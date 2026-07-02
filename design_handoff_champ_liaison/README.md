# Handoff — Champ de liaison (relation / lien) · Parade OS

## Overview
`ChampLiaison` (link field) is a reusable property field that relates a record to
one or more other records — **contacts, entités, projets, factures, échéances,
tags…**. It is the generalisation of the "Contacts liés" pattern: each linked
record is shown as a compact, clickable **jeton (chip)**; the user adds values
inline through a search/create popover and removes them with an inline `×`. The
same component is meant to be dropped on **any** record surface across the app.

This is **Variant A · Jetons compacts**, validated by the team as the primary
treatment. The component implements the **three interactions** end to end:
**ajout** (search/create popover), **survol → carte d'aperçu** (peek), and
**clic → fiche en panneau latéral** (drawer).

## About the design files
The files in this bundle are **design references created in HTML** (Parade OS
Design Component prototypes). They demonstrate the intended look, spacing, states,
and behaviour — they are **not** production code to copy verbatim. Recreate the
component in the target codebase using its established framework and patterns
(React/Vue/etc.), mapping the values below to the project's design tokens. If no
component environment exists yet, implement it in the framework already used by
the app.

Files included:
- `ChampLiaison.dc.html` — the reusable, prop-driven component (Variant A).
- `reference — mécanisme complet.dc.html` — the full exploration: the component
  in context (Fiche entité), the 3 variants, and the 3 interaction states
  (add popover, hover peek, side-panel open). Reference only.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, radii, and interaction
states. Recreate pixel-accurately using the codebase's component library, mapping
each literal below to the corresponding design token.

---

## Component: `ChampLiaison`

### Anatomy
```
LABEL  ‹count›
────────────────────────────────  ← hairline
[● Avatar  Name  ×] [icon  Name  ×] … [ + Ajouter ]
```

1. **Label row** (optional) — uppercase eyebrow + optional count, then a hairline.
2. **Chip row** — flex-wrap row of value chips, gap 8px.
3. **Add control** — dashed "+ Ajouter" button → opens the add popover.

### Data model
```ts
type LinkKind = "person" | "entity" | "projet" | "facture" | "echeance" | "tag";

interface LinkItem {
  id: string;
  name: string;
  kind: LinkKind;   // default "person"
  role?: string;    // secondary line, shown in suggestions / peek
}
```

### Props / API
| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | `"Contacts liés"` | `""` hides the label row entirely |
| `addLabel` | `string` | `"Ajouter"` | text on the add button |
| `showCount` | `boolean` | `true` | shows the item count next to the label |
| `addable` | `boolean` | `true` | shows the "+ Ajouter" control + popover |
| `removable` | `boolean` | `true` | shows the inline `×` on each chip |
| `peekEnabled` | `boolean` | `true` | show the hover preview (peek) card |
| `openInPanel` | `boolean` | `true` | click a chip → open the side panel (drawer) |
| `items` | `LinkItem[]` | sample contacts | the linked records |
| `suggestions` | `LinkItem[]` | sample pool | candidates shown in the popover |

`LinkItem` may carry `role`, `entity`, `email`, `phone`, `meta` — these populate
the peek card and the side panel (each rendered only when present).

Callbacks to wire in production (the prototype mutates local state):
`onAdd(item)`, `onRemove(id)`, `onOpen(item)` (navigate, or let the built-in
drawer handle it), `onCreate(query)`, `onSearch(query) -> LinkItem[]`. In a real
app the side panel is usually an app-level surface; the component ships one for
self-containment — set `openInPanel:false` and use `onOpen` to route to yours.

---

## Visual spec (exact values)

### Chip (resting)
- Layout: `inline-flex; align-items:center; gap:7px; max-width:230px`
- Padding: `4px 5px`
- Radius: `6px` (`--radius-tag`)
- Background: `#FBFBFA` (`--bg-surface`)
- Border: hairline ring `box-shadow: 0 0 0 1px #E3E3E0` (`--border`) — **no drop shadow**
- Font: `14px / 1.35` Hanken Grotesk (`--type-ui`), color `#37352F` (`--text`)
- Cursor: `pointer`
- Name: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`

### Chip leading glyph
- **Person** → round avatar `20×20`, `border-radius:999px`, initials `9px / 600`,
  background = category tint `*-bg`, text = same family `*-text`.
- **Object** (entity/projet/facture/echeance/tag) → **Phosphor duotone** icon,
  `15px`, colour = category tint `*-dot`.
  - entity → `ph-buildings` · projet → `ph-briefcase` · facture → `ph-receipt`
    · echeance → `ph-calendar-dot` · tag → `ph-circle`
- Tint is derived deterministically from the name (stable hash → one of the 9
  categorical families) so the same record always gets the same colour. In
  production, prefer an explicit colour stored on the record if available.

### Chip — remove button
- `17×17`, `border-radius:4px`, colour `#9B9890` (`--text-tertiary`),
  icon `ph-x` bold `10px`.
