/**
 * Markdown → sanitised HTML.
 *
 * `marked` does the parsing, DOMPurify removes anything active. The result is
 * injected with `dangerouslySetInnerHTML`, so this module is the single place
 * where sanitising happens — never bypass it from a component.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false,
  async: false,
});

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick'],
};

/**
 * @param {string} source
 * @returns {string} safe HTML
 */
export function renderMarkdown(source) {
  const text = String(source ?? '');
  if (!text.trim()) return '';
  // DOMPurify needs a DOM. It always has one in the renderer, but if it is
  // somehow unavailable we degrade to escaped plain text rather than injecting
  // unsanitised HTML or crashing the editor.
  if (typeof DOMPurify?.sanitize !== 'function') {
    return `<pre class="md-raw mono">${escapeHtml(text)}</pre>`;
  }
  let html;
  try {
    html = marked.parse(text);
  } catch (err) {
    return `<p class="md-error">Markdown 渲染失败：${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
  }
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
