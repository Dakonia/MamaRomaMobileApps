import Svg, { Circle, Path } from 'react-native-svg';

type Kind =
  | 'cheese'
  | 'meat'
  | 'mushroom'
  | 'sauce'
  | 'herb'
  | 'fish'
  | 'tomato'
  | 'pepper'
  | 'dough'
  | 'plus';

type Props = {
  name: string;
  size?: number;
  color: string;
};

/** Что за добавка — понимаем по названию: сайт отдаёт их одной строкой. */
function kindOf(name: string): Kind {
  const lowered = name.toLowerCase();
  const table: [string[], Kind][] = [
    [['пармезан', 'моцарелла', 'сыр', 'горгонзола', 'эмменталь', 'страчателла'], 'cheese'],
    [['бекон', 'ветчина', 'пеперони', 'салями', 'прошутто', 'курин'], 'meat'],
    [['гриб', 'фунги'], 'mushroom'],
    [['лосось', 'тунец', 'креветк'], 'fish'],
    [['соус', 'кетчуп', 'майонез', 'горчица', 'сметана', 'песто'], 'sauce'],
    [['зелень', 'базилик', 'руккола', 'шпинат', 'порей', 'сельдерей', 'брокколи'], 'herb'],
    [['томат', 'помидор', 'черри', 'оливк', 'маслин', 'ананас', 'кукуруз'], 'tomato'],
    [['перец', 'чили', 'чеснок'], 'pepper'],
    [['тесто', 'хлеб'], 'dough'],
  ];

  for (const [words, kind] of table) {
    if (words.some((word) => lowered.includes(word))) return kind;
  }
  return 'plus';
}

/**
 * Свои иконки добавок вместо эмодзи: одна линия, один цвет — рисуются так же,
 * как остальные значки приложения, и не зависят от шрифта системы.
 */
export function ExtraIcon({ name, size = 22, color }: Props) {
  const kind = kindOf(name);
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none' } as const;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'cheese' ? (
        <>
          {/* клин сыра с дырками */}
          <Path d="M3 16.5 L20 7.5 L21 16.5 L4.5 19.5 Z" {...stroke} strokeLinejoin="round" />
          <Circle cx="9" cy="15" r="1.4" fill={color} />
          <Circle cx="14.5" cy="13" r="1" fill={color} />
          <Circle cx="17.5" cy="16.5" r="1.2" fill={color} />
        </>
      ) : null}

      {kind === 'meat' ? (
        <>
          {/* полоска бекона */}
          <Path
            d="M3 8c3-3 5 3 8 0s5 3 8 0v4c-3 3-5-3-8 0s-5-3-8 0Z"
            {...stroke}
            strokeLinejoin="round"
          />
          <Path d="M3 12v4c3-3 5 3 8 0s5 3 8 0v-4" {...stroke} strokeLinejoin="round" />
        </>
      ) : null}

      {kind === 'mushroom' ? (
        <>
          <Path d="M4 11a8 6 0 0 1 16 0Z" {...stroke} strokeLinejoin="round" />
          <Path d="M10 11v6a2 2 0 0 0 4 0v-6" {...stroke} strokeLinejoin="round" />
        </>
      ) : null}

      {kind === 'sauce' ? (
        <Path d="M12 3.5c3.5 4.5 5.5 7 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2.5 2-5 5.5-9.5Z" {...stroke} />
      ) : null}

      {kind === 'herb' ? (
        <>
          <Path d="M20 4c-8 0-13 4-13 10 0 2 1 4 1 4s9-1 11-8c1-3.5 1-6 1-6Z" {...stroke} />
          <Path d="M4 20c2-5 6-9 12-12" {...stroke} strokeLinecap="round" />
        </>
      ) : null}

      {kind === 'fish' ? (
        <>
          <Path d="M3 12c3-4 7-6 11-6 3.5 0 6 2 7 6-1 4-3.5 6-7 6-4 0-8-2-11-6Z" {...stroke} />
          <Circle cx="16.5" cy="10.5" r="1" fill={color} />
          <Path d="M3 12c1.5-1.5 2.5-3 2.5-3M3 12c1.5 1.5 2.5 3 2.5 3" {...stroke} />
        </>
      ) : null}

      {kind === 'tomato' ? (
        <>
          <Circle cx="12" cy="14" r="7" {...stroke} />
          <Path d="M9 6.5c1 1 2 1.5 3 1.5s2-.5 3-1.5" {...stroke} strokeLinecap="round" />
          <Path d="M12 8V5" {...stroke} strokeLinecap="round" />
        </>
      ) : null}

      {kind === 'pepper' ? (
        <>
          <Path d="M17 7c0 6-3.5 12-8 12-2 0-3-1.5-3-3 0-4 5-7 11-9Z" {...stroke} />
          <Path d="M17 7c0-2 1-3 2.5-3.5" {...stroke} strokeLinecap="round" />
        </>
      ) : null}

      {kind === 'dough' ? (
        <>
          <Circle cx="12" cy="12" r="8.5" {...stroke} />
          <Circle cx="10" cy="10" r="1.2" fill={color} />
          <Circle cx="14.5" cy="13" r="1.2" fill={color} />
          <Circle cx="10.5" cy="15" r="1" fill={color} />
        </>
      ) : null}

      {kind === 'plus' ? (
        <>
          <Circle cx="12" cy="12" r="8.5" {...stroke} />
          <Path d="M12 8.5v7M8.5 12h7" {...stroke} strokeLinecap="round" />
        </>
      ) : null}
    </Svg>
  );
}
