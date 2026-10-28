import "server-only";

import { getSetting, SETTING_KEYS } from "@/lib/settings";

export type RepoFileResult =
  | { status: "ok"; sha: string; text: string }
  | { status: "no_token" }
  | { status: "error"; httpStatus: number | null; message: string };

/**
 * Un fichier d'un dépôt GitHub (branche par défaut), lu avec le jeton du
 * réglage `GITHUB_TOKEN`. Demande « Contents : lecture » sur le jeton.
 * Pas de cache : l'appelant stocke l'instantané (cf. repo_roadmaps).
 */
export async function getRepoFile(
  ref: { owner: string; repo: string },
  path: string,
): Promise<RepoFileResult> {
  const token = await getSetting(SETTING_KEYS.GITHUB_TOKEN);
  if (!token) return { status: "no_token" };

  const cleanPath = path.replace(/^\/+/, "");
  const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${cleanPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
  } catch (err) {
    return {
      status: "error",
      httpStatus: null,
      message: err instanceof Error ? err.message : "GitHub injoignable.",
    };
  }
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Jeton GitHub refusé."
        : res.status === 403
          ? "Le jeton voit le dépôt mais n'a pas la permission « Contents : lecture »."
          : res.status === 404
            ? `Fichier ${cleanPath} introuvable, ou jeton sans « Contents : lecture » sur ce dépôt.`
            : `GitHub a répondu ${res.status}.`;
    return { status: "error", httpStatus: res.status, message };
  }
  const body = (await res.json()) as {
    type?: string;
    sha?: string;
    content?: string;
    encoding?: string;
  };
  if (body.type !== "file" || typeof body.content !== "string" || !body.sha) {
    return { status: "error", httpStatus: null, message: `${cleanPath} n'est pas un fichier.` };
  }
  const text =
    body.encoding === "base64"
      ? Buffer.from(body.content, "base64").toString("utf8")
      : body.content;
  return { status: "ok", sha: body.sha, text };
}
