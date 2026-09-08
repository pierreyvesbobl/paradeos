/**
 * Client de l'API interne LinkedIn « Voyager ».
 *
 * Pourquoi ici et pas côté serveur Paradeos : LinkedIn bloque les
 * plages d'IP datacenter par ASN (Vercel tourne sur AWS) et vérifie la
 * cohérence cookie + fingerprint + géolocalisation. Réutiliser la même
 * session depuis une IP résidentielle ET depuis une fonction serveur
 * est exactement le signal « session origin mismatch » qui fait
 * restreindre les comptes. En restant dans le navigateur on garde une
 * seule origine, et le cookie `li_at` ne quitte jamais la machine —
 * on ne le lit même pas : le navigateur l'attache tout seul.
 *
 * ⚠️ Voyager n'est pas une API publique : les chemins et les formes de
 * réponse changent sans préavis. Tout est concentré dans ce fichier
 * pour qu'une réparation reste locale. Si une synchro ne remonte rien,
 * utiliser le bouton « Diagnostic » de la popup : il dit quel endpoint
 * a répondu quoi. La méthode de mise à jour : ouvrir linkedin.com,
 * onglet Réseau des devtools, relever la requête réelle, la transcrire.
 */

const BASE = "https://www.linkedin.com";

/** LECTURE SEULE. Aucune écriture vers LinkedIn, jamais. */
export const ENDPOINTS = {
  conversations: `${BASE}/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX`,
  events: (conversationId) =>
    `${BASE}/voyager/api/messaging/conversations/${encodeURIComponent(
      conversationId,
    )}/events?keyVersion=LEGACY_INBOX`,
  connections: (start, count) =>
    `${BASE}/voyager/api/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`,
};

/**
 * Plafonds de sécurité du compte. Ce ne sont pas des optimisations :
 * un rythme régulier et soutenu est précisément ce que LinkedIn
 * détecte. Ne pas les relever sans raison.
 */
export const LIMITS = {
  MAX_CONVERSATIONS_PER_RUN: 20,
  MAX_MESSAGES_PER_CONVERSATION: 50,
  MAX_CONNECTIONS_PER_RUN: 200,
  CONNECTIONS_PAGE_SIZE: 40,
  MIN_DELAY_MS: 800,
  MAX_DELAY_MS: 1500,
  /** Nombre max d'appels Voyager par tranche de 24 h, tous types confondus. */
  MAX_CALLS_PER_DAY: 300,
};

/** Pause aléatoire — la régularité parfaite est un signal en soi. */
export function humanDelay() {
  const { MIN_DELAY_MS, MAX_DELAY_MS } = LIMITS;
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoyagerError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "VoyagerError";
    this.status = status;
    /** 429 = quota, 999 = blocage anti-scraping : on arrête tout le run. */
    this.isBlocking = status === 429 || status === 999 || status === 403;
  }
}

/**
 * Le header `csrf-token` doit valoir la valeur du cookie JSESSIONID,
 * guillemets retirés. C'est la seule chose qu'on lit dans les cookies.
 */
