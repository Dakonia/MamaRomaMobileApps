import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { api, mediaUrl } from '@/api/client';
import { EmptyArt, type EmptyArtKind } from '@/components/empty-art';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

// Соусы и напитки на фотографии не читаются — берём то, что выглядит едой
const DULL = /соус|напит|добав|допол/i;

type Props = {
  /** Экран уже рисует фон сам — тогда второй слой не нужен. */
  backdrop?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  /** Рисунок вместо блюд: нужен, когда меню ещё не загружено или его нет. */
  art?: EmptyArtKind;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Три блюда полукругом: крайние мельче и ниже, среднее крупное впереди
const SPOTS = [
  { size: 76, x: -72, y: 16, angle: -12, drift: 3600 },
  { size: 104, x: 0, y: -6, angle: 4, drift: 4400 },
  { size: 76, x: 72, y: 16, angle: 13, drift: 3100 },
] as const;

function FloatingPlate({
  uri,
  spot,
  index,
}: {
  uri: string;
  spot: (typeof SPOTS)[number];
  index: number;
}) {
  const theme = useTheme();
  const shift = useSharedValue(0);

  useEffect(() => {
    shift.value = withDelay(
      index * 260,
      withRepeat(withTiming(1, { duration: spot.drift }), -1, true),
    );
  }, [index, shift, spot.drift]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: spot.x },
      { translateY: spot.y - 8 * shift.value },
      { rotate: `${spot.angle}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.plate,
        style,
        theme.elevation.card,
        {
          width: spot.size,
          height: spot.size,
          borderRadius: spot.size / 2,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%', borderRadius: spot.size / 2 }}
        contentFit="cover"
        transition={300}
      />
    </Animated.View>
  );
}

/**
 * Пустой экран с характером: вместо серой иконки — три блюда из разных
 * категорий меню, которые мягко покачиваются над тёплым свечением.
 */
export function EmptyState({
  backdrop = true,
  icon,
  art = 'plate',
  title,
  description,
  actionLabel,
  onAction,
}: Props) {
  const theme = useTheme();

  const restaurantId = useCart((state) => state.restaurantId);

  // Тот же ключ, что у экрана меню: обычно данные уже в кеше и запроса не будет
  const menu = useQuery({
    queryKey: ['menu', restaurantId],
    queryFn: () => api.menu(restaurantId ?? undefined),
    staleTime: 10 * 60_000,
  });

  const photos: string[] = [];
  for (const category of menu.data?.categories ?? []) {
    if (DULL.test(category.name)) continue;

    const dish = category.dishes.find((item) => item.image_url !== null);
    const uri = mediaUrl(dish?.image_url);
    if (uri) photos.push(uri);
    if (photos.length === SPOTS.length) break;
  }

  return (
    <View style={[styles.root, { padding: theme.spacing.xl, gap: theme.spacing.md }]}>
      {backdrop ? <PizzaBackdrop strength={0.6} /> : null}

      {photos.length === SPOTS.length ? (
        <Animated.View entering={FadeIn.duration(400)} style={styles.stage}>
          <View
            style={[
              styles.glow,
              { borderRadius: theme.radius.pill, backgroundColor: theme.colors.brandSubtle },
            ]}
          />
          {photos.map((uri, index) => (
            <FloatingPlate key={uri} uri={uri} spot={SPOTS[index]} index={index} />
          ))}
        </Animated.View>
      ) : (
        // Фотографий нет — например, гость без сети. Рисуем своё, а не серую иконку
        <Animated.View entering={FadeIn.duration(400)}>
          <EmptyArt kind={art} />
        </Animated.View>
      )}

      <Text style={[theme.typography.h2, styles.centered, { color: theme.colors.textPrimary }]}>
        {title}
      </Text>

      <Text style={[theme.typography.body, styles.centered, { color: theme.colors.textSecondary }]}>
        {description}
      </Text>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={theme.hitSlop}
          style={({ pressed }) => [
            styles.center,
            {
              minHeight: theme.layout.minTouchTarget,
              paddingHorizontal: theme.spacing.xl,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
              marginTop: theme.spacing.xs,
            },
          ]}
        >
          <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { height: 150, width: '100%', alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 230, height: 130, opacity: 0.7 },
  plate: { position: 'absolute', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
});
