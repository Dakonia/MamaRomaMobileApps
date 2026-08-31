import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Filter,
  Hash,
  Link2,
  ListTree,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Store,
  Trash2,
  Unlink,
  Utensils,
  Wand2,
  X,
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
import { Badge, Button, IconButton, Section, Select, cn } from "./ui";

type Pane = "bridges" | "links" | "tree" | "queue";
type MatchFilter = "unmatched" | "matched" | "price" | "all";
type LinkKindFilter = "all" | "dish" | "extra";
type TreeGroupScope = "suggested" | "free" | "selected" | "all";
type TreeTargetKind = "category" | "extras" | "deny";

type DraftPick = {
  code?: string | null;
  groupPath?: string | null;
  id: string;
  name: string;
  priceKopecks?: number;
  productType?: string | null;
};

const bridgeColumn = createAdminColumnHelper<Bridge>();
const queueColumn = createAdminColumnHelper<Handoff>();

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
    priceKopecks: row.iiko_price_kopecks,
    productType: row.product_type,
  };
}

function pickFromProduct(product: IikoProduct): DraftPick {
  return {
    code: product.code,
    groupPath: product.group_path,
    id: product.product_id,
    name: product.name,
    priceKopecks: product.price_kopecks,
    productType: product.product_type,
  };
}

function rowCategory(row: IikoLink): string {
  return row.group ?? "Без категории";
}

function kindLabel(kind: IikoLink["kind"]): string {
  return kind === "dish" ? "Блюдо" : "Добавка";
}

function iikoPrice(pick: DraftPick | null): number {
  return pick?.priceKopecks ?? 0;
}

function priceDelta(row: IikoLink, pick: DraftPick | null): number | null {
  const theirPrice = iikoPrice(pick);
  if (!pick || row.our_price_kopecks <= 0 || theirPrice <= 0) return null;
  return theirPrice - row.our_price_kopecks;
}

function hasPriceDiff(row: IikoLink, pick: DraftPick | null): boolean {
  const delta = priceDelta(row, pick);
  return delta !== null && delta !== 0;
}

function priceDeltaLabel(delta: number | null): string {
  if (delta === null) return "нет цены";
  if (delta === 0) return "совпадает";
  return `${delta > 0 ? "+" : "-"}${formatPrice(Math.abs(delta))}`;
}

function linkBadge(row: IikoLink, pick: DraftPick | null, changed: boolean) {
  if (!pick) return <Badge text="нет связи" tone="warn" />;
  if (changed) return <Badge text="черновик" tone="accent" />;
  if (hasPriceDiff(row, pick)) return <Badge text="цена отличается" tone="warn" />;
  return <Badge text="готово" tone="ok" />;
}

