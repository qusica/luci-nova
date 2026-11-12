#!/usr/bin/env bash
# Real opkg solver/payload tests in disposable offline roots; hooks never run.
# Optional legacy inputs default to explicitly synthetic fixtures.
# Only native OpenWrt tar-format IPKs are accepted. Inputs are never modified.
set -euo pipefail
[[ $# -eq 3 || $# -eq 5 ]] || { echo "Usage: $0 OPKG THEME.ipk NEW_STAGE [OLD_THEME.ipk OLD_DASHBOARD.ipk]" >&2; exit 2; }
[[ ! -e $3 && ! -L $3 ]] || { echo 'NEW_STAGE already exists' >&2; exit 2; }
mkdir -p "$3"
stage=$(realpath "$3")
exec > >(tee "$stage/results.log") 2>&1
python3 - "$1" "$2" "$stage" "${@:4}" <<'PY'
import hashlib, io, pathlib, subprocess, sys, tarfile
opkg, theme, stage, *legacy_paths = map(lambda p: pathlib.Path(p).resolve(), sys.argv[1:])
(stage / "var/lock").mkdir(parents=True)
(stage / "tmp").mkdir()

def entries(blob):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as tar:
        total = 0
        for item in tar:
            path = pathlib.PurePosixPath(item.name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in item.name
            assert item.isfile() or item.isdir(), f'Unsupported entry {item.name}'
            assert str(path) not in result and len(result) < 10000
            total += item.size
            assert total <= 64 * 1024 * 1024
            result[str(path)] = tar.extractfile(item).read() if item.isfile() else None
    return result

def read_ipk(path):
    assert path.stat().st_size < 32 * 1024 * 1024
    outer = entries(path.read_bytes())
    assert set(outer) - {'.'} == {'debian-binary', 'control.tar.gz', 'data.tar.gz'}
    assert outer['debian-binary'] == b'2.0\n'
    control = entries(outer['control.tar.gz'])
    meta = {}
    for line in control['control'].decode().splitlines():
        if line and not line[0].isspace():
            key, sep, value = line.partition(':')
            assert sep and key not in meta
            meta[key] = value.strip()
    return meta, {name: data for name, data in entries(outer['data.tar.gz']).items() if data is not None}

def tar_bytes(files):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as archive:
        directories = {str(parent) for name in files for parent in pathlib.PurePosixPath(name).parents if str(parent) != '.'}
        for name in sorted(directories, key=lambda value: (value.count('/'), value)):
            info = tarfile.TarInfo('./' + name); info.type = tarfile.DIRTYPE; info.mode = 0o755
            archive.addfile(info)
        for name, data in files.items():
            info = tarfile.TarInfo('./' + name); info.size = len(data); info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
    return out.getvalue()


def write_ipk(path, name, dependencies, files):
    control = f'Package: {name}\nVersion: 0.2.12-r1\nArchitecture: all\nDepends: {dependencies}\nDescription: SYNTHETIC legacy test fixture, not SDK output\n'.encode()
    path.write_bytes(tar_bytes({'debian-binary': b'2.0\n', 'control.tar.gz': tar_bytes({'control': control}), 'data.tar.gz': tar_bytes(files)}))

if legacy_paths:
    old_theme, old_dash = legacy_paths
    print('Upgrade coverage: caller-supplied legacy IPKs (hashes below).', flush=True)
else:
    print('Upgrade coverage: SYNTHETIC legacy metadata and representative payloads, not historical SDK artifacts.', flush=True)
    old_theme, old_dash = stage / 'synthetic-old-theme.ipk', stage / 'synthetic-old-dashboard.ipk'
    write_ipk(old_theme, 'luci-theme-nova', 'luci-base, luci-theme-bootstrap', {
        'www/luci-static/nova/nova-shell.js': b'synthetic old theme\n',
        'usr/share/ucode/luci/template/themes/nova/header.ut': b'synthetic old header\n',
    })
    write_ipk(old_dash, 'luci-app-nova-dashboard', 'luci-base', {
        'www/luci-static/resources/view/nova/dashboard.js': b'synthetic old dashboard\n',
        'usr/share/rpcd/acl.d/luci-app-nova-dashboard.json': b'{}\n',
        'usr/share/luci/menu.d/luci-app-nova-dashboard.json': b'{}\n',
        'usr/lib/lua/luci/i18n/nova-dashboard.zh-cn.lmo': b'synthetic translation\n',
    })

new, payload = read_ipk(theme)
old, _ = read_ipk(old_theme)
dash, _ = read_ipk(old_dash)
assert new['Package'] == old['Package'] == 'luci-theme-nova'
assert dash['Package'] == 'luci-app-nova-dashboard'
assert new['Conflicts'] == 'luci-app-nova-dashboard' and not new.get('Replaces')
for meta in (new, old, dash):
    assert meta['Architecture'] == 'all'
    deps = {v.strip() for v in meta.get('Depends', '').split(',') if v.strip()}
    assert deps <= {'libc', 'luci-base', 'luci-theme-bootstrap'}, deps
    assert 'luci-base' in deps
subprocess.run([str(opkg), '-f', '/dev/null', '--offline-root', str(stage), 'compare-versions', old['Version'], '<', new['Version']], check=True)
subprocess.run([str(opkg), '--version'], check=True)
print('Input artifacts (caller must identify SDK versus synthetic provenance):', flush=True)
for path in (theme, old_theme, old_dash):
    print(hashlib.sha256(path.read_bytes()).hexdigest(), path, flush=True)
for required in ('www/luci-static/nova/nova-shell.js', 'www/luci-static/resources/view/nova/dashboard.js', 'usr/share/rpcd/acl.d/luci-app-nova-dashboard.json', 'usr/share/luci/menu.d/luci-app-nova-dashboard.json'):
    assert required in payload

# Native dependencies are controlled sentinel packages, not router packages.

sentinels = {}
stubs = []
for name, file in [('libc', 'usr/lib/nova-test-libc'), ('luci-base', 'www/luci-static/resources/view/status/include/10_system.js'), ('luci-theme-bootstrap', 'usr/share/ucode/luci/template/themes/bootstrap/header.ut')]:
    sentinels[file] = (name + '\n').encode()
    control = f'Package: {name}\nVersion: 1\nArchitecture: all\nDescription: Offline test sentinel\n'.encode()
    path = stage / (name + '.ipk')
    path.write_bytes(tar_bytes({'debian-binary': b'2.0\n', 'control.tar.gz': tar_bytes({'control': control}), 'data.tar.gz': tar_bytes({file: sentinels[file]})}))
    stubs.append(path)
config = stage / 'opkg.conf'
config.write_text('arch all 100\ndest root /\n')  # No feeds: cannot fetch packages.

def run(root, *args, fail=False):
    command = [str(opkg), '-f', str(config), '--offline-root', str(root), '--tmp-dir', str(stage / 'tmp'), *map(str, args)]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print('+', ' '.join(command), '\n' + result.stdout, flush=True)
    assert (result.returncode != 0) if fail else (result.returncode == 0), result.stdout
    return result.stdout

def init(name):
    root = stage / name
    (root / 'var/lock').mkdir(parents=True)
    run(root, 'install', *stubs)
    return root

def installed(root, name, version=None):
    text = run(root, 'list-installed')
    return (f'{name} - {version}' in text.splitlines()) if version else any(line.startswith(name + ' - ') for line in text.splitlines())

def native(root):
    for name in ('libc', 'luci-base', 'luci-theme-bootstrap'):
        assert installed(root, name, '1')
    for file, data in sentinels.items():
        assert (root / file).read_bytes() == data

def matches(root):
    assert installed(root, 'luci-theme-nova', new['Version'])
    assert not installed(root, 'luci-app-nova-dashboard')
    for file, data in payload.items():
        assert (root / file).read_bytes() == data, file
    native(root)

def snapshot(root):
    # opkg may rewrite status formatting even on a refused transaction.
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file() and '/usr/lib/opkg/' not in str(p) and '/var/lock/' not in str(p)}

clean = init('clean'); run(clean, 'install', theme); matches(clean)
before = snapshot(clean)
assert 'luci-app-nova-dashboard' in run(clean, 'install', old_dash, fail=True)
assert snapshot(clean) == before
matches(clean)
legacy = init('legacy'); run(legacy, 'install', old_theme, old_dash)
before = snapshot(legacy)
assert 'luci-app-nova-dashboard' in run(legacy, 'install', theme, fail=True)
assert snapshot(legacy) == before
assert installed(legacy, 'luci-theme-nova', old['Version'])
assert installed(legacy, 'luci-app-nova-dashboard', dash['Version'])
run(legacy, 'remove', 'luci-app-nova-dashboard')
assert not installed(legacy, 'luci-app-nova-dashboard')
native(legacy)
run(legacy, 'install', theme); matches(legacy)
upgrade = init('theme-upgrade'); run(upgrade, 'install', old_theme); run(upgrade, 'install', theme); matches(upgrade)
run(legacy, 'remove', 'luci-theme-nova')
assert not installed(legacy, 'luci-theme-nova')
for file in payload:
    assert not (legacy / file).exists(), file
native(legacy)
print('PASS: clean install, both conflict directions, removal-first migration, theme upgrade, uninstall, native payload preservation.')
print('Scope: real opkg solver and payloads; dependencies are stubs. Offline mode skips hooks. No services, UCI or router/UI runtime tested.')
PY
