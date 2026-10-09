require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const axios = require("axios");
const compression = require("compression");

const app = express();

// =======================================
// MIDDLEWARE DE COMPRESIÓN GZIP (ALTO RENDIMIENTO)
// =======================================
app.use(compression({
    threshold: 1024,
    level: 6
}));

// =======================================
// CONFIGURACIÓN CENTRAL DESACOPLADA
// =======================================

function limpiarVar(val) {
    if (!val) return "";
    let s = String(val).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

const PORT = Number(process.env.PORT) || 3001;

function leerConfiguracion() {
    try {
        const rutaConfig = path.join(__dirname, "public", "config.json");
        if (fs.existsSync(rutaConfig)) {
            const raw = fs.readFileSync(rutaConfig, "utf-8");
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn("[Config] Error leyendo public/config.json:", e.message);
    }
    return {
        estado: "STANDBY",
        proyecto: "Terminal de Supervisión en Espera",
        canton: "",
        provincia: "",
        modalidad: "sectores",
        meta: 0,
        kobo: {}
    };
}

function obtenerParametrosActivos() {
    const config = leerConfiguracion();
    const esStandby = (config.estado || "STANDBY").toUpperCase() === "STANDBY";

    const koboAssetFromConfig = config.kobo && typeof config.kobo.asset_id === "string" ? config.kobo.asset_id.trim() : null;
    const assetId = esStandby
        ? ""
        : (koboAssetFromConfig !== null
            ? koboAssetFromConfig
            : limpiarVar(process.env.ASSET_ID || ""));

    const koboTokenFromConfig = config.kobo && typeof config.kobo.api_token === "string" ? config.kobo.api_token.trim() : null;
    const apiToken = esStandby
        ? ""
        : (koboTokenFromConfig !== null && koboTokenFromConfig !== ""
            ? koboTokenFromConfig
            : limpiarVar(process.env.API_TOKEN || process.env.KOBO_API_TOKEN || process.env.KOBO_TOKEN || ""));

    const campoEnc = limpiarVar(
        process.env.CAMPO_ENCUESTADOR ||
        (config.kobo && config.kobo.campo_encuestador) ||
        "codenc"
    );

    const campoSup = limpiarVar(
        process.env.CAMPO_SUPERVISOR ||
        (config.kobo && config.kobo.campo_supervisor) ||
        "codsup"
    );

    const choicesParroquias = (config.kobo && config.kobo.choices_parroquias) || {};
    const choicesCantones = (config.kobo && config.kobo.choices_cantones) || {};
    const choicesProvincias = (config.kobo && config.kobo.choices_provincias) || {
        "4": "Carchi",
        "8": "Esmeraldas",
        "10": "Imbabura",
        "17": "Pichincha"
    };
    const choicesTipologias = (config.kobo && config.kobo.choices_tipologias) || {
        "1": "A", "2": "B", "3": "C", "4": "D", "5": "E", "6": "F", "7": "G", "8": "H",
        "a": "A", "b": "B", "c": "C", "d": "D", "e": "E", "f": "F", "g": "G", "h": "H"
    };

    return {
        config,
        esStandby,
        assetId,
        apiToken,
        campoEnc,
        campoSup,
        choicesParroquias,
        choicesCantones,
        choicesProvincias,
        choicesTipologias
    };
}

const LIMITE_POR_PAGINA = 3000;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_SEGUNDOS) || 90) * 1000;
const TIMEOUT_MS = 30000;

// Log inicial
const initParams = obtenerParametrosActivos();
if (initParams.esStandby) {
    console.log("[SUPERVISOR] 💤 Terminal en MODO STANDBY (en espera de nuevo proyecto). API Kobo en reposo.");
} else {
    console.log(`[SUPERVISOR] 📡 Proyecto activo: ${initParams.config.proyecto || "Encuesta Activa"} | Formulario Kobo: ${initParams.assetId} (${initParams.apiToken ? "Token presente ✓" : "Sin token ⚠️"})`);
}

