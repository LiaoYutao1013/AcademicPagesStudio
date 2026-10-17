import { Icon } from './Icons.jsx';

export default function EmptyState({ icon = 'file', title, description, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      {title ? <h3>{title}</h3> : null}
      {description ? <p>{description}</p> : null}
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}
