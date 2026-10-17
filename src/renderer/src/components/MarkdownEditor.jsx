import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';

/** Dark theme matching the app shell (CSS variables cannot reach CM's shadows). */
const studioTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#11151d',
      color: '#e5e9f2',
      height: '100%',
      fontSize: '13.5px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily:
        'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace',
      lineHeight: '1.7',
      padding: '4px 0',
    },
    '.cm-content': { padding: '10px 0 40px', caretColor: '#7fb0ff' },
    '.cm-gutters': {
      backgroundColor: '#11151d',
      color: '#4d5668',
      border: 'none',
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px' },
    '.cm-activeLine': { backgroundColor: 'rgba(126, 176, 255, 0.06)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8fb3ff' },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(110, 168, 254, 0.26)',
    },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(110, 168, 254, 0.32)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#7fb0ff', borderLeftWidth: '2px' },
    '.cm-placeholder': { color: '#5b6579' },
    '.cm-panels': { backgroundColor: '#151a24', color: '#dbe2ee' },
    '.cm-tooltip': { backgroundColor: '#1b2130', border: '1px solid #2b3444', color: '#dbe2ee' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(126, 176, 255, 0.15)' },
  },
  { dark: true },
);

/** Markdown syntax colours tuned for the dark theme. */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: '#9ec1ff', fontWeight: '700', fontSize: '1.35em' },
  { tag: tags.heading2, color: '#9ec1ff', fontWeight: '700', fontSize: '1.2em' },
  { tag: tags.heading3, color: '#a9c8ff', fontWeight: '700', fontSize: '1.08em' },
  { tag: tags.heading4, color: '#a9c8ff', fontWeight: '600' },
  { tag: [tags.heading5, tags.heading6], color: '#8fa8cf', fontWeight: '600' },
  { tag: tags.strong, color: '#f0f3f9', fontWeight: '700' },
  { tag: tags.emphasis, color: '#d8e3f5', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#8b93a7', textDecoration: 'line-through' },
  { tag: tags.link, color: '#7fb0ff', textDecoration: 'underline' },
  { tag: tags.url, color: '#6f8fbf' },
  { tag: tags.monospace, color: '#e2c1f5' },
  { tag: tags.quote, color: '#a3b1c6', fontStyle: 'italic' },
  { tag: tags.list, color: '#8fb3ff' },
  { tag: tags.meta, color: '#6c7a92' },
  { tag: tags.processingInstruction, color: '#64748b' },
  { tag: tags.contentSeparator, color: '#3f4a5d' },
  { tag: tags.comment, color: '#6c7a92', fontStyle: 'italic' },
]);

const extensions = [
  lineNumbers(),
  history(),
  drawSelection(),
  highlightActiveLine(),
  bracketMatching(),
  markdown(),
  syntaxHighlighting(markdownHighlight, { fallback: true }),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文编辑器', spellcheck: 'true' }),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  studioTheme,
];

/**
 * CodeMirror 6 wrapper.
 *
 * The `EditorView` is created exactly once per mounted component (the parent
 * keys the editor per document, so "once per document" holds) and external
 * value changes are pushed into the existing document instead of recreating it.
 */
const MarkdownEditor = forwardRef(function MarkdownEditor(
  { value, onChange, onFiles, placeholder = '' },
  ref,
) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onFilesRef = useRef(onFiles);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const state = EditorState.create({
      doc: String(value ?? ''),
      extensions: [
        ...extensions,
        ...(placeholder ? [placeholderExt(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          paste(event) {
            const files = filesFromClipboard(event.clipboardData);
            if (!files.length) return false;
            event.preventDefault();
            onFilesRef.current?.(files);
            return true;
          },
          drop(event) {
            const files = Array.from(event.dataTransfer?.files ?? []).filter(Boolean);
            if (!files.length) return false;
            event.preventDefault();
            onFilesRef.current?.(files);
            return true;
          },
          dragover(event) {
            if (event.dataTransfer?.types?.includes('Files')) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount only: the value prop is handled by the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external changes (reload, document switch) into the live document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = String(value ?? '');
    if (view.state.doc.toString() === next) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      /** Wrap the selection (or insert a placeholder) and keep it selected. */
      wrap(prefix, suffix, placeholderText) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to) || placeholderText || '';
        const insert = `${prefix}${selected}${suffix}`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + prefix.length, head: from + prefix.length + selected.length },
          scrollIntoView: true,
        });
        view.focus();
      },
      /** Add a prefix to the current line (quotes, list markers). */
      prefixLine(prefix) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const startLine = view.state.doc.lineAt(from);
        const endLine = view.state.doc.lineAt(to);
        const changes = [];
        for (let number = startLine.number; number <= endLine.number; number += 1) {
          const line = view.state.doc.line(number);
          changes.push({ from: line.from, insert: prefix });
        }
        view.dispatch({ changes, scrollIntoView: true });
        view.focus();
      },
      /** Insert raw text at the cursor (asset markdown). */
      insertText(text) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        });
        view.focus();
      },
    }),
    [],
  );

  return <div className="cm-host" ref={hostRef} />;
});

/** Files that arrived through a paste (Chromium reports screenshots as file items). */
function filesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const files = [];
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) {
    for (const file of Array.from(clipboardData.files ?? [])) {
      if (file) files.push(file);
    }
  }
  return files;
}

export default MarkdownEditor;
