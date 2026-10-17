import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ConfirmDialog from './ConfirmDialog.jsx';
import { Icon } from './Icons.jsx';
import MarkdownEditor from './MarkdownEditor.jsx';
import MarkdownPreview from './MarkdownPreview.jsx';
import MarkdownToolbar from './MarkdownToolbar.jsx';
import RenameDialog from './RenameDialog.jsx';
import { Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import FieldRow from './FieldRow.jsx';
import { messageOf, studio } from '../lib/api.js';
import { formatTime, formatValue, todayISO, toInputString, listToText, splitList } from '../lib/format.js';
import { useDocumentKeydown } from '../lib/hooks.js';

const MODES = [
  { id: 'edit', label: '仅编辑', icon: 'edit' },
  { id: 'split', label: '分屏', icon: 'split' },
  { id: 'preview', label: '仅预览', icon: 'eye' },
];

/**
 * Core editing screen.
 *
 * Owns the unsaved state of one document: Front Matter form values, the raw
 * YAML escape hatch, and the Markdown body. Everything that touches disk/IPC
 * lives here and reports upward through callbacks, so the parent shell never
 * has to hold half-edited content.
 */
export default function EditorView({
  doc,
  onDirtyChange,
  onSaved,
  onReload,
  onDeleted,
  onRenamed,
  onOpenPath,
}) {
  const toast = useToast();
  const editorRef = useRef(null);

  const fields = doc.spec?.fields ?? [];
  const initialValues = useMemo(() => valuesFromDoc(doc), [doc]);
  const initialBody = doc.body ?? '';
  const initialFrontMatter = doc.frontMatterText ?? '';

  const [values, setValues] = useState(initialValues);
  const [body, setBody] = useState(initialBody);
  const [frontMatterText, setFrontMatterText] = useState(initialFrontMatter);
  const [frontMatterBaseline, setFrontMatterBaseline] = useState(initialFrontMatter);
  const [advanced, setAdvanced] = useState(Boolean(doc.frontMatterError));
  const [snapshot, setSnapshot] = useState(() =>
    JSON.stringify({ values: initialValues, body: initialBody, fm: initialFrontMatter }),
  );
  const [meta, setMeta] = useState(() => pickMeta(doc));
  const [mode, setMode] = useState('split');
  const [fieldsOpen, setFieldsOpen] = useState(true);

  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [conflict, setConflict] = useState(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftCopyOpen, setDraftCopyOpen] = useState(false);
  const [advancedOffOpen, setAdvancedOffOpen] = useState(false);

  const mtimeRef = useRef(doc.mtimeMs);
  const dirtyRef = useRef(false);
  const dirtyCallbackRef = useRef(onDirtyChange);

  const dirty = JSON.stringify({ values, body, fm: frontMatterText }) !== snapshot;

  // Keep the callback in a ref so a non-memoised parent prop cannot trigger the
  // unmount cleanup (which would clear the parent's dirty flag mid-edit).
  useEffect(() => {
    dirtyCallbackRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    dirtyCallbackRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => () => dirtyCallbackRef.current?.(false), []);

  const inheritedEntries = useMemo(() => Object.entries(doc.inherited ?? {}), [doc.inherited]);
  const typeLabel = meta.spec?.label ?? meta.typeId ?? '文档';
  const err = meta.frontMatterError;

  const setField = useCallback((key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  function validate() {
    // In advanced mode the raw YAML is authoritative; the form is disabled and
    // may legitimately be empty (e.g. repairing a file with broken front matter).
    if (advanced) return true;
    const missing = fields.filter(
      (field) => field.required && field.type !== 'boolean' && !String(values[field.key] ?? '').trim(),
    );
    if (missing.length) {
      toast.push(`请填写必填字段：${missing.map((field) => field.label).join('、')}`, 'warn');
      setFieldsOpen(true);
      return false;
    }
    return true;
  }

  function buildPayload() {
    const payload = { path: meta.path, body, expectedMtimeMs: mtimeRef.current };
    if (advanced) payload.frontMatterText = frontMatterText;
    else payload.values = buildFieldValues(fields, values);
    return payload;
  }

  /** Write and then re-read the file, so the UI always mirrors disk. */
  async function persist() {
    const result = await studio().docs.save(buildPayload());
    return result.doc;
  }

  async function applyFresh(fresh) {
    const nextValues = valuesFromDoc(fresh);
    const nextBody = fresh.body ?? '';
    const nextFrontMatter = fresh.frontMatterText ?? '';
    setValues(nextValues);
    setBody(nextBody);
    setFrontMatterBaseline(nextFrontMatter);
    setFrontMatterText(nextFrontMatter);
    setMeta(pickMeta(fresh));
    mtimeRef.current = fresh.mtimeMs;
    setSnapshot(JSON.stringify({ values: nextValues, body: nextBody, fm: nextFrontMatter }));
  }

  async function refreshFromDisk() {
    try {
      const fresh = await studio().docs.read(meta.path);
      await applyFresh(fresh);
      onSaved?.(fresh);
    } catch {
      setSnapshot(JSON.stringify({ values, body, fm: frontMatterText }));
    }
  }

  async function handleSave() {
    if (saving || pendingAction) return;
    if (!validate()) return;
    setSaving(true);
    setConflict(null);
    try {
      const saved = await persist();
      mtimeRef.current = saved.mtimeMs;
      setMeta((current) => ({ ...current, ...saved }));
      setSavedAt(formatTime(new Date()));
      toast.push('已保存到本地', 'ok');
      await refreshFromDisk();
    } catch (error) {
      if (error?.code === 'FILE_CONFLICT') {
        setConflict({ message: messageOf(error, '文件已被其他程序修改') });
      }
      toast.pushError(error, '保存失败');
    } finally {
      setSaving(false);
    }
  }

  useDocumentKeydown((event) => {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
    }
  });

  async function handlePublish() {
    if (pendingAction) return;
    if (!validate()) return;
    setPendingAction('publish');
    setConflict(null);
    try {
      if (dirty) {
        const saved = await persist();
        mtimeRef.current = saved.mtimeMs;
      }
      const result = await studio().docs.publish({
        path: meta.path,
        date: todayISO(),
        slug: meta.slug || undefined,
      });
      toast.push(`草稿已发布到 ${result.doc.path}`, 'ok');
      onRenamed?.(result.doc.path);
    } catch (error) {
      if (error?.code === 'FILE_CONFLICT') setConflict({ message: messageOf(error) });
      toast.pushError(error, '发布草稿失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveAsDraft() {
    if (pendingAction) return;
    if (!meta.typeId) {
      toast.push('无法识别该文档的类型，不能另存为草稿', 'error');
      return;
    }
    if (!validate()) return;
    setPendingAction('draft');
    try {
      if (dirty) await persist();
      const result = await studio().docs.create({
        typeId: meta.typeId,
        title: meta.title,
        slug: meta.slug || undefined,
        date: todayISO(),
        draft: true,
        values: buildFieldValues(fields, values),
        body,
      });
      setDraftCopyOpen(false);
      toast.push(`已另存为草稿 ${result.doc.path}`, 'ok');
      onOpenPath?.(result.doc.path);
    } catch (error) {
      toast.pushError(error, '另存为草稿失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (pendingAction) return;
    setPendingAction('delete');
    try {
      const result = await studio().docs.remove(meta.path);
      toast.push(result?.trashed ? '已移到系统回收站' : '文件已删除', 'ok');
      setDeleteOpen(false);
      onDeleted?.();
    } catch (error) {
      toast.pushError(error, '删除失败');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReveal() {
    try {
      await studio().app.reveal(meta.path);
    } catch (error) {
      toast.pushError(error, '无法打开所在文件夹');
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? []).filter(Boolean);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        try {
          const sourcePath = studio().assets.pathForFile(file);
          let result;
          if (sourcePath) {
            result = await studio().assets.import({ sourcePath, fileName: file.name || undefined });
          } else {
            const dataBase64 = await readAsBase64(file);
            result = await studio().assets.import({
              dataBase64,
              fileName: file.name || 'pasted-image.png',
              kind: 'image',
            });
          }
          editorRef.current?.insertText(result.markdown);
          toast.push(`已保存资源：${result.repoPath}`, 'ok');
        } catch (error) {
          toast.pushError(error, '导入文件失败');
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function handleToolbar(action) {
    const editor = editorRef.current;
    if (!editor) return;
    switch (action) {
      case 'bold':
        editor.wrap('**', '**', '粗体');
        break;
      case 'italic':
        editor.wrap('_', '_', '斜体');
        break;
      case 'code':
        editor.wrap('`', '`', '代码');
        break;
      case 'codeblock':
        editor.wrap('\n```\n', '\n```\n', '代码块');
        break;
      case 'link':
        editor.wrap('[', '](https://)', '链接文字');
        break;
      case 'image':
        editor.wrap('![', '](https://)', '图片说明');
        break;
      case 'quote':
        editor.prefixLine('> ');
        break;
      case 'ul':
        editor.prefixLine('- ');
        break;
      case 'ol':
        editor.prefixLine('1. ');
        break;
      default:
        break;
    }
  }

  function toggleAdvanced() {
    if (advanced) {
      if (frontMatterText !== frontMatterBaseline) {
        setAdvancedOffOpen(true);
        return;
      }
      setAdvanced(false);
      return;
    }
    setFrontMatterText(frontMatterBaseline);
    setAdvanced(true);
  }

  const busy = saving || pendingAction !== null;

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title-row">
          <div className="editor-titles">
            <h1 title={meta.title}>{meta.title || '（无标题）'}</h1>
            <div className="editor-sub">
              <span className="mono muted">{meta.path}</span>
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              <span className="muted">{typeLabel}</span>
              {meta.permalink ? (
                <>
                  <span className="dot-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="mono muted">{meta.permalink}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="editor-badges">
            {meta.draft ? <span className="badge badge-draft">草稿</span> : null}
            {dirty ? (
              <span className="badge badge-warn">未保存</span>
            ) : savedAt ? (
              <span className="badge badge-ok">已保存 {savedAt}</span>
            ) : (
              <span className="badge badge-muted">无改动</span>
            )}
          </div>
        </div>

        <div className="editor-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={busy || !dirty}>
            {saving ? <Spinner size={13} /> : <Icon name="check" size={14} />}
            保存到本地
          </button>
          {meta.draft ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handlePublish}
              disabled={busy}
              title="把 _drafts/ 下的文件移动到 _posts/ 并写入日期"
            >
              {pendingAction === 'publish' ? <Spinner size={13} /> : <Icon name="play" size={13} />}
              发布草稿
            </button>
          ) : meta.spec?.draftable ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDraftCopyOpen(true)}
              disabled={busy || advanced}
              title={advanced ? '高级模式下不支持另存为草稿，请先关闭高级模式' : '在 _drafts/ 下创建一份草稿副本'}
            >
              <Icon name="file" size={13} />
              另存为草稿
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => setRenameOpen(true)} disabled={busy}>
            <Icon name="edit" size={13} />
            重命名
          </button>
          <button type="button" className="btn btn-sm" onClick={handleReveal}>
            <Icon name="folder" size={13} />
            在文件夹中显示
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger-ghost"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
          >
            <Icon name="trash" size={13} />
            删除
          </button>

          <span className="editor-actions-spacer" />

          <div className="segmented" role="group" aria-label="编辑模式">
            {MODES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`segmented-btn ${mode === item.id ? 'segmented-btn-active' : ''}`.trim()}
                onClick={() => setMode(item.id)}
                aria-pressed={mode === item.id}
                title={item.label}
              >
                <Icon name={item.icon} size={13} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="editor-scroll">
        {err ? (
          <div className="notice notice-danger">
            <Icon name="warn" size={14} />
            <div>
              <strong>Front Matter 解析失败：</strong>
              {err.message}
              {err.line ? `（第 ${err.line} 行）` : ''}
              <div className="muted">表单无法读取该文件，请用下方「高级」里的原始 YAML 修正后保存。</div>
            </div>
          </div>
        ) : null}

        {!meta.hasFrontMatter && !err ? (
          <div className="notice notice-info">
            <Icon name="info" size={14} />
            <div>这个文件还没有 Front Matter，保存时会自动补上。</div>
          </div>
        ) : null}

        {conflict ? (
          <div className="notice notice-danger">
            <Icon name="warn" size={14} />
            <div>
              <strong>文件已被其他程序修改</strong>
              <div>{conflict.message}</div>
              <div className="notice-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setConflict(null);
                    onReload?.();
                  }}
                >
                  <Icon name="refresh" size={13} />
                  重新加载
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConflict(null)}>
                  关闭提示
                </button>
              </div>
              <div className="muted">重新加载会丢弃未保存的修改。</div>
            </div>
          </div>
        ) : null}

        <section className="fm-panel">
          <button
            type="button"
            className="fm-toggle"
            onClick={() => setFieldsOpen((open) => !open)}
            aria-expanded={fieldsOpen}
          >
            <Icon name={fieldsOpen ? 'chevronDown' : 'chevronRight'} size={14} />
            <span>Front Matter</span>
            <span className="muted">{fields.length} 个字段</span>
            {advanced ? <span className="badge badge-warn">高级模式</span> : null}
          </button>

          {fieldsOpen ? (
            <div className="fm-body">
              {inheritedEntries.length ? (
                <div className="inherited">
                  <div className="inherited-head">
                    <Icon name="layers" size={13} />
                    以下默认值来自 <code className="mono">_config.yml</code> 的 defaults，保存时会自动写入文件
                  </div>
                  <div className="chips">
                    {inheritedEntries.map(([key, value]) => (
                      <span className="chip chip-muted" key={key}>
                        <span className="mono">{key}</span>
                        <span className="chip-value">{formatValue(value)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="fm-grid">
                {fields.map((field) => (
                  <div
                    className={`fm-cell ${field.type === 'textarea' ? 'fm-cell-wide' : ''}`.trim()}
                    key={field.key}
                  >
                    <FieldRow
                      field={field}
                      value={values[field.key]}
                      onChange={(value) => setField(field.key, value)}
                      disabled={advanced}
                      idPrefix="fm"
                    />
                  </div>
                ))}
              </div>

              {advanced ? (
                <p className="notice notice-warn compact">
                  <Icon name="warn" size={13} />
                  高级模式：保存时将以原始 YAML 为准，上方表单字段本次不会写入。
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="fm-advanced">
            <button type="button" className="link-btn" onClick={toggleAdvanced}>
              <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={13} />
              {advanced ? '收起原始 YAML' : '高级：直接编辑 Front Matter YAML'}
            </button>
            {advanced ? (
              <>
                <textarea
                  className="input textarea mono yaml-area"
                  value={frontMatterText}
                  onChange={(event) => setFrontMatterText(event.target.value)}
                  rows={Math.min(24, Math.max(8, frontMatterText.split('\n').length + 1))}
                  spellCheck={false}
                  aria-label="Front Matter YAML 原文"
                />
                <p className="field-help">
                  不含首尾的 <code className="mono">---</code> 分隔线。留空保存会写入一个空的 Front Matter。
                </p>
              </>
            ) : null}
          </div>
        </section>
      </div>

      {/* Both panes stay mounted: switching mode must not recreate the
          CodeMirror view (or discard its cursor/history). */}
      <div className={`editor-body mode-${mode}`}>
        <div className="editor-pane editor-pane-cm">
          <MarkdownToolbar onAction={handleToolbar} />
          {uploading ? (
            <div className="pane-notice">
              <Spinner size={12} /> 正在导入文件…
            </div>
          ) : null}
          <MarkdownEditor
            ref={editorRef}
            value={body}
            onChange={setBody}
            onFiles={handleFiles}
            placeholder="在这里写 Markdown 正文…"
          />
        </div>

        <div className="editor-pane editor-pane-preview">
          <div className="pane-head">
            <span>预览</span>
            <span className="muted">marked + DOMPurify</span>
          </div>
          <div className="preview-scroll">
            <MarkdownPreview source={body} />
          </div>
        </div>
      </div>

      {renameOpen ? (
        <RenameDialog
          doc={meta}
          onClose={() => setRenameOpen(false)}
          onRenamed={(nextPath) => {
            setRenameOpen(false);
            onRenamed?.(nextPath);
          }}
        />
      ) : null}

      {deleteOpen ? (
        <ConfirmDialog
          title="删除这个文档？"
          message={`${meta.path} 将被移除（可用时移入系统回收站），此操作无法在应用内撤销。`}
          confirmText="删除文件"
          danger
          pending={pendingAction === 'delete'}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      ) : null}

      {draftCopyOpen ? (
        <ConfirmDialog
          title="另存为草稿"
          message="将在 _drafts/ 下创建一份草稿副本；当前已发布的文件保持不变。草稿在发布前不会出现在站点上。"
          confirmText="另存为草稿"
          pending={pendingAction === 'draft'}
          onCancel={() => setDraftCopyOpen(false)}
          onConfirm={handleSaveAsDraft}
        />
      ) : null}

      {advancedOffOpen ? (
        <ConfirmDialog
          title="放弃原始 YAML 的修改？"
          message="关闭高级模式会丢弃你在原始 Front Matter 中尚未保存的修改。"
          confirmText="放弃修改"
          danger
          onCancel={() => setAdvancedOffOpen(false)}
          onConfirm={() => {
            setFrontMatterText(frontMatterBaseline);
            setAdvanced(false);
            setAdvancedOffOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Front matter object → form state (lists as comma text, booleans as boolean). */
function valuesFromDoc(doc) {
  const out = {};
  const flat = doc.flatData ?? {};
  for (const field of doc.spec?.fields ?? []) {
    const raw = flat[field.key];
    if (field.type === 'list') out[field.key] = listToText(raw);
    else if (field.type === 'boolean') out[field.key] = raw === true || raw === 'true';
    else out[field.key] = toInputString(raw);
  }
  return out;
}

/** Form state → payload values (lists as arrays, booleans as boolean). */
function buildFieldValues(fields, values) {
  const out = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (field.type === 'list') out[field.key] = splitList(raw);
    else if (field.type === 'boolean') out[field.key] = Boolean(raw);
    else out[field.key] = typeof raw === 'string' ? raw.trim() : toInputString(raw);
  }
  return out;
}

function pickMeta(doc) {
  return {
    path: doc.path,
    title: doc.title,
    slug: doc.slug,
    date: doc.date,
    draft: doc.draft,
    typeId: doc.typeId,
    mtimeMs: doc.mtimeMs,
    permalink: doc.permalink,
    frontMatterError: doc.frontMatterError,
    hasFrontMatter: doc.hasFrontMatter,
    spec: doc.spec,
  };
}

/** Clipboard images have no path; read them as base64 for `assets.import`. */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const index = result.indexOf(',');
      resolve(index >= 0 ? result.slice(index + 1) : result);
    };
    reader.onerror = () => reject(new Error('无法读取剪贴板内容'));
    reader.readAsDataURL(file);
  });
}
