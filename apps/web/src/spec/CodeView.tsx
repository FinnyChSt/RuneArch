import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

/** Token colors from the theme (tokens.css) */
const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--accent)' },
  { tag: tags.string, color: 'var(--method-get)' },
  { tag: tags.number, color: 'var(--node-db)' },
  { tag: [tags.bool, tags.null, tags.keyword], color: 'var(--node-be)' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--text-muted)' },
  { tag: tags.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
]);

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-canvas)', color: 'var(--text)', fontSize: '12px', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6' },
    '.cm-gutters': { backgroundColor: 'var(--bg-canvas)', color: 'var(--text-muted)', border: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
    },
  },
  { dark: true },
);

const LANGUAGES = { json, yaml, python, typescript: () => javascript({ typescript: true }) };

/** `text` shows plain, unhighlighted code (DBML, Mermaid, SQL) */
type Props = { value: string; language: keyof typeof LANGUAGES | 'text'; label: string };

/** Read-only, syntax-highlighted code (CodeMirror 6) */
export function CodeView({ value, language, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true' }),
          lineNumbers(),
          syntaxHighlighting(highlight),
          theme,
          languageSlot.current.of([]),
        ],
      }),
    });
    return () => view.current?.destroy();
  }, [label]);

  useEffect(() => {
    view.current?.dispatch({ effects: languageSlot.current.reconfigure(language === 'text' ? [] : LANGUAGES[language]()) });
  }, [language]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full overflow-hidden rounded-lg border border-border" />;
}
