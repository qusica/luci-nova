# LuCI Nova

Nova is a dark LuCI theme and a companion status dashboard for OpenWrt and ImmortalWrt.

> Preview 0.2.12: detected interface cards, live PPPoE status and searchable native LuCI lists. This is still experimental and has not been tested on every router or firmware. Keep Bootstrap installed for safe rollback.

## Packages

- `luci-theme-nova` — standalone dark visual theme, with Bootstrap as its supported base. It does not depend on the dashboard.
- `luci-app-nova-dashboard` — optional, independent LuCI dashboard under **Nova Dashboard / Nova 仪表盘** (also available via **Status → Nova Dashboard**). It can also run with Bootstrap without installing the Nova theme.

## IPK and APK builds

One source tree supports both package managers via the matching OpenWrt SDK:

| Target firmware | Package manager | Extension |
| --- | --- | --- |
| OpenWrt 23.05 / 24.10 | opkg | `.ipk` |
| OpenWrt 25.12+ | apk | `.apk` |

ImmortalWrt support depends on its actual LuCI/API and package-manager version; the target should be built against a compatible SDK. File extensions are *not* interchangeable.

GitHub Actions currently builds `25.12` APK artifacts only. Automatic IPK builds
are paused until feature development is complete; the source still supports
building IPK manually with a matching SDK. Both Lua/ucode templates and static
browser resources are platform-independent; the packages are intended for the
`all` architecture.

## Install

Download the theme package for your firmware series from a successful signed build (or a future release). Download the dashboard only if you want its extra status page. Transfer only the packages you intend to install to your router.

For **opkg**:
```sh
opkg install /tmp/luci-theme-nova_*.ipk
# Optional, separately:
opkg install /tmp/luci-app-nova-dashboard_*.ipk
```

For **apk**, once the selected package is individually signed and the reviewed
publisher key is trusted by your router:
```sh
apk add /tmp/luci-theme-nova-0.2.12-r1.apk
# Optional, separately:
apk add /tmp/luci-app-nova-dashboard-0.2.12-r1.apk
```

You may install, upgrade, or remove either Nova package independently. A build
producing both packages with the same version is not an installation dependency.
The brand link uses LuCI's normal home entry: it opens the optional dashboard
when that is the first accessible page, otherwise a native LuCI page.

The ordinary CI APK artifacts are unsigned. LuCI upload verifies package
signatures and will reject them. The separate **Build signed APK packages**
workflow signs automatically on main updates and v* tags, after its repository
secret and reviewed public-key fingerprint are configured. Missing configuration
fails closed. Pull-request tests only use disposable keys: never install a
`TEST-ONLY-*` key on your router. See [signing setup](docs/apk-signing.md) for the
required one-time setup and separate approval before changing router trust.

The theme **does not become the default automatically**. Switch in LuCI under System → System → Language and Style (wording varies by firmware), or via UCI after checking the registered theme name.

### Recover from a broken theme

Over SSH, switch back to the default Bootstrap theme:
```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
/etc/init.d/uhttpd restart
```

Keep `luci-theme-bootstrap` installed.

## Build in OpenWrt SDK / buildroot

Treat this repository as an OpenWrt package feed:
```sh
echo 'src-git nova https://github.com/qusica/luci-nova.git' >> feeds.conf.default
./scripts/feeds update nova
./scripts/feeds install -p nova luci-theme-nova luci-app-nova-dashboard
make defconfig
make package/feeds/nova/luci-theme-nova/compile V=s
make package/feeds/nova/luci-app-nova-dashboard/compile V=s
```

The output suffix (`.ipk` or `.apk`) is decided by the SDK. Prefer official versions matching the running firmware.

## Development checks

Run the dependency-free dashboard rendering tests with Node.js 18 or newer:

