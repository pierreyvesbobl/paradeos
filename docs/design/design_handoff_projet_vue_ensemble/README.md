# Handoff: Projet — Vue d'ensemble (fiche projet consolidée)

## Overview
This is the **project detail "Vue d'ensemble" (Overview) tab** for a project inside
Parade OS — a Notion-inspired workspace where agencies/freelancers run client
spaces (projects, tasks, invoices, deadlines). The screen surfaces, at a glance,
everything a project lead needs when opening a client project: **key facts
(budget, forecast, probability, billing, period), status, all stakeholders
(internal team + external contacts), last exchanges, and a dated activity feed.**

The consolidated layout documented here corresponds to variant **`6a`** in the
prototype (`Projet - Vue d'ensemble - Propositions.dc.html`). Earlier variants
(3a/3b/4a/4b/4c/5a/5b) are exploration only — **`6a` is the one to build.**

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype
showing the intended look and behavior, **not production code to copy directly**.
The task is to **recreate this design in the target codebase's existing
environment** (React/Vue/etc.) using its established component library, routing,
and data layer. If no environment exists yet, choose the most appropriate
framework and implement it there. Treat the HTML/inline-styles as a spec for
structure, spacing, color, and copy — not as shippable markup.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interaction states are
final and come from the bound **Paradeos Design System**. Recreate the UI
pixel-accurately using the codebase's existing primitives, mapping to the design
tokens listed below (they are the Paradeos token names). Do not invent new colors
or type — everything maps to a token.

---

## Screen: Projet — Vue d'ensemble (variant 6a)

### Purpose
The project lead lands here to read the project's state and act: see who's
involved (internal + client side), confirm budget/forecast, check the last
contact/email and upcoming follow-up, and scan recent activity. Editable fields
(description, members, contacts, period) are click-to-edit inline.

### Overall layout
App shell → main content column. Everything is on a **warm-white app background
(`--bg-app #FFFFFF`)** with **0.5px hairline borders (`--border #E3E3E0`)** doing
the separating; resting cards have **no drop shadow**.

```
┌───────────┬────────────────────────────────────────────────────────┐
│ Sidebar   │ Topbar (search ⌘K · bell · avatar)                      │
│ 236px     ├────────────────────────────────────────────────────────┤
│ fixed     │ Breadcrumb: Projets › PREVANDCARE › Refonte du site     │
│           │ Title row: ● dot · H1 · status pill · [Gantt][Supprimer]│
│ P logo    │ Tabs (Vue d'ensemble active · Tâches · Notes · …)       │
│ nav items │ ── Facts band: 5 columns (1px gap grid) ──────────────  │
│           │ ┌───────── two-column body ─────────────────────────┐   │
│           │ │ LEFT (flex:1)          │ RIGHT (360px fixed)      │   │
│           │ │ • Statut banner        │ • Derniers échanges (2×2)│   │
│           │ │ • Parties prenantes    │ • Activité (timeline)    │   │
│           │ │ • Description          │                          │   │
│           │ └────────────────────────┴──────────────────────────┘   │
└───────────┴────────────────────────────────────────────────────────┘
```
Outer content padding: `22px 32px 32px`. Vertical gap between major blocks: `18px`.
Body two-column gap: `18px`. Reference frame height in the prototype: `960px`.

### Components

**Sidebar** (`width:236px`, `background:--bg-sidebar #F7F7F5`, right hairline;
`padding:14px 12px`)
- Brand row: `30×30` rounded-8 "P" lettermark + "Parade" wordmark in **Fraunces
  600, 19px**.
- Nav items: icon (Phosphor duotone, `19px`) + label (**Hanken Grotesk medium,
  ~14px**). Row `padding:7px 9px`, `radius:8px`, `gap:11px`.
  - **Active item** (Projets): `background:--primary-50 #E7F3F8`, icon
    `--primary-700`, label `--primary-900`. This is the only pale-tint highlight.
  - Inactive: transparent, icon `--text-tertiary`, label `--text-muted`; hover →
    `background:--bg-hover`.