async function getCsrfToken() {
  const cookie = await chrome.cookies.get({
    url: "https://www.linkedin.com/",
    name: "JSESSIONID",
  });
  if (!cookie || !cookie.value) return null;
  return cookie.value.replace(/"/g, "");
}

/** L'utilisateur est-il connecté sur LinkedIn dans ce navigateur ? */
export async function isLoggedIn() {
  const li = await chrome.cookies.get({ url: "https://www.linkedin.com/", name: "li_at" });
  return Boolean(li?.value);
}

async function voyagerFetch(url) {
  const csrf = await getCsrfToken();
  if (!csrf) {
    throw new VoyagerError("Pas de session LinkedIn (cookie JSESSIONID absent).", 401);
  }

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      // Le navigateur attache li_at lui-même : on ne le lit jamais.
      credentials: "include",
      headers: {
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
        accept: "application/vnd.linkedin.normalized+json+2.1",
      },
    });
  } catch (err) {
    throw new VoyagerError(`Réseau : ${err.message || err}`, 0);
  }

  if (res.status === 401) {
    throw new VoyagerError("Session LinkedIn expirée. Recharge linkedin.com.", 401);
  }
  if (!res.ok) {
    throw new VoyagerError(`Voyager ${res.status} sur ${new URL(url).pathname}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new VoyagerError(
      "Réponse Voyager non-JSON (LinkedIn a probablement changé).",
      res.status,
    );
  }
}

// ---------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------
// Voyager renvoie soit `{ elements: [...] }`, soit une forme normalisée
// `{ data: {...}, included: [...] }` où les objets se référencent par
// URN. Les parsers ci-dessous sont volontairement défensifs : un champ
// manquant donne null, jamais une exception — une conversation mal
// formée ne doit pas faire perdre tout le lot.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Index des objets `included` par entityUrn, pour résoudre les refs. */
function indexIncluded(payload) {
  const map = new Map();
  for (const item of asArray(payload?.included)) {
    if (item && typeof item.entityUrn === "string") map.set(item.entityUrn, item);
  }
  return map;
}

function pickString(...candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Le texte d'un profil Voyager, quelle que soit la variante de schéma. */
function readProfile(node, included) {
  if (!node) return null;
  const resolved = typeof node === "string" ? included.get(node) : node;
  if (!resolved || typeof resolved !== "object") return null;

  const nested =
    resolved.miniProfile ||
    resolved.profile ||
    (typeof resolved["*miniProfile"] === "string"
      ? included.get(resolved["*miniProfile"])
      : null) ||
    resolved;

  const first = pickString(nested.firstName, nested.givenName);
  const last = pickString(nested.lastName, nested.familyName);
  const name = pickString(nested.name, [first, last].filter(Boolean).join(" ")) || null;

  return {
    urn: pickString(nested.entityUrn, resolved.entityUrn, nested.objectUrn) || "",
    name,
    firstName: first || "",
    lastName: last || "",
    headline: pickString(
      nested.occupation,
      nested.headline,
      typeof nested.headline === "object" ? nested.headline?.text : null,
    ),
    publicIdentifier: pickString(nested.publicIdentifier, nested.publicId),
    pictureUrl: null,
  };
}

function readTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Voyager donne des epoch en millisecondes.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Extrait le texte d'un événement de message, toutes variantes. */
function readMessageBody(event) {
  const ec = event?.eventContent || {};
  return pickString(
    ec.attributedBody?.text,
    ec.body?.text,
    ec.body,
    event?.body?.text,
    event?.body,
  );
}

/**
 * `urn:li:fs_conversation:2-abc==` → `2-abc==`, l'identifiant attendu
 * par l'endpoint des événements.
 */
export function conversationIdFromUrn(urn) {
  if (typeof urn !== "string") return null;
  const parts = urn.split(":");
  const last = parts[parts.length - 1];
  return last && last !== urn ? last : null;
}

// ---------------------------------------------------------------------
// Appels de haut niveau
// ---------------------------------------------------------------------

/**
 * Liste les conversations récentes. Renvoie des paires
 * `{ id, conversation }` : `conversation` est déjà au format attendu
 * par POST /api/linkedin/ingest (c'est l'extension qui porte la
 * connaissance de Voyager, pas le serveur), `id` est l'identifiant
 * technique dont l'endpoint des événements a besoin.
 */
export async function fetchConversations(counters) {
  const payload = await voyagerFetch(ENDPOINTS.conversations);
  counters.calls += 1;
  const included = indexIncluded(payload);
  const elements = asArray(payload?.elements).length
    ? asArray(payload.elements)
    : asArray(payload?.data?.elements);

  const out = [];
  for (const el of elements.slice(0, LIMITS.MAX_CONVERSATIONS_PER_RUN)) {
    const urn = pickString(el?.entityUrn, el?.dashEntityUrn);
    if (!urn) continue;

    const participants = asArray(el?.participants)
      .map((p) => readProfile(p?.messagingMember || p, included))
      .filter((p) => p?.urn)
      .map((p) => ({
        urn: p.urn,
        name: p.name,
        headline: p.headline,
        publicIdentifier: p.publicIdentifier,
        pictureUrl: p.pictureUrl,
      }));

    out.push({
      id: conversationIdFromUrn(urn),
      conversation: {
        conversationUrn: urn,
        title:
          pickString(el?.name) ||
          participants
            .map((p) => p.name)
            .filter(Boolean)
            .join(", ") ||
          null,
        isGroup: participants.length > 1 || el?.groupChat === true,
        participants,
        messages: [],
      },
    });
  }
  return out;
}

/** Messages d'une conversation, normalisés pour l'ingestion. */
export async function fetchMessages(conversationId, counters) {
  const payload = await voyagerFetch(ENDPOINTS.events(conversationId));
  counters.calls += 1;
  const included = indexIncluded(payload);
  const elements = asArray(payload?.elements).length
    ? asArray(payload.elements)
    : asArray(payload?.data?.elements);

  const out = [];
  for (const ev of elements.slice(0, LIMITS.MAX_MESSAGES_PER_CONVERSATION)) {
    const urn = pickString(ev?.entityUrn, ev?.dashEntityUrn);
    if (!urn) continue;
    const sender = readProfile(
      ev?.from?.["com.linkedin.voyager.messaging.MessagingMember"] || ev?.from,
      included,
    );
    out.push({
      messageUrn: urn,
      senderUrn: sender?.urn || null,
      senderName: sender?.name || null,
      senderPublicIdentifier: sender?.publicIdentifier || null,
      // `subtype: MEMBER_TO_MEMBER` + absence de flag entrant : Voyager
      // ne marque pas explicitement le sens, on le déduit côté serveur
      // au besoin. Par défaut on considère le message comme entrant.
      direction: "in",
      bodyText: readMessageBody(ev),
      sentAt: readTimestamp(ev?.createdAt),
    });
  }
  return out;
}

/** Relations, paginées et plafonnées. */
export async function fetchConnections(counters) {
  const out = [];
  let start = 0;

  while (out.length < LIMITS.MAX_CONNECTIONS_PER_RUN) {
    const payload = await voyagerFetch(ENDPOINTS.connections(start, LIMITS.CONNECTIONS_PAGE_SIZE));
    counters.calls += 1;
    const included = indexIncluded(payload);
    const elements = asArray(payload?.elements).length
      ? asArray(payload.elements)
      : asArray(payload?.data?.elements);
    if (elements.length === 0) break;

    for (const el of elements) {
      const profile = readProfile(el?.connectedMemberResolutionResult || el, included);
      if (!profile || !profile.urn) continue;
      out.push({
        memberUrn: profile.urn,
        publicIdentifier: profile.publicIdentifier,
        firstName: profile.firstName,
        lastName: profile.lastName,
        headline: profile.headline,
        company: null,
        position: null,
        profileUrl: profile.publicIdentifier
          ? `https://www.linkedin.com/in/${profile.publicIdentifier}`
          : null,
        email: null,
        connectedAt: readTimestamp(el?.createdAt),
      });
    }

    if (elements.length < LIMITS.CONNECTIONS_PAGE_SIZE) break;
    start += LIMITS.CONNECTIONS_PAGE_SIZE;
    await humanDelay();
  }

  return out.slice(0, LIMITS.MAX_CONNECTIONS_PER_RUN);
}

/**
 * Diagnostic : interroge chaque endpoint une fois et rapporte ce qui
 * répond. Indispensable le jour où LinkedIn change quelque chose —
 * ça évite de deviner.
 */
export async function diagnose() {
  const report = [];
  const probes = [
    ["conversations", ENDPOINTS.conversations],
    ["connections", ENDPOINTS.connections(0, 1)],
  ];
  for (const [name, url] of probes) {
    try {
      const payload = await voyagerFetch(url);
      const n = asArray(payload?.elements).length || asArray(payload?.data?.elements).length || 0;
      report.push(`${name} : OK (${n} éléments)`);
    } catch (err) {
      report.push(`${name} : ${err.message}`);
    }
    await humanDelay();
  }
  return report;
}
