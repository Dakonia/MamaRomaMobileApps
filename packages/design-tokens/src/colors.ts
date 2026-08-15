export const palette = {
  terracotta: {
    50: "#FDF3F1",
    100: "#FADFDA",
    200: "#F2BAB1",
    300: "#E68F81",
    400: "#D66454",
    500: "#C0392B",
    600: "#A32C21",
    700: "#82231A",
    800: "#5F1A13",
    900: "#3D110C",
  },
  basil: {
    50: "#EEF7F2",
    100: "#D2EADF",
    200: "#A3D4BF",
    300: "#6FB998",
    400: "#3F9C75",
    500: "#1B7F5A",
    600: "#146848",
    700: "#0F5138",
    800: "#0A3A28",
    900: "#062418",
  },
  sand: {
    0: "#FFFFFF",
    50: "#FAF8F6",
    100: "#F3EFEB",
    200: "#E7E0D9",
    300: "#D5CBC1",
    400: "#B3A79B",
    500: "#8C8177",
    600: "#6B615A",
    700: "#4A423C",
    800: "#2C2622",
    900: "#1A1614",
  },
  saffron: {
    100: "#FDF0D9",
    300: "#F2C266",
    500: "#D98324",
    700: "#A65C13",
  },
  chili: {
    100: "#FBE3E1",
    300: "#E88D85",
    500: "#B3261E",
    700: "#7F1911",
  },
} as const;

export interface ColorScheme {
  brand: string;
  brandPressed: string;
  brandSubtle: string;
  onBrand: string;

  accent: string;
  accentSubtle: string;

  highlight: string;
  highlightSubtle: string;

  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  overlay: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textOnBrand: string;

  border: string;
  borderStrong: string;
  divider: string;

  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;

  skeleton: string;
  scrim: string;
}

export const lightColors: ColorScheme = {
  brand: palette.terracotta[500],
  brandPressed: palette.terracotta[600],
  brandSubtle: palette.terracotta[50],
  onBrand: palette.sand[0],

  accent: palette.basil[500],
  accentSubtle: palette.basil[50],

  highlight: palette.saffron[700],
  highlightSubtle: palette.saffron[100],

  background: palette.sand[0],
  backgroundAlt: palette.sand[50],
  surface: palette.sand[0],
  surfaceRaised: palette.sand[0],
  surfaceSunken: palette.sand[100],
  overlay: "rgba(26, 22, 20, 0.55)",

  textPrimary: palette.sand[900],
  textSecondary: palette.sand[600],
  textTertiary: palette.sand[500],
  textInverse: palette.sand[0],
  textOnBrand: palette.sand[0],

  border: palette.sand[200],
  borderStrong: palette.sand[300],
  divider: palette.sand[100],

  success: palette.basil[500],
  successSubtle: palette.basil[50],
  warning: palette.saffron[500],
  warningSubtle: palette.saffron[100],
  danger: palette.chili[500],
  dangerSubtle: palette.chili[100],

  skeleton: palette.sand[100],
  scrim: "rgba(255, 255, 255, 0.86)",
};

export const darkColors: ColorScheme = {
  brand: palette.terracotta[400],
  brandPressed: palette.terracotta[300],
  brandSubtle: "rgba(214, 100, 84, 0.16)",
  onBrand: palette.sand[900],

  accent: palette.basil[300],
  accentSubtle: "rgba(111, 185, 152, 0.16)",

  highlight: palette.saffron[300],
  highlightSubtle: "rgba(242, 194, 102, 0.16)",

  background: palette.sand[900],
  backgroundAlt: "#211C19",
  surface: palette.sand[800],
  surfaceRaised: "#332C27",
  surfaceSunken: "#141110",
  overlay: "rgba(0, 0, 0, 0.66)",

  textPrimary: palette.sand[50],
  textSecondary: palette.sand[300],
  textTertiary: palette.sand[400],
  textInverse: palette.sand[900],
  textOnBrand: palette.sand[900],

  border: "#3B342E",
  borderStrong: "#4E453E",
  divider: "#2A2420",

  success: palette.basil[300],
  successSubtle: "rgba(111, 185, 152, 0.16)",
  warning: palette.saffron[300],
  warningSubtle: "rgba(242, 194, 102, 0.16)",
  danger: palette.chili[300],
  dangerSubtle: "rgba(232, 141, 133, 0.16)",

  skeleton: "#332C27",
  scrim: "rgba(20, 17, 16, 0.86)",
};
