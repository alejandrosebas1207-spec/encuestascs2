const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    extraerValor,
    normalizarCoordenadas,
    extraerSexo,
    extraerEdad,
    extraerSexoYEdad,
    extraerDuracionMinutos,
    extraerConsentimiento
} = require(path.join(__dirname, '../public/js/kobo-parser.js'));

test('prioridad estricta P1 sobre P9 para sexo/género', () => {
    // Si P1 tiene '1' (Hombre) y P9 tiene '2' (Mujer), P1 DEBE ganar
    const surveyConAmbos = {
        p1: '1',
        p9: '2'
    };
    assert.equal(extraerSexo(surveyConAmbos), 'Hombre');

    // Variaciones de nombres de campo P1
    assert.equal(extraerSexo({ '1. ¿CUÁL ES SU GÉNERO?': 'Masculino' }), 'Hombre');
    assert.equal(extraerSexo({ p1_genero: '1' }), 'Hombre');
    assert.equal(extraerSexo({ genero_resp: '2' }), 'Mujer');
    assert.equal(extraerSexo({ 'group/p1': '2' }), 'Mujer');

    // Fallback a P9 solo si P1 no existe
    assert.equal(extraerSexo({ p9: '2' }), 'Mujer');
    assert.equal(extraerSexo({ p9: '1' }), 'Hombre');
});

test('prioridad estricta P2 sobre P10 para edad y rango 16..115', () => {
    // Si P2 tiene 25 y P10 tiene 5 (p10 suele ser calificación de servicio o problema), P2 DEBE ganar
    const survey = {
        p2: '25',
        p10: '5'
    };
    assert.equal(extraerEdad(survey), 25);

    // Variaciones de P2
    assert.equal(extraerEdad({ '2. ¿CUÁL ES SU EDAD? (edad cumplida en años)': '38' }), 38);
    assert.equal(extraerEdad({ p2_edad: '62' }), 62);
    assert.equal(extraerEdad({ 'seccion/p2': '16' }), 16);

    // Descartar edades menores de 16 años (no votantes)
    assert.equal(extraerEdad({ p2: '15' }), null);
    assert.equal(extraerEdad({ p2: '12' }), null);
    assert.equal(extraerEdad({ p2: '0' }), null);
    assert.equal(extraerEdad({ p2: '-4' }), null);

    // Descartar edades mayores de 115
    assert.equal(extraerEdad({ p2: '116' }), null);
    assert.equal(extraerEdad({ p2: '999' }), null);

    // Descartar textos no numéricos
    assert.equal(extraerEdad({ p2: 'no sabe' }), null);
});

test('extraerSexoYEdad compuesto', () => {
    const res = extraerSexoYEdad({
        p1: '2',
        p2: '45'
    });
    assert.deepEqual(res, { sexo: 'Mujer', edad: 45 });
});

test('normalización de coordenadas y corrección de inversión', () => {
    // Coordenadas válidas en Ecuador
    const coords = normalizarCoordenadas([-0.18, -78.48]);
    assert.deepEqual(coords, [-0.18, -78.48]);

    // Invertidas (Latitud -78, Longitud -0.18)
    const invertidas = normalizarCoordenadas([-78.48, -0.18]);
    assert.deepEqual(invertidas, [-0.18, -78.48]);

    // Inválidas
    assert.equal(normalizarCoordenadas(['invalido', -78.48]), null);
    assert.equal(normalizarCoordenadas([95, -78.48]), null); // lat > 90
    assert.equal(normalizarCoordenadas([-0.18, 200]), null); // lng > 180
    assert.equal(normalizarCoordenadas([]), null);
    assert.equal(normalizarCoordenadas(null), null);
});

test('cálculo de duración en minutos', () => {
    const ini = '2026-10-15T10:00:00.000Z';
    const fin = '2026-10-15T10:12:30.000Z';
    assert.equal(extraerDuracionMinutos(ini, fin), 12.5);

    // Duración negativa o nula
    assert.equal(extraerDuracionMinutos(fin, ini), null);
    assert.equal(extraerDuracionMinutos(null, fin), null);
});

test('extracción de consentimiento informado', () => {
    assert.equal(extraerConsentimiento({ consent: '1' }), 'SI');
    assert.equal(extraerConsentimiento({ consent: 'si' }), 'SI');
    assert.equal(extraerConsentimiento({}), 'SI'); // Default si no se pregunta
    assert.equal(extraerConsentimiento({ consent: '2' }), 'NO');
    assert.equal(extraerConsentimiento({ consentimiento: 'no' }), 'NO');
    assert.equal(extraerConsentimiento({ acepta: 'rechaza' }), 'NO');
});
