---
# DESIGN.md frontmatter — machine-readable design tokens for design agents
# (e.g. Stitch, Figma plugins). Values are extracted from the live
# codebase (src/renderer/src/styles/*.css + src/renderer/src/index.css), not
# invented. Anything not in this block is editorial, not authoritative.

schema_version: 1
project: SciForge
default_runtime: sciforge
optional_runtimes: [codex]
themes: [light, dark, system]

# ---------- 1. Palette (raw hex from --ds-* tokens) ----------
palette:
  light:
    bg_app: "#f5f7fa"            # --bg-app / --ds-bg-main
    bg_sidebar: "#f4f7fb"         # --bg-sidebar / --ds-bg-sidebar
    bg_canvas: "#fbfcfe"          # --ds-bg-canvas
    surface_card: "rgba(255,255,255,0.90)"   # --ds-surface-card
    surface_elevated: "rgba(255,255,255,0.98)"
    surface_subtle: "#eef2f7"     # --ds-surface-subtle
    surface_hover: "rgba(15,23,42,0.055)"
    border: "rgba(15,23,42,0.12)" # --ds-border
    border_muted: "rgba(15,23,42,0.08)"
    border_strong: "rgba(15,23,42,0.18)"
    text: "#222222"               # --ds-text
    text_muted: "#5f6878"
    text_faint: "#8a93a4"
    text_placeholder: "#949dad"
    accent: "#0088ff"             # --ds-accent
    accent_soft: "rgba(0,136,255,0.14)"
    bubble_user: "rgba(0,0,0,0.06)"
    bubble_user_fg: "#222222"
    success: "#128a4a"
    success_soft: "rgba(17,185,129,0.14)"
    danger: "#c92a2a"
    danger_soft: "rgba(239,68,68,0.12)"
    diff_added: "#128a4a"
    diff_added_soft: "rgba(18,138,74,0.10)"
    diff_removed: "#c92a2a"
    diff_removed_soft: "rgba(201,42,42,0.10)"
    skill: "#7c3aed"
    skill_soft: "rgba(124,58,237,0.12)"
    warning_soft: "rgba(245,158,11,0.14)"
    selection: "rgba(0,136,255,0.18)"
    scrollbar_thumb: "rgba(95,104,120,0.22)"
    scrollbar_thumb_hover: "rgba(95,104,120,0.32)"
  dark:
    bg_app: "#101010"
    bg_sidebar: "#141414"
    bg_canvas: "#181818"
    surface_card: "rgba(24,24,24,0.92)"
    surface_elevated: "#202020"
    surface_subtle: "#202020"
    surface_hover: "rgba(255,255,255,0.10)"
    border: "rgba(255,255,255,0.10)"
    border_muted: "rgba(255,255,255,0.10)"
    border_strong: "rgba(255,255,255,0.16)"
    text: "#ffffff"
    text_muted: "#c7c7c7"
    text_faint: "#858585"
    text_placeholder: "#7a7a7a"
    accent: "#339cff"
    accent_soft: "rgba(51,156,255,0.18)"
    bubble_user: "rgba(255,255,255,0.08)"
    bubble_user_fg: "#ffffff"
    success: "#40c977"
    success_soft: "rgba(64,201,119,0.18)"
    danger: "#fa423e"
    danger_soft: "rgba(250,66,62,0.18)"
    diff_added: "#40c977"
    diff_added_soft: "rgba(64,201,119,0.16)"
    diff_removed: "#fa423e"
    diff_removed_soft: "rgba(250,66,62,0.16)"
    skill: "#ad7bf9"
    skill_soft: "rgba(173,123,249,0.16)"
    warning_soft: "rgba(245,158,11,0.18)"
    selection: "rgba(51,156,255,0.24)"
    scrollbar_thumb: "rgba(170,170,170,0.28)"
    scrollbar_thumb_hover: "rgba(200,200,200,0.38)"

