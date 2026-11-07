# Local SDK builds, isolated GitHub verification and signing

Local development uses a cached, signature-verified OpenWrt 25.12.6 x86/64 SDK.
The existing production private key stays in GitHub. This entry is for the
specifically approved 0.2.5 development pair only, not a release or a main merge.

The reviewed source is `3ae33fdff39310d45b54d347ac6b80a1c6476c15`, tree
`d71343edfcfae3c44f8da41b3453d57a61008736`. This pair fixes navigation alignment, semantic icons and menu localization.
The consumed 0.2.4 entry must not be updated or rerun.

## Package transfer

The final pair and local build manifest are transferred to GitHub as data in
`local-signing-input/` on the dedicated `ci/sign-nova-0.2.5-local-test` branch.
Each APK uses canonical single-line base64, because the available repository
text API does not upload binary blobs. No executable package contents are run
during transport or decoding. The manifest must not contain credentials,
private keys, session data or unrelated local information.

Before the one branch push, independently check the SDK signature/hash, source
tree and package metadata, then fill the manifest and package SHA-256 constants
in `scripts/prepare-local-signing.py`. All unset pins fail closed. Verify that
the branch has no prior run. Run the guard tests and review the complete diff.
Publish the full reviewed commit in one branch creation; do not make multiple
successive commits that each trigger the entry. Do not create a PR for this
temporary intake branch or merge its workflow/data into main.

## Verification before signing

The first GitHub job checks exact source and repository identity, decodes the
pinned local pair, and repeats Node behavior tests and all three Chrome suites
against the APKs' actual extracted/minified bytes. The job has no signing key.
Package hooks are not executed. Only the exact package pair and provenance
pass through a same-run Actions artifact to a fresh signing job.

The signing job rechecks pinned package hashes and provenance. It builds the
pinned APK tool from trusted production commit
`beaf5c7557b153f7e2b7ca3c7907a8b26a88890b`, then exposes the existing signing
secret only to the trusted signing step. The original public-key DER SHA-256
is fixed at `1475de2470b41a6c99263996ebc44b393bdf385d3639991514563d5c89054140`.
Both packages are strictly signature-verified before upload. No new keys,
router trust, persistent credentials, production release or main merge occurs.

The output contains both signed APKs, public key, checksums and BUILD-SOURCE.json.
Verify all of these before installing on the authorized test router. Retain
Bootstrap for rollback. Local fixture success does not prove hardware PPPoE or
wireless behavior; report those separately from simulated cases.

## Reuse and retries

The SDK/cache and data-transfer/test/signing structure are reusable. Every new
package pair must be separately reviewed and pinned under the user's current
authorization. This entry is deliberately one-use: reruns and any earlier run,
including failed or cancelled attempts, fail closed. A failed test can be
diagnosed without keys, but a new signing attempt needs a separately reviewed,
authorized entry. Never delete run history or remove guards to retry.

The old SDK-only CI run is not a provenance dependency for this local route.
Its pending or eventual artifact must never be substituted for the pinned
local pair. Existing production workflow files remain unchanged.
