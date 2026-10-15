# PandaOS — Module Contract (API.md)

This is the binding contract between all PandaOS modules. Every module is written by a different
agent in parallel, so **code only against what is written here**. If you need something that is not
here, implement it privately inside your own files (or degrade gracefully) — never edit another
module's files.

## 0. Ground rules

- Plain HTML/CSS/JS. **No frameworks, no CDNs, no external assets, no ES modules, no `fetch()`**
  (the OS must run from `file://` by double-clicking `index.html`, fully offline).
- Every JS file is a classic script wrapped in an IIFE with `'use strict'`, attaching to the global
  `window.PandaOS` (created by `js/core/kernel.js`, which always loads first).
- 2-space indentation, semicolons, `const`/`let`, modern JS (Chrome/Edge/Firefox current) is fine.
- **UI language is Turkish** (all labels, menus, messages, dialogs). Code/comments in English.
  Use proper Turkish characters (ç ğ ı İ ö ş ü). Dates/times via `tr-TR` locale.
- Colors/radii/shadows/fonts **must** come from CSS variables in `css/theme.css` so light/dark theme
  and the accent color work everywhere. No hard-coded light-only or dark-only colors for surfaces/text
  (decorative colors like game tiles or icon art are fine).
- CSS is scoped: shell modules prefix their classes (`wm-`, `desk-`, `lock-`, `boot-`, `tb-`, `sm-`,
  `cal-`, `nc-`, `ctx-`, `toast-`, `dlg-`, `fp-`); apps scope everything under `.app-<appId>`.
- Never rely only on `transitionend`/`animationend` to finish a state change; always have a timeout
  fallback (animations can be disabled via the `animations` setting).
- Defensive coding: a module that fails must not take down the OS. Wrap risky init code in try/catch,
  check optional APIs (`PandaOS.notify?.(...)`) when calling *other* modules.
- No `alert()/confirm()/prompt()` — use `PandaOS.dialog.*`.
- Don't use `localStorage` directly — use `PandaOS.storage` (namespaced) or `PandaOS.fs`.

## 1. Files and owners

| File(s) | Owner |
|---|---|
| `index.html`, `css/theme.css`, `js/core/kernel.js`, `js/boot.js`, `tests/harness.js`, `tools/*` | plan (do not edit) |
| `js/core/vfs.js`, `tests/vfs.test.js` | C1 VFS |
| `js/core/wm.js`, `css/wm.css`, `tests/wm.test.js` | C2 Window manager |
| `js/shell/session.js`, `js/shell/desktop.js`, `js/shell/wallpapers.js`, `css/session.css`, `css/desktop.css`, `tests/desktop.test.js` | C3a Session & desktop |
| `js/shell/taskbar.js`, `js/shell/startmenu.js`, `css/taskbar.css`, `tests/taskbar.test.js` | C3b Taskbar & start menu |
| `js/ui/contextmenu.js`, `js/ui/notify.js`, `js/ui/dialog.js`, `js/ui/sound.js`, `css/components.css`, `css/ui.css`, `tests/ui.test.js` | C4 UI kit |
| `js/core/icons.js`, `tests/icons.test.js` | C5 Icons |
| `js/apps/<id>.js`, `css/apps/<id>.css`, `tests/<id>.test.js` | one agent per app |

## 2. DOM layers (in `index.html`)

```html
<div id="os-root">
  <div id="desktop"></div>             <!-- C3a: wallpaper + icons; covers full screen -->
  <div id="windows"></div>             <!-- C2: window layer; area above the taskbar -->
  <div id="taskbar"></div>             <!-- C3b -->
  <div id="start-menu"></div>          <!-- C3b -->
  <div id="panels"></div>              <!-- C3b: calendar flyout, notification center, volume flyout -->
  <div id="toasts"></div>              <!-- C4: toast notifications -->
  <div id="context-menu-layer"></div>  <!-- C4 -->
  <div id="dialog-layer"></div>        <!-- C4: modal dialogs -->
  <div id="lock-screen"></div>         <!-- C3a -->
  <div id="boot-screen"></div>         <!-- C3a: boot splash / shutdown screen -->
</div>
```

