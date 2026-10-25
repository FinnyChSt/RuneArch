import type { CanvasDoc } from '@flowcanvas/shared';
import { useMemo, useState } from 'react';
import { useForm, useWatch, type DefaultValues, type FieldPath, type FieldValues } from 'react-hook-form';
import { useCanvasStore } from '../store/canvasStore';
import { hasIssues, validateDraft, type DraftIssues, type DraftSection, type IssueMapper } from './validation';

type Options<T extends FieldValues> = {
  /** Id of the edited node (or flow, with `section: 'flows'`) */
  nodeId: string;
  section?: DraftSection;
  defaultValues: T;
  /** The current doc with this draft applied */
  build(doc: CanvasDoc, draft: T): CanvasDoc;
  mapper(draft: T): IssueMapper;
};

/**
 * Dialog draft (ARCHITECTURE.md §7): React Hook Form holds the draft; every change is validated
 * against the whole doc. Errors show once a field is touched or after a save attempt.
 */
export function useDraftForm<T extends FieldValues>({ nodeId, section = 'nodes', defaultValues, build, mapper }: Options<T>) {
  const form = useForm<T>({ defaultValues: defaultValues as DefaultValues<T> });
  const draft = useWatch({ control: form.control }) as T;
  const doc = useCanvasStore((s) => s.doc);
  const [submitted, setSubmitted] = useState(false);

  const candidate = useMemo(() => build(doc, draft), [build, doc, draft]);
  const issues: DraftIssues = useMemo(
    () => validateDraft(candidate, nodeId, mapper(draft), section),
    [candidate, nodeId, mapper, draft, section],
  );

  const { formState } = form;
  /** Error for a field, once the user has interacted with it or tried to save */
  const errorFor = (field: string): string | undefined => {
    const message = issues.fields[field];
    if (!message) return undefined;
    const state = form.getFieldState(field as FieldPath<T>, formState);
    return submitted || state.isDirty || state.isTouched ? message : undefined;
  };

  /** Whether any shown error starts with `prefix` (for tab badges) */
  const hasErrorsUnder = (prefix: string) =>
    Object.keys(issues.fields).some((f) => f.startsWith(prefix) && errorFor(f));

  /** Calls `commit` with the latest draft if it is valid; otherwise reveals all errors */
  const submit = (commit: (draft: T) => void) => {
    setSubmitted(true);
    const latest = form.getValues();
    const latestIssues = validateDraft(build(useCanvasStore.getState().doc, latest), nodeId, mapper(latest), section);
    if (!hasIssues(latestIssues)) commit(latest);
  };

  return {
    form,
    draft,
    candidate,
    issues,
    errorFor,
    hasErrorsUnder,
    submit,
    generalErrors: submitted ? issues.other : [],
  };
}
