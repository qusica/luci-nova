# Interface detection and failure states

Nova uses `network.interface dump` and `network.wireless status` as the
authoritative runtime inventories. A successful empty inventory hides absent
WAN and wireless cards. Configured but disconnected PPPoE interfaces and
disabled radios remain visible. A failed request never means an empty inventory.

When runtime inventory is unavailable, Nova first preserves any previous
successful runtime snapshot, with a stale-state warning. On an initial failure,
it can read the already-authorized `network` interface and `wireless` radio UCI
sections. These are labelled as saved configuration with unknown runtime state;
they do not prove that physical hardware exists or that an uplink is connected.
Runtime traffic and station counts are not invented for this fallback.

The configuration projection keeps only interface names, protocols, device
names, bands, hardware modes and the configured disabled flag. Authentication
fields and wireless keys are never rendered or retained in the projection.
Explicit runtime access denial, including ubus permission errors and HTTP
401/403, does not trigger an alternate configuration read. No configuration,
service or trust settings are changed by this view.

Diagnostics display bounded error categories and ubus/HTTP codes. They never
display raw payloads, URLs, session tokens or arbitrary exception text. Numeric
ubus codes remain useful when LuCI translates the original error descriptions.

## Live test lesson from 0.2.3

The two signed 0.2.3 APKs installed normally on the OpenWrt 25.12.6 test system,
but live acceptance failed. The native process page did not show netifd, while
the native interface page could still display saved UCI configuration. The
runtime requests failed, so those native settings were not evidence that the
runtime dump was working. No service was started and no network settings were
changed to hide this condition.

LuCI 25.12 also stringifies null entries inside DOM child arrays. Earlier test
helpers incorrectly discarded these entries, masking literal null text in
conditional sections. The current implementation filters optional child nodes,
and both the unit and browser helpers reproduce LuCI's null conversion. The
regression fails against the actual signed 0.2.3 dashboard and passes with the
fix. Browser fixtures remain isolated fixtures, not a full live-router test.

Real PPPoE dialing and physical wireless operation require an appropriately
configured device. The test system has no such setup; simulated transitions
must not be reported as real dialing or hardware acceptance.

## Verify the packaged assets

The 0.2.4 candidate passed source checks but failed behavior tests after SDK
minification: a regular expression immediately after `return` lost meaningful
spaces, so HTTP 401/403 and JSON-RPC -32002 were not recognized as access denial.
Assigning the same expression to a local variable avoids that minifier case.
The APK workflow now extracts its actual built packages as data and repeats
syntax, dashboard/list behavior, and all three Chrome suites against those
packaged assets before uploading artifacts. The regression includes initial
loads, polling, each inventory independently, and numeric boundary cases.
