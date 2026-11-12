# Upstream LuCI polling fixtures

These files are the complete, unchanged `const Poll = Class.singleton(...)`
blocks extracted from LuCI's `modules/luci-base/htdocs/luci-static/resources/luci.js`.
They are test-only and are not shipped in the Nova package. LuCI is licensed
under Apache-2.0; the upstream license is retained in `LICENSE-LuCI`.

- `luci-poll-24.10.js`: OpenWrt LuCI commit
  [aa4865e8e6472d6ba68e541688065fc2235bbd83](https://github.com/openwrt/luci/blob/aa4865e8e6472d6ba68e541688065fc2235bbd83/modules/luci-base/htdocs/luci-static/resources/luci.js#L1004-L1158),
  lines 1004–1158. SHA256:
  `9ad63654bf7fd2b5ee7fb6d51a9c60b65bf530ae1c457d1b482ad3dc0539890b`.
- `luci-poll-25.12.js`: OpenWrt LuCI commit
  [b2e0be4b46ec0fd43394c081fa7c50657af14011](https://github.com/openwrt/luci/blob/b2e0be4b46ec0fd43394c081fa7c50657af14011/modules/luci-base/htdocs/luci-static/resources/luci.js#L1067-L1221),
  lines 1067–1221. SHA256:
  `44f32e08364c5cf2f79c0d120200140847e1aa5e1f8f321c9796f6b405f0a24a`.

Only JSDoc function-type annotations differ between these two extracts. Tests
execute each actual implementation, controlling only the later one-second
timer. `add()`, `start()` and `step()` retain their synchronous dispatch behavior.
The browser preferences suite uses the 25.12 implementation with real DOM and
native controls. Do not replace these fixtures with a deferred `add()` mock.
