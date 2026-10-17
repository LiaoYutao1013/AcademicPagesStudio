import { useEffect, useMemo, useState } from 'react';

import Modal from './Modal.jsx';
import { Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { studio, messageOf } from '../lib/api.js';
import { useDebouncedValue } from '../lib/hooks.js';
import { todayISO } from '../lib/format.js';

/** Create a document from a content type, showing where the file will land. */
export default function CreateDocDialog({ types, defaultTypeId, onClose, onCreated }) {
  const toast = useToast();
  const list = types ?? [];
  const [typeId, setTypeId] = useState(
    defaultTypeId && list.some((type) => type.id === defaultTypeId) ? defaultTypeId : list[0]?.id ?? 'post',
  );
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const type = useMemo(() => list.find((item) => item.id === typeId) ?? null, [list, typeId]);
  const draftable = Boolean(type?.draftable);

  useEffect(() => {
    if (!draftable) setDraft(false);
  }, [draftable]);

  const debouncedTitle = useDebouncedValue(title, 280);
  const debouncedSlug = useDebouncedValue(slug, 280);

  useEffect(() => {
    let cancelled = false;
    const trimmed = debouncedTitle.trim();
    if (!typeId || !trimmed) {
      setSuggestion(null);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const result = await studio().docs.suggestPath({
          typeId,
          title: trimmed,
          date,
          draft: draftable ? draft : false,
        });
        if (!cancelled) setSuggestion(result);
      } catch {
        if (!cancelled) setSuggestion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedTitle, typeId, date, draft, draftable]);

  const effectiveSlug = (debouncedSlug.trim() || suggestion?.slug || '').trim();
  const previewPath = useMemo(() => {
    if (!type) return '';
    const dir = draft && draftable ? '_drafts' : type.dir;
    const prefix = type.datePrefix && !(draft && draftable) ? `${date || 'YYYY-MM-DD'}-` : '';
    return `${dir}/${prefix}${effectiveSlug || 'untitled'}.md`;
  }, [type, draft, draftable, date, effectiveSlug]);

  const pathTaken = Boolean(suggestion && suggestion.available === false && !slug.trim());

  async function handleCreate() {
    if (!title.trim()) {
      setError('请填写标题');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await studio().docs.create({
        typeId,
        title: title.trim(),
        slug: slug.trim() || undefined,
        date: date || undefined,
        draft: draftable ? draft : false,
        body: '',
      });
      toast.push(`已创建 ${result.doc.path}`, 'ok');
      onCreated?.(result.doc.path);
    } catch (err) {
      setError(messageOf(err, '创建文档失败'));
      toast.pushError(err, '创建文档失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="新建文档"
      subtitle="文件会直接写入仓库，随后打开编辑。"
      onClose={onClose}
      closeOnBackdrop={!creating}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={creating}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner size={13} /> : null}
            创建
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="create-type">
            类型
          </label>
          <select
            id="create-type"
            className="input select"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            disabled={creating}
          >
            {list.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}（{item.dir}/）
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="create-title">
            标题 <span className="field-required">*</span>
          </label>
          <input
            id="create-title"
            className="input"
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError('');
            }}
            placeholder="例如：一次关于本地优先编辑器的实验"
            autoFocus
            disabled={creating}
          />
        </div>

        <div className="form-row">
          <div className="field">
            <label className="field-label" htmlFor="create-date">
              日期
            </label>
            <input
              id="create-date"
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={creating}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="create-slug">
              文件名 slug <span className="field-optional">可选</span>
            </label>
            <input
              id="create-slug"
              className="input mono"
              type="text"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={suggestion?.slug || '根据标题自动生成'}
              disabled={creating}
            />
          </div>
        </div>

        {draftable ? (
          <label className="checkbox-line" htmlFor="create-draft">
            <input
              id="create-draft"
              type="checkbox"
              checked={draft}
              onChange={(event) => setDraft(event.target.checked)}
              disabled={creating}
            />
            <span>
              保存为草稿（写入 <code className="mono">_drafts/</code>，不会立即发布）
            </span>
          </label>
        ) : null}

        <div className="path-preview">
          <span className="muted">将创建：</span>
          <code className="mono">{previewPath || '—'}</code>
          {pathTaken ? <span className="hint">同名文件已存在，保存时会自动追加序号。</span> : null}
        </div>

        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
