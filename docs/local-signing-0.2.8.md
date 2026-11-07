# Nova 0.2.8 local test signing

This dedicated intake is for the exact reviewed development source
`ded1f669a43c0fbefae922742a153b2afeb9e36b`, tree
`545224b7e30b110ef20ab03a52982838886cd4af`. It does not merge main, build IPK,
create a production release, change router trust, or move the private key out
of GitHub. The previously consumed signing entries remain unchanged.

This one-use entry validates final 0.2.8 with the reviewed soft-glow inputs,
taller tabs, forced-colors focus checks, and CSS packaging correction. SDK CSS
optimization altered reviewed foreground/font-size declarations into wrong
background colors, so both package recipes now preserve CSS without that
optimization. Actual packaged CSS must match every reviewed source CSS file
byte-for-byte, and browser tests check muted label foreground, transparent
background, and exact font size. JavaScript minification remains enabled.
Earlier 0.2.8 candidate builds were held and never published or signed.
Only this final source and its new manifest/pair are permitted.
All earlier consumed signing entries remain untouched.

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
regressions, all four Chrome suites must pass: browser-layout,
native-lists-browser, navigation-browser, and the new visual-browser suite.
The workflow explicitly checks that visual-browser exists and is invoked.
Chinese fonts are installed for the visual cases. Uploaded visual screenshots
use synthetic fixture data and are not evidence of live router telemetry.
All four browser suites run sequentially, with the same assertions and
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
