import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Plus, RotateCcw, ShieldCheck, Trash2, UserCog, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  formatDateTime,
  type PermissionInfo,
  type Staff,
  type StaffDraft,
  type StaffRole,
} from "./api";
import { ConfirmDialog } from "./components/patterns/ConfirmDialog";
import { useAdminSession, usePermissions } from "./lib/admin-session";
import { Badge, Button, IconButton, Section, Select } from "./ui";

const empty: StaffDraft = {
  email: "",
  name: "",
  role: "delivery_operator",
  password: "",
  overrides: {},
  restaurant_ids: [],
};

/**
 * Флаг хранится только если отличается от набора роли. Вернули значение
 * к тому, что даёт роль — убираем запись совсем: тогда сотрудник поедет
 * дальше вместе с ролью, когда набор роли поменяется.
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

function roleTone(role: StaffRole): "accent" | "ok" | "muted" {
  if (role === "owner") return "accent";
  if (role === "courier" || role === "restaurant") return "muted";
  return "ok";
}

export function StaffTab() {
  const queryClient = useQueryClient();
  const { staff: current } = useAdminSession();
  const { can } = usePermissions();

  const staff = useQuery({ queryKey: ["staff"], queryFn: api.staff });
  const catalog = useQuery({ queryKey: ["staff-catalog"], queryFn: api.staffCatalog });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StaffDraft | null>(null);
  const [removing, setRemoving] = useState<Staff | null>(null);

  const canManage = can("staff.manage");
  const rows = staff.data ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionInfo[]>();
    for (const permission of catalog.data?.permissions ?? []) {
      const list = byGroup.get(permission.group) ?? [];
      list.push(permission);
      byGroup.set(permission.group, list);
    }
    return [...byGroup.entries()];
  }, [catalog.data]);

  const roleOptions = (catalog.data?.roles ?? []).map((role) => ({
    value: role.code,
    label: role.title,
    description: role.web_admin ? undefined : "пока без входа в админку",
  }));

  const defaultsFor = (role: StaffRole) =>
    catalog.data?.roles.find((item) => item.code === role)?.permissions ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["staff"] });
  };

  const fail = (error: unknown) => {
    toast.error(error instanceof ApiError ? error.message : "Не получилось сохранить");
  };

  const create = useMutation({
    mutationFn: api.createStaff,
    onSuccess: (row) => {
      toast.success(`${row.name} теперь в команде`);
      setDraft(null);
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

  const togglePermission = (row: Staff, code: string, next: boolean) => {
    update.mutate({
      id: row.id,
      patch: { overrides: withToggle(row.overrides, code, next, defaultsFor(row.role)) },
    });
  };

  return (
    <Section
      title="Сотрудники"
      description="Роль задаёт набор прав, флаги правят его под конкретного человека"
      action={
        canManage ? (
          <Button onClick={() => setDraft(empty)}>
            <Plus size={16} aria-hidden /> Завести сотрудника
          </Button>
        ) : undefined
      }
    >
      {staff.isLoading ? <p className="section-copy">Загружаем…</p> : null}

      {!staff.isLoading && rows.length === 0 ? (
        <p className="section-copy">Пока в сети только вы.</p>
      ) : null}

      <div className="staff-grid">
        <ul className="staff-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                className="staff-card"
                data-active={row.id === selectedId}
                type="button"
                onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}
              >
                <span className="staff-card-top">
                  <strong>{row.name}</strong>
                  <Badge
                    text={
                      catalog.data?.roles.find((item) => item.code === row.role)?.title ?? row.role
                    }
                    tone={roleTone(row.role)}
                  />
                </span>
                <span className="staff-card-mail">{row.email}</span>
                <span className="staff-card-foot">
                  {row.is_active ? (
                    <span>
                      {row.last_login_at
                        ? `был(а) ${formatDateTime(row.last_login_at)}`
                        : "ни разу не заходил(а)"}
                    </span>
                  ) : (
                    <Badge text="доступ выключен" tone="bad" />
                  )}
                  {row.id === current?.id ? <Badge text="это вы" tone="muted" /> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <div className="staff-detail">
            <div className="staff-detail-head">
              <div>
                <h3>{selected.name}</h3>
                <p className="section-copy">{selected.email}</p>
              </div>
              {canManage && selected.id !== current?.id ? (
                <div className="staff-detail-actions">
                  <IconButton
                    label={selected.is_active ? "Выключить доступ" : "Включить доступ"}
                    onClick={() =>
                      update.mutate({
                        id: selected.id,
                        patch: { is_active: !selected.is_active },
                      })
                    }
                  >
                    <KeyRound size={16} aria-hidden />
                  </IconButton>
                  <IconButton
                    label="Удалить сотрудника"
                    variant="danger"
                    onClick={() => setRemoving(selected)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </IconButton>
                </div>
              ) : null}
            </div>

            {canManage && selected.id !== current?.id ? (
              <label className="staff-role-row">
                <span>Роль</span>
                <Select
                  options={roleOptions}
                  value={selected.role}
                  onChange={(value) =>
                    update.mutate({ id: selected.id, patch: { role: value as StaffRole } })
                  }
                />
              </label>
            ) : null}

            {selected.role === "owner" ? (
              <p className="staff-owner-note">
                <ShieldCheck size={16} aria-hidden /> Суперпользователь: полный доступ ко всему,
                права не ограничиваются.
              </p>
            ) : (
              <div className="staff-permissions">
                <div className="staff-permissions-head">
                  <span className="section-copy">
                    Отмечено — доступно. Отличия от роли показаны точкой.
                  </span>
                  {canManage && Object.keys(selected.overrides).length > 0 ? (
                    <Button
                      size="xs"
                      tone="quiet"
                      onClick={() => update.mutate({ id: selected.id, patch: { overrides: {} } })}
                    >
                      <RotateCcw size={14} aria-hidden /> Вернуть как в роли
                    </Button>
                  ) : null}
                </div>

                {groups.map(([group, permissions]) => (
                  <fieldset key={group} className="staff-permission-group">
                    <legend>{group}</legend>
                    {permissions.map((permission) => {
                      const granted = selected.permissions.includes(permission.code);
                      const changed = permission.code in selected.overrides;

                      return (
                        <label key={permission.code} className="staff-permission" data-changed={changed}>
                          <input
                            checked={granted}
                            disabled={!canManage || permission.owner_only}
                            type="checkbox"
                            onChange={(event) =>
                              togglePermission(selected, permission.code, event.target.checked)
                            }
                          />
                          <span>{permission.title}</span>
                          {permission.owner_only ? (
                            <Lock size={13} aria-label="только суперпользователь" />
                          ) : null}
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="staff-detail staff-detail-empty">
            <UserCog size={20} aria-hidden />
            <p>Выберите сотрудника, чтобы посмотреть и поправить его права.</p>
          </div>
        )}
      </div>

      {draft ? (
        <form
          className="staff-draft"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ ...draft, email: draft.email.trim().toLowerCase() });
          }}
        >
          <div className="staff-draft-head">
            <h3>Новый сотрудник</h3>
            <IconButton label="Закрыть" onClick={() => setDraft(null)}>
              <X size={16} aria-hidden />
            </IconButton>
          </div>

          <label>
            <span>Имя</span>
            <input
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label>
            <span>Почта</span>
            <input
              required
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </label>

          <label>
            <span>Роль</span>
            <Select
              options={roleOptions}
              value={draft.role}
              onChange={(value) => setDraft({ ...draft, role: value as StaffRole, overrides: {} })}
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              required
              minLength={10}
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </label>

          <p className="section-copy">
            Права можно будет поправить сразу после создания — по умолчанию сотрудник получит
            набор своей роли.
          </p>

          <Button disabled={create.isPending} type="submit">
            {create.isPending ? "Создаём…" : "Завести"}
          </Button>
        </form>
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
    </Section>
  );
}
