import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/theme/theme-provider';

export type CategoryChip = { id: string; title: string };

type Props = {
  categories: CategoryChip[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

/** Липкая полоса категорий: подсвечивает текущий раздел и сама к нему подъезжает. */
export function CategoryBar({ categories, activeId, onSelect }: Props) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  useEffect(() => {
    if (activeId === null) return;
    const x = offsets.current[activeId];
    if (x !== undefined) {
      scroller.current?.scrollTo({ x: Math.max(0, x - theme.spacing.xxl), animated: true });
    }
  }, [activeId, theme.spacing.xxl]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
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
              offsets.current[category.id] = event.nativeEvent.layout.x;
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
                backgroundColor: active ? theme.colors.brand : theme.colors.surfaceSunken,
              },
            ]}
          >
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: active ? theme.colors.textOnBrand : theme.colors.textSecondary },
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
