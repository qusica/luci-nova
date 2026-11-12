# Historical independent packages (0.2.x)

Nova 0.2.x shipped independent theme and Dashboard packages. **This is no longer
the install model for 0.3.0 or later.** Current builds contain the Dashboard in
`luci-theme-nova` and reject the old standalone app to avoid shared file ownership.

Use the [current APK/IPK migration and rollback guide](package-migration.md).
Do not follow earlier version-qualified coexistence instructions with 0.3.0+.

For diagnosing an unchanged 0.2.x installation, an APK `world[...]` constraint is
not itself a package dependency. A checksum pin must be compared to the actual
installed package before diagnosing it as inconsistent. Do not routinely edit
`world`, disable verification or force a broken transaction.
