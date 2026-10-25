import type { ReactNode } from 'react';
import { Button } from '../components/ui/form';

type Props = { errors: string[]; onCancel(): void; onSave(): void; /** Left-aligned extra action */ start?: ReactNode };

/** Cancel / Save plus errors no field owns */
export function DialogFooter({ errors, onCancel, onSave, start }: Props) {
  return (
    <>
      {start}
      <p role={errors.length ? 'alert' : undefined} className="min-w-0 flex-1 text-xs text-danger">
        {errors.join(' · ')}
      </p>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave}>
        Save
      </Button>
    </>
  );
}
