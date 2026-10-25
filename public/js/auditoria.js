/**
 * =========================================================================
 * CLIMA SOCIAL · MOTOR DE AUDITORÍA Y CONTROL DE CALIDAD DE CAMPO
 * =========================================================================
 * Reglas de calidad:
 * - Duración atípica: entrevista menor a 2 minutos (< 2.0 min)
 * - Consentimiento: exclusión de encuestas no consentidas
 * =========================================================================
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CS_Auditoria = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const UMBRAL_DURACION_ATIPICA_MINUTOS = 2.0;

    function esDuracionAtipica(duracionMinutos) {
        if (duracionMinutos === null || duracionMinutos === undefined || isNaN(duracionMinutos)) return false;
        return Number(duracionMinutos) < UMBRAL_DURACION_ATIPICA_MINUTOS;
    }

    function auditarEncuesta(duracionMin, consentimiento) {
        const alertas = [];
        let esAtipica = false;
        let sinConsentimiento = false;

        if (consentimiento === 'NO') {
            sinConsentimiento = true;
            alertas.push('Sin consentimiento informado');
        }

        if (esDuracionAtipica(duracionMin)) {
            esAtipica = true;
            alertas.push(`Duración atípica (< ${UMBRAL_DURACION_ATIPICA_MINUTOS} min: ${duracionMin}m)`);
        }

        return {
            esAtipica,
            sinConsentimiento,
            alertas,
            esValidaParaAvance: !sinConsentimiento
        };
    }

    return {
        UMBRAL_DURACION_ATIPICA_MINUTOS,
        esDuracionAtipica,
        auditarEncuesta
    };
});
