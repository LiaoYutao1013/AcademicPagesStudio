import { useCallback, useEffect, useMemo, useState } from 'react';

import EmptyState from './EmptyState.jsx';
import FieldRow from './FieldRow.jsx';
import { Icon } from './Icons.jsx';
import Modal from './Modal.jsx';
import FilePreviewList from './FilePreviewList.jsx';
import { LoadingPane, Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { messageOf, studio } from '../lib/api.js';

const KIND_PLACEHOLDER = {
  url: 'https://example.com/…',
  email: 'you@example.com',
  username: '用户名（不是完整链接）',
  file: 'avatar.jpg',
};

const KIND_TYPE = {
  textarea: 'textarea',
  url: 'text',
  email: 'text',
  username: 'text',
  file: 'text',
  text: 'text',
};

/** `_config.yml` → `author:` block. Preview, then write; never auto-commits. */
export default function ProfileView({ onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await studio().profile.get();
      setData(result);
      setValues(result.values ?? {});
      setWarnings([]);
      setErrors([]);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groupNames = useMemo(() => {
    const declared = Array.isArray(data?.groups) ? data.groups : [];
    const extra = [];
    for (const field of data?.fields ?? []) {
      if (!declared.includes(field.group) && !extra.includes(field.group)) extra.push(field.group);
    }
    return [...declared, ...extra];
  }, [data]);

  const warningsByKey = useMemo(() => groupByKey(warnings), [warnings]);
  const errorsByKey = useMemo(() => groupByKey(errors), [errors]);

  const dirty = useMemo(() => {
    if (!data) return false;
    return JSON.stringify(values) !== JSON.stringify(data.values ?? {});
  }, [data, values]);

  function setField(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function applyValidationError(err) {
    const details = err?.details ?? {};
    setErrors(Array.isArray(details.errors) ? details.errors : []);
    setWarnings(Array.isArray(details.warnings) ? details.warnings : []);
    toast.pushError(err, '个人资料校验失败');
  }

  async function handlePreview() {
    if (previewing) return;
    setPreviewing(true);
    setErrors([]);
    try {
      const result = await studio().profile.preview(values);
      setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      if (!result.files || result.files.length === 0) {
        toast.push('配置没有变化，无需保存', 'info');
        return;
      }
      setPreview(result);
    } catch (err) {
      applyValidationError(err);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (applying) return;
    setApplying(true);
    try {
      const result = await studio().profile.apply(values);
      toast.push(`已写入 ${result.path}`, 'ok');
      setPreview(null);
      onSaved?.();
      await load();
    } catch (err) {
      applyValidationError(err);
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  async function handleUploadAvatar() {
    setUploading(true);
    try {
      const picked = await studio().assets.pick('image');
      if (picked.canceled || !picked.sourcePath) return;
      const result = await studio().assets.avatar({
        sourcePath: picked.sourcePath,
        fileName: picked.fileName,
      });
      setValues((current) => ({ ...current, avatar: result.name }));
      toast.push(`头像已保存到 ${result.repoPath}，记得保存配置`, 'ok');
    } catch (err) {
      toast.pushError(err, '上传头像失败');
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <LoadingPane label="正在读取 _config.yml…" />;

  if (loadError) {
    return (
      <div className="view-root">
        <EmptyState
          icon="warn"
          title="无法读取配置"
          description={messageOf(loadError, '读取 _config.yml 失败')}
        >
          <button type="button" className="btn btn-sm" onClick={load}>
            重试
          </button>
        </EmptyState>
      </div>
    );
  }

  const extras = data?.extras ?? {};
  const extraKeys = Object.keys(extras);

  return (
    <div className="view-root">
      <header className="view-head">
        <div>
          <h1>个人资料</h1>
          <p className="view-sub">
            编辑 <code className="mono">_config.yml</code> 的 <code className="mono">author:</code> 区块；保存时只改动对应行，注释与缩进保持原样。
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
        <section className="card avatar-card">
          <div className="avatar-row">
            <div className="avatar-preview" aria-hidden="true">
              {values.avatar ? (
                <span className="avatar-file mono">{String(values.avatar).slice(0, 12)}</span>
              ) : (
                <Icon name="user" size={22} />
              )}
            </div>
            <div className="avatar-fields">
              <div className="field">
                <label className="field-label" htmlFor="profile-avatar">
                  头像文件名
                </label>
                <input
                  id="profile-avatar"
                  className="input mono"
                  type="text"
                  value={String(values.avatar ?? '')}
                  onChange={(event) => setField('avatar', event.target.value)}
                  placeholder="avatar.jpg"
                  spellCheck={false}
                />
                <p className="field-help">
                  图片会保存到 <code className="mono">images/</code>，这里只需文件名；留空则不显示图标。
                </p>
                {(warningsByKey.avatar ?? []).length ? (
                  <p className="field-warning">{(warningsByKey.avatar ?? []).join('；')}</p>
                ) : null}
              </div>
              <div className="avatar-actions">
                <button type="button" className="btn btn-sm" onClick={handleUploadAvatar} disabled={uploading}>
                  {uploading ? <Spinner size={13} /> : <Icon name="image" size={13} />}
                  上传图片
                </button>
                <span className="hint">图片复制进 images/，并自动填入文件名</span>
              </div>
            </div>
          </div>
        </section>

        {groupNames.map((group) => (
          <section className="card" key={group}>
            <header className="card-head">
              <h2 className="card-title">{group}</h2>
            </header>
            <div className="form-grid">
              {(data?.fields ?? [])
                .filter((field) => field.group === group && field.key !== 'avatar')
                .map((field) => {
                  const spec = {
                    key: field.key,
                    label: field.label,
                    type: KIND_TYPE[field.kind] ?? 'text',
                    help: field.help,
                    placeholder: KIND_PLACEHOLDER[field.kind],
                  };
                  return (
                    <div
                      className={`fm-cell ${field.kind === 'textarea' ? 'fm-cell-wide' : ''}`.trim()}
                      key={field.key}
                    >
                      <FieldRow
                        field={spec}
                        value={values[field.key] ?? ''}
                        onChange={(value) => setField(field.key, value)}
                        warning={(warningsByKey[field.key] ?? []).join('；')}
                        error={(errorsByKey[field.key] ?? []).join('；')}
                        idPrefix="profile"
                      />
                    </div>
                  );
                })}
            </div>
          </section>
        ))}

        {warnings.some((warning) => !warning.key) ? (
          <div className="notice notice-warn">
            <Icon name="warn" size={14} />
            <div>
              {warnings
                .filter((warning) => !warning.key)
                .map((warning) => warning.message)
                .join('；')}
            </div>
          </div>
        ) : null}

        {extraKeys.length ? (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">其他键</h2>
              <span className="badge badge-muted">{extraKeys.length}</span>
            </header>
            <p className="card-hint">
              这些 <code className="mono">author</code> 键不在表单里管理，保存时会原样保留：
            </p>
            <div className="chips">
              {extraKeys.map((key) => (
                <span className="chip chip-muted" key={key}>
                  <span className="mono">{key}</span>
                </span>
              ))}
            </div>
          </section>
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
          title="预览配置变更"
          subtitle="_config.yml"
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
                {preview.warnings.map((warning) => (
                  <div key={`${warning.key}-${warning.message}`}>{warning.message}</div>
                ))}
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

function groupByKey(list) {
  const map = {};
  for (const item of list ?? []) {
    const key = item?.key ?? '';
    if (!map[key]) map[key] = [];
    map[key].push(String(item?.message ?? ''));
  }
  return map;
}
