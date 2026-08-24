import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInDown,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Order } from '@/api/client';
import { Confetti } from '@/components/confetti';
import { PrimaryButton } from '@/components/primary-button';
import { SuccessCheck } from '@/components/success-check';
import { TextField } from '@/components/text-field';
import { track } from '@/lib/analytics';
import { useTheme } from '@/theme/theme-provider';

type Mood = { icon: keyof typeof Ionicons.glyphMap; word: string; tone: 'danger' | 'warning' | 'good' };

/** Лицо оценки: слово и цвет меняются вместе со звёздами. */
const MOOD: Record<number, Mood> = {
  1: { icon: 'sad-outline', word: 'Совсем не то', tone: 'danger' },
  2: { icon: 'sad-outline', word: 'Не понравилось', tone: 'danger' },
  3: { icon: 'ellipsis-horizontal', word: 'Нормально', tone: 'warning' },
  4: { icon: 'happy-outline', word: 'Хорошо', tone: 'good' },
  5: { icon: 'heart', word: 'Всё отлично!', tone: 'good' },
};

type Tag = { text: string; icon: keyof typeof Ionicons.glyphMap };

/**
 * Отметки пишем целой мыслью, а не одним словом: «Курьер» не говорит ничего,
 * а «Вежливый курьер» и «Курьер нагрубил» — говорят.
 */
const TAGS: Record<'delivery' | 'pickup', { good: Tag[]; bad: Tag[] }> = {
  delivery: {
    bad: [
      { text: 'Долго везли', icon: 'time-outline' },
      { text: 'Привезли холодным', icon: 'snow-outline' },
      { text: 'Ошиблись в заказе', icon: 'swap-horizontal-outline' },
      { text: 'Помятая упаковка', icon: 'cube-outline' },
      { text: 'Курьер нагрубил', icon: 'person-outline' },
      { text: 'Невкусно', icon: 'restaurant-outline' },
    ],
    good: [
      { text: 'Привезли быстро', icon: 'flash-outline' },
      { text: 'Всё горячее', icon: 'flame-outline' },
      { text: 'Очень вкусно', icon: 'restaurant-outline' },
      { text: 'Вежливый курьер', icon: 'person-outline' },
      { text: 'Аккуратная упаковка', icon: 'cube-outline' },
      { text: 'Щедрые порции', icon: 'pizza-outline' },
    ],
  },
  // На самовывозе нет курьера — про него и не спрашиваем
  pickup: {
    bad: [
      { text: 'Долго ждал', icon: 'time-outline' },
      { text: 'Отдали холодным', icon: 'snow-outline' },
      { text: 'Ошиблись в заказе', icon: 'swap-horizontal-outline' },
      { text: 'Помятая упаковка', icon: 'cube-outline' },
      { text: 'Невежливо встретили', icon: 'person-outline' },
      { text: 'Невкусно', icon: 'restaurant-outline' },
    ],
    good: [
      { text: 'Отдали быстро', icon: 'flash-outline' },
      { text: 'Всё горячее', icon: 'flame-outline' },
      { text: 'Очень вкусно', icon: 'restaurant-outline' },
      { text: 'Приветливый персонал', icon: 'person-outline' },
      { text: 'Аккуратная упаковка', icon: 'cube-outline' },
      { text: 'Щедрые порции', icon: 'pizza-outline' },
    ],
  },
};

