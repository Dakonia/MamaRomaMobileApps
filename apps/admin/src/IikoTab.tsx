import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Copy,
  Link2,
  ListTree,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Unlink,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDateTime,
  formatPrice,
  type Bridge,
  type Handoff,
  type IikoGroup,
  type IikoLink,
  type IikoProduct,
  type MenuBranch,
  type MenuTree,
} from "./api";
import { DataTable, DensityToggle, createAdminColumnHelper, useTableDensity } from "./components/patterns/DataTable";
import { Badge, Button, IconButton, Section, Select } from "./ui";

type Pane = "bridges" | "links" | "tree" | "queue";
type MatchFilter = "unmatched" | "matched" | "all";
type LinkKindFilter = "all" | "dish" | "extra";

type DraftPick = {
  code?: string | null;
  groupPath?: string | null;
  id: string;
  name: string;
  productType?: string | null;
};

const bridgeColumn = createAdminColumnHelper<Bridge>();
const linkColumn = createAdminColumnHelper<IikoLink>();
const queueColumn = createAdminColumnHelper<Handoff>();
const branchColumn = createAdminColumnHelper<MenuBranch>();

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

function sinceLabel(iso: string | null): string {
  if (!iso) return "не выходил на связь";

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "на связи";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ч назад`;
  return `${Math.floor(minutes / 1440)} дн назад`;
}

function isOnline(iso: string | null): boolean {
  return iso !== null && Date.now() - new Date(iso).getTime() < 10 * 60 * 1000;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function keyOf(row: IikoLink): string {
  return `${row.kind}:${row.id}`;
}

function currentPick(row: IikoLink, draft: Record<string, DraftPick>): DraftPick | null {
  const picked = draft[keyOf(row)];
  if (picked) return picked.id ? picked : null;
  if (!row.product_id || !row.product_name) return null;
  return {
    code: row.product_code,
    groupPath: row.product_group_path,
    id: row.product_id,
    name: row.product_name,
    productType: row.product_type,
  };
}

function bridgeStatus(row: Bridge) {
  if (!row.is_registered) return <Badge text="нет ключа" tone="muted" />;
  if (!row.is_active) return <Badge text="выключен" tone="muted" />;
  if (isOnline(row.last_seen_at)) return <Badge text="на связи" tone="ok" />;
  return <Badge text="молчит" tone="warn" />;
}

function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

function SecretPanel({ shown, onClose }: { onClose: () => void; shown: { name: string; secret: string } }) {
  const copy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(shown.secret).then(() => toast.success("Ключ скопирован"));
  };

  return (
    <div className="secret-card">
      <div className="section-head">
        <div>
          <h2 className="section-title">Ключ для «{shown.name}»</h2>
          <p className="section-copy">Скопируйте сейчас: второй раз ключ не покажется.</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Скрыть
        </Button>
      </div>
      <code className="secret-code">{shown.secret}</code>
      <div className="drawer-actions">
        <Button variant="ghost" onClick={copy}>
          <Copy size={15} aria-hidden />
          Скопировать
        </Button>
      </div>
      <p className="section-copy">
        Впишите ключ в bridge.settings.json в поле mamaroma.secret, а идентификатор ресторана —
        в mamaroma.restaurantId.
      </p>
    </div>
  );
}

function Bridges({ onOpenLinks }: { onOpenLinks: (restaurantId: string) => void }) {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [shown, setShown] = useState<{ name: string; secret: string } | null>(null);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  const bridges = useQuery({
    queryKey: ["iiko-bridges"],
    queryFn: api.bridges,
    refetchInterval: 30000,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });

  const issue = useMutation({
    mutationFn: (row: { id: string; name: string }) =>
      api.bridgeSecret(row.id).then((result) => ({ name: row.name, secret: result.secret })),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      setShown(result);
      refresh();
      toast.success("Ключ выпущен");
    },
  });

  const toggle = useMutation({
    mutationFn: ({ active, id }: { active: boolean; id: string }) => api.toggleBridge(id, active),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: refresh,
  });

  const copyLinks = useMutation({
    mutationFn: () => api.copyIikoLinks(source, target, false),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      refresh();
      toast.success(`Перенесено ${result.copied}, пропущено ${result.skipped}`);
    },
  });

  const bridgeRows = bridges.data ?? [];
  const isLoadingBridges = bridges.isPending;
  const ready = bridgeRows.filter((row) => row.linked_dishes > 0);
  const registered = bridgeRows.filter((row) => row.is_registered).length;
  const online = bridgeRows.filter((row) => isOnline(row.last_seen_at)).length;
  const unlinked = bridgeRows.reduce((sum, row) => sum + row.unlinked_dishes, 0);
  const failed = bridgeRows.reduce((sum, row) => sum + row.failed_orders, 0);

  const columns = useMemo(
    () =>
      bridgeColumn.columns([
        bridgeColumn.accessor("restaurant_name", {
          header: "Ресторан",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {row.terminal_name ?? "терминал не назвался"}
                  {row.plugin_version ? ` · версия ${row.plugin_version}` : ""}
                </div>
              </div>
            );
          },
        }),
        bridgeColumn.accessor("last_seen_at", {
          header: "Связь",
          cell: (info) => (
            <div>
              {bridgeStatus(info.row.original)}
              <div className="row-sub">{sinceLabel(info.getValue())}</div>
            </div>
          ),
        }),
        bridgeColumn.display({
          id: "links",
          header: "Сопоставлено",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="mono row-main">
                  {row.linked_dishes} блюд · {row.linked_extras} добавок
                </div>
                <div className="row-sub">в кассе {row.products} товаров</div>
                {row.is_registered && row.unlinked_dishes > 0 ? (
                  <div className="form-error">не связано {row.unlinked_dishes}</div>
                ) : null}
              </div>
            );
          },
        }),
        bridgeColumn.display({
          id: "queue",
          header: "Очередь",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div>{row.pending_orders > 0 ? `${row.pending_orders} ждут` : "пусто"}</div>
                {row.failed_orders > 0 ? <div className="form-error">{row.failed_orders} с ошибкой</div> : null}
              </div>
            );
          },
        }),
        bridgeColumn.accessor("restaurant_id", {
          header: "ID",
          cell: (info) => (
            <code className="table-code" title={info.getValue()}>
              {shortId(info.getValue())}
            </code>
          ),
        }),
        bridgeColumn.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) => {
            const row = info.row.original;
            return (
              <div className="cell-actions">
                <Button size="xs" variant="ghost" onClick={() => onOpenLinks(row.restaurant_id)}>
                  <Link2 size={14} aria-hidden />
                  Связи
                </Button>
                <Button
                  size="xs"
                  onClick={() => issue.mutate({ id: row.restaurant_id, name: row.restaurant_name })}
                >
                  <ShieldCheck size={14} aria-hidden />
                  {row.is_registered ? "Новый ключ" : "Ключ"}
                </Button>
                {row.is_registered ? (
                  <Button
                    size="xs"
                    variant={row.is_active ? "danger" : "ghost"}
                    onClick={() => toggle.mutate({ active: !row.is_active, id: row.restaurant_id })}
                  >
                    {row.is_active ? <Unlink size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
                    {row.is_active ? "Выключить" : "Включить"}
                  </Button>
                ) : null}
              </div>
            );
          },
        }),
      ]),
    [issue, onOpenLinks, toggle],
  );

  return (
    <div className="page-stack">
      <Section title="Плагины по ресторанам">
        <div className="metric-strip">
          <Metric label="Точек" note="в интеграции" value={isLoadingBridges ? "..." : String(bridgeRows.length)} />
          <Metric label="С ключом" note="зарегистрированы" value={isLoadingBridges ? "..." : String(registered)} />
          <Metric label="На связи" note="последние 10 минут" value={isLoadingBridges ? "..." : String(online)} />
          <Metric label="Риски" note="несвязанные/ошибки" value={isLoadingBridges ? "..." : `${unlinked}/${failed}`} />
        </div>

        {shown ? <SecretPanel shown={shown} onClose={() => setShown(null)} /> : null}

        <div className="surface-toolbar">
          <DensityToggle density={density} onChange={setDensity} />
        </div>

        {bridges.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить плагины</h2>
            <p>{errorMessage(bridges.error)}</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={bridgeRows}
            density={density}
            getRowId={(row) => row.restaurant_id}
            isLoading={bridges.isPending}
            pageSize={20}
          />
        )}
      </Section>

      <Section title="Перенести сопоставление на другую точку">
        <div className="iiko-copy-panel">
          <div className="field">
            <span className="field-label">Откуда</span>
            <Select
              value={source}
              options={[
                { label: "Настроенный ресторан", value: "" },
                ...ready.map((row) => ({
                  label: row.restaurant_name,
                  description: `${row.linked_dishes} блюд`,
                  value: row.restaurant_id,
                })),
              ]}
              onChange={setSource}
            />
          </div>
          <div className="field">
            <span className="field-label">Куда</span>
            <Select
              value={target}
              options={[
                { label: "Новая точка", value: "" },
                ...bridgeRows
                  .filter((row) => row.restaurant_id !== source)
                  .map((row) => ({
                    label: row.restaurant_name,
                    description: `связано ${row.linked_dishes}`,
                    value: row.restaurant_id,
                  })),
              ]}
              onChange={setTarget}
            />
          </div>
          <Button disabled={!source || !target || copyLinks.isPending} onClick={() => copyLinks.mutate()}>
            <Copy size={15} aria-hidden />
            {copyLinks.isPending ? "Переносим..." : "Перенести"}
          </Button>
        </div>
        <div className="info-band">
          Уже настроенные позиции не перезаписываем. Товары, которых нет в номенклатуре получателя,
          будут пропущены.
        </div>
      </Section>
    </div>
  );
}

function ProductPicker({
  groups,
  onClose,
  onPick,
  restaurantId,
  title,
}: {
  groups: string[];
  onClose: () => void;
  onPick: (product: IikoProduct) => void;
  restaurantId: string;
  title: string;
}) {
  const [query, setQuery] = useState(title);
  const [typed, setTyped] = useState(title);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), 300);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const found = useQuery({
    queryKey: ["iiko-search", restaurantId, query, groups],
    queryFn: () => api.searchIikoProducts(restaurantId, query, groups),
  });

  return (
    <>
      <div className="command-overlay" onClick={onClose} />
      <section aria-modal="true" className="picker-dialog" role="dialog">
        <div className="picker-head">
          <div>
            <h2 className="drawer-title">{title}</h2>
            <div className="row-sub">
              {groups.length > 0 ? `Поиск в выбранных группах: ${groups.length}` : "Поиск по всей номенклатуре"}
            </div>
          </div>
          <span className="toolbar-spacer" />
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </div>

        <div className="picker-search">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" size={15} aria-hidden />
          <input
            autoFocus
            className="input pl-9"
            placeholder="Название товара в кассе"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>

        <div className="picker-results">
          {found.isPending ? (
            <div className="empty-state">
              <h2>Ищем товары</h2>
              <p>Сервер просматривает номенклатуру выбранной кассы.</p>
            </div>
          ) : (found.data ?? []).length === 0 ? (
            <div className="empty-state">
              <h2>Ничего не нашлось</h2>
              <p>Попробуйте часть названия, код или снимите ограничение по группам.</p>
            </div>
          ) : (
            (found.data ?? []).map((product) => (
              <button
                key={product.product_id}
                className="picker-row"
                type="button"
                onClick={() => onPick(product)}
              >
                <span className="row-main">{product.name}</span>
                <span className="row-sub">
                  {product.group_path ?? product.group_name ?? "без группы"}
                  {product.code ? ` · код ${product.code}` : ""}
                  {product.price_kopecks > 0 ? ` · ${formatPrice(product.price_kopecks)}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function Links({
  onRestaurantChange,
  restaurantId,
}: {
  onRestaurantChange: (id: string) => void;
  restaurantId: string;
}) {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
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
    const unique = [...new Set(presetGroups)].filter(Boolean);
    setGroups(unique);
    localStorage.setItem(storageKey, JSON.stringify(unique));
  }, [groups.length, presetGroups, restaurantId, storageKey]);

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

  const links = useQuery({
    queryKey: ["iiko-links", restaurantId, groups],
    queryFn: () => api.iikoLinks(restaurantId, groups),
    enabled: restaurantId !== "",
  });

  const selectedProductId = (row: IikoLink) => currentPick(row, draft)?.id ?? "";
  const isRowLinked = (row: IikoLink) => selectedProductId(row) !== "";

  const save = useMutation({
    mutationFn: () =>
      api.saveIikoLinks(
        restaurantId,
        Object.entries(draft).map(([key, value]) => {
          const [kind, id] = key.split(":");
          return { id, kind, product_id: value.id };
        }),
      ),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ["iiko-links", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
      toast.success(`Сохранено связей: ${result.applied}`);
    },
  });

  const auto = useMutation({
    mutationFn: () => api.autoMatchIiko(restaurantId, groups),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["iiko-links", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
      toast.success(`Автосвязано ${result.matched}, пропущено ${result.skipped}`);
    },
  });

  const allRows = links.data ?? [];
  const categoryStats = useMemo(() => {
    const byCategory = new Map<string, { dishes: number; extras: number; linked: number; name: string; total: number }>();

    for (const row of allRows) {
      const name = row.group ?? "Без категории";
      const current = byCategory.get(name) ?? { dishes: 0, extras: 0, linked: 0, name, total: 0 };
      current.total += 1;
      if (isRowLinked(row)) current.linked += 1;
      if (row.kind === "dish") current.dishes += 1;
      if (row.kind === "extra") current.extras += 1;
      byCategory.set(name, current);
    }

    return [...byCategory.values()].sort((a, b) => b.total - a.total);
  }, [allRows, draft]);

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!categoryStats.some((item) => item.name === categoryFilter)) setCategoryFilter("all");
  }, [categoryFilter, categoryStats]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return allRows.filter((row) => {
      const linked = isRowLinked(row);
      if (matchFilter === "unmatched" && linked) return false;
      if (matchFilter === "matched" && !linked) return false;
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (categoryFilter !== "all" && (row.group ?? "Без категории") !== categoryFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.name,
        row.group ?? "",
        row.product_name ?? "",
        row.product_code ?? "",
        row.product_group_path ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("ru-RU");
      return haystack.includes(needle);
    });
  }, [allRows, categoryFilter, draft, kindFilter, matchFilter, search]);

  const total = allRows.length;
  const linked = allRows.filter(isRowLinked).length;
  const unlinked = total - linked;
  const dishTotal = allRows.filter((row) => row.kind === "dish").length;
  const dishLinked = allRows.filter((row) => row.kind === "dish" && isRowLinked(row)).length;
  const extraTotal = allRows.filter((row) => row.kind === "extra").length;
  const extraLinked = allRows.filter((row) => row.kind === "extra" && isRowLinked(row)).length;
  const changed = Object.keys(draft).length;

  const columns = useMemo(
    () =>
      linkColumn.columns([
        linkColumn.accessor("name", {
          header: "Позиция",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">{info.getValue()}</div>
                <div className="row-sub">
                  {row.kind === "dish" ? row.group ?? "Без категории" : "Добавка"}
                  {row.kind === "extra" ? " · нужна группа модификатора" : ""}
                </div>
              </div>
            );
          },
        }),
        linkColumn.display({
          id: "product",
          header: "Товар iiko",
          cell: (info) => {
            const row = info.row.original;
            const picked = currentPick(row, draft);
            const changedRow = draft[keyOf(row)] !== undefined;
            const priceDiff =
              picked !== null &&
              row.iiko_price_kopecks > 0 &&
              row.our_price_kopecks !== row.iiko_price_kopecks;

            return picked ? (
              <div>
                <div className={changedRow ? "row-main text-[var(--acc)]" : "row-main"}>{picked.name}</div>
                <div className="row-sub">
                  {picked.code ? `код ${picked.code}` : "без кода"}
                  {picked.productType ? ` · ${picked.productType}` : ""}
                </div>
                {picked.groupPath ? <div className="iiko-product-path">{picked.groupPath}</div> : null}
                {priceDiff ? (
                  <div className="chips-line mt-1">
                    <Badge text="цена отличается" tone="warn" />
                    <span className="row-sub">
                      у нас {formatPrice(row.our_price_kopecks)}, iiko {formatPrice(row.iiko_price_kopecks)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <Badge text="нет связи" tone="warn" />
            );
          },
        }),
        linkColumn.display({
          id: "actions",
          header: "Действие",
          cell: (info) => {
            const row = info.row.original;
            const key = keyOf(row);
            const picked = currentPick(row, draft);
            return (
              <div className="iiko-link-actions">
                <div className="drawer-actions">
                  <Button size="xs" variant="ghost" onClick={() => setPicking(row)}>
                    <Search size={14} aria-hidden />
                    {picked ? "Сменить" : "Найти"}
                  </Button>
                  {picked ? (
                    <Button
                      size="xs"
                      variant="danger"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          [key]: { id: "", name: "" },
                        }))
                      }
                    >
                      <Unlink size={14} aria-hidden />
                      Снять
                    </Button>
                  ) : null}
                </div>
                {row.suggestions.length > 0 ? (
                  <div className="suggestion-chips">
                    {row.suggestions.slice(0, 4).map((product) => (
                      <button
                        key={product.product_id}
                        className="suggestion-chip"
                        title={product.group_path ?? product.group_name ?? ""}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            [key]: {
                              code: product.code,
                              groupPath: product.group_path,
                              id: product.product_id,
                              name: product.name,
                              productType: product.product_type,
                            },
                          }))
                        }
                      >
                        {product.name}
                        {product.code ? ` · ${product.code}` : ""}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          },
        }),
      ]),
    [draft],
  );

  return (
    <div className="page-stack">
      <Section
        title="Сопоставление iiko"
        action={
          <div className="surface-toolbar">
            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={restaurantId}
                options={[
                  { label: "Выберите ресторан", value: "" },
                  ...(bridges.data ?? []).map((row) => ({ label: row.restaurant_name, value: row.restaurant_id })),
                ]}
                onChange={onRestaurantChange}
              />
            </div>
            <Button disabled={restaurantId === ""} variant="ghost" onClick={() => saveGroups(presetGroups)}>
              Группы Mama Roma
            </Button>
            <Button disabled={restaurantId === ""} variant="ghost" onClick={() => saveGroups([])}>
              Вся касса
            </Button>
          </div>
        }
      >
        {restaurantId === "" ? (
          <div className="empty-state">
            <h2>Выберите ресторан</h2>
            <p>После выбора загрузятся группы iiko и позиции, которые требуют связи.</p>
          </div>
        ) : (
          <>
            <div className="metric-strip">
              <Metric
                label="Ресторан"
                note={currentBridge && isOnline(currentBridge.last_seen_at) ? "плагин на связи" : "нет свежей связи"}
                value={currentBridge?.restaurant_name ?? "—"}
              />
              <Metric label="Блюда" note={`не связано ${Math.max(dishTotal - dishLinked, 0)}`} value={`${dishLinked}/${dishTotal}`} />
              <Metric label="Добавки" note="модификаторы" value={`${extraLinked}/${extraTotal}`} />
              <Metric
                label="Номенклатура"
                note={groups.length > 0 ? `групп выбрано ${groups.length}` : "поиск по всей кассе"}
                value={String(currentBridge?.products ?? 0)}
              />
            </div>

            <div className="iiko-group-chips">
              {(allGroups.data ?? [])
                .filter((group) => group.is_preset)
                .map((group) => {
                  const picked = groups.includes(group.path);
                  return (
                    <button
                      key={group.path}
                      className="filter-chip"
                      data-active={picked}
                      title={group.path}
                      type="button"
                      onClick={() => pickGroup(group.path)}
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
            <div className="surface-toolbar">
              <Button disabled={auto.isPending} variant="ghost" onClick={() => auto.mutate()}>
                <BadgeCheck size={15} aria-hidden />
                {auto.isPending ? "Ищем..." : "Автосвязать точные"}
              </Button>
              <Button disabled={changed === 0 || save.isPending} onClick={() => save.mutate()}>
                <CheckCircle2 size={15} aria-hidden />
                {save.isPending ? "Сохраняем..." : changed > 0 ? `Сохранить (${changed})` : "Сохранить"}
              </Button>
            </div>
          }
        >
          <div className="surface-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Поиск связи"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <div className="filter-chips" aria-label="Статус связи">
              <button className="filter-chip" data-active={matchFilter === "unmatched"} type="button" onClick={() => setMatchFilter("unmatched")}>
                Нет связи
              </button>
              <button className="filter-chip" data-active={matchFilter === "matched"} type="button" onClick={() => setMatchFilter("matched")}>
                Есть связь
              </button>
              <button className="filter-chip" data-active={matchFilter === "all"} type="button" onClick={() => setMatchFilter("all")}>
                Все
              </button>
            </div>
            <div className="filter-chips" aria-label="Тип позиции">
              <button className="filter-chip" data-active={kindFilter === "dish"} type="button" onClick={() => setKindFilter("dish")}>
                Блюда
              </button>
              <button className="filter-chip" data-active={kindFilter === "extra"} type="button" onClick={() => setKindFilter("extra")}>
                Добавки
              </button>
              <button className="filter-chip" data-active={kindFilter === "all"} type="button" onClick={() => setKindFilter("all")}>
                Всё
              </button>
            </div>
            <span className="toolbar-spacer" />
            <DensityToggle density={density} onChange={setDensity} />
          </div>

          <div className="iiko-link-layout">
            <aside className="iiko-category-list">
              <button
                className="iiko-category-card"
                data-active={categoryFilter === "all"}
                type="button"
                onClick={() => setCategoryFilter("all")}
              >
                <span className="row-main">Все категории</span>
                <span className="row-sub">нет связи {unlinked}</span>
              </button>
              {categoryStats.map((item) => {
                const missing = item.total - item.linked;
                return (
                  <button
                    key={item.name}
                    className="iiko-category-card"
                    data-active={categoryFilter === item.name}
                    type="button"
                    onClick={() => setCategoryFilter(item.name)}
                  >
                    <span className="row-main">{item.name}</span>
                    <span className="row-sub">
                      {item.linked}/{item.total} · {missing > 0 ? `нет связи ${missing}` : "готово"}
                    </span>
                  </button>
                );
              })}
            </aside>

            <DataTable
              columns={columns}
              data={rows}
              density={density}
              getRowId={(row) => keyOf(row)}
              isLoading={links.isPending}
              pageSize={20}
              empty={
                <div className="empty-state">
                  <h2>Ничего не найдено</h2>
                  <p>Смените фильтр, категорию или поисковую строку.</p>
                </div>
              }
            />
          </div>
        </Section>
      ) : null}

      {picking ? (
        <ProductPicker
          groups={groups}
          restaurantId={restaurantId}
          title={picking.name}
          onClose={() => setPicking(null)}
          onPick={(product) => {
            setDraft((current) => ({
              ...current,
              [keyOf(picking)]: {
                code: product.code,
                groupPath: product.group_path,
                id: product.product_id,
                name: product.name,
                productType: product.product_type,
              },
            }));
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Queue() {
  const queryClient = useQueryClient();
  const [density, setDensity] = useTableDensity();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const queue = useQuery({
    queryKey: ["iiko-queue", onlyProblems],
    queryFn: () => api.iikoQueue(onlyProblems),
    refetchInterval: 20000,
  });

  const retry = useMutation({
    mutationFn: api.retryHandoff,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["iiko-queue"] });
      toast.success("Заказ отправлен на повтор");
    },
  });

  const status: Record<string, { text: string; tone: "ok" | "warn" | "muted" | "bad" }> = {
    accepted: { text: "заведён", tone: "ok" },
    failed: { text: "не принят", tone: "bad" },
    pending: { text: "ждёт кассу", tone: "warn" },
    sent: { text: "у плагина", tone: "warn" },
  };

  const failed = (queue.data ?? []).filter((row) => row.status === "failed").length;
  const pending = (queue.data ?? []).filter((row) => row.status === "pending" || row.status === "sent").length;
  const sent = (queue.data ?? []).filter((row) => row.status === "accepted").length;

  const columns = useMemo(
    () =>
      queueColumn.columns([
        queueColumn.accessor("order_number", {
          header: "Заказ",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <div className="row-main">№ {info.getValue()}</div>
                <div className="row-sub">
                  {formatDateTime(row.created_at)} · {formatPrice(row.total_kopecks)}
                </div>
              </div>
            );
          },
        }),
        queueColumn.accessor("restaurant_name", {
          header: "Ресторан",
          cell: (info) => info.getValue(),
        }),
        queueColumn.accessor("status", {
          header: "Состояние",
          cell: (info) => {
            const row = info.row.original;
            const item = status[info.getValue()] ?? { text: info.getValue(), tone: "muted" as const };
            return (
              <div>
                <Badge text={item.text} tone={item.tone} />
                {row.iiko_order_number ? <div className="row-sub">на кассе № {row.iiko_order_number}</div> : null}
                {row.attempts > 1 ? <div className="row-sub">попыток: {row.attempts}</div> : null}
              </div>
            );
          },
        }),
        queueColumn.display({
          id: "problem",
          header: "Что случилось",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                {row.error ? <div className="form-error">{row.error}</div> : <span className="row-muted">—</span>}
                {row.missing_products.length > 0 ? (
                  <div className="row-sub">Нет сопоставления: {row.missing_products.join(", ")}</div>
                ) : null}
              </div>
            );
          },
        }),
        queueColumn.display({
          id: "actions",
          header: "",
          meta: { align: "right" },
          cell: (info) =>
            info.row.original.status === "failed" ? (
              <Button size="xs" onClick={() => retry.mutate(info.row.original.order_id)}>
                <RefreshCw size={14} aria-hidden />
                Повторить
              </Button>
            ) : null,
        }),
      ]),
    [retry],
  );

  return (
    <Section
      title="Очередь заказов на кассу"
      action={
        <Button variant={onlyProblems ? "primary" : "ghost"} onClick={() => setOnlyProblems(!onlyProblems)}>
          Только с ошибкой
        </Button>
      }
      description="Передача заказов из приложения в ресторанную кассу."
    >
      <div className="metric-strip">
        <Metric label="В очереди" note="показано сейчас" value={String(queue.data?.length ?? 0)} />
        <Metric label="Ждут" note="pending/sent" value={String(pending)} />
        <Metric label="Приняты" note="на кассе" value={String(sent)} />
        <Metric label="Ошибки" note="нужна реакция" value={String(failed)} />
      </div>

      <div className="surface-toolbar">
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {queue.error ? (
        <div className="error-state">
          <h2>Не удалось загрузить очередь</h2>
          <p>{errorMessage(queue.error)}</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={queue.data ?? []}
          density={density}
          getRowId={(row) => row.order_id}
          isLoading={queue.isPending}
          pageSize={20}
          empty={
            <div className="empty-state">
              <h2>{onlyProblems ? "Ошибок нет" : "Очередь пуста"}</h2>
              <p>Новые передачи заказов появятся здесь автоматически.</p>
            </div>
          }
        />
      )}
    </Section>
  );
}

function split(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function Tree() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deny, setDeny] = useState<string | null>(null);
  const [extras, setExtras] = useState<string | null>(null);
  const [keepUnknown, setKeepUnknown] = useState<boolean | null>(null);

  const tree = useQuery({ queryKey: ["iiko-menu-tree"], queryFn: api.menuTree });

  const save = useMutation({
    mutationFn: (data: MenuTree) =>
      api.saveMenuTree({
        branches: data.branches.map((branch) => ({
          category_id: branch.category_id,
          iiko_group_paths: split(draft[branch.category_id] ?? branch.iiko_group_paths.join("\n")),
        })),
        deny_markers: split(deny ?? data.deny_markers.join("\n")),
        extra_group_paths: split(extras ?? data.extra_group_paths.join("\n")),
        keep_unknown_groups: keepUnknown ?? data.keep_unknown_groups,
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      setDraft({});
      setDeny(null);
      setExtras(null);
      setKeepUnknown(null);
      void queryClient.invalidateQueries({ queryKey: ["iiko-menu-tree"] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-groups"] });
      toast.success("Дерево меню сохранено");
    },
  });

  const columns = useMemo(
    () =>
      branchColumn.columns([
        branchColumn.accessor("name", {
          header: "Категория",
          cell: (info) => <span className="row-main">{info.getValue()}</span>,
        }),
        branchColumn.display({
          id: "linked",
          header: "Связано",
          cell: (info) => {
            const branch = info.row.original;
            return (
              <div>
                <div className="mono row-main">
                  {branch.linked} из {branch.dishes}
                </div>
                <div className="row-sub">
                  {branch.dishes - branch.linked > 0 ? `нет связи ${branch.dishes - branch.linked}` : "готово"}
                </div>
              </div>
            );
          },
        }),
        branchColumn.display({
          id: "paths",
          header: "Ветки кассы",
          cell: (info) => {
            const branch = info.row.original;
            return (
              <textarea
                className="textarea iiko-tree-textarea"
                rows={Math.max(2, branch.iiko_group_paths.length + 1)}
                value={draft[branch.category_id] ?? branch.iiko_group_paths.join("\n")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [branch.category_id]: event.target.value,
                  }))
                }
              />
            );
          },
        }),
      ]),
    [draft],
  );

  const data = tree.data;
  const keep = keepUnknown ?? data?.keep_unknown_groups ?? false;

  return (
    <div className="page-stack">
      <Section
        title="Дерево меню"
        action={
          <Button disabled={!data || save.isPending} onClick={() => data && save.mutate(data)}>
            <CheckCircle2 size={15} aria-hidden />
            {save.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        }
        description="Где в iiko искать блюда каждой категории и какие ветки исключать."
      >
        <div className="info-band">
          Ветка — начало пути группы в кассе. По одной в строке. Настройка общая для сети,
          потому что товары заводятся централизованно.
        </div>

        {tree.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить дерево меню</h2>
            <p>{errorMessage(tree.error)}</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={data?.branches ?? []}
            density="regular"
            getRowId={(row) => row.category_id}
            isLoading={tree.isPending}
            pageSize={20}
          />
        )}
      </Section>

      {data ? (
        <Section title="Общие правила сети">
          <div className="tree-rules-grid">
            <label className="field">
              <span className="field-label">Мусорные метки</span>
              <textarea
                className="textarea iiko-rules-textarea"
                value={deny ?? data.deny_markers.join("\n")}
                onChange={(event) => setDeny(event.target.value)}
              />
              <span className="row-sub">Ветку пропускаем, если путь содержит такой фрагмент.</span>
            </label>

            <label className="field">
              <span className="field-label">Ветки добавок</span>
              <textarea
                className="textarea iiko-rules-textarea"
                value={extras ?? data.extra_group_paths.join("\n")}
                onChange={(event) => setExtras(event.target.value)}
              />
              <span className="row-sub">Где лежат модификаторы: соусы, тесто, сыр и прочие добавки.</span>
            </label>
          </div>

          <label className="inline-check warn-check">
            <input checked={keep} type="checkbox" onChange={() => setKeepUnknown(!keep)} />
            Забирать с кассы всё, включая ветки вне меню
          </label>
          <div className="row-sub">
            Нужен только на этапе разбора дерева: иначе в приложение может попасть весь справочник точки.
          </div>
        </Section>
      ) : null}
    </div>
  );
}

