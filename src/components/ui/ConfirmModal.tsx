import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

interface Props {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'secondary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirmar',
  variant = 'danger',
  onConfirm,
  onCancel,
}: Props) {
  // z-index maior (70) para ficar acima de modais comuns (50)
  return (
    <Modal open onClose={onCancel} size="md" zIndex={70}>
      <div className="px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" variant={variant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
