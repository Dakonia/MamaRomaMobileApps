import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tenant } from '@/lib/tenant';
import { cartCount, useCart } from '@/store/cart';
import { useTheme } from '@/theme/theme-provider';

/**
 * НИЖНЯЯ ПАНЕЛЬ ВКЛАДОК — всё, что видно внизу экрана, задаётся здесь.
 *
 * Иконки — из набора Ionicons. Полный каталог с поиском: icons.expo.fyi
 * Ошибиться в имени нельзя: тип IconName подчеркнёт опечатку красным
 * ещё до запуска.
 */
type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Пара иконок для одной вкладки.
 *
 * @param name        когда вкладка НЕ выбрана — контурная, с суффиксом -outline
 * @param focusedName когда выбрана — залитая, без суффикса
 *
 * Размер приходит от навигатора. Нужен свой — впишите число: size={26}.
 * Разумные значения 22–28: больше выглядит грубо, меньше плохо заметно.
 */
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
        {/* Сумка становится фирменной, как только в корзине что-то есть */}
        <Ionicons
          name={filled || focused ? 'bag-handle' : 'bag-handle-outline'}
          size={24}
          color={filled ? theme.colors.brand : color}
        />

        {filled ? (
          <View
            // КРУЖОК СО СЧЁТЧИКОМ. Все его размеры — здесь
            style={{
              position: 'absolute',
              top: -5, // насколько поднят над сумкой
              right: -8, // насколько сдвинут вправо
              minWidth: 17, // ширина растёт под двузначное число
              height: 17, // размер кружка
              paddingHorizontal: 4,
              borderRadius: theme.radius.pill,
              borderWidth: 2, // белая обводка отделяет кружок от иконки
              borderColor: theme.colors.surface,
              backgroundColor: theme.colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Размер цифры и порог, после которого показываем «99+» */}
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
        tabBarActiveTintColor: theme.colors.brand, // ЦВЕТ ВЫБРАННОЙ вкладки
        tabBarInactiveTintColor: theme.colors.textTertiary, // цвет остальных
        // Полоса ровно под содержимое: иконка, подпись и системный индикатор снизу
        tabBarStyle: {
          // ВЫСОТА ПАНЕЛИ = наша часть + системная полоса жеста внизу.
          // Менять нужно tabBarHeight (48) в packages/design-tokens/src/layout.ts.
          // insets.bottom трогать нельзя: это полоса жеста iPhone,
          // на старых телефонах она равна нулю
          height: theme.layout.tabBarHeight + insets.bottom,
          paddingTop: theme.spacing.xxs,
          paddingBottom: insets.bottom,
          backgroundColor: theme.colors.surface, // фон панели
          borderTopColor: theme.colors.divider, // тонкая линия сверху
        },
        tabBarIconStyle: { marginBottom: -theme.spacing.xxs },
        // ПОДПИСИ под иконками. Нужны крупнее — замените overline (11)
        // на caption (13). Убрать совсем — добавьте сюда,
        // в screenOptions: tabBarShowLabel: false
        tabBarLabelStyle: {
          fontFamily: theme.typography.caption.fontFamily,
          fontSize: theme.typography.overline.fontSize,
          marginBottom: theme.spacing.xxs,
        },
      }}
    >
      {/*
        ПОРЯДОК ВКЛАДОК = порядок этих блоков. Хотите переставить —
        передвиньте блок целиком.
        title — подпись под иконкой. На адрес экрана она не влияет:
        адрес берётся из имени файла.
      */}
      <Tabs.Screen
        name="index"
        options={{ title: 'Меню', tabBarIcon: tabIcon('restaurant-outline', 'restaurant') }}
      />
      <Tabs.Screen
        name="promos"
        options={{
          title: 'Акции',
          tabBarIcon: tabIcon('pricetags-outline', 'pricetags'),
          // ВКЛАДКА ПРЯЧЕТСЯ САМА, если у сети выключены акции.
          // Флаг лежит в packages/tenants/data/mamaroma.json → features.stories
          // null прячет вкладку, undefined показывает
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
          // Прячется, если сеть не принимает брони — features.dineInReservation
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
