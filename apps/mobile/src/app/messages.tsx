import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl, type Message } from '@/api/client';
import { EmptyState } from '@/components/empty-state';
import { PizzaBackdrop } from '@/components/pizza-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { useRefresher } from '@/components/refresher';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { useTheme } from '@/theme/theme-provider';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «сегодня», «вчера» или дата: точное время в ленте новостей не нужно. */
function when(iso: string | null | undefined): string {
  if (!iso) return '';

  const at = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) /
      86_400_000,
  );

  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  if (days === 0) return `сегодня в ${clock}`;
  if (days === 1) return `вчера в ${clock}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** Куда ведёт сообщение: то же, что и нажатие на уведомление. */
function open(message: Message): void {
  const screen = message.target?.screen;
  const id = message.target?.id;

  if (screen === 'promo' && id) router.push(`/promo/${id}`);
  else if (screen === 'dish' && id) router.push(`/dish/${id}`);
  else if (screen === 'menu') router.push('/(tabs)');
  else if (screen === 'cart') router.push('/(tabs)/cart');
  else if (screen === 'booking') router.push('/(tabs)/booking');
  else router.push('/(tabs)/promos');
}

/**
 * Лента сообщений: акции и новости внутри приложения.
 *
 * Уведомления разрешают не все, а знать о новинках хотят почти все. Здесь те
 * же сообщения, что уходили пушами, — их видно, когда гость заходит сам.
 */
export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const messages = useQuery({ queryKey: ['messages'], queryFn: () => api.messages() });
  const refresher = useRefresher(() => messages.refetch());

  const read = useMutation({
    mutationFn: (id: string) => api.readMessage(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['messages'] }),
  });

  const rows = messages.data ?? [];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.backgroundAlt }]}>
      <PizzaBackdrop strength={0.45} />

      <ScreenHeader title="Сообщения" onBack={() => router.back()} />

      <ScrollView
        refreshControl={refresher}
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {messages.isPending ? (
          [0, 1, 2].map((key) => <Skeleton key={key} height={96} radius={theme.radius.xl} />)
        ) : rows.length === 0 ? (
          <EmptyState
            icon="mail-outline"
            art="orders"
            title="Пока тихо"
            description="Здесь появятся новости и акции сети — заглядывайте."
          />
        ) : (
          rows.map((message, index) => (
            <Animated.View key={message.id} entering={FadeInDown.duration(280).delay(index * 40)}>
              <PressableScale
                depth={0.99}
                accessibilityLabel={message.title}
                onPress={() => {
                  if (!message.is_read) read.mutate(message.id);
                  open(message);
                }}
                style={[
                  styles.card,
                  {
                    borderRadius: theme.radius.xl,
                    backgroundColor: theme.colors.surface,
                    borderColor: message.is_read ? theme.colors.border : theme.colors.brand,
                    borderWidth: message.is_read ? StyleSheet.hairlineWidth : 1.5,
                    padding: theme.spacing.base,
                    gap: theme.spacing.md,
                  },
                ]}
              >
                <View style={styles.grow}>
                  <View style={[styles.row, { gap: theme.spacing.sm }]}>
                    {message.is_read ? null : (
                      <View style={[styles.dot, { backgroundColor: theme.colors.brand }]} />
                    )}
                    <Text
                      numberOfLines={2}
                      style={[
                        theme.typography.bodyMedium,
                        styles.grow,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {message.title}
                    </Text>
                  </View>

                  <Text
                    numberOfLines={3}
                    style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
                  >
                    {message.body}
                  </Text>

                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {when(message.sent_at)}
                  </Text>
                </View>

                {mediaUrl(message.image_url) ? (
                  <Image
                    source={{ uri: mediaUrl(message.image_url) ?? undefined }}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.skeleton,
                    }}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View
                    style={[
                      styles.icon,
                      {
                        width: 72,
                        height: 72,
                        borderRadius: theme.radius.lg,
                        backgroundColor: theme.colors.brandSubtle,
                      },
                    ]}
                  >
                    <Ionicons name="pricetags-outline" size={24} color={theme.colors.brand} />
                  </View>
                )}
              </PressableScale>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
