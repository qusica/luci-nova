> Since 0.3.0, the theme owns this catalog and both menu routes. The `nova-dashboard` catalog name and legacy ACL key remain unchanged for compatibility.

# Menu localization

Nova leaves native LuCI and plugin menu titles with LuCI's translation system.
It does not replace their text in the browser. Route matching for navigation
icons is independent of the active language.

Both Nova menu entries use the source key `Nova Dashboard`. The integrated theme package
includes `nova-dashboard.zh-cn.lmo`, compiled by the matching SDK's `po2lmo`
from `luci-theme-nova/translations/zh_Hans/nova-dashboard.po`.
LuCI loads this standard catalog when Simplified Chinese is selected and shows
`Nova 仪表盘`. English and languages without a Nova catalog retain the source
title. No third Nova language package is needed.

The catalog only contains Nova's own title. In particular, it does not override
the generic `Dashboard` key, which other plugins may use with a different
meaning. The source is outside the conventional `po/` directory because
`luci.mk` would otherwise generate a separate language APK rather than include
it in the theme package.

## Native or plugin menus remaining in English

A translated base LuCI interface does not imply that all plugin language
packages are installed. On OpenWrt 25.12, these examples use their own packages:

| Menu | Simplified Chinese package | Upstream Chinese title |
| --- | --- | --- |
| Software | `luci-i18n-package-manager-zh-cn` | 软件包 |
| Attended Sysupgrade | `luci-i18n-attendedsysupgrade-zh-cn` | 值守式系统升级 |

Check Installed packages and the selected LuCI language before installing
anything. Use language packages from the router's own matching firmware feeds.
Do not add an unrelated plugin merely to translate a menu, change package trust,
or overwrite plugin translations through the theme. After an approved language
package installation, reload LuCI to fetch the updated native catalog.

## Regression checks

Run `node --test tests/menu-localization.test.js` for source checks. With the
SDK host tool available, set `PO2LMO=/absolute/path/to/po2lmo` to also compile and
inspect the native catalog. The built-APK test runs the same checks against the
catalog actually extracted from the theme package.
