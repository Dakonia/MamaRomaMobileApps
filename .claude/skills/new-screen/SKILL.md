---
name: new-screen
description: Создать новый экран мобильного приложения по стандартам проекта — с токенами дизайна, типизированным роутом, состоянием загрузки и пустым состоянием. Использовать при запросах «сделай экран», «добавь страницу», «новый таб».
---

# Новый экран

## Куда класть

Экраны живут в `apps/mobile/src/app/` (expo-router, файловая маршрутизация).
Табы — в группе `(tabs)`, модалки — с `presentation: "modal"` в опциях.
Переиспользуемые куски — в `apps/mobile/src/components/`, не в папке роутов.

## Обязательные требования

1. **Только токены.** Цвета, отступы, радиусы, типографика — из `useTheme()`
   (`@/theme/theme-provider`). Ни одного хардкода вроде `#fff`, `padding: 16`,
   `fontSize: 15` — вместо этого `theme.colors.surface`, `theme.spacing.base`,
   `theme.typography.body`.

2. **Бренд — из тенанта.** Название сети, телефон, ссылки берём из `@mr/tenants`,
   а не пишем «Mama Roma» в JSX.

3. **Три состояния данных.** Любой экран с загрузкой данных обрабатывает: загрузку
   (скелетоны на `theme.colors.skeleton`, не спиннер по центру), ошибку (с кнопкой
   «Повторить») и пустое состояние (текст + действие). Данные тянем через
   React Query, не через `useEffect` + `fetch`.

4. **Безопасные зоны.** `useSafeAreaInsets()` для верха и низа — на устройствах с
   вырезом и жестовой навигацией контент не должен упираться в край.

5. **Тач-цели ≥ 44pt.** Мелкие иконки оборачиваем в `Pressable` с `hitSlop`
   из токенов.

6. **Списки — через FlashList**, не `ScrollView` с `.map()`, если элементов может
   быть больше десятка.

7. **Тексты на русском**, обращение к гостю на «вы». Цены форматируем через общий
   хелпер, в разметке не пишем `${price} ₽` вручную.

## Скелет экрана

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme-provider';

export default function Screen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.colors.background, paddingTop: insets.top },
      ]}
    >
      <Text style={[theme.typography.h1, { color: theme.colors.textPrimary }]}>
        Заголовок
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
```

## После создания

Прогнать `npx tsc --noEmit` в `apps/mobile` — проект держится на нуле ошибок типов.
