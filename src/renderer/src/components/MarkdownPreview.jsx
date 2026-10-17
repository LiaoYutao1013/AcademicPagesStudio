import { useMemo } from 'react';

import { renderMarkdown } from '../lib/markdown.js';

/** Sanitised live preview of the Markdown body. */
export default function MarkdownPreview({ source, emptyHint = '正文为空，左侧输入后会实时预览。' }) {
  const text = String(source ?? '');
  const html = useMemo(() => renderMarkdown(text), [text]);

  if (!text.trim()) {
    return <div className="md-preview-empty">{emptyHint}</div>;
  }

  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
