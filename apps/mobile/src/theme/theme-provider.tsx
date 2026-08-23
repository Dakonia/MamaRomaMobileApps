import { createContext, use, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { useAppearance } from "@/store/appearance";

import { darkTheme, lightTheme, type Theme } from "./index";

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  children,
  forceScheme,
}: {
  children: ReactNode;
  forceScheme?: "light" | "dark";
}) {
  // Только выбор гостя: приложение светлое, пока он сам не решит иначе
  const chosen = useAppearance((state) => state.mode);
  const scheme = forceScheme ?? chosen;
  const theme = scheme === "dark" ? darkTheme : lightTheme;

  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}