`theme.css` positions every layer `absolute` and sets the z-order
(`--z-desktop` < `--z-windows` < `--z-taskbar` < `--z-popups` < `--z-toasts` < `--z-menu` <
`--z-dialog` < `--z-lock` < `--z-boot`). Overlay layers (`#start-menu`, `#panels`, `#toasts`,
`#context-menu-layer`, `#dialog-layer`, `#lock-screen`, `#boot-screen`) have `pointer-events: none`;
**their owners must set `pointer-events: auto` on visible children**.
`#windows` also has `pointer-events: none`; each window sets `pointer-events: auto`.
`--taskbar-height` is 48px; `#windows` spans `top:0 → bottom: var(--taskbar-height)`.

## 3. Kernel (`js/core/kernel.js`) — already written

```js
PandaOS.version        // '1.0.0'
PandaOS.user           // { name:'panda', displayName:'Panda', home:'/home/panda', hostname:'pandaos' }
PandaOS.params         // URLSearchParams of location.search

// Event bus
PandaOS.bus.on(evt, fn) -> unsubscribe()     PandaOS.bus.once(evt, fn) -> unsubscribe()
PandaOS.bus.off(evt, fn)                     PandaOS.bus.emit(evt, data)

// Namespaced persistent JSON storage (localStorage key = 'pandaos.' + key)
PandaOS.storage.get(key, fallback)  PandaOS.storage.set(key, value) -> bool
PandaOS.storage.remove(key)         PandaOS.storage.clearAll()
// Apps store their own state under 'app.<appId>', e.g. PandaOS.storage.get('app.game2048', {best:0})

// Settings (persisted; emits 'settings:change' {key, value, old})
PandaOS.settings.get(key)  PandaOS.settings.set(key, value)  PandaOS.settings.all()  PandaOS.settings.reset()
// keys + defaults:
//  theme:'dark'|'light'|'auto' ('dark')     accent:'#2f9e6b'       wallpaper:'bamboo'
//  volume:0..100 (70)   muted:false   sounds:true (UI sounds)   dnd:false (do not disturb)
//  animations:true      clock24h:true showSeconds:false
//  'taskbar.pinned': ['files','terminal','notepad','music']   'desktop.iconSize':'small'|'medium'|'large'
PandaOS.settings.ACCENTS   // [{name, value}] suggested accent colors (Settings app uses these)

// Theme (applies data-theme on <html>, --accent, --accent-contrast, .no-anim class)
PandaOS.theme.get() -> 'dark'|'light' (effective)   PandaOS.theme.mode() -> 'dark'|'light'|'auto'
PandaOS.theme.set(mode)   PandaOS.theme.toggle()   PandaOS.theme.apply()
// emits 'theme:change' {theme}

// App registry
PandaOS.apps.register(def)
//  def = {
//    id: 'notepad', name: 'Not Defteri', icon: 'notepad',   // icon: name in PandaOS.icons or raw '<svg…>'
//    description: 'Metin dosyalarını düzenle', category: 'system'|'productivity'|'media'|'games'|'utilities',
//    fileTypes: ['.txt', '.md'],        // extensions this app opens (lowercase, with dot)
//    singleInstance: false,             // true → launching again focuses the existing window
//    showInStartMenu: true,
//    window: { width, height, minWidth, minHeight, resizable, maximizable, maximized },
//    launch(win, args) { … },           // render into win.body; args = {} or { path } or app specific
//    relaunch(win, args) { … }          // optional; singleInstance app re-launched with new args
//  }
PandaOS.apps.get(id) -> def | undefined   PandaOS.apps.list() -> def[] (sorted by name, tr)
PandaOS.apps.launch(id, args = {}) -> win | null
PandaOS.apps.openFile(path) -> win | null   // dir → files; '.app' → JSON {appId,args}; else by fileTypes; fallback notepad
PandaOS.apps.forExtension(ext) -> def[]
PandaOS.apps.running(id) -> win[]

// In-memory clipboard for files (shared by desktop & file manager); emits 'clipboard:change'
PandaOS.clipboard.set({ op: 'copy'|'cut', paths: [...] })   PandaOS.clipboard.get() -> {op, paths} | null
PandaOS.clipboard.clear()

// Helpers
PandaOS.util.el(tag, attrs, ...children)   // attrs: class, style (obj|str), dataset, text, html, on:{evt:fn}, any attr
PandaOS.util.escapeHtml(str)   uid(prefix)   clamp(v,min,max)   debounce(fn,ms)   throttle(fn,ms)
PandaOS.util.formatBytes(n)    formatDate(ts, opts)   formatTime(ts, withSeconds)   formatDateTime(ts)
PandaOS.util.compareNames(a,b) // Turkish, numeric-aware
PandaOS.util.isEditable(el)    // input/textarea/select/contenteditable
PandaOS.util.loadScript(src) -> Promise
```

