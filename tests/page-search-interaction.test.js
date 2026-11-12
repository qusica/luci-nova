'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova/nova-search.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ width = 360, left = 12, late = false, zh = true } = {}) {
    class Target {
        constructor() { this.listeners = {}; }
        addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
        emit(name, props = {}) {
            const e = { target: this, relatedTarget: null, key: '', defaultPrevented: false, stopped: false,
                preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
            (this.listeners[name] || []).forEach(fn => fn(e));
            return e;
        }
    }
    class Element extends Target {
        constructor(tag) { super(); this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.hidden = false; this.value = ''; this.className = ''; this.isConnected = true; this._text = ''; }
        appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
        set textContent(text) { this._text = text; this.children = []; }
        get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return this.attrs[k] ?? null; }
        removeAttribute(k) { delete this.attrs[k]; }
        contains(el) { return this === el || this.children.some(c => c.contains(el)); }
        closest(selector) { return selector === '.nova-page-search' && this.className === 'nova-page-search' ? this : this.parentElement?.closest(selector); }
        get classList() { return { contains: name => this.className.split(' ').includes(name) }; }
        getBoundingClientRect() { return { left, bottom: 180 }; }
        scrollIntoView() { this.scrolled = true; }
        select() { this.selected = true; }
        click() { this.emit('click'); if (this.href) navigations.push(this.href); }
        focus() {
            if (doc.activeElement === this) return;
            const previous = doc.activeElement;
            doc.activeElement = this;
            for (let node = previous; node; node = node.parentElement) node.emit('focusout', { relatedTarget: this });
            this.emit('focus');
        }
    }
    const doc = new Target(), win = new Target(), navigations = [];
    const body = new Element('body'), container = body.appendChild(new Element('div'));
    container.className = 'nova-page-search';
    const input = container.appendChild(new Element('input')); input.id = 'nova-search';
    const editor = body.appendChild(new Element('input')); editor.id = 'editor';
    doc.body = body; doc.readyState = 'complete'; doc.activeElement = editor;
    doc.documentElement = { lang: zh ? 'zh-CN' : 'en', clientWidth: width };
    doc.createElement = name => new Element(name);
    function find(node, id) { if (node.id === id) return node; return node.children.map(c => find(c, id)).find(Boolean); }
    doc.getElementById = id => find(body, id);
    win.innerHeight = 640;
    let resolve, reject, loads = 0;
    const pages = ['Interfaces', 'Firewall', '<script>literal</script>'].map((title, i) => ({ name: 'page' + i, title, action: { type: 'view' } }));
    const tree = { nodes: [{ name: 'admin', title: 'Administration', nodes: [{ name: 'network', title: 'Network', action: { type: 'firstchild' }, nodes: pages }] }] };
    const menu = { getChildren: node => node.nodes || [], load() { loads++; return new Promise((yes, no) => { resolve = () => yes(tree); reject = no; }); } };
    function install() { win.L = { require: async () => ({ menu }), url: (...p) => '/custom/' + p.join('/') }; }
    if (!late) install();
    vm.runInNewContext(source, { document: doc, window: win, Promise });
    const panel = container.children[1], status = panel.children[1], list = panel.children[2];
    return { doc, win, input, editor, container, panel, status, list, navigations, install,
        async ready() { await settle(); resolve(); await settle(); },
        async fail() { await settle(); reject(new Error('unavailable')); await settle(); },
        loads: () => loads,
        query(value) { input.focus(); input.value = value; input.emit('input'); },
        key(key, props) { return input.emit('keydown', { key, ...props }); }
    };
}

test('async menu completion updates current query but does not reopen dismissed popup', async () => {
    const h = harness({ late: true });
    h.query('network');
    assert.match(h.status.textContent, /加载/);
    h.install(); h.doc.emit('luci-loaded');
    h.key('Escape');
    await h.ready();
    assert.equal(h.panel.hidden, true);
    h.input.click();
    assert.equal(h.list.children.length, 3);
    assert.equal(h.input.getAttribute('aria-expanded'), 'true');
    assert.equal(h.input.getAttribute('aria-activedescendant'), 'nova-search-option-0');
    assert.equal(h.loads(), 1);
});

test('keyboard choices, exact route navigation, IME and repeated Enter use the actual shipped handlers', async () => {
    const h = harness(); await h.ready(); h.query('network');
    assert.equal(h.list.children[0].href, '/custom/admin/network/page0');
    h.key('ArrowDown');
    assert.equal(h.list.children[1].getAttribute('aria-selected'), 'true');
    assert.equal(h.list.children[1].scrolled, true);
    h.key('Enter', { isComposing: true });
    h.key('Enter', { keyCode: 229 });
    h.key('Enter', { repeat: true });
    assert.deepEqual(h.navigations, []);
    h.key('Enter');
    assert.deepEqual(h.navigations, ['/custom/admin/network/page1']);
    h.key('ArrowUp'); h.key('ArrowUp');
    assert.equal(h.list.children[2].getAttribute('aria-selected'), 'true');
});

test('shortcut restores previous focus on Escape, while native modal focus remains untouched', async () => {
    const h = harness(); await h.ready();
    const e = h.doc.emit('keydown', { key: 'k', ctrlKey: true });
    assert.equal(e.defaultPrevented, true);
    assert.equal(h.doc.activeElement, h.input);
    assert.equal(h.input.selected, true);
    h.key('Escape');
    assert.equal(h.doc.activeElement, h.editor);
    assert.equal(h.panel.hidden, true);
    h.doc.body.className = 'modal-overlay-active';
    assert.equal(h.doc.emit('keydown', { key: 'k', metaKey: true }).defaultPrevented, false);
    assert.equal(h.doc.activeElement, h.editor);
});

test('Tab, outside click, focus loss and Back/Forward restoration dismiss without navigation', async () => {
    const h = harness(); await h.ready();
    for (const dismiss of [() => h.key('Tab'), () => h.doc.emit('click', { target: h.editor }),
        () => h.editor.focus(), () => h.win.emit('pagehide'), () => h.win.emit('pageshow')]) {
        h.query('network');
        assert.equal(h.panel.hidden, false);
        dismiss();
        assert.equal(h.panel.hidden, true);
        assert.equal(h.input.getAttribute('aria-activedescendant'), null);
    }
    assert.deepEqual(h.navigations, []);
    assert.equal(h.loads(), 1);
});

test('no-result, cleared and failed searches have explicit status and no stale destinations', async () => {
    const h = harness({ zh: false }); await h.ready(); h.query('Interfaces');
    assert.equal(h.list.children.length, 1);
    h.query('missing');
    assert.equal(h.list.children.length, 0);
    assert.match(h.status.textContent, /No matching/);
    h.key('Enter'); assert.deepEqual(h.navigations, []);
    h.query(''); assert.match(h.status.textContent, /Type a page name/);
    const failure = harness({ zh: false }); failure.query('network'); await failure.fail();
    assert.match(failure.status.textContent, /unavailable/);
    assert.equal(failure.list.children.length, 0);
});

test('untrusted-looking titles remain text and popup clamps to viewport on resize', async () => {
    const h = harness({ width: 768, left: 500 }); await h.ready(); h.query('script');
    const title = h.list.children[0].children[0];
    assert.equal(title.textContent, '<script>literal</script>');
    assert.equal(title.children.length, 0);
    assert.equal(h.panel.style.left, '-184px');
    h.doc.documentElement.clientWidth = 320;
    h.win.emit('resize');
    assert.equal(h.panel.style.left, '-488px');
    assert.equal(h.panel.style.maxHeight, '440px');
});
