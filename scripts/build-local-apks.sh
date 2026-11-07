#!/usr/bin/env bash
# Build only Nova from an authenticated, warm OpenWrt SDK. Never handles a key.
set -euo pipefail
umask 022
[[ $# -eq 2 ]] || { echo 'Usage: build-local-apks.sh SDK_CACHE NEW_OUTPUT_DIRECTORY' >&2; exit 2; }
cache=$(realpath "$1")
driver=$(realpath "$0")
base=$(cd "$(dirname "$0")/.." && pwd)
sdk="$cache/sdk"
out=$2
[[ -f "$cache/sdk-provenance.json" && -f "$sdk/Makefile" ]]
[[ ! -e $out && ! -L $out ]] || { echo 'Output directory must be new.' >&2; exit 1; }
mkdir -p "$out"
out=$(realpath "$out")
exec 9>"$cache/sdk.lock"
flock 9
started=$(date +%s)
exec > >(tee "$out/build.log") 2>&1
if [[ -d "$cache/host-tools/root/usr/bin" ]]; then
    export PATH="$cache/host-tools/bin:$cache/host-tools/root/usr/bin:$PATH"
    export LD_LIBRARY_PATH="$cache/host-tools/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
commit=$(git -C "$base" rev-parse HEAD)
tree=$(git -C "$base" rev-parse HEAD^{tree})
export SOURCE_DATE_EPOCH=$(git -C "$base" show -s --format=%ct HEAD)
git -C "$base" diff --exit-code HEAD -- luci-theme-nova luci-app-nova-dashboard tests scripts/test-built-apks.sh
[[ -z $(git -C "$base" ls-files --others --exclude-standard -- luci-theme-nova luci-app-nova-dashboard tests) ]]
source="$cache/sources/$commit"
if [[ ! -d $source ]]; then
    mkdir -p "$cache/sources"
    stage=$(mktemp -d "$cache/sources/extract.XXXXXXXX")
    git -C "$base" archive HEAD | tar -x -C "$stage"
    mv "$stage" "$source"
fi
python3 - "$base" "$source" "$commit" <<'PY'
import hashlib,os,pathlib,subprocess,sys
base,source,commit=sys.argv[1:]
root=pathlib.Path(source)
entries=subprocess.check_output(['git','-C',base,'ls-tree','-rz',commit]).split(b'\0')
expected=set()
for entry in filter(None,entries):
    metadata,name=entry.split(b'\t',1)
    mode,kind,digest=metadata.split()
    assert kind==b'blob','Submodules are not supported in local package inputs.'
    relative=os.fsdecode(name);expected.add(relative);path=root/relative
    if mode==b'120000':
        assert path.is_symlink(),relative
        data=os.fsencode(os.readlink(path))
    else:
        assert path.is_file() and not path.is_symlink(),relative
        data=path.read_bytes()
        assert bool(path.stat().st_mode & 0o111)==(mode==b'100755'),relative
    actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    assert actual==digest.decode(),f'Cached source changed: {relative}'
actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
assert actual==expected,'Cached source contains missing or extra files.'
PY
printf 'Source commit: %s\nSource tree: %s\nSOURCE_DATE_EPOCH: %s\n' "$commit" "$tree" "$SOURCE_DATE_EPOCH"
for feed in base luci packages; do
    test -d "$cache/feeds/$feed/.git"
    expected=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["feeds"][sys.argv[2]])' "$cache/sdk-provenance.json" "$feed")
    [[ $(git -C "$cache/feeds/$feed" rev-parse HEAD) == "$expected" ]]
    git -C "$cache/feeds/$feed" diff --quiet
    git -C "$cache/feeds/$feed" diff --cached --quiet
    [[ -z $(git -C "$cache/feeds/$feed" ls-files --others --exclude-standard) ]] || { echo "Unexpected untracked files in $feed feed" >&2; exit 1; }
done
cd "$sdk"
printf 'src-link base %s\nsrc-link packages %s\nsrc-link luci %s\nsrc-link nova %s\n' \
    "$cache/feeds/base/package" "$cache/feeds/packages" "$cache/feeds/luci" "$source" >feeds.conf
for feed in base packages luci; do
    expected=$(git -C "$cache/feeds/$feed" rev-parse HEAD)
    if [[ ! -f "feeds/$feed.index" || ! -f "feeds/$feed.nova-revision" || $(cat "feeds/$feed.nova-revision") != "$expected" ]]; then
        ./scripts/feeds update "$feed"
        printf '%s\n' "$expected" >"feeds/$feed.nova-revision"
    fi
done
./scripts/feeds update nova
./scripts/feeds install -p nova luci-theme-nova luci-app-nova-dashboard
# A dedicated package configuration avoids SDK defaults that build every
# language and every optional variant of a dependency.
cat >.config <<'CONFIG'
# CONFIG_ALL is not set
# CONFIG_ALL_NONSHARED is not set
# CONFIG_ALL_KMODS is not set
CONFIG_PACKAGE_luci-theme-nova=m
CONFIG_PACKAGE_luci-app-nova-dashboard=m
CONFIG_LUCI_JSMIN=y
CONFIG_LUCI_CSSTIDY=y
# CONFIG_SIGNED_PACKAGES is not set
# CONFIG_AUTOREMOVE is not set
CONFIG
make defconfig
make package/luci-theme-nova/clean package/luci-app-nova-dashboard/clean V=s
make -j"${NOVA_BUILD_JOBS:-4}" package/luci-theme-nova/compile package/luci-app-nova-dashboard/compile \
    SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" PKG_SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" V=s
mkdir "$out/packages"
for package in luci-theme-nova luci-app-nova-dashboard; do
    mapfile -d '' matches < <(find bin/packages -type f -name "$package-*.apk" -print0)
    [[ ${#matches[@]} -eq 1 ]] || { echo "Expected exactly one APK for $package" >&2; exit 1; }
    cp "${matches[0]}" "$out/packages/"
done
apk=${NOVA_APK_TOOL:-$sdk/staging_dir/host/bin/apk}
[[ -x $apk ]]
apk=$(realpath "$apk")
mkdir "$out/package-tests" "$out/package-tests/extracted" "$out/package-tests/luci-theme-nova" "$out/package-tests/luci-app-nova-dashboard"
APK_CONFIG=/dev/null "$apk" extract --allow-untrusted --destination "$out/package-tests/extracted" "$out"/packages/*.apk
cp -R "$source/tests" "$out/package-tests/tests"
ln -s "$out/package-tests/extracted/www" "$out/package-tests/luci-theme-nova/htdocs"
ln -s "$out/package-tests/extracted/www" "$out/package-tests/luci-app-nova-dashboard/htdocs"
ln -s "$out/package-tests/extracted" "$out/package-tests/luci-app-nova-dashboard/root"
for file in www/luci-static/nova/nova-shell.js www/luci-static/nova/nova-lists.js www/luci-static/resources/view/nova/dashboard.js; do
    node --check "$out/package-tests/extracted/$file"
done
GIT_DIR="$(git -C "$base" rev-parse --absolute-git-dir)" GIT_WORK_TREE="$source" \
    node --test "$source/tests/dashboard.test.js" "$source/tests/native-lists.test.js" "$source/tests/asset-version.test.js" >"$out/source-tests.log" 2>&1
node --test "$out/package-tests/tests/dashboard.test.js" "$out/package-tests/tests/native-lists.test.js" >"$out/packaged-tests.log" 2>&1
browser_status=deferred_to_secret_free_ci
if [[ ${NOVA_LOCAL_BROWSER_TESTS:-1} == 1 ]]; then
    node --test "$out/package-tests/tests/browser-layout.test.js" "$out/package-tests/tests/native-lists-browser.test.js" "$out/package-tests/tests/navigation-browser.test.js" >"$out/browser-tests.log" 2>&1
    browser_status=passed
fi
cp "$cache/sdk-provenance.json" "$out/SDK-PROVENANCE.json"
cp "$cache/downloads/sha256sums" "$out/SDK-SHA256SUMS"
cp "$cache/downloads/sha256sums.asc" "$out/SDK-SHA256SUMS.asc"
cp "$cache/verification/manifest-verification.log" "$out/sdk-verification.log"
cp "$sdk/.config" "$out/sdk-config.txt"
python3 - "$out" "$commit" "$tree" "$SOURCE_DATE_EPOCH" "$browser_status" "$started" "$apk" "$driver" "$base/scripts/setup-local-sdk.sh" <<'PY'
import hashlib,json,pathlib,subprocess,sys,time
out=pathlib.Path(sys.argv[1])
packages=[]
for path in sorted((out/'packages').glob('*.apk')):
    packages.append({'name':path.name,'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
record={'schema_version':1,'repository':'qusica/luci-nova','source_commit':sys.argv[2],
        'source_tree':sys.argv[3],'source_date_epoch':int(sys.argv[4]),'package_source_clean':True,
        'sdk':json.loads((out/'SDK-PROVENANCE.json').read_text()),'packages':packages,
        'checks':{'source_unit':'passed','packaged_unit':'passed','packaged_syntax':'passed','local_browser':sys.argv[5]},
        'elapsed_seconds':round(time.time()-int(sys.argv[6]),3),
        'apk_tool_version':subprocess.check_output([sys.argv[7],'--version'],text=True).strip(),
        'build_recipe':{'build_helper_sha256':hashlib.sha256(pathlib.Path(sys.argv[8]).read_bytes()).hexdigest(),
                        'setup_helper_sha256':hashlib.sha256(pathlib.Path(sys.argv[9]).read_bytes()).hexdigest(),
                        'sdk_config_sha256':hashlib.sha256((out/'sdk-config.txt').read_bytes()).hexdigest(),
                        'node_version':subprocess.check_output(['node','--version'],text=True).strip(),
                        'gcc_version':subprocess.check_output(['gcc','-dumpfullversion'],text=True).strip(),
                        'make_version':subprocess.check_output(['make','--version'],text=True).splitlines()[0]},
        'signing':'unsigned; no publisher key used locally'}
record['trust_scope']='Local provenance from a mutable build cache; not an independent build attestation.'
(out/'BUILD-SOURCE.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
with (out/'SHA256SUMS').open('w') as sums:
    for path in sorted((out/'packages').glob('*.apk'))+[out/'BUILD-SOURCE.json',out/'SDK-PROVENANCE.json']:
        sums.write(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+str(path.relative_to(out))+'\n')
print(json.dumps(record,indent=2))
PY
printf 'Unsigned packages and provenance ready: %s\n' "$out"
