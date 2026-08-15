import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/theme/theme-provider';

export default function PromosScreen() {
  const theme = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title="Акции" subtitle="Специальные предложения сети" />
      <EmptyState
        icon="pricetags-outline"
        title="Пока без акций"
        description="Здесь появятся сезонные предложения и подборки. Мы пришлём уведомление, когда запустим первую."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
