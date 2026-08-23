import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import type { OrderMode } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  mode: OrderMode;
  onMode: (mode: OrderMode) => void;
  /** Только переключатель: он стоит в одном ряду с корзиной. */
  compact?: boolean;
  /** Только строка с адресом или рестораном — она занимает всю ширину. */
  lineOnly?: boolean;
  title?: string;
  subtitle?: string;
  warning?: boolean;
  onPress?: () => void;
};

/**
 * Шапка меню: сначала выбор способа — доставка или самовывоз, потом строка
 * с адресом либо рестораном. Название сети тут не нужно: гость и так знает,
 * какое приложение открыл, а место на экране дорогое.
 */
export function ModeHeader({
  mode,
  onMode,
  compact = false,
  lineOnly = false,
  title = '',
  subtitle = '',
  warning,
  onPress,
}: Props) {
  const theme = useTheme();

  const shift = useDerivedValue(() =>
    withTiming(mode === 'delivery' ? 0 : 1, { duration: theme.motion.duration.fast }),
  );

  const pill = useAnimatedStyle(() => ({
    left: `${shift.value * 50}%`,
  }));

  const tab = (value: OrderMode, label: string, icon: keyof typeof Ionicons.glyphMap) => {
    const active = mode === value;
    return (
      <PressableScale
        depth={0.97}
        accessibilityLabel={label}
        onPress={() => {
          if (!active) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onMode(value);
        }}
        style={[styles.tab, { gap: theme.spacing.xs, minHeight: theme.spacing.xxl }]}
      >
        <Ionicons
          name={icon}
          size={16}
          color={active ? theme.colors.hero : theme.colors.onHeroMuted}
        />
        <Text
          numberOfLines={1}
          style={[
            theme.typography.bodyMedium,
            { color: active ? theme.colors.hero : theme.colors.onHeroMuted },
          ]}
        >
          {label}
        </Text>
      </PressableScale>
    );
  };

  const line = useAnimatedStyle(() => ({
    color: interpolateColor(
      warning ? 1 : 0,
      [0, 1],
      [theme.colors.onHero, theme.colors.warning],
    ),
  }));

  if (lineOnly) {
    return (
      <PressableScale
        depth={0.98}
        accessibilityLabel={mode === 'delivery' ? 'Выбрать адрес' : 'Выбрать ресторан'}
        onPress={onPress ?? (() => undefined)}
        style={[styles.row, { gap: theme.spacing.sm }]}
      >
        <Ionicons
          name={mode === 'delivery' ? 'location' : 'storefront'}
          size={18}
          color={warning ? theme.colors.warning : theme.colors.onHero}
        />

        <View style={styles.grow}>
          <Animated.Text numberOfLines={1} style={[theme.typography.bodyMedium, line]}>
            {title}
          </Animated.Text>
          <Text
            numberOfLines={1}
            style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}
          >
            {subtitle}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={18} color={theme.colors.onHeroMuted} />
      </PressableScale>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View
        style={[
          styles.switch,
          { borderRadius: theme.radius.pill, backgroundColor: theme.colors.heroRaised },
        ]}
      >
        <Animated.View
          style={[
            styles.pill,
            pill,
            { borderRadius: theme.radius.pill, backgroundColor: theme.colors.onHero },
          ]}
        />
        {tab('delivery', 'Доставка', 'car')}
        {tab('pickup', 'Самовывоз', 'walk')}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', padding: 3, position: 'relative' },
  pill: { position: 'absolute', top: 3, bottom: 3, width: '50%', marginHorizontal: 3 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
});
