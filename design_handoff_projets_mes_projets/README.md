# Handoff: Page Projets — vue liste à facettes avec filtre « Mes projets » (option 3a)

## Overview
Refonte de la page **Projets** de Parade OS : la liste de tous les projets (missions
clients, produits internes, initiatives transverses). L'objectif est une vue **par ligne**
(table dense) accompagnée d'un **panneau de filtres latéral (facettes)**, avec en tête un
filtre **« Mes projets »** qui restreint la liste aux projets où l'utilisateur courant est
**lead ou membre**. La colonne **Équipe** montre le lead (avatar cerclé) et les membres.

La proposition retenue est l'**option 3a** du fichier de design (badge `3a`, « Tour 3 »).

## About the Design Files
Les fichiers de ce bundle sont des **références de design réalisées en HTML** — des
prototypes qui montrent l'apparence et le comportement voulus, **pas du code de production
à copier tel quel**. Le fichier est un « Design Component » (`.dc.html`) : un runtime maison
lit un template + une classe de logique. **Ne pas réutiliser ce runtime.**

La tâche est de **recréer ce design dans l'environnement du codebase cible** (React, Vue,
etc.) avec ses patterns et sa librairie de composants existants. S'il n'existe pas encore
d'environnement, choisir le framework le plus adapté et y implémenter le design. Les tokens
CSS (couleurs, typo, espacements) du design system Paradeos sont référencés plus bas et
doivent être mappés sur les tokens du codebase.

## Fidelity
**High-fidelity (hifi).** Couleurs, typographie, espacements et interaction (bascule
« Mes projets ») sont définitifs. Recréer l'UI au pixel près en s'appuyant sur les
composants et tokens existants du codebase. Le seul contenu est illustratif (données de
démonstration) — la structure des données est réelle.

## Screens / Views

### Écran unique : Projets (liste à facettes)

**Purpose** — L'utilisateur parcourt, filtre et ouvre les projets. Le filtre « Mes projets »
lui donne immédiatement sa charge personnelle.

**Layout global (shell applicatif)**
- **Rail latéral gauche** : `56px` de large, fond `--bg-sidebar (#F7F7F5)`, bordure droite
  hairline `--border (#E3E3E0)`. Contient le lettermark « P » (30×30, radius 8) puis des
  icônes de nav 20px centrées dans des zones 38×38 (radius 8). L'item actif (**Projets**,
  icône `briefcase`) a un fond `--primary-50 (#E7F3F8)` et l'icône en `--primary-700`.
  Les autres icônes sont en `--text-tertiary`. Ordre : house, briefcase (actif), funnel,
  clock, microphone, envelope, users, calculator.
- **Topbar** : hauteur `50px`, bordure basse hairline. Champ de recherche à gauche
  (fond `--bg-surface`, bordure `--border`, radius 8, padding 6×12) avec icône loupe,
  placeholder « Rechercher… » et raccourci `⌘K` (mono 11px, encadré). À droite : cloche
  (`--text-muted`) puis avatar rond 28px de l'utilisateur (initiales « PS », fond
  `--tint-orange-bg`, texte `--tint-orange-text`).
- **Zone de contenu** : padding `20px 24px`.
  - **En-tête** : eyebrow « DELIVERY » (caption, uppercase, tracking 0.08em, `--text-tertiary`),
    titre « Projets » (24px / 600 / `--text`), sous-titre « Missions clients, produits
    internes et initiatives transverses. » (`--text-muted`). À droite, bouton primaire
    **Nouveau projet** (fond `--primary-500`, texte blanc, radius 7, padding 8×13, icône
    `plus` bold 13px). Marge basse `18px`.
  - **Corps en deux colonnes** : `display:flex; gap:20px; align-items:flex-start`.
    - **Panneau de facettes** : largeur fixe `224px` (voir composants ci-dessous).
    - **Résultats** : `flex:1`, contient la barre de résultats + la table.

**Panneau de facettes (largeur 224px, colonne, gap 16px)**
1. **Bascule de périmètre (le filtre clé)** — deux lignes empilées, gap 4px :
   - « Tous les projets » (icône `list-bullets` duotone 18px) + compteur `20` à droite.
   - « Mes projets » (icône `user-focus` duotone 18px) + compteur `10` à droite.
   - Chaque ligne : padding `8px 10px`, radius 8, `cursor:pointer`, hover `--bg-hover`.
   - **État actif** : fond `--primary-50`, texte + icône en `--primary-900` (label) /
     `--primary-700` (accents). L'état par défaut de la maquette est « Mes projets » actif.
   - Cliquer une ligne définit le périmètre et re-filtre la table.
2. **Facette « Mon rôle »** (titre caption uppercase `--text-tertiary`) : deux cases à cocher
   « Lead » (icône `crown-simple`) et « Membre » (icône `user`). Case = carré 16px, bordure
   `--border-strong`, radius 4. *(Visuel dans la maquette ; à câbler comme sous-filtre.)*
