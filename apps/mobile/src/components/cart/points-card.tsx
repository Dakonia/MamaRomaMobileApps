import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Text } from '@/components/text';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/theme-provider';
import { pieces } from '@/components/cart/shared';

export function PointsCard({
  balance,
  maxToSpend,
  spending,
  earned,
  onToggle,
}: {
  balance: number;
  maxToSpend: number;
  spending: boolean;
  earned: number;
  onToggle: (value: boolean) => void;
}) {
  const theme = useTheme();
  const on = useSharedValue(spending ? 1 : 0);
  const disabled = maxToSpend <= 0;

  useEffect(() => {
    on.value = withSpring(spending ? 1 : 0, { damping: 17, stiffness: 220 });
  }, [on, spending]);

  const card = useAnimatedStyle(() => ({
    borderColor: spending ? theme.colors.accent : theme.colors.border,
    borderWidth: 1 + on.value * 0.6,
  }));

  const track = useAnimatedStyle(() => ({
    backgroundColor: spending ? theme.colors.accent : theme.colors.border,
  }));

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * 22 }] }));

  return (
    <Animated.View
      style={[
        card,
        {
          gap: theme.spacing.sm,
          padding: theme.spacing.base,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <View style={[pieces.line, { gap: theme.spacing.md }]}>
        <View
          style={[
            pieces.badge,
            {
              width: 40,
              height: 40,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.accentSubtle,
            },
          ]}
        >
          <Ionicons name="sparkles" size={19} color={theme.colors.accent} />
        </View>

        <View style={pieces.grow}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.textPrimary }]}>
            {disabled ? 'Баллы копятся' : `Списать ${maxToSpend} ₽ баллами`}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            На счёте {balance}
            {earned > 0 ? ` · вернём ${earned}` : ''}
          </Text>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: spending, disabled }}
          accessibilityLabel="Списать баллы"
          disabled={disabled}
          hitSlop={theme.hitSlop}
          onPress={() => onToggle(!spending)}
        >
          <Animated.View
            style={[
              track,
              { width: 52, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' },
            ]}
          >
            <Animated.View
              style={[
                knob,
                {
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: theme.colors.surface,
                },
              ]}
            />
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * Полка допродажи: лента вбок с фотографиями, как «с этим берут» в карточке
 * блюда. Столбиком она растягивала бы корзину на лишний экран.
 */
