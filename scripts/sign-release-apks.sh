#!/usr/bin/env bash
# Entry point for an approved repository Actions secret. Never generates keys.
set +x
set -euo pipefail
umask 077
if [[ $# -ne 4 ]]; then
  echo "Usage: $0 APK THEME.apk DASHBOARD.apk NEW_OUTPUT_DIR" >&2; exit 2
fi
[[ -n ${NOVA_APK_SIGNING_KEY:-} ]] || {
  echo 'Missing repository secret NOVA_APK_SIGNING_KEY; refusing unsigned release.' >&2; exit 2;
}
expected=${NOVA_APK_SIGNING_PUBLIC_KEY_SHA256:-}
[[ $expected =~ ^[[:xdigit:]]{64}$ ]] || {
  echo 'Missing/invalid repository variable NOVA_APK_SIGNING_PUBLIC_KEY_SHA256.' >&2; exit 2;
}
base=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nova-release-key.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$NOVA_APK_SIGNING_KEY" > "$work/input.pem"
unset NOVA_APK_SIGNING_KEY
# Empty passphrase makes encrypted/invalid input fail instead of prompting.
openssl pkey -in "$work/input.pem" -passin pass: -out "$work/private.pem"
rm -f -- "$work/input.pem"
openssl pkey -in "$work/private.pem" -passin pass: -pubout -out "$work/public.pem"
openssl pkey -pubin -in "$work/public.pem" -outform DER > "$work/public.der"
actual=$(sha256sum "$work/public.der" | cut -d ' ' -f 1)
[[ $actual == "${expected,,}" ]] || {
  echo 'Signing key does not match the reviewed public-key fingerprint.' >&2; exit 2;
}
openssl pkey -pubin -in "$work/public.pem" -text -noout | grep -q 'NIST CURVE: P-256' || {
  echo 'Signing key must be ECDSA P-256.' >&2; exit 2;
}
bash "$base/sign-apks.sh" "$1" "$work/private.pem" "$work/public.pem" "$4" "$2" "$3"
# The trap removes the private key before any later artifact-upload step.
