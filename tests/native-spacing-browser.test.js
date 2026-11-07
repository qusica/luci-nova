'use strict';
// Faithful native markup and upstream Bootstrap, with synthetic values only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const chromium = require('./helpers/chromium');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function fixture() {
 const row = (id, title, contents) => `<div class="cbi-value" id="row-${id}"><label class="cbi-value-title" for="${id}">${title}</label><div class="cbi-value-field">${contents}</div></div>`;
 return `<!doctype html><html data-darkmode="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <style>${read('tests/fixtures/bootstrap/cascade.css')}</style>
 <style media="only screen and (max-device-width:854px)">${read('tests/fixtures/bootstrap/mobile.css')}</style>
 <style>${read('luci-theme-nova/htdocs/luci-static/nova/cascade.css')}</style>
 <!-- The package manager injects this native rule after theme styles. -->
 <style>.td.version,.td.size{white-space:nowrap}</style>
 <body><header id="native-header"><a class="brand" href="#"><span class="nova-brand-mark">N</span><span class="nova-brand-name">Nova</span></a><span class="nova-hostname">nova-test</span><ul class="nav" id="topmenu"><li class="active"><a href="#">Nova 仪表盘</a></li><li class="dropdown"><a class="menu" href="#">状态</a><ul class="dropdown-menu"><li><a href="#">概览</a></li></ul></li><li class="dropdown"><a class="menu" href="#">系统</a><ul class="dropdown-menu"><li><a href="#">系统设置</a></li></ul></li><li class="dropdown"><a class="menu" href="#">网络</a></li><li><a href="#">退出</a></li></ul></header>
 <div class="nova-topbar"><div class="nova-current-page">系统</div><div class="nova-top-actions"><label class="nova-search-wrap"><span>⌕</span><input type="search" placeholder="搜索菜单"></label><button class="nova-refresh">刷新</button></div></div>
 <main id="maincontent" class="container"><div id="view"><div class="cbi-map" id="system-map">
 <h2 id="page-title">系统</h2><div class="cbi-map-descr" id="page-description">此处配置设备的基本信息，如主机名、时区。</div>
 <div class="cbi-section" id="properties"><h3 id="section-title">系统属性</h3>
 <ul class="cbi-tabmenu" id="system-tabs"><li class="cbi-tab"><a href="#general" data-target="general">通用设置</a></li><li class="cbi-tab-disabled"><a href="#logging" data-target="logging">日志记录</a></li><li class="cbi-tab-disabled"><a href="#timesync" data-target="timesync">时间同步</a></li><li class="cbi-tab-disabled"><a href="#language" data-target="language">语言和界面</a></li></ul>
 <div class="cbi-section-node cbi-section-node-tabbed">
 <div id="general" data-tab="general" data-tab-title="通用设置" data-tab-active="true">
 ${row('localtime','本地时间','<input id="localtime" type="text" readonly value="2026年11月7日 GMT+8 21:54:39"><br><span class="control-group" id="time-actions"><button class="cbi-button cbi-button-apply">与浏览器同步</button> <button class="cbi-button cbi-button-apply">与 NTP 服务器同步</button></span>')}
 ${row('hostname','主机名','<input id="hostname" type="text" value="nova-test"><div class="cbi-value-description">用于在网络中识别此设备。</div>')}
 ${row('password','管理密码','<span class="control-group" id="joined"><input id="password" type="password" value="fixture-only"><button class="cbi-button" type="button">显示</button></span>')}
 ${row('dns','DNS 服务器','<div class="cbi-dynlist"><div class="item" tabindex="0" data-value="192.0.2.1">192.0.2.1</div><div class="add-item"><input id="dns" type="text"><button class="cbi-button cbi-button-add" type="button">+</button></div></div>')}
 ${row('notes','备注','<textarea id="notes" rows="3">Synthetic notes for layout verification.</textarea>')}
 <div class="cbi-value hidden" id="dependency-hidden"><label>隐藏依赖项</label><input></div>
 <div class="cbi-value" id="nested-row"><div class="cbi-section" id="nested-section"><h3>高级选项</h3><div class="cbi-section-descr">仅影响此接口。</div>${row('mtu','MTU','<input id="mtu" type="number" value="1500">')}</div></div>
 </div>
 <div id="logging" data-tab="logging" data-tab-title="日志记录"><div class="cbi-tab-descr">配置日志记录。</div>${row('logsize','日志缓冲区大小','<input id="logsize" type="number" value="64">')}</div>
 <div id="timesync" data-tab="timesync" data-tab-title="时间同步">时间同步配置</div><div id="language" data-tab="language" data-tab-title="语言和界面">语言配置</div>
 </div></div>
 <div class="cbi-map-tabbed" id="map-tabs"><div class="cbi-section" data-tab-title="当前" data-tab-active="true" id="active-map-tab"><h3>当前配置</h3><p>可见的配置内容。</p></div><div class="cbi-section" data-tab-title="隐藏" id="hidden-map-tab"><h3>隐藏的配置</h3><p>不应占用留白。</p></div></div>
 <div class="cbi-section" id="table-section"><h3>接口状态</h3><table class="table"><tr class="tr table-titles"><th class="th">接口</th><th class="th">状态</th><th class="th">操作</th></tr><tr class="tr"><td class="td" data-title="接口">lan</td><td class="td" data-title="状态">已连接</td><td class="td cbi-section-actions"><button class="cbi-button">编辑</button></td></tr></table></div>
 <div class="cbi-section" id="content_syslog"><h3>系统日志</h3><textarea id="syslog" rows="90" readonly wrap="off">${Array.from({length:100},(_,i)=>'Synthetic log '+i+' '+ 'long-unbroken-log-value'.repeat(20)).join('\n')}</textarea></div>
 <div class="cbi-section" id="packages-section"><h3>软件包</h3><div class="table" id="packages"><div class="tr table-titles"><div class="th">软件包名称</div><div class="th">版本</div><div class="th">大小</div><div class="th">描述</div><div class="th">操作</div></div><div class="tr"><div class="td">luci-app-synthetic-package-with-long-generated-name-abcdefghijklmnopqrstuv</div><div class="td version">25.12.6-r20261107~abcdef0123456789abcdef0123456789abcdef0123456789-r1</div><div class="td size">123456 KiB</div><div class="td">Synthetic package description with https://example.invalid/verylongunbrokendescriptorabcdefghijklmnopqrstuvwxyz0123456789 and ordinary readable text.</div><div class="td cbi-section-actions"><button class="cbi-button cbi-button-action">安装</button></div></div></div></div>
 </div><div class="cbi-page-actions" id="page-actions"><button class="cbi-button">重置</button> <button class="cbi-button">保存</button> <button class="cbi-button cbi-button-apply">保存并应用</button></div></div></main>
 <div id="modal_overlay"><div class="modal cbi-modal"><h4>编辑接口</h4><div class="cbi-map"><div class="cbi-section">${row('modal-host','主机名','<input id="modal-host" type="text" value="test">')}</div></div><div class="button-row"><button class="cbi-button" id="close-modal">取消</button><button class="cbi-button cbi-button-apply">保存</button></div></div></div>
 <script>document.querySelectorAll('[data-target]').forEach(a=>a.onclick=e=>{e.preventDefault();document.querySelectorAll('.cbi-section-node-tabbed > [data-tab]').forEach(p=>p.setAttribute('data-tab-active',String(p.id===a.dataset.target)));document.querySelectorAll('#system-tabs li').forEach(li=>li.className=li.contains(a)?'cbi-tab':'cbi-tab-disabled');});document.querySelector('#close-modal').onclick=()=>document.body.classList.remove('modal-overlay-active');</script></body></html>`;
}

