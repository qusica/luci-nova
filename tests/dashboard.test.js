'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const resources = path.resolve(__dirname, '../luci-app-nova-dashboard/htdocs/luci-static/resources');
const source = fs.readFileSync(path.join(resources, 'view/nova/dashboard.js'), 'utf8');
const hasClass = name => node => (node.attrs.class || '').split(' ').includes(name);
function all(node, predicate) {
    if (typeof node !== 'object' || node == null) return [];
    return (predicate(node) ? [node] : []).concat(...node.children.map(child => all(child, predicate)));
}
function text(node) {
    return typeof node === 'object' && node != null ? node.children.map(text).join('') : String(node);
}

// Dependency-free DOM/RPC doubles. The browser suite exercises real layout.
function harness() {
    const polls = new Set(), calls = [], declarations = {};
    let active;
    function E(tag, attrs = {}, children = []) {
        const element = {
            tag, attrs, hidden: !!attrs.hidden, parent: null, children: [],
            get isConnected() { return this.tag === 'body' || this.tag === 'head' || !!(this.parent && this.parent.isConnected); },
            get nextSibling() { return this.parent && this.parent.children[this.parent.children.indexOf(this)+1]; },
            get textContent() { return text(this); },
            set textContent(value) { this.replaceChildren(String(value)); },
            getAttribute(name) { return this.attrs[name]; },
            setAttribute(name, value) { this.attrs[name] = value; },
            replaceChildren(...values) {
                this.children.forEach(child => { if (typeof child === 'object') child.parent = null; });
                this.children = [];
                values.forEach(v => this.appendChild(v));
            },
            appendChild(value) { if (value == null) value = String(value); this.children.push(value); if (typeof value === 'object') value.parent = this; return value; },
            replaceWith(value) {
                const parent = this.parent;
                assert.ok(parent, 'replaceWith needs an attached root');
                parent.children[parent.children.indexOf(this)] = value;
                value.parent = parent; this.parent = null;
            },
            querySelectorAll(selector) {
                return all(this, node => {
                    if (selector === '.nv-node:focus') return hasClass('nv-node')(node) && node === active;
                    if (selector.startsWith('.')) return hasClass(selector.slice(1))(node);
                    const match = selector.match(/^\[data-nova=(.+)\]$/);
                    return match && node.attrs['data-nova'] === match[1];
                });
            },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
            click() { if (this.attrs.click) this.attrs.click(); },
            focus() { active = this; }
        };
        element.replaceChildren(...(Array.isArray(children) ? children : [children]));
        return element;
    }
    const document = {
        head: E('head'), body: E('body'),
        getElementById: id => all(document.body, n => n.attrs.id === id).concat(all(document.head, n => n.attrs.id === id))[0],
        createTextNode: text => String(text)
    };
    const responses = {
        'system.board': { hostname:'test-router', model:'Test router', release:{description:'OpenWrt test'} },
        'system.info': {memory:{total:1024,available:512},root:{total:1024,used:128}},
        'network.interface.dump': {interface:[]}, 'network.wireless.status': {},
        'luci-rpc.getWirelessDevices': {}, 'iwinfo.assoclist': {results:[]},
        'luci.getRealtimeStats': [[1,100,0,50],[4,400,0,200]]
    };
    let cpu = 100;
    const view = new Function('view','rpc','poll','fs','E','L','document',source)(
        {extend:value=>value}, {declare: options => {
            const key = options.object+'.'+options.method; declarations[key] = options;
            return (...args) => {
                calls.push([key,...args]);
                const value=responses[key];
                return value instanceof Error ? Promise.reject(value) : Promise.resolve(typeof value === 'function' ? value(...args) : structuredClone(value));
            };
        }}, {add:fn=>polls.add(fn),remove:fn=>polls.delete(fn)},
        {read: file => Promise.resolve(file === '/proc/stat' ? `cpu ${cpu+=50} 0 0 ${cpu*2}` : null)}, E,
        {url:x=>'/cgi-bin/luci/'+x,resource:x=>'/luci-static/resources/'+x},document
    );
    const app = {
        view, document, polls, responses, calls, declarations,
        get root() { return document.body.children[0]; },
        get active() { return active; },
        async render(interfaces=[], wireless={}) {
            responses['network.interface.dump']={interface:interfaces};
            responses['network.wireless.status']=wireless;
            responses['luci-rpc.getWirelessDevices']=wireless;
            return app.mount();
        },
        async mount() { const data=await view.load(); document.body.replaceChildren(view.render(data)); return app.root; },
        async poll() { assert.equal(polls.size,1); await [...polls][0](); return app.root; }
    };
    return app;
}
function radio(band='2g', options={}) {
    const enabled = options.up !== false && !options.disabled;
    return {up:enabled,disabled:!!options.disabled,config:{band},interfaces:options.noVif?[]:[{
        section:'default_radio0',ifname:enabled?(options.ifname||'phy0-ap0'):undefined,
        config:{ssid:'Test Wi-Fi'},iwinfo:enabled?{frequency:options.frequency||2462,channel:options.channel||11,ssid:'Test Wi-Fi',noise:-95,txpower:20}:undefined,
        vlans:options.vlans||[]
    }]};
}
const count = (root, name) => all(root,hasClass(name)).length;
const wanDown = {interface:'internet',proto:'pppoe',up:false,available:true,device:'eth1',route:[]};
const wanUp = {...wanDown,up:true,l3_device:'pppoe-internet','ipv4-address':[{address:'203.0.113.8'}],route:[{target:'0.0.0.0',mask:0}]};

