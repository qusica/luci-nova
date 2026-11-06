include $(TOPDIR)/rules.mk

LUCI_TITLE:=Nova Dark LuCI Theme
LUCI_DEPENDS:=+luci-base +luci-theme-bootstrap
PKG_LICENSE:=MIT AND Apache-2.0
PKG_VERSION:=0.2.3
PKG_RELEASE:=1

define Package/luci-theme-nova/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
    uci -q delete luci.themes.Nova
    uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
