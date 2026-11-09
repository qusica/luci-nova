'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const theme = path.join(root, 'luci-theme-nova');
const sourceHeader = path.join(theme, 'ucode/template/themes/nova/header.ut');
const header = fs.readFileSync(fs.existsSync(sourceHeader) ? sourceHeader :
    path.join(theme, 'root/usr/share/ucode/luci/template/themes/nova/header.ut'), 'utf8');

test('theme brand uses native LuCI home without requesting the optional app', () => {
    const brand = header.match(/<a\s+class="brand"\s+href="\{\{\s*(.*?)\s*\}\}">/);
    assert.ok(brand, 'actual theme template contains a native brand link');
    const routes = [];
    const url = vm.runInNewContext(brand[1], {
        dispatcher: { build_url: route => { routes.push(route); return '/custom-luci/' + route; } }
    });
    assert.deepEqual(routes, ['admin'], 'let LuCI resolve the first accessible page and enforce its ACLs');
    assert.equal(url, '/custom-luci/admin', 'preserve the router LuCI mount prefix');
    assert.doesNotMatch(header, /build_url\(["']admin\/nova["']\)/);
});

test('theme templates load only theme or core LuCI resources', () => {
    for (const name of ['header', 'footer', 'sysauth']) {
        const source = path.join(theme, 'ucode/template/themes/nova', name + '.ut');
        const content = fs.readFileSync(fs.existsSync(source) ? source :
            path.join(theme, 'root/usr/share/ucode/luci/template/themes/nova', name + '.ut'), 'utf8');
        assert.doesNotMatch(content, /resources\/(?:view\/)?nova\/dashboard|nova\/dashboard\.(?:js|css)|luci-app-nova-dashboard/);
    }
});

test('theme registration neither changes the landing page nor installs the dashboard', () => {
    const registration = fs.readFileSync(path.join(theme, 'root/etc/uci-defaults/30_luci-theme-nova'), 'utf8');
    assert.match(registration, /uci set luci\.themes\.Nova='\/luci-static\/nova'/);
    assert.doesNotMatch(registration, /luci\.main\.|(?:apk|opkg)\s|dashboard|admin\/nova/);
});
