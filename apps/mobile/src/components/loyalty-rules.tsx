import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { formatPoints, formatRubles } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  /** Уровень гостя: его подсвечиваем в лестнице. */
  tierCode?: string;
};

/**
 * Всё про баллы одним раскрывающимся блоком. Раньше под это была отдельная
 * вкладка, но карта в профиле уже показывает баланс и уровень — правила нужны
 * редко, поэтому лежат свёрнутыми рядом с ней.
 */
export function LoyaltyRules({ tierCode }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { loyalty } = tenant;

  const turn = useDerivedValue(() => withTiming(open ? 1 : 0, { duration: 200 }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 * turn.value}deg` }] }));

  const rules = [
    {
      icon: 'wallet-outline' as const,
      text: `1 балл = ${formatRubles(loyalty.pointToRubleRate)}, списать можно до ${Math.round(
        loyalty.maxRedeemShareOfCheck * 100,
      )}% чека`,
    },
    {
      icon: 'time-outline' as const,
      text: `Баллы сгорают через ${loyalty.pointsExpireAfterDays} дней после начисления`,
    },
    {
      icon: 'gift-outline' as const,
      text: `В день рождения дарим ${formatPoints(loyalty.birthdayBonus)}`,
    },
  ];

  return (
    <Animated.View
      layout={LinearTransition}
      style={{
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      <PressableScale
        depth={0.99}
        accessibilityLabel="Как работают баллы"
        onPress={() => setOpen((value) => !value)}
        style={[
          styles.row,
          {
            minHeight: theme.layout.minTouchTarget + theme.spacing.xs,
            paddingHorizontal: theme.spacing.base,
            gap: theme.spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.icon,
            {
              width: theme.spacing.xxl,
              height: theme.spacing.xxl,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.brandSubtle,
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={18} color={theme.colors.brand} />
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            Как работают баллы
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            Кэшбэк от {loyalty.tiers[0].cashbackPercent}% до{' '}
            {loyalty.tiers[loyalty.tiers.length - 1].cashbackPercent}%
          </Text>
        </View>

        <Animated.View style={chevron}>
          <Ionicons name="chevron-down" size={18} color={theme.colors.textTertiary} />
        </Animated.View>
      </PressableScale>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          style={{
            paddingHorizontal: theme.spacing.base,
            paddingBottom: theme.spacing.base,
            gap: theme.spacing.base,
          }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            {loyalty.tiers.map((tier) => {
              const active = tier.code === tierCode;
              return (
                <View
                  key={tier.code}
                  style={[
                    styles.row,
                    {
                      padding: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      gap: theme.spacing.md,
                      backgroundColor: active
                        ? theme.colors.brandSubtle
                        : theme.colors.surfaceSunken,
                    },
                  ]}
                >
                  <View style={styles.grow}>
                    <View style={[styles.row, { gap: theme.spacing.sm }]}>
                      <Text
                        style={{
                          fontFamily: theme.typography.display.fontFamily,
                          fontSize: 17,
                          color: active ? theme.colors.brand : theme.colors.textPrimary,
                        }}
                      >
                        {tier.title}
                      </Text>
                      {active ? (
                        <View
                          style={{
                            paddingHorizontal: theme.spacing.sm,
                            paddingVertical: theme.spacing.xxs,
                            borderRadius: theme.radius.pill,
                            backgroundColor: theme.colors.brand,
                          }}
                        >
                          <Text
                            style={[theme.typography.overline, { color: theme.colors.textOnBrand }]}
                          >
                            вы здесь
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                      {tier.thresholdRub === 0
                        ? 'С первого заказа'
                        : `От ${formatRubles(tier.thresholdRub)} покупок`}
                    </Text>
                  </View>

                  <View
                    style={{
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: theme.typography.display.fontFamily,
                        fontSize: 16,
                        color: active ? theme.colors.textOnBrand : theme.colors.textSecondary,
                      }}
                    >
                      {tier.cashbackPercent}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            {rules.map((rule) => (
              <View key={rule.text} style={[styles.row, { gap: theme.spacing.md }]}>
                <Ionicons name={rule.icon} size={18} color={theme.colors.accent} />
                <Text
                  style={[theme.typography.body, styles.grow, { color: theme.colors.textPrimary }]}
                >
                  {rule.text}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
