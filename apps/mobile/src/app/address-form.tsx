import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, type AddressSuggestion, type DeliveryResolve } from '@/api/client';
import { PrimaryButton } from '@/components/primary-button';
import { Grabber } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { useAddressDraft } from '@/store/address-draft';
import { keyboardScroll } from '@/lib/keyboard';
import { mapsAvailable } from '@/lib/tenant';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

const TITLES = [
  { value: 'Дом', icon: 'home-outline' },
  { value: 'Работа', icon: 'briefcase-outline' },
  { value: 'Другое', icon: 'location-outline' },
] as const;

export default function AddressFormScreen() {
  const theme = useTheme();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ mode?: string; onboarding?: string; id?: string }>();
  const editingId = params.id ?? null;

  const [cityId, setCityId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [manual, setManual] = useState(false);
  // Кто везёт на выбранный адрес: считаем и на карте, и при ручном вводе
  const [delivery, setDelivery] = useState<DeliveryResolve | null>(null);

  const [street, setStreet] = useState('');
  const [locality, setLocality] = useState('');
  const [house, setHouse] = useState('');
  const [corpus, setCorpus] = useState('');
  const [structure, setStructure] = useState('');
  const [flat, setFlat] = useState('');
  const [entrance, setEntrance] = useState('');
  const [floor, setFloor] = useState('');
  const [intercom, setIntercom] = useState('');
  const [comment, setComment] = useState('');
  const [title, setTitle] = useState<string>('Дом');

  const [failure, setFailure] = useState<string | null>(null);

  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api.cities() });

  // Правим сохранённый адрес — подставляем его поля в форму
  const existing = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
    enabled: editingId !== null,
  });

  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || editingId === null) return;
    const address = (existing.data ?? []).find((row) => row.id === editingId);
    if (!address) return;

    filled.current = true;
    setStreet(address.street);
    setLocality(address.locality ?? '');
    setHouse(address.house);
    setCorpus(address.building?.startsWith('стр') ? '' : (address.building ?? ''));
    setStructure(address.building?.startsWith('стр') ? address.building : '');
    setFlat(address.flat ?? '');
    setEntrance(address.entrance ?? '');
    setFloor(address.floor ?? '');
    setIntercom(address.intercom ?? '');
    setComment(address.comment ?? '');
    setTitle(address.title ?? 'Дом');
    setSearch(address.full_text);
    setManual(true);
    setCityId(address.city_id);
  }, [editingId, existing.data]);
  const activeCity = cities.data?.find((city) => city.id === cityId) ?? cities.data?.[0] ?? null;

  useEffect(() => {
    if (cityId === null && activeCity) setCityId(activeCity.id);
  }, [activeCity, cityId]);

  // Печатаем быстрее, чем отвечает справочник — спрашиваем его только на паузе.
  // Пауза в 400 мс заметно срезает число запросов: платим за них по счётчику
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const suggestions = useQuery({
    queryKey: ['address-suggest', debounced, activeCity?.id],
    queryFn: () => api.suggestAddresses(debounced, activeCity?.id),
    enabled: debounced.length >= 3 && picked === null,
    staleTime: 30 * 60_000,
  });

  const choose = (item: AddressSuggestion) => {
    setPicked(item);

    // Подсказка приносит координаты — сразу спрашиваем, кто сюда везёт.
    // Раньше это работало только на карте, и при ручном вводе гость узнавал
    // об отсутствии доставки лишь на оформлении заказа
    setDelivery(null);
    if (item.latitude !== null && item.longitude !== null) {
      void api
        .resolveDelivery(item.latitude, item.longitude, activeCity?.id)
        .then(setDelivery)
        .catch(() => setDelivery(null));
    }

    setStreet(item.street);
    setLocality(item.subtitle);
    setHouse(item.house);
    // Справочник отдаёт одну часть дома: «к 2», «стр 1» или «литера А»
    setCorpus(item.building.startsWith('стр') ? '' : item.building);
    setStructure(item.building.startsWith('стр') ? item.building : '');
    setFailure(null);

    const matched = cities.data?.find((city) => city.name === item.city);
    if (matched) setCityId(matched.id);
  };

  // Вернулись с карты — забираем выбранный дом и заполняем поля
  const draft = useAddressDraft();
  useFocusEffect(
    useCallback(() => {
      if (draft.picked === null) return;
      choose(draft.picked);
      setSearch(draft.picked.title);
      draft.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft.picked]),
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        city_id: activeCity?.id ?? '',
        locality: picked?.city.trim() || null,
        street: street.trim(),
        house: house.trim(),
        building: [corpus.trim(), structure.trim()].filter(Boolean).join(' ') || null,
        flat: flat.trim() || null,
        entrance: entrance.trim() || null,
        floor: floor.trim() || null,
        intercom: intercom.trim() || null,
        comment: comment.trim() || null,
        title,
        latitude: picked?.latitude ?? null,
        longitude: picked?.longitude ?? null,
        is_default: true,
      };

      return editingId === null ? api.addAddress(body) : api.updateAddress(editingId, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });

      // Только что заведённый адрес сразу становится текущим: искать его
      // заново в списке — лишний шаг
      cart.selectAddress(saved.id);
      if (saved.restaurant_id) cart.selectRestaurant(saved.restaurant_id);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const found = suggestions.data ?? [];
  const chosen = picked !== null || manual;
  const canSave = street.trim().length > 1 && house.trim().length > 0 && activeCity !== null;
  const nothingFound =
    picked === null && !manual && debounced.length >= 3 && !suggestions.isFetching && found.length === 0;

  const label = (text: string) => (
    <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>{text}</Text>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <View
        style={{
          paddingTop: theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <Grabber />

        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
            hitSlop={theme.hitSlop}
            onPress={() => router.back()}
            style={[
              styles.circle,
              {
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceSunken,
              },
            ]}
          >
            <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
          </Pressable>

          <Text style={[theme.typography.h1, styles.grow, { color: theme.colors.textPrimary }]}>
            Адрес доставки
          </Text>
        </View>

        {(cities.data ?? []).length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {(cities.data ?? []).map((city) => {
              const selected = city.id === activeCity?.id;
              return (
                <Pressable
                  key={city.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCityId(city.id)}
                  style={{
                    paddingHorizontal: theme.spacing.base,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: selected ? theme.colors.brand : theme.colors.surfaceSunken,
                  }}
                >
                  <Text
                    style={[
                      theme.typography.bodyMedium,
                      { color: selected ? theme.colors.textOnBrand : theme.colors.textSecondary },
                    ]}
                  >
                    {city.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.huge,
          gap: theme.spacing.lg,
        }}
        {...keyboardScroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View layout={LinearTransition} style={{ gap: theme.spacing.md }}>
          <TextField
            label="Улица и дом"
            value={search}
            onChangeText={(next) => {
              setSearch(next);
              setPicked(null);
            }}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />

          {mapsAvailable ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/address-map',
                params: {
                  latitude: picked?.latitude ? String(picked.latitude) : '',
                  longitude: picked?.longitude ? String(picked.longitude) : '',
                  next: 'back',
                },
              })
            }
            style={[
              styles.locate,
              {
                gap: theme.spacing.sm,
                minHeight: theme.layout.minTouchTarget,
                paddingHorizontal: theme.spacing.base,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.brandSubtle,
              },
            ]}
          >
            <Ionicons name="map" size={18} color={theme.colors.brand} />
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
              Указать на карте
            </Text>
          </Pressable>
          ) : null}

          {suggestions.isFetching ? (
            <Animated.View
              entering={FadeIn}
              exiting={FadeOut}
              style={[styles.row, { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }]}
            >
              <ActivityIndicator color={theme.colors.textTertiary} />
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                Ищем адрес…
              </Text>
            </Animated.View>
          ) : null}

          {picked === null && found.length > 0 ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition}
              style={{
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surfaceSunken,
                overflow: 'hidden',
              }}
            >
              {found.map((item, index) => (
                <Pressable
                  key={`${item.title}-${index}`}
                  accessibilityRole="button"
                  onPress={() => {
                    choose(item);
                    setSearch(item.title);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      gap: theme.spacing.md,
                      padding: theme.spacing.base,
                      minHeight: theme.layout.minTouchTarget,
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.divider,
                      backgroundColor: pressed ? theme.colors.brandSubtle : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name="location-outline" size={18} color={theme.colors.textTertiary} />
                  <View style={styles.grow}>
                    <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text
                        numberOfLines={1}
                        style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
                      >
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </Animated.View>
          ) : null}

          {chosen ? null : nothingFound ? (
            <Animated.View entering={FadeIn} style={{ gap: theme.spacing.sm }}>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                Такого адреса в справочнике нет. Заполните поля сами — курьер приедет.
              </Text>
              <PrimaryButton
                label="Ввести вручную"
                tone="ghost"
                onPress={() => {
                  setManual(true);
                  setStreet(search.trim());
                }}
              />
            </Animated.View>
          ) : (
            <Pressable
              accessibilityRole="button"
              hitSlop={theme.hitSlop}
              onPress={() => {
                setManual(true);
                setStreet(search.trim());
              }}
              style={{ paddingVertical: theme.spacing.sm, alignItems: 'center' }}
            >
              <Text style={[theme.typography.bodyMedium, { color: theme.colors.textTertiary }]}>
                Ввести адрес вручную
              </Text>
            </Pressable>
          )}
        </Animated.View>

        {chosen ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            layout={LinearTransition}
            style={{ gap: theme.spacing.md }}
          >
            {label('Адрес')}

            <TextField
              label="Улица"
              hint={locality || undefined}
              value={street}
              onChangeText={setStreet}
            />

            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <TextField label="Дом" value={house} onChangeText={setHouse} flex={1.1} />
              <TextField label="Корпус" value={corpus} onChangeText={setCorpus} flex={1} />
              <TextField label="Строение" value={structure} onChangeText={setStructure} flex={1} />
            </View>
          </Animated.View>
        ) : null}

        {chosen && delivery !== null ? (
          // Кто повезёт — крупно и до того, как гость начнёт заполнять квартиру
          <Animated.View
            entering={FadeIn.duration(220)}
            layout={LinearTransition}
            style={[
              styles.row,
              theme.elevation.card,
              {
                gap: theme.spacing.base,
                padding: theme.spacing.base,
                borderRadius: theme.radius.xl,
                backgroundColor: delivery.covered ? theme.colors.accent : theme.colors.warning,
              },
            ]}
          >
            <View
              style={[
                styles.badge,
                {
                  width: theme.spacing.xxxl,
                  height: theme.spacing.xxxl,
                  borderRadius: theme.radius.pill,
                  backgroundColor: 'rgba(255, 255, 255, 0.22)',
                },
              ]}
            >
              <Ionicons
                name={delivery.covered ? 'car' : 'alert-circle'}
                size={20}
                color={theme.colors.onHero}
              />
            </View>

            <View style={styles.grow}>
              {delivery.covered && delivery.restaurant ? (
                <>
                  <Text style={[theme.typography.overline, { color: 'rgba(255,255,255,0.75)' }]}>
                    доставит
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.h3, { color: theme.colors.onHero }]}
                  >
                    {delivery.restaurant.name}
                  </Text>
                  <Text style={[theme.typography.caption, { color: 'rgba(255,255,255,0.85)' }]}>
                    от {Math.round(delivery.min_order_kopecks / 100)} ₽
                    {delivery.delivery_price_kopecks > 0
                      ? ` · доставка ${Math.round(delivery.delivery_price_kopecks / 100)} ₽`
                      : ' · бесплатно'}
                    {delivery.delivery_opens_at && delivery.delivery_closes_at
                      ? ` · ${delivery.delivery_opens_at.slice(0, 5)}–${delivery.delivery_closes_at.slice(0, 5)}`
                      : ''}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[theme.typography.h3, { color: theme.colors.onHero }]}>
                    Сюда пока не доставляем
                  </Text>
                  <Text style={[theme.typography.caption, { color: 'rgba(255,255,255,0.85)' }]}>
                    {delivery.paused_reason ?? 'Адрес можно сохранить и забрать заказ самим'}
                  </Text>
                </>
              )}
            </View>
          </Animated.View>
        ) : null}

        {chosen ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            layout={LinearTransition}
            style={{ gap: theme.spacing.md }}
          >
            {label('Как вас найти')}

            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <TextField
                label="Квартира"
                value={flat}
                onChangeText={setFlat}
                keyboardType="number-pad"
                flex={1}
              />
              <TextField label="Подъезд" value={entrance} onChangeText={setEntrance} flex={1} />
              <TextField label="Этаж" value={floor} onChangeText={setFloor} flex={1} />
            </View>

            <TextField label="Домофон" value={intercom} onChangeText={setIntercom} />

            <TextField
              label="Комментарий курьеру"
              hint="Код от ворот, ориентир, «не звонить в дверь»"
              value={comment}
              onChangeText={setComment}
              multiline
            />

            {label('Название')}
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              {TITLES.map((option) => {
                const selected = title === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setTitle(option.value)}
                    style={[
                      styles.chip,
                      {
                        gap: theme.spacing.xs,
                        minHeight: theme.layout.minTouchTarget,
                        borderRadius: theme.radius.pill,
                        borderColor: selected ? theme.colors.brand : theme.colors.border,
                        backgroundColor: selected ? theme.colors.brandSubtle : theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={16}
                      color={selected ? theme.colors.brand : theme.colors.textTertiary}
                    />
                    <Text
                      style={[
                        theme.typography.bodyMedium,
                        { color: selected ? theme.colors.brand : theme.colors.textSecondary },
                      ]}
                    >
                      {option.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        ) : null}

        {failure ? (
          <Animated.Text
            entering={FadeIn}
            style={[theme.typography.caption, { color: theme.colors.danger }]}
          >
            {failure}
          </Animated.Text>
        ) : null}

        {chosen ? (
          <Animated.View entering={FadeIn} layout={LinearTransition}>
            <PrimaryButton
              label={editingId === null ? 'Сохранить адрес' : 'Сохранить изменения'}
              loading={save.isPending}
              disabled={!canSave}
              onPress={() => {
                setFailure(null);
                save.mutate();
              }}
            />
          </Animated.View>
        ) : null}

        {params.onboarding === '1' ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={theme.hitSlop}
            onPress={() => router.back()}
            style={{ paddingVertical: theme.spacing.md, alignItems: 'center' }}
          >
            <Text style={[theme.typography.bodyMedium, { color: theme.colors.textTertiary }]}>
              Заполню позже
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  locate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
});
