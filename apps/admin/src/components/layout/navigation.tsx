import {
  BellRing,
  CalendarDays,
  ChefHat,
  ClipboardList,
  DatabaseZap,
  Gift,
  GitBranch,
  Map,
  Megaphone,
  MessageSquareText,
  MonitorCog,
  Network,
  ReceiptText,
  RefreshCw,
  Settings2,
  Store,
  TicketPercent,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminSection = "operations" | "menu" | "marketing" | "network" | "system";

export type AdminPath =
  | "/orders"
  | "/reservations"
  | "/feedback"
  | "/menu"
  | "/extras"
  | "/promos"
  | "/promo-codes"
  | "/notifications"
  | "/guests"
  | "/restaurants"
  | "/zones"
  | "/iiko"
  | "/sync";

export type NavItem = {
  path: AdminPath;
  label: string;
  section: AdminSection;
  icon: LucideIcon;
  description: string;
};

export const NAV_SECTIONS: {
  key: AdminSection;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}[] = [
  { key: "operations", label: "Операции", subtitle: "смена и живой поток", icon: ClipboardList },
  { key: "menu", label: "Меню", subtitle: "ассортимент и наличие", icon: ChefHat },
  { key: "marketing", label: "Маркетинг", subtitle: "акции, гости, пуши", icon: Megaphone },
  { key: "network", label: "Сеть", subtitle: "рестораны и доставка", icon: Network },
  { key: "system", label: "Система", subtitle: "касса и обновление", icon: MonitorCog },
];

export const NAV_ITEMS: NavItem[] = [
  {
    path: "/orders",
    label: "Заказы",
    section: "operations",
    icon: ReceiptText,
    description: "Смена на доске, история — во вкладках",
  },
  {
    path: "/reservations",
    label: "Брони",
    section: "operations",
    icon: CalendarDays,
    description: "Сегодняшние бронирования и подтверждения",
  },
  {
    path: "/feedback",
    label: "Отзывы",
    section: "operations",
    icon: MessageSquareText,
    description: "Оценки гостей и быстрый ответ",
  },
  {
    path: "/menu",
    label: "Блюда и меню",
    section: "menu",
    icon: ChefHat,
    description: "Категории, блюда, фото, цены и стоп-лист",
  },
  {
    path: "/extras",
    label: "Добавки",
    section: "menu",
    icon: GitBranch,
    description: "Группы добавок и привязка к категориям",
  },
  {
    path: "/promos",
    label: "Акции",
    section: "marketing",
    icon: Gift,
    description: "Витрина акций и порядок показа",
  },
  {
    path: "/promo-codes",
    label: "Промокоды",
    section: "marketing",
    icon: TicketPercent,
    description: "Коды, лимиты и сроки действия",
  },
  {
    path: "/notifications",
    label: "Уведомления",
    section: "marketing",
    icon: BellRing,
    description: "Правила, кампании и автоматизации",
  },
  {
    path: "/guests",
    label: "Гости",
    section: "marketing",
    icon: Users,
    description: "Поиск, профиль, баллы и история",
  },
  {
    path: "/restaurants",
    label: "Рестораны",
    section: "network",
    icon: Store,
    description: "Адреса, часы, доставка и паузы",
  },
  {
    path: "/zones",
    label: "Зоны доставки",
    section: "network",
    icon: Map,
    description: "Карта зон, минималки и время доставки",
  },
  {
    path: "/iiko",
    label: "Касса iiko",
    section: "system",
    icon: DatabaseZap,
    description: "Связь с Front, сопоставление и очередь",
  },
  {
    path: "/sync",
    label: "Обновление",
    section: "system",
    icon: RefreshCw,
    description: "Синхронизация меню, ресторанов и акций",
  },
];

export const DEFAULT_QUICK_ACCESS: AdminPath[] = ["/iiko", "/sync", "/zones"];

export const settingsIcon = Settings2;

export function getNavItem(pathname: string): NavItem {
  return NAV_ITEMS.find((item) => item.path === pathname) ?? NAV_ITEMS[0];
}

export function getSection(section: AdminSection) {
  return NAV_SECTIONS.find((item) => item.key === section) ?? NAV_SECTIONS[0];
}

export function getSectionItems(section: AdminSection): NavItem[] {
  return NAV_ITEMS.filter((item) => item.section === section);
}
