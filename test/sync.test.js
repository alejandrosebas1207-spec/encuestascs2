const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
function setup(fetch) {
    const timers = new Map();
    let id = 0;
    const context = vm.createContext({
        fetch, AbortController, Date, console: { error() {}, warn() {} },
        setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        document: { hidden: false },
        AppState: { encuestas: [{ encuestador: '1' }], config: {} },
        UI: { badgeTexto: {}, ultimaActualizacion: {} },
        localStorage: { setItem() {} },
        ocultarError() {}, mostrarError() {}, auditarEncuestas() {},
        poblarFiltros() {}, renderizarVista() {},
        normalizarSupervisorEncuesta: x => x, campo: () => ''
    });
    vm.runInContext(source.slice(source.indexOf('    let reintentoDatos'), source.indexOf('    // =========================================================================\n    // FILTROS CRUZADOS')), context);
    return { context, timers, run: () => context.cargarDatos() };
}
test('HTTP failure preserves data and retry restores live status', async () => {
    let ok = false;
    const { context, timers, run } = setup(async () => ({ ok, status: 502, json: async () => ({ resultados: [{ encuestador: '1' }] }) }));
    assert.equal(await run(), false);
    assert.equal(context.AppState.encuestas.length, 1);
    assert.equal(context.UI.badgeTexto.textContent, 'Actualización pendiente');
    const retry = [...timers.values()].find(t => t.delay === 30000);
    assert.ok(retry);
    ok = true;
    assert.equal(await run(), true);
    assert.equal(context.UI.badgeTexto.textContent, 'En vivo');
    assert.equal(timers.size, 0);
});
test('stalled requests abort and release the loading lock', async () => {
    const { context, timers, run } = setup((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))));
    const pending = run();
    assert.equal(await run(), false);
    [...timers.values()].find(t => t.delay === 120000).fn();
    assert.equal(await pending, false);
    assert.equal(context.AppState.cargandoDatos, false);
    assert.ok([...timers.values()].some(t => t.delay === 30000));
});
