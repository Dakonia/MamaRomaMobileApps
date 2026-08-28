import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { radius, spacing, typography } from "@mr/design-tokens";
import { useEffect, useMemo, useState } from "react";

import {
  api,
  formatDateTime,
  formatPrice,
  type IikoLink,
  type IikoProduct,
} from "./api";
import { Badge, Button, c, Section, styles } from "./ui";

type Pane = "bridges" | "links" | "queue";

/** Сколько прошло с последней связи: точнее, чем дата, и читается быстрее. */
function sinceLabel(iso: string | null): string {
  if (!iso) return "не выходил на связь";

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "на связи";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ч назад`;
  return `${Math.floor(minutes / 1440)} дн назад`;
}

/** Плагин считается живым, если выходил на связь последние десять минут. */
function isOnline(iso: string | null): boolean {
  return iso !== null && Date.now() - new Date(iso).getTime() < 10 * 60 * 1000;
}

function Bridges({ onOpenLinks }: { onOpenLinks: (restaurantId: string) => void }) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<{ name: string; secret: string } | null>(null);

  const bridges = useQuery({
    queryKey: ["iiko-bridges"],
    queryFn: api.bridges,
    // Терминал отмечается при каждом запросе — обновляем, чтобы видеть живых
    refetchInterval: 30000,
  });

  const issue = useMutation({
    mutationFn: (row: { id: string; name: string }) =>
      api.bridgeSecret(row.id).then((result) => ({ name: row.name, secret: result.secret })),
    onSuccess: (result) => {
      setShown(result);
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.toggleBridge(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] }),
  });

  return (
    <Section title="Плагины по ресторанам">
      {shown ? (
        <div
          style={{
            padding: spacing.base,
            borderRadius: radius.lg,
            background: c.warningSubtle,
            border: `1px solid ${c.warning}`,
            marginBottom: spacing.base,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>
            Ключ для «{shown.name}» — скопируйте сейчас, второй раз он не покажется
          </div>
          <code
            style={{
              display: "block",
              padding: spacing.sm,
              background: c.surface,
              borderRadius: radius.sm,
              wordBreak: "break-all",
              fontSize: typography.caption.fontSize,
            }}
          >
            {shown.secret}
          </code>
          <div style={{ marginTop: spacing.sm, color: c.textSecondary, fontSize: typography.caption.fontSize }}>
            Впишите его в <code>bridge.settings.json</code> в поле <code>mamaroma.secret</code>,
            а идентификатор ресторана — в <code>mamaroma.restaurantId</code>.
          </div>
          <div style={{ marginTop: spacing.sm }}>
            <Button tone="quiet" onClick={() => setShown(null)}>
              Скрыть
            </Button>
          </div>
        </div>
      ) : null}

      {bridges.isPending ? (
        <p style={{ color: c.textSecondary }}>Загружаем…</p>
      ) : (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Ресторан</th>
                <th style={styles.th}>Связь</th>
                <th style={styles.th}>Сопоставлено</th>
                <th style={styles.th}>Очередь</th>
                <th style={styles.th}>Идентификатор</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {(bridges.data ?? []).map((row) => (
                <tr key={row.restaurant_id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600 }}>{row.restaurant_name}</div>
                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      {row.terminal_name ?? "терминал не назвался"}
                      {row.plugin_version ? ` · версия ${row.plugin_version}` : ""}
                    </div>
                  </td>

                  <td style={styles.td}>
                    {!row.is_registered ? (
                      <Badge text="нет ключа" tone="muted" />
                    ) : !row.is_active ? (
                      <Badge text="выключен" tone="muted" />
                    ) : isOnline(row.last_seen_at) ? (
                      <Badge text="на связи" tone="ok" />
                    ) : (
                      <Badge text="молчит" tone="warn" />
                    )}
                    <div style={{ marginTop: 4, color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      {sinceLabel(row.last_seen_at)}
                    </div>
                  </td>

                  <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>
                    {row.linked_dishes} блюд · {row.linked_extras} добавок
                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      в кассе {row.products} товаров
                    </div>
                  </td>

                  <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>
                    {row.pending_orders > 0 ? `${row.pending_orders} ждут` : "пусто"}
                    {row.failed_orders > 0 ? (
                      <div style={{ color: c.danger }}>{row.failed_orders} с ошибкой</div>
                    ) : null}
                  </td>

                  <td style={{ ...styles.td, fontSize: typography.caption.fontSize, color: c.textSecondary }}>
                    <code style={{ wordBreak: "break-all" }}>{row.restaurant_id}</code>
                  </td>

                  <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: spacing.xs, justifyContent: "flex-end" }}>
                      <Button tone="quiet" onClick={() => onOpenLinks(row.restaurant_id)}>
                        Сопоставить
                      </Button>
                      <Button
                        tone="brand"
                        onClick={() =>
                          issue.mutate({ id: row.restaurant_id, name: row.restaurant_name })
                        }
                      >
                        {row.is_registered ? "Новый ключ" : "Выдать ключ"}
                      </Button>
                      {row.is_registered ? (
                        <Button
                          tone={row.is_active ? "danger" : "quiet"}
                          onClick={() =>
                            toggle.mutate({ id: row.restaurant_id, active: !row.is_active })
                          }
                        >
                          {row.is_active ? "Выключить" : "Включить"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Окно поиска товара кассы: ищет сервер, в браузер список целиком не влезает. */
function ProductPicker({
  restaurantId,
  groups,
  title,
  onPick,
  onClose,
}: {
  restaurantId: string;
  groups: string[];
  title: string;
  onPick: (product: IikoProduct) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(title);
  const [typed, setTyped] = useState(title);

  // Пока печатают, сервер не дёргаем
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const found = useQuery({
    queryKey: ["iiko-search", restaurantId, query, groups],
    queryFn: () => api.searchIikoProducts(restaurantId, query, groups),
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,17,16,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: c.surface,
          borderRadius: radius.lg,
          border: `1px solid ${c.border}`,
          overflow: "hidden",
        }}
      >
        <div style={{ padding: spacing.base, borderBottom: `1px solid ${c.divider}` }}>
          <div style={{ fontWeight: 600, marginBottom: spacing.sm }}>{title}</div>
          <input
            autoFocus
            style={{ ...styles.input, width: "100%" }}
            placeholder="Название товара в кассе"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div style={{ marginTop: 6, color: c.textTertiary, fontSize: typography.caption.fontSize }}>
            {groups.length > 0
              ? `Ищем в выбранных группах (${groups.length})`
              : "Ищем по всей номенклатуре — выберите группы, чтобы сузить"}
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          {found.isPending ? (
            <p style={{ padding: spacing.base, color: c.textSecondary }}>Ищем…</p>
          ) : (found.data ?? []).length === 0 ? (
            <p style={{ padding: spacing.base, color: c.textSecondary }}>Ничего не нашлось</p>
          ) : (
            (found.data ?? []).map((product) => {
              const groupLabel = product.group_path ?? product.group_name;

              return (
                <button
                  key={product.product_id}
                  type="button"
                  onClick={() => onPick(product)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: `${spacing.sm}px ${spacing.base}px`,
                    border: "none",
                    borderBottom: `1px solid ${c.divider}`,
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: typography.body.fontSize,
                    color: c.textPrimary,
                  }}
                >
                  {product.name}
                  <span style={{ color: c.textTertiary }}>
                    {groupLabel ? ` · ${groupLabel}` : ""}
                    {product.code ? ` · ${product.code}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

type DraftPick = {
  id: string;
  name: string;
  code?: string | null;
  groupPath?: string | null;
  productType?: string | null;
};

type MatchFilter = "unmatched" | "matched" | "all";
type LinkKindFilter = "all" | "dish" | "extra";

function Links({
  restaurantId,
  onRestaurantChange,
}: {
  restaurantId: string;
  onRestaurantChange: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("unmatched");
  const [kindFilter, setKindFilter] = useState<LinkKindFilter>("dish");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [draft, setDraft] = useState<Record<string, DraftPick>>({});
  const [picking, setPicking] = useState<IikoLink | null>(null);

  const bridges = useQuery({
    queryKey: ["iiko-bridges"],
    queryFn: api.bridges,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (restaurantId !== "" || !bridges.data || bridges.data.length === 0) return;
    const preferred =
      bridges.data.find((row) => row.is_registered && row.products > 0)?.restaurant_id ??
      bridges.data[0].restaurant_id;
    onRestaurantChange(preferred);
  }, [bridges.data, onRestaurantChange, restaurantId]);

  const currentBridge = useMemo(
    () => (bridges.data ?? []).find((row) => row.restaurant_id === restaurantId) ?? null,
    [bridges.data, restaurantId],
  );

  const [groups, setGroups] = useState<string[]>([]);
  const storageKey = `iiko-group-paths-${restaurantId}`;

  useEffect(() => {
    if (restaurantId === "") {
      setGroups([]);
      return;
    }

    try {
      const saved = localStorage.getItem(storageKey);
      setGroups(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setGroups([]);
    }
    setDraft({});
    setCategoryFilter("all");
    setSearch("");
  }, [restaurantId, storageKey]);

  const saveGroups = (next: string[]) => {
    const unique = [...new Set(next)].filter(Boolean);
    setGroups(unique);
    localStorage.setItem(storageKey, JSON.stringify(unique));
  };

  const pickGroup = (path: string) => {
    setGroups((current) => {
      const next = current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const allGroups = useQuery({
    queryKey: ["iiko-groups", restaurantId],
    queryFn: () => api.iikoGroups(restaurantId),
    enabled: restaurantId !== "",
  });

  const presetGroups = useMemo(
    () => (allGroups.data ?? []).filter((group) => group.is_preset).map((group) => group.path),
    [allGroups.data],
  );

  useEffect(() => {
    if (restaurantId === "" || groups.length > 0 || presetGroups.length === 0) return;
    if (localStorage.getItem(storageKey)) return;
    saveGroups(presetGroups);
  }, [groups.length, presetGroups, restaurantId, storageKey]);

  const links = useQuery({
    queryKey: ["iiko-links", restaurantId, groups],
    queryFn: () => api.iikoLinks(restaurantId, groups),
    enabled: restaurantId !== "",
  });

  const keyOf = (row: IikoLink) => `${row.kind}:${row.id}`;
  const selectedProductId = (row: IikoLink) => {
    const drafted = draft[keyOf(row)];
    return drafted ? drafted.id : row.product_id ?? "";
  };
  const isRowLinked = (row: IikoLink) => selectedProductId(row) !== "";

  const save = useMutation({
    mutationFn: () =>
      api.saveIikoLinks(
        restaurantId,
        Object.entries(draft).map(([key, value]) => {
          const [kind, id] = key.split(":");
          return { kind, id, product_id: value.id };
        }),
      ),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ["iiko-links", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
    },
  });

  const auto = useMutation({
    mutationFn: () => api.autoMatchIiko(restaurantId, groups),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["iiko-links", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
    },
  });

  const allRows = links.data ?? [];

  const categoryStats = useMemo(() => {
    const byCategory = new Map<string, { name: string; total: number; linked: number; dishes: number; extras: number }>();

    for (const row of allRows) {
      const name = row.group ?? "Без категории";
      const current = byCategory.get(name) ?? {
        name,
        total: 0,
        linked: 0,
        dishes: 0,
        extras: 0,
      };
      current.total += 1;
      if (isRowLinked(row)) current.linked += 1;
      if (row.kind === "dish") current.dishes += 1;
      if (row.kind === "extra") current.extras += 1;
      byCategory.set(name, current);
    }

    return [...byCategory.values()];
  }, [allRows, draft]);

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!categoryStats.some((item) => item.name === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, categoryStats]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      const linked = isRowLinked(row);
      if (matchFilter === "unmatched" && linked) return false;
      if (matchFilter === "matched" && !linked) return false;
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (categoryFilter !== "all" && (row.group ?? "Без категории") !== categoryFilter) {
        return false;
      }
      if (needle === "") return true;
      const haystack = [
        row.name,
        row.group ?? "",
        row.product_name ?? "",
        row.product_code ?? "",
        row.product_group_path ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [allRows, categoryFilter, draft, kindFilter, matchFilter, search]);

  const total = allRows.length;
  const linked = allRows.filter(isRowLinked).length;
  const unlinked = total - linked;
  const changed = Object.keys(draft).length;
  const dishTotal = allRows.filter((row) => row.kind === "dish").length;
  const dishLinked = allRows.filter((row) => row.kind === "dish" && isRowLinked(row)).length;
  const extraTotal = allRows.filter((row) => row.kind === "extra").length;
  const extraLinked = allRows.filter((row) => row.kind === "extra" && isRowLinked(row)).length;

  return (
    <>
      <Section
        title="Сопоставление iiko"
        action={
          <div style={{ display: "flex", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
            <select
              style={{ ...styles.input, minWidth: 280 }}
              value={restaurantId}
              onChange={(event) => onRestaurantChange(event.target.value)}
            >
              <option value="">Выберите ресторан</option>
              {(bridges.data ?? []).map((row) => (
                <option key={row.restaurant_id} value={row.restaurant_id}>
                  {row.restaurant_name}
                </option>
              ))}
            </select>
            <Button tone="quiet" onClick={() => saveGroups(presetGroups)} disabled={restaurantId === ""}>
              Группы Mama Roma
            </Button>
            <Button tone="quiet" onClick={() => saveGroups([])} disabled={restaurantId === ""}>
              Вся касса
            </Button>
          </div>
        }
      >
        {restaurantId === "" ? (
          <p style={{ color: c.textSecondary, margin: 0 }}>Выберите ресторан.</p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: spacing.md,
              }}
            >
              <div style={{ padding: spacing.base, background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.md }}>
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>Ресторан</div>
                <div style={{ fontWeight: 700 }}>{currentBridge?.restaurant_name ?? "—"}</div>
                <div style={{ marginTop: 4 }}>
                  {currentBridge && isOnline(currentBridge.last_seen_at) ? (
                    <Badge text="плагин на связи" tone="ok" />
                  ) : (
                    <Badge text="нет свежей связи" tone="warn" />
                  )}
                </div>
              </div>
              <div style={{ padding: spacing.base, background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.md }}>
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>Блюда</div>
                <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {dishLinked} / {dishTotal}
                </div>
                <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                  не связано {Math.max(dishTotal - dishLinked, 0)}
                </div>
              </div>
              <div style={{ padding: spacing.base, background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.md }}>
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>Добавки</div>
                <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {extraLinked} / {extraTotal}
                </div>
                <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                  требуют группы модификатора
                </div>
              </div>
              <div style={{ padding: spacing.base, background: c.surface, border: `1px solid ${c.border}`, borderRadius: radius.md }}>
                <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>Номенклатура iiko</div>
                <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {currentBridge?.products ?? 0}
                </div>
                <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                  {groups.length > 0 ? `групп выбрано ${groups.length}` : "поиск по всей кассе"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xs }}>
              {(allGroups.data ?? []).filter((group) => group.is_preset).map((group) => {
                const picked = groups.includes(group.path);
                return (
                  <button
                    key={group.path}
                    type="button"
                    onClick={() => pickGroup(group.path)}
                    style={{
                      padding: `4px ${spacing.sm}px`,
                      borderRadius: radius.pill,
                      border: `1px solid ${picked ? c.brand : c.border}`,
                      background: picked ? c.brandSubtle : c.surface,
                      color: picked ? c.brand : c.textSecondary,
                      cursor: "pointer",
                      fontSize: typography.caption.fontSize,
                      fontFamily: "inherit",
                      fontWeight: 600,
                    }}
                    title={group.path}
                  >
                    {group.name} · {group.products}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Section>

      {restaurantId !== "" ? (
        <Section
          title={`Позиции · связано ${linked} из ${total}`}
          action={
            <div style={{ display: "flex", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
              <input
                style={{ ...styles.input, minWidth: 220 }}
                placeholder="Блюдо или товар iiko"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button tone={matchFilter === "unmatched" ? "brand" : "quiet"} onClick={() => setMatchFilter("unmatched")}>
                Нет связи
              </Button>
              <Button tone={matchFilter === "matched" ? "brand" : "quiet"} onClick={() => setMatchFilter("matched")}>
                Есть связь
              </Button>
              <Button tone={matchFilter === "all" ? "brand" : "quiet"} onClick={() => setMatchFilter("all")}>
                Все
              </Button>
              <Button tone="quiet" onClick={() => auto.mutate()} disabled={auto.isPending}>
                {auto.isPending ? "Ищем…" : "Автосвязать точные"}
              </Button>
              <Button tone="brand" onClick={() => save.mutate()} disabled={changed === 0 || save.isPending}>
                {save.isPending ? "Сохраняем…" : changed > 0 ? `Сохранить (${changed})` : "Сохранить"}
              </Button>
            </div>
          }
        >
          {auto.data ? (
            <div style={{ color: c.textSecondary }}>
              Автоподбор добавил {auto.data.matched}; без точного совпадения осталось {auto.data.skipped}.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
            <Button tone={kindFilter === "dish" ? "brand" : "quiet"} onClick={() => setKindFilter("dish")}>
              Блюда
            </Button>
            <Button tone={kindFilter === "extra" ? "brand" : "quiet"} onClick={() => setKindFilter("extra")}>
              Добавки
            </Button>
            <Button tone={kindFilter === "all" ? "brand" : "quiet"} onClick={() => setKindFilter("all")}>
              Всё
            </Button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "280px minmax(0, 1fr)",
              gap: spacing.base,
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                style={{
                  textAlign: "left",
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  border: `1px solid ${categoryFilter === "all" ? c.brand : c.border}`,
                  background: categoryFilter === "all" ? c.brandSubtle : c.surface,
                  color: c.textPrimary,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontWeight: 700 }}>Все категории</div>
                <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                  не связано {unlinked}
                </div>
              </button>
              {categoryStats.map((item) => {
                const missing = item.total - item.linked;
                const picked = categoryFilter === item.name;

                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => setCategoryFilter(item.name)}
                    style={{
                      textAlign: "left",
                      padding: spacing.sm,
                      borderRadius: radius.md,
                      border: `1px solid ${picked ? c.brand : c.border}`,
                      background: picked ? c.brandSubtle : c.surface,
                      color: c.textPrimary,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: spacing.sm }}>
                      <span style={{ fontWeight: 700 }}>{item.name}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{item.linked}/{item.total}</span>
                    </div>
                    <div style={{ color: missing > 0 ? c.warning : c.success, fontSize: typography.caption.fontSize }}>
                      {missing > 0 ? `нет связи ${missing}` : "готово"}
                    </div>
                  </button>
                );
              })}
            </div>

            <div>
              {links.isPending ? (
                <p style={{ color: c.textSecondary }}>Загружаем…</p>
              ) : rows.length === 0 ? (
                <div style={{ ...styles.card, padding: spacing.base, color: c.textSecondary }}>
                  Ничего не найдено.
                </div>
              ) : (
                <div style={styles.card}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Позиция приложения</th>
                        <th style={styles.th}>Товар iiko</th>
                        <th style={styles.th}>Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((row) => {
                        const key = keyOf(row);
                        const chosen = draft[key];
                        const currentName = chosen ? chosen.name : row.product_name ?? "";
                        const currentCode = chosen ? chosen.code : row.product_code;
                        const currentGroupPath = chosen ? chosen.groupPath : row.product_group_path;
                        const currentType = chosen ? chosen.productType : row.product_type;

                        return (
                          <tr key={key}>
                            <td style={styles.td}>
                              <div style={{ fontWeight: 700 }}>{row.name}</div>
                              <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                                {row.kind === "dish" ? row.group : "Добавка"}
                              </div>
                            </td>

                            <td style={{ ...styles.td, minWidth: 320 }}>
                              {currentName ? (
                                <div>
                                  <div style={{ color: chosen ? c.brand : c.textPrimary, fontWeight: 600 }}>
                                    {currentName}
                                  </div>
                                  <div style={{ color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                                    {currentCode ? `код ${currentCode}` : "без кода"}
                                    {currentType ? ` · ${currentType}` : ""}
                                  </div>
                                  {currentGroupPath ? (
                                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                                      {currentGroupPath}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <Badge text="нет связи" tone="warn" />
                              )}
                            </td>

                            <td style={styles.td}>
                              <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                                <div style={{ display: "flex", gap: spacing.xs, flexWrap: "wrap" }}>
                                  <Button tone="quiet" onClick={() => setPicking(row)}>
                                    {currentName ? "Сменить" : "Найти"}
                                  </Button>
                                  {currentName ? (
                                    <Button
                                      tone="danger"
                                      onClick={() =>
                                        setDraft((current) => ({
                                          ...current,
                                          [key]: { id: "", name: "" },
                                        }))
                                      }
                                    >
                                      Снять
                                    </Button>
                                  ) : null}
                                </div>
                                {row.suggestions.length > 0 ? (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xs }}>
                                    {row.suggestions.map((product) => (
                                      <button
                                        key={product.product_id}
                                        type="button"
                                        onClick={() =>
                                          setDraft((current) => ({
                                            ...current,
                                            [key]: {
                                              id: product.product_id,
                                              name: product.name,
                                              code: product.code,
                                              groupPath: product.group_path,
                                              productType: product.product_type,
                                            },
                                          }))
                                        }
                                        style={{
                                          padding: `2px ${spacing.sm}px`,
                                          borderRadius: radius.pill,
                                          border: `1px solid ${c.border}`,
                                          background: c.surface,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                          fontSize: typography.caption.fontSize,
                                          color: c.textSecondary,
                                          maxWidth: 360,
                                        }}
                                        title={product.group_path ?? product.group_name ?? ""}
                                      >
                                        {product.name}
                                        {product.code ? ` · ${product.code}` : ""}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {rows.length > 200 ? (
                    <div style={{ padding: spacing.base, color: c.textTertiary }}>
                      Показаны первые 200 из {rows.length}. Выберите категорию или уточните поиск.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </Section>
      ) : null}

      {picking ? (
        <ProductPicker
          restaurantId={restaurantId}
          groups={groups}
          title={picking.name}
          onClose={() => setPicking(null)}
          onPick={(product) => {
            setDraft((current) => ({
              ...current,
              [`${picking.kind}:${picking.id}`]: {
                id: product.product_id,
                name: product.name,
                code: product.code,
                groupPath: product.group_path,
                productType: product.product_type,
              },
            }));
            setPicking(null);
          }}
        />
      ) : null}
    </>
  );
}

function Queue() {
  const queryClient = useQueryClient();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const queue = useQuery({
    queryKey: ["iiko-queue", onlyProblems],
    queryFn: () => api.iikoQueue(onlyProblems),
    refetchInterval: 20000,
  });

  const retry = useMutation({
    mutationFn: (orderId: string) => api.retryHandoff(orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["iiko-queue"] }),
  });

  const label: Record<string, { text: string; tone: "ok" | "warn" | "muted" }> = {
    pending: { text: "ждёт кассу", tone: "warn" },
    sent: { text: "у плагина", tone: "warn" },
    accepted: { text: "заведён", tone: "ok" },
    failed: { text: "не принят", tone: "muted" },
  };

  return (
    <Section
      title="Очередь заказов на кассу"
      action={
        <Button tone={onlyProblems ? "brand" : "quiet"} onClick={() => setOnlyProblems(!onlyProblems)}>
          Только с ошибкой
        </Button>
      }
    >
      {queue.isPending ? (
        <p style={{ color: c.textSecondary }}>Загружаем…</p>
      ) : (queue.data ?? []).length === 0 ? (
        <p style={{ color: c.textSecondary }}>
          {onlyProblems ? "Ошибок нет" : "Очередь пуста"}
        </p>
      ) : (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Заказ</th>
                <th style={styles.th}>Ресторан</th>
                <th style={styles.th}>Состояние</th>
                <th style={styles.th}>Что случилось</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {(queue.data ?? []).map((row) => (
                <tr key={row.order_id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600 }}>№ {row.order_number}</div>
                    <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                      {formatDateTime(row.created_at)} · {formatPrice(row.total_kopecks)}
                    </div>
                  </td>
                  <td style={styles.td}>{row.restaurant_name}</td>
                  <td style={styles.td}>
                    <Badge
                      text={label[row.status]?.text ?? row.status}
                      tone={label[row.status]?.tone ?? "muted"}
                    />
                    {row.iiko_order_number ? (
                      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                        на кассе № {row.iiko_order_number}
                      </div>
                    ) : null}
                    {row.attempts > 1 ? (
                      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                        попыток: {row.attempts}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...styles.td, maxWidth: 420 }}>
                    {row.error ? <div style={{ color: c.danger }}>{row.error}</div> : "—"}
                    {row.missing_products.length > 0 ? (
                      <div style={{ marginTop: 4, color: c.textSecondary, fontSize: typography.caption.fontSize }}>
                        Нет сопоставления: {row.missing_products.join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td style={styles.td}>
                    {row.status === "failed" ? (
                      <Button tone="brand" onClick={() => retry.mutate(row.order_id)}>
                        Повторить
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/**
 * Касса ресторана: плагины по точкам, сопоставление блюд и очередь заказов.
 *
 * База iiko у каждого ресторана своя, поэтому и ключ, и сопоставление —
 * тоже свои. Отсюда три раздела: где стоит плагин, что чему соответствует
 * в этой точке и что происходит с заказами.
 */
export function IikoTab() {
  const [pane, setPane] = useState<Pane>("bridges");
  const [restaurantId, setRestaurantId] = useState("");

  const panes: { key: Pane; label: string }[] = [
    { key: "bridges", label: "Плагины" },
    { key: "links", label: "Сопоставление" },
    { key: "queue", label: "Очередь" },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: spacing.sm }}>
        {panes.map((item) => (
          <Button
            key={item.key}
            tone={pane === item.key ? "brand" : "quiet"}
            onClick={() => setPane(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {pane === "bridges" ? (
        <Bridges
          onOpenLinks={(id) => {
            setRestaurantId(id);
            setPane("links");
          }}
        />
      ) : null}
      {pane === "links" ? (
        <Links restaurantId={restaurantId} onRestaurantChange={setRestaurantId} />
      ) : null}
      {pane === "queue" ? <Queue /> : null}
    </>
  );
}
