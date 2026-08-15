import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, mediaUrl, type Promotion } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function until(promotion: Promotion): string | null {
  if (!promotion.ends_at) return null;
  const date = new Date(promotion.ends_at);
  return `До ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export default function PromosScreen() {
  const theme = useTheme();
  const cart = useCart();

  const promos = useQuery({
    queryKey: ['promotions', cart.restaurantId],
    queryFn: () => api.promotions(cart.restaurantId ?? undefined),
  });

  const content = () => {
    if (promos.isPending) {
      return (
        <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.base }}>
          {[0, 1, 2].map((row) => (
            <View
              key={row}
              style={{
                height: theme.spacing.huge * 3,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.skeleton,
              }}
            />
          ))}
        </View>
      );
    }

    if (promos.isError) {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Акции не загрузились"
          description={promos.error.message}
          actionLabel="Повторить"
          onAction={() => {
            void promos.refetch();
          }}
        />
      );
    }

    if ((promos.data ?? []).length === 0) {
      return (
        <EmptyState
          icon="pricetags-outline"
          title="Пока без акций"
          description="Здесь появятся сезонные предложения и подборки."
        />
      );
    }

    return (
      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.lg,
          paddingBottom: theme.layout.tabBarHeight + theme.spacing.xxxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={promos.isRefetching}
            onRefresh={() => {
              void promos.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        {(promos.data ?? []).map((promotion) => {
          const photo = mediaUrl(promotion.image_url);
          const deadline = until(promotion);

          return (
            <View
              key={promotion.id}
              style={[
                styles.card,
                {
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.surfaceSunken,
                  ...theme.elevation.card,
                },
              ]}
            >
              {photo ? (
                <View>
                  <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" transition={200} />
                  {promotion.label ? (
                    <View
                      style={[
                        styles.label,
                        {
                          top: theme.spacing.md,
                          left: theme.spacing.md,
                          paddingHorizontal: theme.spacing.md,
                          paddingVertical: theme.spacing.xs,
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
                </View>
              ) : null}

              <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
                {!photo && promotion.label ? (
                  <Text style={[theme.typography.overline, { color: theme.colors.brand }]}>
                    {promotion.label}
                  </Text>
                ) : null}

                <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
                  {promotion.title}
                </Text>

                {promotion.description ? (
                  <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                    {promotion.description}
                  </Text>
                ) : null}

                {deadline ? (
                  <Text
                    style={[
                      theme.typography.caption,
                      { color: theme.colors.accent, marginTop: theme.spacing.xs },
                    ]}
                  >
                    {deadline}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Акции" subtitle="Специальные предложения сети" />
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { overflow: 'hidden' },
  photo: { width: '100%', height: 180 },
  label: { position: 'absolute' },
});
