"use client";

import { Button } from "@/components/ui/button";
import { setBrandLogo } from "@/lib/actions/integrations";
import { Image as ImageIcon, Upload } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type BrandRow = {
  brand: "coworking" | "automato" | "parade";
  label: string;
  configured: string | null;
  pinned: string | null;
};

export function BrandLogosSettings({ brands }: { brands: BrandRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {brands.map((row) => (
        <BrandLogoRow
          key={row.brand}
          row={row}
          pending={pending}
          busy={busy === row.brand}
          onUpload={(file) => {
            setBusy(row.brand);
            startTransition(async () => {
              try {
                // Normalisé avant envoi : c'est la seule prise qu'on ait sur la
                // taille apparente du logo, Dougs ne l'expose pas.
                const normalized = await normalizeLogo(file);
                const dataBase64 = await fileToBase64(normalized);
                const res = await setBrandLogo({
                  brand: row.brand,
                  filename: normalized.name,
                  contentType: normalized.type,
                  dataBase64,
                });
                if (!res.ok) {
                  toast.error(res.message);
                  return;
                }
                toast.success(`Logo ${row.label} mis à jour.`);
                router.refresh();
              } finally {
                setBusy(null);
              }
            });
          }}
        />
      ))}
    </div>
  );
}

function BrandLogoRow({
  row,
  pending,
  busy,
  onUpload,
}: {
  row: BrandRow;
  pending: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uuid = row.configured ?? row.pinned;

  return (
    <div className="flex items-center gap-4 rounded-md border bg-background p-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
        {uuid ? (
          // biome-ignore lint/performance/noImgElement: le proxy Dougs renvoie
          // un type arbitraire, next/image exigerait de déclarer un domaine.
          <img
            src={`/api/dougs/file/${uuid}`}
            alt={`Logo ${row.label}`}
            className="size-full object-contain"
          />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{row.label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {row.configured
            ? "Réglé ici"
            : row.pinned
              ? "Valeur par défaut du code — dépose une image pour la remplacer"
              : "Aucun logo : les documents prendront celui par défaut de la société"}
        </p>
        {uuid ? <p className="font-mono text-[10px] text-muted-foreground">{uuid}</p> : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          // Permet de redéposer le même fichier après une erreur.
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1.5 size-4" />
        {busy ? "Envoi…" : "Changer"}
      </Button>
    </div>
  );
}

/**
 * Gabarit commun à tous les logos de marque.
 *
 * Dougs met le logo dans une boîte de proportions fixes et l'y adapte : deux
 * images de rapports très différents n'occupent donc pas la même place sur le
 * document, ce qui faisait paraître un logo bien plus gros qu'un autre. En
 * déposant toutes les marques sur la **même toile**, avec un fond transparent
 * autour, on obtient un rendu homogène sans rien changer chez Dougs.
 *
 * 600 × 200 : assez grand pour rester net à l'impression, et un rapport 3:1 qui
 * convient aussi bien à un logo large qu'à un logo carré.
 */
const LOGO_CANVAS = { width: 600, height: 200 } as const;

/**
 * Redessine l'image sur la toile standard, centrée, sans la déformer ni
 * l'agrandir au-delà de sa taille d'origine (un petit logo étiré serait flou).
 *
 * Les SVG passent sans retouche : les rastériser leur ferait perdre leur
 * principal intérêt, et leur taille intrinsèque n'est pas toujours déclarée.
 */
async function normalizeLogo(file: File): Promise<File> {
  if (file.type === "image/svg+xml") return file;

  const bitmap = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_CANVAS.width;
  canvas.height = LOGO_CANVAS.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  // `min(..., 1)` : on réduit si l'image dépasse, jamais on n'agrandit.
  const scale = Math.min(LOGO_CANVAS.width / bitmap.width, LOGO_CANVAS.height / bitmap.height, 1);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (LOGO_CANVAS.width - w) / 2, (LOGO_CANVAS.height - h) / 2, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-normalise.png`, { type: "image/png" });
}

/** `createImageBitmap` quand il existe, sinon un `<img>` et son `onload`. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Certains navigateurs refusent des formats que `<img>` accepte.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image illisible."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Lit un fichier en base64 sans le préfixe `data:…;base64,`. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
