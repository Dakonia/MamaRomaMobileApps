import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api } from '@/api/client';
import { PressableScale } from '@/components/pressable-scale';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

/**
 * Строка с сообщениями в профиле. Появляется, только когда есть что показать —
 * пустой раздел «Сообщения» гостю ни к чему.
 */
export function MessagesStrip() {
  const theme = useTheme();
  const session = useSession();

  const messages = useQuery({
    queryKey: ['messages'],
    queryFn: () => api.messages(),
    enabled: session.status === 'authorized',
  });

  const rows = messages.data ?? [];
  const unread = rows.filter((row) => !row.is_read).length;

  if (rows.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(260)}>
      <PressableScale
        depth={0.99}
        accessibilityLabel="Сообщения"
        onPress={() => router.push('/messages')}
        style={[
          styles.row,
          {
            padding: theme.spacing.base,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            gap: theme.spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.icon,
            {
              width: theme.spacing.xxl,
              height: theme.spacing.xxl,
              borderRadius: theme.radius.md,
              backgroundColor: unread > 0 ? theme.colors.brandSubtle : theme.colors.surfaceSunken,
            },
          ]}
        >
          <Ionicons
            name="mail-outline"
            size={18}
            color={unread > 0 ? theme.colors.brand : theme.colors.textTertiary}
          />
        </View>

        <View style={styles.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            Сообщения
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {unread > 0 ? `${unread} новых` : 'Новости и акции сети'}
          </Text>
        </View>

        {unread > 0 ? (
          <View
            style={[
              styles.badge,
              {
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xxs,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.brand,
              },
            ]}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.textOnBrand }]}>
              {unread}
            </Text>
          </View>
        ) : null}

        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  badge: { alignItems: 'center', justifyContent: 'center' },
});
