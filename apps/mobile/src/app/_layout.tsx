import {
  Comfortaa_500Medium,
  Comfortaa_600SemiBold,
  Comfortaa_700Bold,
} from '@expo-google-fonts/comfortaa';
import {
  Onest_400Regular,
  Onest_500Medium,
  Onest_600SemiBold,
  Onest_700Bold,
} from '@expo-google-fonts/onest';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { BootSplash } from '@/components/boot-splash';
import { ErrorBoundary } from '@/components/error-boundary';
import { OfflineScreen } from '@/components/offline-screen';
import { PushInvite } from '@/components/push-invite';
import { RatingGate } from '@/components/rating-gate';
import { UpdateReady } from '@/components/update-ready';
import { UpdateGate } from '@/components/update-gate';
import { startAnalytics, track, trackError, trackScreen } from '@/lib/analytics';
import * as Notifications from 'expo-notifications';

import { useBoot } from '@/lib/boot';
import { useCartEcho } from '@/lib/use-cart-echo';
import { persistOptions, queryClient } from '@/lib/query-client';
import { useAppearance } from '@/store/appearance';
import { useSession } from '@/store/session';
import { darkTheme, lightTheme } from '@/theme';
import { ThemeProvider } from '@/theme/theme-provider';

SplashScreen.preventAutoHideAsync();

// Сбор аналитики и падений включаем до первого экрана: интересны и те ошибки,
// что случаются на запуске
startAnalytics();

// Ошибки вне отрисовки — в промисах и обработчиках — иначе теряются молча
const previousHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, fatal) => {
  trackError(fatal ? 'Падение приложения' : 'Ошибка в обработчике', error);
  previousHandler?.(error, fatal);
});

// Реакту нужно рассказать, что «фокус» на телефоне — это выход из фона
AppState.addEventListener('change', (status) => {
  focusManager.setFocused(status === 'active');
});

export default function RootLayout() {
  const appearance = useAppearance((state) => state.mode);
  // Заставка играет один раз за запуск и уходит, когда данные уже в памяти
  const [booting, setBooting] = useState(true);
  const boot = useBoot();
  // Сервер должен знать, что корзина не пуста, — иначе о ней некому напомнить
  useCartEcho();
  const pathname = usePathname();

  // Экран, на котором сейчас гость: из этого собирается воронка
  useEffect(() => {
    trackScreen(pathname);
  }, [pathname]);

  // Нажали на уведомление — открываем сам заказ, а не главный экран
  useEffect(() => {
    /**
     * Куда ведёт уведомление. Экран приходит меткой в самом сообщении, поэтому
     * новые сценарии добавляются в админке, а не переписыванием приложения.
     */
    const open = (raw: Record<string, unknown> | undefined) => {
      if (raw === undefined) return;

      const screen = typeof raw.screen === 'string' ? raw.screen : null;
      const id = typeof raw.id === 'string' ? raw.id : null;

      // Доставку писем считает Expo, а вот открытия — только мы: без этого
      // не видно, доводит ли рассылка до заказа
      track('push_opened', {
        screen: screen ?? 'unknown',
        campaign: typeof raw.campaignId === 'string' ? raw.campaignId : null,
      });

      if (screen === 'order' && typeof raw.orderId === 'string') {
        router.push(`/order/${raw.orderId}`);
        return;
      }

      if (screen === 'promo' && id) {
        router.push(`/promo/${id}`);
        return;
      }

      if (screen === 'dish' && id) {
        router.push(`/dish/${id}`);
        return;
      }

      if (screen === 'messages') {
        router.push('/messages');
        return;
      }

      if (screen === 'promos') {
        router.push('/(tabs)/promos');
        return;
      }

      if (screen === 'menu') {
        router.push('/(tabs)');
        return;
      }

      if (screen === 'cart') {
        router.push('/(tabs)/cart');
        return;
      }

      if (screen === 'booking') {
        router.push('/(tabs)/booking');
        return;
      }

      if (screen === 'loyalty' || screen === 'profile') {
        router.push('/(tabs)/profile');
      }
    };

    // Приложение запустили нажатием на уведомление из закрытого состояния
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      open(response?.notification.request.content.data);
    });

    const listener = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });

    return () => listener.remove();
  }, []);
  const isDark = appearance === 'dark';
  const theme = isDark ? darkTheme : lightTheme;

  const [fontsLoaded] = useFonts({
    Comfortaa_500Medium,
    Comfortaa_600SemiBold,
    Comfortaa_700Bold,
    Onest_400Regular,
    Onest_500Medium,
    Onest_600SemiBold,
    Onest_700Bold,
  });

  const status = useSession((state) => state.status);

  // Сменился гость — выбрасываем чужие адреса и заказы из памяти запросов
  useEffect(() => {
    if (status === 'anonymous') {
      queryClient.removeQueries({ queryKey: ['addresses'] });
      queryClient.removeQueries({ queryKey: ['orders'] });
      queryClient.removeQueries({ queryKey: ['guest-summary'] });
    }
  }, [status]);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      primary: theme.colors.brand,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.textPrimary,
      border: theme.colors.border,
    },
  };

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider>
          <NavigationThemeProvider value={navigationTheme}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth" options={{ presentation: 'modal' }} />
              <Stack.Screen name="restaurants" options={{ presentation: 'modal' }} />
              <Stack.Screen name="cart" />
              <Stack.Screen name="order/[id]" />
              <Stack.Screen
                name="dish/[id]"
                options={{
                  // Обычный экран, а не модалка: работает системный свайп от края назад.
                  // Экран проявляется, а не въезжает: движение делает летящее фото
                  animation: 'fade',
                  animationDuration: 220,
                  gestureEnabled: true,
                }}
              />
              <Stack.Screen name="promo/[id]" options={{ presentation: 'modal' }} />
              {/* Разделы профиля: в них заходят вглубь, поэтому обычные экраны
                  со стрелкой назад и системным свайпом от края */}
              <Stack.Screen
                name="profile-edit"
                options={{ animation: 'slide_from_right', gestureEnabled: true }}
              />
              <Stack.Screen
                name="addresses"
                options={{ animation: 'slide_from_right', gestureEnabled: true }}
              />
              <Stack.Screen
                name="reservations"
                options={{ animation: 'slide_from_right', gestureEnabled: true }}
              />
              <Stack.Screen
                name="messages"
                options={{ animation: 'slide_from_right', gestureEnabled: true }}
              />
              <Stack.Screen name="address-form" options={{ presentation: 'modal' }} />
              <Stack.Screen name="address-map" options={{ presentation: 'modal' }} />
            </Stack>

            {/* Пока идёт заставка, поверх неё ничего не показываем */}
            {booting ? null : <PushInvite />}
            {booting ? null : <RatingGate />}
            <UpdateReady />
            <OfflineScreen />

            {/* Заслон поверх всего: со старой сборкой дальше идти нельзя */}
            <UpdateGate />

            {booting ? (
              <BootSplash
                progress={boot.progress}
                ready={boot.ready && fontsLoaded}
                onDone={() => setBooting(false)}
              />
            ) : null}
          </NavigationThemeProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
