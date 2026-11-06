# LuCI Nova

Nova is a dark LuCI theme and a companion status dashboard for OpenWrt and ImmortalWrt.

> Preview 0.2.2: click-controlled navigation, live status metrics and versioned browser assets. This is still experimental and has not been tested on every router or firmware. Keep Bootstrap installed for safe rollback.

## Packages

- `luci-theme-nova` — dark visual theme, with Bootstrap as its supported base.
- `luci-app-nova-dashboard` — independent LuCI dashboard under **Dashboard / 仪表盘** (also available via **Status → Nova Dashboard**).

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

Download both packages for your firmware series from a successful GitHub Actions build (or a future release). Transfer the files to your router.

For **opkg**:
```sh
opkg install /tmp/luci-theme-nova_*.ipk /tmp/luci-app-nova-dashboard_*.ipk
```

For **apk**, once both packages are individually signed and the reviewed
publisher key is trusted by your router:
```sh
apk add /tmp/luci-theme-nova-*.apk /tmp/luci-app-nova-dashboard-*.apk
```

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
node --test tests/dashboard.test.js
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
```

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

Make sure to download the fresh 0.2.2 packages from a **successful** CI run.
Install both packages again using your device's normal package-manager update/upgrade procedure,
and reload the browser without cached assets. SSH rollback remains available above.

### Current limitations

- Vantage is an independent UI; Nova uses LuCI's default menu and forms under the hood.
- A full port-level Ethernet client topology and live spectrum-quality indicators are not yet implemented.
- Live traffic sampling may be unavailable on some devices or locked-down accounts.

