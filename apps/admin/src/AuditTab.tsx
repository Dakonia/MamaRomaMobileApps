import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CalendarDays,
  ChefHat,
  DatabaseZap,
  FileUp,
  Gift,
  GitBranch,
  Map as MapIcon,
  Megaphone,
  MessageSquareText,
  ReceiptText,
  RefreshCw,
  Search,
  Store,
  TicketPercent,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type AuditEntry, type Staff } from "./api";
import { formatTime } from "./lib/format";
import { Button, Section, Select } from "./ui";

const PAGE = 60;

/** Раздел админки: как называется по-русски и какой иконкой узнаётся. */
const SECTIONS: Record<string, { title: string; icon: LucideIcon }> = {
  orders: { title: "Заказы", icon: ReceiptText },
  reservations: { title: "Брони", icon: CalendarDays },
  feedback: { title: "Отзывы", icon: MessageSquareText },
  categories: { title: "Меню", icon: ChefHat },
  dishes: { title: "Меню", icon: ChefHat },
  menu: { title: "Меню", icon: ChefHat },
  "stop-list": { title: "Стоп-лист", icon: ChefHat },
  extras: { title: "Добавки", icon: GitBranch },
  promotions: { title: "Акции", icon: Gift },
  "promo-codes": { title: "Промокоды", icon: TicketPercent },
  campaigns: { title: "Рассылки", icon: Megaphone },
  notifications: { title: "Уведомления", icon: BellRing },
  automations: { title: "Сценарии", icon: BellRing },
  guests: { title: "Гости", icon: Users },
  restaurants: { title: "Рестораны", icon: Store },
  zones: { title: "Зоны доставки", icon: MapIcon },
  iiko: { title: "Касса", icon: DatabaseZap },
  sync: { title: "Обновление", icon: RefreshCw },
  staff: { title: "Сотрудники", icon: UserCog },
  uploads: { title: "Файлы", icon: FileUp },
};

/** Что за действие: создание, правка или удаление — по нему цвет отметки. */
const KIND: Record<string, { tone: "new" | "edit" | "gone"; label: string }> = {
  POST: { tone: "new", label: "создание" },
  PUT: { tone: "edit", label: "замена" },
  PATCH: { tone: "edit", label: "правка" },
  DELETE: { tone: "gone", label: "удаление" },
};

/**
 * Ручки названы командами — «Сменить статус заказа». В журнале это уже
 * случилось, поэтому читаем как событие: «Смена статуса заказа».
 */
const EVENT_TITLES: Record<string, string> = {
  "Сменить статус заказа": "Смена статуса заказа",
  "Сменить статус брони": "Смена статуса брони",
  "Изменить состав заказа": "Правка состава заказа",
  "Начислить или списать баллы": "Начисление или списание баллов",
  "Завести гостя": "Новый гость",
  "Изменить гостя": "Правка профиля гостя",
  "Удалить гостя": "Удаление гостя",
  "Создать категорию": "Новая категория",
  "Изменить категорию": "Правка категории",
  "Удалить категорию": "Удаление категории",
  "Создать блюдо": "Новое блюдо",
  "Изменить блюдо": "Правка блюда",
  "Удалить блюдо": "Удаление блюда",
  "Поставить в стоп-лист": "Блюдо в стоп-лист",
  "Убрать из стоп-листа": "Блюдо снято со стопа",
  "Изменить меню ресторана": "Правка меню ресторана",
  "Создать добавку": "Новая добавка",
  "Изменить добавку": "Правка добавки",
  "Удалить добавку": "Удаление добавки",
  "Разделы, где предлагается добавка": "Разделы для добавки",
  "Блюда, где предлагается добавка": "Блюда для добавки",
  "Создать акцию": "Новая акция",
  "Изменить акцию": "Правка акции",
  "Удалить акцию": "Удаление акции",
  "Создать промокод": "Новый промокод",
  "Изменить промокод": "Правка промокода",
  "Удалить промокод": "Удаление промокода",
  "Создать рассылку": "Новая рассылка",
  "Изменить рассылку": "Правка рассылки",
  "Удалить рассылку": "Удаление рассылки",
  "Копия рассылки": "Копия рассылки",
  "Отправить рассылку сейчас": "Отправка рассылки",
  "Изменить правило шага": "Правка текста уведомления",
  "Изменить тихие часы": "Правка тихих часов",
  "Изменить сценарий": "Правка сценария",
  "Создать ресторан": "Новый ресторан",
  "Изменить ресторан": "Правка ресторана",
  "Удалить ресторан": "Удаление ресторана",
  "Добавить зону": "Новая зона доставки",
  "Изменить зону": "Правка зоны доставки",
  "Удалить зону": "Удаление зоны доставки",
  "Сверить раздел с сайтом": "Сверка с сайтом",
  "Записать выбранные изменения": "Запись изменений с сайта",
  "Убрать изменение из списка": "Изменение отклонено",
  "Выдать или сменить ключ плагина": "Ключ плагина кассы",
  "Включить или выключить плагин точки": "Плагин точки включён или выключен",
  "Сохранить сопоставление": "Правка связей с кассой",
  "Сопоставить по названиям": "Автосопоставление с кассой",
  "Сохранить дерево номенклатуры": "Правка номенклатуры кассы",
  "Перенести сопоставление на другую точку": "Перенос связей на другую точку",
  "Отдать заказ на кассу заново": "Повтор отправки на кассу",
  "Загрузить фотографию": "Загрузка фотографии",
  "Завести сотрудника": "Новый сотрудник",
  "Изменить сотрудника": "Правка доступа сотрудника",
  "Удалить сотрудника": "Удаление сотрудника",
};

