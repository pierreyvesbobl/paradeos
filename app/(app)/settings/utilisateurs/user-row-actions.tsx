"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteUser, updateUser } from "@/lib/actions/users";
import { type UserRoleValue, userRoleEnum, userRoleLabels } from "@/lib/schemas/users";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type UserRow = {
  id: string;
  fullName: string;
  role: UserRoleValue;
  costRateHourly: string;
};

export function UserRowActions({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(user);

  function onSave() {
    startTransition(async () => {
      const res = await updateUser({
        id: draft.id,
        fullName: draft.fullName,
        role: draft.role,
        costRateHourly: draft.costRateHourly || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Utilisateur mis à jour.");
      setEditOpen(false);
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteUser({ id: user.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Utilisateur supprimé.");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Actions sur l'utilisateur"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setDraft(user);
              setEditOpen(true);
            }}
          >
            <Pencil className="size-4" />
            Modifier…
          </DropdownMenuItem>
          {!isSelf ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setDeleteOpen(true);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                Supprimer…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nom complet</Label>
              <Input
                id="edit-name"
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Rôle</Label>
              <Select
                value={draft.role}
                onValueChange={(v) => setDraft({ ...draft, role: v as UserRoleValue })}
                disabled={pending || isSelf}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userRoleEnum.options.map((r) => (
                    <SelectItem key={r} value={r}>
                      {userRoleLabels[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSelf ? (
                <p className="text-muted-foreground text-xs">
                  Tu ne peux pas modifier ton propre rôle.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-cost">Taux horaire (HT/h)</Label>
              <MoneyInput
                id="edit-cost"
                value={draft.costRateHourly}
                onValueChange={(v) => setDraft({ ...draft, costRateHourly: v })}
                disabled={pending}
                placeholder="80"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {user.fullName || "(sans nom)"} » ?</DialogTitle>
            <DialogDescription>
              Le compte d'authentification est supprimé. Les tâches, créneaux et notes restent mais
              ne seront plus rattachés à un utilisateur.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending ? "Suppression…" : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
