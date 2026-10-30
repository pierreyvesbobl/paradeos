/**
 * Synchro du cookie de session Dougs vers Paradeos, depuis le service
 * worker : la popup n'a plus besoin d'être ouverte.
 *
 * Trois déclencheurs : un changement de `auth_session` (reconnexion sur
 * app.dougs.fr), une alarme horaire, et le bouton de la popup. Un cookie
 * déjà poussé n'est renvoyé qu'au bout de RESYNC_MS, pour que Paradeos
 * garde une date d'expiration à jour sans recevoir un appel par heure.
 */

const COOKIE_URL = "https://app.dougs.fr/";
const AUTH_COOKIE = "auth_session";
/** Même cookie : renvoyé au plus toutes les 6 h. */
const RESYNC_MS = 6 * 60 * 60 * 1000;

export async function readDougsCookies() {
  // `getAll({ url })` retourne les cookies que le navigateur enverrait
  // à cette URL — incluant les cookies de domaine parent (.dougs.fr).
  const cookies = await chrome.cookies.getAll({ url: COOKIE_URL });
  const auth = cookies.find((c) => c.name === AUTH_COOKIE);
  return {
    cookieString: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    count: cookies.length,
    names: cookies.map((c) => c.name),
    hasAuthSession: Boolean(auth),
    authValue: auth?.value ?? null,
    // Cookie de session (sans date) : Paradeos retombe sur ~24 h.
    expiresAt: auth?.expirationDate ? new Date(auth.expirationDate * 1000).toISOString() : null,
  };
}

/** Empreinte du cookie : on ne garde jamais sa valeur en clair dans le storage. */
async function fingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isDougsAuthCookie(cookie) {
  return cookie.name === AUTH_COOKIE && cookie.domain.replace(/^\./, "").endsWith("dougs.fr");
}

/** @param {{ trigger: "manual" | "alarm" | "cookie" }} opts */
export async function syncDougs({ trigger }) {
  const store = await chrome.storage.local.get([
    "dougs.endpoint",
    "dougs.token",
    "dougs.lastFingerprint",
    "dougs.lastPushedAt",
  ]);
  const endpoint = store["dougs.endpoint"];
  const token = store["dougs.token"];
  if (!endpoint || !token) {
    return { ok: false, error: "Endpoint et token Dougs non configurés." };
  }

  const cookies = await readDougsCookies();
  if (cookies.count === 0) {
    return record({ ok: false, error: "Aucun cookie pour app.dougs.fr. Connecte-toi d'abord." });
  }
  if (!cookies.hasAuthSession) {
    return record({
      ok: false,
      error: `Cookie auth_session absent (${cookies.count} cookies : ${cookies.names.join(", ")}). Re-login sur app.dougs.fr.`,
    });
  }

  const print = await fingerprint(cookies.authValue);
  const lastPushedAt = store["dougs.lastPushedAt"] ? Date.parse(store["dougs.lastPushedAt"]) : 0;
  if (
    trigger !== "manual" &&
    print === store["dougs.lastFingerprint"] &&
    Date.now() - lastPushedAt < RESYNC_MS
  ) {
    return { ok: true, skipped: true, error: null };
  }

  let body;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cookie: cookies.cookieString, expiresAt: cookies.expiresAt }),
    });
    try {
      body = await res.json();
    } catch {
      body = { ok: false, error: `HTTP ${res.status} (réponse non-JSON)` };
    }
    if (!body.ok) body.error = `HTTP ${res.status} : ${body.error || "erreur inconnue"}`;
  } catch (err) {
    body = { ok: false, error: `Erreur : ${err?.message || err}` };
  }

  if (body.ok) {
    await chrome.storage.local.set({
      "dougs.lastFingerprint": print,
      "dougs.lastPushedAt": new Date().toISOString(),
    });
  }
  return record({
    ok: Boolean(body.ok),
    error: body.ok ? null : body.error,
    count: cookies.count,
    expiresAt: body.expiresAt ?? null,
    trigger,
  });
}

async function record(result) {
  await chrome.storage.local.set({
    "dougs.lastRunAt": new Date().toISOString(),
    "dougs.lastResult": result,
  });
  return result;
}

export async function readDougsStatus() {
  const store = await chrome.storage.local.get(["dougs.lastRunAt", "dougs.lastResult"]);
  return {
    lastRunAt: store["dougs.lastRunAt"] || null,
    lastResult: store["dougs.lastResult"] || null,
  };
}