for (const [name, interfaces] of [
    ['empty dump',[]],['LAN only',[{interface:'lan',device:'br-home',up:true}]],
    ['unrelated guest',[{interface:'guest',device:'br-guest',up:true}]]
]) test(name+' hides absent WAN/Wi-Fi nodes, client branches, cards and counters',async()=>{
    const root=await harness().render(interfaces);
    for(const name of ['nv-internet','nv-wifi','nv-traffic','nv-wireline'])assert.equal(count(root,name),0,name);
    assert.doesNotMatch(text(root),/2\.4 GHz|5 GHz|WAN 未连接|连接状态待检查|null|undefined/);
    assert.match(text(root),/CPU.*内存.*存储/);
    assert.equal(count(root,'nv-metric'),3);
    assert.equal(count(root,'nv-radio'),interfaces[0]?.interface==='lan'?1:0);
});

for(const [lan, expected, client] of [
    [{l3_device:'br-home',device:'eth1'},'br-home','eth1'],
    [{device:'eth2'},'eth2','eth2'],[{l3_device:'br-office'},'br-office','br-office'],
    [{l3_device:'',device:'eth3'},'eth3','eth3']
]) test('LAN device '+expected+' remains available and links native settings',async()=>{
    const app=harness(),root=await app.render([{interface:'lan',...lan}]);
    const router=all(root,hasClass('nv-router'))[0];
    assert.equal(router.attrs.title,'OpenWrt test · LAN '+expected);
    assert.match(text(all(root,hasClass('nv-radio'))[0]),new RegExp(expected));
    assert.match(text(all(root,hasClass('nv-client'))[0]),new RegExp(client));
    router.click();router.click();
    assert.equal(app.document.getElementById('nv-selected').children.length,3);
});

test('missing LAN device is unknown, not invented, while configured LAN is retained',async()=>{
    const app=harness(),root=await app.render([{interface:'lan',up:false}]);
    assert.equal(count(root,'nv-radio'),1);
    assert.match(text(root),/未连接/);
    assert.doesNotMatch(text(root),/undefined|br-lan/);
});

test('single detected 2.4 GHz band creates exactly one matching branch and card',async()=>{
    const app=harness(),root=await app.render([], {radio0:radio()});
    assert.equal(count(root,'nv-wifi'),1);assert.equal(count(root,'nv-radio'),1);assert.equal(count(root,'nv-client'),1);
    assert.match(text(root),/2\.4 GHz/);assert.doesNotMatch(text(root),/5 GHz|6 GHz/);
    await app.poll();
    assert.ok(app.calls.some(c=>c[0]==='luci.getRealtimeStats'&&c[2]==='phy0-ap0'));
    assert.ok(!app.calls.some(c=>c[0]==='luci.getRealtimeStats'&&/wan|wlan/.test(c[2])));
});

