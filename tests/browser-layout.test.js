'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Requires an installed Chromium/Chrome, but no npm packages or network access.
// This is an isolated CSS/DOM fixture, not a full LuCI integration test.
test('dashboard grids and narrow navigation render in Chromium', () => {
    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'luci-app-nova-dashboard/htdocs/luci-static/resources/view/nova/dashboard.js'), 'utf8');
    const theme = fs.readFileSync(path.join(root, 'luci-theme-nova/htdocs/luci-static/nova/cascade.css'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'luci-app-nova-dashboard/htdocs/luci-static/resources/nova/dashboard.css'), 'utf8');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-layout-'));
    try {
        fs.writeFileSync(path.join(temporary, 'dashboard.css'), dashboard);
        fs.writeFileSync(path.join(temporary, 'old-dashboard.css'), '.nova-dashboard .nova-grid{display:grid}');
        const dashboardUrl = pathToFileURL(path.join(temporary, 'dashboard.css')).href;
        const child = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}ul{list-style:none}#topmenu{position:relative}.dropdown-menu{list-style:none}a{cursor:pointer}</style>
<style>${theme}</style>
<!-- Simulate a stylesheet left behind by the previous dashboard view. -->
<link id="nova-dashboard-style" rel="stylesheet" href="old-dashboard.css">
<header><a class="brand"><span class="nova-brand-mark">N</span><span>Nova</span></a>
<ul id="topmenu"><li><a>仪表盘</a></li><li class="dropdown open"><a>状态</a><ul class="dropdown-menu" id="status-menu">
${['概览','路由表','防火墙','内核日志','进程','实时信息'].map(name => '<li><a>'+name+'</a></li>').join('')}
</ul></li><li><a>系统</a></li><li><a>网络</a></li><li><a>退出</a></li></ul></header>
<div class="nova-topbar">Local fixture</div><div id="maincontent" class="container"></div>
<script>
(async function(){
const scenario=new URLSearchParams(location.search).get('case') || 'empty';
try {
    function E(tag,attrs={},children=[]) {
        // LuCI dom.create does not infer an SVG namespace.
        const e=document.createElement(tag);
        for(const [name,value] of Object.entries(attrs)) {
            if(typeof value==='function')e.addEventListener(name,value);
            else if(typeof value==='boolean'){if(value)e.setAttribute(name,'');}
            else e.setAttribute(name,value);
        }
        // Match LuCI 25.12 dom.append: null inside an array becomes text.
        for(const child of Array.isArray(children)?children:[children])e.append(child);
        return e;
    }
    const lan={interface:'lan',up:true,device:'br-home'};
    const ppp={interface:'internet',proto:'pppoe',up:false,device:'eth1'};
    const wifi=(band,frequency,channel)=>({up:true,disabled:false,config:{band},interfaces:[{
        section:'default_'+band,ifname:'phy-'+band,config:{ssid:'Test '+band},iwinfo:{frequency,channel,ssid:'Test '+band}
    }]});
    let interfaces=scenario==='lan'?[lan]:scenario==='pppoe'?[ppp]:scenario==='dual'?[{...ppp,up:true,l3_device:'pppoe-internet'},lan]:[];
    const wireless=scenario==='dual'?{radio0:wifi('2g',2462,11),radio1:wifi('5g',5180,36),radio2:wifi('6g',5955,1)}:
        scenario==='disabled'?{radio1:{up:false,disabled:true,config:{band:'5g'},interfaces:[]}}:{};
    const polls=new Set(),samples=[];
    let runtimeFailed=scenario==='failed'||scenario==='configured';
    const app=new Function('view','rpc','poll','fs','E','L','document',${JSON.stringify(source)})(
        {extend:x=>x},{declare:options=>(...args)=>{
            const key=options.object+'.'+options.method;
            if(runtimeFailed&&(key==='network.interface.dump'||key==='network.wireless.status'))return Promise.reject(new Error('RPC call failed with ubus code 4: 未找到'));
            if(key==='uci.get')return Promise.resolve(scenario==='configured'?{values:args[0]==='network'?{
                lan:{'.type':'interface',device:'br-home',proto:'static'},internet:{'.type':'interface',device:'eth1',proto:'pppoe',password:'private-never-render'}
            }:{radio0:{'.type':'wifi-device',band:'5g',disabled:'1'}}}:{});
            if(key==='luci.getRealtimeStats')samples.push(args);
            return Promise.resolve(key==='system.board'?{hostname:'local-fixture',release:{description:'OpenWrt fixture'}}:
                key==='network.interface.dump'?{interface:interfaces}:key==='network.wireless.status'||key==='luci-rpc.getWirelessDevices'?structuredClone(wireless):
                key==='iwinfo.assoclist'?{results:[]}:key==='luci.getRealtimeStats'?[[1,100,0,50],[4,400,0,200]]:{});
        }},{add:fn=>polls.add(fn),remove:fn=>polls.delete(fn)},{read:()=>Promise.resolve(null)},E,
        {url:x=>'/cgi-bin/luci/'+x,resource:x=>${JSON.stringify(dashboardUrl)}},document);
    const data=await app.load();
    const stylesheet=document.getElementById('nova-dashboard-style');
    const expectedHref=${JSON.stringify(dashboardUrl)}+'?v=0.2.8';
    const styleLoaded=new Promise((resolve,reject)=>{
        function loaded(){
            if(stylesheet.getAttribute('href')===expectedHref && stylesheet.sheet && stylesheet.sheet.href===expectedHref){
                stylesheet.removeEventListener('load',loaded);resolve();
            }
        }
        stylesheet.addEventListener('load',loaded);
        stylesheet.addEventListener('error',()=>reject(new Error('versioned dashboard CSS failed to load')),{once:true});
    });
    document.getElementById('maincontent').append(app.render(data));
    await styleLoaded;
    function check(condition,message){if(!condition)throw new Error(message);}
    check(stylesheet.getAttribute('href')===${JSON.stringify(dashboardUrl)}+'?v=0.2.8','stale CSS link was not upgraded');
    check(!/null|undefined/.test(document.querySelector('.nova-dashboard').textContent),'conditional DOM entries leaked literal null/undefined');
    const vectorNodes=[...document.querySelectorAll('.nova-dashboard svg,.nova-dashboard svg *')];
    check(vectorNodes.length>0 && vectorNodes.every(n=>n.namespaceURI==='http://www.w3.org/2000/svg'),'SVG must use native SVG namespace, not a fixture repair');
    check([...document.querySelectorAll('.nv-icon')].every(n=>n.viewBox.baseVal.width===24 && n.getBBox().width>0 && n.getBBox().height>0),'decorative SVG has no rendered geometry');
    const width=window.innerWidth;
    const expected=scenario==='dual'||scenario==='configured'?6:scenario==='disabled'?5:scenario==='pppoe'?4:3;
    const grid=getComputedStyle(document.querySelector('.nv-metric-grid'));
    check(grid.display==='grid','dashboard metric layout is not grid');
    const columns=grid.gridTemplateColumns.split(' ').filter(v=>parseFloat(v)>0).length;
    check(columns>=1 && columns<=expected,'wrong visible metric column count at '+width);
    if(width<=530)check(columns===1,'mobile metric layout must be one column');
    check(document.querySelectorAll('.nv-metric').length===expected,'missing-interface fixture retains fake interface metrics');
    if(scenario==='empty'||scenario==='failed')check(!document.querySelector('.nv-wifi,.nv-internet,.nv-traffic,.nv-wireline,.nv-fork,.nv-radio'),'empty inventory retains fake topology/card');
    if(scenario==='lan')check(!document.querySelector('.nv-wifi,.nv-internet,.nv-traffic,.nv-wireline'),'LAN-only inventory has phantom WAN or wireless');
    if(scenario==='disabled'){
        check(document.querySelectorAll('.nv-wifi').length===1,'disabled radio card lost');
        check(document.querySelector('.nv-wifi').textContent.includes('已禁用'),'disabled radio status missing');
        check(!document.querySelector('.nv-internet,.nv-traffic'),'disabled-only fixture adds a WAN');
    }
    if(scenario==='failed'||scenario==='configured')check(document.querySelector('.nv-detection-warning'),'detection error is hidden');
    if(scenario==='configured'){
        check(document.querySelectorAll('.nv-wifi').length===1,'configured radio lost');
        check(document.querySelector('.nv-wifi').textContent.includes('已禁用（配置）'),'configured disabled state lost');
        check(document.querySelector('.nv-internet').textContent.includes('状态未知'),'configured PPPoE claims runtime state');
        check(!document.querySelector('.nova-dashboard').textContent.includes('private-never-render'),'configuration secret rendered');
        await [...polls][0]();check(samples.length===0,'unavailable runtime sampled traffic');
    }
    const branches=document.querySelectorAll('.nv-radio');
    const clients=document.querySelectorAll('.nv-client');
    check(branches.length===clients.length,'branch/client rows differ');
    for(let i=0;i<branches.length;i++)check(Math.abs(branches[i].getBoundingClientRect().top-clients[i].getBoundingClientRect().top)<1,'dynamic branch row misaligned');
    if(scenario==='dual')check(document.querySelectorAll('.nv-wifi').length===3,'2.4/5/6 GHz cards missing');
    const topology=document.querySelector('.nv-path');
    if(scenario==='empty')check(topology.scrollWidth<=topology.clientWidth+1,'empty topology leaves phantom columns');
    check(getComputedStyle(document.querySelector('.nv-overview-head')).display==='flex','dashboard header is not flex');
    const router=document.querySelector('.nv-router');
    check(router.title==='OpenWrt fixture · '+(scenario==='configured'?'LAN br-home（已配置，运行状态未知）':scenario==='lan'||scenario==='dual'?'LAN br-home':scenario==='failed'?'接口检测失败':'未检测到 LAN 接口'),'LAN tooltip');
    router.click();router.click();
    check(document.querySelectorAll('#nv-selected a').length===1,'repeated node clicks duplicated detail');
    const header=document.querySelector('header');
    if(width<=900){
        check(getComputedStyle(header).overflowY==='visible','narrow header clips pop-out menu');
        const menu=document.getElementById('status-menu');
        const box=menu.getBoundingClientRect();
        const headerBox=header.getBoundingClientRect();
        check(box.bottom>headerBox.bottom,'fixture must exercise menu beyond the header');
        const hit=document.elementFromPoint(box.left+20,Math.min(box.bottom-10,headerBox.bottom+40));
        check(hit&&menu.contains(hit),'status submenu is not visible/hittable beyond the header');
    }else{
        check(getComputedStyle(header).overflowY==='auto','desktop sidebar must remain scrollable');
    }
    if(scenario==='configured'){
        runtimeFailed=false;interfaces=[{...ppp,up:true,l3_device:'pppoe-internet','ipv4-address':[{address:'203.0.113.8'}]},lan];
        await [...polls][0]();
        check(!document.querySelector('.nv-detection-warning'),'runtime recovery kept stale warnings');
        check(!document.querySelector('.nv-wifi'),'runtime recovery kept removed configured radio');
        check(document.querySelector('.nv-internet').textContent.includes('203.0.113.8'),'runtime recovery did not update configured PPPoE');
    }
    if(scenario==='pppoe'){
        router.focus();
        interfaces=[{...ppp,up:true,l3_device:'pppoe-internet','ipv4-address':[{address:'203.0.113.8'}]}];
        await [...polls][0]();
        check(document.querySelector('.nv-internet').textContent.includes('203.0.113.8'),'PPPoE did not refresh');
        check(document.activeElement.classList.contains('nv-router'),'refresh lost keyboard focus');
        check(document.querySelector('#nv-selected').hidden===false,'refresh lost open detail');
        check(!document.querySelector('[data-nova=traffic-down]').textContent.includes('等待'),'refresh skipped current traffic sample');
        interfaces=[];await [...polls][0]();
        check(!document.querySelector('.nv-internet,.nv-traffic'),'removed WAN remains visible');
        check(polls.size===1,'refresh duplicated polling');
    }
    app.remove();check(polls.size===0,'teardown leaked a poll');
    parent.postMessage({width,scenario,passed:true,columns,stylesheetUpgraded:true},'*');
}catch(error){parent.postMessage({width:innerWidth,scenario,passed:false,error:error.message},'*');}
})();
</script>`;
        fs.writeFileSync(path.join(temporary, 'frame.html'), child);
        const frame = pathToFileURL(path.join(temporary, 'frame.html')).href;
        const widths = [1600, 1180, 700, 528, 390];
        const scenarios = ['empty','lan','pppoe','dual','disabled','failed','configured'];
        fs.writeFileSync(path.join(temporary, 'index.html'), `<!doctype html><meta charset="utf-8"><pre id="results">pending</pre><script>
