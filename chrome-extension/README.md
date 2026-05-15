# Paradeos — Sync Dougs (Chrome extension)

Synchronise le cookie de session Dougs (HttpOnly inclus) avec Paradeos en un clic.

## Pourquoi cette extension

`auth_session` (le cookie de session Dougs) est marqué **HttpOnly** par
sécurité. Conséquence : `document.cookie` ne le voit pas, donc aucun
bookmarklet ne peut le récupérer. Seules deux APIs voient les HttpOnly :
`chrome.cookies.getAll` (extension) et `GM.cookie.list` (userscript
Tampermonkey). Cette extension utilise `chrome.cookies.getAll`.

## Installation (side-load, 1 minute)

1. `chrome://extensions` dans Chrome
2. Active **« Mode développeur »** (toggle en haut à droite)
3. **« Charger l'extension non empaquetée »** → sélectionne ce dossier
4. (Optionnel) Épingle l'extension dans la barre (puzzle → punaise)

## Configuration (une fois)

1. Paradeos → `/settings/integrations` → onglet Compta → Dougs
2. Section « Tokens de synchro » → **Générer un token** avec un label
3. Copie le **token** affiché (une seule fois) et l'**endpoint** affichés
4. Ouvre la popup de l'extension dans Chrome → colle les deux → **Enregistrer**

## Utilisation

- Sois connecté sur `app.dougs.fr` dans le navigateur
- Clique l'icône de l'extension → **« Sync maintenant »**
- L'extension lit tous les cookies de `app.dougs.fr` (incluant
  `auth_session` HttpOnly) et les pousse sur Paradeos

À refaire à chaque expiration du cookie Dougs (~24 h).

## Sécurité

- Le token est stocké dans `chrome.storage.local` (Chrome chiffre le
  stockage local côté disque)
- Aucune télémétrie, aucune analytics
- Code source : 3 fichiers (`manifest.json`, `popup.html`, `popup.js`)
- Si tu perds une machine : révoque le token depuis Paradeos
