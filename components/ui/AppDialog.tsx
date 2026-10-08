"use client";

import { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type AppDialogAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type AppDialogProps = {
  open: boolean;
  // Chiamata anche per ESC e click fuori: chi usa il dialog decide cosa
  // significa chiudere (di norma: annullare).
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  // Azioni nel piede: la principale conferma, la secondaria annulla.
  primaryAction?: AppDialogAction;
  secondaryAction?: AppDialogAction;
  // Larghezza massima da sm in su, es. "sm:max-w-[340px]".
  widthClassName?: string;
};

// Layer sovrapposto della UX Foundation v2, sopra la primitive Dialog
// esistente (focus, ESC, click fuori, scroll lock): l'unico elemento con
// ombra, perche' sta sopra la pagina e non nel suo layout.
export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  widthClassName = "sm:max-w-md",
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={`max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-[10px] border border-mc-border bg-mc-surface p-0 text-mc-text shadow-[0_16px_40px_rgba(16,24,40,0.16)] ring-0 ${widthClassName}`}
      >
        <div className="px-4 pb-3 pt-4">
          <DialogTitle className="text-[15px] font-semibold leading-tight text-mc-text">{title}</DialogTitle>
          {description && (
            <DialogDescription className="mt-1 text-[12px] leading-4 text-mc-text-secondary">
              {description}
            </DialogDescription>
          )}
        </div>

        <div className="px-4 pb-4">{children}</div>

        {(primaryAction || secondaryAction) && (
          // sticky: su schermi bassi il contenuto scorre, le azioni restano raggiungibili.
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-mc-border bg-mc-surface-subtle px-4 py-3">
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
                className="h-[34px] rounded-[7px] border border-mc-border bg-mc-surface px-3 text-[13px] font-semibold text-mc-text transition hover:bg-mc-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                {secondaryAction.label}
              </button>
            )}
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                className="h-[34px] rounded-[7px] bg-teal px-3.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {primaryAction.label}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
