import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DishExtra } from '@/api/client';
import { ExtraIcon } from '@/components/extra-icon';
import { PressableScale } from '@/components/pressable-scale';
import { PrimaryButton } from '@/components/primary-button';
import { formatPrice } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  visible: boolean;
  extras: DishExtra[];
  picked: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
};

/** Разделы собираем по названию: сайт отдаёт добавки одним плоским списком. */
const GROUPS: { title: string; icon: keyof typeof Ionicons.glyphMap; words: string[] }[] = [
  {
    title: 'Мясо и рыба',
    icon: 'restaurant-outline',
    words: [
      'бекон', 'ветчина', 'пеперони', 'салями', 'прошутто', 'тунец', 'лосось',
      'креветк', 'яйцо', 'курин',
    ],
  },
  {
    title: 'Сыры',
    icon: 'ellipse-outline',
    words: ['сыр', 'моцарелла', 'пармезан', 'горгонзола', 'эмменталь', 'проволоне', 'страчателла'],
  },
  {
    title: 'Соусы',
    icon: 'water-outline',
    words: ['соус', 'кетчуп', 'майонез', 'горчица', 'сметана', 'песто'],
  },
  {
    title: 'Овощи и зелень',
    icon: 'leaf-outline',
    words: [
      'томат', 'помидор', 'перец', 'лук', 'гриб', 'шпинат', 'руккола', 'оливк', 'маслин',
      'кукуруз', 'ананас', 'цукини', 'баклажан', 'брокколи', 'каперс', 'чеснок', 'зелень',
      'базилик', 'огурц', 'порей', 'сельдерей', 'черри',
    ],
  },
];

function groupOf(name: string): string {
  const lowered = name.toLowerCase();
  const found = GROUPS.find((group) => group.words.some((word) => lowered.includes(word)));
  return found?.title ?? 'Разное';
}

/**
 * Полноэкранный выбор добавок: список из полусотни позиций не помещается в
 * карточку блюда, поэтому он живёт в своём окне — с поиском и разделами.
 */
export function ExtrasSheet({ visible, extras, picked, onToggle, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = search
      ? extras.filter((extra) => extra.name.toLowerCase().includes(search))
      : extras;

    const map = new Map<string, DishExtra[]>();
    for (const extra of rows) {
      const title = groupOf(extra.name);
      map.set(title, [...(map.get(title) ?? []), extra]);
    }

    const order = [...GROUPS.map((group) => group.title), 'Разное'];
    const grouped = order
      .filter((title) => map.has(title))
      .map((title) => ({
        title,
        icon: (GROUPS.find((group) => group.title === title)?.icon ??
          'add-circle-outline') as keyof typeof Ionicons.glyphMap,
        rows: map.get(title) ?? [],
      }));

    // Советы идут первыми: к пасте — пармезан, к пицце — моцарелла
    const advised = rows.filter((extra) => extra.is_recommended);
    return advised.length > 0
      ? [{ title: 'Советуем', icon: 'sparkles' as const, rows: advised }, ...grouped]
      : grouped;
  }, [extras, query]);

  const total = extras
    .filter((extra) => picked.includes(extra.id))
    .reduce((sum, extra) => sum + extra.price_kopecks, 0);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={[styles.veil, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable style={styles.grow} accessibilityLabel="Закрыть" onPress={onClose} />

        <Animated.View
          // Плавный выезд без пружины: отскок читался как рывок
          entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutDown.duration(200).easing(Easing.in(Easing.cubic))}
          style={{
            // Высота фиксирована: иначе окно прыгает, когда поиск сокращает список
            height: Math.round(height * 0.8),
            borderTopLeftRadius: theme.radius.xxl,
            borderTopRightRadius: theme.radius.xxl,
            backgroundColor: theme.colors.background,
            overflow: 'hidden',
          }}
        >
          <View style={{ padding: theme.layout.screenPadding, gap: theme.spacing.md }}>
            <View
              style={[
                styles.grabber,
                { backgroundColor: theme.colors.border, borderRadius: theme.radius.pill },
              ]}
            />

            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Text style={[theme.typography.h2, styles.grow, { color: theme.colors.textPrimary }]}>
                Добавки
              </Text>
              <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={onClose}>
                <Ionicons name="close" size={22} color={theme.colors.textTertiary} />
              </Pressable>
            </View>

            <View
              style={[
                styles.row,
                {
                  gap: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.base,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.surfaceSunken,
                },
              ]}
            >
              <Ionicons name="search" size={16} color={theme.colors.textTertiary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Найти добавку"
                placeholderTextColor={theme.colors.textTertiary}
                style={[
                  theme.typography.body,
                  styles.grow,
                  { color: theme.colors.textPrimary, minHeight: theme.layout.minTouchTarget },
                ]}
              />
              {query.length > 0 ? (
                <Pressable accessibilityRole="button" hitSlop={theme.hitSlop} onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color={theme.colors.textTertiary} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: theme.layout.screenPadding,
              paddingBottom: theme.spacing.xl,
              gap: theme.spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {sections.map((section) => (
              <View key={section.title} style={{ gap: theme.spacing.xs }}>
                <View style={[styles.row, { gap: theme.spacing.xs }]}>
                  <Ionicons name={section.icon} size={13} color={theme.colors.textTertiary} />
                  <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                    {section.title}
                  </Text>
                </View>

                {section.rows.map((extra) => {
                  const on = picked.includes(extra.id);

                  return (
                    <Pressable
                      key={extra.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={extra.name}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        onToggle(extra.id);
                      }}
                      style={[
                        styles.row,
                        {
                          gap: theme.spacing.md,
                          paddingVertical: theme.spacing.sm,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.colors.divider,
                        },
                      ]}
                    >
                      {on ? (
                        <Ionicons name="checkmark-circle" size={22} color={theme.colors.brand} />
                      ) : (
                        <ExtraIcon name={extra.name} size={22} color={theme.colors.textTertiary} />
                      )}
                      <Text
                        style={[
                          theme.typography.body,
                          styles.grow,
                          { color: theme.colors.textPrimary },
                        ]}
                      >
                        {extra.name}
                      </Text>
                      <Text
                        style={[
                          theme.typography.bodyMedium,
                          { color: on ? theme.colors.brand : theme.colors.textSecondary },
                        ]}
                      >
                        +{formatPrice(extra.price_kopecks)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {sections.length === 0 ? (
              <Text style={[theme.typography.body, { color: theme.colors.textTertiary }]}>
                Ничего не нашли — попробуйте другое слово.
              </Text>
            ) : null}
          </ScrollView>

          <View
            style={{
              paddingHorizontal: theme.layout.screenPadding,
              paddingTop: theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.md,
              backgroundColor: theme.colors.surface,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.divider,
            }}
          >
            <PrimaryButton
              label={picked.length > 0 ? `Готово · +${formatPrice(total)}` : 'Готово'}
              onPress={onClose}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  veil: { flex: 1, justifyContent: 'flex-end' },
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grabber: { width: 40, height: 4, alignSelf: 'center' },
});