function eventTitle(title: string): string {
  return EVENT_TITLES[title] ?? title;
}

function sectionMeta(section: string) {
  return SECTIONS[section] ?? { title: section, icon: ReceiptText };
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru-RU"))
      .join("") || "?"
  );
}

/** Заголовок группы: сегодняшние и вчерашние события так и подписываем. */
function dayTitle(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const same = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  if (same(date, today)) return "Сегодня";
  if (same(date, yesterday)) return "Вчера";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(date);
}

function useDebounced(value: string, delayMs = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

export function AuditTab() {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [staffId, setStaffId] = useState("");
  const [page, setPage] = useState(0);

  const debounced = useDebounced(search);

  useEffect(() => {
    setPage(0);
  }, [debounced, section, staffId]);

  const staff = useQuery({ queryKey: ["staff"], queryFn: api.staff });

  const log = useQuery({
    queryKey: ["audit", debounced, section, staffId, page],
    queryFn: () =>
      api.audit({
        search: debounced,
        section: section || undefined,
        staff_id: staffId || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const shown = page * PAGE + rows.length;
  const filtered = Boolean(debounced || section || staffId);

  // События идут по дням: так видно смену, а не сплошной поток строк
  const days = useMemo(() => {
    const grouped = new Map<string, AuditEntry[]>();
    for (const row of rows) {
      const key = new Date(row.created_at).toDateString();
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    return [...grouped.values()];
  }, [rows]);

  const staffOptions = useMemo(
    () => [
      { value: "", label: "Все сотрудники" },
      ...(staff.data ?? []).map((row: Staff) => ({ value: row.id, label: row.name })),
    ],
    [staff.data],
  );

  const sectionOptions = useMemo(
    () => [
      { value: "", label: "Все разделы" },
      ...(log.data?.sections ?? []).map((item) => ({
        value: item,
        label: sectionMeta(item).title,
      })),
    ],
    [log.data?.sections],
  );

  return (
    <Section
      title="Журнал действий"
      description="Кто из сотрудников что менял. Записи хранятся 90 дней"
    >
      <div className="surface-toolbar">
        <label className="field toolbar-field">
          <span className="field-label">Поиск</span>
          <span className="search-control">
            <Search className="search-icon" size={15} aria-hidden />
            <input
              className="input"
              placeholder="Действие, сотрудник, подробность"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>

        <label className="field toolbar-field">
          <span className="field-label">Сотрудник</span>
          <Select options={staffOptions} value={staffId} onChange={setStaffId} />
        </label>

        <label className="field toolbar-field">
          <span className="field-label">Раздел</span>
          <Select options={sectionOptions} value={section} onChange={setSection} />
        </label>

        <span className="toolbar-spacer" />
        <span className="toolbar-note">
          {total > 0 ? `${shown} из ${total}` : "записей пока нет"}
        </span>
      </div>

      {log.isPending ? <p className="section-copy">Загружаем…</p> : null}

      {!log.isPending && rows.length === 0 ? (
        <div className="empty-state">
          <h2>{filtered ? "Ничего не нашлось" : "Записей пока нет"}</h2>
          <p>
            {filtered
              ? "Попробуйте снять фильтр или изменить запрос."
              : "Здесь появится всё, что сотрудники меняют: заказы, баллы, меню, доступы."}
          </p>
        </div>
      ) : null}

      <div className="audit-feed">
        {days.map((entries) => (
          <section key={entries[0].id} className="audit-day">
            <div className="audit-day-head">
              <h3>{dayTitle(entries[0].created_at)}</h3>
              <span>{entries.length}</span>
            </div>

            <ol className="audit-list">
              {entries.map((entry) => {
                const meta = sectionMeta(entry.section);
                const kind = KIND[entry.method] ?? { tone: "edit" as const, label: "правка" };
                const Icon = meta.icon;
                // Списание баллов — это минус у гостя, зелёным его показывать нельзя
                const tone = entry.summary?.startsWith("Списал") ? "gone" : kind.tone;

                return (
                  <li key={entry.id} className="audit-item" data-tone={tone}>
                    <span className="audit-mark" title={kind.label}>
                      <Icon size={14} aria-hidden />
                    </span>

                    <div className="audit-body">
                      <div className="audit-line">
                        <strong>{eventTitle(entry.title)}</strong>
                        <span className="audit-section">{meta.title}</span>
                      </div>

                      {entry.summary ? <p className="audit-summary">{entry.summary}</p> : null}

                      <div className="audit-meta">
                        <span className="audit-avatar" aria-hidden>
                          {initials(entry.staff_name)}
                        </span>
                        <span className="audit-who">{entry.staff_name}</span>
                        <span className="audit-dot" aria-hidden />
                        <time dateTime={entry.created_at}>{formatTime(entry.created_at)}</time>
                        {entry.ip ? (
                          <>
                            <span className="audit-dot" aria-hidden />
                            <span className="audit-ip">{entry.ip}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {total > PAGE ? (
        <div className="surface-toolbar">
          <Button disabled={page === 0} variant="ghost" onClick={() => setPage(page - 1)}>
            Новее
          </Button>
          <span className="toolbar-spacer" />
          <Button disabled={shown >= total} variant="ghost" onClick={() => setPage(page + 1)}>
            Раньше
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
