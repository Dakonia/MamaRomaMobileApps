import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// 5173 занят другим проектом на этой машине, поэтому админка живёт на 5174
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  envDir: fileURLToPath(new URL("../mobile", import.meta.url)),
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  /**
   * На сервере админка отдаётся из подпапки /mamaroma/admin/, а не из корня
   * домена: там уже живёт другое приложение. Без этого сборка просит стили и
   * скрипты по корневым адресам, nginx отвечает на них чужой страницей, и
   * браузер ругается на неверный тип содержимого. В разработке база корневая
   */
  base: command === "build" ? "/mamaroma/admin/" : "/",
  server: { port: 5174, strictPort: true },
}));
