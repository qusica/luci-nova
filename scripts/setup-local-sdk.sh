#!/usr/bin/env bash
# Cache one authenticated SDK; normal iterations never download it again.
set -euo pipefail
umask 022
[[ $# -eq 1 ]] || { echo 'Usage: setup-local-sdk.sh CACHE_DIRECTORY' >&2; exit 2; }
mkdir -p "$1"
cache=$(realpath "$1")
exec 9>"$cache/sdk.lock"
flock 9
name=openwrt-sdk-25.12.6-x86-64_gcc-14.3.0_musl.Linux-x86_64.tar.zst
expected=1864152619092e781fa36a401960c8e9ae42d6a364c44ee5f0b197ca5f3c0fcc
base=https://downloads.openwrt.org/releases/25.12.6/targets/x86/64
mkdir -p "$cache/downloads" "$cache/verification/gnupg" "$cache/feeds"
chmod 700 "$cache/verification/gnupg"
fetch() {
    local url=$1 destination=$2
    curl --fail --location --retry 2 --retry-delay 2 --connect-timeout 20 \
        --max-time 900 --speed-limit 10240 --speed-time 45 "$url" -o "$destination.part"
    mv "$destination.part" "$destination"
}
for file in sha256sums sha256sums.asc feeds.buildinfo; do
    [[ -f "$cache/downloads/$file" ]] || fetch "$base/$file" "$cache/downloads/$file"
done
key="$cache/verification/0x1D53D1877742E911.asc"
[[ -f $key ]] || fetch \
    https://raw.githubusercontent.com/openwrt/docker/333c887910922b3254590da704ac2876ec212ef4/keys/0x1D53D1877742E911.asc "$key"
gpg --batch --no-options --homedir "$cache/verification/gnupg" --yes \
    --output "$cache/verification/release-keyring.gpg" --dearmor "$key"
gpg --batch --no-options --homedir "$cache/verification/gnupg" --no-default-keyring \
    --keyring "$cache/verification/release-keyring.gpg" --status-fd=1 \
    --verify "$cache/downloads/sha256sums.asc" "$cache/downloads/sha256sums" \
    >"$cache/verification/manifest-verification.log" 2>&1
grep -q '^\[GNUPG:\] VALIDSIG 92C561DE55AE6552F3C736B82B0151090606D1D9 .* 8A8BC12F46B836C0F9CDB36F1D53D1877742E911$' \
    "$cache/verification/manifest-verification.log"
grep -Fx "$expected *$name" "$cache/downloads/sha256sums" >/dev/null
(
    cd "$cache/downloads"
    grep -F '*feeds.buildinfo' sha256sums | sha256sum -c -
)
[[ -f "$cache/downloads/$name" ]] || fetch "$base/$name" "$cache/downloads/$name"
printf '%s  %s\n' "$expected" "$cache/downloads/$name" | sha256sum -c -
if [[ ! -d "$cache/sdk" ]]; then
    stage=$(mktemp -d "$cache/sdk-extract.XXXXXXXX")
    trap 'rm -rf "$stage"' EXIT
    tar --zstd -xf "$cache/downloads/$name" --strip-components=1 --no-same-owner -C "$stage"
    mv "$stage" "$cache/sdk"
    trap - EXIT
fi
# Pins come from the signed release's feeds.buildinfo, verified above.
for spec in 'base:64900e756efa667774214f9c6b17c113222e01f7' 'packages:093d551675b1119a06ef224d419905e8d6b2af1a' 'luci:75a306df84a020c57a631ef5b4c02ace56d93387'; do
    feed=${spec%%:*}; commit=${spec#*:}
    repo=$feed
    if [[ $feed == base ]]; then
        grep -Eq "^src-git --root=package base .*\^$commit$" "$cache/sdk/feeds.conf.default"
        repo=openwrt
    else
        grep -Eq "^src-git $feed .*\^$commit$" "$cache/downloads/feeds.buildinfo"
    fi
    if [[ ! -d "$cache/feeds/$feed/.git" ]]; then
        git init -q "$cache/feeds/$feed"
        git -C "$cache/feeds/$feed" remote add origin "https://github.com/openwrt/$repo.git"
    fi
    git -C "$cache/feeds/$feed" cat-file -e "$commit^{commit}" 2>/dev/null || \
        git -C "$cache/feeds/$feed" fetch --depth=1 origin "$commit"
    git -C "$cache/feeds/$feed" diff --quiet
    git -C "$cache/feeds/$feed" diff --cached --quiet
    [[ -z $(git -C "$cache/feeds/$feed" ls-files --others --exclude-standard) ]] || { echo "Unexpected untracked files in $feed feed" >&2; exit 1; }
    git -C "$cache/feeds/$feed" checkout -q --detach "$commit"
done
python3 - "$cache" "$expected" <<'PY'
import json, pathlib, sys
cache=pathlib.Path(sys.argv[1])
metadata={'openwrt':'25.12.6','target':'x86/64','sdk_sha256':sys.argv[2],
          'release_primary_fingerprint':'8A8BC12F46B836C0F9CDB36F1D53D1877742E911',
          'feeds':{'base':'64900e756efa667774214f9c6b17c113222e01f7','packages':'093d551675b1119a06ef224d419905e8d6b2af1a','luci':'75a306df84a020c57a631ef5b4c02ace56d93387'}}
(cache/'sdk-provenance.json').write_text(json.dumps(metadata,indent=2)+'\n')
PY
printf 'SDK ready: %s\n' "$cache/sdk"