test('disabled 5 GHz radio without VIF is preserved and never sampled',async()=>{
    const app=harness(),root=await app.render([], {radio1:radio('5g',{disabled:true,noVif:true})});
    assert.equal(count(root,'nv-wifi'),1);assert.match(text(root),/5 GHz.*已禁用/);
    assert.doesNotMatch(text(root),/2\.4 GHz|个已启用/);
    await app.poll();assert.ok(!app.calls.some(c=>c[0]==='luci.getRealtimeStats'));
});

test('6 GHz and unknown bands are not mislabeled from low channel numbers',async()=>{
    const app=harness(), unknown=radio('',{up:false});
    const root=await app.render([], {radio6:radio('6g',{frequency:5955,channel:1}),unknown});
    assert.equal(count(root,'nv-wifi'),2);assert.match(text(root),/6 GHz/);assert.match(text(root),/无线（频段未知）/);
    assert.doesNotMatch(text(root),/2\.4 GHz|other GHz/);
});

test('unsupported 60 GHz radio is not manufactured into a 6 GHz card',async()=>{
    const root=await harness().render([], {radio0:radio('',{frequency:60480,channel:2})});
    assert.equal(count(root,'nv-wifi'),1);assert.match(text(root),/无线（频段未知）/);assert.doesNotMatch(text(root),/6 GHz/);
});

test('active network is sampled before a stale down interface in the same band',async()=>{
    const app=harness(),down=radio('2g',{up:false});down.interfaces[0].ifname='old-ap0';
    await app.render([], {radio0:down,radio1:radio('2g',{ifname:'phy1-ap0'})});
    await app.poll();
    const samples=app.calls.filter(c=>c[0]==='luci.getRealtimeStats');
    assert.ok(samples.some(c=>c[2]==='phy1-ap0'));assert.ok(!samples.some(c=>c[2]==='old-ap0'));
});

test('multiple networks in one band make one band card, not a fake band count',async()=>{
    const app=harness();const r=radio();r.interfaces.push({...r.interfaces[0],section:'guest',ifname:'phy0-ap1'});
    const root=await app.render([], {radio0:r});
    assert.equal(count(root,'nv-wifi'),1);assert.match(text(root),/1 个频段/);assert.match(text(root),/2 个无线配置/);
});

for(const [name,wan] of [['custom PPPoE down',wanDown],['PPPoE pending',{...wanDown,pending:true}],['WAN disconnected',{interface:'wan',proto:'dhcp',up:false}],['IPv6 default route',{interface:'uplink6',proto:'dhcpv6',up:true,route:[{target:'::',mask:0}],'ipv6-address':[{address:'2001:db8::1'}]}]])
    test(name+' is kept and leads to original interface settings',async()=>{
        const app=harness(),root=await app.render([wan]);
        assert.equal(count(root,'nv-internet'),1);assert.equal(count(root,'nv-traffic'),1);
        const node=all(root,hasClass('nv-internet'))[0];node.click();
        const link=all(app.document.getElementById('nv-selected'),n=>n.tag==='a')[0];
        assert.equal(link.attrs.href,'/cgi-bin/luci/admin/network/network');
        assert.match(node.attrs.title,new RegExp(wan.interface));
        assert.match(text(node),new RegExp(wan.pending?'连接中':wan.up?'已连接':'未连接'));
    });

test('PPPoE connects, changes runtime device, disconnects, then is removed without reload',async()=>{
    const app=harness();await app.render([wanDown]);
    await app.poll();assert.ok(!app.calls.some(c=>c[0]==='luci.getRealtimeStats'));
    app.responses['network.interface.dump']={interface:[wanUp]};await app.poll();
    assert.match(text(app.root),/已连接/);assert.match(text(app.root),/203\.0\.113\.8/);
    assert.ok(app.calls.some(c=>c[0]==='luci.getRealtimeStats'&&c[2]==='pppoe-internet'));
    assert.doesNotMatch(text(app.root.querySelector('[data-nova=traffic-down]')),/等待采样/);
    const start=app.calls.length;
    app.responses['network.interface.dump']={interface:[wanDown]};await app.poll();
    assert.equal(count(app.root,'nv-internet'),1);assert.match(text(app.root.querySelector('[data-nova=traffic-down]')),/未连接/);
    assert.ok(!app.calls.slice(start).some(c=>c[0]==='luci.getRealtimeStats'));
    app.responses['network.interface.dump']={interface:[]};await app.poll();
    assert.equal(count(app.root,'nv-internet'),0);assert.equal(count(app.root,'nv-traffic'),0);assert.equal(app.polls.size,1);
});

