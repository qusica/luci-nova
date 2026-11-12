#!/usr/bin/env bash
# Disposable APK solver/payload regressions; no router runtime or package hooks.
# Usage: test-package-migration.sh APK THEME.apk NEW_STAGE [OLD_THEME.apk OLD_DASHBOARD.apk]
# Default baselines are synthetic legacy metadata + representative owned files.
# Supply actual old artifacts to validate real historical payload migration.
set -euo pipefail
[[ $# -eq 3 || $# -eq 5 ]] || { echo "Usage: $0 APK THEME.apk NEW_STAGE [OLD_THEME.apk OLD_DASHBOARD.apk]" >&2; exit 2; }
apk=$(realpath "$1"); theme=$(realpath "$2"); stage=$3
[[ -x $apk && -f $theme ]]
[[ ! -e $stage && ! -L $stage ]] || { echo 'NEW_STAGE already exists' >&2; exit 2; }
mkdir -p "$stage"; stage=$(realpath "$stage")
exec > >(tee "$stage/results.log") 2>&1
export APK_CONFIG=/dev/null
"$apk" --version
mkdir "$stage/keys" "$stage/stubs"
common=(--keys-dir "$stage/keys" --repositories-file /dev/null --no-network --no-scripts --allow-untrusted)
run() { local root=$1; shift; printf '+ apk --root %q ' "$root"; printf '%q ' "$@"; printf '\n'; "$apk" --root "$root" "${common[@]}" "$@"; }
metadata() {
    "$apk" adbdump "$1" > "$stage/$2.metadata"
    [[ $(sed -n 's/^  name: //p' "$stage/$2.metadata" | head -1) == "$3" ]]
    awk '/^  depends:/{on=1; next} on && /^    - /{sub(/^    - /, ""); print; next} on{exit}' "$stage/$2.metadata" | sed "s/^'//; s/'$//" > "$stage/$2.deps"
    while IFS= read -r dep; do
        case "$dep" in libc|luci-base|luci-theme-bootstrap) ;; '!luci-app-nova-dashboard') [[ $2 == theme ]] ;; *) echo "Unexpected dependency: $2 -> $dep"; exit 1;; esac
    done < "$stage/$2.deps"
    grep -qx luci-base "$stage/$2.deps"
}
version() { sed -n 's/^  version: //p' "$stage/$1.metadata" | head -1; }
metadata "$theme" theme luci-theme-nova
grep -qx luci-theme-bootstrap "$stage/theme.deps"
grep -qx '!luci-app-nova-dashboard' "$stage/theme.deps"
if grep -q '^  replaces:' "$stage/theme.metadata"; then echo 'Unexpected automatic replacement'; exit 1; fi
# Give native dependencies representative owned files, not just empty metadata.
native_path() {
    case "$1" in
        libc) echo usr/lib/nova-test-libc-sentinel ;;
        luci-base) echo www/luci-static/resources/view/status/include/10_system.js ;;
        luci-theme-bootstrap) echo usr/share/ucode/luci/template/themes/bootstrap/header.ut ;;
    esac
}
for name in libc luci-base luci-theme-bootstrap; do
    native_file=$(native_path "$name")
    mkdir -p "$stage/stubs/$name/$(dirname "$native_file")"
    printf 'native package %s\n' "$name" > "$stage/stubs/$name/$native_file"
    "$apk" mkpkg -I "name:$name" -I version:1-r0 -I arch:noarch --files "$stage/stubs/$name" -o "$stage/stubs/$name.apk"
