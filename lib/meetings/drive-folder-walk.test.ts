import { describe, expect, it } from "vitest";
import {
  DRIVE_FOLDER_MIME,
  type WalkableDriveFile,
  walkTranscriptFolder,
} from "./drive-folder-walk";

const DOC = "application/vnd.google-apps.document";

function file(id: string, name: string, mimeType = DOC, modifiedTime?: string): WalkableDriveFile {
  return { id, name, mimeType, modifiedTime };
}

function folder(id: string, name: string, modifiedTime?: string): WalkableDriveFile {
  return file(id, name, DRIVE_FOLDER_MIME, modifiedTime);
}

/** Un Drive en mémoire : `tree[dossier]` = ses enfants directs. */
function lister(tree: Record<string, WalkableDriveFile[]>, calls: string[] = []) {
  return async (folderId: string, limit: number) => {
    calls.push(folderId);
    const children = tree[folderId];
    if (!children) throw new Error(`404 ${folderId}`);
    return children.slice(0, limit);
  };
}

describe("walkTranscriptFolder", () => {
  it("rend les fichiers à plat et ceux des sous-dossiers, jamais les dossiers", async () => {
    const tree = {
      root: [
        folder("old", "Meet Recordings", "2025-07-15T12:42:11Z"),
        folder("m1", "Point Channel Health - 2026/10/09 16:56 CEST", "2026-10-09T15:45:59Z"),
        file("flat", "Réunion à plat - 2026/08/31 14:23 CEST - Transcript"),
      ],
      old: [file("a", "Ancien - 2025/07/29 10:00 CEST - Transcript")],
      m1: [
        file("t1", "Point Channel Health - 2026/10/09 16:56 CEST - Transcript"),
        folder("nested", "Pièces jointes"),
      ],
    };
    const { files, errors } = await walkTranscriptFolder("root", lister(tree));
    expect(files.map((f) => f.id)).toEqual(["flat", "t1", "a"]);
    expect(errors).toEqual([]);
  });

  it("explore les sous-dossiers les plus récents d'abord et s'arrête au plafond", async () => {
    const calls: string[] = [];
    const tree = {
      root: [
        folder("s1", "Un", "2026-10-01T00:00:00Z"),
        folder("s3", "Trois", "2026-10-03T00:00:00Z"),
        folder("s2", "Deux", "2026-10-02T00:00:00Z"),
      ],
      s1: [file("f1", "Un - Transcript")],
      s2: [file("f2", "Deux - Transcript")],
      s3: [file("f3", "Trois - Transcript")],
    };
    const { files } = await walkTranscriptFolder("root", lister(tree, calls), {
      maxSubfolders: 2,
    });
    expect(calls).toEqual(["root", "s3", "s2"]);
    expect(files.map((f) => f.id)).toEqual(["f3", "f2"]);
  });

  it("consigne un sous-dossier illisible sans interrompre la tournée", async () => {
    const tree = {
      root: [
        folder("bad", "Cassé", "2026-10-05T00:00:00Z"),
        folder("ok", "Bon", "2026-10-04T00:00:00Z"),
      ],
      ok: [file("f", "Bon - Transcript")],
    };
    const { files, errors } = await walkTranscriptFolder("root", lister(tree));
    expect(files.map((f) => f.id)).toEqual(["f"]);
    expect(errors.map((e) => [e.folder.name, e.error.message])).toEqual([["Cassé", "404 bad"]]);
  });

  it("laisse remonter l'échec du dossier racine", async () => {
    await expect(walkTranscriptFolder("missing", lister({}))).rejects.toThrow("404 missing");
  });
});