### Drag & drop of files between modules
Use HTML5 DnD with `dataTransfer.setData('application/x-pandaos-paths', JSON.stringify([absPaths]))`
(also set `text/plain` to the paths joined by `\n`). Desktop and file manager both accept drops
(move into the target folder; hold Ctrl to copy). Dropping on the trash icon trashes.

## 4. Boot (`js/boot.js`) — already written

Order: `storage reset?` → `theme.apply()` → `fs.init()` → `init()` of `contextMenu, notify, dialog,
sound, wm, desktop, taskbar, startMenu, session` (each guarded) → emit `os:init` →
(unless `fast=1`) `await session.bootSplash()` then `await session.lock({initial:true})` →
emit `os:ready` → launch `open=` apps → run `test=` suites.

URL parameters (used by the test tools, also handy for development):

| param | effect |
|---|---|
| `fast=1` | skip boot splash and lock screen |
| `reset=1` | wipe all `pandaos.*` storage before boot (factory state) |
| `theme=light\|dark` | force theme |
| `open=id1,id2` | launch these apps after boot |
| `file=/abs/path` | open this file after boot |
| `test=suite1,suite2` | load `tests/harness.js` + `tests/<suite>.test.js` and run them |

## 5. VFS — `PandaOS.fs` (C1, `js/core/vfs.js`)

Synchronous API over a JSON tree persisted in `PandaOS.storage` key `'fs'`. Paths are absolute,
POSIX style, `/` separated. Names may contain spaces and Turkish characters; not `/`, not empty,
not `.`/`..`. Home: `/home/panda`.

```js
fs.HOME                       // '/home/panda'
fs.init()                     // load from storage, or seed default tree on first run. Idempotent.
fs.reset()                    // wipe and re-seed (factory reset); emits fs:change {type:'reset'}
// path helpers (pure)
fs.normalize(path, cwd = HOME) // resolves '~', '.', '..', relative paths, duplicate slashes → absolute
fs.join(...parts)  fs.dirname(p)  fs.basename(p)  fs.extname(p) /* '.txt' lowercase or '' */
fs.stem(p)                     // basename without extension
fs.displayName(p)              // basename, but '.app' shortcuts lose the extension
// queries
fs.exists(p) -> bool     fs.isDir(p) -> bool     fs.isFile(p) -> bool
fs.stat(p) -> Stat | null
//   Stat = { path, name, type:'dir'|'file', ext, size /*bytes; dirs: total of children*/,
//            created, modified /*ms timestamps*/, childCount /*dirs only*/, hidden /*name starts with .*/ }
fs.list(dir, { hidden = false } = {}) -> Stat[]   // dirs first, then compareNames
fs.readFile(p) -> string
fs.search(query, { root = HOME, limit = 50, hidden = false }) -> Stat[]  // case-insensitive name contains (tr)
fs.walk(dir, fn(stat))                     // depth-first over descendants
fs.usage() -> { used, quota }              // bytes used by the fs storage, approx quota (5 MB)
// mutations (each emits 'fs:change' — see below)
fs.writeFile(p, content)                   // create or overwrite; parent must exist
fs.appendFile(p, content)
fs.mkdir(p, { recursive = false } = {})
fs.rename(p, newName) -> newPath           // same folder
fs.move(src, destDir) -> newPath           // EEXIST if name taken; cannot move dir into itself
fs.copy(src, destDir) -> newPath           // recursive; auto-renames to 'ad (kopya).txt' when needed
fs.remove(p, { recursive = false } = {})   // PERMANENT delete (ENOTEMPTY for non-empty dir w/o recursive)
fs.uniqueName(dir, name) -> name           // 'Yeni Klasör' → 'Yeni Klasör (2)'; keeps extension: 'a (2).txt'
// trash
fs.trash(p) -> trashId                     // moves to trash, remembers original path + time
fs.listTrash() -> [{ id, name, type, size, originalPath, deletedAt }]   (newest first)
fs.restore(id) -> restoredPath             // recreates missing parent dirs; uniqueName on collision
fs.deleteFromTrash(id)   fs.emptyTrash()   fs.trashCount() -> number
fs.FSError                                 // class; instances have .code and a Turkish .message
```

