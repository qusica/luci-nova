#!/usr/bin/env bash
# Validate OpenWrt 24.10 IPKs as data only. Never install or execute package hooks.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'Usage: test-built-ipks.sh THEME.ipk NEW_STAGE' >&2; exit 2; }
theme=$(realpath "$1")
stage=$2
base=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $theme ]]
[[ ! -e $stage && ! -L $stage ]]
mkdir -p "$stage"
stage=$(realpath "$stage")
python3 - "$base" "$stage" "$theme" <<'PY'
import io
import pathlib
import re
import sys
import tarfile

base, stage, *packages = map(pathlib.Path, sys.argv[1:])


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def safe_name(name):
    path = pathlib.PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
            f'Unsafe archive path: {name!r}')
    return str(path)


def tar_entries(blob):
    # Reject links (including hard links), devices and duplicates before writing.
    # This architecture-independent package needs only files/directories.
    entries = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as archive:
        for member in archive:
            name = safe_name(member.name)
            require(member.isfile() or member.isdir(), f'Unsupported archive entry: {name}')
            require(name not in entries, f'Duplicate archive entry: {name}')
            require(member.size <= 32 * 1024 * 1024, f'Oversized archive entry: {name}')
            total += member.size
            require(total <= 64 * 1024 * 1024 and len(entries) < 10000,
                    'Package payload exceeds validation limit')
            entries[name] = None if member.isdir() else archive.extractfile(member).read()
    require(sum(len(data) for data in entries.values() if data is not None) <= 64 * 1024 * 1024,
            'Package payload exceeds validation limit')
    return entries


def ipk_entries(file):
    require(file.stat().st_size <= 32 * 1024 * 1024, f'Oversized package: {file}')
    blob = file.read_bytes()
    if not blob.startswith(b'!<arch>\n'):
        return tar_entries(blob)  # Native OpenWrt ipkg-build outer tar.gz.
    entries = {}
    position = 8
    while position < len(blob):
        header = blob[position:position + 60]
        require(len(header) == 60 and header[58:60] == b'`\n', 'Malformed ar header')
        name = safe_name(header[:16].decode('ascii').strip().rstrip('/'))
        require(name and name not in entries, f'Invalid/duplicate ar member: {name}')
        size = int(header[48:58].decode('ascii').strip())
        require(size >= 0 and position + 60 + size <= len(blob), 'Truncated ar member')
        entries[name] = blob[position + 60:position + 60 + size]
        position += 60 + size + size % 2
    require(position == len(blob), 'Malformed ar padding')
    return entries


def unpack(entries, destination):
    destination.mkdir(parents=True)
    for name, data in entries.items():
        target = destination / name
        if data is None:
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(data)


names = ('luci-theme-nova',)
for file, name in zip(packages, names):
    outer = ipk_entries(file)
    require(set(outer) - {'.'} == {'debian-binary', 'control.tar.gz', 'data.tar.gz'},
            f'{name}: unexpected IPK container members')
    require(outer['debian-binary'] == b'2.0\n', f'{name}: invalid debian-binary')
    control = tar_entries(outer['control.tar.gz'])
    require(isinstance(control.get('control'), bytes), f'{name}: missing control metadata')
    metadata = {}
    for line in control['control'].decode('utf-8').splitlines():
        if not line or line[0].isspace():
            continue
        key, separator, value = line.partition(':')
        require(separator and key not in metadata, f'{name}: malformed/duplicate control field')
        metadata[key] = value.strip()
    makefile = (base / name / 'Makefile').read_text()
    version = re.search(r'^PKG_VERSION:=(.+)$', makefile, re.M).group(1).strip()
    release = re.search(r'^PKG_RELEASE:=(.+)$', makefile, re.M).group(1).strip()
    expected = version + '-r' + release
    require(metadata.get('Package') == name, f'{name}: incorrect Package')
    require(metadata.get('Version') == expected, f'{name}: expected Version {expected}')
    require(metadata.get('Architecture') == 'all', f'{name}: expected Architecture all')
    dependencies = set(re.findall(r'(?:^|[,|])\s*([a-zA-Z0-9+_.-]+)', metadata.get('Depends', '')))
    required = {'luci-base'} | ({'luci-theme-bootstrap'} if name == names[0] else set())
    require(dependencies <= required | {'libc'}, f'{name}: unexpected dependencies {dependencies - required - {"libc"}}')
    require(required <= dependencies, f'{name}: missing required dependencies {required - dependencies}')
    require(not dependencies.intersection(names), f'{name}: unexpected Nova package dependency')
    require(metadata.get('Conflicts') == 'luci-app-nova-dashboard', f'{name}: missing legacy dashboard conflict')
    require(not metadata.get('Replaces'), f'{name}: must not force replacement of the old dashboard')
    # Tests read only this single package, so missing dashboard assets cannot hide.
    root = stage / name / 'root'
    unpack(tar_entries(outer['data.tar.gz']), root)
    require((root / 'www').is_dir(), f'{name}: missing www payload')
    (stage / name / 'htdocs').symlink_to(root / 'www', target_is_directory=True)
    unpack(control, stage / 'control' / name)
    print(f'IPK metadata verified: {name} {expected} all; dependencies: {sorted(dependencies)}')

PY
cp -R "$base/tests" "$stage/tests"
# Preserve exact CSS bytes: SDK csstidy can silently corrupt merged rules.
for package in luci-theme-nova; do
    while IFS= read -r -d '' source; do
        relative=${source#"$base/$package/htdocs/"}
        cmp "$source" "$stage/$package/htdocs/$relative"
        printf 'CSS payload matches source: %s\n' "$package/$relative"
    done < <(find "$base/$package/htdocs" -type f -name '*.css' -print0)
done
node --check "$stage/luci-theme-nova/htdocs/luci-static/resources/view/nova/dashboard.js"
node --check "$stage/luci-theme-nova/htdocs/luci-static/nova/nova-shell.js"
node --check "$stage/luci-theme-nova/htdocs/luci-static/nova/nova-lists.js"
node --test "$stage/tests/dashboard.test.js" "$stage/tests/native-lists.test.js" "$stage/tests/navigation.test.js" "$stage/tests/menu-localization.test.js" "$stage/tests/package-integration.test.js"
export XDG_CACHE_HOME="$stage/browser-cache"
mkdir -p "$XDG_CACHE_HOME/fontconfig"
if command -v fc-cache >/dev/null 2>&1; then
    fc-cache
fi
node --test --test-concurrency=1 "$stage/tests/browser-layout.test.js" "$stage/tests/native-lists-browser.test.js" "$stage/tests/navigation-browser.test.js" "$stage/tests/visual-browser.test.js" "$stage/tests/native-spacing-browser.test.js" "$stage/tests/sidebar-overflow-browser.test.js"
