/* Nova shell: small progressive enhancements, no changes to LuCI menu data. */
(function() {
  'use strict';
  function boot() {
    var search = document.getElementById('nova-search');
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
    }
    function closeMenus() {
      if (!menu) return;
      menu.querySelectorAll(':scope > li > a').forEach(function(link) {
        if (toggleFor(link)) setExpanded(link, false);
      });
    }
    function update() {
      if (!menu) return;
      var q = search ? search.value.trim().toLowerCase() : '';
      var items = menu.querySelectorAll(':scope > li');
      for (var i=0; i<items.length; i++) {
        var text = (items[i].textContent || '').toLowerCase();
        items[i].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
        if (q && text.indexOf(q) >= 0) items[i].classList.add('nova-search-result');
        else items[i].classList.remove('nova-search-result');
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
    if (search) {
      search.addEventListener('input', update);
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          search.focus();
          search.select();
        }
        if (e.key === 'Escape' && document.activeElement === search) {
          search.value = ''; update(); search.blur();
        }
      });
    }
    // Menu is inserted asynchronously by LuCI.
    if (menu && window.MutationObserver) {
      new MutationObserver(update).observe(menu, {childList:true,subtree:true});
    }
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
