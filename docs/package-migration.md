# Upgrade to the integrated Nova package

Starting with 0.3.0, **luci-theme-nova includes the Dashboard**. New builds
produce one Nova package for each package manager. The old standalone
`luci-app-nova-dashboard` is no longer built or required.

The integrated package owns the theme, Dashboard JS/CSS, both existing menu
routes, the read-only ACL and the native Chinese catalog. Runtime paths, ACL
identity `luci-app-nova-dashboard`, and the catalog name stay unchanged so
bookmarks and existing permission grants keep working. This ACL name is not a
package dependency. Native Status → Overview and all configuration pages remain
available; no native status files, settings or router data are overwritten.

## Before upgrading

- Obtain the new **0.3.0 or later** package and keep a known-good old package for
  rollback. Use `.apk` for apk firmware and `.ipk` for opkg firmware.
- Keep Bootstrap installed and keep SSH access available. Save the router's normal
  configuration backup and record the installed Nova versions.
- If the standalone Dashboard is installed, **remove it before installing the
  integrated theme**. The integrated package declares a conflict with it. Never
  use force-overwrite, force-depends, force-broken-world or disabled signature
  verification to bypass that conflict.
- Removing the old Dashboard removes only its static assets, menu, translation
  and read-only RPC grant. It has no persistent router configuration or telemetry
  database. Its in-memory graphs restart after reloading as they already do today.
- The current 0.2.x theme may remain installed while the old app is removed.
  You do not need to remove the theme or Bootstrap.

## APK migration

Use a publisher-signed package whose reviewed key is already trusted. Replace
the example path with the exact downloaded filename. First inspect both plans:

```sh
apk info -e luci-app-nova-dashboard
apk del --simulate luci-app-nova-dashboard
# Continue only if it removes the old app, without unrelated package removals:
apk del luci-app-nova-dashboard
apk add --simulate /tmp/luci-theme-nova-0.3.0-r1.apk
# Continue only if it installs/upgrades Nova and retains Bootstrap/native LuCI:
apk add /tmp/luci-theme-nova-0.3.0-r1.apk
```

Skip the `apk del` steps if the standalone app is not installed. APK normally
removes its matching version/checksum world constraint with `apk del`; do not
manually rewrite `/etc/apk/world`. If the solver fails or proposes unrelated
removals, stop and inspect the full package state. Do not infer the cause from
`world[...]` alone. Existing inconsistent pins need separate diagnosis.

## IPK migration

```sh
opkg list-installed luci-app-nova-dashboard
# Only if the old app is installed:
opkg remove luci-app-nova-dashboard
opkg install /tmp/luci-theme-nova_0.3.0-r1_all.ipk
```

Check command output before continuing. If an unrelated package depends on the
old app, resolve that dependency deliberately; do not force removal. The new
package does not claim to provide the old independent package.

## After upgrading

Reload LuCI and sign in again if an old session has cached menu/ACL information.
The existing `/admin/nova` and `/admin/status/nova` paths both remain valid. The
brand uses LuCI's native home/ACL selection instead of bypassing access checks.
Native Status → Overview keeps the complete original information and actions.
Installing Nova does not select the theme or change the home route. Dashboard
is bundled even when Bootstrap is selected; there is no monitoring daemon.

If the page still shows old assets, hard-reload the browser. Dashboard and theme
assets now share the package's `0.3.0` versioned cache key. Firmware may also
require refreshing its LuCI menu/rpcd session caches after installing packages;
use the firmware's normal procedure rather than editing permissions.

## Removal and rollback

The theme and Dashboard are now one unit: removing `luci-theme-nova` removes
both. Select Bootstrap before removal; the new removal hook also resets an
active Nova selection to Bootstrap after its templates have gone. It leaves a
different selected theme unchanged, does not reset selection during replacement,
and does not edit host UCI when assembling an offline image.

To return to 0.2.x, switch to Bootstrap, remove the integrated Nova package, then
install the old theme and optionally the old standalone Dashboard. Do not install
the old app alongside the integrated theme. Use only packages and signing keys
appropriate for the device. Router network/wireless/system configuration is not
part of either Nova package and is not removed by this migration.

## Checks and limits

Source tests check one-package ownership, preserved route/ACL identities,
read-only access, native-home selection and removal-hook cases. Actual built
IPK checks inspect metadata (including conflict), payloads, translations and
browser regressions. Both package managers additionally exercise clean install,
old-app conflict, remove-first migration, upgrade and uninstall in disposable
roots with native-file sentinels:

```sh
bash scripts/test-built-ipks.sh THEME.ipk NEW_STAGE
bash scripts/test-built-apks.sh APK THEME.apk NEW_STAGE
bash scripts/test-package-migration.sh APK THEME.apk NEW_STAGE OLD_THEME.apk OLD_DASHBOARD.apk
bash scripts/build-host-opkg.sh NEW_BUILD_DIR
bash scripts/test-ipk-migration.sh OPKG THEME.ipk NEW_STAGE OLD_THEME.ipk OLD_DASHBOARD.ipk
```

Without historical package arguments the migration scripts use clearly labelled
synthetic legacy fixtures. Core dependencies are inert stubs, hooks and network
are disabled, and untrusted packages are allowed only in isolated test roots.
These checks do not change router trust or replace live acceptance. APK disables
package hooks and opkg offline mode skips them. The actual packaged removal hook
is separately executed with mocked UCI and template presence to cover selected
Nova, another theme, upgrade/replacement and offline-image cases. Firmware
service hooks and actual router lifecycle remain unverified. Real-device
acceptance is required before release.
