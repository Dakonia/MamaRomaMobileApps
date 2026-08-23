/**
 * Палитра админки. Намеренно своя: интерфейс сотрудника не должен спорить с
 * витриной сети — терракота и базилик остаются гостю, а здесь спокойный
 * сине-серый, на котором цветные зоны и статусы видно сразу.
 */
export const admin = {
  background: "#F4F6F9",
  surface: "#FFFFFF",
  surfaceSunken: "#EEF1F6",
  surfaceRaised: "#F9FAFC",

  textPrimary: "#161B26",
  textSecondary: "#4A5468",
  textTertiary: "#7B8598",
  textOnAccent: "#FFFFFF",

  border: "#DDE3EC",
  borderStrong: "#C3CCDA",
  divider: "#E9EDF3",

  accent: "#2D5BD7",
  accentPressed: "#2249B4",
  accentSubtle: "#E7EDFC",

  success: "#1B7F5A",
  successSubtle: "#E4F2EC",
  warning: "#B8770B",
  warningSubtle: "#FBF0DA",
  danger: "#C0392B",
  dangerSubtle: "#FBE9E7",

  skeleton: "#E5EAF2",
  scrim: "rgba(22, 27, 38, 0.55)",
} as const;

/** Цвета зон на карте: различимые между собой и не из палитры бренда. */
export const zoneColors = [
  "#2D5BD7",
  "#0E9F8C",
  "#B8770B",
  "#8E44AD",
  "#C0392B",
  "#3C7A1E",
  "#D3562B",
  "#1F6F9E",
] as const;
