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

## 8. Data persistence (renderer + main)

| Data | Where | Format | Owner |
| --- | --- | --- | --- |
| Settings | OS app-data dir | JSON | `JsonSettingsStore` (main) |
| Session list / workbench layout | `localStorage` | JSON | Renderer |
| Write thread registry | `localStorage` | JSON | Renderer |
| GUI plan registry | `localStorage` (`sciforge.plan.registry.v1`) | JSON | Renderer |
| Remote-channel connections | OS app-data dir | JSON | `JsonSettingsStore` |
| Threads / turns / events | `~/.sciforge/runtime` | JSON + JSONL | SciForge Runtime |
| Usage counters | SciForge Runtime data dir | JSON | SciForge Runtime |
| Skill / MCP files | SciForge Runtime data dir + workspace | Markdown / JSON | SciForge Runtime + renderer |
| GUI logs | OS app-data dir / `log/` | NDJSON | `logger.ts` |
| Inline completion debug | OS app-data dir | NDJSON | `write-inline-completion-service.ts` |

Default OS app-data paths:

- macOS: `~/Library/Application Support/SciForge`
- Windows: `%APPDATA%\SciForge`
- Linux: `~/.config/SciForge`

Uninstalling the app does not remove app data. Documented in
the README and respected by the install script.

---

## 9. Key subsystems

### 9.1 Tool execution & approval

- `LocalToolHost`
  holds the registered tools and their policies. Policies:
  `auto`, `on-request`, `suggest`, `never`, `untrusted`.
- A tool with `shouldAdvertise(ctx)` is gated at the listing
  layer too — this is how `create_plan` stays scoped to plan
  threads.
- Approval requests emit a `RuntimeEvent` of kind
  `approval_requested`; the GUI shows the approval block and
  POSTs the decision to `/v1/approvals/{id}`. The agent loop
  resumes on `allow`, errors out on `deny`.

### 9.2 Plan mode

Plan threads expose a `create_plan` tool. The renderer advertises
a `GuiPlanContext` on the active turn, the loop gates the tool,
the model writes a Markdown plan, and the renderer stores it as a
`GuiPlanArtifact`. The `Build` button promotes a plan artifact
into a new `agent`-mode thread, preserving the plan as the
opening turn.

Plan-mode prompt injection sits *after* the immutable prefix as
a second system message, so the cached prefix is untouched.

### 9.3 Context compaction

`ContextCompactor` estimates token count, folds long histories
into a single `compaction` item, and always preserves the
immutable prefix's pinned constraints. Soft threshold 16k
tokens, hard threshold 24k tokens. The GUI renders the
compaction block inline with a "show replaced" detail.

### 9.4 Write-mode completion & RAG

- **Router-backed short completion** — debounced 650 ms, max 96 tokens,
  min accept score 0.52. Used while typing.
- **Inspirational long completion** — debounced 2.8 s, max
  256 tokens, min accept score 0.36. Used at sentence/paragraph
  boundaries.
- **RAG** — write workspace Markdown files are indexed
  on-demand with BM25 + keyword match; relevant snippets are
  injected as hidden Markdown comments.
- **Selected-text inline agent** — selected text is captured
  with file path and line range, then submitted as a
  structured prompt. The agent returns Markdown edits the
  user can apply or ignore.
- **Export** — `write-export-service.ts` converts the current
  Markdown document to HTML / PDF / DOC / DOCX, preserving
  headings, lists, code blocks, tables, and local images.

### 9.5 Remote channel automation

- The main-process remote channel bridge creates and reuses threads through the
  configured AgentRuntime. SciForge Runtime remains the default mapping for migrated
  data; non-SciForge Runtime background execution currently fails closed until native
  adapter support exists, and must not write Codex thread ids into SciForge Runtime mappings.
- The phone-connection adapter sits behind the platform-neutral
  remote-channel boundary. Vendor-specific SDK details stay behind
  that implementation boundary; user-facing copy and public API names
  stay vendor-neutral. Install is device-flow QR code; the renderer
  polls `connectPhone:install:poll` until authorized.
