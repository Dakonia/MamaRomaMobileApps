import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Reservation } from '@/api/client';
import { PrimaryButton } from '@/components/primary-button';
import { SuccessCheck } from '@/components/success-check';
import { guestsLabel } from '@/lib/dates';
import { useTheme } from '@/theme/theme-provider';

const SCENE = require('../../assets/images/hero-pizza.jpg');

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Насечки по нижнему краю: карточка читается как отрывной билет. */
const NOTCHES = Array.from({ length: 13 }, (_, index) => index);

type Props = {
  reservation: Reservation | null;
  phone?: string | null;
  onClose: () => void;
};

/**
 * Подтверждение брони: тёмный зал за размытым стеклом и белый билет по центру.
 * Движение сдержанное — карточка поднимается, по ней проходит свет, строки
 * проявляются по очереди. Всё действие внутри карточки, на светлом.
 */
export function BookingDone({ reservation, phone, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const card = useSharedValue(0);
  const shine = useSharedValue(0);

  useEffect(() => {
    if (!reservation) {
      card.value = 0;
      shine.value = 0;
      return;
    }

    card.value = withSpring(1, { damping: 15, stiffness: 130, mass: 0.9 });
    shine.value = withDelay(620, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }));

    const timer = setTimeout(
      () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      280,
    );

    return () => clearTimeout(timer);
  }, [reservation, card, shine]);

  const paper = useAnimatedStyle(() => ({
    opacity: card.value,
    transform: [{ translateY: (1 - card.value) * 60 }, { scale: 0.96 + card.value * 0.04 }],
  }));

  const sweep = useAnimatedStyle(() => ({
    opacity: shine.value > 0.05 && shine.value < 0.95 ? 0.22 : 0,
    transform: [{ translateX: -300 + shine.value * 620 }, { rotate: '16deg' }],
  }));

  if (!reservation) return null;

  const at = new Date(reservation.reserved_at);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(240)}
        exiting={FadeOut.duration(180)}
        style={styles.root}
      >
        {/* Зал не в фокусе: кадр размыт и притушен, чтобы не спорить с билетом */}
        <Image
          source={SCENE}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={26}
          transition={0}
        />
        <LinearGradient
          colors={['rgba(16,11,9,0.9)', 'rgba(16,11,9,0.78)', 'rgba(16,11,9,0.95)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />

        <View
          style={[
            styles.stage,
            {
              paddingHorizontal: theme.spacing.lg,
              paddingTop: insets.top + theme.spacing.lg,
              paddingBottom: insets.bottom + theme.spacing.lg,
            },
          ]}
        >
          <Animated.View
            style={[
              paper,
              styles.card,
              { borderRadius: theme.radius.xxl, backgroundColor: theme.colors.surface },
            ]}
          >
            <View
              style={{
                paddingHorizontal: theme.spacing.xl,
                paddingTop: theme.spacing.xxl,
                paddingBottom: theme.spacing.xl,
                alignItems: 'center',
                gap: theme.spacing.md,
              }}
            >
              <SuccessCheck color={theme.colors.accent} ringColor={theme.colors.accentSubtle} />

              <Animated.Text
                entering={FadeInDown.duration(300).delay(220)}
                style={[
                  theme.typography.overline,
                  styles.center,
                  { color: theme.colors.textTertiary },
                ]}
              >
                Стол забронирован
              </Animated.Text>

              <Animated.Text
                entering={FadeInDown.duration(320).delay(280)}
                style={[
                  styles.center,
                  {
                    fontFamily: theme.typography.display.fontFamily,
                    fontSize: 46,
                    lineHeight: 52,
                    letterSpacing: -1,
                    color: theme.colors.textPrimary,
                  },
                ]}
              >
                {clock}
              </Animated.Text>

              <Animated.Text
                entering={FadeInDown.duration(320).delay(330)}
                style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}
              >
                {WEEKDAYS[at.getDay()]}, {at.getDate()} {MONTHS[at.getMonth()]}
              </Animated.Text>

              <Animated.View
                entering={FadeIn.duration(320).delay(380)}
                style={[styles.rule, { gap: theme.spacing.sm }]}
              >
                <View style={[styles.hair, { backgroundColor: theme.colors.border }]} />
                <Ionicons name="leaf" size={13} color={theme.colors.accent} />
                <View style={[styles.hair, { backgroundColor: theme.colors.border }]} />
              </Animated.View>

              {/* Адрес не режем: он длинный и гостю нужен целиком */}
              <Animated.Text
                entering={FadeInDown.duration(320).delay(430)}
                style={[theme.typography.h3, styles.center, { color: theme.colors.textPrimary }]}
              >
                {reservation.restaurant_name}
              </Animated.Text>

              <Animated.Text
                entering={FadeInDown.duration(320).delay(470)}
                style={[theme.typography.caption, styles.center, { color: theme.colors.textSecondary }]}
              >
                {guestsLabel(reservation.guests_count)} · придержим стол 30 минут
              </Animated.Text>

              <Animated.View style={[styles.sweep, sweep]} pointerEvents="none" />
            </View>

            {/* Отрывной край — и уже на нём действия */}
            <View style={styles.notches}>
              {NOTCHES.map((notch) => (
                <View
                  key={notch}
                  style={[styles.notch, { backgroundColor: theme.colors.border }]}
                />
              ))}
            </View>

            <Animated.View
              entering={FadeInDown.duration(320).delay(520)}
              style={{
                paddingHorizontal: theme.spacing.xl,
                paddingTop: theme.spacing.lg,
                paddingBottom: theme.spacing.xl,
                gap: theme.spacing.md,
              }}
            >
              <Text
                style={[theme.typography.caption, styles.center, { color: theme.colors.textTertiary }]}
              >
                Ресторан подтвердит бронь и позвонит, если что-то изменится
              </Text>

              <PrimaryButton label="Отлично" onPress={onClose} />

              {phone ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                  style={[
                    styles.call,
                    { minHeight: theme.layout.minTouchTarget, gap: theme.spacing.sm },
                  ]}
                >
                  <Ionicons name="call-outline" size={16} color={theme.colors.brand} />
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                    Позвонить в ресторан
                  </Text>
                </Pressable>
              ) : null}
            </Animated.View>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100B09' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { alignSelf: 'stretch', overflow: 'hidden' },
  center: { textAlign: 'center' },
  rule: { flexDirection: 'row', alignItems: 'center' },
  hair: { width: 40, height: StyleSheet.hairlineWidth },
  notches: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  notch: { width: 14, height: StyleSheet.hairlineWidth },
  call: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  sweep: { position: 'absolute', top: -140, bottom: -140, width: 70, backgroundColor: '#FFFFFF' },
});
