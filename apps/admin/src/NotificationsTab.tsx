import { Bell, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { AutomationsTab } from "./AutomationsTab";
import { CampaignsTab } from "./CampaignsTab";
import { NotificationSteps } from "./NotificationSteps";
import { Section } from "./ui";

type Part = "steps" | "campaigns" | "automations";

const PARTS: { icon: typeof Bell; key: Part; label: string }[] = [
  { icon: Bell, key: "steps", label: "Шаги заказа" },
  { icon: Send, key: "campaigns", label: "Рассылки" },
  { icon: Sparkles, key: "automations", label: "Сценарии" },
];

export function NotificationsTab() {
  const [part, setPart] = useState<Part>("steps");

  return (
    <Section
      title="Уведомления"
      action={
        <div className="tabs" aria-label="Раздел уведомлений">
          {PARTS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className="tab-button"
                data-active={part === item.key}
                type="button"
                onClick={() => setPart(item.key)}
              >
                <Icon size={15} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      }
      description="Транзакционные сообщения, рекламные рассылки и автоматические сценарии в одном месте."
    >
      {part === "steps" ? <NotificationSteps /> : null}
      {part === "campaigns" ? <CampaignsTab /> : null}
      {part === "automations" ? <AutomationsTab /> : null}
    </Section>
  );
}
