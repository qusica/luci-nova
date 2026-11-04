# LuCI Nova

Nova is a dark LuCI theme and a companion status dashboard for OpenWrt and ImmortalWrt.

> Preview 0.2.0: screenshot-inspired layout, live status metrics and dual package formats. This is still experimental and has not been tested on every router or firmware. Keep Bootstrap installed for safe rollback.

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

The GitHub Actions workflow builds both `24.10` IPK and `25.12` APK artifacts. Both Lua/ucode templates and static browser resources are platform-independent; the packages are intended for the `all` architecture.

## Install

Download both packages for your firmware series from a successful GitHub Actions build (or a future release). Transfer the files to your router.

For **opkg**:
```sh
opkg install /tmp/luci-theme-nova_*.ipk /tmp/luci-app-nova-dashboard_*.ipk
```

For **apk** (locally-built, unsigned packages only):
```sh
apk add --allow-untrusted /tmp/luci-theme-nova-*.apk /tmp/luci-app-nova-dashboard-*.apk
```

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

## Design and safety

- No hard-coded WAN interface names or credentials.
- No change to router configuration on install, aside from adding a selectable theme entry.
- The custom dashboard is optional and can be removed independently.
- A separate package prevents the theme from requiring expensive monitoring services.

## License

Project-authored files: MIT. Templates adapted from the LuCI Bootstrap theme retain their upstream Apache-2.0 notices.

## What's new in 0.2.0

- Vantage-inspired 232px fixed sidebar, 51px toolbar, menu search and refresh.
- Six compact status metrics, CPU utilization sampled from `/proc/stat`, memory and rootfs stats from `system.info`.
- Branching WAN-router-wireless/LAN map. Click a node to see details or open the relevant LuCI configuration.
- Realtime WAN and selected Wi-Fi interface traffic drawn from `luci.getRealtimeStats`, when available.
- Wi-Fi radio channel, noise, transmit power and station counts queried through the built-in LuCI network layer.
- **No placeholder/random telemetry.** Unavailable data is shown as unavailable, not invented.
- For custom deployments, WLAN rate reporting depends on driver and rpcd access. Network client grouping reflects associated Wi-Fi stations; wired host count is not inferred from unreliable ARP data.

### Updating an existing installation

Make sure to download the fresh 0.2.0 packages from a **successful** CI run.
Install both packages again using your device's normal package-manager update/upgrade procedure,
and reload the browser without cached assets. SSH rollback remains available above.

### Current limitations

- Vantage is an independent UI; Nova uses LuCI's default menu and forms under the hood.
- A full port-level Ethernet client topology and live spectrum-quality indicators are not yet implemented.
- Live traffic sampling may be unavailable on some devices or locked-down accounts.