/** Звезда наливается золотом и подпрыгивает — по очереди, волной слева направо. */
function Star({ index, rating, onPick }: { index: number; rating: number; onPick: () => void }) {
  const theme = useTheme();
  const lit = index <= rating;

  const fill = useDerivedValue(() =>
    withSpring(lit ? 1 : 0, { damping: 11, stiffness: 220 }),
  );

  const shell = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + fill.value * 0.18 }, { translateY: -fill.value * 4 }],
  }));

  const glow = useAnimatedStyle(() => ({
    opacity: fill.value * 0.5,
    transform: [{ scale: 0.6 + fill.value * 0.9 }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Оценка ${index} из 5`}
      hitSlop={theme.hitSlop}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPick();
      }}
      style={styles.center}
    >
      {/* Свечение под звездой: золото, а не тень — плоская иконка оживает */}
      <Animated.View
        style={[
          styles.glow,
          glow,
          { backgroundColor: theme.colors.warning, borderRadius: theme.radius.pill },
        ]}
      />
      <Animated.View style={shell}>
        <Ionicons
          name={lit ? 'star' : 'star-outline'}
          size={40}
          color={lit ? theme.colors.warning : theme.colors.border}
        />
      </Animated.View>
    </Pressable>
  );
}

type Props = {
  order: Order;
  onClose: () => void;
};

/**
 * Оценка доставленного заказа.
 *
 * Спрашиваем один раз и только после доставки. Публичного рейтинга у сети нет —
 * отзыв читает только персонал, поэтому гостю незачем взвешивать слова. Отказ
 * тоже ответ: смахнул шторку вниз — вопрос снят.
 */
export function OrderRating({ order, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  const send = useMutation({
    mutationFn: () =>
      api.rateOrder(order.id, {
        rating,
        tags,
        comment: comment.trim().length > 0 ? comment.trim() : null,
      }),
    onSuccess: () => {
      track('order_rated', { rating, tags: tags.length, comment: comment.length > 0 });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Список заказов теперь знает об оценке — второй раз не спросим
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setDone(true);
      setTimeout(onClose, 1900);
    },
    // Не дошло — не мучаем гостя повтором: оценка не стоит его нервов
    onError: onClose,
  });

  const positive = rating >= 4;
  const list = TAGS[order.type === 'delivery' ? 'delivery' : 'pickup'];
  const choices = positive ? list.good : list.bad;

  // Список подменился — прежние отметки к нему уже не относятся
  useEffect(() => {
    setTags([]);
  }, [positive]);

  const mood = MOOD[rating];
  const moodColor =
    mood === undefined
      ? theme.colors.textTertiary
      : mood.tone === 'danger'
        ? theme.colors.danger
        : mood.tone === 'warning'
          ? theme.colors.warning
          : theme.colors.accent;

  // Шторку можно просто смахнуть вниз — это то же «Не сейчас»
  const pull = useSharedValue(0);
  const leaving = useSharedValue(false);
  const scroll = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });

  const swipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((event) => {
      // Тянем только с самого верха: ниже жест мешал бы прокрутке
      if (leaving.value || event.translationY <= 0 || scroll.value > 4) return;
      pull.value = event.translationY;
    })
    .onEnd((event) => {
      if (leaving.value) return;

      if (pull.value > 120 || event.velocityY > 900) {
        leaving.value = true;
        pull.value = withTiming(600, { duration: 220, easing: Easing.in(Easing.cubic) });
        runOnJS(onClose)();
        return;
      }

      pull.value = withSpring(0, { damping: 18, stiffness: 200 });
    });

  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  // Чем дальше оттянули, тем прозрачнее фон: видно, что шторка уходит
  const veil = useAnimatedStyle(() => ({
    opacity: interpolate(pull.value, [0, 320], [1, 0], 'clamp'),
  }));

  // Ореол вокруг лица оценки дышит, пока гость не выбрал
  const halo = useSharedValue(0);

  useEffect(() => {
    halo.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [halo]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.14 + halo.value * 0.16,
    transform: [{ scale: 1 + halo.value * 0.12 }],
  }));

  const faceScale = useDerivedValue(() =>
    withSpring(rating > 0 ? 1 : 0.94, { damping: 12, stiffness: 200 }),
  );

  const face = useAnimatedStyle(() => ({ transform: [{ scale: faceScale.value }] }));

  const grow = useDerivedValue(() => withTiming(rating > 0 ? 1 : 0, { duration: 260 }));

  const extra = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [{ translateY: (1 - grow.value) * 14 }],
  }));

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={[styles.scrim, veil, { backgroundColor: theme.colors.scrim }]}
      >
        <Pressable style={styles.grow} onPress={onClose} accessibilityLabel="Закрыть" />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <GestureDetector gesture={swipe}>
          <Animated.View
            entering={SlideInDown.duration(360)}
            style={[
              sheet,
              styles.sheet,
              {
                maxHeight: '92%',
                borderTopLeftRadius: theme.radius.xxl,
                borderTopRightRadius: theme.radius.xxl,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            {/* Язычок: за него шторку тянут вниз, и это видно без подписи */}
            <View style={[styles.center, { paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
              <View
                style={{
                  width: theme.spacing.xxl,
                  height: 4,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.border,
                }}
              />
            </View>

            <Animated.ScrollView
              onScroll={onScroll}
              scrollEventThrottle={16}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: theme.layout.screenPadding,
                paddingBottom: insets.bottom + theme.spacing.lg,
                gap: theme.spacing.base,
              }}
            >
            {done ? (
              <View style={[styles.center, { paddingVertical: theme.spacing.xl, gap: theme.spacing.md }]}>
                {positive ? (
                  <Confetti colors={[theme.colors.warning, theme.colors.accent, theme.colors.brand]} />
                ) : null}

                <SuccessCheck color={moodColor} ringColor={theme.colors.accentSubtle} />

                <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                  Спасибо!
                </Text>
                <Text
                  style={[theme.typography.body, styles.centered, { color: theme.colors.textSecondary }]}
                >
                  {positive
                    ? 'Передадим ресторану — им будет приятно'
                    : 'Разберёмся, что пошло не так'}
                </Text>
              </View>
            ) : (
              <>
                <View style={[styles.center, { gap: theme.spacing.sm }]}>
                  {/* Лицо оценки: цвет и выражение меняются вместе со звёздами */}
                  <View style={styles.mark}>
                    <Animated.View
                      style={[
                        StyleSheet.absoluteFill,
                        haloStyle,
                        { borderRadius: theme.radius.pill, backgroundColor: moodColor },
                      ]}
                    />
                    <Animated.View
                      style={[
                        face,
                        styles.center,
                        styles.mark,
                        { borderRadius: theme.radius.pill },
                      ]}
                    >
                      <Ionicons
                        name={mood?.icon ?? 'star-outline'}
                        size={34}
                        color={moodColor}
                      />
                    </Animated.View>
                  </View>

                  <Text style={[theme.typography.h2, styles.centered, { color: theme.colors.textPrimary }]}>
                    Как всё прошло?
                  </Text>
                  <Text
                    style={[
                      theme.typography.caption,
                      styles.centered,
                      { color: theme.colors.textTertiary },
                    ]}
                  >
                    Заказ № {order.number} · {order.restaurant_name}
                  </Text>
                </View>

                <View style={[styles.stars, { gap: theme.spacing.xs }]}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} index={star} rating={rating} onPick={() => setRating(star)} />
                  ))}
                </View>

                {/* Слово вместо цифры: меняется вместе с оценкой */}
                <View style={[styles.center, { height: theme.spacing.xl }]}>
                  {mood ? (
                    <Animated.View
                      key={mood.word}
                      entering={FadeInDown.duration(220).easing(Easing.out(Easing.quad))}
                      style={{
                        paddingHorizontal: theme.spacing.base,
                        paddingVertical: theme.spacing.xxs,
                        borderRadius: theme.radius.pill,
                        backgroundColor: theme.colors.surfaceSunken,
                      }}
                    >
                      <Text style={[theme.typography.bodyMedium, { color: moodColor }]}>
                        {mood.word}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>

                {rating > 0 ? (
                  <Animated.View style={[extra, { gap: theme.spacing.base }]}>
                    <Text
                      style={[
                        theme.typography.bodyMedium,
                        styles.centered,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {positive ? 'Что понравилось?' : 'Что пошло не так?'}
                    </Text>

                    <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                      {choices.map((tag, index) => {
                        const picked = tags.includes(tag.text);

                        return (
                          <Animated.View
                            key={tag.text}
                            entering={FadeInDown.duration(240)
                              .delay(index * 40)
                              .easing(Easing.out(Easing.quad))}
                          >
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ selected: picked }}
                              onPress={() => {
                                void Haptics.selectionAsync();
                                setTags((current) =>
                                  picked
                                    ? current.filter((item) => item !== tag.text)
                                    : [...current, tag.text],
                                );
                              }}
                              style={[
                                styles.chip,
                                {
                                  paddingLeft: theme.spacing.md,
                                  paddingRight: theme.spacing.base,
                                  paddingVertical: theme.spacing.sm,
                                  gap: theme.spacing.xs,
                                  borderRadius: theme.radius.pill,
                                  borderWidth: 1.5,
                                  borderColor: picked ? moodColor : theme.colors.border,
                                  backgroundColor: picked
                                    ? theme.colors.surfaceSunken
                                    : theme.colors.surface,
                                },
                              ]}
                            >
                              <Ionicons
                                name={picked ? 'checkmark-circle' : tag.icon}
                                size={17}
                                color={picked ? moodColor : theme.colors.textTertiary}
                              />
                              <Text
                                style={[
                                  theme.typography.bodyMedium,
                                  { color: picked ? theme.colors.textPrimary : theme.colors.textSecondary },
                                ]}
                              >
                                {tag.text}
                              </Text>
                            </Pressable>
                          </Animated.View>
                        );
                      })}
                    </View>

                    <TextField
                      label="Комментарий"
                      value={comment}
                      onChangeText={setComment}
                      placeholder={positive ? 'Что запомнилось' : 'Что стоит исправить'}
                      multiline
                    />

                    <PrimaryButton
                      label="Отправить"
                      loading={send.isPending}
                      onPress={() => send.mutate()}
                    />
                  </Animated.View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={onClose}
                  style={[styles.center, { minHeight: theme.layout.minTouchTarget }]}
                >
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.textTertiary }]}>
                    Не сейчас
                  </Text>
                </Pressable>
              </>
            )}
            </Animated.ScrollView>
          </Animated.View>
        </GestureDetector>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  grow: { flex: 1 },
  sheet: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  mark: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 40, height: 40 },
  stars: { flexDirection: 'row', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center' },
});
