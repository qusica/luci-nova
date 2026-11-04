/* Nova shell: small progressive enhancements, no changes to LuCI menu data. */
(function() {
  'use strict';
  function boot() {
    var search = document.getElementById('nova-search');
    var refresh = document.getElementById('nova-refresh');
    var menu = document.getElementById('topmenu');
    if (refresh) refresh.addEventListener('click', function() { window.location.reload(); });
    function update() {
      if (!menu || !search) return;
      var q = search.value.trim().toLowerCase();
      var items = menu.querySelectorAll(':scope > li');
      for (var i=0; i<items.length; i++) {
        var text = (items[i].textContent || '').toLowerCase();
        items[i].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
        if (q && text.indexOf(q) >= 0) items[i].classList.add('nova-search-result');
        else items[i].classList.remove('nova-search-result');
      }
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
