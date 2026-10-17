import Modal from './Modal.jsx';
import { Spinner } from './Spinner.jsx';

/**
 * Two-button confirmation. `pending` disables both buttons so a slow IPC call
 * cannot be triggered twice or dismissed halfway through.
 */
export default function ConfirmDialog({
  title,
  message,
  children,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!pending) onCancel?.();
      }}
      closeOnBackdrop={!pending}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={pending}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? <Spinner size={13} /> : null}
            {confirmText}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        {message ? <p className="confirm-message">{message}</p> : null}
        {children}
      </div>
    </Modal>
  );
}
