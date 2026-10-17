import EmptyState from './EmptyState.jsx';

const SIGN = { add: '+', del: '−', context: ' ' };

/**
 * Line diff renderer for the `FilePreview.diff` shape produced in the main
 * process: `{ hunks: [{ header, lines }], added, removed, changed }`.
 */
export default function DiffView({ diff, emptyText = '没有差异' }) {
  if (!diff || !Array.isArray(diff.hunks) || diff.hunks.length === 0) {
    return (
      <EmptyState
        icon="check"
        title={diff && diff.changed === false ? emptyText : '没有差异'}
        description="该文件的内容与磁盘一致。"
      />
    );
  }

  return (
    <div className="diff">
      <div className="diff-summary">
        <span className="diff-count diff-count-add">+{diff.added ?? 0}</span>
        <span className="diff-count diff-count-del">−{diff.removed ?? 0}</span>
        <span className="diff-hunk-count">{diff.hunks.length} 个差异块</span>
      </div>
      <div className="diff-body">
        {diff.hunks.map((hunk, hunkIndex) => (
          <div className="diff-hunk" key={`${hunk.header}-${hunkIndex}`}>
            <div className="diff-hunk-head mono">{hunk.header}</div>
            {(hunk.lines ?? []).map((line, lineIndex) => (
              <div
                className={`diff-line diff-line-${line.type}`}
                key={`${hunkIndex}-${lineIndex}`}
              >
                <span className="diff-sign mono">{SIGN[line.type] ?? ' '}</span>
                <span className="diff-text mono">{line.text === '' ? ' ' : line.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
