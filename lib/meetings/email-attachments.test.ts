import { describe, expect, it } from "vitest";
import {
  classifyEmailAttachment,
  cleanEmailBodyForTranscript,
  fileExtension,
  htmlToPlainText,
  pickTranscriptSource,
  sanitizeAudioFileName,
  titleFromSubject,
} from "./email-attachments";

const att = (filename: string, mimeType = "application/octet-stream", size = 1000) => ({
  filename,
  mimeType,
  size,
});

describe("fileExtension", () => {
  it("prend l'extension en minuscule", () => {
    expect(fileExtension("Compte-rendu.TXT")).toBe("txt");
    expect(fileExtension("reunion.2026.m4a")).toBe("m4a");
  });

  it("rend null sans extension exploitable", () => {
    expect(fileExtension("transcript")).toBeNull();
    expect(fileExtension(".gitignore")).toBeNull();
    expect(fileExtension("fin.")).toBeNull();
  });
});

describe("classifyEmailAttachment", () => {
  it("classe par extension, même quand le MIME est génerique", () => {
    expect(classifyEmailAttachment(att("cr.txt"))).toBe("text");
    expect(classifyEmailAttachment(att("cr.vtt"))).toBe("text");
    expect(classifyEmailAttachment(att("cr.pdf"))).toBe("pdf");
    expect(classifyEmailAttachment(att("reunion.m4a"))).toBe("audio");
  });

  it("retombe sur le MIME quand l'extension ne dit rien", () => {
    expect(classifyEmailAttachment(att("transcript", "text/plain"))).toBe("text");
    expect(classifyEmailAttachment(att("piece", "application/pdf"))).toBe("pdf");
    expect(classifyEmailAttachment(att("visio", "video/mp4"))).toBe("audio");
  });

  it("ignore ce qui ne peut pas porter un transcript", () => {
    expect(classifyEmailAttachment(att("logo.png", "image/png"))).toBeNull();
    expect(classifyEmailAttachment(att("memo.wma", "audio/x-ms-wma"))).toBe("audio");
    expect(classifyEmailAttachment(att("archive.zip", "application/zip"))).toBeNull();
  });
});

describe("pickTranscriptSource", () => {
  it("préfère le texte déjà écrit à l'audio à transcrire", () => {
    const picked = pickTranscriptSource([att("reunion.mp3"), att("cr.txt")]);
    expect(picked).toEqual({ kind: "text", attachment: att("cr.txt") });
  });

  it("préfère le texte au PDF, et le PDF à l'audio", () => {
    expect(pickTranscriptSource([att("cr.pdf"), att("cr.md")])?.kind).toBe("text");
    expect(pickTranscriptSource([att("reunion.wav"), att("cr.pdf")])?.kind).toBe("pdf");
  });

  it("à nature égale, garde la plus grosse — le transcript complet", () => {
    const picked = pickTranscriptSource([
      att("extrait.txt", "text/plain", 500),
      att("complet.txt", "text/plain", 50_000),
    ]);
    expect(picked?.attachment.filename).toBe("complet.txt");
  });

  it("rend null quand aucune PJ n'est exploitable", () => {
    expect(pickTranscriptSource([])).toBeNull();
    expect(pickTranscriptSource([att("logo.png", "image/png")])).toBeNull();
  });
});

describe("titleFromSubject", () => {
  it("retire les préfixes de réponse et de transfert empilés", () => {
    expect(titleFromSubject("TR: Fwd: Re: Point hebdo Acme", "x")).toBe("Point hebdo Acme");
    expect(titleFromSubject("RE[2]: Cadrage", "x")).toBe("Cadrage");
  });

  it("retombe sur le fallback si l'objet est vide ou absent", () => {
    expect(titleFromSubject(null, "Réunion du 12/03")).toBe("Réunion du 12/03");
    expect(titleFromSubject("  Fwd:  ", "Réunion du 12/03")).toBe("Réunion du 12/03");
  });

  it("garde un objet qui commence par un mot proche d'un préfixe", () => {
    expect(titleFromSubject("Refonte site : brief", "x")).toBe("Refonte site : brief");
  });
});

describe("cleanEmailBodyForTranscript", () => {
  it("retire l'entête de transfert et garde le transcript", () => {
    const body = [
      "Voici le compte-rendu.",
      "",
      "---------- Message transféré ---------",
      "De : Jean <jean@acme.com>",
      "Date : lun. 12 mars 2026",
      "Objet : Notes de réunion",
      "À : moi <moi@example.com>",
      "",
      "Jean : on valide le devis.",
      "Marie : je relance lundi.",
    ].join("\n");
    expect(cleanEmailBodyForTranscript(body)).toBe(
      "Voici le compte-rendu.\n\nJean : on valide le devis.\nMarie : je relance lundi.",
    );
  });

  it("coupe la conversation citée et la signature", () => {
    const body = [
      "Jean : on valide le devis.",
      "",
      "-- ",
      "Pierre-Yves, Parade",
      "06 12 34 56 78",
    ].join("\n");
    expect(cleanEmailBodyForTranscript(body)).toBe("Jean : on valide le devis.");
  });

  it("coupe au « Le … a écrit : »", () => {
    const body = [
      "Marie : je relance lundi.",
      "",
      "Le 12 mars 2026 à 09:12, Jean <jean@acme.com> a écrit :",
      "> texte du mail précédent",
    ].join("\n");
    expect(cleanEmailBodyForTranscript(body)).toBe("Marie : je relance lundi.");
  });
});

describe("htmlToPlainText", () => {
  it("rend le texte des paragraphes et décode les entités", () => {
    expect(htmlToPlainText("<p>Jean&nbsp;: devis &amp; planning</p><p>Marie : OK</p>")).toBe(
      "Jean : devis & planning\nMarie : OK",
    );
  });

  it("jette scripts et styles", () => {
    expect(htmlToPlainText("<style>p{color:red}</style><p>Notes</p>")).toBe("Notes");
  });
});

describe("sanitizeAudioFileName", () => {
  it("translittère et neutralise les caractères de chemin", () => {
    expect(sanitizeAudioFileName("Réunion 12/03 (final).m4a")).toBe("Reunion_12_03_final_.m4a");
  });

  it("garde un nom par défaut si tout est filtré", () => {
    expect(sanitizeAudioFileName("///")).toBe("audio");
  });
});
