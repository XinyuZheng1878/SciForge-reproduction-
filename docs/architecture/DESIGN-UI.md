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

## 3. How the project should look and feel

> **This section is the editorial companion to the YAML frontmatter
> above.** Values in the frontmatter are the contract; values here
> are the *why* and the *when*.

### 3.1 The "feel" in one paragraph

A near-paper canvas (light) or near-charcoal canvas (dark), a single
**blue accent** that only lights up when the user can act on
something, pill-shaped chrome on a desktop title bar, generous
whitespace, layered translucent surfaces that read as "glass", and
text that is dense but never crowded. The product feels like a
**calm professional tool** — closer to a code editor than to a
chat app. It must not feel like a marketing site.

### 3.2 Canvas, surface, elevation

The renderer paints two layers behind the chrome:

- **Base canvas** (`--ds-bg-canvas`, `#ffffff` light / `#181818` dark)
  is the central work area. The chat timeline, the writing editor,
  and the file tree all live on this canvas.
- **Surrounding surface** (`--ds-bg-main`, `#f5f7fa` light / `#101010`
  dark) is the app shell. Sidebars, topbar, and inspectors
  rest on it. The contrast between canvas and surface is
  intentionally small — about 4% — so the eye reads them as one
  workspace, not two zones.

On top of those, three translucent glass surfaces stack:

- `ds-card` / `ds-surface-card` — cards, list rows, popover triggers.
- `ds-elevated` / `ds-surface-elevated` — dialogs, dropdowns, the
  composer shell, anything that must lift off the page.
- `ds-subtle` / `ds-surface-subtle` — quiet secondary surfaces
  (e.g. settings tabs that are not currently active).

Glass effect is achieved with `backdrop-blur-xl` (24px) plus a faint
`inset 0 1px 0 rgba(255,255,255,0.45)` highlight on chips, and the
topbar carries a 3-stop vertical gradient
(`topbar_gradient_light` / `topbar_gradient_dark`) so the title bar
reads as a soft glass strip.

A subtle body glaze (`body_glaze_light` / `body_glaze_dark`)
sits on `body::after` to add a soft directional light without ever
introducing a new color.

### 3.3 Color, when to use it

The accent is **electric blue** (`#0088ff` light / `#339cff` dark).
Use it for *exactly* these things:

- The primary action button ("Send", "Allow", "Save").
- A focused form control's border + ring.
- Status dots that mean "this is live and doing something".
- Hyperlink-style chip labels (e.g. a feature flag toggle).
- Selection background (`--ds-selection`).

Do **not** use accent for:

- Decorative background fills larger than a chip.
- Body text or headings.
- Disabled state — disabled elements are *opacity 0.45*, not
  recolored.

Other named colors are reserved for their semantic:

- `--ds-success` / `--ds-success-soft` — completed tools, cached
  read, OK health pings.
- `--ds-danger` / `--ds-danger-soft` — failed tools, denied
  approvals, errors, retry badges.
- `--ds-skill` / `--ds-skill-soft` — anything related to a user-loaded
  Skill (purple is the "this came from a plugin" hue).
- `--ds-diff-added` / `--ds-diff-removed` — file change diff blocks.
  These are the **only** colors that may sit side-by-side on a code
  block.
- `--ds-warning-soft` — non-fatal warnings (e.g. token cache
  missing, retry-pending).

Everything else — text, borders, the canvas itself, the sidebar —
stays in the neutral palette. If a screen needs more than accent
plus these named semantic colors, it is probably a sign the
information architecture should change first.

### 3.4 Typography

Three families, and only three:

- **Sans (body)**: SF Pro Text → PingFang SC → Noto Sans SC → Helvetica
  Neue → Arial. The product is bilingual (zh + en), so the cascade
  covers macOS, Windows, and Linux. Set as
  `body { font-family: ... }` in `index.css`.
- **Display (hero, welcome)**: SF Pro Display, same CJK fallback.
  Used sparingly — only in welcome cards and modal hero copy.
- **Mono**: SF Mono → JetBrains Mono → IBM Plex Mono. Used for code
  blocks, inline code, kbd hints, command lines, model ids,
  and tool result detail.

The size rhythm in `typography.size_rhythm` is the only allowed
ladder. If you find yourself reaching for `text-[15.5px]` you're
probably between two rungs — pick the closer one or restructure.

Default `leading` is `leading-relaxed` for body prose, `leading-5`
or `leading-6` for compact UI lists, and tight (`leading-tight`)
only for hero headings. Never `leading-none` except in chips.

`tracking-wide` is reserved for the small uppercase section labels
(`text-[11px] font-semibold uppercase tracking-wide text-ds-faint`)
that appear above settings groups. Nothing else uses letter-spacing.

### 3.5 Spacing & rhythm

The product uses Tailwind's default 4-px scale. Three rules:

1. **Card padding is `px-3 py-2` (tight) or `px-4 py-3` (normal).**
   `px-5 py-4` is reserved for hero cards and full-screen modals.
2. **Inline element gap is `gap-1` to `gap-3`.** Beyond `gap-4`,
   you're starting a new region; use vertical margin instead.