- Webhook / relay is a small HTTP server in the remote channel bridge that
  POSTs inbound webhooks into the configured runtime thread.
- Scheduled tasks are detected from natural-language remote-channel
  prompts (`scheduled-task-detector.ts`) and stored under
  `schedule.tasks` in settings.
- The managed `schedule-mcp-node-entry` hosts schedule tools over MCP
  through the `gui_schedule` worker entry, hiding the macOS dock icon
  when running headless.

### 9.6 Updater

`electron-updater` driven by `gui-updater.ts`. Channels:
`stable`, `beta`, `nightly`. The Settings page surfaces state
and check / download / install actions. macOS / Windows only;
Linux users build from source.

### 9.7 Logging

`logger.ts` writes structured NDJSON to the OS app-data log
directory. The renderer can open the log dir, and `log:error`
lets any UI surface report a category / message / detail
tuple. A startup trace is enabled by
`SCIFORGE_STARTUP_TRACE=1` and prints to stdout for
postmortem timing.

---

## 10. Security model

- **Auth** — every `/v1/*` request carries
  `Authorization: Bearer <runtime-token>` unless the runtime
  was started with `--insecure` (local dev only). The token is
  generated and stored in settings.
- **Approval policy** — `auto` (default), `on-request`,
  `untrusted`, `never`, `suggest`. Per-tool policies can override.
- **Sandbox mode** — `read-only` / `workspace-write` (default) /
  `danger-full-access` / `external-sandbox`. Enforced by the
  workspace inspector and the file/tool adapters.
- **Renderer isolation** — `contextIsolation: true`, no
  `nodeIntegration`, no `webviewTag` exposure. The renderer
  only sees the `window.sciforge` API surface.
- **External links** — `openExternal` is the only way to leave
  the app; URLs are validated against an allow-list.
- **Markdown rendering** — `rehype-harden` strips unsafe
  nodes. Code blocks go through `shiki` with a fixed theme.
- **Settings file** — written atomically, debounced, never
  read on the renderer side. Legacy `codewhale` / `reasonix`
  keys are migrated to `agents.sciforge` once and discarded; Codex may only
  appear under `agents.codex` after explicit user configuration.

---

## 11. Constraints (do not violate)

These are enforced by `docs/AGENTS.md` and reflect real product
decisions. New work must respect them.

- **User-selectable local agent runtime.** SciForge Runtime is default; Codex is
  optional and must be selected explicitly. No implicit fallback, no
  legacy CodeWhale / Reasonix process path.
- **No UI surface for runtime internals.** No AgentSwitcher,
  no ConnectionStatusBar, no RuntimeDiagnosticsDialog, no
  RuntimeInsightsPanel, no `/usage` or `/runtime` slash
  command.
- **Saved settings only contain `agents.sciforge` and `agents.codex`.**
  Old keys may only appear in migration.
- **Renderer does not implement agent logic.** Approvals,
  steering, compaction, fork, resume, usage — all come from
  the active runtime boundary, never re-implemented in React.
- **No new drawing / design starter card** in the core
  workbench.
- **No emoji in production copy or as functional UI
  affordance.**

If a feature request appears to require violating a constraint,
escalate before coding.

---

## 12. Extension guide

When you need to add a new capability, follow this path. It's
intentionally boring.

1. **Add the protocol field.** New Zod schema in the local-runtime
   contracts. Run `npm run build:local-runtime`.
2. **Add the agent behavior.** In the local-runtime loop,
   services, or a new port + adapter pair.
3. **Add the HTTP route.** New route under the local-runtime HTTP
   server, registered in its route index.
4. **Map the endpoint / event through AgentRuntime.** Add or update the
   shared contract as needed, then map SciForge Runtime behavior in
   `src/main/runtime/local-runtime-agent-runtime-adapter.ts` and renderer display in
   `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`.
5. **Add runtime settings only under `agents.sciforge` or
   `agents.codex`.** Anything else gets migrated away.
