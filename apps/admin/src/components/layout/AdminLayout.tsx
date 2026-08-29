import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Command,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

import logoUrl from "../../../../../packages/tenants/assets/mamaroma/logo.png";
import { api, tenant } from "../../api";
import { useAdminSession } from "../../lib/admin-session";
import { Button, IconButton, cn } from "../../ui";
import { CommandMenu } from "./CommandMenu";
import {
  DEFAULT_QUICK_ACCESS,
  NAV_ITEMS,
  NAV_SECTIONS,
  getNavItem,
  getSection,
  getSectionItems,
  type AdminPath,
  type AdminSection,
} from "./navigation";

const COLLAPSED_KEY = "mr.admin.nav-collapsed";
const QUICK_ACCESS_KEY = "mr.admin.quick-access";
const THEME_KEY = "mr.admin.theme";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === "true" || initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function useThemeMode() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

function getStoredQuickAccess(): AdminPath[] {
  try {
    const raw = localStorage.getItem(QUICK_ACCESS_KEY);
    if (!raw) return DEFAULT_QUICK_ACCESS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_QUICK_ACCESS;
    return parsed
      .filter((item): item is AdminPath => NAV_ITEMS.some((nav) => nav.path === item))
      .slice(0, 3);
  } catch {
    return DEFAULT_QUICK_ACCESS;
  }
}

export function AdminLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { staff, logout } = useAdminSession();
  const activeItem = getNavItem(pathname);
  const [activeSection, setActiveSection] = useState<AdminSection>(activeItem.section);
  const [collapsed, setCollapsed] = useStoredBoolean(COLLAPSED_KEY, false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [theme, setTheme] = useThemeMode();

  const orders = useQuery({
    queryKey: ["orders", "nav-count"],
    queryFn: api.orders,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const reservations = useQuery({
    queryKey: ["reservations", "nav-count"],
    queryFn: () => api.reservations(true),
    refetchInterval: 45_000,
    staleTime: 15_000,
  });

  const counts = useMemo((): Partial<Record<AdminPath, number>> => {
    const activeOrders =
      orders.data?.filter((order) => !["completed", "cancelled"].includes(order.status)).length ?? 0;
    const waitingReservations =
      reservations.data?.filter((reservation) => reservation.status === "requested").length ?? 0;

    return {
      "/orders": activeOrders,
      "/reservations": waitingReservations,
    };
  }, [orders.data, reservations.data]);

  useEffect(() => {
    setActiveSection(activeItem.section);
  }, [activeItem.section]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }

      if (event.key === "[") {
        event.preventDefault();
        setCollapsed((value) => !value);
      }

      if (event.key === "Escape") {
        setCommandOpen(false);
        setUserOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCollapsed]);

  const quickAccess = useMemo(
    () =>
      getStoredQuickAccess()
        .map((path) => NAV_ITEMS.find((item) => item.path === path))
        .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item)),
    [],
  );

  const section = getSection(activeSection);
  const sectionItems = getSectionItems(activeSection);

  const navigateTo = (path: AdminPath) => {
    void navigate({ to: path });
  };

  const staffInitials =
    staff?.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru-RU"))
      .join("") || "MR";

  return (
    <div className="admin-app app-shell" data-nav-collapsed={collapsed}>
      <aside className="rail" aria-label="Разделы админки">
        <div className="brand-mark" title={tenant.branding.displayName}>
          <img alt="" src={logoUrl} />
        </div>

        <nav className="rail-nav">
          {NAV_SECTIONS.map((item) => {
            const Icon = item.icon;
            const sectionHasProblems = getSectionItems(item.key).some((navItem) => (counts[navItem.path] ?? 0) > 0);
            const firstPath = getSectionItems(item.key)[0]?.path ?? "/orders";

            return (
              <button
                key={item.key}
                aria-label={item.label}
                className="rail-button"
                data-active={activeSection === item.key}
                title={item.label}
                type="button"
                onClick={() => {
                  setActiveSection(item.key);
                  navigateTo(firstPath);
                }}
              >
                <Icon size={18} aria-hidden />
                {sectionHasProblems ? <span className="rail-dot" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="rail-spacer" />

        <IconButton label="Поиск" size="sm" variant="quiet" onClick={() => setCommandOpen(true)}>
          <Search size={16} aria-hidden />
        </IconButton>
        <IconButton
          className="hide-mobile"
          label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          size="sm"
          variant="quiet"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
        </IconButton>
      </aside>

      <aside className="nav-panel" aria-label="Навигация раздела">
        <div className="nav-panel-inner">
          <div className="nav-panel-head">
            <h2 className="nav-title">{section.label}</h2>
            <span className="nav-subtitle">{section.subtitle}</span>
          </div>

          <nav className="nav-list">
            {sectionItems.map((item) => {
              const Icon = item.icon;
              const count = counts[item.path] ?? 0;

              return (
                <button
                  key={item.path}
                  className="nav-item"
                  data-active={activeItem.path === item.path}
                  type="button"
                  onClick={() => navigateTo(item.path)}
                >
                  <Icon size={16} aria-hidden />
                  <span className="nav-item-label">{item.label}</span>
                  {count > 0 ? <span className="nav-count">{count}</span> : null}
                </button>
              );
            })}
          </nav>

          {quickAccess.length > 0 ? (
            <>
              <div className="nav-divider" />
              <div className="nav-panel-head">
                <h2 className="nav-title">Быстрый доступ</h2>
                <span className="nav-subtitle">закреплённые разделы</span>
              </div>
              <nav className="nav-list">
                {quickAccess.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.path}
                      className="nav-item"
                      data-active={activeItem.path === item.path}
                      type="button"
                      onClick={() => navigateTo(item.path)}
                    >
                      <Icon size={16} aria-hidden />
                      <span className="nav-item-label">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </>
          ) : null}

          <div className="nav-footer">
            <button className="user-menu-button" type="button" onClick={() => setUserOpen(true)}>
              <span className="user-avatar">{staffInitials}</span>
              <span className="min-w-0">
                <span className="user-name">{staff?.name ?? "Сотрудник"}</span>
                <span className="user-role">{staff?.role ?? "администратор"}</span>
              </span>
            </button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <IconButton
            className="hide-mobile"
            label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </IconButton>

          <div className="workspace-title-block">
            <div className="workspace-kicker">{section.label}</div>
            <h1 className="workspace-title">{activeItem.label}</h1>
          </div>

          <div className="workspace-actions">
            <button className="command-button hide-mobile" type="button" onClick={() => setCommandOpen(true)}>
              <Search size={15} aria-hidden />
              <span>Поиск</span>
              <kbd className="kbd">
                <Command size={11} aria-hidden />K
              </kbd>
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void queryClient.invalidateQueries();
              }}
            >
              <RefreshCw size={15} aria-hidden />
              Обновить
            </Button>
          </div>
        </header>

        <main className="workspace-body">
          <Outlet />
        </main>
      </section>

      {userOpen ? (
        <>
          <button
            aria-label="Закрыть меню пользователя"
            className="user-popover-layer"
            type="button"
            onClick={() => setUserOpen(false)}
          />
          <div className="user-popover">
            <button
              className="popover-item"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
              {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            </button>
            <button className="popover-item" type="button" onClick={logout}>
              <LogOut size={15} aria-hidden />
              Выйти
            </button>
          </div>
        </>
      ) : null}

      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigateTo} />
      <Toaster richColors={false} position="bottom-right" />
    </div>
  );
}