# ---------- 2. Typography ----------
typography:
  family:
    sans: "SF Pro Text, 'PingFang SC', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif"
    display: "SF Pro Display, 'PingFang SC', 'Noto Sans SC', sans-serif"
    mono: "SF Mono, 'JetBrains Mono', 'IBM Plex Mono', monospace"
  size_scale_px:  # values actually used in JSX
    [9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 24, 30]
  size_rhythm:
    caption: 11
    label_small: 11.5
    chip: 10
    chip_md: 12
    body_sm: 12.5
    body: 13
    body_lg: 14
    body_xl: 14.5
    title_sm: 15
    title: 16
    title_lg: 18
    display: 24
    hero: 30
  weight_scale: [400, 500, 600, 700]
  leading:
    tight: 5
    snug: 6
    normal: 7
  tracking:
    normal: 0
    wide: 0.04
  ui_zoom_factor:
    small: 0.82
    medium: 0.88
    large: 1.00
  # Where each scale is used:
  usage:
    hero: "Welcome card, marketing-style headings"
    title_lg: "Topbar session title, settings section H2"
    title: "Card titles, dialog title"
    title_sm: "Strong inline label"
    body_xl: "Settings subtitle, session header sub"
    body_lg: "Primary form input text, list row primary"
    body: "Default body, button text, table cell"
    body_sm: "Secondary metadata, list row secondary"
    label_small: "Tab label, table header"
    caption: "Helper text, hint line"
    chip: "Status chip, tag"

# ---------- 3. Spacing & sizing ----------
spacing:
  base_unit_px: 4
  scale: [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12]
  # Tailwind px values: 1=4 1.5=6 2=8 2.5=10 3=12 4=16 5=20 6=24 8=32
  card_padding:
    tight: "px-3 py-2"     # 12x8
    normal: "px-4 py-3"    # 16x12
    loose: "px-5 py-4"     # 20x16
  block_gap: [1, 1.5, 2, 2.5, 3]
  # Fixed panel sizes (from Workbench.tsx defaults)
  layout:
    left_sidebar_default_px: 268
    left_sidebar_min_px: 236
    left_sidebar_max_px: 420
    right_inspector_default_px: 360
    right_inspector_min_px: 280
    right_inspector_max_px: 760
    sidebar_hard_min_px: 180

# ---------- 4. Border radius ----------
radius:
  scale_px: [4, 6, 8, 10, 12, 14, 16, 18, 22, 28, 9999]
  alias:
    sm: 6        # rounded-md
    md: 8        # rounded-lg
    lg: 12       # rounded-xl — most card surfaces
    xl: 14       # tailwind xl
    "2xl": 16    # rounded-2xl
    "2.5xl": 18  # rounded-[18px] — topbar dropdown
    "3xl": 22    # rounded-3xl
    composer: 28 # .ds-chat-composer
    pill: 9999   # rounded-full — chip / pill button / avatar
  usage:
    chip: pill
    pill_button: pill
    avatar: pill
    card_default: lg
    dialog: "3xl"
    topbar_dropdown: "2.5xl"
    composer: composer
    inline_code: sm
    icon_only_button: md

# ---------- 5. Elevation (shadows + dark-mode shadows) ----------
elevation:
  light:
    chip: "inset 0 1px 0 rgba(255,255,255,0.78)"
    card_soft: "0 10px 28px rgba(15,23,42,0.06)"
    card_strong: "0 14px 36px rgba(15,23,42,0.09)"
    panel: "0 16px 44px rgba(15,23,42,0.06)"
    shell: "0 12px 30px rgba(15,23,42,0.08)"
    composer: "0 18px 46px rgba(15,23,42,0.10), 0 5px 16px rgba(15,23,42,0.06)"
    dropdown: "0 18px 52px rgba(15,23,42,0.18)"
    topbar: "0 16px 42px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.64)"
  dark:
    chip: "inset 0 1px 0 rgba(255,255,255,0.045)"
    card_soft: "0 16px 42px rgba(0,0,0,0.22)"
    card_strong: "0 22px 56px rgba(0,0,0,0.30)"
    panel: "0 22px 58px rgba(0,0,0,0.35)"
    shell: "0 38px 96px rgba(0,0,0,0.55)"
    composer: "0 28px 78px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)"
    dropdown: "0 22px 58px rgba(0,0,0,0.38)"
    topbar: "0 18px 44px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.07)"

# ---------- 6. Motion ----------
motion:
  timing_ms:
    micro: 140       # hover bg, border, color
    standard: 150     # card hover, transform
    deep: 300
  easing: ease       # mostly linear ease
  special:
    pulse: 1800      # ms, ease-in-out, infinite (logo / status dot)
    shiny_text: 2400 # ms, ease-in-out, infinite (streaming shimmer)
  transform:
    card_lift: "translateY(-1px)"
    button_press: "scale(0.985)"
  when_to_use:
    micro: "chip hover, menu item hover, focus ring swap"
    standard: "card hover, composer border on focus, topbar glass"
    deep: "modal open, route transition"

