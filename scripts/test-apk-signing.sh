#!/usr/bin/env bash
# Test-only keys are deleted on exit. Output must never be used as a release.
set -euo pipefail
umask 077
if [[ $# -ne 3 ]]; then
  echo "Usage: $0 APK THEME.apk NEW_OUTPUT_DIR" >&2; exit 2
fi
apk=$(realpath "$1")
theme=$(realpath "$2")
out=$3
[[ ! -e $out && ! -L $out ]]
base=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/trust" "$work/wrong-trust" "$work/empty"
openssl ecparam -name prime256v1 -genkey -noout -out "$work/test-private.pem"
openssl pkey -in "$work/test-private.pem" -pubout -out "$work/trust/test.pem"
openssl ecparam -name prime256v1 -genkey -noout -out "$work/wrong-private.pem"
openssl pkey -in "$work/wrong-private.pem" -pubout -out "$work/wrong-trust/wrong.pem"
bash "$base/sign-apks.sh" "$apk" "$work/test-private.pem" "$work/trust/test.pem" \
  "$out" "$theme"
expect_reject() {
  local label=$1; shift
  if "$@" > "$work/rejection.log" 2>&1; then
    echo "FAIL: $label unexpectedly passed" >&2; exit 1
  fi
  printf 'PASS: %s rejected\n' "$label"
}
for source in "$theme"; do
  package="$out/$(basename "$source")"
  APK_CONFIG=/dev/null "$apk" --keys-dir "$work/trust" verify "$package"
  echo "PASS: $(basename "$package") trusted signature accepted"
  expect_reject 'original unsigned/untrusted package' env APK_CONFIG=/dev/null \
    "$apk" --keys-dir "$work/trust" verify "$source"
  expect_reject 'no trusted key' env APK_CONFIG=/dev/null \
    "$apk" --keys-dir "$work/empty" verify "$package"
  expect_reject 'wrong trusted key' env APK_CONFIG=/dev/null \
    "$apk" --keys-dir "$work/wrong-trust" verify "$package"
  python3 - "$package" "$work/tampered.apk" <<'PY'
import pathlib, sys
data = bytearray(pathlib.Path(sys.argv[1]).read_bytes())
data[len(data) // 2] ^= 1
pathlib.Path(sys.argv[2]).write_bytes(data)
PY
  expect_reject 'tampered package' env APK_CONFIG=/dev/null \
    "$apk" --keys-dir "$work/trust" verify "$work/tampered.apk"
done
expect_reject 'mismatched key pair' bash "$base/sign-apks.sh" "$apk" \
  "$work/test-private.pem" "$work/wrong-trust/wrong.pem" "$work/bad-output" "$theme"
[[ ! -e $work/bad-output ]]
expect_reject 'existing output directory' bash "$base/sign-apks.sh" "$apk" \
  "$work/test-private.pem" "$work/trust/test.pem" "$out" "$theme"
cat "$work/trust/test.pem" "$work/test-private.pem" > "$work/concatenated.pem"
bash "$base/sign-apks.sh" "$apk" "$work/test-private.pem" "$work/concatenated.pem" \
  "$work/normalized-output" "$theme"
cmp -s "$work/trust/test.pem" "$work/normalized-output/nova-signing-public.pem"
if grep -q 'PRIVATE KEY' "$work/normalized-output/nova-signing-public.pem"; then
  echo 'FAIL: private key material appeared in public output' >&2; exit 1
fi
echo 'PASS: public output strips concatenated private-key material'
cp "$theme" "$work/luci-theme-nova-wrong.apk"
expect_reject 'package filename/metadata mismatch' bash "$base/sign-apks.sh" "$apk" \
  "$work/test-private.pem" "$work/trust/test.pem" "$work/wrong-metadata" \
  "$work/luci-theme-nova-wrong.apk"
expect_reject 'missing release signing secret' env -u NOVA_APK_SIGNING_KEY \
  bash "$base/sign-release-apks.sh" "$apk" "$theme" "$work/missing-secret"
mkdir "$work/runner"
fingerprint=$(openssl pkey -pubin -in "$work/trust/test.pem" -outform DER | sha256sum | cut -d ' ' -f 1)
NOVA_APK_SIGNING_KEY=$(cat "$work/test-private.pem") \
NOVA_APK_SIGNING_PUBLIC_KEY_SHA256="$fingerprint" RUNNER_TEMP="$work/runner" \
  bash "$base/sign-release-apks.sh" "$apk" "$theme" "$work/release-output"
echo 'PASS: release wrapper accepts the reviewed disposable key'
expect_reject 'wrong release signing fingerprint' env \
  NOVA_APK_SIGNING_KEY="$(cat "$work/test-private.pem")" \
  NOVA_APK_SIGNING_PUBLIC_KEY_SHA256="$(printf '%064d' 0)" RUNNER_TEMP="$work/runner" \
  bash "$base/sign-release-apks.sh" "$apk" "$theme" "$work/wrong-fingerprint"
test -z "$(find "$work/runner" -mindepth 1 -print -quit)"
echo 'PASS: release wrapper removes temporary key files on success and failure'
printf '%s\n' 'TEST ONLY. Ephemeral private key deleted after this run.' \
  'Do not install this public key on a production router.' > "$out/TEST-ONLY.txt"
echo 'PASS: all signing tests; temporary private keys removed on exit'