export function IikoTab() {
  const [pane, setPane] = useState<Pane>("bridges");
  const [restaurantId, setRestaurantId] = useState("");

  const panes: { icon: typeof Building2; key: Pane; label: string }[] = [
    { icon: Building2, key: "bridges", label: "Плагины" },
    { icon: Link2, key: "links", label: "Связи" },
    { icon: ListTree, key: "tree", label: "Дерево" },
    { icon: Send, key: "queue", label: "Очередь" },
  ];

  return (
    <div className="page-stack">
      <Section
        title="iiko"
        action={
          <div className="tabs" aria-label="Раздел iiko">
            {panes.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className="tab-button"
                  data-active={pane === item.key}
                  type="button"
                  onClick={() => setPane(item.key)}
                >
                  <Icon size={15} aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </div>
        }
        description="Плагины ресторанов, сопоставление номенклатуры, дерево iiko и очередь заказов."
      >
        <div className="info-band">
          Ключ и сопоставление хранятся отдельно для каждой точки: база iiko у ресторанов своя,
          а заказ на кухню уходит только когда все активные блюда связаны с кассой.
        </div>
      </Section>

      {pane === "bridges" ? (
        <Bridges
          onOpenLinks={(id) => {
            setRestaurantId(id);
            setPane("links");
          }}
        />
      ) : null}
      {pane === "links" ? <Links restaurantId={restaurantId} onRestaurantChange={setRestaurantId} /> : null}
      {pane === "tree" ? <Tree /> : null}
      {pane === "queue" ? <Queue /> : null}
    </div>
  );
}
