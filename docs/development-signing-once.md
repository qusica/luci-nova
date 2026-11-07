# One-version development test signing

This temporary entry is only for `ci/sign-nova-0.2.3-test` in `qusica/luci-nova`.
It does not create a release, merge a PR, rebuild the SDK, or change router trust.
Do not merge these temporary files into main or the feature PR.

Before publishing this branch:

1. Wait for source run `42311247044`, attempt 1, to finish successfully.
2. Read that run's artifact metadata. Pin the ID and SHA-256 digest of its unique
   `luci-nova-25.12-apk` in `scripts/prepare-development-signing.py`. The committed
   zero/empty placeholders intentionally refuse signing. Do not substitute a
   later run, different package version, or disposable-key test artifact.
3. Run `python3 tests/development-signing.test.py` and review the workflow diff.
4. Push only these reviewed changes to the exact temporary branch, without a PR.
   That push triggers signing. Existing main/tag production job gates stay the
   same and skip this branch; the PR-only SDK workflow does not run.

The clean development signing job validates GitHub run and artifact metadata,
checks the downloaded ZIP against the pinned digest, and extracts exactly two
`0.2.3-r1` APKs as data. It never executes feature-branch package scripts.
Production signing code comes from reviewed commit
`beaf5c7557b153f7e2b7ca3c7907a8b26a88890b`. The pinned/checksummed APK tool is built
before the existing repository private-key secret enters the single signing
step. This development job pins the existing 0.2.1 publisher public-key DER
SHA-256 `1475de2470b41a6c99263996ebc44b393bdf385d3639991514563d5c89054140`,
independently checked against the old signed artifact and included in provenance.
Changing a repository variable cannot select another development signing key.
The original production job still uses its existing variable unchanged.
The production signer retains public-key fingerprint, P-256, package
metadata/version, key-pair, and per-APK signature checks and private-key cleanup.

Only the two signed packages, public key, checksums, and source provenance are
uploaded under `DEVELOPMENT-TEST-luci-nova-0.2.3-r1-a0ce5dd2b474`, retained 7 days.
This is a test build, not a production release.

Workflow concurrency serializes this branch. The guard rejects incomplete
history, another pending run, rerun attempts, and any prior successful push run.
A failed/cancelled run may be retried only by a new reviewed push, still signing
exactly the same pinned input. A cancellation after signing but before upload
may have signed bytes without publishing them; this is not an irreversible
external one-shot key counter. Never delete run history to defeat the guard.
After successful publication, retire the temporary branch through the normal
approved repository workflow. No persistent credentials or new trust are added.
