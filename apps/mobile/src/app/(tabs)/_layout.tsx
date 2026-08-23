import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tenant } from '@/lib/tenant';
import { cartCount, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName, focusedName: IconName) {
  return function TabIcon({ color, focused, size }: TabIconProps) {
    return <Ionicons name={focused ? focusedName : name} size={size} color={color} />;
  };
}

type TabIconProps = { color: ColorValue; focused: boolean; size: number };

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { features } = tenant;
  const count = useCart((state) => cartCount(state.items));

  /**
   * Корзина по центру, вровень с остальными вкладками: приподнятый круг с серой
   * заливкой выглядел чужеродно. Счётчик рисуем сами — системный значок
   * налезает на сумку.
   */
  const cartIcon = ({ focused, color }: { focused: boolean; color: ColorValue }) => {
    const filled = count > 0;

    return (
      <View style={{ width: 30, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons
          name={filled || focused ? 'bag-handle' : 'bag-handle-outline'}
          size={24}
          color={filled ? theme.colors.brand : color}
        />

        {filled ? (
          <View
            style={{
              position: 'absolute',
              top: -5,
              right: -8,
              minWidth: 17,
              height: 17,
              paddingHorizontal: 4,
              borderRadius: theme.radius.pill,
              borderWidth: 2,
              borderColor: theme.colors.surface,
              backgroundColor: theme.colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.textOnBrand }}>
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Экраны вкладок не подменяются рывком, а мягко проявляются
        animation: 'fade',
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        // Полоса ровно под содержимое: иконка, подпись и системный индикатор снизу
        tabBarStyle: {
          height: theme.layout.tabBarHeight + insets.bottom,
          paddingTop: theme.spacing.xxs,
          paddingBottom: insets.bottom,
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.divider,
        },
        tabBarIconStyle: { marginBottom: -theme.spacing.xxs },
        tabBarLabelStyle: {
          fontFamily: theme.typography.caption.fontFamily,
          fontSize: theme.typography.overline.fontSize,
          marginBottom: theme.spacing.xxs,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Меню', tabBarIcon: tabIcon('restaurant-outline', 'restaurant') }}
      />
      <Tabs.Screen
        name="promos"
        options={{
          title: 'Акции',
          tabBarIcon: tabIcon('pricetags-outline', 'pricetags'),
          href: features.stories ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Корзина',
          tabBarIcon: cartIcon,
          // Оформление — отдельный экран: вкладки внизу тут только мешают,
          // кнопка «Оформить» должна стоять у самого края
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="booking"
        options={{
          title: 'Бронь',
          tabBarIcon: tabIcon('calendar-outline', 'calendar'),
          href: features.dineInReservation ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Профиль', tabBarIcon: tabIcon('person-outline', 'person') }}
      />
    </Tabs>
  );
}