```sh
node --test tests/dashboard.test.js tests/native-lists.test.js tests/navigation.test.js tests/menu-localization.test.js tests/package-independence.test.js
node --test tests/asset-version.test.js
node --check luci-app-nova-dashboard/htdocs/luci-static/resources/view/nova/dashboard.js
node --check luci-theme-nova/htdocs/luci-static/nova/nova-shell.js
```

These tests exercise LuCI rendering with DOM/RPC doubles. They do not replace
browser layout checks or testing on an actual OpenWrt installation.

For isolated layout checks at desktop, tablet, and phone widths, use an installed
Chrome or Chromium (the GitHub runner includes `google-chrome`):

```sh
CHROME_BIN=google-chrome node --test tests/browser-layout.test.js
CHROME_BIN=google-chrome node --test tests/navigation-browser.test.js
CHROME_BIN=google-chrome node --test tests/native-lists-browser.test.js
CHROME_BIN=google-chrome node --test tests/visual-browser.test.js
```

When running all four browser files together, pass `--test-concurrency=1` to Node.
Each suite launches its own Chrome process; serial startup avoids resource
contention on small runners without weakening assertions or timeouts.
CI and extracted-APK checks also create a writable, run-local Fontconfig cache
and warm it before Chrome starts; cache failures remain test failures.

The browser test uses local fixtures only. It starts with a stale stylesheet link,
loads the current versioned CSS, and checks the actual Nova styles. It does not
verify the router's cache headers or the full Bootstrap/LuCI stack.
The navigation test sends real Chrome mouse, keyboard, and touch input to check
that hovering cannot expand menus or move the next click target.

When changing browser assets, bump `PKG_VERSION` in both package Makefiles and
`dashboardAssetVersion` in dashboard.js. LuCI's template substitution uses
`PKG_VERSION` for CSS/JS cache keys and ignores `PKG_RELEASE`; an r-only update can
leave the old styles cached. CI compares changed assets with the PR/push base and
rejects that mistake. To run the same comparison locally, set
`NOVA_ASSET_BASE` to the previous commit when running `tests/asset-version.test.js`.

## Design and safety

- No hard-coded WAN interface names or credentials.
- No change to router configuration on install, aside from adding a selectable theme entry.
- The custom dashboard is optional and can be removed independently.
- A separate package prevents the theme from requiring expensive monitoring services.

## License

Project-authored files: MIT. Templates adapted from the LuCI Bootstrap theme retain their upstream Apache-2.0 notices.

## What's new in 0.2.12

- Recognize an explicitly unavailable wireless service when LuCI appends a
  diagnostic stack to its RPC error. Match only the first error line so a stack
  frame cannot turn a generic, permission or timeout failure into an unavailable
  service. This does not infer that wireless hardware is absent.

## What's new in 0.2.11

- Remove the sidebar's empty horizontal scrollbar by balancing the brand's
  full-width margins. Long menus still scroll vertically, with keyboard focus
  kept visible. Source and extracted-APK tests now inspect the sidebar itself,
  not only the document width, with the complete native Bootstrap cascade.
- Identify an explicitly unavailable wireless runtime service without claiming
  that the device has no wireless hardware. Permission, transport and ambiguous
  RPC failures remain visible as detection failures. Missing saved configuration
  no longer claims that an empty fallback is being displayed.

## What's new in 0.2.10

- Make the theme brand link use native LuCI home instead of requiring the
  optional dashboard route. Native access checks and first-page selection stay
  in LuCI, including when the dashboard is missing or inaccessible.
- Clarify independent package installation and upgrades. Verify actual APK
  dependency metadata, separate installation, independent upgrades, optional
  removal and inconsistent-checksum diagnostics in disposable package roots.
- Retain the existing native forms, lists, navigation, dashboard and visuals.

## What's new in 0.2.9

- Normalize native map, heading, description, section and form spacing across
  system, status and network pages. Inactive native tab panels no longer leave
  padded empty strips, and clock action buttons have their own wrapping row.
- Load Bootstrap mobile before Nova so the same spacing rules win on phones.
  Preserve native joined widgets, dependency visibility and tab behavior.