// =======================================
// MIDDLEWARE DE SEGURIDAD
// =======================================

app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer",
        "X-XSS-Protection": "0"
    });
    next();
});

// Sirve la carpeta pública (frontend) con control anti-stale estricto
app.use(express.static(path.join(__dirname, "public"), {
    dotfiles: "deny",
    etag: true,
    setHeaders: (res, filePath) => {
        if (/service-worker\.js$/i.test(filePath) || /\.(?:html|json|webmanifest|geojson|css|js)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        } else if (/\.(?:svg|png|jpg|webp|woff2|woff|ttf|pbf)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        }
    }
}));

// =======================================
// CACHÉ EN MEMORIA PARA KOBO
// =======================================

let cache = {
    datos: null,
    timestamp: 0,
    enProceso: null,
    assetId: null
};

function extraerValor(obj, claves) {
    if (!obj || typeof obj !== "object") return "";
    const valorTexto = value => value === undefined || value === null || typeof value === "object"
        ? "" : String(value).trim();
    for (let i = 0; i < claves.length; i++) {
        const k = claves[i];
        const valor = valorTexto(obj[k]);
        if (valor) return valor;
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        for (let j = 0; j < claves.length; j++) {
            const k = claves[j];
            const valor = valorTexto(obj[key]);
            if (key.endsWith("/" + k) && valor) {
                return valor;
            }
        }
        if (typeof obj[key] === "object" && obj[key] !== null) {
            const nested = extraerValor(obj[key], claves);
            if (nested) return nested;
        }
    }
    return "";
}

function normalizarCoordenadas(valores, validarEcuador = false) {
    if (!Array.isArray(valores) || valores.length < 2) return null;
    const par = valores.slice(0, 2);
    if (par.some(v => (typeof v !== "number" && typeof v !== "string") || String(v).trim() === "")) return null;
    let [lat, lng] = par.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -50 && lng > -10 && lng < 10) {
        const tmp = lat; lat = lng; lng = tmp;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (validarEcuador && !(lat >= -5.0 && lat <= 2.5 && lng >= -92.0 && lng <= -75.0)) return null;
    return [lat, lng];
}

