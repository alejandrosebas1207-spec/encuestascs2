/**
 * =========================================================================
 * CLIMA SOCIAL · MOTOR DE TIPOLOGÍAS Y CUOTAS OFICIALES
 * =========================================================================
 * Define las 8 tipologías muestrales (A..H) y sus cuotas exactas de 10
 * encuestas por sector (5 Hombres / 5 Mujeres), así como las 5 cohortes
 * poblacionales de edad (iniciando estrictamente en 16 años).
 * 
 * Compatible con Node.js (CommonJS) y Navegadores móviles (window.CS_Tipologias).
 * =========================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CS_Tipologias = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const COHORTES_PIRAMIDE = [
        { id: '61+', label: '61 y más', min: 61, max: 125 },
        { id: '45-60', label: '45-60', min: 45, max: 60 },
        { id: '30-44', label: '30-44', min: 30, max: 44 },
        { id: '20-29', label: '20-29', min: 20, max: 29 },
        { id: '16-19', label: '16-19', min: 16, max: 19 }
    ];

    // Matriz Oficial de Cuotas Muestrales Clima Social (Aprobada según Formato Tipologías.pdf)
    // Invariante matemático estricto: cada tipología suma 10 (5H y 5M)
    const CUOTAS_TIPOLOGIA = {
        'A': { '16-19': { H: 0, M: 2 }, '20-29': { H: 1, M: 1 }, '30-44': { H: 2, M: 1 }, '45-60': { H: 1, M: 1 }, '61+': { H: 1, M: 0 } },
        'B': { '16-19': { H: 0, M: 2 }, '20-29': { H: 2, M: 0 }, '30-44': { H: 3, M: 0 }, '45-60': { H: 0, M: 2 }, '61+': { H: 0, M: 1 } },
        'C': { '16-19': { H: 2, M: 0 }, '20-29': { H: 1, M: 1 }, '30-44': { H: 1, M: 2 }, '45-60': { H: 1, M: 1 }, '61+': { H: 0, M: 1 } },
        'D': { '16-19': { H: 2, M: 0 }, '20-29': { H: 0, M: 2 }, '30-44': { H: 0, M: 3 }, '45-60': { H: 2, M: 0 }, '61+': { H: 1, M: 0 } },
        'E': { '16-19': { H: 0, M: 1 }, '20-29': { H: 1, M: 1 }, '30-44': { H: 2, M: 1 }, '45-60': { H: 0, M: 2 }, '61+': { H: 2, M: 0 } },
        'F': { '16-19': { H: 0, M: 1 }, '20-29': { H: 2, M: 0 }, '30-44': { H: 3, M: 0 }, '45-60': { H: 0, M: 2 }, '61+': { H: 0, M: 2 } },
        'G': { '16-19': { H: 1, M: 0 }, '20-29': { H: 0, M: 2 }, '30-44': { H: 0, M: 3 }, '45-60': { H: 2, M: 0 }, '61+': { H: 2, M: 0 } },
        'H': { '16-19': { H: 1, M: 0 }, '20-29': { H: 1, M: 1 }, '30-44': { H: 1, M: 2 }, '45-60': { H: 2, M: 0 }, '61+': { H: 0, M: 2 } }
    };

    function normalizarLetraTipologia(val, choices = {}) {
        if (!val) return '';
        const str = String(val).trim().toUpperCase();
        if (CUOTAS_TIPOLOGIA[str]) return str;
        if (/^[1-8]$/.test(str)) return String.fromCharCode(64 + Number(str));
        if (choices[val] && CUOTAS_TIPOLOGIA[choices[val]]) return choices[val];
        return '';
    }

    function obtenerCohorteEdad(edad) {
        if (edad === null || edad === undefined || isNaN(edad)) return null;
        const n = Number(edad);
        if (n < 16 || n > 125) return null;
        for (let i = 0; i < COHORTES_PIRAMIDE.length; i++) {
            const c = COHORTES_PIRAMIDE[i];
            if (n >= c.min && n <= c.max) return c;
        }
        return null;
    }

    function validarInvarianteCuotas(cuotas = CUOTAS_TIPOLOGIA) {
        const errores = [];
        const letras = Object.keys(cuotas);
        if (letras.length !== 8) {
            errores.push(`Se esperaban 8 tipologías (A..H), hay ${letras.length}`);
        }
        letras.forEach(tipo => {
            const coh = cuotas[tipo];
            let totH = 0;
            let totM = 0;
            COHORTES_PIRAMIDE.forEach(c => {
                const cell = coh[c.id];
                if (!cell) {
                    errores.push(`Tipología ${tipo} carece de la cohorte ${c.id}`);
                    return;
                }
                totH += cell.H;
                totM += cell.M;
            });
            const tot = totH + totM;
            if (tot !== 10) errores.push(`Tipología ${tipo} suma ${tot} encuestas (debe sumar exactamente 10)`);
            if (totH !== 5) errores.push(`Tipología ${tipo} tiene ${totH} hombres (debe ser exactamente 5)`);
            if (totM !== 5) errores.push(`Tipología ${tipo} tiene ${totM} mujeres (debe ser exactamente 5)`);
        });
        return { valido: errores.length === 0, errores };
    }

    return {
        COHORTES_PIRAMIDE,
        CUOTAS_TIPOLOGIA,
        normalizarLetraTipologia,
        obtenerCohorteEdad,
        validarInvarianteCuotas
    };
});
