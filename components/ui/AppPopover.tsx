"use client";

import { ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

type AppPopoverProps = {
  // Elemento che apre il popover: un solo elemento interattivo (es. un
  // <button>), a cui la primitive aggancia ruolo, stato e focus.
  trigger: ReactNode;
  children: ReactNode;
  // Controllo esterno opzionale dell'apertura.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  // Larghezza del pannello; non supera mai la viewport.
  widthClassName?: string;
  className?: string;
};

// Pannello ancorato a un trigger, sopra la primitive Popover gia' usata da
// Dialog e Sheet: focus, ESC, click fuori e posizionamento (con rientro
// automatico ai bordi dello schermo) sono a carico della primitive. E' un
// layer sovrapposto, quindi e' tra i pochi elementi con ombra.
export function AppPopover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  widthClassName = "w-72",
  className = "",
}: AppPopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={6}
          collisionPadding={16}
          className={`z-50 max-w-[calc(100vw-2rem)] rounded-[10px] border border-mc-border bg-mc-surface text-mc-text shadow-[0_12px_32px_rgba(16,24,40,0.14)] outline-none ${widthClassName} ${className}`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
