# Dashboard presentation and refresh

The integrated Dashboard keeps every existing card visible by default. Open
**自定义卡片** to choose metric, topology, WAN traffic and detected-band cards.
Only cards supported by the current detected inventory are offered. Hiding a
card does not delete data or change router settings. **恢复默认** shows all
available cards and restores the 10-second interval. Even with all cards hidden,
controls and the native **原生状态概览** link stay available.

Preferences are saved in this browser's local storage on the router's origin,
not in UCI. Another browser can use a different layout. Invalid/oversized saved
values are ignored. If storage is unavailable the page still works and explains
that changes last only for the current page.

Radio summaries remain visible; open their native details control for client
count, transmit power, noise and interface. The topology's detail view starts
expanded and can be collapsed. Keyboard users can toggle native summaries with
Enter/Space. Information is not removed and native Status → Overview stays
unchanged.

Refresh choices are **10 / 30 / 60 seconds** and **pause**. Background tabs and
an entirely hidden dashboard stop polling. Returning to the tab or re-enabling
refresh resumes on the next scheduled tick. Hidden WAN/radio charts do not make
their realtime-stat requests. Detection remains necessary to keep the visible
inventory current. Existing session/ACL restrictions still apply.

The refresh status distinguishes waiting, paused/background and partial or
failed reads. Values are not invented when reads fail. Changing the interval,
navigating away or hiding the tab invalidates late responses so they cannot
restart polling or rebuild an obsolete page. These settings control Nova's
Dashboard only, not LuCI's native page refresh or the router's services.

Version 0.3.1 fixes a LuCI scheduler startup race: `poll.add()` can synchronously
invoke the callback before `render()` returns and before LuCI mounts the root.
That one pre-mount tick is ignored without unregistering the callback. A later
tick on a detached or abandoned root still cleans up. Topology replacement,
pause/resume, interval changes and hidden-tab recovery use the same lifecycle.
Regressions execute the unchanged upstream 24.10 and 25.12 Poll implementations,
including synchronous startup, rather than only registering a delayed mock.
