# Global page search

Nova's top-bar search opens individual LuCI pages rather than hiding sidebar
categories. The normal native menus remain available throughout a search.

- Search translated page names, original menu titles or route words, including
  deeper tab pages. Space-separated terms are matched together.
- Results include the page's menu breadcrumb and link directly through `L.url()`.
  No `/cgi-bin/luci` prefix or plugin inventory is hard-coded.
- Ctrl/Cmd+K focuses search. Up/Down select a result, Enter opens it, Esc closes
  search and returns to the shortcut's previous focus. Tab leaves normally.
- Chinese input-method confirmation does not navigate. Clearing the input,
  clicking elsewhere, leaving the page and Back/Forward restoration dismiss
  stale results without changing native page content.
- A search uses LuCI's cached, permission-filtered `ui.menu.load()` result and
  `ui.menu.getChildren()` traversal. It adds no polling, direct RPC, configuration
  access, history storage or telemetry. Menus remain the source of truth, so
  plugin visibility and LuCI ACLs still apply. Logout and category redirects
  are not page results.
- Results are limited to the first 50 matches with an explicit refinement hint.
  Loading, no-match and unavailable states are distinct. A failed search leaves
  the native menus usable. Reload the page to reload LuCI's own menu cache.

The implementation follows LuCI's menu APIs in
[`ui.js`](https://github.com/openwrt/luci/blob/openwrt-24.10/modules/luci-base/htdocs/luci-static/resources/ui.js)
and its navigation hierarchy in
[`menu-bootstrap.js`](https://github.com/openwrt/luci/blob/openwrt-24.10/themes/luci-theme-bootstrap/htdocs/luci-static/resources/menu-bootstrap.js).
The search does not modify these upstream modules or the menu tree itself.

## Checks

```sh
node --check luci-theme-nova/htdocs/luci-static/nova/nova-search.js
node --test tests/page-search.test.js tests/page-search-interaction.test.js
CHROME_BIN=google-chrome node --test tests/page-search-browser.test.js
```

Index tests cover permission-filtered trees, untranslated and translated titles,
multiple depths, route prefixes, aliases/cycles and ranking. Interaction tests
run the shipped script with DOM doubles, including late loading, dismissal,
keyboard input, focus restoration, failures and plain-text rendering.

The browser suite uses only localhost fixtures and real Chrome keyboard,
pointer and touch input at 320, 360, 640, 768, 901, 1024 and 1280 CSS pixels. It
covers direct navigation, Back, responsive bounds, result scrolling, IME,
empty/failed loading and native-menu preservation. It is not a router test.

For release integration, run these checks in source CI and against the actual
extracted IPK/APK assets. Include `nova-search.js` in syntax checks, both
non-browser test files in unit checks, and `page-search-browser.test.js` in the
serialized browser checks. Browser changes require a new `PKG_VERSION` cache
key under the repository's normal asset-version rule.