- **Opacity 0 at rest → 1 on chip hover** (transition `opacity 120ms`).
- Click removes the chip and **must not** trigger the chip's open/navigate action
  (stop propagation).

### Chip — states
- Hover: background → `#EFEFED` (`--bg-hover`); `×` fades in.
- Press: background → `#E7E7E4` (`--bg-press`); surface darkens, **no scale/move**.
- Focus (keyboard): accent ring using `--accent` (`#1F6F95`).
- Click on chip body: open the linked record (navigate or side-panel peek).

### Add button ("+ Ajouter")
- `inline-flex; gap:6px; padding:5px 11px; border-radius:6px`
- Border: `1px dashed #D6D5D1` (`--border-strong`)
- Colour `#9B9890`, icon `ph-plus` bold `11px`
- Hover: background `#EFEFED`, border `#D6D5D1`, colour `#605C54`

### Label row
- Eyebrow: `12px / 600`, `letter-spacing:0.1em`, `text-transform:uppercase`,
  colour `#9B9890`.
- Count: `12px` (`--type-caption`), colour `#9B9890`, to the right of the label.
- Hairline below: `height:1px; background:#E3E3E0; margin:9px 0 14px`.

### Chip container
- `display:flex; flex-wrap:wrap; gap:8px; align-items:center`.

### Add popover
- Width `300px`, background `#FFFFFF`, radius `10px` (`--radius-panel` ≈ 10–12),
  shadow `--shadow-popover`:
  `rgba(15,15,15,.05) 0 0 0 1px, rgba(15,15,15,.08) 0 3px 6px, rgba(15,15,15,.12) 0 9px 24px`.
- **Header** (search): `padding:10px 12px`, bottom hairline; `ph-magnifying-glass`
  15px + input placeholder `Rechercher…` + `Esc` keycap (`--type-mono` 10px,
  1px border `#E3E3E0`, radius 4px).
- **Suggestions list**: section eyebrow `Suggestions` (11px/600 uppercase
  tertiary); each row `padding:7px 8px; radius:6px; gap:9px` →
  `26×26` avatar + (name `--type-ui-medium` / role `--type-caption` tertiary) +
  `ph-plus` 12px. Row hover → `#EFEFED`.
- **Footer**: top hairline, row `padding:10px 12px`, `ph-plus-circle` 18px in
  `#1F6F95` + "Créer …" label in `#185A7C` (`--primary-700`).

### Hover peek card
- Trigger: pointer enters a chip; opens after the cursor settles, anchored
  `top: calc(100% + 8px); left:0`, `z-index:50`. A ~140ms grace delay on leave
  lets the cursor travel into the card without it closing.
- Card: width `296px`, background `#FFFFFF`, radius `10px`, `--shadow-popover`.
- Header (`padding:16px`, bottom hairline): `44px` avatar (person) or `44px`
  rounded-`12px` tinted tile with the duotone icon (object) + name
  (`16px/600`) + role (`--type-ui`, tertiary).
- Body (`padding:12px 16px`, gap 9px): one row per present field — Entité
  (`ph-buildings`), E-mail (`ph-envelope-simple`), meta (`ph-briefcase`); icons
  `16px` tertiary, text `--type-ui` muted.
- Footer (top hairline): centered "Ouvrir la fiche →" in `--primary-700`,
  opens the record.
- Motion: fade + 4px rise, 120ms. Suppress with `peekEnabled:false`.

### Side panel (drawer) — click a chip
- Overlay: `position:fixed; inset:0; z-index:1000`, justified to the right.
- Scrim: `rgba(15,15,15,.18)`, fades in 140ms; click closes.
- Drawer: width `360px` (`max-width:88vw`), full height, background `#FFFFFF`,
  left border hairline, shadow `-8px 0 28px rgba(15,15,15,.10)`; slides in 18px /
  180ms.
- Header (`height:50px`, bottom hairline): close `×` button, kind eyebrow
  (e.g. "Contact"), `ph-arrow-square-out` to open the full page.
- Body (`padding:22px 20px`): record header (48px avatar/tile + name `19px/600`
  + role) then a property stack (Entité / E-mail / Téléphone), each an uppercase
  11px tertiary eyebrow + value, gap 18px. Only present fields render.
- In production this is typically an app-level surface — set `openInPanel:false`
  and route via `onOpen(item)` instead.

---

## Interactions & behaviour
- **Add**: click "+ Ajouter" → popover opens anchored below the button. Typing
  filters `suggestions` live. Selecting a row appends the item and closes the
  popover. "Créer …" creates a new record from the current query.
