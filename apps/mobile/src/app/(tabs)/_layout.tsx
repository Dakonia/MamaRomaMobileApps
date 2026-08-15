import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tenant } from '@/lib/tenant';
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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
        name="bonus"
        options={{
          title: 'Бонусы',
          tabBarIcon: tabIcon('gift-outline', 'gift'),
          href: features.loyalty ? undefined : null,
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
