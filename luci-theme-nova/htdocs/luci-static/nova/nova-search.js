/* Nova page search: reuse LuCI's permission-filtered menu, never router settings. */
(function() {
  'use strict';

  function normalize(value) {
    var text = String(value || '').toLowerCase();
    return (text.normalize ? text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : text).trim();
  }

  function buildIndex(tree, menu, url, translate) {
    var pages = [], seen = Object.create(null);
    function visit(node, path, labels, originals, ancestors) {
      // Alias/rewrite nodes can share children, including a malformed cycle.
      if (!node || path.length > 16 || (node.children && ancestors.indexOf(node.children) >= 0)) return;
      var nextAncestors = node.children ? ancestors.concat([node.children]) : ancestors;
      menu.getChildren(node).forEach(function(child) {
        if (child.title == null || !String(child.title).trim()) return;
        var parts = path.concat(child.name);
        if (parts[0] !== 'admin' || parts[1] === 'logout') return;
        var title = String(translate(child.title) || child.title || child.name);
        var trail = labels.concat(title), originalTrail = originals.concat(child.title || child.name);
        var action = child.action && child.action.type;
        // Category redirects are not pages; actual pages with subtabs are useful too.
        if (parts.length > 1 && action && action !== 'firstchild') {
          var href = url.apply(null, parts);
          if (!seen[href]) {
            seen[href] = true;
            pages.push({ title: title, breadcrumb: trail.slice(1).join(' › '), href: href,
              titleKey: normalize(title), originalKey: normalize(child.title),
              searchKey: normalize(trail.join(' ') + ' ' + originalTrail.join(' ') + ' ' + parts.join('/')) });
          }
        }
        visit(child, parts, trail, originalTrail, nextAncestors);
      });
    }
    visit(tree, [], [], [], []);
    return pages;
  }

  function findPages(pages, query) {
    var q = normalize(query), words = q.split(/\s+/);
    if (!q) return [];
    return pages.filter(function(page) {
      return words.every(function(word) { return page.searchKey.indexOf(word) >= 0; });
    }).map(function(page, order) {
      var score = page.titleKey === q || page.originalKey === q ? 0 :
        page.titleKey.indexOf(q) === 0 || page.originalKey.indexOf(q) === 0 ? 1 :
        page.titleKey.indexOf(q) >= 0 || page.originalKey.indexOf(q) >= 0 ? 2 : 3;
      return { page: page, score: score, order: order };
    }).sort(function(a, b) { return a.score - b.score || a.order - b.order; })
      .map(function(result) { return result.page; });
  }

  // The shipped pure indexing functions are also exercised on packaged JS.
  if (typeof module === 'object' && module.exports) module.exports = { buildIndex: buildIndex, findPages: findPages };
  if (typeof document === 'undefined') return;

  function boot() {
    var input = document.getElementById('nova-search');
    var container = input && input.closest('.nova-page-search');
    if (!container || container.getAttribute('data-nova-search-ready')) return;
    container.setAttribute('data-nova-search-ready', 'true');
    var zh = /^zh\b/i.test(document.documentElement.lang || '');
    function text(en, cn) { return zh ? cn : en; }
    input.placeholder = text('Search pages…', '搜索页面…');
    input.setAttribute('aria-label', text('Search LuCI pages', '搜索 LuCI 页面'));
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'nova-search-results');
    input.setAttribute('aria-describedby', 'nova-search-hint');
    input.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');

    var panel = document.createElement('div');
    panel.className = 'nova-search-panel';
    panel.hidden = true;
    var hint = document.createElement('div');
    hint.id = 'nova-search-hint';
    hint.className = 'nova-search-hint';
    hint.textContent = text('↑ ↓ to choose · Enter to open · Esc to close', '↑ ↓ 选择 · Enter 打开 · Esc 关闭');
    var status = document.createElement('div');
    status.className = 'nova-search-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var list = document.createElement('div');
    list.id = 'nova-search-results';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', text('Pages', '页面'));
    panel.appendChild(hint);
    panel.appendChild(status);
    panel.appendChild(list);
    container.appendChild(panel);

    var pages = [], matches = [], active = -1, loading = false, ready = false, failed = false;
    var returnFocus = null;
    function position() {
      if (panel.hidden) return;
      var bounds = container.getBoundingClientRect();
      var width = Math.min(440, document.documentElement.clientWidth - 24);
      var left = Math.max(12, Math.min(bounds.left, document.documentElement.clientWidth - width - 12));
      panel.style.left = (left - bounds.left) + 'px';
      panel.style.right = 'auto';
      var viewport = window.visualViewport;
      var bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      panel.style.maxHeight = Math.max(0, Math.min(520, bottom - bounds.bottom - 20)) + 'px';
    }
    function close() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function select(index, scroll) {
      var options = list.children;
      active = index;
      for (var i = 0; i < options.length; i++) options[i].setAttribute('aria-selected', String(i === active));
      if (options[active]) {
        input.setAttribute('aria-activedescendant', options[active].id);
        if (scroll) options[active].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      if (panel.hidden) return;
      list.textContent = '';
      matches = ready ? findPages(pages, input.value) : [];
      var shown = matches.slice(0, 50);
      shown.forEach(function(page, i) {
        var link = document.createElement('a');
        link.id = 'nova-search-option-' + i;
        link.href = page.href;
        link.tabIndex = -1;
        link.setAttribute('role', 'option');
        var title = document.createElement('span');
        title.className = 'nova-search-title';
        title.textContent = page.title;
        var path = document.createElement('span');
        path.className = 'nova-search-path';
        path.textContent = page.breadcrumb;
        link.appendChild(title);
        link.appendChild(path);
        // Keep DOM focus in the combobox; clicking is still normal link navigation.
        link.addEventListener('mousedown', function(e) { e.preventDefault(); });
        link.addEventListener('mousemove', function() { select(i, false); });
        list.appendChild(link);
      });
      if (!ready) status.textContent = failed
        ? text('Page search is unavailable. Use the menu, or reload to retry.', '页面搜索暂不可用。请使用菜单，或刷新页面重试。')
        : text('Loading pages…', '正在加载页面…');
      else if (!input.value.trim()) status.textContent = text('Type a page name or path. Ctrl/Cmd + K opens search.', '输入页面名称或路径。Ctrl/Cmd + K 打开搜索。');
      else if (!matches.length) status.textContent = text('No matching pages. Try another name or path.', '没有匹配的页面，请换一个名称或路径。');
      else status.textContent = matches.length > shown.length
        ? text('Showing the first 50 matches. Refine your search.', '显示前 50 个结果，请缩小搜索范围。')
        : matches.length + text(' matching pages', ' 个匹配页面');
      list.hidden = !shown.length;
      select(shown.length ? 0 : -1, false);
      position();
    }
    function load() {
      if (loading || ready || !window.L || typeof window.L.require !== 'function') return;
      loading = true;
      failed = false;
      render();
      Promise.resolve().then(function() { return window.L.require('ui'); }).then(function(ui) {
        return ui.menu.load().then(function(tree) {
          pages = buildIndex(tree, ui.menu, function() { return window.L.url.apply(window.L, arguments); },
            typeof window._ === 'function' ? window._ : function(value) { return value; });
          ready = true;
        });
      }).catch(function() { failed = true; }).then(function() {
        loading = false;
        render();
      });
    }
    function open() {
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      load();
      render();
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('click', open);
    input.addEventListener('keydown', function(e) {
      // IME confirmation must never trigger navigation.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (panel.hidden) {
          open();
          if (list.children.length) select(e.key === 'ArrowDown' ? 0 : list.children.length - 1, true);
        } else if (list.children.length) select((active + (e.key === 'ArrowDown' ? 1 : -1) + list.children.length) % list.children.length, true);
      } else if (e.key === 'Enter' && !panel.hidden) {
        e.preventDefault();
        if (!e.repeat && list.children[active]) list.children[active].click();
      } else if (e.key === 'Escape' && !panel.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
        returnFocus = null;
      } else if (e.key === 'Tab') close();
    });
    container.addEventListener('focusout', function(e) {
      if (!container.contains(e.relatedTarget)) { close(); returnFocus = null; }
    });
    document.addEventListener('click', function(e) { if (!container.contains(e.target)) close(); });
    document.addEventListener('keydown', function(e) {
      if (!e.isComposing && !e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // Do not steal focus from LuCI's modal workflow.
        if (document.body.classList.contains('modal-overlay-active')) return;
        e.preventDefault();
        if (document.activeElement !== input) returnFocus = document.activeElement;
        input.focus();
        input.select();
        open();
      }
    });
    // LuCI can become available after this shell script. No independent polling/RPC.
    document.addEventListener('luci-loaded', load);
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', function() { close(); returnFocus = null; });
    window.addEventListener('resize', position);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', position);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
