# Dougs Proxy via Apps Script

## Pourquoi

Cloudflare devant `app.dougs.fr` détecte le fingerprint TLS des fetch
Node.js (local dev ET Vercel prod) et renvoie 401, même avec un cookie
de session valide. Les IPs Google (Apps Script `UrlFetchApp`) passent
le filtre proprement parce que Cloudflare les considère comme du
trafic Google légitime.

Solution : router toutes les requêtes Dougs depuis Paradeos via un Apps
Script déployé. Côté Paradeos, le routage s'active automatiquement dès
que la variable d'environnement `DOUGS_PROXY_URL` est définie (sinon
fetch direct, utile pour debug local sans Cloudflare en chemin).

## Code à ajouter dans l'Apps Script existant

Va sur ton projet Apps Script (celui déployé à
`https://script.google.com/macros/s/AKfycbzdESBY6NE3i1wA4AF6gYKwc_MOTPWhIdYXfC4ybcwjGbEiVrjPuPZz1HRBK4db1l_YwA/exec`)
via **Extensions → Apps Script**, et **ajoute la fonction `dougsProxy`
ci-dessous** + le branchement dans `doPost`.

```javascript
// Optionnel : shared secret. Met la même valeur dans
//   Apps Script (Propriétés du script) → PROXY_SECRET
//   Vercel env → DOUGS_PROXY_SECRET
// Si PROXY_SECRET est vide côté script, le check est skippé.
function dougsProxy(params) {
  const expected = PropertiesService.getScriptProperties().getProperty('PROXY_SECRET');
  if (expected && params.secret !== expected) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const { method, path, body, cookie } = params;
  if (!method || !path || !cookie) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'method, path, cookie required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const url = 'https://app.dougs.fr' + path;
  const options = {
    method: String(method).toLowerCase(),
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'Origin': 'https://app.dougs.fr',
      'Referer': 'https://app.dougs.fr/app/',
    },
    muteHttpExceptions: true,
    followRedirects: false,
  };
  // UrlFetchApp ne permet PAS de mettre un body sur GET/HEAD/DELETE.
  if (body && !['get', 'head', 'delete'].includes(options.method)) {
    options.payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(url, options);
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      status: res.getResponseCode(),
      body: res.getContentText(),
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Et dans `doPost(e)`, au début du switch d'actions, ajoute :

```javascript
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents || '{}'); }
  catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'invalid JSON' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (body.action === 'dougsProxy') return dougsProxy(body);

  // ... actions existantes (gmailToDougs, batchGmailToDougs, etc.)
}
```

## Déployer

1. Sauve le code (`Cmd+S`)
2. **Déployer → Gérer les déploiements** → édite le déploiement existant
   → **Nouvelle version** → Déployer (l'URL reste la même)
3. Côté Vercel (Settings → Environment Variables) ajoute :
   - `DOUGS_PROXY_URL` = l'URL `https://script.google.com/macros/.../exec`
   - (optionnel mais recommandé) `DOUGS_PROXY_SECRET` = string random
     identique à ce que tu as mis dans **Propriétés du script** côté
     Apps Script
4. Redeploy Paradeos (Vercel le fait auto au push)

## Test

Une fois en prod, push un devis ou une facture jalon depuis la fiche
projet — devrait passer en HTTP 200 puisque la requête traverse Google
puis Cloudflare.

Si toujours 401 :
- Soit le cookie est vraiment invalide (re-coller dans `/settings/integrations`)
- Soit le `PROXY_SECRET` est désynchro (Apps Script ne reçoit pas le bon)

## Sécurité

- L'URL Apps Script est publique (pas d'auth en entrée), donc importante
  à ne pas committer en clair. Stocke-la uniquement dans Vercel env vars.
- Le `PROXY_SECRET` empêche qu'un attaquant ayant l'URL Apps Script
  puisse l'utiliser sans connaître aussi le secret.
- Le proxy a accès à **tous les cookies que Paradeos envoie** — si
  Paradeos est compromis, Dougs aussi. Risque acceptable parce que le
  cookie chiffré est déjà déchiffré côté Paradeos avant l'envoi.