function normalizarEncuesta(raw, params) {
    const id = raw._id || "";
    const submissionTime = raw._submission_time || "";
    const start = raw.start || extraerValor(raw, ["start", "inicio"]) || "";
    const end = raw.end || extraerValor(raw, ["end", "fin"]) || "";

    let geo = normalizarCoordenadas(raw._geolocation);
    if (!geo) {
        const gps = extraerValor(raw, [
            "ya_registrado", "gps", "ubicacion_gps", "coordenadas",
            "geopoint", "punto_gps", "punto", "ubicacion"
        ]);
        if (gps) geo = normalizarCoordenadas(gps.split(/\s+/));
    }
    if (!geo) {
        for (const [k, v] of Object.entries(raw)) {
            if (typeof v === "string" && v.includes(" ")) {
                const partes = v.trim().split(/\s+/);
                if (partes.length >= 2) {
                    const testGeo = normalizarCoordenadas(partes, true);
                    if (testGeo) {
                        geo = testGeo;
                        break;
                    }
                }
            }
        }
    }

    const campoEnc = params.campoEnc;
    const campoSup = params.campoSup;

    let encuestador = extraerValor(raw, [campoEnc, "cenc", "codenc", "codencu", "cod_encu", "cod_enc", "C_digo_encuestador", "encuestador", "cod_encuestador"]);
    let supervisor = extraerValor(raw, [campoSup, "csup", "codsup", "cod_sup", "C_digo_Supervisor", "supervisor", "cod_supervisor"]);

    const rawConsen = extraerValor(raw, ["consent", "consen", "consentimiento", "acepta"]);
    const noConsent = rawConsen === "2" || String(rawConsen).trim().toLowerCase() === "no" || String(rawConsen).trim().toLowerCase() === "rechaza";
    const consentimiento = noConsent ? "NO" : "SI";

    const sc = extraerValor(raw, ["seccensal", "sc", "sectorcen", "p_ref", "codigo_sc", "sector_censal", "sector", "punto", "num_muestra"]);
    const rawTipol = String(extraerValor(raw, ["tipol", "tipologia", "TIPOLOGIA", "tipo_sc"]) || "").trim().toLowerCase();
    const tipologia = params.choicesTipologias[rawTipol] || rawTipol.toUpperCase();
    const barrio = extraerValor(raw, ["barrio", "barr", "BARRIO_O_SECTOR", "sector", "barrio_sector"]);

    const rawParroquia = extraerValor(raw, ["parroquia", "PARROQUIA", "nom_parroquia", "parr"]) || "";
    const parroquia = params.choicesParroquias[rawParroquia] || String(rawParroquia).trim().toUpperCase();

    const rawCanton = extraerValor(raw, ["canton", "CANTON", "canton_nombre", "nom_can", "nom_canton"]) || "";
    const cantonDefecto = params.config.canton || "Territorio";
    const canton = params.choicesCantones[rawCanton] || (rawCanton ? String(rawCanton).trim() : cantonDefecto);

    const rawProvincia = extraerValor(raw, ["provincia", "PROVINCIA", "nom_provincia", "prov"]) || "";
    let provincia = params.choicesProvincias[rawProvincia] || (rawProvincia ? String(rawProvincia).trim() : "");
    if (!provincia) {
        const canNorm = String(canton || rawCanton).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (["80", "81", "82", "ELOY ALFARO", "RIOVERDE", "SAN LORENZO"].some(k => canNorm.includes(k))) {
            provincia = "Esmeraldas";
        } else if (["40", "41", "42", "43", "44", "BOLIVAR", "ESPEJO", "MIRA", "MONTUFAR", "SAN PEDRO DE HUACA", "TULCAN", "HUACA"].some(k => canNorm.includes(k))) {
            provincia = "Carchi";
        } else if (["101", "102", "103", "104", "105", "106", "ANTONIO ANTE", "COTACACHI", "IBARRA", "OTAVALO", "PIMAMPIRO", "SAN MIGUEL DE URCUQUI", "URCUQUI"].some(k => canNorm.includes(k))) {
            provincia = "Imbabura";
        } else if (["171", "PEDRO MONCAYO", "QUITO", "MEJIA", "CAYAMBE", "RUMINAHUI"].some(k => canNorm.includes(k))) {
            provincia = "Pichincha";
        } else {
            const parNorm = String(parroquia || rawParroquia).trim();
            if (parNorm.startsWith("8")) provincia = "Esmeraldas";
            else if (parNorm.startsWith("4")) provincia = "Carchi";
            else if (parNorm.startsWith("10")) provincia = "Imbabura";
            else if (parNorm.startsWith("17")) provincia = "Pichincha";
        }
    }

    const rawCirc = extraerValor(raw, ["circunscripcion", "circ", "CIRCUNSCRIPCION"]) || "";
    const CIRCUNSCRIPCIONES = { "1": "CIRCUNSCRIPCION URBANA 1", "2": "CIRCUNSCRIPCION URBANA 2", "3": "CIRCUNSCRIPCION RURAL" };
    const circunscripcion = CIRCUNSCRIPCIONES[rawCirc] || String(rawCirc).trim();

    const rawGen = extraerValor(raw, [
        "p1", "p1_1", "genero", "p_genero", "sexo", "gender",
        "1. ¿CUÁL ES SU GÉNERO?", "1._CU_L_ES_SU_G_NERO",
        "genero_resp", "p1_genero"
    ]) || "";

    let genero = rawGen;
    if (rawGen === "1" || rawGen.toLowerCase().includes("masc") || rawGen.toLowerCase().includes("hombre")) {
        genero = "Hombre";
    } else if (rawGen === "2" || rawGen.toLowerCase().includes("fem") || rawGen.toLowerCase().includes("mujer")) {
        genero = "Mujer";
    } else if (rawGen === "3") {
        genero = "LGBTIQ+";
    } else if (rawGen === "0") {
        genero = "Otro";
    }

    const edadRaw = extraerValor(raw, [
        "p2", "edad", "p_edad", "age",
        "2. ¿CUÁL ES SU EDAD? (edad cumplida en años)",
        "2._CU_L_ES_SU_EDAD_edad_cumplida_en_a_os",
        "2. ¿CUÁNTOS AÑOS TIENE?",
        "p2_edad"
    ]) || "";
    const edadNum = Number(edadRaw);
    const edad = (!isNaN(edadNum) && edadNum > 0 && edadNum < 120) ? edadNum : null;

    return {
        _id: id,
        _submission_time: submissionTime,
        start,
        end,
        _geolocation: geo,
        [campoEnc]: encuestador,
        [campoSup]: supervisor,
        cod_enc: encuestador,
        cod_sup: supervisor,
        cenc: encuestador,
        csup: supervisor,
        encuestador,
        supervisor,
        sc,
        tipologia,
        barrio,
        parroquia,
        canton,
        provincia,
        circunscripcion,
        genero,
        edad,
        consentimiento,
        consen: rawConsen || (noConsent ? "2" : "1")
    };
}

