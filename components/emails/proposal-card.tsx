"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acceptEmailProposal, rejectEmailProposal } from "@/lib/actions/email-proposals";
import { DemoBlur } from "@/lib/demo/components";
import { formatDate } from "@/lib/format";
import {
  Briefcase,
  Building2,
  Check,
  ExternalLink,
  ListTodo,
  Mail,
  Reply,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type ProposalKind =
  | "task"
  | "category_tag"
  | "project_link"
  | "contact"
  | "entity"
  | "project"
  | "draft_reply";

type Proposal = {
  id: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  matchedId: string | null;
  matchConfidence: string | null;
  matchedProjectName: string | null;
  matchedTagLabel: string | null;
  matchedContactName: string | null;
  matchedEntityName: string | null;
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

const KIND_ICON: Record<ProposalKind, typeof ListTodo> = {
  task: ListTodo,
  category_tag: Tag,
  project_link: Briefcase,
  contact: UserPlus,
  entity: Building2,
  project: Briefcase,
  draft_reply: Reply,
};

const KIND_LABEL: Record<ProposalKind, string> = {
  task: "Tâche",
  category_tag: "Catégorie",
  project_link: "Lien projet",
  contact: "Contact",
  entity: "Entité",
  project: "Projet",
  draft_reply: "Brouillon de réponse",
};

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
            <DemoBlur>{message.subject || "(sans objet)"}</DemoBlur>
          </Link>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <DemoBlur>
              {message.fromName ? `${message.fromName} ` : ""}
              {message.fromEmail ? `<${message.fromEmail}>` : ""}
            </DemoBlur>
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
            : p.kind === "project_link"
              ? "Lien projet ajouté."
              : p.kind === "contact"
                ? "Contact créé."
                : p.kind === "entity"
                  ? "Entité créée."
                  : p.kind === "draft_reply"
                    ? "Brouillon Gmail créé."
                    : "Projet créé.",
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
          <span className="font-medium text-sm">
            <DemoBlur>{describeProposal(p)}</DemoBlur>
          </span>
          {p.matchConfidence ? (
            <span className="text-[10px] text-muted-foreground">
              · match {(Number(p.matchConfidence) * 100).toFixed(0)}%
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          <DemoBlur>{describeDetails(p)}</DemoBlur>
        </p>
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
    return p.matchedTagLabel ? (p.matchedTagLabel.split("/").pop() ?? name) : name;
  }
  if (p.kind === "project_link") {
    return p.matchedProjectName ?? String(p.payload.projectName ?? "Projet");
  }
  if (p.kind === "contact") {
    return (
      `${String(p.payload.firstName ?? "").trim()} ${String(p.payload.lastName ?? "").trim()}`.trim() ||
      "Contact"
    );
  }
  if (p.kind === "entity") {
    return String(p.payload.name ?? "Entité");
  }
  if (p.kind === "draft_reply") {
    return String(p.payload.subject ?? "Re: (sans objet)");
  }
  // project (création)
  return String(p.payload.name ?? "Projet");
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
    return "Catégorie existante — sera appliquée au thread.";
  }
  if (p.kind === "project_link") {
    return p.matchedProjectName
      ? "Lie le thread à ce projet (label Gmail ajouté)."
      : "Projet pas encore créé dans le CRM.";
  }
  if (p.kind === "contact") {
    const parts: string[] = [];
    if (p.payload.email) parts.push(String(p.payload.email));
    if (p.payload.jobTitle) parts.push(String(p.payload.jobTitle));
    if (p.payload.entityName) parts.push(`@ ${String(p.payload.entityName)}`);
    if (p.matchedContactName) parts.push(`déjà connu : ${p.matchedContactName}`);
    return parts.join(" · ") || "Nouveau contact à créer.";
  }
  if (p.kind === "entity") {
    const parts: string[] = [];
    if (p.payload.kind) parts.push(String(p.payload.kind));
    if (p.matchedEntityName) parts.push(`déjà connue : ${p.matchedEntityName}`);
    return parts.join(" · ") || "Nouvelle entité à créer.";
  }
  if (p.kind === "draft_reply") {
    const body = String(p.payload.body ?? "");
    return body.slice(0, 140) + (body.length > 140 ? "…" : "");
  }
  // project (création)
  const parts: string[] = [];
  if (p.payload.entityName) parts.push(`pour ${String(p.payload.entityName)}`);
  if (p.payload.status) parts.push(String(p.payload.status));
  if (p.payload.valueAmount) parts.push(`${p.payload.valueAmount}€`);
  if (p.matchedProjectName) parts.push(`déjà connu : ${p.matchedProjectName}`);
  return parts.join(" · ") || "Nouveau projet à créer.";
}
