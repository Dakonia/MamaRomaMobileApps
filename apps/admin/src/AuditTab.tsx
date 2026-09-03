import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, formatDateTime, type AuditEntry, type Staff } from "./api";
import {
  DataTable,
  createAdminColumnHelper,
  useTableDensity,
} from "./components/patterns/DataTable";
import { Badge, Button, Section } from "./ui";

const column = createAdminColumnHelper<AuditEntry>();

const PAGE = 50;

/** Разделы админки по-русски: в базе они лежат кусками пути. */
const SECTIONS: Record<string, string> = {
  orders: "Заказы",
  reservations: "Брони",
  guests: "Гости",
  menu: "Меню",
  categories: "Меню",
  dishes: "Меню",
  extras: "Добавки",
  "stop-list": "Стоп-лист",
  promotions: "Акции",
  "promo-codes": "Промокоды",
  campaigns: "Рассылки",
  notifications: "Уведомления",
  automations: "Сценарии",
  restaurants: "Рестораны",
  zones: "Зоны доставки",
  iiko: "Касса",
  sync: "Обновление",
  staff: "Сотрудники",
  uploads: "Файлы",
};

const METHOD_TONE: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  POST: "ok",
  PUT: "warn",
  PATCH: "warn",
  DELETE: "bad",
};

function sectionTitle(section: string): string {
  return SECTIONS[section] ?? section;
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
  const [density] = useTableDensity();
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

  const people = useMemo(
    () => (staff.data ?? []).map((row: Staff) => ({ id: row.id, name: row.name })),
    [staff.data],
  );

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("created_at", {
          header: "Когда",
          sortFn: "datetime",
          cell: (info) => <span className="row-sub">{formatDateTime(info.getValue())}</span>,
        }),
        column.accessor("staff_name", {
          header: "Кто",
          cell: (info) => <div className="row-main">{info.getValue()}</div>,
        }),
        column.accessor("title", {
          header: "Что сделал",
          cell: (info) => (
            <div>
              <div className="row-main">{info.getValue()}</div>
              {info.row.original.summary ? (
                <div className="row-sub">{info.row.original.summary}</div>
              ) : null}
            </div>
          ),
        }),
        column.accessor("section", {
          header: "Раздел",
          cell: (info) => <span className="row-sub">{sectionTitle(info.getValue())}</span>,
        }),
        column.accessor("method", {
          header: "Тип",
          cell: (info) => (
            <Badge text={info.getValue()} tone={METHOD_TONE[info.getValue()] ?? "muted"} />
          ),
        }),
      ]),
    [],
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
          <select
            className="input"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            <option value="">Все</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field toolbar-field">
          <span className="field-label">Раздел</span>
          <select
            className="input"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          >
            <option value="">Все</option>
            {(log.data?.sections ?? []).map((item) => (
              <option key={item} value={item}>
                {sectionTitle(item)}
              </option>
            ))}
          </select>
        </label>

        <span className="toolbar-spacer" />
        <span className="toolbar-note">
          {total > 0 ? `${shown} из ${total}` : "записей пока нет"}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        density={density}
        empty={
          <div className="empty-state">
            <h2>Записей нет</h2>
            <p>
              Здесь появится всё, что сотрудники меняют в админке: заказы, баллы, меню, доступы.
            </p>
          </div>
        }
        getRowId={(row) => row.id}
        isLoading={log.isPending}
      />

      {total > PAGE ? (
        <div className="surface-toolbar">
          <Button disabled={page === 0} variant="ghost" onClick={() => setPage(page - 1)}>
            Назад
          </Button>
          <span className="toolbar-spacer" />
          <Button disabled={shown >= total} variant="ghost" onClick={() => setPage(page + 1)}>
            Дальше
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
