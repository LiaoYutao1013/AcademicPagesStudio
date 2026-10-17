import { useEffect, useMemo, useState } from 'react';

import DiffView from './DiffView.jsx';
import { Icon } from './Icons.jsx';
import Modal from './Modal.jsx';
import { Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { messageOf, studio } from '../lib/api.js';
import { useDebouncedValue } from '../lib/hooks.js';

const INITIAL = {
  label: '',
  title: '',
  navUrl: '',
  permalink: '/:collection/:path/',
  layout: 'single',
  intro: '',
  includeNav: true,
  share: true,
  comments: true,
};

const FILE_PLAN = [
  {
    path: '_config.yml',
    title: 'collections 条目',
    detail: '在 collections: 下追加 <label>: { output: true, permalink: … }，只新增行，不改动其它内容。',
  },
  {
    path: '_config.yml',
    title: 'defaults 条目',
    detail: '在 defaults: 末尾追加一个 scope.type 默认值块（layout / author_profile / share / comments）。',
  },
  {
    path: '_pages/<slug>.html',
    title: '归档页',
    detail: 'layout: archive 的页面，循环输出 site.<label> 里的条目，并生成归档 URL。',
  },
  {
    path: '_data/navigation.yml',
    title: '导航条目（可选）',
    detail: '在 main: 末尾添加「标题 + 归档 URL」，让分区出现在顶部导航里。',
  },
];

/** Create a new Jekyll collection ("分区") with the four coordinated edits. */
export default function CollectionsView({ onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState(INITIAL);
  const [check, setCheck] = useState({ errors: [], warnings: [] });
  const [checking, setChecking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState(null);
  const [appliedPaths, setAppliedPaths] = useState([]);

  const debouncedForm = useDebouncedValue(form, 350);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedForm.label.trim() && !debouncedForm.title.trim()) {
      setCheck({ errors: [], warnings: [] });
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }
    setChecking(true);
    (async () => {
      try {
        const result = await studio().collections.check(debouncedForm);
        if (!cancelled) {
          setCheck({ errors: result.errors ?? [], warnings: result.warnings ?? [] });
        }
      } catch (err) {
        if (!cancelled) {
          setCheck({ errors: [{ message: messageOf(err, '校验失败') }], warnings: [] });
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedForm]);

  const input = useMemo(
    () => ({
      label: form.label,
      title: form.title,
      navUrl: form.navUrl,
      permalink: form.permalink,
      layout: form.layout,
      intro: form.intro,
      includeNav: form.includeNav,
      share: form.share,
      comments: form.comments,
    }),
    [form],
  );

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handlePreview() {
    if (previewing) return;
    if (check.errors.length) {
      toast.push('请先修正校验错误', 'warn');
      return;
    }
    setPreviewing(true);
    try {
      const result = await studio().collections.preview(input);
      setCheck({ errors: result.errors ?? [], warnings: result.warnings ?? [] });
      if (result.errors?.length) {
        toast.push('生成文件前校验失败，请查看错误', 'error');
        return;
      }
      setPreview(result);
    } catch (err) {
      toast.pushError(err, '预览生成文件失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (applying) return;
    setApplying(true);
    try {
      const result = await studio().collections.apply(input);
      setPreview(null);
      setAppliedPaths(result.paths ?? []);
      toast.push(`分区 ${form.label} 已创建`, 'ok');
      onChanged?.();
    } catch (err) {
      toast.pushError(err, '创建分区失败');
    } finally {
      setApplying(false);
    }
  }

  const hasErrors = check.errors.length > 0;

  return (
    <div className="view-root">
      <header className="view-head">
        <div>
          <h1>我的分区</h1>
          <p className="view-sub">
            在 Academic Pages 里新增一个集合（例如「项目」「课程」），需要同时修改配置、归档页和导航。
          </p>
        </div>
        <div className="view-head-actions">
          {checking ? (
            <span className="muted inline-spinner">
              <Spinner size={12} /> 校验中…
            </span>
          ) : hasErrors ? (
            <span className="badge badge-danger">{check.errors.length} 个错误</span>
          ) : form.label || form.title ? (
            <span className="badge badge-ok">校验通过</span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handlePreview}
            disabled={previewing || hasErrors}
          >
            {previewing ? <Spinner size={13} /> : <Icon name="eye" size={14} />}
            预览生成文件
          </button>
        </div>
      </header>

      <div className="view-scroll">
        <section className="card">
          <header className="card-head">
            <h2 className="card-title">会改动哪些文件</h2>
          </header>
          <ol className="file-plan">
            {FILE_PLAN.map((item) => (
              <li key={item.title}>
                <span className="file-plan-path mono">{item.path}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="card-hint">
            还会创建目录 <code className="mono">_&lt;label&gt;/</code>（含 <code className="mono">.gitkeep</code>），
            之后可以在文档列表里选择这个类型写条目。
          </p>
        </section>

        <section className="card">
          <header className="card-head">
            <h2 className="card-title">分区设置</h2>
          </header>
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="collection-label">
                集合标识（label） <span className="field-required">*</span>
              </label>
              <input
                id="collection-label"
                className="input mono"
                type="text"
                value={form.label}
                onChange={(event) => setField('label', event.target.value)}
                placeholder="projects"
                spellCheck={false}
              />
              <p className="field-help">
                只能用小写字母、数字、- 和 _，以字母开头；决定目录 <code className="mono">_label/</code>。
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="collection-title">
                标题 <span className="field-required">*</span>
              </label>
              <input
                id="collection-title"
                className="input"
                type="text"
                value={form.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="项目"
              />
              <p className="field-help">用于归档页标题、导航文字和默认文件名。</p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="collection-nav-url">
                归档页 URL
              </label>
              <input
                id="collection-nav-url"
                className="input mono"
                type="text"
                value={form.navUrl}
                onChange={(event) => setField('navUrl', event.target.value)}
                placeholder={form.label ? `/${form.label}/` : '/projects/'}
                spellCheck={false}
              />
              <p className="field-help">
                必须以 <code className="mono">/</code> 开头；留空时自动使用 <code className="mono">/&lt;label&gt;/</code>。
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="collection-layout">
                条目布局（layout）
              </label>
              <select
                id="collection-layout"
                className="input select"
                value={form.layout}
                onChange={(event) => setField('layout', event.target.value)}
              >
                <option value="single">single — 普通内容页</option>
                <option value="talk">talk — 报告/演讲式条目</option>
              </select>
              <p className="field-help">写入 defaults，之后新增条目会自动继承。</p>
            </div>

            <div className="field fm-cell-wide">
              <label className="field-label" htmlFor="collection-permalink">
                条目永久链接（permalink）
              </label>
              <input
                id="collection-permalink"
                className="input mono"
                type="text"
                value={form.permalink}
                onChange={(event) => setField('permalink', event.target.value)}
                spellCheck={false}
              />
              <p className="field-help">
                必须包含 <code className="mono">:collection</code>，默认 <code className="mono">/:collection/:path/</code>。
              </p>
            </div>

            <div className="field fm-cell-wide">
              <label className="field-label" htmlFor="collection-intro">
                归档页简介
              </label>
              <textarea
                id="collection-intro"
                className="input textarea"
                rows={3}
                value={form.intro}
                onChange={(event) => setField('intro', event.target.value)}
                placeholder="显示在归档页顶部的 Markdown 文本，可留空。"
              />
            </div>

            <div className="field fm-cell-wide checkbox-group">
              <label className="checkbox-line" htmlFor="collection-nav">
                <input
                  id="collection-nav"
                  type="checkbox"
                  checked={form.includeNav}
                  onChange={(event) => setField('includeNav', event.target.checked)}
                />
                <span>同步添加导航条目（_data/navigation.yml）</span>
              </label>
              <label className="checkbox-line" htmlFor="collection-share">
                <input
                  id="collection-share"
                  type="checkbox"
                  checked={form.share}
                  onChange={(event) => setField('share', event.target.checked)}
                />
                <span>条目标题下包含分享按钮（share: true）</span>
              </label>
              <label className="checkbox-line" htmlFor="collection-comments">
                <input
                  id="collection-comments"
                  type="checkbox"
                  checked={form.comments}
                  onChange={(event) => setField('comments', event.target.checked)}
                />
                <span>条目包含评论区（comments: true）</span>
              </label>
            </div>
          </div>

          {hasErrors ? (
            <div className="notice notice-danger">
              <Icon name="warn" size={14} />
              <div>
                {check.errors.map((error, index) => (
                  <div key={index}>{error.message}</div>
                ))}
              </div>
            </div>
          ) : null}

          {check.warnings.length ? (
            <div className="notice notice-warn">
              <Icon name="warn" size={14} />
              <div>
                {check.warnings.map((warning, index) => (
                  <div key={index}>{warning.message}</div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {appliedPaths.length ? (
          <section className="card">
            <header className="card-head">
              <h2 className="card-title">
                <Icon name="check" size={15} /> 分区已创建
              </h2>
            </header>
            <ul className="path-list">
              {appliedPaths.map((createdPath) => (
                <li key={createdPath}>
                  <code className="mono">{createdPath}</code>
                </li>
              ))}
            </ul>
            <p className="card-hint">
              重新打开仓库（或刷新文档列表）后，新类型就会出现在「文档」的内容类型里。
            </p>
          </section>
        ) : null}
      </div>

      <footer className="view-foot">
        <span className="muted">创建会直接写入上述文件；请先在预览里确认内容。</span>
        <div className="view-foot-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setForm(INITIAL);
              setAppliedPaths([]);
            }}
          >
            重置表单
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handlePreview}
            disabled={previewing || hasErrors}
          >
            预览生成文件
          </button>
        </div>
      </footer>

      {preview ? (
        <Modal
          title="预览生成文件"
          subtitle={preview.plan?.pagePath ? `将创建 ${preview.plan.pagePath}` : undefined}
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
                创建分区
              </button>
            </>
          }
        >
          {preview.warnings?.length ? (
            <div className="notice notice-warn">
              <Icon name="warn" size={14} />
              <div>
                {preview.warnings.map((warning, index) => (
                  <div key={index}>{warning.message}</div>
                ))}
              </div>
            </div>
          ) : null}
          {preview.files?.length ? (
            preview.files.map((file) => (
              <section className="preview-file" key={file.path}>
                <header className="preview-file-head preview-file-head-static">
                  <Icon name="file" size={14} />
                  <span className="preview-path mono">{file.path}</span>
                  <span className={`badge ${file.action === 'create' ? 'badge-ok' : 'badge-warn'}`}>
                    {file.action === 'create' ? '新建' : '修改'}
                  </span>
                  <span className="preview-counts">
                    <span className="diff-count diff-count-add">+{file.diff?.added ?? 0}</span>
                    <span className="diff-count diff-count-del">−{file.diff?.removed ?? 0}</span>
                  </span>
                </header>
                <div className="preview-file-body">
                  <div className="preview-subhead">完整内容</div>
                  <pre className="file-content mono">{file.after || '（空文件）'}</pre>
                  <div className="preview-subhead">差异</div>
                  <DiffView diff={file.diff} />
                </div>
              </section>
            ))
          ) : (
            <p className="hint">没有需要写入的文件。</p>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
