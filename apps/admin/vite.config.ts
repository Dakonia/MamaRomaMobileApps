import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 5173 занят другим проектом на этой машине, поэтому админка живёт на 5174
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
