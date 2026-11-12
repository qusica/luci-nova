'use strict';

// Real pointer/touch/keyboard input against local files, not synthetic DOM events.
// No npm dependencies. CI supplies google-chrome; CHROME_BIN can override it.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromium(directory) {
    const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking',
        '--remote-debugging-pipe', '--user-data-dir=' + path.join(directory, 'profile'),
        'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let sequence = 0, buffer = '', stderr = '', failure;
    const pending = new Map();
    const fail = error => {
        failure = error;
        for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        pending.clear();
    };
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
    child.on('error', fail);
    child.stdio[3].on('error', fail);
    child.stdio[4].on('error', fail);
    child.on('exit', (code, signal) => fail(new Error(`Chrome exited (${code}, ${signal}): ${stderr}`)));
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', data => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\0')) !== -1) {
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!packet) continue;
            const message = JSON.parse(packet);
            const request = pending.get(message.id);
            if (!request) continue;
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(JSON.stringify(message.error)));
            else request.resolve(message.result);
        }
    });
    function send(method, params = {}, sessionId) {
        if (failure) return Promise.reject(failure);
        const id = ++sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timed out: ${method}\n${stderr}`));
            }, 10000);
            pending.set(id, { resolve, reject, timer });
            child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
        });
    }
    async function close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        await exited;
        clearTimeout(timer);
    }
    return { send, close };
}

function fixture(directory) {
    const root = path.resolve(__dirname, '..', 'luci-theme-nova/htdocs/luci-static/nova');
    fs.copyFileSync(path.join(root, 'cascade.css'), path.join(directory, 'cascade.css'));
    fs.copyFileSync(path.join(root, 'nova-shell.js'), path.join(directory, 'nova-shell.js'));
    const groups = ['status', 'system', 'network'].map((name, index) =>
        `<li class="dropdown${index === 0 ? ' active' : ''}" id="${name}"><a class="menu" id="${name}-toggle" href="#">${['状态', '系统', '网络'][index]}</a><ul class="dropdown-menu"><li><a id="${name}-first" href="admin/${name}/leaf.html?from=${name}">概览</a></li><li><a href="admin/${name}/leaf.html?second=${name}">设置</a></li><li><a href="admin/${name}/leaf.html?third=${name}">日志</a></li></ul></li>`).join('');
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Relevant stock Bootstrap cascade: test the inherited arrow, offscreen
     dropdown positioning and native list sizing, not just clean standalone CSS. -->
<style>*{box-sizing:border-box}body{margin:0}ul{list-style:none;margin:0 0 9px 25px;padding:0}a{cursor:pointer}.dropdown-menu{display:none;position:absolute;left:-9999px;min-width:max-content;padding:6px 0}.nav .dropdown-menu li a{padding:4px 15px}a.menu:after{width:0;height:0;display:inline-block;content:"&darr;";text-indent:-99999px;margin-top:8px;margin-left:4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:4px solid #fff;opacity:.5}.dropdown:hover ul.dropdown-menu{display:block;left:0}</style>
<link rel="stylesheet" href="cascade.css"><script defer src="nova-shell.js"></script>
<header><a class="brand" href="index.html"><span class="nova-brand-mark">N</span>Nova</a><ul id="topmenu" class="nav"></ul></header>
<main id="maincontent" class="container"><input id="nova-search" aria-label="Search menu"><button id="outside" style="position:fixed;right:20px;bottom:20px">Outside</button></main>
<script>addEventListener('load',()=>setTimeout(()=>{document.getElementById('topmenu').innerHTML=${JSON.stringify(groups + '<li><a id="leaf" href="admin/logout/leaf.html?from=top">退出</a></li>')};window.fixtureReady=true;},30));</script>`);
    for (const name of ['status', 'system', 'network', 'logout']) {
        fs.mkdirSync(path.join(directory, 'admin', name), { recursive: true });
        fs.writeFileSync(path.join(directory, 'admin', name, 'leaf.html'), '<!doctype html><title>Native destination</title><h1 id="destination">Native navigation succeeded</h1>');
    }
    return pathToFileURL(path.join(directory, 'index.html')).href;
}

