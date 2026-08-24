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
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
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

type Tone = 'bad' | 'mixed' | 'good';

const toneOf = (rating: number): Tone => (rating >= 4 ? 'good' : rating === 3 ? 'mixed' : 'bad');

/** Лицо оценки: выражение и слово меняются вместе со звёздами. */
const MOOD: Record<number, { icon: keyof typeof Ionicons.glyphMap; word: string }> = {
  1: { icon: 'sad-outline', word: 'Совсем не то' },
  2: { icon: 'sad-outline', word: 'Не понравилось' },
  3: { icon: 'ellipsis-horizontal', word: 'Нормально' },
  4: { icon: 'happy-outline', word: 'Хорошо' },
  5: { icon: 'heart', word: 'Всё отлично!' },
};

const HEADING: Record<Tone, string> = {
  bad: 'Что пошло не так?',
  mixed: 'Что улучшить?',
  good: 'Что понравилось?',
};

type Tag = { text: string; icon: keyof typeof Ionicons.glyphMap };

/**
 * Отметки: свой набор на каждое настроение оценки и по четыре штуки, чтобы
 * блок не разрастался. Пишем целой мыслью — «Курьер» не говорит ничего,
 * а «Вежливый курьер» и «Курьер нагрубил» говорят.
 */
const TAGS: Record<'delivery' | 'pickup', Record<Tone, Tag[]>> = {
  delivery: {
    bad: [
      { text: 'Долго везли', icon: 'time-outline' },
      { text: 'Привезли холодным', icon: 'snow-outline' },
      { text: 'Ошиблись в заказе', icon: 'swap-horizontal-outline' },
      { text: 'Курьер нагрубил', icon: 'person-outline' },
    ],
    mixed: [
      { text: 'Могли быстрее', icon: 'time-outline' },
      { text: 'Не очень горячее', icon: 'thermometer-outline' },
      { text: 'Мелкая ошибка', icon: 'swap-horizontal-outline' },
      { text: 'Помятая упаковка', icon: 'cube-outline' },
    ],
    good: [
      { text: 'Привезли быстро', icon: 'flash-outline' },
      { text: 'Всё горячее', icon: 'flame-outline' },
      { text: 'Очень вкусно', icon: 'restaurant-outline' },
      { text: 'Вежливый курьер', icon: 'person-outline' },
    ],
  },
  // На самовывозе нет курьера — про него и не спрашиваем
  pickup: {
    bad: [
      { text: 'Долго ждал', icon: 'time-outline' },
      { text: 'Отдали холодным', icon: 'snow-outline' },
      { text: 'Ошиблись в заказе', icon: 'swap-horizontal-outline' },
      { text: 'Невежливо встретили', icon: 'person-outline' },
    ],
    mixed: [
      { text: 'Пришлось ждать', icon: 'time-outline' },
      { text: 'Не очень горячее', icon: 'thermometer-outline' },
      { text: 'Мелкая ошибка', icon: 'swap-horizontal-outline' },
      { text: 'Помятая упаковка', icon: 'cube-outline' },
    ],
    good: [
      { text: 'Отдали быстро', icon: 'flash-outline' },
      { text: 'Всё горячее', icon: 'flame-outline' },
      { text: 'Очень вкусно', icon: 'restaurant-outline' },
      { text: 'Приветливый персонал', icon: 'person-outline' },
    ],
  },
};

/** Звезда наливается по очереди — волной слева направо, без свечений и теней. */
function Star({ index, rating, onPick }: { index: number; rating: number; onPick: () => void }) {
  const theme = useTheme();
  const lit = index <= rating;

  const fill = useDerivedValue(() =>
    withDelay(lit ? index * 45 : 0, withSpring(lit ? 1 : 0, { damping: 10, stiffness: 240 })),
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + fill.value * 0.2 }, { translateY: -fill.value * 4 }],
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
    >
      <Animated.View style={style}>
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
 * тоже ответ: потянул шторку за язычок вниз — вопрос снят.
 */