- Footer caption "Parade SAS — Lyon" in `--text-tertiary`, pushed to bottom
  (`margin-top:auto`).

**Topbar** (`height:52px`, bottom hairline, `padding:0 24px`, `gap:14px`)
- Search field: `--bg-surface` fill, hairline, `radius:8px`, `padding:6px 12px`;
  magnifier icon `16px --text-tertiary`, placeholder "Rechercher…", trailing
  `⌘K` chip (JetBrains Mono 11px, hairline, `radius:4px`).
- Bell icon `19px --text-muted` (pushed right with `margin-left:auto`).
- Avatar: `28×28` round, `--tint-orange-bg`/`--tint-orange-text`, initials "PS", 11px 600.

**Breadcrumb** — all-caps tracking `0.04em`, `--text-tertiary`, caret separators
(`ph-caret-right` bold 9px). Last crumb `--text-muted`. Text:
`Projets › PREVANDCARE › Refonte du site`.

**Title row** (`gap:14px`, align center)
- Category dot: `16×16` round, `--tint-orange-dot` (project color).
- H1: **Hanken Grotesk 600, 26px**, `line-height:1.1`, `letter-spacing:-0.01em`,
  color `--text`. Text: "PrevandCare — Refonte du site".
- Status pill: `--tint-green-bg` fill, `--tint-green-text`, `6px`-radius,
  `padding:3px 10px`, caption 600, leading `6px` `--tint-green-dot` dot. Text "Actif".
- Right (`margin-left:auto`, `gap:8px`):
  - **Gantt** button: hairline, `radius:7px`, `padding:7px 13px`, `--text-muted`,
    duotone chart icon `15px`; hover → `--bg-hover`.
  - **Supprimer** button: text-only, `--tint-red-text`, trash icon; hover →
    `--tint-red-bg`.

**Tabs** (`border-bottom:1px --border`, `gap:2px`)
- Each tab: icon `15px` + label, `padding:9px 12px`, `margin-bottom:-1px`.
- Active ("Vue d'ensemble"): `border-bottom:2px --primary-500`, text
  `--primary-700`, icon `--primary-700`, medium weight.
- Inactive: transparent underline, text `--text-muted`, icon `--text-tertiary`.
- Full tab set: Vue d'ensemble · Tâches · Notes · Meetings · Emails · Fichiers ·
  Facturation · Secrets · Temps & marge.

**Facts band** — CSS grid, `grid-template-columns:repeat(5,1fr)`, `gap:1px` over a
`--border` background (creates hairline dividers), outer hairline, `radius:10px`,
`overflow:hidden`. Each cell: `--bg-app`, `padding:12px 15px`, column flex,
`gap:5px`. Label = caption uppercase `0.05em` `--text-tertiary`; value below.
| Cell | Value | Value style |
|---|---|---|
| Budget | 13 920,00 € | JetBrains Mono 16px 600 `--text` |
| Prévisionnel | 13 920,00 € | JetBrains Mono 16px 600 |
| Probabilité | 100% + progress bar | mono 16px 600 + `5px` bar, track `--bg-press`, fill `--primary-500`, full width |
| Facturation | Forfait | pill: hairline, `radius:6px`, `padding:2px 9px`, `--text` |
| Période | Dès le 6 mai 2026 | Hanken medium `--text` |

**Body — LEFT column** (`flex:1`, `gap:16px`)

1. **Statut** block (label "Statut" with `ph-flow-arrow` icon). Banner:
   `--tint-green-bg` fill, border `#CFE0CF`, `radius:9px`, `padding:11px 14px`,
   `gap:12px`. Contents: `ph-play-circle` `20px --tint-green-text`, "Actif"
   (medium, `--tint-green-text`), muted caption "— projet en cours de livraison",
   and right-aligned link "Repasser au pipeline" (`--primary-700`, `ph-arrow-u-up-left`).

