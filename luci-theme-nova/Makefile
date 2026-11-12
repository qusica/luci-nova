include $(TOPDIR)/rules.mk

LUCI_TITLE:=Nova LuCI Theme and Dashboard
# Dashboard assets, menu, ACL and translations ship in this single package.
# Old standalone dashboard files must be removed before installing 0.3+.
# Package/Default clears ordinary CONFLICTS before luci.mk builds the package.
# There is only one package in this Makefile, including its translations.
override CONFLICTS:=luci-app-nova-dashboard
LUCI_DEPENDS:=+luci-base +luci-theme-bootstrap
# APK does not serialize the opkg Conflicts field. It uses negative dependencies.
# Do not put this in LUCI_EXTRA_DEPENDS, which requires version constraints.
# Keep the negative token out of Kconfig dependency generation during DUMP.
ifeq ($(DUMP),)
  ifeq ($(CONFIG_USE_APK),y)
    LUCI_DEPENDS += !luci-app-nova-dashboard
  endif
endif
PKG_LICENSE:=MIT AND Apache-2.0
PKG_VERSION:=0.3.0
PKG_RELEASE:=1

# The SDK csstidy optimizer corrupts merged rules in our modern CSS. Keep
# stylesheet bytes intact; APK compression still applies. JS remains minified.
LUCI_MINIFY_CSS:=0

define Package/luci-theme-nova/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
    # Old postrm may run during an upgrade. Only reset the selected theme
    # after the package templates are actually gone, never on replacement.
    if [ ! -f /usr/share/ucode/luci/template/themes/nova/header.ut ]; then
        if [ "$$(uci -q get luci.main.mediaurlbase)" = '/luci-static/nova' ]; then
            uci set luci.main.mediaurlbase='/luci-static/bootstrap'
        fi
        uci -q delete luci.themes.Nova
        uci commit luci
    fi
}
endef

# Keep this catalog in the theme instead of a separate language package.
# Preserve the catalog name and ACL key for existing LuCI permissions.
define Build/NovaTranslations
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n
	po2lmo $(CURDIR)/translations/zh_Hans/nova-dashboard.po \
		$(PKG_BUILD_DIR)/root/usr/lib/lua/luci/i18n/nova-dashboard.zh-cn.lmo
endef
Hooks/Compile/Post += Build/NovaTranslations

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
