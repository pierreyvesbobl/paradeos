"use client";

import { PriorityPill } from "@/components/tasks/priority-pill";
import type {
  TaskContactOption,
  TaskProjectOption,
  TaskUserOption,
} from "@/components/tasks/task-types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContactAvatar } from "@/components/user/contact-avatar";
import { UserAvatar } from "@/components/user/user-avatar";
import { quickCreateTask } from "@/lib/actions/tasks";
import { formatDate } from "@/lib/format";
import { type TaskPriority, taskPriorityEnum, taskPriorityLabels } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";
import { CalendarIcon, Check, ChevronDown, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type Assignee =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null }
  | null;

type Props = {
  /** Si fourni, projet par défaut (fiche projet). */
  projectId?: string;
  /** Texte d'invite. */
  placeholder?: string;
  /** Membres internes pour le popover assigné. */
  userOptions?: TaskUserOption[];
  /** Contacts externes pour le popover assigné. */
  contactOptions?: TaskContactOption[];
  /** Liste des projets pour la colonne Projet (page /taches uniquement). */
  projectOptions?: TaskProjectOption[];
  /** Masque la colonne Projet (fiche projet — `defaultProjectId` posé). */
  hideProjectColumn?: boolean;
};

/**
 * Ligne d'ajout rapide alignée au design "Tâches consolidé" :
 * - En tête de la liste, fond `primary-50`, bordure gauche inset 2px primary.
 * - Colonnes alignées sur les colonnes du tableau (Titre / [Projet] /
 *   Priorité / Assigné / Échéance).
 * - Une ligne helper en dessous (raccourcis clavier + bouton Ajouter bleu).
 *
 * Comportement clavier :
 * - Entrée : crée la tâche (et garde la sélection des défauts pour la
 *   suivante si l'utilisateur tape ensuite).
 * - Maj+Entrée : crée la tâche ET garde le focus + tous les défauts pour
 *   enchaîner rapidement plusieurs créations.
 * - Échap : reset tout.
 */
