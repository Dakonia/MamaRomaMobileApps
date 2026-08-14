export type TenantId = string;

export interface TenantBranding {
  displayName: string;
  legalName: string;
  tagline: string;
  primary: string;
  onPrimary: string;
  accent: string;
  splashBackground: string;
  androidAdaptiveBackground: string;
}

export interface TenantStores {
  bundleIdentifier: string;
  androidPackage: string;
  scheme: string;
  appStoreId?: string;
}

export interface TenantFeatures {
  delivery: boolean;
  pickup: boolean;
  dineInReservation: boolean;
  loyalty: boolean;
  stories: boolean;
  onlinePayment: boolean;
}

export interface TenantLoyaltyTier {
  code: string;
  title: string;
  cashbackPercent: number;
  thresholdRub: number;
}

export interface TenantLoyalty {
  pointToRubleRate: number;
  maxRedeemShareOfCheck: number;
  pointsExpireAfterDays: number;
  welcomeBonus: number;
  birthdayBonus: number;
  tiers: TenantLoyaltyTier[];
}

export interface TenantConfig {
  id: TenantId;
  slug: string;
  branding: TenantBranding;
  stores: TenantStores;
  features: TenantFeatures;
  loyalty: TenantLoyalty;
  supportPhone: string;
  supportEmail: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
  offerUrl: string;
  defaultCityId: string;
  currency: "RUB";
  locale: "ru-RU";
  timezone: string;
}
