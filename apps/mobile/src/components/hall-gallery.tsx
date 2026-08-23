import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { mediaUrl, type Restaurant } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { Skeleton } from '@/components/skeleton';
import { useTheme } from '@/theme/theme-provider';

const HEIGHT = 300;
const AUTOPLAY_MS = 4200;

type Props = {
  restaurant?: Restaurant;
  loading?: boolean;
  open: boolean;
  onChange: () => void;
};

/** Один кадр зала: при пролистывании двигается медленнее свайпа — глубина. */
function Frame({
  uri,
  index,
  offset,
  width,
  height,
}: {
  uri: string;
  index: number;
  offset: { value: number };
  width: number;
  height: number;
}) {
  const theme = useTheme();

  const parallax = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          offset.value,
          [(index - 1) * width, index * width, (index + 1) * width],
          [-width * 0.22, 0, width * 0.22],
        ),
      },
      {
        scale: interpolate(
          offset.value,
          [(index - 1) * width, index * width, (index + 1) * width],
          [1.12, 1, 1.12],
        ),
      },
    ],
  }));

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.skeleton }]}
          contentFit="cover"
          transition={260}
          // Кадры листаются по кругу — держим их в памяти и на диске
          cachePolicy="memory-disk"
          priority={index === 0 ? 'high' : 'low'}
          recyclingKey={uri}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Витрина зала: несколько снимков ресторана листаются сами, поверх — название,
 * часы и переход к списку. Гость выбирает стол глазами, а не по адресу.
 */
export function HallGallery({ restaurant, loading, open, onChange }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const scroller = useRef<ScrollView>(null);
  const offset = useSharedValue(0);
  const [page, setPage] = useState(0);
  const [touched, setTouched] = useState(false);

  const photos = (restaurant?.photos ?? [])
    .map((path) => mediaUrl(path))
    .filter((uri): uri is string => Boolean(uri));

  // Больше восьми кадров карусели никто не пролистывает, а память они занимают
  const shots = (
    photos.length > 0
      ? photos
      : [mediaUrl(restaurant?.image_url)].filter((uri): uri is string => Boolean(uri))
  ).slice(0, 8);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offset.value = event.contentOffset.x;
    },
  });

  // Кадры сменяются сами, пока гость не листает вручную
  useEffect(() => {
    if (touched || shots.length < 2) return;

    const timer = setInterval(() => {
      setPage((current) => {
        const next = (current + 1) % shots.length;
        scroller.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTOPLAY_MS);

    return () => clearInterval(timer);
  }, [touched, shots.length, width]);

  // Сменился ресторан — показываем его с первого кадра
  useEffect(() => {
    setPage(0);
    setTouched(false);
    scroller.current?.scrollTo({ x: 0, animated: false });
  }, [restaurant?.id]);

  if (loading) return <Skeleton height={HEIGHT + insets.top} radius={0} />;

  return (
    <View style={{ height: HEIGHT + insets.top }}>
      <Animated.ScrollView
        ref={scroller as never}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setTouched(true)}
        onMomentumScrollEnd={(event) =>
          setPage(Math.round(event.nativeEvent.contentOffset.x / width))
        }
      >
        {shots.map((uri, index) => (
          <Frame
            key={uri}
            uri={uri}
            index={index}
            offset={offset}
            width={width}
            height={HEIGHT + insets.top}
          />
        ))}
      </Animated.ScrollView>

      {/* Снимки залов светлые: без затемнения текст на них не читается */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(20,14,12,0.55)', 'rgba(20,14,12,0.05)', 'rgba(20,14,12,0.82)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          StyleSheet.absoluteFill,
          styles.overlay,
          {
            padding: theme.layout.screenPadding,
            paddingTop: insets.top + theme.spacing.sm,
            // Под кнопкой «Другой ресторан» нужен запас: сверху на неё
            // наезжает форма брони
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.sm,
          },
        ]}
      >
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View
            style={[
              styles.badge,
              {
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radius.pill,
                backgroundColor: open ? 'rgba(27,127,90,0.92)' : 'rgba(20,14,12,0.6)',
                gap: theme.spacing.xs,
              },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: '#FFFFFF' }]} />
            <Text style={[theme.typography.overline, { color: '#FFFFFF' }]}>
              {open ? 'Открыт' : 'Закрыт'}
            </Text>
          </View>

          <View style={styles.grow} />

          {shots.length > 1 ? (
            <View style={[styles.row, { gap: theme.spacing.xs }]}>
              {shots.map((uri, index) => (
                <View
                  key={uri}
                  style={{
                    width: index === page ? 18 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: index === page ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.grow} />

        <Animated.View entering={FadeIn.duration(300)} style={{ gap: theme.spacing.xxs }}>
          <Text style={[theme.typography.overline, { color: 'rgba(255,255,255,0.75)' }]}>
            Бронь стола
          </Text>

          <Text numberOfLines={1} style={[theme.typography.h1, { color: '#FFFFFF' }]}>
            {restaurant?.name ?? 'Выберите ресторан'}
          </Text>

          {restaurant?.metro ? (
            <View style={[styles.row, { gap: theme.spacing.xs }]}>
              <Ionicons name="subway" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={[theme.typography.caption, { color: 'rgba(255,255,255,0.85)' }]}>
                {restaurant.metro} · {restaurant.opens_at.slice(0, 5)}–
                {restaurant.closes_at.slice(0, 5)}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        <PressableScale
          depth={0.97}
          accessibilityLabel="Выбрать другой ресторан"
          onPress={onChange}
          style={[
            styles.row,
            {
              alignSelf: 'flex-start',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.base,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: 'rgba(255,255,255,0.16)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: 'rgba(255,255,255,0.45)',
            },
          ]}
        >
          <Ionicons name="location" size={14} color="#FFFFFF" />
          <Text style={[theme.typography.bodyMedium, { color: '#FFFFFF' }]}>
            {restaurant ? 'Другой ресторан' : 'Выбрать ресторан'}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  overlay: { justifyContent: 'flex-start' },
  badge: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