# ---------- 7. Z-index ----------
z_index:
  background: -2
  background_overlay: -1
  base: 0
  sticky: 10
  dropdown: 50
  modal: 100
  toast: 200

# ---------- 8. Window chrome & layout container ----------
window:
  app_region: drag           # html/body/-webkit-app-region
  no_drag_class: ds-no-drag  # add to anything clickable in the title bar
  macos_top_inset_px: 42     # safe area for traffic-light controls
  app_icon: src/asset/img/sciforge.png
  secondary_logos: [sciforge-icon.svg]

# ---------- 9. Iconography ----------
icons:
  library: lucide-react
  default_size_px: 16
  common_sizes_px: [14, 16, 18, 20, 24]
  color: currentColor

# ---------- 10. Component patterns (the recurring building blocks) ----------
components:
  card:
    base: "border border-ds-border bg-ds-card rounded-xl shadow-sm"
    strong: "border-ds-border-strong bg-ds-elevated shadow-[ds-shadow-card-strong] backdrop-blur-xl"
  button_primary:
    base: "inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
    shadow: "0 10px 24px rgba(0,136,255,0.22)"
  button_secondary:
    base: "inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
  button_pill:
    base: "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition"
  input:
    base: "w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
  chip:
    base: "inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent"
    muted: "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted bg-ds-subtle shadow-sm"
  user_bubble:
    base: "rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm"
  code_inline:
    base: "rounded-md bg-ds-inline-code-bg px-1.5 py-0.5 font-mono text-[12px] text-ds-ink"
  code_block:
    base: "rounded-xl border border-ds-border-muted bg-ds-pre-bg p-3 font-mono text-[12px] leading-5 text-ds-ink"
  status_dot:
    base: "h-2 w-2 rounded-full bg-accent animate-pulse"
  kbd:
    base: "rounded bg-ds-kbd-bg px-1.5 py-0.5 font-mono text-[11px] text-ds-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
  modal:
    container: "fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    panel: "w-full max-w-md rounded-3xl border border-ds-border bg-ds-elevated p-6 shadow-[ds-shadow-panel]"

# ---------- 11. Topography & gradient backgrounds ----------
backgrounds:
  app_gradient_light: "linear-gradient(180deg, #fbfcfe 0%, #ffffff 100%)"
  app_gradient_dark: "linear-gradient(180deg, #101010 0%, #181818 100%)"
  sidebar_gradient_light: "linear-gradient(180deg, rgba(248,251,254,0.98) 0%, rgba(242,247,252,0.98) 100%)"
  sidebar_gradient_dark: "linear-gradient(180deg, #181818 0%, #141414 45%, #101010 100%)"
  topbar_gradient_light: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.58) 58%, rgba(255,255,255,0.30) 100%)"
  topbar_gradient_dark: "linear-gradient(180deg, rgba(32,32,32,0.86) 0%, rgba(24,24,24,0.70) 58%, rgba(18,18,18,0.42) 100%)"
  body_glaze_light: "linear-gradient(180deg, rgba(255,255,255,0.50), transparent 22%), linear-gradient(120deg, rgba(255,255,255,0.22), transparent 34%, rgba(255,255,255,0.12) 74%, transparent)"
  body_glaze_dark: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 24%), linear-gradient(120deg, rgba(255,255,255,0.03), transparent 35%, rgba(255,255,255,0.02) 72%, transparent)"
  composer_glow: "radial-gradient(circle at top left, rgba(0,136,255,0.07), transparent 28%), radial-gradient(circle at right 14% bottom 18%, rgba(0,136,255,0.04), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.08), transparent 28%)"

# ---------- 12. i18n & copy tone ----------
i18n:
  locales: [zh, en]
  default: zh
  tone: "helpful, direct, never robotic; first-person plural when describing product ('we ship'), second-person for the user. No emoji in production copy."
  error_format: "human sentence ending in punctuation; never raw stack traces"

# ---------- 13. Brand & voice ----------
brand:
  product_name: "SciForge"
  tagline: "把 SciForge Runtime 的本地智能体能力带进桌面窗口"
  hero_kw: [Code, Write, Connect phone]
  pillars:
    - "本地优先 (Local-first): settings, sessions, logs all on disk; runtime model calls go through the local Model Router."
    - "可观察 (Observable): every tool call, file change, reasoning step surfaces in the UI."
    - "可控制 (Controllable): approval policy + sandbox mode + interrupt + revert."
  voice: "Direct, no marketing fluff. Show what the agent did, not how great it is."

