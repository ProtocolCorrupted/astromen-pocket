import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Braces, Check, ChevronRight, CircleHelp, Code2, Files, Folder, LockKeyhole, MoreHorizontal, Plus, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import Workspace from './components/Workspace';
import Settings from './components/Settings';
import Modal from './components/Modal';
import { addFile, applyProposal, contextMessages, createProject, safePath, uid } from './core/sandbox.mjs';
import { listProjects, removeProject, saveProject } from './core/storage';
import { exportProject, importProject } from './core/archive';
import { getStatus, streamChat } from './core/api';
import type { Connection, Message, Project, SourceFile, Status } from './types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]), [ready, setReady] = useState(false), [storageError, setStorageError] = useState('');
  const [page, setPage] = useState('projects'), [selected, setSelected] = useState(''), [activePath, setActivePath] = useState('');
  const [dialog, setDialog] = useState<'new' | 'delete' | 'rename' | null>(null), [target, setTarget] = useState<Project | null>(null), [name, setName] = useState(''), [template, setTemplate] = useState('web'), [formError, setFormError] = useState('');
  const [query, setQuery] = useState(''), [toast, setToast] = useState(''), [saved, setSaved] = useState('Saved on device');
  const [connection, setConnection] = useState<Connection>({ url: localStorage.getItem('pocket-gateway-url') || '', token: '' }), [status, setStatus] = useState<Status | null>(null), [connectionError, setConnectionError] = useState(''), [checking, setChecking] = useState(false);
  const [model, setModel] = useState('gemini-4-carbon'), [scope, setScope] = useState('project'), [effort, setEffort] = useState('high'), [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), controller = useRef<AbortController>(), current = useRef(projects), writeQueue = useRef(Promise.resolve());
  current.current = projects;
  const project = projects.find(p => p.id === selected);
  const notify = (text: string) => setToast(text);
  const persist = (p: Project) => {
    setSaved('Saving…');
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => saveProject(p)).then(() => { setSaved('Saved on device'); setStorageError(''); }).catch((e: Error) => { setSaved('Not saved'); setStorageError(e.message); });
  };
  const update = (id: string, fn: (p: Project) => Project) => {
    const existing = current.current.find(p => p.id === id); if (!existing) return;
    const next = fn(existing); current.current = current.current.map(p => p.id === id ? next : p); setProjects(current.current); persist(next);
  };
  const addProject = async (p: Project) => { await saveProject(p); current.current = [p, ...current.current]; setProjects(current.current); return p; };
  const connect = async (next: Connection) => {
    setChecking(true); setConnectionError(''); setConnection(next); setStatus(null);
    try { const result = await getStatus(next); setStatus(result); localStorage.setItem('pocket-gateway-url', next.url); }
    catch (e: any) { setConnectionError(e.message); }
    finally { setChecking(false); }
  };
  useEffect(() => {
    let active = true;
    listProjects().then(data => { if (active) { setProjects(data); current.current = data; setReady(true); } }).catch(e => { if (active) { setStorageError(e.message); setReady(true); } });
    void connect(connection);
    return () => { active = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  const open = (p: Project) => { setSelected(p.id); setActivePath(p.files[0]?.path || ''); setPage('workspace'); };
  const newDialog = () => { setName(''); setTemplate('web'); setFormError(''); setDialog('new'); };
  const checkpoint = (p: Project, label: string) => ({ id: uid(), at: Date.now(), label, files: p.files.map(f => ({ ...f })) });
  const doExport = async (p: Project) => { try { await exportProject(p); notify('Project exported. Your gateway token was not included.'); } catch (e: any) { notify(e.message); } };
  const fileChange = (fn: (p: Project) => Project) => { if (project) update(project.id, fn); };
  const send = async (prompt: string) => {
    if (!project || busy) return;
    const id = project.id, base = project.files.map(f => ({ ...f })), assistantId = uid();
    const messages = contextMessages(project, prompt, scope, activePath);
    const human: Message = { id: uid(), role: 'user', content: prompt };
    const answer: Message = { id: assistantId, role: 'assistant', content: '', model: status?.models.find(m => m.id === model)?.label || model, baseFiles: base };
    update(id, p => ({ ...p, messages: [...p.messages, human, answer], updatedAt: Date.now() }));
    setBusy(true); const abort = new AbortController(); controller.current = abort;
    try {
      await streamChat(connection, { model, effort, messages }, abort.signal, (content, usage, truncated) => update(id, p => ({ ...p, messages: p.messages.map(m => m.id === assistantId ? { ...m, content, usage, truncated } : m) })));
    } catch (e: any) {
      update(id, p => ({ ...p, messages: p.messages.map(m => m.id === assistantId ? { ...m, content: m.content + (abort.signal.aborted ? '\n\nGeneration stopped.' : `\n\n${e.message}`), status: abort.signal.aborted ? 'cancelled' : 'error' } : m) }));
    } finally { setBusy(false); controller.current = undefined; }
  };
  const apply = (change: SourceFile, message: Message) => {
    try { fileChange(p => applyProposal(p, change, message.baseFiles?.find(f => f.path === change.path)?.content)); notify(`Applied ${change.path}. Checkpoint saved.`); }
    catch (e: any) { notify(e.message); }
  };
  const submitProject = async () => {
    try {
      if (dialog === 'new') { const next = await addProject(createProject(name, template)); open(next); }
      else if (dialog === 'rename' && target) { if (!name.trim() || name.trim().length > 80) throw new Error('Use 1–80 characters.'); update(target.id, p => ({ ...p, name: name.trim(), updatedAt: Date.now() })); }
      else if (dialog === 'delete' && target) { await writeQueue.current; await removeProject(target.id); current.current = current.current.filter(p => p.id !== target.id); setProjects(current.current); }
      setDialog(null);
    } catch (e: any) { setFormError(e.message); }
  };
  const filtered = projects.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  const renderWorkspace = project && page === 'workspace';
  return <div className="app-shell">
    {!renderWorkspace && <aside className="app-sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('projects'); }}><img src="/icon.svg" alt=""/><span>astromen<span className="brand-pocket">pocket</span></span></a><div className="sidebar-section">YOUR WORKSPACE</div><nav><button className={page === 'projects' ? 'active' : ''} onClick={() => setPage('projects')}><Folder size={18}/>Projects<span>{projects.length.toString().padStart(2, '0')}</span></button><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings2 size={18}/>Settings</button></nav><div className="sidebar-bottom"><div className="private-card"><div className="private-symbol"><LockKeyhole size={18}/></div><b>A little space.<br/>Entirely yours.</b><p>Private, on-device projects.<br/>Built to go wherever you go.</p></div><button className="connection-button" onClick={() => setPage('settings')}><span className={`connection-dot ${status?.configured ? 'online' : ''}`}/><span>{status?.configured ? 'Gateway configured' : 'Gateway not connected'}<small>{status?.models.some(m => m.verified) ? 'Provider limits available' : 'Set up Coarena'}</small></span><ChevronRight size={15}/></button><div className="sidebar-footer"><span>ASTROMEN POCKET</span><span>v1.0</span></div></div></aside>}
    <main className={renderWorkspace ? 'workspace-main' : 'main-content'}>
      {!renderWorkspace && <header className="app-topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13}/><b>{page === 'settings' ? 'Settings' : 'Projects'}</b></div><div className="topbar-right"><span><LockKeyhole size={12}/>Local-first by design</span><button className="icon-button" aria-label="Connection help" onClick={() => setPage('settings')}><CircleHelp size={18}/></button><div className="avatar">A</div></div></header>}
      {renderWorkspace ? <Workspace project={project} status={status} activePath={activePath} setActivePath={setActivePath} updateFile={content => fileChange(p => ({ ...p, files: p.files.map(f => f.path === activePath ? { ...f, content } : f), updatedAt: Date.now() }))} addFile={path => { fileChange(p => addFile(p, path)); setActivePath(path); }} renameFile={(path, next) => { safePath(next); fileChange(p => { if (p.files.some(f => f.path !== path && f.path.toLowerCase() === next.toLowerCase())) throw new Error('That path already exists.'); return { ...p, files: p.files.map(f => f.path === path ? { ...f, path: next } : f), history: [checkpoint(p, `Before rename: ${path}`), ...p.history].slice(0, 20), updatedAt: Date.now() }; }); setActivePath(next); }} deleteFile={path => { fileChange(p => ({ ...p, files: p.files.filter(f => f.path !== path), history: [checkpoint(p, `Before delete: ${path}`), ...p.history].slice(0, 20), updatedAt: Date.now() })); setActivePath(project.files.find(f => f.path !== path)?.path || ''); }} back={() => setPage('projects')} exportWork={() => void doExport(project)} saved={saved} busy={busy} model={model} setModel={setModel} scope={scope} setScope={setScope} effort={effort} setEffort={setEffort} send={text => void send(text)} stop={() => controller.current?.abort()} apply={apply} clear={() => fileChange(p => ({ ...p, messages: [] }))} connect={() => setPage('settings')} checkpoint={() => { fileChange(p => ({ ...p, history: [checkpoint(p, 'Manual checkpoint'), ...p.history].slice(0, 20) })); notify('Checkpoint saved.'); }} restore={id => { fileChange(p => { const point = p.history.find(h => h.id === id)!; return { ...p, files: point.files.map(f => ({ ...f })), history: [checkpoint(p, 'Before restore'), ...p.history].slice(0, 20), updatedAt: Date.now() }; }); setActivePath(project.history.find(h => h.id === id)?.files[0]?.path || ''); notify('Project restored.'); }}/>
      : page === 'settings' ? <Settings connection={connection} status={status} error={connectionError} connect={connect} checking={checking}/>
      : <div className="library"><div className="library-heading"><div><span className="small-label">A STUDIO THAT GOES WITH YOU</span><h1>Small screen.<br className="mobile-break"/> Big possibilities<span>.</span></h1><p>A home for your projects. A second mind for your ideas.</p></div><button className="primary" onClick={newDialog}><Plus size={17}/>New project</button></div>
        <section className="hero-card"><div className="hero-copy"><div className="hero-kicker"><span className="little-star">✳</span>YOUR NEXT CHAPTER</div><h2>Build something<br/>only you could.</h2><p>Your code, your AI, your own little universe.<br/>Start small. See how far it goes.</p><button onClick={newDialog}>Create a project<ArrowUpRight size={18}/></button><div className="hero-bottom"><span><LockKeyhole size={12}/>Sandboxed & private</span><span><Sparkles size={12}/>3 powerful models</span></div></div><img className="hero-art" src="/orbit.svg" alt="Sculptural green planet surrounded by an orbital ring"/></section>
        <section className="projects-section"><div className="projects-heading"><div><h2>Your projects<span>{projects.length.toString().padStart(2, '0')}</span></h2><p>A place to pick up where you left off.</p></div><div className="library-tools"><label className="search"><Search size={16}/><input aria-label="Search projects" placeholder="Find a project…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</label><button className="secondary import-button" onClick={() => fileInput.current?.click()}><ArrowDownToLine size={15}/>Import</button></div></div>
          {!ready ? <div className="library-empty">Opening your workspace…</div> : <div className="project-grid">{filtered.map((p, index) => <article className="project-card" key={p.id}><div className="project-card-top"><span className={`project-symbol variant-${index % 3}`}><Braces size={23}/></span><div className="project-card-controls"><button className="icon-button" aria-label={`Export ${p.name}`} onClick={() => void doExport(p)}><ArrowDownToLine size={16}/></button><button className="icon-button" aria-label={`Rename ${p.name}`} onClick={() => { setTarget(p); setName(p.name); setFormError(''); setDialog('rename'); }}><MoreHorizontal size={18}/></button><button className="icon-button" aria-label={`Delete ${p.name}`} onClick={() => { setTarget(p); setFormError(''); setDialog('delete'); }}><Trash2 size={15}/></button></div></div><button className="project-open" onClick={() => open(p)}><h3>{p.name}<ArrowUpRight size={17}/></h3><p>{p.description}</p></button><div className="project-meta"><span><span className="tiny-dot"/>{p.template}</span><span>{p.files.length} files</span><time>{new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div></article>)}<button className="new-project-card" onClick={newDialog}><span><Plus size={23}/></span><b>{projects.length ? 'A new possibility' : 'Your first possibility'}</b><p>{query && !filtered.length ? 'No matches. Try a fresh start.' : 'Every great idea starts somewhere.'}</p></button></div>}
        </section><section className="model-strip"><span className="model-strip-icon"><Sparkles size={18}/></span><div><b>Good company for your code.</b><p>Gemini 4 Carbon, Gemini 4 Argon & Fable 5.2</p></div><button onClick={() => setPage('settings')}>Meet your models<ArrowRight size={16}/></button></section><footer className="library-footer"><span>Made for the moments inspiration finds you.</span><span><LockKeyhole size={12}/>Your device. Your projects.</span></footer></div>}
    </main>
    {!renderWorkspace && <nav className="mobile-app-nav" aria-label="Main navigation"><button className={page === 'projects' ? 'active' : ''} onClick={() => setPage('projects')}><Folder size={20}/>Projects</button><button onClick={newDialog}><Plus size={22}/>Create</button><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings2 size={20}/>Settings</button></nav>}
    <input ref={fileInput} hidden type="file" accept=".zip,.json" aria-label="Import project archive" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const p = await addProject(await importProject(file)); open(p); notify('Project imported into a new sandbox.'); } catch (error: any) { notify(error.message); } e.target.value = ''; }}/>
    {storageError && <div className="storage-error" role="alert">{storageError} Your current changes may be unsaved. Export your project now.</div>}
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="Dismiss notification" className="icon-button" onClick={() => setToast('')}><X size={16}/></button></div>}
    {dialog && <Modal title={dialog === 'new' ? 'A new possibility.' : dialog === 'rename' ? 'Rename project' : 'Delete this project?'} close={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); void submitProject(); }}>{dialog === 'delete' ? <p><b>{target?.name}</b> and its local files will be permanently removed from this device. Export a copy first if you need it.</p> : <><p className="muted">Your own private sandbox. Make it something special.</p><label>Project name<input autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="My next big idea" required/></label>{dialog === 'new' && <fieldset><legend>Start with</legend><div className="template-options"><button type="button" className={template === 'web' ? 'selected' : ''} onClick={() => setTemplate('web')}><Code2 size={22}/><b>Web starter</b><span>HTML, CSS, JavaScript<br/>Ready to preview</span></button><button type="button" className={template === 'blank' ? 'selected' : ''} onClick={() => setTemplate('blank')}><Files size={22}/><b>Blank canvas</b><span>Just a README<br/>Anything is possible</span></button></div></fieldset>}</>}{formError && <p role="alert" className="error-banner">{formError}</p>}<button className={dialog === 'delete' ? 'danger' : 'primary'}>{dialog === 'new' ? 'Create project' : dialog === 'rename' ? 'Save name' : 'Delete permanently'}<ArrowRight size={16}/></button></form></Modal>}
  </div>;
}
