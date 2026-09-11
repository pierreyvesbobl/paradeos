# Handoff: Task detail page — inline-editable (Parade OS)

## Overview
This is the redesign of the **task detail view** in Parade OS (French-first workspace
for agencies/freelancers: Projets, Tâches, Factures, Échéances). The screen shows one
task and its metadata, time tracking, and notes. The headline requirement:
**every field must be editable in place (inline)** — no separate "edit mode" / modal.

The chosen direction is **1b — "Rail de métadonnées"** (Linear-style): the task content
(title, time, notes) sits in a wide left column; all properties live in a fixed-width
right rail. The two other explored directions are included for reference only.

## About the design files
The files in this bundle are **design references authored in HTML** (a prototype of the
intended look and behavior). They are **not production code to ship as-is**. The task is
to **recreate this design in the target codebase's existing environment** (React, Vue,
etc.) using its established component library, routing, and data layer. If no environment
exists yet, pick the most appropriate framework and implement there.

The prototypes use a small in-house template runtime (`<x-dc>`, `{{ }}` holes,
`<sc-if>`/`<sc-for>`) — ignore that mechanism. Read them for **layout, spacing, colors,
copy, and interaction intent**, and reimplement with idiomatic components.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and interactions are final and
taken from the Parade OS design system. Recreate pixel-faithfully using the codebase's
existing primitives (Button, Tag, Avatar, Select, Input, popover/menu, date picker).

## Screens / Views

### Task detail (rail layout) — `Tâches - Détail (rail) — 1b.dc.html`
**Purpose:** view and edit a single task; every property is editable in place.

**Global frame**
- App shell: fixed **240px** left sidebar (`--bg-sidebar`, right hairline `--border`)
  with the Parade logo (blue rounded-square "P" lettermark in Fraunces + "Parade"
  wordmark) and nav rows (Dashboard, Projets, Pipeline, Time tracking, Meetings, Emails,
  CRM, Compta, Coworking) — Phosphor **duotone** icons at 19px, `--primary-500`; label
  `--text-muted`. Footer caption "Parade SAS — Lyon".
- Top bar: 64px tall, left search field (max 560px, `--bg-surface`, hairline, 8px radius,
  magnifier + "Rechercher…" + `⌘K` mono kbd), right bell icon + 32px round user avatar.
- Content area scrolls; inner column `max-width: 1180px`, centered, padding `8px 44px 64px`.

**Breadcrumb** (above the card): all-caps, 12px, weight 600, tracking 0.06em,
`--text-tertiary`; caret separators (`ph-caret-right`, bold, 10px). Segments:
`TÂCHES › {PROJECT, uppercased} › {TITLE, uppercased}` (last segment truncates).

