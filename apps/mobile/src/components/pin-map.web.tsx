import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type Props = ViewProps & {
  initialRegion?: Region;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  onPanDrag?: () => void;
  onRegionChange?: (region: Region) => void;
  onRegionChangeComplete?: (region: Region) => void;
};

export type PinMapHandle = { animateToRegion: (region: Region, duration?: number) => void };

/** В браузере карты нет — показываем подсказку и не роняем сборку. */
export const PinMap = forwardRef<PinMapHandle, Props>(function PinMap({ style }, ref) {
  useImperativeHandle(ref, () => ({ animateToRegion: () => undefined }));

  return (
    <View style={[styles.root, style]}>
      <Text style={styles.text}>Карта доступна в приложении на телефоне</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFEBE7' },
  text: { color: '#6C625C' },
});
