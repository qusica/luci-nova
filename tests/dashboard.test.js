'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const resources = path.resolve(__dirname, '../luci-app-nova-dashboard/htdocs/luci-static/resources');
const source = fs.readFileSync(path.join(resources, 'view/nova/dashboard.js'), 'utf8');

// Minimal LuCI DOM/RPC doubles keep render regressions dependency-free.
function harness() {
    const ids = new Map();
    const polls = new Set();
    function E(tag, attrs = {}, children = []) {
        const element = {
            tag, attrs, hidden: !!attrs.hidden,
            children: (Array.isArray(children) ? children : [children]).filter(v => v != null),
            getAttribute(name) { return this.attrs[name]; },
            setAttribute(name, value) { this.attrs[name] = value; },
            replaceChildren(...values) { this.children = values; },
            appendChild(value) { this.children.push(value); return value; }
        };
        if (attrs.id) ids.set(attrs.id, element);
        return element;
    }
    const document = {
        head: E('head'),
        getElementById: id => ids.get(id),
        createTextNode: text => String(text)
    };
    const poll = { add: fn => polls.add(fn), remove: fn => polls.delete(fn) };
    const view = new Function('view', 'rpc', 'poll', 'network', 'fs', 'E', 'L', 'document', source)(
        { extend: value => value }, { declare: () => () => Promise.resolve({}) }, poll,
        {}, {}, E,
        { url: value => '/cgi-bin/luci/' + value, resource: value => '/luci-static/resources/' + value },
        document
    );
    function render(interfaces = []) {
        return view.render([
            { hostname: 'test-router', model: 'Test router', release: { description: 'OpenWrt test' } },
            {}, { interface: interfaces }, [], {}, null, null, []
        ]);
    }
    return { render, view, document, polls };
}

function all(node, predicate) {
    if (typeof node !== 'object' || node == null) return [];
    return (predicate(node) ? [node] : []).concat(...node.children.map(child => all(child, predicate)));
}
function text(node) {
    return typeof node === 'object' && node != null ? node.children.map(text).join('') : String(node);
}
function hasClass(name) {
    return node => (node.attrs.class || '').split(' ').includes(name);
}

for (const [label, interfaces] of [
    ['missing LAN', []],
    ['unrelated interface', [{ interface: 'guest', l3_device: 'br-guest', device: 'br-guest' }]],
    ['missing LAN device fields', [{ interface: 'lan' }]],
    ['empty LAN device fields', [{ interface: 'lan', l3_device: '', device: '' }]]
]) {
    test(label + ' renders an explicit unknown, never undefined or an invented bridge', () => {
        const app = harness();
        const root = app.render(interfaces);
        const router = all(root, hasClass('nv-router'))[0];
        assert.equal(router.attrs.title, 'OpenWrt test · 未检测到 LAN 接口');
        assert.match(text(root), /未检测到 LAN 接口/);
        assert.doesNotMatch(text(root), /undefined|br-lan|br-guest/);
        for (const node of all(root, hasClass('nv-node'))) {
            assert.doesNotMatch(node.attrs.title, /undefined|br-lan|br-guest/);
        }
        router.attrs.click();
        const selected = app.document.getElementById('nv-selected');
        assert.equal(selected.hidden, false);
        assert.match(text(selected), /OpenWrt test · 未检测到 LAN 接口/);
        router.attrs.click();
        assert.equal(selected.children.length, 3, 'repeated clicks replace the detail');
    });
}

for (const [label, lan, expected, client] of [
    ['L3 device', { l3_device: 'br-home', device: 'eth1' }, 'br-home', 'eth1'],
    ['device fallback', { device: 'eth2' }, 'eth2', 'eth2'],
    ['L3-only device', { l3_device: 'br-office' }, 'br-office', 'br-office'],
    ['empty L3 fallback', { l3_device: '', device: 'eth3' }, 'eth3', 'eth3']
]) {
    test(label + ' preserves the actual interface name in the topology', () => {
        const root = harness().render([{ interface: 'lan', ...lan }]);
        assert.equal(all(root, hasClass('nv-router'))[0].attrs.title, 'OpenWrt test · LAN ' + expected);
        const lanRadio = all(root, hasClass('nv-radio'))[2];
        assert.equal(text(lanRadio.children[1].children[1]), expected);
        assert.match(lanRadio.attrs.title, new RegExp('LAN ' + expected + '$'));
        const lanClient = all(root, hasClass('nv-client'))[2];
        assert.equal(text(lanClient.children[1].children[1]), client);
    });
}

test('render links the packaged stylesheet once and removes its poll on teardown', () => {
    const app = harness();
    app.render();
    assert.equal(app.polls.size, 1);
    const style = app.document.head.children[0];
    assert.equal(style.tag, 'link');
    assert.equal(style.attrs.rel, 'stylesheet');
    assert.equal(style.attrs.href, '/luci-static/resources/nova/dashboard.css?v=0.2.1');
    assert.ok(fs.statSync(path.join(resources, 'nova/dashboard.css')).size > 0);
    app.view.remove();
    assert.equal(app.polls.size, 0);
    app.render();
    assert.equal(app.document.head.children.length, 1);
    app.view.remove();
    assert.equal(app.polls.size, 0);
});

test('render upgrades an existing unversioned or old stylesheet without duplicating it', () => {
    const app = harness();
    app.render();
    app.view.remove();
    const style = app.document.head.children[0];
    for (const oldHref of ['/luci-static/resources/nova/dashboard.css', '/luci-static/resources/nova/dashboard.css?v=0.2.0']) {
        style.attrs.href = oldHref;
        app.render();
        assert.equal(style.attrs.href, '/luci-static/resources/nova/dashboard.css?v=0.2.1');
        assert.equal(app.document.head.children.length, 1);
        app.view.remove();
    }
});
