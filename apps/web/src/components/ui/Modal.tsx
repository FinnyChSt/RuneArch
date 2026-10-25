import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Tailwind max-width class */
  width?: string;
  onClose(): void;
  footer?: ReactNode;
  /** Focus something specific on open instead of the first focusable element */
  initialFocus?(): void;
  children: ReactNode;
};

/** Centered modal dialog (Radix): focus trap, Esc and overlay click close it */
export function Modal({ title, description, width = 'max-w-lg', onClose, footer, initialFocus, children }: Props) {
  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-canvas/70" />
        <RadixDialog.Content
          {...(!description && { 'aria-describedby': undefined })}
          onOpenAutoFocus={(e) => {
            if (!initialFocus) return;
            e.preventDefault();
            initialFocus();
          }}
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface-raised text-sm text-text shadow-2xl ${width}`}
        >
          <header className="flex items-start gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-base font-semibold">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-xs text-text-muted">{description}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text">
              <X className="size-4" />
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex items-center gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
