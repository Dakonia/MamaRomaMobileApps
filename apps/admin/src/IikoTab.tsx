import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { radius, spacing, typography } from "@mr/design-tokens";
import { useEffect, useMemo, useState } from "react";

import { api, formatDateTime, formatPrice, type IikoLink, type IikoProduct } from "./api";
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
            (found.data ?? []).map((product) => (
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
                  {product.group_name ? ` · ${product.group_name}` : ""}
                  {product.code ? ` · ${product.code}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Links({ restaurantId }: { restaurantId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [draft, setDraft] = useState<Record<string, { id: string; name: string }>>({});
  const [picking, setPicking] = useState<IikoLink | null>(null);

  /**
   * Группы кассы, в которых ищем товар. В базе точки десятки тысяч позиций:
   * заготовки, посуда, акции прошлых лет. Выбор помним — он один и тот же
   * изо дня в день, а перевыбирать его каждый раз утомительно.
   */
  const [groups, setGroups] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(`iiko-groups-${restaurantId}`);
    setGroups(saved ? (JSON.parse(saved) as string[]) : []);
    setDraft({});
  }, [restaurantId]);

  const pickGroup = (name: string) => {
    setGroups((current) => {
      const next = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      localStorage.setItem(`iiko-groups-${restaurantId}`, JSON.stringify(next));
      return next;
    });
  };

  const allGroups = useQuery({
    queryKey: ["iiko-groups", restaurantId],
    queryFn: () => api.iikoGroups(restaurantId),
    enabled: restaurantId !== "",
  });

  const links = useQuery({
    queryKey: ["iiko-links", restaurantId, groups],
    queryFn: () => api.iikoLinks(restaurantId, groups),
    enabled: restaurantId !== "",
  });

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

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (links.data ?? []).filter((row) => {
      const linked = draft[`${row.kind}:${row.id}`]?.id ?? row.product_id;
      if (onlyEmpty && linked) return false;
      if (needle === "") return true;
      return row.name.toLowerCase().includes(needle);
    });
  }, [links.data, search, onlyEmpty, draft]);

  const total = (links.data ?? []).length;
  const linked = (links.data ?? []).filter((row) => row.product_id).length;
  const changed = Object.keys(draft).length;

  if (restaurantId === "") {
    return (
      <Section title="Сопоставление">
        <p style={{ color: c.textSecondary }}>Выберите ресторан на вкладке «Плагины».</p>
      </Section>
    );
  }

  return (
    <>
      <Section title="Где искать товары кассы">
        <p style={{ marginTop: 0, color: c.textSecondary }}>
          В базе этой точки {(allGroups.data ?? []).reduce((sum, g) => sum + g.products, 0)} позиций:
          заготовки, посуда, акции прошлых лет. Отметьте группы настоящего меню — поиск,
          подсказки и автоподбор будут работать только по ним.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xs, maxHeight: 180, overflow: "auto" }}>
          {(allGroups.data ?? []).map((group) => {
            const picked = groups.includes(group.name);

            return (
              <button
                key={group.name}
                type="button"
                onClick={() => pickGroup(group.name)}
                style={{
                  padding: `4px ${spacing.sm}px`,
                  borderRadius: radius.pill,
                  border: `1px solid ${picked ? c.brand : c.border}`,
                  background: picked ? c.brandSubtle : c.surface,
                  color: picked ? c.brand : c.textSecondary,
                  cursor: "pointer",
                  fontSize: typography.caption.fontSize,
                  fontFamily: "inherit",
                }}
              >
                {group.name || "без группы"} · {group.products}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title={`Блюда · связано ${linked} из ${total}`}
        action={
          <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
            <input
              style={{ ...styles.input, minWidth: 180 }}
              placeholder="Поиск блюда"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button tone={onlyEmpty ? "brand" : "quiet"} onClick={() => setOnlyEmpty(!onlyEmpty)}>
              Только несвязанные
            </Button>
            <Button tone="quiet" onClick={() => auto.mutate()}>
              {auto.isPending ? "Ищем…" : "Связать совпадения"}
            </Button>
            <Button tone="brand" onClick={() => save.mutate()}>
              {save.isPending ? "Сохраняем…" : changed > 0 ? `Сохранить (${changed})` : "Сохранить"}
            </Button>
          </div>
        }
      >
        {groups.length === 0 ? (
          <p style={{ color: c.warning, marginTop: 0 }}>
            Группы не выбраны — подсказок не будет, а поиск пойдёт по всем позициям сразу.
          </p>
        ) : null}

        {auto.data ? (
          <p style={{ color: c.textSecondary, marginTop: 0 }}>
            Связано {auto.data.matched}. Оставлено вам {auto.data.skipped} — там названия не совпали
            точно или в кассе нашлось несколько одинаковых.
          </p>
        ) : null}

        {links.isPending ? (
          <p style={{ color: c.textSecondary }}>Загружаем…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: c.textSecondary }}>
            {onlyEmpty ? "Всё связано" : "Ничего не нашлось"}
          </p>
        ) : (
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Наше блюдо</th>
                  <th style={styles.th}>Товар кассы</th>
                  <th style={styles.th}>Подсказки</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 120).map((row) => {
                  const key = `${row.kind}:${row.id}`;
                  const chosen = draft[key];
                  const currentName = chosen?.name ?? row.product_name;

                  return (
                    <tr key={key}>
                      <td style={styles.td}>
                        <div>{row.name}</div>
                        <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
                          {row.group}
                        </div>
                      </td>

                      <td style={{ ...styles.td, minWidth: 260 }}>
                        {currentName ? (
                          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
                            <span style={{ color: chosen ? c.brand : c.textPrimary }}>
                              {currentName}
                            </span>
                            <Button
                              tone="quiet"
                              onClick={() =>
                                setDraft((current) => ({ ...current, [key]: { id: "", name: "" } }))
                              }
                            >
                              снять
                            </Button>
                          </div>
                        ) : (
                          <Button tone="quiet" onClick={() => setPicking(row)}>
                            Найти в кассе
                          </Button>
                        )}
                      </td>

                      <td style={styles.td}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xs }}>
                          {row.suggestions.map((product) => (
                            <button
                              key={product.product_id}
                              type="button"
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  [key]: { id: product.product_id, name: product.name },
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
                              }}
                            >
                              {product.name}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length > 120 ? (
              <div style={{ padding: spacing.base, color: c.textTertiary }}>
                Показаны первые 120 из {rows.length}. Сохраните сделанное или сузьте поиском.
              </div>
            ) : null}
          </div>
        )}
      </Section>

      {picking ? (
        <ProductPicker
          restaurantId={restaurantId}
          groups={groups}
          title={picking.name}
          onClose={() => setPicking(null)}
          onPick={(product) => {
            setDraft((current) => ({
              ...current,
              [`${picking.kind}:${picking.id}`]: { id: product.product_id, name: product.name },
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
      {pane === "links" ? <Links restaurantId={restaurantId} /> : null}
      {pane === "queue" ? <Queue /> : null}
    </>
  );
}
