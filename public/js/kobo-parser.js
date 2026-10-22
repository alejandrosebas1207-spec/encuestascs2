/**
 * =========================================================================
 * CLIMA SOCIAL · EXTRACTOR Y NORMALIZADOR DE DATOS KOBO
 * =========================================================================
 * Funciones puras para extraer género, edad, coordenadas, duración
 * y consentimiento desde las respuestas de KoboToolbox.
 * 
 * Reglas clave:
 * - Prioridad estricta P1 (género) sobre P9
 * - Prioridad estricta P2 (edad) sobre P10
 * - Validación estricta de edad: 16 <= edad <= 115
 * - Corrección automática de coordenadas invertidas
 * =========================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CS_KoboParser = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function extraerValor(obj, claves) {
        if (!obj || typeof obj !== 'object') return '';
        const valorTexto = v => (v === undefined || v === null || typeof v === 'object') ? '' : String(v).trim();
        const keys = Object.keys(obj);
        for (let j = 0; j < claves.length; j++) {
            const k = claves[j];
            if (!k) continue;
            const directo = valorTexto(obj[k]);
            if (directo) return directo;
            const kLower = k.toLowerCase();
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (key.toLowerCase().endsWith('/' + kLower) || key.toLowerCase() === kLower) {
                    const valor = valorTexto(obj[key]);
                    if (valor) return valor;
                }
            }
        }
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                const nested = extraerValor(obj[key], claves);
                if (nested) return nested;
            }
        }
        return '';
    }

    function normalizarCoordenadas(valores, validarEcuador = false) {
        if (!Array.isArray(valores) || valores.length < 2) return null;
        const par = valores.slice(0, 2);
        if (par.some(v => (typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '')) return null;
        let [lat, lng] = par.map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        // Invertir si viene invertido (Longitud cerca de 0 y Latitud cerca de -78)
        if (lat < -50 && lng > -10 && lng < 10) {
            const tmp = lat; lat = lng; lng = tmp;
        }
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        if (validarEcuador && !(lat >= -5.5 && lat <= 2.5 && lng >= -92.5 && lng <= -75.0)) return null;
        return [lat, lng];
    }

    function extraerSexo(encuesta) {
        if (!encuesta) return null;
        // 1. Priorizar P1 (1. ¿Cuál es su género?) sobre P9
        const rawGen = (
            encuesta.p1 !== undefined ? encuesta.p1 :
            encuesta.genero !== undefined ? encuesta.genero :
            encuesta.sexo !== undefined ? encuesta.sexo :
            extraerValor(encuesta, [
                'p1', 'p1_genero', 'p1_1', 'genero_resp',
                '1. ¿CUÁL ES SU GÉNERO?', '1._CU_L_ES_SU_G_NERO',
                'genero', 'sexo', 'gender', 'p_genero',
                'p9', '_9_G_NERO', '9. GÉNERO', 'p9_1'
            ])
        );

        const genStr = String(rawGen || '').toLowerCase().trim();
        if (genStr.includes('masc') || genStr.includes('hombre') || genStr === '1' || genStr === 'h') {
            return 'Hombre';
        }
        if (genStr.includes('fem') || genStr.includes('mujer') || genStr === '2' || genStr === 'm') {
            return 'Mujer';
        }
        return null;
    }

    function extraerEdad(encuesta) {
        if (!encuesta) return null;
        // 1. Priorizar P2 (2. ¿Cuántos años tiene?) sobre P10
        const rawEdad = (
            encuesta.p2 !== undefined ? encuesta.p2 :
            encuesta.edad !== undefined ? encuesta.edad :
            extraerValor(encuesta, [
                'p2', 'p2_edad', 'p_edad',
                '2. ¿CUÁL ES SU EDAD? (edad cumplida en años)',
                '2._CU_L_ES_SU_EDAD_edad_cumplida_en_a_os',
                '2. ¿CUÁNTOS AÑOS TIENE?',
                'edad', 'age',
                'p10', '10. ¿CUÁNTOS AÑOS TIENE? (Anota la edad en años cumplidos)'
            ])
        );

        const num = Number(rawEdad);
        if (!isNaN(num) && num >= 16 && num <= 115) {
            return num;
        }
        return null;
    }

    function extraerSexoYEdad(encuesta) {
        return {
            sexo: extraerSexo(encuesta),
            edad: extraerEdad(encuesta)
        };
    }

    function extraerDuracionMinutos(start, end) {
        if (!start || !end) return null;
        const dIni = new Date(start);
        const dFin = new Date(end);
        if (isNaN(dIni.getTime()) || isNaN(dFin.getTime())) return null;
        const difMs = dFin - dIni;
        if (difMs <= 0) return null;
        return Number((difMs / 60000).toFixed(1));
    }

    function extraerConsentimiento(encuesta) {
        if (!encuesta) return 'SI';
        const rawConsen = extraerValor(encuesta, ['consent', 'consen', 'consentimiento', 'acepta']);
        if (!rawConsen) return 'SI';
        const s = String(rawConsen).trim().toLowerCase();
        if (s === '2' || s === 'no' || s === 'rechaza' || s.includes('no continua') || s.includes('rechaza')) {
            return 'NO';
        }
        return 'SI';
    }

    return {
        extraerValor,
        normalizarCoordenadas,
        extraerSexo,
        extraerEdad,
        extraerSexoYEdad,
        extraerDuracionMinutos,
        extraerConsentimiento
    };
});