const results=[];
addEventListener('message',event=>{if(!event.data||typeof event.data.passed!=='boolean')return;results.push(event.data);
if(results.length===${widths.length * scenarios.length})document.getElementById('results').textContent=JSON.stringify(results);});
for(const width of ${JSON.stringify(widths)})for(const scenario of ${JSON.stringify(scenarios)}){const frame=document.createElement('iframe');frame.width=width;frame.height=900;frame.style.border='0';frame.src=${JSON.stringify(frame)}+'?case='+scenario;document.body.append(frame);}
</script>`);
        const run = spawnSync(process.env.CHROME_BIN || 'google-chrome', [
            '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
            '--no-default-browser-check', '--disable-background-networking',
            '--user-data-dir=' + path.join(temporary, 'profile'),
            '--virtual-time-budget=5000', '--dump-dom',
            pathToFileURL(path.join(temporary, 'index.html')).href
        ], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        assert.ifError(run.error);
        assert.equal(run.status, 0, run.stderr);
        const match = run.stdout.match(/<pre id="results">([^<]+)<\/pre>/);
        assert.ok(match, 'browser did not emit fixture results');
        assert.notEqual(match[1], 'pending', 'browser did not finish all viewport fixtures');
        const results = JSON.parse(match[1]);
        assert.deepEqual(results.map(result => result.width+'|'+result.scenario).sort(),widths.flatMap(width=>scenarios.map(scenario=>width+'|'+scenario)).sort());
        console.log(JSON.stringify(results));
        for (const result of results) assert.equal(result.passed, true, JSON.stringify(result));
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
