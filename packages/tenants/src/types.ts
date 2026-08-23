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

  /** Ниже этой версии приложение не пускает к экранам: API уже несовместим. */
  minSupportedVersion?: string;
  /** Свежая версия в магазинах: о ней просто сообщаем. */
  latestVersion?: string;

  appStoreUrl?: string;
  googlePlayUrl?: string;
  ruStoreUrl?: string;
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
  /** Перевод названия на русский: «Amico» гостю ни о чём не говорит, «Друг» — говорит. */
  note: string;
  cashbackPercent: number;
  thresholdRub: number;
}

export interface TenantLoyalty {
  pointToRubleRate: number;
  maxRedeemShareOfCheck: number;
  pointsExpireAfterDays: number;
  welcomeBonus: number;
  birthdayBonus: number;
  /** Можно ли гасить баллами стоимость доставки. */
  pointsCoverDelivery: boolean;
  tiers: TenantLoyaltyTier[];
}

export interface TenantOrdering {
  /** Сколько стоит один комплект приборов, в копейках. */
  cutleryPriceKopecks: number;
}

export interface TenantConfig {
  id: TenantId;
  slug: string;
  branding: TenantBranding;
  stores: TenantStores;
  features: TenantFeatures;
  loyalty: TenantLoyalty;
  ordering: TenantOrdering;
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
