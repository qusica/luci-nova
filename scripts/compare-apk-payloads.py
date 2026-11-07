#!/usr/bin/env python3
"""Compare independently built unsigned APK data/hooks, without running hooks."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile

parser=argparse.ArgumentParser()
parser.add_argument('apk_tool')
parser.add_argument('local_directory')
parser.add_argument('reference_directory')
parser.add_argument('report')
args=parser.parse_args()
tool=str(Path(args.apk_tool).resolve())
local_root=Path(args.local_directory).resolve()
names=[]
for package in ['luci-theme-nova','luci-app-nova-dashboard']:
    matches=list(local_root.glob(package+'-*.apk'))
    assert len(matches)==1, f'Expected exactly one APK for {package}'
    names.append(matches[0].name)
provenance=json.loads((local_root.parent/'BUILD-SOURCE.json').read_text())
results=[]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path, root):
    metadata=json.loads(subprocess.check_output([tool,'adbdump','--format','json',str(path)],text=True))
    for directory in metadata['paths']:
        parent=PurePosixPath(directory.get('name',''))
        assert not parent.is_absolute() and '..' not in parent.parts
        for file in directory.get('files',[]):
            name=PurePosixPath(file['name'])
            assert len(name.parts)==1 and name.name not in ('.','..') and not name.is_absolute()
            assert not any(k in file for k in ('target','device')), 'Only regular Nova files are expected'
    root.mkdir()
    subprocess.run([tool,'extract','--allow-untrusted','--destination',str(root),str(path)],check=True,
                   env={**os.environ,'APK_CONFIG':'/dev/null'},stdout=subprocess.DEVNULL)
    files={}
    for entry in root.rglob('*'):
        assert not entry.is_symlink(), 'Only regular Nova files are expected'
        if entry.is_file():
            files[str(entry.relative_to(root))]={'sha256':sha(entry),'mode':oct(entry.stat().st_mode&0o7777),'size':entry.stat().st_size}
    return metadata,files

with tempfile.TemporaryDirectory(prefix='nova-apk-compare-') as temp:
    for index,name in enumerate(names):
        local=Path(args.local_directory).resolve()/name
        reference=Path(args.reference_directory).resolve()/name
        left,lf=read(local,Path(temp)/f'local-{index}')
        right,rf=read(reference,Path(temp)/f'reference-{index}')
        assert lf==rf, f'Payload contents or modes differ: {name}'
        assert left.get('scripts',{})==right.get('scripts',{}), f'Package hooks differ: {name}'
        ignore={'hashes','origin'}
        li={k:v for k,v in left['info'].items() if k not in ignore}
        ri={k:v for k,v in right['info'].items() if k not in ignore}
        assert li==ri, f'Package metadata differs: {name}'
        def without_mtime(value):
            if isinstance(value,dict):return {k:without_mtime(v) for k,v in value.items() if k!='mtime'}
            if isinstance(value,list):return [without_mtime(v) for v in value]
            return value
        assert without_mtime(left['paths'])==without_mtime(right['paths']), f'Paths/ownership/modes differ: {name}'
        results.append({'name':name,'local_sha256':sha(local),'reference_sha256':sha(reference),
                        'payload_files':lf,'file_count':len(lf),'hooks_equal':True,'package_metadata_equal':True,
                        'path_metadata_equal_except_mtime':True,
                        'permitted_envelope_differences':{'origin':[left['info']['origin'],right['info']['origin']],
                         'content_identifier':[left['info']['hashes'],right['info']['hashes']],
                         'local_file_mtimes':sorted({f['mtime'] for d in left['paths'] for f in d.get('files',[])}),
                         'reference_file_mtimes':sorted({f['mtime'] for d in right['paths'] for f in d.get('files',[])})}})
report={'schema_version':1,'comparison':'all regular file bytes, permissions, ownership, paths, package hooks and operational metadata match',
        'local_source_commit':provenance['source_commit'],
        'source_tree':provenance['source_tree'],
        'packages':results}
Path(args.report).write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
print(json.dumps({'result':'payloads_and_hooks_match','packages':[r['name'] for r in results]},indent=2))
