#!/usr/bin/env bash
# Run source regressions against actual SDK output, including minified assets.
# Extract as data only; no package hooks or installed scripts are executed.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'Usage: test-built-apks.sh APK THEME.apk NEW_STAGE' >&2; exit 2; }
apk=$(realpath "$1")
theme=$(realpath "$2")
stage=$3
base=$(cd "$(dirname "$0")/.." && pwd)
[[ -x $apk && -f $theme ]]
[[ ! -e $stage && ! -L $stage ]]
mkdir -p "$stage"
stage=$(realpath "$stage")
mkdir "$stage/extracted" "$stage/luci-theme-nova"
APK_CONFIG=/dev/null "$apk" extract --allow-untrusted --destination "$stage/extracted" "$theme"
# Inspect the actual packaged removal hook, not only the source Makefile.
APK_CONFIG=/dev/null "$apk" adbdump --format json "$theme" > "$stage/theme-metadata.json"
python3 - "$stage" <<'PYCODE'
import json, pathlib, sys
stage = pathlib.Path(sys.argv[1])
data = json.loads((stage / 'theme-metadata.json').read_text())
hook = data.get('scripts', {}).get('post-deinstall')
if not hook:
    raise SystemExit('Integrated APK lacks the expected post-deinstall hook')
control = stage / 'control/luci-theme-nova'
control.mkdir(parents=True)
(control / 'postrm').write_text(hook)
PYCODE
cp -R "$base/tests" "$stage/tests"
# Preserve the tests' source layout but point every asset at extracted APK data.
ln -s "$stage/extracted/www" "$stage/luci-theme-nova/htdocs"
ln -s "$stage/extracted" "$stage/luci-theme-nova/root"
# CSS is deliberately not run through SDK csstidy: its selector merging can
# silently replace declarations. Verify every stylesheet, not just sampled UI.
for package in luci-theme-nova; do
    while IFS= read -r -d '' source; do
        relative=${source#"$base/$package/htdocs/"}
        cmp "$source" "$stage/extracted/www/$relative"
        printf 'CSS payload matches source: %s\n' "$relative"
    done < <(find "$base/$package/htdocs" -type f -name '*.css' -print0)
done
node --check "$stage/extracted/www/luci-static/resources/view/nova/dashboard.js"
node --check "$stage/extracted/www/luci-static/nova/nova-shell.js"
node --check "$stage/extracted/www/luci-static/nova/nova-lists.js"
node --check "$stage/extracted/www/luci-static/nova/nova-search.js"
node --test "$stage/tests/dashboard.test.js" "$stage/tests/native-lists.test.js" "$stage/tests/navigation.test.js" "$stage/tests/menu-localization.test.js" "$stage/tests/package-integration.test.js" "$stage/tests/page-search.test.js" "$stage/tests/page-search-interaction.test.js"

# Migration dependency/solver coverage uses disposable roots and test copies.
bash "$base/scripts/test-package-migration.sh" "$apk" "$theme" "$stage/package-migration"

# Fontconfig may inherit non-writable system/user caches from the CI image.
# Give this validation run its own cache and surface prewarm failures normally.
export XDG_CACHE_HOME="$stage/browser-cache"
mkdir -p "$XDG_CACHE_HOME/fontconfig"
if command -v fc-cache >/dev/null 2>&1; then
    fc-cache
fi
# Each file launches a separate Chrome process. Serialize startup on small CI
# runners; preserve all suites, assertions and their bounded CDP timeouts.
node --test --test-concurrency=1 "$stage/tests/browser-layout.test.js" "$stage/tests/native-lists-browser.test.js" "$stage/tests/navigation-browser.test.js" "$stage/tests/visual-browser.test.js" "$stage/tests/native-spacing-browser.test.js" "$stage/tests/sidebar-overflow-browser.test.js" "$stage/tests/dashboard-preferences-browser.test.js" "$stage/tests/page-search-browser.test.js"
