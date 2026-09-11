# Handoff: Emails — Split Triage (Parade OS)

## Overview
A redesign of the **Emails** section of Parade OS (a Notion-style workspace where an
agency runs client spaces: projects, tasks, invoices, meetings). This direction —
**"Split triage"** — replaces the old two-page flow (a full-width list, then a separate
detail page) with a single **master–detail split screen**:

- **Left pane** — a compact, scrollable list of email threads with filters.
- **Right pane** — the selected thread's reading view, topped by an **"À valider"**
  review panel where the user validates/rejects everything the AI extracted from the
  thread: **tasks, contacts, and entities** (extensible to projects).

Selecting a row in the left pane swaps the right pane. The goal is to read, triage,
and turn a thread into structured Parade objects without leaving the screen.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype
showing intended look and behavior, **not production code to ship as-is**. The task is to
**recreate this design in the target codebase's environment** (React, Vue, etc.) using its
established components, state, and data layer. If no front-end environment exists yet,
choose the most appropriate framework and implement it there.

The prototype uses a small internal template runtime (`support.js`) and a `class Component`
with a `renderVals()` method. **Ignore that runtime** — it is a prototyping convenience.
Read `renderVals()` as a plain description of the data shapes and derived view-state the UI
needs, and re-implement it idiomatically.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interaction states
are all specified via the Paradeos design tokens (see `tokens/`). Recreate the UI
pixel-faithfully using the codebase's own components mapped onto these token values.
Copy (all French) is final and can be used verbatim.

## How to run the prototype
Open `Emails - Split Triage.dc.html` in a browser. It loads the design tokens from
`tokens/` (bundled here), Phosphor icons from CDN, and Google Fonts. Click any thread in
the left list to switch the detail pane; hover a review row to reveal Invalider/Valider;
use "Tout valider" / "Tout rejeter" at the panel header.

---

## Layout

Full-viewport app shell, three regions left→right:

```
┌────────────┬─────────────────────────────────────────────────────────┐
│  SIDEBAR   │  TOPBAR (search · bell · avatar)                         │
│  240px     ├──────────────────┬──────────────────────────────────────┤
│  fixed     │  LIST PANE       │  DETAIL PANE                          │
│            │  396px fixed     │  flex, min-width:0, scrolls           │
│            │  scrolls         │  inner content max-width 840px        │
└────────────┴──────────────────┴──────────────────────────────────────┘
```

- Root: `display:flex; height:100vh; width:100vw; overflow:hidden`.
- Sidebar `240px` fixed; main column `flex:1; min-width:0; flex-direction:column`.
- Topbar `height:58px`, bottom hairline border, `padding:0 24px`.
- Split row `flex:1; min-height:0; display:flex`.
- List pane `width:396px; flex:none`, right hairline border, `background:#FBFBFA` (surface).
- Detail pane `flex:1; min-width:0; overflow-y:auto`; content wrapper `padding:24px 30px 40px; max-width:840px`.

4px spacing grid throughout. Hairline separators are `1px solid var(--border)` (`#E3E3E0`).

---

## Screens / Views

### 1. Sidebar (shared app chrome)
- **Purpose:** primary navigation. "Emails" is the active item.
- **Layout:** vertical stack, `padding:12px 10px; gap:2px`.
- **Brand:** 28×28 rounded-8 square, `background:var(--primary-500)`, white Fraunces "P",
  next to the Fraunces wordmark "Parade" (`font-size:19px; weight:600`).
- **Nav rows:** icon + label, `padding:7px 8px; radius:6px; font-size:14px; white-space:nowrap`.
  - Active row ("Emails"): `background:var(--primary-50)`, text `var(--primary-900)`,
    icon `var(--primary-700)`, weight 500.
  - Inactive rows: text `var(--text-muted)`, icon `var(--primary-500)`, weight 400.
    Hover → `background:var(--bg-hover)`.
  - Order + Phosphor (duotone) icons: Dashboard `ph-house`, Projets `ph-briefcase`,
    Pipeline `ph-funnel`, Time tracking `ph-clock`, Meetings `ph-microphone`,
    **Emails `ph-envelope-simple`**, CRM `ph-users`, Compta `ph-calculator`,
    Coworking `ph-buildings`.
