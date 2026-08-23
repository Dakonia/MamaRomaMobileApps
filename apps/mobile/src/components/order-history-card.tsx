import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { mediaUrl, type Order } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

const STATUS: Record<string, { label: string; tone: 'ok' | 'live' | 'off' }> = {
  created: { label: 'Оформлен', tone: 'live' },
  paid: { label: 'Оплачен', tone: 'live' },
  accepted: { label: 'Принят', tone: 'live' },
  cooking: { label: 'Готовим', tone: 'live' },
  ready: { label: 'Готов', tone: 'live' },
  delivering: { label: 'В пути', tone: 'live' },
  completed: { label: 'Доставлен', tone: 'ok' },
  cancelled: { label: 'Отменён', tone: 'off' },
};

const TYPE: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  delivery: { label: 'Доставка', icon: 'car-outline' },
  pickup: { label: 'Самовывоз', icon: 'walk-outline' },
  dine_in: { label: 'В зале', icon: 'restaurant-outline' },
};

/** «17 августа, 19:40» — год в истории заказов не нужен. */
function whenText(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

type Props = {
  order: Order;
  onPress: () => void;
};

export function OrderHistoryCard({ order, onPress }: Props) {
  const theme = useTheme();

  const status = STATUS[order.status] ?? { label: order.status, tone: 'off' as const };
  const type = TYPE[order.type] ?? TYPE.delivery;
  const photos = order.items
    .map((item) => mediaUrl(item.image_url))
    .filter((uri): uri is string => uri !== null)
    .slice(0, 4);

  const tone = {
    ok: { background: theme.colors.accentSubtle, text: theme.colors.accent },
    live: { background: theme.colors.brandSubtle, text: theme.colors.brand },
    off: { background: theme.colors.surfaceSunken, text: theme.colors.textTertiary },
  }[status.tone];

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={`Заказ ${order.number}`}
      style={[
        styles.root,
        theme.elevation.card,
        {
          padding: theme.spacing.base,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          gap: theme.spacing.md,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Ionicons name={type.icon} size={16} color={theme.colors.textTertiary} />
        <Text style={[theme.typography.caption, styles.grow, { color: theme.colors.textTertiary }]}>
          {type.label} · {whenText(order.created_at)}
        </Text>
        <View
          style={{
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xxs,
            borderRadius: theme.radius.pill,
            backgroundColor: tone.background,
          }}
        >
          <Text style={[theme.typography.overline, { color: tone.text }]}>{status.label}</Text>
        </View>
      </View>

      {photos.length > 0 ? (
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          {photos.map((uri, index) => (
            <Image
              key={`${uri}-${index}`}
              source={{ uri }}
              style={{
                width: 52,
                height: 52,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.skeleton,
              }}
              contentFit="cover"
              transition={200}
            />
          ))}
          {order.items.length > photos.length ? (
            <View
              style={[
                styles.more,
                {
                  width: 52,
                  height: 52,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceSunken,
                },
              ]}
            >
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textSecondary }]}>
                +{order.items.length - photos.length}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text numberOfLines={2} style={[theme.typography.body, { color: theme.colors.textPrimary }]}>
        {order.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}
      </Text>

      <View style={[styles.row, styles.between]}>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {order.restaurant_name}
        </Text>
        <Text style={[theme.typography.price, theme.tabularNums, { color: theme.colors.textPrimary }]}>
          {formatPrice(order.total_kopecks)}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: {},
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  more: { alignItems: 'center', justifyContent: 'center' },
});
