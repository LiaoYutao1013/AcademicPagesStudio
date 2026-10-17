import { useState } from 'react';

import Modal from './Modal.jsx';
import { Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { studio, messageOf } from '../lib/api.js';
import { todayISO } from '../lib/format.js';

/** Rename (slug) and re-date a document. The date prefix follows the date. */
export default function RenameDialog({ doc, onClose, onRenamed }) {
  const toast = useToast();
  const [slug, setSlug] = useState(doc.slug ?? '');
  const [date, setDate] = useState((doc.date || todayISO()).slice(0, 10));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const isDraft = Boolean(doc.draft);

  async function handleRename() {
    if (!slug.trim()) {
      setError('slug 不能为空');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await studio().docs.rename({
        path: doc.path,
        slug: slug.trim(),
        date: date || undefined,
      });
      toast.push(`已重命名为 ${result.doc.path}`, 'ok');
      onRenamed?.(result.doc.path);
    } catch (err) {
      setError(messageOf(err, '重命名失败'));
      toast.pushError(err, '重命名失败');
      setPending(false);
    }
  }

  return (
    <Modal
      title="重命名文档"
      subtitle={doc.path}
      onClose={onClose}
      closeOnBackdrop={!pending}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={handleRename} disabled={pending}>
            {pending ? <Spinner size={13} /> : null}
            重命名
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="rename-slug">
            slug <span className="field-required">*</span>
          </label>
          <input
            id="rename-slug"
            className="input mono"
            type="text"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setError('');
            }}
            placeholder="my-post"
            disabled={pending}
            autoFocus
          />
          <p className="field-help">只填文件名中的 slug 部分，不要带日期和扩展名。</p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="rename-date">
            日期
          </label>
          <input
            id="rename-date"
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={pending || isDraft}
          />
          <p className="field-help">
            {isDraft
              ? '草稿文件名不含日期前缀；发布时再决定日期。'
              : '文件名前缀与 YAML 里的 date 会一起更新。'}
          </p>
        </div>

        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
