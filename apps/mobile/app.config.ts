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
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: branding.splashBackground,
        image: "./assets/images/splash-icon.png",
        imageWidth: 160,
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
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    tenantId: tenant.id,
    tenant,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
  },
});
