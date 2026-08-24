import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Order } from '@/api/client';
import { PrimaryButton } from '@/components/primary-button';
import { SuccessCheck } from '@/components/success-check';
import { TextField } from '@/components/text-field';
import { track } from '@/lib/analytics';
import { useTheme } from '@/theme/theme-provider';

/** Что могло пойти не так и что понравилось: слова гостя писать необязательно. */
const BAD_TAGS = ['Долго везли', 'Остыло', 'Не то привезли', 'Упаковка', 'Курьер', 'Вкус'];
const GOOD_TAGS = ['Быстро', 'Вкусно', 'Горячее', 'Вежливый курьер', 'Упаковка', 'Порции'];

const WORDS: Record<number, string> = {
  1: 'Плохо, извините',
  2: 'Так себе',
  3: 'Нормально',
  4: 'Хорошо',
  5: 'Отлично!',
};

/** Звезда: при выборе наливается и коротко подпрыгивает. */
function Star({ index, rating, onPick }: { index: number; rating: number; onPick: () => void }) {
  const theme = useTheme();
  const lit = index <= rating;

  const fill = useDerivedValue(() => withSpring(lit ? 1 : 0, { damping: 12, stiffness: 220 }));

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + fill.value * 0.2 }, { translateY: -fill.value * 3 }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Оценка ${index}`}
      hitSlop={theme.hitSlop}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPick();
      }}
    >
      <Animated.View style={style}>
        <Ionicons
          name={lit ? 'star' : 'star-outline'}
          size={38}
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
 * Оценка доставленного заказа. Спрашиваем один раз и только после доставки —
 * отзыв видит сеть, публичного рейтинга у нас нет, поэтому гость может писать
 * честно. Отказ тоже ответ: закрыл окно — больше не спрашиваем.
 */
export function OrderRating({ order, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
      setDone(true);
      setTimeout(onClose, 1700);
    },
    // Не дошло — не мучаем гостя повтором: оценка не стоит его нервов
    onError: onClose,
  });

  // Набор отметок меняется вместе с настроением оценки
  const positive = rating >= 4;
  const choices = positive ? GOOD_TAGS : BAD_TAGS;

  // Список подменился — прежние отметки к нему уже не относятся
  useEffect(() => {
    setTags([]);
  }, [positive]);

  const grow = useDerivedValue(() => withTiming(rating > 0 ? 1 : 0, { duration: 240 }));

  const extra = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [{ translateY: (1 - grow.value) * 12 }],
  }));

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={[styles.scrim, { backgroundColor: theme.colors.scrim }]}
      >
        <Pressable style={styles.grow} onPress={onClose} accessibilityLabel="Закрыть" />

        <Animated.View
          entering={SlideInDown.duration(320)}
          exiting={SlideOutDown.duration(220)}
          style={{
            paddingHorizontal: theme.layout.screenPadding,
            paddingTop: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            backgroundColor: theme.colors.surface,
            gap: theme.spacing.base,
          }}
        >
          {done ? (
            <View style={[styles.center, { paddingVertical: theme.spacing.xl, gap: theme.spacing.md }]}>
              <SuccessCheck color={theme.colors.accent} ringColor={theme.colors.accentSubtle} />
              <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                Спасибо!
              </Text>
              <Text
                style={[theme.typography.body, styles.centered, { color: theme.colors.textSecondary }]}
              >
                {rating >= 4
                  ? 'Передадим ресторану — им приятно'
                  : 'Разберёмся, что пошло не так'}
              </Text>
            </View>
          ) : (
            <>
              <View style={{ gap: theme.spacing.xxs }}>
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

              <View style={[styles.stars, { gap: theme.spacing.sm }]}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} index={star} rating={rating} onPick={() => setRating(star)} />
                ))}
              </View>

              <Text
                style={[
                  theme.typography.bodyMedium,
                  styles.centered,
                  { color: rating > 0 ? theme.colors.textPrimary : theme.colors.textTertiary },
                ]}
              >
                {rating > 0 ? WORDS[rating] : 'Нажмите на звёзды'}
              </Text>

              {rating > 0 ? (
                <Animated.View style={[extra, { gap: theme.spacing.base }]}>
                  <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                    {choices.map((tag, index) => {
                      const picked = tags.includes(tag);

                      return (
                        <Animated.View
                          key={tag}
                          entering={FadeInDown.duration(220).delay(index * 30).easing(
                            Easing.out(Easing.quad),
                          )}
                        >
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              void Haptics.selectionAsync();
                              setTags((current) =>
                                picked ? current.filter((item) => item !== tag) : [...current, tag],
                              );
                            }}
                            style={{
                              paddingHorizontal: theme.spacing.base,
                              paddingVertical: theme.spacing.sm,
                              borderRadius: theme.radius.pill,
                              borderWidth: StyleSheet.hairlineWidth,
                              borderColor: picked ? theme.colors.brand : theme.colors.border,
                              backgroundColor: picked
                                ? theme.colors.brandSubtle
                                : theme.colors.surface,
                            }}
                          >
                            <Text
                              style={[
                                theme.typography.bodyMedium,
                                { color: picked ? theme.colors.brand : theme.colors.textSecondary },
                              ]}
                            >
                              {tag}
                            </Text>
                          </Pressable>
                        </Animated.View>
                      );
                    })}
                  </View>

                  <TextField
                    label="Что добавить?"
                    value={comment}
                    onChangeText={setComment}
                    hint="Не обязательно. Прочитает только ресторан"
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
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
