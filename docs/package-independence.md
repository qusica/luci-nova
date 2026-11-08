# Independent Nova packages

`luci-theme-nova` depends on LuCI base and Bootstrap. The OpenWrt SDK also
adds its normal libc dependency. It does not depend on
`luci-app-nova-dashboard`. The dashboard depends on LuCI base and libc, not
on the Nova theme or Bootstrap. These are ordinary package dependencies,
not an instruction to install both Nova packages.

Install or upgrade only the package you want, using its signed APK and the
normal package manager. Keep Bootstrap for the theme's base assets and
rollback. The optional dashboard can be added later, retained at an older
version during a theme upgrade, or removed without uninstalling the theme.
Dashboard status and chart assets, menu entries, translations and RPC access
rules belong to the dashboard package. The theme owns its shell, styles,
native-list enhancements and selectable theme registration.

The theme brand link targets LuCI's `admin` entry, not `admin/nova`.
LuCI's native first-child routing and access checks select an available page.
With the dashboard installed and accessible, its menu priority normally makes
it the landing page. Without it, native LuCI navigation remains available.
No theme install hook changes the user's landing-page or theme selection.

## Distinguish dependencies from APK world constraints

APK records explicitly selected packages in `/etc/apk/world`. A local APK
can produce a checksum constraint such as `luci-app-nova-dashboard><Q1…`.
This is a restriction on which dashboard package satisfies the user's requested
state. It is not a dependency declared by the theme.

A **matching** checksum pin for an installed older dashboard does not prevent
upgrading only the theme. Tests with apk-tools 3.0.5 and actual signed Nova
0.2.4/0.2.5 packages confirm this. Merely seeing `world[...]` in an error does
not establish the cause: inspect the complete error and compare the recorded
constraint with the installed package.

An **inconsistent** checksum pin can cause the solver to reject an otherwise
independent theme upgrade with `breaks: world[luci-app-nova-dashboard><Q1…]`.
A controlled disposable fixture reproduces this. Literal `name=hexHASH` is
not the same format: APK interprets `=` as a version constraint and can reject
it as an invalid version before solving dependencies.

### Conditional repair after diagnosis

Do not routinely edit `world`, uninstall the dashboard, disable verification,
or force a broken transaction. First retain a backup of the package state,
record the exact installed dashboard version and inspect the proposed change.
If the error has specifically been traced to an inconsistent dashboard checksum
pin, an explicit **version-qualified** dashboard request can replace that pin
without changing the installed dashboard version. For example, only when the
installed dashboard really is `0.2.8-r1`:

```sh
apk add --simulate 'luci-app-nova-dashboard=0.2.8-r1' /tmp/luci-theme-nova-0.2.10-r1.apk
# Proceed only if the plan upgrades the theme and retains the dashboard:
apk add 'luci-app-nova-dashboard=0.2.8-r1' /tmp/luci-theme-nova-0.2.10-r1.apk
```

Use the exact installed version, not the example blindly. This deliberately
replaces only the dashboard's checksum constraint with a version constraint;
that version remains pinned until a later explicit dashboard update. Normal
signature verification remains enabled. This does not repair an invalid world
syntax or a different dependency error. No such migration runs automatically
on installation, and these instructions do not claim the cause of a particular
router error without its package-state evidence.

## Regression coverage and limits

Run the actual-package checks with the same host APK 3 tool used by the build:

```sh
bash scripts/test-package-independence.sh APK THEME.apk DASHBOARD.apk NEW_STAGE
# Additionally use genuine earlier APKs when available:
bash scripts/test-package-independence.sh APK THEME.apk DASHBOARD.apk NEW_STAGE OLD_THEME.apk OLD_DASHBOARD.apk
```

The script checks actual dependency metadata and installs into new disposable
roots. It covers theme-only, dashboard-only and combined installs; independent
and combined upgrades while preserving the other package's checksum pin;
and dashboard removal while preserving every theme payload file. A deliberately
inconsistent constraint must fail first, then a simulated and real targeted
version-qualified repair must preserve the dashboard version.

Without old APK arguments, explicitly labelled synthetic older packages test
solver transitions rather than pretending to be historical releases. Core
system dependencies are inert stubs, installation scripts and networking are
disabled, and unsigned/test APKs are allowed only inside the disposable roots.
No router trust settings are read or changed. These tests do not replace
signature checks, executing real install scripts or live router acceptance.

Source and extracted-template tests verify that brand navigation requests only
native home, templates have no dashboard resource requirement, native menus
work without the dashboard, and removing its route does not recreate it.
The existing browser suites continue to cover native pages and optional
dashboard functionality independently of these package solver checks.
