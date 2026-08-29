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
