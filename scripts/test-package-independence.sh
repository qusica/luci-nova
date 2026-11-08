#!/usr/bin/env bash
# Isolated APK solver/payload regressions, never router runtime validation.
# Usage: test-package-independence.sh APK THEME.apk DASHBOARD.apk NEW_STAGE
#        [OLD_THEME.apk OLD_DASHBOARD.apk]
# NEW_STAGE must not exist. Retained logs, roots and metadata are test evidence.
# Unsigned SDK outputs are accepted ONLY in these disposable roots. No host
# keys/world/repositories are changed; no package scripts or network are used.
# Without old APKs, upgrade baselines are empty synthetic 0.0.0-r0 packages:
# this proves solver independence, NOT real historical payload migration.
set -euo pipefail
[[ $# -eq 4 || $# -eq 6 ]] || { echo "Usage: $0 APK THEME.apk DASHBOARD.apk NEW_STAGE [OLD_THEME.apk OLD_DASHBOARD.apk]" >&2; exit 2; }
apk=$(realpath "$1"); theme=$(realpath "$2"); dashboard=$(realpath "$3"); stage=$4
[[ -x $apk && -f $theme && -f $dashboard ]]
[[ ! -e $stage && ! -L $stage ]] || { echo 'NEW_STAGE already exists' >&2; exit 2; }
mkdir -p "$stage"; stage=$(realpath "$stage")
exec > >(tee "$stage/results.log") 2>&1
export APK_CONFIG=/dev/null
"$apk" --version
printf 'TEST ONLY: --allow-untrusted, --no-scripts, --no-network, empty repositories; roots under %s\n' "$stage"
mkdir "$stage/keys" "$stage/stubs"
common=(--keys-dir "$stage/keys" --repositories-file /dev/null --no-network --no-scripts --allow-untrusted)
run() { local root=$1; shift; printf '+ apk --root %q ' "$root"; printf '%q ' "$@"; printf '\n'; "$apk" --root "$root" "${common[@]}" "$@"; }
metadata() {
    local file=$1 label=$2 expected=$3
    "$apk" adbdump "$file" > "$stage/$label.metadata"
    [[ $(sed -n 's/^  name: //p' "$stage/$label.metadata" | head -1) == "$expected" ]]
    awk '/^  depends:/{on=1; next} on && /^    - /{sub(/^    - /, ""); print; next} on{exit}' "$stage/$label.metadata" > "$stage/$label.deps"
    # These are the only core dependencies modeled by empty test stubs.
    # Fail rather than silently making a new or versioned dependency pass.
    while IFS= read -r dep; do
        case "$dep" in libc|luci-base) ;; luci-theme-bootstrap) [[ $expected == luci-theme-nova ]] ;; *) echo "Unexpected dependency: $label -> $dep"; exit 1;; esac
    done < "$stage/$label.deps"
    grep -qx luci-base "$stage/$label.deps"
    if [[ $expected == luci-theme-nova ]]; then grep -qx luci-theme-bootstrap "$stage/$label.deps"; fi
}
version() { sed -n 's/^  version: //p' "$stage/$1.metadata" | head -1; }
metadata "$theme" theme luci-theme-nova
metadata "$dashboard" dashboard luci-app-nova-dashboard
for name in libc luci-base luci-theme-bootstrap; do
    "$apk" mkpkg -I "name:$name" -I version:1-r0 -I arch:noarch -o "$stage/stubs/$name.apk"