**The card** — `--bg-app`, 1px `--border`, radius 12px, `box-shadow: 0 1px 3px rgba(0,0,0,.06)`,
`overflow: visible` (so property popovers aren't clipped). Two columns, no gap:

**Left column** (flex:1, padding `34px 40px`):
1. **Title** — editable `<h1>`, Fraunces (`--font-brand`), 32px / weight 600 / line-height 1.16,
   `--text`. Editable affordance: hover → `--bg-hover`; focus → `box-shadow: 0 0 0 2px var(--primary-200)`,
   6–8px radius, small negative margin so the highlight doesn't shift layout.
2. **"Temps passé"** section title (`--type-ui-medium`, 17px). Three equal stat cards in a
   flex row, gap 16px. Each: 1px `--border`, radius 10px, `--bg-surface`, padding `16px 18px`;
   uppercase caption label (`--text-tertiary`); value 26px / weight 700.
   - RÉALISÉ — value color `--tint-green-text`; editable number + static "h".
   - PLANIFIÉ — value color `--text`; editable number + static "h".
   - ÉCART — computed = réalisé − planifié; string `"+Nh"` / `"-Nh"`; color: `>0` →
     `--tint-red-text`, `<0` → `--tint-green-text`, `0` → `--text`. **Not** directly editable.
   - Under the cards: muted line "Aucun créneau enregistré sur cette tâche. Ajoute-en
     depuis le [calendrier]." ("calendrier" is a link, `--primary-500`).
3. **"Notes"** — header row with title + right-aligned "Ajouter" button (hairline, `--bg-surface`,
   plus icon). Empty state: bordered card, centered `ph-note-blank` (34px, `--text-tertiary`),
   "Aucune note pour l'instant." + two muted helper lines. Non-empty: stacked note cards
   (`--bg-surface`, hairline, radius 10px, padding 16px 18px) each with a `ph-note` icon, an
   editable body (`data-placeholder="Écris une note…"`), and a hover trash button (turns
   `--tint-red-text` on `--tint-red-bg`).

**Right rail** (width **320px**, `--bg-surface`, left hairline, radius `0 12px 12px 0`,
padding `30px 26px`, vertical stack gap 24px). Each property = uppercase caption label +
editable control:
- **Statut** — colored chip + caret; click opens a popover menu of 4 options, each a dot +
  label + check on the active one. Values: `À faire` (solid `--primary-500` bg, white text —
  the only saturated block, matches source), `En cours` (blue tint), `En attente` (yellow
  tint), `Terminée` (green tint). Chip: gap 8px, padding 6px 12px, radius 6px, 7px dot.
- **Priorité** — same chip+popover pattern. Options: `Basse`/`Normale` (gray tint),
  `Haute` (yellow tint), `Urgente` (red tint).
- **Assignée à** — 26px round initials avatar (`--tint-brown-bg`/`--tint-brown-text`),
  editable name (`--type-ui-medium`), and a `Externe` badge (yellow tint, 11px).
- **Projet** — editable box styled like an input (hairline, radius 8px, `--bg-app`, padding
  9px 12px); focus → primary ring + `--primary-300` border.
- **Période (Gantt)** — filled: bordered chip with `ph-calendar-blank` + "Jusqu'au {date}"
  + clear ✕. Empty: dashed "Ajouter" chip. Click opens popover with a native date input +
  "Retirer". Date display format: French, e.g. `27 juin 2025`.
- **Terminée le** — same date pattern; filled shows `ph-check-circle` (green) + date + clear.
  Empty: dashed "Marquer terminée" chip. Popover has date input + "Non terminée".
- Divider hairline, then a red **"Supprimer la tâche"** action (hover `--tint-red-bg`).

### Reference only — `reference - 3 alternatives.dc.html`
A canvas comparing three explored directions: **1a** properties-in-a-column (Notion-style
key/value list), **1b** metadata rail (the chosen one), **1c** compact chip bar. Keep for
context; implement **1b**.

## Interactions & Behavior
- **Inline text edit** (title, assignee name, project, note body, réalisé, planifié):
  `contentEditable`. Commit on **blur** (not per keystroke). Title falls back to
  "Sans titre" if emptied. Number fields parse out non-numeric chars (accept `,`/`.` decimals).
- **Select popovers** (statut, priorité): click chip toggles a popover anchored under it
  (top: `calc(100% + 6px)`); picking an option sets the value and closes. Popover:
  `--bg-app`, 1px border, radius 10px, shadow `0 8px 24px rgba(15,15,15,.12)`, padding 6px;
  rows padding 8px 10px, hover `--bg-hover`, active row shows a primary check.
- **Date popovers** (période, terminée le): native date input + a destructive clear row.
  Selecting a date sets it and closes.
- **Only one popover open at a time.** A full-viewport transparent backdrop (z-index 40)
  renders while any popover is open; clicking it closes. Popovers sit at z-index 50.
- **Clear buttons** must `stopPropagation` so they don't also toggle the field's popover.
- **Notes:** "Ajouter" appends an empty editable note; per-note trash removes it.
- Motion: quiet, 90–220ms, ease `cubic-bezier(0.2,0,0,1)`. No scale on press — surfaces
  darken one neutral step instead.

## State Management
Single task object:
- `title: string`
- `status: "afaire" | "encours" | "attente" | "terminee"`
- `priority: "basse" | "normale" | "haute" | "urgente"`
- `periodEnd: ISODateString | null` — Gantt end date
- `doneDate: ISODateString | null`
- `project: string` (relation in production — resolve to a Projet entity)
- `assignee: { name, initials, type: "Externe" | "Interne", client }`
- `realise: number` (hours), `planifie: number` (hours) — `ecart` is derived, not stored
- `notes: string[]`
- UI-only: `openMenu: "status" | "prio" | "period" | "done" | null`

Transitions: field edits commit on blur/change → persist (PATCH task). Opening a popover
sets `openMenu`; selecting/clearing/backdrop resets it to `null`. In production, `project`
and `assignee` are relations (RelationField in the DS) — swap the free-text editors for the
codebase's entity pickers.

## Design Tokens
Full token files included under `tokens/` (`colors.css`, `typography.css`). Key values:

**Neutrals** — app `#FFFFFF`, surface `#FBFBFA`, sidebar `#F7F7F5`, hover `#EFEFED`,
press `#E7E7E4`, border `#E3E3E0`, border-strong `#D6D5D1`. Text `#37352F`, muted `#605C54`,
tertiary `#9B9890`. Never pure black, never cold gray.

**Primary (blue)** — 50 `#E7F3F8`, 100 `#C3DEEC`, 200 `#8FC0DA`, 300 `#66ABCC`,
500 `#1F6F95` (THE primary), 700 `#185A7C` (hover/press/focus), 900 `#10384E`.

**Categorical tints** (bg / text / dot): gray `#F1F0EE`/`#605C54`/`#908D85`,
brown `#F4EEEA`/`#7A5C44`/`#A8825E`, yellow `#FBF3DB`/`#8A6A1A`/`#C9A227`,
green `#EDF3EC`/`#3F6B43`/`#5E9B63`, blue `#E7F3F8`/`#28617E`/`#4A93B8`,
red `#FBE9E7`/`#9B3530`/`#CE5A52`. Rule: pale bg + same-family dark text + one saturated dot.

**Type** — brand/display **Fraunces**; UI/body **Hanken Grotesk**; figures/mono **JetBrains
Mono** (all via Google Fonts; brand + UI/mono are substitutions — see DS readme).
H1 32px/600 Fraunces, panel title 17px/500, UI 14px, caption 12px, stat value 26px/700.

**Radii** — 6px chips/tags, 8px inputs/cards, 10–12px panels/popovers, round avatars/dots.
**Borders** — 1px hairline `#E3E3E0` (system spec is 0.5px; use hairline). Cards: hairline
ring, no shadow at rest. **Shadows** — only floating layers: popovers/dialogs
`0 8px 24px rgba(15,15,15,.12)`. **Spacing** — 4px grid.

## Assets
- **Icons:** [Phosphor Icons](https://phosphoricons.com), **duotone** weight, via
  `@phosphor-icons/web` CDN. Used: house, briefcase, funnel, clock, microphone,
  envelope-simple, users, calculator, buildings, magnifying-glass, bell, caret-right/down,
  circle-half, flag, user, calendar-blank, calendar-plus, check-circle, x-circle, check, x,
  note, note-blank, trash, plus, plus (bold). In the codebase, use its existing icon library
  equivalents (duotone if available).
- **Logo:** blue rounded-square "P" lettermark + "Parade" wordmark in Fraunces. No official
  asset was provided — use the real brand asset if one exists.
- **Fonts:** Fraunces, Hanken Grotesk, JetBrains Mono (Google Fonts). Confirm/replace with
  licensed brand fonts.
- No photographic imagery; the brand signals via color dots + duotone icons.

## Files
- `Tâches - Détail (rail) — 1b.dc.html` — **the design to implement** (chosen direction 1b).
- `reference - 3 alternatives.dc.html` — the three explored directions, for context.
- `tokens/colors.css`, `tokens/typography.css` — design tokens (map to the codebase's theme).
