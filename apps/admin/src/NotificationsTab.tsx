import { useState } from "react";

import { AutomationsTab } from "./AutomationsTab";
import { CampaignsTab } from "./CampaignsTab";
import { NotificationSteps } from "./NotificationSteps";
import { Button, Section, spacing } from "./ui";

type Part = "steps" | "campaigns" | "automations";

const PARTS: { key: Part; label: string }[] = [
  { key: "steps", label: "Шаги заказа" },
  { key: "campaigns", label: "Рассылки" },
  { key: "automations", label: "Сценарии" },
];

/** Всё про уведомления в одном разделе: транзакционные, рекламные и автоматические. */
export function NotificationsTab() {
  const [part, setPart] = useState<Part>("steps");

  return (
    <Section
      title="Уведомления"
      action={
        <div style={{ display: "flex", gap: spacing.sm }}>
          {PARTS.map((item) => (
            <Button
              key={item.key}
              tone={part === item.key ? "brand" : "quiet"}
              onClick={() => setPart(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      }
    >
      {part === "steps" ? <NotificationSteps /> : null}
      {part === "campaigns" ? <CampaignsTab /> : null}
      {part === "automations" ? <AutomationsTab /> : null}
    </Section>
  );
}