3. Séparateur : trait 1px `--border`.
4. **Facette « Type »** : cases à cocher « Client » (7), « Produit » (6), « Transverse » (7),
   compteur à droite en `--text-tertiary`.
5. Séparateur.
6. **Facette « Entité »** : une ligne par entité, avec un avatar rond 18px (initiale, fond +
   texte selon la teinte de l'entité — voir Design Tokens), le nom, et le compteur. Entités
   dans l'ordre : Parade (13), PrevandCare (1), Flow Boreal (1), Avenir Focus (2), CAD.42 (1),
   Maestro (1), Thermigo (1).
   - Item de facette générique : padding `3px 6px`, radius 6, hover `--bg-hover`.
   - Case cochée : fond `--primary-500`, coche blanche (`check` bold 11px) ; la ligne cochée
     prend le fond `--primary-50` et le texte `--primary-900`.

**Barre de résultats (au-dessus de la table)**
- Quand « Mes projets » est actif : jeton supprimable « Mes projets » (icône `user-focus`
  13px, fond `--primary-50`, texte `--primary-900`, croix `x` bold cliquable qui rebascule
  sur « Tous »).
- Compteur « **10** projets » (nombre en `--text-muted` 600, reste `--text-tertiary`).
- À droite : contrôle de tri « Activité » (icône `arrows-down-up` 14px, `--text-muted`).

**Table (résultats)**
- Conteneur : bordure `--border`, radius 10, `overflow:hidden`.
- **Grille** (header et lignes identiques) :
  `grid-template-columns: 1fr 96px 80px 108px 112px; gap:16px;` (colonnes : Projet, Type,
  Statut, Équipe, Activité).
- **Header** : padding `9px 16px`, fond `--bg-surface`, bordure basse hairline. Libellés en
  caption 600 `--text-muted`. La colonne « Activité » est l'axe de tri actif : libellé en
  `--primary-700` + flèche `arrow-down` bold 11px.
- **Ligne** : padding `10px 16px`, bordure basse hairline, `align-items:center`,
  `cursor:pointer`, **hover → fond `--bg-hover`**.
  - **Projet** : pastille catégorielle ronde 9px (couleur du projet, voir données) + nom
    (`--type-ui`, `--text`), tronqué en ellipse.
  - **Type** : tag — padding `2px 8px`, bordure `--border`, radius 6, caption `--text-muted`
    (valeurs : Client / Produit / Transverse).
  - **Statut** : pill « Actif » — padding `2px 8px`, bordure `#CFE0CF`, radius 6, texte
    `--tint-green-text`, précédée d'une pastille 5px `--tint-green-dot`.
  - **Équipe** : cluster d'avatars ronds 22px qui se chevauchent (`margin-left:-6px`, le
    conteneur a `padding-left:6px`). Chaque avatar = initiales 9px 700, fond + texte selon la
    personne. **Le premier avatar (lead) a une bordure `2px solid --primary-400`** ; les
    autres `2px solid --bg-surface`. Au-delà de 3 personnes, une pastille `+N` (fond
    `--bg-hover`, texte `--text-tertiary`).
  - **Activité** : temps relatif (« il y a 2 h », « hier », « il y a 3 sem. »…) en caption
    `--text-muted`, précédé d'une pastille verte 6px `--tint-green-dot` si le projet est
    « récent » (activité ≤ ~1 jour).

## Interactions & Behavior
- **Bascule Tous / Mes projets** (implémentée) : clic sur une ligne de périmètre →
  met à jour l'état `scope` (`'all'` | `'mine'`) → re-filtre la table et met à jour le
  compteur, le jeton de résultats et le surlignage actif. « Mes projets » = projets où
  l'utilisateur courant est lead **ou** membre.
