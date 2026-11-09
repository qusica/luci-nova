'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const app = path.resolve(__dirname, '..', 'luci-app-nova-dashboard');
const catalogPath = path.join(app, 'root/usr/lib/lua/luci/i18n/nova-dashboard.zh-cn.lmo');
const poPath = path.join(app, 'translations/zh_Hans/nova-dashboard.po');
const sourceTree = fs.existsSync(path.join(app, 'Makefile'));
const sourceTitle = 'Nova Dashboard';
const translatedTitle = 'Nova 仪表盘';
// LuCI's canonical SuperFastHash for this exact menu source key. Verify the
// compiled index, not merely the presence of Chinese text somewhere in the APK.
const titleHash = 0x03a6d77e;

function checkCatalog(file) {
    const data = fs.readFileSync(file);
    assert.ok(data.length >= 4, 'catalog has an LMO footer');
    const index = data.readUInt32BE(data.length - 4);
    assert.ok(index <= data.length - 4, 'catalog index is inside the file');
    assert.equal((data.length - 4 - index) % 16, 0, 'LMO entries are complete');
    const messages = new Map();
    let previous = -1;
    for (let entry = index; entry < data.length - 4; entry += 16) {
        const key = data.readUInt32BE(entry);
        const offset = data.readUInt32BE(entry + 8);
        const length = data.readUInt32BE(entry + 12);
        assert.ok(key > previous, 'native lookup needs a sorted, unique index');
        assert.ok(offset + length <= index, 'translation bytes precede the index');
        messages.set(key, data.toString('utf8', offset, offset + length));
        previous = key;
    }
    assert.deepEqual([...messages.keys()], [0, titleHash], 'only plural metadata and Nova-owned keys are bundled');
    assert.equal(messages.get(0), 'nplurals=1; plural=0;');
    assert.equal(messages.get(titleHash), translatedTitle);
}

test('both Nova menu routes use a native source title rather than hardcoded Chinese', () => {
    const menu = JSON.parse(fs.readFileSync(path.join(app, 'root/usr/share/luci/menu.d/luci-app-nova-dashboard.json'), 'utf8'));
    assert.deepEqual(Object.keys(menu).sort(), ['admin/nova', 'admin/status/nova']);
    for (const entry of Object.values(menu)) {
        assert.equal(entry.title, sourceTitle, 'English and untranslated locales retain the source title');
        assert.equal(entry.action.path, 'nova/dashboard');
    }
});

test('Nova catalog source cannot override generic or plugin menu translations', { skip: !sourceTree }, () => {
    const po = fs.readFileSync(poPath, 'utf8');
    const keys = [...po.matchAll(/^msgid "(.+)"$/gm)].map(match => match[1]);
    assert.deepEqual(keys, [sourceTitle]);
    assert.match(po, /msgstr "Nova 仪表盘"/);
    const makefile = fs.readFileSync(path.join(app, 'Makefile'), 'utf8');
    assert.match(makefile, /Hooks\/Compile\/Post \+= Build\/NovaTranslations/);
    assert.match(makefile, /nova-dashboard\.zh-cn\.lmo/);
    assert.equal(fs.existsSync(path.join(app, 'po')), false, 'do not silently move translations into an unshipped third APK');
});

test('the bundled native Chinese catalog resolves the exact Nova menu key', t => {
    if (!sourceTree) {
        assert.ok(fs.existsSync(catalogPath), 'dashboard APK must include the catalog');
        checkCatalog(catalogPath);
        return;
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-menu-i18n-'));
    try {
        const compiled = path.join(temporary, 'nova-dashboard.zh-cn.lmo');
        const result = spawnSync(process.env.PO2LMO || 'po2lmo', [poPath, compiled], { encoding: 'utf8' });
        if (result.error && result.error.code === 'ENOENT' && !process.env.PO2LMO) {
            t.skip('SDK po2lmo is unavailable; the built-APK regression requires the actual catalog');
            return;
        }
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        checkCatalog(compiled);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
