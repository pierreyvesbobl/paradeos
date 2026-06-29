import { ImageResponse } from "next/og";

// Next.js App Router icon convention — sert le favicon depuis cette route.
// Image générée via Satori (next/og) pour rester fidèle au brand mark
// (carré bleu --ds-primary-500 + "P" serif blanc) sans dépendre d'un
// asset binaire commité dans le repo.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#1F6F95",
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "ui-serif, Georgia, 'Times New Roman', serif",
        fontWeight: 600,
        fontSize: 22,
        lineHeight: 1,
        // 24% du gabarit, comme `.parade-mark`.
        borderRadius: 8,
      }}
    >
      P
    </div>,
    size,
  );
}
