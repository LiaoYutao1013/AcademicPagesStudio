import { useCallback, useEffect, useState } from 'react';

import EmptyState from './EmptyState.jsx';
import { Icon } from './Icons.jsx';
import { LoadingBlock, Spinner } from './Spinner.jsx';
import TokenCard from './TokenCard.jsx';
import { useToast } from './Toast.jsx';
import { conflictFiles, messageOf, studio } from '../lib/api.js';
import { DEFAULT_COMMIT_MESSAGE, formatDateTime, shortPath } from '../lib/format.js';

const STATUS_LABEL = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '重命名',
  C: '复制',
  U: '冲突',
  '?': '未跟踪',
};

/** Sync & publish screen: token, status, changed files, commit/push, conflicts. */
export default function SyncView({ session, token, onTokenChanged, onGitStatus, onRepoChanged }) {
  const toast = useToast();
  const [status, setStatus] = useState(session?.git ?? null);
  const [log, setLog] = useState([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [message, setMessage] = useState(DEFAULT_COMMIT_MESSAGE);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState('');
  const [conflicts, setConflicts] = useState([]);

  const refresh = useCallback(async () => {
    setStatusLoading(true);
    try {
      const next = await studio().git.status();
      setStatus(next);
      setStatusError(null);
      onGitStatus?.(next);
    } catch (err) {
      setStatusError(err);
    } finally {
      setStatusLoading(false);
    }
    try {
      const commits = await studio().git.log(20);
      setLog(Array.isArray(commits) ? commits : []);
    } catch {
      setLog([]);
    }
  }, [onGitStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let unsubscribe = null;
    try {
      unsubscribe = studio().onGitProgress((payload) => {
        if (payload?.message) setProgress(String(payload.message));
      });
    } catch {
      /* progress is optional */
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {
        /* already gone */
      }
    };
  }, []);

  function collectConflict(err) {
    const files = conflictFiles(err);
    if (files.length) setConflicts(files);
  }

  async function handleCommit() {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.push('请填写提交信息', 'warn');
      return;
    }
    setBusy('commit');
    setProgress('');
    try {
      const result = await studio().git.commit(trimmed);
      if (result?.committed) {
        toast.push(`已提交 ${result.hash ? String(result.hash).slice(0, 7) : ''}`.trim(), 'ok');
      } else {
        toast.push('没有需要提交的更改', 'info');
      }
      await refresh();
    } catch (err) {
      collectConflict(err);
      toast.pushError(err, '提交失败');
    } finally {
      setBusy(null);
      setProgress('');
    }
  }

  async function handleSync() {
    const trimmed = message.trim() || DEFAULT_COMMIT_MESSAGE;
    setBusy('sync');
    setProgress('正在同步…');
    try {
      const result = await studio().git.sync({ message: trimmed, pull: true });
      const parts = [];
      if (result?.committed) parts.push('已提交');
      if (result?.rebased) parts.push('已同步远端');
      if (result?.pushed) parts.push('已推送');
      if (result?.upToDate) parts.push('已是最新');
      toast.push(parts.join('，') || '同步完成', 'ok');
      if (result?.status) {
        setStatus(result.status);
        onGitStatus?.(result.status);
      }
      onRepoChanged?.();
      await refresh();
    } catch (err) {
      collectConflict(err);
      toast.pushError(err, '同步失败');
    } finally {
      setBusy(null);
      setProgress('');
    }
  }

  async function handlePull() {
    setBusy('pull');
    setProgress('正在拉取远端更新…');
    try {
      const result = await studio().git.pull();
      if (result?.rebased) toast.push('已拉取并变基到远端分支', 'ok');
      else if (result?.reason === 'up-to-date') toast.push('已经是最新，无需拉取', 'info');
      else if (result?.reason === 'no-upstream') toast.push('当前分支没有上游分支，无法拉取', 'warn');
      else toast.push('拉取完成', 'ok');
      await refresh();
    } catch (err) {
      collectConflict(err);
      toast.pushError(err, '拉取失败');
    } finally {
      setBusy(null);
      setProgress('');
    }
  }

  const conflictList = conflicts.length ? conflicts : status?.conflicts ?? [];
  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];
  const untracked = status?.untracked ?? [];
  const totalChanges = staged.length + unstaged.length + untracked.length;
  const disabled = busy !== null;

  return (
    <div className="view-root">
      <header className="view-head">
        <div>
          <h1>同步与发布</h1>
          <p className="view-sub">保存到本地之后，在这里预览改动、提交并推送到 GitHub。</p>
        </div>
        <div className="view-head-actions">
          <span className={`chip ${status?.clean ? 'chip-ok' : 'chip-warn'}`}>
            {statusLoading ? '刷新中…' : status ? (status.clean ? '工作区干净' : `${totalChanges} 个改动`) : '状态未知'}
          </span>
          <button type="button" className="btn btn-sm" onClick={refresh} disabled={statusLoading || disabled}>
            {statusLoading ? <Spinner size={13} /> : <Icon name="refresh" size={14} />}
            刷新
          </button>
        </div>
      </header>

      <div className="view-scroll">
        {statusError ? (
          <div className="notice notice-danger">
            <Icon name="warn" size={14} />
            <div>
              <strong>无法读取 Git 状态</strong>
              <div>{messageOf(statusError, 'git status 执行失败')}</div>
              <div className="muted">请确认该目录是 Git 仓库，并且 git 已安装且在 PATH 中。</div>
            </div>
          </div>
        ) : null}

        {conflictList.length ? (
          <section className="card conflict-card">
            <header className="card-head">
              <h2 className="card-title">
                <Icon name="warn" size={15} /> 合并冲突
              </h2>
              <span className="badge badge-danger">{conflictList.length} 个文件</span>
            </header>
            <ul className="path-list">
              {conflictList.map((file) => (
                <li key={file}>
                  <code className="mono">{file}</code>
                </li>
              ))}
            </ul>
            <p className="card-hint">
              自动 rebase 已被中止，工作区不会停留在半合并状态。请在命令行或编辑器里解决这些文件的冲突
              （或先提交/暂存本地修改），然后回到这里重新尝试。
            </p>
            <div className="card-actions">
              <button type="button" className="btn btn-sm" onClick={refresh} disabled={disabled}>
                重新检查状态
              </button>
            </div>
          </section>
        ) : null}

        <section className="card">
          <header className="card-head">
            <h2 className="card-title">仓库状态</h2>
            {status?.remoteUrl ? (
              <span className="mono muted remote-url" title={status.remoteUrl}>
                {shortPath(status.remoteUrl, 48)}
              </span>
            ) : null}
          </header>
          {status ? (
            <dl className="kv kv-grid">
              <div className="kv-row">
                <dt>分支</dt>
                <dd className="mono">{status.branch || '—'}</dd>
              </div>
              <div className="kv-row">
                <dt>上游分支</dt>
                <dd className="mono">{status.upstream || '未设置'}</dd>
              </div>
              <div className="kv-row">
                <dt>领先 / 落后</dt>
                <dd>
                  <span className="badge badge-info">↑{status.ahead ?? 0}</span>{' '}
                  <span className="badge badge-info">↓{status.behind ?? 0}</span>
                </dd>
              </div>
              <div className="kv-row">
                <dt>冲突</dt>
                <dd>{conflictList.length ? `${conflictList.length} 个文件` : '无'}</dd>
              </div>
            </dl>
          ) : statusLoading ? (
            <LoadingBlock label="正在读取仓库状态…" />
          ) : (
            <p className="card-hint">暂时读不到 Git 状态，请先解决上面的问题后点击「刷新」。</p>
          )}
        </section>

        <section className="card">
          <header className="card-head">
            <h2 className="card-title">改动的文件</h2>
            <span className="badge badge-muted">{totalChanges}</span>
          </header>

          {totalChanges === 0 ? (
            <EmptyState
              icon="check"
              title="没有未提交的改动"
              description="在「文档」里保存内容后，这里会显示改动文件。"
            />
          ) : (
            <div className="change-groups">
              <ChangeGroup title="已暂存" entries={staged} tone="ok" />
              <ChangeGroup title="未暂存" entries={unstaged} tone="warn" />
              <ChangeGroup title="未跟踪" entries={untracked} tone="muted" />
            </div>
          )}
        </section>

        <section className="card">
          <header className="card-head">
            <h2 className="card-title">提交</h2>
          </header>
          <div className="field">
            <label className="field-label" htmlFor="commit-message">
              提交信息
            </label>
            <textarea
              id="commit-message"
              className="input textarea"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="card-actions">
            <button type="button" className="btn btn-sm" onClick={handleCommit} disabled={disabled}>
              {busy === 'commit' ? <Spinner size={13} /> : <Icon name="commit" size={14} />}
              仅提交到本地
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSync} disabled={disabled}>
              {busy === 'sync' ? <Spinner size={13} /> : <Icon name="sync" size={14} />}
              提交并推送
            </button>
            <button type="button" className="btn btn-sm" onClick={handlePull} disabled={disabled}>
              {busy === 'pull' ? <Spinner size={13} /> : <Icon name="cloud" size={14} />}
              拉取更新
            </button>
          </div>
          {busy ? (
            <div className="progress-line" role="status">
              <Spinner size={12} />
              <span>{progress || '正在执行…'}</span>
            </div>
          ) : null}
          <p className="card-hint">
            「提交并推送」会先提交本地改动，再 fetch / rebase 到上游，最后推送；遇到冲突会中止 rebase 并列出文件。
          </p>
        </section>

        <TokenCard
          token={token}
          encryptionAvailable={Boolean(token?.encryptionAvailable)}
          onChanged={onTokenChanged}
        />

        <section className="card">
          <header className="card-head">
            <h2 className="card-title">最近的提交</h2>
          </header>
          {log.length ? (
            <ul className="commit-list">
              {log.map((commit) => (
                <li key={commit.hash} className="commit-item">
                  <span className="commit-hash mono">{commit.shortHash}</span>
                  <span className="commit-subject">{commit.subject}</span>
                  <span className="commit-meta muted">
                    {commit.author} · {formatDateTime(commit.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="commit" title="还没有提交记录" description="第一次提交之后会显示在这里。" />
          )}
        </section>
      </div>
    </div>
  );
}

function ChangeGroup({ title, entries, tone }) {
  if (!entries.length) return null;
  return (
    <div className="change-group">
      <h3 className="change-group-title">
        {title} <span className="badge badge-muted">{entries.length}</span>
      </h3>
      <ul className="change-list">
        {entries.map((entry) => (
          <li key={`${title}-${entry.path}`}>
            <code className="mono change-path">{entry.path}</code>
            <span className={`badge badge-${tone}`}>
              {STATUS_LABEL[entry.index] ?? STATUS_LABEL[entry.worktree] ?? '改动'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
