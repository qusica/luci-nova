'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova/nova-lists.js'), 'utf8');
// Exercise the shipped filtering function with minimal row/control doubles.
// The separate Chrome test covers actual DOM, native events, polling and layout.
const start = source.search(/function\s+update\s*\(def,\s*state\)\s*\{/);
const end = source.search(/function\s+refresh\s*\(\)/);
assert.ok(start > 0 && end > start, 'production filter function must be located');
const update = new Function('pageSize', 'setText', 't', source.slice(start, end) + '; return update;')(
    25, (node, text) => { node.textContent = text; }, (en) => en);

function row(text, family = '') {
    const classes = new Set();
    return {
        textContent: text,
        classList: {
            contains: name => classes.has(name),
            toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
        },
        querySelector: selector => selector === 'td, .td' ? { textContent: family } : null
    };
}
function state(rows, query = '', family = 'all', page = 0, placeholders = []) {
    return {
        owner: { query, family, select: { options: ['all','ipv4','ipv6','other'].map(value => ({ value })) } },
        table: { querySelectorAll: selector => selector === '.placeholder' ? placeholders : rows },
        page, count: {}, range: {}, previous: {}, next: {}, footer: {}, empty: {}
    };
}
function shown(rows) { return rows.filter(r => !r.classList.contains('nova-list-hidden')); }

const emptyStart = source.search(/function\s+nativeEmptyLeaseMessage\s*\(heading\)\s*\{/);
const emptyEnd = source.search(/function\s+enhanceEmptyLeases\s*\(\)/);
assert.ok(emptyStart > 0 && emptyEnd > emptyStart, 'production empty-state matcher must be located');
function emptyMatcher(translate) {
    return new Function('window', source.slice(emptyStart, emptyEnd) + '; return nativeEmptyLeaseMessage;')({ _: translate });
}
function emptyHeading(title, messageText) {
    const message = { tagName: 'EM', textContent: messageText, classList: { contains: () => false } };
    const content = { tagName: 'DIV', children: [message], firstElementChild: message };
    const control = { textContent: 'Hide' };
    const heading = {
        childNodes: [{ textContent: title + ' ' }, control],
        querySelector: () => control,
        parentElement: { nextElementSibling: content }
    };
    return { heading, control, content, message };
}

test('first-load DHCP empty branch matches LuCI translations and preserves its actual message', () => {
    for (const [title, text] of [['DHCP Leases', 'No active leases found'], ['DHCP 租约', '没有已分配的租约'], ['Baux DHCP', 'Aucun bail actif']]) {
        const translate = key => key === 'DHCP Leases' ? title : text;
        const fixture = emptyHeading(title, text);
        const result = emptyMatcher(translate)(fixture.heading);
        assert.equal(result.title, title);
        assert.equal(result.content, fixture.content);
        assert.equal(result.message, fixture.message);
        assert.equal(fixture.heading.childNodes[1], fixture.control);
    }
});

test('missing LuCI translation/runtime or native poll control cannot identify an empty module', () => {
    const fixture = emptyHeading('DHCP Leases', 'No active leases found');
    assert.equal(emptyMatcher(undefined)(fixture.heading), null);
    fixture.heading.querySelector = () => null;
    assert.equal(emptyMatcher(key => key)(fixture.heading), null);
});

test('empty-state matcher leaves add-ons, pending loads and failures unchanged', () => {
    const match = emptyMatcher(key => key);
    for (const change of [
        fixture => { fixture.heading.childNodes[0].textContent = 'Unrelated plugin '; },
        fixture => { fixture.message.textContent = 'Collecting data...'; },
        fixture => { fixture.message.textContent = 'Permission denied'; },
        fixture => { fixture.message.classList.contains = value => value === 'spinning'; },
        fixture => { fixture.message.tagName = 'P'; },
        fixture => { fixture.content.children.push({}); },
        fixture => { fixture.content.tagName = 'SECTION'; },
        fixture => { fixture.heading.parentElement.nextElementSibling = null; }
    ]) {
        const fixture = emptyHeading('DHCP Leases', 'No active leases found');
        change(fixture);
        assert.equal(match(fixture.heading), null);
    }
});

test('native rows are preserved and paginated without truncating payloads', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row('host-' + i));
    const value = state(rows);
    update({}, value);
    assert.equal(value.rows.length, 5000);
    assert.equal(value.rows[4999], rows[4999]);
    assert.equal(shown(rows).length, 25);
    assert.equal(value.count.textContent, '5000');
    assert.equal(value.range.textContent, '1–25 / 5000');
    value.page = 199; update({}, value);
    assert.equal(value.range.textContent, '4976–5000 / 5000');
    assert.equal(shown(rows)[24], rows[4999]);
    assert.equal(value.next.disabled, true);
});

