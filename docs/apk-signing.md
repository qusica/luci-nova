# Nova APK signing plan

This branch implements signing but does not configure a production key, publish
a release, alter router trust, or make unsigned CI artifacts safe for LuCI upload.
`TEST-ONLY-*` artifacts and keys are for disposable systems only. Test private
keys are deleted before the script exits.

## Why LuCI rejected the packages

The SDK creates unsigned APK v3 packages. A signed repository index is separate
from a signature embedded in each package. LuCI's upload flow calls
`/usr/libexec/package-manager-call install /tmp/upload.apk`, which maps to
`apk add /tmp/upload.apk` without `--allow-untrusted`. A manually uploaded APK
must carry a valid signature from a key already trusted by that router.

The SDK action's `PRIVATE_KEY` input signs the feed index when enabled; it does
not by itself solve the individual uploaded-package signature requirement.
IPK/opkg uses a different format and usign-signed package indexes. This APK
implementation must not be presented as per-IPK signing.

## Implemented test

`scripts/test-apk-signing.sh APK THEME.apk DASHBOARD.apk NEW_OUTPUT_DIR`

- Creates ECDSA P-256 keys in a temporary directory with restrictive permissions.
- Calls `sign-apks.sh` to sign separate copies of the two packages.
- Uses one `adbsign --allow-untrusted --reset-signatures --sign-key` call per file.
- Independently verifies every signed output with an isolated public-key directory
  and `APK_CONFIG=/dev/null`. Verification never uses `--allow-untrusted`.
- Rejects the original packages, missing/wrong trust, a modified package,
  mismatched private/public keys, and existing output directories.
- Deletes both temporary private keys, retaining only test packages, public key,
  SHA256 checksums, DER public-key SHA256 fingerprint, and a TEST-ONLY notice.
- Serializes only the parsed public key instead of copying raw PEM input, and
  tests that accidentally concatenated private-key material cannot be exported.

OpenWrt 25.12 uses apk-tools 3.0.5. Its `adbsign` may return zero after a file
error and does not reset all state between multiple file arguments. Independent
verification and one-file invocations are therefore required. Key-directory
arguments must be absolute because APK resolves them from its root directory.

`scripts/build-host-apk.sh NEW_BUILD_DIRECTORY` builds upstream commit
`b5a31c0d865342ad80be10d68f1bb3d3ad9b0866`, with the downloaded source archive
also checked against SHA256. CI adds this test after the existing APK build.
Original unsigned artifacts retain their existing names; test-signed artifacts
have a separate explicit TEST-ONLY name. The PR test workflow has no production
secret references.

## GitHub Actions setup

The **Build signed APK packages** workflow runs on main updates and v* tag
pushes. It also supports **Run workflow** on main. Other manually selected
branches, forks and pull requests cannot enter its build/sign jobs. Tags must
point to a commit contained in main. The existing PR build only uses ephemeral
test keys and never references the production secret.

The two jobs run on separate fresh runners. The build job receives no signing
secret. The signing job downloads only the current run's named intermediate
artifact, installs/builds the pinned APK tool, then reads the key in one step.
It checks package metadata, matching versions and reviewed public-key fingerprint,
signs both packages, strictly verifies the results, and removes temporary key
files before uploading the exact public output files. All actions in the signed
workflow use full commit pins. No build cache is restored in the signing job.

Configure these two repository settings only after approval:

- **Settings > Secrets and variables > Actions > Secrets > New repository secret**:
  name `NOVA_APK_SIGNING_KEY`; value is the dedicated ECDSA P-256 private PEM.
- **Settings > Secrets and variables > Actions > Variables > New repository variable**:
  name `NOVA_APK_SIGNING_PUBLIC_KEY_SHA256`; value is the reviewed public key's
  SHA256-of-DER as 64 hexadecimal characters, not the PEM file checksum.

No keys or variables have been configured by this code change. Missing values,
an unexpected key, an unsupported key type, or failed signature validation
cause a hard failure and no signed artifact upload. It never silently publishes
unsigned packages as a signed release.

Repository secrets can be read by other eligible workflows in this repository.
The checks in this workflow are not a replacement for access controls. Keep
repository write access restricted, review workflow changes, and protect main
and v* tags. If stronger isolation is required, use a separately approved
protected signing environment with required reviewers. This change does not
create or modify branch/tag/environment protection settings.