function compactSearch(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[\s.,;:()№#₽"']/g, "");
}

function priceSearchParts(value: number): string[] {
  if (value <= 0) return [];
  return [formatPrice(value), String(Math.round(value / 100)), String(value)];
}

function linkMatchesSearch(row: IikoLink, pick: DraftPick | null, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("ru-RU");
  if (!needle) return true;

  const fields = [
    row.name,
    rowCategory(row),
    row.product_name ?? "",
    row.product_code ?? "",
    row.product_group_path ?? "",
    pick?.name ?? "",
    pick?.code ?? "",
    pick?.groupPath ?? "",
    ...priceSearchParts(row.our_price_kopecks),
    ...priceSearchParts(iikoPrice(pick)),
  ];
  const haystack = fields.join(" ").toLocaleLowerCase("ru-RU");
  return haystack.includes(needle) || compactSearch(haystack).includes(compactSearch(needle));
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

function ProductCandidate({
  onPick,
  product,
  row,
}: {
  onPick: (product: IikoProduct) => void;
  product: IikoProduct;
  row: IikoLink;
}) {
  const delta = priceDelta(row, pickFromProduct(product));

  return (
    <button
      className="iiko-candidate-button"
      data-price={delta === 0 ? "same" : delta === null ? "unknown" : "diff"}
      title={product.group_path ?? product.group_name ?? ""}
      type="button"
      onClick={() => onPick(product)}
    >
      <span className="row-main">{product.name}</span>
      <span className="row-sub">
        {product.code ? `код ${product.code}` : "без кода"}
        {product.product_type ? ` · ${product.product_type}` : ""}
      </span>
      <span className="iiko-candidate-meta">
        <strong>{formatPrice(product.price_kopecks)}</strong>
        <small>{priceDeltaLabel(delta)}</small>
      </span>
    </button>
  );
}

function ProductPicker({
  groups,
  onClose,
  onPick,
  restaurantId,
  row,
}: {
  groups: string[];
  onClose: () => void;
  onPick: (product: IikoProduct) => void;
  restaurantId: string;
  row: IikoLink;
}) {
  const [query, setQuery] = useState(row.name);
  const [typed, setTyped] = useState(row.name);
  const priceQuery = row.our_price_kopecks > 0 ? String(Math.round(row.our_price_kopecks / 100)) : "";

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), 300);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const found = useQuery({
    queryKey: ["iiko-search", restaurantId, query, groups],
    queryFn: () => api.searchIikoProducts(restaurantId, query, groups),
  });

  const products = found.data ?? [];

  return (
    <>
      <div className="command-overlay" onClick={onClose} />
      <section aria-modal="true" className="iiko-picker-dialog" role="dialog">
        <div className="iiko-picker-head">
          <div className="iiko-picker-title">
            <span className="iiko-match-icon" data-kind={row.kind}>
              {row.kind === "dish" ? <Utensils size={16} aria-hidden /> : <CircleDollarSign size={16} aria-hidden />}
            </span>
            <div className="min-w-0">
              <span className="metric-label">{kindLabel(row.kind)} в приложении</span>
              <h2>{row.name}</h2>
              <div className="row-sub">
                {rowCategory(row)} · {formatPrice(row.our_price_kopecks)}
              </div>
            </div>
          </div>
          <IconButton label="Закрыть поиск" size="sm" variant="quiet" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>

        <div className="iiko-picker-search">
          <label className="field">
            <span className="field-label">Поиск товара iiko</span>
            <span className="search-control">
              <Search className="search-icon" size={15} aria-hidden />
              <input
                autoFocus
                className="input"
                placeholder="Название, код, цена, группа"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </span>
          </label>
          <div className="iiko-quick-search">
            <Button size="xs" variant="ghost" onClick={() => setTyped(row.name)}>
              <Search size={14} aria-hidden />
              По названию
            </Button>
            {priceQuery ? (
              <Button size="xs" variant="ghost" onClick={() => setTyped(priceQuery)}>
                <CircleDollarSign size={14} aria-hidden />
                По цене
              </Button>
            ) : null}
            <span className="row-sub">{groups.length > 0 ? `${groups.length} групп` : "вся касса"}</span>
          </div>
        </div>

        <div className="iiko-picker-results">
          {found.isPending ? (
            <div className="empty-state">
              <h2>Идёт поиск</h2>
              <p>Проверяем номенклатуру выбранной точки.</p>
            </div>
          ) : products.length === 0 ? (
            <div className="empty-state">
              <h2>Ничего не нашлось</h2>
              <p>Попробуйте цену, код товара или другую ветку номенклатуры.</p>
            </div>
          ) : (
            products.map((product) => (
              <button
                key={product.product_id}
                className="iiko-picker-row"
                data-price={priceDelta(row, pickFromProduct(product)) === 0 ? "same" : "diff"}
                type="button"
                onClick={() => onPick(product)}
              >
                <span className="iiko-picker-row-main">
                  <strong>{product.name}</strong>
                  <small>{product.group_path ?? product.group_name ?? "без группы"}</small>
                </span>
                <span className="iiko-picker-row-meta">
                  <span className="mono">{formatPrice(product.price_kopecks)}</span>
                  <small>{product.code ? `код ${product.code}` : "без кода"}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function IikoMatchCard({
  changed,
  onClear,
  onPick,
  onSearch,
  pick,
  row,
}: {
  changed: boolean;
  onClear: () => void;
  onPick: (product: IikoProduct) => void;
  onSearch: () => void;
  pick: DraftPick | null;
  row: IikoLink;
}) {
  const delta = priceDelta(row, pick);
  const state = !pick ? "missing" : hasPriceDiff(row, pick) ? "price" : "ready";

  return (
    <article className="iiko-match-card" data-state={state}>
      <div className="iiko-match-side">
        <div className="iiko-match-kicker">
          <Badge text={kindLabel(row.kind)} tone={row.kind === "dish" ? "accent" : "muted"} />
          {linkBadge(row, pick, changed)}
        </div>
        <h3>{row.name}</h3>
        <div className="iiko-match-subline">
          <ListTree size={14} aria-hidden />
          <span>{rowCategory(row)}</span>
        </div>
        <div className="iiko-price-card">
          <span>Цена в приложении</span>
          <strong>{formatPrice(row.our_price_kopecks)}</strong>
        </div>
      </div>

      <div className="iiko-match-arrow" aria-hidden>
        <ArrowRight size={17} />
      </div>

      <div className="iiko-match-side">
        {pick ? (
          <>
            <div className="iiko-match-kicker">
              <Badge text="товар iiko" tone="ok" />
              {pick.code ? (
                <span className="iiko-code-pill">
                  <Hash size={12} aria-hidden />
                  {pick.code}
                </span>
              ) : null}
            </div>
            <h3 className={cn(changed && "iiko-draft-title")}>{pick.name}</h3>
            <div className="iiko-match-subline">
              <Store size={14} aria-hidden />
              <span>{pick.groupPath || "без группы"}</span>
            </div>
            <div className="iiko-price-compare" data-state={delta === 0 ? "same" : delta === null ? "unknown" : "diff"}>
              <span>
                <small>iiko</small>
                <strong>{iikoPrice(pick) > 0 ? formatPrice(iikoPrice(pick)) : "нет цены"}</strong>
              </span>
              <span>
                <small>разница</small>
                <strong>{priceDeltaLabel(delta)}</strong>
              </span>
            </div>
          </>
        ) : (
          <div className="iiko-empty-match">
            <AlertTriangle size={17} aria-hidden />
            <strong>Товар iiko не выбран</strong>
            <span>Заказ с этой позицией не сможет уйти на кассу.</span>
          </div>
        )}
      </div>

      <div className="iiko-match-actions">
        <Button size="xs" variant="ghost" onClick={onSearch}>
          <Search size={14} aria-hidden />
          {pick ? "Сменить" : "Найти"}
        </Button>
        {pick ? (
          <Button size="xs" variant="danger" onClick={onClear}>
            <Unlink size={14} aria-hidden />
            Снять
          </Button>
        ) : null}
      </div>

      {row.suggestions.length > 0 ? (
        <div className="iiko-candidates">
          <span className="metric-label">Кандидаты</span>
          <div className="iiko-candidate-grid">
            {row.suggestions.slice(0, 4).map((product) => (
              <ProductCandidate key={product.product_id} product={product} row={row} onPick={onPick} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
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
  const [groupSearch, setGroupSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("unmatched");
  const [kindFilter, setKindFilter] = useState<LinkKindFilter>("dish");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [draft, setDraft] = useState<Record<string, DraftPick>>({});
  const [picking, setPicking] = useState<IikoLink | null>(null);
  const [copySource, setCopySource] = useState("");
  const [copyOverwrite, setCopyOverwrite] = useState(false);
  const [showAllGroups, setShowAllGroups] = useState(false);

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

  const bridgeRows = bridges.data ?? [];
  const currentBridge = useMemo(
    () => bridgeRows.find((row) => row.restaurant_id === restaurantId) ?? null,
    [bridgeRows, restaurantId],
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
    setCopySource("");
    setGroupSearch("");
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

  const pickForRow = (row: IikoLink) => currentPick(row, draft);
  const selectedProductId = (row: IikoLink) => pickForRow(row)?.id ?? "";
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

  const copyLinks = useMutation({
    mutationFn: () => api.copyIikoLinks(copySource, restaurantId, copyOverwrite),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (result) => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ["iiko-links", restaurantId] });
      void queryClient.invalidateQueries({ queryKey: ["iiko-bridges"] });
      toast.success(`Перенесено ${result.copied}, пропущено ${result.skipped}`);
    },
  });

  const allRows = links.data ?? [];
  const total = allRows.length;
  const linked = allRows.filter(isRowLinked).length;
  const unlinked = total - linked;
  const dishTotal = allRows.filter((row) => row.kind === "dish").length;
  const dishLinked = allRows.filter((row) => row.kind === "dish" && isRowLinked(row)).length;
  const extraTotal = allRows.filter((row) => row.kind === "extra").length;
  const extraLinked = allRows.filter((row) => row.kind === "extra" && isRowLinked(row)).length;
  const priceMismatches = allRows.filter((row) => isRowLinked(row) && hasPriceDiff(row, pickForRow(row))).length;
  const changed = Object.keys(draft).length;
  const progress = total > 0 ? Math.round((linked / total) * 100) : 0;

  const categoryStats = useMemo(() => {
    const byCategory = new Map<
      string,
      { dishes: number; extras: number; linked: number; name: string; priceDiffs: number; total: number }
    >();

    for (const row of allRows) {
      const name = rowCategory(row);
      const current = byCategory.get(name) ?? { dishes: 0, extras: 0, linked: 0, name, priceDiffs: 0, total: 0 };
      const pick = pickForRow(row);
      current.total += 1;
      if (pick) current.linked += 1;
      if (hasPriceDiff(row, pick)) current.priceDiffs += 1;
      if (row.kind === "dish") current.dishes += 1;
      if (row.kind === "extra") current.extras += 1;
      byCategory.set(name, current);
    }

    return [...byCategory.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ru"));
  }, [allRows, draft]);

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!categoryStats.some((item) => item.name === categoryFilter)) setCategoryFilter("all");
  }, [categoryFilter, categoryStats]);

  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        const pick = pickForRow(row);
        const linkedRow = Boolean(pick);
        if (matchFilter === "unmatched" && linkedRow) return false;
        if (matchFilter === "matched" && !linkedRow) return false;
        if (matchFilter === "price" && !hasPriceDiff(row, pick)) return false;
        if (kindFilter !== "all" && row.kind !== kindFilter) return false;
        if (categoryFilter !== "all" && rowCategory(row) !== categoryFilter) return false;
        return linkMatchesSearch(row, pick, search);
      }),
    [allRows, categoryFilter, draft, kindFilter, matchFilter, search],
  );

  const groupNeedle = groupSearch.trim().toLocaleLowerCase("ru-RU");
  const groupRows = useMemo(() => {
    const source = allGroups.data ?? [];
    const filtered = source.filter((group) => {
      if (!groupNeedle) return group.is_preset || groups.includes(group.path);
      return `${group.name} ${group.path}`.toLocaleLowerCase("ru-RU").includes(groupNeedle);
    });
    return filtered.slice(0, showAllGroups || groupNeedle ? 80 : 18);
  }, [allGroups.data, groupNeedle, groups, showAllGroups]);
  const hiddenGroups = Math.max(0, (allGroups.data ?? []).length - groupRows.length);

  const copyOptions = bridgeRows.filter((row) => row.restaurant_id !== restaurantId && row.linked_dishes + row.linked_extras > 0);
  const selectedCategory = categoryStats.find((item) => item.name === categoryFilter);

  return (
    <div className="page-stack iiko-links-page">
      <Section
        className="iiko-link-overview"
        title="Сопоставление iiko"
        action={
          <div className="surface-toolbar iiko-restaurant-toolbar">
            <div className="field">
              <span className="field-label">Ресторан</span>
              <Select
                value={restaurantId}
                options={[
                  { label: "Выберите ресторан", value: "" },
                  ...bridgeRows.map((row) => ({
                    label: row.restaurant_name,
                    description: `${row.linked_dishes} блюд · ${row.products} товаров`,
                    value: row.restaurant_id,
                  })),
                ]}
                onChange={onRestaurantChange}
              />
            </div>
          </div>
        }
      >
        {restaurantId === "" ? (
          <div className="empty-state">
            <h2>Выберите ресторан</h2>
            <p>После выбора загрузятся товары кассы, группы поиска и позиции меню.</p>
          </div>
        ) : (
          <>
            <div className="iiko-match-summary">
              <div className="iiko-progress-card">
                <div className="iiko-progress-head">
                  <span>
                    <strong>{currentBridge?.restaurant_name ?? "Ресторан"}</strong>
                    <small>{currentBridge && isOnline(currentBridge.last_seen_at) ? "плагин на связи" : sinceLabel(currentBridge?.last_seen_at ?? null)}</small>
                  </span>
                  <Badge text={`${progress}%`} tone={unlinked === 0 ? "ok" : "accent"} />
                </div>
                <div className="iiko-progress-track">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="iiko-progress-foot">
                  <span>{linked}/{total} связей</span>
                  <span>{unlinked} без товара</span>
                  <span>{priceMismatches} цен проверить</span>
                </div>
              </div>

              <Metric label="Блюда" note={`без связи ${Math.max(dishTotal - dishLinked, 0)}`} value={`${dishLinked}/${dishTotal}`} />
              <Metric label="Добавки" note="модификаторы iiko" value={`${extraLinked}/${extraTotal}`} />
              <Metric
                label="Номенклатура"
                note={groups.length > 0 ? `${groups.length} групп в поиске` : "поиск по всей кассе"}
                value={String(currentBridge?.products ?? 0)}
              />
            </div>
          </>
        )}
      </Section>

      {restaurantId !== "" ? (
        <div className="iiko-secondary-tools">
          <details className="iiko-transfer-panel">
            <summary>
              <span className="iiko-transfer-copy">
                <Copy size={16} aria-hidden />
                <span>
                  <strong>Сопоставить как в другой точке</strong>
                  <small>По тем же блюдам, добавкам и кодам товаров</small>
                </span>
              </span>
              <strong>{copySource ? "источник выбран" : "выбрать источник"}</strong>
            </summary>
            <div className="iiko-transfer-controls">
              <Select
                value={copySource}
                placeholder="Ресторан-источник"
                options={[
                  { label: "Ресторан-источник", value: "" },
                  ...copyOptions.map((row) => ({
                    label: row.restaurant_name,
                    description: `${row.linked_dishes} блюд · ${row.linked_extras} добавок`,
                    value: row.restaurant_id,
                  })),
                ]}
                onChange={setCopySource}
              />
              <label className="inline-check">
                <input checked={copyOverwrite} type="checkbox" onChange={() => setCopyOverwrite((value) => !value)} />
                Перезаписать текущие
              </label>
              <Button disabled={!copySource || copyLinks.isPending} onClick={() => copyLinks.mutate()}>
                <Copy size={15} aria-hidden />
                {copyLinks.isPending ? "Переносим..." : "Перенести"}
              </Button>
            </div>
          </details>

          <details className="iiko-groups-panel">
            <summary>
              <span>
                <ListTree size={15} aria-hidden />
                Группы поиска
              </span>
              <strong>{groups.length > 0 ? `${groups.length} выбрано` : "вся касса"}</strong>
            </summary>
            <div className="iiko-groups-toolbar">
              <label className="field toolbar-field">
                <span className="field-label">Найти группу</span>
                <span className="search-control">
                  <Search className="search-icon" size={15} aria-hidden />
                  <input
                    className="input"
                    placeholder="Пицца, модификаторы, кухня"
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                  />
                </span>
              </label>
              <Button disabled={presetGroups.length === 0} variant="ghost" onClick={() => saveGroups(presetGroups)}>
                <ListTree size={15} aria-hidden />
                Группы меню
              </Button>
              <Button variant="ghost" onClick={() => saveGroups([])}>
                <Store size={15} aria-hidden />
                Вся касса
              </Button>
            </div>
            <div className="iiko-group-grid">
              {groupRows.map((group) => {
                const picked = groups.includes(group.path);
                return (
                  <button
                    key={group.path}
                    className="iiko-group-button"
                    data-active={picked}
                    data-preset={group.is_preset}
                    title={group.path}
                    type="button"
                    onClick={() => pickGroup(group.path)}
                  >
                    <span>{group.name}</span>
                    <small>{group.products} товаров</small>
                  </button>
                );
              })}
            </div>
            {hiddenGroups > 0 && !groupNeedle ? (
              <Button size="xs" variant="ghost" onClick={() => setShowAllGroups((value) => !value)}>
                {showAllGroups ? "Свернуть группы" : `Показать ещё ${hiddenGroups}`}
              </Button>
            ) : null}
          </details>
        </div>
      ) : null}

      {restaurantId !== "" ? (
        <Section
          className="iiko-link-positions"
          title={`Позиции · ${linked} из ${total}`}
          action={
            <div className="surface-toolbar">
              <Button disabled={auto.isPending} variant="ghost" onClick={() => auto.mutate()}>
                <Wand2 size={15} aria-hidden />
                {auto.isPending ? "Ищем..." : "Автосвязать"}
              </Button>
              <Button disabled={changed === 0 || save.isPending} onClick={() => save.mutate()}>
                <CheckCircle2 size={15} aria-hidden />
                {save.isPending ? "Сохраняем..." : changed > 0 ? `Сохранить (${changed})` : "Сохранить"}
              </Button>
            </div>
          }
        >
          <div className="surface-toolbar iiko-filter-toolbar">
            <label className="field toolbar-field">
              <span className="field-label">Поиск</span>
              <span className="search-control">
                <Search className="search-icon" size={15} aria-hidden />
                <input
                  className="input"
                  placeholder="Название, код, цена 1430, группа"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <div className="filter-chips" aria-label="Статус связи">
              <button className="filter-chip" data-active={matchFilter === "unmatched"} type="button" onClick={() => setMatchFilter("unmatched")}>
                Нет связи
              </button>
              <button className="filter-chip" data-active={matchFilter === "price"} type="button" onClick={() => setMatchFilter("price")}>
                Цена отличается
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

          <div className="iiko-category-grid">
            <button
              className="iiko-category-card"
              data-active={categoryFilter === "all"}
              type="button"
              onClick={() => setCategoryFilter("all")}
            >
              <span className="row-main">Все категории</span>
              <span className="row-sub">нет связи {unlinked}</span>
              <span className="iiko-category-progress"><i style={{ width: `${progress}%` }} /></span>
            </button>
            {categoryStats.map((item) => {
              const missing = item.total - item.linked;
              const categoryProgress = item.total > 0 ? Math.round((item.linked / item.total) * 100) : 0;
              return (
                <button
                  key={item.name}
                  className="iiko-category-card"
                  data-active={categoryFilter === item.name}
                  type="button"
                  onClick={() => setCategoryFilter((current) => (current === item.name ? "all" : item.name))}
                >
                  <span className="row-main">{item.name}</span>
                  <span className="row-sub">
                    {item.linked}/{item.total} · {missing > 0 ? `${missing} без связи` : "готово"}
                  </span>
                  <span className="iiko-category-progress"><i style={{ width: `${categoryProgress}%` }} /></span>
                </button>
              );
            })}
          </div>

          {selectedCategory ? (
            <div className="iiko-category-focus">
              <Filter size={15} aria-hidden />
              <span>{selectedCategory.name}</span>
              <strong>{selectedCategory.linked}/{selectedCategory.total}</strong>
              {selectedCategory.priceDiffs > 0 ? <Badge text={`${selectedCategory.priceDiffs} цен проверить`} tone="warn" /> : null}
            </div>
          ) : null}

          {links.isPending ? (
            <div className="iiko-match-list" data-density={density}>
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="skeleton skeleton-card" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <h2>Ничего не найдено</h2>
              <p>Смените фильтр, категорию или поисковую строку.</p>
            </div>
          ) : (
            <div className="iiko-match-list" data-density={density}>
              {rows.map((row) => {
                const key = keyOf(row);
                return (
                  <IikoMatchCard
                    key={key}
                    changed={draft[key] !== undefined}
                    pick={pickForRow(row)}
                    row={row}
                    onClear={() =>
                      setDraft((current) => ({
                        ...current,
                        [key]: { id: "", name: "", priceKopecks: 0 },
                      }))
                    }
                    onPick={(product) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: pickFromProduct(product),
                      }))
                    }
                    onSearch={() => setPicking(row)}
                  />
                );
              })}
            </div>
          )}

          {changed > 0 ? (
            <div className="iiko-save-strip">
              <span>{changed} изменений не сохранено</span>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                <CheckCircle2 size={15} aria-hidden />
                {save.isPending ? "Сохраняем..." : "Сохранить"}
              </Button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {picking ? (
        <ProductPicker
          groups={groups}
          restaurantId={restaurantId}
          row={picking}
          onClose={() => setPicking(null)}
          onPick={(product) => {
            setDraft((current) => ({
              ...current,
              [keyOf(picking)]: pickFromProduct(product),
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
  return cleanTreePaths(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

function cleanTreePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
}

function treeTargetKey(categoryId: string): string {
  return `category:${categoryId}`;
}

function treeTargetKind(targetKey: string): TreeTargetKind {
  if (targetKey === "extras") return "extras";
  if (targetKey === "deny") return "deny";
  return "category";
}

function treePathTitle(path: string): string {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function treePathParent(path: string): string {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, -1).join(" / ");
}

function normalizeTreeTerm(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function treeGroupMatchesTarget(kind: TreeTargetKind, branch: MenuBranch | null, group: IikoGroup): boolean {
  const source = normalizeTreeTerm(`${group.name} ${group.path}`);
  if (!source) return false;

  if (kind === "category" && branch) {
    const words = normalizeTreeTerm(branch.name)
      .split(" ")
      .filter((word) => word.length > 2);
    return words.some((word) => source.includes(word));
  }

  if (kind === "extras") return /добав|модиф|соус|сыр|тест|топп|опц/.test(source);
  return /архив|служ|заготов|сырье|тара|посуд|old|test|тест|стоп|удален/.test(source);
}

function Tree({
  onRestaurantChange,
  restaurantId,
}: {
  onRestaurantChange: (id: string) => void;
  restaurantId: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [deny, setDeny] = useState<string[] | null>(null);
  const [extras, setExtras] = useState<string[] | null>(null);
  const [keepUnknown, setKeepUnknown] = useState<boolean | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupScope, setGroupScope] = useState<TreeGroupScope>("suggested");
  const [showAllGroups, setShowAllGroups] = useState(false);

  const bridges = useQuery({
    queryKey: ["iiko-bridges"],
    queryFn: api.bridges,
    refetchInterval: 30000,
  });
  const tree = useQuery({ queryKey: ["iiko-menu-tree"], queryFn: api.menuTree });
  const groups = useQuery({
    queryKey: ["iiko-groups", restaurantId],
    queryFn: () => api.iikoGroups(restaurantId),
    enabled: restaurantId !== "",
  });

  useEffect(() => {
    if (restaurantId !== "" || !bridges.data || bridges.data.length === 0) return;
    const preferred =
      bridges.data.find((row) => row.is_registered && row.products > 0)?.restaurant_id ??
      bridges.data[0].restaurant_id;
    onRestaurantChange(preferred);
  }, [bridges.data, onRestaurantChange, restaurantId]);

  const data = tree.data;
  const branches = data?.branches ?? [];

  useEffect(() => {
    if (branches.length === 0) return;
    if (targetKey === "extras" || targetKey === "deny") return;
    const selectedId = targetKey.replace("category:", "");
    if (!selectedId || !branches.some((branch) => branch.category_id === selectedId)) {
      setTargetKey(treeTargetKey(branches[0].category_id));
    }
  }, [branches, targetKey]);

  useEffect(() => {
    setGroupSearch("");
    setGroupScope("suggested");
    setShowAllGroups(false);
  }, [targetKey]);

  const bridgeRows = bridges.data ?? [];
  const keep = keepUnknown ?? data?.keep_unknown_groups ?? false;
  const extraPaths = cleanTreePaths(extras ?? data?.extra_group_paths ?? []);
  const denyPaths = cleanTreePaths(deny ?? data?.deny_markers ?? []);
  const kind = treeTargetKind(targetKey);
  const selectedBranchId = targetKey.replace("category:", "");
  const selectedBranch =
    kind === "category"
      ? branches.find((branch) => branch.category_id === selectedBranchId) ?? branches[0] ?? null
      : null;
  const activeTargetKey = selectedBranch ? treeTargetKey(selectedBranch.category_id) : targetKey;

  const pathsForBranch = (branch: MenuBranch) =>
    cleanTreePaths(draft[branch.category_id] ?? branch.iiko_group_paths);

  const selectedPaths =
    kind === "extras"
      ? extraPaths
      : kind === "deny"
        ? denyPaths
        : selectedBranch
          ? pathsForBranch(selectedBranch)
          : [];
  const selectedSet = new Set(selectedPaths);

  const setSelectedPaths = (next: string[]) => {
    const cleaned = cleanTreePaths(next);
    if (kind === "extras") {
      setExtras(cleaned);
      return;
    }
    if (kind === "deny") {
      setDeny(cleaned);
      return;
    }
    if (!selectedBranch) return;
    setDraft((current) => ({ ...current, [selectedBranch.category_id]: cleaned }));
  };

  const pathOwners = useMemo(() => {
    const owners = new Map<string, string[]>();
    const addOwner = (path: string, owner: string) => {
      const current = owners.get(path) ?? [];
      if (!current.includes(owner)) owners.set(path, [...current, owner]);
    };

    for (const branch of branches) {
      for (const path of pathsForBranch(branch)) addOwner(path, branch.name);
    }
    for (const path of extraPaths) addOwner(path, "Добавки");
    for (const path of denyPaths) addOwner(path, "Исключено");

    return owners;
  }, [branches, denyPaths, draft, extraPaths]);

  const targetName =
    kind === "extras"
      ? "Ветки добавок"
      : kind === "deny"
        ? "Исключить из меню"
        : selectedBranch?.name ?? "Категория";
  const targetHint =
    kind === "extras"
      ? "Модификаторы, соусы, тесто, сыр и другие добавки."
      : kind === "deny"
        ? "Служебные, архивные и технические группы, которые не должны попадать в меню."
        : "Группы iiko, где лежат блюда этой категории.";

  const hasChanges =
    Object.keys(draft).length > 0 ||
    extras !== null ||
    deny !== null ||
    keepUnknown !== null;
  const configuredBranches = branches.filter((branch) => pathsForBranch(branch).length > 0).length;
  const totalBranchPaths = branches.reduce((sum, branch) => sum + pathsForBranch(branch).length, 0);
  const totalGroups = groups.data?.length ?? 0;
  const visibleBranches = branches.filter((branch) => {
    const needle = normalizeTreeTerm(categorySearch);
    if (!needle) return true;
    return normalizeTreeTerm(branch.name).includes(needle);
  });
  const groupNeedle = normalizeTreeTerm(groupSearch);
  const matchingGroups = (groups.data ?? []).filter((group) => {
    const path = group.path || group.name;
    if (!path) return false;
    const groupText = normalizeTreeTerm(`${group.name} ${group.path}`);
    if (groupNeedle && !groupText.includes(groupNeedle)) return false;
    const owners = pathOwners.get(path) ?? [];
    const selected = selectedSet.has(path);
    const suggested = treeGroupMatchesTarget(kind, selectedBranch, group);
    if (groupScope === "selected") return selected;
    if (groupScope === "free") return selected || owners.length === 0;
    if (groupScope === "suggested") return selected || suggested;
    return true;
  });
  const visibleGroups = matchingGroups.slice(0, showAllGroups ? 160 : 48);
  const hiddenGroups = Math.max(0, matchingGroups.length - visibleGroups.length);
  const suggestedPaths = cleanTreePaths(
    (groups.data ?? [])
      .filter((group) => treeGroupMatchesTarget(kind, selectedBranch, group))
      .map((group) => group.path || group.name),
  );

  const save = useMutation({
    mutationFn: (payload: MenuTree) =>
      api.saveMenuTree({
        branches: payload.branches.map((branch) => ({
          category_id: branch.category_id,
          iiko_group_paths: pathsForBranch(branch),
        })),
        deny_markers: denyPaths,
        extra_group_paths: extraPaths,
        keep_unknown_groups: keep,
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

  const togglePath = (path: string) => {
    setSelectedPaths(
      selectedSet.has(path)
        ? selectedPaths.filter((item) => item !== path)
        : [...selectedPaths, path],
    );
  };

  return (
    <div className="page-stack iiko-tree-page">
      <Section
        className="iiko-tree-overview"
        title="Дерево меню"
        action={
          <div className="surface-toolbar iiko-tree-actions">
            <label className="field">
              <span className="field-label">Группы из ресторана</span>
              <Select
                value={restaurantId}
                options={[
                  { label: "Выберите ресторан", value: "" },
                  ...bridgeRows.map((row) => ({
                    label: row.restaurant_name,
                    description: `${row.products} товаров · ${row.linked_dishes} связей`,
                    value: row.restaurant_id,
                  })),
                ]}
                onChange={onRestaurantChange}
              />
            </label>
            <Button disabled={!data || !hasChanges || save.isPending} onClick={() => data && save.mutate(data)}>
              <CheckCircle2 size={15} aria-hidden />
              {save.isPending ? "Сохраняем..." : hasChanges ? "Сохранить" : "Сохранено"}
            </Button>
          </div>
        }
      >
        {tree.error ? (
          <div className="error-state">
            <h2>Не удалось загрузить дерево меню</h2>
            <p>{errorMessage(tree.error)}</p>
          </div>
        ) : (
          <div className="iiko-tree-summary">
            <div className="iiko-tree-summary-card">
              <ListTree size={17} aria-hidden />
              <span>
                <strong>{configuredBranches}/{branches.length}</strong>
                <small>категорий настроено</small>
              </span>
            </div>
            <div className="iiko-tree-summary-card">
              <Link2 size={17} aria-hidden />
              <span>
                <strong>{totalBranchPaths}</strong>
                <small>веток блюд</small>
              </span>
            </div>
            <div className="iiko-tree-summary-card">
              <Store size={17} aria-hidden />
              <span>
                <strong>{totalGroups}</strong>
                <small>{restaurantId ? "групп iiko в точке" : "выберите ресторан"}</small>
              </span>
            </div>
            <div className="iiko-tree-summary-card">
              <Utensils size={17} aria-hidden />
              <span>
                <strong>{extraPaths.length}</strong>
                <small>веток добавок</small>
              </span>
            </div>
          </div>
        )}
      </Section>

      {tree.isPending ? (
        <Section title="Настройка веток">
          <div className="iiko-tree-layout">
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        </Section>
      ) : data ? (
        <Section className="iiko-tree-builder" title="Настройка веток">
          <div className="iiko-tree-layout">
            <aside className="iiko-tree-sidebar">
              <label className="field">
                <span className="field-label">Категория приложения</span>
                <span className="search-control">
                  <Search className="search-icon" size={15} aria-hidden />
                  <input
                    className="input"
                    placeholder="Пицца, салаты, паста"
                    value={categorySearch}
                    onChange={(event) => setCategorySearch(event.target.value)}
                  />
                </span>
              </label>

              <div className="iiko-tree-branch-list">
                {visibleBranches.map((branch) => {
                  const paths = pathsForBranch(branch);
                  const branchProgress = branch.dishes > 0 ? Math.round((branch.linked / branch.dishes) * 100) : 0;
                  return (
                    <button
                      key={branch.category_id}
                      className="iiko-tree-branch"
                      data-active={activeTargetKey === treeTargetKey(branch.category_id)}
                      type="button"
                      onClick={() => setTargetKey(treeTargetKey(branch.category_id))}
                    >
                      <span className="row-main">{branch.name}</span>
                      <span className="row-sub">
                        {paths.length > 0 ? `${paths.length} веток` : "ветки не выбраны"} · {branch.linked}/{branch.dishes}
                      </span>
                      <span className="iiko-category-progress"><i style={{ width: `${branchProgress}%` }} /></span>
                    </button>
                  );
                })}
              </div>

              <div className="iiko-tree-rule-targets">
                <button
                  className="iiko-tree-rule-target"
                  data-active={targetKey === "extras"}
                  type="button"
                  onClick={() => setTargetKey("extras")}
                >
                  <Utensils size={15} aria-hidden />
                  <span>
                    <strong>Добавки</strong>
                    <small>{extraPaths.length} веток</small>
                  </span>
                </button>
                <button
                  className="iiko-tree-rule-target"
                  data-active={targetKey === "deny"}
                  type="button"
                  onClick={() => setTargetKey("deny")}
                >
                  <Trash2 size={15} aria-hidden />
                  <span>
                    <strong>Исключить</strong>
                    <small>{denyPaths.length} меток</small>
                  </span>
                </button>
              </div>
            </aside>

            <div className="iiko-tree-editor">
              <div className="iiko-tree-editor-head">
                <span className="iiko-tree-target-icon" data-kind={kind}>
                  {kind === "deny" ? (
                    <Trash2 size={18} aria-hidden />
                  ) : kind === "extras" ? (
                    <Utensils size={18} aria-hidden />
                  ) : (
                    <ListTree size={18} aria-hidden />
                  )}
                </span>
                <span>
                  <strong>{targetName}</strong>
                  <small>{targetHint}</small>
                </span>
                <Badge text={`${selectedPaths.length} выбрано`} tone={selectedPaths.length > 0 ? "accent" : "muted"} />
              </div>

              <div className="iiko-tree-selected-paths">
                {selectedPaths.length > 0 ? (
                  selectedPaths.map((path) => (
                    <button key={path} className="iiko-tree-path-chip" type="button" onClick={() => togglePath(path)}>
                      <span>{treePathTitle(path)}</span>
                      <small>{treePathParent(path) || path}</small>
                      <X size={13} aria-hidden />
                    </button>
                  ))
                ) : (
                  <div className="iiko-tree-empty-inline">Ветки пока не выбраны</div>
                )}
              </div>

              <div className="surface-toolbar iiko-tree-toolbar">
                <label className="field toolbar-field">
                  <span className="field-label">Группы iiko</span>
                  <span className="search-control">
                    <Search className="search-icon" size={15} aria-hidden />
                    <input
                      className="input"
                      placeholder="Название или путь группы"
                      value={groupSearch}
                      onChange={(event) => setGroupSearch(event.target.value)}
                    />
                  </span>
                </label>
                <div className="filter-chips" aria-label="Фильтр групп iiko">
                  <button className="filter-chip" data-active={groupScope === "suggested"} type="button" onClick={() => setGroupScope("suggested")}>
                    Подходящие
                  </button>
                  <button className="filter-chip" data-active={groupScope === "free"} type="button" onClick={() => setGroupScope("free")}>
                    Свободные
                  </button>
                  <button className="filter-chip" data-active={groupScope === "selected"} type="button" onClick={() => setGroupScope("selected")}>
                    Выбранные
                  </button>
                  <button className="filter-chip" data-active={groupScope === "all"} type="button" onClick={() => setGroupScope("all")}>
                    Все
                  </button>
                </div>
                <span className="toolbar-spacer" />
                <Button
                  disabled={suggestedPaths.length === 0}
                  variant="ghost"
                  onClick={() => setSelectedPaths([...selectedPaths, ...suggestedPaths])}
                >
                  <Wand2 size={15} aria-hidden />
                  Подобрать
                </Button>
                <Button disabled={selectedPaths.length === 0} variant="danger" onClick={() => setSelectedPaths([])}>
                  <Trash2 size={15} aria-hidden />
                  Очистить
                </Button>
              </div>

              {groups.isPending ? (
                <div className="iiko-tree-group-grid">
                  {Array.from({ length: 12 }, (_, index) => (
                    <div key={index} className="skeleton skeleton-row" />
                  ))}
                </div>
              ) : visibleGroups.length === 0 ? (
                <div className="empty-state">
                  <h2>{restaurantId ? "Группы не найдены" : "Выберите ресторан"}</h2>
                  <p>
                    {restaurantId
                      ? "Проверьте выгрузку номенклатуры плагином или переключите фильтр групп."
                      : "После выбора точки здесь появятся группы iiko для добавления в дерево."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="iiko-tree-group-grid">
                    {visibleGroups.map((group) => {
                      const path = group.path || group.name;
                      const picked = selectedSet.has(path);
                      const owners = pathOwners.get(path) ?? [];
                      const suggested = treeGroupMatchesTarget(kind, selectedBranch, group);
                      return (
                        <button
                          key={path}
                          className="iiko-tree-group"
                          data-picked={picked}
                          data-suggested={suggested}
                          type="button"
                          onClick={() => togglePath(path)}
                        >
                          <span className="iiko-tree-group-head">
                            <strong>{group.name || treePathTitle(path)}</strong>
                            {picked ? <Badge text="выбрано" tone="accent" /> : suggested ? <Badge text="подходит" tone="ok" /> : null}
                          </span>
                          <span className="row-sub">{path}</span>
                          <span className="iiko-tree-group-foot">
                            <small>{group.products} товаров</small>
                            {owners.length > 0 ? <small>{owners.join(", ")}</small> : <small>свободно</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {hiddenGroups > 0 ? (
                    <Button variant="ghost" onClick={() => setShowAllGroups((value) => !value)}>
                      {showAllGroups ? "Показать меньше" : `Показать ещё ${hiddenGroups}`}
                    </Button>
                  ) : null}
                </>
              )}

              <details className="iiko-tree-manual">
                <summary>Ручной режим</summary>
                <textarea
                  className="textarea iiko-tree-textarea"
                  value={selectedPaths.join("\n")}
                  onChange={(event) => setSelectedPaths(split(event.target.value))}
                />
              </details>
            </div>
          </div>
        </Section>
      ) : null}

      {data ? (
        <Section className="iiko-tree-safety" title="Режим отбора">
          <label className="inline-check warn-check">
            <input checked={keep} type="checkbox" onChange={() => setKeepUnknown(!keep)} />
            Забирать с кассы всё, включая ветки вне меню
          </label>
          <div className="row-sub">
            Включать только для первичной выгрузки справочника: иначе в приложение может попасть лишняя номенклатура.
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
        className="iiko-root-section"
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
        <div className="info-band iiko-root-note">
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
      {pane === "tree" ? <Tree restaurantId={restaurantId} onRestaurantChange={setRestaurantId} /> : null}
      {pane === "queue" ? <Queue /> : null}
    </div>
  );
}