async function fetchConReintento(url, opciones, maxReintentos = 2) {
    for (let intento = 0; intento <= maxReintentos; intento++) {
        try {
            return await axios.get(url, opciones);
        } catch (err) {
            const esTransitorio = !err.response || err.response.status >= 500 || err.code === "ECONNABORTED";
            if (intento < maxReintentos && esTransitorio) {
                const espera = (intento + 1) * 1200;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            throw err;
        }
    }
}

async function obtenerDatosKobo() {
    const params = obtenerParametrosActivos();
    if (params.esStandby || !params.assetId || !params.apiToken) {
        return {
            estado: params.esStandby ? "STANDBY" : "CONFIG_PENDIENTE",
            total: 0,
            resultados: [],
            obtenidoEn: Date.now(),
            mensaje: params.esStandby
                ? "Terminal en reposo (Standby). Sin encuesta activa asignada."
                : "Esperando configuración de credenciales Kobo."
        };
    }

    const ahora = Date.now();
    if (cache.datos && cache.assetId === params.assetId && ahora - cache.timestamp < CACHE_TTL_MS) {
        return cache.datos;
    }

    if (cache.enProceso) {
        return cache.enProceso;
    }

    cache.enProceso = (async () => {
        const origenKobo = new URL(`https://kf.kobotoolbox.org/api/v2/assets/${encodeURIComponent(params.assetId)}/data/`);
        let url = `${origenKobo.href}?limit=${LIMITE_POR_PAGINA}`;
        const resultadosRaw = [];
        const paginasVisitadas = new Set();
        let total = null;

        while (url) {
            const pagina = new URL(url, origenKobo);
            if (pagina.origin !== origenKobo.origin || pagina.pathname !== origenKobo.pathname || pagina.username || pagina.password || paginasVisitadas.has(pagina.href)) {
                throw new Error("Paginación de Kobo inválida: destino ajeno al formulario o página repetida.");
            }
            paginasVisitadas.add(pagina.href);
            url = pagina.href;
            const respuesta = await fetchConReintento(url, {
                headers: { Authorization: `Token ${params.apiToken}` },
                timeout: TIMEOUT_MS,
                maxRedirects: 0
            });

            const data = respuesta.data;
            if (!data || !Array.isArray(data.results) || !Number.isInteger(data.count) || data.count < 0 ||
                (data.next !== null && data.next !== undefined && typeof data.next !== "string")) {
                throw new Error("Respuesta de Kobo inválida: estructura de paginación no reconocida.");
            }
            total = data.count;
            resultadosRaw.push(...data.results);
            url = data.next;
        }
        if (resultadosRaw.length !== total) {
            throw new Error("Respuesta de Kobo incompleta: el conteo no coincide con las boletas recibidas.");
        }

        const provinciaObjetivo = (params.config.provincia || "").trim().toUpperCase();

        const resultados = resultadosRaw
            .map(raw => normalizarEncuesta(raw, params))
            .filter(e => {
                if (String(e.encuestador).trim() === "98" || String(e.supervisor).trim() === "98") return false;
                if (e.consentimiento === "NO" || String(e.consen).trim() === "2") return false;
                if (provinciaObjetivo && e.provincia && e.provincia.trim().toUpperCase() !== provinciaObjetivo) {
                    return false;
                }
                return true;
            });

        cache.datos = {
            estado: "ACTIVO",
            total: resultados.length,
            resultados,
            obtenidoEn: Date.now()
        };
        cache.timestamp = Date.now();
        cache.assetId = params.assetId;
        return cache.datos;
    })();

    try {
        const datos = await cache.enProceso;
        return datos;
    } finally {
        cache.enProceso = null;
    }
}

// =======================================
// RUTAS DE API
// =======================================

app.get("/api/health", (req, res) => {
    const params = obtenerParametrosActivos();
    res.json({
        estado: params.esStandby ? "STANDBY" : "ACTIVO",
        koboConfigurado: Boolean(params.assetId && params.apiToken),
        cacheActiva: Boolean(cache.datos),
        cacheEdadSegundos: cache.datos ? Math.round((Date.now() - cache.timestamp) / 1000) : null
    });
});

app.get("/api/config", (req, res) => {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    });
    const params = obtenerParametrosActivos();
    const cfg = params.config;

    res.json({
        estado: params.esStandby ? "STANDBY" : "ACTIVO",
        version: cfg.version || "1.0.0",
        proyecto: cfg.proyecto || (params.esStandby ? "Terminal de Supervisión en Espera" : "Encuesta de Campo"),
        canton: cfg.canton || "",
        provincia: cfg.provincia || "",
        modalidad: cfg.modalidad || "sectores",
        meta: Number(cfg.meta) || 500,
        bounds: cfg.bounds || null,
        equipo: cfg.equipo || { supervisores: {}, encuestadores: {} },
        kobo: {
            campoEncuestador: params.campoEnc,
            campoSupervisor: params.campoSup
        }
    });
});