Errors: throw `new fs.FSError(code, message)` with code in
`ENOENT, EEXIST, ENOTDIR, EISDIR, ENOTEMPTY, EINVAL, EPERM, ENOSPC`.
Protected (EPERM on remove/trash/rename/move): `/`, `/home`, `/home/panda`, `/home/panda/Masaüstü`.
Writes that exceed localStorage quota throw `ENOSPC` and leave the fs unchanged.

Event: `PandaOS.bus.emit('fs:change', { type, path, oldPath?, parents })` after every mutation, where
`type ∈ create|write|mkdir|delete|rename|move|copy|trash|restore|trashDelete|emptyTrash|reset|external`
and `parents` = array of affected parent dirs. Views simply re-render on any `fs:change` (cheap).

Seed tree (first run):
```
/bin  /etc/hostname ('pandaos')  /etc/motd  /etc/os-release  /tmp
/home/panda/Masaüstü/   Dosyalar.app Terminal.app Not Defteri.app Hesap Makinesi.app Müzik Çalar.app
                        Mayın Tarlası.app 2048.app Çizim.app Ayarlar.app  Beni Oku.txt
/home/panda/Belgeler/   Notlar.txt  Alışveriş Listesi.txt  Projeler/PandaOS Fikirleri.md
/home/panda/Resimler/   (empty — Paint saves here)
/home/panda/Müzik/      Neşeye Övgü.pmus
/home/panda/İndirilenler/
```
A `.app` file is a desktop shortcut: content `{"appId":"terminal"}` (optionally `"args":{…}`).

A `.pmus` file is a song for the music player (JSON):
```json
{ "title": "Neşeye Övgü", "artist": "L. v. Beethoven", "bpm": 120,
  "tracks": [ { "instrument": "lead",  "notes": [["E4",1],["E4",1],["F4",1],["G4",1],[null,1]] },
              { "instrument": "bass",  "notes": [["C3",2],["G2",2]] },
              { "instrument": "drums", "notes": [["kick",1],["hat",0.5],["snare",1]] } ] }
```
`notes`: `[noteName|null(rest), durationInBeats]`. Note names `C0..B8` with `#`/`b`.
Instruments: `lead, pad, bass, pluck, bell, drums` (drum notes: `kick, snare, hat, clap`).

## 6. Window manager — `PandaOS.wm` (C2, `js/core/wm.js`, `css/wm.css`)

```js
wm.init()
wm.open(opts) -> win
//  opts = { appId, title, icon, width=640, height=440, minWidth=280, minHeight=180, x?, y?,
//           resizable=true, maximizable=true, minimizable=true, maximized=false, className? }
//  Default position: cascade from top-left of the work area, clamped to fit.
wm.list() -> win[]            // all open windows (bottom → top z-order)
wm.get(id) -> win             wm.byApp(appId) -> win[]
wm.getFocused() -> win|null   wm.focus(id)
wm.minimizeAll()              // "show desktop"; calling again restores the windows it minimized
wm.closeAll()
wm.workArea() -> { x, y, width, height }   // area available for windows (above taskbar)
wm.refocus()                  // give DOM focus back to the focused window's last control (no-op without one)
```

`win` object:
```js
win.id  win.appId  win.el /* root .wm-window */  win.body /* content element */
win.state                     // free object for the app
win.setTitle(t)  win.getTitle()  win.setIcon(name)
win.focus()  win.minimize()  win.maximize()  win.restore()  win.toggleMaximize()
win.close()                   // runs beforeClose; returns Promise<boolean closed>
win.forceClose()              // closes without beforeClose
win.isMinimized()  win.isMaximized()  win.isFocused()  win.isClosed()
win.setSize(w, h)  win.setPosition(x, y)  win.getBounds() -> {x,y,width,height}  win.center()
win.on(evt, fn) -> unsubscribe   // evts: close, focus, blur, minimize, restore, maximize,
                                 //       resize ({width,height} of body), keydown (KeyboardEvent)
win.beforeClose = null           // app may set: () => boolean | Promise<boolean>; false cancels close
win.dirty                        // optional boolean: an app that keeps a permanent beforeClose sets dirty=false while it has
                                 // nothing unsaved (undefined counts as unsaved) — the page-unload warning honours it
win.flash()                      // draw attention (taskbar button pulses)
```