6. **Add i18n strings to both `zh` and `en` locale files.**
7. **If the surface needs a new visual element, add it to
   this file's YAML frontmatter first.** Don't invent tokens
   in the JSX.
8. **Verify** with `npm run typecheck && npm test && npm run
   build`.

---

## 13. Verification

Minimum checks for any change to the design, runtime, or
build:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke (full list in `docs/AGENTS.md`):

- Code: create thread, stream reply, approve / deny, interrupt.
- Write: open workspace, request inline completion, run
  selected-text agent.
- Connect phone: save settings, run a manual SciForge Runtime task, and verify non-SciForge Runtime
  background execution fails closed without corrupting SciForge Runtime mappings.
- Settings → Agents: shows SciForge Runtime and Codex, with SciForge Runtime selected by default.
- Cache telemetry on a hot thread should stay ≥ 90% hit.

If any check fails, the change is not ready.

---

## 14. Key files index

| Concern | File |
| --- | --- |
| App lifecycle | `src/main/index.ts` |
| Runtime contract | `src/shared/agent-runtime-contract.ts` |
| Runtime host | `src/main/runtime/agent-runtime/host.ts` |
| SciForge Runtime adapter | `src/main/runtime/local-runtime-agent-runtime-adapter.ts`, `src/main/runtime/local-runtime-adapter.ts` |
| Codex adapter | `src/main/runtime/codex/codex-agent-runtime-adapter.ts`, `src/main/runtime/codex/` |
| Child process | `src/main/local-runtime-process.ts` |
| Settings | `src/main/settings-store.ts`, `src/shared/app-settings.ts` |
| IPC | `src/main/ipc/register-app-ipc-handlers.ts`, `src/main/ipc/app-ipc-schemas.ts` |
| SciForge API | `src/preload/index.ts`, `src/shared/sciforge-api.ts` |
| Agent provider | `src/renderer/src/agent/agent-runtime-provider.ts`, `src/renderer/src/agent/registry.ts` |
| Event mapping | `src/renderer/src/agent/agent-runtime-event-dispatcher.ts` |
| App shell | `src/renderer/src/AppShell.tsx` |
| Workbench | `src/renderer/src/components/Workbench.tsx` |
| Chat store | `src/renderer/src/store/chat-store.ts` |
| Remote channel bridge | `src/main/remote-channel-runtime.ts` |
| Write services | `src/main/services/write-*-service.ts` |
| Workspace/editor services | `src/main/services/workspace-*.ts`, `src/main/services/workspace-editors.ts` |
| Tokens / styles | `src/renderer/src/styles/*.css`, `src/renderer/src/index.css` |
| Agent loop | SciForge Runtime loop |
| Immutable prefix | SciForge Runtime cache module |
| HTTP routes | SciForge Runtime HTTP routes |
| Tool host | SciForge Runtime local tool host |
| Model client | SciForge Runtime model client |
| Cache doc | `docs/local-runtime-cache-optimization.md` |
| Runtime contract doc | `docs/agent-runtime-contract.md` |
| Architecture doc | `docs/local-runtime-architecture.md` |
| Contribution doc | `docs/local-runtime-contributing.md` |

---

## 15. References

- `docs/agent-runtime-contract.md` — neutral SciForge Runtime/Codex runtime
  contract, event model, capability model, and migration cleanup conditions.
- `docs/local-runtime-architecture.md` — SciForge Runtime runtime architecture and
  GUI拆改范围.
- `docs/local-runtime-cache-optimization.md` — cache hit rate
  measurement, stable prefix rules, tool pair healing.
- `docs/local-runtime-contributing.md` — port & adapter / FCIS
  patterns, four PR archetypes.
- Local runtime package README — CLI flags, env vars, data dir layout,
  HTTP API.
- `docs/AGENTS.md` — agent runtime notes (constraints enforced
  on contributors).
- `README.md` / `README.en.md` — product-level overview.

This file is the design source of truth. When the code and this
file disagree, **this file is wrong** until you change both.
