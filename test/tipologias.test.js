const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    COHORTES_PIRAMIDE,
    CUOTAS_TIPOLOGIA,
    normalizarLetraTipologia,
    obtenerCohorteEdad,
    validarInvarianteCuotas
} = require(path.join(__dirname, '../public/js/tipologias.js'));

test('invariante de tipologías: exactamente 8 tipologías (A..H) con 10 encuestas y 5H/5M', () => {
    const res = validarInvarianteCuotas();
    assert.equal(res.valido, true, `Invariante falló con errores: ${res.errores.join('; ')}`);
    assert.deepEqual(res.errores, []);
});

test('todas las tipologías A..H suman exactamente 10 encuestas y tienen 5 hombres y 5 mujeres', () => {
    const letras = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    assert.equal(Object.keys(CUOTAS_TIPOLOGIA).length, 8);

    letras.forEach(letra => {
        const cuota = CUOTAS_TIPOLOGIA[letra];
        assert.ok(cuota, `Falta la tipología ${letra}`);

        let totalH = 0;
        let totalM = 0;
        COHORTES_PIRAMIDE.forEach(c => {
            const celda = cuota[c.id];
            assert.ok(celda, `Falta la cohorte ${c.id} en tipología ${letra}`);
            assert.ok(celda.H >= 0, `H negativo en ${letra}-${c.id}`);
            assert.ok(celda.M >= 0, `M negativo en ${letra}-${c.id}`);
            totalH += celda.H;
            totalM += celda.M;
        });

        assert.equal(totalH, 5, `Tipología ${letra} debe tener 5 hombres (tiene ${totalH})`);
        assert.equal(totalM, 5, `Tipología ${letra} debe tener 5 mujeres (tiene ${totalM})`);
        assert.equal(totalH + totalM, 10, `Tipología ${letra} debe sumar 10 encuestas`);
    });
});

test('cohortes de edad inician estrictamente en 16 años según estándar oficial', () => {
    const minEdadGeneral = Math.min(...COHORTES_PIRAMIDE.map(c => c.min));
    assert.equal(minEdadGeneral, 16, 'La edad mínima para encuestas electorales/muestrales debe ser 16 años');

    const idsEsperados = ['61+', '45-60', '30-44', '20-29', '16-19'];
    assert.deepEqual(COHORTES_PIRAMIDE.map(c => c.id), idsEsperados);
});

test('clasificación de edad por cohorte (obtenerCohorteEdad)', () => {
    assert.equal(obtenerCohorteEdad(16)?.id, '16-19');
    assert.equal(obtenerCohorteEdad(19)?.id, '16-19');
    assert.equal(obtenerCohorteEdad(20)?.id, '20-29');
    assert.equal(obtenerCohorteEdad(29)?.id, '20-29');
    assert.equal(obtenerCohorteEdad(30)?.id, '30-44');
    assert.equal(obtenerCohorteEdad(44)?.id, '30-44');
    assert.equal(obtenerCohorteEdad(45)?.id, '45-60');
    assert.equal(obtenerCohorteEdad(60)?.id, '45-60');
    assert.equal(obtenerCohorteEdad(61)?.id, '61+');
    assert.equal(obtenerCohorteEdad(90)?.id, '61+');

    // Descartar edades inválidas
    assert.equal(obtenerCohorteEdad(15), null);
    assert.equal(obtenerCohorteEdad(0), null);
    assert.equal(obtenerCohorteEdad(-5), null);
    assert.equal(obtenerCohorteEdad(130), null);
    assert.equal(obtenerCohorteEdad(null), null);
    assert.equal(obtenerCohorteEdad(undefined), null);
    assert.equal(obtenerCohorteEdad('invalido'), null);
});

test('normalización de letra de tipología (letras, números 1-8 y choices)', () => {
    assert.equal(normalizarLetraTipologia('a'), 'A');
    assert.equal(normalizarLetraTipologia('A'), 'A');
    assert.equal(normalizarLetraTipologia('1'), 'A');
    assert.equal(normalizarLetraTipologia('2'), 'B');
    assert.equal(normalizarLetraTipologia('8'), 'H');
    assert.equal(normalizarLetraTipologia('9'), '');
    assert.equal(normalizarLetraTipologia('Z'), '');
    assert.equal(normalizarLetraTipologia('tipo_b', { 'tipo_b': 'B' }), 'B');
});
