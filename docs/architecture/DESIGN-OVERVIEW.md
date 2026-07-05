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

## 0. How to read this file

This file has two layers, on purpose:

- **YAML frontmatter (`---` block at the top)** — machine-readable design
  tokens (exact hex values, font stacks, spacing scale, radius scale,
  shadows, motion timings, component recipes). Design agents (Stitch,
  Figma plugins, future codegen tools) read this and apply it verbatim.
  When you change a value, change it here **and** in
  `src/renderer/src/styles/*.css` / `src/renderer/src/index.css` so the running
  app and this file stay in sync.
- **Markdown body** — the human-readable *why*. Design intent,
  principles, anti-patterns, and per-screen rules. This is what a
  contributor reads when they're deciding whether a new screen is
  on-brand.

Treat the frontmatter as the source of truth for values and the
markdown as the source of truth for judgment. If they ever conflict,
the frontmatter wins, and the markdown needs an update.

---

## 1. Project at a glance

SciForge is a local desktop workbench for agentic project work.
SciForge Runtime is the default runtime, and Codex app-server is an optional runtime
that must be selected explicitly. The desktop shell is Electron; SciForge Runtime is
a TypeScript package that speaks HTTP/SSE; Codex is hosted by the main
process through JSON-RPC stdio; the renderer is React 19 + Zustand 5
and consumes both through the neutral AgentRuntime contract. The visual
system is TailwindCSS 3 with a hand-built token layer on top.

The product is **not** another chat shell. It exists to let a real
agent do real work in a real project on a real machine, with the
human staying in the loop on every mutating call.

**Two workbenches plus connected entry points, one runtime contract:**

| Surface | Job to be done |
| --- | --- |
| **Code** | Bound to a local repo, drives the agent through tool calls, file changes, commands, and review. |
| **Write** | A long-form writing space: Markdown files, Model Router-backed inline completion, selection-scoped inline agent. |
| **Connect phone** | Background automation: platform-neutral remote channels, phone-connection webhooks / relay, scheduled tasks. UI state lives in the chat route; persistent settings use `remoteChannel` and `connectPhone`. |

All product surfaces share the same AgentRuntime boundary and settings
choice. SciForge Runtime remains the default path; Codex is used only after explicit
selection. Both share the same visual system. Any runtime path that needs an
LLM provider API uses the local Model Router as its only provider boundary.

---

## 2. Design principles

These six rules are not aspirations — they are how the product is
already built. New screens must follow them, not re-interpret them.

1. **One runtime contract, explicit runtime choice.** Code, Write, and
   Connect phone all enter through AgentRuntime. SciForge Runtime is the default
   adapter behind that contract; Codex is optional and never a silent
   fallback. The renderer never embeds an agent loop or talks to backend
   transports directly.
2. **Local-first, observable, controllable.** Settings, sessions,
   and runtime state live on disk under the OS app-data folder.
   Every tool call, file change, and reasoning step is shown in
   the UI. The user can interrupt, approve, deny, or revert at any
   point.
3. **No legacy agent switcher, no runtime console.** The product
   intentionally does not surface old provider diagnostics or
   model-control panels in the main canvas. Runtime selection belongs in
   Settings, and it may only select SciForge Runtime or Codex.
4. **The renderer maps AgentRuntime events, it does not implement agent
   logic.** Approvals, steering, compaction, fork, resume, usage, and
   runtime status come through the AgentRuntime contract, never as
   duplicated agent behavior in React.
5. **Stable visual identity, not visual novelty.** A new screen
   should look like a sibling of an existing one, not a fresh
   experiment. New components earn their place by replacing
   multiple existing ones, not by adding a new style.
6. **Calm by default.** The default surface is a near-white (or
   near-black) canvas with restrained surfaces, no chroma in the
   chrome, and a single accent that only appears on actionable
   elements. Status, danger, and skill are the only other colors
   you may reach for.

---

