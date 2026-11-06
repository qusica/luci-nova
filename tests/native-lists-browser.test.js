'use strict';

// Local native-LuCI-shaped fixtures. No router data, requests or npm dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const chromium = require('./helpers/chromium');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(directory, page = 'admin-status-overview') {
    const assets = path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova');
    for (const name of ['cascade.css', 'nova-lists.css', 'nova-lists.js']) fs.copyFileSync(path.join(assets, name), path.join(directory, name));
    const file = path.join(directory, page + '.html');
    fs.writeFileSync(file, `<!doctype html><html lang="zh-cn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}table{border-collapse:collapse}td,th{padding:7px;text-align:left}th{white-space:nowrap}.table{display:table}.tr{display:table-row}.td,.th{display:table-cell}button{cursor:pointer}#maincontent{margin:0!important;padding:20px!important}.hide-xs{display:none}</style>
<link rel="stylesheet" href="cascade.css"><link rel="stylesheet" href="nova-lists.css"><script defer src="nova-lists.js"></script>
<body data-page="${page}"><main id="maincontent" class="container"><div id="view">
<section class="cbi-section" id="system"><div class="cbi-title"><h3>系统 <span>Hide</span></h3></div><div id="system-data">OpenWrt model · kernel · uptime · load</div></section>
<section class="cbi-section" id="storage"><div class="cbi-title"><h3>存储 <span>Hide</span></h3></div><div id="storage-data"><progress value="17" max="100"></progress><a href="#mount">/overlay · /tmp · /mnt/data</a></div></section>
<section class="cbi-section" id="dhcp"><div class="cbi-title"><h3>DHCP 租约 <span id="native-hide">Hide</span></h3></div><div id="leases-content"></div></section>
<section class="cbi-section" id="wifi"><div class="cbi-title"><h3>无线 <span>Hide</span></h3></div><div id="wifi-content"></div></section>
<section class="cbi-section" id="extra"><h3>Third-party plugin</h3><button id="plugin-action">Native extra action</button></section>
<section class="cbi-section" id="connection-section"><input id="filter-connections" placeholder="Native filter"><button id="lookup">Enable DNS lookups</button><div id="connection-content"></div></section>
</div></main><script>
window.actionCount=0; window.requests=0; window.initialStorage=document.getElementById('storage-data');
window.fetch=()=>{window.requests++;throw new Error('Unexpected network request')};
function cell(tag,text){const e=document.createElement(tag);e.className=tag==='th'?'th':'td';e.textContent=text;return e;}
window.makeTable=(id,count,readonly=false)=>{
 const table=document.createElement('table');table.id=id;table.className='table';
 const head=document.createElement('tr');head.className='tr table-titles';
 (id==='connections'?['Network','Protocol','Source','Destination','Transfer']:['Hostname','Address','MAC / DUID','Remaining','Action']).forEach(x=>head.append(cell('th',x)));table.append(head);
 for(let i=0;i<count;i++){
  const row=document.createElement('tr');row.className='tr';row.dataset.index=i;
  const six=id==='status_leases6';
  const values=id==='connections'?[i%3===0?'IPv6':i%3===1?'IPv4':'OTHER',i%2?'TCP':'UDP','host-'+i+' 192.0.2.'+(i%250)+':443','[2001:db8::'+i+']:53','12 kB']:
    ['host-'+i,six?'2001:db8::'+i+' / 2001:db8:1::'+i:'192.0.2.'+(i%250),'02:00:00:00:00:'+i,'remaining '+i];
  values.forEach(x=>row.append(cell('td',x)));
  if(id!=='connections'&&!readonly){const td=cell('td','');const b=document.createElement('button');b.textContent=id==='wifi_assoclist_table'?'Disconnect':'Reserve IP';b.addEventListener('click',()=>window.actionCount++);b.disabled=i===1;td.append(b);row.append(td);}
  table.append(row);
 }
 if(!count){const row=document.createElement('tr');row.className='tr placeholder';row.append(cell('td','No active leases found'));table.append(row);}
 return table;
};
window.pollLeases=(count=81,readonly=false)=>{
 const host=document.getElementById('leases-content');host.replaceChildren();
 if(count<0){host.textContent='No active leases found';return;}
 for(const [id,title,n] of [['status_leases','Active DHCPv4 Leases',count],['status_leases6','Active DHCPv6 Leases',Math.min(count,3)]]){
  const h=document.createElement('h3');h.textContent=title;host.append(h,makeTable(id,n,readonly));
 }
};
window.pollWifi=()=>{const host=document.getElementById('wifi-content');host.replaceChildren();const card=document.createElement('div');card.textContent='radio0 · SSID · WPS';card.id='radio-summary';host.append(card,makeTable('wifi_assoclist_table',3));};
document.getElementById('native-hide').onclick=()=>{const box=document.getElementById('leases-content');if(box.style.display==='none'){box.style.display='';box.textContent='Collecting data...';setTimeout(()=>pollLeases(81),20);}else box.style.display='none';};
addEventListener('load',()=>setTimeout(()=>{
 if(${JSON.stringify(page)}.includes('connections'))document.getElementById('connection-content').append(makeTable('connections',99));
 else{pollLeases();pollWifi();}
 window.fixtureReady=true;
},20));
</script></body></html>`);
    return pathToFileURL(file).href;
}

