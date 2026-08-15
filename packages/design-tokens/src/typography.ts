export const fontFamily = {
  display: "Comfortaa_600SemiBold",
  displayBold: "Comfortaa_700Bold",
  displayMedium: "Comfortaa_500Medium",
  body: "Onest_400Regular",
  bodyMedium: "Onest_500Medium",
  bodySemiBold: "Onest_600SemiBold",
  bodyBold: "Onest_700Bold",
} as const;

export const typography = {
  display: { fontFamily: fontFamily.displayBold, fontSize: 32, lineHeight: 42, letterSpacing: -0.4 },
  h1: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  h2: { fontFamily: fontFamily.display, fontSize: 21, lineHeight: 28, letterSpacing: -0.2 },
  h3: { fontFamily: fontFamily.bodySemiBold, fontSize: 18, lineHeight: 24 },
  bodyLg: { fontFamily: fontFamily.body, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 18 },
  overline: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
  price: { fontFamily: fontFamily.displayBold, fontSize: 19, lineHeight: 26, letterSpacing: -0.2 },
  button: { fontFamily: fontFamily.display, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
} as const;

export type TypographyToken = keyof typeof typography;