- Add a faithful native Bootstrap fixture with true device-width tests, repeated
  tab changes, nested sections, action groups and modal containment. Source and
  extracted APK checks run the same suite.

## What's new in 0.2.8

- Give text inputs, selects, textareas and native dropdowns a gentle focus glow
  rather than a detached outline. Invalid fields retain red borders and glow;
  disabled fields remain quiet. Forced-colors mode keeps a system focus outline.
- Make native tab targets 38 px high (40 px on narrow screens) with more padding
  and gaps, preserving native tab behavior and keyboard access.

- Preserve CSS bytes through packaging. The SDK's csstidy optimizer was observed
  replacing muted-label declarations with an unrelated radio-meter background.
- Verify every packaged stylesheet against source, plus exact small-label color,
  transparency and size in the source and packaged visual browser suites.
- JavaScript remains minified. APK compression still keeps the package compact.

## What's new in 0.2.7

- Fix an actual native-LuCI rendering issue: dashboard SVG icons and charts now explicitly use the SVG namespace. LuCI's generic `E()` creates HTML elements even when the tag is `svg`, so that helper cannot create working vectors.
- Browser fixtures now reproduce LuCI's actual HTML-only `E()` behavior. Regression checks verify SVG namespace, case-sensitive viewBox attributes and nonempty rendered icon geometry, including extracted APKs.
- Asset versions advance again because 0.2.6 was installed during live acceptance. The Quiet Slate palette and all data/configuration behavior are unchanged.

## What's new in 0.2.6

- **Quiet Slate:** a unified graphite and ice-blue visual system across navigation, native LuCI forms, the dashboard, lists and the favicon. Mint indicates live activity, amber marks warnings, and lavender distinguishes uploads. No fluorescent lime accents remain.
- Larger tabular metrics, clearer secondary labels, calmer borders and a more spacious header improve long-session readability. Consistent decorative line icons replace the misleading checkmarks previously shown beside every metric.
- Keyboard focus remains visible. Download/upload charts also differ by line pattern, not color alone. Existing detected-interface data, native actions, menu interactions, list search and pagination are unchanged.
- A dedicated secret-free visual review checks 320/390/768/1024/1440 px layouts, key small-text contrast, unknown-state cards and decorative SVG accessibility. Screenshots use **synthetic test data**, not router telemetry. The same browser test is run against the minified APK assets.

See [visual design notes](docs/visual-design.md) for palette, semantics and acceptance boundaries.

## What's new in 0.2.5

- Consistent line icons identify menu categories by their LuCI route, so translating, hiding or reordering categories cannot change their meaning. Dashboard uses tiles, Status uses an activity trace, System uses a gear, Network uses a connected topology, and Logout uses an exit arrow.
- Parent and submenu labels share a text column. Disclosure arrows sit at the right edge, and tablet keyboard/touch dropdowns no longer inherit Bootstrap's offscreen position.
- Nova's two menu entries use the native LuCI translation catalog. Simplified Chinese shows **Nova 仪表盘**, while English keeps **Nova Dashboard**. The catalog is bundled into the dashboard APK; other apps retain their own translations. See [menu localization](docs/menu-localization.md).

## What's new in 0.2.3

- Native overview DHCP leases keep separate IPv4/IPv6 groups; associated stations and realtime connection lists gain default-collapsed, searchable, paginated details. Every original row and native action remains available, including multiple IPv6 addresses, reservation/disconnect controls, and permission-dependent fields. Group counts describe records, not guaranteed online devices.
- Existing system, memory, all storage mount rows, network, port, DSL and wireless summaries are left intact. Unknown add-on sections remain unchanged. See [the native overview compatibility inventory](docs/native-overview.md).

