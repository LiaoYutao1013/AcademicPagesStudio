import { useState } from 'react';

import DiffView from './DiffView.jsx';
import { Icon } from './Icons.jsx';

const ACTION_LABEL = { create: '新建', update: '修改' };

/**
 * List of `FilePreview` objects with collapsible diffs.
 *
 * `showContent` additionally prints the full resulting file — used by the
 * collection wizard, where the point is reviewing generated source.
 */
export default function FilePreviewList({ files, showContent = false }) {
  if (!files || files.length === 0) {
    return <p className="hint">没有文件变更。</p>;
  }
  return (
    <div className="preview-files">
      {files.map((file) => (
        <FileCard file={file} showContent={showContent} key={file.path} />
      ))}
    </div>
  );
}

function FileCard({ file, showContent }) {
  const [open, setOpen] = useState(true);
  const added = file.diff?.added ?? 0;
  const removed = file.diff?.removed ?? 0;

  return (
    <section className="preview-file">
      <button
        type="button"
        className="preview-file-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        <span className="preview-path mono">{file.path}</span>
        <span className={`badge ${file.action === 'create' ? 'badge-ok' : 'badge-warn'}`}>
          {ACTION_LABEL[file.action] ?? file.action}
        </span>
        <span className="preview-counts">
          <span className="diff-count diff-count-add">+{added}</span>
          <span className="diff-count diff-count-del">−{removed}</span>
        </span>
      </button>
      {open ? (
        <div className="preview-file-body">
          {showContent ? (
            <>
              <div className="preview-subhead">完整内容</div>
              <pre className="file-content mono">{file.after || '（空文件）'}</pre>
              <div className="preview-subhead">差异</div>
            </>
          ) : null}
          <DiffView diff={file.diff} />
        </div>
      ) : null}
    </section>
  );
}
