import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Loyalty } from '@/api/client';
import { Avatar } from '@/components/avatar';
import { Barcode } from '@/components/barcode';
import { formatRubles } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  loyalty: Loyalty;
  name: string;
  birthday?: string | null;
};

/** 483920 → 48 39 20: короткий номер так проще продиктовать. */
function groupCard(value: string): string {
  return value.replace(/(\d{2})(?=\d)/g, '$1 ');
}

/** Сегодня ли день рождения гостя. */
function isBirthday(birthday: string | null | undefined): boolean {
  if (!birthday) return false;
  const today = new Date();
  const [, month, day] = birthday.split('-').map(Number);
  return today.getMonth() + 1 === month && today.getDate() === day;
}

/** Сколько до следующего уровня и какая его доля пройдена. */
function progressOf(loyalty: Loyalty) {
  const tiers = [...tenant.loyalty.tiers].sort((a, b) => a.thresholdRub - b.thresholdRub);
  const spentRub = Math.round(loyalty.lifetime_spent_kopecks / 100);
  const index = Math.max(
    0,
    tiers.findIndex((tier) => tier.code === loyalty.tier_code),
  );
  const current = tiers[index];
  const next = tiers[index + 1];

  if (!next) return { next: null, share: 1, left: 0 };

  const span = next.thresholdRub - current.thresholdRub;
  const done = Math.max(0, spentRub - current.thresholdRub);
  return {
    next,
    share: span > 0 ? Math.min(1, done / span) : 0,
    left: Math.max(0, next.thresholdRub - spentRub),
  };
}

/**
 * Карта гостя. На лицевой стороне только то, что нужно каждый день: кто ты,
 * какой уровень, сколько баллов и сколько до следующего уровня. Курс балла,
 * лимит списания и лестница уровней живут в блоке «Как работают баллы» —
 * из-за них карта раньше разрасталась и текст упирался в нижний край.
 */
