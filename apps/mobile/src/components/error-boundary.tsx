import { Ionicons } from '@expo/vector-icons';
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { trackError } from '@/lib/analytics';
import { lightTheme } from '@/theme';

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Последняя защита от белого экрана: любая ошибка отрисовки ловится здесь,
 * уходит в отчёты и показывает гостю понятный экран вместо пустоты.
 * Тема берётся светлая напрямую — контекста в этот момент может уже не быть.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    trackError('Экран не отрисовался', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const theme = lightTheme;

    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background, gap: theme.spacing.base }]}>
        <View
          style={[
            styles.icon,
            { backgroundColor: theme.colors.brandSubtle, borderRadius: theme.radius.pill },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={34} color={theme.colors.brand} />
        </View>

        <Text style={[theme.typography.h2, styles.center, { color: theme.colors.textPrimary }]}>
          Что-то пошло не так
        </Text>

        <Text style={[theme.typography.body, styles.center, { color: theme.colors.textSecondary }]}>
          Мы уже знаем об ошибке и чиним. Попробуйте открыть экран заново.
        </Text>

        <View style={{ alignSelf: 'stretch', paddingTop: theme.spacing.sm }}>
          <PrimaryButton label="Попробовать снова" onPress={() => this.setState({ failed: false })} />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