- **Footer:** "Parade SAS — Lyon", `var(--type-caption)`, `var(--text-tertiary)`.

### 2. Topbar
- Search field: `width:400px`, `background:var(--bg-surface)`, `1px var(--border)`,
  `radius:8px`, `padding:8px 12px`; `ph-magnifying-glass` + placeholder "Rechercher…"
  + a `⌘K` mono key hint chip.
- Right: `ph-bell` (20px, `var(--text-muted)`) + 30px round avatar "PY"
  (`background:var(--tint-red-bg)`, text `var(--tint-red-text)`).

### 3. List pane
- **Header** (`padding:16px 16px 13px`, bottom border, `gap:12px`):
  - Title "Emails" (Fraunces, 20px, 600) + count pill "11"
    (`background:var(--primary-50)`, text `var(--primary-900)`, round).
  - Two 30×30 icon buttons (bordered, radius 7): `ph-sparkle` (primary) and `ph-tag` (muted).
  - **Filter pills** (flex, `flex-wrap:wrap`, `gap:6px`): four segmented pills
    `À traiter · 11` (active), `Tous · 183`, `Facturation · 9`, `Bruits · 163`.
    - Active pill: `background:var(--primary-500)`, white text, count chip
      `background:rgba(255,255,255,.22)`.
    - Inactive: `background:var(--bg-app)`, `1px var(--border)`, text `var(--text-muted)`,
      count chip `background:var(--bg-hover)`.
    - Icons: À traiter `ph-sparkle`, Tous `ph-tray`, Facturation `ph-receipt`,
      Bruits `ph-speaker-simple-slash`.
  - In-list search: `background:var(--bg-app)`, bordered, radius 8, placeholder
    "Filtrer dans « À traiter »…".
- **Row** (`er-row`, `padding:13px 16px 13px 19px`, bottom hairline, `cursor:pointer`,
  hover `background:var(--bg-hover)`):
  - A 3px full-height **left accent bar** (absolute, left:0): selected row →
    `var(--primary-500)`; unselected-but-unread → `var(--primary-200)`; else transparent.
  - Selected row also gets `background:var(--bg-hover)`.
  - **Line 1:** optional 7px unread dot (`var(--primary-500)`), subject
    (`font-size:13.5px`; weight 600 if unread else 500; single-line ellipsis), date
    (`var(--type-caption)`, `var(--text-tertiary)`).
  - **Line 2:** avatar cluster (19px circles, overlap `margin-left:-5px`, 1.5px surface
    ring) + snippet (caption, muted, single-line ellipsis).
  - **Line 3:** optional project chip (folder icon + label, tinted per project) · spacer ·
    optional AI-task pill "N tâche(s)" (`background:var(--primary-50)`, `ph-fill ph-sparkle`)
    · optional "N msgs" mono count (only when thread has >1 message).

### 4. Detail pane
- **Header:** subject `<h2>` (Fraunces, 23px, 600, line-height 1.22) + a bordered
  "Ouvrir sur Gmail" button (`ph-arrow-square-out`, muted). No breadcrumb.