3. **Section spacing is `mt-3` to `mt-6`.** Anything tighter than
   `mt-3` should be `gap-*` on a flex parent; anything wider than
   `mt-6` should probably be a new card or a divider.

The fixed three-pane layout sizes are part of the design system,
not an accident. Don't let a new screen override the sidebar
defaults — that's what `--ds-layout-left-sidebar-width` is for.

### 3.6 Radius, shape, and "softness"

The product reads as **soft but not round**. Pill controls (`rounded-full`)
on the title bar, large `rounded-xl` / `rounded-2xl` cards in the
body, and a single oversized `rounded-[28px]` shell for the
composer. Smaller radii (`rounded-md`, `rounded-lg`) appear on
inline code, kbd, and icon-only buttons.

Two hard rules:

- **No square corners on a clickable surface.** Minimum 6px.
- **No fully-rounded corners on a card surface.** Cards are
  `rounded-xl` to `rounded-3xl`, never pill-shaped.

### 3.7 Elevation & shadow

Three elevation tiers, in increasing depth:

1. **Card soft** — list rows, side panels, in-page popovers.
   Subtle, single shadow.
2. **Card strong / panel** — modals, dropdowns, the composer.
   Deeper shadow + `backdrop-blur-xl` to read as "lifted glass".
3. **Shell** — the main app shell, the welcome screen, the
   settings root. Largest shadow, used sparingly.

Chips and pill buttons get an *inset* highlight
(`inset 0 1px 0 rgba(255,255,255,0.78)` light) so they look pressed
out of a glass surface, not painted onto one.

Never use a colored shadow. All shadows are black or near-black
with low alpha.

### 3.8 Motion

Motion is **functional, not decorative**. It exists to:

- Confirm a click (button press, focus ring swap) — 140 ms.
- Reveal a hover state (card lift, chip background) — 150 ms.
- Smooth a route or panel change — 200-300 ms.
- Indicate liveness (status dot, streaming shimmer) — looped, 1.8-2.4 s.

Two looped animations exist in the system:

- `pulse` on status dots and the work logo.
- `ds-shiny-text` on streaming assistant text (a 2.4s linear
  shimmer, not a typewriter).

Everything else is one-shot. Do not animate entry/exit of dialogs
beyond a 200ms opacity+scale. Do not animate hover on rows
containing many cells. Do not animate the composer.

### 3.9 Layout grammar

Every screen in SciForge follows the same macro-grammar:

- **Topbar**: a translucent strip with the back button, session
  title, mode switcher, and right-side action cluster. The topbar
  is *always* draggable for window move; interactive elements
  inside it must opt out with `.ds-no-drag`.
- **Left sidebar**: workspace roots (Code) / channels (Connect phone) /
  spaces (Write). Collapsible, drag-resizable, 268 px default.
- **Center column**: the work surface — message timeline (Code /
  Connect phone) or editor (Write). Never bleed into the sidebars.
- **Right inspector**: optional, context-driven — Changes,
  Todo, Browser, Plan, File, Write Assistant, and SDD Assistant.
  Drag-resizable, 360 px default. The Write assistant and SDD
  assistant both use this slot.

A new screen should fit into this grammar. If it can't, that is a
signal the grammar needs to grow — and the change goes in this file
first.

### 3.10 Voice and copy

- The product is bilingual. Strings live under
  `src/renderer/src/locales/{zh,en}/` and are loaded through
  `react-i18next`. New strings ship in both locales at the same
  time.
- Tone is direct, helpful, and slightly opinionated. First-person
  plural when describing the product ("we ship", "we ship Code,
  Write, and Connect phone"), second person for the user. No emoji. No
  marketing language. Error messages are full sentences ending in
  punctuation; never a raw stack trace.
- The product name is "SciForge". The runtime is "SciForge Runtime".
  The main workbenches are "Code" and "Write"; the phone/IM surface is
  "Connect phone" in English and "连接手机" in zh copy.

### 3.11 Theme switching

Three modes: `system`, `light`, `dark`. The choice is in Settings →
General. `system` listens to `prefers-color-scheme` and updates
live. The theme is applied as `data-theme` on `<html>`; Tailwind
`dark:` variants and CSS custom properties both pick it up. UI
font scale is independent (small / medium / large) and is applied
as a CSS `--ds-ui-scale` zoom factor.

Every new screen must work in both themes without per-screen
overrides. The token system is the contract.

### 3.12 What "on-brand" looks like — quick test

Before shipping a new screen, run this checklist:

- [ ] Sits in the standard three-pane + topbar grammar (or
      explicitly extends it in this file).
- [ ] Uses only the four families of color (neutral, accent,
      status, skill/diff).
- [ ] Uses only the three font families and the size rhythm.
- [ ] Uses the radius ladder (no square clickables, no round cards).
- [ ] Uses elevation tiers, not custom shadows.
- [ ] All interactive elements have a focus ring (`ring-1
      ring-accent/30`).
- [ ] Strings exist in both `zh` and `en` locale files.
- [ ] No emoji, no marketing copy, no extra runtime surface.
- [ ] No agent switcher, no legacy provider diagnostics panel, no legacy
      CodeWhale/Reasonix import.

If any box is unchecked, fix it before merging.

---