test('click-only LuCI navigation handles real hover, keyboard and touch', { timeout: 90000 }, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-navigation-'));
    const url = fixture(temporary);
    const browser = chromium(temporary);
    try {
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => browser.send(method, params, sessionId);
        await send('Page.enable');
        await send('Runtime.enable');
        async function evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function until(expression, description) {
            let lastError;
            for (let i = 0; i < 100; i++) {
                try { if (await evaluate(expression)) return; } catch (error) { lastError = error; }
                await delay(40);
            }
            assert.fail(description + (lastError ? ': ' + lastError.message : ''));
        }
        const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
        async function load(width, touch = false) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
            await send('Page.navigate', { url });
            await until('window.fixtureReady === true && document.querySelectorAll("#topmenu > li").length === 4', 'asynchronous menu did not arrive');
            await settle();
        }
        const rect = id => evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
        const rectangles = () => evaluate('Array.from(document.querySelectorAll("#topmenu > li > a"), a=>{const r=a.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})');
        function sameRect(before, after, message) {
            assert.equal(before.length, after.length, message);
            before.forEach((value, i) => assert.ok(Math.abs(value - after[i]) < 0.5, `${message}: ${before} -> ${after}`));
        }
        async function point(id) {
            const r = await rect(id);
            assert.ok(r.width > 0 && r.height > 0, `${id} has no visible rectangle`);
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            assert.ok(await evaluate(`(()=>{const a=document.getElementById(${JSON.stringify(id)});return a.contains(document.elementFromPoint(${x},${y}))})()`), `${id} is not hittable`);
            return { x, y };
        }
        async function move(id) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point(id) }); await settle(); }
        async function click(id) {
            await move(id);
            const p = await point(id);
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
            await delay(40);
        }
        async function tap(id) {
            const p = await point(id);
            await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, radiusX: 1, radiusY: 1, force: 1 }] });
            await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await delay(80);
        }
        async function key(key, code, virtualKey) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
            await settle();
        }
        async function state(expected) {
            const actual = await evaluate(`Array.from(document.querySelectorAll('#topmenu > li.dropdown'),li=>{const a=li.querySelector(':scope > a');const menu=li.querySelector(':scope > ul');return {open:getComputedStyle(menu).display!=='none',expanded:a.getAttribute('aria-expanded'),controls:!!menu.id&&a.getAttribute('aria-controls')===menu.id}})`);
            actual.forEach((item, i) => {
                assert.equal(item.open, expected[i], `group ${i} visibility`);
                assert.equal(item.expanded, String(expected[i]), `group ${i} aria-expanded`);
                assert.equal(item.controls, true, `group ${i} aria-controls`);
            });
            assert.equal(await evaluate('location.href'), url, 'menu toggle must not navigate, including a trailing #');
        }
        const focus = id => evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
        const active = () => evaluate('document.activeElement.id');

        for (const width of [1180, 768, 528]) {
            await load(width);
            await state([false, false, false]); // Even the active route is closed until clicked.
            assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#topmenu > li > a"), a => a.dataset.novaIcon)'), ['status', 'system', 'network', 'logout']);
            const iconSizes = await evaluate('Array.from(document.querySelectorAll(".nova-menu-icon"), s => {const r=s.getBoundingClientRect(); return [r.width,r.height,s.getAttribute("aria-hidden"),s.getAttribute("focusable")]})');
            for (const size of iconSizes) assert.deepEqual(size, [width > 900 ? 20 : 18, width > 900 ? 20 : 18, 'true', 'false']);
            const baseline = await rectangles();
            for (const id of ['status-toggle', 'system-toggle', 'network-toggle', 'leaf']) {
                await move(id);
                await state([false, false, false]);
                const hovered = await rectangles();
                baseline.forEach((r, i) => sameRect(r, hovered[i], `hover moved link ${i} at ${width}px`));
            }
            for (const id of ['status-toggle', 'system-toggle', 'network-toggle']) {
                const before = Object.values(await rect(id));
                await click(id);
                const index = ['status-toggle', 'system-toggle', 'network-toggle'].indexOf(id);
                await state([0, 1, 2].map(i => i === index));
                sameRect(before, Object.values(await rect(id)), `opening moved its control at ${width}px`);
                await point(id.replace('-toggle', '-first'));
                const geometry = await evaluate(`(()=>{const a=document.getElementById(${JSON.stringify(id)}), child=document.getElementById(${JSON.stringify(id.replace('-toggle', '-first'))});function textRect(e){const range=document.createRange();range.selectNodeContents([...e.childNodes].find(n=>n.nodeType===3&&n.textContent.trim()));const r=range.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}const r=a.getBoundingClientRect(),c=child.getBoundingClientRect(),icon=a.querySelector('svg').getBoundingClientRect(),arrow=getComputedStyle(a,'::after');return {label:textRect(a),child:textRect(child),right:r.right,iconRight:icon.right,arrowPosition:arrow.position,arrowRight:arrow.right,childRight:c.right,menuRight:child.closest('ul').getBoundingClientRect().right}})()`);
                assert.ok(geometry.label.left > geometry.iconRight, 'icon and label overlap');
                assert.equal(geometry.arrowPosition, 'absolute', 'Bootstrap inline triangle remains');
                assert.ok(geometry.label.right < geometry.right - parseFloat(geometry.arrowRight) - 6, 'arrow overlaps category label');
                assert.ok(geometry.childRight <= geometry.menuRight + 1, 'submenu padding overflows its container');
                if (width > 900) assert.ok(Math.abs(geometry.label.left - geometry.child.left) < 1, 'submenu text is not aligned with its parent label');
                if (width <= 900) {
                    assert.ok(await evaluate(`(()=>{const menu=document.getElementById(${JSON.stringify(id)}).nextElementSibling;const r=menu.getBoundingClientRect();const link=menu.querySelector('li:last-child a');const last=link.getBoundingClientRect();return r.bottom>document.querySelector('header').getBoundingClientRect().bottom&&link.contains(document.elementFromPoint(last.x+last.width/2,last.y+last.height/2))})()`), 'narrow submenu must be hittable beyond header bounds');
                }
                await click(id);
                await state([false, false, false]);
                assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).matches(':hover')`), true, 'pointer must remain over collapsed toggle');
                sameRect(before, Object.values(await rect(id)), 'repeated click moved its control');
            }
            await click('status-toggle');
            await click('system-toggle');
            await state([true, true, false]);
            await click('system-toggle');
            await state([true, false, false]);
            await click('outside');
            await state([false, false, false]);
            await focus('status-toggle');
            await key('Enter', 'Enter', 13);
            await state([true, false, false]);
            await key('Enter', 'Enter', 13);
            await state([false, false, false]);
            await key(' ', 'Space', 32);
            await state([true, false, false]);
            await key(' ', 'Space', 32);
            await state([false, false, false]);
            await key('ArrowDown', 'ArrowDown', 40);
            await state([true, false, false]);
            assert.equal(await active(), 'status-first', 'ArrowDown must focus first submenu link');
            await point('status-first'); // Keyboard opening must work without hover, including tablet widths.
            await key('Escape', 'Escape', 27);
            await state([false, false, false]);
            assert.equal(await active(), 'status-toggle', 'Escape must restore toggle focus');
            await key('ArrowDown', 'ArrowDown', 40);
            // Tab must be native and eventually leave the open group, not cycle inside it.
            let leftGroup = false;
            for (let i = 0; i < 5; i++) {
                await key('Tab', 'Tab', 9);
                if (await evaluate('!document.getElementById("status").contains(document.activeElement)')) { leftGroup = true; break; }
            }
            assert.ok(leftGroup, 'Tab was trapped in the dropdown');
            await click('outside');
            await click('leaf');
            await until('!!document.getElementById("destination") && location.search === "?from=top"', 'top-level leaf did not navigate normally');
        }
        await load(1180);
        await evaluate(`(()=>{const menu=document.getElementById('topmenu');menu.prepend(menu.lastElementChild);menu.insertAdjacentHTML('afterbegin','<li><a id="custom" href="/cgi-bin/luci/admin/custom">A long custom plugin name that wraps without hiding its icon</a></li><li><a id="dashboard" href="/cgi-bin/luci/admin/nova">仪表盘</a></li>')})()`);
        await until('document.querySelectorAll("#topmenu .nova-menu-icon").length===6', 'asynchronous added menu icons missing');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#topmenu > li > a"),a=>a.dataset.novaIcon)'), ['folder','dashboard','logout','status','system','network']);
        await evaluate(`(()=>{const menu=document.getElementById('topmenu');for(let i=0;i<4;i++){const marker=document.createElement('span');menu.append(marker);marker.remove()}})()`);
        await settle();
        assert.equal(await evaluate('document.querySelectorAll(".nova-menu-icon").length'), 6, 'observer duplicated icons');
        assert.equal(await evaluate('document.getElementById("custom").textContent'), 'A long custom plugin name that wraps without hiding its icon', 'SVG polluted accessible label');
        assert.ok(await evaluate(`(()=>{const a=document.getElementById('custom'),r=a.getBoundingClientRect(),icon=a.querySelector('svg').getBoundingClientRect();return icon.width===20 && icon.left>=r.left && icon.right<r.right && a.scrollWidth<=a.clientWidth})()`), 'long category label overflows or squashes its icon');
        await evaluate(`(()=>{const s=document.getElementById('nova-search');s.value='网络';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        assert.equal(await evaluate('document.getElementById("network").style.display'), '', 'page search must leave matching native menu groups visible');
        assert.equal(await evaluate('document.getElementById("system").style.display'), '', 'page search must not hide native menu groups');
        await load(528, true);
        await tap('network-toggle');
        await state([false, false, true]);
        await point('network-first');
        await tap('network-toggle');
        await state([false, false, false]);
        await tap('network-toggle');
        await state([false, false, true]);
        await tap('network-first');
        await until('!!document.getElementById("destination") && location.search === "?from=network"', 'touch submenu link did not navigate normally');
        console.log('Navigation passed: route icons, indentation, real hover/click and keyboard at 1180/768/528px; asynchronous reorder and touch at 528px.');
    } finally {
        await browser.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
