'use strict';
'require view';
'require rpc';
'require poll';
'require fs';

// Keep in sync with PKG_VERSION; tests enforce this cache key on every release.
var dashboardAssetVersion = '0.2.9';

var getBoard = rpc.declare({ object: 'system', method: 'board' });
var getInfo = rpc.declare({ object: 'system', method: 'info' });
// Do not default failed detection to an empty inventory. LuCI RPC otherwise
// resolves ubus error codes (and expect:{} can silently mask them).
var getInterfaces = rpc.declare({ object: 'network.interface', method: 'dump', reject: true });
var getWirelessStatus = rpc.declare({ object: 'network.wireless', method: 'status', reject: true });
var getConfig = rpc.declare({ object: 'uci', method: 'get', params: [ 'config', 'type' ], reject: true });
var getWireless = rpc.declare({ object: 'luci-rpc', method: 'getWirelessDevices', reject: true });
var getAssocs = rpc.declare({ object: 'iwinfo', method: 'assoclist', params: [ 'device' ], reject: true });
var getRealtime = rpc.declare({
    object: 'luci', method: 'getRealtimeStats',
    params: [ 'mode', 'device' ], expect: { result: [] }
});
function object(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function interfaceDump(value) {
    if (!object(value) || !Array.isArray(value.interface) || value.interface.some(function(n) {
        return !object(n) || typeof n.interface !== 'string' ||
            ['route','ipv4-address','ipv6-address','dns-server'].some(function(key){return n[key]!=null && !Array.isArray(n[key]);}) ||
            (n.inactive!=null && (!object(n.inactive) || (n.inactive.route!=null && !Array.isArray(n.inactive.route))));
    })) throw new Error('Invalid interface inventory');
    return value;
}
function wirelessDump(value) {
    if (!object(value) || Object.keys(value).some(function(name) {
        var radio = value[name];
        return !object(radio) || !object(radio.config) || !Array.isArray(radio.interfaces) || radio.interfaces.some(function(vif){return !object(vif);});
    })) throw new Error('Invalid wireless inventory');
    return value;
}
// luci-rpc returns netifd's configured radios, including disabled/down radios.
// A radio with no VIF still exists. Do not invent wlan names or default bands.
function wifiNetworks(radios) {
    var nets = [];
    Object.keys(radios || {}).forEach(function(name) {
        var radio = radios[name];
        (radio.interfaces.length ? radio.interfaces : [{}]).forEach(function(vif) {
            var config = vif.config || {}, iw = vif.iwinfo || radio.iwinfo || {}, rc = radio.config;
            nets.push({
                getName: function() { return vif.section || name; },
                getIfname: function() { return vif.ifname || ''; },
                getAssocDevices: function() { return [vif.ifname].concat((vif.vlans || []).map(function(v){return v.ifname;})).filter(function(n,i,a){return n && a.indexOf(n)===i;}); },
                getActiveSSID: function() { return iw.ssid || config.ssid || name; },
                getFrequency: function() { return iw.frequency ? iw.frequency / 1000 : null; },
                getChannel: function() { return iw.channel || null; },
                getTXPower: function() { return iw.txpower != null ? iw.txpower : null; },
                getNoise: function() { return iw.noise != null ? iw.noise : null; },
                getBand: function() { return rc.band || (rc.hwmode === '11a' ? '5g' : rc.hwmode === '11g' ? '2g' : ''); },
                isDisabled: function() { return radio.disabled === true || rc.disabled === true || rc.disabled === '1' || config.disabled === true || config.disabled === '1'; },
                isKnown: function() { return !radio.configuredOnly; },
                isUp: function() { return radio.up === true && !!vif.ifname; }
            });
        });
    });
    return nets;
}
function detectionError(error) {
    // Show bounded diagnostics, never RPC payloads, URLs or credentials.
    // LuCI translates descriptions, so use numeric ubus codes first.
    var message = error && error.message || '', reason = '请求失败';
    var code = message.match(/ubus code (\d{1,3})(?:\D|$)/);
    var labels = {1:'方法不可用',3:'方法不可用',4:'对象不存在',5:'无数据',6:'权限不足',7:'请求超时',8:'方法不可用',10:'连接失败'};
    if (code) return (labels[code[1]] || reason)+'（ubus '+code[1]+'）';
    code = message.match(/HTTP error (\d{3})(?:\D|$)/i);
    if (code) return (code[1]==='401'||code[1]==='403'?'权限不足':'HTTP 请求失败')+'（HTTP '+code[1]+'）';
    if (/Invalid (interface|wireless|configuration) inventory/.test(message)) reason = '返回格式异常';
    else if (/permission|access denied/i.test(message)) reason = '权限不足';
    else if (/method not found|not supported|invalid command/i.test(message)) reason = '方法不可用';
    else if (/not found|no data/i.test(message)) reason = '对象不存在或无数据';
    else if (/timeout|timed out/i.test(message)) reason = '请求超时';
    else if (/failed to fetch|NetworkError|network request|connection failed|connection refused|network unreachable/i.test(message)) reason = '连接失败';
    code = message.match(/(?:error|code)\s+(-?\d{1,7})(?:\D|$)/i);
    return reason + (code ? '（RPC '+code[1]+'）' : '');
}
function accessDenied(error) {
    var message = error && error.message || '';
    // The SDK jsmin misparses regex literals directly after return and can
    // remove meaningful spaces. Assign the expression before returning it.
    var denied = /ubus code 6(?:\D|$)|HTTP error (401|403)(?:\D|$)|(?:error|code) -32002(?:\D|$)|permission|access denied/i;
    return denied.test(message);
}
function configuredInventory(value, type) {
    if (!object(value) || !object(value.values) || Object.keys(value.values).some(function(name) { return !object(value.values[name]); }))
        throw new Error('Invalid configuration inventory');
    // Copy only display fields; never keep PPP credentials or wireless keys.
    var interfaces = [], radios = {};
    Object.keys(value.values).forEach(function(name) {
        var section = value.values[name];
        if (section['.type'] !== type) return;
        function text(key) { return typeof section[key] === 'string' ? section[key] : ''; }
        if (type === 'interface') interfaces.push({interface:name,proto:text('proto'),device:text('device') || text('ifname'),configuredOnly:true});
        else radios[name] = {config:{band:text('band'),hwmode:text('hwmode'),disabled:text('disabled')},interfaces:[],configuredOnly:true};
    });
    return type === 'interface' ? {interface:interfaces} : radios;
}
function readDetection() {
    var errors = {}, denied = {};
    function inventory(task, name) {
        return Promise.resolve(task).catch(function(error) {
            errors[name] = detectionError(error);
            denied[name] = accessDenied(error);
            return null;
        });
    }
    return Promise.all([
        inventory(getInterfaces().then(interfaceDump), 'interfaces'),
        inventory(Promise.all([getWirelessStatus().then(wirelessDump),safe(getWireless(),null)]).then(function(results){
            var status=results[0], enriched=results[1];
            // luci-rpc masks an underlying netifd timeout as {}, so only the
            // direct network.wireless status may establish presence/absence.
            Object.keys(status).forEach(function(name){
                var extra=object(enriched) && enriched[name];
                if(!object(extra))return;
                status[name].iwinfo=extra.iwinfo;
                status[name].interfaces.forEach(function(vif){
                    var match=(Array.isArray(extra.interfaces)?extra.interfaces:[]).find(function(n){return object(n) && n.section===vif.section && n.ifname===vif.ifname;});
                    if(match)vif.iwinfo=match.iwinfo;
                });
            });
            return status;
        }), 'wireless')
    ]).then(function(results) {
        // Runtime failure is not absence. Read already-authorized configuration
        // only as a labelled fallback, never as proof of current hardware/state.
        // Do not try an alternate source after an explicit runtime access denial.
        return Promise.all([
            results[0]===null && !denied.interfaces ? inventory(getConfig('network','interface').then(function(value){return configuredInventory(value,'interface');}), 'interfaceConfig') : null,
            results[1]===null && !denied.wireless ? inventory(getConfig('wireless','wifi-device').then(function(value){return configuredInventory(value,'wifi-device');}), 'wirelessConfig') : null
        ]).then(function(configs) { return results.concat([errors], configs); });
    });
}
function readStations(nets) {
    return Promise.all(nets.map(function(n) {
        if (n.isKnown && !n.isKnown()) return null;
        if (!n.isUp() || n.isDisabled() || !n.getIfname()) return [];
        return safe(Promise.all(n.getAssocDevices().map(function(device){
            return getAssocs(device).then(function(value) {
                if (!object(value) || !Array.isArray(value.results)) throw new Error('Invalid station list');
                return value.results;
            });
        })).then(function(lists){return [].concat.apply([],lists);}), null);
    }));
}

function safe(task, fallback) {
    return Promise.resolve(task).catch(function() { return fallback; });
}
function number(v) { return isFinite(Number(v)) ? Number(v) : 0; }
function percent(a,b) { return b > 0 ? Math.max(0,Math.min(100,Math.round(a/b*100))) : null; }
function mib(n) { return Math.round(number(n)/1048576) + ' MiB'; }
function rate(bytes) {
    var bps = Math.max(0, number(bytes)) * 8;
    if (bps >= 1e9) return (bps/1e9).toFixed(2)+' Gbit/s';
    if (bps >= 1e6) return (bps/1e6).toFixed(2)+' Mbit/s';
    if (bps >= 1e3) return (bps/1e3).toFixed(1)+' kbit/s';
    return Math.round(bps)+' bit/s';
}
function attrValue(node, val) { if (node) node.textContent = val; }
function dot(){ return E('span', {'class':'nv-dot', 'aria-hidden':'true'}); }
function label(text) {return E('span', {'class':'nv-kicker'}, text);}
function tag(text, kind) {return E('span', {'class':'nv-tag '+(kind || '')}, text);}
function children(contents) {
    // LuCI 25.12 stringifies null array entries rather than ignoring them.
    return Array.isArray(contents) ? contents.filter(function(child) { return child != null; }) : contents;
}
function el(kind, klass, contents){return E(kind, {'class':klass}, children(contents));}
// All dashboard ornaments use one line-icon family. They are decorative, not
// health checks: unavailable CPU/storage/network data must never get a checkmark.
// LuCI E() uses document.createElement, including for an "svg" tag. SVG roots
// and their shapes must be created explicitly in the SVG namespace.
function svg(kind, attrs, content) {
    var element = document.createElementNS('http://www.w3.org/2000/svg', kind);
    Object.keys(attrs || {}).forEach(function(key){element.setAttribute(key,attrs[key]);});
    (content || []).forEach(function(child){element.appendChild(child);});
    return element;
}
function icon(kind) {
    var paths = {
        cpu:['7,7 17,7 17,17 7,17 7,7','10,10 14,10 14,14 10,14 10,10','9,3 9,7','15,3 15,7','9,17 9,21','15,17 15,21','3,9 7,9','3,15 7,15','17,9 21,9','17,15 21,15'],
        memory:['3,7 21,7 21,17 3,17 3,7','7,10 7,14','11,10 11,14','15,10 15,14','7,17 7,20','12,17 12,20','17,17 17,20'],
        disk:['5,4 19,4 21,15 21,20 3,20 3,15 5,4','3,15 21,15','16,18 18,18'],
        wifi:['2,8 6,5 12,3 18,5 22,8','5,12 8,9 12,8 16,9 19,12','9,16 12,14 15,16','12,20 12,20'],
        signal:['4,19 4,16','9,19 9,12','14,19 14,8','19,19 19,4'],
        'rate-down':['8,3 8,20 3,15','8,20 13,15','16,21 16,4 11,9','16,4 21,9'],
        router:['4,11 20,11 21,20 3,20 4,11','7,11 5,3','17,11 19,3','7,16 7,16','11,16 11,16','15,16 17,16'],
        lan:['4,7 20,7 20,20 4,20 4,7','8,7 8,3 16,3 16,7','8,11 8,15','12,11 12,15','16,11 16,15'],
        client:['3,4 21,4 21,16 3,16 3,4','8,21 16,21','12,16 12,21'],
        internet:['4,7 8,3 16,3 20,7 21,12 20,17 16,21 8,21 4,17 3,12 4,7','3,12 21,12','12,3 8,8 8,16 12,21 16,16 16,8 12,3'],
        path:['3,5 9,5 9,11 3,11 3,5','15,13 21,13 21,19 15,19 15,13','6,11 6,16 15,16','18,13 18,8 9,8'],
        activity:['2,13 6,13 9,5 14,20 17,10 19,13 22,13']
    };
    return svg('svg', {'class':'nv-icon','viewBox':'0 0 24 24','fill':'none','stroke':'currentColor',
        'stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true','focusable':'false'},
        (paths[kind] || paths.activity).map(function(points){return svg('polyline',{'points':points});}));
}
function metric(name,value,detail,key){
    return el('div','nv-metric',[
        el('span','nv-metric-icon', icon(key)),
        el('div','nv-metric-main',[
            el('div','nv-metric-label',name),
            E('strong',key ? {'data-nova':key} : {},value),
            el('small','nv-metric-sub',detail)
        ])
    ]);
}
function detailLine(a,b){return el('span','nv-detail-line',[label(a),el('strong','',b)]);}
function node(klass,iconKind,name,sub,details,target) {
    return E('button',{
        'class':'nv-node '+klass,'type':'button','data-nova-node':klass.split(' ')[0]+'|'+name,
        'title':details,
        'click':function(){
            var field=document.getElementById('nv-selected');
            if(field) {
                field.hidden=false;
                field.setAttribute('data-nova-node',klass.split(' ')[0]+'|'+name);
                field.replaceChildren(
                    el('strong','',name+' · '),
                    document.createTextNode(details),
                    target ? E('a',{'href':target},'查看设置 →') : document.createTextNode('')
                );
            }
        }
    },[
        el('span','nv-node-icon',icon(iconKind)),
        el('span','nv-node-text',[el('strong','nv-truncate',name),el('small','nv-truncate',sub)])
    ]);
}
function bucket(net){
    var f=Number(net.getFrequency ? net.getFrequency() : 0);
    if(f>=5.925 && f<=7.125) return '6';
    if(f>=4.8 && f<5.925) return '5';
    if(f>2 && f<3) return '2.4';
    var band=net.getBand && net.getBand();
    return band==='2g' ? '2.4' : band==='5g' ? '5' : band==='6g' ? '6' : 'other';
}
function bandName(band) { return band === 'other' ? '无线（频段未知）' : band+' GHz'; }
function wifiState(g) {
    var unknown=g.some(function(n){return n.net.isKnown && !n.net.isKnown();});
    if(g.every(function(n){return n.net.isDisabled && n.net.isDisabled();})) return unknown ? '已禁用（配置）' : '已禁用';
    if(unknown) return '状态未知';
    return g.some(function(n){return n.net.isUp && n.net.isUp();}) ? '已启用' : '未连接';
}
function bands(networks,assocLists){
    var map={'2.4':[], '5':[], '6':[], 'other':[]};
    (networks||[]).forEach(function(n,i){
        var info={net:n,assocs:assocLists[i]||[], known:Array.isArray(assocLists[i]), band:bucket(n)};
        map[info.band].push(info);
    });
    return map;
}
function groupCount(g){return (g||[]).reduce(function(v,n){return v+n.assocs.length;},0);}
function clientSummary(g) { return g.every(function(n){return n.known;}) ? groupCount(g)+' 客户端' : '客户端数不可用'; }
function firstNet(g){
    return (g||[]).find(function(a){return a.net.isUp && a.net.isUp() && (!a.net.isDisabled || !a.net.isDisabled());}) ||
        (g||[]).find(function(a){return a.net.getIfname && a.net.getIfname() && (!a.net.isDisabled || !a.net.isDisabled());}) || (g||[])[0];
}
function wifiSummary(g){
    if(!g || !g.length) return '未检测到无线接口';
    var n=firstNet(g);
    return (n.net.getActiveSSID && n.net.getActiveSSID() || n.net.getIfname() || 'Wi-Fi')+' · '+wifiState(g)+' · '+clientSummary(g);
}
function wifiCard(band,g){
    var info=firstNet(g), net=info&&info.net;
    var ch=net&&net.getChannel?net.getChannel():null;
    var f=net&&net.getFrequency?net.getFrequency():null;
    var tx=net&&net.getTXPower?net.getTXPower():null;
    var noise=net&&net.getNoise?net.getNoise():null;
    var count=groupCount(g);
    var id=band.replace('.','');
    var colour=band==='2.4'?'blue':band==='5'?'orange':'purple';
    return E('section',{'class':'nv-panel nv-wifi nv-'+colour},[
        el('div','nv-panel-head',[
            el('div','nv-panel-title',[tag(bandName(band),colour),el('strong','', 'Wi-Fi')]),
            el('div','nv-online'+(wifiState(g)==='已启用'?'':' nv-inactive'), [dot(),wifiState(g)])
        ]),
        el('div','nv-wifi-main',[el('strong','', ch ? '信道 '+ch : '—'), E('span',{},f?f+' GHz':'无线信息不可用')]),
        el('div','nv-band-meter',[E('span',{'style':'width:'+Math.max(0,Math.min(100,number(ch)*1.25))+'%'})]),
        el('div','nv-band-caption',[el('span','',wifiSummary(g))]),
        el('div','nv-wifi-stats',[
            detailLine('客户端',g.every(function(n){return n.known;}) ? String(count) : '不可用'),
            detailLine('发射功率', tx != null ? tx+' dBm' : '—'),
            detailLine('噪声', noise != null ? noise+' dBm' : '—'),
            detailLine('接口', net&&net.getIfname&&net.getIfname() || '—')
        ]),
        el('div','nv-mini-chart',[
            svg('svg',{'viewBox':'0 0 360 76','preserveAspectRatio':'none','aria-label':bandName(band)+' 实时吞吐量'},[
                svg('line',{'x1':'0','y1':'65','x2':'360','y2':'65','class':'nv-axis'}),
                svg('polyline',{'data-nova':'wifi-'+id,'class':'nv-spark','points':'0,65 360,65'})
            ]),
            E('span',{'data-nova':'wifi-rate-'+id,'class':'nv-mini-rate'},net && net.isKnown && !net.isKnown() ? '运行状态未知' : net && net.isUp && net.isUp() ? '等待采样' : '接口未连接')
        ])
    ]);
}
function defaultRoute(n) {
    return (n.route || []).concat(n.inactive && n.inactive.route || []).some(function(r) {
        return (r.target === '0.0.0.0' || r.target === '::') && Number(r.mask) === 0;
    });
}
function getWan(interfaces){
    var candidates=interfaces.filter(function(n) {
        return defaultRoute(n) || n.proto === 'pppoe' || n.interface === 'wan' || n.interface === 'wan6';
    });
    return candidates.find(function(n){return n.up && defaultRoute(n);}) ||
        candidates.find(function(n){return n.up;}) || candidates[0] || null;
}
function wanState(wan) { return wan.up ? '已连接' : wan.pending ? '连接中' : '未连接'; }
function wanLabel(wan) { return (wan.proto === 'pppoe' ? 'PPPoE' : (wan.proto || 'WAN').toUpperCase())+' · '+wan.interface; }
function getAddress(wan, ipv6){
    if(!wan) return '—';
    var arr=wan[ipv6?'ipv6-address':'ipv4-address'];
    return Array.isArray(arr) && arr.length && arr[0].address || '—';
}
function getCpuSample(text){
    var line=String(text||'').split('\n')[0].trim().split(/\s+/);
    if(line[0]!=='cpu') return null;
    var numbers=line.slice(1).map(Number);
    if(numbers.some(function(n){return !isFinite(n);}))return null;
    var total=numbers.reduce(function(a,b){return a+b;},0);
    return {total:total,idle:(numbers[3]||0)+(numbers[4]||0)};
}
function parseGraphRows(raw){
    var arr=Array.isArray(raw)?raw:[];
    var down=[],up=[];
    for(var i=1;i<arr.length;i++){
        var prev=arr[i-1],curr=arr[i];
        if(!Array.isArray(curr)||!Array.isArray(prev))continue;
        var dt=number(curr[0])-number(prev[0]);
        if(dt<=0)continue;
        down.push(Math.max(0,(number(curr[1])-number(prev[1]))/dt));
        up.push(Math.max(0,(number(curr[3])-number(prev[3]))/dt));
    }
    return {down:down.slice(-60),up:up.slice(-60)};
}
function points(data, peak, width, height){
    var arr=data||[], p=Math.max(1,peak), xstep=arr.length>1?width/(arr.length-1):0;
    if(!arr.length) return '0,'+height+' '+width+','+height;
    return arr.map(function(v,i){
        return (i*xstep).toFixed(1)+','+(height-Math.min(1,v/p)*(height-10)).toFixed(1);
    }).join(' ');
}
function fillChart(raw,downPath,upPath,downRate,upRate,peakLabel){
    var lines=parseGraphRows(raw);
    var p=Math.max(1024,Math.max.apply(Math,lines.down.concat(lines.up,[0]))*1.2);
    if(downPath)downPath.setAttribute('points',points(lines.down,p,600,145));
    if(upPath)upPath.setAttribute('points',points(lines.up,p,600,145));
    attrValue(downRate,lines.down.length?rate(lines.down[lines.down.length-1]):'等待采样');
    attrValue(upRate,lines.up.length?rate(lines.up[lines.up.length-1]):'等待采样');
    attrValue(peakLabel,lines.down.length||lines.up.length?rate(p/1.2):'—');
}
return view.extend({
    load:function(){
        return Promise.all([
            safe(getBoard(),{}), safe(getInfo(),{}), readDetection(),
            safe(fs.read('/proc/stat'),null), safe(fs.read('/sys/class/thermal/thermal_zone0/temp'),null)
        ]).then(function(d){
            var nets=wifiNetworks(d[2][1] || d[2][4]);
            return readStations(nets).then(function(stations){
                return [d[0],d[1],d[2][0] || d[2][3],nets,{},d[3],d[4],stations,
                    {interfaces:d[2][0]!==null,wireless:d[2][1]!==null,errors:d[2][2],interfacesConfigured:d[2][0]===null && d[2][3]!==null,wirelessConfigured:d[2][1]===null && d[2][4]!==null},d[2][1] || d[2][4]];
            });
        });
    },
    render:function(data){
        var board=data[0]||{}, sys=data[1]||{}, entries=(data[2]||{}).interface||[];
        var nets=data[3]||[], cpuRaw=data[5],tempRaw=data[6],assocs=data[7]||[];
        var detected=data[8] || {interfaces:!!data[2],wireless:Array.isArray(data[3])};
        var groups=bands(nets,assocs), wifiAll=groups['2.4'].concat(groups['5'],groups['6'],groups.other);
        var totalClients=wifiAll.reduce(function(v,n){return v+n.assocs.length;},0);
        var clientSignals=wifiAll.reduce(function(v,n){
            return v.concat(n.assocs.filter(function(a){return typeof a.signal==='number' && a.signal < 0;}).map(function(a){return a.signal;}));
        },[]);
        var worst=clientSignals.length?Math.min.apply(Math,clientSignals):null;
        var wan=getWan(entries);
        var wanDev=wan&&(wan.l3_device || wan.device);
        var lan=entries.find(function(n){return n.interface==='lan';}) || {};
        var hasLan=!!lan.interface;
        var lanDev=lan.l3_device || lan.device;
        var lanSummary=lanDev ? 'LAN '+lanDev : hasLan ? 'LAN '+lan.interface+' · '+(detected.interfaces?'未连接':'状态未知') : detected.interfaces ? '未检测到 LAN 接口' : '接口检测失败';
        if(hasLan && detected.interfacesConfigured)lanSummary+='（已配置，运行状态未知）';
        var mem=sys.memory||{},root=sys.root||{};
        var memUsed=number(mem.total)-number(mem.available!=null?mem.available:mem.free);
        var memPct=percent(memUsed,mem.total);
        var diskPct=percent(root.used,root.total);
        var cpuTemp=Number(String(tempRaw||'').trim())/1000;
        var tempText=isFinite(cpuTemp)&&cpuTemp>0&&cpuTemp<130 ? cpuTemp.toFixed(0)+'°C' : '';
        var conn=!!(wan&&wan.up), status=detected.interfaces&&wan?wanState(wan):'状态未知', model=board.model||board.system||'OpenWrt Router';
        var firmware=board.release&&board.release.description||'OpenWrt';
        var ip=getAddress(wan,false);
        var shownBands=['2.4','5','6','other'].filter(function(band){return groups[band].length;});
        var visibleBands=shownBands.filter(function(band){return band!=='other';}).length;
        var clientsKnown=detected.wireless && wifiAll.every(function(n){return n.known;});
        var warnings=[];
        if(!detected.interfaces) warnings.push('接口检测失败，无法确认 WAN/LAN 是否存在'+(detected.errors && detected.errors.interfaces ? '：'+detected.errors.interfaces : ''));
        if(!detected.wireless) warnings.push('无线检测失败，无法确认无线接口是否存在'+(detected.errors && detected.errors.wireless ? '：'+detected.errors.wireless : ''));
        if(detected.errors && detected.errors.interfaceConfig)warnings.push('网络配置读取失败：'+detected.errors.interfaceConfig);
        if(detected.errors && detected.errors.wirelessConfig)warnings.push('无线配置读取失败：'+detected.errors.wirelessConfig);
        if(detected.interfacesConfigured || detected.wirelessConfigured) warnings.push('按已保存配置展示，运行状态未知，不能据此确认物理接口存在');
        if((!detected.interfaces && !detected.interfacesConfigured && (wan || hasLan)) || (!detected.wireless && !detected.wirelessConfigured && nets.length)) warnings.push('已保留上次检测结果，状态可能已过期');
        var channels=[], clients=[];
        shownBands.forEach(function(band){
            var group=groups[band], title=bandName(band);
            channels.push(node('nv-radio'+(band==='5'?' nv-five':''),'wifi',title,wifiState(group),
                title+' · '+wifiSummary(group),L.url('admin/network/wireless')));
            clients.push(node('nv-client','client',firstNet(group).net.getActiveSSID() || title,
                clientSummary(group),'该频段关联'+clientSummary(group),L.url('admin/status/overview')));
        });
        if(hasLan){
            channels.push(node('nv-radio','lan','有线 LAN',lanDev || (detected.interfaces?'未连接':'状态未知'),'有线设备数暂不可判定 · '+lanSummary,L.url('admin/network/network')));
            clients.push(node('nv-client','lan','LAN',lan.device||lanDev||(detected.interfaces?'未连接':'状态未知'),'有线端口和设备详情请查看接口设置',L.url('admin/network/network')));
        }
        var path=[];
        if(wan){
            path.push(node('nv-internet'+(conn?'':' nv-inactive'),'internet',wanLabel(wan),status+(conn?' · '+(ip==='—'?getAddress(wan,true):ip):''),
                wanLabel(wan)+' · '+status+' · 设备 '+(wanDev||'尚未建立')+' · IPv4 '+ip+' · IPv6 '+getAddress(wan,true)+' · DNS '+((wan['dns-server']||[]).join(', ')||'—'),L.url('admin/network/network')));
            path.push(el('div','nv-wireline'+(conn?'':' nv-inactive'),[E('strong',{'data-nova':'path-download'},!detected.interfaces?'状态未知':conn?'↓ 等待采样':'未连接'),E('small',{},wanDev||wan.interface)]));
        }
        path.push(node('nv-router','router',board.hostname||'本地主路由',model,firmware+' · '+lanSummary,L.url('admin/status/overview')));
        if(channels.length){
            path.push(E('div',{'class':'nv-fork','style':'height:'+Math.max(0,(channels.length-1)*75)+'px'},[el('span','','')]));
            path.push(el('div','nv-path-channels',channels));
            path.push(el('div','nv-branch-lines',channels.map(function(){return el('span','','');})));
            path.push(el('div','nv-path-clients',clients));
        }
        var pathStats=[];
        if(nets.length){
            pathStats.push(el('div','',[label('客户端'),el('strong','',clientsKnown?String(totalClients):'—'),el('small','',clientsKnown?totalClients+' 个 Wi-Fi 已关联':'客户端信息不可用')]));
            pathStats.push(el('div','',[label('无线频段'),el('strong','',visibleBands ? visibleBands+(detected.wirelessConfigured?' 个已配置':' 个已检测'):'频段未知'),el('small','',nets.length+' 个无线配置')]));
            pathStats.push(el('div','',[label('最弱信号'),el('strong','',worst!=null?worst+' dBm':'—'),el('small','',worst!=null?'来自已关联 Wi-Fi 客户端':'暂无客户端信号数据')]));
        }
        if(wan)pathStats.push(el('div','',[label('当前流量'),E('strong',{'data-nova':'path-flow'},!detected.interfaces?'状态未知':conn?'等待采样':'未连接'),el('small','',wanLabel(wan))]));
        var mainCard=el('section','nv-panel nv-topology',[
            el('div','nv-panel-head',[
                el('div','nv-panel-title',[el('span','nv-head-icon',icon('path')),el('strong','', '网络路径')]),
                el('span','nv-muted','点击节点查看详情')
            ]),
            el('div','nv-path-scroll',[
                el('div','nv-path'+(wan?'':' nv-no-wan')+(channels.length?'':' nv-no-branches'),path)
            ]),
            E('div',{'id':'nv-selected','class':'nv-node-detail','hidden':true}),
            pathStats.length ? el('div','nv-path-stats',pathStats) : null
        ]);
        var header=el('div','nv-overview-head',[
            el('span','nv-pulse'+(!conn||!detected.interfaces?' nv-inactive':''),''),
            el('div','nv-title-group',[
                E('h2',{}, !detected.interfaces ? '接口状态暂不可用' : wan ? (conn?'上行链路已连接':'上行链路'+wanState(wan)) : '本地网络概览'),
                el('p','',model+' · '+firmware+(nets.length?' · '+(clientsKnown?totalClients+' 个无线客户端':'无线客户端数不可用'):''))
            ]),
            E('span',{'class':'nv-updated'},[dot(),'实时 · 每 3 秒更新'])
        ]);
        var cards=el('div','nv-metric-grid',[
            wan ? metric('上行链路',!detected.interfaces?'状态未知':conn?'↓ 等待采样':status,wanLabel(wan)+(wanDev?' · '+wanDev:''),'rate-down') : null,
            metric('CPU', '等待采样', '负载 '+(sys.load&&sys.load.length?(number(sys.load[0])/65535).toFixed(2):'—')+(tempText?' · '+tempText:''),'cpu'),
            metric('内存',memPct!=null?'可用 '+(100-memPct)+'%':'—',mib(memUsed)+' / '+mib(mem.total),'memory'),
            nets.length ? metric('Wi-Fi',visibleBands?visibleBands+' 个频段':'频段未知',nets.length+' 个无线配置 · '+(clientsKnown?totalClients+' 个客户端':'客户端数不可用'),'wifi') : null,
            nets.length ? metric('信号强度',worst!=null?worst+' dBm':'暂无数据',worst!=null?(worst>=-75?'信号正常':'存在弱信号客户端'):'没有可用的客户端信号','signal') : null,
            metric('存储',diskPct!=null?'已用 '+diskPct+'%':'—',root.total?('剩余 '+Math.max(0,Math.round((root.total-root.used)/1024))+' MiB'):'无法获取根分区使用率','disk')
        ]);
        var trend=el('section','nv-panel nv-traffic',[
            el('div','nv-panel-head',[
                el('div','nv-panel-title',[el('span','nv-head-icon',icon('activity')),el('strong','', '吞吐量'),el('span','nv-muted','实时采集 · WAN 接口')]),
                el('div','nv-legend',[el('span','nv-legend-down','下载'),el('span','nv-legend-up','上传')])
            ]),
            el('div','nv-traffic-content',[
                el('div','nv-traffic-numbers',[
                    label(wan?wanLabel(wan):''),
                    E('strong',{'data-nova':'traffic-down'},!detected.interfaces?'状态未知':conn?'等待采样':'未连接'),
                    E('span',{'data-nova':'traffic-up','class':'nv-upload-label'},!detected.interfaces?'—':conn?'↑ 等待采样':'—'),
                    E('small',{},['峰值 ',E('span',{'data-nova':'traffic-peak'},'—')])
                ]),
                svg('svg',{'class':'nv-traffic-chart','viewBox':'0 0 600 150','preserveAspectRatio':'none','role':'img','aria-label':'WAN 实时上下行速率'},[
                    svg('line',{'class':'nv-gridline','x1':'0','y1':'37','x2':'600','y2':'37'}),
                    svg('line',{'class':'nv-gridline','x1':'0','y1':'76','x2':'600','y2':'76'}),
                    svg('line',{'class':'nv-gridline','x1':'0','y1':'115','x2':'600','y2':'115'}),
                    svg('polyline',{'class':'nv-line-down','data-nova':'down-path','points':'0,145 600,145'}),
                    svg('polyline',{'class':'nv-line-up','data-nova':'up-path','points':'0,145 600,145'})
                ])
            ]),
            el('div','nv-chart-note','显示实际采样数据；尚未采样时不生成模拟曲线。')
        ]);
        var panels=shownBands.map(function(band){return wifiCard(band,groups[band]);});
        if(wan)panels.unshift(trend);
        var bottom=panels.length ? el('div','nv-bottom-grid',panels) : null;
        var notice=warnings.length ? E('p',{'class':'nv-detection-warning','role':'status'},warnings.join('；')+'。正在自动重试。') : null;
        var root=E('div',{'class':'nova-dashboard'},children([header,notice,cards,mainCard,bottom]));
        var styleHref=L.resource('nova/dashboard.css')+'?v='+dashboardAssetVersion;
        var style=document.getElementById('nova-dashboard-style');
        if(!style){
            document.head.appendChild(E('link',{'id':'nova-dashboard-style','rel':'stylesheet','href':styleHref}));
        }else if(style.getAttribute('href')!==styleHref){
            style.setAttribute('href',styleHref);
        }
        var self=this, prevSample=this._novaCpuSample || getCpuSample(cpuRaw);
        var wifiDevs=shownBands.map(function(band){return {id:band.replace('.',''),net:(firstNet(groups[band])||{}).net};});
        // Compare display-relevant inventory only: uptime and byte counters must
        // not rebuild the DOM every poll or interrupt an open detail/focus.
        function signature(d){
            return JSON.stringify({
                interfaces:((d[2]||{}).interface||[]).map(function(n){return [n.interface,n.proto,n.up,n.pending,n.device,n.l3_device,n['ipv4-address'],n['ipv6-address'],n['dns-server'],defaultRoute(n)];}),
                wireless:(d[3]||[]).map(function(n,i){return [n.getName(),n.getIfname(),n.getActiveSSID(),n.getFrequency(),n.getChannel(),n.getBand(),n.isUp(),n.isDisabled(),n.getTXPower(),n.getNoise(),(d[7]||[])[i]===null?null:((d[7]||[])[i]||[]).map(function(a){return [a.mac,a.signal];})];}),
                detected:d[8]
            });
        }
        var lastSignature=signature(data), updating=false;
        function refresh(){
            return readDetection().then(function(d){
                var next=data.slice();
                next[8]={interfaces:d[0]!==null,wireless:d[1]!==null,errors:d[2],interfacesConfigured:!!data[8].interfacesConfigured,wirelessConfigured:!!data[8].wirelessConfigured};
                if(d[0]!==null){next[2]=d[0];next[8].interfacesConfigured=false;}
                else if(d[3]!==null && (!next[2] || next[8].interfacesConfigured)){next[2]=d[3];next[8].interfacesConfigured=true;}
                if(d[1]!==null){next[9]=d[1];next[3]=wifiNetworks(d[1]);next[8].wirelessConfigured=false;}
                else if(d[4]!==null && (!next[9] || next[8].wirelessConfigured)){next[9]=d[4];next[3]=wifiNetworks(d[4]);next[8].wirelessConfigured=true;}
                return readStations(next[3]).then(function(stations){
                    next[7]=stations;
                    if(!root.isConnected || self._novaPoll!==update)return false;
                    if(signature(next)===lastSignature)return true;
                    // Preserve selection/focus across a topology change. Never
                    // re-use WAN rates after a PPP device/name switch.
                    var selected=root.querySelector('.nv-node:focus');
                    var detail=document.getElementById('nv-selected');
                    var title=selected&&selected.getAttribute('data-nova-node');
                    var detailKey=detail&&!detail.hidden&&detail.getAttribute('data-nova-node');
                    var replacement=self.render(next);
                    root.replaceWith(replacement);
                    Array.prototype.forEach.call(replacement.querySelectorAll('.nv-node'),function(n){
                        if(detailKey && n.getAttribute('data-nova-node')===detailKey)n.click();
                        if(title && n.getAttribute('data-nova-node')===title)n.focus();
                    });
                    return self._novaSampleRates().then(function(){return false;});
                });
            });
        }
        function sampleRates(){
            var tasks=[
                safe(getInfo(),{}),
                safe(fs.read('/proc/stat'),null),
                conn&&wanDev&&detected.interfaces?safe(getRealtime('interface',wanDev),[]):Promise.resolve([])
            ];
            wifiDevs.forEach(function(item){
                var n=item.net,ifname=n&&n.getIfname&&n.getIfname();
                tasks.push(detected.wireless&&n.isUp()&&!n.isDisabled()&&ifname?safe(getRealtime('interface',ifname),[]):Promise.resolve([]));
            });
            return Promise.all(tasks).then(function(v){
                if(!root.isConnected || self._novaPoll!==update)return;
                var info=v[0]||{},mem=info.memory||{},rootfs=info.root||{};
                var sample=getCpuSample(v[1]);
                if(sample&&prevSample&&sample.total>prevSample.total){
                    var busy=1-((sample.idle-prevSample.idle)/(sample.total-prevSample.total));
                    attrValue(root.querySelector('[data-nova=cpu]'),Math.round(Math.max(0,Math.min(1,busy))*100)+'%');
                }
                prevSample=sample||prevSample;
                self._novaCpuSample=prevSample;
                if(mem.total){
                    var used=number(mem.total)-number(mem.available!=null?mem.available:mem.free);
                    attrValue(root.querySelector('[data-nova=memory]'),'可用 '+(100-percent(used,mem.total))+'%');
                }
                if(rootfs.total)attrValue(root.querySelector('[data-nova=disk]'),'已用 '+percent(rootfs.used,rootfs.total)+'%');
                var chart=parseGraphRows(v[2]),lastDown=chart.down.length?chart.down[chart.down.length-1]:null;
                var lastUp=chart.up.length?chart.up[chart.up.length-1]:null;
                if(lastDown!=null){
                    attrValue(root.querySelector('[data-nova=rate-down]'),'↓ '+rate(lastDown));
                    attrValue(root.querySelector('[data-nova=traffic-up]'),'↑ '+rate(lastUp));
                    attrValue(root.querySelector('[data-nova=path-download]'),'↓ '+rate(lastDown));
                    attrValue(root.querySelector('[data-nova=path-flow]'),'↓ '+rate(lastDown));
                    var card=root.querySelector('[data-nova=rate-down]');
                    if(card&&card.nextSibling)card.nextSibling.textContent='↑ '+rate(lastUp)+' · '+wanDev;
                }
                if(conn && detected.interfaces)fillChart(v[2],root.querySelector('[data-nova=down-path]'),root.querySelector('[data-nova=up-path]'),
                    root.querySelector('[data-nova=traffic-down]'),root.querySelector('[data-nova=traffic-up]'),
                    root.querySelector('[data-nova=traffic-peak]'));
                wifiDevs.forEach(function(item,i){
                    var id=item.id;
                    var rows=parseGraphRows(v[3+i]);
                    var all=rows.down.concat(rows.up);
                    var p=Math.max(1024,Math.max.apply(Math,all.concat([0]))*1.2);
                    var pl=root.querySelector('[data-nova=wifi-'+id+']');
                    if(pl)pl.setAttribute('points',points(rows.down,p,360,65));
                    var last=rows.down.length ? rows.down[rows.down.length-1] : null;
                    attrValue(root.querySelector('[data-nova=wifi-rate-'+id+']'),last!=null?'↓ '+rate(last):!detected.wireless?'检测失败':item.net.isUp()?'等待采样':'接口未连接');
                });
            });
        }
        function update(){
            if(updating || !root.isConnected || self._novaPoll!==update)return Promise.resolve();
            updating=true;
            return refresh().then(function(unchanged){if(unchanged)return sampleRates();}).finally(function(){updating=false;});
        }
        if(this._novaPoll)poll.remove(this._novaPoll);
        this._novaSampleRates=sampleRates;
        this._novaPoll=update;
        poll.add(update,3);
        return root;
    },
    remove:function(){
        if(this._novaPoll)poll.remove(this._novaPoll);
        this._novaPoll=null;
        this._novaCpuSample=null;
        this._novaSampleRates=null;
    },
    handleSaveApply:null, handleSave:null,handleReset:null
});