# ---------- 14. Accessibility ----------
a11y:
  focus_ring: "1px ring-1 ring-accent/30 with 40% accent border"
  focus_visible_only: true
  hit_target_min_px: 32
  contrast_target: WCAG_AA
  selection_color: var(--ds-selection)
  respects_prefers_reduced_motion: false
  keyboard_shortcuts:
    Enter: "send message"
    Shift_Enter: "newline in composer"
    Ctrl_Enter: "send message"
    Esc: "close panel / dismiss popover"

# ---------- 15. Don't (anti-patterns enforced by the codebase) ----------
dont:
  - "Add an implicit runtime fallback; SciForge Runtime is default and Codex must be selected explicitly."
  - "Add AgentSwitcher / ConnectionStatusBar / RuntimeDiagnosticsDialog."
  - "Add CodeWhale/Reasonix adapters, process managers, RPC bridges, updaters, importers."
  - "Add a design/drawing starter card in the core workbench."
  - "Add /usage or /runtime slash command that opens a runtime control panel."
  - "Save settings under agents.codewhale or agents.reasonix; only agents.sciforge and agents.codex are valid."
  - "Use emoji in production copy or as functional UI affordance."
  - "Apply a tint or hue that isn't in the palette above."
  - "Use a font outside the three declared families."
  - "Use a border radius smaller than 4px on a clickable surface."
---

# SciForge — DESIGN.md

> 单一权威设计文档。所有屏幕、所有组件、所有视觉决策,都从这里出。

---

## 4. Top-level architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React 19 + Zustand 5)                             │
│  AppShell  →  Workbench  →  (Code | Write | Connect phone) UI│
│       │                                                      │
│       │ AgentRuntimeProvider                                │
│       │ window.sciforge.agentRuntime.*                      │
│       ▼                                                      │
│ Preload (contextBridge, contextIsolated)                    │
│  window.sciforge.* IPC surface                              │
│       │                                                      │
│       ▼                                                      │
│ Main process (Node)                                          │
│  AgentRuntimeHost  →  local-runtime adapter                  │
│                    →  CodexAgentRuntimeAdapter               │
│  Settings / Connect phone runtime / Terminal / Updater / Logger│
│       │                                                      │
│       │ spawn child process + runtime transport              │
│       ▼                                                      │
│ SciForge Runtime: HTTP/SSE, cache-first AgentLoop           │
│ Codex: app-server JSON-RPC stdio, GUI thread store          │
│       │                                                      │
│       │ HTTPS to local Model Router                          │
│       ▼                                                      │
│ Model Router /v1 chat/completions                          │
│ Upstream providers stay behind the router                   │
└─────────────────────────────────────────────────────────────┘
```

Three lessons baked into this shape:

1. The renderer **does not know** which runtime it talks to
   beyond neutral AgentRuntime capabilities. SciForge Runtime is the default;
   Codex must be selected explicitly in Settings.
2. The main process **does not implement agent logic**. It
   hosts adapters, forwards SciForge Runtime HTTP/SSE or Codex JSON-RPC stdio, and
   owns GUI-only services (settings, updater, Connect phone runtime,
   workspace
   files, external editors, and Write export/completion) that the
   renderer can ask for.
3. The runtime adapter **is** the boundary. SciForge Runtime keeps its loop, tool
   host, stores, model client, and server behind HTTP/SSE. Codex keeps
   app-server state and normalization behind `src/main/runtime/codex/`.
   Renderer code consumes the shared contract documented in
   `docs/agent-runtime-contract.md`.

---


## 6. Desktop shell (Electron)

### 6.1 Process roles

- **Main** (`src/main/`) — Node process. Owns the SciForge Runtime
  child process, settings store, updater, Connect phone runtime,
  file/git/editor helpers, Write services, IPC handlers, logger,
  GUI updater, macOS/Windows code-signing glue.
- **Preload** (`src/preload/`) — `contextBridge` surface.
  Exposes a typed `window.sciforge` API to the renderer. No Node
  access leaks into the renderer.
- **Renderer** (`src/renderer/`) — Chromium process. React 19
  SPA. Runs Code / Write / Connect phone UIs.

### 6.2 Module layout

```text
src/
  main/
    index.ts                        # app entry, IPC wiring, lifecycle
    ipc/                            # app IPC handlers and Zod schemas
    runtime/                        # runtime adapter (process, host, port, token)
    services/                       # git, workspace, editor, write-* services
    settings-store.ts               # JSON-backed settings store
    remote-channel-runtime.ts       # remote channel / webhook / scheduled-task bridge
    schedule-mcp-*                  # schedule MCP config + node-entry server
    gui-updater.ts                  # electron-updater integration
    logger.ts                       # structured logger
    resolve-local-runtime-binary.ts # CLI / dev-script / packaged binary resolver
  preload/
    index.ts                        # contextBridge surface (window.sciforge)
    index.d.ts                      # API type definitions
  shared/                           # types + constants shared by main and renderer
  renderer/
    src/
      App.tsx                       # Suspense shell
      AppShell.tsx                  # routes Workbench / Settings / InitialSetup
      agent/                        # Runtime-neutral AgentProvider/client
      components/                   # Workbench, Settings, ChangeInspector, …
      hooks/
      lib/                          # formatters, helpers, plan store, etc.
      locales/{zh,en}/              # i18n
      plan/                         # Plan-mode prompt, store, panel
      store/                        # Zustand chat store + actions
      write/                        # Write-mode workspace, inline edit, RAG
