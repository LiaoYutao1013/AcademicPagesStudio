import { useCallback, useEffect, useMemo, useState } from 'react';

import CollectionsView from './components/CollectionsView.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import CreateDocDialog from './components/CreateDocDialog.jsx';
import EditorView from './components/EditorView.jsx';
import EmptyState from './components/EmptyState.jsx';
import { Icon } from './components/Icons.jsx';
import NavView from './components/NavView.jsx';
import ProfileView from './components/ProfileView.jsx';
import Sidebar from './components/Sidebar.jsx';
import { LoadingBlock, LoadingPane } from './components/Spinner.jsx';
import SyncView from './components/SyncView.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import TopBar from './components/TopBar.jsx';
import WelcomeView from './components/WelcomeView.jsx';
import { messageOf, studio } from './lib/api.js';

export default function App() {
  return (
    <ToastProvider>
      <StudioApp />
    </ToastProvider>
  );
}

function StudioApp() {
  const toast = useToast();

  const [boot, setBoot] = useState({ loading: true, error: null });
  const [bootNonce, setBootNonce] = useState(0);
  const [initInfo, setInitInfo] = useState(null);
  const [session, setSession] = useState(null);
  const [token, setToken] = useState(null);
  const [opening, setOpening] = useState(false);

  const [view, setView] = useState('docs');
  const [mountedViews, setMountedViews] = useState(() => new Set(['docs']));
  const [configVersion, setConfigVersion] = useState(0);

  // docs list
  const [types, setTypes] = useState([]);
  const [typeId, setTypeId] = useState('post');
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsVersion, setDocsVersion] = useState(0);
  const [query, setQuery] = useState('');

  // open document
  const [activePath, setActivePath] = useState(null);
  const [doc, setDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pendingPath, setPendingPath] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [git, setGit] = useState(null);
  const [gitLoading, setGitLoading] = useState(false);

  const adoptSession = useCallback((opened) => {
    const list = opened?.contentTypes ?? [];
    setSession(opened);
    setTypes(list);
    setTypeId((current) => (list.some((type) => type.id === current) ? current : list[0]?.id ?? 'post'));
    setGit(opened?.git ?? null);
    setDocs([]);
    setActivePath(null);
    setDoc(null);
    setDocError(null);
    setDocLoading(false);
    setDirty(false);
    setQuery('');
    setView('docs');
    setDocsVersion((value) => value + 1);
    setConfigVersion((value) => value + 1);
  }, []);

  // ---------------------------------------------------------------- startup

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await studio().workspace.init();
        if (cancelled) return;
        setInitInfo(info);
        setToken({ ...(info.token ?? {}), encryptionAvailable: Boolean(info.encryptionAvailable) });
        if (info.repoPath) {
          try {
            const opened = await studio().workspace.open(info.repoPath);
            if (!cancelled) adoptSession(opened);
          } catch (err) {
            if (!cancelled) toast.pushError(err, '无法打开上次使用的仓库');
          }
        }
        if (!cancelled) setBoot({ loading: false, error: null });
      } catch (err) {
        if (!cancelled) setBoot({ loading: false, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adoptSession, bootNonce, toast]);

  // -------------------------------------------------------------- documents

  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    setDocsLoading(true);
    (async () => {
      try {
        const result = await studio().docs.list(typeId);
        if (cancelled) return;
        setDocs(Array.isArray(result.docs) ? result.docs : []);
        if (Array.isArray(result.types) && result.types.length) setTypes(result.types);
      } catch (err) {
        if (!cancelled) toast.pushError(err, '无法读取文档列表');
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, typeId, docsVersion, toast]);

  useEffect(() => {
    if (!session) return;
    const list = session.contentTypes ?? [];
    if (list.length && !list.some((type) => type.id === typeId)) setTypeId(list[0].id);
  }, [session, typeId]);

  const loadDoc = useCallback(
    async (docPath) => {
      if (!docPath) return;
      setDocLoading(true);
      setDocError(null);
      try {
        const full = await studio().docs.read(docPath);
        setDoc(full);
        setActivePath(docPath);
        setDirty(false);
      } catch (err) {
        setDoc(null);
        setDocError({ path: docPath, message: messageOf(err, '读取文件失败') });
        toast.pushError(err, '无法打开文档');
      } finally {
        setDocLoading(false);
      }
    },
    [toast],
  );

  const requestOpenDoc = useCallback(
    (docPath) => {
      if (!docPath || docPath === activePath) return;
      if (dirty) {
        setPendingPath(docPath);
        return;
      }
      setDoc(null);
      loadDoc(docPath);
    },
    [activePath, dirty, loadDoc],
  );

  const handleCreated = useCallback(
    (docPath) => {
      setCreateOpen(false);
      setDocsVersion((value) => value + 1);
      setDirty(false);
      setDoc(null);
      loadDoc(docPath);
    },
    [loadDoc],
  );

  const handleOpenPath = useCallback(
    (docPath) => {
      setDocsVersion((value) => value + 1);
      setDirty(false);
      setDoc(null);
      loadDoc(docPath);
    },
    [loadDoc],
  );

  const handleRenamed = useCallback(
    (nextPath) => {
      setDocsVersion((value) => value + 1);
      setDirty(false);
      setReloadKey((value) => value + 1);
      setDoc(null);
      loadDoc(nextPath);
    },
    [loadDoc],
  );

  const handleDeleted = useCallback(() => {
    setDoc(null);
    setActivePath(null);
    setDirty(false);
    setDocsVersion((value) => value + 1);
  }, []);

  const handleReload = useCallback(() => {
    setReloadKey((value) => value + 1);
    loadDoc(activePath);
  }, [activePath, loadDoc]);

  // ------------------------------------------------------------------- git

  const refreshGit = useCallback(async () => {
    if (!session) return;
    setGitLoading(true);
    try {
      const next = await studio().git.status();
      setGit(next);
    } catch {
      /* git problems are surfaced by TopBar / the sync view */
    } finally {
      setGitLoading(false);
    }
  }, [session]);

  const handleSaved = useCallback(() => {
    setDocsVersion((value) => value + 1);
    refreshGit();
  }, [refreshGit]);

  const refreshToken = useCallback(async () => {
    try {
      const status = await studio().secrets.status();
      setToken(status);
    } catch (err) {
      toast.pushError(err, '无法读取 Token 状态');
    }
  }, [toast]);

  // -------------------------------------------------------------- workspace

  const handleChoose = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const picked = await studio().workspace.choose();
      if (picked?.canceled || !picked?.repoPath) return;
      const opened = await studio().workspace.open(picked.repoPath);
      adoptSession(opened);
    } catch (err) {
      toast.pushError(err, '无法打开仓库');
    } finally {
      setOpening(false);
    }
  }, [adoptSession, opening, toast]);

  const handleOpenRecent = useCallback(
    async (repoPath) => {
      if (opening || !repoPath) return;
      setOpening(true);
      try {
        const opened = await studio().workspace.open(repoPath);
        adoptSession(opened);
      } catch (err) {
        toast.pushError(err, '无法打开仓库');
      } finally {
        setOpening(false);
      }
    },
    [adoptSession, opening, toast],
  );

  /** Re-read `_config.yml` (collections, content types) without closing the editor. */
  const refreshRepo = useCallback(async () => {
    if (!session) return;
    try {
      const opened = await studio().workspace.open(session.root);
      setSession(opened);
      setTypes(opened.contentTypes ?? []);
      setGit(opened.git ?? null);
      setConfigVersion((value) => value + 1);
      setDocsVersion((value) => value + 1);
    } catch (err) {
      toast.pushError(err, '刷新仓库信息失败');
    }
  }, [session, toast]);

  useEffect(() => {
    setMountedViews((current) => (current.has(view) ? current : new Set(current).add(view)));
  }, [view]);

  const encryptionAvailable = useMemo(
    () => Boolean(token?.encryptionAvailable ?? initInfo?.encryptionAvailable),
    [token, initInfo],
  );

  // ------------------------------------------------------------------ views

  if (boot.loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark" aria-hidden="true">
          <Icon name="edit" size={22} />
        </div>
        <h1>Academic Pages Studio</h1>
        <LoadingBlock label="正在初始化…" />
      </div>
    );
  }

  if (boot.error) {
    return (
      <div className="boot-screen">
        <EmptyState
          icon="warn"
          title="初始化失败"
          description={messageOf(boot.error, '无法与主进程通信')}
        >
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setBoot({ loading: true, error: null });
              setBootNonce((value) => value + 1);
            }}
          >
            重试
          </button>
        </EmptyState>
      </div>
    );
  }

  if (!session) {
    return (
      <WelcomeView
        initInfo={initInfo}
        token={token}
        encryptionAvailable={encryptionAvailable}
        opening={opening}
        onChoose={handleChoose}
        onOpen={handleOpenRecent}
        onTokenChanged={refreshToken}
      />
    );
  }

  const repoKey = session.root;

  return (
    <div className="app">
      <TopBar
        root={session.root}
        git={git}
        gitError={session.gitError}
        onSync={() => setView('sync')}
        onRefresh={refreshGit}
        refreshing={gitLoading}
      />

      <div className="app-body">
        <Sidebar
          session={session}
          view={view}
          onView={setView}
          types={types.length ? types : session.contentTypes ?? []}
          typeId={typeId}
          onTypeChange={setTypeId}
          docs={docs}
          docsLoading={docsLoading}
          query={query}
          onQueryChange={setQuery}
          activePath={activePath}
          onSelectDoc={requestOpenDoc}
          onCreateDoc={() => setCreateOpen(true)}
          git={git}
        />

        <main className="workspace">
          <div className={`view-slot ${view === 'docs' ? '' : 'view-slot-hidden'}`}>
            {doc ? (
              <EditorView
                key={`${repoKey}#${doc.path}#${reloadKey}`}
                doc={doc}
                onDirtyChange={setDirty}
                onSaved={handleSaved}
                onReload={handleReload}
                onDeleted={handleDeleted}
                onRenamed={handleRenamed}
                onOpenPath={handleOpenPath}
              />
            ) : docLoading ? (
              <LoadingPane label="正在打开文档…" />
            ) : docError ? (
              <EmptyState
                icon="warn"
                title="无法打开文档"
                description={docError.message}
              >
                <button type="button" className="btn btn-sm" onClick={() => loadDoc(docError.path)}>
                  重试
                </button>
              </EmptyState>
            ) : (
              <EmptyState
                icon="docs"
                title="从左侧选择一篇文档"
                description="也可以点击「新建」创建一篇新的 Markdown 文档。"
              >
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  <Icon name="plus" size={14} />
                  新建文档
                </button>
              </EmptyState>
            )}
          </div>

          {mountedViews.has('profile') ? (
            <div className={`view-slot ${view === 'profile' ? '' : 'view-slot-hidden'}`}>
              <ProfileView key={`${repoKey}-profile-${configVersion}`} onSaved={refreshGit} />
            </div>
          ) : null}

          {mountedViews.has('nav') ? (
            <div className={`view-slot ${view === 'nav' ? '' : 'view-slot-hidden'}`}>
              <NavView key={`${repoKey}-nav-${configVersion}`} onSaved={refreshGit} />
            </div>
          ) : null}

          {mountedViews.has('collections') ? (
            <div className={`view-slot ${view === 'collections' ? '' : 'view-slot-hidden'}`}>
              <CollectionsView key={`${repoKey}-collections`} onChanged={refreshRepo} />
            </div>
          ) : null}

          {mountedViews.has('sync') ? (
            <div className={`view-slot ${view === 'sync' ? '' : 'view-slot-hidden'}`}>
              <SyncView
                key={`${repoKey}-sync-${configVersion}`}
                session={session}
                token={token}
                onTokenChanged={refreshToken}
                onGitStatus={setGit}
                onRepoChanged={refreshGit}
              />
            </div>
          ) : null}
        </main>
      </div>

      {createOpen ? (
        <CreateDocDialog
          types={types.length ? types : session.contentTypes ?? []}
          defaultTypeId={typeId}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}

      {pendingPath ? (
        <ConfirmDialog
          title="放弃未保存的修改？"
          message="当前文档有尚未保存的修改，切换后这些修改会丢失。"
          confirmText="放弃并切换"
          cancelText="继续编辑"
          danger
          onCancel={() => setPendingPath(null)}
          onConfirm={() => {
            const next = pendingPath;
            setPendingPath(null);
            setDirty(false);
            setDoc(null);
            loadDoc(next);
          }}
        />
      ) : null}
    </div>
  );
}
