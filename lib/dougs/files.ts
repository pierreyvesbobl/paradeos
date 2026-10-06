import { fetchWithTimeout } from "../net/fetch-with-timeout";
import { BASE, DougsApiError, DougsAuthError, loadSession, touchUsed } from "./http";

/** Plafond mémoire pour un justificatif (25 Mio). */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 5;

export type DougsDownloadedFile = {
  buffer: Buffer;
  contentType: string;
  filename: string | null;
};

/**
 * Télécharge un justificatif Dougs.
 *
 * Dougs répond par une 302 vers une URL S3/CDN pré-signée. On suit la
 * redirection **à la main** (`redirect: "manual"`) pour une raison de
 * sécurité : `fetch` en mode `follow` rejouerait nos en-têtes — dont le
 * cookie de session Dougs — vers un hôte tiers. Ici, dès que le prochain
 * saut sort de `app.dougs.fr`, on repart sans aucun en-tête : l'URL
 * signée se suffit à elle-même.
 *
 * On refuse par ailleurs tout saut non-HTTPS ou portant des identifiants
 * dans l'URL, et on borne le corps lu à 25 Mio pour ne pas faire sauter
 * la mémoire de la fonction Vercel sur un PDF anormalement gros.
 */
export async function downloadDougsFile(
  userId: string,
  fileUuid: string,
): Promise<DougsDownloadedFile> {
  return downloadFromDougs(
    userId,
    `/files/${encodeURIComponent(fileUuid)}/actions/download`,
    fileUuid,
  );
}

/**
 * PDF d'un **brouillon** de facture de vente. Permet de montrer le document
 * exact que recevra le client sans le finaliser, donc sans consommer de numéro
 * de facture.
 */
export async function downloadDougsSalesInvoiceDraftPdf(
  userId: string,
  draftId: string,
): Promise<DougsDownloadedFile> {
  return downloadFromDougs(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/download`,
    `brouillon ${draftId}`,
  );
}

/** PDF d'un brouillon de devis. Même usage que ci-dessus. */
export async function downloadDougsQuoteDraftPdf(
  userId: string,
  draftId: string,
): Promise<DougsDownloadedFile> {
  return downloadFromDougs(
    userId,
    `/companies/{companyId}/invoicing/quote-drafts/${draftId}/actions/download`,
    `devis ${draftId}`,
  );
}

async function downloadFromDougs(
  userId: string,
  pathTemplate: string,
  label: string,
): Promise<DougsDownloadedFile> {
  const session = await loadSession(userId);
  if (!session) {
    throw new DougsAuthError(
      "Aucune session Dougs connectée. Va dans /settings/integrations pour coller ton cookie.",
    );
  }

  let url = new URL(`${BASE}${pathTemplate.replace("{companyId}", session.companyId)}`);
  let redirects = 0;

  while (true) {
    const sameOrigin = url.origin === BASE;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "manual",
      headers: sameOrigin ? { Cookie: session.cookie } : {},
      timeoutMs: 15000,
      label: `Dougs GET ${url.pathname}`,
    });

    if (res.status >= 300 && res.status < 400) {
      if (redirects >= MAX_DOWNLOAD_REDIRECTS) {
        throw new DougsApiError(
          "Trop de redirections sur le téléchargement Dougs.",
          res.status,
          "",
        );
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new DougsApiError("Redirection Dougs sans en-tête Location.", res.status, "");
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new DougsApiError("Redirection Dougs avec une URL invalide.", res.status, "");
      }
      if (next.protocol !== "https:" || next.username || next.password) {
        throw new DougsApiError(
          "Redirection Dougs refusée : HTTPS sans identifiants exigé.",
          res.status,
          "",
        );
      }
      url = next;
      redirects += 1;
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new DougsAuthError(
        "Cookie Dougs expiré ou invalide. Va dans /settings/integrations le rafraîchir.",
      );
    }
    if (!res.ok) {
      throw new DougsApiError(
        `Dougs ${res.status} ${res.statusText} (téléchargement ${label})`,
        res.status,
        "",
      );
    }

    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      throw new DougsApiError("Justificatif Dougs trop volumineux (> 25 Mio).", 413, "");
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new DougsApiError("Justificatif Dougs trop volumineux (> 25 Mio).", 413, "");
    }

    await touchUsed(userId);
    return {
      buffer,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      filename: parseContentDispositionFilename(res.headers.get("content-disposition")),
    };
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