- **"À valider" review panel** (shown when the thread has ≥1 extracted item):
  - **Panel header** (flex, wrap, `gap:8px`): title "À valider" (17px, 600) +
    caption "extrait par l'IA de ce thread" + status count chips + right-aligned
    "Tout rejeter" and "Tout valider" buttons.
    - Pending chip: `var(--tint-yellow-bg)`/`text`, leading yellow dot, "N en attente".
    - Validated chip: `var(--tint-green-bg)`/`text`, `ph-check`, "N validé(s)".
    - Invalidated chip: `var(--tint-red-bg)`/`text`, `ph-x`, "N invalidé(s)".
    - "Tout rejeter": `var(--tint-red-bg)`/`text`. "Tout valider":
      `var(--tint-green-bg)`/`text` + `inset 0 0 0 1px var(--tint-green-dot)`.
  - **Item rows** (bordered container radius 11, rows split by hairline). Each row is one
    extracted object with a **type**:
    - **Leading indicator:** when pending → duotone **type icon** in `var(--primary-500)`
      (task `ph-list-checks`, contact `ph-user`, entité `ph-buildings`, projet
      `ph-briefcase`). When resolved → a 30px filled circle: green `ph-check` if validated,
      red `ph-x` if invalidated.
    - **Title** (`var(--type-ui-medium)`) + a pending-only "Nouvelle tâche / Nouveau
      contact / Nouvelle entité" badge (`var(--tint-green-bg)`/`text`, `ph-plus-circle`,
      `white-space:nowrap`). Invalidated title → `var(--text-tertiary)` + `line-through`.
    - **Meta chips** (`flex-wrap`, `gap:6px`, each `nowrap`): small tinted/neutral chips.
      - Task chips: assignee (`ph-user` "Pierre-Yves", neutral) + project chip (tinted).
      - Contact chips: role (`ph-identification-badge`) + company (`ph-buildings`), neutral.
      - Entité chip: descriptor (`ph-tag`), neutral. Neutral chip = `background:var(--bg-app)`,
        `1px var(--border)`, text `var(--text-muted)`. When invalidated, meta `opacity:.55`.
    - **Row actions:**
      - Pending → three controls: pencil "Éditer" (icon-only 32px), **Invalider**
        (`var(--tint-red-bg)`/`text`), **Valider** (`var(--tint-green-bg)`/`text` + inset
        green ring). Invalider/Valider are icon buttons whose text label expands on hover
        (`max-width` 0→120px, opacity 0→1, ~160ms `cubic-bezier(0.2,0,0,1)`).
      - Resolved → a single 32px "undo" button (`ph-arrow-counter-clockwise`) bordered in
        the state color, to revert back to pending.
- **Message card** (`border`, radius 12, `background:var(--bg-app)`, `padding:19px 21px`):
  - Header row: 38px round sender avatar (initials, tinted) + name (`ui-medium`) + email
    (caption, tertiary) + recipients line "À : …" (caption, tertiary) + date/time (caption,
    tertiary, right).
  - Body: stacked paragraphs, `var(--type-body)`, `var(--text-muted)`,
    `white-space:pre-line` (signatures keep their line breaks).
  - Footer (top hairline): "Répondre" (primary filled, `ph-arrow-bend-up-left`) +
    "Transférer" (bordered, muted).

---

## Interactions & Behavior
- **Select thread:** click a list row → set `active = <thread id>`; detail pane re-renders
  for that thread; the row shows the primary left bar + hover background.
- **Validate / invalidate an item:** click Valider or Invalider on a review row → set that
  item's state to `valid` / `reject`. Clicking the same action again toggles back to
  `pending`. Resolved rows collapse their actions to a single undo button.
- **Bulk:** "Tout valider" / "Tout rejeter" set every review item in the current thread to
  `valid` / `reject`.
- **Header status chips** recompute live from item states (pending/validated/invalidated
  counts); a chip hides when its count is 0.
- **Hover states:** nav rows and list rows deepen one neutral step to `var(--bg-hover)`;
  Invalider/Valider reveal their text label; icon buttons highlight to `var(--bg-hover)`.
- **Motion:** quiet, 120–160ms, ease `cubic-bezier(0.2,0,0,1)`. No bounce/scale.
- **Real behavior to wire in production** (mocked in the prototype): "Ouvrir sur Gmail"
  (deep-link to the thread), "Éditer" (inline edit of an extracted item before creation),
  Répondre/Transférer, and search/filter querying. Validating an item should create the
  corresponding Parade object (task / CRM contact / entity / project) and link it to the
  thread; invalidating discards the suggestion.

## State Management
Per-view state needed:
- `active: string` — id of the currently selected thread (default: first / `"thermigo"`).
- `itemStates: Record<itemId, "pending" | "valid" | "reject">` — validation state for every
  AI-extracted item across threads (default pending). Toggling an already-set state returns
  it to pending.

