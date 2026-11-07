#!/usr/bin/env python3
"""Check APK header bytes, allowing only five fixed SDK version insertions."""
from pathlib import Path
import sys

VERSION = b'0.2.9'
URLS = (
    b'"{{ media }}/cascade.css"',
    b'"{{ media }}/nova-lists.css"',
    b'"{{ resource }}/cbi.js"',
    b'"{{ media }}/nova-shell.js"',
    b'"{{ media }}/nova-lists.js"',
)


def expected_header(source):
    if not 0 < len(source) < 100_000:
        raise ValueError('Invalid reviewed header size')
    expected = source
    for url in URLS:
        if source.count(url) != 1:
            raise ValueError('Each reviewed versioned URL must occur exactly once')
        expected = expected.replace(url, url[:-1] + b'?v=' + VERSION + b'"')
    markers = (b'href="/luci-static/bootstrap/cascade.css"',
               b'href="/luci-static/bootstrap/mobile.css"',
               b'href="{{ media }}/cascade.css"')
    if any(source.count(marker) != 1 for marker in markers):
        raise ValueError('Missing or duplicated stylesheet-order marker')
    offsets = [source.index(marker) for marker in markers]
    if offsets != sorted(offsets):
        raise ValueError('Bootstrap cascade/mobile must precede Nova')
    return expected


def verify_header(source, actual):
    if actual != expected_header(source):
        raise ValueError('Packaged header differs beyond fixed SDK version insertions')


def main():
    if len(sys.argv) != 3:
        raise ValueError('Usage: check-packaged-header.py REVIEWED_SOURCE ACTUAL_APK_HEADER')
    paths = [Path(arg) for arg in sys.argv[1:]]
    if any(not path.is_file() or path.is_symlink() for path in paths):
        raise ValueError('Header inputs must be regular files')
    verify_header(*(path.read_bytes() for path in paths))
    print('Actual packaged header matches source with only five fixed SDK version insertions; stylesheet order verified')


if __name__ == '__main__':
    main()
