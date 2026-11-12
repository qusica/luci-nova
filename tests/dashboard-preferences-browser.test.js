'use strict';
// Real Chromium DOM, CSS, storage and keyboard activation. No npm/network needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {pathToFileURL} = require('node:url');
const chromium = require('./helpers/chromium');

test('dashboard preferences work with native controls, keyboard, persistence and mobile layout', async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nova-preferences-'));
    const resources=path.resolve(__dirname,'../luci-theme-nova/htdocs/luci-static/resources');
    const source=fs.readFileSync(path.join(resources,'view/nova/dashboard.js'),'utf8');
    fs.copyFileSync(path.join(resources,'nova/dashboard.css'),path.join(directory,'dashboard.css'));
    fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="dashboard.css"><style>body{margin:12px;background:#111923}</style><main id="mount"></main>');
    const browser=chromium(directory);
    try {
        const {targetId}=await browser.send('Target.createTarget',{url:pathToFileURL(path.join(directory,'index.html')).href});
        const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
        const send=(method,params)=>browser.send(method,params,sessionId);
        async function evaluate(expression){
            const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
            assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        await send('Page.enable');
        await send('Page.bringToFront');
        // CDP keyDown without text becomes rawKeyDown. Native HTML activation
        // (unlike JS keydown handlers) needs the corresponding keypress too.
        async function press(key,code,virtualKey,text){
            await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey,text,unmodifiedText:text});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey});
        }
        async function focus(selector){
            assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();return document.activeElement===e;})()`),true,'focus '+selector);
        }
        for(let i=0;i<100;i++){
            if(await evaluate('!!document.getElementById("mount") && document.readyState === "complete"'))break;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        await evaluate(`(async()=>{
            localStorage.clear();
            window.E=function(tag,attrs={},children=[]){
                const e=document.createElement(tag);
                for(const [key,value] of Object.entries(attrs)){
                    if(typeof value==='function')e.addEventListener(key,value);
                    else if(typeof value==='boolean'){if(value)e.setAttribute(key,'');}
                    else e.setAttribute(key,value);
                }
                for(const child of Array.isArray(children)?children:[children])e.append(child);
                return e;
            };
            window.polls=new Map();window.calls=[];
            window.interfaces=[{interface:'wan',proto:'dhcp',up:true,device:'eth1',route:[{target:'0.0.0.0',mask:0}]}];
            const wireless={radio0:{up:true,config:{band:'2g'},interfaces:[{section:'default_radio0',ifname:'phy0-ap0',config:{ssid:'Test'},iwinfo:{channel:6,frequency:2437,txpower:20,noise:-90}}]}};
            window.makeApp=()=>new Function('view','rpc','poll','fs','E','L','document',${JSON.stringify(source)})(
                {extend:x=>x},{declare:options=>(...args)=>{
                    const key=options.object+'.'+options.method;calls.push(key);
                    return Promise.resolve(key==='system.board'?{hostname:'Test router'}:key==='system.info'?{memory:{total:1024,available:512},root:{total:1024,used:128}}:
                        key==='network.interface.dump'?{interface:interfaces}:key==='network.wireless.status'||key==='luci-rpc.getWirelessDevices'?structuredClone(wireless):
                        key==='iwinfo.assoclist'?{results:[]}:key==='luci.getRealtimeStats'?[[1,100,0,50],[4,400,0,200]]:{});
                }},{add:(fn,seconds)=>polls.set(fn,seconds),remove:fn=>polls.delete(fn)},{read:()=>Promise.resolve('cpu 100 0 0 200')},E,
                {url:x=>'/cgi-bin/luci/'+x,resource:()=>new URL('dashboard.css',location.href).href},document);
            window.mount=async()=>{window.app=makeApp();document.getElementById('mount').replaceChildren(app.render(await app.load()));};
            await mount();
            window.option=key=>document.querySelector('[data-nova-card-option="'+key+'"]');
            window.card=key=>document.querySelector('[data-nova-card="'+key+'"]');
            window.changeInterval=value=>{const e=document.getElementById('nv-refresh-interval');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};
            return true;
        })()`);
        assert.deepEqual(await evaluate('[...polls.values()]'),[10]);
        assert.equal(await evaluate('document.querySelectorAll("[data-nova-card][hidden]").length'),0);
        // Enter activates a focused native summary, rather than a custom JS toggle.
        await evaluate(`window.activationEvents=[];for(const type of ['keydown','keypress','keyup','click'])document.addEventListener(type,event=>activationEvents.push({type:event.type,trusted:event.isTrusted,tag:event.target.tagName,key:event.key}));`);
        await focus('.nv-controls summary');
        await press('Enter','Enter',13,'\r');
        assert.equal(await evaluate('document.querySelector(".nv-controls details").open'),true);
        assert.equal(await evaluate(`activationEvents.some(e=>e.type==='keypress' && e.key==='Enter' && e.trusted && e.tag==='SUMMARY') && activationEvents.some(e=>e.type==='click' && e.trusted && e.tag==='SUMMARY')`),true,'native trusted summary activation');
        await press('Enter','Enter',13,'\r');
        assert.equal(await evaluate('document.querySelector(".nv-controls details").open'),false);
        await press(' ','Space',32,' ');
        assert.equal(await evaluate('document.querySelector(".nv-controls details").open'),true);
        await focus('[data-nova-card-option="cpu"]');
        await press(' ','Space',32,' ');
        assert.equal(await evaluate('getComputedStyle(card("cpu")).display'),'none');
        assert.equal(await evaluate('document.querySelector(".nv-wifi details").open'),false);
        await focus('.nv-wifi summary');
        await press(' ','Space',32,' ');
        assert.equal(await evaluate('document.querySelector(".nv-wifi details").open && document.querySelector(".nv-wifi-stats").getBoundingClientRect().height>0'),true);
        // An inventory rebuild preserves an open picker and focused checkbox.
        await evaluate('(async()=>{option("memory").focus();interfaces=[{...interfaces[0],"ipv4-address":[{address:"203.0.113.10"}]}];await [...polls.keys()][0]();})()');
        assert.equal(await evaluate('document.activeElement===option("memory") && document.querySelector(".nv-controls details").open && card("cpu").hidden'),true);
        await evaluate('changeInterval("30")');assert.deepEqual(await evaluate('[...polls.values()]'),[30]);
        await evaluate('changeInterval("0")');assert.equal(await evaluate('polls.size'),0);
        assert.match(await evaluate('document.querySelector(".nv-updated").textContent'),/已暂停/);
        await evaluate('changeInterval("60")');assert.deepEqual(await evaluate('[...polls.values()]'),[60]);
        await evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"))');
        assert.equal(await evaluate('polls.size'),0);
        await evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"))');
        assert.equal(await evaluate('polls.size'),1);
        await evaluate('(async()=>{app.remove();await mount();})()');
        assert.equal(await evaluate('card("cpu").hidden'),true);assert.deepEqual(await evaluate('[...polls.values()]'),[60]);
        await evaluate('document.querySelectorAll(".nv-card-options input").forEach(e=>{if(e.checked)e.click()})');
        assert.equal(await evaluate('polls.size'),0);assert.equal(await evaluate('document.querySelector(".nv-empty").hidden'),false);
        await focus('.nv-reset');
        await press('Enter','Enter',13,'\r');
        assert.deepEqual(await evaluate('[...polls.values()]'),[10]);assert.equal(await evaluate('document.querySelectorAll("[data-nova-card][hidden]").length'),0);
        for(const width of [390,700,1400]){
            await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'page overflow at '+width);
            assert.equal(await evaluate('[...document.querySelectorAll(".nv-controls input")].every(e=>!!e.closest("label"))'),true);
        }
        await evaluate('app.remove();document.dispatchEvent(new Event("visibilitychange"))');assert.equal(await evaluate('polls.size'),0);
    } finally {await browser.close();fs.rmSync(directory,{recursive:true,force:true});}
});
