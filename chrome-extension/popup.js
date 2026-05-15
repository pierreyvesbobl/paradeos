/**
 * Lit token + endpoint depuis chrome.storage.local, récupère TOUS les
 * cookies de app.dougs.fr (HttpOnly inclus, ce que document.cookie ne
 * peut PAS faire) via chrome.cookies.getAll, et POST le résultat à
 * Paradeos avec Bearer auth.
 */

const els = {
  endpoint: document.getElementById("endpoint"),
  token: document.getElementById("token"),
  save: document.getElementById("save"),
  sync: document.getElementById("sync"),
  status: document.getElementById("status"),
};

function showStatus(msg, tone) {
  els.status.style.display = "block";
  els.status.className = `status ${tone}`;
  els.status.textContent = msg;
}

async function loadConfig() {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  if (endpoint) els.endpoint.value = endpoint;
  if (token) els.token.value = token;
}

async function saveConfig() {
  const endpoint = els.endpoint.value.trim();
  const token = els.token.value.trim();
  if (!endpoint || !token) {
    showStatus("Endpoint et token requis.", "err");
    return false;
  }
  await chrome.storage.local.set({ endpoint, token });
  showStatus("Config enregistrée.", "ok");
  return true;
}

async function getDougsCookieString() {
  // `getAll({ url })` retourne les cookies que le navigateur enverrait
  // à cette URL — incluant les cookies de domaine parent (.dougs.fr),
  // sans avoir à matcher les valeurs de `domain` à la main.
  const cookies = await chrome.cookies.getAll({ url: "https://app.dougs.fr/" });
  // Debug : affiche ce qu'on voit dans la console de la popup.
  console.log("[Paradeos Sync] cookies trouvés :", cookies);
  return {
    cookieString: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    count: cookies.length,
    names: cookies.map((c) => c.name),
    hasAuthSession: cookies.some((c) => c.name === "auth_session"),
  };
}

async function sync() {
  els.sync.disabled = true;
  els.save.disabled = true;
  try {
    const ok = await saveConfig();
    if (!ok) return;

    const { cookieString, count, names, hasAuthSession } = await getDougsCookieString();
    if (count === 0) {
      showStatus("Aucun cookie pour app.dougs.fr. Connecte-toi sur app.dougs.fr d'abord.", "err");
      return;
    }
    if (!hasAuthSession) {
      showStatus(
        `⚠️ Cookie auth_session absent (${count} cookies, dont : ${names.join(", ")}). Re-login sur app.dougs.fr.`,
        "err",
      );
      return;
    }

    const endpoint = els.endpoint.value.trim();
    const token = els.token.value.trim();

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cookie: cookieString }),
    });

    let body;
    try {
      body = await res.json();
    } catch {
      body = { ok: false, error: `HTTP ${res.status} (réponse non-JSON)` };
    }

    if (body.ok) {
      showStatus(
        `✓ Synchronisé (${count} cookies, ${cookieString.length} chars). Expire vers ${body.expiresAt ? new Date(body.expiresAt).toLocaleString("fr-FR") : "inconnu"}.`,
        "ok",
      );
    } else {
      showStatus(`✗ HTTP ${res.status} : ${body.error || "erreur inconnue"}`, "err");
    }
  } catch (err) {
    showStatus(`✗ Erreur : ${err.message || err}`, "err");
  } finally {
    els.sync.disabled = false;
    els.save.disabled = false;
  }
}

els.save.addEventListener("click", saveConfig);
els.sync.addEventListener("click", sync);

loadConfig().then(async () => {
  if (els.endpoint.value && els.token.value) {
    try {
      const { count, hasAuthSession } = await getDougsCookieString();
      if (count === 0) {
        showStatus("Pas connecté sur app.dougs.fr.", "info");
      } else if (!hasAuthSession) {
        showStatus(`⚠️ ${count} cookies mais auth_session absent. Re-login Dougs.`, "info");
      } else {
        showStatus(`Prêt. ${count} cookies (auth_session inclus). Clique Sync.`, "info");
      }
    } catch {
      // ignore
    }
  }
});
