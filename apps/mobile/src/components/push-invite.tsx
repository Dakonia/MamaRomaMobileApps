import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  SlideInUp,
  SlideOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { track } from '@/lib/analytics';
import { enablePush, pushAllowed } from '@/lib/push';
import { usePushAsk } from '@/store/push-ask';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

/**
 * Предложение включить уведомления: узкая плашка у верхнего края, поверх любого
 * экрана. Висит, пока гость не ответит, — пропустить её нельзя, но и работать
 * она не мешает: занимает одну строку и не перекрывает содержимое.
 */
export function PushInvite() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();

  const answered = usePushAsk((state) => state.answered);
  const postpone = usePushAsk((state) => state.postpone);
  const answer = usePushAsk((state) => state.answer);

  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const authorized = session.status === 'authorized';

  useEffect(() => {
    if (!authorized || answered) {
      setShow(false);
      return;
    }

    // Разрешение уже выдано — предлагать нечего
    void pushAllowed().then((allowed) => {
      setShow(!allowed);
      if (allowed) answer();
    });
  }, [authorized, answered, answer]);

  const bell = useSharedValue(0);

  useEffect(() => {
    if (!show) return;

    // Колокольчик качается: плашка узкая, ей нужен якорь для взгляда
    bell.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [bell, show]);

  const swing = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-8 + bell.value * 16}deg` }],
  }));

  if (!show) return null;

  const allow = () => {
    setBusy(true);

    void enablePush(true).then((token) => {
      track('push_invite', { allowed: token !== null });
      setBusy(false);
      answer();
      setShow(false);
    });
  };

  return (
    <Animated.View
      entering={SlideInUp.duration(420)}
      exiting={SlideOutUp.duration(240)}
      style={[
        styles.root,
        theme.elevation.card,
        {
          top: insets.top + theme.spacing.xs,
          marginHorizontal: theme.layout.screenPadding,
          paddingLeft: theme.spacing.base,
          paddingRight: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.hero,
          gap: theme.spacing.sm,
        },
      ]}
    >
      <Animated.View style={swing}>
        <Ionicons name="notifications" size={17} color={theme.colors.onHero} />
      </Animated.View>

      <View style={styles.grow}>
        <Text numberOfLines={1} style={[theme.typography.bodyMedium, { color: theme.colors.onHero }]}>
          Сообщать о заказе?
        </Text>
        <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>
          Напишем, когда примут и когда выедет курьер
        </Text>
      </View>

      <PressableScale
        depth={0.94}
        accessibilityLabel="Не сейчас"
        onPress={() => {
          track('push_invite', { allowed: false, postponed: true });
          postpone();
          setShow(false);
        }}
        style={[styles.later, { paddingHorizontal: theme.spacing.sm }]}
      >
        <Text style={[theme.typography.caption, { color: theme.colors.onHeroMuted }]}>Позже</Text>
      </PressableScale>

      <PressableScale
        depth={0.94}
        accessibilityLabel="Разрешить уведомления"
        onPress={allow}
        style={[
          styles.allow,
          {
            paddingHorizontal: theme.spacing.base,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.onHero,
            opacity: busy ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.hero }]}>Разрешить</Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: { flex: 1 },
  later: { justifyContent: 'center' },
  allow: { alignItems: 'center', justifyContent: 'center' },
});
