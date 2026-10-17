import { useCallback, useEffect, useMemo, useState } from 'react';

import EmptyState from './EmptyState.jsx';
import FilePreviewList from './FilePreviewList.jsx';
import { Icon } from './Icons.jsx';
import Modal from './Modal.jsx';
import { LoadingPane, Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { messageOf, studio } from '../lib/api.js';

/**
 * `_data/navigation.yml` → `main:` list.
 *
 * Order in the file *is* the header order, so this screen edits the sequence:
 * drag the handle (or use 上移/下移) to reorder, edit title/url inline.
 */
export default function NavView({ onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [snapshot, setSnapshot] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [serverWarnings, setServerWarnings] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [autoFocusIndex, setAutoFocusIndex] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await studio().nav.get();
      const list = (result.items ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
      }));
      setItems(list);
      setSnapshot(JSON.stringify(list));
      setServerErrors([]);
      setServerWarnings([]);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = JSON.stringify(items) !== snapshot;

  const localErrors = useMemo(() => {
    const out = {};
    items.forEach((item, index) => {
      const list = [];
      const title = item.title.trim();
      const url = item.url.trim();
      if (!title) list.push('标题不能为空');
      if (!url) list.push('URL 不能为空');
      else if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) list.push('内部链接需以 / 开头');
      if (list.length) out[index] = list;
    });
    return out;
  }, [items]);

  const serverByIndex = useMemo(() => {
    const map = {};
    for (const entry of serverErrors) {
      const index = typeof entry?.index === 'number' ? entry.index : -1;
      if (!map[index]) map[index] = [];
      map[index].push(typeof entry === 'string' ? entry : String(entry?.message ?? ''));
    }
    return map;
  }, [serverErrors]);

  const hasLocalErrors = Object.keys(localErrors).length > 0;

  function updateItem(index, key, value) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    );
  }

  function removeItem(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function moveItem(from, to) {
    setItems((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function addItem() {
    setItems((current) => [...current, { title: '', url: '/' }]);
    setAutoFocusIndex(items.length);
  }

  function handleDragStart(event, index) {
    setDragIndex(index);
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      /* some environments expose a read-only dataTransfer */
    }
  }

  function handleDragOver(event, index) {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  }

  function handleDrop(event, index) {
    event.preventDefault();
    const raw = dragIndex ?? Number(event.dataTransfer.getData('text/plain'));
    if (Number.isInteger(raw) && !Number.isNaN(raw)) moveItem(raw, index);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function collectErrors(err) {
    const details = err?.details ?? {};
    setServerErrors(Array.isArray(details.errors) ? details.errors : []);
    setServerWarnings(Array.isArray(details.warnings) ? details.warnings : []);
  }

  async function handlePreview() {
    if (previewing) return;
    if (hasLocalErrors) {
      toast.push('请先修正导航列表里的错误', 'warn');
      return;
    }
    setPreviewing(true);
    setServerErrors([]);
    try {
      const result = await studio().nav.preview(items);
      setServerWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      if (!result.files || result.files.length === 0) {
        toast.push('导航栏没有变化', 'info');
        return;
      }
      setPreview(result);
    } catch (err) {
      collectErrors(err);
      toast.pushError(err, '预览导航栏变更失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (applying) return;
    setApplying(true);
    try {
      await studio().nav.apply(items);
      toast.push('导航栏已保存到本地', 'ok');
      setPreview(null);
      onSaved?.();
      // Re-read from disk so the list reflects exactly what was written
      // (the service trims and normalises URLs).
      await load();
    } catch (err) {
      collectErrors(err);
      setPreview(null);
      toast.pushError(err, '保存导航栏失败');
    } finally {
      setApplying(false);
    }
  }

  if (loading) return <LoadingPane label="正在读取 _data/navigation.yml…" />;

  if (loadError) {
    return (
      <div className="view-root">
        <EmptyState
          icon="warn"
          title="无法读取导航栏"
          description={messageOf(loadError, '读取 _data/navigation.yml 失败')}
        >
          <button type="button" className="btn btn-sm" onClick={load}>
            重试
          </button>
        </EmptyState>
      </div>
    );
  }

  const globalErrors = serverByIndex[-1] ?? [];

  return (
    <div className="view-root">
      <header className="view-head">
        <div>
          <h1>导航栏</h1>
          <p className="view-sub">
            编辑 <code className="mono">_data/navigation.yml</code> 里的 <code className="mono">main:</code> 列表，顺序就是顶部导航的顺序。
          </p>
        </div>
        <div className="view-head-actions">
          <span className={`badge ${dirty ? 'badge-warn' : 'badge-muted'}`}>
            {dirty ? '有未保存的修改' : '与磁盘一致'}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={handlePreview} disabled={previewing}>
            {previewing ? <Spinner size={13} /> : <Icon name="eye" size={14} />}
            预览变更
          </button>
        </div>
      </header>

      <div className="view-scroll">
        <div className="notice notice-info">
          <Icon name="info" size={14} />
          <div>
            删除条目只会移除顶部导航链接，<strong>不会删除页面文件</strong>；新增条目通常还需要在
            <code className="mono"> _pages/</code> 下创建对应页面，或指向一个已存在的归档页。
          </div>
        </div>

        {dirty && hasLocalErrors ? (
          <div className="notice notice-warn">
            <Icon name="warn" size={14} />
            <div>有 {Object.keys(localErrors).length} 项需要修正后才能预览和保存。</div>
          </div>
        ) : null}

        {globalErrors.length ? (
          <div className="notice notice-danger">
            <Icon name="warn" size={14} />
            <div>{globalErrors.join('；')}</div>
          </div>
        ) : null}

        <section className="card nav-card">
          <header className="card-head">
            <h2 className="card-title">
              导航条目 <span className="badge badge-muted">{items.length}</span>
            </h2>
            <button type="button" className="btn btn-sm" onClick={addItem}>
              <Icon name="plus" size={13} />
              新增条目
            </button>
          </header>

          {items.length === 0 ? (
            <EmptyState
              icon="nav"
              title="导航栏是空的"
              description="点击「新增条目」添加第一个链接，例如指向 /about/ 的「关于」。"
            />
          ) : (
            <ul className="nav-list">
              {items.map((item, index) => {
                const problems = [...(localErrors[index] ?? []), ...(serverByIndex[index] ?? [])];
                return (
                  <li
                    className={`nav-item ${dragIndex === index ? 'nav-item-dragging' : ''} ${
                      overIndex === index && dragIndex !== index ? 'nav-item-over' : ''
                    }`.trim()}
                    key={`nav-${index}`}
                    onDragOver={(event) => handleDragOver(event, index)}
                    onDrop={(event) => handleDrop(event, index)}
                  >
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={(event) => handleDragStart(event, index)}
                      onDragEnd={handleDragEnd}
                      title="拖动排序"
                      aria-hidden="true"
                    >
                      <Icon name="drag" size={14} />
                    </span>
                    <span className="nav-index mono">{index + 1}</span>
                    <div className="nav-fields">
                      <input
                        className="input"
                        type="text"
                        value={item.title}
                        aria-label={`第 ${index + 1} 项标题`}
                        placeholder="标题，例如 关于"
                        autoFocus={autoFocusIndex === index}
                        onFocus={() => setAutoFocusIndex(null)}
                        onChange={(event) => updateItem(index, 'title', event.target.value)}
                      />
                      <input
                        className="input mono"
                        type="text"
                        value={item.url}
                        aria-label={`第 ${index + 1} 项链接`}
                        placeholder="/about/ 或 https://example.com"
                        spellCheck={false}
                        onChange={(event) => updateItem(index, 'url', event.target.value)}
                      />
                      {problems.length ? <p className="field-error">{problems.join('；')}</p> : null}
                    </div>
                    <div className="nav-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`上移第 ${index + 1} 项`}
                        onClick={() => moveItem(index, index - 1)}
                        disabled={index === 0}
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`下移第 ${index + 1} 项`}
                        onClick={() => moveItem(index, index + 1)}
                        disabled={index === items.length - 1}
                      >
                        <Icon name="down" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label={`删除第 ${index + 1} 项（只删除导航链接）`}
                        title="只删除导航链接，不删除页面"
                        onClick={() => removeItem(index)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {serverWarnings.length ? (
          <div className="notice notice-warn">
            <Icon name="warn" size={14} />
            <div>
              {serverWarnings.map((warning, index) => (
                <div key={index}>{warning.message ?? String(warning)}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="view-foot">
        <span className="muted">保存只写入本机文件，不会提交或推送。</span>
        <div className="view-foot-actions">
          <button type="button" className="btn btn-sm" onClick={load} disabled={applying}>
            重新读取
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handlePreview} disabled={previewing}>
            预览变更
          </button>
        </div>
      </footer>

      {preview ? (
        <Modal
          title="预览导航栏变更"
          subtitle="_data/navigation.yml"
          wide
          onClose={() => setPreview(null)}
          closeOnBackdrop={!applying}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPreview(null)} disabled={applying}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={handleApply} disabled={applying}>
                {applying ? <Spinner size={13} /> : null}
                保存到本地
              </button>
            </>
          }
        >
          <FilePreviewList files={preview.files} />
          {preview.warnings?.length ? (
            <div className="notice notice-warn">
              <Icon name="warn" size={14} />
              <div>
                {preview.warnings.map((warning, index) => (
                  <div key={index}>{warning.message ?? String(warning)}</div>
                ))}
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
