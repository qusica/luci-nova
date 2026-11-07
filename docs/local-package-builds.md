# Fast local APK builds

Use one authenticated OpenWrt SDK cache for development, then submit the exact
unsigned APK bytes to the separate GitHub validation/signing intake. The
publisher private key stays in GitHub. Building a package does not install it
on a router or change the router's trusted keys.

## One-time setup

Use an x86-64 Linux host with a case-sensitive filesystem. Install the normal
OpenWrt host prerequisites, including GCC/G++, GNU make/awk, rsync, ncurses
development headers, Git, Perl, Python 3, curl, GnuPG, tar, zstd and unzip.
Node.js and Chrome/Chromium are needed for the tests. Docker is not required.

```
bash scripts/setup-local-sdk.sh "$HOME/.cache/nova-openwrt-25.12.6"
```

Setup pins the official 25.12.6 x86/64 SDK and its SHA-256, verifies the release
manifest using the pinned OpenWrt release key, and pins LuCI/packages feeds to
the release's signed feeds.buildinfo, plus the base feed pinned inside the
authenticated SDK. The SDK archive, extracted tools, source
downloads and host build outputs stay in the cache. The initial SDK archive is
about 273 MiB and the extracted SDK is about 1.4 GiB before extra dependencies.
The one-time download can still be slow; cached iterations do not repeat it.

Do not use temporary directories for a cache you want to keep. A cloud
workspace cache lasts only as long as that workspace: retain the scripts and
pins in Git, and use a persistent computer or volume for cross-workspace reuse.
Never include publisher private keys, tokens or other credentials in the cache.

## Build a committed source revision

Commit the intended source and test changes locally first. The helper rejects
uncommitted package/test changes and verifies the cached source bytes against
the exact Git tree. It does not push any commits.

```
CHROME_BIN=chromium bash scripts/build-local-apks.sh \
  "$HOME/.cache/nova-openwrt-25.12.6" /path/to/new-output-directory
```

Each build uses the commit timestamp as SOURCE_DATE_EPOCH, cleans only Nova's
two packages and keeps the SDK, dependency outputs and downloads warm. Pinned
feed indexes are reused. A lock prevents simultaneous builds in one SDK.
The two packages are architecture-independent APKs for the compatible OpenWrt
25.12/LuCI stack, not firmware images. Do not rename them to IPKs or assume
compatibility with a different OpenWrt/LuCI series.

The output contains:

- packages/: the exact unsigned theme/dashboard APK pair.
- BUILD-SOURCE.json: source commit/tree, SDK/feed pins, package sizes and SHA-256
  digests, helper/configuration hashes, host-tool versions, test results and
  elapsed time.
- SHA256SUMS, SDK-PROVENANCE.json and the signed SDK manifest.
- Full build log, SDK configuration and source/packaged regression logs.

The helper extracts package data without running package hooks and tests the
actual minified JavaScript. Normal runs also execute all three browser suites.
If a restricted build host cannot launch Chromium, set
NOVA_LOCAL_BROWSER_TESTS=0 explicitly. The manifest then records browser tests
as deferred, and the GitHub secret-free intake must run the complete
test-built-apks.sh suite before signing. This option never means browser QA
passed. The asset-change comparison test additionally needs NOVA_ASSET_BASE
when comparing a candidate against an earlier released source revision.

## Signing and reproducibility

Submit only the exact reviewed APK pair and provenance to the dedicated intake
branch/workflow. The intake must pin their digests, verify the source revision,
decode packages as data, and run packaged tests without signing secrets. A
fresh job uses the trusted signer and original reviewed public-key fingerprint.
Never load the signing key into the SDK build or local workspace.

Run the same committed source twice into two new output directories and compare
the APK entries in SHA256SUMS. Equal hashes establish byte-for-byte repeatability
for that cached SDK/configuration. Build logs and provenance timing will differ.
They are not a claim of independent cross-machine reproducibility.

The signature authenticates the downloaded SDK archive. It does not attest
that an existing extracted cache or optional host-tools override remains
unchanged. Treat the cache as trusted local build state, rebuild it after a
suspected change, and treat submitted APKs as untrusted data. Local provenance
is not proof that package bytes match source. For the first rollout, compare
the local payload and hooks against the independently successful pinned CI
build as an additional check before accepting the new signing intake.

After downloading the signed results, verify each package against the existing
publisher public key and verify its payload equals the reviewed unsigned
package. Only then proceed with an authorized router installation and live QA.

## Initial validation

On November 7, 2026, source bb79774037f923475143f2950dfd90cf13ff16ec was
built twice with the warm cache in 70.415 and 67.881 seconds, including local
syntax and regression checks. Both runs produced identical APK bytes.
All 80 source tests, including the asset-version comparison against PR base
e8a99ab390582e2ad3f99293b2a6677678717dcc, and all 78 packaged behavior tests
passed. Seven negative tests verify rejection of dirty/staged/untracked source,
changed cached contents/modes, extra cached files and untracked feed inputs.

The 15 payload files across the pair, their modes/ownership/paths, all package
hooks and operational package metadata matched the independently successful
GitHub run 42345179679. Only build-origin metadata, package content identifiers
and file timestamps differed. Browser tests remained an explicit GitHub
pre-signing requirement because the local executor could not launch Chromium.