export function QuickAddTask({
  projectId,
  placeholder = "Ajouter une tâche",
  userOptions = [],
  contactOptions = [],
  projectOptions = [],
  hideProjectColumn = false,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState<Assignee>(null);
  const [dueDate, setDueDate] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<TaskProjectOption | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = title.trim().length > 0 && !pending;

  function reset(opts?: { keepDefaults?: boolean }) {
    setTitle("");
    if (!opts?.keepDefaults) {
      setPriority("medium");
      setAssignee(null);
      setDueDate("");
      setSelectedProject(null);
    }
  }

  function submit(opts?: { chain?: boolean }) {
    const value = title.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await quickCreateTask({
        title: value,
        projectId: hideProjectColumn ? projectId : (selectedProject?.id ?? projectId),
        priority,
        assigneeId: assignee?.kind === "user" ? assignee.id : undefined,
        assigneeContactId: assignee?.kind === "contact" ? assignee.id : undefined,
        dueDate: dueDate || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      reset({ keepDefaults: opts?.chain });
      router.refresh();
      inputRef.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit({ chain: e.shiftKey });
    } else if (e.key === "Escape") {
      reset();
      inputRef.current?.blur();
    }
  }

  return (
    <div className="flex flex-col">
      {/* Ligne 1 — input alignée sur les colonnes */}
      <div
        className="flex min-h-[44px] items-center bg-primary-50 px-2"
        style={{ boxShadow: "inset 2px 0 0 var(--ds-primary-500)" }}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          aria-label="Ajouter une tâche"
          className="mr-3 inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-primary-300 border-dashed text-primary-500 outline-none transition-colors hover:border-primary-500 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-[10px] stroke-[3]" />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={pending}
          maxLength={300}
          className="min-w-0 flex-1 bg-transparent pr-3 text-ds-text text-sm caret-primary-500 outline-none placeholder:text-ds-text-tertiary disabled:opacity-50"
        />

        <span className="w-[60px] shrink-0" />

        {!hideProjectColumn ? (
          <span className="ml-1 w-[140px] shrink-0 pr-2">
            <ProjectPicker
              value={selectedProject}
              onChange={setSelectedProject}
              options={projectOptions}
            />
          </span>
        ) : null}

        <span className="w-[108px] shrink-0">
          <PriorityPicker value={priority} onChange={setPriority} />
        </span>

        <span className="w-[84px] shrink-0">
          <AssigneePicker
            value={assignee}
            onChange={setAssignee}
            userOptions={userOptions}
            contactOptions={contactOptions}
          />
        </span>

        <span className="w-[100px] shrink-0">
          <DueDateTrigger value={dueDate} onChange={setDueDate} />
        </span>
      </div>

      {/* Ligne 2 — helper raccourcis clavier + bouton Ajouter */}
      <div className="flex items-center gap-2.5 border-ds-border border-b bg-primary-50 px-2 py-1.5">
        <span className="text-[11px] text-ds-text-tertiary">
          <strong className="font-semibold text-ds-text-muted">Entrée</strong> pour créer ·{" "}
          <strong className="font-semibold text-ds-text-muted">Maj+Entrée</strong> pour enchaîner
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => submit()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-3 py-[5px] font-medium text-white text-xs outline-none transition-colors hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3 stroke-[3]" />
          {pending ? "…" : "Ajouter"}
        </button>
      </div>
    </div>
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (v: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Priorité"
        >
          <PriorityPill value={value} />
          <ChevronDown className="size-[9px] text-ds-text-tertiary opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
        <ul className="space-y-0.5">
          {taskPriorityEnum.options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-ds-hover"
              >
                <span>{taskPriorityLabels[opt]}</span>
                {opt === value ? <Check className="size-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function AssigneePicker({
  value,
  onChange,
  userOptions,
  contactOptions,
}: {
  value: Assignee;
  onChange: (v: Assignee) => void;
  userOptions: TaskUserOption[];
  contactOptions: TaskContactOption[];
}) {
  const [open, setOpen] = useState(false);

  function pickUser(u: TaskUserOption) {
    onChange({ kind: "user", id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl });
    setOpen(false);
  }
  function pickContact(c: TaskContactOption) {
    onChange({ kind: "contact", id: c.id, fullName: c.fullName, entityName: c.entityName });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Assigner"
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            value === null
              ? "border-[1.5px] border-ds-border-strong border-dashed text-ds-text-tertiary hover:border-ds-text-muted"
              : "hover:opacity-80",
          )}
        >
          {value === null ? (
            <Plus className="size-[10px] stroke-[3]" />
          ) : value.kind === "user" ? (
            <UserAvatar size="sm" name={value.fullName} avatarUrl={value.avatarUrl} />
          ) : (
            <ContactAvatar size="sm" name={value.fullName} entityName={value.entityName} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Membre Paradeos ou contact externe…" />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                value="__aucun__"
              >
                <X className="size-3.5 text-ds-text-tertiary" />
                <span className="text-ds-text-tertiary">Personne</span>
                {value === null ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Paradeos">
              {userOptions.map((u) => (
                <CommandItem
                  key={`u:${u.id}`}
                  value={`u ${u.fullName ?? u.id}`}
                  onSelect={() => pickUser(u)}
                >
                  <UserAvatar size="sm" name={u.fullName} avatarUrl={u.avatarUrl} />
                  <span>{u.fullName ?? "(sans nom)"}</span>
                  {value?.kind === "user" && value.id === u.id ? (
                    <Check className="ml-auto size-3.5" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {contactOptions.length > 0 ? (
              <CommandGroup heading="Externes">
                {contactOptions.map((c) => (
                  <CommandItem
                    key={`c:${c.id}`}
                    value={`c ${c.fullName} ${c.entityName ?? ""}`}
                    onSelect={() => pickContact(c)}
                  >
                    <ContactAvatar size="sm" name={c.fullName} entityName={c.entityName} />
                    <span className="truncate">
                      {c.fullName}
                      {c.entityName ? (
                        <span className="text-ds-text-tertiary"> — {c.entityName}</span>
                      ) : null}
                    </span>
                    {value?.kind === "contact" && value.id === c.id ? (
                      <Check className="ml-auto size-3.5" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProjectPicker({
  value,
  onChange,
  options,
}: {
  value: TaskProjectOption | null;
  onChange: (v: TaskProjectOption | null) => void;
  options: TaskProjectOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Projet"
          className="inline-flex w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-left text-sm outline-none hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value ? (
            <span className="truncate text-ds-text">{value.name}</span>
          ) : (
            <span className="text-ds-text-tertiary">Projet</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Rechercher un projet…" />
          <CommandList>
            <CommandEmpty>Aucun projet.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                value="__aucun__"
              >
                <X className="size-3.5 text-ds-text-tertiary" />
                <span className="text-ds-text-tertiary">Aucun projet</span>
                {value === null ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
              {options.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <span>{p.name}</span>
                  {p.id === value?.id ? <Check className="ml-auto size-3.5" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DueDateTrigger({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <DateInput
      value={value}
      onValueChange={onChange}
      trigger={
        <button
          type="button"
          aria-label="Échéance"
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-ds-text-tertiary text-xs outline-none hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarIcon className="size-[14px]" />
          {value ? formatDate(value) : "Échéance"}
        </button>
      }
    />
  );
}