After reviewing and merging this PR and configuring the approved values, open
**Actions > Build signed APK packages > Run workflow**, select **main**, and
run it. Secret/variable changes alone do not trigger a build. After the first
successful run, main updates and v* tags build and sign automatically.

Download `luci-nova-25.12-signed-apk-<commit>` from that run's Artifacts. It holds
both signed APKs, `nova-signing-public.pem`, its DER fingerprint, package/file
checksums, and source/run provenance. Artifacts are retained for 30 days. This
workflow does not create a GitHub Release or an online package feed. Ignore the
one-day `intermediate-unsigned-apk-*` artifact for installation.

## Production key and router trust, after separate explicit approvals

1. Review the final release source, signing scripts and repository access.
2. Generate a dedicated ECDSA P-256 production key only after approval. Store
   the private key only in the approved protected signing destination. Do not
   commit, log, upload as an artifact, pass to fork PRs, or paste it into chat.
   Do not repurpose the temporary test key; its private part no longer exists.
3. Publish the actual public PEM and its SHA256-of-DER fingerprint for review.
   Build and sign both APKs, then repeat independent and tamper verification.
   Publish only the signed outputs, checksums and public key, never an entire
   working directory that could include secrets. Fail closed if key input is
   unavailable or output verification fails.
4. Ask for action-time approval before adding that exact public key to the
   user's router. This trust permits future packages signed by its private key,
   potentially including root-level install scripts. It is not limited to Nova
   by APK, so keeping the signer secure matters.
5. Only after that approval, verify the downloaded public key fingerprint and
   copy it to `/etc/apk/keys/nova-release.pem` with mode 0644. Do not disable
   signature verification. Confirm with `apk verify` that both exact packages
   are accepted, then upload the signed theme and dashboard in LuCI's package
   manager. Keep Bootstrap installed, then select Nova in Language and Style.

The future one-time router commands, once the real key and its fingerprint
are reviewed, are:

```sh
# /tmp/nova-release.pem must be the reviewed public key, not a TEST-ONLY key.
# Verify its SHA256-of-DER fingerprint first, off-router if OpenSSL is absent.
cp /tmp/nova-release.pem /etc/apk/keys/nova-release.pem
chmod 0644 /etc/apk/keys/nova-release.pem
apk verify /tmp/luci-theme-nova-*.apk /tmp/luci-app-nova-dashboard-*.apk
# Then use LuCI upload, or the normal apk add flow, without --allow-untrusted.
```

These are review instructions, not actions already performed. If trust must be
revoked, remove only `nova-release.pem` from the trusted-key directory and stop
using packages signed by that key. Removing a key does not uninstall or undo
software already installed. Rotate keys with an explicit trust-change review.

### Owner-operated key preparation

If you choose to generate the key yourself, run these commands on your trusted
computer in a Bash shell with OpenSSL installed, in a private directory outside
any repository, synced folder or build artifact directory:

```sh
umask 077
openssl ecparam -name prime256v1 -genkey -noout -out nova-private.pem
openssl pkey -in nova-private.pem -pubout -out nova-public.pem
openssl pkey -pubin -in nova-public.pem -outform DER | openssl dgst -sha256
```

Keep the private PEM out of chat, commits and screenshots. Enter it directly
into the named GitHub repository Secret through the approved secure workflow.
The public PEM and the printed DER SHA256 are safe to review. Retain an approved
secure backup of the private key if continuity/recovery is needed; losing it
requires a key rotation and another router trust update. The assistant must
receive action-time approval before generating or configuring production
credentials, and a separate approval before installing the exact router key.

## Source references

- [OpenWrt package generation](https://github.com/openwrt/openwrt/blob/2ab43560b164a8fa9c9c2d3b6a39d51579a4e3b5/include/package-pack.mk)
- [OpenWrt key/index generation](https://github.com/openwrt/openwrt/blob/2ab43560b164a8fa9c9c2d3b6a39d51579a4e3b5/package/Makefile)
- [APK 3.0.5 signing implementation](https://github.com/alpinelinux/apk-tools/blob/b5a31c0d865342ad80be10d68f1bb3d3ad9b0866/src/app_adbsign.c)
- [LuCI upload frontend](https://github.com/openwrt/luci/blob/e969939b49167516e219d465df8030d98d443d67/applications/luci-app-package-manager/htdocs/luci-static/resources/view/package-manager.js)
- [LuCI install wrapper](https://github.com/openwrt/luci/blob/e969939b49167516e219d465df8030d98d443d67/applications/luci-app-package-manager/root/usr/libexec/package-manager-call)
