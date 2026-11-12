'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const chromium = require('./helpers/chromium');
const root = path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture() {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/cascade.css">
    <header><a class="brand" href="/index"><span class="nova-brand-mark">N</span>Nova</a><ul id="topmenu" class="nav"><li><a href="#">网络</a><ul class="dropdown-menu"><li><a href="/custom/luci/admin/network/interfaces">接口</a></li></ul></li><li><a href="/custom/luci/admin/status/overview">概览</a></li></ul></header>
    <div class="nova-topbar"><div class="nova-current-page">概览</div><div class="nova-top-actions"><div class="nova-page-search"><label class="nova-search-wrap"><span>⌕</span><input id="nova-search" type="search" autocomplete="off"></label></div><button class="nova-refresh" id="outside">刷新</button><span class="nova-device">Router · OpenWrt</span></div></div>
    <main id="maincontent"><input id="editor" value="Existing unsaved value"><p>Native page content stays intact.</p></main>
    <script>
    window.menuLoads=0;
    window.installLuCI=function(){
      const page=(title,extra={})=>({title,satisfied:true,action:{type:'view'},...extra});
      const group=(title,children)=>page(title,{action:{type:'firstchild'},children});
      const extra={};for(let i=0;i<70;i++)extra['plugin'+i]=page('插件 '+i);
      const tree={children:{admin:group('Administration',{
        status:group('Status',{overview:page('Overview')}),network:group('Network',{
          interfaces:page('Interfaces'),firewall:group('Firewall',{rules:page('Rules'),zones:page('Zones')})}),
        services:group('Services',extra),malicious:page('<img src=x onerror="window.injected=true">'),
        denied:page('Forbidden secret',{satisfied:false}),hidden:{satisfied:true,action:{type:'view'}},logout:page('Logout')})}};
      window._=s=>({Administration:'管理',Status:'状态',Overview:'概览',Network:'网络',Interfaces:'接口',Firewall:'防火墙',Rules:'规则',Zones:'区域'}[s]||s);
      const menu={getChildren:n=>Object.entries(n.children||{}).filter(([,c])=>c.satisfied&&Object.hasOwn(c,'title')).map(([name,c])=>({...c,name})),load:()=>{window.menuLoads++;return new Promise((resolve,reject)=>{window.resolveMenu=()=>resolve(tree);window.rejectMenu=()=>reject(new Error('fixture menu unavailable'))})}};
      window.L={require:()=>Promise.resolve({menu}),url:(...parts)=>'/custom/luci/'+parts.map(encodeURIComponent).join('/')};
      document.dispatchEvent(new Event('luci-loaded'));
    };
    </script><script src="/nova-shell.js"></script><script src="/nova-search.js"></script></html>`;
}

test('global search loads ACL-filtered deep pages and supports real keyboard, pointer, touch and interrupted flows', { timeout: 120000 }, async () => {
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/custom/luci/')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1 id="destination">Native destination</h1>'); return; }
        if (req.url === '/cascade.css' || req.url === '/nova-shell.js' || req.url === '/nova-search.js') {
            res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/index`;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-page-search-'));
    const browser = chromium(temp);
    try {
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params = {}) => browser.send(method, params, sessionId);
        await send('Page.enable');
        async function evaluate(expression) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
            return r.result.value;
        }
        async function until(expression, message) {
            for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30); }
            assert.fail(message);
        }
        async function key(key, code, vk, modifiers = 0) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
        }
        async function query(value) {
            await evaluate("document.getElementById('nova-search').focus();document.getElementById('nova-search').select()");
            await send('Input.insertText', { text: value });
        }
        async function click(selector, touch = false) {
            const p = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))throw new Error('Target is obscured');return {x,y}})()`);
            if (touch) {
                await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, radiusX: 1, radiusY: 1, force: 1 }] });
                await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } else {
                await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
                await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
            }
        }
        const panelOpen = () => evaluate("!document.querySelector('.nova-search-panel').hidden");
        const titles = () => evaluate("Array.from(document.querySelectorAll('.nova-search-title'),e=>e.textContent)");
        const selected = () => evaluate("document.getElementById('nova-search').getAttribute('aria-activedescendant')");
        async function load(width, touch = false) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: touch });
            await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
            await send('Page.navigate', { url });
            await until("!!document.querySelector('.nova-search-panel')", 'search did not mount');
            await evaluate('window.installLuCI()');
            await until('!!window.resolveMenu', 'menu load did not start');
            await evaluate('window.resolveMenu()');
        }
        // User can type before LuCI and its asynchronous menu arrive.
        await send('Page.navigate', { url });
        await until("!!document.querySelector('.nova-search-panel')", 'search did not mount');
        await query('规则');
        assert.match(await evaluate("document.querySelector('.nova-search-status').textContent"), /加载/);
        await evaluate('window.installLuCI()');
        await until('!!window.resolveMenu', 'late LuCI was not picked up');
        await key('Escape', 'Escape', 27);
        await evaluate('window.resolveMenu()');
        await delay(30);
        assert.equal(await panelOpen(), false, 'late menu completion reopened a dismissed search');
        await click('#nova-search');
        assert.deepEqual(await titles(), ['规则']);
        assert.equal(await evaluate("document.querySelector('.nova-search-path').textContent"), '网络 › 防火墙 › 规则');
        assert.equal(await evaluate("document.querySelector('#nova-search-results a').getAttribute('href')"), '/custom/luci/admin/network/firewall/rules');
        assert.equal(await evaluate("document.querySelectorAll('#topmenu>li:not([style*=" + JSON.stringify('display: none') + "])').length"), 2);
        assert.equal(await evaluate("document.getElementById('nova-search').getAttribute('role')"), 'combobox');
        // IME Enter confirms composition and must not open the selected page.
        await evaluate("document.getElementById('nova-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))");
        assert.equal(await evaluate('location.href'), url);
        await key('Enter', 'Enter', 13);
        await until("location.pathname==='/custom/luci/admin/network/firewall/rules'", 'Enter did not navigate to the deep page');
        const history = await send('Page.getNavigationHistory');
        await send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id });
        await until("!!document.querySelector('.nova-search-panel')", 'Back did not restore page');
        assert.equal(await panelOpen(), false, 'Back restored a stale popup');

        for (const width of [1280, 1024, 901, 768, 640, 360, 320]) {
            await load(width, width <= 640);
            await evaluate("document.getElementById('editor').focus()");
            await key('k', 'KeyK', 75, width === 1280 ? 4 : 2); // Cmd on one pass, Ctrl elsewhere.
            assert.equal(await evaluate('document.activeElement.id'), 'nova-search');
            await send('Input.insertText', { text: 'network' });
            await until("document.querySelectorAll('#nova-search-results a').length===3", 'English route/title search failed');
            assert.equal(await selected(), 'nova-search-option-0');
            await key('ArrowDown', 'ArrowDown', 40);
            assert.equal(await selected(), 'nova-search-option-1');
            await key('ArrowUp', 'ArrowUp', 38);
            assert.equal(await selected(), 'nova-search-option-0');
            await key('ArrowUp', 'ArrowUp', 38);
            assert.equal(await selected(), 'nova-search-option-2', 'ArrowUp must wrap without focus loss');
            assert.equal(await evaluate('document.activeElement.id'), 'nova-search');
            assert.ok(await evaluate("(()=>{const r=document.querySelector('.nova-search-panel').getBoundingClientRect();return r.left>=0&&r.right<=document.documentElement.clientWidth&&r.bottom<=innerHeight+1})()"), `search escapes viewport at ${width}px`);
            assert.ok(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), `horizontal overflow at ${width}px`);
            await key('Escape', 'Escape', 27);
            assert.equal(await panelOpen(), false);
            assert.equal(await evaluate('document.activeElement.id'), 'editor', 'Escape did not restore shortcut origin');
            assert.equal(await evaluate('location.href'), url, 'dismissal changed URL/history');
            assert.equal(await evaluate("document.getElementById('editor').value"), 'Existing unsaved value');
            await query('防火墙 rules');
            assert.deepEqual(await titles(), ['规则']);
            await key('Tab', 'Tab', 9);
            assert.equal(await panelOpen(), false, 'Tab trapped focus or left stale popup');
            assert.equal(await evaluate('document.activeElement.id'), 'outside');
            await query('nothing-matches');
            assert.match(await evaluate("document.querySelector('.nova-search-status').textContent"), /没有匹配/);
            assert.equal(await selected(), null);
            await key('Enter', 'Enter', 13);
            assert.equal(await evaluate('location.href'), url);
            await click('#outside', width <= 640);
            assert.equal(await panelOpen(), false, 'outside pointer/touch must dismiss search');
            await query('network');
            assert.equal(await evaluate('window.menuLoads'), 1, 'queries must not trigger RPC polling');
            await click('#nova-search-results a', width <= 640);
            await until("location.pathname==='/custom/luci/admin/network/interfaces'", 'pointer/touch did not navigate');
        }
        await load(1280);
        await query('插件');
        assert.equal((await titles()).length, 50);
        assert.match(await evaluate("document.querySelector('.nova-search-status').textContent"), /50/);
        for (let i = 0; i < 45; i++) await key('ArrowDown', 'ArrowDown', 40);
        assert.ok(await evaluate("document.querySelector('.nova-search-panel').scrollTop>0"), 'selected results do not scroll into view');
        await query('<img');
        assert.equal(await evaluate("document.querySelectorAll('.nova-search-panel img').length"), 0, 'menu label became HTML');
        assert.equal(await evaluate('!!window.injected'), false);
        await query('Forbidden');
        assert.deepEqual(await titles(), []);
        await query('logout');
        assert.deepEqual(await titles(), []);
        await evaluate("document.getElementById('nova-search').value='';document.getElementById('nova-search').dispatchEvent(new Event('input'))");
        assert.deepEqual(await titles(), []);
        assert.match(await evaluate("document.querySelector('.nova-search-status').textContent"), /Ctrl/);
        await key('Escape', 'Escape', 27);
        await evaluate("document.getElementById('editor').focus();document.body.classList.add('modal-overlay-active')");
        await key('k', 'KeyK', 75, 2);
        assert.equal(await evaluate('document.activeElement.id'), 'editor', 'shortcut stole focus from a native modal');

        // Failure leaves native navigation available and no stale search choices.
        await send('Page.navigate', { url });
        await until("!!document.querySelector('.nova-search-panel')", 'failure fixture did not mount');
        await evaluate('window.installLuCI()');
        await until('!!window.rejectMenu', 'failure fixture did not load');
        await query('overview');
        await evaluate('window.rejectMenu()');
        await until("document.querySelector('.nova-search-status').textContent.includes('暂不可用')", 'failure state was not visible');
        assert.deepEqual(await titles(), []);
        await click('#topmenu>li:last-child a');
        await until("location.pathname==='/custom/luci/admin/status/overview'", 'search failure broke native navigation');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
