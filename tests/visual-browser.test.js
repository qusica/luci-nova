'use strict';
// Actual Nova rendering against explicitly synthetic data. These screenshots
// review visual hierarchy; they are not evidence of live router telemetry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const chromium = require('./helpers/chromium');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function fixture() {
    const theme = read('luci-theme-nova/htdocs/luci-static/nova/cascade.css');
    const lists = read('luci-theme-nova/htdocs/luci-static/nova/nova-lists.css');
    const shell = read('luci-theme-nova/htdocs/luci-static/nova/nova-shell.js');
    const dashboard = read('luci-app-nova-dashboard/htdocs/luci-static/resources/view/nova/dashboard.js');
    return `<!doctype html><html data-darkmode="true" lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0}ul{list-style:none;margin:0;padding:0}a{text-decoration:none;cursor:pointer}button{cursor:pointer}button,input{font-family:inherit}.cbi-value{padding:12px 0;display:flex;gap:20px;border-bottom:1px solid}.cbi-value-title{width:160px}.cbi-value-field{flex:1}.cbi-value input,.cbi-value select{padding:8px 10px;max-width:100%}.cbi-button{padding:8px 14px;border:1px solid #45576c;background:#202a35;color:#e9eef5}.table{width:100%;border-collapse:collapse}.table td,.table th{padding:12px;border-bottom:1px solid #303d4c;text-align:left}.table th{color:#a6b3c2;font-weight:500}.cbi-page-actions{display:flex;gap:10px;justify-content:flex-end}.cbi-tabmenu{display:flex;gap:20px;margin:0 0 20px}.cbi-tabmenu li{padding:8px}.cbi-value-description{font-size:12px;margin-top:5px}@media(max-width:640px){.cbi-value{display:block}.cbi-value-title{display:block;margin-bottom:8px}}
</style><style>${theme}\n${lists}</style>
<header><a class="brand" href="#"><span class="nova-brand-mark">N</span><span class="nova-brand-name">Nova</span></a><ul id="topmenu">
<li class="active"><a href="/cgi-bin/luci/admin/nova">Nova 仪表盘</a></li>
${[['status','状态'],['system','系统'],['network','网络']].map(([route,name])=>`<li class="dropdown"><a class="menu" href="#">${name}</a><ul class="dropdown-menu"><li><a href="/cgi-bin/luci/admin/${route}/overview">概览</a></li><li><a href="/cgi-bin/luci/admin/${route}/settings">设置</a></li></ul></li>`).join('')}
<li><a href="/cgi-bin/luci/admin/logout">退出</a></li></ul><div class="nova-sidebar-foot"><span class="nova-footer-dot">●</span> Nova for OpenWrt</div></header>
<div class="nova-topbar"><div class="nova-current-page">Nova 仪表盘</div><div class="nova-top-actions"><label class="nova-search-wrap"><span aria-hidden="true">⌕</span><input id="nova-search" type="search" placeholder="搜索菜单 / Search menu" aria-label="搜索菜单"></label><button class="nova-refresh" type="button"><span>↻</span>刷新</button><span class="nova-device"><span class="nova-live-dot">●</span>nova-lab · Design fixture</span><div id="indicators">刷新中</div></div></div>
<main id="maincontent" class="container"><div id="view"></div></main><footer>Nova · Quiet Slate / Synthetic design fixture, not live router data</footer>
<script>${shell}</script><script>
(async function(){try{
const mode = new URLSearchParams(location.search).get('case') || 'full';
const tags=['svg','polyline','line'];
function E(tag,attrs={},children=[]){const e=tags.includes(tag)?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(typeof value==='function')e.addEventListener(key,value);else if(typeof value==='boolean'){if(value)e.setAttribute(key,'');}else e.setAttribute(key,value);}for(const child of Array.isArray(children)?children:[children])e.append(child);return e;}
const wifi=(band,frequency,channel)=>({up:true,config:{band},interfaces:[{section:'wifi_'+band,ifname:'phy-'+band,config:{ssid:'Nova Studio'},iwinfo:{ssid:'Nova Studio',frequency,channel,txpower:20,noise:-94}}]});
const radios=mode==='full'?{radio0:wifi('2g',2437,6),radio1:wifi('5g',5180,36)}:{};
const polls=[];
const app=new Function('view','rpc','poll','fs','E','L','document',${JSON.stringify(dashboard)})(
{extend:x=>x},{declare:o=>(...args)=>{const key=o.object+'.'+o.method;
if(mode==='failed'&&(key==='network.interface.dump'||key==='network.wireless.status'))return Promise.reject(new Error('RPC call failed with ubus code 4'));
return Promise.resolve(key==='system.board'?{hostname:'nova-lab',model:'OpenWrt Router',release:{description:'OpenWrt 25.12.6'}}:key==='system.info'?{memory:{total:1073741824,available:734003200},root:{total:524288,used:131072},load:[12452]}:key==='network.interface.dump'?{interface:mode==='full'?[{interface:'internet',proto:'pppoe',up:true,l3_device:'pppoe-internet','ipv4-address':[{address:'203.0.113.8'}]},{interface:'lan',up:true,device:'br-lan'}]:[{interface:'lan',up:true,device:'br-lan'}]}:key==='network.wireless.status'||key==='luci-rpc.getWirelessDevices'?radios:key==='iwinfo.assoclist'?{results:[{signal:-52},{signal:-61},{signal:-67}]}:key==='uci.get'?{values:args[0]==='network'?{lan:{'.type':'interface',proto:'static',device:'br-lan'}}:{}}:key==='luci.getRealtimeStats'?Array.from({length:36},(_,i)=>[i*3,2000000+i*1800000+(i%5)*250000,0,200000+i*240000+(i%3)*40000]):{});
}},{add:fn=>polls.push(fn),remove:()=>{}},{read:p=>Promise.resolve(p==='/proc/stat'?'cpu 120 0 30 800 0 0 0 0 0 0':'45000')},E,{url:p=>'/cgi-bin/luci/'+p,resource:p=>new URL('dashboard.css',location.href).href},document);
const data=await app.load();document.querySelector('#view').append(app.render(data));
for(const fn of polls)await fn();
if(mode==='native'){document.querySelector('#view').replaceChildren();document.querySelector('.nova-current-page').textContent='系统';document.querySelector('#view').innerHTML='<h2>系统</h2><p class="cbi-map-descr">配置此设备的基本信息。</p><ul class="cbi-tabmenu"><li class="cbi-tab"><a>常规设置</a></li><li><a>时间同步</a></li><li><a>语言和界面</a></li></ul><section class="cbi-section"><h3>常规设置</h3><div class="cbi-value"><label class="cbi-value-title" for="host">主机名</label><div class="cbi-value-field"><input id="host" value="nova-lab"><div class="cbi-value-description">用于在网络中识别此设备。</div></div></div><div class="cbi-value"><label class="cbi-value-title" for="zone">时区</label><div class="cbi-value-field"><select id="zone"><option>Asia/Shanghai</option></select></div></div><div class="cbi-value"><label class="cbi-value-title" for="sync">启用 NTP 客户端</label><div class="cbi-value-field"><input id="sync" type="checkbox" checked></div></div></section><section class="cbi-section"><h3>接口状态</h3><table class="table"><tr><th>接口</th><th>协议</th><th>状态</th></tr><tr><td>internet</td><td>PPPoE</td><td>已连接</td></tr><tr><td>lan</td><td>静态地址</td><td>已连接</td></tr></table></section><div class="cbi-page-actions"><button class="cbi-button">重置</button><button class="cbi-button">保存</button><button class="cbi-button cbi-button-apply">保存并应用</button></div>';}
await new Promise(resolve=>{const link=document.querySelector('#nova-dashboard-style');if(link.sheet)resolve();else link.addEventListener('load',resolve,{once:true});});
window.visualReady=true;
}catch(e){window.visualError=e.message;}})();
</script></html>`;
}
function luminance(rgb) {
    const values=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
    return .2126*values[0]+.7152*values[1]+.0722*values[2];
}
test('Quiet Slate visual hierarchy, accessible contrast and responsive containment', {timeout:90000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nova-visual-'));
 fs.writeFileSync(path.join(dir,'index.html'),fixture());
 fs.copyFileSync(path.join(root,'luci-app-nova-dashboard/htdocs/luci-static/resources/nova/dashboard.css'),path.join(dir,'dashboard.css'));
 const browser=chromium(dir);
 try {
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params)=>browser.send(method,params,sessionId);
  await send('Page.enable');await send('Runtime.enable');
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  for(const width of [1440,1024,768,390,320])for(const scenario of ['full','failed','native']){
   await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await send('Page.navigate',{url:pathToFileURL(path.join(dir,'index.html')).href+'?case='+scenario});
   for(let i=0;i<100;i++){if(await evaluate('window.visualReady||window.visualError||false'))break;await new Promise(r=>setTimeout(r,30));}
   assert.equal(await evaluate('window.visualError'),undefined);
   assert.equal(await evaluate('window.visualReady'),true);
   const state=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,icons:[...document.querySelectorAll('.nv-icon')].every(e=>e.namespaceURI==='http://www.w3.org/2000/svg'&&e.getAttribute('aria-hidden')==='true'),palette:getComputedStyle(document.body).getPropertyValue('--nova-accent').trim(),metrics:document.querySelectorAll('.nv-metric').length,checks:[['.nv-metric-label','.nv-metric'],['.nv-metric-sub','.nv-metric'],['.nv-detection-warning','.nv-detection-warning'],['.nova-list-note','.nova-list-group'],['.nova-sidebar-foot','header']].filter(([a,b])=>document.querySelector(a)&&document.querySelector(b)).map(([a,b])=>({name:a,fg:getComputedStyle(document.querySelector(a)).color,bg:getComputedStyle(document.querySelector(b)).backgroundColor}))})`);
   assert.ok(state.scroll<=state.width+1,`${width}/${scenario} page overflow: ${JSON.stringify(state)}`);
   assert.ok(state.icons);assert.equal(state.palette,'#9bc1f1');
   if(scenario==='failed')assert.equal(state.metrics,3,'failed inventory invents metric cards');
   for(const check of state.checks){const a=luminance(check.fg),b=luminance(check.bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${check.name} contrast at ${width}`);}
   if(process.env.NOVA_SCREENSHOT_DIR&&[1440,390].includes(width)){
    fs.mkdirSync(process.env.NOVA_SCREENSHOT_DIR,{recursive:true});
    const {contentSize}=await send('Page.getLayoutMetrics');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:contentSize.width,height:contentSize.height,scale:1}});
    fs.writeFileSync(path.join(process.env.NOVA_SCREENSHOT_DIR,`quiet-slate-${scenario}-${width}.png`),Buffer.from(shot.data,'base64'));
   }
   console.log(`${width}/${scenario}: contained, decorative icons, AA small-text contrast`);
  }
 } finally {await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
