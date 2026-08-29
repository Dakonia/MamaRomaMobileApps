import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { yandexMapsKey } from '@/lib/tenant';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type PinMapHandle = {
  animateToRegion: (region: Region, duration?: number) => void;
};

/** Зона доставки для отрисовки: контур как в GeoJSON и цвет из админки. */
export type MapZone = {
  id: string;
  name: string;
  outline: number[][];
  color: string;
};

type Props = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  /** Общая граница доставки: внешний силуэт всех зон, слитых воедино. */
  coverage?: number[][][];
  /** Цвет этой границы — берём из темы приложения. */
  coverageColor?: string;
  /** Зона под меткой: только её показываем отдельно, поверх общей границы. */
  activeZone?: MapZone | null;
  showsUserLocation?: boolean;
  onPanDrag?: () => void;
  onRegionChange?: (region: Region) => void;
  onRegionChangeComplete?: (region: Region) => void;
};

/** Дельта градусов ↔ уровень зума: карта живёт в зуме, а экран — в дельтах. */
function zoomOf(delta: number): number {
  return Math.round(Math.log2(360 / Math.max(delta, 0.0001)));
}

/** Общая обвязка страницы: карта на весь экран и мост в приложение. */
function shell(head: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #F3EFEB; }
    </style>
    ${head}
  </head>
  <body>
    <div id="map"></div>
    <script>
      var post = function (type, latitude, longitude, span) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: type, latitude: latitude, longitude: longitude, span: span })
        );
      };
      ${body}
    </script>
  </body>
</html>`;
}

/** Карта Яндекса: лучшая детализация по России. */
function yandexPage(key: string, region: Region): string {
  return shell(
    `<script src="https://api-maps.yandex.ru/2.1/?apikey=${key}&lang=ru_RU"></script>`,
    `ymaps.ready(function () {
      var map = new ymaps.Map('map', {
        center: [${region.latitude}, ${region.longitude}],
        zoom: ${zoomOf(region.latitudeDelta)},
        controls: [],
      }, { suppressMapOpenBlock: true });

      map.behaviors.disable('dblClickZoom');

      var send = function (type) {
        var center = map.getCenter();
        post(type, center[0], center[1], 360 / Math.pow(2, map.getZoom()));
      };

      map.events.add('actionbegin', function () { send('drag'); });
      map.events.add('actiontick', function () { send('move'); });
      map.events.add('actionend', function () { send('idle'); });
      send('idle');

      var painted = null;

      /**
       * Сначала общая граница: один силуэт вместо двадцати шести контуров,
       * которые накладывались друг на друга и превращались в паутину. Разбивку
       * по зонам показываем только под меткой — там она и нужна.
       */
      var paint = function (data) {
        if (painted) { map.geoObjects.remove(painted); }
        painted = new ymaps.GeoObjectCollection();

        var ringOf = function (outline) {
          var ring = [];
          // В базе точки лежат как в GeoJSON — долгота первой, а карте нужна широта
          for (var p = 0; p < outline.length; p += 1) {
            ring.push([outline[p][1], outline[p][0]]);
          }
          return ring;
        };

        // Граница покрытия — сплошная и в полную силу: на сером фоне карты
        // бледная линия терялась среди дорог
        var coverage = data.coverage || [];
        for (var i = 0; i < coverage.length; i += 1) {
          painted.add(new ymaps.Polygon([ringOf(coverage[i])], {}, {
            fillColor: data.color + '12',
            strokeColor: data.color,
            strokeWidth: 3,
            interactivityModel: 'default#transparent',
          }));
        }

        if (data.zone) {
          // Зона под меткой заметно плотнее общей границы: её видно сразу
          painted.add(new ymaps.Polygon([ringOf(data.zone.outline)], {
            hintContent: data.zone.name,
          }, {
            fillColor: data.zone.color + '40',
            strokeColor: data.zone.color,
            strokeWidth: 5,
            interactivityModel: 'default#transparent',
          }));
        }

        map.geoObjects.add(painted);
      };

      var apply = function (raw) {
        try {
          var data = JSON.parse(raw);
          if (data.type === 'move') {
            map.setCenter([data.latitude, data.longitude], data.zoom, { duration: data.duration });
          } else if (data.type === 'zones') {
            paint(data);
          }
        } catch (error) {}
      };

      document.addEventListener('message', function (event) { apply(event.data); });
      window.addEventListener('message', function (event) { apply(event.data); });

      // Слушатели на месте — теперь приложению есть кому отвечать
      post('ready', 0, 0, 0);
    });`,
  );
}

/**
 * Карта Яндекса внутри WebView: нативный SDK потребовал бы своей сборки и не
 * работал бы в Expo Go, а JS API одинаково живёт на обеих платформах.
 */
export const PinMap = forwardRef<PinMapHandle, Props>(function PinMap(
  {
    style,
    initialRegion,
    coverage,
    coverageColor = '#C0392B',
    activeZone,
    onPanDrag,
    onRegionChange,
    onRegionChangeComplete,
  },
  ref,
) {
  const web = useRef<WebView>(null);
  const loaded = useRef(false);

  const html = useMemo(() => yandexPage(yandexMapsKey, initialRegion), [initialRegion]);

  // Зоны приезжают с сервера позже самой карты, поэтому шлём их отдельно —
  // и повторяем после загрузки страницы: до неё сообщение упало бы в пустоту
  const sendZones = useCallback(() => {
    if (!loaded.current || coverage === undefined) return;

    web.current?.postMessage(
      JSON.stringify({
        type: 'zones',
        coverage,
        color: coverageColor,
        zone: activeZone ?? null,
      }),
    );
  }, [activeZone, coverage, coverageColor]);

  useEffect(sendZones, [sendZones]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region, duration = 400) => {
      web.current?.postMessage(
        JSON.stringify({
          type: 'move',
          latitude: region.latitude,
          longitude: region.longitude,
          zoom: zoomOf(region.latitudeDelta),
          duration,
        }),
      );
    },
  }));

  return (
    <View style={style}>
      <WebView
        ref={web}
        style={StyleSheet.absoluteFill}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost' }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as {
              type: string;
              latitude: number;
              longitude: number;
              span: number;
            };

            const region: Region = {
              latitude: data.latitude,
              longitude: data.longitude,
              latitudeDelta: data.span,
              longitudeDelta: data.span,
            };

            if (data.type === 'ready') {
              loaded.current = true;
              sendZones();
            } else if (data.type === 'drag') onPanDrag?.();
            else if (data.type === 'idle') onRegionChangeComplete?.(region);
            else onRegionChange?.(region);
          } catch {
            // сообщение не наше — пропускаем
          }
        }}
      />
    </View>
  );
});
