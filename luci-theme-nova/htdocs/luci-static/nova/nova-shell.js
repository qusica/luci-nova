/* Nova shell: small progressive enhancements, no changes to LuCI menu data. */
(function() {
  'use strict';
  // Route-based icons remain correct when ACLs, translations or add-ons reorder menus.
  // Small project-authored SVG paths share a 24px grid and one stroke weight.
  var icons = {
    dashboard: ['M3 3h7v7H3zM14 3h7v11h-7zM3 14h7v7H3zM14 18h7v3h-7z'],
    status: ['M3 12h4l3-7 4 14 3-7h4'],
    system: ['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    network: ['M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4'],
    services: ['M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01M12 7.5h5M12 16.5h5'],
    vpn: ['M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6z', 'M9 12l2 2 4-4'],
    statistics: ['M4 3v18h17M8 16v-5M13 16V7M18 16v-8'],
    logout: ['M10 4H4v16h6M8 12h13M17 8l4 4-4 4'],
    folder: ['M3 6h7l2 3h9v11H3z']
  };
  function iconFor(item) {
    var links = item.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href || href.charAt(0) === '#') continue;
      var route;
      try { route = new URL(href, document.baseURI).pathname.match(/(?:^|\/)admin\/([^/]+)(?:\/|$)/); }
      catch (e) { continue; }
      if (!route) continue;
      var name = route[1] === 'nova' ? 'dashboard' : route[1];
      return Object.prototype.hasOwnProperty.call(icons, name) ? name : 'folder';
    }
    return 'folder';
  }
  function decorateLink(item) {
    var link = item.querySelector(':scope > a');
    if (!link) return;
    var name = iconFor(item);
    var previous = link.querySelector(':scope > .nova-menu-icon');
    if (previous && link.getAttribute('data-nova-icon') === name) return;
    if (previous) previous.remove();
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'nova-menu-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    icons[name].forEach(function(d) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    link.insertBefore(svg, link.firstChild);
    link.setAttribute('data-nova-icon', name);
  }
  function boot() {
    var refresh = document.getElementById('nova-refresh');
    var menu = document.getElementById('topmenu');
    if (refresh) refresh.addEventListener('click', function() { window.location.reload(); });
    var submenuId = 0;
    function toggleFor(target) {
      var link = target && target.closest && target.closest('a');
      if (!link || !menu || link.parentElement.parentElement !== menu) return null;
      var submenu = link.parentElement.querySelector(':scope > .dropdown-menu');
      return submenu && submenu.children.length ? link : null;
    }
    function setExpanded(link, expanded) {
      link.parentElement.classList.toggle('open', expanded);
      link.setAttribute('aria-expanded', String(expanded));
      var submenu = link.parentElement.querySelector(':scope > .dropdown-menu');
      submenu.style.marginLeft = '';
      // Mobile categories can sit near the right edge or wrap onto a new row.
      // Keep their popout inside the usable viewport, including its scrollbar.
      if (expanded && window.getComputedStyle(submenu).position === 'absolute') {
        var bounds = submenu.getBoundingClientRect();
        var shift = Math.max(8 - bounds.left, Math.min(0, document.documentElement.clientWidth - 8 - bounds.right));
        submenu.style.marginLeft = shift + 'px';
      }
    }
    function closeMenus() {
      if (!menu) return;
      menu.querySelectorAll(':scope > li > a').forEach(function(link) {
        if (toggleFor(link)) setExpanded(link, false);
      });
    }
    function update() {
      if (!menu) return;
      var items = menu.querySelectorAll(':scope > li');
      for (var i=0; i<items.length; i++) {
        decorateLink(items[i]);
        var link = toggleFor(items[i].querySelector(':scope > a'));
        if (link) {
          var submenu = items[i].querySelector(':scope > .dropdown-menu');
          if (!submenu.id) {
            var id;
            do { id = 'nova-submenu-' + (++submenuId); }
            while (document.getElementById(id));
            submenu.id = id;
          }
          link.setAttribute('role', 'button');
          link.setAttribute('aria-controls', submenu.id);
          setExpanded(link, items[i].style.display !== 'none' && items[i].classList.contains('open'));
        }
      }
    }
    if (menu) {
      // LuCI inserts these links asynchronously. Delegation also handles later updates.
      menu.addEventListener('click', function(e) {
        var link = toggleFor(e.target);
        if (!link) return; // Preserve real submenu and leaf-link navigation.
        e.preventDefault();
        setExpanded(link, !link.parentElement.classList.contains('open'));
      });
      menu.addEventListener('keydown', function(e) {
        var link = toggleFor(e.target);
        if (link && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
          e.preventDefault();
          if (!e.repeat) setExpanded(link, !link.parentElement.classList.contains('open'));
        } else if (link && e.key === 'ArrowDown') {
          e.preventDefault();
          setExpanded(link, true);
          var first = link.parentElement.querySelector('.dropdown-menu a[href]');
          if (first) first.focus();
        } else if (e.key === 'Escape') {
          var item = e.target.closest && e.target.closest('#topmenu > li');
          var owner = item && toggleFor(item.querySelector(':scope > a'));
          if (owner && item.classList.contains('open')) {
            e.preventDefault();
            setExpanded(owner, false);
            owner.focus();
          }
        }
      });
      menu.addEventListener('focusout', function(e) {
        if (!menu.contains(e.relatedTarget)) closeMenus();
      });
      document.addEventListener('click', function(e) {
        if (!menu.contains(e.target)) closeMenus();
      });
    }
    // Menu is inserted asynchronously by LuCI.
    if (menu && window.MutationObserver) {
      new MutationObserver(update).observe(menu, {childList:true,subtree:true});
    }
    window.addEventListener('resize', update);
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
