import { createContext, useContext } from "react";

import type { Staff } from "../api";

type AdminSession = {
  staff: Staff | null;
  logout: () => void;
};

const AdminSessionContext = createContext<AdminSession | null>(null);

export const AdminSessionProvider = AdminSessionContext.Provider;

export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (!session) {
    throw new Error("AdminSessionProvider не подключён");
  }
  return session;
}

/**
 * Права текущего сотрудника.
 *
 * Ответ на вопрос «можно ли» приходит с сервера готовым списком — здесь мы
 * его только читаем. Скрытый раздел не защита: доступ всё равно проверяется
 * на бэкенде, а это лишь способ не показывать кнопки, которые не сработают.
 */
export function usePermissions() {
  const { staff } = useAdminSession();
  const granted = staff?.permissions ?? [];

  return {
    can: (permission: string) => granted.includes(permission),
    canAny: (...permissions: string[]) => permissions.some((item) => granted.includes(item)),
    isOwner: staff?.role === "owner",
  };
}
