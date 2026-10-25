import { cloneElement, useId, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

/** Shared control styles; `aria-invalid` switches to the danger border */
export const controlClass =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none placeholder:text-text-muted/70 focus:border-accent aria-[invalid=true]:border-danger';

/** Same look for controls that size to their content (inline in rows) */
export const compactControlClass = `${controlClass.replace('w-full ', '')} px-2 py-1 text-xs`;

export const checkboxClass = 'size-4 accent-[var(--accent)]';

type FieldProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  /** A single control; it gets the id, aria-invalid and aria-describedby */
  children: ReactElement<Record<string, unknown>>;
};

/** Label + control + inline error */
export function Field({ label, error, hint, className = '', children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const control = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? messageId : undefined,
  });
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-muted">
        {label}
      </label>
      {control}
      {error ? (
        <p id={messageId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="mt-1 text-xs text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Error text for controls without their own Field (e.g. grid cells) */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-0.5 text-[11px] leading-tight text-danger">
      {message}
    </p>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' };

const BUTTON: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-canvas font-medium hover:brightness-110',
  secondary: 'border border-border bg-surface hover:bg-surface-raised',
  ghost: 'text-text-muted hover:bg-surface hover:text-text',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

type IconActionProps = { label: string; disabled?: boolean; onClick(): void; children: ReactNode };

/** Small icon-only button for row actions (move, remove, ...) */
export function IconAction({ label, disabled, onClick, children }: IconActionProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-text-muted hover:bg-surface-raised hover:text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}