- **Jeton « Mes projets » ×** : rebascule sur « Tous ».
- **Facettes Type / Entité / Rôle** : présentes visuellement, à câbler comme filtres
  cumulables (ET entre familles, OU au sein d'une famille) qui intersectent le périmètre.
- **Tri** : colonne « Activité » triée décroissante par défaut (plus récent en haut). Les
  en-têtes Projet/Type/Période sont triables ailleurs dans le produit.
- **Ligne** : hover `--bg-hover` ; le clic ouvre la fiche projet (navigation, hors périmètre
  de ce handoff).
- **Motion** : transitions courtes `90–220ms`, ease `cubic-bezier(0.2,0,0,1)`. Pas de
  rebond, pas de scale. Les surfaces au repos n'ont **pas** d'ombre (juste la hairline) ;
  ombres réservées aux éléments flottants (popovers, dialogs).

## State Management
- `scope: 'all' | 'mine'` — périmètre courant (défaut `'mine'` dans la maquette ; en prod,
  choisir selon l'attente produit).
- `currentUser` — identifie l'utilisateur (ici initiales « PS »). Sert à calculer `mine`.
- Filtres de facettes (à ajouter) : `types: string[]`, `entities: string[]`, `role: {lead, member}`.
- Tri : `sortKey` (« activity » par défaut) + `sortDir` (« desc »).
- Dérivé : `list` = projets filtrés par périmètre ∩ facettes, puis triés ; `myCount`,
  compteurs par type et par entité (pour les badges de facettes).
- **Données** : chaque projet porte `name`, `type` (Client/Produit/Transverse),
  `entity`, `status` (Actif…), `period` (date de début ou null → « Définir la période »),
  `lastActivity` (timestamp → temps relatif), `dotColor`, `lead` (personne),
  `members` (personnes). `mine = lead === me || members.includes(me)`.

## Design Tokens
Source : design system **Paradeos** (`_ds/…/tokens/*.css`). Grays chauds uniquement,
jamais de noir pur, jamais de gris froid.

**Surfaces / neutres**
- `--bg-app #FFFFFF` · `--bg-surface #FBFBFA` · `--bg-sidebar #F7F7F5`
- `--bg-hover #EFEFED` (hover, ligne active, sélection) · `--bg-press #E7E7E4`
- `--border #E3E3E0` (hairline) · `--border-strong #D6D5D1`

**Texte**
- `--text #37352F` · `--text-muted #605C54` · `--text-tertiary #9B9890`

**Primaire (bleu) — ramp**
- `--primary-50 #E7F3F8` · `--primary-400 #3E94BE` · `--primary-500 #1F6F95` (THE primary)
- `--primary-700 #185A7C` (hover/press/focus) · `--primary-900 #10384E` (texte sur fond pâle)

**Teintes catégorielles** (chaque famille = fond pâle `-bg` + texte foncé `-text` + pastille
saturée `-dot`). Utilisées pour les avatars d'entité et les pills de statut :
- vert : bg `#EDF3EC` / text `#3F6B43` / dot `#5E9B63` (statut Actif ; pill bordure `#CFE0CF`)
- gris : `#F1F0EE` / `#605C54` / `#908D85` — bleu : `#E7F3F8` / `#28617E` / `#4A93B8`
- mauve : `#F2EEFA` / `#5E4B8B` / `#9B82CE` — orange : `#FAEBDD` / `#9A5E26` / `#C2702F`
- jaune : `#FBF3DB` / `#8A6A1A` / `#C9A227` — rose : `#FBEBF4` / `#8A3A6B` / `#C25E97`
- rouge : `#FBE9E7` / `#9B3530` / `#CE5A52` — brun : `#F4EEEA` / `#7A5C44` / `#A8825E`

**Pastilles de projet (colonne Projet)** — couleurs de démonstration :
teal `#26B6C4`, orange `#C2702F`, rose `#C25E97`, mauve `#9B82CE`, indigo `#6C63E8`,
bleu `#4A93B8`, rouge `#CE5A52`, jaune `#C9A227`, gris foncé `#605C54`, gris clair `#D6D5D1`.

**Typographie**
- Marque / display : **Fraunces** (lettermark « P », wordmark).
- UI / corps : **Hanken Grotesk**. Mono (figures, raccourcis, montants) : **JetBrains Mono**.
- Casse phrase partout ; petits eyebrows en majuscules, tracking large (~0.08em).
- Tokens de rôle utilisés : `--type-ui` (~14px), `--type-ui-medium` (14/600),
  `--type-caption` (~12px), `--type-mono`.

**Rayons** : tags/pills 6px · cartes 8px · panneaux/dialogs 10–12px · avatars/pastilles ronds.
**Bordures** : hairlines 0.5–1px `--border`. **Ombres** : `--shadow-sm` seulement pour les
surfaces flottantes / la carte-écran ; rien au repos sur les lignes.
**Grille d'espacement** : base 4px.

## Assets
- **Icônes** : [Phosphor Icons](https://phosphoricons.com), poids **duotone** en interface
  (24/20px, 16px en lignes denses) et **bold** pour les micro-accents (croix, chevrons,
  plus, flèche de tri). Chargées via webfont `@phosphor-icons/web` (CDN). Duotone : trait =
  couleur de texte de la teinte, remplissage secondaire = même couleur à ~40% d'opacité ;
  en UI neutre, `--text-muted`. Icônes utilisées : `house, briefcase, funnel, clock,
  microphone, envelope-simple, users, calculator, magnifying-glass, bell, plus, list-bullets,
  user-focus, crown-simple, user, check, arrows-down-up, arrow-down, x, buildings`.
- **Aucune image bitmap.** Avatars = initiales sur fond de teinte. Lettermark « P » = texte
  Fraunces (classe `parade-mark` du design system).
- Pas d'emoji.

## Files
- `Projets - Propositions.dc.html` — prototype complet (copié dans ce dossier). Il contient
  plusieurs propositions organisées par « Tours ». **La cible de ce handoff est l'option
  `3a`** (« Tour 3 »), en haut du fichier. La logique du filtre « Mes projets » (état `scope`,
  calcul de `mine`, données d'équipe `people`/`teams`) est dans la classe `Component` en bas
  du fichier — s'en inspirer pour le modèle de données, pas pour l'implémentation.
- Tokens de référence : `_ds/paradeos-design-system-<id>/tokens/*.css` du projet
  (couleurs, typo, espacements, rayons).
