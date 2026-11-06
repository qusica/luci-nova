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
        const child = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}ul{list-style:none}#topmenu{position:relative}.dropdown-menu{list-style:none}a{cursor:pointer}</style>
<style>${theme}\n${dashboard}</style>
<!-- The actual stylesheet was inlined above; prevent a synthetic network request. -->
<link id="nova-dashboard-style" rel="stylesheet">
<header><a class="brand"><span class="nova-brand-mark">N</span><span>Nova</span></a>
<ul id="topmenu"><li><a>仪表盘</a></li><li class="dropdown open"><a>状态</a><ul class="dropdown-menu" id="status-menu">
${['概览','路由表','防火墙','内核日志','进程','实时信息'].map(name => '<li><a>'+name+'</a></li>').join('')}
</ul></li><li><a>系统</a></li><li><a>网络</a></li><li><a>退出</a></li></ul></header>
<div class="nova-topbar">Local fixture</div><div id="maincontent" class="container"></div>
<script>
try {
    const svgTags=['svg','line','polyline'];
    function E(tag,attrs={},children=[]) {
        const e=svgTags.includes(tag)?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag);
        for(const [name,value] of Object.entries(attrs)) {
            if(typeof value==='function')e.addEventListener(name,value);
            else if(typeof value==='boolean'){if(value)e.setAttribute(name,'');}
            else e.setAttribute(name,value);
        }
        for(const child of Array.isArray(children)?children:[children])if(child!=null)e.append(child);
        return e;
    }
    const app=new Function('view','rpc','poll','network','fs','E','L','document',${JSON.stringify(source)})(
        {extend:x=>x},{declare:()=>()=>Promise.resolve({})},{add:()=>{},remove:()=>{}},{},{},E,
        {url:x=>'/cgi-bin/luci/'+x,resource:x=>'/luci-static/resources/'+x},document);
    document.getElementById('maincontent').append(app.render([
        {hostname:'local-fixture',release:{description:'OpenWrt fixture'}},{},{interface:[]},[],{},null,null,[]
    ]));
    function check(condition,message){if(!condition)throw new Error(message);}
    const width=window.innerWidth;
    const expected=width>1350?6:width>780?3:width>530?2:1;
    const grid=getComputedStyle(document.querySelector('.nv-metric-grid'));
    check(grid.display==='grid','dashboard metric layout is not grid');
    check(grid.gridTemplateColumns.split(' ').length===expected,'wrong dashboard column count at '+width);
    check(getComputedStyle(document.querySelector('.nv-overview-head')).display==='flex','dashboard header is not flex');
    const router=document.querySelector('.nv-router');
    check(router.title==='OpenWrt fixture · 未检测到 LAN 接口','missing LAN tooltip');
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
    parent.postMessage({width,passed:true,columns:expected},'*');
}catch(error){parent.postMessage({width:innerWidth,passed:false,error:error.message},'*');}
</script>`;
        fs.writeFileSync(path.join(temporary, 'frame.html'), child);
        const frame = pathToFileURL(path.join(temporary, 'frame.html')).href;
        const widths = [1600, 1180, 700, 528, 390];
        fs.writeFileSync(path.join(temporary, 'index.html'), `<!doctype html><meta charset="utf-8"><pre id="results">pending</pre><script>
const results=[];
addEventListener('message',event=>{if(!event.data||typeof event.data.passed!=='boolean')return;results.push(event.data);
if(results.length===${widths.length})document.getElementById('results').textContent=JSON.stringify(results);});
for(const width of ${JSON.stringify(widths)}){const frame=document.createElement('iframe');frame.width=width;frame.height=900;frame.style.border='0';frame.src=${JSON.stringify(frame)};document.body.append(frame);}
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
        assert.deepEqual(results.map(result => result.width).sort((a,b) => a-b), widths.slice().sort((a,b) => a-b));
        for (const result of results) assert.equal(result.passed, true, JSON.stringify(result));
        console.log(JSON.stringify(results));
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
