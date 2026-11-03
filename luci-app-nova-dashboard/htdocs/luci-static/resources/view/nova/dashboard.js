'use strict';
'require view';
'require rpc';

var callBoard = rpc.declare({ object: 'system', method: 'board' });
var callInfo = rpc.declare({ object: 'system', method: 'info' });
var callInterfaces = rpc.declare({ object: 'network.interface', method: 'dump' });

function formatUptime(secs) {
    var d = Math.floor((secs || 0) / 86400);
    var h = Math.floor(((secs || 0) % 86400) / 3600);
    var m = Math.floor(((secs || 0) % 3600) / 60);
    return (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
}
function formatMemory(bytes) {
    return Math.round((bytes || 0) / 1048576) + ' MiB';
}
function metric(title, value, detail) {
    return E('div', { 'class': 'nova-card' }, [
        E('span', { 'class': 'nova-label' }, [ E('span', {'class':'nova-ok'}, '●'), title ]),
        E('strong', {}, value),
        E('div', { 'class': 'nova-sub' }, detail)
    ]);
}
function node(name, detail, primary) {
    return E('div', { 'class': primary ? 'nova-node primary' : 'nova-node' }, [
        E('div', { 'class': 'nova-name' }, name),
        E('div', { 'class': 'nova-detail' }, detail)
    ]);
}
function connector() { return E('span', { 'class': 'nova-connector', 'aria-hidden': 'true' }); }
return view.extend({
    load: function() {
        return Promise.all([
            callBoard().catch(function() { return {}; }),
            callInfo().catch(function() { return {}; }),
            callInterfaces().catch(function() { return {}; })
        ]);
    },
    render: function(data) {
        var board = data[0] || {};
        var info = data[1] || {};
        var net = data[2] || {};
        var mem = info.memory || {};
        var entries = net.interface || [];
        var wan = entries.find(function(i) { return i.interface === 'wan' || i.interface === 'wan6'; });
        var lan = entries.find(function(i) { return i.interface === 'lan'; });
        var wanAddress = wan && wan['ipv4-address'] && wan['ipv4-address'][0] ? wan['ipv4-address'][0].address : 'No IPv4 address';
        var routerName = board.hostname || 'OpenWrt';
        var style = E('link', { rel: 'stylesheet', href: L.resource('nova/dashboard.css') });
        document.head.appendChild(style);
        return E('div', { 'class': 'nova-dashboard' }, [
            E('div', { 'class':'nova-heading' }, [
                E('span', {'class':'nova-pulse', 'aria-hidden':'true'}),
                E('div', {}, [E('h2', {}, _('All systems normal')), E('div', {'class':'nova-muted'}, [routerName + ' · ' + (board.model || 'Router')])])
            ]),
            E('div', { 'class':'nova-grid' }, [
                metric(_('Uptime'), formatUptime(info.uptime), _('Since last boot')),
                metric(_('Load (1 min)'), (info.load && info.load.length ? (info.load[0] / 65536).toFixed(2) : '—'), _('System load average')),
                metric(_('Memory used'), formatMemory((mem.total || 0) - (mem.available || mem.free || 0)), formatMemory(mem.total) + ' total'),
                metric(_('WAN status'), wan ? (wan.up ? _('Connected') : _('Disconnected')) : _('Unknown'), wan ? wanAddress : _('No WAN interface discovered'))
            ]),
            E('div', { 'class':'nova-panel' }, [
                E('h3', {}, _('Network overview')),
                E('div', { 'class':'nova-path' }, [
                    node(_('Internet'), wan ? (wan.up ? _('WAN connected') : _('WAN disconnected')) : _('WAN not detected')),
                    connector(),
                    node(routerName, board.model || _('Local router'), true),
                    connector(),
                    node(_('Local network'), lan ? (lan.device || lan.l3_device || 'LAN') + ' · ' + (lan.up ? _('Online') : _('Offline')) : _('No LAN interface discovered'))
                ]),
                E('div', { 'class':'nova-links' }, [
                    E('a', { href:L.url('admin/status/overview') }, _('System overview')),
                    E('a', { href:L.url('admin/network/network') }, _('Network interfaces')),
                    E('a', { href:L.url('admin/network/wireless') }, _('Wireless settings'))
                ])
            ])
        ]);
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