- `win.body` has classes `wm-body app-<appId>`; it is `display:flex; flex-direction:column;
  min-height:0; overflow:hidden; background: var(--bg)`. Apps fill it.
- Title bar (≈36px): app icon + title on the left; minimize / maximize-restore / close on the right
  (close turns red on hover). Double-click title bar toggles maximize. Dragging a maximized window
  restores it under the cursor.
- 8-direction resize handles. Windows stay reachable (title bar can't leave the work area).
- Snap: drag cursor to left/right screen edge → half-screen, to top edge → maximize (show a translucent
  preview while dragging).
- Open / close / minimize / restore animations (minimize toward the taskbar button:
  `PandaOS.taskbar?.getButtonRect?.(winId)` → DOMRect|null).
- Focus: mousedown anywhere in a window focuses it and brings it to front. Focusing a window gives
  DOM focus to it (`win.el` has `tabindex=-1`) unless focus is already inside it. Active vs inactive
  title bar styling. Closing/minimizing the focused window focuses the next topmost visible window.
- Focus memory: the wm remembers which control inside each window had DOM focus (a `focusin` listener on the window layer).
  Re-activating a window — taskbar click, minimize/restore, closing the window above it, unlock after the lock screen —
  puts DOM focus back on that control (the caret returns to the textarea), not on the bare window. Focusing the bare
  window itself (clicking blank space) forgets the control. Pressing a title bar never takes focus away from the app.
  `wm.refocus()` re-applies this for the focused window; popups (start menu, tray flyouts) call it when they close.
- Resizing the browser shrinks floating windows too (never below their minWidth/minHeight) and keeps them fully inside
  the work area when they fit.
- Keyboard: wm listens to `document` keydown and emits `'keydown'` on the focused window **only when**
  the session is unlocked (`!PandaOS.session?.isLocked?.()`), no modal dialog is open
  (`!PandaOS.dialog?.isOpen?.()`), and the event target is `document.body` or inside that window.
- Bus events: `wm:open, wm:close, wm:focus, wm:blur, wm:minimize, wm:restore, wm:maximize, wm:title`
  (data = win), plus `wm:change` after any of them (taskbar re-renders on this).

## 7. Session & desktop (C3a)

```js
PandaOS.session.init()
PandaOS.session.bootSplash() -> Promise        // full-screen black, panda logo, "PandaOS", progress ~2 s
PandaOS.session.lock({ initial } = {}) -> Promise  // shows lock screen; resolves when unlocked
PandaOS.session.unlock()  PandaOS.session.isLocked() -> bool
PandaOS.session.restart()                      // close windows → splash → lock
PandaOS.session.shutdown()                     // close windows → "Kapatılıyor…" → black screen, click to power on
// emits 'session:lock', 'session:unlock', 'session:shutdown'

PandaOS.wallpapers          // array [{ id, name, css }], css = CSS `background` shorthand value
PandaOS.wallpapers.css(value) -> string   // value = wallpaper id or 'vfs:/abs/path.png' (data-URL file)
PandaOS.desktop.init()   PandaOS.desktop.refresh()
PandaOS.desktop.DIR         // '/home/panda/Masaüstü'
```

- Desktop = wallpaper (setting `wallpaper`) + icons: a special **Çöp Kutusu** icon (empty/full, opens
  `PandaOS.apps.launch('files', { path: 'trash:' })`) + the entries of `/home/panda/Masaüstü`
  (`.app` shortcuts show the target app's icon and name without extension).
- Lock screen: blurred wallpaper, big clock + Turkish date; click/key reveals avatar, "Panda", password
  field (any or empty password unlocks, hint shown) → unlock animation, startup sound
  (`PandaOS.sound?.play('startup')`). Ctrl+Alt+L locks.

## 8. Taskbar & start menu (C3b)

```js
PandaOS.taskbar.init()
PandaOS.taskbar.getButtonRect(winId) -> DOMRect | null
PandaOS.startMenu.init()  .open()  .close()  .toggle()  .isOpen()
```
Taskbar: start button (panda logo) + pinned apps + running windows (centered group), tray at right:
volume (flyout slider bound to settings `volume`/`muted`), theme toggle (sun/moon), notification bell
(unread badge → notification center panel), clock (time + date; click → calendar flyout), and a
"show desktop" sliver at the far right. Start menu: search (apps + files via `fs.search`), app grid,
user tile, power menu (Kilitle / Yeniden Başlat / Kapat). Notification center lists
`PandaOS.notify.history()`, with "Tümünü temizle" and a Do-Not-Disturb toggle (`dnd` setting).

## 9. UI kit (C4)

```js
// Context menu
PandaOS.contextMenu.show(x, y, items, { onClose } = {})   PandaOS.contextMenu.hide()
//  items: [{ label, icon?, shortcut?, disabled?, checked?, danger?, action?, submenu?: items }
//          | { type: 'separator' }]   — falsy entries are ignored (handy for conditional items)
// Notifications (toasts + history)
PandaOS.notify({ title, message, icon?, appId?, timeout = 5000, actions?: [{label, action}], onClick? }) -> id
PandaOS.notify.dismiss(id)  PandaOS.notify.history() -> [{id,title,message,icon,appId,time,read}]
PandaOS.notify.clear()  PandaOS.notify.markAllRead()  PandaOS.notify.unreadCount()
//  emits 'notify:new' (item) and 'notify:change'. When settings.dnd is true: no toast, history only.
// Dialogs (modal, Promise based)
PandaOS.dialog.alert({ title, message, icon? }) -> Promise<void>
PandaOS.dialog.confirm({ title, message, okText='Tamam', cancelText='İptal', danger=false }) -> Promise<boolean>
PandaOS.dialog.prompt({ title, message, value='', placeholder, okText, validate?: v => errorString|null })
  -> Promise<string|null>
PandaOS.dialog.pickFile({ mode: 'open'|'save', title, dir = HOME, name = '', extensions = [] })
  -> Promise<string|null>   // mini file browser; save mode confirms overwrite
PandaOS.dialog.properties(path)  // info modal: icon, name, type, location, size, created, modified
PandaOS.dialog.isOpen() -> bool
// Hover tooltip (the taskbar's glass tooltip, shared; defined by js/shell/taskbar.js)
PandaOS.ui.tip(el, textOrFn, delay?) -> detach()   // text may contain '
' (first line is bold); text is re-read on every hover;
                                                   // shows above the element, below it when there is no room above
PandaOS.ui.tip.hide()
//  Use it instead of the native `title` attribute (keep aria-label). Falls back to nothing if the taskbar module is absent.
// Accent surfaces (js/ui/contextmenu.js keeps the CSS variables in sync with settings.accent)
PandaOS.ui.accentPair(hex) -> { solid, hover, active, on } | null   // hex strings; `on` is #ffffff or #111111, >= 4.5:1 on `solid`
// Sound (Web Audio, shared)
PandaOS.sound.context() -> AudioContext       // lazily created, resumed on demand
PandaOS.sound.master() -> GainNode            // connect app audio here; follows volume/muted settings
PandaOS.sound.play(name)                      // 'notify'|'error'|'click'|'startup'|'trash'|'shutdown'
                                              // (respects settings.sounds)
```

### Colour tokens for accent surfaces (`css/theme.css`, refined at runtime by `PandaOS.theme.apply()`)
`--accent` is the raw accent: use it for focus rings, slider fills, indicator pills — anything **without text on it**.
For a fill that carries text or a mark (primary buttons, badges, toggled tiles, switch / checkbox fills, "today") use
`background: var(--accent-solid)` + `color: var(--on-accent)` (hover / active: `--accent-solid-hover`, `--accent-solid-active`);
they are derived per accent so the text is always >= 4.5:1. Accent used **as text** (links, highlights) on glass or
panels: `color: var(--accent-text)` (defined in `css/components.css`). `--accent-contrast` equals `--on-accent` and belongs
on `--accent-solid`, not on the raw `--accent`. `PandaOS.theme.accentPair(hex)` returns `{solid, hover, active, on}`.
`--text-faint` is guaranteed >= 4.5:1 on `--bg` / `--bg-elev`; do not fade it further with `opacity`.

### Shared component classes (`css/components.css`, C4) — apps should use these
`.p-btn` (+ `.primary` `.danger` `.ghost` `.icon` `.small`), `.p-input` (text inputs + textarea),
`.p-select`, `.p-range`, `.p-switch` (`<label class="p-switch"><input type="checkbox"><span></span></label>`),
`.p-checkbox`, `.p-toolbar` (+ `.spacer` child), `.p-statusbar`, `.p-sidebar`, `.p-list` > `.p-list-item`
(`.selected`), `.p-tabs` > `.p-tab` (`.active`), `.p-card`, `.p-badge`, `.p-kbd`, `.p-divider`,
`.p-empty` (centered empty state), `.p-spinner`, `.p-segmented` > `button` (`.active`).

## 10. Icons — `PandaOS.icons` (C5, `js/core/icons.js`)

```js
PandaOS.icons.get(name) -> SVG markup string (fallback icon for unknown names; raw '<svg' passes through)
PandaOS.icons.el(name, { size = 24, className } = {}) -> <span class="p-icon">…svg…</span>
PandaOS.icons.has(name) -> bool    PandaOS.icons.forFile(statOrPath) -> name   // folder / file-text / …
```
Colorful (48×48 art): app ids `files terminal notepad calculator music minesweeper game2048 settings paint
taskmanager clock`, plus `trash trash-full folder folder-open file file-text file-code file-image
file-audio file-app computer panda avatar error warning info`.
Glyphs (24×24, `currentColor`, stroke ~1.75): `close minimize maximize restore search chevron-left
chevron-right chevron-up chevron-down arrow-up arrow-left arrow-right refresh plus minus folder-plus
file-plus delete edit copy cut paste info-glyph check x bell bell-off volume volume-low volume-mute
wifi battery power lock restart logout sun moon grid list play pause stop next prev shuffle repeat
home star flag bomb undo redo save open gear palette image note monitor cpu memory time alarm timer
stopwatch globe download upload eye eye-off menu more sort filter desktop document brush eraser
bucket line rect ellipse pencil zoom-in zoom-out terminal-glyph sidebar external`.

## 11. App ids, names, file types

| id | name | icon | singleInstance | fileTypes |
|---|---|---|---|---|
| files | Dosyalar | files | no | (directories) |
| terminal | Terminal | terminal | no | |
| notepad | Not Defteri | notepad | no | .txt .md .log .json .js .css .html .csv (+ fallback) |
| calculator | Hesap Makinesi | calculator | no | |
| music | Müzik Çalar | music | yes | .pmus |
| minesweeper | Mayın Tarlası | minesweeper | yes | |
| game2048 | 2048 | game2048 | yes | |
| settings | Ayarlar | settings | yes | |
| paint | Çizim | paint | no | .png |
| taskmanager | Görev Yöneticisi | taskmanager | yes | |
| clock | Saat | clock | yes | |

Special path for the file manager: `PandaOS.apps.launch('files', { path: 'trash:' })` opens the trash.
Settings accepts `{ page: 'appearance'|'wallpaper'|'sound'|'notifications'|'storage'|'about' }`.

Images (`.png`) are stored as data-URL strings (`data:image/png;base64,…`) in file content.

## 12. Testing (`tests/harness.js`, `tools/test.sh`, `tools/shot.sh`)

- `bash tools/test.sh <suite>[,<suite>] ["extra=query&params"]` → runs headless Chrome on
  `index.html?fast=1&reset=1&test=<suite>`, prints pass/fail per test **and every JS error /
  console.error captured during boot and tests**. Exit code 0 = all passed and no errors.
- `bash tools/shot.sh <out.png> "<query params>" [1440x900]` → headless screenshot (read the PNG to
  look at it). Example: `bash tools/shot.sh /tmp/calc.png "fast=1&open=calculator&theme=light"`.
  Combine with `test=<suite>` to drive UI state before the shot (the harness is invisible).
- `tests/<suite>.test.js` uses the global `PandaTest`:
```js
PandaTest.test('name', async (t) => { … });
t.ok(cond, msg)  t.eq(actual, expected, msg) /*deep*/  t.throws(fn, code?)  await t.sleep(ms)
await t.waitFor(() => cond, timeout = 3000)  t.$(sel, root)  t.$$(sel, root)
t.click(el)  t.dblclick(el)  t.contextmenu(el)  t.mouse(el, type, {clientX, clientY, button, ctrlKey…})
t.key(target, key, {ctrlKey, shiftKey, altKey})   // keydown+keyup; target defaults to activeElement
t.type(el, text)                                  // sets value char by char + input events
t.drag(el, dx, dy)                                // pointer/mouse down-move-up sequence
```
  Tests should clean up after themselves (close windows they open).

## 13. Integration notes (behaviour verified by `tests/integration.test.js`)

Extras that exist on top of the contract above — apps may rely on them, but must stay defensive (`?.`) when calling other modules.

- **Window manager:** `wm.blurAll()` deactivates the focused window (the desktop calls it on a wallpaper click; clicking any
  window focuses it again). `win.snap('left'|'right')`, `win.isSnapped()`, `win.getIcon()`, bus events `wm:snap`, `wm:move`, `wm:flash`.
  With `?fast=1` all window animations are skipped (tests/screenshots).
- **Unsaved work:** a window that may veto closing sets `win.beforeClose = () => boolean | Promise<boolean>` (typically it shows a
  `PandaOS.dialog.confirm` and saves). `session.shutdown()` / `session.restart()` call `win.close()` on every such window (topmost
  first) before anything else; a `false` answer cancels the whole shutdown/restart. Windows without `beforeClose`, and everything
  when the machine is shut down from the lock screen, are force-closed.
- **Dialogs:** `dialog.closeAll()` cancels every open dialog (used on shutdown/restart). While the session is locked, open dialogs
  stay behind the lock screen and ignore keyboard/focus; they are still open after unlock.
- **Notifications:** `notify.remove(id)` is an alias of `notify.dismiss(id)`; both also remove the history entry. Opening the
  notification center dismisses the toasts on screen (the history keeps them); while it is open a new notification is added to
  its list (marked read) instead of showing a toast. Clicking a toast opens its `appId` app unless `onClick` is given. `notify.history()`
  is newest first.
- **Launch args used by the shell:** desktop "Terminalde aç" → `apps.launch('terminal', { cwd })`; wallpaper/personalize menu items →
  `apps.launch('settings', { page: 'wallpaper' | 'appearance' })`; trash icon → `apps.launch('files', { path: 'trash:' })`;
  `.app` shortcut → `apps.launch(appId, args)`; start-menu file results → `apps.openFile(path)`; a notification with `appId` → `apps.launch(appId)` when clicked (toast or notification center).
- **Drops from the real computer:** the desktop imports dropped text/image files; anywhere else a dropped file is ignored (the page
  never navigates away). An app that wants such drops cancels `dragover` and `drop` itself.
- **Layers:** every overlay layer is `pointer-events: none` when idle (checked exhaustively by the integration suite); a window
  that is minimized or closing never captures clicks.
- **Keyboard focus after popups / lock:** closing the start menu or a tray flyout (Escape, or clicking the button that opened
  it) and unlocking the session hand DOM focus back to the active window's last control (`wm.refocus()`); with no active
  window the desktop (or the tray button) gets it. Keys only reach a window's `keydown` listeners when focus is inside it or on `<body>`.
- **Desktop icons:** hover details use `PandaOS.ui.tip` (no native `title`); `P.desktop.tipText(key)` returns the text.
  When there are more entries than fit the visible grid, the icon area scrolls sideways (`.desk-scroll`, wheel too)
  and `P.desktop.grid()` keeps reporting the visible `cols` x `rows`. A Desktop entry renamed from anywhere keeps its cell.
  With "Masaüstü simgelerini göster" off the desktop ignores the keyboard.
- **Unsaved work on page unload:** a `beforeunload` guard asks the browser to confirm when any window has `beforeClose` and
  `dirty !== false`. A shutdown / restart picked on the lock screen always goes through, even if an earlier request
  is still waiting for a "save?" dialog.
- **Other browser tabs:** `pandaos.settings`, `pandaos.notifications`, `pandaos.desktop.layout` and the fs are re-read on
  `storage` events, so a second PandaOS tab never overwrites the first one's changes.
- **Test tooling:** `tests/integration.test.js` registers *stand-in* apps for any app id that is not registered yet (so the shell can
  be exercised before/without the real apps) and has screenshot scenes (`shot=desktop|windows|snap|start|search|calendar|quick|
  notifications|ctx|ctxicon|confirm|alert|picker|toasts|taskbar|e2e`). The icons gallery stays in the DOM only when `icons` is the
  last suite in `test=`. `integration` also contains a seeded random walk over the whole UI (`fuzzseeds=1,2,3&fuzzsteps=300` for
  more). `node tools/e2e.mjs` (env `THEME`, `OUT`) replays boot → lock → desktop → windows → taskbar with real mouse/keyboard input
  through the DevTools protocol (needs Node 22+ and Chrome/Edge) and saves screenshots.
