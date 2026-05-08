import { requireUser } from "@/lib/auth/server";
import { getValidAccessToken } from "@/lib/google/account";
import { NextResponse } from "next/server";

/**
 * Renvoie un access_token Google valide pour le user courant. Utilisé
 * par le composant client `DrivePickerButton` pour initialiser le
 * Google Picker (qui a besoin d'un OAuth token frais à chaque ouverture).
 *
 * Le token est court-lived (typiquement 1h) et ne contient pas le
 * refresh_token — pas de problème à le renvoyer via fetch.
 */
export async function GET() {
  const user = await requireUser();
  try {
    const token = await getValidAccessToken(user.id);
    if (!token) {
      return NextResponse.json({ error: "no_account" }, { status: 404 });
    }
    return NextResponse.json({ accessToken: token });
  } catch (err) {
    console.error("[google access-token]", err);
    return NextResponse.json({ error: "refresh_failed" }, { status: 500 });
  }
}