test('search is case-insensitive AND matching across native cells', () => {
    const rows = [row('Laptop 192.0.2.7 02:AA:BB:CC:DD:EE'), row('tablet 192.0.2.8'), row('Laptop 192.0.2.9')];
    const value = state(rows, ' LAPTOP   192.0.2.7 ');
    update({}, value);
    assert.deepEqual(shown(rows), [rows[0]]);
    assert.equal(value.count.textContent, '1 / 3');
    assert.equal(value.footer.hidden, true);
    value.owner.query = '02:aa:bb'; update({}, value);
    assert.deepEqual(shown(rows), [rows[0]]);
});

test('all IPv6 addresses and DUID values remain searchable', () => {
    const rows = [row('host 2001:db8::1 / 2001:db8:1::2 000100ABCDEF IAID01')];
    const value = state(rows, '2001:db8:1::2 000100abcdef');
    update({}, value);
    assert.equal(shown(rows).length, 1);
});

test('connection family filters keep IPv4 IPv6 and unknown protocols distinct', () => {
    const rows = [row('IPv4 TCP 192.0.2.7:443', 'IPv4'), row('IPv6 UDP [2001:db8::1]:53', 'IPv6'), row('OTHER GRE custom', 'OTHER')];
    const value = state(rows, '', 'ipv6');
    update({ group: true }, value);
    assert.deepEqual(shown(rows), [rows[1]]);
    assert.equal(value.owner.select.options[0].textContent, 'All (3)');
    value.owner.family = 'other'; update({ group: true }, value);
    assert.deepEqual(shown(rows), [rows[2]]);
    value.owner.family = 'all'; value.owner.query = 'TCP :443'; update({ group: true }, value);
    assert.deepEqual(shown(rows), [rows[0]]);
});

test('out-of-range pages clamp after native polling removes records', () => {
    const rows = Array.from({ length: 27 }, (_, i) => row('host-' + i));
    const value = state(rows, '', 'all', 40);
    update({}, value);
    assert.equal(value.page, 1);
    assert.equal(shown(rows).length, 2);
    value.owner.query = 'host-26'; update({}, value);
    assert.equal(value.page, 0);
    assert.deepEqual(shown(rows), [rows[26]]);
});

test('empty tables keep native placeholders and no fabricated counts', () => {
    const placeholder = row('No active leases found');
    const value = state([], '', 'all', 0, [placeholder]);
    update({}, value);
    assert.equal(placeholder.classList.contains('nova-list-hidden'), false);
    assert.equal(value.count.textContent, '0');
    assert.equal(value.empty.hidden, true);
    assert.equal(value.previous.disabled, true);
    assert.equal(value.next.disabled, true);
});

test('no matches show a separate empty state and literal HTML text is not parsed', () => {
    const rows = [row('<img src=x onerror=alert(1)> 192.0.2.1')];
    const value = state(rows, 'not-found');
    update({}, value);
    assert.equal(value.empty.hidden, false);
    assert.equal(value.count.textContent, '0 / 1');
    value.owner.query = '<IMG'; update({}, value);
    assert.deepEqual(shown(rows), rows);
    assert.equal(rows[0].textContent, '<img src=x onerror=alert(1)> 192.0.2.1');
});

test('progressive enhancement does not add data access or replace native row content', () => {
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|innerHTML|outerHTML|cloneNode)\b/);
    assert.match(source, /open:\s*false/);
    assert.match(source, /scroller\.appendChild\(table\)/);
    assert.match(source, /observer\.disconnect\(\)/);
    assert.match(source, /admin-status-overview/);
    assert.doesNotMatch(source, /admin-network-dhcp/);
});
