import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { mediaUrl, type Promotion } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  promotions: Promotion[];
  onOpen: (id: string) => void;
};

export function PromoCarousel({ promotions, onOpen }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  if (promotions.length === 0) {
    return null;
  }

  // Край следующей карточки виден — так понятно, что полку можно листать
  const cardWidth = width - theme.layout.screenPadding * 2 - theme.spacing.xxl;
  const step = cardWidth + theme.spacing.md;

  const list = useRef<ScrollView>(null);
  const index = useRef(0);
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  // Полка едет сама, пока её не трогают: акции замечают, только если они движутся
  useEffect(() => {
    if (promotions.length < 2) return;

    const timer = setInterval(() => {
      if (paused.current) return;
      index.current = (index.current + 1) % promotions.length;
      setActive(index.current);
      list.current?.scrollTo({ x: index.current * step, animated: true });
    }, 4500);

    return () => clearInterval(timer);
  }, [promotions.length, step]);

  return (
    <>
    <ScrollView
      ref={list}
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={step}
      onTouchStart={() => {
        paused.current = true;
      }}
      onMomentumScrollEnd={(event) => {
        // Гость пролистал сам — продолжаем с того места, где он остановился
        index.current = Math.round(event.nativeEvent.contentOffset.x / step);
        setActive(index.current);
        paused.current = false;
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenPadding,
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      {promotions.map((promotion) => {
        const photo = mediaUrl(promotion.image_url);

        return (
          <PressableScale
            key={promotion.id}
            onPress={() => onOpen(promotion.id)}
            accessibilityLabel={promotion.title}
            depth={0.98}
            style={[
              styles.card,
              {
                width: cardWidth,
                height: cardWidth * 0.46,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                ...theme.elevation.card,
              },
            ]}
          >
            {/* Фотография в своей квадратной части: раньше она растягивалась
                на всю карточку и у широкого баннера срезало половину кадра */}
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={{ width: cardWidth * 0.46, height: '100%' }}
                contentFit="cover"
                transition={220}
              />
            ) : null}

            <View style={[styles.body, { padding: theme.spacing.base, gap: theme.spacing.xs }]}>
              {promotion.label ? (
                <View
                  style={[
                    styles.label,
                    {
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xxs,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.brand,
                    },
                  ]}
                >
                  <Text style={[theme.typography.overline, { color: theme.colors.textOnBrand }]}>
                    {promotion.label}
                  </Text>
                </View>
              ) : null}

              <Text
                numberOfLines={2}
                style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}
              >
                {promotion.title}
              </Text>

              {promotion.description ? (
                <Text
                  numberOfLines={2}
                  style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
                >
                  {promotion.description.replace(/\s*\n\s*/g, ' ')}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>

    {promotions.length > 1 ? (
      <View style={[styles.dots, { gap: theme.spacing.xs }]}>
        {promotions.map((promotion, position) => (
          <View
            key={promotion.id}
            style={{
              width: position === active ? 14 : 5,
              height: 5,
              borderRadius: 3,
              backgroundColor:
                position === active ? theme.colors.brand : theme.colors.border,
            }}
          />
        ))}
      </View>
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', flexDirection: 'row', alignItems: 'stretch' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
  label: { alignSelf: 'flex-start' },
  dots: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 4 },
});