```

### 6.3 The SciForge API Surface

`window.sciforge` is the only thing the renderer is allowed to call
on the system. It includes:

- `agentRuntime.*` — neutral connect/capabilities/thread/turn/event/control
  API defined by `docs/agent-runtime-contract.md`.
- `getSettings` / `setSettings` — typed settings I/O.
- Workspace / file / git helpers (`pickWorkspaceDirectory`,
  `listWorkspaceDirectory`, `readWorkspaceFile`,
  `writeWorkspaceFile`, `watchWorkspaceFile`, `getGitBranches`,
  `switchGitBranch`, `createAndSwitchGitBranch`).
- Terminal (`createTerminalSession`, `writeTerminalSession`,
  `resizeTerminalSession`, `closeTerminalSession`,
  `onTerminalData`, `onTerminalExit`).
- Write-mode services (`exportWriteDocument`,
  `requestWriteInlineCompletion`,
  `listWriteInlineCompletionDebugEntries`,
  `clearWriteInlineCompletionDebugEntries`).
- Connect phone / remote channel (`getConnectPhoneStatus`,
  `startConnectPhoneInstallQr`,
  `pollConnectPhoneInstall`, `createRemoteChannelTaskFromText`,
  `onRemoteChannelActivity`).
- Schedule (`getScheduleStatus`, `runScheduleTask`,
  `createScheduleTaskFromText`).
- Shell / notifications / updater / logger (`openExternal`,
  `showTurnCompleteNotification`, `getGuiUpdateState`,
  `checkGuiUpdate`, `downloadGuiUpdate`, `installGuiUpdate`,
  `onGuiUpdateState`, `logError`, `getLogPath`, `openLogDir`).

Every method on this surface is typed in `src/shared/sciforge-api.ts`
and validated at the IPC boundary by Zod schemas in
`src/main/ipc/app-ipc-schemas.ts`.

### 6.4 The runtime adapter

The main process owns runtime selection through `AgentRuntimeHost`.
It reads `activeAgentRuntime`, defaults to SciForge Runtime, and delegates to Codex
only after explicit user selection:

- The local-runtime adapter maps the shared contract to SciForge Runtime
  HTTP/SSE. SciForge Runtime child process startup, port, token, and config remain
  behind `localRuntimeAdapter`.
- `CodexAgentRuntimeAdapter` maps the shared contract to the
  app-server service under `src/main/runtime/codex/`. JSON-RPC,
  server request registry, event normalization, and thread/event stores
  stay in that module boundary.
- Runtime request/SSE and renderer `codex:*` IPC bypasses are removed. New
  capabilities must go through the neutral AgentRuntime contract or a narrow
  typed `window.sciforge` method.

---

## 7. Renderer (React 19 + Zustand 5)

### 7.1 Top-level shape

```text
App
  └── AppShell  (Suspense)
        ├── Workbench          (routes: chat / write / plugins / schedule; Connect phone is a chat panel)
        │     ├── Sidebar      (left, drag-resizable, 268 px)
        │     ├── Topbar       (translucent glass strip)
        │     ├── Center column
        │     │     ├── MessageTimeline  (Code / Connect phone)
        │     │     └── WriteMarkdownEditor (Write)
        │     ├── Right inspector  (optional, 360 px)
        │     │     ├── ChangeInspector
        │     │     ├── TodoPanel
        │     │     ├── DevBrowserPanel
        │     │     ├── PlanPanel
        │     │     ├── WorkspaceFilePreviewPanel
        │     │     ├── WriteAssistantPanel
        │     │     └── SddAssistantPanel
        │     ├── PluginMarketplaceView  (route = 'plugins')
        │     └── ScheduleTasksView      (route = 'schedule')
        ├── SettingsView       (route = 'settings')
        └── InitialSetupDialog (first-run)