for(const [name,key,value] of [
    ['interface denied','network.interface.dump',new Error('Permission denied')],
    ['interface error code','network.interface.dump',6],
    ['malformed interface','network.interface.dump',{wrong:[]}],
    ['wireless timeout','network.wireless.status',new Error('Timeout')],
    ['malformed wireless','network.wireless.status',{radio0:{}}]
]) test(name+' shows uncertainty, not a confirmed absent inventory',async()=>{
    const app=harness();app.responses[key]=value;await app.mount();
    assert.equal(count(app.root,'nv-detection-warning'),1);assert.match(text(app.root),/检测失败/);
    assert.doesNotMatch(text(app.root),/WAN 未连接|一切正常/);
    assert.equal(count(app.root,'nv-internet'),0);assert.equal(count(app.root,'nv-wifi'),0);
    app.responses[key]=key.includes('interface')?{interface:[]}:{};await app.poll();
    assert.equal(count(app.root,'nv-detection-warning'),0);
});

for (const [error, expected] of [
    ['RPC call to network.interface/dump failed with error 4: Object not found', /对象不存在或无数据（RPC 4）/],
    ['RPC call to network.interface/dump failed with error 6: Permission denied', /权限不足（RPC 6）/],
    ['RPC call to network.interface/dump failed with error 3: Method not found', /方法不可用（RPC 3）/],
    ['RPC call to network.interface/dump failed with error 7: Request timed out', /请求超时（RPC 7）/],
    ['RPC call to network.interface/dump failed with ubus code 4: 未找到', /对象不存在（ubus 4）/],
    ['RPC call to network.interface/dump failed with ubus code 6: 权限不足', /权限不足（ubus 6）/],
    ['RPC call to network.interface/dump failed with ubus code 7: 超时', /请求超时（ubus 7）/],
    ['RPC call to network.interface/dump failed with HTTP error 404', /HTTP 请求失败（HTTP 404）/],
    ['Failed to fetch', /连接失败/],
    ['unexpected payload https://example.test/?token=do-not-display', /请求失败/]
]) test('detection diagnostics classify '+error.split(':')[0], async()=>{
    const app=harness();app.responses['network.interface.dump']=new Error(error);await app.mount();
    assert.match(text(app.root), expected);
    assert.doesNotMatch(text(app.root), /null|undefined|example\.test|do-not-display/);
    assert.equal(count(app.root,'nv-internet'),0);
    app.responses['network.interface.dump']={interface:[]};await app.poll();
    assert.equal(count(app.root,'nv-detection-warning'),0);
    assert.doesNotMatch(text(app.root), /null|undefined|RPC/);
});

