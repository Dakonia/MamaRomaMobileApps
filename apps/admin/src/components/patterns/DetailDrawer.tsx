import { X } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton, cn } from "../../ui";

export function DetailDrawer({
  badge,
  children,
  className,
  footer,
  onClose,
  subtitle,
  title,
}: {
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  onClose: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className={cn("detail-drawer", className)} aria-label={typeof title === "string" ? title : "Детали"}>
        <div className="drawer-head">
          <div className="min-w-0">
            <h2 className="drawer-title">{title}</h2>
            {subtitle ? <div className="row-sub">{subtitle}</div> : null}
            {badge ? <div className="mt-2">{badge}</div> : null}
          </div>
          <span className="toolbar-spacer" />
          <IconButton label="Закрыть панель" size="sm" variant="quiet" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}
