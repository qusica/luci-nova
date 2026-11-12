#!/usr/bin/env bash
# Sign copies, never the input files. No key generation or router trust changes.
set -euo pipefail
umask 077
if [[ $# -ne 5 ]]; then
  echo "Usage: $0 APK PRIVATE_KEY PUBLIC_KEY NEW_OUTPUT_DIR THEME.apk" >&2
  exit 2
fi
apk=$(realpath "$1")
private=$(realpath "$2")
public=$(realpath "$3")
out=$4
theme=$(realpath "$5")
[[ -x $apk && -f $private && -f $public && -f $theme ]]
[[ ! -e $out && ! -L $out ]] || { echo "Output already exists: $out" >&2; exit 2; }
[[ $(basename "$theme") == luci-theme-nova-*.apk ]]
mkdir -p "$(dirname "$out")"
stage=$(mktemp -d "$(dirname "$out")/.nova-sign.XXXXXXXX")
stage=$(realpath "$stage")
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/trust" "$stage/packages"
APK_CONFIG=/dev/null "$apk" adbdump --format json "$theme" > "$stage/theme.json"
python3 - "$stage/theme.json" "$theme" <<'PYCODE'
import json, pathlib, sys
info = json.loads(pathlib.Path(sys.argv[1]).read_text())['info']
name = 'luci-theme-nova'
if (info.get('name') != name or info.get('arch') != 'noarch'
        or pathlib.Path(sys.argv[2]).name != name + '-' + info['version'] + '.apk'):
    raise SystemExit('Refusing unexpected package metadata: ' + name)
PYCODE
openssl pkey -in "$private" -passin pass: -pubout -outform DER > "$stage/derived.der"
openssl pkey -pubin -in "$public" -outform DER > "$stage/provided.der"
cmp -s "$stage/derived.der" "$stage/provided.der" || {
  echo "Public key does not match private key" >&2; exit 2;
}
# Normalize to a public-only PEM. Never publish a raw supplied PEM file that
# could accidentally contain a concatenated private-key block or extra data.
openssl pkey -pubin -in "$public" -pubout -out "$stage/trust/nova.pem"
for source in "$theme"; do
  target="$stage/packages/$(basename "$source")"
  cp -- "$source" "$target"
  # 3.0.5 adbsign can return zero on a per-file error. One file per invocation,
  # followed by a separate strict verification is mandatory.
  APK_CONFIG=/dev/null "$apk" adbsign --allow-untrusted --reset-signatures \
    --sign-key "$private" "$target"
  APK_CONFIG=/dev/null "$apk" --keys-dir "$stage/trust" verify "$target"
done
cp -- "$stage/trust/nova.pem" "$stage/packages/nova-signing-public.pem"
openssl dgst -sha256 "$stage/provided.der" | sed 's/.*= //' > "$stage/packages/PUBLIC-KEY-SHA256.txt"
(cd "$stage/packages"; sha256sum ./*.apk nova-signing-public.pem > SHA256SUMS)
chmod 755 "$stage/packages"
chmod 644 "$stage/packages/"*
mv -- "$stage/packages" "$out"
echo "Signed and strictly verified the integrated theme package. Output: $out"
