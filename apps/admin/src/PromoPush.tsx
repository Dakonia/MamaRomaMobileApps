import { useQuery } from "@tanstack/react-query";
import { Bell, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiError, mediaUrl, type City, type Promotion } from "./api";
import { DetailDrawer } from "./components/patterns/DetailDrawer";
import { Badge, Button, Select } from "./ui";

function draftFrom(promo: Promotion): { body: string; title: string } {
  const text = (promo.description ?? "").replace(/\s+/g, " ").trim();
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? "";

  return {
    body: (firstSentence || text).slice(0, 240) || "Подробности — в приложении",
    title: promo.title.slice(0, 120),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Действие не выполнено";
}

type Props = {
  cities: City[];
  onClose: () => void;
  promo: Promotion;
};

export function PromoPush({ promo, cities, onClose }: Props) {
  const initial = useMemo(() => draftFrom(promo), [promo]);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [city, setCity] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const audience = useMemo(() => (city ? { cities: [city] } : {}), [city]);
  const reach = useQuery({
    queryKey: ["promo-push-audience", promo.id, audience],
    queryFn: () => api.campaignAudience(audience),
  });

  const send = async (force = false) => {
    setBusy(true);
    setNote(null);

    try {
      const campaign =
        campaignId === null
          ? await api.createCampaign({
              audience,
              body: body.trim(),
              image_url: promo.image_url,
              name: `Акция: ${promo.title}`,
              scheduled_at: null,
              target: { screen: "promo", id: promo.id },
              title: title.trim(),
            })
          : { id: campaignId };

      const sent = await api.sendCampaign(campaign.id, force);
      if (sent.error) {
        setCampaignId(sent.id);
        setNote(sent.error);
        toast.warning(sent.error);
        return;
      }

      toast.success("Уведомление отправлено");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailDrawer
      badge={promo.label ? <Badge text={promo.label} tone="warn" /> : undefined}
      footer={
        <>
          <Button disabled={busy} variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          {note ? (
            <Button disabled={busy || title.trim().length < 2} variant="ghost" onClick={() => void send(true)}>
              Отправить всё равно
            </Button>
          ) : null}
          <Button disabled={busy || title.trim().length < 2} onClick={() => void send(false)}>
            <Send size={15} aria-hidden />
            {busy ? "Отправляем..." : "Отправить"}
          </Button>
        </>
      }
      subtitle={`Нажатие откроет акцию «${promo.title}»`}
      title="Отправить акцию"
      onClose={onClose}
    >
      <div className="drawer-form">
        {note ? <div className="alert-band">{note}</div> : null}

        <section className="drawer-section">
          <h3 className="drawer-section-title">Сообщение</h3>
          <div className="drawer-form-grid">
            <label className="field" data-wide="true">
              <span className="field-label">Заголовок</span>
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field" data-wide="true">
              <span className="field-label">Текст</span>
              <textarea className="textarea" value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <div className="field">
              <span className="field-label">Кому</span>
              <Select
                value={city}
                options={[
                  { label: "Всем гостям", value: "" },
                  ...cities.map((item) => ({ label: item.name, value: item.id })),
                ]}
                onChange={setCity}
              />
            </div>
          </div>
        </section>

        <div className="reach-card">
          <div>
            <div className="metric-label">Охват</div>
            <div className="metric-value">{reach.data?.count ?? "..."}</div>
          </div>
          <div className="row-sub">
            {reach.data
              ? `Всего гостей ${reach.data.guests}, push включён у ${reach.data.with_push}`
              : "Считаем аудиторию"}
          </div>
        </div>

        <section className="drawer-section">
          <h3 className="drawer-section-title">Предпросмотр</h3>
          <div className="push-preview">
            <div className="push-icon">
              <Bell size={16} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="row-main">{title || "Заголовок"}</div>
              <div className="row-sub">{body || "Текст уведомления"}</div>
            </div>
            {promo.image_url ? (
              <img className="push-media" src={mediaUrl(promo.image_url) ?? undefined} alt="" />
            ) : null}
          </div>
        </section>
      </div>
    </DetailDrawer>
  );
}
