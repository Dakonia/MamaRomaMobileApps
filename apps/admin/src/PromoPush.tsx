import { useEffect, useState } from "react";

import { api, ApiError, type City, type Promotion, type Reach } from "./api";
import { Button, c, radius, spacing, styles, typography } from "./ui";

/** Из акции получается готовое уведомление: заголовок и первая фраза описания. */
function draftFrom(promo: Promotion): { title: string; body: string } {
  const text = (promo.description ?? "").replace(/\s+/g, " ").trim();
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? "";

  return {
    title: promo.title.slice(0, 120),
    body: (firstSentence || text).slice(0, 240) || "Подробности — в приложении",
  };
}

type Props = {
  promo: Promotion;
  cities: City[];
  onClose: () => void;
};

/**
 * Отправка акции уведомлением прямо из списка акций.
 *
 * Так менеджеру не приходится переписывать текст в другом разделе: акция уже
 * есть, остаётся выбрать, кому написать, а нажатие в уведомлении откроет
 * именно её карточку.
 */
export function PromoPush({ promo, cities, onClose }: Props) {
  const start = draftFrom(promo);

  const [title, setTitle] = useState(start.title);
  const [body, setBody] = useState(start.body);
  const [city, setCity] = useState("");
  const [reach, setReach] = useState<Reach | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const audience = city ? { cities: [city] } : {};

  useEffect(() => {
    let alive = true;
    void api
      .campaignAudience(audience)
      .then((result) => alive && setReach(result))
      .catch(() => alive && setReach(null));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  const send = async (force: boolean) => {
    setBusy(true);
    setFailure(null);
    setNote(null);

    try {
      const campaign = await api.createCampaign({
        name: `Акция: ${promo.title}`,
        title,
        body,
        image_url: promo.image_url,
        target: { screen: "promo", id: promo.id },
        audience,
        scheduled_at: null,
      });

      const sent = await api.sendCampaign(campaign.id, force);
      if (sent.error) {
        setNote(sent.error);
        return;
      }

      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          <div>
            <div style={{ fontSize: typography.h3.fontSize, fontWeight: 600 }}>
              Отправить акцию уведомлением
            </div>
            <div style={{ color: c.textTertiary, fontSize: typography.caption.fontSize }}>
              Нажатие откроет карточку «{promo.title}» в приложении
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <Button tone="quiet" onClick={onClose}>
            Закрыть
          </Button>
        </div>

        <label style={field}>
          <span style={label}>Заголовок</span>
          <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label style={field}>
          <span style={label}>Текст</span>
          <input style={styles.input} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        <label style={field}>
          <span style={label}>Кому</span>
          <select style={styles.input} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Всем гостям</option>
            {cities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        {/* Так уведомление увидят на телефоне */}
        <div style={preview}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: c.accentSubtle,
              display: "grid",
              placeItems: "center",
            }}
          >
            🍕
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title || "Заголовок"}</div>
            <div style={{ fontSize: 13, color: c.textSecondary }}>{body || "Текст"}</div>
          </div>
        </div>

        {note ? (
          <div style={{ ...warn, display: "flex", alignItems: "center", gap: spacing.md }}>
            <span style={{ flex: 1 }}>{note}</span>
            <Button tone="quiet" onClick={() => void send(true)}>
              Отправить всё равно
            </Button>
          </div>
        ) : null}

        {failure ? <div style={{ color: c.danger }}>{failure}</div> : null}

        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{reach?.count ?? "…"}</div>
            <div style={{ fontSize: typography.caption.fontSize, color: c.textTertiary }}>
              {reach
                ? `получат · всего гостей ${reach.guests}, с уведомлениями ${reach.with_push}`
                : "считаем охват"}
            </div>
          </div>

          <span style={{ flex: 1 }} />

          <Button onClick={() => void send(false)} disabled={busy || title.trim().length < 2}>
            {busy ? "Отправляем…" : "Отправить"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: c.scrim,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: spacing.xl,
  zIndex: 40,
};

const sheet: React.CSSProperties = {
  background: c.surface,
  borderRadius: radius.lg,
  border: `1px solid ${c.border}`,
  padding: spacing.lg,
  width: "min(620px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: spacing.md,
  boxShadow: "0 24px 60px rgba(22, 27, 38, 0.24)",
};

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

const label: React.CSSProperties = {
  fontSize: typography.caption.fontSize,
  color: c.textTertiary,
};

const preview: React.CSSProperties = {
  background: c.surfaceSunken,
  borderRadius: radius.md,
  padding: spacing.md,
  display: "flex",
  gap: spacing.md,
  alignItems: "center",
};

const warn: React.CSSProperties = {
  background: c.warningSubtle,
  color: c.warning,
  borderRadius: radius.md,
  padding: spacing.md,
};
