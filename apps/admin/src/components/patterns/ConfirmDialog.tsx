import { AlertTriangle } from "lucide-react";

import { Button } from "../../ui";

export function ConfirmDialog({
  busy = false,
  confirmLabel = "Удалить",
  message,
  onCancel,
  onConfirm,
  title,
}: {
  busy?: boolean;
  confirmLabel?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <>
      <div className="command-overlay" onClick={onCancel} />
      <section aria-modal="true" className="confirm-dialog" role="dialog">
        <div className="confirm-body">
          <AlertTriangle color="var(--bad)" size={20} aria-hidden />
          <h2 className="confirm-title">{title}</h2>
          <p className="confirm-copy">{message}</p>
        </div>
        <div className="drawer-foot">
          <Button disabled={busy} variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={busy} variant="destructive" onClick={onConfirm}>
            {busy ? "Удаляем..." : confirmLabel}
          </Button>
        </div>
      </section>
    </>
  );
}