- **Remove**: hover a chip → `×` appears → click removes it.
- **Open**: click a chip body → open the linked record (navigate to its page, or
  open it in a side panel — see the reference file's interaction frames). Provide
  a non-destructive **hover peek** card where useful (the "Aperçu" affordance).
- **Keyboard**: popover open → `↑/↓` move selection, `⏎` link the highlighted
  item, `Esc` closes. Chips are tabbable; `Enter` opens, `Backspace`/`Delete` on a
  focused chip removes it.
- **Motion**: `90–220ms`, ease `cubic-bezier(0.2,0,0,1)`. Fades + small position
  shifts only. No bounce/spring.

## Accessibility
- Each chip is a link/button with `aria-label="Ouvrir la fiche — {name}"`.
- Remove button: separate focusable control, `aria-label="Retirer {name}"`,
  reachable by keyboard (don't gate it behind hover only).
- "+ Ajouter" opens a `role="dialog"`/listbox popover; manage focus into the
  search field and trap/return focus on close.
- Colour never carries meaning alone — the category tint pairs a pale background
  with same-family dark text and is backed by the icon/avatar + the name.
- Maintain visible focus rings (`--accent`).

## State management
- `items: LinkItem[]` — current links (controlled in production via `onAdd`/`onRemove`).
- `popoverOpen: boolean` — add popover visibility.
- `query: string` + `results: LinkItem[]` — search state for the popover.
- Optional `peekItem` / `activeItem` for hover-peek / side-panel.

---

## Design tokens

### Neutrals
| Token | Hex |
|---|---|
| `--bg-app` | `#FFFFFF` |
| `--bg-surface` | `#FBFBFA` |
| `--bg-sidebar` | `#F7F7F5` |
| `--bg-hover` | `#EFEFED` |
| `--bg-press` | `#E7E7E4` |
| `--border` | `#E3E3E0` |
| `--border-strong` | `#D6D5D1` |
| `--text` | `#37352F` |
| `--text-muted` | `#605C54` |
| `--text-tertiary` | `#9B9890` |

### Brand primary (blue)
`--primary-50 #E7F3F8` · `--primary-500 #1F6F95` (THE primary) ·
`--primary-700 #185A7C` (hover/press/focus) · `--primary-900 #10384E`.

### Categorical tints (bg / text / dot)
gray `#F1F0EE / #605C54 / #908D85` · brown `#F4EEEA / #7A5C44 / #A8825E` ·
orange `#FAEBDD / #9A5E26 / #C2702F` · yellow `#FBF3DB / #8A6A1A / #C9A227` ·
green `#EDF3EC / #3F6B43 / #5E9B63` · blue `#E7F3F8 / #28617E / #4A93B8` ·
mauve `#F2EEFA / #5E4B8B / #9B82CE` · pink `#FBEBF4 / #8A3A6B / #C25E97` ·
red `#FBE9E7 / #9B3530 / #CE5A52`.
> Rule: always pale background + same-family dark text; never black text on a
> tint; the dot is the saturated accent. A tint encodes a **category**, not a
> hierarchy.

### Radii / borders / shadow
- tag/control `6px` · card `8px` · panel/popover `10–12px` · pill `999px`.
- Hairline `1px solid #E3E3E0`; resting surfaces get the ring only (no drop shadow).
- `--shadow-popover: rgba(15,15,15,.05) 0 0 0 1px, rgba(15,15,15,.08) 0 3px 6px, rgba(15,15,15,.12) 0 9px 24px`.

### Typography
- UI / body: **Hanken Grotesk** — `--type-ui` 14/1.35, `--type-ui-medium` 14/1.35 500,
  `--type-caption` 12.
- Brand / display: **Fraunces** (titles only).
- Mono (keycaps, IDs, amounts): **JetBrains Mono** — `--type-mono` 13.

## Assets / icons
- **Phosphor Icons**, **duotone** weight, loaded as a webfont
  (`@phosphor-icons/web`, class `ph-duotone ph-<name>`); `ph-bold` for the small
  `×` and `+`. Names used: `ph-buildings`, `ph-briefcase`, `ph-receipt`,
  `ph-calendar-dot`, `ph-circle`, `ph-magnifying-glass`, `ph-plus`,
  `ph-plus-circle`, `ph-x`. Map these to the codebase's icon system if different.
- No raster assets. Avatars are initials on a tint; swap for a photo if present.

## Files in this project (for reference)
- `ChampLiaison.dc.html` — the component (template + logic + props).
- `Champ de liaison — mécanisme.dc.html` — full exploration / interaction states.
- Design tokens live under
  `_ds/paradeos-design-system-471c38cf-e5de-4f68-a17d-0983349e053a/tokens/`
  (`colors.css`, `typography.css`, `radii.css`).
