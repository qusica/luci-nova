# Native LuCI baseline

Unmodified Bootstrap cascade.css and mobile.css from the locally built OpenWrt
25.12 LuCI feed, commit `75a306df84a020c57a631ef5b4c02ace56d93387`. The copyright and Apache-2.0 notice in cascade.css are retained.
Upstream: https://github.com/openwrt/luci/tree/openwrt-25.12/themes/luci-theme-bootstrap

These are test-only compatibility fixtures, not shipped theme assets. Keep their
order faithful to the Nova header: Bootstrap cascade, Bootstrap mobile (device
media query), then Nova. Do not replace native rules with idealized form CSS.
