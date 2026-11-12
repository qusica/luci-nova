#!/usr/bin/env bash
# Build OpenWrt 24.10's pinned opkg and a pinned official libubox in a new directory.
# Requires CMake 3.x, a C compiler, make, pkg-config and git. No system install.
set -euo pipefail
[[ $# -eq 1 ]] || { echo "Usage: $0 NEW_BUILD_DIRECTORY" >&2; exit 2; }
[[ ! -e $1 && ! -L $1 ]]
mkdir -p "$1"; out=$(realpath "$1")
opkg_rev=38eccbb1fd694d4798ac1baf88f9ba83d1eac616
ubox_rev=3868f47c8f6c6570e62a3cdf8a7f26ffb1a67e6a
for project in opkg-lede libubox; do
    git clone "https://git.openwrt.org/project/$project.git" "$out/$project"
done
git -C "$out/opkg-lede" checkout --detach "$opkg_rev"
git -C "$out/libubox" checkout --detach "$ubox_rev"
cmake -S "$out/libubox" -B "$out/ubox-build" -DBUILD_LUA=OFF -DBUILD_EXAMPLES=OFF
cmake --build "$out/ubox-build" --target ubox-static -j2
mkdir -p "$out/prefix/include/libubox" "$out/prefix/lib"
cp "$out/libubox/"*.h "$out/prefix/include/libubox/"
cp "$out/ubox-build/libubox.a" "$out/prefix/lib/"
cmake -S "$out/opkg-lede" -B "$out/build" \
    -DCMAKE_PREFIX_PATH="$out/prefix" -DCMAKE_C_FLAGS="-I$out/prefix/include" \
    -DBUILD_TESTS=OFF -DSTATIC_UBOX=ON -DVERSION="24.10-$opkg_rev"
cmake --build "$out/build" -j2
"$out/build/src/opkg-cl" --version
