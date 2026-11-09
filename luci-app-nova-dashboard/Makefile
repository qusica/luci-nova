include $(TOPDIR)/rules.mk

LUCI_TITLE:=Nova Status Dashboard
LUCI_DEPENDS:=+luci-base
PKG_LICENSE:=MIT
PKG_VERSION:=0.2.11
PKG_RELEASE:=1

# The SDK csstidy optimizer corrupts merged rules in our modern CSS. Keep
# stylesheet bytes intact; APK compression still applies. JS remains minified.
LUCI_MINIFY_CSS:=0

# Bundle Nova's own native catalog with this optional app so its menu is
# localized even when the Nova theme is not installed. Do not include other LuCI applications' translation keys.
# Keep these sources outside po/: luci.mk would create a third language package
# there, which users installing only the theme and dashboard would not receive.
define Build/NovaTranslations
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	po2lmo $(CURDIR)/translations/zh_Hans/nova-dashboard.po \
		$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/nova-dashboard.zh-cn.lmo
endef
Hooks/Compile/Post += Build/NovaTranslations

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
