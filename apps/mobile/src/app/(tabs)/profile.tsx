import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api/client';
import { ScreenHeader } from '@/components/screen-header';
import { formatPhone, formatPoints, formatPrice, phoneToUri } from '@/lib/format';
import { tenant } from '@/lib/tenant';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme/theme-provider';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  url: string;
};

export default function ProfileScreen() {
  const theme = useTheme();
  const session = useSession();
  const authorized = session.status === 'authorized' && session.guest !== null;

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: authorized,
  });

  const contactRows: Row[] = [
    {
      icon: 'call-outline',
      label: 'Позвонить',
      value: formatPhone(tenant.supportPhone),
      url: phoneToUri(tenant.supportPhone),
    },
    {
      icon: 'mail-outline',
      label: 'Написать',
      value: tenant.supportEmail,
      url: `mailto:${tenant.supportEmail}`,
    },
    { icon: 'globe-outline', label: 'Сайт сети', url: tenant.websiteUrl },
  ];

  const legalRows: Row[] = [
    { icon: 'shield-outline', label: 'Политика конфиденциальности', url: tenant.privacyPolicyUrl },
    { icon: 'document-text-outline', label: 'Публичная оферта', url: tenant.offerUrl },
  ];

  const renderRow = (row: Row) => (
    <Pressable
      key={row.label}
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(row.url);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.layout.minTouchTarget,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.base,
          borderRadius: theme.radius.md,
          gap: theme.spacing.md,
          backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        },
      ]}
    >
      <Ionicons name={row.icon} size={theme.spacing.lg} color={theme.colors.textTertiary} />

      <View style={styles.rowText}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
          {row.label}
        </Text>
        {row.value ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {row.value}
          </Text>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={theme.spacing.base} color={theme.colors.textTertiary} />
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Профиль" subtitle="Заказы, адреса и настройки" />

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
        }}
      >
        <View
          style={[
            styles.card,
            {
              padding: theme.spacing.lg,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surfaceSunken,
              gap: theme.spacing.xs,
            },
          ]}
        >
          {authorized && session.guest ? (
            <>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                {session.guest.name ?? formatPhone(session.guest.phone)}
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                {session.loyalty
                  ? `${session.loyalty.tier_title} · ${formatPoints(session.loyalty.points_balance)}`
                  : 'Профиль активен'}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={theme.hitSlop}
                onPress={() => {
                  void session.signOut();
                }}
                style={[styles.cardAction, { marginTop: theme.spacing.sm }]}
              >
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
                  Выйти
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                Вход по номеру телефона
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                После входа здесь появятся история заказов, сохранённые адреса и карта гостя для
                кассы.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/auth')}
                style={({ pressed }) => [
                  styles.cardAction,
                  {
                    minHeight: theme.layout.minTouchTarget,
                    paddingHorizontal: theme.spacing.xl,
                    borderRadius: theme.radius.pill,
                    marginTop: theme.spacing.sm,
                    backgroundColor: pressed ? theme.colors.brandPressed : theme.colors.brand,
                  },
                ]}
              >
                <Text style={[theme.typography.button, { color: theme.colors.textOnBrand }]}>
                  Войти
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {authorized && (orders.data?.length ?? 0) > 0 ? (
          <View style={{ gap: theme.spacing.xxs }}>
            <Text
              style={[
                theme.typography.overline,
                { color: theme.colors.textTertiary, paddingHorizontal: theme.spacing.base },
              ]}
            >
              Мои заказы
            </Text>
            {(orders.data ?? []).slice(0, 5).map((order) => (
              <Pressable
                key={order.id}
                accessibilityRole="button"
                onPress={() => router.push(`/order/${order.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    minHeight: theme.layout.minTouchTarget,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.base,
                    borderRadius: theme.radius.md,
                    gap: theme.spacing.md,
                    backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name="receipt-outline"
                  size={theme.spacing.lg}
                  color={theme.colors.textTertiary}
                />
                <View style={styles.rowText}>
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                    Заказ {order.number}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {order.restaurant_name}
                  </Text>
                </View>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                  {formatPrice(order.total_kopecks)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {authorized ? (
          <View style={{ gap: theme.spacing.xxs }}>
            <Text
              style={[
                theme.typography.overline,
                { color: theme.colors.textTertiary, paddingHorizontal: theme.spacing.base },
              ]}
            >
              Мои данные
            </Text>

            {[
              { icon: 'person-outline' as const, label: 'Личные данные', to: '/profile-edit' as const },
              { icon: 'home-outline' as const, label: 'Адреса доставки', to: '/addresses' as const },
            ].map((item) => (
              <Pressable
                key={item.to}
                accessibilityRole="button"
                onPress={() => router.push(item.to)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    minHeight: theme.layout.minTouchTarget,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.base,
                    borderRadius: theme.radius.md,
                    gap: theme.spacing.md,
                    backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
                  },
                ]}
              >
                <Ionicons name={item.icon} size={theme.spacing.lg} color={theme.colors.textTertiary} />
                <Text
                  style={[theme.typography.bodyMedium, styles.rowText, { color: theme.colors.textPrimary }]}
                >
                  {item.label}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={theme.spacing.base}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.xxs }}>
          <Text
            style={[
              theme.typography.overline,
              { color: theme.colors.textTertiary, paddingHorizontal: theme.spacing.base },
            ]}
          >
            Связаться
          </Text>
          {contactRows.map(renderRow)}
        </View>

        <View style={{ gap: theme.spacing.xxs }}>
          <Text
            style={[
              theme.typography.overline,
              { color: theme.colors.textTertiary, paddingHorizontal: theme.spacing.base },
            ]}
          >
            Документы
          </Text>
          {legalRows.map(renderRow)}
        </View>

        <Text
          style={[
            theme.typography.caption,
            styles.footer,
            { color: theme.colors.textTertiary },
          ]}
        >
          {tenant.branding.legalName}
          {'\n'}
          Версия {Constants.expoConfig?.version ?? '—'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { width: '100%' },
  cardAction: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: { flex: 1 },
  footer: { textAlign: 'center' },
});
