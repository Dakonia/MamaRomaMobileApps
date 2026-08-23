import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOutUp,
  SlideInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { track } from '@/lib/analytics';
import { BLOCKED_BY_SETTINGS, enablePush, lastPushError, pushAllowed, pushBlocked } from '@/lib/push';
import { usePushAsk } from '@/store/push-ask';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

/**
 * Предложение включить уведомления. Карточка у верхнего края: светлая, как
 * остальные карточки приложения, с понятным текстом и двумя крупными кнопками.
 * Висит поверх любого экрана, пока гость не ответит, — пропустить её нельзя,
 * но она занимает верхнюю полосу и не мешает пользоваться приложением.
 */
export function PushInvite() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();

  const answered = usePushAsk((state) => state.answered);
  const wanted = usePushAsk((state) => state.wanted);
  const asked = usePushAsk((state) => state.asked);
  const launches = usePushAsk((state) => state.launches);
  const nagAt = usePushAsk((state) => state.nagAt);
  const postpone = usePushAsk((state) => state.postpone);
  const skipNag = usePushAsk((state) => state.skipNag);
  const answer = usePushAsk((state) => state.answer);

  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const authorized = session.status === 'authorized';

  useEffect(() => {
    if (!authorized || !wanted) {
      setShow(false);
      return;
    }

    void (async () => {
      const [allowed, denied] = await Promise.all([pushAllowed(), pushBlocked()]);

      // Разрешение выдано — предлагать нечего
      if (allowed) {
        answer();
        setShow(false);
        return;
      }

      // Запретили в настройках телефона: напоминаем редко, раз в два десятка
      // запусков, и только тем, кто уведомления вообще хотел
      if (denied) {
        setBlocked(true);
        setShow(launches >= nagAt);
        return;
      }

      setBlocked(false);
      setShow(!answered && asked < 2);
    })();
  }, [authorized, answered, wanted, asked, launches, nagAt, answer]);

  const bell = useSharedValue(0);

  useEffect(() => {
    if (!show) return;

    bell.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        // Пауза между покачиваниями: иначе значок дёргается без остановки
        withTiming(0, { duration: 2200 }),
      ),
      -1,
      false,
    );
  }, [bell, show]);

  const swing = useAnimatedStyle(() => ({
    transform: [{ rotate: `${bell.value * 12}deg` }],
  }));

  if (!show) return null;

  const allow = () => {
    setBusy(true);

    void enablePush(true).then((token) => {
      setBusy(false);
      track('push_invite', { allowed: token !== null });

      // Отказали раньше — системное окно больше не появится, ведём в настройки
      if (token === null && lastPushError === BLOCKED_BY_SETTINGS) {
        setBlocked(true);
        skipNag();
        setShow(false);
        void Linking.openSettings();
        return;
      }

      answer();
      setShow(false);
    });
  };

  return (
    <Animated.View
      entering={SlideInUp.duration(420)}
      exiting={FadeOutUp.duration(220)}
      style={[
        styles.root,
        theme.elevation.card,
        {
          top: insets.top + theme.spacing.sm,
          marginHorizontal: theme.layout.screenPadding,
          padding: theme.spacing.base,
          borderRadius: theme.radius.xxl,
          backgroundColor: theme.colors.surface,
          borderWidth: 1.5,
          borderColor: theme.colors.brand,
          gap: theme.spacing.md,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.icon,
            {
              width: theme.spacing.xxl + theme.spacing.xs,
              height: theme.spacing.xxl + theme.spacing.xs,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.brandSubtle,
            },
          ]}
        >
          <Animated.View style={swing}>
            <Ionicons name="notifications" size={20} color={theme.colors.brand} />
          </Animated.View>
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
            Сообщать о заказе?
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {blocked
              ? 'Уведомления запрещены в настройках телефона — включите их там'
              : 'Напишем, когда ресторан примет заказ и когда курьер выедет'}
          </Text>
        </View>
      </View>

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {blocked ? null : (
          <PressableScale
            depth={0.97}
            accessibilityLabel="Не сейчас"
            onPress={() => {
              track('push_invite', { allowed: false, postponed: true });
              postpone();
              setShow(false);
            }}
            style={[
              styles.button,
              styles.grow,
              {
                minHeight: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceSunken,
              },
            ]}
          >
            <Text style={[theme.typography.button, { color: theme.colors.textSecondary }]}>
              Не сейчас
            </Text>
          </PressableScale>
        )}

        <PressableScale
          depth={0.97}
          accessibilityLabel={blocked ? 'Открыть настройки телефона' : 'Разрешить уведомления'}
          onPress={allow}
          style={[
            styles.button,
            styles.grow,
            {
              minHeight: theme.layout.minTouchTarget,
              paddingHorizontal: theme.spacing.base,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.brand,
              opacity: busy ? 0.6 : 1,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[theme.typography.button, { color: theme.colors.textOnBrand }]}
          >
            {blocked ? 'Открыть настройки' : 'Разрешить'}
          </Text>
        </PressableScale>
      </View>

      {/* Напоминание можно отложить: вернёмся через два десятка запусков */}
      {blocked ? (
        <Text
          onPress={() => {
            track('push_invite', { allowed: false, skipped: true });
            skipNag();
            setShow(false);
          }}
          style={[theme.typography.bodyMedium, styles.skip, { color: theme.colors.textTertiary }]}
        >
          Пропустить
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, zIndex: 24 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  button: { alignItems: 'center', justifyContent: 'center' },
  skip: { textAlign: 'center', paddingVertical: 6 },
});
