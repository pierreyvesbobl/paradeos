"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acceptEmailProposal, rejectEmailProposal } from "@/lib/actions/email-proposals";
import { formatDate } from "@/lib/format";
import { Briefcase, Check, ExternalLink, ListTodo, Mail, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Proposal = {
  id: string;
  kind: "task" | "category_tag" | "project_link";
  payload: Record<string, unknown>;
  matchedId: string | null;
  matchConfidence: string | null;
  matchedProjectName: string | null;
  matchedTagLabel: string | null;
};

type Props = {
  message: {
    subject: string | null;
    fromEmail: string | null;
    fromName: string | null;
    date: string | null;
    threadId: string;
    gmailThreadId: string;
  };
  proposals: Proposal[];
};

const KIND_ICON = {
  task: ListTodo,
  category_tag: Tag,
  project_link: Briefcase,
} as const;

const KIND_LABEL = {
  task: "Tâche",
  category_tag: "Catégorie",
  project_link: "Lien projet",
} as const;

export function ProposalCard({ message, proposals }: Props) {
  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/emails/${message.threadId}`}
            className="block min-w-0 truncate font-medium text-sm hover:underline"
          >
            <Mail className="-mt-0.5 mr-1 inline size-3.5 text-muted-foreground" />
            {message.subject || "(sans objet)"}
          </Link>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {message.fromName ? `${message.fromName} ` : ""}
            {message.fromEmail ? `<${message.fromEmail}>` : ""}
            {message.date ? ` · ${formatDate(message.date)}` : ""}
          </p>
        </div>
        <a
          href={`https://mail.google.com/mail/u/0/#inbox/${message.gmailThreadId}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Ouvrir dans Gmail"
          title="Ouvrir dans Gmail"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </header>

      <ul className="space-y-2">
        {proposals.map((p) => (
          <ProposalRow key={p.id} proposal={p} />
        ))}
      </ul>
    </article>
  );
}

function ProposalRow({ proposal: p }: { proposal: Proposal }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = KIND_ICON[p.kind];

  function accept() {
    startTransition(async () => {
      const res = await acceptEmailProposal({ proposalId: p.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        p.kind === "task"
          ? "Tâche créée."
          : p.kind === "category_tag"
            ? "Tag appliqué."
            : "Lien projet ajouté.",
      );
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectEmailProposal({ proposalId: p.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex items-start gap-3 rounded-md border bg-background p-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {KIND_LABEL[p.kind]}
          </Badge>
          <span className="font-medium text-sm">{describeProposal(p)}</span>
          {p.matchConfidence ? (
            <span className="text-[10px] text-muted-foreground">
              · match {(Number(p.matchConfidence) * 100).toFixed(0)}%
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">{describeDetails(p)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          onClick={accept}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <Check className="size-3" />
          Accepter
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={reject}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
        >
          <X className="size-3" />
          Rejeter
        </Button>
      </div>
    </li>
  );
}

function describeProposal(p: Proposal): string {
  if (p.kind === "task") {
    return String(p.payload.title ?? "Sans titre");
  }
  if (p.kind === "category_tag") {
    const name = String(p.payload.name ?? "");
    return p.matchedTagLabel ? (p.matchedTagLabel.split("/").pop() ?? name) : `Créer « ${name} »`;
  }
  // project_link
  return p.matchedProjectName ?? String(p.payload.projectName ?? "Projet");
}

function describeDetails(p: Proposal): string {
  if (p.kind === "task") {
    const parts: string[] = [];
    if (p.payload.dueDate) parts.push(`due ${p.payload.dueDate as string}`);
    if (p.matchedProjectName) parts.push(`projet : ${p.matchedProjectName}`);
    else if (p.payload.projectName) parts.push(`projet : ${p.payload.projectName as string}`);
    if (p.payload.assigneeName) parts.push(`pour ${p.payload.assigneeName as string}`);
    if (p.payload.priority) parts.push(`priorité ${p.payload.priority as string}`);
    return parts.join(" · ") || "—";
  }
  if (p.kind === "category_tag") {
    return p.matchedTagLabel
      ? "Catégorie existante — sera appliquée au thread."
      : "Nouvelle catégorie — sera créée + appliquée.";
  }
  return p.matchedProjectName
    ? "Lie le thread à ce projet (label Gmail ajouté)."
    : "Projet pas encore créé dans le CRM.";
}
