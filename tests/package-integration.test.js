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

test('theme brand uses native LuCI home with native ACL-aware routing', () => {
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

test('theme registration does not change selected theme, home or router configuration', () => {
    const registration = fs.readFileSync(path.join(theme, 'root/etc/uci-defaults/30_luci-theme-nova'), 'utf8');
    assert.match(registration, /uci set luci\.themes\.Nova='\/luci-static\/nova'/);
    assert.doesNotMatch(registration, /luci\.main\.|(?:apk|opkg)\s|dashboard|admin\/nova/);
});

const makefilePath = path.join(theme, 'Makefile');
const sourceTree = fs.existsSync(makefilePath);

test('one package contains every dashboard resource and preserves existing ACL identities', () => {
    for (const relative of [
        'htdocs/luci-static/resources/view/nova/dashboard.js',
        'htdocs/luci-static/resources/nova/dashboard.css',
        'root/usr/share/luci/menu.d/luci-app-nova-dashboard.json',
        'root/usr/share/rpcd/acl.d/luci-app-nova-dashboard.json'
    ]) assert.ok(fs.statSync(path.join(theme, relative)).size > 0, relative);
    const menu = JSON.parse(fs.readFileSync(path.join(theme, 'root/usr/share/luci/menu.d/luci-app-nova-dashboard.json')));
    const acl = JSON.parse(fs.readFileSync(path.join(theme, 'root/usr/share/rpcd/acl.d/luci-app-nova-dashboard.json')));
    assert.deepEqual(Object.keys(menu).sort(), ['admin/nova', 'admin/status/nova']);
    assert.ok(acl['luci-app-nova-dashboard']);
    for (const item of Object.values(menu)) assert.deepEqual(item.depends.acl, ['luci-app-nova-dashboard']);
    assert.equal(acl['luci-app-nova-dashboard'].write, undefined);
    // Native overview and configuration are neither replaced nor shadowed.
    assert.equal(fs.existsSync(path.join(theme, 'htdocs/luci-static/resources/view/status')), false);
    assert.equal(fs.existsSync(path.join(theme, 'root/etc/config')), false);
});

test('integrated source blocks legacy ownership without forced replacement or package-manager hooks', { skip: !sourceTree }, () => {
    const makefile = fs.readFileSync(makefilePath, 'utf8');
    assert.match(makefile, /^override CONFLICTS:=luci-app-nova-dashboard$/m);
    assert.doesNotMatch(makefile, /(?:PROVIDES|REPLACES):=|(?:apk|opkg)\s+(?:del|remove|add|install)/);
    assert.equal(fs.existsSync(path.join(root, 'luci-app-nova-dashboard/Makefile')), false);
    assert.match(makefile, /^LUCI_DEPENDS:=\+luci-base \+luci-theme-bootstrap$/m);
});

test('uninstall selects Bootstrap only when removing the active Nova theme, not on upgrade', () => {
    const { spawnSync } = require('node:child_process');
    const os = require('node:os');
    const hook = sourceTree ? fs.readFileSync(makefilePath, 'utf8')
        .match(/define Package\/luci-theme-nova\/postrm\n([\s\S]*?)\nendef/)[1].replace(/\$\$/g, '$') :
        fs.readFileSync(path.join(root, 'control/luci-theme-nova/postrm'), 'utf8');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-postrm-'));
    try {
        const template = path.join(temporary, 'header.ut');
        const script = hook.replace('/usr/share/ucode/luci/template/themes/nova/header.ut', template);
        const uci = path.join(temporary, 'uci');
        fs.writeFileSync(uci, '#!/bin/sh\nif [ "$1 $2 $3" = "-q get luci.main.mediaurlbase" ]; then printf "%s\\n" "$TEST_THEME"; else printf "%s\\n" "$*" >> "$TEST_LOG"; fi\n', {mode: 0o755});
        for (const scenario of [
            {name: 'remove active Nova', current: '/luci-static/nova', installed: false, offline: '', reset: true, cleanup: true},
            {name: 'remove inactive Nova', current: '/luci-static/bootstrap', installed: false, offline: '', reset: false, cleanup: true},
            {name: 'retain another selected theme', current: '/luci-static/other', installed: false, offline: '', reset: false, cleanup: true},
            {name: 'upgrade retains current theme', current: '/luci-static/nova', installed: true, offline: '', reset: false, cleanup: false},
            {name: 'offline image never edits host UCI', current: '/luci-static/nova', installed: false, offline: '/image', reset: false, cleanup: false}
        ]) {
            if (scenario.installed) fs.writeFileSync(template, 'replacement template');
            else fs.rmSync(template, {force: true});
            const log = path.join(temporary, 'calls');
            fs.writeFileSync(log, '');
            const result = spawnSync('sh', ['-c', script], {encoding: 'utf8', env: {...process.env,
                PATH: temporary + ':' + process.env.PATH, TEST_THEME: scenario.current,
                TEST_LOG: log, IPKG_INSTROOT: scenario.offline}});
            assert.equal(result.status, 0, result.stderr);
            const calls = fs.readFileSync(log, 'utf8');
            assert.equal(calls.includes('set luci.main.mediaurlbase=/luci-static/bootstrap'), scenario.reset, scenario.name);
            assert.equal(calls.includes('-q delete luci.themes.Nova'), scenario.cleanup, scenario.name);
            assert.equal(calls.includes('commit luci'), scenario.cleanup, scenario.name);
        }
    } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('package conflict survives SDK defaults and APK receives a negative dependency', { skip: !sourceTree }, () => {
    const { spawnSync } = require('node:child_process');
    const makefile = fs.readFileSync(makefilePath, 'utf8');
    // Exercise the package's real declarations under make, including the
    // Package/Default reset performed before luci.mk's Package is evaluated.
    const declarations = makefile.slice(makefile.indexOf('LUCI_TITLE:='), makefile.indexOf('define Package/'));
    for (const [useApk, dump] of [['', ''], ['y', ''], ['', '1'], ['y', '1']]) {
        const fixture = 'CONFIG_USE_APK:=' + useApk + '\nDUMP:=' + dump + '\n' + declarations + '\n' +
            'define Package/Default\nCONFLICTS:=\nendef\n$(eval $(Package/Default))\n' +
            'all:\n\t@echo "CONFLICTS=$(CONFLICTS)"\n\t@echo "DEPENDS=$(LUCI_DEPENDS)"\n';
        const result = spawnSync('make', ['--no-print-directory', '-f', '-'], {input: fixture, encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^CONFLICTS=luci-app-nova-dashboard$/m);
        assert.equal(result.stdout.includes('!luci-app-nova-dashboard'), useApk === 'y' && !dump);
        assert.doesNotMatch(result.stdout, /(?:PROVIDES|REPLACES)=/);
    }
});
