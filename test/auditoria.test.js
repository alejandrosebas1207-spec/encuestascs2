const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    UMBRAL_DURACION_ATIPICA_MINUTOS,
    esDuracionAtipica,
    auditarEncuesta
} = require(path.join(__dirname, '../public/js/auditoria.js'));

test('umbral de duración atípica es exactamente 2 minutos', () => {
    assert.equal(UMBRAL_DURACION_ATIPICA_MINUTOS, 2.0);
    assert.equal(esDuracionAtipica(1.9), true, 'Menor a 2 min debe ser atípica');
    assert.equal(esDuracionAtipica(0.5), true, 'Menor a 2 min debe ser atípica');
    assert.equal(esDuracionAtipica(2.0), false, 'Exactamente 2 min NO es atípica');
    assert.equal(esDuracionAtipica(15.2), false, '15 min es duración normal');
    assert.equal(esDuracionAtipica(null), false);
    assert.equal(esDuracionAtipica(undefined), false);
});

test('auditarEncuesta genera alertas adecuadas para atípica y sin consentimiento', () => {
    // Caso normal
    const normal = auditarEncuesta(12.0, 'SI');
    assert.equal(normal.esAtipica, false);
    assert.equal(normal.sinConsentimiento, false);
    assert.equal(normal.esValidaParaAvance, true);
    assert.equal(normal.alertas.length, 0);

    // Caso atípico (muy rápida: < 2 min)
    const rapida = auditarEncuesta(1.5, 'SI');
    assert.equal(rapida.esAtipica, true);
    assert.equal(rapida.sinConsentimiento, false);
    assert.ok(rapida.alertas.some(a => a.includes('Duración atípica')));

    // Caso sin consentimiento
    const rechazo = auditarEncuesta(1.0, 'NO');
    assert.equal(rechazo.sinConsentimiento, true);
    assert.equal(rechazo.esValidaParaAvance, false);
    assert.ok(rechazo.alertas.some(a => a.includes('consentimiento')));
});