2. **Parties prenantes** card (surface `--bg-surface`, hairline, `radius:10px`,
   `padding:16px 18px`, `gap:16px`). Header: `ph-users-three` + eyebrow
   "PARTIES PRENANTES".
   - **Interne** sub-label (caption `--text-tertiary`). Member chip: hairline,
     `radius:8px`, `padding:6px 13px 6px 6px`; `28×28` round avatar
     `--tint-orange-bg`/`text`, initials "PS"; name (medium) + role "Lead"
     (caption). Plus a dashed "＋ Membre" add-chip (`--border-strong` dashed).
   - **Externe · PrevandCare · 4** sub-label. `grid-template-columns:1fr 1fr`,
     `gap:10px`. Each contact card: hairline, `radius:8px`, `padding:9px 12px`,
     `gap:10px`; `30×30` round avatar in its tint, name (medium, ellipsis) + role
     (caption). Hover → `--bg-hover`.
     - Amaury Barbier de la Serre — Sponsor — blue tint (`--tint-blue-bg/text`)
     - Solène Bonnardot — Cheffe de projet — red tint
     - Amaury Khelifi — Contact technique — green tint
     - Guillaume Staub — Contact — mauve tint
   - Dashed "＋ Lier un contact" add-chip below.

3. **Description** card (surface, hairline, `radius:10px`, `padding:16px 18px`).
   Eyebrow "DESCRIPTION" + click-to-edit placeholder "Cliquer pour ajouter une
   description…" (`--text-tertiary`, `cursor:text`).

**Body — RIGHT column** (`width:360px` fixed, `gap:16px`)

1. **Derniers échanges** card (surface, hairline, `radius:10px`, `padding:16px`).
   Eyebrow + `grid 1fr 1fr`, `gap:10px`, four mini-cells (hairline, `--bg-app`,
   `radius:8px`, `padding:9px 11px`): caption label over value.
   - Dernier contact → "Hier"
   - Dernier mail → "Hier, 16:20"
   - Relance prévue → "—" (`--text-tertiary`)
   - Closing estimé → "06/05/2026"

2. **Activité** card (surface, hairline, `radius:10px`, `padding:16px`,
   `flex:1`). Header row: eyebrow "ACTIVITÉ" + hairline rule (`flex:1` 1px line) +
   filter caption "Tout · Mails". Below: **vertical timeline** — each item is a
   row `gap:12px`: a `30×30` round icon badge (tinted bg + duotone icon) with a
   `1.5px --border` connector line beneath, and title (Hanken `--text`) + meta
   (caption `--text-tertiary`). Items:
   - `ph-envelope-simple` (blue) — "Email envoyé à Solène Bonnardot" — "Relance planning · hier, 16:20"
   - `ph-file-text` (green) — "Devis Dougs validé — 11 600,00 €" — "Facturation · 6 mai 2026"
   - `ph-flag` (orange) — "Projet passé du pipeline à « Actif »" — "Transition · 6 mai 2026"
   - `ph-user-plus` (gray) — "4 contacts liés depuis le CRM" — "Contacts · 5 mai 2026"

## Interactions & Behavior
- **Tabs**: switch the project sub-view; "Vue d'ensemble" is active here. Client-side route per tab.
- **Inline edit**: Description, member/contact add-chips, and Période are
  click-to-edit / open a picker popover. Add-chips open a person/contact selector.
- **Status banner → "Repasser au pipeline"**: moves the project from "Actif" back
  to a pipeline stage (status transition; confirm + optimistic update).
- **Gantt** button: opens the project Gantt view. **Supprimer**: destructive,
  confirm dialog (danger styling `--tint-red`).
- **Hover states**: nav rows, contact cards, buttons, and add-chips all deepen one
  neutral step to `--bg-hover`; links underline; danger actions reveal `--tint-red-bg`.
- **Motion**: quiet & quick — `90–220ms`, ease `cubic-bezier(0.2,0,0,1)`. Fades /
  small position shifts only. No bounce, no scale on press (surface darkens instead).
- **Right column** is a fixed 360px rail; the left column is fluid. On narrow
  widths, stack the rail below the left column (activity/last-exchanges after
  stakeholders).

## State Management
- **Project**: id, name, category color, status (`Actif` / pipeline stage), type
  (Client), billing (Forfait), budget, forecast amount, probability %, period
  (start/closing).