done
if [[ $# -eq 5 ]]; then
    old_theme=$(realpath "$4"); old_dashboard=$(realpath "$5")
    echo 'Upgrade coverage: actual supplied legacy APK payloads.'
else
    echo 'Upgrade coverage: SYNTHETIC representative legacy files, not historical SDK artifacts.'
    old_theme=$stage/old-theme.apk; old_dashboard=$stage/old-dashboard.apk
    mkdir -p "$stage/legacy-theme/www/luci-static/nova" "$stage/legacy-dashboard/www/luci-static/resources/view/nova" "$stage/legacy-dashboard/usr/share/rpcd/acl.d"
    printf 'old shell\n' > "$stage/legacy-theme/www/luci-static/nova/nova-shell.js"
    printf 'old dashboard\n' > "$stage/legacy-dashboard/www/luci-static/resources/view/nova/dashboard.js"
    printf '{}\n' > "$stage/legacy-dashboard/usr/share/rpcd/acl.d/luci-app-nova-dashboard.json"
    "$apk" mkpkg -I name:luci-theme-nova -I version:0.2.12-r1 -I arch:noarch -I 'depends:luci-base luci-theme-bootstrap' --files "$stage/legacy-theme" -o "$old_theme"
    "$apk" mkpkg -I name:luci-app-nova-dashboard -I version:0.2.12-r1 -I arch:noarch -I 'depends:luci-base' --files "$stage/legacy-dashboard" -o "$old_dashboard"
fi
metadata "$old_theme" old-theme luci-theme-nova
metadata "$old_dashboard" old-dashboard luci-app-nova-dashboard
[[ $("$apk" version -t "$(version old-theme)" "$(version theme)") == '<' ]]
installed() { "$apk" --root "$1" --no-network --repositories-file /dev/null info -v; }
assert_package() { installed "$1" | grep -Fx "$2-$3"; }
assert_absent() { if installed "$1" | grep -q "^$2-"; then echo "Unexpected installed $2"; exit 1; fi; }
init() { mkdir -p "$1/etc/apk/cache"; run "$1" add --initdb --usermode "$stage/stubs/libc.apk" "$stage/stubs/luci-base.apk" "$stage/stubs/luci-theme-bootstrap.apk"; }
native_preserved() {
    for name in libc luci-base luci-theme-bootstrap; do
        assert_package "$1" "$name" 1-r0
        cmp "$stage/stubs/$name/$(native_path "$name")" "$1/$(native_path "$name")"
    done
}
mkdir "$stage/theme-payload"
"$apk" extract --allow-untrusted --destination "$stage/theme-payload" "$theme"
for file in www/luci-static/nova/nova-shell.js www/luci-static/resources/view/nova/dashboard.js usr/share/rpcd/acl.d/luci-app-nova-dashboard.json usr/share/luci/menu.d/luci-app-nova-dashboard.json; do
    [[ -f $stage/theme-payload/$file ]]
done
payload_matches() {
    while IFS= read -r -d '' file; do
        cmp "$file" "$1/${file#"$stage/theme-payload/"}"
    done < <(find "$stage/theme-payload" -type f -print0)
    assert_package "$1" luci-theme-nova "$(version theme)"
    assert_absent "$1" luci-app-nova-dashboard
    native_preserved "$1"
}
init "$stage/clean"
run "$stage/clean" add --usermode "$theme"
payload_matches "$stage/clean"
init "$stage/legacy"
run "$stage/legacy" add --usermode "$old_theme" "$old_dashboard"
# Installing over a still-installed dashboard must fail without touching files
# or the world/database (apart from cache and diagnostic log). Do not use --force-overwrite or automatic replacement.
cp -a "$stage/legacy" "$stage/conflict"
snapshot() { (cd "$1"; find . -type f ! -path './lib/apk/db/lock' ! -path './etc/apk/cache/*' ! -path './var/log/apk.log' -exec sha256sum {} + | sort); }
snapshot "$stage/conflict" > "$stage/before.sha256"
if run "$stage/conflict" add --usermode "$theme" > "$stage/conflict.log" 2>&1; then
    echo 'ERROR: old dashboard conflict unexpectedly accepted'; exit 1
fi
cat "$stage/conflict.log"
grep -F 'luci-app-nova-dashboard' "$stage/conflict.log"
snapshot "$stage/conflict" | cmp - "$stage/before.sha256"
# Also reject installing the retired dashboard alongside a fresh merged theme.
if run "$stage/clean" add --usermode "$old_dashboard" > "$stage/reverse-conflict.log" 2>&1; then
    echo 'ERROR: retired dashboard installed alongside merged theme'; exit 1
fi
payload_matches "$stage/clean"
cp -a "$stage/legacy" "$stage/migration"
run "$stage/migration" del luci-app-nova-dashboard
assert_absent "$stage/migration" luci-app-nova-dashboard
assert_package "$stage/migration" luci-theme-nova "$(version old-theme)"
native_preserved "$stage/migration"
run "$stage/migration" add --usermode "$theme"
payload_matches "$stage/migration"
# Existing theme without the optional old app also upgrades directly.
init "$stage/theme-upgrade"
run "$stage/theme-upgrade" add --usermode "$old_theme"
run "$stage/theme-upgrade" add --usermode "$theme"
payload_matches "$stage/theme-upgrade"
cp -a "$stage/migration" "$stage/uninstall"
run "$stage/uninstall" del luci-theme-nova
assert_absent "$stage/uninstall" luci-theme-nova
assert_absent "$stage/uninstall" luci-app-nova-dashboard
native_preserved "$stage/uninstall"
while IFS= read -r -d '' file; do
    relative=${file#"$stage/theme-payload/"}
    [[ ! -e $stage/uninstall/$relative ]] || { echo "Payload remains after uninstall: $relative"; exit 1; }
done < <(find "$stage/theme-payload" -type f -print0)
echo 'PASS: merged install, atomic legacy conflict, reverse conflict, removal-first migration, theme upgrade, uninstall and native file preservation.'
echo 'Scope: APK metadata, solver and files only; no hooks, services or router/UI runtime.'
