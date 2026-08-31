import { Bell, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { AutomationsTab } from "./AutomationsTab";
import { CampaignsTab } from "./CampaignsTab";
import { NotificationSteps } from "./NotificationSteps";
import { Section } from "./ui";

type Part = "steps" | "campaigns" | "automations";

const PARTS: { icon: typeof Bell; key: Part; label: string }[] = [
  { icon: Send, key: "campaigns", label: "Рассылки" },
  { icon: Sparkles, key: "automations", label: "Сценарии" },
  { icon: Bell, key: "steps", label: "Статусы заказа" },
];

export function NotificationsTab() {
  const [part, setPart] = useState<Part>("campaigns");

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
      description="Рассылки, автоматические сценарии и сервисные сообщения для гостей."
    >
      {part === "steps" ? <NotificationSteps /> : null}
      {part === "campaigns" ? <CampaignsTab /> : null}
      {part === "automations" ? <AutomationsTab /> : null}
    </Section>
  );
}
