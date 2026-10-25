import { useState } from 'react';

/*
 * Undo/redo for a value that lives elsewhere (here: the wireframe in the Screen dialog's form draft).
 * Only the past and future are kept; the present is always the current value. This is separate from
 * the canvas history: the whole dialog still commits as one canvas undo step.
 */

export type UndoStack<T> = {
  past: T[];
  future: T[];
  /** Key of the last change; consecutive changes with the same key merge into one step (typing) */
  key?: string;
};

const LIMIT = 100;

export const emptyStack = <T>(): UndoStack<T> => ({ past: [], future: [] });

/** Records that `present` is being replaced; merges with the previous step when `key` repeats */
export function record<T>(stack: UndoStack<T>, present: T, key?: string): UndoStack<T> {
  if (key !== undefined && key === stack.key) return { ...stack, future: [] };
  return { past: [...stack.past, present].slice(-LIMIT), future: [], key };
}

/** Steps back: returns the value to restore, or null when there is nothing to undo */
export function undoStep<T>(stack: UndoStack<T>, present: T): { stack: UndoStack<T>; value: T } | null {
  if (stack.past.length === 0) return null;
  const value = stack.past[stack.past.length - 1] as T;
  return { stack: { past: stack.past.slice(0, -1), future: [present, ...stack.future] }, value };
}

export function redoStep<T>(stack: UndoStack<T>, present: T): { stack: UndoStack<T>; value: T } | null {
  if (stack.future.length === 0) return null;
  const [value, ...future] = stack.future as [T, ...T[]];
  return { stack: { past: [...stack.past, present], future }, value };
}

export type Undoable<T> = {
  change(next: T, key?: string): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useUndo<T>(value: T, set: (next: T) => void): Undoable<T> {
  const [stack, setStack] = useState(emptyStack<T>);
  const apply = (step: { stack: UndoStack<T>; value: T } | null) => {
    if (!step) return;
    setStack(step.stack);
    set(step.value);
  };
  return {
    change(next, key) {
      setStack((s) => record(s, value, key));
      set(next);
    },
    undo: () => apply(undoStep(stack, value)),
    redo: () => apply(redoStep(stack, value)),
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
  };
}
