/**
 * Service worker : orchestre la synchro LinkedIn et pousse le résultat
 * sur Paradeos. Tourne ici (et non dans la popup) pour survivre à sa
 * fermeture et pour porter l'alarme périodique.
 *
 * La synchro n'a lieu que quand Chrome est ouvert — c'est la
 * contrepartie assumée du choix d'appeler Voyager depuis le navigateur
 * plutôt que depuis les fonctions serveur.
 */

import {
  LIMITS,
  VoyagerError,
  diagnose,
  fetchConnections,
  fetchConversations,
  fetchMessages,
  humanDelay,
  isLoggedIn,
} from "./voyager.js";

const ALARM = "linkedin-sync";
/** Jamais plus d'une synchro par demi-heure, même déclenchée à la main. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;
/** L'ingestion serveur borne les lots à 100 items. */
const BATCH_SIZE = 25;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    runSync({ trigger: "alarm" }).catch((err) => console.error("[paradeos]", err));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "linkedin-sync") {
    runSync({ trigger: "manual" }).then(sendResponse);
    return true; // réponse asynchrone
  }
  if (msg?.type === "linkedin-diagnose") {
    diagnose()
      .then((report) => sendResponse({ ok: true, report }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "linkedin-status") {
    readStatus().then(sendResponse);
    return true;
  }
  return false;
});

async function readStatus() {
  const store = await chrome.storage.local.get([
    "linkedin.lastRunAt",
    "linkedin.lastResult",
    "linkedin.quota",
  ]);
  return {
    loggedIn: await isLoggedIn(),
    lastRunAt: store["linkedin.lastRunAt"] || null,
    lastResult: store["linkedin.lastResult"] || null,
    callsToday: (await readQuota()).calls,
  };
}

/**
 * Compteur d'appels glissant sur 24 h. Persisté pour survivre à
 * l'arrêt du service worker (MV3 le tue agressivement).
 */
async function readQuota() {
  const { "linkedin.quota": quota } = await chrome.storage.local.get("linkedin.quota");
  const today = new Date().toISOString().slice(0, 10);
  if (!quota || quota.day !== today) return { day: today, calls: 0 };
  return quota;
}

async function writeQuota(quota) {
  await chrome.storage.local.set({ "linkedin.quota": quota });
}

async function postBatch(endpoint, token, kind, items) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, items }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: `HTTP ${res.status} (réponse non-JSON)` };
  }
  if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function pushInBatches(endpoint, token, kind, items) {
  const totals = { conversations: 0, messages: 0, connections: 0 };
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const body = await postBatch(endpoint, token, kind, items.slice(i, i + BATCH_SIZE));
    totals.conversations += body.conversationsUpserted || 0;
    totals.messages += body.messagesUpserted || 0;
    totals.connections += body.connectionsUpserted || 0;
  }
  return totals;
}

export async function runSync({ trigger }) {
  const store = await chrome.storage.local.get([
    "linkedin.endpoint",
    "linkedin.token",
    "linkedin.lastRunAt",
  ]);
  const endpoint = store["linkedin.endpoint"];
  const token = store["linkedin.token"];
  if (!endpoint || !token) {
    return { ok: false, error: "Endpoint et token LinkedIn non configurés." };
  }

  const lastRunAt = store["linkedin.lastRunAt"] ? Date.parse(store["linkedin.lastRunAt"]) : 0;
  const since = Date.now() - lastRunAt;
  if (trigger === "alarm" && since < MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, error: null };
  }

  if (!(await isLoggedIn())) {
    return { ok: false, error: "Pas de session LinkedIn. Ouvre linkedin.com et connecte-toi." };
  }

  const quota = await readQuota();
  if (quota.calls >= LIMITS.MAX_CALLS_PER_DAY) {
    return { ok: false, error: `Plafond de ${LIMITS.MAX_CALLS_PER_DAY} appels/jour atteint.` };
  }

  const counters = { calls: 0 };
  const totals = { conversations: 0, messages: 0, connections: 0 };
  let error = null;

  try {
    // 1. Conversations, puis leurs messages.
    const fetched = await fetchConversations(counters);
    const conversations = [];
    for (const { id, conversation } of fetched) {
      if (quota.calls + counters.calls >= LIMITS.MAX_CALLS_PER_DAY) break;
      await humanDelay();
      let messages = [];
      try {
        messages = id ? await fetchMessages(id, counters) : [];
      } catch (err) {
        if (err instanceof VoyagerError && err.isBlocking) throw err;
        // Une conversation illisible ne doit pas arrêter le run.
        console.warn("[paradeos] messages", conversation.conversationUrn, err);
      }
      conversations.push({ ...conversation, messages });
    }

    if (conversations.length > 0) {
      const t = await pushInBatches(endpoint, token, "conversations", conversations);
      totals.conversations += t.conversations;
      totals.messages += t.messages;
    }

    // 2. Relations.
    await humanDelay();
    if (quota.calls + counters.calls < LIMITS.MAX_CALLS_PER_DAY) {
      const connections = await fetchConnections(counters);
      if (connections.length > 0) {
        const t = await pushInBatches(endpoint, token, "connections", connections);
        totals.connections += t.connections;
      }
    }
  } catch (err) {
    error = String(err?.message || err);
    if (err instanceof VoyagerError && err.isBlocking) {
      // 429 / 999 / 403 : LinkedIn nous freine. On s'arrête net et on
      // brûle le quota du jour pour ne pas insister — insister est
      // exactement ce qui transforme un ralentissement en restriction.
      quota.calls = LIMITS.MAX_CALLS_PER_DAY;
      error = `${error} — synchro suspendue jusqu'à demain par sécurité.`;
    }
  }

  quota.calls += counters.calls;
  await writeQuota(quota);

  const result = { ok: !error, error, totals, calls: counters.calls };
  await chrome.storage.local.set({
    "linkedin.lastRunAt": new Date().toISOString(),
    "linkedin.lastResult": result,
  });
  return result;
}
