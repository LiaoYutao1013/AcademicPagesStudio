import { Icon } from './Icons.jsx';

/**
 * One Front Matter field, rendered from a `FieldSpec`.
 *
 * `list` values are edited as comma separated text (the caller keeps them as a
 * string and converts on save); `boolean` is a checkbox; everything else is a
 * normal input/select/textarea.
 */
export default function FieldRow({
  field,
  value,
  onChange,
  disabled = false,
  error,
  warning,
  idPrefix = 'field',
}) {
  const inputId = `${idPrefix}-${String(field.key).replace(/[^a-zA-Z0-9]+/g, '-')}`;
  const helpId = field.help || field.type === 'list' ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  const shared = {
    id: inputId,
    disabled,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
  };

  let control = null;
  if (field.type === 'textarea') {
    control = (
      <textarea
        {...shared}
        className="input textarea"
        rows={3}
        placeholder={field.placeholder}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (field.type === 'boolean') {
    control = (
      <label className="checkbox-line" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  } else if (field.type === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    const current = String(value ?? '');
    const hasCurrent = options.some((option) => option.value === current);
    control = (
      <select
        {...shared}
        className="input select"
        value={current}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">（未设置）</option>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
        {current && !hasCurrent ? <option value={current}>{current}（当前值）</option> : null}
      </select>
    );
  } else if (field.type === 'list') {
    control = (
      <input
        {...shared}
        type="text"
        className="input"
        placeholder={field.placeholder ?? '用英文逗号分隔，例如：论文, 笔记'}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    );
  } else {
    // `type="date"` only accepts `YYYY-MM-DD`; anything else (a hand-written
    // `date: May 2025`) falls back to a text input so the value is not lost.
    const raw = String(value ?? '');
    const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const inputType = field.type === 'date' ? (raw === '' || isoDate ? 'date' : 'text') : 'text';
    control = (
      <input
        {...shared}
        type={inputType}
        className={`input ${field.type === 'url' || field.type === 'date' ? 'mono' : ''}`.trim()}
        placeholder={field.placeholder}
        value={raw}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    );
  }

  return (
    <div className={`field ${error ? 'field-invalid' : ''}`.trim()}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={inputId}>
          {field.label}
          {field.required ? <span className="field-required" title="必填">*</span> : null}
        </label>
        <span className="field-key mono">{field.key}</span>
      </div>
      {control}
      {field.type === 'boolean' ? null : field.type === 'list' ? (
        <p className="field-help" id={helpId}>
          {field.help ? `${field.help} · ` : ''}多个值用英文逗号分隔，保存为 YAML 列表
        </p>
      ) : field.help ? (
        <p className="field-help" id={helpId}>
          {field.help}
        </p>
      ) : null}
      {warning ? (
        <p className="field-warning">
          <Icon name="warn" size={12} /> {warning}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
