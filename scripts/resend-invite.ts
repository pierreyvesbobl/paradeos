/**
 * Renvoie un email d'invitation (magic link) à un user existant. Le lien
 * pointe vers `NEXT_PUBLIC_APP_URL` (prod si correctement configuré).
 *
 * Usage : pnpm tsx scripts/resend-invite.ts <email> [<email> …]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { Resend } from "resend";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

function emailLayout(content: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#4f46e5;">Parade OS</p>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.5;">${content}</div>
    <div style="padding:12px 24px;border-top:1px solid #e2e8f0;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#64748b;">Parade SAS · Lyon</p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const emails = process.argv.slice(2);
  if (emails.length === 0) {
    console.error("Usage : pnpm tsx scripts/resend-invite.ts <email> [<email> …]");
    process.exit(1);
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("EMAIL_FROM");
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resend = new Resend(resendKey);

  for (const email of emails) {
    console.info(`\n→ ${email}`);
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) {
      console.error(`  ✗ generateLink: ${error.message}`);
      continue;
    }
    const tokenHash = data.properties?.hashed_token;
    if (!tokenHash) {
      console.error("  ✗ pas de hashed_token");
      continue;
    }
    const link = `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/settings/profile`;

    const html = emailLayout(`
      <p>Bonjour,</p>
      <p>Voici ton lien pour accéder à <strong>Parade OS</strong> (valable 1 h) :</p>
      <p style="margin:20px 0;">
        <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Ouvrir Parade OS</a>
      </p>
      <p style="color:#64748b;font-size:12px;">Si le bouton ne fonctionne pas, copie/colle ce lien dans ton navigateur :<br/>${link}</p>
    `);

    const { data: sent, error: sendErr } = await resend.emails.send({
      from,
      to: email,
      subject: "Ton accès à Parade OS",
      html,
      tags: [{ name: "type", value: "invite-resend" }],
    });
    if (sendErr) {
      console.error(`  ✗ Resend: ${sendErr.message ?? JSON.stringify(sendErr)}`);
      continue;
    }
    console.info(`  ✓ envoyé (id=${sent?.id})`);
    console.info(`    → ${link}`);
  }
}

main().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
