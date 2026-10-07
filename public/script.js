/**
 * Supervisor de Campo — Clima Social
 * Frontend Logic: Layout 2 Columnas, Filtros Cruzados (Sector, Supervisor, Fecha), 
 * Modo Puntos Individuales vs Clusters y Seguimiento en Tiempo Real.
 */

// =========================================================================
// PROTECCIÓN DE CLIENTE Y PRIVACIDAD DE CÓDIGO EN PRODUCCIÓN
// Deshabilita accesos directos de DevTools, clic derecho y limpia consola
// =========================================================================
(function() {
    // 1. Bloqueo de Clic Derecho (Menú contextual de inspección)
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    }, { passive: false });

    // 2. Bloqueo de Teclas de Inspección (F12, Ctrl+Shift+I/J/C, Ctrl+U)
    document.addEventListener('keydown', function(e) {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
            (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's'))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, { passive: false });

    // 3. Suprimir salida de consola en cliente
    try {
        if (window.console) {
            const noop = function() {};
            window.console.log = noop;
            window.console.info = noop;
            window.console.debug = noop;
            window.console.dir = noop;
        }
    } catch (_) {}
})();

document.addEventListener('DOMContentLoaded', () => {
    // Purga proactiva inmediata de cachés heredadas de otros cantones o versiones en el navegador (Brave/Chrome)
    if ('caches' in window) {
        const CACHE_VALIDA = 'clima-social-v80-purge';
        caches.keys().then(keys => {
            keys.forEach(k => {
                if (k !== CACHE_VALIDA) {
                    console.log('[Cache] Purgando caché obsoleta o de cantón previo:', k);
                    caches.delete(k);
                }
            });
        }).catch(() => {});
    }

    // Normalizador universal de texto (remueve tildes, diacríticos y espacios)
    const normTexto = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

    // =========================================================================
    // ESTADO GLOBAL DE LA APLICACIÓN
    // =========================================================================
    const AppState = {
        config: {
            nombreProyecto: 'Terminal de Supervisión',
            metaEncuestas: 0,
            campoEncuestador: 'codenc',
            campoSupervisor: 'codsup'
        },
        encuestas: [],
        supervisorSeleccionado: 'Todos',
        cantonSeleccionado: 'Todos',
        sectorSeleccionado: 'Todos',
        parroquiaSeleccionada: 'Todas',
        fechaSeleccionada: 'Todas',
        encuestadorSeleccionado: null,
        mostrarEtiquetas: false,
        capasVisibles: {
            sectores: true,
            parroquias: true
        },
        filtroGPS: 'Todos',
        filtroSoloAlertas: false,
        filtroSoloPendientes: false,
        conteoPorSector: new Map(),
        totalAlertas: 0,
        erroresColapsados: true,
        filtroTabla: '',
        modoVisualizacion: 'puntos',
        modoAgrupacionTabla: 'supervisor',
        ordenTabla: { columna: 'encuestador', asc: true },
        supervisoresExpandidos: new Set(),
        ubicacionSupervisor: null,
        markerSupervisor: null,
        mapLoaded: false,
        cantonBbox: [[-78.36, 0.14], [-78.14, 0.29]],
        parroquiasGeojson: null,
        parroquiasMap: new Map(),
        sectoresGeojson: null,
        sectoresMap: new Map()
    };
    window.AppState = AppState;

    // Paleta oficial Clima Social de Alto Contraste para Mapa (Supervisores)
    const PALETA_SUPERVISORES = {
        '1': '#028090', // Teal Intenso Oficial
        '2': '#e11d48', // Coral / Carmesí Vivo
        '3': '#d97706', // Ámbar Dorado Brillante
        '4': '#7c3aed', // Violeta Real Intenso
        '5': '#059669', // Verde Esmeralda Vivo
        '6': '#2563eb', // Azul Cobalto Eléctrico
        '7': '#ea580c', // Naranja Intenso
        'default': '#f26419'
    };

    // Directorio dinámico del Equipo de Campo (100% desacoplado, se puebla desde config.json)
    let SUPERVISORES_CAMPO = {};
    let EQUIPO_CAMPO = {};
    let SUPERVISOR_ENCUESTADORES = {};
    let ENCUESTADOR_A_SUPERVISOR = {};

    function obtenerEtiquetaEncuestador(id, formato = 'corto') {
        const raw = String(id || '').trim();
        if (!raw || raw === 'Sin asignar' || raw === 'undefined' || raw === 'null') return 'Sin Asignar';
        const numOnly = parseInt(raw, 10);
        const sid = !isNaN(numOnly) ? String(numOnly) : raw;
        const miembro = EQUIPO_CAMPO[sid] || EQUIPO_CAMPO[raw];
        if (miembro) {
            if (formato === 'completo') return `Enc. ${sid} · ${miembro.nombre}`;
            if (formato === 'nombre') return miembro.nombre;
            if (formato === 'primerNombre') return miembro.primerNombre;
            if (formato === 'busqueda') return `Enc. ${sid} ${miembro.primerNombre} ${miembro.nombre}`;
            return `Enc. ${sid} · ${miembro.primerNombre}`;
        }
        if (!isNaN(numOnly)) {
            return `Enc. ${sid}`;
        }
        return `Enc. ${raw}`;
    }

    function obtenerEtiquetaSupervisor(id, formato = 'corto') {
        const raw = String(id || '').trim();
        if (!raw || raw === 'Sin asignar' || raw === 'undefined' || raw === 'null' || raw === '0') return formato === 'micro' ? 'Sin Sup' : 'Sin Supervisor';
        const numOnly = parseInt(raw, 10);
        const sid = !isNaN(numOnly) ? String(numOnly) : raw;
        const miembro = SUPERVISORES_CAMPO[sid] || SUPERVISORES_CAMPO[raw];
        if (miembro) {
            if (formato === 'completo') return `Sup. ${sid} · ${miembro.nombre}`;
            if (formato === 'micro') return `Sup. ${sid}`;
            if (formato === 'nombre') return miembro.nombre;
            if (formato === 'primerNombre') return miembro.primerNombre;
            if (formato === 'busqueda') return `Sup. ${sid} ${miembro.primerNombre} ${miembro.nombre}`;
            return `Sup. ${sid} · ${miembro.primerNombre}`;
        }
        if (!isNaN(numOnly)) {
            return `Sup. ${sid}`;
        }
        return `Sup. ${raw}`;
    }

    // Paleta cromática distintiva de alto contraste para Encuestadores (excluye Teal #0d9488 de Muestreo)
    const PALETA_ENCUESTADORES = [
        '#e11d48', // 1: Carmesí / Rojo Vivo
        '#2563eb', // 2: Azul Eléctrico
        '#ea580c', // 3: Naranja Fuego
        '#7c3aed', // 4: Violeta / Púrpura
        '#f59e0b', // 5: Ámbar Dorado
        '#16a34a', // 6: Verde Vivo
        '#db2777', // 7: Rosa Intenso / Magenta
        '#4f46e5', // 8: Índigo
        '#84cc16', // 9: Lima Brillante
        '#9333ea', // 10: Morado
        '#d97706', // 11: Ocre Cálido
        '#0284c7', // 12: Azul Cielo
        '#b91c1c', // 13: Rojo Granate
        '#475569', // 14: Grafito / Pizarra
        '#c026d3', // 15: Fucsia Neón
        '#65a30d', // 16: Verde Oliva
        '#e11d8f', // 17: Baya / Frambuesa
        '#3b82f6', // 18: Azul Brillante
        '#ca8a04', // 19: Mostaza
        '#6366f1', // 20: Azul Lavanda
        '#a855f7', // 21: Púrpura Claro
        '#dc2626', // 22: Escarlata
        '#f97316', // 23: Naranja Brillante
        '#15803d', // 24: Verde Pino
        '#0891b2', // 25: Cian Petróleo
        '#4338ca', // 26: Azul Índigo Oscuro
        '#be185d', // 27: Rosa Profundo
        '#047857'  // 28: Verde Esmeralda Oscuro
    ];

    // Parroquias oficiales organizadas por Cantón (se enriquece automáticamente desde el GeoJSON)
    const PARROQUIAS_POR_CANTON = {};

    // =========================================================================
    // IDENTIDAD VISUAL Y PALETA CROMÁTICA POR CANTÓN (CLIMA SOCIAL)
    // =========================================================================
    function hexToRgba(hex, alpha = 0.20) {
        if (!hex || typeof hex !== 'string') return `rgba(2, 128, 144, ${alpha})`;
        let c = hex.replace('#', '').trim();
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        if (c.length !== 6) return `rgba(2, 128, 144, ${alpha})`;
        const num = parseInt(c, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const PALETA_ROTATIVA_CANTONES = [
        '#028090', '#7c3aed', '#059669', '#d97706', '#ea580c',
        '#2563eb', '#1d4ed8', '#0d9488', '#dc2626', '#9333ea',
        '#0891b2', '#0284c7', '#65a30d', '#1e40af', '#be185d',
        '#4f46e5', '#ca8a04', '#047857', '#991b1b', '#0369a1'
    ];

    const PALETA_CANTONES_DEF = {
        // === IMBABURA ===
        'IBARRA': { nombre: 'Ibarra', hex: '#028090', badge: '📍' },
        'OTAVALO': { nombre: 'Otavalo', hex: '#7c3aed', badge: '🧵' },
        'COTACACHI': { nombre: 'Cotacachi', hex: '#059669', badge: '🏔️' },
        'ANTONIO ANTE': { nombre: 'Antonio Ante', hex: '#d97706', badge: '🏭' },
        'ATUNTAQUI': { nombre: 'Antonio Ante', hex: '#d97706', badge: '🏭' },
        'PIMAMPIRO': { nombre: 'Pimampiro', hex: '#ea580c', badge: '🍑' },
        'SAN MIGUEL DE URCUQUI': { nombre: 'Urcuquí', hex: '#2563eb', badge: '🔬' },
        'URCUQUI': { nombre: 'Urcuquí', hex: '#2563eb', badge: '🔬' },

        // === CARCHI ===
        'TULCAN': { nombre: 'Tulcán', hex: '#1d4ed8', badge: '🌲' },
        'TULCÁN': { nombre: 'Tulcán', hex: '#1d4ed8', badge: '🌲' },
        'MONTUFAR': { nombre: 'Montúfar', hex: '#0d9488', badge: '🏛️' },
        'MONTÚFAR': { nombre: 'Montúfar', hex: '#0d9488', badge: '🏛️' },
        'ESPEJO': { nombre: 'Espejo', hex: '#b91c1c', badge: '🌾' },
        'MIRA': { nombre: 'Mira', hex: '#9333ea', badge: '🍇' },
        'BOLIVAR': { nombre: 'Bolívar', hex: '#c2410c', badge: '⛰️' },
        'BOLÍVAR': { nombre: 'Bolívar', hex: '#c2410c', badge: '⛰️' },
        'SAN PEDRO DE HUACA': { nombre: 'San Pedro de Huaca', hex: '#0891b2', badge: '🥔' },
        'HUACA': { nombre: 'Huaca', hex: '#0891b2', badge: '🥔' },

        // === ESMERALDAS ===
        'ESMERALDAS': { nombre: 'Esmeraldas', hex: '#059669', badge: '🌴' },
        'ATACAMES': { nombre: 'Atacames', hex: '#0284c7', badge: '🏖️' },
        'QUININDE': { nombre: 'Quinindé', hex: '#ea580c', badge: '🌿' },
        'QUININDÉ': { nombre: 'Quinindé', hex: '#ea580c', badge: '🌿' },
        'SAN LORENZO': { nombre: 'San Lorenzo', hex: '#7c3aed', badge: '🚂' },
        'ELOY ALFARO': { nombre: 'Eloy Alfaro', hex: '#65a30d', badge: '🛶' },
        'MUISNE': { nombre: 'Muisne', hex: '#1e40af', badge: '🦀' },
        'RIOVERDE': { nombre: 'Rioverde', hex: '#be185d', badge: '🌊' },

        // === PICHINCHA ===
        'QUITO': { nombre: 'Quito', hex: '#1e3a8a', badge: '🏛️' },
        'D.M. QUITO': { nombre: 'Quito', hex: '#1e3a8a', badge: '🏛️' },
        'RUMIÑAHUI': { nombre: 'Rumiñahui', hex: '#400054', badge: '🌽' },
        'RUMINAHUI': { nombre: 'Rumiñahui', hex: '#400054', badge: '🌽' },
        'MEJIA': { nombre: 'Mejía', hex: '#991b1b', badge: '🌋' },
        'MEJÍA': { nombre: 'Mejía', hex: '#991b1b', badge: '🌋' },
        'CAYAMBE': { nombre: 'Cayambe', hex: '#ea580c', badge: '🧀' },
        'PEDRO MONCAYO': { nombre: 'Pedro Moncayo', hex: '#db2777', badge: '🌹' },
        'SAN MIGUEL DE LOS BANCOS': { nombre: 'Los Bancos', hex: '#047857', badge: '🦜' },
        'PEDRO VICENTE MALDONADO': { nombre: 'P.V. Maldonado', hex: '#0284c7', badge: '🌿' },
        'PUERTO QUITO': { nombre: 'Puerto Quito', hex: '#15803d', badge: '🛶' },

        // === GUAYAS & COSTA ===
        'GUAYAQUIL': { nombre: 'Guayaquil', hex: '#0284c7', badge: '⚓' },
        'SAMBORONDON': { nombre: 'Samborondón', hex: '#7c3aed', badge: '🏙️' },
        'SAMBORONDÓN': { nombre: 'Samborondón', hex: '#7c3aed', badge: '🏙️' },
        'DAULE': { nombre: 'Daule', hex: '#d97706', badge: '🌾' },
        'DURAN': { nombre: 'Durán', hex: '#e11d48', badge: '🚆' },
        'DURÁN': { nombre: 'Durán', hex: '#e11d48', badge: '🚆' },
        'MACHALA': { nombre: 'Machala', hex: '#d97706', badge: '🍌' },
        'MANTA': { nombre: 'Manta', hex: '#0d9488', badge: '🐟' },
        'PORTOVIEJO': { nombre: 'Portoviejo', hex: '#15803d', badge: '🌳' },
        'SANTO DOMINGO': { nombre: 'Santo Domingo', hex: '#c2410c', badge: '🍍' },

        // === SIERRA SUR & CENTRO ===
        'CUENCA': { nombre: 'Cuenca', hex: '#b91c1c', badge: '⛲' },
        'LOJA': { nombre: 'Loja', hex: '#2563eb', badge: '🎵' },
        'AMBATO': { nombre: 'Ambato', hex: '#4d7c0f', badge: '🍎' },
        'RIOBAMBA': { nombre: 'Riobamba', hex: '#334155', badge: '🚂' }
    };

    const COLORES_CANTON = {};

    function registrarColorCanton(clave, info) {
        const keyNorm = normTexto(clave);
        const hex = info.hex || '#028090';
        COLORES_CANTON[keyNorm] = {
            nombre: info.nombre || clave,
            hex: hex,
            linea: hex,
            fill: hexToRgba(hex, 0.20),
            fillSector: hexToRgba(hex, 0.35),
            lineaSector: hex,
            label: hex,
            badge: info.badge || '📍',
            pinSlug: `pin-can-${keyNorm.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
        };
        return COLORES_CANTON[keyNorm];
    }

    Object.keys(PALETA_CANTONES_DEF).forEach(k => {
        registrarColorCanton(k, PALETA_CANTONES_DEF[k]);
    });

    function obtenerConfigCanton(cantonNombre) {
        if (!cantonNombre) {
            return COLORES_CANTON['IBARRA'] || {
                nombre: 'Territorio',
                hex: '#028090',
                linea: '#028090',
                fill: 'rgba(2, 128, 144, 0.20)',
                fillSector: 'rgba(2, 128, 144, 0.35)',
                lineaSector: '#005f73',
                label: '#005f73',
                badge: '📍',
                pinSlug: 'pin-referencia'
            };
        }
        const kNorm = normTexto(cantonNombre);
        if (COLORES_CANTON[kNorm]) return COLORES_CANTON[kNorm];

        // Autodescubrimiento con hash determinista
        let hash = 0;
        for (let i = 0; i < kNorm.length; i++) {
            hash = (hash << 5) - hash + kNorm.charCodeAt(i);
            hash |= 0;
        }
        const hexElegido = PALETA_ROTATIVA_CANTONES[Math.abs(hash) % PALETA_ROTATIVA_CANTONES.length];
        return registrarColorCanton(kNorm, {
            nombre: cantonNombre,
            hex: hexElegido,
            badge: '📍'
        });
    }

    // Expresiones MapLibre GL multicantón
    function generarExprCanton(propiedad, fallback) {
        const expr = ['match', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']]];
        const keys = Object.keys(COLORES_CANTON);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const val = COLORES_CANTON[k][propiedad];
            if (val) {
                expr.push(k, val);
            }
        }
        expr.push(fallback);
        return expr;
    }

    const EXPR_PARROQUIAS_FILL = generarExprCanton('fill', 'rgba(2, 128, 144, 0.20)');
    const EXPR_PARROQUIAS_LINE = generarExprCanton('linea', '#028090');
    const EXPR_PARROQUIAS_LABEL = generarExprCanton('label', '#005f73');
    const EXPR_SECTORES_FILL = generarExprCanton('fillSector', 'rgba(2, 128, 144, 0.35)');
    const EXPR_SECTORES_LINE = generarExprCanton('lineaSector', '#028090');
    const EXPR_SECTORES_LABEL = generarExprCanton('label', '#005f73');
    const EXPR_PIN_CANTON = generarExprCanton('pinSlug', 'pin-referencia');

    // Aliases para compatibilidad
    const EXPR_CANTON_PARROQUIAS_LINE = EXPR_PARROQUIAS_LINE;
    const EXPR_CANTON_PARROQUIAS_LABEL = EXPR_PARROQUIAS_LABEL;
    const EXPR_CANTON_SECTORES_FILL = EXPR_SECTORES_FILL;
    const EXPR_CANTON_SECTORES_LINE = EXPR_SECTORES_LINE;
    const EXPR_CANTON_SECTORES_LABEL = EXPR_SECTORES_LABEL;

    function obtenerColorEncuestador(enc) {
        if (enc === undefined || enc === null || enc === '') return '#64748b';
        const str = String(enc).trim();
        const num = parseInt(str, 10);
        if (!isNaN(num) && num > 0) {
            return PALETA_ENCUESTADORES[(num - 1) % PALETA_ENCUESTADORES.length];
        }
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return PALETA_ENCUESTADORES[Math.abs(hash) % PALETA_ENCUESTADORES.length];
    }

    const UI = {
        cargaOverlay: document.getElementById('cargaOverlay'),
        errorBanner: document.getElementById('errorBanner'),
        botonReintentar: document.getElementById('botonReintentar'),
        tituloProyecto: document.getElementById('tituloProyecto'),
        badgeTexto: document.getElementById('badgeTexto'),
        hora: document.getElementById('hora'),
        fecha: document.getElementById('fecha'),
        botonSync: document.getElementById('botonSync'),
        botonModoOscuro: document.getElementById('botonModoOscuro'),
        
        // KPIs
        kpiTotal: document.getElementById('kpiTotal'),
        kpiHoy: document.getElementById('kpiHoy'),
        kpiPendientes: document.getElementById('kpiPendientes'),
        kpiSubPendientes: document.getElementById('kpiSubPendientes'),
        kpiAvance: document.getElementById('kpiAvance'),
        kpiTituloAvance: document.getElementById('kpiTituloAvance'),
        kpiSubAvance: document.getElementById('kpiSubAvance'),
        barraAvance: document.getElementById('barraAvance'),
        kpiMeta: document.getElementById('kpiMeta'),
        
        // Filtros Cruzados
        supervisorFilter: document.getElementById('supervisorFilter'),
        cantonFilter: document.getElementById('cantonFilter'),
        sectorFilter: document.getElementById('sectorFilter'),
        parroquiaFilter: document.getElementById('parroquiaFilter'),
        fechaFilter: document.getElementById('fechaFilter'),
        datePills: document.querySelectorAll('#datePills .cs-date-pill'),
        btnLimpiarFiltros: document.getElementById('btnLimpiarFiltros'),
        txtLimpiarFiltros: document.getElementById('txtLimpiarFiltros'),
        activeFilterChipsWrap: document.getElementById('activeFilterChipsWrap'),
        activeFilterChips: document.getElementById('activeFilterChips'),
        
        // Mapa, Capas y Modos
        mapContainer: document.getElementById('map'),
        mapLegend: document.getElementById('mapLegend'),
        mapLegendItems: document.getElementById('mapLegendItems'),
        locateBtn: document.getElementById('locateBtn'),
        btnEtiquetasOn: document.getElementById('btnEtiquetasOn'),
        btnEtiquetasOff: document.getElementById('btnEtiquetasOff'),
        mapStats: document.getElementById('mapStats'),
        toggleCantones: document.getElementById('toggleCantones'),
        toggleSectores: document.getElementById('toggleSectores'),
        toggleSoloPendientes: document.getElementById('toggleSoloPendientes'),
        lblToggleSoloPendientes: document.getElementById('lblToggleSoloPendientes'),
        toggleParroquias: document.getElementById('toggleParroquias'),
        cantonLegendBar: document.getElementById('cantonLegendBar'),
        toggleAlerta: document.getElementById('toggleAlerta'),
        
        // Tabla
        searchInput: document.getElementById('searchInput'),
        tablaEncuestadoresBody: document.querySelector('#tablaEncuestadores tbody'),
        emptyState: document.getElementById('emptyState'),
        headersTabla: document.querySelectorAll('#tablaEncuestadores th'),
        btnAgruparCanton: document.getElementById('btnAgruparCanton'),
        btnAgruparSupervisor: document.getElementById('btnAgruparSupervisor'),
        
        // Pirámide Poblacional (Sexo y Edad)
        panelPiramide: document.getElementById('panelPiramide'),
        togglePiramide: document.getElementById('togglePiramide'),
        subtextoPiramide: document.getElementById('subtextoPiramide'),
        tagHombres: document.getElementById('tagHombres'),
        tagMujeres: document.getElementById('tagMujeres'),
        filasPiramide: document.getElementById('filasPiramide'),

        // Footer & Toast
        ultimaActualizacion: document.getElementById('ultimaActualizacion'),
        toast: document.getElementById('toast')
    };

    let map = null;
    let popupSectorActivo = null;

    function abrirPopupPuntoMuestra(sectorMeta, coordsExplicit) {
        if (!sectorMeta) return;
        const p = sectorMeta.props || (sectorMeta.feature && sectorMeta.feature.properties) || {};
        const sc = String(p.sc || p.codigo_muestra || p.num_muestra || '').trim();
        const tip = String(p.tipologia || '').trim().toUpperCase();
        const etiq = sectorMeta.etiquetaSC || p.etiquetaSC || p.etiqueta || (sc && tip ? `${sc} | ${tip}` : sc);
        const parroquia = sectorMeta.parroquia || p.parroquia || p.PARROQUIA || '';
        const canton = sectorMeta.canton || p.canton || p.CANTON || '';
        const puntoRef = p.punto_referencial || p.PUNTO_REFERENCIAL || '';
        const casos = p.casos || p.CASOS || 10;

        let lng = null, lat = null;
        if (coordsExplicit && typeof coordsExplicit.lng === 'number' && typeof coordsExplicit.lat === 'number') {
            lng = coordsExplicit.lng;
            lat = coordsExplicit.lat;
        } else if (coordsExplicit && Array.isArray(coordsExplicit) && coordsExplicit.length >= 2) {
            lng = coordsExplicit[0];
            lat = coordsExplicit[1];
        } else if (p.longitud && p.latitud) {
            lng = Number(p.longitud);
            lat = Number(p.latitud);
        } else if (sectorMeta.centroid && Array.isArray(sectorMeta.centroid)) {
            lng = sectorMeta.centroid[0];
            lat = sectorMeta.centroid[1];
        } else if (sectorMeta.feature && sectorMeta.feature.geometry && sectorMeta.feature.geometry.coordinates) {
            lng = sectorMeta.feature.geometry.coordinates[0];
            lat = sectorMeta.feature.geometry.coordinates[1];
        }

        const cInfo = COLORES_CANTON[canton] || {};
        const cColor = cInfo.hex || '#059669';
        const gmapsUrl = (lat && lng)
            ? `https://www.google.com/maps/dir/?api=1&destination=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`
            : '#';

        // 1. Configurar y Mostrar Barra Flotante de Navegación
        const barra = document.getElementById('barraSectorActivo');
        const titulo = document.getElementById('sectorActivoTitulo');
        const btnGmaps = document.getElementById('btnRutaGoogleMaps');
        if (barra && titulo && btnGmaps) {
            titulo.textContent = `Punto #${etiq}${puntoRef ? ` · ${puntoRef}` : ` (${parroquia})`}`;
            btnGmaps.href = gmapsUrl;
            barra.style.display = 'inline-flex';
        }

        // 2. Abrir Popup en el Mapa
        if (popupSectorActivo) {
            popupSectorActivo.remove();
            popupSectorActivo = null;
        }
        if (map && lat && lng) {
            popupSectorActivo = new maplibregl.Popup({ offset: [0, -12], closeButton: true, maxWidth: '320px' })
                .setLngLat([lng, lat])
                .setHTML(`
                    <div style="font-family:'Inter',sans-serif;padding:6px 8px;min-width:220px;text-align:center;">
                        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:1.05rem;color:${cColor};margin-bottom:2px;">
                            🎯 Punto #${etiq}
                        </div>
                        <div style="font-size:0.78rem;font-weight:700;color:#64748b;margin-bottom:6px;">
                            ${canton} · ${parroquia}
                        </div>
                        ${puntoRef ? `<div style="font-size:0.75rem;color:#1e293b;background:#f8fafc;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:8px;text-align:left;line-height:1.35;font-weight:500;">📍 ${puntoRef}</div>` : ''}
                        <div style="font-size:0.75rem;color:#475569;margin-bottom:8px;">Cuota de Campo: <strong style="color:#0f172a;">${casos} encuestas</strong></div>
                        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="cs-btn-gmaps" style="display:inline-flex;justify-content:center;align-items:center;gap:6px;width:100%;padding:7px 12px;font-size:0.82rem;font-weight:700;border-radius:9999px;text-decoration:none;box-sizing:border-box;">
                            <svg class="cs-icon" style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                            Cómo llegar (Google Maps)
                        </a>
                    </div>
                `)
                .addTo(map);
        }
    }

    // =========================================================================
    // RESOLVER DE CAMPOS KOBO (Ultra-rápido O(1) con fallback)
    // =========================================================================
    function campo(encuesta, nombreCorto) {
        if (!encuesta) return undefined;
        if (encuesta[nombreCorto] !== undefined) return encuesta[nombreCorto];
        
        // Fast paths directos para rendimiento instantáneo
        if ((nombreCorto === 'sc' || nombreCorto === 'p_ref') && (encuesta.sc !== undefined || encuesta.p_ref !== undefined)) return encuesta.sc !== undefined ? encuesta.sc : encuesta.p_ref;
        if ((nombreCorto === 'tipologia' || nombreCorto === 'TIPOLOGIA') && encuesta.tipologia !== undefined) return encuesta.tipologia;
        if ((nombreCorto === 'parroquia' || nombreCorto === 'PARROQUIA' || nombreCorto === 'nom_parroquia') && encuesta.parroquia !== undefined) return encuesta.parroquia;
        if ((nombreCorto === 'barrio' || nombreCorto === 'BARRIO_O_SECTOR') && encuesta.barrio !== undefined) return encuesta.barrio;
        if ((nombreCorto === 'C_digo_encuestador' || nombreCorto === 'codencu') && encuesta.encuestador !== undefined) return encuesta.encuestador;
        if ((nombreCorto === 'C_digo_Supervisor' || nombreCorto === 'codsup') && encuesta.supervisor !== undefined) return encuesta.supervisor;

        const keys = Object.keys(encuesta);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k.endsWith('/' + nombreCorto)) return encuesta[k];
        }
        return undefined;
    }

    // =========================================================================
    // EXTRACCIÓN Y NORMALIZACIÓN DE PARROQUIA Y CANTÓN (IBARRA)
    // =========================================================================
    function normalizarCanton(valor) {
        if (!valor) return (AppState.config && (AppState.config.canton || AppState.config.provincia)) ? normTexto(AppState.config.canton || AppState.config.provincia) : 'TERRITORIO';
        return normTexto(valor);
    }

    function parroquiaDeclarada(encuesta) {
        return String(campo(encuesta, 'parroquia') || campo(encuesta, 'PARROQUIA')
            || campo(encuesta, 'nom_parroquia') || campo(encuesta, 'nom_par') || '').trim().toUpperCase();
    }

    function cantonDeclarado(encuesta) {
        return normalizarCanton(campo(encuesta, 'canton') || campo(encuesta, 'cant') || campo(encuesta, 'CANTON'));
    }

    function cantonPorParroquia(parroquia) {
        if (!parroquia) return '';
        const coincidencias = Object.entries(PARROQUIAS_POR_CANTON)
            .filter(([, nombres]) => nombres.some(n => normTexto(n) === normTexto(parroquia)));
        return coincidencias.length === 1 ? coincidencias[0][0] : '';
    }

    function normalizarAliasSector(valor) {
        return normTexto(valor).replace(/[|\s]/g, '');
    }

    function resolverSectorEncuesta(encuesta) {
        if (!encuesta) return null;
        if (encuesta._sectorResuelto !== undefined) return encuesta._sectorResuelto;

        const raw = String(
            encuesta.sc_key ||
            encuesta.sc ||
            campo(encuesta, 'seccensal') ||
            campo(encuesta, 'sc') ||
            campo(encuesta, 'p_ref') ||
            encuesta.sec_anm ||
            ''
        ).trim();

        if (!raw) {
            encuesta._sectorResuelto = null;
            return null;
        }

        // 1. Coincidencia directa en AppState.sectoresMap
        if (AppState.sectoresMap) {
            const secMeta = AppState.sectoresMap.get(raw);
            if (secMeta) {
                encuesta._sectorResuelto = secMeta;
                return secMeta;
            }
        }

        // 2. Extracción de número entero de muestra (1..266)
        // En Morona Santiago los números de punto de muestra 1 a 266 son globalmente únicos en toda la provincia.
        const numMatch = raw.match(/\d+/);
        const numId = numMatch ? String(parseInt(numMatch[0], 10)) : '';

        if (numId) {
            if (AppState.sectoresCandidatos) {
                const candNum = AppState.sectoresCandidatos.get(numId);
                if (candNum && candNum.length === 1) {
                    encuesta._sectorResuelto = candNum[0];
                    return candNum[0];
                }
            }
            if (AppState.sectoresMap) {
                const secPorNum = AppState.sectoresMap.get(numId);
                if (secPorNum) {
                    encuesta._sectorResuelto = secPorNum;
                    return secPorNum;
                }
            }
        }

        // 3. Búsqueda por alias normalizado
        const alias = normalizarAliasSector(raw);
        if (alias && AppState.sectoresCandidatos) {
            const candidatos = AppState.sectoresCandidatos.get(alias) || [];
            if (candidatos.length === 1) {
                encuesta._sectorResuelto = candidatos[0];
                return candidatos[0];
            }
            if (candidatos.length > 1) {
                const canton = cantonDeclarado(encuesta) || cantonPorParroquia(parroquiaDeclarada(encuesta));
                const tipRaw = String(campo(encuesta, 'tipologia') || campo(encuesta, 'TIPOLOGIA') || '').trim().toUpperCase();
                const tip = /^[1-8]$/.test(tipRaw) ? String.fromCharCode(64 + Number(tipRaw)) : tipRaw;
                const filtrados = candidatos.filter(s => {
                    const matchCanton = !canton || normTexto(s.canton) === normTexto(canton);
                    const matchTip = !tip || s.props.tipologia === tip;
                    return matchCanton && matchTip;
                });
                if (filtrados.length >= 1) {
                    encuesta._sectorResuelto = filtrados[0];
                    return filtrados[0];
                }
                encuesta._sectorResuelto = candidatos[0];
                return candidatos[0];
            }
        }

        // 4. Búsqueda de rescate en la colección GeoJSON por num_muestra o sc
        if (AppState.sectoresGeojson && Array.isArray(AppState.sectoresGeojson.features)) {
            const numVal = parseInt(numId || raw, 10);
            if (!isNaN(numVal)) {
                const feat = AppState.sectoresGeojson.features.find(f => {
                    const p = f.properties || {};
                    return Number(p.num_muestra) === numVal || Number(p.sc) === numVal;
                });
                if (feat) {
                    const res = {
                        feature: feat,
                        bbox: feat.properties.bbox,
                        centroid: feat.properties.centroid,
                        etiquetaSC: feat.properties.etiquetaSC,
                        parroquia: feat.properties.parroquia,
                        canton: feat.properties.canton,
                        sec_anm: feat.properties.sec_anm,
                        props: feat.properties
                    };
                    encuesta._sectorResuelto = res;
                    return res;
                }
            }
        }

        encuesta._sectorResuelto = null;
        return null;
    }

    function obtenerParroquiaEncuesta(encuesta) {
        const sector = resolverSectorEncuesta(encuesta);
        if (sector && sector.parroquia) return sector.parroquia;
        return parroquiaDeclarada(encuesta) || '';
    }

    function obtenerCantonEncuesta(encuesta) {
        const sector = resolverSectorEncuesta(encuesta);
        if (sector && sector.canton) return sector.canton;
        const declarado = cantonDeclarado(encuesta);
        if (declarado) return declarado;
        const porParroquia = cantonPorParroquia(parroquiaDeclarada(encuesta));
        if (porParroquia) return porParroquia;
        return 'Sin asignar';
    }

    function coincideSector(encuesta, clave) {
        if (!clave || clave === 'Todos') return true;
        const sector = resolverSectorEncuesta(encuesta);
        if (!sector || !sector.props) return false;
        const p = sector.props;
        const claveNorm = normTexto(clave);
        return p.sc_key === clave ||
               String(p.sc) === clave ||
               String(p.num_muestra) === clave ||
               p.etiquetaSC === clave ||
               normTexto(p.sc_key) === claveNorm ||
               normTexto(p.etiquetaSC) === claveNorm;
    }

    function recalcularConteosSectores() {
        const conteo = new Map();
        const encuestas = AppState.encuestas || [];
        for (let i = 0; i < encuestas.length; i++) {
            const sec = resolverSectorEncuesta(encuestas[i]);
            if (sec && sec.props) {
                const k1 = sec.props.sc_key;
                const k2 = String(sec.props.sc || '');
                const k3 = String(sec.props.num_muestra || '');
                const k4 = sec.props.etiquetaSC;
                if (k1) conteo.set(k1, (conteo.get(k1) || 0) + 1);
                if (k2 && k2 !== k1) conteo.set(k2, (conteo.get(k2) || 0) + 1);
                if (k3 && k3 !== k1 && k3 !== k2) conteo.set(k3, (conteo.get(k3) || 0) + 1);
                if (k4 && k4 !== k1) conteo.set(k4, (conteo.get(k4) || 0) + 1);
            }
        }
        AppState.conteoPorSector = conteo;
        return conteo;
    }

    function normCanton(c) {
        if (!c) return '';
        return normTexto(c).toUpperCase().trim();
    }

    function cantonEncuesta(encuesta) {
        if (encuesta.canton) return normCanton(encuesta.canton);
        const sector = resolverSectorEncuesta(encuesta);
        return sector ? normCanton(sector.canton) : '';
    }

    function crearFiltroMapLibreCanton(cantonVal) {
        if (!cantonVal || cantonVal === 'Todos') return null;
        const cNorm = normCanton(cantonVal);
        return [
            'any',
            ['==', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], ''], cantonVal],
            ['==', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']], cNorm]
        ];
    }

    function normalizarSupervisorEncuesta(e) {
        if (!e) return e;
        let sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '').trim();
        let enc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();

        // Mapeo oficial estricto: a cada encuestador le corresponde su supervisor oficial
        const supOficial = ENCUESTADOR_A_SUPERVISOR[enc];
        const supFinal = supOficial || sup || 'Sin Asignar';

        e._supervisorOriginal = sup;
        e.supervisor = supFinal;
        e.encuestador = enc || 'Sin Asignar';
        if (e.codsup !== undefined) e.codsup = e.supervisor;
        if (e.codencu !== undefined) e.codencu = e.encuestador;
        if (e.C_digo_Supervisor !== undefined) e.C_digo_Supervisor = e.supervisor;
        if (e.C_digo_encuestador !== undefined) e.C_digo_encuestador = e.encuestador;
        return e;
    }

    // =========================================================================
    // UTILIDADES DE FECHA LOCAL (ZONA HORARIA ECUADOR UTC-5)
    // =========================================================================
    function obtenerFechaLocalEcuador(d = new Date()) {
        if (!d) return '';
        const dateObj = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dateObj.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Guayaquil',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(dateObj);
        } catch (_) {
            const ecuadorOffset = -5 * 60; // minutos
            const localMs = dateObj.getTime() + ecuadorOffset * 60000;
            return new Date(localMs).toISOString().split('T')[0];
        }
    }

    function obtenerFechaEncuesta(e) {
        if (!e) return '';
        // 1. Prioridad: 'start' registra la fecha local en el dispositivo del encuestador
        if (e.start && typeof e.start === 'string' && e.start.length >= 10) {
            const fStart = e.start.substring(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(fStart)) {
                return fStart;
            }
        }
        // 2. KoboToolbox almacena _submission_time en UTC; convertir a huso horario de Ecuador
        if (e._submission_time && typeof e._submission_time === 'string') {
            try {
                let st = e._submission_time.trim();
                if (!st.includes('Z') && !st.includes('+') && !st.match(/-\d{2}:?\d{2}$/)) {
                    st += 'Z';
                }
                const d = new Date(st);
                if (!isNaN(d.getTime())) {
                    return obtenerFechaLocalEcuador(d);
                }
            } catch (_) {}
            return e._submission_time.substring(0, 10);
        }
        return '';
    }

    function formatearFechaHoraEcuador(enc) {
        if (!enc) return 'Sin fecha';
        const rawDate = enc.start || enc._submission_time;
        if (!rawDate) return 'Sin fecha';
        try {
            let str = String(rawDate).trim();
            if (!enc.start && !str.includes('Z') && !str.includes('+') && !str.match(/-\d{2}:?\d{2}$/)) {
                str += 'Z';
            }
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                return new Intl.DateTimeFormat('es-EC', {
                    timeZone: 'America/Guayaquil',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }).format(d).replace(',', '');
            }
        } catch (_) {}
        return String(rawDate).replace('T', ' ').substring(0, 19);
    }

    function extraerCoordenadas(encuesta) {
        if (!encuesta) return null;
        // 1. _geolocation [lat, lng]
        if (encuesta._geolocation && Array.isArray(encuesta._geolocation) && encuesta._geolocation.length >= 2 && encuesta._geolocation[0] !== null) {
            let lat = parseFloat(encuesta._geolocation[0]);
            let lng = parseFloat(encuesta._geolocation[1]);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                if (lat < -50 && lng > -10 && lng < 10) { const tmp = lat; lat = lng; lng = tmp; }
                if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
            }
        }
        // 2. Campos de GPS conocidos (incluyendo ya_registrado, gps, ubicacion_gps, etc.)
        const posiblesCampos = ['ya_registrado', 'gps', 'ubicacion_gps', 'coordenadas', 'geopoint', 'punto_gps', 'punto', 'ubicacion'];
        for (let i = 0; i < posiblesCampos.length; i++) {
            const val = campo(encuesta, posiblesCampos[i]);
            if (val && typeof val === 'string') {
                const partes = val.trim().split(/\s+/);
                if (partes.length >= 2) {
                    let lat = parseFloat(partes[0]);
                    let lng = parseFloat(partes[1]);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        if (lat < -50 && lng > -10 && lng < 10) { const tmp = lat; lat = lng; lng = tmp; }
                        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
                    }
                }
            }
        }
        // 3. Escaneo universal en todas las claves de la encuesta (validando rango Ecuador)
        const keys = Object.keys(encuesta);
        for (let i = 0; i < keys.length; i++) {
            const val = encuesta[keys[i]];
            if (typeof val === 'string' && val.includes(' ')) {
                const partes = val.trim().split(/\s+/);
                if (partes.length >= 2) {
                    let lat = parseFloat(partes[0]);
                    let lng = parseFloat(partes[1]);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        if (lat < -50 && lng > -10 && lng < 10) { const tmp = lat; lat = lng; lng = tmp; }
                        if (lat >= -5.0 && lat <= 2.5 && lng >= -92.0 && lng <= -75.0) {
                            return [lat, lng];
                        }
                    }
                }
            }
        }
        return null;
    }

    function calcularDistancia(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    const normStr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

    function puntoEnPoligono(lng, lat, coords) {
        if (!coords || coords.length === 0) return false;
        let inside = false;
        const ring = coords[0];
        const n = ring.length;
        let j = n - 1;
        for (let i = 0; i < n; i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
            j = i;
        }
        if (inside && coords.length > 1) {
            for (let h = 1; h < coords.length; h++) {
                const hole = coords[h];
                let inHole = false;
                const nh = hole.length;
                let jh = nh - 1;
                for (let ih = 0; ih < nh; ih++) {
                    const xi = hole[ih][0], yi = hole[ih][1];
                    const xj = hole[jh][0], yj = hole[jh][1];
                    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
                    if (intersect) inHole = !inHole;
                    jh = ih;
                }
                if (inHole) return false;
            }
        }
        return inside;
    }

    function puntoEnGeometria(lng, lat, geometry) {
        if (!geometry) return false;
        if (geometry.type === 'Polygon') {
            return puntoEnPoligono(lng, lat, geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
            for (let p = 0; p < geometry.coordinates.length; p++) {
                if (puntoEnPoligono(lng, lat, geometry.coordinates[p])) return true;
            }
        }
        return false;
    }

    function detectarParroquiaGPS(lng, lat) {
        if (!AppState.parroquiasGeojson || !AppState.parroquiasGeojson.features) return null;
        for (const f of AppState.parroquiasGeojson.features) {
            if (puntoEnGeometria(lng, lat, f.geometry)) {
                return f.properties.PARROQUIA || f.properties.nombre || null;
            }
        }
        return null;
    }

    function encontrarHitoMasCercano(lng, lat) {
        if (!AppState.sectoresGeojson || !AppState.sectoresGeojson.features) return null;
        let minD = Infinity;
        let masCercano = null;
        AppState.sectoresGeojson.features.forEach(f => {
            const p = f.properties || {};
            if (p.centroid) {
                const [hLng, hLat] = p.centroid;
                const d = calcularDistancia(lat, lng, hLat, hLng);
                if (d < minD) {
                    minD = d;
                    masCercano = { feature: f, distanciaKm: d };
                }
            }
        });
        return masCercano;
    }

    function auditarEncuestas() {
        if (!AppState.encuestas) return;

        let totalAlertas = 0;
        AppState.encuestas.forEach(enc => {
            const alertas = [];

            // ÚNICAMENTE VERIFICACIÓN DE CÓDIGOS DE ENCUESTADOR Y SUPERVISOR
            const encCodStr = String(enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || '').trim();
            const supCodOriginal = String(enc._supervisorOriginal || enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '').trim();

            if (!EQUIPO_CAMPO[encCodStr]) {
                alertas.push({
                    tipo: 'encuestador',
                    titulo: 'No oficial',
                    mensaje: `Encuestador no oficial (${encCodStr})`
                });
            } else {
                const supEsperado = ENCUESTADOR_A_SUPERVISOR[encCodStr];
                if (supCodOriginal && supCodOriginal !== supEsperado) {
                    alertas.push({
                        tipo: 'supervisor',
                        titulo: 'Supervisor erróneo',
                        mensaje: `Sup. ${supCodOriginal} en vez de ${supEsperado}`
                    });
                }
            }

            enc._tieneAlerta = alertas.length > 0;
            enc._alertas = alertas;
            enc._alertaMensaje = alertas.map(a => a.mensaje).join(' · ');
            if (enc._tieneAlerta) totalAlertas++;
        });

        AppState.totalAlertas = totalAlertas;
    }

    // =========================================================================
    // INICIALIZACIÓN Y BYPASS DE INSPECCIÓN
    // =========================================================================
    function configurarBypassStandby() {
        const logoBtn = document.getElementById('standbyLogoBtn');
        const standbyEl = document.getElementById('standbyOverlay');
        const inspectBar = document.getElementById('inspectBar');
        const btnSalir = document.getElementById('btnSalirInspeccion');

        if (!logoBtn) return;

        let clickCount = 0;
        let clickTimer = null;
        let pressTimer = null;

        const activar = async () => {
            if (standbyEl) standbyEl.style.display = 'none';
            if (inspectBar) inspectBar.style.display = 'flex';
            mostrarToast('🔓 Modo Inspección Cartográfica activo', 'info');
            document.title = 'Clima Social · Modo Inspección';

            const nom = (AppState.config && (AppState.config.proyecto || AppState.config.nombreProyecto)) || 'Inspección Cartográfica';
            if (UI.tituloProyecto) UI.tituloProyecto.textContent = nom;

            if (!map) {
                if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'flex';
                try {
                    await inicializarMapa();
                    await cargarLimitesParroquiales();
                    poblarFiltros();
                    renderizarVista(false, false);
                } catch (e) {
                    console.warn('[Inspección] Error cargando mapa:', e);
                } finally {
                    if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
                }
            } else {
                setTimeout(() => map.resize(), 100);
                setTimeout(() => map.resize(), 400);
            }
        };

        const desactivar = () => {
            if (inspectBar) inspectBar.style.display = 'none';
            if (standbyEl) standbyEl.style.display = 'flex';
            document.title = 'Clima Social · Terminal en Espera';
            mostrarToast('🔒 Terminal en espera (Standby)', 'info');
        };

        if (btnSalir) {
            btnSalir.onclick = desactivar;
        }

        // Acceso 1: 3 clics rápidos en desktop o móvil
        logoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clickCount++;
            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 900);
            } else if (clickCount >= 3) {
                clearTimeout(clickTimer);
                clickCount = 0;
                activar();
            }
        });

        // Acceso 2: Mantener presionado 1.3s en móvil táctil
        logoBtn.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
                activar();
            }, 1300);
        }, { passive: true });

        logoBtn.addEventListener('touchend', () => {
            if (pressTimer) clearTimeout(pressTimer);
        }, { passive: true });

        logoBtn.addEventListener('touchcancel', () => {
            if (pressTimer) clearTimeout(pressTimer);
        }, { passive: true });
    }

    function configurarNavegacionMovil() {
        const navBtns = document.querySelectorAll('#mobileNav .cs-mobile-nav-btn');
        if (!navBtns || navBtns.length === 0) return;

        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                navBtns.forEach(b => b.classList.toggle('active', b === btn));
                if (tab === 'mapa' && map) {
                    setTimeout(() => map.resize(), 100);
                }
            });
        });
    }

    async function inicializar() {
        iniciarReloj();
        configurarModoOscuro();
        configurarNavegacionMovil();
        configurarEventos();

        // 1. Purga estricta de cachés residuales de proyectos anteriores
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('cs_encuestas') || (k.startsWith('cs_') && k !== 'modo_oscuro')) {
                    localStorage.removeItem(k);
                }
            });
        } catch (e) {
            console.warn('[Cache] Error purgando localStorage:', e);
        }

        // Failsafe de seguridad: nunca dejar la pantalla bloqueada más de 6s
        setTimeout(() => {
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
        }, 6000);
        
        try {
            const esActivo = await cargarConfiguracion();
            if (!esActivo) {
                console.log('[App] Terminal en modo STANDBY (en espera).');
                configurarBypassStandby();
                return;
            }
            try {
                await inicializarMapa();
            } catch (errorMapa) {
                // Un dispositivo sin WebGL debe poder consultar las encuestas y usar la tabla.
                console.warn('[Mapa] No se pudo iniciar el mapa:', errorMapa);
                map = null;
                if (UI.mapStats) UI.mapStats.textContent = 'Mapa no disponible en este dispositivo';
            }
            await cargarLimitesParroquiales();
            poblarFiltros();
            renderizarVista(false, false);

            await cargarDatos(AppState.encuestas.length === 0, true);
            
            window.addEventListener('online', () => cargarDatos(false));

            // Auto-refresco inteligente (pausa si la pantalla se apaga o se cambia de app)
            AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
            
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    clearInterval(AppState.intervaloPolling);
                    AppState.intervaloPolling = null;
                } else {
                    // Restablecer el canvas del mapa si estaba oculto (Android Chrome/tablet)
                    if (map) {
                        setTimeout(() => map.resize(), 100);
                        setTimeout(() => map.resize(), 500);
                    }
                    cargarDatos(false);
                    if (!AppState.intervaloPolling) {
                        AppState.intervaloPolling = setInterval(() => cargarDatos(false), 180000);
                    }
                }
            });
        } catch (error) {
            console.error('Error al inicializar:', error);
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
            mostrarError('Error de inicialización de la aplicación.');
        }
    }

    async function cargarConfiguracion() {
        try {
            const res = await fetch('/api/config', { 
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            if (res.ok) {
                const configData = await res.json();
                AppState.config = { ...AppState.config, ...configData };
            }
        } catch (e) {
            console.warn('[Config] Usando configuración local o por defecto');
        }

        const estado = (AppState.config && AppState.config.estado || 'STANDBY').toUpperCase();
        const standbyEl = document.getElementById('standbyOverlay');
        if (estado === 'STANDBY') {
            document.title = 'Clima Social · Terminal en Espera';
            if (standbyEl) standbyEl.style.display = 'flex';
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
            if (UI.badgeTexto) UI.badgeTexto.textContent = 'En espera';
            return false;
        }

        if (standbyEl) standbyEl.style.display = 'none';

        const nom = AppState.config.proyecto || AppState.config.nombreProyecto || 'Encuesta de Campo';
        if (UI.tituloProyecto) {
            UI.tituloProyecto.textContent = nom;
        }
        document.title = 'Clima Social · ' + nom;

        const meta = AppState.config.meta || AppState.config.metaEncuestas || 500;
        const canton = AppState.config.canton || '';
        if (UI.kpiMeta) {
            UI.kpiMeta.textContent = `Meta: ${meta.toLocaleString()} ${canton ? '(' + canton + ')' : ''}`;
        }

        if (AppState.config.bounds && Array.isArray(AppState.config.bounds)) {
            AppState.cantonBbox = AppState.config.bounds;
        }

        if (AppState.config.equipo) {
            if (AppState.config.equipo.supervisores && typeof AppState.config.equipo.supervisores === 'object') {
                Object.assign(SUPERVISORES_CAMPO, AppState.config.equipo.supervisores);
            }
            if (AppState.config.equipo.encuestadores && typeof AppState.config.equipo.encuestadores === 'object') {
                Object.assign(EQUIPO_CAMPO, AppState.config.equipo.encuestadores);
            }
            Object.keys(EQUIPO_CAMPO).forEach(encId => {
                const enc = EQUIPO_CAMPO[encId];
                const supId = enc.supervisor ? String(enc.supervisor) : null;
                if (supId) {
                    ENCUESTADOR_A_SUPERVISOR[encId] = supId;
                    if (!SUPERVISOR_ENCUESTADORES[supId]) {
                        SUPERVISOR_ENCUESTADORES[supId] = [];
                    }
                    if (!SUPERVISOR_ENCUESTADORES[supId].includes(encId)) {
                        SUPERVISOR_ENCUESTADORES[supId].push(encId);
                    }
                }
            });
        }
        return true;
    }

    let reintentoDatos = null;

    async function cargarDatos(mostrarOverlay = false, forzarFresco = false) {
        if (AppState.cargandoDatos) return false;
        clearTimeout(reintentoDatos);
        reintentoDatos = null;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        AppState.cargandoDatos = true;
        if (mostrarOverlay && UI.cargaOverlay) UI.cargaOverlay.style.display = 'flex';
        ocultarError();
        
        if (UI.badgeTexto) UI.badgeTexto.textContent = 'Sincronizando…';

        try {
            const url = `/api/encuestas?_ts=${Date.now()}${forzarFresco ? '&fresh=1' : ''}`;
            const res = await fetch(url, {
                signal: controller.signal,
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
            
            const data = await res.json();
            if (!Array.isArray(data.resultados)) throw new Error('Respuesta de encuestas inválida');
            const rawEncuestas = data.resultados;
            AppState.encuestas = rawEncuestas.map(normalizarSupervisorEncuesta).filter(e => {
                const codEnc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
                const codSup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '').trim();
                const consent = String(e.consentimiento || e.consen || '').trim().toUpperCase();
                if (codEnc === '98' || codSup === '98') return false;
                if (consent === 'NO' || consent === '2') return false;
                return true;
            });

            auditarEncuestas();

            // Guardar último resultado; el mapa base sigue necesitando conexión.
            try {
                // Caché en localStorage desactivada para prevenir filtración entre proyectos
            } catch (e) {
                console.warn('[Cache] Error al guardar caché:', e);
            }
            
            poblarFiltros();
            renderizarVista(false, mostrarOverlay);
            
            if (AppState.encuestas.length === 0) {
                if (UI.badgeTexto) UI.badgeTexto.textContent = 'En espera';
                if (UI.ultimaActualizacion) UI.ultimaActualizacion.textContent = data.mensaje || 'Esperando nueva encuesta';
            } else {
                if (UI.badgeTexto) UI.badgeTexto.textContent = 'En vivo';
                if (UI.ultimaActualizacion) {
                    const ahora = new Date();
                    UI.ultimaActualizacion.textContent = `Última sincronización: ${ahora.toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil' })}`;
                }
            }
            return true;
        } catch (error) {
            console.error('Error cargando encuestas:', error);
            const hayDatosGuardados = Array.isArray(AppState.encuestas) && AppState.encuestas.length > 0;
            if (!hayDatosGuardados) {
                mostrarError('No se pudieron cargar los datos de KoboToolbox.');
            }
            if (UI.badgeTexto) UI.badgeTexto.textContent = 'Actualización pendiente';
            if (UI.ultimaActualizacion) {
                UI.ultimaActualizacion.textContent = hayDatosGuardados
                    ? 'No se pudo actualizar · mostrando los últimos datos disponibles. Reintentando en 30 s…'
                    : 'No se pudo cargar la información. Reintentando en 30 s…';
            }
            reintentoDatos = setTimeout(() => {
                reintentoDatos = null;
                if (!document.hidden) cargarDatos(false);
            }, 30000);
            return false;
        } finally {
            clearTimeout(timeout);
            AppState.cargandoDatos = false;
            if (UI.cargaOverlay) UI.cargaOverlay.style.display = 'none';
        }
    }

    // =========================================================================
    // FILTROS CRUZADOS INTELIGENTES Y DINÁMICOS
    // =========================================================================
    function actualizarFiltrosUI() {
        let activeCount = 0;
        const chips = [];

        if (UI.supervisorFilter) {
            const isAct = AppState.supervisorSeleccionado !== 'Todos';
            UI.supervisorFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'supervisor',
                    label: obtenerEtiquetaSupervisor(AppState.supervisorSeleccionado, 'corto'),
                    onClear: () => {
                        AppState.supervisorSeleccionado = 'Todos';
                        if (UI.supervisorFilter) UI.supervisorFilter.value = 'Todos';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }

        if (UI.cantonFilter) {
            const isAct = AppState.cantonSeleccionado !== 'Todos';
            UI.cantonFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'canton',
                    label: `Cantón: ${AppState.cantonSeleccionado}`,
                    onClear: () => {
                        AppState.cantonSeleccionado = 'Todos';
                        if (UI.cantonFilter) UI.cantonFilter.value = 'Todos';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        if (UI.parroquiaFilter) {
            const isAct = AppState.parroquiaSeleccionada !== 'Todas';
            UI.parroquiaFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                chips.push({
                    tipo: 'parroquia',
                    label: `Parroquia: ${AppState.parroquiaSeleccionada}`,
                    onClear: () => {
                        AppState.parroquiaSeleccionada = 'Todas';
                        if (UI.parroquiaFilter) UI.parroquiaFilter.value = 'Todas';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        if (UI.sectorFilter) {
            const isAct = AppState.sectorSeleccionado !== 'Todos';
            UI.sectorFilter.classList.toggle('is-active', isAct);
            if (isAct) {
                activeCount++;
                const secMeta = AppState.sectoresMap.get(AppState.sectorSeleccionado);
                const isPM = secMeta && secMeta.esPuntoMuestreo;
                const chipLbl = isPM ? `Punto #${AppState.sectorSeleccionado}` : `Sector: ${AppState.sectorSeleccionado}`;
                chips.push({
                    tipo: 'sector',
                    label: chipLbl,
                    onClear: () => {
                        AppState.sectorSeleccionado = 'Todos';
                        if (UI.sectorFilter) UI.sectorFilter.value = 'Todos';
                        poblarFiltros();
                        renderizarVista(true, true);
                    }
                });
            }
        }
        // Sincronizar Botones Rápidos de Fecha (Pills)
        if (UI.datePills && UI.datePills.length > 0) {
            UI.datePills.forEach(pill => {
                const f = pill.dataset.dateFilter;
                pill.classList.toggle('active', AppState.fechaSeleccionada === f);
            });
        }

        if (UI.fechaFilter) {
            const isCustomDate = AppState.fechaSeleccionada !== 'Todas' && 
                                 AppState.fechaSeleccionada !== 'Hoy' && 
                                 AppState.fechaSeleccionada !== 'Ayer';
            UI.fechaFilter.classList.toggle('is-active', isCustomDate);
            if (isCustomDate) {
                UI.fechaFilter.value = AppState.fechaSeleccionada;
            }
        }

        if (AppState.fechaSeleccionada !== 'Todas') {
            activeCount++;
            let fecLabel = `Fecha: ${AppState.fechaSeleccionada}`;
            if (AppState.fechaSeleccionada === 'Hoy') fecLabel = 'Fecha: Hoy';
            else if (AppState.fechaSeleccionada === 'Ayer') fecLabel = 'Fecha: Ayer';

            chips.push({
                tipo: 'fecha',
                label: fecLabel,
                onClear: () => {
                    AppState.fechaSeleccionada = 'Todas';
                    if (UI.fechaFilter) UI.fechaFilter.value = 'Todas';
                    renderizarVista(true, true);
                }
            });
        }
        if (AppState.encuestadorSeleccionado) {
            activeCount++;
            chips.push({
                tipo: 'encuestador',
                label: obtenerEtiquetaEncuestador(AppState.encuestadorSeleccionado, 'corto'),
                onClear: () => {
                    seleccionarEncuestador(AppState.encuestadorSeleccionado);
                }
            });
        }
        if (AppState.filtroSoloAlertas) {
            activeCount++;
            chips.push({
                tipo: 'alerta',
                label: `⚠️ Errores (${AppState.totalAlertas})`,
                onClear: () => {
                    AppState.filtroSoloAlertas = false;
                    renderizarVista();
                }
            });
        }
        if (AppState.filtroSoloPendientes) {
            activeCount++;
            chips.push({
                tipo: 'pendientes',
                label: `⏳ Solo Sectores Pendientes (<10)`,
                onClear: () => {
                    AppState.filtroSoloPendientes = false;
                    if (UI.toggleSoloPendientes) UI.toggleSoloPendientes.classList.remove('active');
                    renderizarVista(true, false);
                }
            });
        }
        if (AppState.filtroTabla) {
            activeCount++;
            chips.push({
                tipo: 'busqueda',
                label: `Búsqueda: "${AppState.filtroTabla}"`,
                onClear: () => {
                    AppState.filtroTabla = '';
                    if (UI.searchInput) UI.searchInput.value = '';
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                    actualizarFiltrosUI();
                }
            });
        }

        if (UI.btnLimpiarFiltros) {
            UI.btnLimpiarFiltros.classList.toggle('has-active', activeCount > 0);
            const txt = document.getElementById('txtLimpiarFiltros');
            if (txt) {
                txt.textContent = activeCount > 0 ? `Limpiar (${activeCount})` : 'Limpiar';
            }
        }

        // Renderizar Chips de Filtros Activos
        if (UI.activeFilterChipsWrap && UI.activeFilterChips) {
            if (chips.length > 0) {
                UI.activeFilterChipsWrap.style.display = 'flex';
                UI.activeFilterChips.innerHTML = '';
                chips.forEach(chip => {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'cs-filter-chip';
                    el.innerHTML = `<span>${chip.label}</span><svg class="cs-chip-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                    el.title = `Quitar filtro: ${chip.label}`;
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        chip.onClear();
                    });
                    UI.activeFilterChips.appendChild(el);
                });
                // Botón "Limpiar todo" inline dentro de los chips
                if (chips.length > 1) {
                    const clearAll = document.createElement('button');
                    clearAll.type = 'button';
                    clearAll.className = 'cs-chip-clear-all';
                    clearAll.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Limpiar todo</span>`;
                    clearAll.title = 'Restablecer todos los filtros';
                    clearAll.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (UI.btnLimpiarFiltros) UI.btnLimpiarFiltros.click();
                    });
                    UI.activeFilterChips.appendChild(clearAll);
                }
            } else {
                UI.activeFilterChipsWrap.style.display = 'none';
                UI.activeFilterChips.innerHTML = '';
            }
        }
    }

    function poblarFiltros() {
        recalcularConteosSectores();
        const selSup = AppState.supervisorSeleccionado;
        const selSec = AppState.sectorSeleccionado;
        const selPar = AppState.parroquiaSeleccionada;
        const selFec = AppState.fechaSeleccionada;
        const selEnc = AppState.encuestadorSeleccionado;
        const targetPar = selPar !== 'Todas' ? selPar.toUpperCase() : '';

        const supervisores = new Map();
        const sectores = new Map();
        const parroquias = new Map();
        const fechas = new Map();

        const encuestas = AppState.encuestas || [];
        const total = encuestas.length;
        const ahoraHoy = new Date();
        const hoyFiltroStr = obtenerFechaLocalEcuador(ahoraHoy);
        const ayerFiltroStr = obtenerFechaLocalEcuador(new Date(ahoraHoy.getTime() - 86400000));

        for (let i = 0; i < total; i++) {
            const e = encuestas[i];
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
            const sector = resolverSectorEncuesta(e);
            const etiq = sector ? sector.props.sc_key : '';
            const parr = obtenerParroquiaEncuesta(e);
            const fec = obtenerFechaEncuesta(e);
            const encCod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');

            const matchSup = (selSup === 'Todos' || sup === selSup);
            const matchSec = (selSec === 'Todos' || coincideSector(e, selSec));
            const matchCan = AppState.cantonSeleccionado === 'Todos' || normCanton(obtenerCantonEncuesta(e)) === normCanton(AppState.cantonSeleccionado);
            if (!matchCan) continue;
            let matchFec = true;
            if (selFec !== 'Todas') {
                if (selFec === 'Hoy') matchFec = (fec === hoyFiltroStr);
                else if (selFec === 'Ayer') matchFec = (fec === ayerFiltroStr);
                else matchFec = (fec === selFec);
            }
            const matchEnc = (!selEnc || encCod === String(selEnc));
            let matchPar = true;
            if (targetPar) {
                const uParr = parr.toUpperCase();
                matchPar = normTexto(uParr) === normTexto(targetPar);
            }

            // 1. Supervisores disponibles según los códigos capturados por el XLSForm.
            if (sup && sup !== '98' && matchSec && matchPar && matchFec && matchEnc) {
                supervisores.set(sup, (supervisores.get(sup) || 0) + 1);
            }

            // 2. Puntos de Muestreo disponibles (Número + Tipología)
            if (matchSup && matchPar && matchFec && matchEnc) {
                if (sector && sector.props) {
                    const k1 = sector.props.sc_key;
                    const k2 = String(sector.props.sc || '');
                    const k3 = String(sector.props.num_muestra || '');
                    const k4 = sector.props.etiquetaSC;
                    if (k1) sectores.set(k1, (sectores.get(k1) || 0) + 1);
                    if (k2 && k2 !== k1) sectores.set(k2, (sectores.get(k2) || 0) + 1);
                    if (k3 && k3 !== k1 && k3 !== k2) sectores.set(k3, (sectores.get(k3) || 0) + 1);
                    if (k4 && k4 !== k1) sectores.set(k4, (sectores.get(k4) || 0) + 1);
                } else if (etiq) {
                    sectores.set(etiq, (sectores.get(etiq) || 0) + 1);
                }
            }

            // 3. Parroquias disponibles (filtrado por Supervisor, Sector, Fecha, Encuestador)
            if (parr && matchSup && matchSec && matchFec && matchEnc) {
                parroquias.set(parr, (parroquias.get(parr) || 0) + 1);
            }

            // 4. Fechas disponibles (filtrado por Supervisor, Sector, Parroquia, Encuestador)
            if (fec && matchSup && matchSec && matchPar && matchEnc) {
                fechas.set(fec, (fechas.get(fec) || 0) + 1);
            }
        }

        const hayFiltroActivo = (selSup !== 'Todos' || !!selEnc || !!targetPar || selFec !== 'Todas');

        // 1. Selector Supervisores: Nómina oficial si está disponible, o supervisores registrados en campo
        if (UI.supervisorFilter) {
            const actualSup = AppState.supervisorSeleccionado || 'Todos';
            UI.supervisorFilter.innerHTML = '<option value="Todos">Todos los supervisores</option>';
            const supOficialKeys = Object.keys(SUPERVISORES_CAMPO);
            const supKeys = supOficialKeys.length > 0 
                ? supOficialKeys 
                : Array.from(supervisores.keys()).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));
            supKeys.forEach(id => {
                const totalEnc = supervisores.get(id) || 0;
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${obtenerEtiquetaSupervisor(id, 'corto')} (${totalEnc} enc.)`;
                UI.supervisorFilter.appendChild(option);
            });
            UI.supervisorFilter.value = supKeys.includes(actualSup) ? actualSup : 'Todos';
            if (!supKeys.includes(actualSup) && actualSup !== 'Todos') AppState.supervisorSeleccionado = 'Todos';
        }

        // 1.1 Selector Cantón (Ibarra)
        if (UI.cantonFilter) {
            const actualCan = AppState.cantonSeleccionado || 'Todos';
            const keysCantones = Object.keys(PARROQUIAS_POR_CANTON);
            let cantonesList = [];

            if (keysCantones.length > 1) {
                cantonesList = [
                    { id: 'Todos', label: 'Todos los Cantones', badge: '🌐' },
                    ...keysCantones.map(can => {
                        const cInfo = COLORES_CANTON[can] || {};
                        return { id: can, label: cInfo.nombre || can, badge: cInfo.badge || '📍' };
                    })
                ];
            } else if (keysCantones.length === 1) {
                const can = keysCantones[0];
                const cInfo = COLORES_CANTON[can] || {};
                cantonesList = [
                    { id: 'Todos', label: cInfo.nombre || can, badge: cInfo.badge || '📍' }
                ];
            } else {
                cantonesList = [
                    { id: 'Todos', label: 'Todos los Cantones', badge: '🌐' }
                ];
            }

            let html = '';
            cantonesList.forEach(c => {
                let cnt = 0;
                if (AppState.encuestas && AppState.encuestas.length > 0) {
                    if (c.id === 'Todos') {
                        cnt = AppState.encuestas.length;
                    } else {
                        cnt = AppState.encuestas.filter(e => obtenerCantonEncuesta(e) === c.id).length;
                    }
                }
                const extra = cnt > 0 ? ` (${cnt} enc.)` : '';
                html += `<option value="${c.id}">${c.badge} ${c.label}${extra}</option>`;
            });
            UI.cantonFilter.innerHTML = html;
            const validCantones = cantonesList.map(c => c.id);
            UI.cantonFilter.value = validCantones.includes(actualCan) ? actualCan : 'Todos';
        }

        // 2b. Selector Sectores Censales (50 sectores de Ibarra)
        if (UI.sectorFilter) {
            const actualSec = AppState.sectorSeleccionado || 'Todos';
            const parActivaNorm = (AppState.parroquiaSeleccionada !== 'Todas') ? normTexto(AppState.parroquiaSeleccionada) : null;
            const listaSectores = [];

            if (AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
                AppState.sectoresGeojson.features.forEach(f => {
                    const p = f.properties || {};
                    const scNum = String(p.sc || p.codigo_muestra || p.num_muestra || '').trim();
                    const tipologia = String(p.tipologia || '').trim().toUpperCase();
                    const etiqueta = p.etiquetaSC || p.etiqueta || (scNum && tipologia ? `${scNum}|${tipologia}` : scNum);
                    const parroquia = String(p.parroquia || p.PARROQUIA || '').trim();
                    const canton = String(p.canton || p.CANTON || 'IBARRA').trim();
                    const scKey = p.sc_key || `${canton}_${scNum}`;

                    // Filtrar por Cantón si está activo (Cascada Cantón ➔ Puntos)
                    if (AppState.cantonSeleccionado !== 'Todos') {
                        if (canton && normTexto(canton) !== normTexto(AppState.cantonSeleccionado)) {
                            return;
                        }
                    }

                    if (parActivaNorm && parroquia) {
                        const pNorm = normTexto(parroquia);
                        if (!pNorm.includes(parActivaNorm) && !parActivaNorm.includes(pNorm)) {
                            return;
                        }
                    }

                    listaSectores.push({
                        sc: scNum,
                        scKey: scKey,
                        canton: canton,
                        etiqueta: etiqueta,
                        etiquetaKey: `${scNum}${tipologia}`,
                        detalle: `${etiqueta} · ${parroquia}`,
                        parroquia: parroquia
                    });
                });
            }

            listaSectores.sort((a, b) => {
                if (a.canton !== b.canton) return a.canton.localeCompare(b.canton);
                return (parseInt(a.sc, 10) || 0) - (parseInt(b.sc, 10) || 0);
            });

            // Conteo total y conteo de pendientes en el ámbito territorial seleccionado
            let countPendientesEnLista = 0;
            listaSectores.forEach(item => {
                const count = sectores.get(item.scKey) || sectores.get(item.sc) || 0;
                const totalGlobal = (AppState.conteoPorSector && (AppState.conteoPorSector.get(item.scKey) || AppState.conteoPorSector.get(item.sc))) || count;
                const esCompleto = totalGlobal >= 10 || count >= 10;
                if (!esCompleto) countPendientesEnLista++;
            });

            // Si está activo el filtro de solo pendientes, se limita la lista a puntos incompletos
            let listaParaMostrar = listaSectores;
            if (AppState.filtroSoloPendientes) {
                listaParaMostrar = listaSectores.filter(item => {
                    const count = sectores.get(item.scKey) || sectores.get(item.sc) || 0;
                    const totalGlobal = (AppState.conteoPorSector && (AppState.conteoPorSector.get(item.scKey) || AppState.conteoPorSector.get(item.sc))) || count;
                    return totalGlobal < 10 && count < 10;
                });
            }

            const totalSectores = listaParaMostrar.length;
            let labelTodos = (AppState.parroquiaSeleccionada !== 'Todas') 
                ? `Todos los sectores de ${AppState.parroquiaSeleccionada} (${totalSectores})`
                : `Todos los sectores (${totalSectores})`;
            if (AppState.filtroSoloPendientes) {
                labelTodos = (AppState.parroquiaSeleccionada !== 'Todas')
                    ? `Sectores pendientes en ${AppState.parroquiaSeleccionada} (${totalSectores})`
                    : `Todos los sectores pendientes (${totalSectores})`;
            }
            UI.sectorFilter.innerHTML = `<option value="Todos">${labelTodos}</option>`;

            if (UI.lblToggleSoloPendientes) {
                UI.lblToggleSoloPendientes.textContent = AppState.filtroSoloPendientes
                    ? `Pendientes (${countPendientesEnLista})`
                    : `Solo Pendientes (${countPendientesEnLista})`;
            }
            if (UI.toggleSoloPendientes) {
                UI.toggleSoloPendientes.classList.toggle('active', AppState.filtroSoloPendientes);
            }

            const frag = document.createDocumentFragment();
            const sectoresValidos = new Set();

            listaParaMostrar.forEach(item => {
                const count = sectores.get(item.scKey) || sectores.get(item.sc) || 0;
                const totalGlobal = (AppState.conteoPorSector && (AppState.conteoPorSector.get(item.scKey) || AppState.conteoPorSector.get(item.sc))) || count;
                const displayCount = Math.max(count, totalGlobal);
                const esCompleto = displayCount >= 10;
                sectoresValidos.add(item.scKey);

                const opt = document.createElement('option');
                opt.value = item.scKey;
                opt.dataset.canton = item.canton;
                opt.dataset.parroquia = item.parroquia;
                opt.dataset.scKey = item.scKey;

                const cBadge = (COLORES_CANTON[item.canton] || {}).badge || '📍 ';

                if (esCompleto) {
                    opt.textContent = `🟢 ${cBadge} ${item.detalle} (${displayCount}/10 COMPLETO)`;
                    opt.style.color = '#059669';
                    opt.style.fontWeight = '700';
                } else if (displayCount > 0) {
                    opt.textContent = `🟡 ${cBadge} ${item.detalle} (${displayCount}/10)`;
                    opt.style.color = '#d97706';
                } else {
                    opt.textContent = `⚪ ${cBadge} ${item.detalle} (0/10)`;
                    opt.style.color = '#64748b';
                }
                frag.appendChild(opt);
            });
            UI.sectorFilter.appendChild(frag);

            if (actualSec !== 'Todos' && !sectoresValidos.has(actualSec)) {
                AppState.sectorSeleccionado = 'Todos';
                UI.sectorFilter.value = 'Todos';
            } else {
                UI.sectorFilter.value = actualSec;
            }
        }

        // 3. Selector Parroquias (Filtrado en cascada por Cantón y Sector)
        if (UI.parroquiaFilter) {
            const actualPar = AppState.parroquiaSeleccionada || 'Todas';
            UI.parroquiaFilter.innerHTML = '<option value="Todas">Todas las parroquias</option>';
            const normStr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            
            let parList = [];
            const cantActivo = AppState.cantonSeleccionado;
            const permitidasCanton = (cantActivo !== 'Todos' && PARROQUIAS_POR_CANTON[cantActivo]) ? PARROQUIAS_POR_CANTON[cantActivo].map(normStr) : null;

            if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features && AppState.parroquiasGeojson.features.length > 0) {
                AppState.parroquiasGeojson.features.forEach(f => {
                    const p = (f.properties.nombre || f.properties.PARROQUIA || f.properties.name || '').toUpperCase().trim();
                    const c = (f.properties.canton || f.properties.CANTON || '').trim();
                    
                    // Si hay cantón seleccionado, filtrar estrictamente para que solo queden las correspondientes a ese cantón
                    if (permitidasCanton) {
                        const targetCan = normStr(cantActivo);
                        const normC = normStr(c);
                        if (normC && normC !== targetCan && !normC.includes(targetCan) && !targetCan.includes(normC)) return;
                        const normP = normStr(p);
                        const coincideParroquia = permitidasCanton.includes(normP);
                        if (!coincideParroquia) return;
                    }
                    if (p && !parList.includes(p)) parList.push(p);
                });
            }

            if (parList.length === 0) {
                if (permitidasCanton) {
                    permitidasCanton.forEach(p => { if (!parList.includes(p)) parList.push(p); });
                } else {
                    Object.values(PARROQUIAS_POR_CANTON).forEach(pars => {
                        pars.forEach(p => { const up = p.toUpperCase().trim(); if (!parList.includes(up)) parList.push(up); });
                    });
                }
            }

            parList.sort((a, b) => a.localeCompare(b, 'es'));
            const frag = document.createDocumentFragment();
            parList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                const count = parroquias.get(p) || 0;
                const pMeta = AppState.parroquiasMap ? AppState.parroquiasMap.get(p) : null;
                const cP = pMeta && pMeta.props ? normCanton(pMeta.props.canton || pMeta.props.CANTON) : '';
                const cInfo = COLORES_CANTON[cP];
                const cBadge = cInfo ? `${cInfo.badge} ` : '';
                opt.textContent = count > 0 ? `${cBadge}${p} (${count} enc.)` : `${cBadge}${p}`;
                frag.appendChild(opt);
            });
            UI.parroquiaFilter.appendChild(frag);
            UI.parroquiaFilter.value = parList.includes(actualPar) ? actualPar : 'Todas';
            if (!parList.includes(actualPar) && actualPar !== 'Todas') AppState.parroquiaSeleccionada = 'Todas';
        }

        // 4. Selector Fechas
        if (UI.fechaFilter) {
            const actualFec = AppState.fechaSeleccionada || 'Todas';
            UI.fechaFilter.innerHTML = '<option value="Todas">Otras fechas…</option>';
            const fecList = Array.from(fechas.keys()).sort().reverse();
            const frag = document.createDocumentFragment();
            fecList.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `${f} (${fechas.get(f)} enc.)`;
                frag.appendChild(opt);
            });
            UI.fechaFilter.appendChild(frag);
            const isNamedFec = actualFec === 'Todas' || actualFec === 'Hoy' || actualFec === 'Ayer' || actualFec === 'Semana';
            UI.fechaFilter.value = isNamedFec ? 'Todas' : (fechas.has(actualFec) ? actualFec : 'Todas');
            if (!isNamedFec && !fechas.has(actualFec)) AppState.fechaSeleccionada = 'Todas';
        }

        actualizarFiltrosUI();
    }

    function obtenerEncuestasFiltradas() {
        let filtradas = AppState.encuestas || [];
        
        // Filtro por Supervisor
        if (AppState.supervisorSeleccionado !== 'Todos') {
            filtradas = filtradas.filter(e => {
                const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
                return sup === AppState.supervisorSeleccionado;
            });
        }

        // Filtro por Cantón
        if (AppState.cantonSeleccionado !== 'Todos') {
            const targetCan = normCanton(AppState.cantonSeleccionado);
            filtradas = filtradas.filter(e => normCanton(obtenerCantonEncuesta(e)) === targetCan);
        }

        // Filtro por Parroquia
        if (AppState.parroquiaSeleccionada !== 'Todas') {
            const target = AppState.parroquiaSeleccionada.toUpperCase();
            filtradas = filtradas.filter(e => {
                return normTexto(obtenerParroquiaEncuesta(e)) === normTexto(target);
            });
        }

        // Filtro por Punto de Muestreo / Sector (Número + Tipología)
        if (AppState.sectorSeleccionado !== 'Todos') {
            filtradas = filtradas.filter(e => coincideSector(e, AppState.sectorSeleccionado));
        }

        // Filtro por Fecha (Compatible con 'Hoy', 'Ayer' y fecha específica YYYY-MM-DD)
        if (AppState.fechaSeleccionada !== 'Todas') {
            const hoyObj = new Date();
            const hoyStr = obtenerFechaLocalEcuador(hoyObj);
            const ayerStr = obtenerFechaLocalEcuador(new Date(hoyObj.getTime() - 86400000));

            filtradas = filtradas.filter(e => {
                const fec = obtenerFechaEncuesta(e);
                if (!fec) return false;

                if (AppState.fechaSeleccionada === 'Hoy') {
                    return fec === hoyStr;
                } else if (AppState.fechaSeleccionada === 'Ayer') {
                    return fec === ayerStr;
                } else {
                    return fec === AppState.fechaSeleccionada;
                }
            });
        }

        // Filtro por Encuestador seleccionado en tabla
        if (AppState.encuestadorSeleccionado) {
            filtradas = filtradas.filter(e => {
                const enc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');
                return enc === AppState.encuestadorSeleccionado;
            });
        }

        // Filtro por Errores de Código
        if (AppState.filtroSoloAlertas) {
            filtradas = filtradas.filter(e => e._tieneAlerta);
        }

        // Filtro por Solo Sectores Pendientes (< 10 encuestas)
        if (AppState.filtroSoloPendientes) {
            const conteos = AppState.conteoPorSector || recalcularConteosSectores();
            filtradas = filtradas.filter(e => {
                const sec = resolverSectorEncuesta(e);
                if (!sec || !sec.props || !sec.props.sc_key) return true; // Mantener encuestas sin resolver para auditoría
                const c = conteos.get(sec.props.sc_key) || 0;
                return c < 10;
            });
        }

        return filtradas;
    }

    function renderizarVista(actualizarSelects = false, ajustarCamara = false) {
        if (actualizarSelects) {
            poblarFiltros();
        } else {
            actualizarFiltrosUI();
        }
        actualizarPoligonosMapa(ajustarCamara);
        const encuestas = obtenerEncuestasFiltradas();
        actualizarKPIs(encuestas);
        // Los filtros territoriales definen la cámara mediante los polígonos.
        // Así, una boleta previa de Quito nunca puede volver a centrar el mapa
        // cuando se selecciona Cayambe, Mejía o Rumiñahui.
        const hayFiltroTerritorial = AppState.cantonSeleccionado !== 'Todos'
            || AppState.parroquiaSeleccionada !== 'Todas'
            || AppState.sectorSeleccionado !== 'Todos';
        actualizarMapa(encuestas, ajustarCamara && !hayFiltroTerritorial);
        actualizarLeyendaMapa(encuestas);
        actualizarTabla(encuestas);
        actualizarPiramidePoblacional(encuestas);
        actualizarClaseZoom();
    }

    // =========================================================================
    // DETERMINAR META ACTIVA SEGÚN FILTRO TERRITORIAL (CANTÓN / PARROQUIA / SECTOR)
    // =========================================================================
    function obtenerMetaActiva() {
        // 1. Filtro por Sector Censal Sorteado (cuota: 10 encuestas)
        if (AppState.sectorSeleccionado && AppState.sectorSeleccionado !== 'Todos') {
            return {
                meta: 10,
                etiquetaMeta: `Meta: 10 (Sector ${AppState.sectorSeleccionado})`,
                subPendientes: `Para completar Sector ${AppState.sectorSeleccionado}`,
                tituloAvance: `Avance Sector`,
                subAvance: `Cuota estándar (10 encuestas)`
            };
        }

        // 2. Filtro por Parroquia (dinámica según sectores sorteados)
        if (AppState.parroquiaSeleccionada && AppState.parroquiaSeleccionada !== 'Todas') {
            const pNorm = normTexto(AppState.parroquiaSeleccionada);
            let numSectores = 0;
            if (AppState.sectoresGeojson && Array.isArray(AppState.sectoresGeojson.features)) {
                numSectores = AppState.sectoresGeojson.features.filter(f => {
                    const props = f.properties || {};
                    const p = normTexto(props.parroquia || props.PARROQUIA || props.nom_par || '');
                    return p === pNorm;
                }).length;
            }
            const metaParr = Math.max(10, (numSectores || 1) * 10);
            return {
                meta: metaParr,
                etiquetaMeta: `Meta: ${metaParr.toLocaleString()} (${AppState.parroquiaSeleccionada})`,
                subPendientes: `Para meta en ${AppState.parroquiaSeleccionada}`,
                tituloAvance: `Avance Parroquia`,
                subAvance: `${numSectores || 1} sectores (${metaParr} encuestas)`
            };
        }

        // 3. Filtro por Cantón
        if (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos') {
            let numSectoresCanton = 0;
            if (AppState.sectoresGeojson && Array.isArray(AppState.sectoresGeojson.features)) {
                numSectoresCanton = AppState.sectoresGeojson.features.filter(f => {
                    const props = f.properties || {};
                    return normTexto(props.canton || props.CANTON || '') === normTexto(AppState.cantonSeleccionado);
                }).length;
            }
            const metaCanton = numSectoresCanton > 0 ? numSectoresCanton * 10 : 500;
            return {
                meta: metaCanton,
                etiquetaMeta: `Meta: ${metaCanton.toLocaleString()} (${AppState.cantonSeleccionado})`,
                subPendientes: `Para meta en ${AppState.cantonSeleccionado}`,
                tituloAvance: `Avance ${AppState.cantonSeleccionado}`,
                subAvance: `Meta cantonal (${metaCanton.toLocaleString()})`
            };
        }

        // 4. Ámbito General (Ibarra)
        const metaGeneral = AppState.config.metaEncuestas || 500;
        return {
            meta: metaGeneral,
            etiquetaMeta: `Meta: ${metaGeneral.toLocaleString()} (Ibarra)`,
            subPendientes: `Faltan para la meta cantonal`,
            tituloAvance: `Avance General`,
            subAvance: `Cumplimiento cantonal (${metaGeneral.toLocaleString()})`
        };
    }

    // =========================================================================
    // KPIS
    // =========================================================================
    function actualizarKPIs(encuestas) {
        const total = encuestas.length;
        const infoMeta = obtenerMetaActiva();
        const meta = infoMeta.meta;
        
        const hoyStr = obtenerFechaLocalEcuador();
        const hoy = encuestas.filter(e => {
            const fecha = obtenerFechaEncuesta(e);
            return fecha === hoyStr;
        }).length;
        
        const pendientes = Math.max(0, meta - total);
        const avancePorcentaje = meta > 0 ? ((total / meta) * 100).toFixed(1) : '0.0';

        animarNumero(UI.kpiTotal, total);
        animarNumero(UI.kpiHoy, hoy);
        animarNumero(UI.kpiPendientes, pendientes);
        
        if (UI.kpiMeta) UI.kpiMeta.textContent = infoMeta.etiquetaMeta;
        if (UI.kpiSubPendientes) UI.kpiSubPendientes.textContent = infoMeta.subPendientes;
        if (UI.kpiTituloAvance) UI.kpiTituloAvance.textContent = infoMeta.tituloAvance;
        if (UI.kpiSubAvance) UI.kpiSubAvance.textContent = infoMeta.subAvance;
        
        if (UI.kpiAvance) UI.kpiAvance.textContent = `${avancePorcentaje}%`;
        if (UI.barraAvance) UI.barraAvance.style.width = `${Math.min(100, parseFloat(avancePorcentaje))}%`;
    }

    function animarNumero(elemento, valorFinal) {
        if (!elemento) return;
        const valorInicial = parseInt(elemento.textContent.replace(/[^\d]/g, ''), 10) || 0;
        if (valorInicial === valorFinal) {
            elemento.textContent = valorFinal.toLocaleString();
            return;
        }
        const duracion = 350;
        const inicio = performance.now();

        function frame(ahora) {
            const progreso = Math.min((ahora - inicio) / duracion, 1);
            const easeOut = 1 - (1 - progreso) * (1 - progreso);
            const actual = Math.round(valorInicial + (valorFinal - valorInicial) * easeOut);
            elemento.textContent = actual.toLocaleString();
            if (progreso < 1) {
                requestAnimationFrame(frame);
            } else {
                elemento.textContent = valorFinal.toLocaleString();
            }
        }
        requestAnimationFrame(frame);
    }

    // =========================================================================
    // MAPA WEBGL MAPLIBRE (Aceleración GPU 100% Nativa - Cero Glitches)
    // =========================================================================
    async function inicializarMapa() {
        if (!UI.mapContainer || !window.maplibregl) return;

        // Pre-cargar datos cartográficos (Ultra-optimizado para móviles Galaxy A01 Core)
        let parroquiasData = { type: 'FeatureCollection', features: [] };
        let sectoresData = { type: 'FeatureCollection', features: [] };

        try {
            const versionQuery = '?v=73.0.0';
            const [resPar, resSec] = await Promise.all([
                fetch('assets/parroquias.geojson' + versionQuery),
                fetch('assets/sectores_censales.geojson' + versionQuery)
            ]);
            if (resPar.ok) parroquiasData = await resPar.json();
            if (resSec.ok) sectoresData = await resSec.json();
        } catch (e) {
            console.warn('[Mapa] Error pre-cargando GeoJSONs:', e);
        }

        AppState.cantonesGeojson = { type: 'FeatureCollection', features: [] };
        AppState.parroquiasGeojson = parroquiasData;
        AppState.sectoresGeojson = sectoresData;
        AppState.puntosMuestreoGeojson = { type: 'FeatureCollection', features: [] };
        AppState.cantonesMap = new Map();
        AppState.parroquiasMap = new Map();
        AppState.puntosMuestreoMap = new Map();
        AppState.sectoresMap = new Map();
        AppState.sectoresCandidatos = new Map();

        // Indexar Sectores Censales (266 puntos de muestra de Morona Santiago)
        if (sectoresData.features) {
            sectoresData.features.forEach(f => {
                const p = f.properties || {};
                const cod = String(p.sc || p.codigo_muestra || p.num_muestra || '').trim();
                const tip = String(p.tipologia || '').trim().toUpperCase();
                const can = String(p.canton || p.CANTON || '').trim();
                let par = String(p.parroquia || p.PARROQUIA || '').trim().toUpperCase();
                if (par.includes('YUNGANZA')) par = 'YUNGANZA /EL ROSARIO';
                const secAnm = String(p.sec_anm || '').trim();
                const etiq = p.etiqueta || p.etiquetaSC || (cod && tip ? `${cod}|${tip}` : (cod || tip));
                p.sc = cod;
                p.tipologia = tip;
                p.canton = can;
                p.parroquia = par;
                p.sc_key = p.sc_key || (can && cod ? `${can}_${cod}` : '');
                p.etiqueta = etiq;
                p.etiquetaSC = etiq;

                let bbox = null;
                let centroid = null;
                if (p.bbox && Array.isArray(p.bbox)) {
                    bbox = p.bbox;
                } else if (f.geometry) {
                    bbox = calcularBBOX(f.geometry);
                }
                if (p.centroid && Array.isArray(p.centroid)) {
                    centroid = p.centroid;
                } else if (bbox) {
                    centroid = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                }
                p.bbox = bbox;
                p.centroid = centroid;

                const meta = { feature: f, bbox, centroid, etiquetaSC: etiq, etiqueta: etiq, parroquia: par, canton: can, sec_anm: secAnm, props: p };
                const numSc = parseInt(cod, 10);
                const numStr = !isNaN(numSc) ? String(numSc) : '';

                [p.sc_key, secAnm, cod, numStr, etiq, cod && tip ? `${cod}${tip}` : '', numStr && tip ? `${numStr}${tip}` : ''].forEach(alias => {
                    const key = normalizarAliasSector(alias);
                    if (!key) return;
                    const candidatos = AppState.sectoresCandidatos.get(key) || [];
                    if (!candidatos.includes(meta)) {
                        candidatos.push(meta);
                        AppState.sectoresCandidatos.set(key, candidatos);
                    }
                });
                if (numStr) {
                    const candidatosNum = AppState.sectoresCandidatos.get(numStr) || [];
                    if (!candidatosNum.includes(meta)) {
                        candidatosNum.push(meta);
                        AppState.sectoresCandidatos.set(numStr, candidatosNum);
                    }
                }
                if (secAnm) AppState.sectoresMap.set(secAnm, meta);
                if (p.sc_key) AppState.sectoresMap.set(p.sc_key, meta);
                if (can && cod) {
                    AppState.sectoresMap.set(`${can}_${cod}`, meta);
                    AppState.sectoresMap.set(`${can.toUpperCase()}_${cod}`, meta);
                    AppState.sectoresMap.set(`${can}_${etiq}`, meta);
                }
                if (par && cod) {
                    AppState.sectoresMap.set(`${par}_${cod}`, meta);
                    AppState.sectoresMap.set(`${par}_${etiq}`, meta);
                }
                if (cod) {
                    if (!AppState.sectoresMap.has(cod)) AppState.sectoresMap.set(cod, meta);
                    if (!AppState.sectoresMap.has(etiq)) AppState.sectoresMap.set(etiq, meta);
                    if (tip && !AppState.sectoresMap.has(`${cod}${tip}`)) AppState.sectoresMap.set(`${cod}${tip}`, meta);
                    if (tip && !AppState.sectoresMap.has(`${cod}|${tip}`)) AppState.sectoresMap.set(`${cod}|${tip}`, meta);
                    if (tip && !AppState.sectoresMap.has(`${cod} | ${tip}`)) AppState.sectoresMap.set(`${cod} | ${tip}`, meta);
                    if (numStr && !AppState.sectoresMap.has(numStr)) AppState.sectoresMap.set(numStr, meta);
                }
            });
        }

        // Crear colección de centroides puntuales para etiquetas únicas de sectores censales (evita duplicación por teselado en MapLibre)
        const sectoresCentroidesData = {
            type: 'FeatureCollection',
            features: (sectoresData.features || []).map(f => {
                const p = f.properties || {};
                const scNum = String(p.sc || p.codigo_muestra || p.num_muestra || '').trim();
                const tip = String(p.tipologia || '').trim().toUpperCase();
                const etiq = p.etiqueta || p.etiquetaSC || (scNum && tip ? `${scNum}|${tip}` : (scNum || tip));
                let coords = (f.geometry && f.geometry.type === 'Point') ? f.geometry.coordinates : p.centroid;
                if (!coords || !Array.isArray(coords)) {
                    if (p.bbox && Array.isArray(p.bbox)) {
                        const minX = Array.isArray(p.bbox[0]) ? p.bbox[0][0] : p.bbox[0];
                        const minY = Array.isArray(p.bbox[0]) ? p.bbox[0][1] : p.bbox[1];
                        const maxX = Array.isArray(p.bbox[1]) ? p.bbox[1][0] : p.bbox[2];
                        const maxY = Array.isArray(p.bbox[1]) ? p.bbox[1][1] : p.bbox[3];
                        coords = [(minX + maxX) / 2, (minY + maxY) / 2];
                    } else if (f.geometry) {
                        const b = calcularBBOX(f.geometry);
                        coords = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
                    } else {
                        coords = [-78.2625, 0.2285];
                    }
                }
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coords },
                    properties: { ...p, etiquetaSC: etiq, etiqueta: etiq, sc: scNum, tipologia: tip }
                };
            })
        };
        AppState.sectoresCentroidesGeojson = sectoresCentroidesData;

        // Indexar Parroquias (62 parroquias en estudio)
        if (parroquiasData.features) {
            parroquiasData.features.forEach(f => {
                const p = f.properties || {};
                const nombre = (p.nombre || p.PARROQUIA || p.name || '').toUpperCase().trim();
                const b = f.geometry ? calcularBBOX(f.geometry) : null;
                f.properties.bbox = b;
                if (nombre) AppState.parroquiasMap.set(nombre, { feature: f, bbox: b, props: p });
            });
        }
        AppState.puntosMuestreoMap = AppState.sectoresMap;

        // Crear colección de centroides puntuales para etiquetas únicas de parroquias (evita duplicación por teselado en MapLibre)
        const parroquiasCentroidesData = {
            type: 'FeatureCollection',
            features: (parroquiasData.features || []).map(f => {
                const p = f.properties || {};
                const nom = (p.nombre || p.PARROQUIA || p.name || '').toUpperCase().trim();
                let coords = [-78.48, -0.19];
                if (p.bbox && Array.isArray(p.bbox)) {
                    const minX = Array.isArray(p.bbox[0]) ? p.bbox[0][0] : p.bbox[0];
                    const minY = Array.isArray(p.bbox[0]) ? p.bbox[0][1] : p.bbox[1];
                    const maxX = Array.isArray(p.bbox[1]) ? p.bbox[1][0] : p.bbox[2];
                    const maxY = Array.isArray(p.bbox[1]) ? p.bbox[1][1] : p.bbox[3];
                    coords = [(minX + maxX) / 2, (minY + maxY) / 2];
                } else if (f.geometry) {
                    const b = calcularBBOX(f.geometry);
                    coords = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
                }
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coords },
                    properties: { ...p, nombre: nom }
                };
            })
        };
        AppState.parroquiasCentroidesGeojson = parroquiasCentroidesData;

        // Auto-calcular Bounding Box global desde las 53 parroquias y 266 puntos a encuestar
        let globalMinX = Infinity, globalMinY = Infinity, globalMaxX = -Infinity, globalMaxY = -Infinity;
        if (parroquiasData.features && parroquiasData.features.length > 0) {
            parroquiasData.features.forEach(f => {
                const b = f.properties.bbox || (f.geometry ? calcularBBOX(f.geometry) : null);
                if (b && Array.isArray(b)) {
                    const minX = Array.isArray(b[0]) ? b[0][0] : b[0];
                    const minY = Array.isArray(b[0]) ? b[0][1] : b[1];
                    const maxX = Array.isArray(b[1]) ? b[1][0] : b[2];
                    const maxY = Array.isArray(b[1]) ? b[1][1] : b[3];
                    if (minX < globalMinX) globalMinX = minX;
                    if (minY < globalMinY) globalMinY = minY;
                    if (maxX > globalMaxX) globalMaxX = maxX;
                    if (maxY > globalMaxY) globalMaxY = maxY;
                }
            });
        }
        if (sectoresData.features && sectoresData.features.length > 0) {
            sectoresData.features.forEach(f => {
                if (f.geometry && f.geometry.coordinates) {
                    const [x, y] = f.geometry.coordinates;
                    if (x < globalMinX) globalMinX = x;
                    if (y < globalMinY) globalMinY = y;
                    if (x > globalMaxX) globalMaxX = x;
                    if (y > globalMaxY) globalMaxY = y;
                }
            });
        }

        const BBOX_CANTON = [[-78.20, 0.15], [-77.96, 0.59]];
        let mapCenter = [-78.12, 0.35]; // Ibarra Centro
        let initialBounds = BBOX_CANTON;

        if (globalMinX !== Infinity && globalMaxX !== -Infinity) {
            mapCenter = [(globalMinX + globalMaxX) / 2, (globalMinY + globalMaxY) / 2];
            initialBounds = [[globalMinX, globalMinY], [globalMaxX, globalMaxY]];
        }
        AppState.cantonBbox = initialBounds;

        // Prioridad si centro viene en AppState.config
        if (AppState.config && AppState.config.centroLng && AppState.config.centroLat) {
            mapCenter = [AppState.config.centroLng, AppState.config.centroLat];
        }

        // Crear el mapa con MapLibre optimizado para móviles (Galaxy A01 Core)
        map = new maplibregl.Map({
            container: 'map',
            fadeDuration: 0,
            maxTileCacheSize: 20, // Optimizado para 1-2GB RAM (Galaxy A01 Core)
            preserveDrawingBuffer: false,
            antialias: false,
            trackResize: true,
            failIfMajorPerformanceCaveat: false,
            style: {
                version: 8,
                glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
                sources: {
                    // Vías y referencias visibles para orientar el trabajo de campo.
                    // La memoria se mantiene acotada por maxTileCacheSize: 20 en esta misma configuración.
                    // Cartografía Base de Máximo Detalle: OpenStreetMap Estándar
                    // Incluye vías peatonales, pasajes, numeración, comercios, farmacias, paradas y puntos de referencia
                    'base-map-tiles': {
                        type: 'raster',
                        tiles: [
                            'https://tile.openstreetmap.de/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        maxzoom: 19,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> colaboradores'
                    },
                    'parroquias-source': {
                        type: 'geojson',
                        data: parroquiasData
                    },
                    'parroquias-centroides-source': {
                        type: 'geojson',
                        data: parroquiasCentroidesData
                    },
                    'sectores-source': {
                        type: 'geojson',
                        data: sectoresData
                    },
                    'sectores-centroides-source': {
                        type: 'geojson',
                        data: sectoresCentroidesData
                    }
                },
                layers: [
                    {
                        id: 'base-map-layer',
                        type: 'raster',
                        source: 'base-map-tiles',
                        minzoom: 0,
                        maxzoom: 22
                    },
                    // 1. Límites y Relleno Parroquial por Cantón (Morona Santiago 2026)
                    {
                        id: 'parroquias-fill',
                        type: 'fill',
                        source: 'parroquias-source',
                        paint: {
                            'fill-color': EXPR_PARROQUIAS_FILL,
                            'fill-opacity': 0.22
                        }
                    },
                    {
                        id: 'parroquias-line',
                        type: 'line',
                        source: 'parroquias-source',
                        paint: {
                            'line-color': EXPR_PARROQUIAS_LINE,
                            'line-width': [
                                'interpolate', ['linear'], ['zoom'],
                                8, 2.0,
                                10, 2.6,
                                12, 3.4,
                                15, 4.5
                            ],
                            'line-opacity': 1.0
                        }
                    },
                    {
                        id: 'parroquias-label',
                        type: 'symbol',
                        source: 'parroquias-centroides-source',
                        minzoom: 8.8,
                        maxzoom: 15.0,
                        layout: {
                            'text-field': ['coalesce', ['get', 'nombre'], ['get', 'parroquia'], ['get', 'PARROQUIA'], ''],
                            'text-font': ['Open Sans Bold'],
                            'text-size': [
                                'interpolate', ['linear'], ['zoom'],
                                9, 10.0,
                                11, 11.5,
                                13, 13.5,
                                15, 15.0
                            ],
                            'text-anchor': 'center',
                            'text-max-width': 8
                        },
                        paint: {
                            'text-color': EXPR_PARROQUIAS_LABEL,
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 3.2
                        }
                    },
                    // 2. Sectores Censales Poligonales (si la geometría es Polygon)
                    {
                        id: 'sectores-fill',
                        type: 'fill',
                        source: 'sectores-source',
                        filter: ['==', ['geometry-type'], 'Polygon'],
                        paint: {
                            'fill-color': EXPR_SECTORES_FILL,
                            'fill-opacity': 0.20
                        }
                    },
                    {
                        id: 'sectores-line',
                        type: 'line',
                        source: 'sectores-source',
                        filter: ['==', ['geometry-type'], 'Polygon'],
                        paint: {
                            'line-color': EXPR_SECTORES_LINE,
                            'line-width': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 2.0,
                                13, 3.5,
                                16, 5.0
                            ],
                            'line-opacity': 1.0
                        }
                    },
                    // 3. Puntos de Muestreo / Puntos Referenciales (si la geometría es Point)
                    {
                        id: 'sectores-point',
                        type: 'symbol',
                        source: 'sectores-source',
                        filter: ['==', ['geometry-type'], 'Point'],
                        layout: {
                            'icon-image': EXPR_PIN_CANTON,
                            'icon-size': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 0.65,
                                12, 0.82,
                                14, 0.98,
                                17, 1.18
                            ],
                            'icon-anchor': 'bottom',
                            'icon-allow-overlap': true,
                            'icon-ignore-placement': true
                        }
                    },
                    // Etiqueta del Sector Censal (Centrada en el centroide único del polígono)
                    {
                        id: 'sectores-label',
                        type: 'symbol',
                        source: 'sectores-centroides-source',
                        minzoom: 9.0,
                        layout: {
                            'text-field': ['coalesce', ['get', 'etiquetaSC'], ['get', 'etiqueta'], ''],
                            'text-font': ['Open Sans Bold'],
                            'text-size': [
                                'interpolate', ['linear'], ['zoom'],
                                9, 10,
                                12, 12.5,
                                15, 14.5
                            ],
                            'text-anchor': 'center',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'visibility': 'visible'
                        },
                        paint: {
                            'text-color': EXPR_SECTORES_LABEL,
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 3.0
                        }
                    }
                ]
            },
            center: mapCenter,
            zoom: (AppState.config && AppState.config.zoomInicial) ? AppState.config.zoomInicial : 7.8,
            bounds: initialBounds || undefined,
            fitBoundsOptions: initialBounds ? { padding: 25, maxZoom: 14 } : undefined,
            minZoom: 6.5,
            maxZoom: 20,
            interactive: true,
            dragPan: true,
            scrollZoom: true,
            boxZoom: true,
            dragRotate: false,
            keyboard: true,
            doubleClickZoom: true,
            touchZoomRotate: true,
            touchPitch: false,
            cooperativeGestures: false
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        window.map = map;

        // Asegurar gestos de navegación y paneo activos en todos los dispositivos
        try {
            if (map.dragPan) map.dragPan.enable();
            if (map.touchZoomRotate) map.touchZoomRotate.enable();
            if (map.scrollZoom) map.scrollZoom.enable();
            if (map.doubleClickZoom) map.doubleClickZoom.enable();
        } catch (err) {
            console.warn('[Map Gestures]', err);
        }

        // =====================================================================
        // CONTROLADOR UNIVERSAL DE GESTOS TÁCTILES Y DE RATÓN
        // Garantiza paneo y navegación 100% fluidos en iOS Safari, Android Chrome y PC
        // =====================================================================
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            let isTouching = false;
            let lastTouchX = 0, lastTouchY = 0;
            let pinchInitialDist = 0;
            let isMouseDown = false;
            let lastMouseX = 0, lastMouseY = 0;

            // --- Soporte Táctil (Móvil / Tablet) ---
            mapContainer.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    isTouching = true;
                    lastTouchX = e.touches[0].clientX;
                    lastTouchY = e.touches[0].clientY;
                } else if (e.touches.length === 2) {
                    isTouching = true;
                    pinchInitialDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                }
            }, { passive: true });

            mapContainer.addEventListener('touchmove', (e) => {
                if (!isTouching || !map) return;

                // Bloquea estrictamente el scroll vertical del navegador para que MapLibre reciba el gesto
                if (e.cancelable) {
                    e.preventDefault();
                }

                if (e.touches.length === 1) {
                    const curX = e.touches[0].clientX;
                    const curY = e.touches[0].clientY;
                    const dx = curX - lastTouchX;
                    const dy = curY - lastTouchY;

                    // Si el handler interno de MapLibre está pausado por el SO, forzamos paneo directo
                    if (!map.dragPan.isActive()) {
                        map.panBy([-dx, -dy], { duration: 0 });
                    }
                    lastTouchX = curX;
                    lastTouchY = curY;
                } else if (e.touches.length === 2 && pinchInitialDist > 0) {
                    const curDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                    const zoomDelta = Math.log2(curDist / pinchInitialDist);
                    if (Math.abs(zoomDelta) > 0.03 && !map.touchZoomRotate.isActive()) {
                        map.setZoom(map.getZoom() + zoomDelta * 0.12);
                        pinchInitialDist = curDist;
                    }
                }
            }, { passive: false });

            const endTouch = () => { isTouching = false; pinchInitialDist = 0; };
            mapContainer.addEventListener('touchend', endTouch, { passive: true });
            mapContainer.addEventListener('touchcancel', endTouch, { passive: true });

            // --- Soporte Ratón / Trackpad (PC / Laptop) ---
            mapContainer.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                    isMouseDown = true;
                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;
                }
            });

            window.addEventListener('mousemove', (e) => {
                if (!isMouseDown || !map) return;
                const dx = e.clientX - lastMouseX;
                const dy = e.clientY - lastMouseY;
                if (!map.dragPan.isActive()) {
                    map.panBy([-dx, -dy], { duration: 0 });
                }
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            });

            window.addEventListener('mouseup', () => { isMouseDown = false; });
        }

        map.on('error', (e) => {
            console.warn('[MapLibre Error]', e);
        });

        map.on('load', () => {
            AppState.mapLoaded = true;

            // Generar marcador tipo PIN oficial (estilo Rumiñahui, gota estilizada con diana blanca central)
            // Calibrado con proporciones discretas para no saturar el mapa ni confundirse con las encuestas
            try {
                function generarImagenPin(colorPrincipal, colorSecundario, esActivo = false) {
                    const width = 48;
                    const height = 64;
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return null;

                    ctx.scale(1.5, 1.5);

                    // 1. Sombra suave de contacto en el suelo
                    ctx.beginPath();
                    ctx.ellipse(16, 40, 6.0, 2.0, 0, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
                    ctx.fill();

                    // 2. Silueta del Pin estilizado (marcador tipo gota de precisión)
                    ctx.beginPath();
                    ctx.moveTo(16, 40);
                    ctx.bezierCurveTo(13.5, 32, 4.5, 22.5, 4.5, 14);
                    ctx.arc(16, 14, 11.5, Math.PI, 0, false);
                    ctx.bezierCurveTo(27.5, 22.5, 18.5, 32, 16, 40);
                    ctx.closePath();

                    const grad = ctx.createLinearGradient(16, 2, 16, 40);
                    grad.addColorStop(0, colorSecundario || colorPrincipal);
                    grad.addColorStop(1, colorPrincipal);
                    ctx.fillStyle = grad;
                    ctx.fill();

                    // Borde blanco nítido de contraste
                    ctx.lineWidth = esActivo ? 2.6 : 2.0;
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineJoin = 'round';
                    ctx.stroke();

                    // 3. Diana blanca interior (centro de referencia visual)
                    ctx.beginPath();
                    ctx.arc(16, 14, 4.6, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();

                    ctx.beginPath();
                    ctx.arc(16, 14, 2.2, 0, Math.PI * 2);
                    ctx.fillStyle = esActivo ? '#c2410c' : colorPrincipal;
                    ctx.fill();

                    return ctx.getImageData(0, 0, width, height);
                }

                if (!map.hasImage('pin-referencia')) {
                    const pinImg = generarImagenPin('#475569', '#64748b', false);
                    if (pinImg) map.addImage('pin-referencia', pinImg, { pixelRatio: 2 });
                }
                if (!map.hasImage('pin-referencia-activo')) {
                    const pinActivoImg = generarImagenPin('#ea580c', '#f97316', true);
                    if (pinActivoImg) map.addImage('pin-referencia-activo', pinActivoImg, { pixelRatio: 2 });
                }

                // Generar pin temático oficial para cada cantón según COLORES_CANTON
                Object.keys(COLORES_CANTON).forEach(cantonKey => {
                    const cfg = COLORES_CANTON[cantonKey];
                    const idImg = cfg.pinSlug || `pin-can-${cantonKey.toLowerCase()}`;
                    if (!map.hasImage(idImg)) {
                        const img = generarImagenPin(cfg.hex, cfg.lineaSector || cfg.linea || cfg.hex, false);
                        if (img) map.addImage(idImg, img, { pixelRatio: 2 });
                    }
                });
                if (!map.hasImage('pin-ibarra') && map.hasImage('pin-can-ibarra')) {
                    // Alias de compatibilidad
                }
            } catch (errIcon) {
                console.warn('[MapLibre Pin Marker]', errIcon);
            }

            configurarCapasWebGL();
            if (initialBounds) {
                map.fitBounds(initialBounds, { padding: 25, maxZoom: 14, duration: 0 });
            }
            renderizarVista(false, false);
            // Asegurar dimensiones óptimas
            setTimeout(() => { if (map) map.resize(); }, 150);
            setTimeout(() => { if (map) map.resize(); }, 600);
        });

        // pageshow: captura el Back/Forward Cache de iOS Safari y Chrome Android
        window.addEventListener('pageshow', (e) => {
            if (map) setTimeout(() => map.resize(), 100);
        });

        window.addEventListener('orientationchange', () => {
            setTimeout(() => { if (map) map.resize(); }, 200);
            setTimeout(() => { if (map) map.resize(); }, 600);
        });
    }

    function configurarCapasWebGL() {
        if (!map || !map.isStyleLoaded()) return;

        if (AppState.parroquiasGeojson && map.getSource('parroquias-source')) {
            map.getSource('parroquias-source').setData(AppState.parroquiasGeojson);
        }
        if (AppState.parroquiasCentroidesGeojson && map.getSource('parroquias-centroides-source')) {
            map.getSource('parroquias-centroides-source').setData(AppState.parroquiasCentroidesGeojson);
        }
        if (AppState.sectoresGeojson && map.getSource('sectores-source')) {
            map.getSource('sectores-source').setData(AppState.sectoresGeojson);
        }
        if (AppState.sectoresCentroidesGeojson && map.getSource('sectores-centroides-source')) {
            map.getSource('sectores-centroides-source').setData(AppState.sectoresCentroidesGeojson);
        }

        // Asegurar que las capas cartográficas estén explícitamente visibles
        const capasBase = ['parroquias-fill', 'parroquias-line', 'parroquias-label', 'sectores-fill', 'sectores-line', 'sectores-label'];
        capasBase.forEach(ly => {
            if (map.getLayer(ly)) {
                map.setLayoutProperty(ly, 'visibility', 'visible');
            }
        });

        // 3. Capas de Encuestas: Puntos Individuales y Etiquetas
        if (!map.getSource('encuestas-puntos-source')) {
            map.addSource('encuestas-puntos-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: false
            });

            // 1. Círculos de Puntos Individuales (Coloreados por Encuestador)
            map.addLayer({
                id: 'puntos-layer',
                type: 'circle',
                source: 'encuestas-puntos-source',
                paint: {
                    'circle-color': ['coalesce', ['get', 'color'], '#e11d48'],
                    'circle-radius': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 3.5,
                        13, 5.0,
                        16, 7.0,
                        19, 9.0
                    ],
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.95
                }
            });

            // 2. Capa de Etiquetas de Encuestador (Centrada exactamente dentro del círculo)
            map.addLayer({
                id: 'puntos-label-layer',
                type: 'symbol',
                source: 'encuestas-puntos-source',
                layout: {
                    'text-field': ['to-string', ['get', 'encuestador']],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        13, 8.0,
                        16, 9.5,
                        19, 11.0
                    ],
                    'text-offset': [0, 0],
                    'text-anchor': 'center',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': 'rgba(0, 0, 0, 0.95)',
                    'text-halo-width': 1.2
                }
            });

            // 3. Capa de Micro-Etiquetas de Sector y Tipología de la Encuesta (Discreta, arriba del punto)
            map.addLayer({
                id: 'puntos-micro-label-layer',
                type: 'symbol',
                source: 'encuestas-puntos-source',
                layout: {
                    'text-field': ['get', 'microEtiqueta'],
                    'text-font': ['Open Sans Bold'],
                    'text-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        13, 8.5,
                        16, 10.0,
                        19, 11.5
                    ],
                    'text-offset': [0, -1.1],
                    'text-anchor': 'bottom',
                    'text-allow-overlap': false,
                    'text-optional': true,
                    'visibility': AppState.mostrarEtiquetas ? 'visible' : 'none'
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.0,
                    'text-halo-blur': 0.2
                }
            });
        }

        // =====================================================================
        // EVENTOS E INTERACTIVIDAD WEBGL
        // =====================================================================
        const abrirPopupEncuesta = (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            const tieneAlerta = p.tieneAlerta === true || p.tieneAlerta === 'true';
            const colorPunto = tieneAlerta ? '#dc2626' : (p.color || obtenerColorEncuestador(p.encuestador));

            let distInfo = '';
            if (AppState.ubicacionSupervisor) {
                const d = calcularDistancia(AppState.ubicacionSupervisor.lat, AppState.ubicacionSupervisor.lng, coords[1], coords[0]);
                distInfo = `<p style="margin:4px 0;font-size:0.8rem;color:#028090;"><strong>A ${d.toFixed(2)} km de tu ubicación</strong></p>`;
            }

            let bannerAlerta = '';
            if (tieneAlerta) {
                bannerAlerta = `
                    <div style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:6px 8px;border-radius:6px;margin:6px 0 8px 0;font-size:0.75rem;line-height:1.3;">
                        <strong style="display:block;margin-bottom:2px;font-size:0.76rem;color:#b91c1c;">⚠️ Error:</strong>
                        <span>${p.alertaMensaje || 'Código no válido'}</span>
                    </div>
                `;
            }

            new maplibregl.Popup({ offset: [0, -10], closeButton: true })
                .setLngLat(coords)
                .setHTML(`
                    <div style="font-family:'Inter',sans-serif;min-width:210px;padding:2px;">
                        <div style="background:${colorPunto};color:#fff;padding:6px 10px;border-radius:6px 6px 0 0;margin:-14px -14px 8px -14px;font-weight:700;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;">
                            <span title="${obtenerEtiquetaEncuestador(p.encuestador, 'completo')}">${tieneAlerta ? '⚠️ ' : ''}${obtenerEtiquetaEncuestador(p.encuestador, 'corto')}</span>
                            <span title="${obtenerEtiquetaSupervisor(p.supervisor, 'completo')}">${obtenerEtiquetaSupervisor(p.supervisor, 'corto')}</span>
                        </div>
                        ${bannerAlerta}
                        <p style="margin:4px 0;font-size:0.8rem;"><strong>Parroquia:</strong> ${p.parroquia}</p>
                        ${p.sc ? `<p style="margin:4px 0;font-size:0.8rem;"><strong>Punto de Muestreo:</strong> #${p.sc}${p.tipologia ? ` (Tipología ${p.tipologia})` : ''}</p>` : ''}
                        ${p.barrio ? `<p style="margin:4px 0;font-size:0.8rem;"><strong>Barrio:</strong> ${p.barrio}</p>` : ''}
                        <p style="margin:4px 0;font-size:0.75rem;color:#64748b;">Fecha: ${p.fecha}</p>
                        ${distInfo}
                    </div>
                `)
                .addTo(map);
        };

        map.on('click', 'puntos-layer', abrirPopupEncuesta);

        // Cursores interactivos
        map.on('mouseenter', 'puntos-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'puntos-layer', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'sectores-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'sectores-fill', () => { map.getCanvas().style.cursor = ''; });

        // Clic en Sector Censal
        const abrirPopupSector = (e) => {
            if (!e.features || !e.features.length) return;
            const p = e.features[0].properties || {};
            const geom = e.features[0].geometry;
            const coords = (geom && geom.type === 'Point' && Array.isArray(geom.coordinates))
                ? { lng: geom.coordinates[0], lat: geom.coordinates[1] }
                : (e.lngLat || null);
            const sc = String(p.sc || p.codigo_muestra || p.num_muestra || '').trim();
            const can = String(p.canton || p.CANTON || '').trim();
            const scKey = String(p.sc_key || (can && sc ? `${can}_${sc}` : sc)).trim();

            if (scKey && UI.sectorFilter) {
                AppState.sectorSeleccionado = scKey;
                UI.sectorFilter.value = scKey;
                renderizarVista(false, false);
            }

            const sectorMeta = AppState.sectoresMap.get(scKey) || AppState.sectoresMap.get(sc) || { props: p, feature: e.features[0] };
            abrirPopupPuntoMuestra(sectorMeta, coords);
        };

        map.on('click', 'sectores-fill', abrirPopupSector);

        // Conectar botones para Prender / Apagar capas en el mapa
        const togglesMap = [
            { btn: UI.toggleParroquias, key: 'parroquias', layers: ['parroquias-fill', 'parroquias-line', 'parroquias-label'] },
            { btn: UI.toggleSectores, key: 'sectores', layers: ['sectores-fill', 'sectores-line', 'sectores-label'] }
        ];

        togglesMap.forEach(({ btn, key, layers }) => {
            if (!btn) return;
            btn.onclick = () => {
                const actual = AppState.capasVisibles[key];
                const nuevo = !actual;
                AppState.capasVisibles[key] = nuevo;
                btn.classList.toggle('active', nuevo);
                const vis = nuevo ? 'visible' : 'none';
                layers.forEach(ly => {
                    if (map.getLayer(ly)) {
                        map.setLayoutProperty(ly, 'visibility', vis);
                    }
                });
            };
        });

        // Conectar botón específico de Solo Sectores Pendientes (< 10 encuestas)
        if (UI.toggleSoloPendientes) {
            UI.toggleSoloPendientes.onclick = () => {
                AppState.filtroSoloPendientes = !AppState.filtroSoloPendientes;
                UI.toggleSoloPendientes.classList.toggle('active', AppState.filtroSoloPendientes);
                renderizarVista(true, false);
                if (AppState.filtroSoloPendientes) {
                    mostrarToast('Filtrando únicamente sectores pendientes (<10)', 'info');
                } else {
                    mostrarToast('Mostrando todos los sectores y encuestas', 'info');
                }
            };
        }
    }

    function actualizarClaseZoom() {
        if (!map) return;
        const show = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', show);
        }
        if (map.getLayer('puntos-micro-label-layer')) {
            map.setLayoutProperty('puntos-micro-label-layer', 'visibility', show);
        }
    }

    // Calcula los límites [ [minLng, minLat], [maxLng, maxLat] ] de una geometría GeoJSON
    function calcularBBOX(geometry) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        function procesarCoords(coords) {
            if (typeof coords[0] === 'number') {
                const lng = coords[0], lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
            } else {
                for (let i = 0; i < coords.length; i++) {
                    procesarCoords(coords[i]);
                }
            }
        }
        procesarCoords(geometry.coordinates);
        return [[minLng, minLat], [maxLng, maxLat]];
    }

    async function cargarLimitesParroquiales() {
        try {
            if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features && AppState.parroquiasGeojson.features.length > 0) {
                return; // Ya cargado en inicializarMapa
            }
            const res = await fetch('assets/parroquias.geojson?v=73.0.0');
            if (!res.ok) return;
            const geojsonData = await res.json();

            AppState.parroquiasGeojson = geojsonData;
            AppState.parroquiasCentroidesGeojson = {
                type: 'FeatureCollection',
                features: (geojsonData.features || []).map(f => {
                    const p = f.properties || {};
                    const nom = (p.nombre || p.PARROQUIA || p.name || '').toUpperCase().trim();
                    const bbox = f.geometry ? calcularBBOX(f.geometry) : null;
                    let coords = [-78.48, -0.19];
                    if (bbox) {
                        coords = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                    }
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: coords },
                        properties: { ...p, nombre: nom }
                    };
                })
            };
            AppState.parroquiasMap.clear();
            const listaParroquias = [];

            if (geojsonData.features) {
                AppState.diccionarioParroquias = AppState.diccionarioParroquias || {};
                geojsonData.features.forEach(f => {
                    const p = f.properties || {};
                    const nombre = p.nombre || p.PARROQUIA || p.name || 'Parroquia';
                    const canton = p.CANTON || p.canton || '';
                    const tipo = p.ESTADO || 'Rural';
                    const cod = p.CODPAR || p.cod || p.codigo || '';

                    const cNorm = String(canton || '').trim().toUpperCase();
                    const nNorm = String(nombre || '').trim().toUpperCase();
                    if (cNorm) {
                        obtenerConfigCanton(cNorm);
                        if (!PARROQUIAS_POR_CANTON[cNorm]) PARROQUIAS_POR_CANTON[cNorm] = [];
                        if (nNorm && !PARROQUIAS_POR_CANTON[cNorm].includes(nNorm)) {
                            PARROQUIAS_POR_CANTON[cNorm].push(nNorm);
                        }
                    }

                    if (cod && nombre) {
                        AppState.diccionarioParroquias[String(cod).trim()] = nombre.toUpperCase();
                        const n = parseInt(cod, 10);
                        if (!isNaN(n)) AppState.diccionarioParroquias[String(n)] = nombre.toUpperCase();
                    }

                    listaParroquias.push({ nombre, canton, tipo, cod });
                    const bbox = f.geometry ? calcularBBOX(f.geometry) : null;
                    AppState.parroquiasMap.set(nombre.toUpperCase(), { feature: f, bbox });
                });
            }

            poblarFiltros();
            configurarCapasWebGL();
            actualizarPoligonosMapa(false);
        } catch (e) {
            console.warn('No se pudo cargar la capa de límites parroquiales:', e);
        }
    }

    async function cargarSectoresCensales() {
        // Sectores censales unificados en los 70 puntos de muestreo oficiales (puntos_muestreo.geojson)
        return;
    }

    function poblarFiltroParroquias() {
        poblarFiltros();
    }

    function seleccionarParroquia(nombre) {
        AppState.parroquiaSeleccionada = nombre;
        if (UI.parroquiaFilter) UI.parroquiaFilter.value = nombre;
        
        // Auto-sincronizar Cantón si está en 'Todos' y la parroquia pertenece a un cantón específico
        if (nombre !== 'Todas') {
            const normP = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            const targetP = normP(nombre);
            // Búsqueda de cantón por coincidencia exacta primero para evitar colisión de nombres
            let cantonEncontrado = null;
            for (const [can, pars] of Object.entries(PARROQUIAS_POR_CANTON)) {
                if (pars.some(p => normP(p) === targetP)) {
                    cantonEncontrado = can;
                    break;
                }
            }
            // Fallback cuidadoso solo si no hubo coincidencia exacta
            if (!cantonEncontrado) {
                for (const [can, pars] of Object.entries(PARROQUIAS_POR_CANTON)) {
                    if (pars.some(p => {
                        const np = normP(p);
                        // Prohibir match entre Rosario y Yunganza
                        if ((np === 'ROSARIO' && targetP.includes('YUNGANZA')) || (targetP === 'ROSARIO' && np.includes('YUNGANZA'))) return false;
                        return np.includes(targetP) || targetP.includes(np);
                    })) {
                        cantonEncontrado = can;
                        break;
                    }
                }
            }
            if (cantonEncontrado) {
                if (Object.keys(PARROQUIAS_POR_CANTON).length > 1) {
                    AppState.cantonSeleccionado = cantonEncontrado;
                    if (UI.cantonFilter) UI.cantonFilter.value = cantonEncontrado;
                } else {
                    AppState.cantonSeleccionado = 'Todos';
                    if (UI.cantonFilter) UI.cantonFilter.value = 'Todos';
                }
            }
        }

        // Al cambiar de parroquia, resetear el punto específico seleccionado
        AppState.sectorSeleccionado = 'Todos';
        if (UI.sectorFilter) UI.sectorFilter.value = 'Todos';
        if (popupSectorActivo) {
            popupSectorActivo.remove();
            popupSectorActivo = null;
        }
        const barra = document.getElementById('barraSectorActivo');
        if (barra) barra.style.display = 'none';

        poblarFiltros();
        renderizarVista(false, true);
    }

    function obtenerBboxParroquia(nombreParroquia) {
        if (!nombreParroquia || nombreParroquia === 'Todas') return null;
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
        const target = norm(nombreParroquia);
        const cantActivo = (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos') ? norm(AppState.cantonSeleccionado) : null;

        // 1. Buscar en AppState.parroquiasGeojson (priorizando match de cantón y match exacto de parroquia)
        if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features) {
            // Intento 1: Match exacto de nombre y match de cantón
            let feat = AppState.parroquiasGeojson.features.find(f => {
                const p = f.properties || {};
                const n = norm(p.nombre || p.PARROQUIA || p.name || '');
                const c = norm(p.canton || p.CANTON || '');
                const parMatch = (n === target);
                const canMatch = !cantActivo || (c === cantActivo || c.includes(cantActivo) || cantActivo.includes(c));
                return parMatch && canMatch;
            });

            // Intento 2: Match exacto de nombre sin filtro de cantón
            if (!feat) {
                feat = AppState.parroquiasGeojson.features.find(f => {
                    const p = f.properties || {};
                    const n = norm(p.nombre || p.PARROQUIA || p.name || '');
                    return n === target;
                });
            }

            // Intento 3: Match parcial cuidadoso (prohibiendo colisión Rosario <-> Yunganza)
            if (!feat) {
                feat = AppState.parroquiasGeojson.features.find(f => {
                    const p = f.properties || {};
                    const n = norm(p.nombre || p.PARROQUIA || p.name || '');
                    const c = norm(p.canton || p.CANTON || '');
                    if ((n === 'ROSARIO' && target.includes('YUNGANZA')) || (target === 'ROSARIO' && n.includes('YUNGANZA'))) return false;
                    const canMatch = !cantActivo || (c === cantActivo);
                    return canMatch && (n.includes(target) || target.includes(n));
                });
            }

            if (feat) {
                if (feat.properties && feat.properties.bbox) return feat.properties.bbox;
                if (feat.geometry) return calcularBBOX(feat.geometry);
            }
        }

        // 2. Fallback: calcular envolvente de los sectores censales que pertenezcan a esa parroquia
        if (AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let encontrados = 0;
            AppState.sectoresGeojson.features.forEach(f => {
                const p = f.properties || {};
                const par = norm(p.parroquia || p.PARROQUIA || '');
                const c = norm(p.canton || p.CANTON || '');
                const parMatch = (par === target);
                const canMatch = !cantActivo || (c === cantActivo);
                if (parMatch && canMatch) {
                    const b = p.bbox || (f.geometry ? calcularBBOX(f.geometry) : null);
                    if (b) {
                        encontrados++;
                        const bMinX = Array.isArray(b[0]) ? b[0][0] : b[0];
                        const bMinY = Array.isArray(b[0]) ? b[0][1] : b[1];
                        const bMaxX = Array.isArray(b[1]) ? b[1][0] : b[2];
                        const bMaxY = Array.isArray(b[1]) ? b[1][1] : b[3];
                        if (bMinX < minX) minX = bMinX;
                        if (bMinY < minY) minY = bMinY;
                        if (bMaxX > maxX) maxX = bMaxX;
                        if (bMaxY > maxY) maxY = bMaxY;
                    }
                }
            });
            if (encontrados > 0 && minX !== Infinity) {
                return [[minX, minY], [maxX, maxY]];
            }
        }

        return null;
    }

    function obtenerBboxCanton(nombreCanton) {
        if (!nombreCanton || nombreCanton === 'Todos') return AppState.cantonBbox || [[-78.9539, -3.5878], [-76.6921, -1.4484]];
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
        const target = norm(nombreCanton);
        
        let parsPermitidas = [];
        for (const [canKey, pList] of Object.entries(PARROQUIAS_POR_CANTON)) {
            const nCan = norm(canKey);
            if (nCan === target || target.includes(nCan) || nCan.includes(target)) {
                parsPermitidas = pList.map(norm);
                break;
            }
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let encontrados = 0;

        if (AppState.parroquiasGeojson && AppState.parroquiasGeojson.features) {
            AppState.parroquiasGeojson.features.forEach(f => {
                const p = f.properties || {};
                const c = norm(p.canton || p.CANTON || '');
                const nom = norm(p.nombre || p.PARROQUIA || p.name || '');
                // El cantón debe coincidir estrictamente si está definido en la propiedad
                const matchCanton = c && (c === target || c.includes(target) || target.includes(c));
                const matchPar = parsPermitidas.includes(nom);

                if (c ? matchCanton : matchPar) {
                    const b = p.bbox || (f.geometry ? calcularBBOX(f.geometry) : null);
                    if (b) {
                        encontrados++;
                        const bMinX = Array.isArray(b[0]) ? b[0][0] : b[0];
                        const bMinY = Array.isArray(b[0]) ? b[0][1] : b[1];
                        const bMaxX = Array.isArray(b[1]) ? b[1][0] : b[2];
                        const bMaxY = Array.isArray(b[1]) ? b[1][1] : b[3];
                        if (bMinX < minX) minX = bMinX;
                        if (bMinY < minY) minY = bMinY;
                        if (bMaxX > maxX) maxX = bMaxX;
                        if (bMaxY > maxY) maxY = bMaxY;
                    }
                }
            });
        }

        // Fallback: calcular envolvente con los puntos del cantón si no se obtuvieron parroquias
        if (encontrados === 0 && AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
            AppState.sectoresGeojson.features.forEach(f => {
                const p = f.properties || {};
                const c = norm(p.canton || p.CANTON || '');
                if (c && (c === target || c.includes(target) || target.includes(c))) {
                    const coords = f.geometry ? f.geometry.coordinates : null;
                    if (coords && Array.isArray(coords)) {
                        const [lng, lat] = coords;
                        if (lng < minX) minX = lng;
                        if (lat < minY) minY = lat;
                        if (lng > maxX) maxX = lng;
                        if (lat > maxY) maxY = lat;
                        encontrados++;
                    }
                }
            });
        }

        if (encontrados > 0 && minX !== Infinity) {
            return [[minX, minY], [maxX, maxY]];
        }

        return AppState.cantonBbox || [[-78.9539, -3.5878], [-76.6921, -1.4484]];
    }

    function actualizarPoligonosMapa(ajustarCamara = false) {
        if (!map) return;

        // 0. Límites y Relleno Parroquial por Circunscripción
        if (map.getLayer('parroquias-line')) {
            // Si hay una parroquia específica seleccionada: AISLAR SOLO ESA PARROQUIA
            if (AppState.parroquiaSeleccionada && AppState.parroquiaSeleccionada !== 'Todas') {
                const targetPar = String(AppState.parroquiaSeleccionada).trim().toUpperCase();
                const variantesPar = [targetPar];
                if (targetPar.includes('YUNGANZA')) {
                    variantesPar.push('YUNGANZA / EL ROSARIO', 'YUNGANZA /EL ROSARIO');
                }
                const matchParExpr = [
                    'in',
                    ['upcase', ['coalesce', ['get', 'nombre'], ['get', 'parroquia'], ['get', 'PARROQUIA'], '']],
                    ['literal', variantesPar]
                ];
                const filterSoloParroquia = (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos')
                    ? ['all', ['==', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']], AppState.cantonSeleccionado.toUpperCase()], matchParExpr]
                    : matchParExpr;
                if (map.getLayer('parroquias-fill')) {
                    map.setFilter('parroquias-fill', filterSoloParroquia);
                    map.setPaintProperty('parroquias-fill', 'fill-color', EXPR_PARROQUIAS_FILL);
                    map.setPaintProperty('parroquias-fill', 'fill-opacity', 0.25);
                }
                map.setFilter('parroquias-line', filterSoloParroquia);
                if (map.getLayer('parroquias-label')) map.setFilter('parroquias-label', filterSoloParroquia);

                map.setPaintProperty('parroquias-line', 'line-width', 3.5);
                map.setPaintProperty('parroquias-line', 'line-color', EXPR_PARROQUIAS_LINE);
                map.setPaintProperty('parroquias-line', 'line-opacity', 1.0);
            } else if (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos') {
                // Si está en 'Todas' las parroquias pero hay cantón seleccionado: mostrar solo las de ese cantón
                const targetCanton = AppState.cantonSeleccionado;
                const parsPermitidas = (PARROQUIAS_POR_CANTON[targetCanton] || []).map(p => p.toUpperCase().trim());
                const filterParCanton = [
                    'all',
                    ['==', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']], targetCanton.toUpperCase()],
                    ['in', ['upcase', ['coalesce', ['get', 'nombre'], ['get', 'parroquia'], ['get', 'PARROQUIA'], '']], ['literal', parsPermitidas]]
                ];
                if (map.getLayer('parroquias-fill')) {
                    map.setFilter('parroquias-fill', filterParCanton);
                    map.setPaintProperty('parroquias-fill', 'fill-color', EXPR_PARROQUIAS_FILL);
                    map.setPaintProperty('parroquias-fill', 'fill-opacity', 0.22);
                }
                map.setFilter('parroquias-line', filterParCanton);
                if (map.getLayer('parroquias-label')) map.setFilter('parroquias-label', filterParCanton);

                map.setPaintProperty('parroquias-line', 'line-width', [
                    'interpolate', ['linear'], ['zoom'],
                    8, 2.2,
                    10, 2.8,
                    12, 3.6,
                    15, 4.8
                ]);
                map.setPaintProperty('parroquias-line', 'line-color', EXPR_PARROQUIAS_LINE);
                map.setPaintProperty('parroquias-line', 'line-opacity', 1.0);
            } else {
                // Vista global: todas las parroquias con color por cantón
                if (map.getLayer('parroquias-fill')) {
                    map.setFilter('parroquias-fill', null);
                    map.setPaintProperty('parroquias-fill', 'fill-color', EXPR_PARROQUIAS_FILL);
                    map.setPaintProperty('parroquias-fill', 'fill-opacity', 0.22);
                }
                map.setFilter('parroquias-line', null);
                if (map.getLayer('parroquias-label')) map.setFilter('parroquias-label', null);

                map.setPaintProperty('parroquias-line', 'line-width', [
                    'interpolate', ['linear'], ['zoom'],
                    8, 2.0,
                    10, 2.6,
                    12, 3.4,
                    15, 4.5
                ]);
                map.setPaintProperty('parroquias-line', 'line-color', EXPR_PARROQUIAS_LINE);
                map.setPaintProperty('parroquias-line', 'line-opacity', 1.0);
            }
            if (map.getLayer('parroquias-label')) {
                map.setPaintProperty('parroquias-label', 'text-color', EXPR_PARROQUIAS_LABEL);
            }
        }

        // 1. Polígonos y Puntos de Muestreo de Sectores Censales
        if (map.getLayer('sectores-puntos-circle') || map.getLayer('sectores-fill')) {
            const barra = document.getElementById('barraSectorActivo');
            const titulo = document.getElementById('sectorActivoTitulo');
            const btnGmaps = document.getElementById('btnRutaGoogleMaps');

            let filterPendientes = null;
            if (AppState.filtroSoloPendientes) {
                const conteos = AppState.conteoPorSector || recalcularConteosSectores();
                const keysPendientes = [];
                if (AppState.sectoresGeojson && AppState.sectoresGeojson.features) {
                    AppState.sectoresGeojson.features.forEach(f => {
                        const p = f.properties || {};
                        const k = p.sc_key || `${p.canton}_${p.sc}`;
                        if (k && (conteos.get(k) || 0) < 10) {
                            keysPendientes.push(k);
                        }
                    });
                }
                filterPendientes = ['in', ['to-string', ['coalesce', ['get', 'sc_key'], '']], ['literal', keysPendientes]];
            }

            // Filtro espacial base por Cantón o Parroquia
            let baseTerritorialFilter = null;
            if (AppState.parroquiaSeleccionada && AppState.parroquiaSeleccionada !== 'Todas') {
                const targetPar = String(AppState.parroquiaSeleccionada).trim().toUpperCase();
                const variantesPar = [targetPar];
                if (targetPar.includes('YUNGANZA')) {
                    variantesPar.push('YUNGANZA / EL ROSARIO', 'YUNGANZA /EL ROSARIO');
                }
                const matchParExpr = [
                    'in',
                    ['upcase', ['coalesce', ['get', 'parroquia'], ['get', 'PARROQUIA'], '']],
                    ['literal', variantesPar]
                ];
                baseTerritorialFilter = (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos')
                    ? ['all', ['==', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']], AppState.cantonSeleccionado.toUpperCase()], matchParExpr]
                    : matchParExpr;
            } else if (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos') {
                const targetCan = AppState.cantonSeleccionado;
                const parsPermitidas = (PARROQUIAS_POR_CANTON[targetCan] || []).map(p => p.toUpperCase().trim());
                baseTerritorialFilter = [
                    'all',
                    ['==', ['upcase', ['coalesce', ['get', 'canton'], ['get', 'CANTON'], '']], targetCan.toUpperCase()],
                    ['in', ['upcase', ['coalesce', ['get', 'parroquia'], ['get', 'PARROQUIA'], '']], ['literal', parsPermitidas]]
                ];
            }

            const filterGeneral = (baseTerritorialFilter && filterPendientes)
                ? ['all', baseTerritorialFilter, filterPendientes]
                : (baseTerritorialFilter || filterPendientes || null);

            if (AppState.sectorSeleccionado !== 'Todos') {
                // Nivel 1: Sector específico activo
                const targetSC = String(AppState.sectorSeleccionado).trim();
                const matchSC = [
                    'any',
                    ['==', ['to-string', ['coalesce', ['get', 'sc_key'], '']], targetSC],
                    ['==', ['to-string', ['coalesce', ['get', 'sc'], '']], targetSC],
                    ['==', ['to-string', ['coalesce', ['get', 'codigo_muestra'], '']], targetSC],
                    ['==', ['to-string', ['coalesce', ['get', 'num_muestra'], '']], targetSC],
                    ['==', ['to-string', ['coalesce', ['get', 'etiquetaSC'], '']], targetSC]
                ];

                const sectorMeta = AppState.sectoresMap.get(targetSC) || (function() {
                    for (let meta of AppState.sectoresMap.values()) {
                        const p = meta.props || {};
                        if (p.sc_key === targetSC || String(p.num_muestra) === targetSC || String(p.sc) === targetSC || p.etiquetaSC === targetSC) {
                            return meta;
                        }
                    }
                    return null;
                })();

                if (map.getLayer('sectores-fill')) {
                    map.setFilter('sectores-fill', filterGeneral);
                }
                if (map.getLayer('sectores-line')) {
                    map.setFilter('sectores-line', filterGeneral);
                }
                if (map.getLayer('sectores-label')) {
                    map.setFilter('sectores-label', filterGeneral);
                }

                // Configurar Barra Flotante de Navegación
                if (sectorMeta && barra && titulo && btnGmaps) {
                    const p = sectorMeta.props || {};
                    const etiq = sectorMeta.etiquetaSC || `Sector ${targetSC}`;
                    const parr = sectorMeta.parroquia ? sectorMeta.parroquia : '';
                    const puntoRef = p.punto_referencial || p.PUNTO_REFERENCIAL || '';
                    titulo.textContent = `Sector ${etiq}${puntoRef ? ` · ${puntoRef}` : (parr ? ` (${parr})` : '')}`;

                    let lat = null, lng = null;
                    if (sectorMeta.centroid && Array.isArray(sectorMeta.centroid)) {
                        lng = sectorMeta.centroid[0];
                        lat = sectorMeta.centroid[1];
                    } else if (p.latitud && p.longitud) {
                        lat = Number(p.latitud);
                        lng = Number(p.longitud);
                    } else if (sectorMeta.feature && sectorMeta.feature.geometry && sectorMeta.feature.geometry.coordinates) {
                        lng = sectorMeta.feature.geometry.coordinates[0];
                        lat = sectorMeta.feature.geometry.coordinates[1];
                    }

                    if (lat && lng) {
                        btnGmaps.href = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
                    }
                    barra.style.display = 'inline-flex';
                }
            } else {
                // Nivel 'Todos los sectores'
                if (barra) barra.style.display = 'none';
                if (popupSectorActivo) {
                    popupSectorActivo.remove();
                    popupSectorActivo = null;
                }

                if (map.getLayer('sectores-fill')) {
                    map.setFilter('sectores-fill', filterGeneral);
                    map.setPaintProperty('sectores-fill', 'fill-color', EXPR_SECTORES_FILL);
                    map.setPaintProperty('sectores-fill', 'fill-opacity', 0.20);
                }

                if (map.getLayer('sectores-line')) {
                    map.setFilter('sectores-line', filterGeneral);
                    map.setPaintProperty('sectores-line', 'line-color', EXPR_SECTORES_LINE);
                    map.setPaintProperty('sectores-line', 'line-width', [
                        'interpolate', ['linear'], ['zoom'],
                        10, 2.0,
                        13, 3.5,
                        16, 5.0
                    ]);
                    map.setPaintProperty('sectores-line', 'line-opacity', 1.0);
                }

                if (map.getLayer('sectores-label')) {
                    map.setFilter('sectores-label', filterGeneral);
                    map.setPaintProperty('sectores-label', 'text-color', EXPR_SECTORES_LABEL);
                }
            }
        }
        // 2. ZOOM AUTOMÁTICO INTELIGENTE EN CASCADA SEGÚN FILTROS ACTIVOS
        // =====================================================================
        if (ajustarCamara && map) {
            if (AppState.sectorSeleccionado !== 'Todos') {
                // Nivel 1: Zoom al Punto de Muestra / Sector seleccionado
                const targetSC = String(AppState.sectorSeleccionado).trim();
                const sectorMeta = AppState.sectoresMap.get(targetSC);
                let coords = sectorMeta ? sectorMeta.centroid : null;
                if (!coords && sectorMeta && sectorMeta.feature && sectorMeta.feature.geometry) {
                    if (sectorMeta.feature.geometry.type === 'Point') {
                        coords = sectorMeta.feature.geometry.coordinates;
                    }
                }
                if (coords && Array.isArray(coords)) {
                    map.flyTo({
                        center: coords,
                        zoom: 16.5,
                        duration: 850
                    });
                } else {
                    const bbox = sectorMeta ? (sectorMeta.bbox || (sectorMeta.feature && sectorMeta.feature.properties && sectorMeta.feature.properties.bbox)) : null;
                    if (bbox) {
                        map.fitBounds(bbox, {
                            padding: { top: 60, bottom: 50, left: 50, right: 50 },
                            maxZoom: 17.5,
                            duration: 850
                        });
                    }
                }
            } else if (AppState.parroquiaSeleccionada && AppState.parroquiaSeleccionada !== 'Todas') {
                // Nivel 2: Zoom a la Parroquia seleccionada
                const bboxPar = obtenerBboxParroquia(AppState.parroquiaSeleccionada);
                if (bboxPar) {
                    map.fitBounds(bboxPar, {
                        padding: { top: 60, bottom: 50, left: 50, right: 50 },
                        maxZoom: 14.5,
                        duration: 850
                    });
                }
            } else if (AppState.cantonSeleccionado && AppState.cantonSeleccionado !== 'Todos') {
                // Nivel 3: Zoom al Cantón seleccionado
                const bboxCan = obtenerBboxCanton(AppState.cantonSeleccionado);
                if (bboxCan) {
                    map.fitBounds(bboxCan, {
                        padding: { top: 45, bottom: 45, left: 45, right: 45 },
                        maxZoom: 12.5,
                        duration: 850
                    });
                }
            } else {
                // Nivel 4: Vista global de Ibarra
                const globalBbox = AppState.cantonBbox || [[-78.20, 0.15], [-77.96, 0.59]];
                map.fitBounds(globalBbox, {
                    padding: { top: 40, bottom: 40, left: 40, right: 40 },
                    maxZoom: 12.5,
                    duration: 850
                });
            }
        }
    }

    function actualizarMapa(encuestas, ajustarCamara = false) {
        if (!map) return;

        let conGeo = 0;
        let sinGeo = 0;
        const features = [];
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

        for (let i = 0; i < encuestas.length; i++) {
            const enc = encuestas[i];
            const coords = extraerCoordenadas(enc);
            
            if (!coords) {
                sinGeo++;
                continue;
            }

            conGeo++;

            if (AppState.filtroGPS === 'SinGPS') continue;

            const [lat, lng] = coords;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;

            const encuestador = enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || 'N/A';
            const supervisor = String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || 'N/A');
            const sc = enc.sc || campo(enc, 'sc') || '';
            const tipologiaRaw = enc.tipologia || campo(enc, 'tipologia') || campo(enc, 'TIPOLOGIA') || '';
            const tipologia = String(tipologiaRaw).trim().toUpperCase();

            let microEtiqueta = '';
            if (sc !== undefined && sc !== null && String(sc).trim() !== '') {
                microEtiqueta = `${sc}${tipologia}`;
            } else if (tipologia) {
                microEtiqueta = tipologia;
            }

            const parroquia = obtenerParroquiaEncuesta(enc) || '';
            const barrio = enc.barrio || campo(enc, 'BARRIO_O_SECTOR') || campo(enc, 'barrio');
            const fecha = formatearFechaHoraEcuador(enc);

            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                },
                properties: {
                    encuestador,
                    supervisor,
                    color: obtenerColorEncuestador(encuestador),
                    sc,
                    tipologia,
                    microEtiqueta,
                    parroquia,
                    barrio,
                    fecha,
                    tieneAlerta: Boolean(enc._tieneAlerta),
                    alertaMensaje: enc._alertaMensaje || ''
                }
            });
        }

        const geojsonFC = {
            type: 'FeatureCollection',
            features: features
        };

        configurarCapasWebGL();
        const srcPuntos = map.getSource('encuestas-puntos-source');
        if (srcPuntos) srcPuntos.setData(geojsonFC);

        const showLabels = AppState.mostrarEtiquetas ? 'visible' : 'none';

        if (map.getLayer('puntos-layer')) {
            map.setLayoutProperty('puntos-layer', 'visibility', 'visible');
        }
        if (map.getLayer('puntos-label-layer')) {
            map.setLayoutProperty('puntos-label-layer', 'visibility', showLabels);
        }
        if (map.getLayer('puntos-micro-label-layer')) {
            map.setLayoutProperty('puntos-micro-label-layer', 'visibility', showLabels);
        }

        if (UI.mapStats) {
            UI.mapStats.innerHTML = `<strong>${conGeo.toLocaleString()}</strong> encuestas mapeadas`;
        }

        // Auto-centrar cámara si se solicitó explícitamente
        if (ajustarCamara && features.length > 0 && !AppState.ubicacionSupervisor) {
            // Filtrar outliers que caigan fuera del cantón actual con margen de tolerancia (0.20°)
            const cantonBbox = AppState.cantonBbox;
            const validPoints = cantonBbox ? features.filter(f => {
                const [lng, lat] = f.geometry.coordinates;
                return lat >= cantonBbox[0][1] - 0.20 && lat <= cantonBbox[1][1] + 0.20 &&
                       lng >= cantonBbox[0][0] - 0.20 && lng <= cantonBbox[1][0] + 0.20;
            }) : features;
            const pts = validPoints.length > 0 ? validPoints : features;
            let bMinLng = Infinity, bMinLat = Infinity, bMaxLng = -Infinity, bMaxLat = -Infinity;
            pts.forEach(f => {
                const [lng, lat] = f.geometry.coordinates;
                if (lng < bMinLng) bMinLng = lng;
                if (lat < bMinLat) bMinLat = lat;
                if (lng > bMaxLng) bMaxLng = lng;
                if (lat > bMaxLat) bMaxLat = lat;
            });
            if (bMinLng !== Infinity) {
                map.fitBounds([[bMinLng, bMinLat], [bMaxLng, bMaxLat]], {
                    padding: 50,
                    maxZoom: 15,
                    duration: 1000
                });
            }
        }
    }

    // =========================================================================
    // GEOLOCALIZACIÓN DEL SUPERVISOR
    // =========================================================================
    function localizarSupervisor() {
        if (!navigator.geolocation) {
            mostrarToast('Geolocalización no compatible con tu navegador', 'error');
            return;
        }

        mostrarToast('Obteniendo tu ubicación GPS…', 'info');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                AppState.ubicacionSupervisor = { lat, lng };

                if (map) {
                    map.flyTo({ center: [lng, lat], zoom: 15 });

                    if (!AppState.markerSupervisor) {
                        const el = document.createElement('div');
                        el.className = 'cs-gps-pegman-wrap';
                        el.setAttribute('title', 'Tu ubicación actual (Supervisor en campo)');
                        el.innerHTML = `
                            <div class="cs-gps-pegman-radar"></div>
                            <svg class="cs-gps-pegman-svg" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <!-- Sombra de los pies en el suelo -->
                                <ellipse cx="18" cy="45" rx="8" ry="2.5" fill="rgba(15,23,42,0.4)"/>
                                
                                <!-- Piernas: Jeans azul moderno -->
                                <rect x="13" y="29" width="4" height="13" rx="2" fill="#2563eb"/>
                                <rect x="13" y="39.5" width="4" height="2.5" rx="1" fill="#1d4ed8"/>
                                <!-- Zapato izquierdo: Sneaker blanco con suela oscura -->
                                <ellipse cx="14" cy="43" rx="3.5" ry="2" fill="#ffffff" stroke="#0f172a" stroke-width="0.8"/>
                                <ellipse cx="14" cy="44" rx="3" ry="0.8" fill="#0f172a"/>
                                <ellipse cx="14.5" cy="42.5" rx="1.5" ry="0.7" fill="#94a3b8"/>
                                
                                <!-- Pierna derecha -->
                                <rect x="19" y="29" width="4" height="13" rx="2" fill="#2563eb"/>
                                <rect x="19" y="39.5" width="4" height="2.5" rx="1" fill="#1d4ed8"/>
                                <!-- Zapato derecho: Sneaker blanco con suela oscura -->
                                <ellipse cx="22" cy="43" rx="3.5" ry="2" fill="#ffffff" stroke="#0f172a" stroke-width="0.8"/>
                                <ellipse cx="22" cy="44" rx="3" ry="0.8" fill="#0f172a"/>
                                <ellipse cx="22.5" cy="42.5" rx="1.5" ry="0.7" fill="#94a3b8"/>
                                
                                <!-- Camiseta interior visible en cuello -->
                                <path d="M15 14H21V16H15V14Z" fill="#0f172a"/>

                                <!-- Cuerpo / Chaleco gris técnico de campo Clima Social -->
                                <path d="M11 16C11 14.5 12.5 13.5 14 13.5H22C23.5 13.5 25 14.5 25 16V28C25 29 24 30 23 30H13C12 30 11 29 11 28V16Z" fill="#64748b" stroke="#334155" stroke-width="0.8"/>
                                <!-- Cremallera central plateada -->
                                <line x1="18" y1="14" x2="18" y2="30" stroke="#cbd5e1" stroke-width="0.9" stroke-dasharray="1 0.7"/>
                                
                                <!-- Bolsillos inferiores del chaleco con tiradores -->
                                <rect x="12" y="23" width="4.5" height="5" rx="0.8" fill="#475569" stroke="#334155" stroke-width="0.5"/>
                                <rect x="19.5" y="23" width="4.5" height="5" rx="0.8" fill="#475569" stroke="#334155" stroke-width="0.5"/>
                                <line x1="12" y1="24.2" x2="16.5" y2="24.2" stroke="#334155" stroke-width="0.6"/>
                                <line x1="19.5" y1="24.2" x2="24" y2="24.2" stroke="#334155" stroke-width="0.6"/>

                                <!-- Bolsillo superior derecho con gafete -->
                                <rect x="12" y="16" width="3.8" height="3.5" rx="0.6" fill="#475569" stroke="#334155" stroke-width="0.5"/>
                                <rect x="12.6" y="16.8" width="2.6" height="1.8" rx="0.3" fill="#ffffff"/>
                                <line x1="13" y1="17.7" x2="14.8" y2="17.7" stroke="#0284c7" stroke-width="0.5"/>

                                <!-- ISOTIPO OFICIAL CLIMA SOCIAL EN EL PECHO (4 Nodos) -->
                                <circle cx="21.6" cy="17.8" r="3.3" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.4"/>
                                <!-- Nodo Superior: Coral Red (#C23B49) -->
                                <circle cx="21.6" cy="16.3" r="1.1" fill="#C23B49"/>
                                <!-- Nodo Derecho: Slate Teal (#4F7E90) -->
                                <circle cx="23.1" cy="17.8" r="1.1" fill="#4F7E90"/>
                                <!-- Nodo Inferior: Amber Gold (#F0A200) -->
                                <circle cx="21.6" cy="19.3" r="1.1" fill="#F0A200"/>
                                <!-- Nodo Izquierdo: Deep Purple (#40004F) -->
                                <circle cx="20.1" cy="17.8" r="1.1" fill="#40004F"/>
                                <!-- Centro blanco nexus -->
                                <circle cx="21.6" cy="17.8" r="0.65" fill="#ffffff"/>

                                <!-- Brazo izquierdo con portapapeles de encuestas -->
                                <path d="M11 16L7.5 22C7 23 7.5 24.5 8.5 24.5L11 24" stroke="#64748b" stroke-width="2.8" stroke-linecap="round"/>
                                <rect x="4" y="20" width="6.5" height="8.5" rx="1" fill="#ffffff" stroke="#0f172a" stroke-width="0.8"/>
                                <rect x="5.5" y="19" width="3.5" height="1.5" rx="0.5" fill="#0284c7"/>
                                <line x1="5.5" y1="22.5" x2="9" y2="22.5" stroke="#64748b" stroke-width="0.8"/>
                                <line x1="5.5" y1="24.5" x2="9" y2="24.5" stroke="#64748b" stroke-width="0.8"/>
                                <line x1="5.5" y1="26.5" x2="8" y2="26.5" stroke="#64748b" stroke-width="0.8"/>
                                <circle cx="10.2" cy="24.2" r="1.2" fill="#fcd34d"/>

                                <!-- Brazo derecho saludando (animado) -->
                                <g class="cs-pegman-arm-waving">
                                    <path d="M25 16L28.5 21C29.2 22 28.5 23.5 27.5 23.5L25 23" stroke="#64748b" stroke-width="2.8" stroke-linecap="round"/>
                                    <circle cx="28" cy="23.5" r="1.5" fill="#fcd34d"/>
                                </g>

                                <!-- Cabeza y Rostro -->
                                <rect x="16.5" y="12.5" width="3" height="2" fill="#fcd34d"/>
                                <circle cx="18" cy="8.5" r="5.5" fill="#fcd34d"/>
                                <circle cx="16.5" cy="8.5" r="0.75" fill="#0f172a"/>
                                <circle cx="16.3" cy="8.2" r="0.28" fill="#ffffff"/>
                                <circle cx="19.5" cy="8.5" r="0.75" fill="#0f172a"/>
                                <circle cx="19.3" cy="8.2" r="0.28" fill="#ffffff"/>
                                <path d="M16.8 10.5C17.2 11.2 18.8 11.2 19.2 10.5" stroke="#0f172a" stroke-width="0.75" stroke-linecap="round"/>
                                <circle cx="15.2" cy="9.8" r="0.8" fill="#f87171" opacity="0.45"/>
                                <circle cx="20.8" cy="9.8" r="0.8" fill="#f87171" opacity="0.45"/>

                                <!-- Gorrita de campo deportiva -->
                                <path d="M12.5 7C13 4 15 3 18 3C21 3 23 4 23.5 7H12.5Z" fill="#334155"/>
                                <path d="M12 7.5H24.5C25.5 7.5 26 8.2 25 8.5L23 9H13L12 7.5Z" fill="#0f172a"/>
                                <circle cx="18" cy="3" r="1" fill="#4F7E90"/>
                            </svg>
                        `;

                        AppState.markerSupervisor = new maplibregl.Marker({ 
                            element: el,
                            anchor: 'bottom'
                        })
                            .setLngLat([lng, lat])
                            .setPopup(new maplibregl.Popup({ offset: [0, -48] }).setHTML(`
                                <div style="font-family:'Plus Jakarta Sans',sans-serif;padding:3px 6px;text-align:center;">
                                    <strong style="color:#0f172a;font-size:0.86rem;display:block;">📍 Tu ubicación actual</strong>
                                    <span style="color:#64748b;font-size:0.74rem;">Supervisor en campo</span>
                                </div>
                            `))
                            .addTo(map);
                    } else {
                        AppState.markerSupervisor.setLngLat([lng, lat]);
                    }
                }

                mostrarToast('Ubicación fijada ✓', 'success');
                renderizarVista();
            },
            (err) => {
                console.warn('Fallo geolocalización inicial:', err);
                // Si falló por timeout o alta precisión, reintentar con precisión estándar (red/antena)
                if (err.code === 3 || err.code === 2) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            const lat = pos.coords.latitude;
                            const lng = pos.coords.longitude;
                            AppState.ubicacionSupervisor = { lat, lng };
                            if (map) {
                                map.flyTo({ center: [lng, lat], zoom: 15 });
                                if (AppState.markerSupervisor) {
                                    AppState.markerSupervisor.setLngLat([lng, lat]);
                                }
                            }
                            mostrarToast('Ubicación aproximada fijada ✓', 'success');
                        },
                        (fallbackErr) => {
                            let msg = 'No se pudo obtener el GPS. ';
                            if (fallbackErr.code === 1) msg += 'Permiso denegado en el navegador.';
                            else if (fallbackErr.code === 2) msg += 'Activa el GPS/Ubicación en tu teléfono.';
                            else msg += 'Tiempo de espera agotado. Reintenta al aire libre.';
                            mostrarToast(msg, 'error');
                        },
                        { enableHighAccuracy: false, timeout: 15000 }
                    );
                } else if (err.code === 1) {
                    mostrarToast('Permiso de GPS bloqueado. Actívalo en el candado 🔒 de tu navegador.', 'error');
                } else {
                    mostrarToast('No se pudo obtener el GPS. Verifica que esté activo en los ajustes de tu celular.', 'error');
                }
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
        );
    }

    // =========================================================================
    // CONTEO DE ENCUESTAS VISIBLES POR SUPERVISOR Y ENCUESTADOR
    // =========================================================================
    function actualizarLeyendaMapa(encuestas) {
        if (!UI.mapLegend || !UI.mapLegendItems) return;

        if (!encuestas || encuestas.length === 0) {
            UI.mapLegend.style.display = 'none';
            return;
        }

        const conteoSupervisores = new Map();
        const conteoEncuestadores = new Map();
        encuestas.forEach(e => {
            if (!extraerCoordenadas(e)) return;
            const enc = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '').trim();
            if (sup && sup !== '98') conteoSupervisores.set(sup, (conteoSupervisores.get(sup) || 0) + 1);
            if (enc && enc !== '98') conteoEncuestadores.set(enc, (conteoEncuestadores.get(enc) || 0) + 1);
        });

        if (conteoSupervisores.size === 0 && conteoEncuestadores.size === 0) {
            UI.mapLegend.style.display = 'none';
            return;
        }

        UI.mapLegend.style.display = 'block';
        UI.mapLegendItems.innerHTML = '';

        const ordenarCodigos = (a, b) => {
            const numA = parseInt(a, 10);
            const numB = parseInt(b, 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b, undefined, { numeric: true });
        };

        const frag = document.createDocumentFragment();
        const agregarGrupo = (titulo, conteos, etiqueta, color) => {
            if (!conteos.size) return;
            const encabezado = document.createElement('div');
            encabezado.className = 'cs-map-legend__group-title';
            encabezado.textContent = titulo;
            frag.appendChild(encabezado);
            Array.from(conteos.keys()).sort(ordenarCodigos).forEach(id => {
                const nombreCompleto = etiqueta(id, 'completo');
                const total = conteos.get(id);
                const item = document.createElement('div');
                item.className = 'cs-map-legend__item';
                item.title = `${nombreCompleto}: ${total} encuestas mapeadas`;
                const punto = document.createElement('span');
                punto.className = 'cs-legend-color-dot';
                punto.style.backgroundColor = color(id);
                const nombre = document.createElement('span');
                nombre.className = 'cs-map-legend__name';
                nombre.title = nombreCompleto;
                nombre.textContent = etiqueta(id, 'corto');
                const cantidad = document.createElement('span');
                cantidad.className = 'cs-legend-count';
                cantidad.textContent = total;
                item.append(punto, nombre, cantidad);
                frag.appendChild(item);
            });
        };
        agregarGrupo('Supervisores', conteoSupervisores, obtenerEtiquetaSupervisor,
            id => PALETA_SUPERVISORES[id] || PALETA_SUPERVISORES.default);
        agregarGrupo('Encuestadores', conteoEncuestadores, obtenerEtiquetaEncuestador,
            obtenerColorEncuestador);

        UI.mapLegendItems.appendChild(frag);
    }

    // =========================================================================
    // TABLA DE RENDIMIENTO POR ENCUESTADOR & MÉTRICAS DE TIEMPO
    // =========================================================================
    function formatearMinutos(m) {
        if (m === null || isNaN(m) || m <= 0) return '-';
        if (m < 1) return `${Math.round(m * 60)}s`;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const rem = Math.round(m % 60);
            return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
        }
        return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`;
    }

    function agruparPorEncuestador(encuestas) {
        const grupos = new Map();

        // Pre-poblar los encuestadores oficiales de la nómina para que aparezcan siempre en la tabla lateral
        Object.keys(EQUIPO_CAMPO).forEach(codEnc => {
            const supOficial = ENCUESTADOR_A_SUPERVISOR[codEnc] || 'Sin asignar';
            grupos.set(codEnc, {
                id: codEnc,
                encuestas: [],
                duraciones: [],
                totalMins: 0,
                numAlertas: 0,
                supervisor: String(supOficial).trim(),
                cantonesConteo: {},
                promStr: 'Sin datos',
                minStr: '-',
                maxStr: '-'
            });
        });

        const total = encuestas.length;

        for (let i = 0; i < total; i++) {
            const enc = encuestas[i];
            const codEnc = String(enc.encuestador || enc.C_digo_encuestador || campo(enc, AppState.config.campoEncuestador) || 'Sin asignar');
            const codSup = String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '').trim();
            if (codEnc === '98' || codSup === '98') continue;

            let g = grupos.get(codEnc);
            if (!g) {
                const supOficial = ENCUESTADOR_A_SUPERVISOR[codEnc];
                const supVal = supOficial || codSup || 'Sin asignar';
                g = {
                    id: codEnc,
                    encuestas: [],
                    duraciones: [],
                    totalMins: 0,
                    numAlertas: 0,
                    supervisor: String(supVal).trim(),
                    cantonesConteo: {},
                    promStr: 'Sin datos',
                    minStr: '-',
                    maxStr: '-'
                };
                grupos.set(codEnc, g);
            }

            if (enc._tieneAlerta) {
                g.numAlertas = (g.numAlertas || 0) + 1;
            }

            g.encuestas.push(enc);
            const canton = obtenerCantonEncuesta(enc);
            if (canton && canton !== 'Sin asignar') {
                g.cantonesConteo[canton] = (g.cantonesConteo[canton] || 0) + 1;
            }

            // Duración por encuesta (filtrando outliers <30s o >3h)
            const s = enc.start;
            const end = enc.end;
            if (s && end) {
                const d1 = new Date(s).getTime();
                const d2 = new Date(end).getTime();
                if (!isNaN(d1) && !isNaN(d2) && d2 > d1) {
                    const diff = (d2 - d1) / 60000;
                    if (diff >= 0.5 && diff <= 180) {
                        g.totalMins += diff;
                        g.duraciones.push(diff);
                    }
                }
            }
        }

        // Asegurar que toda la nómina oficial esté representada en el panel de equipo
        if (Object.keys(EQUIPO_CAMPO).length > 0) {
            Object.keys(EQUIPO_CAMPO).forEach(codEnc => {
                if (!grupos.has(codEnc)) {
                    const supOficial = ENCUESTADOR_A_SUPERVISOR[codEnc] || 'Sin asignar';
                    grupos.set(codEnc, {
                        id: codEnc,
                        encuestas: [],
                        duraciones: [],
                        totalMins: 0,
                        numAlertas: 0,
                        supervisor: String(supOficial).trim(),
                        cantonesConteo: {},
                        promStr: '--',
                        minStr: '--',
                        maxStr: '--'
                    });
                }
            });
        }

        const resultado = [];
        const territorioDefecto = (AppState.config && (AppState.config.canton || AppState.config.provincia)) || 'Territorio';
        for (const g of grupos.values()) {
            if (g.duraciones.length > 0) {
                const prom = g.totalMins / g.duraciones.length;
                const min = Math.min(...g.duraciones);
                const max = Math.max(...g.duraciones);
                g.promStr = formatearMinutos(prom);
                g.minStr = formatearMinutos(min);
                g.maxStr = formatearMinutos(max);
            }
            g.numAlertas = g.encuestas.filter(e => e._tieneAlerta).length;

            // Cantón principal asignado según encuestas recolectadas
            let topCan = territorioDefecto;
            let topCnt = -1;
            for (const [can, cnt] of Object.entries(g.cantonesConteo || {})) {
                if (cnt > topCnt) {
                    topCnt = cnt;
                    topCan = can;
                }
            }
            g.cantonPrincipal = topCan;
            resultado.push(g);
        }

        return resultado;
    }

    function ordenarEncuestadoresLista(lista) {
        lista.sort((a, b) => {
            if (AppState.ordenTabla.columna === 'encuestas') {
                const diff = a.encuestas.length - b.encuestas.length;
                return AppState.ordenTabla.asc ? diff : -diff;
            } else {
                const numA = parseInt(a.id, 10);
                const numB = parseInt(b.id, 10);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return AppState.ordenTabla.asc ? (numA - numB) : (numB - numA);
                }
                const cmp = String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' });
                return AppState.ordenTabla.asc ? cmp : -cmp;
            }
        });
    }

    function crearFilaEncuestador(grupo) {
        const tr = document.createElement('tr');
        tr.className = 'cs-enc-row';
        if (AppState.encuestadorSeleccionado === grupo.id) {
            tr.classList.add('selected');
        }

        const supLabel = obtenerEtiquetaSupervisor(grupo.supervisor, 'micro');
        const supTitle = obtenerEtiquetaSupervisor(grupo.supervisor, 'completo');
        const encTituloCorto = obtenerEtiquetaEncuestador(grupo.id, 'corto');
        const encTituloCompleto = obtenerEtiquetaEncuestador(grupo.id, 'completo');

        // Badge de supervisor
        const badgeSupHtml = `<span class="cs-badge" style="background:var(--bg-subtle);color:var(--text-muted);font-weight:600;font-size:0.6rem;padding:0.06rem 0.35rem;border:1px solid var(--border-subtle);" title="${supTitle}">${supLabel}</span>`;

        tr.innerHTML = `
            <td>
                <div class="cs-enc-card">
                    <div class="cs-enc-avatar" style="--enc-color:${obtenerColorEncuestador(grupo.id)};">
                        <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <div class="cs-enc-meta">
                        <div class="cs-enc-name" title="${encTituloCompleto} (${supTitle})">
                            <span>${encTituloCompleto}</span>
                        </div>
                        <div class="cs-enc-sub">
                            ${badgeSupHtml}
                            <span class="cs-time-tag cs-time-tag--avg" title="Tiempo promedio por encuesta">⏱️ ${grupo.promStr}</span>
                            <span class="cs-time-tag cs-time-tag--min" title="Tiempo mínimo registrado">⬇️ ${grupo.minStr}</span>
                            <span class="cs-time-tag cs-time-tag--max" title="Tiempo máximo registrado">⬆️ ${grupo.maxStr}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td style="text-align:right;">
                <span class="cs-enc-total-pill" title="Total de encuestas recolectadas">${grupo.encuestas.length}</span>
            </td>
        `;

        tr.addEventListener('click', (e) => {
            e.stopPropagation();
            seleccionarEncuestador(grupo.id);
        });

        return tr;
    }

    function actualizarTabla(encuestas) {
        if (!UI.tablaEncuestadoresBody) {
            UI.tablaEncuestadoresBody = document.querySelector('#tablaEncuestadores tbody');
        }
        if (!UI.tablaEncuestadoresBody) return;

        // Sincronizar estado visual de los botones de agrupación
        if (UI.btnAgruparCanton && UI.btnAgruparSupervisor) {
            const esCanton = AppState.modoAgrupacionTabla === 'canton';
            UI.btnAgruparCanton.classList.toggle('is-active', esCanton);
            UI.btnAgruparSupervisor.classList.toggle('is-active', !esCanton);
        }

        let datos = agruparPorEncuestador(encuestas);

        // Búsqueda en vivo (por id, supervisor o cantón)
        if (AppState.filtroTabla) {
            const term = AppState.filtroTabla.toLowerCase();
            datos = datos.filter(g => {
                const nombreEnc = obtenerEtiquetaEncuestador(g.id, 'completo').toLowerCase();
                const nombreSup = obtenerEtiquetaSupervisor(g.supervisor, 'completo').toLowerCase();
                return g.id.toLowerCase().includes(term) || 
                    nombreEnc.includes(term) ||
                    nombreSup.includes(term) ||
                    (g.supervisor && g.supervisor.toLowerCase().includes(term)) ||
                    (g.cantonPrincipal && g.cantonPrincipal.toLowerCase().includes(term));
            });
        }

        UI.tablaEncuestadoresBody.innerHTML = '';

        if (datos.length === 0) {
            if (UI.emptyState) UI.emptyState.style.display = 'flex';
            return;
        }

        if (UI.emptyState) UI.emptyState.style.display = 'none';

        const fragment = document.createDocumentFragment();

        // ---------------------------------------------------------------------
        // AGRUPAR POR SUPERVISOR (Panel limpio: estrictamente los 4 supervisores y sus 3 encuestadores)
        // ---------------------------------------------------------------------
        const gruposSupervisor = new Map();
        const hayNominaOficial = Object.keys(SUPERVISORES_CAMPO).length > 0;

        if (hayNominaOficial) {
            Object.keys(SUPERVISORES_CAMPO).forEach(supId => {
                gruposSupervisor.set(supId, {
                    id: supId,
                    encuestadores: [],
                    totalEncuestas: 0
                });
            });
        }

        let totalOficialesActivos = 0;

        datos.forEach(encuestador => {
            const supOficial = ENCUESTADOR_A_SUPERVISOR[encuestador.id];
            if (hayNominaOficial) {
                if (supOficial && gruposSupervisor.has(supOficial) && EQUIPO_CAMPO[encuestador.id]) {
                    const gSup = gruposSupervisor.get(supOficial);
                    gSup.encuestadores.push(encuestador);
                    gSup.totalEncuestas += encuestador.encuestas.length;
                    totalOficialesActivos++;
                }
            } else {
                // Modo dinámico limpio: agrupar por el supervisor reportado en las encuestas
                const supVal = encuestador.supervisor || 'Sin asignar';
                if (!gruposSupervisor.has(supVal)) {
                    gruposSupervisor.set(supVal, {
                        id: supVal,
                        encuestadores: [],
                        totalEncuestas: 0
                    });
                }
                const gSup = gruposSupervisor.get(supVal);
                gSup.encuestadores.push(encuestador);
                gSup.totalEncuestas += encuestador.encuestas.length;
                totalOficialesActivos++;
            }
        });

        // Determinar qué supervisores mostrar
        let supKeys = Array.from(gruposSupervisor.keys()).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));
        if (AppState.supervisorSeleccionado !== 'Todos') {
            supKeys = supKeys.filter(id => id === AppState.supervisorSeleccionado);
        } else if (AppState.filtroTabla) {
            supKeys = supKeys.filter(id => gruposSupervisor.get(id).encuestadores.length > 0);
        }

        supKeys.forEach(supId => {
            const gSup = gruposSupervisor.get(supId);
            ordenarEncuestadoresLista(gSup.encuestadores);

            const colorSupervisor = PALETA_SUPERVISORES[supId] || PALETA_SUPERVISORES.default;
            const isExplicitlyExpanded = AppState.supervisoresExpandidos && AppState.supervisoresExpandidos.has(supId);
            const isFilteredSup = AppState.supervisorSeleccionado !== 'Todos' && AppState.supervisorSeleccionado === supId;
            const hasSearch = Boolean(AppState.filtroTabla);
            // Para supervisores en Ibarra, abiertos por defecto salvo que se colapsen explícitamente
            const isExplicitlyCollapsed = AppState.supervisoresExpandidos && AppState.supervisoresExpandidos.has(supId) === false;
            const isCollapsed = isExplicitlyCollapsed && !hasSearch && !isFilteredSup;

            // Fila de encabezado de grupo (Supervisor)
            const trHeader = document.createElement('tr');
            trHeader.className = `cs-table-group-header ${isCollapsed ? 'is-collapsed' : ''}`;
            trHeader.dataset.supId = supId;

            const supLabel = obtenerEtiquetaSupervisor(supId, 'completo');
            const supTitle = obtenerEtiquetaSupervisor(supId, 'completo');
            const pluralEnc = gSup.encuestadores.length === 1 ? 'enc.' : 'enc.';
            const pluralEncuestas = gSup.totalEncuestas === 1 ? 'encuesta' : 'encuestas';

            trHeader.innerHTML = `
                <td colspan="2">
                    <div class="cs-table-group-title">
                        <span class="cs-group-toggle-icon">
                            <svg class="cs-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </span>
                        <span class="cs-group-color-dot" style="--sup-dot-color: ${colorSupervisor};"></span>
                        <span class="cs-group-name" title="${supTitle}">${supLabel}</span>
                        <span class="cs-group-pill" style="margin-left:auto;">${gSup.encuestadores.length} ${pluralEnc} · ${gSup.totalEncuestas} ${pluralEncuestas}</span>
                    </div>
                </td>
            `;

            trHeader.addEventListener('click', () => {
                if (!AppState.supervisoresExpandidos) AppState.supervisoresExpandidos = new Set();
                if (AppState.supervisoresExpandidos.has(supId)) {
                    AppState.supervisoresExpandidos.delete(supId);
                } else {
                    AppState.supervisoresExpandidos.add(supId);
                }
                const encs = obtenerEncuestasFiltradas();
                actualizarTabla(encs);
            });

            fragment.appendChild(trHeader);

            // Filas de encuestadores del supervisor (si no está colapsado)
            if (!isCollapsed) {
                gSup.encuestadores.forEach(grupo => {
                    try {
                        fragment.appendChild(crearFilaEncuestador(grupo));
                    } catch (errFila) {
                        console.error('Error al crear fila de encuestador:', errFila);
                    }
                });
            }
        });

        // ---------------------------------------------------------------------
        // SECCIÓN DE ERRORES DE CÓDIGO (Al final de los supervisores)
        // ---------------------------------------------------------------------
        const encuestadoresNoOficiales = hayNominaOficial ? datos.filter(g => !EQUIPO_CAMPO[g.id]) : [];
        ordenarEncuestadoresLista(encuestadoresNoOficiales);

        const encuestasBase = AppState.encuestas || [];
        const encuestasSupMismatch = hayNominaOficial ? encuestasBase.filter(e => {
            const encCod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
            const supOrig = String(e._supervisorOriginal || '').trim();
            const supEsp = ENCUESTADOR_A_SUPERVISOR[encCod];
            return Boolean(EQUIPO_CAMPO[encCod] && supOrig && supEsp && supOrig !== supEsp);
        }) : [];

        let mismatchesFiltrados = encuestasSupMismatch;
        if (AppState.supervisorSeleccionado !== 'Todos') {
            mismatchesFiltrados = mismatchesFiltrados.filter(e => {
                const encCod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
                return ENCUESTADOR_A_SUPERVISOR[encCod] === AppState.supervisorSeleccionado;
            });
        }
        if (AppState.filtroTabla) {
            const term = AppState.filtroTabla.toLowerCase();
            mismatchesFiltrados = mismatchesFiltrados.filter(e => {
                const encCod = String(e.encuestador || '').toLowerCase();
                const nom = (EQUIPO_CAMPO[encCod]?.nombre || '').toLowerCase();
                return encCod.includes(term) || nom.includes(term);
            });
        }

        const totalErroresNoOficiales = (AppState.supervisorSeleccionado === 'Todos') ? encuestadoresNoOficiales.reduce((acc, g) => acc + g.encuestas.length, 0) : 0;
        const totalErroresSupMismatch = mismatchesFiltrados.length;
        const totalErrores = totalErroresNoOficiales + totalErroresSupMismatch;

        if (totalErrores > 0) {
            const isErrorsCollapsed = AppState.erroresColapsados !== false;

            const trErrorsHeader = document.createElement('tr');
            trErrorsHeader.className = `cs-table-group-header cs-table-group-header--errors ${isErrorsCollapsed ? 'is-collapsed' : ''}`;
            trErrorsHeader.innerHTML = `
                <td colspan="2">
                    <div class="cs-table-group-title">
                        <span class="cs-group-toggle-icon">
                            <svg class="cs-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </span>
                        <span class="cs-group-color-dot" style="--sup-dot-color: #ef4444; background: #ef4444;"></span>
                        <span class="cs-group-name" style="color: #ef4444; font-weight: 800;">⚠️ Errores</span>
                        <span class="cs-group-pill cs-group-pill--danger">${totalErrores}</span>
                    </div>
                </td>
            `;

            trErrorsHeader.addEventListener('click', () => {
                AppState.erroresColapsados = !AppState.erroresColapsados;
                const encs = obtenerEncuestasFiltradas();
                actualizarTabla(encs);
            });

            fragment.appendChild(trErrorsHeader);

            if (!isErrorsCollapsed) {
                // A. Encuestadores no oficiales
                if (AppState.supervisorSeleccionado === 'Todos') {
                    encuestadoresNoOficiales.forEach(g => {
                        const tr = document.createElement('tr');
                        tr.className = 'cs-enc-row cs-error-row';
                        if (AppState.encuestadorSeleccionado === g.id) {
                            tr.classList.add('selected');
                        }
                        tr.innerHTML = `
                            <td>
                                <div class="cs-enc-card">
                                    <div class="cs-enc-avatar" style="--enc-color:#ef4444; background:#fee2e2; color:#b91c1c; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem;">
                                        ⚠️
                                    </div>
                                    <div class="cs-enc-meta">
                                        <div class="cs-enc-name">
                                            <span style="font-weight:700; color:#b91c1c;">Enc. ${g.id}</span>
                                        </div>
                                        <div class="cs-enc-sub" style="font-size:0.7rem; color:var(--text-muted);">
                                            <span>No oficial</span>
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td style="text-align:right;">
                                <span class="cs-enc-total-pill cs-enc-total-pill--danger" title="Encuestas no oficiales">${g.encuestas.length}</span>
                            </td>
                        `;
                        tr.addEventListener('click', (e) => {
                            e.stopPropagation();
                            seleccionarEncuestador(g.id);
                        });
                        fragment.appendChild(tr);
                    });
                }

                // B. Errores de supervisor ingresado
                const mismatchesPorEnc = new Map();
                mismatchesFiltrados.forEach(e => {
                    const encCod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '').trim();
                    if (!mismatchesPorEnc.has(encCod)) {
                        mismatchesPorEnc.set(encCod, []);
                    }
                    mismatchesPorEnc.get(encCod).push(e);
                });

                mismatchesPorEnc.forEach((encsList, encCod) => {
                    const nombreEnc = EQUIPO_CAMPO[encCod]?.nombre || encCod;
                    const supEsperado = ENCUESTADOR_A_SUPERVISOR[encCod];
                    const supsIngresados = [...new Set(encsList.map(e => e._supervisorOriginal))].join(', ');

                    const tr = document.createElement('tr');
                    tr.className = 'cs-enc-row cs-error-row';
                    tr.innerHTML = `
                        <td>
                            <div class="cs-enc-card">
                                <div class="cs-enc-avatar" style="--enc-color:#f59e0b; background:#fef3c7; color:#b45309; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem;">
                                    ⚠️
                                </div>
                                <div class="cs-enc-meta">
                                    <div class="cs-enc-name">
                                        <span style="font-weight:700;">Enc. ${encCod} (${nombreEnc})</span>
                                    </div>
                                    <div class="cs-enc-sub" style="font-size:0.7rem; color:var(--text-muted);">
                                        <span>Sup. ${supsIngresados} en vez de ${supEsperado}</span>
                                    </div>
                                </div>
                            </div>
                        </td>
                        <td style="text-align:right;">
                            <span class="cs-enc-total-pill cs-enc-total-pill--warning" title="Supervisor incorrecto">${encsList.length}</span>
                        </td>
                    `;
                    tr.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const coords = encsList.map(e => extraerCoordenadas(e)).filter(Boolean);
                        if (coords.length > 0 && map) {
                            if (coords.length === 1) {
                                map.flyTo({ center: [coords[0][1], coords[0][0]], zoom: 16, duration: 700 });
                            } else {
                                let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
                                coords.forEach(([lat, lng]) => {
                                    if (lng < minLng) minLng = lng;
                                    if (lat < minLat) minLat = lat;
                                    if (lng > maxLng) maxLng = lng;
                                    if (lat > maxLat) maxLat = lat;
                                });
                                map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 16, duration: 700 });
                            }
                        }
                        mostrarToast(`Enc. ${encCod}: Sup. ${supsIngresados} en vez de ${supEsperado}`, 'warning');
                    });
                    fragment.appendChild(tr);
                });
            }
        }

        UI.tablaEncuestadoresBody.appendChild(fragment);
    }

    // =========================================================================
    // PIRÁMIDE POBLACIONAL (SEXO Y GRUPOS DE EDAD) - ULTRA LIGERA
    // =========================================================================
    const COHORTES_PIRAMIDE = [
        { id: '61+', label: '61+', min: 61, max: 125 },
        { id: '45-60', label: '45-60', min: 45, max: 60 },
        { id: '30-44', label: '30-44', min: 30, max: 44 },
        { id: '20-29', label: '20-29', min: 20, max: 29 },
        { id: '16-19', label: '16-19', min: 16, max: 19 }
    ];

    function extraerSexoYEdad(e) {
        if (!e) return { sexo: null, edad: null };

        // 1. Sexo / Género (Detección directa y tolerante a variantes de formulario)
        let sexo = null;
        let rawGen = (
            e.genero ||
            e.sexo ||
            e.p1 ||
            e.p_genero ||
            e.p_sexo ||
            e.filtro_genero ||
            e.filtro_sexo ||
            e['1. ¿CUÁL ES SU GÉNERO?'] ||
            e['1._CU_L_ES_SU_G_NERO'] ||
            campo(e, 'genero') ||
            campo(e, 'sexo') ||
            campo(e, 'p1') ||
            campo(e, 'p_genero') ||
            ''
        );

        if (!rawGen) {
            const keys = Object.keys(e);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i].toLowerCase();
                if (k.includes('genero') || k.includes('sexo') || k.endsWith('/p1') || k === 'p1') {
                    rawGen = e[keys[i]];
                    if (rawGen) break;
                }
            }
        }

        const genStr = String(rawGen || '').toLowerCase().trim();
        if (genStr.includes('masc') || genStr.includes('hombre') || genStr === '1' || genStr === 'h') {
            sexo = 'Hombre';
        } else if (genStr.includes('fem') || genStr.includes('mujer') || genStr === '2' || genStr === 'm') {
            sexo = 'Mujer';
        }

        // 2. Edad (Detección directa y numérica segura)
        let edad = null;
        let rawEdad = (
            e.edad !== undefined ? e.edad :
            e.p2 !== undefined ? e.p2 :
            e.p_edad !== undefined ? e.p_edad :
            e.filtro_edad !== undefined ? e.filtro_edad :
            e['2. ¿CUÁL ES SU EDAD? (edad cumplida en años)'] !== undefined ? e['2. ¿CUÁL ES SU EDAD? (edad cumplida en años)'] :
            campo(e, 'edad') !== undefined ? campo(e, 'edad') :
            campo(e, 'p2')
        );

        if (rawEdad === undefined || rawEdad === null || rawEdad === '') {
            const keys = Object.keys(e);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i].toLowerCase();
                if (k.includes('edad') || k.endsWith('/p2') || k === 'p2') {
                    rawEdad = e[keys[i]];
                    if (rawEdad !== undefined && rawEdad !== null && rawEdad !== '') break;
                }
            }
        }

        if (rawEdad !== undefined && rawEdad !== null && rawEdad !== '') {
            const n = parseInt(rawEdad, 10);
            if (!isNaN(n) && n >= 15 && n <= 115) {
                edad = n;
            }
        }

        return { sexo, edad };
    }

    function actualizarPiramidePoblacional(encuestas) {
        if (!UI.filasPiramide) return;

        let totalHombres = 0;
        let totalMujeres = 0;
        let conRegistroValido = 0;

        const conteo = {};
        COHORTES_PIRAMIDE.forEach(c => {
            conteo[c.id] = { hombres: 0, mujeres: 0 };
        });

        const total = encuestas ? encuestas.length : 0;
        for (let i = 0; i < total; i++) {
            const { sexo, edad } = extraerSexoYEdad(encuestas[i]);
            if (sexo && edad !== null) {
                conRegistroValido++;
                if (sexo === 'Hombre') totalHombres++;
                else if (sexo === 'Mujer') totalMujeres++;

                for (let j = 0; j < COHORTES_PIRAMIDE.length; j++) {
                    const c = COHORTES_PIRAMIDE[j];
                    if (edad >= c.min && edad <= c.max) {
                        if (sexo === 'Hombre') conteo[c.id].hombres++;
                        else if (sexo === 'Mujer') conteo[c.id].mujeres++;
                        break;
                    }
                }
            } else if (sexo === 'Hombre') {
                totalHombres++;
            } else if (sexo === 'Mujer') {
                totalMujeres++;
            }
        }

        const totalSexo = totalHombres + totalMujeres;
        const pctHombres = totalSexo > 0 ? ((totalHombres / totalSexo) * 100).toFixed(1) : '0.0';
        const pctMujeres = totalSexo > 0 ? ((totalMujeres / totalSexo) * 100).toFixed(1) : '0.0';

        if (UI.tagHombres) UI.tagHombres.textContent = `♂ ${pctHombres}% (${totalHombres})`;
        if (UI.tagMujeres) UI.tagMujeres.textContent = `♀ ${pctMujeres}% (${totalMujeres})`;

        // Subtítulo contextual reactivo al sector o filtro activo
        if (UI.subtextoPiramide) {
            if (AppState.sectorSeleccionado && AppState.sectorSeleccionado !== 'Todos') {
                const scLimpio = AppState.sectorSeleccionado.includes('_') 
                    ? AppState.sectorSeleccionado.split('_')[1] 
                    : AppState.sectorSeleccionado;
                UI.subtextoPiramide.textContent = `(Sector ${scLimpio} · ${total} encuestas)`;
                // Asegurar que la pirámide esté abierta al enfocar un sector
                if (UI.panelPiramide && UI.panelPiramide.classList.contains('collapsed')) {
                    UI.panelPiramide.classList.remove('collapsed');
                    if (UI.togglePiramide) UI.togglePiramide.setAttribute('aria-expanded', 'true');
                }
            } else if (AppState.parroquiaSeleccionada && AppState.parroquiaSeleccionada !== 'Todas') {
                UI.subtextoPiramide.textContent = `(${AppState.parroquiaSeleccionada} · ${total} encuestas)`;
            } else {
                UI.subtextoPiramide.textContent = `(Total · ${total} encuestas)`;
            }
        }

        if (total === 0 || conRegistroValido === 0) {
            UI.filasPiramide.innerHTML = `
                <div style="text-align:center; padding:0.6rem; color:var(--text-secondary); font-size:0.68rem;">
                    Sin registros demográficos (sexo/edad) en el sector seleccionado
                </div>
            `;
            return;
        }

        // Calcular porcentaje máximo relativo para escalar barras
        let maxPct = 0;
        COHORTES_PIRAMIDE.forEach(c => {
            const hPct = (conteo[c.id].hombres / conRegistroValido) * 100;
            const mPct = (conteo[c.id].mujeres / conRegistroValido) * 100;
            if (hPct > maxPct) maxPct = hPct;
            if (mPct > maxPct) maxPct = mPct;
        });
        if (maxPct <= 0) maxPct = 20;

        let html = '';
        COHORTES_PIRAMIDE.forEach(c => {
            const nH = conteo[c.id].hombres;
            const nM = conteo[c.id].mujeres;
            const pctH = ((nH / conRegistroValido) * 100).toFixed(1);
            const pctM = ((nM / conRegistroValido) * 100).toFixed(1);

            const barWidthH = Math.min(100, Math.max(nH > 0 ? 5 : 0, (nH / conRegistroValido / (maxPct / 100)) * 100));
            const barWidthM = Math.min(100, Math.max(nM > 0 ? 5 : 0, (nM / conRegistroValido / (maxPct / 100)) * 100));

            html += `
                <div class="cs-piramide-row" title="Edad ${c.label}: ${nH} hombres (${pctH}%), ${nM} mujeres (${pctM}%)">
                    <div class="cs-piramide-val cs-piramide-val--hombres">${nH > 0 ? `${nH} <span class="cs-piramide-pct">(${pctH}%)</span>` : ''}</div>
                    <div class="cs-piramide-side cs-piramide-side--left">
                        <div class="cs-piramide-bar cs-piramide-bar--hombres" style="width: ${barWidthH}%;"></div>
                    </div>
                    <div class="cs-piramide-center-label">${c.label}</div>
                    <div class="cs-piramide-side cs-piramide-side--right">
                        <div class="cs-piramide-bar cs-piramide-bar--mujeres" style="width: ${barWidthM}%;"></div>
                    </div>
                    <div class="cs-piramide-val cs-piramide-val--mujeres">${nM > 0 ? `<span class="cs-piramide-pct">(${pctM}%)</span> ${nM}` : ''}</div>
                </div>
            `;
        });

        html += `
            <div class="cs-piramide-footer-note">
                Base analizada: ${conRegistroValido} encuestas con sexo y edad clasificados
            </div>
        `;

        UI.filasPiramide.innerHTML = html;
    }

    function seleccionarEncuestador(id) {
        if (AppState.encuestadorSeleccionado === id) {
            AppState.encuestadorSeleccionado = null;
            mostrarToast('Mostrando todo el equipo', 'info');
            renderizarVista(true, true);
            return;
        }

        AppState.encuestadorSeleccionado = id;

        // Auto-adaptar filtros a este encuestador
        const encuestasDelEnc = AppState.encuestas.filter(e => {
            const cod = String(e.encuestador || e.C_digo_encuestador || campo(e, AppState.config.campoEncuestador) || '');
            return cod === String(id);
        });

        let supId = '';
        const coords = [];
        encuestasDelEnc.forEach(e => {
            const sup = String(e.supervisor || e.C_digo_Supervisor || campo(e, AppState.config.campoSupervisor) || '');
            if (sup && !supId) supId = sup;
            const c = extraerCoordenadas(e);
            if (c) coords.push(c);
        });

        if (supId && Object.keys(SUPERVISORES_CAMPO).includes(String(supId)) && UI.supervisorFilter) {
            AppState.supervisorSeleccionado = supId;
            UI.supervisorFilter.value = supId;
        }

        mostrarToast(`${obtenerEtiquetaEncuestador(id, 'corto')} (${obtenerEtiquetaSupervisor(supId, 'micro')}) · ${encuestasDelEnc.length} encuestas`, 'info');
        renderizarVista(true, false);

        // Enfocar mapa a sus puntos
        if (coords.length > 0 && map) {
            let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
            coords.forEach(([lat, lng]) => {
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
            });

            if (minLng !== Infinity) {
                if (minLng === maxLng && minLat === maxLat) {
                    map.flyTo({ center: [minLng, minLat], zoom: 15, duration: 700 });
                } else {
                    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                        padding: { top: 50, bottom: 50, left: 50, right: 50 },
                        maxZoom: 16,
                        duration: 700
                    });
                }
            }
        }
    }

    // =========================================================================
    // EVENTOS Y CONTROLES
    // =========================================================================
    function configurarEventos() {
        // 1. Filtro Supervisor
        if (UI.supervisorFilter) {
            UI.supervisorFilter.addEventListener('change', (e) => {
                AppState.supervisorSeleccionado = e.target.value;
                if (AppState.encuestadorSeleccionado) {
                    const enc = AppState.encuestas.find(x => {
                        const cod = String(x.encuestador || x.C_digo_encuestador || campo(x, AppState.config.campoEncuestador) || '');
                        return cod === String(AppState.encuestadorSeleccionado);
                    });
                    const sup = enc ? String(enc.supervisor || enc.C_digo_Supervisor || campo(enc, AppState.config.campoSupervisor) || '') : '';
                    if (AppState.supervisorSeleccionado !== 'Todos' && sup !== AppState.supervisorSeleccionado) {
                        AppState.encuestadorSeleccionado = null;
                    }
                }
                renderizarVista(true, true);
            });
        }



        // Filtro Cantón (13 Cantones de Morona Santiago)
        if (UI.cantonFilter) {
            UI.cantonFilter.addEventListener('change', (e) => {
                AppState.cantonSeleccionado = e.target.value;
                AppState.parroquiaSeleccionada = 'Todas';
                AppState.sectorSeleccionado = 'Todos';
                if (UI.parroquiaFilter) UI.parroquiaFilter.value = 'Todas';
                if (UI.sectorFilter) UI.sectorFilter.value = 'Todos';
                poblarFiltros();
                renderizarVista(false, true);
            });
        }

        // 2. Filtro Parroquia
        if (UI.parroquiaFilter) {
            UI.parroquiaFilter.addEventListener('change', (e) => {
                seleccionarParroquia(e.target.value);
            });
        }

        // 3. Filtro Sector Censal (Con auto-sincronización a Cantón y Parroquia)
        if (UI.sectorFilter) {
            UI.sectorFilter.addEventListener('change', (e) => {
                const secVal = e.target.value;
                AppState.sectorSeleccionado = secVal;
                
                if (secVal !== 'Todos') {
                    let secMeta = AppState.sectoresMap.get(secVal);
                    if (!secMeta) {
                        for (let meta of AppState.sectoresMap.values()) {
                            const p = meta.props || {};
                            if (p.sc_key === secVal || String(p.num_muestra) === secVal || String(p.sc) === secVal || p.etiquetaSC === secVal) {
                                secMeta = meta;
                                break;
                            }
                        }
                    }

                    renderizarVista(false, true);

                    if (secMeta && typeof abrirPopupPuntoMuestra === 'function') {
                        let coords = secMeta.centroid;
                        if (!coords && secMeta.feature && secMeta.feature.geometry) {
                            coords = secMeta.feature.geometry.coordinates;
                        }
                        abrirPopupPuntoMuestra(secMeta, coords);
                    }
                } else {
                    renderizarVista(false, true);
                    if (popupSectorActivo) {
                        popupSectorActivo.remove();
                        popupSectorActivo = null;
                    }
                    const barra = document.getElementById('barraSectorActivo');
                    if (barra) barra.style.display = 'none';
                }
            });
        }

        // 3.1 Botón Cerrar Barra Flotante de Punto Activo
        const btnCerrarBarra = document.getElementById('btnCerrarSectorActivo');
        if (btnCerrarBarra) {
            btnCerrarBarra.addEventListener('click', () => {
                const barra = document.getElementById('barraSectorActivo');
                if (barra) barra.style.display = 'none';
            });
        }

        // 4. Filtro Fecha (Dropdown)
        if (UI.fechaFilter) {
            UI.fechaFilter.addEventListener('change', (e) => {
                AppState.fechaSeleccionada = e.target.value;
                renderizarVista(true, true);
            });
        }

        // 4.1 Filtro Rápido de Fecha (Pills: Todas, Hoy, Ayer, Semana)
        const datePills = document.querySelectorAll('#datePills .cs-date-pill');
        if (datePills && datePills.length > 0) {
            datePills.forEach(pill => {
                pill.addEventListener('click', () => {
                    const filterVal = pill.dataset.dateFilter;
                    AppState.fechaSeleccionada = filterVal;
                    if (UI.fechaFilter) {
                        UI.fechaFilter.value = 'Todas';
                    }
                    renderizarVista(true, true);
                });
            });
        }

        // 5. Limpiar Filtros
        if (UI.btnLimpiarFiltros) {
            UI.btnLimpiarFiltros.addEventListener('click', () => {
                AppState.supervisorSeleccionado = 'Todos';
                AppState.cantonSeleccionado = 'Todos';
                AppState.sectorSeleccionado = 'Todos';
                AppState.parroquiaSeleccionada = 'Todas';
                AppState.fechaSeleccionada = 'Todas';
                AppState.encuestadorSeleccionado = null;
                AppState.filtroSoloAlertas = false;
                AppState.filtroSoloPendientes = false;
                AppState.mostrarEtiquetas = false;
                AppState.filtroTabla = '';
                if (UI.cantonFilter) UI.cantonFilter.value = 'Todos';
                if (UI.toggleSoloPendientes) UI.toggleSoloPendientes.classList.remove('active');
                if (UI.btnEtiquetasOn) UI.btnEtiquetasOn.classList.remove('active');
                if (UI.btnEtiquetasOff) UI.btnEtiquetasOff.classList.add('active');
                if (UI.searchInput) UI.searchInput.value = '';

                if (AppState.cantonBbox && map) {
                    map.fitBounds(AppState.cantonBbox, { padding: 35, duration: 800 });
                }

                poblarFiltros();
                renderizarVista(true, true);
                mostrarToast('Filtros restablecidos', 'info');
            });
        }





        // 5. Conmutador de Etiquetas: Mostrar vs Ocultar
        if (UI.btnEtiquetasOn && UI.btnEtiquetasOff) {
            UI.btnEtiquetasOn.addEventListener('click', () => {
                AppState.mostrarEtiquetas = true;
                UI.btnEtiquetasOn.classList.add('active');
                UI.btnEtiquetasOff.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas visibles en el mapa', 'info');
            });

            UI.btnEtiquetasOff.addEventListener('click', () => {
                AppState.mostrarEtiquetas = false;
                UI.btnEtiquetasOff.classList.add('active');
                UI.btnEtiquetasOn.classList.remove('active');
                actualizarClaseZoom();
                mostrarToast('Etiquetas ocultadas', 'info');
            });
        }



        // 6. Búsqueda en tabla (con debounce de 100ms para móviles)
        if (UI.searchInput) {
            let searchTimeout = null;
            UI.searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    AppState.filtroTabla = e.target.value.trim();
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                }, 100);
            });
        }

        // 7. Ordenamiento de tabla
        if (UI.headersTabla) {
            UI.headersTabla.forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (!col) return;
                    if (AppState.ordenTabla.columna === col) {
                        AppState.ordenTabla.asc = !AppState.ordenTabla.asc;
                    } else {
                        AppState.ordenTabla.columna = col;
                        AppState.ordenTabla.asc = false;
                    }
                    const encuestas = obtenerEncuestasFiltradas();
                    actualizarTabla(encuestas);
                });
            });
        }

        // 8. Botón GPS Localizar
        if (UI.locateBtn) {
            UI.locateBtn.addEventListener('click', localizarSupervisor);
        }

        // 10. Sincronizar con Kobo (Ultra-rápido en vivo con bypass de caché)
        if (UI.botonSync) {
            UI.botonSync.addEventListener('click', async () => {
                const icono = UI.botonSync.querySelector('svg, i');
                if (icono) icono.classList.add('anim-girar');
                mostrarToast('Sincronizando con KoboToolbox…', 'info');
                try {
                    const actualizado = await cargarDatos(false, true);
                    mostrarToast(
                        actualizado ? 'Datos sincronizados en vivo ✓' : 'No se completó la actualización. Se reintentará automáticamente.',
                        actualizado ? 'success' : 'info'
                    );
                } catch (e) {
                    mostrarToast('No se pudo completar la actualización.', 'error');
                } finally {
                    if (icono) icono.classList.remove('anim-girar');
                }
            });
        }

        // 11. Modo Oscuro
        if (UI.botonModoOscuro) {
            UI.botonModoOscuro.addEventListener('click', () => {
                document.body.classList.toggle('modo-oscuro');
                const isDark = document.body.classList.contains('modo-oscuro');
                localStorage.setItem('modo_oscuro', isDark ? 'true' : 'false');
            });
        }

        // 12. Drawer cerrar
        if (UI.drawerClose) UI.drawerClose.addEventListener('click', cerrarDrawer);
        if (UI.drawerOverlay) UI.drawerOverlay.addEventListener('click', cerrarDrawer);

        // 13. Reintentar
        if (UI.botonReintentar) {
            UI.botonReintentar.addEventListener('click', () => cargarDatos(true, true));
        }

        // 14. Toggle Pirámide Poblacional
        if (UI.togglePiramide && UI.panelPiramide) {
            UI.togglePiramide.addEventListener('click', () => {
                const isCollapsed = UI.panelPiramide.classList.toggle('collapsed');
                UI.togglePiramide.setAttribute('aria-expanded', String(!isCollapsed));
            });
            UI.togglePiramide.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    UI.togglePiramide.click();
                }
            });
        }
    }

    function iniciarReloj() {
        const actualizar = () => {
            const ahora = new Date();
            if (UI.hora) {
                UI.hora.textContent = ahora.toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil' });
            }
            if (UI.fecha) {
                UI.fecha.textContent = ahora.toLocaleDateString('es-EC', { 
                    timeZone: 'America/Guayaquil',
                    weekday: 'short', 
                    day: 'numeric', 
                    month: 'short' 
                });
            }
        };
        actualizar();
        setInterval(actualizar, 1000);
    }

    function configurarModoOscuro() {
        if (localStorage.getItem('modo_oscuro') === 'true') {
            document.body.classList.add('modo-oscuro');
        }
    }

    function mostrarToast(mensaje, tipo = 'info') {
        if (!UI.toast) return;
        UI.toast.textContent = mensaje;
        UI.toast.className = `cs-toast show ${tipo}`;
        setTimeout(() => {
            UI.toast.classList.remove('show');
        }, 3000);
    }

    function mostrarError(mensaje) {
        if (UI.errorBanner) {
            UI.errorBanner.style.display = 'flex';
        }
    }

    function ocultarError() {
        if (UI.errorBanner) {
            UI.errorBanner.style.display = 'none';
        }
    }

    window.filtrarPorParroquia = seleccionarParroquia;

    // Iniciar aplicación
    inicializar();
});
