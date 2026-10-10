'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useRef } from 'react';

/** Query for the dialog's tab stops — initial focus and the Tab trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getDialogFocusables(dialog: HTMLElement | null): HTMLElement[] {
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface DialogProps {
  /** Whether the dialog is shown; renders nothing while false. */
  open: boolean;
  /** Called on dismissal intents: Escape and backdrop click. Content
      controls (e.g. a cancel Button) call it themselves. */
  onClose: () => void;
  /** `id` of the visible heading inside `children` — the dialog's
      accessible name. */
  labelledBy?: string;
  /** Accessible name for dialogs without a visible heading to point at. */
  'aria-label'?: string;
  /** Dialog body: copy and action controls. */
  children: React.ReactNode;
}

/**
 * Modal dialog primitive — the AgeGate overlay behavior, extracted.
 *
 * While open it owns focus: focus moves into the dialog on open (the
 * previously focused element is remembered), Tab is trapped inside
 * (wrapping at both ends, and pulled back in if it escapes), Escape and
 * a backdrop click dismiss via `onClose`, and on close focus returns to
 * the flow that opened it. The overlay is `fixed inset-0` with the
 * panel centered — same markup as AgeGate, minus its text alignment.
 *
 * Client-only: focus management needs effects, so unlike the other
 * primitives this cannot render inside a server component's own JSX
 * without a client boundary (the 'use client' here is that boundary).
 */
export function Dialog({ open, onClose, labelledBy, 'aria-label': ariaLabel, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    (getDialogFocusables(dialog)[0] ?? dialog)?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusables = getDialogFocusables(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!(active instanceof Node) || !dialog.contains(active)) {
      // Focus escaped (or never entered) the dialog — pull it back in.
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      data-dialog-overlay=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        // Backdrop only — clicks inside the panel bubble here too.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        className="mx-4 w-full max-w-md rounded-lg bg-white p-8 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}