```

### 7.2 State

A single `useChatStore` (Zustand) holds all renderer state. The
store is split into modules under `src/renderer/src/store/`:

- `chat-store.ts` — main store, route, thread list, workbench
  panels, status flags.
- `chat-store-types.ts` — the store's TS surface.
- `chat-store-app-actions.ts`, `chat-store-remote-channel-actions.ts`,
  `chat-store-side-actions.ts` — action creators grouped by
  domain.
- `chat-store-runtime-helpers.ts` — pure helpers around the
  runtime.
- `chat-store-schedulers.ts` — busy watchdog, completion poll,
  startup probe.

Persistence is layered:

- `localStorage` — UI-only state (panel sizes, collapsed flags,
  composer model, write thread registry, code workspace roots,
  fork registry).
- `electron-store` (main) — settings, Connect phone config, write
  workspace config.
- `~/.sciforge/runtime` (SciForge Runtime) — threads,
  events, sessions, usage.

### 7.3 The AgentProvider interface

The renderer talks to the runtime through one interface,
`AgentProvider` (`src/renderer/src/agent/types.ts`). The default
implementation is `AgentRuntimeProvider`, which calls
`window.sciforge.agentRuntime` and dispatches shared `AgentRuntimeEvent`
objects into `ThreadEventSink` / `ChatBlock`.

`getProvider()` (in `registry.ts`) returns a single cached registry
provider backed by `AgentRuntimeProvider`. SciForge Runtime and Codex renderer-side
provider splits are removed; optional SciForge Runtime-only surfaces go through the
neutral `agentRuntime.auxiliary` bridge and unsupported runtimes fail
closed by capability.
`resetProviderCacheForTests()` exists for unit tests and must not be
called outside of them.

### 7.4 Workbench internals

`Workbench.tsx` is the central layout component. It reads the
current route from the store, lays out the left sidebar, center
surface, and optional right inspector, and lazy-loads the heavy panels
(`ChangeInspector`, `TodoPanel`, `PlanPanel`, `WorkspaceFilePreviewPanel`,
`DevBrowserPanel`, `PluginMarketplaceView`, `ScheduleTasksView`)
via `React.lazy`. Panel sizes and the selected right-panel mode are persisted to `localStorage`
under `sciforge.layout.*` keys.

The chat timeline is a virtualized list of `ChatBlock`s. Each
block kind has its own renderer:

- `user` / `assistant` — markdown, with a streaming shimmer on
  the assistant block.
- `reasoning` — collapsible block with monospace text.
- `tool` — file_change, command_execution, tool_call, with
  inline detail and a "show in inspector" action.
- `compaction` — fold summary.
- `approval` — pending / allowed / denied / error states.
- `user_input` — structured question with option buttons.
- `system` — informational messages (e.g. runtime up, runtime
  down, model switched).

### 7.5 Workbench routes, one store

The store distinguishes the main workbench and entry routes through `route`
(`chat`, `write`, `plugins`, `schedule`) plus thread metadata. Connect phone
is represented as `route: 'chat'` with explicit panel/remote-channel state, so it does
not introduce a second chat-like route. Switching does not change the runtime
contract, only which renderer and local workflow state the store pulls in.

- **Code** — default mode, full agent flow, workspace roots,
  todo panel, changes inspector, plan panel, file preview, and dev browser.
- **Write** — write-thread registry isolates Write sessions
  from Code / Connect phone sessions per active runtime, using a
  separate `WRITE_ASSISTANT_THREAD_TITLE` namespace. Inline
  completion and selected-text agent go through dedicated
  main-process services.
- **Connect phone** — remote channel registry. Each remote-channel connection has its
  own thread id, model, workspace root, runtime id, and runtime-specific thread
  mapping. Background remote-channel execution still fails closed for non-SciForge
  Runtime until the local runtime adapter supports it; it must not write Codex thread
  ids into SciForge Runtime mappings.

---

