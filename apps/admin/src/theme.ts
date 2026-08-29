/**
 * Палитра админки. Намеренно своя: интерфейс сотрудника не должен спорить с
 * витриной сети — терракота и базилик остаются гостю, а здесь спокойный
 * сине-серый, на котором цветные зоны и статусы видно сразу.
 */
export const admin = {
  background: "var(--bg)",
  surface: "var(--surface)",
  surfaceSunken: "var(--sunken)",
  surfaceRaised: "var(--surface)",

  textPrimary: "var(--ink)",
  textSecondary: "var(--ink-2)",
  textTertiary: "var(--ink-3)",
  textOnAccent: "var(--on-acc)",

  border: "var(--line)",
  borderStrong: "var(--line-2)",
  divider: "var(--line)",

  accent: "var(--acc)",
  accentPressed: "var(--acc-hover)",
  accentSubtle: "var(--acc-sub)",

  success: "var(--ok)",
  successSubtle: "var(--ok-sub)",
  warning: "var(--warn)",
  warningSubtle: "var(--warn-sub)",
  danger: "var(--bad)",
  dangerSubtle: "var(--bad-sub)",

  skeleton: "var(--skeleton)",
  scrim: "var(--scrim)",
} as const;

/** Цвета зон на карте: различимые между собой и не из палитры бренда. */
export const zoneColors = [
  "#1E3A8A",
  "#0F766E",
  "#B45309",
  "#7E22CE",
  "#B91C1C",
  "#3F6212",
  "#C2410C",
  "#0369A1",
] as const;
