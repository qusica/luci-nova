'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packages = ['luci-theme-nova', 'luci-app-nova-dashboard'];
function version(makefile) {
    const match = makefile.match(/^PKG_VERSION:=(\S+)$/m);
    assert.ok(match, 'package must define an explicit asset version');
    return match[1];
}
const versions = packages.map(name => version(fs.readFileSync(path.join(root, name, 'Makefile'), 'utf8')));

test('theme, dashboard package and dashboard CSS cache key share one version', () => {
    assert.equal(versions[0], versions[1]);
    const source = fs.readFileSync(path.join(root, packages[1], 'htdocs/luci-static/resources/view/nova/dashboard.js'), 'utf8');
    const assetVersion = source.match(/var dashboardAssetVersion = '([^']+)';/);
    assert.ok(assetVersion, 'dashboard stylesheet requires a versioned cache key');
    assert.equal(assetVersion[1], versions[1]);
});

// LuCI appends PKG_VERSION, not PKG_RELEASE, to template CSS/JS URLs.
// The PR/push workflow supplies its base so an r-only asset update fails CI.
const base = process.env.NOVA_ASSET_BASE;
test('changed browser assets bump PKG_VERSION rather than only PKG_RELEASE', {
    skip: !base || /^0+$/.test(base) ? 'no comparison base supplied' : false
}, () => {
    for (let index = 0; index < packages.length; index++) {
        const name = packages[index];
        const changed = execFileSync('git', ['diff', '--name-only', base, '--', name + '/htdocs', name + '/ucode'], { cwd: root, encoding: 'utf8' }).trim();
        if (!changed) continue;
        const oldMakefile = execFileSync('git', ['show', base + ':' + name + '/Makefile'], { cwd: root, encoding: 'utf8' });
        assert.notEqual(versions[index], version(oldMakefile), name + ' browser assets changed without a new PKG_VERSION/cache key');
    }
});

// SDK csstidy was observed replacing small-label foreground declarations with
// an unrelated radio-meter background. Never re-enable it without fixing the
// optimizer and verifying the complete generated CSS.
test('package CSS preserves reviewed source rather than unsafe csstidy rewrites', () => {
    for (const name of packages)
        assert.match(fs.readFileSync(path.join(root, name, 'Makefile'), 'utf8'), /^LUCI_MINIFY_CSS:=0$/m);
});
