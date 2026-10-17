import { Icon } from './Icons.jsx';
import DocList from './DocList.jsx';

const NAV_ITEMS = [
  { id: 'docs', label: '文档', icon: 'docs' },
  { id: 'profile', label: '个人资料', icon: 'user' },
  { id: 'nav', label: '导航栏', icon: 'nav' },
  { id: 'collections', label: '我的分区', icon: 'layers' },
  { id: 'sync', label: '同步与发布', icon: 'sync' },
];

export default function Sidebar({
  session,
  view,
  onView,
  types,
  typeId,
  onTypeChange,
  docs,
  docsLoading,
  query,
  onQueryChange,
  activePath,
  onSelectDoc,
  onCreateDoc,
  git,
}) {
  const hasChanges = Boolean(git && !git.clean);

  return (
    <aside className="sidebar" aria-label="侧边栏">
      <div className="repo-card">
        <div className="repo-card-top">
          <span className="repo-icon" aria-hidden="true">
            <Icon name="cloud" size={15} />
          </span>
          <div className="repo-card-text">
            <div className="repo-name" title={session?.root}>
              {session?.name ?? '未打开仓库'}
            </div>
            <div className="repo-branch mono">
              <Icon name="branch" size={12} />
              <span>{git?.branch ?? '—'}</span>
              {git?.upstream ? <span className="repo-upstream">{git.upstream}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-btn ${view === item.id ? 'nav-btn-active' : ''}`.trim()}
            onClick={() => onView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} size={16} />
            <span className="nav-btn-label">{item.label}</span>
            {item.id === 'sync' && hasChanges ? (
              <span className="nav-dot" title="有未提交的更改" aria-label="有未提交的更改" />
            ) : null}
          </button>
        ))}
      </nav>

      {view === 'docs' ? (
        <div className="sidebar-docs">
          <div className="sidebar-docs-head">
            <label className="sr-only" htmlFor="content-type-select">
              内容类型
            </label>
            <select
              id="content-type-select"
              className="input select sidebar-type-select"
              value={typeId}
              onChange={(event) => onTypeChange(event.target.value)}
            >
              {(types ?? []).map((type) => (
                <option value={type.id} key={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCreateDoc}>
              <Icon name="plus" size={14} />
              新建
            </button>
          </div>

          <div className="search-box">
            <Icon name="search" size={14} className="search-icon" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索标题、标签…"
              aria-label="搜索文档"
            />
            {query ? (
              <button
                type="button"
                className="search-clear"
                aria-label="清除搜索"
                onClick={() => onQueryChange('')}
              >
                ×
              </button>
            ) : null}
          </div>

          <DocList
            docs={docs}
            query={query}
            activePath={activePath}
            loading={docsLoading}
            onSelect={onSelectDoc}
          />
        </div>
      ) : (
        <div className="sidebar-note">
          <p>当前视图不使用文档列表。</p>
          <p className="muted">切换到「文档」可以浏览和编辑内容。</p>
        </div>
      )}

      <div className="sidebar-foot">
        <span className="muted">Academic Pages Studio</span>
        <span className="muted mono">本地优先</span>
      </div>
    </aside>
  );
}
