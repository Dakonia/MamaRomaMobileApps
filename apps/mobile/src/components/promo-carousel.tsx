import { Image } from 'expo-image';
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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={cardWidth + theme.spacing.md}
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
                backgroundColor: theme.colors.brandSubtle,
                ...theme.elevation.card,
              },
            ]}
          >
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={220}
              />
            ) : null}

            <View
              style={[
                styles.veil,
                { backgroundColor: photo ? theme.colors.overlay : 'transparent' },
              ]}
            />

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
                  <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                    {promotion.label}
                  </Text>
                </View>
              ) : null}

              <Text
                numberOfLines={2}
                style={[
                  theme.typography.h2,
                  { color: photo ? theme.colors.textInverse : theme.colors.textPrimary },
                ]}
              >
                {promotion.title}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', justifyContent: 'flex-end' },
  veil: { ...StyleSheet.absoluteFillObject },
  body: { alignItems: 'flex-start' },
  label: { alignSelf: 'flex-start' },
});
