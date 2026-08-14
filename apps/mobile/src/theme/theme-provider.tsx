import { createContext, use, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { darkTheme, lightTheme, type Theme } from "./index";

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  children,
  forceScheme,
}: {
  children: ReactNode;
  forceScheme?: "light" | "dark";
}) {
  const system = useColorScheme();
  const scheme = forceScheme ?? system ?? "light";
  const theme = scheme === "dark" ? darkTheme : lightTheme;

  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return use(ThemeContext);
}