test('native lists preserve modules/actions, grouping, focus, polling and bounded pages', { timeout: 120000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-native-lists-'));
    const browser = chromium(directory);
    try {
        const url = fixture(directory);
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => browser.send(method, params, sessionId);
        await send('Page.enable'); await send('Runtime.enable');
        async function evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function until(expression) {
            for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(25); }
            const diagnostic = await evaluate(`(()=>{
                const active=document.activeElement;
                return { readyState:document.readyState, hasFocus:document.hasFocus(),
                    active:active && {tag:active.tagName, id:active.id, key:active.getAttribute('data-nova-list-focus')},
                    groups:Array.from(document.querySelectorAll('.nova-list-group'),details=>({
                        open:details.open, expanded:details.querySelector('summary').getAttribute('aria-expanded'),
                        summaryTag:details.firstElementChild.tagName,
                        summaryDisplay:getComputedStyle(details.firstElementChild).display
                    })), keyEvents:window.nativeKeyEvents || [] };
            })()`);
            assert.fail('Timed out: ' + expression + '\nNative fixture state: ' + JSON.stringify(diagnostic));
        }
        async function nativeKey(key, code, virtualKey, text) {
            // Like Chromium's normal keyboard input (and Playwright), provide text
            // for Enter/Space. A keyDown without it omits the keypress/default
            // activation path used by native <summary>, unlike JS keydown handlers.
            await send('Input.dispatchKeyEvent', {
                type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey,
                text, unmodifiedText: text
            });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
        }
        async function input(value) {
            await evaluate(`(()=>{const q=document.getElementById('nova-search-leases');q.value=${JSON.stringify(value)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
            await delay(170);
        }
        const visible = id => evaluate(`document.querySelectorAll('#${id} tr:not(.table-titles):not(.placeholder):not(.nova-list-hidden)').length`);
        await send('Page.navigate', { url });
        await until('document.querySelectorAll(".nova-list-group").length === 3');
        assert.equal(await evaluate('document.querySelectorAll(".nova-list-group[open]").length'), 0);
        assert.equal(await evaluate('document.querySelectorAll(".nova-list-tools").length'), 2);
        const shippedScript = fs.readFileSync(path.resolve(__dirname, '../luci-theme-nova/htdocs/luci-static/nova/nova-lists.js'), 'utf8');
        await evaluate('new Function(' + JSON.stringify(shippedScript) + ')()');
        assert.equal(await evaluate('document.querySelectorAll(".nova-list-group").length'), 3, 'duplicate script must be idempotent');
        assert.equal(await evaluate('document.querySelectorAll("#nova-search-leases").length'), 1);
        assert.equal(await visible('status_leases'), 25);
        assert.equal(await evaluate('document.getElementById("storage-data") === window.initialStorage'), true);
        assert.equal(await evaluate('document.getElementById("storage-data").textContent.includes("/mnt/data")'), true);
        assert.equal(await evaluate('!!document.querySelector("#radio-summary") && !!document.querySelector("#plugin-action")'), true);
        // Native keyboard interaction, not programmatic details.open.
        await evaluate(`(()=>{
            window.nativeKeyEvents=[];
            const summary=document.querySelector('[data-nova-list-focus=status_leases-summary]');
            for(const type of ['keydown','keypress','keyup','click']) summary.addEventListener(type,event=>{
                window.nativeKeyEvents.push({type:event.type,key:event.key, trusted:event.isTrusted, defaultPrevented:event.defaultPrevented});
            });
            summary.focus();
        })()`);
        assert.equal(await evaluate('document.activeElement.getAttribute("data-nova-list-focus")'), 'status_leases-summary');
        await nativeKey('Enter', 'Enter', 13, '\r');
        await until('document.getElementById("status_leases").closest("details").open && document.querySelector("[data-nova-list-focus=status_leases-summary]").getAttribute("aria-expanded") === "true"');
        await nativeKey(' ', 'Space', 32, ' ');
        await until('!document.getElementById("status_leases").closest("details").open && document.querySelector("[data-nova-list-focus=status_leases-summary]").getAttribute("aria-expanded") === "false"');
        await nativeKey('Enter', 'Enter', 13, '\r');
        await until('document.getElementById("status_leases").closest("details").open && document.querySelector("[data-nova-list-focus=status_leases-summary]").getAttribute("aria-expanded") === "true"');
        assert.equal(await evaluate('window.nativeKeyEvents.some(event=>event.type==="keypress" && event.key==="Enter" && event.trusted)'), true);
        assert.equal(await evaluate('document.querySelector("[data-nova-list-focus=status_leases-summary]").getAttribute("aria-expanded")'), 'true');
        await evaluate('document.querySelector("#status_leases tr[data-index=0] button").click()');
        assert.equal(await evaluate('window.actionCount'), 1);
        assert.equal(await evaluate('document.querySelector("#status_leases tr[data-index=1] button").disabled'), true);
        await evaluate('document.querySelector("[data-nova-list-focus=status_leases-next]").click()');
        await until('document.querySelector("#status_leases tr[data-index=25]").classList.contains("nova-list-hidden") === false');
        await input('HOST-78');
        assert.equal(await visible('status_leases'), 1);
        assert.equal(await visible('status_leases6'), 0);
        await input('host-7 192.0.2.7');
        assert.equal(await visible('status_leases'), 11);
        await evaluate('document.getElementById("nova-search-leases").focus();document.getElementById("nova-search-leases").setSelectionRange(2,5);window.beforeInput=document.activeElement;pollLeases(100)');
        await until('document.querySelector("#status_leases tr[data-index=99]") !== null && document.querySelectorAll(".nova-list-group").length===3');
        assert.equal(await evaluate('document.activeElement === window.beforeInput'), true);
        assert.equal(await evaluate('document.activeElement.selectionStart'), 2);
        assert.equal(await evaluate('document.getElementById("status_leases").closest("details").open'), true);
        assert.equal(await visible('status_leases'), 11);
        // Poll in the same task, before the asynchronous details toggle event.
        await evaluate('document.getElementById("status_leases").closest("details").open=false;pollLeases(100)');
        await until('document.querySelector("#status_leases tr[data-index=99]") !== null');
        assert.equal(await evaluate('document.getElementById("status_leases").closest("details").open'), false);
        await evaluate('document.getElementById("status_leases").closest("details").open=true;pollLeases(100)');
        await delay(50);
        assert.equal(await evaluate('document.getElementById("status_leases").closest("details").open'), true);
        await input('missing-device');
        assert.equal(await visible('status_leases'), 0);
        assert.equal(await evaluate('document.getElementById("status_leases").closest("details").querySelector(".nova-list-empty").hidden'), false);
        await input('');
        // Empty/no-permission transitions do not fabricate clients or discard state.
        await evaluate('pollLeases(-1)'); await delay(50);
        assert.equal(await evaluate('document.querySelectorAll("#leases-content .nova-list-group").length'), 0);
        await evaluate('pollLeases(0)');
        await until('document.querySelector("#status_leases .placeholder") !== null');
        assert.equal(await evaluate('document.querySelector("#status_leases .placeholder").classList.contains("nova-list-hidden")'), false);
        await evaluate('pollLeases(60,true)');
        await until('document.querySelector("#status_leases tr[data-index=59]") !== null');
        assert.equal(await evaluate('document.querySelectorAll("#status_leases button").length'), 0);
        // Native module hide and unknown add-on content remain functional.
        await evaluate('document.getElementById("native-hide").click()');
        assert.equal(await evaluate('document.getElementById("leases-content").style.display'), 'none');
        await evaluate('document.getElementById("native-hide").click()');
        await until('document.querySelector("#status_leases tr[data-index=80]") !== null');
        // HTML-looking client names stay text, and polling stays local.
        await evaluate('document.querySelector("#status_leases tr[data-index=0] td").textContent="<img src=x onerror=alert(1)>"'); await delay(50);
        await input('<img'); assert.equal(await visible('status_leases'), 1);
        assert.equal(await evaluate('document.querySelectorAll("#status_leases img").length'), 0);
        await input('');
        // Large native payload is retained but only 25 rows participate in layout.
        await evaluate('window.largeStart=performance.now();pollLeases(5000)');
        await until('document.querySelectorAll("#status_leases tr.nova-list-hidden").length === 4975');
        const largeMs = await evaluate('performance.now()-window.largeStart');
        assert.equal(await visible('status_leases'), 25);
        assert.equal(await evaluate('document.querySelectorAll("#status_leases tr[data-index]").length'), 5000);
        console.log('5,000-row native fixture enhancement completed in ' + Math.round(largeMs) + ' ms (includes native row construction)');
        await input('host-4999'); assert.equal(await visible('status_leases'), 1);
        for (const width of [1600, 1024, 768, 390]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'page overflow at ' + width);
        }
        assert.equal(await evaluate('window.requests'), 0);
        if (process.env.NOVA_QA_DIR) {
            fs.mkdirSync(process.env.NOVA_QA_DIR, { recursive: true });
            await input(''); await evaluate('pollLeases(81)'); await delay(80);
            await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
            const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
            fs.writeFileSync(path.join(process.env.NOVA_QA_DIR, 'native-overview-lists.png'), Buffer.from(shot.data, 'base64'));
        }
        // Separate native connection page keeps its DNS/filter controls and all columns.
        await send('Page.navigate', { url: fixture(directory, 'admin-status-realtime-connections') });
        await until('document.querySelectorAll(".nova-list-group").length === 1');
        assert.equal(await evaluate('document.querySelector(".nova-list-group").open'), false);
        assert.equal(await evaluate('!!document.getElementById("filter-connections") && !!document.getElementById("lookup")'), true);
        await evaluate('const s=document.querySelector(".nova-list-family select");s.value="ipv6";s.dispatchEvent(new Event("change"))');
        assert.equal(await visible('connections'), 25);
        assert.equal(await evaluate('Array.from(document.querySelectorAll("#connections tr:not(.table-titles):not(.nova-list-hidden)")).every(r=>r.firstChild.textContent==="IPv6")'), true);
        await evaluate('document.querySelector(".nova-list-family select").value="other";document.querySelector(".nova-list-family select").dispatchEvent(new Event("change"))');
        assert.equal(await evaluate('document.querySelector(".nova-list-count").textContent'), '33 / 99');
        // Native UI.Table updates and sorting reuse the original table element.
        await evaluate('window.savedConnections=document.getElementById("connections");const fresh=makeTable("connections",7);window.savedConnections.replaceChildren(...fresh.childNodes)');
        await until('document.querySelector(".nova-list-count").textContent === "2 / 7"');
        assert.equal(await evaluate('window.savedConnections === document.getElementById("connections")'), true);
        assert.equal(await evaluate('document.querySelectorAll(".nova-list-group").length'), 1);
        await evaluate('const head=window.savedConnections.firstElementChild;head.addEventListener("click",()=>{Array.from(window.savedConnections.children).slice(1).reverse().forEach(r=>window.savedConnections.append(r))});head.click()');
        await delay(40);
        assert.equal(await evaluate('document.querySelector(".nova-list-count").textContent'), '2 / 7');
        assert.equal(await evaluate('document.querySelector("#connections tr:not(.table-titles):not(.nova-list-hidden)").getAttribute("data-index")'), '5');
        // Repeated script loads/navigation must not enhance arbitrary config pages.
        await send('Page.navigate', { url: fixture(directory, 'admin-network-dhcp') });
        await until('window.fixtureReady === true'); await delay(50);
        assert.equal(await evaluate('document.querySelectorAll(".nova-list-group").length'), 0);
    } finally { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
