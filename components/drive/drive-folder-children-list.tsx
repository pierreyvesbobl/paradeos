"use client";

import { formatDate } from "@/lib/format";
import { ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_LIMIT = 10;

export type DriveFolderChild = {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
};

export function DriveFolderChildrenList({ files }: { files: DriveFolderChild[] }) {
  const [showAll, setShowAll] = useState(false);

  if (files.length === 0) {
    return (
      <p className="text-muted-foreground text-xs italic">
        Dossier vide — ajoute des fichiers dans Drive et ils apparaîtront ici.
      </p>
    );
  }

  const visible = showAll ? files : files.slice(0, DEFAULT_LIMIT);
  const hidden = files.length - visible.length;

  return (
    <div className="space-y-1.5">
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((f) => {
          const isFolder = f.mimeType === FOLDER_MIME;
          const href =
            f.webViewLink ??
            (isFolder
              ? `https://drive.google.com/drive/folders/${f.id}`
              : `https://drive.google.com/open?id=${f.id}`);
          return (
            <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5">
              {f.iconLink ? (
                <Image
                  src={f.iconLink}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4 shrink-0"
                  unoptimized
                />
              ) : (
                <span className="size-4 shrink-0 rounded-sm bg-muted" />
              )}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm hover:underline"
                title={f.name}
              >
                {f.name}
              </a>
              {f.size && !isFolder ? (
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {formatBytes(Number.parseInt(f.size, 10))}
                </span>
              ) : null}
              {f.modifiedTime ? (
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {formatDate(f.modifiedTime)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {files.length > DEFAULT_LIMIT ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex items-center gap-1 px-1 text-muted-foreground text-xs hover:text-foreground"
        >
          {showAll ? (
            <>
              <ChevronUp className="size-3" />
              Réduire
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              Voir {hidden} de plus
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function formatBytes(b: number): string {
  if (!Number.isFinite(b)) return "";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}
