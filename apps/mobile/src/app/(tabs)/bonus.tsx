import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/screen-header';
import { formatPoints, formatRubles } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

export default function BonusScreen() {
  const theme = useTheme();
  const session = useSession();
  const { loyalty } = tenant;

  const rules = [
    `1 балл = ${formatRubles(loyalty.pointToRubleRate)}, списать можно до ${Math.round(
      loyalty.maxRedeemShareOfCheck * 100,
    )}% чека`,
    `Баллы сгорают через ${loyalty.pointsExpireAfterDays} дней после начисления`,
    `В день рождения дарим ${formatPoints(loyalty.birthdayBonus)}`,
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Бонусы" subtitle="Программа лояльности сети" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
        }}
      >
        <View
          style={[
            styles.card,
            {
              padding: theme.spacing.lg,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.brandSubtle,
              gap: theme.spacing.xs,
            },
          ]}
        >
          {session.status === 'authorized' && session.loyalty ? (
            <>
              <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
                {session.loyalty.tier_title} · {session.loyalty.cashback_percent}% кэшбэка
              </Text>
              <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
                {formatPoints(session.loyalty.points_balance)}
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                Покажите QR-код на кассе, чтобы списать баллы. Он появится здесь вместе с заказами.
              </Text>
            </>
          ) : (
            <>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                Войдите, чтобы копить баллы
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                За регистрацию начислим {formatPoints(loyalty.welcomeBonus)} — их можно потратить
                уже на первый заказ.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/auth')}
                hitSlop={theme.hitSlop}
                style={({ pressed }) => [
                  styles.button,
                  {
                    minHeight: theme.layout.minTouchTarget,
                    paddingHorizontal: theme.spacing.xl,
                    borderRadius: theme.radius.pill,
                    marginTop: theme.spacing.sm,
                    backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
                  },
                ]}
              >
                <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                  Войти по номеру
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Уровни
          </Text>

          {loyalty.tiers.map((tier) => (
            <View
              key={tier.code}
              style={[
                styles.tier,
                {
                  padding: theme.spacing.base,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surfaceSunken,
                  gap: theme.spacing.base,
                },
              ]}
            >
              <View style={styles.tierText}>
                <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                  {tier.title}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {tier.thresholdRub === 0
                    ? 'С первого заказа'
                    : `От ${formatRubles(tier.thresholdRub)} покупок`}
                </Text>
              </View>

              <Text style={[theme.typography.price, { color: theme.colors.brand }]}>
                {tier.cashbackPercent}%
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Как это работает
          </Text>

          {rules.map((rule) => (
            <View key={rule} style={[styles.rule, { gap: theme.spacing.md }]}>
              <Ionicons
                name="checkmark-circle"
                size={theme.spacing.lg}
                color={theme.colors.accent}
              />
              <Text
                style={[theme.typography.body, styles.ruleText, { color: theme.colors.textPrimary }]}
              >
                {rule}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { width: '100%' },
  button: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierText: { flex: 1 },
  rule: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  ruleText: { flex: 1 },
});
