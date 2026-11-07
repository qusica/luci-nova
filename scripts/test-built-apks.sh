#!/usr/bin/env bash
# Run source regressions against actual SDK output, including minified assets.
# Extract as data only; no package hooks or installed scripts are executed.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'Usage: test-built-apks.sh APK THEME.apk DASHBOARD.apk NEW_STAGE' >&2; exit 2; }
apk=$(realpath "$1")
theme=$(realpath "$2")
dashboard=$(realpath "$3")
stage=$4
base=$(cd "$(dirname "$0")/.." && pwd)
[[ -x $apk && -f $theme && -f $dashboard ]]
[[ ! -e $stage && ! -L $stage ]]
mkdir -p "$stage"
stage=$(realpath "$stage")
mkdir "$stage/extracted" "$stage/luci-app-nova-dashboard" "$stage/luci-theme-nova"
APK_CONFIG=/dev/null "$apk" extract --allow-untrusted --destination "$stage/extracted" "$theme" "$dashboard"
cp -R "$base/tests" "$stage/tests"
# Preserve the tests' source layout but point every asset at extracted APK data.
ln -s "$stage/extracted/www" "$stage/luci-app-nova-dashboard/htdocs"
ln -s "$stage/extracted" "$stage/luci-app-nova-dashboard/root"
ln -s "$stage/extracted/www" "$stage/luci-theme-nova/htdocs"
node --check "$stage/extracted/www/luci-static/resources/view/nova/dashboard.js"
node --check "$stage/extracted/www/luci-static/nova/nova-shell.js"
node --check "$stage/extracted/www/luci-static/nova/nova-lists.js"
node --test "$stage/tests/dashboard.test.js" "$stage/tests/native-lists.test.js" "$stage/tests/navigation.test.js" "$stage/tests/menu-localization.test.js"
# Fontconfig may inherit non-writable system/user caches from the CI image.
# Give this validation run its own cache and surface prewarm failures normally.
export XDG_CACHE_HOME="$stage/browser-cache"
mkdir -p "$XDG_CACHE_HOME/fontconfig"
if command -v fc-cache >/dev/null 2>&1; then
    fc-cache
fi
# Each file launches a separate Chrome process. Serialize startup on small CI
# runners; preserve all suites, assertions and their bounded CDP timeouts.
node --test --test-concurrency=1 "$stage/tests/browser-layout.test.js" "$stage/tests/native-lists-browser.test.js" "$stage/tests/navigation-browser.test.js" "$stage/tests/visual-browser.test.js"
