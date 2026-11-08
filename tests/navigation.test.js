'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova/nova-shell.js'), 'utf8');

// Run the complete shipped shell, including SDK-minified output, on small DOM
// doubles. Real rendering and input are covered by navigation-browser.test.js.
function harness(routes) {
    class Element {
        constructor(tag, attrs = {}) { this.tagName = tag; this.attrs = attrs; this.children = []; this.style = {}; this.classes = new Set(); }
        get textContent() { return this.label || ''; }
        get firstChild() { return this.children[0] || null; }
        getAttribute(key) { return this.attrs[key] ?? null; }
        setAttribute(key, value) { this.attrs[key] = String(value); }
        appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
        insertBefore(node, reference) { node.parentElement = this; const i = this.children.indexOf(reference); this.children.splice(i < 0 ? this.children.length : i, 0, node); }
        remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
        addEventListener() {}
        get classList() { return { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
        closest(selector) { return selector === 'a' && this.tagName === 'a' ? this : null; }
        querySelector(selector) {
            if (selector === ':scope > a') return this.children.find(child => child.tagName === 'a') || null;
            if (selector === ':scope > .nova-menu-icon') return this.children.find(child => child.attrs.class === 'nova-menu-icon') || null;
            return null;
        }
        querySelectorAll(selector) {
            if (selector === ':scope > li') return this.children;
            if (selector === 'a[href]') return this.children.flatMap(child => child.tagName === 'a' && child.attrs.href ? [child] : child.querySelectorAll(selector));
            return [];
        }
    }
    const menu = new Element('ul');
    for (const [title, hrefs] of routes) {
        const item = menu.appendChild(new Element('li'));
        const link = item.appendChild(new Element('a', { href: hrefs[0] }));
        link.label = title;
        if (hrefs.length > 1) {
            const ul = item.appendChild(new Element('ul'));
            hrefs.slice(1).forEach(href => ul.appendChild(new Element('a', { href })));
        }
    }
    let update;
    const document = { readyState: 'complete', baseURI: 'https://router.test/cgi-bin/luci/admin/nova',
        getElementById: id => id === 'topmenu' ? menu : null,
        createElementNS: (namespace, name) => { assert.equal(namespace, 'http://www.w3.org/2000/svg'); return new Element(name); },
        addEventListener() {} };
    class MutationObserver { constructor(callback) { update = callback; } observe() {} }
    vm.runInNewContext(source, { document, window: { MutationObserver }, MutationObserver, URL });
    return { menu, update, links: () => menu.children.map(item => item.children[0]) };
}

test('icons follow routes, not title, position or availability of other categories', () => {
    const h = harness([
        ['退出', ['/cgi-bin/luci/admin/logout']],
        ['Netzwerk', ['#', '/cgi-bin/luci/admin/network/network']],
        ['仪表盘', ['/cgi-bin/luci/admin/nova']],
        ['État', ['#', '/cgi-bin/luci/admin/status/overview']],
        ['System', ['#', '/cgi-bin/luci/admin/system/system']],
        ['Plugin', ['#', '/cgi-bin/luci/admin/services/thing']],
        ['VPN', ['/cgi-bin/luci/admin/vpn']],
        ['Stats', ['/cgi-bin/luci/admin/statistics']],
        ['Unknown', ['#', '/cgi-bin/luci/admin/custom/anything']]
    ]);
    assert.deepEqual(h.links().map(link => link.attrs['data-nova-icon']), ['logout','network','dashboard','status','system','services','vpn','statistics','folder']);
    h.menu.children.reverse(); h.update();
    assert.equal(h.links()[0].attrs['data-nova-icon'], 'folder');
    assert.equal(h.links()[8].attrs['data-nova-icon'], 'logout');
});

test('icons are single accessible-name-neutral SVGs and decoration is idempotent', () => {
    const h = harness([['状态', ['#', '/cgi-bin/luci/admin/status/overview']]]);
    const link = h.links()[0], icon = link.children[0];
    for (let i = 0; i < 5; i++) h.update();
    assert.equal(link.children.length, 1);
    assert.equal(link.children[0], icon);
    assert.equal(link.textContent, '状态');
    assert.equal(icon.tagName, 'svg');
    assert.equal(icon.attrs['aria-hidden'], 'true');
    assert.equal(icon.attrs.focusable, 'false');
    assert.equal(icon.attrs.viewBox, '0 0 24 24');
    assert.equal(icon.attrs.stroke, 'currentColor');
    assert.equal(icon.attrs['stroke-width'], '1.75');
    assert.equal(icon.children.length, 1);
});

test('asynchronous native submenu replacement updates route icon without duplication', () => {
    const h = harness([['Initially empty', ['#']]]);
    const link = h.links()[0];
    assert.equal(link.attrs['data-nova-icon'], 'folder');
    link.setAttribute('href', '/custom-luci-prefix/admin/network/network'); h.update();
    assert.equal(link.attrs['data-nova-icon'], 'network');
    assert.equal(link.children.length, 1);
});

test('theme-only native menus work without creating a dashboard entry', () => {
    const h = harness([
        ['Status', ['#', '/cgi-bin/luci/admin/status/overview']],
        ['System', ['#', '/cgi-bin/luci/admin/system/system']],
        ['Network', ['#', '/cgi-bin/luci/admin/network/network']],
        ['Logout', ['/cgi-bin/luci/admin/logout']]
    ]);
    for (let i = 0; i < 3; i++) h.update();
    assert.deepEqual(h.links().map(link => link.attrs['data-nova-icon']), ['status', 'system', 'network', 'logout']);
    assert.deepEqual(h.links().map(link => link.textContent), ['Status', 'System', 'Network', 'Logout']);
    assert.equal(h.menu.children.length, 4);
});

test('removing the optional dashboard leaves native routes intact', () => {
    const h = harness([
        ['Nova Dashboard', ['/cgi-bin/luci/admin/nova']],
        ['Status', ['#', '/cgi-bin/luci/admin/status/overview']],
        ['System', ['#', '/cgi-bin/luci/admin/system/system']]
    ]);
    h.menu.children[0].remove();
    h.update();
    assert.deepEqual(h.links().map(link => link.attrs['data-nova-icon']), ['status', 'system']);
    assert.equal(h.menu.children.length, 2, 'theme must not recreate removed app navigation');
});

test('unrecognized, missing and non-path URLs use a neutral folder icon', () => {
    const h = harness([['Empty', ['#']], ['Bad', ['http://[']], ['Query only', ['/?next=/admin/system']], ['Prototype name', ['/admin/toString']]]);
    assert.deepEqual(h.links().map(link => link.attrs['data-nova-icon']), ['folder','folder','folder','folder']);
});
