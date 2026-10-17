import { useEffect, useState } from 'react';

import { Icon } from './Icons.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { Spinner } from './Spinner.jsx';
import { useToast } from './Toast.jsx';
import { studio } from '../lib/api.js';

const STORAGE_LABEL = {
  safeStorage: '系统加密保存（safeStorage）',
  memory: '仅本次运行（内存，未写入磁盘）',
  none: '未设置',
};

/**
 * GitHub token panel shared by the welcome screen and the sync view.
 * The token itself is never read back — only status and storage location.
 */
export default function TokenCard({
  token,
  encryptionAvailable = false,
  onChanged,
  title = 'GitHub Token',
  hint = '推送与拉取使用 Personal Access Token（需要 repo 权限）。Token 只保存在本机。',
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [username, setUsername] = useState(token?.username ?? '');
  const [pending, setPending] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setUsername(token?.username ?? '');
  }, [token?.username]);

  const hasToken = Boolean(token?.hasToken);
  const storage = token?.storage ?? 'none';
  const memoryOnly = storage === 'memory' || (!encryptionAvailable && hasToken);

  async function handleSave() {
    if (!value.trim()) {
      toast.push('请先粘贴 Token', 'warn');
      return;
    }
    setPending('save');
    try {
      const result = await studio().secrets.set(value.trim(), username.trim());
      setValue('');
      toast.push(
        result?.storage === 'memory'
          ? 'Token 已保存在内存中，退出应用后失效'
          : 'Token 已加密保存到本机',
        result?.storage === 'memory' ? 'warn' : 'ok',
      );
      onChanged?.();
    } catch (err) {
      toast.pushError(err, '保存 Token 失败');
    } finally {
      setPending(null);
    }
  }

  async function handleClear() {
    setPending('clear');
    try {
      await studio().secrets.clear();
      setValue('');
      setConfirmClear(false);
      toast.push('Token 已清除', 'ok');
      onChanged?.();
    } catch (err) {
      toast.pushError(err, '清除 Token 失败');
    } finally {
      setPending(null);
    }
  }

  async function openTokenPage() {
    try {
      await studio().app.openExternal('https://github.com/settings/tokens');
    } catch (err) {
      toast.pushError(err, '无法打开浏览器');
    }
  }

  return (
    <section className="card token-card">
      <header className="card-head">
        <h2 className="card-title">
          <Icon name="key" size={15} /> {title}
        </h2>
        <span className={`badge ${hasToken ? 'badge-ok' : 'badge-muted'}`}>
          {hasToken ? '已设置' : '未设置'}
        </span>
      </header>

      <p className="card-hint">{hint}</p>

      <dl className="kv">
        <div className="kv-row">
          <dt>状态</dt>
          <dd>{hasToken ? STORAGE_LABEL[storage] ?? storage : '未设置'}</dd>
        </div>
        {token?.username ? (
          <div className="kv-row">
            <dt>GitHub 用户名</dt>
            <dd className="mono">{token.username}</dd>
          </div>
        ) : null}
      </dl>

      {!encryptionAvailable ? (
        <p className="notice notice-warn">
          <Icon name="warn" size={14} />
          当前系统不可用加密存储，Token 只会保留在内存中，关闭应用后需要重新输入。
        </p>
      ) : memoryOnly ? (
        <p className="notice notice-warn">
          <Icon name="warn" size={14} />
          Token 目前只存在于内存中，退出应用后会失效。
        </p>
      ) : null}

      <div className="token-form">
        <div className="field">
          <label className="field-label" htmlFor="token-input">
            Token
          </label>
          <input
            id="token-input"
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="token-username">
            GitHub 用户名 <span className="field-optional">可选</span>
          </label>
          <input
            id="token-username"
            className="input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="octocat"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
      </div>

      <div className="card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={pending !== null}
        >
          {pending === 'save' ? <Spinner size={13} /> : null}
          保存 Token
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirmClear(true)}
          disabled={pending !== null || !hasToken}
        >
          清除
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openTokenPage}>
          <Icon name="external" size={13} />
          生成 Token
        </button>
      </div>

      {confirmClear ? (
        <ConfirmDialog
          title="清除已保存的 Token？"
          message="清除后无法再推送或拉取，直到重新填写 Token。"
          confirmText="清除 Token"
          danger
          pending={pending === 'clear'}
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleClear}
        />
      ) : null}
    </section>
  );
}
