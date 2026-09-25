"use client";

import { Dialog } from "@base-ui/react/dialog";
import { usePortalContainer } from "./app-root";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the dialog (e.g. "Confirm administration"). */
  label: string;
  children: React.ReactNode;
};

/**
 * Centered modal on desktop; a bottom sheet (radius 28px 28px 0 0, above the
 * home indicator) below the 760px breakpoint. Closes on Esc and backdrop click.
 */
export function Modal({ open, onOpenChange, label, children }: ModalProps) {
  const container = usePortalContainer();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="app-modal-backdrop" />
        <Dialog.Viewport className="app-modal-viewport">
          <Dialog.Popup className="app-modal" aria-label={label}>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A button that closes the surrounding modal. */
export const ModalClose = Dialog.Close;
