#!/usr/bin/env python3
"""One approved local APK pair, staged as data. This script never handles keys."""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPO = 'qusica/luci-nova'
REPO_ID = 1444409206
BRANCH = 'ci/sign-nova-0.2.6-local-test-2'
WORKFLOW = '.github/workflows/local-apk-test.yml'
SOURCE_SHA = 'afec1de3e10b0012b82b51f3a3eb40b7218bea7e'
SOURCE_TREE = 'edd7fc05e31f7afc35080989ac18f55cf6eaa2ab'
TRUSTED_SHA = 'beaf5c7557b153f7e2b7ca3c7907a8b26a88890b'
KEY_SHA256 = '1475de2470b41a6c99263996ebc44b393bdf385d3639991514563d5c89054140'
VERSION = '0.2.6-r1'
# Fill these only after validating the actual local output and build provenance.
MANIFEST_SHA256 = '4b2d8418f40de6785dd01541c3010c68d04a2d0af5dcaef674fd17f0cb58e01f'
PACKAGE_SHA256 = {
    'luci-theme-nova-0.2.6-r1.apk': '1172051ae7fdc73194edade208f789ac5128665e04b241c17057a79c1f30834d',
    'luci-app-nova-dashboard-0.2.6-r1.apk': '1f6e83f934d4094d0672db712827863ddfe72cbe1c7bbf3ddffebfa018387266',
}
LIMIT = 2_000_000


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def api(path):
    return json.loads(subprocess.run(['gh', 'api', f'repos/{REPO}/{path}'],
                                    check=True, stdout=subprocess.PIPE).stdout)


def validate_pins():
    for value in [MANIFEST_SHA256, *PACKAGE_SHA256.values()]:
        require(re.fullmatch('[0-9a-f]{64}', value or ''), 'Unreviewed local input pins')


def validate_context(env, history, source):
    require(env.get('GITHUB_REPOSITORY') == REPO, 'Wrong repository')
    require(env.get('GITHUB_REF') == 'refs/heads/' + BRANCH, 'Wrong intake branch')
    require(env.get('GITHUB_EVENT_NAME') == 'push', 'Only the approved push entry is allowed')
    require(env.get('GITHUB_RUN_ATTEMPT') == '1', 'Reruns are forbidden')
    require(env.get('GITHUB_WORKFLOW_REF') == f'{REPO}/{WORKFLOW}@refs/heads/{BRANCH}',
            'Wrong workflow')
    require(re.fullmatch('[0-9a-f]{40}', env.get('GITHUB_SHA', '')), 'Invalid intake commit')
    require(re.fullmatch('[0-9]+', env.get('GITHUB_RUN_ID', '')), 'Invalid run ID')
    runs = history.get('workflow_runs', [])
    # Every prior run consumes this entry, even if it failed before uploading.
    require(history.get('total_count') == 1 and len(runs) == 1,
            'One-time entry consumed or incomplete history')
    run = runs[0]
    require(str(run.get('id')) == env['GITHUB_RUN_ID'] and
            run.get('head_sha') == env['GITHUB_SHA'] and run.get('head_branch') == BRANCH and
            run.get('event') == 'push' and run.get('path') == WORKFLOW and
            run.get('run_attempt') == 1, 'Run identity mismatch')
    for field in ('repository', 'head_repository'):
        repo = run.get(field, {})
        require(repo.get('id') == REPO_ID and repo.get('full_name') == REPO and
                repo.get('fork') is False, 'Fork or repository mismatch')
    require(source.get('sha') == SOURCE_SHA and
            source.get('commit', {}).get('tree', {}).get('sha') == SOURCE_TREE,
            'Source commit or tree mismatch')


def read_regular(path, maximum=LIMIT):
    require(path.is_file() and not path.is_symlink(), 'Missing regular input file')
    require(0 < path.stat().st_size <= maximum, 'Input size outside bound')
    return path.read_bytes()