test('native Bootstrap spacing, hidden panels and real mobile containment', { timeout: 90000 }, async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-native-spacing-'));
 fs.writeFileSync(path.join(dir, 'index.html'), fixture());
 const browser = chromium(dir), failures = [];
 try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const check = (ok, label, state) => { if (!ok) failures.push(`${label}: ${JSON.stringify(state)}`); };
  for (const width of [1440, 1024, 768, 390, 320]) {
   const mobile = width < 600;
   await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, screenWidth: width, screenHeight: 1000, deviceScaleFactor: 1, mobile });
   await send('Page.navigate', { url: pathToFileURL(path.join(dir, 'index.html')).href });
   for (let i = 0; i < 100; i++) { if (await evaluate("document.readyState==='complete' && !!document.querySelector('#time-actions')")) break; await new Promise(r => setTimeout(r, 20)); }
   const state = await evaluate(`(()=>{const r=id=>document.querySelector(id).getBoundingClientRect();const h=id=>r(id).height;return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,mobile:matchMedia('(max-device-width:600px)').matches,titleGap:r('#page-description').top-r('#page-title').bottom,descriptionGap:r('#properties').top-r('#page-description').bottom,headingGap:r('#system-tabs').top-r('#section-title').bottom,timeGap:r('#time-actions').top-r('#localtime').bottom,timeButtonGap:(()=>{let b=document.querySelectorAll('#time-actions button');return b[1].getBoundingClientRect().left-b[0].getBoundingClientRect().right;})(),hidden:h('#hidden-map-tab'),dependency:h('#dependency-hidden'),sectionGap:r('#content_syslog').top-r('#table-section').bottom,joined:(()=>{let b=document.querySelectorAll('#joined > *');return b[1].getBoundingClientRect().left-b[0].getBoundingClientRect().right;})(),tabs:[...document.querySelectorAll('#system-tabs a')].map(e=>e.getBoundingClientRect().height),overflow:[...document.querySelectorAll('#general input,#general textarea,#general .control-group,#page-actions button,#syslog')].filter(e=>{const b=e.getBoundingClientRect();return b.right>innerWidth+1||b.left<0}).map(e=>e.id||e.className)}})()`);
   console.log(`${width}: ${JSON.stringify(state)}`);
   check(state.mobile === mobile, `${width} true device media`, state);
   check(state.scroll <= state.width + 1 && state.overflow.length === 0, `${width} containment`, state);
   check(state.titleGap >= 7.5 && state.descriptionGap >= 15.5 && state.headingGap >= 7.5, `${width} heading rhythm`, state);
   check(state.timeGap >= 7.5, `${width} time actions vertical gap`, state);
   // At narrow widths buttons may wrap; vertical separation is checked below.
   check(state.timeButtonGap >= 7.5 || state.timeButtonGap < -1, `${width} time actions horizontal gap`, state);
   check(state.hidden <= 1 && state.dependency === 0, `${width} hidden panels consume no space`, state);
   check(state.sectionGap >= 15.5, `${width} section rhythm`, state);
   check(state.joined <= 1, `${width} joined input/button retained`, state);
   check(state.tabs.every(h=>h>=38), `${width} tab targets`, state);
   const shell = await evaluate(`(()=>{const h=document.querySelector('header'),r=h.getBoundingClientRect(),b=document.querySelector('header .brand'),br=b.getBoundingClientRect(),s=getComputedStyle(h);return {left:r.left,right:r.right,top:r.top,width:innerWidth,margin:s.margin,brand:getComputedStyle(b).display,brandHeight:br.height};})()`);
   check(shell.left >= 0 && shell.right <= shell.width + 1 && shell.top === 0 && shell.margin === '0px', `${width} header contains no inherited negative margins`, shell);
   check(shell.brand !== 'none' && shell.brandHeight > 0, `${width} brand remains visible with mobile stylesheet`, shell);
   for (const rows of [90, 1]) {
    const log = await evaluate(`(()=>{const e=document.querySelector('#syslog');e.rows=${rows};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {height:r.height,left:r.left,right:r.right,width:innerWidth,viewport:innerHeight,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,overflow:s.overflow,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,readonly:e.readOnly,wrap:e.wrap};})()`);
    check(log.height >= 240 && log.height <= log.viewport * .6 + 1, `${width} ${rows}-row log bounded usable height`, log);
    check(log.left >= 0 && log.right <= log.width + 1 && log.scroll <= log.client + 1 && log.overflow === 'auto' && log.scrollHeight > log.clientHeight && log.readonly && log.wrap === 'off', `${width} ${rows}-row log scroll remains inside readonly viewer`, log);
   }
   await evaluate("document.querySelector('#syslog').rows=90");
   const packages = await evaluate(`(()=>{const e=document.querySelector('#packages'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,cells:[...e.querySelectorAll('.td')].map(c=>({width:c.getBoundingClientRect().width,scroll:c.scrollWidth,client:c.clientWidth})),versions:[...e.querySelectorAll('.td.version,.td.size')].map(c=>getComputedStyle(c).whiteSpace),button:!!e.querySelector('button')};})()`);
   check(packages.left >= 0 && packages.right <= packages.width + 1 && packages.scroll <= packages.client + 1 && packages.cells.every(c=>c.width>0&&c.scroll<=c.client+1) && packages.versions.every(s=>s==='normal') && packages.button, `${width} long package cells and actions remain contained`, packages);
   const wrapping = await evaluate(`(()=>{const buttons=[...document.querySelectorAll('#time-actions button,#page-actions button')];return buttons.every((b,i)=>{if(!i||b.parentElement!==buttons[i-1].parentElement)return true;const p=buttons[i-1].getBoundingClientRect(),r=b.getBoundingClientRect();return r.top<p.bottom-1||r.top-p.bottom>=7.5;});})()`);
   check(wrapping, `${width} wrapped button rows need gap`, state);
   if (process.env.NOVA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.NOVA_SCREENSHOT_DIR, { recursive: true });
    const { contentSize } = await send('Page.getLayoutMetrics');
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 } });
    fs.writeFileSync(path.join(process.env.NOVA_SCREENSHOT_DIR, `native-spacing-${width}.png`), Buffer.from(shot.data, 'base64'));
   }
   for (const target of ['logging', 'general', 'logging', 'general']) {
    const visibility = await evaluate(`(()=>{document.querySelector('[data-target="${target}"]').click();return [...document.querySelectorAll('.cbi-section-node-tabbed > [data-tab]')].map(e=>({id:e.id,height:e.getBoundingClientRect().height,active:e.getAttribute('data-tab-active')}));})()`);
    check(visibility.every(p => p.id === target ? p.height > 0 && p.active === 'true' : p.height <= 1), `${width} native tab switch ${target}`, visibility);
   }
   const modal = await evaluate(`(()=>{document.body.classList.add('modal-overlay-active');const e=document.querySelector('.modal'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:e.scrollWidth,client:e.clientWidth};})()`);
   check(modal.left >= 0 && modal.right <= modal.width + 1 && modal.scroll <= modal.client + 1, `${width} modal containment`, modal);
   await evaluate("document.querySelector('#close-modal').click()");
   check(await evaluate("!document.body.classList.contains('modal-overlay-active')"), `${width} modal dismissal`, {});
  }
  assert.deepEqual(failures, [], failures.join('\n'));
 } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// The APK runner intentionally stages extracted browser assets, not templates.
const headerPath = path.join(root, 'luci-theme-nova/ucode/template/themes/nova/header.ut');
test('source header loads Bootstrap mobile before Nova overrides', { skip: !fs.existsSync(headerPath) }, () => {
 const source = fs.readFileSync(headerPath, 'utf8');
 const base = source.indexOf('href="/luci-static/bootstrap/cascade.css"');
 const mobile = source.indexOf('href="/luci-static/bootstrap/mobile.css"');
 const nova = source.indexOf('href="{{ media }}/cascade.css"');
 assert.ok(base >= 0 && mobile > base && nova > mobile, 'Base cascade and mobile must precede Nova so device media cannot undo spacing');
});
