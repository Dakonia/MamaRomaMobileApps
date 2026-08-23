import { existsSync } from "node:fs";

import type { ExpoConfig, ConfigContext } from "expo/config";

import type { TenantConfig } from "../../packages/tenants/src/types";

// Читаем JSON напрямую: app.config.ts исполняется как CJS и не резолвит TS соседних пакетов.
const tenantId = process.env.EXPO_PUBLIC_TENANT_ID ?? "mamaroma";
const tenant = require(`../../packages/tenants/data/${tenantId}.json`) as TenantConfig;
const { branding, stores } = tenant;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: branding.displayName,
  slug: tenant.slug,
  scheme: stores.scheme,
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  ios: {
    bundleIdentifier: stores.bundleIdentifier,
    supportsTablet: true,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      NSLocationWhenInUseUsageDescription:
        "Нужно, чтобы подобрать ближайший ресторан и рассчитать доставку.",
      NSCameraUsageDescription:
        "Нужно, чтобы сканировать QR-код и списать бонусы на кассе.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: stores.androidPackage,
    // Ключ Firebase для пуш-уведомлений. Файла нет — собираем без пушей,
    // приложение работает как прежде
    googleServicesFile: existsSync("./google-services.json")
      ? "./google-services.json"
      : undefined,
    adaptiveIcon: {
      backgroundColor: branding.androidAdaptiveBackground,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"],
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      // Android с 9-й версии режет обычный http. Пока бэкенд крутится на Mac
      // без сертификата, разрешаем открытый трафик — на проде уберём
      "expo-build-properties",
      { android: { usesCleartextTraffic: true } },
    ],
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        // Системную заставку ставим тем же кадром: между ней и экраном
        // приложения не должно быть видно стыка
        backgroundColor: branding.splashBackground,
        image: "./assets/images/splash-scene.jpg",
        resizeMode: "cover",
      },
    ],
    [
      "expo-notifications",
      {
        // Значок в статусной строке Android рисуется одним цветом — берём знак сети
        icon: "./assets/images/android-icon-monochrome.png",
        color: branding.primary,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Нужно, чтобы подобрать ближайший ресторан и рассчитать доставку.",
      },
    ],
  ],
  // Обновления по воздуху: правки на TypeScript прилетают гостю без магазина.
  // Версия окружения привязана к версии приложения — сборка со старой нативной
  // частью не получит код, которому нужна новая
  updates: {
    url: "https://u.expo.dev/9dcc413d-cb80-47f9-bae9-44091b41ad71",
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "appVersion" },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // Проект в EAS: сюда уходят облачные сборки
    eas: { projectId: "9dcc413d-cb80-47f9-bae9-44091b41ad71" },
    // Карта Яндекса: ключ один на обе платформы. Нет ключа — вместо карты
    // показываем заглушку с ручным вводом адреса, а не пустой экран
    yandexMapsKey: process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ?? "",
    // Аналитика и падения: без ключа сбор просто выключен
    appMetricaKey: process.env.EXPO_PUBLIC_APPMETRICA_KEY ?? "",
    tenantId: tenant.id,
    tenant,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
  },
});
