# Paradeos Sync (extension Chrome)

Une seule extension, deux services : **Dougs** (cookie de session) et
**LinkedIn** (DM + relations).

## Pourquoi une extension

Les deux services ont besoin du navigateur, mais pour des raisons
opposées.

**Dougs** : `auth_session` est marqué HttpOnly, donc `document.cookie`
ne le voit pas et aucun bookmarklet ne peut le récupérer. Seule
`chrome.cookies.getAll` y a accès. L'extension récupère le cookie et le
pousse sur Paradeos, qui le chiffre et appelle Dougs en server-to-server.

**LinkedIn** : le raisonnement inverse. LinkedIn n'expose ni les DM ni
les relations via son API self-serve (la Messages API est réservée aux
partenaires « Compliance »). Il faut donc passer par l'API interne
Voyager — mais **surtout pas depuis un serveur** : LinkedIn bloque les
plages d'IP datacenter par ASN (Vercel tourne sur AWS) et vérifie la
cohérence cookie + fingerprint + géolocalisation. Réutiliser la même
session depuis une IP résidentielle *et* depuis une fonction serveur est
exactement le signal qui fait restreindre les comptes.

C'est donc l'extension qui interroge Voyager, depuis ta session et ton
IP, et qui ne pousse sur Paradeos que du JSON déjà normalisé.
**Ton cookie `li_at` n'est jamais lu ni transmis** — le navigateur
l'attache tout seul.

Contrepartie : la synchro LinkedIn n'a lieu que quand Chrome est ouvert.

## Installation (side-load, 1 minute)

1. `chrome://extensions` dans Chrome
2. Active **« Mode développeur »** (toggle en haut à droite)
3. **« Charger l'extension non empaquetée »** → sélectionne ce dossier
4. (Optionnel) Épingle l'extension dans la barre (puzzle → punaise)

> Mise à jour depuis la v1 : ta configuration Dougs est reprise
> automatiquement, rien à ressaisir.

## Configuration

Pour chaque service, dans Paradeos → `/settings/integrations` :
génère un token, copie le token **et** l'endpoint affichés, puis
colle-les dans l'onglet correspondant de la popup → **Enregistrer**.

- Dougs → `{ton-domaine}/api/dougs/sync-cookie`
- LinkedIn → `{ton-domaine}/api/linkedin/ingest`

Le token brut n'est affiché qu'une fois.

## Utilisation

**Dougs** — sois connecté sur `app.dougs.fr`, puis « Sync maintenant ».
À refaire à chaque expiration du cookie (~24 h).

**LinkedIn** — sois connecté sur `linkedin.com`, puis « Sync maintenant ».
Une alarme relance aussi la synchro périodiquement tant que Chrome
tourne (au plus une fois par demi-heure).

## Sécurité du compte LinkedIn

La synchro est **en lecture seule** : aucun message envoyé, aucune
invitation, aucune écriture vers LinkedIn. C'est ce qui sépare une
lecture discrète d'une automation détectable.

Les plafonds sont dans `voyager.js` (`LIMITS`) et ne devraient pas être
relevés sans raison :

- 20 conversations et 200 relations par run
- 800 à 1500 ms entre deux appels, avec aléa (un rythme parfaitement
  régulier est un signal en soi)
- 300 appels par jour maximum
- sur une réponse 429, 999 ou 403, le run s'arrête et la synchro est
  suspendue jusqu'au lendemain — insister est précisément ce qui
  transforme un ralentissement en restriction

## État de la synchro LinkedIn au 08/09/2026 : hors service

Relevé sur une vraie session : l'endpoint REST des conversations répond
500 (la messagerie est passée en GraphQL avec un `queryId` haché qui
change à chaque déploiement LinkedIn), et les relations ont quitté
Voyager pour du server-driven UI — leur réponse décrit des composants
React, plus des données.

La synchro Dougs, elle, n'est pas concernée et continue de fonctionner.

Le détail du constat et les pistes de remplacement (CSV de l'export
officiel, ou fournisseur type Unipile) sont dans l'en-tête de
`voyager.js`. Côté Paradeos, toute la chaîne d'ingestion est testée et
indépendante de la source : elle attend du JSON normalisé.

## Quand LinkedIn casse quelque chose

Voyager n'est pas une API publique : les chemins et les formes de
réponse changent sans préavis. Le bouton **« Diagnostic »** interroge
chaque endpoint et rapporte lequel répond.

Pour réparer : ouvrir linkedin.com, onglet Réseau des devtools, relever
la requête réelle, puis la transcrire dans `ENDPOINTS` (`voyager.js`).
Tout est concentré dans ce fichier pour que la réparation reste locale.

## Fichiers

| Fichier | Rôle |
|---|---|
| `manifest.json` | Permissions et déclaration du service worker |
| `popup.html` / `popup.js` | UI à deux onglets, config par service, synchro Dougs |
| `voyager.js` | Client de l'API interne LinkedIn + parsers + plafonds |
| `background.js` | Service worker : orchestration, alarme, quota journalier |

## Vie privée

- Tokens stockés dans `chrome.storage.local` (chiffré sur disque par Chrome)
- Aucune télémétrie, aucune analytics
- Aucun cookie LinkedIn ne sort de la machine
- Si tu perds une machine : révoque les tokens depuis Paradeos