function missingRuntime(app, values) {
    app.responses['network.interface.dump']=new Error('RPC call to network.interface/dump failed with ubus code 4: 未找到');
    app.responses['network.wireless.status']=new Error('RPC call to network.wireless/status failed with ubus code 4: 未找到');
    app.responses['uci.get']=(config)=>({values:values[config]||{}});
}
test('missing netifd retains configured LAN with unknown runtime and no phantom WAN/Wi-Fi',async()=>{
    const app=harness();missingRuntime(app,{network:{lan:{'.type':'interface',device:'br-lan',proto:'static'}}});await app.mount();
    assert.equal(count(app.root,'nv-radio'),1);assert.equal(count(app.root,'nv-internet'),0);assert.equal(count(app.root,'nv-wifi'),0);
    assert.match(text(app.root),/按已保存配置展示，运行状态未知/);assert.match(text(app.root),/有线 LANbr-lan/);
    assert.doesNotMatch(text(app.root),/null|undefined|WAN 未连接/);
    await app.poll();assert.ok(!app.calls.some(c=>c[0]==='luci.getRealtimeStats'));
});
test('configured PPPoE and radios stay visible without claiming runtime status or exposing secrets',async()=>{
    const app=harness();missingRuntime(app,{network:{internet:{'.type':'interface',proto:'pppoe',device:'eth1',username:'secret-user',password:'secret-password'}},
        wireless:{radio0:{'.type':'wifi-device',band:'5g',disabled:'0',key:'secret-wireless'}}});await app.mount();
    assert.equal(count(app.root,'nv-internet'),1);assert.equal(count(app.root,'nv-wifi'),1);
    assert.match(text(app.root),/PPPoE/);assert.match(text(app.root),/状态未知/);assert.match(text(app.root),/客户端数不可用/);
    assert.match(text(app.root),/1 个已配置/);
    assert.doesNotMatch(text(app.root),/已检测|已连接|接口未连接|0 客户端|secret-user|secret-password|secret-wireless|null|undefined/);
    await app.poll();assert.ok(!app.calls.some(c=>c[0]==='luci.getRealtimeStats'||c[0]==='iwinfo.assoclist'));
    app.responses['network.interface.dump']={interface:[wanUp]};app.responses['network.wireless.status']={};await app.poll();
    assert.match(text(app.root),/203\.0\.113\.8/);assert.equal(count(app.root,'nv-wifi'),0);assert.equal(count(app.root,'nv-detection-warning'),0);
});
test('saved configuration can change during runtime failure; disabled radios keep configured status',async()=>{
    const app=harness(),values={network:{lan:{'.type':'interface',device:'br-lan'}},wireless:{radio0:{'.type':'wifi-device',band:'2g',disabled:'1'}}};
    missingRuntime(app,values);await app.mount();assert.match(text(app.root),/已禁用（配置）/);
    values.network={};values.wireless={};await app.poll();assert.equal(count(app.root,'nv-radio'),0);assert.equal(count(app.root,'nv-wifi'),0);
    assert.match(text(app.root),/检测失败/);assert.doesNotMatch(text(app.root),/未检测到 LAN/);
});
test('runtime access denial does not read an alternative configuration source',async()=>{
    const app=harness();app.responses['network.interface.dump']=new Error('RPC call to network.interface/dump failed with ubus code 6: 拒绝访问');
    app.responses['network.wireless.status']=new Error('Permission denied');await app.mount();
    assert.ok(!app.calls.some(c=>c[0]==='uci.get'));assert.match(text(app.root),/权限不足/);
});
for (const code of [401,403]) test('HTTP '+code+' blocks all fallback configuration reads',async()=>{
    const app=harness();app.responses['network.interface.dump']=new Error('RPC call failed with HTTP error '+code);
    app.responses['network.wireless.status']=new Error('RPC call failed with HTTP error '+code);await app.mount();
    assert.ok(!app.calls.some(c=>c[0]==='uci.get'));assert.match(text(app.root),new RegExp('权限不足（HTTP '+code+'）'));
});
test('failed later runtime poll retains last-known inventory over configuration fallback',async()=>{
    const app=harness();await app.render([wanUp],{radio0:radio()});missingRuntime(app,{});await app.poll();
    assert.equal(count(app.root,'nv-internet'),1);assert.equal(count(app.root,'nv-wifi'),1);assert.match(text(app.root),/已保留上次检测结果/);
    assert.doesNotMatch(text(app.root),/按已保存配置展示/);
});
test('invalid fallback inventory never manufactures configured ports',async()=>{
    const app=harness();missingRuntime(app,{});app.responses['uci.get']={values:{bad:null}};await app.mount();
    assert.equal(count(app.root,'nv-radio'),0);assert.equal(count(app.root,'nv-internet'),0);assert.match(text(app.root),/检测失败/);
});

test('pending load does not render fake ports before detection completes',async()=>{
    const app=harness();let resolve;
    app.responses['network.interface.dump']=()=>new Promise(r=>{resolve=r;});
    const mounted=app.mount();await Promise.resolve();
    assert.equal(app.root,undefined);resolve({interface:[]});await mounted;
    assert.equal(count(app.root,'nv-internet'),0);
});

test('failed later poll preserves prior inventory with warning, then recovers',async()=>{
    const app=harness();await app.render([wanUp],{radio0:radio()});
    app.responses['network.interface.dump']=new Error('Denied');
    app.responses['network.wireless.status']=new Error('Timeout');
    // luci-rpc may mask that timeout with an empty successful reply.
    app.responses['luci-rpc.getWirelessDevices']={};
    const start=app.calls.length;await app.poll();
    assert.equal(count(app.root,'nv-internet'),1);assert.equal(count(app.root,'nv-wifi'),1);
    assert.match(text(app.root),/已保留上次检测结果/);
    assert.ok(!app.calls.slice(start).some(c=>c[0]==='luci.getRealtimeStats'));
    app.responses['network.interface.dump']={interface:[]};app.responses['network.wireless.status']={};await app.poll();
    assert.equal(count(app.root,'nv-internet'),0);assert.equal(count(app.root,'nv-wifi'),0);assert.equal(count(app.root,'nv-detection-warning'),0);
});

