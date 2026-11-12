'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildIndex, findPages } = require('../luci-theme-nova/htdocs/luci-static/nova/nova-search.js');

const page = (title, extra = {}) => ({ title, satisfied: true, action: { type: 'view' }, ...extra });
const group = (title, children) => page(title, { action: { type: 'firstchild' }, children });
// Match ui.menu.getChildren's ACL/dependency/title filtering and ordering.
const menu = { getChildren(node) {
    return Object.entries(node.children || {}).filter(([, child]) => child.satisfied && Object.hasOwn(child, 'title'))
        .map(([name, child]) => ({ ...child, name })).sort((a, b) => (a.order || 1000) - (b.order || 1000));
} };
const translate = title => ({ Administration: '管理', Status: '状态', Overview: '概览', Network: '网络', Interfaces: '接口', Firewall: '防火墙', Rules: '规则' }[title] || title);
const url = (...parts) => '/custom-prefix/luci/' + parts.map(encodeURIComponent).join('/');
function index(children) { return buildIndex({ children: { admin: group('Administration', children) } }, menu, url, translate); }

test('indexes all titled accessible depths, translated labels and original route paths', () => {
    const pages = index({ status: group('Status', { overview: page('Overview') }), network: group('Network', {
        interfaces: page('Interfaces'), firewall: group('Firewall', { rules: page('Rules') })
    }) });
    assert.equal(pages.length, 3);
    assert.equal(findPages(pages, '规则')[0].href, '/custom-prefix/luci/admin/network/firewall/rules');
    assert.equal(findPages(pages, '防火墙 rules')[0].breadcrumb, '网络 › 防火墙 › 规则');
    assert.equal(findPages(pages, ' NETWORK   INTERFACES ')[0].title, '接口');
    assert.equal(findPages(pages, 'overview')[0].title, '概览');
    assert.equal(findPages(pages, '/network/firewall/')[0].title, '规则');
});

test('uses only the live menu: no ACL-denied, hidden, unavailable, logout or hard-coded dashboard pages', () => {
    const pages = index({ status: group('Status', { overview: page('Overview'), denied: page('Denied', { satisfied: false }),
        hidden: { satisfied: true, action: { type: 'view' } }, nullTitle: page(null), emptyTitle: page('') }),
        blocked: { ...group('Blocked', { child: page('Should not leak') }), satisfied: false },
        logout: page('Logout', { action: { type: 'call' } }) });
    assert.deepEqual(pages.map(p => p.title), ['概览']);
    assert.deepEqual(findPages(pages, 'nova'), []);
    assert.equal(index({ nova: page('Nova Dashboard') })[0].title, 'Nova Dashboard');
});

test('keeps real pages with children, rejects category-only redirects, preserves menu-generated URLs', () => {
    const pages = index({ network: page('Network', { children: { interfaces: page('Interfaces') } }) });
    assert.equal(pages.length, 2);
    assert.equal(pages[0].href, '/custom-prefix/luci/admin/network');
    assert.equal(pages[1].breadcrumb, '网络 › 接口');
});

test('ranks exact titles before title prefixes, partial titles and breadcrumb-only matches', () => {
    const pages = index({ overview: group('Overview', { devices: page('Devices') }),
        b: page('Traffic overview'), c: page('Overview details'), d: page('Overview') });
    assert.deepEqual(findPages(pages, 'overview').map(p => p.title), ['概览', 'Overview details', 'Traffic overview', 'Devices']);
    assert.deepEqual(findPages(pages, 'totally-missing'), []);
    assert.deepEqual(findPages(pages, ' '), []);
});

test('supports case, accents, full-width input and repeated searches without mutation', () => {
    const pages = index({ cafe: page('Café'), wan: page('WAN') });
    const before = JSON.stringify(pages);
    assert.equal(findPages(pages, 'cafe')[0].title, 'Café');
    assert.equal(findPages(pages, 'ＷＡＮ')[0].title, 'WAN');
    for (let i = 0; i < 10; i++) findPages(pages, 'cafe');
    assert.equal(JSON.stringify(pages), before);
});

test('cycles in aliased menu children terminate without losing other pages', () => {
    const nested = { ordinary: page('Normal page') };
    nested.loop = group('Loop', nested);
    const pages = index({ services: group('Services', nested), status: page('Status') });
    assert.deepEqual(pages.map(p => p.title), ['Normal page', '状态']);
});

test('menu labels remain literal data, not HTML or executable markup', () => {
    const title = '<img src=x onerror=alert(1)>';
    assert.equal(index({ plugin: page(title) })[0].title, title);
});