- **Stakeholders**: internal members[] (with role), external contacts[] (name,
  role, avatar tint) linked from the CRM; add/link/remove mutations.
- **Exchanges**: lastContactAt, lastEmailAt, nextFollowUpAt, estimatedClosingAt.
- **Activity feed**: list of events (type, icon, title, source, timestamp), with a
  filter ("Tout" / "Mails"). Paginated / lazy-loaded.
- **Editable fields**: description (rich text), period (date range) — persisted on blur/confirm.

## Design Tokens (Paradeos)
**Surfaces / neutrals**
- `--bg-app #FFFFFF` · `--bg-surface #FBFBFA` · `--bg-sidebar #F7F7F5` ·
  `--bg-hover #EFEFED` · `--bg-press #E7E7E4`
- `--border #E3E3E0` · `--border-strong #D6D5D1`
- Text: `--text #37352F` · `--text-muted #605C54` · `--text-tertiary #9B9890`

**Brand primary (blue)**
- `--primary-50 #E7F3F8` · `--primary-500 #1F6F95` (primary) ·
  `--primary-700 #185A7C` (hover/press/focus) · `--primary-900 #10384E`

**Categorical tints used** (each = bg / text / dot)
- green `#EDF3EC` / `#3F6B43` / `#5E9B63` (status Actif, success)
- orange `#FAEBDD` / `#9A5E26` / `#C2702F` (project dot, avatar PS)
- blue `#E7F3F8` / `#28617E` / `#4A93B8` (contact, mail events)
- red `#FBE9E7` / `#9B3530` / `#CE5A52` (danger / delete, contact tint)
- mauve `#F2EEFA` / `#5E4B8B` / `#9B82CE` (contact tint)
- gray `#F1F0EE` / `#605C54` / `#908D85` (neutral event)
- yellow `#FBF3DB` / `#8A6A1A` / `#C9A227` (entity)
- Banner border accent: `#CFE0CF`

**Typography**
- **Fraunces** — brand wordmark / lettermark / display (600).
- **Hanken Grotesk** — UI & body. Sizes seen: H1 26px/600, section eyebrows ~11px
  uppercase `0.05em`, UI text ~14px, captions ~12px.
- **JetBrains Mono** — monetary figures & the ⌘K chip (16px 600 for amounts).

**Radii** — tags/status `6px` · buttons/cards inner `7–8px` · cards/panels
`10px` · outer frame `14px` · avatars/dots fully round.

**Spacing** — 4px grid. Content padding `22–32px`; card padding `16–18px`; block
gap `16–18px`; dense chip padding `6–9px`.

**Borders / shadows** — 0.5px hairlines (`--border`) separate everything; resting
cards have **no shadow**, only `--shadow-sm` on hover/drag; the outer frame in the
prototype uses `--shadow-sm` just for canvas presentation.

## Assets
- **Icons**: [Phosphor Icons](https://phosphoricons.com), **duotone** weight
  (`ph-duotone` class) + **bold** (`ph-bold`) for tiny carets/plus. Loaded from
  CDN webfont in the prototype; use the codebase's existing Phosphor integration.
  Icons used: `ph-magnifying-glass, ph-bell, ph-caret-right, ph-chart-bar-horizontal,
  ph-trash, ph-flow-arrow, ph-play-circle, ph-arrow-u-up-left, ph-users-three,
  ph-plus, ph-address-book, ph-calendar-blank, ph-envelope-simple, ph-file-text,
  ph-flag, ph-user-plus`, plus nav/tab icons.
- **Logo**: "P" lettermark + "Parade" wordmark (Fraunces). No official asset was
  provided — use the codebase's brand asset if one exists.
- **No photography** — the brand signals with category dots + duotone icons only.

## Files
- `Projet - Vue d'ensemble - Propositions.dc.html` — the full prototype. Build
  variant **`6a`** (badge "6a", section id `#6a`). Other variants are exploration.
- Design tokens live in `_ds/paradeos-design-system-.../tokens/*.css`
  (`colors.css`, `typography.css`, `spacing.css`, `radii.css`) — the source of the
  token values above.
