"use client";

import { X } from "@phosphor-icons/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Drawer latéral droit construit sur Radix Dialog. Sert d'overlay
 * "fiche en panneau" pour les aperçus de records (cf. handoff
 * ChampLiaison). API symétrique à `Dialog` côté API.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetPortal = DialogPrimitive.Portal;
const SheetClose = DialogPrimitive.Close;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(15,15,15,0.18)] data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex h-full w-[360px] max-w-[88vw] flex-col border-l bg-background shadow-[-8px_0_28px_rgba(15,15,15,0.10)] duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

/**
 * En-tête standardisé : bouton close à gauche, eyebrow "kind" centré (optionnel),
 * actions à droite (par ex. lien externe vers la fiche complète).
 */
const SheetHeader = ({
  kind,
  actions,
  className,
  onClose,
}: {
  kind?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  onClose?: () => void;
}) => (
  <div
    className={cn("flex h-[50px] shrink-0 items-center justify-between border-b px-3", className)}
  >
    <DialogPrimitive.Close
      onClick={onClose}
      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      aria-label="Fermer"
    >
      <X weight="bold" className="size-3.5" />
    </DialogPrimitive.Close>
    {kind ? (
      <span className="font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-[0.1em]">
        {kind}
      </span>
    ) : (
      <span />
    )}
    <div className="inline-flex items-center gap-1">{actions}</div>
  </div>
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "font-semibold text-[19px] text-[var(--ds-text)] leading-tight tracking-tight",
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[14px] text-[var(--ds-text-tertiary)]", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetPortal,
  SheetClose,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
