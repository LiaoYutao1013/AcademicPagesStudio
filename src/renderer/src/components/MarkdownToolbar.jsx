import { Icon } from './Icons.jsx';

const ACTIONS = [
  { id: 'bold', label: '加粗', icon: 'bold' },
  { id: 'italic', label: '斜体', icon: 'italic' },
  { id: 'code', label: '行内代码', icon: 'code' },
  { id: 'codeblock', label: '代码块', icon: 'codeblock' },
  { id: 'link', label: '链接', icon: 'link' },
  { id: 'image', label: '图片', icon: 'image' },
  { id: 'quote', label: '引用', icon: 'quote' },
  { id: 'ul', label: '无序列表', icon: 'list' },
  { id: 'ol', label: '有序列表', icon: 'ordered' },
];

const DIVIDER_AFTER = new Set(['italic', 'image']);

export default function MarkdownToolbar({ onAction, disabled = false }) {
  return (
    <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      {ACTIONS.map((action) => (
        <span className="md-toolbar-group" key={action.id}>
          <button
            type="button"
            className="md-btn"
            title={action.label}
            aria-label={action.label}
            disabled={disabled}
            onClick={() => onAction(action.id)}
          >
            <Icon name={action.icon} size={15} />
          </button>
          {DIVIDER_AFTER.has(action.id) ? <span className="md-toolbar-sep" aria-hidden="true" /> : null}
        </span>
      ))}
      <span className="md-toolbar-hint">可将图片拖入编辑器，或直接粘贴截图</span>
    </div>
  );
}
