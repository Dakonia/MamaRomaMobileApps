import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDateTime,
  type PermissionInfo,
  type RoleInfo,
  type Staff,
  type StaffDraft,
  type StaffRole,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import {
  DataTable,
  createAdminColumnHelper,
  useTableDensity,
} from "./components/patterns/DataTable";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { useAdminSession, usePermissions } from "./lib/admin-session";
import { Badge, Button, Section, Select } from "./ui";

const column = createAdminColumnHelper<Staff>();

const empty: StaffDraft = {
  email: "",
  name: "",
  role: "delivery_operator",
  password: "",
  overrides: {},
  restaurant_ids: [],
};

type StaffFilter = "all" | "active" | "disabled";

const FILTERS: { key: StaffFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Работают" },
  { key: "disabled", label: "Выключены" },
];

function roleTone(role: StaffRole): "accent" | "ok" | "muted" {
  if (role === "owner") return "accent";
  if (role === "courier" || role === "restaurant") return "muted";
  return "ok";
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  if (tens > 10 && tens < 20) return many;
  const ones = count % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

/**
 * Что написано под числом прав в таблице: видно ли, что права правили руками.
 * «Как в роли» значит, что человеку ничего не добавляли и не снимали.
 */
function overrideSummary(staff: Staff): string {
  const values = Object.values(staff.overrides);
  if (values.length === 0) return "как в роли";

  const added = values.filter(Boolean).length;
  const removed = values.length - added;
  const parts: string[] = [];
  if (added) parts.push(`+${added} сверх роли`);
  if (removed) parts.push(`−${removed} снято`);
  return parts.join(", ");
}

/** Откуда у сотрудника это право — из роли или его выдали лично. */
function permissionNote(
  permission: PermissionInfo,
  staff: Staff,
  granted: boolean,
): string {
  if (permission.owner_only) return "только суперпользователь";

  const overridden = permission.code in staff.overrides;
  if (overridden) return granted ? "добавлено лично" : "снято лично";
  return granted ? "даёт роль" : "роль не даёт";
}

/**
 * Флаг хранится только если отличается от набора роли. Вернули значение
 * к тому, что даёт роль — убираем запись совсем: тогда право поедет дальше
 * вместе с ролью, когда её набор поменяется.
 */
function withToggle(
  overrides: Record<string, boolean>,
  code: string,
  next: boolean,
  roleDefaults: string[],
): Record<string, boolean> {
  const copy = { ...overrides };
  if (next === roleDefaults.includes(code)) delete copy[code];
  else copy[code] = next;
  return copy;
}

export function StaffTab() {
  const queryClient = useQueryClient();
  const { staff: current } = useAdminSession();
  const { can } = usePermissions();

  const staff = useQuery({ queryKey: ["staff"], queryFn: api.staff });
  const catalog = useQuery({ queryKey: ["staff-catalog"], queryFn: api.staffCatalog });

  const [density] = useTableDensity();
  const [filter, setFilter] = useState<StaffFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<StaffDraft>(empty);
  const [removing, setRemoving] = useState<Staff | null>(null);

  const canManage = can("staff.manage");
  const roles = catalog.data?.roles ?? [];

  const rows = useMemo(() => {
    const all = staff.data ?? [];
    if (filter === "active") return all.filter((row) => row.is_active);
    if (filter === "disabled") return all.filter((row) => !row.is_active);
    return all;
  }, [filter, staff.data]);

  const selected = (staff.data ?? []).find((row) => row.id === selectedId) ?? null;

  const roleTitle = (role: StaffRole) => roles.find((item) => item.code === role)?.title ?? role;
  const defaultsFor = (role: StaffRole) =>
    roles.find((item) => item.code === role)?.permissions ?? [];

  const roleOptions = roles.map((role) => ({
    value: role.code,
    label: role.title,
    description: role.web_admin ? `${role.permissions.length} прав` : "пока без входа в админку",
  }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["staff"] });
  };

  const fail = (error: unknown) => {
    toast.error(error instanceof ApiError ? error.message : "Действие не выполнено");
  };

  const create = useMutation({
    mutationFn: api.createStaff,
    onSuccess: (row) => {
      toast.success(`${row.name} теперь в команде`);
      setCreating(false);
      setDraft(empty);
      setSelectedId(row.id);
      refresh();
    },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateStaff>[1] }) =>
      api.updateStaff(id, patch),
    onSuccess: () => refresh(),
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: api.deleteStaff,
    onSuccess: () => {
      toast.success("Сотрудник удалён");
      setRemoving(null);
      setSelectedId(null);
      refresh();
    },
    onError: fail,
  });

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: "Сотрудник",
          cell: (info) => (
            <div>
              <div className="row-main">{info.getValue()}</div>
              <div className="row-sub">{info.row.original.email}</div>
            </div>
          ),
        }),
        column.accessor("role", {
          header: "Роль",
          cell: (info) => (
            <Badge text={roleTitle(info.getValue())} tone={roleTone(info.getValue())} />
          ),
        }),
        column.accessor((row) => row.permissions.length, {
          id: "permissions",
          header: "Доступно",
          meta: { align: "right" },
          sortFn: "basic",
          cell: (info) => {
            const row = info.row.original;
            const total = catalog.data?.permissions.length ?? 0;
            return (
              <div className="staff-count">
                <strong className="mono">
                  {info.getValue()} из {total}
                </strong>
                <span>{overrideSummary(row)}</span>
              </div>
            );
          },
        }),
        column.accessor("online", {
          header: "Сейчас",
          cell: (info) => {
            const row = info.row.original;
            return info.getValue() ? (
              <span className="staff-online">
                <i aria-hidden /> в админке
              </span>
            ) : (
              <span className="row-sub">
                {row.last_login_at ? `был ${formatDateTime(row.last_login_at)}` : "ни разу не заходил"}
              </span>
            );
          },
        }),
        column.accessor("is_active", {
          header: "Доступ",
          cell: (info) =>
            info.getValue() ? (
              <Badge text="Работает" tone="ok" />
            ) : (
              <Badge text="Выключен" tone="bad" />
            ),
        }),
      ]),
    [catalog.data, roles],
  );

  return (
    <>
      <Section
        title="Сотрудники"
        description="Роль задаёт набор прав, флаги правят его под конкретного человека"
        action={
          canManage ? (
            <Button
              onClick={() => {
                setDraft(empty);
                setSelectedId(null);
                setCreating(true);
              }}
            >
              <Plus size={16} aria-hidden /> Завести сотрудника
            </Button>
          ) : undefined
        }
      >
        <div className="surface-toolbar">
          <div className="filter-chips" aria-label="Фильтр сотрудников">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                className="filter-chip"
                data-active={filter === item.key}
                type="button"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

        </div>

        <DataTable
          columns={columns}
          data={rows}
          density={density}
          empty={
            <div className="empty-state">
              <h2>Сотрудников нет</h2>
              <p>Заведите первого — доступ в админку выдаётся ролью и точечными правами.</p>
            </div>
          }
          getRowId={(row) => row.id}
          isLoading={staff.isPending}
          selectedId={selectedId}
          onRowClick={(row) => {
            setCreating(false);
            setSelectedId(row.id);
          }}
        />
      </Section>

      {creating ? (
        <DetailDrawer
          className="staff-drawer"
          title="Новый сотрудник"
          subtitle="Права можно поправить сразу после создания"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Отмена
              </Button>
              <Button
                disabled={create.isPending}
                onClick={() =>
                  create.mutate({ ...draft, email: draft.email.trim().toLowerCase() })
                }
              >
                {create.isPending ? "Создаём…" : "Завести"}
              </Button>
            </>
          }
        >
          <div className="drawer-section">
            <label className="field">
              <span className="field-label">Имя</span>
              <input
                className="input"
                placeholder="Как обращаться к сотруднику"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label className="field">
              <span className="field-label">Почта</span>
              <input
                className="input"
                placeholder="mail@example.com"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            </label>

            <label className="field">
              <span className="field-label">Пароль</span>
              <input
                className="input"
                placeholder="не короче 10 символов"
                type="password"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            </label>

            <div className="field">
              <span className="field-label">Роль</span>
              <Select
                options={roleOptions}
                value={draft.role}
                onChange={(value) =>
                  setDraft({ ...draft, role: value as StaffRole, overrides: {} })
                }
              />
            </div>
          </div>

          <RolePreview role={draft.role} roles={roles} />
        </DetailDrawer>
      ) : null}

      {selected ? (
        <DetailDrawer
          className="staff-drawer"
          title={selected.name}
          subtitle={selected.email}
          badge={<Badge text={roleTitle(selected.role)} tone={roleTone(selected.role)} />}
          onClose={() => setSelectedId(null)}
          footer={
            canManage && selected.id !== current?.id ? (
              <>
                <Button
                  variant="destructive"
                  onClick={() => setRemoving(selected)}
                >
                  <Trash2 size={15} aria-hidden /> Удалить
                </Button>
                <span className="toolbar-spacer" />
                <Button
                  variant="ghost"
                  onClick={() =>
                    update.mutate({ id: selected.id, patch: { is_active: !selected.is_active } })
                  }
                >
                  <KeyRound size={15} aria-hidden />
                  {selected.is_active ? "Выключить доступ" : "Включить доступ"}
                </Button>
              </>
            ) : undefined
          }
        >
          {selected.id === current?.id ? (
            <p className="drawer-note">
              Это ваша учётная запись: роль и права себе менять нельзя.
            </p>
          ) : null}

          {canManage && selected.id !== current?.id ? (
            <div className="drawer-section">
              <h3 className="drawer-section-title">Роль</h3>
              <Select
                options={roleOptions}
                value={selected.role}
                onChange={(value) =>
                  update.mutate({ id: selected.id, patch: { role: value as StaffRole } })
                }
              />
            </div>
          ) : null}

          {selected.role === "owner" ? (
            <div className="staff-owner-note">
              <ShieldCheck size={16} aria-hidden />
              <div>
                <div className="row-main">Полный доступ</div>
                <div className="row-sub">
                  Суперпользователь проходит без проверки прав — ограничить его нельзя.
                </div>
              </div>
            </div>
          ) : (
            <PermissionEditor
              busy={update.isPending}
              editable={canManage && selected.id !== current?.id}
              permissions={catalog.data?.permissions ?? []}
              staff={selected}
              onReset={() => update.mutate({ id: selected.id, patch: { overrides: {} } })}
              onToggle={(code, next) =>
                update.mutate({
                  id: selected.id,
                  patch: {
                    overrides: withToggle(
                      selected.overrides,
                      code,
                      next,
                      defaultsFor(selected.role),
                    ),
                  },
                })
              }
            />
          )}
        </DetailDrawer>
      ) : null}

      {removing ? (
        <ConfirmDialog
          busy={remove.isPending}
          title="Удалить сотрудника?"
          message={`${removing.name} потеряет доступ к админке.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
        />
      ) : null}
    </>
  );
}

function RolePreview({ role, roles }: { role: StaffRole; roles: RoleInfo[] }) {
  const info = roles.find((item) => item.code === role);
  if (!info) return null;

  return (
    <div className="drawer-section">
      <h3 className="drawer-section-title">Что даёт роль</h3>
      <p className="row-sub">
        {info.permissions.length} {plural(info.permissions.length, "право", "права", "прав")} по
        умолчанию
        {info.web_admin ? "" : " · в веб-админку эта роль пока не входит"}
      </p>
    </div>
  );
}

function PermissionEditor({
  busy,
  editable,
  permissions,
  staff,
  onReset,
  onToggle,
}: {
  busy: boolean;
  editable: boolean;
  permissions: PermissionInfo[];
  staff: Staff;
  onReset: () => void;
  onToggle: (code: string, next: boolean) => void;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionInfo[]>();
    for (const permission of permissions) {
      const list = byGroup.get(permission.group) ?? [];
      list.push(permission);
      byGroup.set(permission.group, list);
    }
    return [...byGroup.entries()];
  }, [permissions]);

  const changed = Object.keys(staff.overrides).length;

  return (
    <div className="drawer-section">
      <div className="drawer-section-head">
        <h3 className="drawer-section-title">Права</h3>
        {editable && changed > 0 ? (
          <Button size="xs" variant="quiet" disabled={busy} onClick={onReset}>
            <RotateCcw size={13} aria-hidden /> Вернуть как в роли
          </Button>
        ) : null}
      </div>

      <p className="row-sub">
        Доступно {staff.permissions.length} из {permissions.length} · {overrideSummary(staff)}
      </p>

      {groups.map(([group, list]) => {
        const openInGroup = list.filter((item) => staff.permissions.includes(item.code)).length;

        return (
        <div key={group} className="staff-group">
          <div className="staff-group-title">
            <span>{group}</span>
            <span className="staff-group-count" data-empty={openInGroup === 0}>
              {openInGroup} из {list.length}
            </span>
          </div>
          <div className="staff-permission-grid">
            {list.map((permission) => {
              const granted = staff.permissions.includes(permission.code);
              const overridden = permission.code in staff.overrides;
              const locked = !editable || permission.owner_only;

              return (
                <label
                  key={permission.code}
                  className="staff-permission"
                  data-checked={granted}
                  data-locked={locked}
                  data-overridden={overridden}
                >
                  <input
                    checked={granted}
                    disabled={locked || busy}
                    type="checkbox"
                    onChange={(event) => onToggle(permission.code, event.target.checked)}
                  />
                  <span className="staff-permission-copy">
                    <span className="row-main">{permission.title}</span>
                    <span className="row-sub">{permissionNote(permission, staff, granted)}</span>
                  </span>
                  {permission.owner_only ? (
                    <Lock size={13} aria-label="только суперпользователь" />
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
