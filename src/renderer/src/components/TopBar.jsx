import { Icon } from './Icons.jsx';
import { Spinner } from './Spinner.jsx';

/** Repository path + git state chip + the "jump to sync" action. */
export default function TopBar({ root, git, gitError, onSync, onRefresh, refreshing = false }) {
  const chip = gitChip(git, gitError);

  return (
    <header className="topbar">
      <div className="topbar-path" title={root}>
        <Icon name="folder" size={14} />
        <span className="mono">{root ?? '未打开仓库'}</span>
      </div>

      <div className="topbar-actions">
        {chip ? (
          <span className={`chip ${chip.tone}`.trim()} title={chip.title}>
            {chip.label}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新 Git 状态"
          title="刷新 Git 状态"
        >
          {refreshing ? <Spinner size={14} /> : <Icon name="refresh" size={15} />}
        </button>
        <button type="button" className="btn btn-accent btn-sm" onClick={onSync}>
          <Icon name="sync" size={15} />
          同步
        </button>
      </div>
    </header>
  );
}

function gitChip(git, gitError) {
  if (gitError) {
    return {
      tone: 'chip-warn',
      label: 'Git 不可用',
      title: gitError.message || '当前仓库无法使用 git 命令',
    };
  }
  if (!git) return { tone: 'chip-muted', label: 'Git 状态未知', title: '无法读取 git 状态' };
  if (Array.isArray(git.conflicts) && git.conflicts.length) {
    return { tone: 'chip-danger', label: `冲突 ${git.conflicts.length}`, title: '存在合并冲突' };
  }
  const parts = [];
  if (git.ahead) parts.push(`↑${git.ahead}`);
  if (git.behind) parts.push(`↓${git.behind}`);
  if (git.clean === false) {
    return {
      tone: 'chip-warn',
      label: parts.length ? `未提交 · ${parts.join(' ')}` : '有未提交的更改',
      title: '工作区有未提交的更改',
    };
  }
  if (parts.length) {
    return { tone: 'chip-info', label: `已同步 · ${parts.join(' ')}`, title: '与远端存在差异' };
  }
  if (git.hasCommits === false) {
    return { tone: 'chip-muted', label: '尚无提交', title: '这个仓库还没有任何提交' };
  }
  return { tone: 'chip-ok', label: '工作区干净', title: '没有未提交的更改' };
}