app.get("/api/encuestas", async (req, res) => {
    try {
        res.set({
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        });
        if (req.query.fresh === "1") {
            cache.datos = null;
            cache.timestamp = 0;
        }
        const datos = await obtenerDatosKobo();
        res.json(datos);
    } catch (error) {
        const mensaje = error.response
            ? `Kobo respondió ${error.response.status}`
            : error.code === "ECONNABORTED"
                ? "Kobo tardó demasiado en responder"
                : error.message;
        console.error(`[${new Date().toLocaleTimeString("es-EC")}] Error al consultar Kobo: ${mensaje}`);
        res.status(502).json({ error: "No fue posible acceder a Kobo.", detalle: mensaje });
    }
});

app.post("/api/sync", async (req, res) => {
    try {
        cache.datos = null;
        cache.timestamp = 0;
        const datos = await obtenerDatosKobo();
        res.json({ estado: datos.estado, total: datos.total, obtenidoEn: datos.obtenidoEn });
    } catch (error) {
        res.status(502).json({ error: "No fue posible sincronizar con Kobo." });
    }
});

app.use("/api", (req, res) => {
    res.status(404).json({ error: "Ruta de API no encontrada" });
});

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SUPERVISOR] 🚀 Servidor Core escuchando en http://0.0.0.0:${PORT}`);
});
