include $(TOPDIR)/rules.mk

LUCI_TITLE:=Nova Dark LuCI Theme
# The dashboard is optional. Keep theme installation and upgrades independent.
LUCI_DEPENDS:=+luci-base +luci-theme-bootstrap
PKG_LICENSE:=MIT AND Apache-2.0
PKG_VERSION:=0.2.12
PKG_RELEASE:=1

# The SDK csstidy optimizer corrupts merged rules in our modern CSS. Keep
# stylesheet bytes intact; APK compression still applies. JS remains minified.
LUCI_MINIFY_CSS:=0

define Package/luci-theme-nova/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
    uci -q delete luci.themes.Nova
    uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
