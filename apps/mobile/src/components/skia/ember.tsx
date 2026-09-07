import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { Platform, StyleSheet, type ViewStyle } from 'react-native';
import { useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';

/**
 * ЖАР ПЕЧИ. Тёплое живое свечение, которое рисует видеокарта.
 *
 * Обычными средствами такое не собрать: мы бы складывали десяток полупрозрачных
 * кругов и двигали их по одному. Здесь вместо этого маленькая программа,
 * которая для каждой точки кадра считает, насколько она сейчас горяча, —
 * и выполняет её видеокарта, не трогая основной поток.
 *
 * Ставится под содержимое как подложка. Один и тот же жар греет заставку,
 * шапку меню и экран принятого заказа — меняются только цвет, яркость и размер.
 */
const source = Skia.RuntimeEffect.Make(`
uniform float2 size;   // размер холста в точках
uniform float  time;   // секунды с начала; 0 — неподвижный кадр
uniform float  power;  // насколько ярко горит: 0 совсем тускло, 1 в полную силу
uniform float3 warm;   // цвет угля
uniform float3 flame;  // цвет пламени

// Простой шум: одно случайное число на клетку сетки
float hash(float2 p) {
  return fract(sin(dot(p, float2(41.7, 289.3))) * 43758.5453);
}

// Сглаженный шум: между клетками переходим плавно, иначе видно квадраты
float noise(float2 p) {
  float2 cell = floor(p);
  float2 part = fract(p);
  float2 ease = part * part * (3.0 - 2.0 * part);

  float a = hash(cell);
  float b = hash(cell + float2(1.0, 0.0));
  float c = hash(cell + float2(0.0, 1.0));
  float d = hash(cell + float2(1.0, 1.0));

  return mix(mix(a, b, ease.x), mix(c, d, ease.x), ease.y);
}

// Несколько слоёв шума разного масштаба — так пламя перестаёт быть пятном
float layers(float2 p) {
  return noise(p) * 0.55 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.15;
}

half4 main(float2 xy) {
  float2 uv = xy / size;

  // Жар поднимается: сетку шума тянем вверх со временем
  float2 flow = float2(uv.x * 3.0 + sin(time * 0.35) * 0.4, uv.y * 2.2 - time * 0.55);
  float heat = layers(flow);

  // Свечение от нижнего края: у пода печи ярче всего
  float rise = pow(1.0 - uv.y, 2.2);

  // Дыхание: два несовпадающих ритма, чтобы пульс не читался как мигание
  float breath = 0.82 + 0.12 * sin(time * 1.7) + 0.06 * sin(time * 0.9 + 1.3);

  float glow = clamp(heat * rise * breath * power * 2.4, 0.0, 1.0);

  // Внизу уголь, выше пламя: цвет ведём по яркости, а не по высоте
  float3 tint = mix(warm, flame, smoothstep(0.25, 0.85, glow));

  // Края гасим, чтобы подложка не обрывалась прямоугольником
  float edges = smoothstep(0.0, 0.22, uv.x) * smoothstep(1.0, 0.78, uv.x);

  return half4(half3(tint * glow), half(glow * edges));
}
`);

type Props = {
  /** Насколько ярко горит: 0 — тлеет, 1 — в полную силу. */
  power?: number;
  /** Цвет угля, к которому уходит свечение внизу. */
  warm?: [number, number, number];
  /** Цвет пламени в самых горячих местах. */
  flame?: [number, number, number];
  style?: ViewStyle;
  /** Размер холста: за его пределы жар не выходит. */
  width: number;
  height: number;
};

const DEFAULT_WARM: [number, number, number] = [0.78, 0.24, 0.06];
const DEFAULT_FLAME: [number, number, number] = [1, 0.62, 0.24];

export function Ember({
  power = 1,
  warm = DEFAULT_WARM,
  flame = DEFAULT_FLAME,
  style,
  width,
  height,
}: Props) {
  const time = useSharedValue(0);

  /**
   * Гость мог попросить систему поменьше двигать картинку — это делают, когда
   * от движения укачивает. Тогда показываем один неподвижный кадр: свечение
   * остаётся, а колыхание уходит.
   */
  const still = useReducedMotion();

  useEffect(() => {
    if (still) return;

    // Один долгий проход по кругу: шейдер периодичен, шва на стыке не видно
    time.set(0);
    time.set(
      withRepeat(withTiming(60, { duration: 60_000, easing: Easing.linear }), -1, false),
    );
  }, [still, time]);

  const uniforms = useDerivedValue(() => ({
    size: [width, height],
    time: still ? 8.4 : time.get(),
    power,
    warm,
    flame,
  }));

  // На вебе Skia тянет отдельный движок в несколько мегабайт — там обходимся
  // без жара: браузерная версия у нас для проверок, а не для гостей
  if (Platform.OS === 'web' || source === null) return null;

  return (
    <Canvas style={[styles.canvas, { width, height }, style]} pointerEvents="none">
      <Fill>
        <Shader source={source} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute' },
});
