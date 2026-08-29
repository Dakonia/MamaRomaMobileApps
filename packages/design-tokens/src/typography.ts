/**
 * ШРИФТЫ И РАЗМЕРЫ ТЕКСТА.
 *
 * В приложении два шрифта: Comfortaa для заголовков, кнопок и цен,
 * Onest для текста и плотного интерфейса.
 *
 * ВАЖНО: строки справа — это ключи из useFonts в apps/mobile/src/app/_layout.tsx.
 * Они обязаны совпадать посимвольно. Опечатку здесь TypeScript не поймает,
 * потому что для него это просто строка: приложение молча подставит
 * системный шрифт, и заголовки перестанут быть округлыми.
 */
export const fontFamily = {
  display: "Comfortaa_600SemiBold", // заголовки экранов и разделов
  displayBold: "Comfortaa_700Bold", // цены и самые крупные заголовки
  displayMedium: "Comfortaa_500Medium",
  body: "Onest_400Regular", // основной текст
  bodyMedium: "Onest_500Medium", // название блюда в карточке
  bodySemiBold: "Onest_600SemiBold", // подзаголовки и подписи заглавными
  bodyBold: "Onest_700Bold",
} as const;

/**
 * ГОТОВЫЕ СТИЛИ ТЕКСТА. Применяется одной строкой — размер, шрифт
 * и высота строки приходят вместе:
 *
 *   <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
 *
 * Меняете fontSize — ОБЯЗАТЕЛЬНО поднимите и lineHeight, иначе строки
 * налезут друг на друга. Рабочее правило: высота строки ≈ размер × 1,45.
 *
 * Отрицательный letterSpacing стягивает буквы: крупный текст без этого
 * выглядит разреженным. У мелких заглавных наоборот положительный —
 * иначе буквы слипаются.
 */
export const typography = {
  display: { fontFamily: fontFamily.displayBold, fontSize: 32, lineHeight: 42, letterSpacing: -0.4 }, // самый крупный: экран успеха
  h1: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 }, // заголовок экрана
  h2: { fontFamily: fontFamily.display, fontSize: 21, lineHeight: 28, letterSpacing: -0.2 }, // название раздела меню
  h3: { fontFamily: fontFamily.bodySemiBold, fontSize: 18, lineHeight: 24 }, // подзаголовки
  bodyLg: { fontFamily: fontFamily.body, fontSize: 17, lineHeight: 24 }, // описание блюда
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22 }, // ОСНОВНОЙ ТЕКСТ
  bodyMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 15, lineHeight: 22 }, // название блюда в карточке
  caption: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 18 }, // состав, вес, подписи
  // ЗАГЛАВНЫМИ: плашки «Остро», «Новинка», подписи вкладок внизу
  overline: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
  // Цифры одинаковой ширины: при пересчёте суммы строка не дёргается
  price: {
    fontFamily: fontFamily.displayBold,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  button: { fontFamily: fontFamily.display, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 }, // надписи на кнопках
} as const;

export type TypographyToken = keyof typeof typography;

/**
 * Цифры одинаковой ширины. Отдельным стилем, а не частью токена: React Native
 * ждёт здесь изменяемый массив, а весь набор токенов заморожен.
 *
 * Ставится рядом с ценой: style={[theme.typography.price, theme.tabularNums]}
 * Без этого «990 ₽» → «1 090 ₽» дёргает строку при пересчёте.
 */
export const tabularNums = { fontVariant: ["tabular-nums"] } as {
  fontVariant: ["tabular-nums"];
};
