import { useMemo } from 'react';

import EmptyState from './EmptyState.jsx';
import { LoadingBlock } from './Spinner.jsx';

function matches(doc, query) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [doc.title, doc.slug, doc.path, doc.date, ...(doc.categories ?? []), ...(doc.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Document list for the sidebar: drafts first, each row shows date + title. */
export default function DocList({ docs, query, activePath, loading, onSelect }) {
  const filtered = useMemo(() => (docs ?? []).filter((doc) => matches(doc, query)), [docs, query]);
  const drafts = useMemo(() => filtered.filter((doc) => doc.draft), [filtered]);
  const published = useMemo(() => filtered.filter((doc) => !doc.draft), [filtered]);

  if (loading) {
    return (
      <div className="doc-list-state">
        <LoadingBlock label="正在读取文档…" />
      </div>
    );
  }

  if (!filtered.length) {
    return (
      <div className="doc-list-state">
        <EmptyState
          icon="docs"
          title={query ? '没有匹配的文档' : '这个类型还没有文档'}
          description={query ? '试试别的关键词，或清空搜索。' : '点击上方「新建」开始写第一篇。'}
        />
      </div>
    );
  }

  return (
    <div className="doc-list">
      {drafts.length ? (
        <section className="doc-group">
          <h3 className="doc-group-title">
            草稿 <span className="doc-group-count">{drafts.length}</span>
          </h3>
          {drafts.map((doc) => (
            <DocItem key={doc.path} doc={doc} active={doc.path === activePath} onSelect={onSelect} />
          ))}
        </section>
      ) : null}
      {published.length ? (
        <section className="doc-group">
          <h3 className="doc-group-title">
            {drafts.length ? '已发布' : '文档'} <span className="doc-group-count">{published.length}</span>
          </h3>
          {published.map((doc) => (
            <DocItem key={doc.path} doc={doc} active={doc.path === activePath} onSelect={onSelect} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function DocItem({ doc, active, onSelect }) {
  return (
    <button
      type="button"
      className={`doc-item ${active ? 'doc-item-active' : ''}`.trim()}
      onClick={() => onSelect(doc.path)}
      title={doc.path}
      aria-current={active ? 'true' : undefined}
    >
      <span className="doc-item-title">{doc.title || '（无标题）'}</span>
      <span className="doc-item-meta">
        <span className="mono doc-item-date">{doc.date || '无日期'}</span>
        {doc.draft ? <span className="badge badge-draft">草稿</span> : null}
        {doc.frontMatterError ? (
          <span className="badge badge-danger" title="Front Matter 解析失败">
            YAML
          </span>
        ) : null}
      </span>
    </button>
  );
}
