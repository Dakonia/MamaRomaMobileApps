import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

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

/** Липкая полоса категорий: подсвечивает текущий раздел и сама к нему подъезжает. */
export function CategoryBar({ categories, activeId, onSelect, onHero }: Props) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const scrollX = useRef(0);
  const draggingUntil = useRef(0);

  // Полоса подъезжает к активному разделу только когда он реально уехал за край
  // и когда её не листает сам гость — иначе она дёргается влево-вправо
  useEffect(() => {
    if (activeId === null) return;

    const chip = offsets.current[activeId];
    if (chip === undefined || viewport.current === 0) return;
    if (Date.now() < draggingUntil.current) return;

    const left = scrollX.current;
    const right = left + viewport.current;
    const margin = theme.spacing.xl;

    const hiddenLeft = chip.x < left + margin;
    const hiddenRight = chip.x + chip.width > right - margin;
    if (!hiddenLeft && !hiddenRight) return;

    scroller.current?.scrollTo({ x: Math.max(0, chip.x - margin), animated: true });
  }, [activeId, theme.spacing.xl]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={32}
      onLayout={(event: LayoutChangeEvent) => {
        viewport.current = event.nativeEvent.layout.width;
      }}
      onScroll={(event) => {
        scrollX.current = event.nativeEvent.contentOffset.x;
      }}
      onScrollBeginDrag={() => {
        // Пока гость листает полосу сам, автоподъезд молчит
        draggingUntil.current = Date.now() + 2500;
      }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenPadding,
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
      }}
    >
      {categories.map((category) => {
        const active = category.id === activeId;

        return (
          <View
            key={category.id}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              offsets.current[category.id] = { x, width };
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
                  ? theme.colors.brand
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
});
