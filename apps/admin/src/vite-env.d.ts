/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly EXPO_PUBLIC_YANDEX_MAPS_KEY?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_YANDEX_MAPS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
