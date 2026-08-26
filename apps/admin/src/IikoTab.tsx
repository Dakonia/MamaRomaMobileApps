import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { radius, spacing, typography } from "@mr/design-tokens";
import { useEffect, useMemo, useState } from "react";

import { api, formatDateTime, formatPrice, type IikoLink } from "./api";
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

function Links({ restaurantId }: { restaurantId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Группы кассы, в которых ищем товар. В базе точки десятки тысяч позиций —
  // без сужения одно и то же блюдо находится и в заготовках, и в акциях
  const [groups, setGroups] = useState<string[]>([]);

  const links = useQuery({
    queryKey: ["iiko-links", restaurantId],
    queryFn: () => api.iikoLinks(restaurantId),
    enabled: restaurantId !== "",
  });

  const allGroups = useQuery({
    queryKey: ["iiko-groups", restaurantId],
    queryFn: () => api.iikoGroups(restaurantId),
    enabled: restaurantId !== "",
  });

  const products = useQuery({
    queryKey: ["iiko-products", restaurantId, groups],
    queryFn: async () => {
      if (groups.length === 0) return api.iikoProducts(restaurantId);

      const batches = await Promise.all(groups.map((name) => api.iikoProducts(restaurantId, name)));
      return batches.flat().sort((left, right) => left.name.localeCompare(right.name));
    },
    enabled: restaurantId !== "",
  });

  // Сменили ресторан — черновик прошлого больше не про этот
  useEffect(() => {
    setDraft({});
    setGroups([]);
  }, [restaurantId]);

  const save = useMutation({
    mutationFn: () =>
      api.saveIikoLinks(
        restaurantId,
        Object.entries(draft).map(([key, productId]) => {
          const [kind, id] = key.split(":");
          return { kind, id, product_id: productId };
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
    return (links.data ?? []).filter((row: IikoLink) => {
      if (onlyEmpty && row.product_id) return false;
      if (needle === "") return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.group ?? "").toLowerCase().includes(needle)
      );
    });
  }, [links.data, search, onlyEmpty]);

  const linkedCount = (links.data ?? []).filter((row) => row.product_id).length;
  const changed = Object.keys(draft).length;

  if (restaurantId === "") {
    return (
      <Section title="Сопоставление">
        <p style={{ color: c.textSecondary }}>Выберите ресторан на вкладке «Плагины».</p>
      </Section>
    );
  }

  return (
    <Section
      title={`Сопоставление · ${linkedCount} из ${(links.data ?? []).length}`}
      action={
        <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
          <input
            style={{ ...styles.input, minWidth: 200 }}
            placeholder="Поиск блюда"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button tone={onlyEmpty ? "brand" : "quiet"} onClick={() => setOnlyEmpty(!onlyEmpty)}>
            Только пустые
          </Button>
          <Button tone="quiet" onClick={() => auto.mutate()}>
            {auto.isPending ? "Ищем…" : "Сопоставить по названиям"}
          </Button>
          <Button tone="brand" onClick={() => save.mutate()}>
            {save.isPending ? "Сохраняем…" : changed > 0 ? `Сохранить (${changed})` : "Сохранить"}
          </Button>
        </div>
      }
    >
      {/* Выбор групп: сначала сужаем номенклатуру, потом сопоставляем */}
      <div style={{ marginBottom: spacing.base }}>
        <div style={{ color: c.textSecondary, marginBottom: spacing.sm }}>
          Где искать товары кассы
          {groups.length > 0 ? ` · выбрано ${groups.length}` : " · пока везде"}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.xs,
            maxHeight: 132,
            overflow: "auto",
            padding: spacing.sm,
            border: `1px solid ${c.border}`,
            borderRadius: radius.md,
            background: c.surfaceSunken,
          }}
        >
          {(allGroups.data ?? []).map((group) => {
            const picked = groups.includes(group.name);

            return (
              <button
                key={group.name}
                type="button"
                onClick={() =>
                  setGroups((current) =>
                    picked
                      ? current.filter((name) => name !== group.name)
                      : [...current, group.name],
                  )
                }
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
      </div>

      {auto.data ? (
        <p style={{ color: c.textSecondary, marginTop: 0 }}>
          Связано {auto.data.matched}, оставлено человеку {auto.data.skipped} — это позиции,
          где названия не совпали или в кассе нашлось несколько одинаковых.
        </p>
      ) : null}

      {(products.data ?? []).length === 0 ? (
        <p style={{ color: c.warning }}>
          Номенклатура этой кассы ещё не выгружена. Плагин присылает её сам — проверьте,
          что он на связи и что в настройках включено <code>syncMenu</code>.
        </p>
      ) : null}

      {links.isPending ? (
        <p style={{ color: c.textSecondary }}>Загружаем…</p>
      ) : (
        <div style={{ ...styles.card, maxHeight: "60vh", overflow: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Наше блюдо</th>
                <th style={styles.th}>Раздел</th>
                <th style={styles.th}>Товар кассы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = `${row.kind}:${row.id}`;
                const value = draft[key] ?? row.product_id ?? "";

                return (
                  <tr key={key}>
                    <td style={styles.td}>
                      {row.name}
                      {row.kind === "extra" ? (
                        <span style={{ color: c.textTertiary }}> · добавка</span>
                      ) : null}
                    </td>
                    <td style={{ ...styles.td, color: c.textSecondary }}>{row.group}</td>
                    <td style={styles.td}>
                      <select
                        style={{ ...styles.input, minWidth: 320 }}
                        value={value}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, [key]: event.target.value }))
                        }
                      >
                        <option value="">— не сопоставлено —</option>
                        {(products.data ?? []).map((product) => (
                          <option key={product.product_id} value={product.product_id}>
                            {product.name}
                            {product.code ? ` · ${product.code}` : ""}
                            {product.has_sizes ? " · есть размеры" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
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
