import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';

export type CategoryChip = { id: string; title: string };

type Props = {
  categories: CategoryChip[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Полоса стоит на тёмной витрине — меняем цвета чипов. */
  onHero?: boolean;
};

const SPRING = { damping: 20, stiffness: 200, mass: 0.7 };

/** Полоса категорий: подсветка перетекает между разделами, активный держится по центру. */
export function CategoryBar({ categories, activeId, onSelect, onHero }: Props) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const draggingUntil = useRef(0);

  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillVisible = useSharedValue(0);

  useEffect(() => {
    if (activeId === null) return;

    const chip = offsets.current[activeId];
    if (chip === undefined) return;

    // Подсветка перетекает к активному разделу, а не перескакивает
    if (pillWidth.value === 0) {
      pillX.value = chip.x;
      pillWidth.value = chip.width;
    } else {
      pillX.value = withSpring(chip.x, SPRING);
      pillWidth.value = withSpring(chip.width, SPRING);
    }
    pillVisible.value = withTiming(1, { duration: theme.motion.duration.fast });

    // Активный раздел держим по центру: соседи слева и справа всегда на виду
    if (viewport.current > 0 && Date.now() >= draggingUntil.current) {
      const centred = chip.x - viewport.current / 2 + chip.width / 2;
      scroller.current?.scrollTo({ x: Math.max(0, centred), animated: true });
    }
  }, [activeId, pillVisible, pillWidth, pillX, theme.motion.duration.fast]);

  const pillStyle = useAnimatedStyle(() => ({
    left: pillX.value,
    width: pillWidth.value,
    opacity: pillVisible.value,
  }));

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={32}
      onLayout={(event: LayoutChangeEvent) => {
        viewport.current = event.nativeEvent.layout.width;
      }}
      onScrollBeginDrag={() => {
        // Пока полосу листает сам гость, автоцентрирование молчит
        draggingUntil.current = Date.now() + 2500;
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenPadding,
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          {
            top: theme.spacing.sm,
            bottom: theme.spacing.sm,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.brand,
          },
          pillStyle,
        ]}
      />

      {categories.map((category) => {
        const active = category.id === activeId;

        return (
          <View
            key={category.id}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              offsets.current[category.id] = { x, width };

              if (category.id === activeId && pillWidth.value === 0) {
                pillX.value = x;
                pillWidth.value = width;
                pillVisible.value = 1;
              }
            }}
          >
            <PressableScale
              onPress={() => onSelect(category.id)}
              accessibilityLabel={`Перейти к разделу ${category.title}`}
              depth={0.94}
              style={[
                styles.chip,
                {
                  minHeight: theme.layout.minTouchTarget - theme.spacing.sm,
                  paddingHorizontal: theme.spacing.base,
                  borderRadius: theme.radius.pill,
                  backgroundColor: active
                    ? 'transparent'
                    : onHero
                      ? theme.colors.heroRaised
                      : theme.colors.surfaceSunken,
                },
              ]}
            >
              <Text
                style={[
                  theme.typography.bodyMedium,
                  {
                    color: active
                      ? theme.colors.textOnBrand
                      : onHero
                        ? theme.colors.onHeroMuted
                        : theme.colors.textSecondary,
                  },
                ]}
              >
                {category.title}
              </Text>
            </PressableScale>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute' },
});
