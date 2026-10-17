import EmptyState from './EmptyState.jsx';
import { Icon } from './Icons.jsx';
import TokenCard from './TokenCard.jsx';
import { Spinner } from './Spinner.jsx';

const PITCH = [
  { icon: 'cloud', title: '本地优先', text: '所有内容直接写入你的博客仓库，不经过任何服务器。' },
  { icon: 'layers', title: 'YAML 注释保全', text: '修改 _config.yml 时只动需要动的行，注释和顺序原样保留。' },
  { icon: 'sync', title: '一键同步', text: '先预览差异，再提交并推送到 GitHub，冲突会明确告诉你是哪几个文件。' },
];

/** First-run screen: pick a repository, set a token, reopen a recent repo. */
export default function WelcomeView({
  initInfo,
  token,
  encryptionAvailable,
  opening,
  onChoose,
  onOpen,
  onTokenChanged,
}) {
  const recent = Array.isArray(initInfo?.recentRepos) ? initInfo.recentRepos : [];
  const gitAvailable = initInfo?.gitAvailable !== false;

  return (
    <div className="welcome">
      <div className="welcome-main">
        <div className="welcome-hero">
          <div className="welcome-mark" aria-hidden="true">
            <Icon name="edit" size={22} />
          </div>
          <h1 className="welcome-title">Academic Pages Studio</h1>
          <p className="welcome-pitch">
            为 Academic Pages（Jekyll）博客准备的本地 Markdown 编辑器：编辑、保存、预览差异、提交、推送，
            全程只在你自己的机器上完成。
          </p>
          <ul className="welcome-points">
            {PITCH.map((point) => (
              <li key={point.title}>
                <span className="welcome-point-icon">
                  <Icon name={point.icon} size={15} />
                </span>
                <div>
                  <strong>{point.title}</strong>
                  <p>{point.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="welcome-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onChoose} disabled={opening}>
              {opening ? <Spinner size={14} /> : <Icon name="folder" size={16} />}
              选择仓库
            </button>
            <span className="hint">
              文件夹必须包含 <code className="mono">_config.yml</code>（Academic Pages 模板仓库根目录）。
            </span>
          </div>

          {!gitAvailable ? (
            <p className="notice notice-warn">
              <Icon name="warn" size={14} />
              未检测到 git 命令，编辑和保存仍可用，但无法提交或推送。
            </p>
          ) : null}
        </div>

        <section className="welcome-recent">
          <h2 className="welcome-section-title">最近打开</h2>
          {recent.length ? (
            <ul className="recent-list">
              {recent.map((repoPath) => (
                <li key={repoPath}>
                  <button type="button" className="recent-item" onClick={() => onOpen(repoPath)} disabled={opening}>
                    <Icon name="folder" size={14} />
                    <span className="recent-path mono">{repoPath}</span>
                    <Icon name="chevronRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="folder" title="还没有打开过仓库" description="点击「选择仓库」开始。" />
          )}
        </section>
      </div>

      <aside className="welcome-side">
        <TokenCard
          token={token}
          encryptionAvailable={encryptionAvailable}
          onChanged={onTokenChanged}
          hint="推送 / 拉取使用 GitHub Personal Access Token（repo 权限）。Token 加密保存在本机，不会写入仓库。"
        />
        <p className="welcome-note">
          <Icon name="info" size={13} />
          应用不会自动提交或推送：所有 git 操作都需要你在「同步与发布」里确认。
        </p>
      </aside>
    </div>
  );
}
