'use strict';

// Use the complete native Bootstrap cascade and shell, including the footer.
// Document-width checks alone cannot see overflow inside a fixed sidebar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const chromium = require('./helpers/chromium');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fixture(directory) {
    const children = Array.from({ length: 24 }, (_, i) =>
        `<li><a id="child-${i}" href="#native-${i}">菜单设置 ${i + 1}</a></li>`).join('');
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${read('tests/fixtures/bootstrap/cascade.css')}</style>
    <style media="only screen and (max-device-width:854px)">${read('tests/fixtures/bootstrap/mobile.css')}</style>
    <style>${read('luci-theme-nova/htdocs/luci-static/nova/cascade.css')}</style></head><body>
    <header><a class="brand" href="#home"><span class="nova-brand-mark">N</span><span class="nova-brand-name">Nova</span></a><span class="nova-hostname">nova-test</span>
    <ul class="nav" id="topmenu"><li><a href="#dashboard">Nova 仪表盘</a></li>
    <li class="dropdown" id="status"><a class="menu" id="status-toggle" href="#">状态</a><ul class="dropdown-menu">${children}</ul></li>
    <li class="dropdown"><a class="menu" href="#">系统</a><ul class="dropdown-menu"><li><a href="#system">系统设置</a></li></ul></li>
    <li class="dropdown"><a class="menu" href="#">网络</a><ul class="dropdown-menu"><li><a href="#network">网络设置</a></li></ul></li>
    <li><a id="logout" href="#logout">退出</a></li></ul>
    <div class="nova-sidebar-foot"><span class="nova-footer-dot">●</span> Nova for OpenWrt</div></header>
    <main id="maincontent" class="container"><h1>完整侧栏布局回归</h1><input id="nova-search" aria-label="搜索菜单"></main>
    <script>${read('luci-theme-nova/htdocs/luci-static/nova/nova-shell.js')}</script></body></html>`);
    return pathToFileURL(path.join(directory, 'index.html')).href;
}

test('sidebar has no phantom scrollbar and long menus remain reachable', { timeout: 90000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-sidebar-'));
    const url = fixture(directory);
    const browser = chromium(directory);
    try {
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => browser.send(method, params, sessionId);
        await send('Page.enable');
        await send('Runtime.enable');
        async function evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        async function load(width, height) {
            await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
            await send('Page.navigate', { url });
            for (let i = 0; i < 100; i++) {
                if (await evaluate('!!document.querySelector("#status-toggle[aria-expanded]")')) break;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.ok(await evaluate('!!document.querySelector("#status-toggle[aria-expanded]")'), 'shell initialized');
            await settle();
        }
        const geometry = () => evaluate(`(() => {
            const h=document.querySelector('header'), b=h.querySelector('.brand'), f=h.querySelector('.nova-sidebar-foot'), s=getComputedStyle(h);
            return { clientWidth:h.clientWidth, scrollWidth:h.scrollWidth, clientHeight:h.clientHeight, scrollHeight:h.scrollHeight,
                height:h.getBoundingClientRect().height, top:h.scrollTop, overflowX:s.overflowX, overflowY:s.overflowY,
                brand:b.getBoundingClientRect().toJSON(), footer:f.getBoundingClientRect().toJSON(),
                documentWidth:document.documentElement.clientWidth, documentScroll:document.documentElement.scrollWidth };
        })()`);
        function noHorizontal(state, label) {
            assert.ok(state.scrollWidth <= state.clientWidth, label + ': sidebar horizontal overflow ' + JSON.stringify(state));
            assert.ok(state.documentScroll <= state.documentWidth, label + ': document horizontal overflow ' + JSON.stringify(state));
        }
        async function click(id) {
            const point = await evaluate(`(() => { const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
            await settle();
        }
        async function key(key, code, virtualKey) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
            await settle();
        }
        for (const width of [901, 1024, 1180, 1440]) {
            await load(width, 757);
            const state = await geometry();
            noHorizontal(state, `${width} collapsed`);
            assert.equal(state.scrollHeight, state.clientHeight, `${width}: short navigation must not scroll vertically`);
            assert.equal(state.clientHeight, state.height, `${width}: no horizontal scrollbar gutter`);
            assert.ok(state.brand.left === 0 && state.brand.right === state.clientWidth, 'brand fills sidebar without padding overflow');
            assert.ok(state.footer.bottom <= state.clientHeight, 'footer fits');
            assert.equal(state.overflowY, 'auto', 'genuine vertical overflow remains scrollable');
        }
        // Actual wheel and keyboard input must reach entries below a short screen.
        await load(1180, 320);
        noHorizontal(await geometry(), 'short screen');
        await click('status-toggle');
        let state = await geometry();
        noHorizontal(state, 'expanded');
        assert.ok(state.scrollHeight > state.clientHeight, 'long menu must overflow vertically');
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 200, deltaX: 0, deltaY: 260 });
        await settle();
        // Wheel input is processed asynchronously by Chrome's compositor.
        for (let i = 0; i < 25 && !(await geometry()).top; i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok((await geometry()).top > 0, 'wheel scrolls sidebar');
        for (let i = 0; i < 24; i++) await key('Tab', 'Tab', 9);
        const focus = await evaluate(`(() => {const e=document.activeElement,r=e.getBoundingClientRect(),h=document.querySelector('header');return {id:e.id,top:r.top,bottom:r.bottom,height:innerHeight,scrollTop:h.scrollTop,outline:getComputedStyle(e).outlineStyle};})()`);
        assert.equal(focus.id, 'child-23', 'Tab reaches last submenu entry');
        assert.ok(focus.top >= 0 && focus.bottom <= focus.height && focus.scrollTop > 0, 'focused entry scrolls into view');
        assert.notEqual(focus.outline, 'none', 'keyboard focus remains visible');
        await key('Escape', 'Escape', 27);
        assert.equal(await evaluate('document.activeElement.id'), 'status-toggle', 'Escape restores toggle focus');
        assert.equal(await evaluate('document.querySelector("#status-toggle").getAttribute("aria-expanded")'), 'false');
        noHorizontal(await geometry(), 'collapsed again');
        // Large menus and text wrapping cannot create a second horizontal scroller.
        await load(1180, 757);
        await evaluate(`document.querySelector('#child-0').textContent='VeryLongUnbrokenNavigationLabel'.repeat(5)`);
        await click('status-toggle');
        noHorizontal(await geometry(), 'long label');
        for (const width of [320, 390, 768, 900]) {
            await load(width, 757);
            let state = await geometry();
            noHorizontal(state, `${width} mobile collapsed`);
            assert.equal(state.overflowY, 'visible', 'horizontal mobile navigation does not clip popouts');
            await click('status-toggle');
            state = await geometry();
            noHorizontal(state, `${width} mobile expanded`);
            assert.equal(await evaluate('getComputedStyle(document.querySelector("#status>.dropdown-menu")).display'), 'block');
            await key('Escape', 'Escape', 27);
        }
    } finally {
        await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
