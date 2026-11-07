# Quiet Slate, Nova 0.2.6

The previous palette mixed fluorescent lime navigation, mint checkmarks and saturated radio colors. Quiet Slate gives each color a narrower job and makes native LuCI pages feel part of the same product.

## Palette and hierarchy

- Canvas `#101419`, sidebar `#141a21`, panels `#19212a`, raised controls `#202a35`.
- Main text `#e9eef5`, secondary text `#a6b3c2`, small supporting text `#96a5b6`.
- Ice blue `#9bc1f1` identifies interactive controls, selected navigation, focus and download data.
- Soft mint `#83cbb2` identifies live activity. It is not used as a blanket "healthy" badge on metric cards.
- Amber `#e3bf86` remains reserved for an unavailable-data warning, alongside explicit text.
- Lavender `#b9abe9` distinguishes upload and the second radio band. Upload lines are also dashed; legends are labeled. Radio bands retain text labels.

Metric values use tabular numerals and a stronger size hierarchy. Native forms keep their labels, descriptions, status, controls and actions. The 232 px sidebar and click-only menu behavior remain intact. The compact navigation still wraps and opens usable dropdowns. No native data column is hidden to make a screenshot cleaner.

## Scope

Presentation only: CSS, decorative dashboard SVGs, favicon and asset cache version. RPC declarations, inventory detection, polling, action URLs, configuration, package dependencies and ACLs are unchanged. Theme and dashboard versions advance together to 0.2.6; ordinary refresh should pick up new assets.

## Verification

The visual browser test uses actual Nova source and explicitly synthetic RPC responses. It exercises a populated dashboard, detection failure and representative native form controls at 320, 390, 768, 1024 and 1440 px. It checks whole-document horizontal containment, decorative SVG semantics and minimum 4.5:1 contrast for sampled small labels. Screenshots are design fixtures, not evidence that a test router has PPPoE or Wi-Fi.

The existing source/packaged suites still cover detected inventory, disabled/down radios, recovery, honest unavailable states, preserved native lists and real pointer/keyboard/touch menu operation. The visual suite runs against extracted APK assets too. Live router acceptance remains a separate check and must not be inferred from fixture success.


## Native-LuCI correction in 0.2.7

Live 0.2.6 acceptance found blank SVG ornaments: LuCI's generic `E()` creates
HTML-namespace nodes, while the original browser fixture silently created SVG
nodes for those tags. The fixture was too permissive. Version 0.2.7 uses explicit
`document.createElementNS` for every icon/chart root and shape, with faithful
HTML-only fixture `E()` implementations and actual rendered-geometry assertions.
Package/cache versions advance because 0.2.6 had already been installed.

## CSS packaging correction in 0.2.8

Live 0.2.7 review caught a lavender rectangle behind muted topology help text.
The source was correct, but SDK csstidy had merged four small-label selectors
and replaced their color/font declarations with an unrelated radio-meter
background. Both packages now use the supported `LUCI_MINIFY_CSS:=0` switch.
APK compression still applies and JavaScript remains minified. Packaged tests
compare every CSS file byte-for-byte with source and visual tests verify the
affected labels' exact foreground, transparent background and 11 px size.

## Input and tab feedback in 0.2.8

The user preferred the subtle glow on LuCI's route-table dropdown over the
hard detached outline on an invalid destination field. Text inputs, selects,
textareas and native dropdowns now use a light ice-blue border and a soft
10 px glow on focus. Invalid fields retain their own red border/glow and
native error message. Disabled fields have no glow; read-only fields keep
muted colors and focusability. System outlines remain in forced-colors mode.
Native tabs keep their familiar shape, with 38 px minimum target height,
40 px on narrow screens, 12 px horizontal padding and 6 px gaps. They can
wrap rather than creating whole-page horizontal overflow. The browser suite
checks these states at all five visual widths as well as the original gates.