Derived per active thread (compute, don't store): the review list (tasks + extras merged),
and pending/validated/invalidated counts + their labels. In a real app these come from the
backend's extraction results; here they're static fixtures.

Data fetching (production): list of threads (subject, participants, snippet, date, message
count, linked project, category), the selected thread's full body, and its AI-extracted
items grouped by type. Mutations: set-item-state (create/link or discard), reply/forward.

## Design Tokens
All values reference the Paradeos tokens in `tokens/` (loaded by the prototype). Key ones:

**Surfaces / neutrals**
- `--bg-app #FFFFFF` · `--bg-surface #FBFBFA` · `--bg-sidebar #F7F7F5`
- `--bg-hover #EFEFED` · `--bg-press #E7E7E4`
- `--border #E3E3E0` · `--border-strong #D6D5D1`

**Text**
- `--text #37352F` · `--text-muted #605C54` · `--text-tertiary #9B9890` (never pure black)

**Brand primary (blue)**
- `--primary-50 #E7F3F8` · `--primary-200 #8FC0DA` · `--primary-400 #3E94BE`
- `--primary-500 #1F6F95` (THE primary) · `--primary-700 #185A7C` · `--primary-900 #10384E`

**Categorical tints** (each = pale bg + same-family dark text + saturated dot). Used here:
- green `--tint-green-bg #EDF3EC` / `-text #3F6B43` / `-dot #5E9B63` (validated / paid)
- red `--tint-red-bg #FBE9E7` / `-text #9B3530` / `-dot #CE5A52` (invalidated / avatar)
- yellow `--tint-yellow-bg #FBF3DB` / `-text #8A6A1A` / `-dot #C9A227` (pending)
- mauve `-bg #F2EEFA` / `-text #5E4B8B` / `-dot #9B82CE` (Thermigo project)
- blue `-bg #E7F3F8` / `-text #28617E` / `-dot #4A93B8` (Flow Boreal project)
- orange `-bg #FAEBDD` / `-text #9A5E26` / `-dot #C2702F` (PrevandCare project)
- gray `-bg #F1F0EE` / `-text #605C54` / `-dot #908D85` (Bruit)
- Tints encode a **category, not a hierarchy**. Never black text on a tint; never a
  full-saturation block.

**Typography**
- Brand/display: **Fraunces** (`--font-brand`) — wordmark, page/section titles.
- UI/body: **Hanken Grotesk** (`--font-sans`). Mono figures: **JetBrains Mono** (`--font-mono`).
- Roles used: `--type-ui` 14/1.35, `--type-ui-medium` 14/1.35 w500, `--type-body` 15/1.55,
  `--type-caption` 12/1.35, `--type-mono` 13. Ad-hoc sizes above are px-exact.
- Sentence case everywhere; wide-tracked all-caps only for tiny section eyebrows.

**Radii:** tags/chips 6px · buttons/inputs 7–8px · cards 11–12px · avatars/dots fully round.
Small radii; **never pill-shaped buttons.**

**Borders / shadows:** resting surfaces get a hairline ring only (no drop shadow). Shadows
are reserved for floating elements (popovers/dialogs).

## Iconography
[Phosphor Icons](https://phosphoricons.com), **duotone** weight for objects/nav
(`ph-duotone ph-*`), **bold** weight for small action glyphs (`ph-bold ph-check/x/plus-circle`),
**fill** for the tiny sparkle in task pills (`ph-fill ph-sparkle`). Size 16–20px in the UI,
~11–13px in dense chips/rows. No emoji, no hand-drawn SVG. The prototype loads the webfont
from CDN; in production use your icon system with the equivalent Phosphor glyphs.

## Assets
- **No raster/image assets.** Avatars are initials on tint backgrounds; the brand mark is a
  Fraunces "P" on `--primary-500`.
- **Fonts:** Fraunces, Hanken Grotesk, JetBrains Mono (Google Fonts, imported by
  `tokens/fonts.css`). Fraunces (brand) + the UI/mono pairing are the chosen Paradeos type
  system — swap for licensed equivalents if the codebase already ships them.
- **Icons:** Phosphor webfont via `unpkg.com/@phosphor-icons/web` (duotone/bold/fill/regular).

## Files
- `Emails - Split Triage.dc.html` — the standalone hifi prototype of this screen (list +
  detail + review panel), self-contained against `tokens/` + `support.js`.
- `tokens/*.css` — Paradeos design tokens (colors, typography, spacing, radii, fonts, base).
- `support.js` — the prototype template runtime (prototyping only; do not port).
- In the wider project, the same design also lives in **`Emails - Refonte.dc.html`**
  alongside two alternative directions (1b "Boîte raffinée", 1c "IA au centre") for context.
  Sibling screens that share this app shell and the same "review" pattern: the
  **`Meetings - Revue complète`** files (the multi-type validation UI this detail pane
  is modeled on).