- WAN and Wi-Fi nodes, matching branches, counters and charts are derived from successful OpenWrt interface/wireless status reads. No fixed 2.4/5 GHz or WAN placeholder cards remain on devices without those configurations.
- Configured PPPoE interfaces keep their logical name and protocol while disconnected or dialing, including custom names. After dialing, their runtime device, IPv4/IPv6 addresses and throughput update automatically. IPv4 and IPv6 default routes are recognized. Native Network → Interfaces settings and all router configuration are unchanged.
- Disabled/down radios remain visible, including radios with no active SSID. Only observed bands get cards, including 6 GHz and an explicit unknown-band group. Configured-but-missing hardware is not silently treated as removed.
- Detection errors show a warning and retain the last known inventory, rather than claiming there are no interfaces. Initial loading uses LuCI's loading state. Failed association reads display unavailable counts, not zero clients.
- CPU, memory, storage and native LuCI features remain available on a LAN-only device. This remains a status dashboard, not a replacement for the native configuration pages.

Detection uses strict `network.interface dump` and `network.wireless status` reads. `luci-rpc.getWirelessDevices` only enriches successful wireless inventory with optional iwinfo data, because some rpcd versions mask an underlying timeout as an empty result. Netifd reports configured radios, not a guaranteed physical-hardware inventory; disabled or configured-but-unavailable devices stay visible. An arbitrary disconnected custom-named DHCP interface cannot be conclusively classified as WAN from a dump alone; connected default-route interfaces and PPPoE are recognized without relying on a fixed device name.

## What's new in 0.2.2

- Sidebar groups open and close on click or tap. Moving the pointer over a menu only highlights it, so links stay still while choosing a destination.
- Enter/Space toggle a focused group, Arrow Down opens it and focuses its first link, and Escape closes it and returns focus to the group button. Tab remains normal navigation; moving focus or clicking outside closes open groups.
- Disclosure state is exposed through `aria-expanded` and `aria-controls`; actual page links keep their normal navigation.
- Real mouse, keyboard, and touch regression tests run before APK builds.

## What's new in 0.2.1

- Fresh theme cache keys and versioned dashboard CSS on upgrades, including replacement of an older stylesheet link left in the page.
- Missing LAN devices are shown as unavailable instead of `undefined` or an assumed bridge name.
- Narrow-screen navigation dropdowns no longer inherit the desktop sidebar's clipping overflow.
- Rendering, upgrade-link, responsive layout, and asset-version regression checks run before APK builds.

## What's new in 0.2.0

- Vantage-inspired 232px fixed sidebar, 51px toolbar, menu search and refresh.
- Six compact status metrics, CPU utilization sampled from `/proc/stat`, memory and rootfs stats from `system.info`.
- Branching WAN-router-wireless/LAN map. Click a node to see details or open the relevant LuCI configuration.
- Realtime WAN and selected Wi-Fi interface traffic drawn from `luci.getRealtimeStats`, when available.
- Wi-Fi radio channel, noise, transmit power and station counts queried through the built-in LuCI network layer.
- **No placeholder/random telemetry.** Unavailable data is shown as unavailable, not invented.
- For custom deployments, WLAN rate reporting depends on driver and rpcd access. Network client grouping reflects associated Wi-Fi stations; wired host count is not inferred from unreliable ARP data.

### Updating an existing installation

Download the fresh package you want to update from a **successful signed** build.
Use the device's normal package-manager update procedure for that package, then
reload the browser. Updating the theme does not require updating or installing
the dashboard, and updating the dashboard does not require updating the theme.
Keep Bootstrap installed. SSH rollback remains available above.

If APK reports a `world[...]` checksum conflict involving an unchanged package,
do not infer a dependency or uninstall working packages. A matching local-file
checksum pin is supported and should not block an independent upgrade. Compare
the exact constraint with the installed package before repairing an inconsistent
pin. See [independent installation and APK diagnostics](docs/package-independence.md).


### Current limitations

- Vantage is an independent UI; Nova uses LuCI's default menu and forms under the hood.
- A full port-level Ethernet client topology and live spectrum-quality indicators are not yet implemented.
- Live traffic sampling may be unavailable on some devices or locked-down accounts.

