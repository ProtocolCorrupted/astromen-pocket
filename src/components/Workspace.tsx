import { useState } from 'react';
import { ArrowLeft, Braces, Check, Code2, Download, FileCode2, FilePlus2, Files, History, LockKeyhole, Play, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import CodeEditor from './CodeEditor';
import AIChat from './AIChat';
import Modal from './Modal';
import { previewDocument } from '../core/preview.mjs';
import type { Message, Project, SourceFile, Status } from '../types';

type Props = {
  project: Project; status: Status | null; activePath: string; setActivePath: (v: string) => void;
  updateFile: (v: string) => void; addFile: (path: string) => void; renameFile: (path: string, next: string) => void; deleteFile: (path: string) => void;
  back: () => void; exportWork: () => void; saved: string; busy: boolean; model: string; setModel: (v: string) => void;
  scope: string; setScope: (v: string) => void; effort: string; setEffort: (v: string) => void;
  send: (v: string) => void; stop: () => void; apply: (c: SourceFile, m: Message) => void; clear: () => void;
  connect: () => void; checkpoint: () => void; restore: (id: string) => void;
};
export default function Workspace(p: Props) {
  const [tab, setTab] = useState('code'), [preview, setPreview] = useState(''), [previewError, setPreviewError] = useState('');
  const [fileDialog, setFileDialog] = useState<'new' | 'rename' | 'delete' | null>(null), [fileName, setFileName] = useState(''), [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const active = p.project.files.find(f => f.path === p.activePath);
  const run = () => { setTab('preview'); try { setPreview(previewDocument(p.project.files)); setPreviewError(''); } catch (e: any) { setPreviewError(e.message); } };
  const fileAction = (action: 'new' | 'rename' | 'delete') => { setFileDialog(action); setFileName(action === 'new' ? '' : p.activePath); setError(''); };
  const submitFile = () => {
    try { if (fileDialog === 'new') p.addFile(fileName); else if (fileDialog === 'rename') p.renameFile(p.activePath, fileName); else p.deleteFile(p.activePath); setFileDialog(null); }
    catch (e: any) { setError(e.message); }
  };
  return <div className={`workspace tab-${tab}`}>
    <header className="workspace-top"><button className="icon-button" aria-label="Back to projects" onClick={p.back} disabled={p.busy}><ArrowLeft size={20}/></button><div className="project-title"><span className="project-mini"><Braces size={18}/></span><div><b>{p.project.name}</b><span><LockKeyhole size={10}/>Private sandbox</span></div></div><div className="workspace-actions"><span className="save-status"><Check size={12}/>{p.saved}</span><button className="icon-button" aria-label="Project history" onClick={() => setHistory(true)}><History size={18}/></button><button className="icon-button" aria-label="Export project" onClick={p.exportWork}><Download size={18}/></button><button className="primary compact" onClick={run}><Play size={14}/>Preview</button></div></header>
    <div className="workspace-body"><aside className="file-panel"><div className="panel-heading"><div><Files size={15}/><span>Explorer</span></div><button className="icon-button" aria-label="New file" onClick={() => fileAction('new')}><FilePlus2 size={16}/></button></div><div className="tree-root"><span className="small-label">{p.project.name}</span></div><div className="file-list">{p.project.files.map(file => <button className={`file-item ${file.path === p.activePath ? 'selected' : ''}`} key={file.path} onClick={() => { p.setActivePath(file.path); setTab('code'); }}><span className={`file-type ${file.path.split('.').at(-1)}`}>{file.path.endsWith('.js') ? 'JS' : file.path.endsWith('.css') ? '#' : file.path.endsWith('.html') ? '〈〉' : 'M'}</span><span>{file.path}</span>{file.path === p.activePath && <span className="active-file-dot"/>}</button>)}</div><div className="sandbox-label"><LockKeyhole size={16}/><b>One project. One sandbox.</b><p>No access to other projects<br/>or your device’s files.</p></div></aside>
      <section className="editor-panel"><div className="editor-tabs"><button className={tab !== 'preview' ? 'editor-tab active' : 'editor-tab'} onClick={() => setTab('code')}><FileCode2 size={14}/>{p.activePath || 'No file'}<span className="active-file-dot"/></button><button className={tab === 'preview' ? 'editor-tab active' : 'editor-tab'} onClick={run}><Play size={12}/>Preview</button><div className="file-tools"><button className="icon-button" aria-label="Rename current file" disabled={!active} onClick={() => fileAction('rename')}><Pencil size={14}/></button><button className="icon-button" aria-label="Delete current file" disabled={!active} onClick={() => fileAction('delete')}><Trash2 size={14}/></button></div></div>
      <div className="editor-breadcrumb">{p.project.name}<span>/</span>{p.activePath}<span className="editor-language">{p.activePath.split('.').at(-1)?.toUpperCase()}</span></div>
      {tab === 'preview' ? <div className="preview-area">{previewError ? <div className="empty-inline"><Code2 size={32}/><h2>Editable, not executable.</h2><p>{previewError}</p><button className="secondary" onClick={() => setTab('code')}>Back to code</button></div> : <iframe key={preview} title="Isolated project preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview}/>}</div> : active ? <CodeEditor key={`${p.project.id}:${p.activePath}`} path={p.activePath} content={active.content} onChange={p.updateFile}/> : <div className="empty-inline"><Files size={32}/><h2>A blank canvas.</h2><button className="primary" onClick={() => fileAction('new')}>Create your first file</button></div>}
      <footer className="editor-status"><span><LockKeyhole size={11}/>Sandboxed</span><span>{active?.content.split('\n').length || 0} lines</span><span>UTF-8</span><span>{p.saved}</span></footer></section>
      <AIChat project={p.project} status={p.status} model={p.model} setModel={p.setModel} scope={p.scope} setScope={p.setScope} effort={p.effort} setEffort={p.setEffort} activePath={p.activePath} busy={p.busy} send={p.send} stop={p.stop} apply={p.apply} clear={p.clear} connect={p.connect}/>
    </div><nav className="mobile-tabs" aria-label="Workspace views">{[{ id: 'files', label: 'Files', icon: Files }, { id: 'code', label: 'Code', icon: Code2 }, { id: 'preview', label: 'Preview', icon: Play }, { id: 'ai', label: 'AI', icon: Sparkles }].map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => item.id === 'preview' ? run() : setTab(item.id)}><item.icon size={20}/>{item.label}</button>)}</nav>
    {fileDialog && <Modal title={fileDialog === 'new' ? 'New file' : fileDialog === 'rename' ? 'Rename file' : 'Delete file?'} close={() => setFileDialog(null)}><form onSubmit={e => { e.preventDefault(); submitFile(); }}>{fileDialog === 'delete' ? <p>Delete <b>{p.activePath}</b>? A checkpoint will keep a recoverable copy.</p> : <label>Relative file path<input autoFocus value={fileName} onChange={e => setFileName(e.target.value)} placeholder="src/app.js" required/></label>}{error && <p role="alert" className="error-banner">{error}</p>}<button className={fileDialog === 'delete' ? 'danger' : 'primary'}>{fileDialog === 'delete' ? 'Delete file' : 'Save file'}</button></form></Modal>}
    {history && <Modal title="Project checkpoints" close={() => setHistory(false)}><p className="muted">Keep a moment before your next big change. AI edits also create automatic checkpoints.</p><button className="primary" onClick={p.checkpoint}><History size={16}/>Save checkpoint</button><div className="history-list">{!p.project.history.length && <p>No checkpoints yet.</p>}{p.project.history.map(item => <div className="history-item" key={item.id}><div><b>{item.label}</b><span>{new Date(item.at).toLocaleString()} · {item.files.length} files</span></div><button className="secondary" onClick={() => { p.restore(item.id); setHistory(false); }}>Restore</button></div>)}</div></Modal>}
  </div>;
}
