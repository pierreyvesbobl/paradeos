/**
 * Popup multi-service.
 *
 * Dougs : le service worker lit les cookies de app.dougs.fr (HttpOnly
 * inclus, ce que `document.cookie` ne peut pas faire) et les pousse sur
 * Paradeos tout seul (cf. dougs.js) ; la popup ne sert qu'à configurer
 * et à forcer une synchro.
 *
 * LinkedIn : rien de tel n'est possible — LinkedIn bloque les IP
 * datacenter et restreint les comptes dont la session change d'origine.
 * C'est donc le service worker qui interroge Voyager ici, dans le
 * navigateur, et ne pousse que des données déjà normalisées. Le cookie
 * `li_at` n'est jamais lu ni transmis.
 */

const $ = (id) => document.getElementById(id);

function showStatus(el, msg, tone) {
  el.style.display = "block";
  el.className = `status ${tone}`;
  el.textContent = msg;
}

// ---------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------

const TABS = ["dougs", "linkedin"];

function selectTab(name) {
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  chrome.storage.local.set({ activeTab: name });
}

for (const t of TABS) {
  $(`tab-${t}`).addEventListener("click", () => selectTab(t));
}

// ---------------------------------------------------------------------
// Config — clés namespacées par service
// ---------------------------------------------------------------------

/**
 * La v1 stockait `endpoint` / `token` à plat (Dougs seul). On les
 * remonte sous `dougs.*` au premier lancement pour ne pas obliger à
 * reconfigurer une extension qui marchait.
 */
async function migrateLegacyConfig() {
  const store = await chrome.storage.local.get([
    "endpoint",
    "token",
    "dougs.endpoint",
    "dougs.token",
  ]);
  if (store["dougs.endpoint"] || store["dougs.token"]) return;
  if (!store.endpoint && !store.token) return;
  await chrome.storage.local.set({
    "dougs.endpoint": store.endpoint || "",
    "dougs.token": store.token || "",
  });
  await chrome.storage.local.remove(["endpoint", "token"]);
}

async function loadConfig(service) {
  const keys = [`${service}.endpoint`, `${service}.token`];
  const store = await chrome.storage.local.get(keys);
  $(`${service}-endpoint`).value = store[keys[0]] || "";
  $(`${service}-token`).value = store[keys[1]] || "";
}

async function saveConfig(service) {
  const endpoint = $(`${service}-endpoint`).value.trim();
  const token = $(`${service}-token`).value.trim();
  const status = $(`${service}-status`);
  if (!endpoint || !token) {
    showStatus(status, "Endpoint et token requis.", "err");
    return false;
  }
  await chrome.storage.local.set({
    [`${service}.endpoint`]: endpoint,
    [`${service}.token`]: token,
  });
  showStatus(status, "Config enregistrée.", "ok");
  return true;
}

// ---------------------------------------------------------------------
// Dougs
// ---------------------------------------------------------------------

function describeDougsResult(res, lastRunAt) {
  const when = lastRunAt ? new Date(lastRunAt).toLocaleString("fr-FR") : "";
  if (!res) return { text: "Jamais synchronisé.", tone: "info" };
  if (!res.ok) return { text: `${when ? `${when} — ` : ""}${res.error}`, tone: "err" };
  const expires = res.expiresAt ? new Date(res.expiresAt).toLocaleString("fr-FR") : "inconnu";
  const how = res.trigger === "manual" ? "à la main" : "automatiquement";
  return { text: `Synchronisé ${how} le ${when}. Expire vers ${expires}.`, tone: "ok" };
}

/** La synchro tourne dans le service worker (cf. dougs.js), comme l'auto-sync. */
async function syncDougs() {
  const status = $("dougs-status");
  $("dougs-sync").disabled = true;
  $("dougs-save").disabled = true;
  try {
    if (!(await saveConfig("dougs"))) return;
    const res = await chrome.runtime.sendMessage({ type: "dougs-sync" });
    const { text, tone } = describeDougsResult(res, new Date().toISOString());
    showStatus(status, text, tone);
  } catch (err) {
    showStatus(status, `Erreur : ${err.message || err}`, "err");
  } finally {
    $("dougs-sync").disabled = false;
    $("dougs-save").disabled = false;
  }
}

// ---------------------------------------------------------------------
// LinkedIn — délégué au service worker
// ---------------------------------------------------------------------

function formatTotals(t) {
  if (!t) return "";
  return `${t.conversations} conversation(s), ${t.messages} message(s), ${t.connections} relation(s)`;
}

async function syncLinkedin() {
  const status = $("linkedin-status");
  $("linkedin-sync").disabled = true;
  $("linkedin-save").disabled = true;
  try {
    if (!(await saveConfig("linkedin"))) return;
    showStatus(status, "Synchro en cours… (rythme volontairement lent)", "info");

    const res = await chrome.runtime.sendMessage({ type: "linkedin-sync" });
    if (res?.ok) {
      showStatus(status, `Synchronisé — ${formatTotals(res.totals)}.`, "ok");
    } else {
      showStatus(status, res?.error || "Erreur inconnue.", "err");
    }
  } catch (err) {
    showStatus(status, `Erreur : ${err.message || err}`, "err");
  } finally {
    $("linkedin-sync").disabled = false;
    $("linkedin-save").disabled = false;
  }
}

async function diagnoseLinkedin() {
  const status = $("linkedin-status");
  $("linkedin-diagnose").disabled = true;
  showStatus(status, "Diagnostic en cours…", "info");
  try {
    const res = await chrome.runtime.sendMessage({ type: "linkedin-diagnose" });
    if (res?.ok) {
      showStatus(status, res.report.join("\n"), "info");
    } else {
      showStatus(status, res?.error || "Diagnostic impossible.", "err");
    }
  } catch (err) {
    showStatus(status, `Erreur : ${err.message || err}`, "err");
  } finally {
    $("linkedin-diagnose").disabled = false;
  }
}

$("dougs-save").addEventListener("click", () => saveConfig("dougs"));
$("dougs-sync").addEventListener("click", syncDougs);
$("linkedin-save").addEventListener("click", () => saveConfig("linkedin"));
$("linkedin-sync").addEventListener("click", syncLinkedin);
$("linkedin-diagnose").addEventListener("click", diagnoseLinkedin);

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------

(async function init() {
  await migrateLegacyConfig();
  await Promise.all([loadConfig("dougs"), loadConfig("linkedin")]);

  const { activeTab } = await chrome.storage.local.get("activeTab");
  selectTab(TABS.includes(activeTab) ? activeTab : "dougs");

  // État Dougs : dernier passage du service worker (auto ou manuel).
  try {
    const st = await chrome.runtime.sendMessage({ type: "dougs-status" });
    const { text, tone } = describeDougsResult(st?.lastResult, st?.lastRunAt);
    showStatus($("dougs-status"), text, tone === "ok" ? "info" : tone);
  } catch {
    // Service worker endormi : pas grave, l'état se rafraîchira.
  }

  // État LinkedIn
  try {
    const st = await chrome.runtime.sendMessage({ type: "linkedin-status" });
    const status = $("linkedin-status");
    if (!st) return;
    if (!st.loggedIn) {
      showStatus(status, "Pas de session LinkedIn. Ouvre linkedin.com.", "info");
    } else {
      const last = st.lastRunAt ? new Date(st.lastRunAt).toLocaleString("fr-FR") : "jamais";
      showStatus(
        status,
        `Prêt. Dernière synchro : ${last}. ${st.callsToday} appel(s) aujourd'hui.`,
        "info",
      );
    }
  } catch {
    // Service worker endormi : pas grave, l'état se rafraîchira.
  }
})();
