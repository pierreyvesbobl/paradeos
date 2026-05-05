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
};

/**
 * Envoie un e-mail transactionnel.
 *  - EMAIL_DELIVERY=resend → vraie expédition via API Resend.
 *  - EMAIL_DELIVERY=console (défaut) → log stdout, pratique en dev.
 *
 * Fail-safe : ne lève jamais d'exception côté caller — les erreurs sont
 * loggées. Les e-mails sont accessoires, pas bloquants.
 */
export async function sendEmail(input: SendInput): Promise<{ ok: boolean; id?: string }> {
  const delivery = process.env.EMAIL_DELIVERY ?? "console";
  const from = process.env.EMAIL_FROM ?? "Parade OS <noreply@parade.local>";

  if (delivery === "console") {
    console.info("[email:console]", {
      from,
      to: input.to,
      subject: input.subject,
      preview: input.html.slice(0, 200),
    });
    return { ok: true };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY manquant, e-mail non envoyé.");
    return { ok: false };
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
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[email] Unexpected error:", err);
    return { ok: false };
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