export function LoyaltyCard({ loyalty, name, birthday }: Props) {
  const theme = useTheme();
  const { next, share, left } = progressOf(loyalty);
  const [flipped, setFlipped] = useState(false);
  const celebrating = isBirthday(birthday);

  const fill = useSharedValue(0);
  const shine = useSharedValue(0);
  const turn = useSharedValue(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    fill.value = withDelay(220, withTiming(share, { duration: 900 }));
    // Блик раз в несколько секунд: карта выглядит как настоящая, а не как блок текста
    shine.value = withRepeat(withDelay(2600, withTiming(1, { duration: 1500 })), -1, false);
  }, [fill, share, shine]);

  // Баллы набегают, а не появляются числом — мелочь, но её замечают
  useEffect(() => {
    const target = loyalty.points_balance;
    const started = Date.now();
    const timer = setInterval(() => {
      const passed = Math.min(1, (Date.now() - started) / 900);
      setShown(Math.round(target * (1 - (1 - passed) ** 3)));
      if (passed >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [loyalty.points_balance]);

  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  const glare = useAnimatedStyle(() => ({
    opacity: shine.value < 0.05 || shine.value > 0.95 ? 0 : 0.12,
    transform: [{ translateX: -220 + 620 * shine.value }, { rotate: '18deg' }],
  }));

  const front = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 1 : 0,
    transform: [
      { perspective: 900 },
      { rotateY: `${interpolate(turn.value, [0, 1], [0, 180])}deg` },
    ],
  }));

  const back = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 0 : 1,
    transform: [
      { perspective: 900 },
      { rotateY: `${interpolate(turn.value, [0, 1], [-180, 0])}deg` },
    ],
  }));

  const flip = () => {
    setFlipped((value) => !value);
    turn.value = withTiming(flipped ? 0 : 1, { duration: 460 });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={flipped ? 'Скрыть штрихкод' : 'Показать штрихкод карты'}
      onPress={flip}
    >
      <View style={{ minHeight: 236 }}>
        <Animated.View
          style={[styles.face, front, theme.elevation.raised, { borderRadius: theme.radius.xxl }]}
        >
          <LinearGradient
            colors={
              celebrating
                ? [theme.colors.brandPressed, theme.colors.highlight]
                : [theme.colors.hero, theme.colors.brandPressed]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <Animated.View style={[styles.glare, glare]} />

          <View style={[styles.body, { padding: theme.spacing.lg }]}>
            <View style={[styles.row, styles.between]}>
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <Ionicons name="pizza" size={16} color={theme.colors.onHeroMuted} />
                <Text style={[theme.typography.overline, { color: theme.colors.onHeroMuted }]}>
                  {tenant.branding.displayName}
                </Text>
              </View>

              <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
                № {groupCard(loyalty.card_number)}
              </Text>
            </View>

            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <Avatar name={name} size={46} onDark />

              <View style={styles.grow}>
                <Text numberOfLines={1} style={[theme.typography.h3, { color: theme.colors.onHero }]}>
                  {name}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
                  {celebrating
                    ? `С днём рождения! Дарим ${tenant.loyalty.birthdayBonus} баллов`
                    : 'Карта гостя'}
                </Text>
              </View>

              <View
                style={[
                  styles.tierPlate,
                  {
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.heroRaised,
                    borderColor: theme.colors.heroRaised,
                  },
                ]}
              >
                <Text
                  style={{
                    fontFamily: theme.typography.display.fontFamily,
                    fontSize: 15,
                    letterSpacing: 0.4,
                    color: theme.colors.onHero,
                  }}
                >
                  {loyalty.tier_title}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
                  {loyalty.cashback_percent}% кэшбэк
                </Text>
              </View>
            </View>

            <View style={[styles.row, styles.bottom]}>
              <View style={styles.grow}>
                {/* Мягкое свечение под числом: баланс читается как главное на карте */}
                <View
                  style={[
                    styles.glow,
                    { borderRadius: theme.radius.pill, backgroundColor: theme.colors.onHero },
                  ]}
                />
                <Text style={[theme.typography.display, { color: theme.colors.onHero }]}>
                  {shown}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
                  баллов на счету
                </Text>
              </View>

              <View
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.heroRaised,
                  },
                ]}
              >
                <Ionicons name="barcode-outline" size={16} color={theme.colors.onHero} />
                <Text style={[theme.typography.caption, { color: theme.colors.onHero }]}>
                  штрихкод
                </Text>
              </View>
            </View>

            <View style={{ gap: theme.spacing.xs }}>
              {/* Подпись стоит НАД полосой: у нижнего края её обрезало */}
              <Text
                numberOfLines={1}
                style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}
              >
                {next
                  ? `${formatRubles(left)} до уровня ${next.title} · кэшбэк ${next.cashbackPercent}%`
                  : 'Высший уровень — максимальный кэшбэк уже ваш'}
              </Text>

              <View style={[styles.track, { backgroundColor: theme.colors.heroRaised }]}>
                <Animated.View
                  style={[styles.fill, bar, { backgroundColor: theme.colors.onHero }]}
                />
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.face,
            back,
            theme.elevation.raised,
            {
              borderRadius: theme.radius.xxl,
              backgroundColor: theme.colors.surface,
              padding: theme.spacing.lg,
              justifyContent: 'space-between',
            },
          ]}
        >
          <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
            Покажите на кассе
          </Text>

          <View style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            <Barcode value={loyalty.card_barcode} color={theme.colors.textPrimary} height={68} />
            <Text style={[theme.typography.h3, styles.digits, { color: theme.colors.textPrimary }]}>
              {groupCard(loyalty.card_number)}
            </Text>
          </View>

          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Кассир отсканирует код или наберёт номер вручную
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  body: { flex: 1, justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  between: { justifyContent: 'space-between' },
  bottom: { justifyContent: 'space-between', alignItems: 'flex-end' },
  tierPlate: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  glare: {
    position: 'absolute',
    top: -60,
    bottom: -60,
    width: 90,
    backgroundColor: '#FFFFFF',
  },
  glow: { position: 'absolute', left: -14, top: 2, width: 120, height: 34, opacity: 0.09 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  digits: { letterSpacing: 2 },
});
