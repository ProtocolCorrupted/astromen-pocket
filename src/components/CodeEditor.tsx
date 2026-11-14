import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#d1d8d1', fontSize: '16px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', padding: '20px 0', caretColor: '#d4ef8a', fontSize: '16px', WebkitUserSelect: 'text', userSelect: 'text' },
  '.cm-line': { padding: '0 20px', lineHeight: '1.75', fontSize: '13.5px' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: '#66716a', paddingLeft: '12px', fontSize: '12px', WebkitUserSelect: 'none', userSelect: 'none' },
  '.cm-activeLine': { backgroundColor: '#ffffff03' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#d4ef8a' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: '#d4ef8a26' },
  '.cm-cursor': { borderLeftColor: '#d4ef8a' },
  '.cm-panels': { backgroundColor: '#202622', color: '#e1e6de' },
  '&.cm-focused': { outline: 'none' },
  '.cm-search input': { color: '#e1e6de', background: '#121713', fontSize: '16px' },
}, { dark: true });
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c7b5e8' }, { tag: [tags.string, tags.attributeValue], color: '#c9dc9f' },
  { tag: tags.comment, color: '#7f8d82', fontStyle: 'italic' }, { tag: tags.number, color: '#e9bf8b' },
  { tag: [tags.tagName, tags.typeName], color: '#93c6c3' }, { tag: tags.attributeName, color: '#c6cace' },
  { tag: tags.function(tags.variableName), color: '#dbd19e' },
]);
export default function CodeEditor({ path, content, onChange }: { path: string; content: string; onChange: (value: string) => void }) {
  const container = useRef<HTMLDivElement>(null), view = useRef<EditorView>(), callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    const language = /\.[jt]sx?$/.test(path) ? javascript({ jsx: true, typescript: /\.tsx?$/.test(path) }) : path.endsWith('.html') ? html() : path.endsWith('.css') ? css() : [];
    const editor = new EditorView({ parent: container.current!, state: EditorState.create({ doc: content, extensions: [lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(), indentOnInput(), highlightSelectionMatches(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), language, syntaxHighlighting(highlight), theme, EditorView.contentAttributes.of({ 'aria-label': `Code editor for ${path}`, autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }), EditorView.updateListener.of(update => { if (update.docChanged) callback.current(update.state.doc.toString()); })] }) });
    view.current = editor;
    return () => { editor.destroy(); view.current = undefined; };
  }, [path]);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } }); }, [content]);
  return <div className="code-editor" ref={container} />;
}
