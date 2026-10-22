const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('consistencia de versionado y cache entre config.json, service-worker.js e index.html', () => {
    const rootDir = path.resolve(__dirname, '..');
    const pkgPath = path.join(rootDir, 'package.json');
    const cfgPath = path.join(rootDir, 'public/config.json');
    const swPath = path.join(rootDir, 'public/service-worker.js');
    const htmlPath = path.join(rootDir, 'public/index.html');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const sw = fs.readFileSync(swPath, 'utf8');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // 1. Version de config.json debe existir
    assert.ok(cfg.version, 'config.json debe tener un campo version');

    // 2. Service Worker debe definir CACHE_NAME con la versión o prefijo institucional
    const cacheMatch = sw.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(cacheMatch, 'service-worker.js debe tener una constante CACHE_NAME');
    assert.ok(cacheMatch[1].startsWith('clima-social-'), 'CACHE_NAME debe empezar con prefijo clima-social-');

    // 3. index.html debe incluir los módulos JS del motor
    assert.ok(html.includes('js/tipologias.js'), 'index.html debe cargar js/tipologias.js');
    assert.ok(html.includes('js/kobo-parser.js'), 'index.html debe cargar js/kobo-parser.js');
    assert.ok(html.includes('js/auditoria.js'), 'index.html debe cargar js/auditoria.js');
});