export function OrderRating({ order, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);

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
      setTimeout(onClose, 2400);
    },
    // Не дошло — не мучаем гостя повтором: оценка не стоит его нервов
    onError: onClose,
  });

  const tone = toneOf(rating);
  const choices = TAGS[order.type === 'delivery' ? 'delivery' : 'pickup'][tone];

  // Список подменился — прежние отметки к нему уже не относятся
  useEffect(() => {
    setTags([]);
  }, [tone]);

  const mood = MOOD[rating];
  const moodColor =
    rating === 0
      ? theme.colors.textTertiary
      : tone === 'bad'
        ? theme.colors.danger
        : tone === 'mixed'
          ? theme.colors.warning
          : theme.colors.accent;

  /**
   * Шторку тянут за язычок, а не за всё полотно: ниже живёт прокрутка, и два
   * жеста на одной площади всё время спорили друг с другом
   */
  const pull = useSharedValue(0);
  const leaving = useSharedValue(false);

  const swipe = Gesture.Pan()
    .onUpdate((event) => {
      if (leaving.value) return;
      // Вверх шторка не едет — только вниз, с сопротивлением у самого верха
      pull.value = event.translationY > 0 ? event.translationY : event.translationY / 6;
    })
    .onEnd((event) => {
      if (leaving.value) return;

      if (pull.value > 110 || event.velocityY > 800) {
        leaving.value = true;
        pull.value = withTiming(700, { duration: 240, easing: Easing.in(Easing.cubic) });
        runOnJS(onClose)();
        return;
      }

      pull.value = withSpring(0, { damping: 20, stiffness: 220 });
    });

  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  // Чем дальше оттянули, тем прозрачнее фон: видно, что шторка уходит
  const veil = useAnimatedStyle(() => ({
    opacity: interpolate(pull.value, [0, 320], [1, 0], 'clamp'),
  }));

  const faceScale = useDerivedValue(() =>
    withSpring(rating > 0 ? 1 : 0.92, { damping: 11, stiffness: 220 }),
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
            <GestureDetector gesture={swipe}>
              <View style={[styles.center, styles.handle]}>
                <View
                  style={{
                    width: 44,
                    height: 5,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.border,
                  }}
                />
              </View>
            </GestureDetector>

            <Animated.ScrollView
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
                <View
                  style={[styles.center, { paddingVertical: theme.spacing.xl, gap: theme.spacing.md }]}
                >
                  <SuccessCheck color={moodColor} ringColor={theme.colors.accentSubtle} />

                  <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                    Спасибо!
                  </Text>
                  <Text
                    style={[
                      theme.typography.body,
                      styles.centered,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {tone === 'good'
                      ? 'Передадим ресторану — им будет приятно'
                      : 'Разберёмся, что пошло не так'}
                  </Text>
                </View>
              ) : (
                <>
                  <View style={[styles.center, { gap: theme.spacing.sm }]}>
                    {/* Лицо оценки: цвет и выражение меняются вместе со звёздами */}
                    <Animated.View
                      style={[
                        face,
                        styles.center,
                        styles.mark,
                        {
                          borderRadius: theme.radius.pill,
                          borderWidth: 1.5,
                          borderColor: moodColor,
                          backgroundColor: theme.colors.surfaceSunken,
                        },
                      ]}
                    >
                      <Animated.View key={rating} entering={FadeIn.duration(220)}>
                        <Ionicons name={mood?.icon ?? 'star-outline'} size={30} color={moodColor} />
                      </Animated.View>
                    </Animated.View>

                    <Text
                      style={[theme.typography.h2, styles.centered, { color: theme.colors.textPrimary }]}
                    >
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

                  <View style={[styles.stars, { gap: theme.spacing.sm }]}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} index={star} rating={rating} onPick={() => setRating(star)} />
                    ))}
                  </View>

                  {/* Слово вместо цифры: меняется вместе с оценкой */}
                  <View style={[styles.center, styles.word]}>
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
                        {HEADING[tone]}
                      </Text>

                      <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                        {choices.map((tag, index) => {
                          const picked = tags.includes(tag.text);

                          return (
                            <Animated.View
                              key={tag.text}
                              entering={FadeInDown.duration(240)
                                .delay(index * 45)
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
                                    {
                                      color: picked
                                        ? theme.colors.textPrimary
                                        : theme.colors.textSecondary,
                                    },
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
                        placeholder={tone === 'good' ? 'Что запомнилось' : 'Что стоит исправить'}
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

            {done && tone === 'good' ? (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Confetti
                  count={30}
                  colors={[
                    theme.colors.warning,
                    theme.colors.accent,
                    theme.colors.brand,
                    theme.colors.warningSubtle,
                  ]}
                />
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  grow: { flex: 1 },
  sheet: { overflow: 'hidden' },
  // Площадь под язычок: за неё тянут, поэтому она заметно больше самой полоски
  handle: { height: 32, paddingTop: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  mark: { width: 68, height: 68 },
  word: { height: 32 },
  stars: { flexDirection: 'row', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center' },
});
