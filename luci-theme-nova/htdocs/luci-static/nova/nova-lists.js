/* Enhance native LuCI lists in place. No RPCs, storage, cloned rows or data uploads. */
(function() {
  'use strict';
  function boot() {
    var page = document.body.getAttribute('data-page') || '';
    var overview = /^(admin-status|admin-status-overview)$/.test(page);
    var connections = /^(admin-status-realtime-connections|admin-status-connections)$/.test(page);
    var root = document.getElementById('view') || document.getElementById('maincontent');
    if ((!overview && !connections) || !root || !window.MutationObserver || root.hasAttribute('data-nova-lists-active')) return;
    root.setAttribute('data-nova-lists-active', 'true');
    var zh = /^zh/i.test(document.documentElement.lang || '');
    function t(en, cn) { return zh ? cn : en; }
    function element(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }
    function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
    var definitions = overview ? [
      { id: 'status_leases', family: 'IPv4', owner: 'leases', name: t('DHCP leases', 'DHCP 租约') },
      { id: 'status_leases6', family: 'IPv6', owner: 'leases', name: t('DHCP leases', 'DHCP 租约') },
      { id: 'wifi_assoclist_table', family: '', owner: 'stations', name: t('Associated stations', '无线已关联站点') }
    ] : [{ id: 'connections', family: '', owner: 'connections', name: t('Connections', '连接'), group: true }];
    var states = {}, owners = {}, focused = null, timer = null;
    var pageSize = 25;

    function observe() { observer.observe(root, { childList: true, subtree: true, characterData: true }); }
    function focusKey(node, key) {
      node.setAttribute('data-nova-list-focus', key);
      node.addEventListener('focus', function() { focused = { node: node, key: key }; });
    }
    function makeButton(text, action) {
      var button = element('button', 'cbi-button', text);
      button.type = 'button';
      button.addEventListener('click', action);
      return button;
    }
    function toolbar(def, table) {
      var owner = owners[def.owner];
      if (!owner) owner = owners[def.owner] = { query: '', family: 'all' };
      if (owner.tools && owner.tools.isConnected) return owner;
      var section = table.closest('.cbi-section');
      var title = section && section.querySelector(':scope > .cbi-title');
      // In overview the title is not replaced by LuCI's polling cycle.
      var host = title || table.parentElement;
      var tools = element('div', 'nova-list-tools');
      var label = element('label', 'nova-list-search');
      var labelText = element('span', '', t('Search ', '搜索') + def.name);
      var input = element('input', 'cbi-input-text');
      input.type = 'search';
      input.id = 'nova-search-' + def.owner;
      input.placeholder = def.group ? t('IP, protocol, port…', 'IP、协议、端口…') : t('Hostname, IP, MAC, DUID…', '主机名、IP、MAC、DUID…');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = owner.query;
      label.append(labelText, input);
      tools.appendChild(label);
      var clear = makeButton(t('Clear', '清除'), function() {
        input.value = ''; owner.query = ''; resetPages(def.owner); refresh(); input.focus();
      });
      tools.appendChild(clear);
      input.addEventListener('input', function() {
        owner.query = input.value;
        resetPages(def.owner);
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 120);
      });
      focusKey(input, def.owner + '-search');
      focusKey(clear, def.owner + '-clear');
      tools.appendChild(element('span', 'nova-list-note', t('Details are collapsed. Search filters all rows; expand a group to view matches.', '详细列表默认收起。搜索全部记录，展开分组查看结果。')));
      if (def.group) {
        var familyLabel = element('label', 'nova-list-family', t('Network ', '网络分组 '));
        var select = element('select', 'cbi-input-select');
        ['all', 'ipv4', 'ipv6', 'other'].forEach(function(value) {
          var option = element('option', '', value === 'all' ? t('All', '全部') : value === 'other' ? t('Other', '其它') : value.toUpperCase().replace('IPV', 'IPv'));
          option.value = value;
          select.appendChild(option);
        });
        select.value = owner.family;
        select.addEventListener('change', function() { owner.family = select.value; resetPages(def.owner); refresh(); });
        focusKey(select, def.owner + '-family');
        familyLabel.appendChild(select); tools.appendChild(familyLabel);
        owner.select = select;
      }
      if (title) title.appendChild(tools);
      else host.insertBefore(tools, table);
      owner.tools = tools;
      return owner;
    }
    function resetPages(owner) {
      definitions.forEach(function(def) { if (def.owner === owner && states[def.id]) states[def.id].page = 0; });
    }
    function enhance(def, table) {
      var state = states[def.id];
      if (!state) state = states[def.id] = { open: false, page: 0, rows: [] };
      state.owner = toolbar(def, table);
      if (state.table === table && state.details.isConnected) return state;
      // The native poll can replace content before a queued disclosure toggle event.
      if (state.details) state.open = state.details.open;
      var heading = table.previousElementSibling;
      var hasHeading = heading && /^H[2-6]$/.test(heading.tagName);
      var details = element('details', 'nova-list-group');
      var summary = element('summary', 'nova-list-summary');
      if (def.family) summary.appendChild(element('span', 'nova-list-badge', def.family));
      summary.appendChild(element('span', 'nova-list-title', hasHeading ? heading.textContent : def.name));
      var count = element('span', 'nova-list-count');
      summary.appendChild(count);
      var body = element('div', 'nova-list-body');
      body.id = 'nova-list-body-' + def.id;
      var scroller = element('div', 'nova-list-scroll');
      scroller.tabIndex = 0;
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', (def.family ? def.family + ' ' : '') + def.name);
      var footer = element('div', 'nova-list-pager');
      var previous = makeButton(t('Previous', '上一页'), function() { state.page--; refresh(); });
      var next = makeButton(t('Next', '下一页'), function() { state.page++; refresh(); });
      var range = element('span', 'nova-list-range');
      range.setAttribute('role', 'status');
      range.setAttribute('aria-live', 'polite');
      footer.append(previous, range, next);
      var empty = element('p', 'nova-list-empty', t('No matching records.', '没有匹配的记录。'));
      body.append(scroller, empty, footer);
      details.append(summary, body);
      table.parentNode.insertBefore(details, table);
      scroller.appendChild(table); // Keep native table IDs, event handlers, buttons and permissions.
      if (hasHeading) {
        // Preserve the native heading itself (and its semantics) inside the disclosure.
        summary.replaceChild(heading, summary.querySelector('.nova-list-title'));
        heading.classList.add('nova-list-title');
      }
      details.open = state.open;
      summary.setAttribute('aria-controls', body.id);
      summary.setAttribute('aria-expanded', String(state.open));
      details.addEventListener('toggle', function() {
        if (state.details !== details) return;
        state.open = details.open;
        summary.setAttribute('aria-expanded', String(state.open));
      });
      focusKey(summary, def.id + '-summary');
      focusKey(previous, def.id + '-previous');
      focusKey(next, def.id + '-next');
      focusKey(scroller, def.id + '-scroll');
      Object.assign(state, { table: table, details: details, count: count, previous: previous, next: next, range: range, empty: empty, footer: footer });
      return state;
    }
    function update(def, state) {
      var query = state.owner.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      var rows = Array.prototype.filter.call(state.table.querySelectorAll('tr, .tr'), function(row) {
        return !row.classList.contains('table-titles') && !row.classList.contains('placeholder') && !row.querySelector('th, .th');
      });
      var totals = { ipv4: 0, ipv6: 0, other: 0 };
      var matches = [];
      rows.forEach(function(row) {
        // Read each row once per refresh. Never interpret client-provided text as HTML.
        var text = row.textContent.toLocaleLowerCase();
        var first = row.querySelector('td, .td');
        var family = first ? first.textContent.trim().toLowerCase() : '';
        family = family === 'ipv4' || family === 'ipv6' ? family : 'other';
        totals[family]++;
        if ((!def.group || state.owner.family === 'all' || state.owner.family === family) && query.every(function(token) { return text.indexOf(token) !== -1; })) matches.push(row);
      });
      state.page = Math.max(0, Math.min(state.page, Math.ceil(matches.length / pageSize) - 1));
      var start = state.page * pageSize;
      var shown = new Set(matches.slice(start, start + pageSize));
      rows.forEach(function(row) { row.classList.toggle('nova-list-hidden', !shown.has(row)); });
      state.table.querySelectorAll('.placeholder').forEach(function(row) { row.classList.toggle('nova-list-hidden', rows.length > 0); });
      setText(state.count, matches.length === rows.length ? String(rows.length) : matches.length + ' / ' + rows.length);
      setText(state.range, matches.length ? (start + 1) + '–' + Math.min(start + pageSize, matches.length) + ' / ' + matches.length : '0 / 0');
      state.previous.disabled = state.page === 0;
      state.next.disabled = start + pageSize >= matches.length;
      state.footer.hidden = matches.length <= pageSize;
      state.empty.hidden = matches.length !== 0 || rows.length === 0;
      if (def.group) Array.prototype.forEach.call(state.owner.select.options, function(option) {
        var names = { all: t('All', '全部'), ipv4: 'IPv4', ipv6: 'IPv6', other: t('Other', '其它') };
        setText(option, names[option.value] + ' (' + (option.value === 'all' ? rows.length : totals[option.value]) + ')');
      });
      state.rows = rows;
    }
    function refresh() {
      timer = null;
      observer.disconnect(); // Our own controls/text must not create an observer loop.
      try {
        definitions.forEach(function(def) {
          var table = root.querySelector('#' + def.id);
          if (table) update(def, enhance(def, table));
        });
        if (focused && !focused.node.isConnected && document.activeElement === document.body) {
          var replacement = root.querySelector('[data-nova-list-focus="' + focused.key + '"]');
          if (replacement) replacement.focus({ preventScroll: true });
        }
      } finally { observe(); }
    }
    var observer = new MutationObserver(function() {
      // Native updates arrive in one mutation batch. Reapply before the browser can
      // paint thousands of unfiltered rows, even when a search debounce is pending.
      if (timer) clearTimeout(timer);
      refresh();
    });
    document.addEventListener('focusin', function(event) {
      if (!event.target.hasAttribute('data-nova-list-focus')) focused = null;
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
