import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, formatPrice, type ApiError, type DishExtra } from "./api";
import { Badge, Button, c, Section, spacing, styles, typography } from "./ui";

export function ExtrasTab() {
  const queryClient = useQueryClient();
  const extras = useQuery({ queryKey: ["extras"], queryFn: api.extras });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const [openFor, setOpenFor] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["extras"] });
  const fail = (exc: ApiError) => setError(exc.message);

  const create = useMutation({
    mutationFn: () =>
      api.createExtra({
        name: name.trim(),
        price_kopecks: Number(price || 0) * 100,
        is_active: true,
      }),
    onSuccess: () => {
      setName("");
      setPrice("");
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<DishExtra> }) =>
      api.updateExtra(id, {
        name: patch.name,
        price_kopecks: patch.price_kopecks,
        is_active: patch.is_active,
      }),
    onSuccess: refresh,
    onError: fail,
  });

  // Добавка «на весь раздел»: пармезан идёт к любой пасте, даже если на сайте
  // у конкретного блюда он не указан
  const setCategories = useMutation({
    mutationFn: ({ id, categoryIds }: { id: string; categoryIds: string[] }) =>
      api.setExtraCategories(id, categoryIds),
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteExtra(id),
    onSuccess: refresh,
    onError: fail,
  });

  const rows = (extras.data ?? []).filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Section title="Добавки к блюдам">
      <p style={{ margin: 0, color: c.textSecondary, maxWidth: 720 }}>
        То, что гость докидывает в блюдо: бекон, грибы, второй сыр. Набор для каждого блюда
        приходит с сайта при обновлении меню — здесь правятся цены и то, какие добавки вообще
        предлагаются.
      </p>

      {error ? <div style={{ color: c.danger }}>{error}</div> : null}

      <div style={{ display: "flex", gap: spacing.sm, flexWrap: "wrap" }}>
        <input
          style={{ ...styles.input, minWidth: 240 }}
          value={name}
          placeholder="Название, например «бекон 50 гр»"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          style={{ ...styles.input, width: 120 }}
          value={price}
          inputMode="numeric"
          placeholder="Цена, ₽"
          onChange={(event) => setPrice(event.target.value.replace(/\D/g, ""))}
        />
        <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
          Добавить
        </Button>

        <input
          style={{ ...styles.input, marginLeft: "auto", minWidth: 200 }}
          value={search}
          placeholder="Поиск"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
        Всего добавок: {(extras.data ?? []).length}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((extra) => (
          <div
            key={extra.id}
            style={{
              ...styles.card,
              padding: `${spacing.sm}px ${spacing.base}px`,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: spacing.base,
              opacity: extra.is_active ? 1 : 0.55,
            }}
          >
            <span style={{ flex: 1 }}>{extra.name}</span>

            <span style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
              {extra.dishes_count > 0 ? `в ${extra.dishes_count} блюдах` : "ни к чему не привязана"}
            </span>

            <input
              style={{ ...styles.input, width: 100 }}
              inputMode="numeric"
              defaultValue={Math.round(extra.price_kopecks / 100)}
              onBlur={(event) => {
                const next = Number(event.target.value.replace(/\D/g, "") || 0) * 100;
                if (next !== extra.price_kopecks) save.mutate({ id: extra.id, patch: { price_kopecks: next } });
              }}
            />

            <span style={{ color: c.textSecondary, minWidth: 70 }}>
              {formatPrice(extra.price_kopecks)}
            </span>

            {extra.category_ids.length > 0 ? (
              <Badge text={`разделов: ${extra.category_ids.length}`} tone="ok" />
            ) : null}
            {!extra.is_active ? <Badge text="выключена" tone="muted" /> : null}

            <Button
              tone="quiet"
              onClick={() => setOpenFor(openFor === extra.id ? null : extra.id)}
            >
              Разделы
            </Button>

            <Button
              tone="quiet"
              onClick={() => save.mutate({ id: extra.id, patch: { is_active: !extra.is_active } })}
            >
              {extra.is_active ? "Выключить" : "Включить"}
            </Button>
            <Button tone="danger" onClick={() => remove.mutate(extra.id)}>
              Удалить
            </Button>

            {openFor === extra.id ? (
              <div
                style={{
                  flexBasis: "100%",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: spacing.sm,
                  paddingTop: spacing.sm,
                  borderTop: `1px solid ${c.border}`,
                }}
              >
                {(categories.data ?? []).map((category) => {
                  const on = extra.category_ids.includes(category.id);

                  return (
                    <label
                      key={category.id}
                      style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setCategories.mutate({
                            id: extra.id,
                            categoryIds: on
                              ? extra.category_ids.filter((id) => id !== category.id)
                              : [...extra.category_ids, category.id],
                          })
                        }
                      />
                      <span style={{ fontSize: typography.caption.fontSize }}>{category.name}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}
