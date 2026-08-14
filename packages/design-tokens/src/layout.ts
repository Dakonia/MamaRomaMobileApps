export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

export const elevation = {
  none: {
    shadowColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  card: {
    shadowColor: "#2C2622",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: "#2C2622",
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  sheet: {
    shadowColor: "#2C2622",
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
} as const;

export const motion = {
  duration: {
    instant: 100,
    fast: 160,
    base: 240,
    slow: 340,
    lazy: 480,
  },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0, 1] as const,
    accelerate: [0.3, 0, 1, 1] as const,
    spring: { damping: 18, stiffness: 220, mass: 1 },
  },
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export const layout = {
  screenPadding: spacing.base,
  tabBarHeight: 56,
  minTouchTarget: 44,
  maxContentWidth: 720,
} as const;
