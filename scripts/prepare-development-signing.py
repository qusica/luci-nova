#!/usr/bin/env python3
"""Fail-closed, one-use acquisition of an exact CI artifact. Never handles keys."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import zipfile

REPO = 'qusica/luci-nova'
REPO_ID = 1444409206
BRANCH = 'ci/sign-nova-0.3.0-router-test'
SOURCE_SHA = 'd787e4140993a5f1117bbb11b1ca553a1b2781c6'
SOURCE_MERGE_SHA = 'a0ad25cfd07a999f57da9202b6ad1d0fc7f1122f'
SOURCE_TREE = '27bfee7606a6c175cb75e6f9f6e094390e9fd4e1'
SOURCE_RUN = 43142743051
SOURCE_RUN_ATTEMPT = 2
SOURCE_WORKFLOW = 405820769
SOURCE_BRANCH = 'feat/integrated-dashboard'
TRUSTED_SHA = SOURCE_SHA
EXPECTED_PUBLIC_KEY_SHA256 = '1475de2470b41a6c99263996ebc44b393bdf385d3639991514563d5c89054140'
ARTIFACT_NAME = 'luci-nova-25.12-apk'
# APK artifact was built in attempt 1; overall CI completed in attempt 2.
ARTIFACT_ID = 13909939345
ARTIFACT_DIGEST = 'sha256:0e60008658917d876ba64a4b4186826b430e126e364ceae2abf16e9abd29d20e'
VERSION = '0.3.0-r1'
PACKAGES = ('luci-theme-nova-0.3.0-r1.apk',)
PACKAGE_PATH = 'bin/packages/x86_64/nova/' + PACKAGES[0]
PACKAGE_SHA256 = '61a16c2a5d63798d434c632b3de4c2017a1ed6456868f2fb1420007e278cba06'
SOURCE_TEXT = (f'repository={REPO}\ncommit={SOURCE_MERGE_SHA}\nref=refs/pull/8/merge\n'
               f'sdk=25.12.6\nformat=apk\nrun=https://github.com/{REPO}/actions/runs/{SOURCE_RUN}\n')


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def api(path, binary=False):
    result = subprocess.run(['gh', 'api', f'repos/{REPO}/{path}'],
                            check=True, stdout=subprocess.PIPE)
    return result.stdout if binary else json.loads(result.stdout)


def validate_context(env, history):
    require(env.get('GITHUB_REPOSITORY') == REPO, 'Wrong signing repository')
    require(env.get('GITHUB_REF') == f'refs/heads/{BRANCH}', 'Wrong signing branch')
    require(env.get('GITHUB_EVENT_NAME') == 'push', 'Exact branch push entry only')
    require(env.get('GITHUB_RUN_ATTEMPT') == '1', 'Reruns are forbidden')
    require(env.get('GITHUB_WORKFLOW_REF') ==
            f'{REPO}/.github/workflows/signed-apk.yml@refs/heads/{BRANCH}',
            'Wrong signing workflow')
    # Serialized by workflow concurrency. Reject another successful publication;
    # failed runs can be followed by an explicitly reviewed branch push retry.
    runs = history.get('workflow_runs', [])
    require(history.get('total_count') == len(runs) and 0 < len(runs) < 100,
            'Missing or incomplete signing run history')
    current_runs = [r for r in runs if str(r.get('id')) == env.get('GITHUB_RUN_ID')]
    require(len(current_runs) == 1, 'Current signing run missing or ambiguous')
    current = current_runs[0]
    for previous in runs:
        if previous is current:
            continue
        require(previous.get('status') == 'completed' and
                previous.get('conclusion') in ('failure', 'cancelled', 'skipped', 'timed_out'),
                'Development signing already succeeded or another run is pending')
    require(str(current.get('id')) == env.get('GITHUB_RUN_ID') and
            current.get('head_sha') == env.get('GITHUB_SHA') and
            current.get('head_branch') == BRANCH and
            current.get('event') == 'push' and
            current.get('path') == '.github/workflows/signed-apk.yml',
            'Signing run identity mismatch')


def validate_source(run, listing, commit, merge_commit):
    expected = {'id': SOURCE_RUN, 'head_sha': SOURCE_SHA,
                'head_branch': SOURCE_BRANCH, 'event': 'pull_request',
                'path': '.github/workflows/build.yml',
                'workflow_id': SOURCE_WORKFLOW, 'run_attempt': SOURCE_RUN_ATTEMPT,
                'status': 'completed', 'conclusion': 'success'}
    require(all(run.get(k) == v for k, v in expected.items()),
            'Source run identity/status mismatch')
    for field in ('repository', 'head_repository'):
        repo = run.get(field, {})
        require(repo.get('full_name') == REPO and repo.get('id') == REPO_ID
                and repo.get('fork') is False, 'Fork or wrong source repository')
    require(commit.get('sha') == SOURCE_SHA and
            commit.get('commit', {}).get('tree', {}).get('sha') == SOURCE_TREE,
            'Source tree mismatch')
    require(merge_commit.get('sha') == SOURCE_MERGE_SHA and
            merge_commit.get('commit', {}).get('tree', {}).get('sha') == SOURCE_TREE,
            'Built merge commit must have the exact reviewed source tree')
    require(ARTIFACT_ID > 0 and re.fullmatch(r'sha256:[0-9a-f]{64}', ARTIFACT_DIGEST),
            'Artifact identity must be pinned after CI succeeds')
    artifacts = listing.get('artifacts', [])
    require(listing.get('total_count') == len(artifacts) and len(artifacts) <= 100,
            'Incomplete artifact listing')
    matches = [a for a in artifacts if a.get('name') == ARTIFACT_NAME]
    require(len(matches) == 1, 'Missing or duplicate unsigned artifact')
    artifact = matches[0]
    require(artifact.get('id') == ARTIFACT_ID and
            artifact.get('digest') == ARTIFACT_DIGEST and
            artifact.get('expired') is False and
            0 < artifact.get('size_in_bytes', 0) <= 20_000_000,
            'Artifact identity/expiry/size mismatch')
    source = artifact.get('workflow_run', {})
    require(source.get('id') == SOURCE_RUN and source.get('head_sha') == SOURCE_SHA
            and source.get('head_branch') == SOURCE_BRANCH
            and source.get('repository_id') == REPO_ID
            and source.get('head_repository_id') == REPO_ID,
            'Artifact workflow identity mismatch')
    return artifact


def unpack(data, destination):
    require(len(data) <= 20_000_000, 'Archive too large')
    require('sha256:' + hashlib.sha256(data).hexdigest() == ARTIFACT_DIGEST,
            'Downloaded artifact digest mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        selected = {}
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            require(not path.is_absolute() and '..' not in path.parts
                    and '\\' not in entry.filename, 'Unsafe ZIP path')
            mode = entry.external_attr >> 16
            require(not stat.S_ISLNK(mode), 'ZIP symlink forbidden')
            if entry.is_dir():
                continue
            require(entry.filename in {PACKAGE_PATH, 'package-provenance/BUILD-SOURCE.txt',
                                       'package-provenance/SHA256SUMS'}
                    and entry.filename not in selected
                    and entry.file_size <= 10_000_000, 'Unexpected ZIP member')
            selected[entry.filename] = entry
        require(set(selected) == {PACKAGE_PATH, 'package-provenance/BUILD-SOURCE.txt',
                                  'package-provenance/SHA256SUMS'}, 'Exact artifact members required')
        package = archive.read(selected[PACKAGE_PATH])
        require(hashlib.sha256(package).hexdigest() == PACKAGE_SHA256, 'Package hash mismatch')
        require(archive.read(selected['package-provenance/BUILD-SOURCE.txt']).decode() == SOURCE_TEXT,
                'Source provenance mismatch')
        require(archive.read(selected['package-provenance/SHA256SUMS']).decode() ==
                f'{PACKAGE_SHA256}  {PACKAGE_PATH}\n', 'Source checksum file mismatch')
        destination.mkdir(exist_ok=False)
        (destination / PACKAGES[0]).write_bytes(package)


def main():
    require(len(sys.argv) == 2, 'Expected new staging directory')
    env = os.environ
    history = api('actions/workflows/signed-apk.yml/runs?branch=' + BRANCH +
                  '&event=push&per_page=100')
    validate_context(env, history)
    run = api(f'actions/runs/{SOURCE_RUN}')
    listing = api(f'actions/runs/{SOURCE_RUN}/artifacts?per_page=100')
    commit = api(f'commits/{SOURCE_SHA}')
    merge_commit = api(f'commits/{SOURCE_MERGE_SHA}')
    artifact = validate_source(run, listing, commit, merge_commit)
    data = api(f'actions/artifacts/{ARTIFACT_ID}/zip', binary=True)
    stage = Path(sys.argv[1])
    unpack(data, stage)
    provenance = {
        'purpose': 'DEVELOPMENT-TEST ONLY; not a release',
        'repository': REPO, 'source_commit': SOURCE_SHA, 'source_tree': SOURCE_TREE,
        'built_merge_commit': SOURCE_MERGE_SHA,
        'source_run': SOURCE_RUN, 'source_run_attempt': SOURCE_RUN_ATTEMPT,
        'artifact_built_in_attempt': 1,
        'source_workflow': '.github/workflows/build.yml',
        'artifact_id': artifact['id'], 'artifact_name': ARTIFACT_NAME,
        'artifact_digest': ARTIFACT_DIGEST, 'package_version': VERSION,
        'trusted_signing_commit': TRUSTED_SHA,
        'expected_public_key_sha256': EXPECTED_PUBLIC_KEY_SHA256,
        'signing_run': env['GITHUB_RUN_ID'], 'signing_commit': env['GITHUB_SHA'],
        'signing_ref': env['GITHUB_REF'],
        'unsigned_sha256': {name: hashlib.sha256((stage/name).read_bytes()).hexdigest()
                            for name in PACKAGES},
    }
    (stage / 'BUILD-SOURCE.json').write_text(json.dumps(provenance, indent=2) + '\n')


if __name__ == '__main__':
    main()