done
if [[ $# -eq 6 ]]; then
    old_theme=$(realpath "$5"); old_dashboard=$(realpath "$6")
    echo 'Upgrade coverage: actual supplied old APKs -> actual new APKs.'
else
    echo 'Upgrade coverage: SYNTHETIC empty old metadata packages -> actual new APKs.'
    old_theme=$stage/old-theme.apk; old_dashboard=$stage/old-dashboard.apk
    "$apk" mkpkg -I name:luci-theme-nova -I version:0.0.0-r0 -I arch:noarch -I "depends:$(tr '\n' ' ' < "$stage/theme.deps")" -o "$old_theme"
    "$apk" mkpkg -I name:luci-app-nova-dashboard -I version:0.0.0-r0 -I arch:noarch -I "depends:$(tr '\n' ' ' < "$stage/dashboard.deps")" -o "$old_dashboard"
fi
metadata "$old_theme" old-theme luci-theme-nova
metadata "$old_dashboard" old-dashboard luci-app-nova-dashboard
[[ $("$apk" version -t "$(version old-theme)" "$(version theme)") == '<' ]]
[[ $("$apk" version -t "$(version old-dashboard)" "$(version dashboard)") == '<' ]]
init() {
    local root=$1; shift; mkdir "$root"
    local args=() dep
    for dep in "$@"; do args+=("$stage/stubs/$dep.apk"); done
    run "$root" add --initdb --usermode "${args[@]}"
}
installed() { "$apk" --root "$1" --no-network --repositories-file /dev/null info -v; }
assert_package() { installed "$1" | grep -Fx "$2-$3"; }
assert_absent() { if installed "$1" | grep -q "^$2-"; then echo "Unexpected installed $2"; exit 1; fi; }
# Only install stubs actually declared by the package being tested.
mapfile -t theme_deps < "$stage/theme.deps"
mapfile -t dashboard_deps < "$stage/dashboard.deps"
mapfile -t both_deps < <(cat "$stage/theme.deps" "$stage/dashboard.deps" "$stage/old-theme.deps" "$stage/old-dashboard.deps" | sort -u)
init "$stage/theme-only" "${theme_deps[@]}"
run "$stage/theme-only" add --usermode "$theme"
assert_package "$stage/theme-only" luci-theme-nova "$(version theme)"
assert_absent "$stage/theme-only" luci-app-nova-dashboard
init "$stage/dashboard-only" "${dashboard_deps[@]}"
run "$stage/dashboard-only" add --usermode "$dashboard"
assert_package "$stage/dashboard-only" luci-app-nova-dashboard "$(version dashboard)"
assert_absent "$stage/dashboard-only" luci-theme-nova
assert_absent "$stage/dashboard-only" luci-theme-bootstrap
init "$stage/combined" "${both_deps[@]}"
run "$stage/combined" add --usermode "$theme" "$dashboard"
assert_package "$stage/combined" luci-theme-nova "$(version theme)"
assert_package "$stage/combined" luci-app-nova-dashboard "$(version dashboard)"
init "$stage/old" "${both_deps[@]}"
run "$stage/old" add --usermode "$old_theme" "$old_dashboard"
# Local-file adds create checksum constraints. Preserve the untouched package's
# exact world line through each independent upgrade. Matching pins are valid.
grep '^luci-theme-nova><' "$stage/old/etc/apk/world" > "$stage/theme.pin"
grep '^luci-app-nova-dashboard><' "$stage/old/etc/apk/world" > "$stage/dashboard.pin"
for scenario in upgrade-theme upgrade-dashboard upgrade-both; do
    cp -a "$stage/old" "$stage/$scenario"
done
run "$stage/upgrade-theme" add --usermode "$theme"
assert_package "$stage/upgrade-theme" luci-theme-nova "$(version theme)"
assert_package "$stage/upgrade-theme" luci-app-nova-dashboard "$(version old-dashboard)"
grep '^luci-app-nova-dashboard><' "$stage/upgrade-theme/etc/apk/world" | cmp - "$stage/dashboard.pin"
run "$stage/upgrade-dashboard" add --usermode "$dashboard"
assert_package "$stage/upgrade-dashboard" luci-theme-nova "$(version old-theme)"
assert_package "$stage/upgrade-dashboard" luci-app-nova-dashboard "$(version dashboard)"
grep '^luci-theme-nova><' "$stage/upgrade-dashboard/etc/apk/world" | cmp - "$stage/theme.pin"
run "$stage/upgrade-both" add --usermode "$theme" "$dashboard"
assert_package "$stage/upgrade-both" luci-theme-nova "$(version theme)"
assert_package "$stage/upgrade-both" luci-app-nova-dashboard "$(version dashboard)"
# Deliberately inconsistent fixture ONLY: installed old dashboard, but its world
# checksum points to the new artifact. A valid matching old pin passed above.
cp -a "$stage/old" "$stage/stale-pin"
new_dashboard_pin=$(grep '^luci-app-nova-dashboard><' "$stage/combined/etc/apk/world")
awk -v replacement="$new_dashboard_pin" '{if ($0 ~ /^luci-app-nova-dashboard></) print replacement; else print}' \
    "$stage/stale-pin/etc/apk/world" > "$stage/stale-pin.world"
cp "$stage/stale-pin.world" "$stage/stale-pin/etc/apk/world"
installed "$stage/stale-pin" > "$stage/stale-pin.before.packages"
# A database snapshot also catches unintended file/script database changes.
find "$stage/stale-pin/lib/apk" "$stage/stale-pin/etc/apk" -type f -exec sha256sum {} + | sort > "$stage/stale-pin.before.database"
if run "$stage/stale-pin" add --usermode "$theme" > "$stage/stale-pin.failure.log" 2>&1; then
    echo 'ERROR: inconsistent checksum unexpectedly accepted'; exit 1
fi
cat "$stage/stale-pin.failure.log"
grep -F 'breaks: world[luci-app-nova-dashboard><' "$stage/stale-pin.failure.log"
cmp "$stage/stale-pin.world" "$stage/stale-pin/etc/apk/world"
installed "$stage/stale-pin" | cmp - "$stage/stale-pin.before.packages"
find "$stage/stale-pin/lib/apk" "$stage/stale-pin/etc/apk" -type f -exec sha256sum {} + | sort | cmp - "$stage/stale-pin.before.database"
retained_dashboard="luci-app-nova-dashboard=$(version old-dashboard)"
run "$stage/stale-pin" add --usermode --simulate "$retained_dashboard" "$theme"
cmp "$stage/stale-pin.world" "$stage/stale-pin/etc/apk/world"
installed "$stage/stale-pin" | cmp - "$stage/stale-pin.before.packages"
find "$stage/stale-pin/lib/apk" "$stage/stale-pin/etc/apk" -type f -exec sha256sum {} + | sort | cmp - "$stage/stale-pin.before.database"
run "$stage/stale-pin" add --usermode "$retained_dashboard" "$theme"
assert_package "$stage/stale-pin" luci-app-nova-dashboard "$(version old-dashboard)"
assert_package "$stage/stale-pin" luci-theme-nova "$(version theme)"
# Only the dashboard repair and explicitly requested theme upgrade may change
# world constraints. Compare against the already tested theme-only upgrade.
awk -v replacement="$retained_dashboard" '{if ($0 ~ /^luci-app-nova-dashboard></) print replacement; else print}' \
    "$stage/upgrade-theme/etc/apk/world" > "$stage/stale-pin.expected.world"
cmp "$stage/stale-pin.expected.world" "$stage/stale-pin/etc/apk/world"
installed "$stage/upgrade-theme" | cmp - <(installed "$stage/stale-pin")
echo 'PASS: inconsistent pin rejected atomically; simulated repair unchanged; exact-version repair retains dashboard.'
# Removing the optional dashboard must preserve all actual theme file payloads.
mkdir "$stage/theme-payload"
"$apk" extract --allow-untrusted --destination "$stage/theme-payload" "$theme"
cp -a "$stage/combined" "$stage/remove-dashboard"
run "$stage/remove-dashboard" del luci-app-nova-dashboard
assert_absent "$stage/remove-dashboard" luci-app-nova-dashboard
assert_package "$stage/remove-dashboard" luci-theme-nova "$(version theme)"
while IFS= read -r -d '' file; do
    relative=${file#"$stage/theme-payload/"}
    cmp "$file" "$stage/remove-dashboard/$relative"
done < <(find "$stage/theme-payload" -type f -print0)
# Symmetric independence: removing the theme preserves dashboard payloads.
mkdir "$stage/dashboard-payload"
"$apk" extract --allow-untrusted --destination "$stage/dashboard-payload" "$dashboard"
cp -a "$stage/combined" "$stage/remove-theme"
run "$stage/remove-theme" del luci-theme-nova
assert_absent "$stage/remove-theme" luci-theme-nova
assert_package "$stage/remove-theme" luci-app-nova-dashboard "$(version dashboard)"
while IFS= read -r -d '' file; do
    relative=${file#"$stage/dashboard-payload/"}
    cmp "$file" "$stage/remove-theme/$relative"
done < <(find "$stage/dashboard-payload" -type f -print0)
echo 'PASS: clean standalone/combined installs, independent checksum-pinned upgrades, combined upgrade, independent removals preserving other package payload.'

echo 'Scope: package metadata, solver and files only; package hooks and router/UI runtime are not exercised.'
