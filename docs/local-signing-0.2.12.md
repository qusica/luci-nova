# Nova 0.2.12 local test signing

This dedicated intake is for the exact reviewed development source
`c2a82916d4cf2a4ccd206f22e1cd2f4ac793011d`, tree
`97ecac94f194c8e5335b6a65179f06788626f1b9`. It does not merge main, build IPK,
create a production release, change router trust, or move the private key out
of GitHub. The previously consumed signing entries remain unchanged.

This one-use entry validates 0.2.12 wireless missing-object errors with LuCI
stack frames. Only the first error line establishes the classification;
generic, permission, timeout and stack-only matches remain failures. All six
browser suites, every CSS byte comparison, strict
packaged header validation, and disposable-root package independence checks
must pass before signing. This is not a router/network change and does not
make absence of a wireless service into a claim about physical hardware.
The original five browser suites and all earlier safety checks are retained.

The local build owner verifies the official SDK and pinned feeds, records the
source tree and recipe/configuration hashes, builds the exact APK pair twice,
and compares the output. The existing mutable cache is trusted local build
state; its manifest is not an independent remote build attestation. A cache
lost with the workspace must be authenticated and rebuilt rather than assumed
to survive.

After reviewing the actual output, pin its manifest and both APK SHA-256
digests in `scripts/prepare-local-signing.py`. Submit the exact bytes as
canonical base64 data plus manifest to this dedicated branch in one reviewed
push. No package hooks are executed during transport or extraction.

The first GitHub job has no signing secret. It validates exact repository,
source tree and data hashes, then runs `test-built-apks.sh` from the pinned
source against the extracted APK payloads. In addition to dashboard/list/menu
regressions, all six Chrome suites must pass: browser-layout,
native-lists-browser, navigation-browser, visual-browser, native-spacing-browser, and sidebar-overflow-browser.
The workflow explicitly checks that visual-browser, native-spacing-browser,
sidebar-overflow-browser and the package-independence runner exist and are
invoked. The source header-order assertion is source-only, so a
separate mandatory check compares the actual APK header template with that
reviewed source before signing. It permits only the SDK's five fixed URL
version insertions (`?v=0.2.12`), requires each original URL exactly once, checks
Bootstrap cascade/mobile precede Nova, and rejects every other byte change.
Chinese fonts are installed for the visual cases. Uploaded visual screenshots
use synthetic fixture data and are not evidence of live router telemetry.
All six browser suites run sequentially, with the same assertions and
timeouts. Font-cache setup failures remain errors.

A fresh signing job downloads only this run's validated package artifact and
independently rechecks all pinned bytes and provenance. It checks out only the
reviewed guard/data and the existing trusted production signer at
`beaf5c7557b153f7e2b7ca3c7907a8b26a88890b`. The secret enters only the signing
step after the trusted tool is built. The original public-key DER SHA-256 is
fixed at `1475de2470b41a6c99263996ebc44b393bdf385d3639991514563d5c89054140`.

The one-use history guard rejects reruns and every earlier run on this exact
branch, including failed or cancelled attempts. Never delete history or
change the guard to obtain another signing attempt. A later version needs a
separately reviewed entry under the user's then-current authorization.

Before test deployment, independently verify the signed archive, provenance,
checksums, original-key signatures and unchanged package payload/hooks. Live
device testing is separate from synthetic browser coverage. No public or
production release is implied by this test artifact.

