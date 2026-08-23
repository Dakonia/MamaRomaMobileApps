import { radius, spacing, typography } from "@mr/design-tokens";
import type { CSSProperties, ReactNode } from "react";

import { admin } from "./theme";

/**
 * Цвета админки берём из своей палитры, а не из токенов приложения: у витрины
 * сети и у рабочего инструмента разные задачи. Размеры, скругления и шрифтовая
 * шкала общие — они нейтральны.
 */
export const c = {
  ...admin,
  brand: admin.accent,
  brandPressed: admin.accentPressed,
  brandSubtle: admin.accentSubtle,
  textOnBrand: admin.textOnAccent,
  backgroundAlt: admin.background,
  onDanger: "#FFFFFF",
};

export const styles = {
  page: {
    minHeight: "100vh",
    background: c.backgroundAlt,
    color: c.textPrimary,
    fontFamily: "'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: typography.body.fontSize,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: spacing.lg,
    padding: `${spacing.base}px ${spacing.xl}px`,
    background: c.surface,
    borderBottom: `1px solid ${c.border}`,
  } satisfies CSSProperties,

  content: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: spacing.xl,
    display: "flex",
    flexDirection: "column",
    gap: spacing.xl,
  } satisfies CSSProperties,

  card: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: radius.lg,
    overflow: "hidden",
  } satisfies CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: typography.body.fontSize,
  } satisfies CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: `${spacing.md}px ${spacing.base}px`,
    background: c.surfaceSunken,
    borderBottom: `1px solid ${c.border}`,
    fontSize: typography.caption.fontSize,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: c.textTertiary,
    fontWeight: 600,
  } satisfies CSSProperties,

  td: {
    padding: `${spacing.md}px ${spacing.base}px`,
    borderBottom: `1px solid ${c.divider}`,
    verticalAlign: "top" as const,
  } satisfies CSSProperties,

  input: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    border: `1px solid ${c.border}`,
    borderRadius: radius.sm,
    background: c.background,
    color: c.textPrimary,
    fontSize: typography.body.fontSize,
    fontFamily: "inherit",
    minHeight: 40,
    boxSizing: "border-box" as const,
  } satisfies CSSProperties,
};

export function Button({
  children,
  onClick,
  tone = "brand",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "brand" | "quiet" | "danger";
  disabled?: boolean;
}) {
  const palette = {
    brand: { background: c.brand, color: c.textOnBrand, border: c.brand },
    quiet: { background: "transparent", color: c.textPrimary, border: c.border },
    danger: { background: "transparent", color: c.danger, border: c.border },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: `${spacing.sm}px ${spacing.base}px`,
        borderRadius: radius.pill,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: typography.button.fontSize,
        fontFamily: "inherit",
        fontWeight: 600,
        minHeight: 40,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ text, tone }: { text: string; tone: "ok" | "warn" | "muted" }) {
  const palette = {
    ok: { background: c.successSubtle, color: c.success },
    warn: { background: c.warningSubtle, color: c.warning },
    muted: { background: c.surfaceSunken, color: c.textSecondary },
  }[tone];

  return (
    <span
      style={{
        display: "inline-block",
        padding: `2px ${spacing.sm}px`,
        borderRadius: radius.pill,
        fontSize: typography.caption.fontSize,
        ...palette,
      }}
    >
      {text}
    </span>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2
          style={{
            margin: 0,
            fontSize: typography.h2.fontSize,
            fontFamily: "'Comfortaa', sans-serif",
            fontWeight: 600,
          }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export { spacing, radius, typography };
