import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Command,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

import { api } from "../../api";
import { useAdminSession, usePermissions } from "../../lib/admin-session";
import { Button, IconButton, cn } from "../../ui";
import { CommandMenu } from "./CommandMenu";
import {
  DEFAULT_QUICK_ACCESS,
  NAV_ITEMS,
  NAV_SECTIONS,
  getNavItem,
  getSection,
  visibleNavItems,
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

const ROLE_LABELS: Record<string, string> = {
  owner: "Суперпользователь",
  network_manager: "Управляющий сетью",
  delivery_operator: "Оператор доставки",
  marketing: "Маркетинг",
  courier: "Доставщик",
  restaurant: "Ресторан",
};

function roleLabel(role?: string | null): string {
  const normalized = role?.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return "Сотрудник";

  return ROLE_LABELS[normalized] ?? role ?? "Сотрудник";
}

function refreshTimeLabel(date: Date | null): string {
  if (!date) return "данные актуальны";

  return `обновлено ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

export function AdminLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { staff, logout } = useAdminSession();
  const { can } = usePermissions();
  const activeItem = getNavItem(pathname);
  const [activeSection, setActiveSection] = useState<AdminSection>(activeItem.section);
  const [collapsed, setCollapsed] = useStoredBoolean(COLLAPSED_KEY, false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [theme, setTheme] = useThemeMode();

  // В меню нужен только счётчик активных: строки не забираем вовсе
  const orders = useQuery({
    queryKey: ["orders", "nav-count"],
    queryFn: () => api.orders({ group: "active", search: "", limit: 1, offset: 0 }),
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
      orders.data?.counts.active ?? 0;
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
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCollapsed]);

  // Разделы, куда сотруднику вообще можно: скрытый пункт — не защита,
  // сервер всё равно проверит право, но нет смысла показывать то, что не откроется
  const allowedItems = visibleNavItems(can);
  const sectionItemsOf = (key: AdminSection) =>
    allowedItems.filter((item) => item.section === key);
  const allowedSections = NAV_SECTIONS.filter((item) => sectionItemsOf(item.key).length > 0);

  const quickAccess = useMemo(
    () =>
      getStoredQuickAccess()
        .map((path) => allowedItems.find((item) => item.path === path))
        .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item)),
    [allowedItems],
  );

  const section = getSection(activeSection);
  const sectionItems = sectionItemsOf(activeSection);
  const activeSectionCount = sectionItems.reduce((sum, item) => sum + (counts[item.path] ?? 0), 0);

  const navigateTo = (path: AdminPath) => {
    void navigate({ to: path });
  };

  const refreshAll = () => {
    setRefreshing(true);
    void queryClient.invalidateQueries().finally(() => {
      setLastRefreshAt(new Date());
      setRefreshing(false);
    });
  };

  const staffInitials =
    staff?.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru-RU"))
      .join("") || "А";

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <div className="admin-app app-shell" data-mobile-menu-open={mobileMenuOpen} data-nav-collapsed={collapsed}>
      <aside className="rail" aria-label="Разделы админки">
        <nav className="rail-nav">
          {allowedSections.map((item) => {
            const Icon = item.icon;
            const sectionHasProblems = sectionItemsOf(item.key).some((navItem) => (counts[navItem.path] ?? 0) > 0);
            const firstPath = sectionItemsOf(item.key)[0]?.path ?? "/orders";

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
                <span className="rail-button-label">{item.label}</span>
                {sectionHasProblems ? <span className="rail-dot" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="rail-spacer" />

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
                  <span className="nav-item-copy">
                    <span className="nav-item-label">{item.label}</span>
                    <span className="nav-item-description">{item.description}</span>
                  </span>
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
                      <span className="nav-item-copy">
                        <span className="nav-item-label">{item.label}</span>
                      </span>
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
                <span className="user-role">{roleLabel(staff?.role)}</span>
              </span>
            </button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <IconButton
            className="mobile-only mobile-nav-trigger"
            label="Открыть навигацию"
            size="sm"
            variant="ghost"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={16} aria-hidden />
          </IconButton>

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
            <p className="workspace-description">{activeItem.description}</p>
          </div>

          <div className="workspace-actions">
            <button className="command-button hide-mobile" type="button" onClick={() => setCommandOpen(true)}>
              <Search size={15} aria-hidden />
              <span>Поиск по админке</span>
              <kbd className="kbd">
                <Command size={11} aria-hidden />K
              </kbd>
            </button>
            <Button
              className="refresh-data-button"
              disabled={refreshing}
              size="sm"
              variant="ghost"
              title="Перезагрузить данные во всех открытых разделах"
              onClick={refreshAll}
            >
              <RefreshCw className={cn(refreshing && "spin")} size={15} aria-hidden />
              <span className="refresh-label">{refreshing ? "Обновляем..." : "Обновить данные"}</span>
            </Button>
            <span className="refresh-note hide-mobile">{refreshTimeLabel(lastRefreshAt)}</span>
          </div>
        </header>

        <main className="workspace-body">
          <Outlet />
        </main>
      </section>

      {mobileMenuOpen ? (
        <>
          <button
            aria-label="Закрыть навигацию"
            className="mobile-nav-scrim"
            type="button"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="mobile-nav-sheet" aria-label="Навигация админки">
            <header className="mobile-nav-head">
              <div className="min-w-0">
                <span className="mobile-nav-eyebrow">Навигация</span>
                <h2>{activeItem.label}</h2>
                <p>{activeItem.description}</p>
              </div>
              <IconButton label="Закрыть навигацию" size="sm" variant="ghost" onClick={() => setMobileMenuOpen(false)}>
                <X size={16} aria-hidden />
              </IconButton>
            </header>

            <div className="mobile-section-strip" aria-label="Группы разделов">
              {allowedSections.map((item) => {
                const Icon = item.icon;
                const sectionHasProblems = sectionItemsOf(item.key).some((navItem) => (counts[navItem.path] ?? 0) > 0);

                return (
                  <button
                    key={item.key}
                    className="mobile-section-button"
                    data-active={activeSection === item.key}
                    type="button"
                    onClick={() => setActiveSection(item.key)}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{item.label}</span>
                    {sectionHasProblems ? <span className="mobile-section-dot" /> : null}
                  </button>
                );
              })}
            </div>

            <div className="mobile-nav-current">
              <div className="mobile-nav-section-title">
                <span>{section.label}</span>
                {activeSectionCount > 0 ? <strong>{activeSectionCount}</strong> : null}
              </div>
              <nav className="mobile-nav-list">
                {sectionItems.map((item) => {
                  const Icon = item.icon;
                  const count = counts[item.path] ?? 0;

                  return (
                    <button
                      key={item.path}
                      className="mobile-nav-item"
                      data-active={activeItem.path === item.path}
                      type="button"
                      onClick={() => navigateTo(item.path)}
                    >
                      <Icon size={17} aria-hidden />
                      <span className="mobile-nav-item-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                      {count > 0 ? <span className="nav-count">{count}</span> : null}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="mobile-user-card">
              <span className="user-avatar">{staffInitials}</span>
              <span className="mobile-user-copy">
                <span>{staff?.name ?? "Сотрудник"}</span>
                <small>{roleLabel(staff?.role)}</small>
              </span>
              <IconButton
                label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                size="sm"
                variant="ghost"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
              </IconButton>
              <IconButton label="Выйти" size="sm" variant="ghost" onClick={logout}>
                <LogOut size={15} aria-hidden />
              </IconButton>
            </div>

            <div className="mobile-nav-actions">
              <button className="mobile-action" type="button" onClick={() => setCommandOpen(true)}>
                <Search size={16} aria-hidden />
                <span>Поиск по админке</span>
                <kbd className="kbd">
                  <Command size={11} aria-hidden />K
                </kbd>
              </button>
              <button className="mobile-action" type="button" disabled={refreshing} onClick={refreshAll}>
                <RefreshCw className={cn(refreshing && "spin")} size={16} aria-hidden />
                <span>{refreshing ? "Обновляем данные" : "Обновить данные"}</span>
                <small>{refreshTimeLabel(lastRefreshAt)}</small>
              </button>
            </div>
          </aside>
        </>
      ) : null}

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
