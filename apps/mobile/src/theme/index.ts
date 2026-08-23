import {
  darkColors,
  elevation,
  hitSlop,
  layout,
  lightColors,
  motion,
  palette,
  radius,
  spacing,
  tabularNums,
  typography,
  type ColorScheme,
} from "@mr/design-tokens";

export type Theme = {
  colors: ColorScheme;
  typography: typeof typography;
  /** Цифры одинаковой ширины: суммы и счётчики не дёргаются при пересчёте. */
  tabularNums: typeof tabularNums;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: typeof elevation;
  motion: typeof motion;
  layout: typeof layout;
  hitSlop: typeof hitSlop;
  isDark: boolean;
};

const shared = {
  typography,
  tabularNums,
  spacing,
  radius,
  elevation,
  motion,
  layout,
  hitSlop,
};

export const lightTheme: Theme = { ...shared, colors: lightColors, isDark: false };
export const darkTheme: Theme = { ...shared, colors: darkColors, isDark: true };

export { palette };