test('association failures display unknown, VLAN associations are included',async()=>{
    const app=harness();app.responses['iwinfo.assoclist']=(dev)=>dev==='phy0-ap0'?{results:[{mac:'a',signal:-50}]}:{results:[{mac:'b',signal:-60}]};
    await app.render([],{radio0:radio('2g',{vlans:[{ifname:'phy0-ap0.10'},{ifname:'phy0-ap0.10'}]})});
    assert.match(text(app.root),/2 个客户端/);
    assert.equal(app.calls.filter(c=>c[0]==='iwinfo.assoclist'&&c[1]==='phy0-ap0.10').length,1);
    app.responses['iwinfo.assoclist']=new Error('Denied');await app.poll();
    assert.match(text(app.root),/客户端数不可用/);assert.equal(count(app.root,'nv-wifi'),1);
});

test('counter-only updates do not replace DOM; real changes preserve focus/detail and sample immediately',async()=>{
    const app=harness();let bytes=0;
    app.responses['iwinfo.assoclist']=()=>({results:[{mac:'a',signal:-50,rx:{bytes:bytes+=100},connected_time:bytes}]});
    await app.render([wanUp],{radio0:radio()});
    const original=app.root,router=all(original,hasClass('nv-router'))[0];router.click();router.focus();
    await app.poll();assert.equal(app.root,original);assert.equal(app.active,router);
    assert.doesNotMatch(text(app.root.querySelector('[data-nova=traffic-down]')),/等待采样/);
    app.responses['network.interface.dump']={interface:[{...wanUp,'ipv4-address':[{address:'203.0.113.9'}]}]};await app.poll();
    assert.notEqual(app.root,original);assert.ok(app.active.isConnected);assert.equal(app.document.getElementById('nv-selected').hidden,false);
    assert.doesNotMatch(text(app.root.querySelector('[data-nova=traffic-down]')),/等待采样/);
    assert.equal(app.polls.size,1);
});

test('late detection response after navigation cannot rebuild page or restart poll',async()=>{
    const app=harness();await app.render([wanUp]);let resolve;
    app.responses['network.interface.dump']=()=>new Promise(r=>{resolve=r;});
    const update=app.poll();await Promise.resolve();app.view.remove();app.document.body.replaceChildren();resolve({interface:[]});await update;
    assert.equal(app.polls.size,0);assert.equal(app.root,undefined);
});

test('read-only ACL covers strict inventories and no router configuration writes',()=>{
    const acl=JSON.parse(fs.readFileSync(path.join(resources,'../../../root/usr/share/rpcd/acl.d/luci-app-nova-dashboard.json'),'utf8'));
    const grant=acl['luci-app-nova-dashboard'];assert.equal(grant.write,undefined);
    assert.deepEqual(grant.read.ubus['network.wireless'],['status']);
    assert.ok(grant.read.uci.includes('network') && grant.read.uci.includes('wireless'));
    const app=harness();
    for(const name of ['network.interface.dump','network.wireless.status','luci-rpc.getWirelessDevices'])assert.equal(app.declarations[name].reject,true);
});

test('versioned stylesheet is upgraded once; render and remove maintain one poll',async()=>{
    const app=harness();await app.render();assert.equal(app.polls.size,1);
    const style=app.document.head.children[0];assert.equal(style.attrs.href,'/luci-static/resources/nova/dashboard.css?v=0.2.4');
    assert.ok(fs.statSync(path.join(resources,'nova/dashboard.css')).size>0);
    for(const old of ['','?v=0.2.2']){
        app.view.remove();style.attrs.href='/luci-static/resources/nova/dashboard.css'+old;
        await app.render();assert.equal(app.document.head.children.length,1);assert.match(style.attrs.href,/\?v=0\.2\.4$/);assert.equal(app.polls.size,1);
    }
    app.view.remove();assert.equal(app.polls.size,0);
});
