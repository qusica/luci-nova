#!/usr/bin/env bash
# Build the exact upstream version used by OpenWrt 25.12, outside the checkout.
set -euo pipefail
[[ $# -eq 1 ]] || { echo "Usage: $0 NEW_BUILD_DIRECTORY" >&2; exit 2; }
out=$1
[[ ! -e $out && ! -L $out ]]
mkdir -p "$out"
out=$(realpath "$out")
commit=b5a31c0d865342ad80be10d68f1bb3d3ad9b0866
archive="$out/apk-tools.tar.gz"
curl --fail --location --retry 3 \
  "https://codeload.github.com/alpinelinux/apk-tools/tar.gz/$commit" -o "$archive"
printf '%s  %s\n' 598056e338fa96af030b0f6f2127cc7df151e6f078b0e44a5cae95cc4bba1f79 \
  "$archive" | sha256sum -c -
tar -xzf "$archive" -C "$out"
meson setup "$out/build" "$out/apk-tools-$commit" \
  -Ddocs=disabled -Dhelp=disabled -Dlua=disabled -Dpython=disabled \
  -Dtests=disabled -Dzstd=enabled
ninja -C "$out/build" src/apk
"$out/build/src/apk" --version
