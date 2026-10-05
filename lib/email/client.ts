import "server-only";
import { Resend } from "resend";

type SendInput = {
  to: string | string[];
  subject: string;
  html: string;
  /** Texte brut pour les clients qui ne rendent pas l'HTML. Optionnel. */
  text?: string;
  /** Adresse de réponse, si différente de EMAIL_FROM. */
  replyTo?: string | string[];
  /** Regroupement (visible dans Resend dashboard). */
  tags?: { name: string; value: string }[];
  /**
   * Pièces jointes. Sert à envoyer nous-mêmes une facture avec le PDF légal
   * généré par Dougs, pour contrôler le mail sans dupliquer le document.
   */
  attachments?: { filename: string; content: Buffer }[];
  /**
   * Nom affiché de l'expéditeur, à la place de celui de `EMAIL_FROM`. Permet
   * d'envoyer sous le nom d'une marque (« Parade Coworking ») sans changer
   * l'adresse, qui doit rester sur le domaine vérifié chez Resend.
   */
  fromName?: string;
};

/**
 * Remplace le nom affiché d'un `From` en gardant l'adresse intacte.
 * `"Parade OS <no-reply@x.fr>"` + `"Coworking"` → `"Coworking <no-reply@x.fr>"`.
 * L'adresse ne doit jamais changer : c'est elle que Resend a vérifiée.
 */
function withFromName(from: string, name: string | undefined): string {
  if (!name) return from;
  const match = from.match(/<([^>]+)>/);
  const address = match ? match[1] : from.trim();
  // Les guillemets dans un display name casseraient l'en-tête.
  return `${name.replace(/["<>]/g, "")} <${address}>`;
}

/**
 * Envoie un e-mail transactionnel.
 *  - `EMAIL_DELIVERY=resend` → vraie expédition via l'API Resend.
 *  - toute autre valeur, vide comprise → log stdout, pratique en dev.
 *
 * Le test est volontairement strict (`=== "resend"`) : un `??` ne rattrape pas
 * la chaîne vide, et une variable mal renseignée doit retomber sur le
 * comportement sûr, pas déclencher des envois réels par accident.
 *
 * Fail-safe : ne lève jamais d'exception côté caller — les erreurs sont
 * loggées. Pour la plupart des mails c'est le bon arbitrage (accessoires, pas
 * bloquants). **`delivered` distingue « expédié » de « simplement loggué »** :
 * les appelants pour qui l'envoi est le cœur du métier — une facture envoyée à
 * un client — doivent le vérifier, sinon ils concluraient au succès alors que
 * rien n'est parti.
 */
export async function sendEmail(
  input: SendInput,
): Promise<{ ok: boolean; id?: string; delivered: boolean }> {
  const delivery = (process.env.EMAIL_DELIVERY ?? "").trim();
  const from = withFromName(
    process.env.EMAIL_FROM ?? "Parade OS <noreply@parade.local>",
    input.fromName,
  );

  if (delivery !== "resend") {
    console.info("[email:console]", {
      from,
      to: input.to,
      subject: input.subject,
      attachments: input.attachments?.map((a) => `${a.filename} (${a.content.length} o)`),
      preview: input.html.slice(0, 200),
    });
    return { ok: true, delivered: false };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY manquant, e-mail non envoyé.");
    return { ok: false, delivered: false };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      tags: input.tags,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false, delivered: false };
    }
    return { ok: true, id: data?.id, delivered: true };
  } catch (err) {
    console.error("[email] Unexpected error:", err);
    return { ok: false, delivered: false };
  }
}

/** Wrapper HTML minimal — header/footer cohérent. */
export function emailLayout(content: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#4f46e5;">Parade OS</p>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.5;">
      ${content}
    </div>
    <div style="padding:12px 24px;border-top:1px solid #e2e8f0;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#64748b;">Parade SAS · Lyon</p>
    </div>
  </div>
</body>
</html>`;
}
