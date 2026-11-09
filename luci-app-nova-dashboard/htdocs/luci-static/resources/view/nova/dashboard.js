'use strict';
'require view';
'require rpc';
'require poll';
'require network';
'require fs';

// Keep in sync with PKG_VERSION; tests enforce this cache key on every release.
var dashboardAssetVersion = '0.2.2';

var getBoard = rpc.declare({ object: 'system', method: 'board' });
var getInfo = rpc.declare({ object: 'system', method: 'info' });
var getInterfaces = rpc.declare({ object: 'network.interface', method: 'dump' });
var getRealtime = rpc.declare({
    object: 'luci', method: 'getRealtimeStats',
    params: [ 'mode', 'device' ], expect: { result: [] }
});
var getNetworkDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });

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
function el(kind, klass, contents){return E(kind, {'class':klass}, contents);}
function metric(name,value,detail,key){
    return el('div','nv-metric',[
        el('span','nv-metric-icon', '✓'),
        el('div','nv-metric-main',[
            el('div','nv-metric-label',name),
            E('strong',key ? {'data-nova':key} : {},value),
            el('small','nv-metric-sub',detail)
        ])
    ]);
}
function detailLine(a,b){return el('span','nv-detail-line',[label(a),el('strong','',b)]);}
function node(klass,icon,name,sub,details,target) {
    return E('button',{
        'class':'nv-node '+klass,'type':'button',
        'title':details,
        'click':function(){
            var field=document.getElementById('nv-selected');
            if(field) {
                field.hidden=false;
                field.replaceChildren(
                    el('strong','',name+' · '),
                    document.createTextNode(details),
                    target ? E('a',{'href':target},'查看设置 →') : document.createTextNode('')
                );
            }
        }
    },[
        el('span','nv-node-icon',icon),
        el('span','nv-node-text',[el('strong','nv-truncate',name),el('small','nv-truncate',sub)])
    ]);
}
function assocCount(list) { return Array.isArray(list) ? list.length : 0; }
function bucket(net){
    var f=Number(net.getFrequency ? net.getFrequency() : 0);
    var ch=Number(net.getChannel ? net.getChannel() : 0);
    if(f>=5.9) return '6';
    if(f>=4.8) return '5';
    if(f>2 && f<3) return '2.4';
    if(ch>=1 && ch<=14) return '2.4';
    if(ch>=30 && ch<=196) return '5';
    return 'other';
}
function bands(networks,assocLists){
    var map={'2.4':[], '5':[], '6':[], 'other':[]};
    (networks||[]).forEach(function(n,i){
        var info={net:n,assocs:assocLists[i]||[], band:bucket(n)};
        map[info.band].push(info);
    });
    return map;
}
function groupCount(g){return (g||[]).reduce(function(v,n){return v+n.assocs.length;},0);}
function firstNet(g){
    return (g||[]).find(function(a){return a.net.getIfname && a.net.getIfname() && (!a.net.isDisabled || !a.net.isDisabled());}) || (g||[])[0];
}
function wifiSummary(g){
    if(!g || !g.length) return '未检测到无线接口';
    var n=firstNet(g);
    return (n.net.getActiveSSID && n.net.getActiveSSID() || n.net.getIfname() || 'Wi-Fi')+' · '+groupCount(g)+' 客户端';
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
            el('div','nv-panel-title',[tag(band+' GHz',colour),el('strong','', 'Wi-Fi')]),
            el('div','nv-online', [dot(),g&&g.length ? '已检测' : '未检测'])
        ]),
        el('div','nv-wifi-main',[el('strong','', ch ? '信道 '+ch : '—'), E('span',{},f?f+' GHz':'无线信息不可用')]),
        el('div','nv-band-meter',[E('span',{'style':'width:'+Math.max(0,Math.min(100,number(ch)*1.25))+'%'})]),
        el('div','nv-band-caption',[el('span','',wifiSummary(g))]),
        el('div','nv-wifi-stats',[
            detailLine('客户端',String(count)),
            detailLine('发射功率', tx != null ? tx+' dBm' : '—'),
            detailLine('噪声', noise != null ? noise+' dBm' : '—'),
            detailLine('接口', net&&net.getIfname&&net.getIfname() || '—')
        ]),
        el('div','nv-mini-chart',[
            E('svg',{'viewBox':'0 0 360 76','preserveAspectRatio':'none','aria-label':band+' GHz 实时吞吐量'},[
                E('line',{'x1':'0','y1':'65','x2':'360','y2':'65','class':'nv-axis'}),
                E('polyline',{'data-nova':'wifi-'+id,'class':'nv-spark','points':'0,65 360,65'})
            ]),
            E('span',{'data-nova':'wifi-rate-'+id,'class':'nv-mini-rate'},'等待采样')
        ])
    ]);
}
function getWan(interfaces){
    return interfaces.find(function(n){return n.interface==='wan'&&n.up;}) ||
           interfaces.find(function(n){return n.interface==='wan6'&&n.up;}) ||
           interfaces.find(function(n){return n.up && n.route && n.route.some(function(r){return r.target==='0.0.0.0' && r.mask===0;});}) ||
           interfaces.find(function(n){return n.interface==='wan' || n.interface==='wan6';}) || null;
}
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
            safe(getBoard(),{}),
            safe(getInfo(),{}),
            safe(getInterfaces(),{interface:[]}),
            safe(network.getWifiNetworks(),[]),
            safe(getNetworkDevices(),{}),
            safe(fs.read('/proc/stat'),null),
            safe(fs.read('/sys/class/thermal/thermal_zone0/temp'),null)
        ]).then(function(d){
            var nets=d[3]||[];
            return Promise.all(nets.map(function(n){
                return safe(n.getAssocList?n.getAssocList():[],[]);
            })).then(function(stations){d.push(stations);return d;});
        });
    },
    render:function(data){
        var board=data[0]||{}, sys=data[1]||{}, entries=(data[2]||{}).interface||[];
        var nets=data[3]||[], devices=data[4]||{}, cpuRaw=data[5],tempRaw=data[6],assocs=data[7]||[];
        var groups=bands(nets,assocs), wifiAll=groups['2.4'].concat(groups['5'],groups['6'],groups.other);
        var totalClients=wifiAll.reduce(function(v,n){return v+n.assocs.length;},0);
        var clientSignals=wifiAll.reduce(function(v,n){
            return v.concat(n.assocs.filter(function(a){return typeof a.signal==='number' && a.signal < 0;}).map(function(a){return a.signal;}));
        },[]);
        var worst=clientSignals.length?Math.min.apply(Math,clientSignals):null;
        var wan=getWan(entries);
        var wanDev=wan&&(wan.l3_device || wan.device);
        var lan=entries.find(function(n){return n.interface==='lan';}) || {};
        var lanDev=lan.l3_device || lan.device;
        var lanSummary=lanDev ? 'LAN '+lanDev : '未检测到 LAN 接口';
        var mem=sys.memory||{},root=sys.root||{};
        var memUsed=number(mem.total)-number(mem.available!=null?mem.available:mem.free);
        var memPct=percent(memUsed,mem.total);
        var diskPct=percent(root.used,root.total);
        var cpuTemp=Number(String(tempRaw||'').trim())/1000;
        var tempText=isFinite(cpuTemp)&&cpuTemp>0&&cpuTemp<130 ? cpuTemp.toFixed(0)+'°C' : '';
        var conn=!!(wan&&wan.up), model=board.model||board.system||'OpenWrt Router';
        var firmware=board.release&&board.release.description||'OpenWrt';
        var ip=getAddress(wan,false);
        var visibleBands=groups['2.4'].length + groups['5'].length + groups['6'].length;
        var mainCard=el('section','nv-panel nv-topology',[
            el('div','nv-panel-head',[
                el('div','nv-panel-title',[el('span','nv-head-icon','⌁'),el('strong','', '网络路径')]),
                el('span','nv-muted','点击节点查看详情')
            ]),
            el('div','nv-path-scroll',[
                el('div','nv-path',[
                    node('nv-internet','◎','互联网',conn?ip:'WAN 未连接',
                        'WAN '+(wanDev||'未检测')+' · IPv4 '+ip+' · DNS '+((wan&&wan['dns-server']||[]).join(', ')||'—'),L.url('admin/network/network')),
                    el('div','nv-wireline',[
                        E('strong',{'data-nova':'path-download'}, '↓ —'),
                        E('small',{},wanDev||'WAN')
                    ]),
                    node('nv-router','▣',board.hostname||'本地主路由',model,
                        firmware+' · '+lanSummary,L.url('admin/status/overview')),
                    el('div','nv-fork', [el('span','', '')]),
                    el('div','nv-path-channels',[
                        node('nv-radio','◈','2.4 GHz',groups['2.4'].length?wifiSummary(groups['2.4']):'未检测到', 'Wi-Fi 2.4 GHz · '+wifiSummary(groups['2.4']),L.url('admin/network/wireless')),
                        node('nv-radio nv-five','◈','5 GHz',groups['5'].length?wifiSummary(groups['5']):'未检测到','Wi-Fi 5 GHz · '+wifiSummary(groups['5']),L.url('admin/network/wireless')),
                        node('nv-radio','▤','有线 LAN',lanDev||'未检测到 LAN 接口','有线设备数暂不可判定 · '+lanSummary,L.url('admin/network/network'))
                    ]),
                    el('div','nv-branch-lines',[el('span','', ''),el('span','', ''),el('span','', '')]),
                    el('div','nv-path-clients',[
                        node('nv-client','♧',groups['2.4'].length?groups['2.4'][0].net.getActiveSSID()||'2.4 GHz SSID':'2.4 GHz 无线',groupCount(groups['2.4'])+' 客户端','该频段关联客户端：'+groupCount(groups['2.4']),L.url('admin/status/overview')),
                        node('nv-client','♧',groups['5'].length?groups['5'][0].net.getActiveSSID()||'5 GHz SSID':'5 GHz 无线',groupCount(groups['5'])+' 客户端','该频段关联客户端：'+groupCount(groups['5']),L.url('admin/status/overview')),
                        node('nv-client','▤','LAN',lan.device||lanDev||'未检测到 LAN 接口','有线端口和设备详情请查看接口设置',L.url('admin/network/network'))
                    ])
                ])
            ]),
            E('div',{'id':'nv-selected','class':'nv-node-detail','hidden':true}),
            el('div','nv-path-stats',[
                el('div','',[label('客户端'),el('strong','',String(totalClients)),el('small','',totalClients+' 个 Wi-Fi 已关联')]),
                el('div','',[label('当前流量'),E('strong',{'data-nova':'path-flow'},'等待采样'),el('small','',wanDev ? '经 '+wanDev:'WAN 未检测')]),
                el('div','',[label('无线频段'),el('strong','',visibleBands ? visibleBands+' 个已启用':'—'),el('small','',nets.length+' 个无线接口')]),
                el('div','',[label('最弱信号'),el('strong','',worst!=null?worst+' dBm':'—'),el('small','',worst!=null?'来自已关联 Wi-Fi 客户端':'暂无客户端信号数据')])
            ])
        ]);
        var header=el('div','nv-overview-head',[
            el('span','nv-pulse',''),
            el('div','nv-title-group',[
                E('h2',{}, conn?'一切正常':'连接状态待检查'),
                el('p','',model+' · '+firmware+' · '+totalClients+' 个无线客户端')
            ]),
            E('span',{'class':'nv-updated'},[dot(),'实时 · 每 3 秒更新'])
        ]);
        var cards=el('div','nv-metric-grid',[
            metric('上行链路',wanDev?'↓ 等待采样':'—',wanDev?'↑ 等待采样 · '+wanDev:'尚未发现活动 WAN','rate-down'),
            metric('CPU', '等待采样', '负载 '+(sys.load&&sys.load.length?(number(sys.load[0])/65535).toFixed(2):'—')+(tempText?' · '+tempText:''),'cpu'),
            metric('内存',memPct!=null?'可用 '+(100-memPct)+'%':'—',mib(memUsed)+' / '+mib(mem.total),'memory'),
            metric('Wi-Fi',visibleBands+' 个已启用',nets.length+' 个接口 · '+totalClients+' 个客户端','wifi'),
            metric('信号强度',worst!=null?worst+' dBm':'暂无数据',worst!=null?(worst>=-75?'信号正常':'存在弱信号客户端'):'没有可用的客户端信号','signal'),
            metric('存储',diskPct!=null?'已用 '+diskPct+'%':'—',root.total?('剩余 '+Math.max(0,Math.round((root.total-root.used)/1024))+' MiB'):'无法获取根分区使用率','disk')
        ]);
        var trend=el('section','nv-panel nv-traffic',[
            el('div','nv-panel-head',[
                el('div','nv-panel-title',[el('span','nv-head-icon','⌁'),el('strong','', '吞吐量'),el('span','nv-muted','实时采集 · WAN 接口')]),
                el('div','nv-legend',[el('span','nv-legend-down','下载'),el('span','nv-legend-up','上传')])
            ]),
            el('div','nv-traffic-content',[
                el('div','nv-traffic-numbers',[
                    label('上行链路 '+(wanDev||'')),
                    E('strong',{'data-nova':'traffic-down'},'等待采样'),
                    E('span',{'data-nova':'traffic-up','class':'nv-upload-label'},'↑ 等待采样'),
                    E('small',{},['峰值 ',E('span',{'data-nova':'traffic-peak'},'—')])
                ]),
                E('svg',{'class':'nv-traffic-chart','viewBox':'0 0 600 150','preserveAspectRatio':'none','role':'img','aria-label':'WAN 实时上下行速率'},[
                    E('line',{'class':'nv-gridline','x1':'0','y1':'37','x2':'600','y2':'37'}),
                    E('line',{'class':'nv-gridline','x1':'0','y1':'76','x2':'600','y2':'76'}),
                    E('line',{'class':'nv-gridline','x1':'0','y1':'115','x2':'600','y2':'115'}),
                    E('polyline',{'class':'nv-line-down','data-nova':'down-path','points':'0,145 600,145'}),
                    E('polyline',{'class':'nv-line-up','data-nova':'up-path','points':'0,145 600,145'})
                ])
            ]),
            el('div','nv-chart-note','显示实际采样数据；尚未采样时不生成模拟曲线。')
        ]);
        var bottom=el('div','nv-bottom-grid',[trend,wifiCard('2.4',groups['2.4']),wifiCard('5',groups['5'])]);
        var root=E('div',{'class':'nova-dashboard'},[header,cards,mainCard,bottom]);
        var styleHref=L.resource('nova/dashboard.css')+'?v='+dashboardAssetVersion;
        var style=document.getElementById('nova-dashboard-style');
        if(!style){
            document.head.appendChild(E('link',{'id':'nova-dashboard-style','rel':'stylesheet','href':styleHref}));
        }else if(style.getAttribute('href')!==styleHref){
            style.setAttribute('href',styleHref);
        }
        var self=this, prevSample=getCpuSample(cpuRaw), currentDown=null;
        var wifiDevs={
            '24':(firstNet(groups['2.4'])||{}).net,
            '5':(firstNet(groups['5'])||{}).net
        };
        function update(){
            var tasks=[
                safe(getInfo(),{}),
                safe(fs.read('/proc/stat'),null),
                wanDev?safe(getRealtime('interface',wanDev),[]):Promise.resolve([])
            ];
            ['24','5'].forEach(function(id){
                var n=wifiDevs[id],ifname=n&&n.getIfname&&n.getIfname();
                tasks.push(ifname?safe(getRealtime('interface',ifname),[]):Promise.resolve([]));
            });
            return Promise.all(tasks).then(function(v){
                if(!root.isConnected)return;
                var info=v[0]||{},mem=info.memory||{},rootfs=info.root||{};
                var sample=getCpuSample(v[1]);
                if(sample&&prevSample&&sample.total>prevSample.total){
                    var busy=1-((sample.idle-prevSample.idle)/(sample.total-prevSample.total));
                    attrValue(root.querySelector('[data-nova=cpu]'),Math.round(Math.max(0,Math.min(1,busy))*100)+'%');
                }
                prevSample=sample||prevSample;
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
                fillChart(v[2],root.querySelector('[data-nova=down-path]'),root.querySelector('[data-nova=up-path]'),
                    root.querySelector('[data-nova=traffic-down]'),root.querySelector('[data-nova=traffic-up]'),
                    root.querySelector('[data-nova=traffic-peak]'));
                ['24','5'].forEach(function(id,i){
                    var rows=parseGraphRows(v[3+i]);
                    var all=rows.down.concat(rows.up);
                    var p=Math.max(1024,Math.max.apply(Math,all.concat([0]))*1.2);
                    var pl=root.querySelector('[data-nova=wifi-'+id+']');
                    if(pl)pl.setAttribute('points',points(rows.down,p,360,65));
                    var last=rows.down.length ? rows.down[rows.down.length-1] : null;
                    attrValue(root.querySelector('[data-nova=wifi-rate-'+id+']'),last!=null?'↓ '+rate(last):'等待采样');
                });
            });
        }
        this._novaPoll=update;
        poll.add(update,3);
        return root;
    },
    remove:function(){
        if(this._novaPoll)poll.remove(this._novaPoll);
    },
    handleSaveApply:null, handleSave:null,handleReset:null
});