def read_manifest(inputs):
    data = read_regular(inputs / 'manifest.json', 100_000)
    require(digest(data) == MANIFEST_SHA256, 'Local manifest digest mismatch')
    manifest = json.loads(data)
    require(isinstance(manifest, dict) and manifest.get('source_commit') == SOURCE_SHA and
            manifest.get('source_tree') == SOURCE_TREE,
            'Local manifest source mismatch')
    return manifest


def provenance(env, manifest):
    return {
        'purpose': 'DEVELOPMENT-TEST ONLY; local build, not a release',
        'repository': REPO, 'source_commit': SOURCE_SHA, 'source_tree': SOURCE_TREE,
        'package_version': VERSION, 'local_manifest_sha256': MANIFEST_SHA256,
        'local_build': manifest, 'unsigned_sha256': PACKAGE_SHA256,
        'trusted_signing_commit': TRUSTED_SHA, 'expected_public_key_sha256': KEY_SHA256,
        'signing_run': env['GITHUB_RUN_ID'], 'signing_commit': env['GITHUB_SHA'],
        'signing_ref': env['GITHUB_REF'],
        'validation': 'Exact APK bytes must pass packaged Node and Chrome tests in a separate no-secret job',
    }


def stage(inputs, destination, env):
    require(inputs.is_dir() and not inputs.is_symlink(), 'Invalid input directory')
    expected = {'manifest.json', *(name + '.base64' for name in PACKAGE_SHA256)}
    require({p.name for p in inputs.iterdir()} == expected, 'Unexpected intake file set')
    manifest = read_manifest(inputs)
    decoded = {}
    for name, expected_hash in PACKAGE_SHA256.items():
        encoded = read_regular(inputs / (name + '.base64'))
        # The transport is canonical single-line base64 with one final LF.
        require(encoded.endswith(b'\n') and b'\n' not in encoded[:-1], 'Noncanonical base64 transport')
        try:
            data = base64.b64decode(encoded[:-1], validate=True)
        except binascii.Error as error:
            raise ValueError('Invalid base64 transport') from error
        require(base64.b64encode(data) + b'\n' == encoded, 'Noncanonical base64 encoding')
        require(0 < len(data) <= LIMIT and digest(data) == expected_hash, 'Package digest mismatch')
        decoded[name] = data
    require(not destination.exists() and not destination.is_symlink(), 'Staging directory exists')
    destination.mkdir(parents=True)
    for name, data in decoded.items():
        (destination / name).write_bytes(data)
    (destination / 'BUILD-SOURCE.json').write_text(
        json.dumps(provenance(env, manifest), indent=2, sort_keys=True) + '\n')


def verify(inputs, destination, env):
    require(destination.is_dir() and not destination.is_symlink(), 'Invalid validated directory')
    require({p.name for p in destination.iterdir()} == {*PACKAGE_SHA256, 'BUILD-SOURCE.json'},
            'Unexpected validated file set')
    for name, expected_hash in PACKAGE_SHA256.items():
        require(digest(read_regular(destination / name)) == expected_hash,
                'Validated package differs from approved local bytes')
    manifest = read_manifest(inputs)
    actual = json.loads(read_regular(destination / 'BUILD-SOURCE.json', 200_000))
    require(actual == provenance(env, manifest), 'Validated provenance differs from approved input')


def main():
    require(len(sys.argv) == 4 and sys.argv[1] in ('stage', 'verify'), 'Expected stage|verify INPUT DESTINATION')
    validate_pins()
    env = os.environ
    # Use the complete repository collection, filtered to this exact branch.
    history = api('actions/runs?branch=' + BRANCH + '&event=push&per_page=100')
    source = api('commits/' + SOURCE_SHA)
    validate_context(env, history, source)
    operation = stage if sys.argv[1] == 'stage' else verify
    operation(Path(sys.argv[2]), Path(sys.argv[3]), env)


if __name__ == '__main__':
    main()
