import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AddressSuggestion, type DeliveryResolve } from '@/api/client';
import { PinMap, type Region } from '@/components/pin-map';
import { EmptyState } from '@/components/empty-state';
import { mapsAvailable } from '@/lib/tenant';
import { PrimaryButton } from '@/components/primary-button';
import { Grabber } from '@/components/screen-header';
import { useAddressDraft } from '@/store/address-draft';
import { useTheme } from '@/theme/theme-provider';

// Центр города: сюда встаём, только если геопозиция недоступна и гость не
// пришёл с готовыми координатами. Раньше карта всегда открывалась здесь, и
// гость видел в карточке чужой адрес, принимая его за свой
const FALLBACK = { latitude: 59.9386, longitude: 30.3141 };

// Дольше этого геопозицию не ждём: лучше показать центр города, чем пустой экран
const LOCATE_MS = 2_500;
const SPAN = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

/** Метров между точками — грубо, но для «сдвинулись ли мы» достаточно. */
function metersBetween(a: Region, b: Region): number {
  const dx = (a.latitude - b.latitude) * 111_000;
  const dy = (a.longitude - b.longitude) * 55_000;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function AddressMapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    latitude?: string;
    longitude?: string;
    onboarding?: string;
    /** 'form' — карта открыта первой и передаёт эстафету форме, 'back' — вызвана из формы. */
    next?: string;
  }>();
  const pick = useAddressDraft((state) => state.pick);

  /**
   * Откуда открыть карту. Пока не знаем — не открываем вовсе: показать чужую
   * точку и подписать её адресом хуже, чем подождать полсекунды.
   */
  const [real, setReal] = useState(Boolean(params.latitude && params.longitude));
  const [start, setStart] = useState<Region | null>(
    params.latitude && params.longitude
      ? {
          latitude: Number(params.latitude),
          longitude: Number(params.longitude),
          ...SPAN,
        }
      : null,
  );

  useEffect(() => {
    if (start !== null) return;

    let alive = true;
    const settle = (point: { latitude: number; longitude: number }, mine = true) => {
      if (!alive) return;
      setReal(mine);
      setStart({ ...point, ...SPAN });
    };

    // Не дождались телефона — открываем центр города, но без адреса под меткой
    const patience = setTimeout(() => settle(FALLBACK, false), LOCATE_MS);

    void (async () => {
      try {
        const granted = await Location.requestForegroundPermissionsAsync();
        if (!granted.granted) {
          setFailure('Доступ к геопозиции закрыт — найдите дом на карте руками');
          settle(FALLBACK, false);
          return;
        }

        const position =
          (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

        if (position) {
          settle({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        } else {
          settle(FALLBACK, false);
        }
      } catch {
        settle(FALLBACK, false);
      } finally {
        clearTimeout(patience);
      }
    })();

    return () => {
      alive = false;
      clearTimeout(patience);
    };
  }, [start]);

  // Куда сеть возит: показываем контуры прямо на карте
  const zones = useQuery({
    queryKey: ['delivery-zones'],
    queryFn: () => api.deliveryZones(),
    staleTime: 60 * 60_000,
  });

  const map = useRef<React.ComponentRef<typeof PinMap>>(null);
  const lastAsked = useRef<Region | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [found, setFound] = useState<AddressSuggestion | null>(null);
  const [delivery, setDelivery] = useState<DeliveryResolve | null>(null);
  const [resolving, setResolving] = useState(false);
  // Высоту нижней карточки меряем: адрес бывает в одну строку, бывает в три,
  // и кнопка геолокации должна стоять над ней в любом случае
  const [sheetHeight, setSheetHeight] = useState(200);
  const [failure, setFailure] = useState<string | null>(null);

  const lift = useSharedValue(0);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -10 * lift.value }],
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 - 0.2 * lift.value,
    transform: [{ scale: 1 - 0.25 * lift.value }],
  }));

  const resolve = useCallback(
    async (region: Region) => {
      setResolving(true);
      setFailure(null);
      try {
        // Адрес и зону доставки спрашиваем разом: гость сразу видит, повезут ли сюда
        const [address, zone] = await Promise.all([
          api.locateAddress(region.latitude, region.longitude),
          api.resolveDelivery(region.latitude, region.longitude),
        ]);
        setDelivery(zone);

        if (address) {
          setFound(address);
          void Haptics.selectionAsync();
        } else {
          setFound(null);
          setFailure('Здесь дома нет. Подвиньте карту ближе к подъезду');
        }
      } catch {
        setFailure('Не удалось определить адрес. Проверьте связь');
      } finally {
        setResolving(false);
      }
    },
    [],
  );

  // Точка известна и она настоящая — сразу спрашиваем адрес под меткой.
  // Для центра города не спрашиваем: это не адрес гостя, а заглушка
  useEffect(() => {
    if (start === null || !real || lastAsked.current !== null) return;

    lastAsked.current = start;
    void resolve(start);
  }, [real, resolve, start]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onRegionChange = (region: Region) => {
    // Каждое микродвижение пальцем — не повод спрашивать адрес: ждём паузу
    // и игнорируем сдвиги меньше пятнадцати метров
    if (lastAsked.current && metersBetween(lastAsked.current, region) < 15) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastAsked.current = region;
      void resolve(region);
    }, 500);
  };

  const recenter = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setFailure('Доступ к геопозиции закрыт — двигайте карту руками');
        return;
      }

      const position =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));

      map.current?.animateToRegion(
        { latitude: position.coords.latitude, longitude: position.coords.longitude, ...SPAN },
        450,
      );
    } catch {
      setFailure('Телефон не отдал координаты — двигайте карту руками');
    }
  };

  const openForm = () => {
    router.replace({
      pathname: '/address-form',
      params: { onboarding: params.onboarding ?? '' },
    });
  };

  const confirm = () => {
    if (!found) return;
    pick(found);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Карту открыли первой — дальше уточняем квартиру и этаж в форме,
    // а сама карта из стопки уходит, чтобы «назад» не возвращало на неё
    if (params.next === 'form') {
      openForm();
      return;
    }
    router.back();
  };

  // Без ключа карт Google на Android MapView роняет экран — показываем
  // понятную заглушку и уводим в ручной ввод адреса
  if (!mapsAvailable) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          icon="map-outline"
          title="Карта пока недоступна"
          description="На этом устройстве карта ещё не подключена. Адрес можно ввести вручную — подскажем улицу и дом."
          actionLabel="Ввести адрес"
          onAction={openForm}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          hitSlop={theme.hitSlop}
          onPress={() => router.back()}
          style={[
            styles.floating,
            {
              top: insets.top + theme.spacing.sm,
              left: theme.layout.screenPadding,
              width: theme.layout.minTouchTarget,
              height: theme.layout.minTouchTarget,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surfaceSunken,
            },
          ]}
        >
          <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    );
  }

  if (start === null) {
    return (
      <View
        style={[
          styles.root,
          styles.circle,
          { backgroundColor: theme.colors.background, gap: theme.spacing.md },
        ]}
      >
        <ActivityIndicator color={theme.colors.brand} />
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          Определяем, где вы
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <PinMap
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={start}
        zones={(zones.data ?? []).map((zone) => ({
          id: zone.id,
          name: zone.name,
          outline: zone.outline,
          color: zone.color,
        }))}
        activeZoneId={delivery?.zone_id ?? null}
        showsUserLocation
        onPanDrag={() => {
          lift.value = withSpring(1, { damping: 16, stiffness: 260 });
        }}
        onRegionChange={onRegionChange}
        onRegionChangeComplete={(region) => {
          lift.value = withTiming(0, { duration: 180 });
          onRegionChange(region);
        }}
      />

      {/* Метка неподвижна в центре, а карта едет под ней — так делают все доставки */}
      <View pointerEvents="none" style={styles.pinBox}>
        <Animated.View
          style={[styles.pinShadow, shadowStyle, { backgroundColor: theme.colors.textPrimary }]}
        />
        <Animated.View style={pinStyle}>
          <Ionicons name="location" size={44} color={theme.colors.brand} />
        </Animated.View>
      </View>

      {/* Карта во весь экран, поверх неё только палочка по центру и крестик слева */}
      <View
        pointerEvents="box-none"
        style={[
          styles.topBar,
          {
            paddingTop: theme.spacing.sm,
            paddingHorizontal: theme.layout.screenPadding,
          },
        ]}
      >
        <Grabber />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          hitSlop={theme.hitSlop}
          onPress={() => router.back()}
          style={[
            styles.circle,
            theme.elevation.card,
            {
              width: theme.layout.minTouchTarget,
              height: theme.layout.minTouchTarget,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Моё местоположение"
        onPress={() => void recenter()}
        style={[
          styles.circle,
          styles.floating,
          theme.elevation.card,
          {
            bottom: sheetHeight + theme.spacing.md,
            right: theme.layout.screenPadding,
            width: theme.layout.minTouchTarget,
            height: theme.layout.minTouchTarget,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Ionicons name="navigate" size={20} color={theme.colors.brand} />
      </Pressable>

      <Animated.View
        entering={FadeIn.duration(260)}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
        style={[
          styles.sheet,
          theme.elevation.sheet,
          {
            paddingTop: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
            paddingHorizontal: theme.layout.screenPadding,
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            backgroundColor: theme.colors.surface,
            gap: theme.spacing.base,
          },
        ]}
      >
        <View style={{ minHeight: 52, justifyContent: 'center', gap: theme.spacing.xxs }}>
          {resolving ? (
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <ActivityIndicator color={theme.colors.textTertiary} />
              <Text style={[theme.typography.body, { color: theme.colors.textTertiary }]}>
                Определяем адрес…
              </Text>
            </View>
          ) : found ? (
            <>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>
                {found.title}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {found.subtitle}
              </Text>

              {delivery === null ? null : delivery.covered && delivery.restaurant ? (
                <View style={[styles.row, { gap: theme.spacing.xs }]}>
                  <Ionicons name="car" size={14} color={theme.colors.accent} />
                  <Text style={[theme.typography.caption, { color: theme.colors.accent }]}>
                    Везёт {delivery.restaurant.name}
                    {delivery.min_order_kopecks > 0
                      ? ` · от ${Math.round(delivery.min_order_kopecks / 100)} ₽`
                      : ''}
                    {delivery.delivery_minutes ? ` · ~${delivery.delivery_minutes} мин` : ''}
                  </Text>
                </View>
              ) : (
                <View style={[styles.row, { gap: theme.spacing.xs }]}>
                  <Ionicons name="alert-circle-outline" size={14} color={theme.colors.warning} />
                  <Text style={[theme.typography.caption, { color: theme.colors.warning }]}>
                    {delivery.paused_reason ?? 'Сюда пока не доставляем — можно забрать самим'}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {failure ?? 'Подвиньте карту к нужному дому'}
            </Text>
          )}
        </View>

        <PrimaryButton label="Этот дом" disabled={found === null || resolving} onPress={confirm} />

        <Pressable
          accessibilityRole="button"
          hitSlop={theme.hitSlop}
          onPress={params.next === 'form' ? openForm : () => router.back()}
          style={{ paddingVertical: theme.spacing.xs, alignItems: 'center' }}
        >
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textTertiary }]}>
            {params.next === 'form' ? 'Ввести адрес вручную' : 'Вернуться к вводу'}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-start' },
  floating: { position: 'absolute' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  pinBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Метка стоит остриём в центре экрана, значит рисуем её выше середины
    paddingBottom: 44,
  },
  pinShadow: {
    position: 'absolute',
    bottom: '50%',
    width: 10,
    height: 4,
    borderRadius: 5,
  },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
