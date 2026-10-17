export function Spinner({ size = 16, className = '' }) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function LoadingBlock({ label = '正在加载…' }) {
  return (
    <div className="loading-block" role="status">
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  );
}

export function LoadingPane({ label = '正在加载…' }) {
  return (
    <div className="pane-loading">
      <LoadingBlock label={label} />
    </div>
  );
}

export default Spinner;
