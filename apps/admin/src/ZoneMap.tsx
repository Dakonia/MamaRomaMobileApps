import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type Point = [number, number];
type MapPoint = [number, number];

export type ZoneMapZone = {
  color: string;
  id: string;
  is_active?: boolean;
  name: string;
  outline: Point[];
  restaurant_name?: string;
};

export type ZoneMapHandle = {
  centerOn: (center: { latitude: number; longitude: number }, zoom?: number) => void;
  fitAll: () => void;
  fitCurrent: () => void;
};

type Props = {
  activeZoneId?: string | null;
  center?: { latitude: number; longitude: number } | null;
  color: string;
  editable?: boolean;
  fitNonce?: number;
  onChange?: (outline: Point[]) => void;
  onSelectPoint?: (index: number | null) => void;
  onZoneClick?: (zoneId: string) => void;
  outline: Point[];
  selectedPointIndex?: number | null;
  snapToAxes?: boolean;
  zones?: ZoneMapZone[];
};

type YandexEvent = {
  get: (key: string) => unknown;
  stopPropagation?: () => void;
};

type YandexGeoObject = {
  events: {
    add: (eventName: string, callback: (event: YandexEvent) => void) => void;
  };
  geometry?: {
    getCoordinates?: () => MapPoint;
  };
};

type YandexGeoObjectCollection = {
  add: (object: YandexGeoObject) => void;
  removeAll: () => void;
};

type YandexMapInstance = {
  behaviors: {
    disable: (behaviorName: string) => void;
  };
  container: {
    fitToViewport: () => void;
  };
  destroy: () => void;
  events: {
    add: (eventName: string, callback: (event: YandexEvent) => void) => void;
  };
  geoObjects: {
    add: (object: YandexGeoObject | YandexGeoObjectCollection) => void;
  };
  setBounds: (bounds: [MapPoint, MapPoint], options?: Record<string, unknown>) => void;
  setCenter: (center: MapPoint, zoom?: number, options?: Record<string, unknown>) => void;
};

type YandexApi = {
  GeoObjectCollection: new () => YandexGeoObjectCollection;
  Map: new (element: HTMLElement, state: Record<string, unknown>, options?: Record<string, unknown>) => YandexMapInstance;
  Placemark: new (
    point: MapPoint,
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YandexGeoObject;
  Polygon: new (
    geometry: [MapPoint[]],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YandexGeoObject;
  Polyline: new (
    geometry: MapPoint[],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => YandexGeoObject;
  ready: (callback: () => void) => void;
};

declare global {
  interface Window {
    ymaps?: YandexApi;
  }
}

const FALLBACK_CENTER: MapPoint = [59.94, 30.31];
const YANDEX_MAPS_KEY = (
  import.meta.env.VITE_YANDEX_MAPS_KEY ??
  import.meta.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ??
  ""
).trim();
export const zoneMapProviderName = YANDEX_MAPS_KEY ? "Яндекс.Карты" : "OpenStreetMap";

let yandexMapsLoader: Promise<YandexApi> | null = null;

const toMap = (point: Point): MapPoint => [point[1], point[0]];

function normalizePoint(point: Point, outline: Point[], snapToAxes: boolean): Point {
  const next: Point = [Number(point[0].toFixed(6)), Number(point[1].toFixed(6))];

  if (!snapToAxes || outline.length === 0) return next;

  const threshold = 0.00035;
  for (const existing of outline) {
    if (Math.abs(next[0] - existing[0]) < threshold) next[0] = existing[0];
    if (Math.abs(next[1] - existing[1]) < threshold) next[1] = existing[1];
  }

  return next;
}

function fromLeaflet(latlng: L.LatLng, outline: Point[], snapToAxes: boolean): Point {
  return normalizePoint([latlng.lng, latlng.lat], outline, snapToAxes);
}

function fromYandex(coords: unknown, outline: Point[], snapToAxes: boolean): Point | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const latitude = Number(coords[0]);
  const longitude = Number(coords[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return normalizePoint([longitude, latitude], outline, snapToAxes);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const x = point[0];
  const y = point[1];
  const x1 = start[0];
  const y1 = start[1];
  const x2 = end[0];
  const y2 = end[1];
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) return (x - x1) ** 2 + (y - y1) ** 2;

  const raw = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, raw));
  const projectionX = x1 + t * dx;
  const projectionY = y1 + t * dy;
  return (x - projectionX) ** 2 + (y - projectionY) ** 2;
}

function insertPoint(outline: Point[], point: Point): Point[] {
  if (outline.length < 3) return [...outline, point];

  let bestIndex = 1;
  let bestDistance = Infinity;

  for (let index = 0; index < outline.length; index += 1) {
    const distance = distanceToSegment(point, outline[index], outline[(index + 1) % outline.length]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }

  const next = [...outline];
  next.splice(bestIndex, 0, point);
  return next;
}

function midpoint(start: Point, end: Point): Point {
  return [Number(((start[0] + end[0]) / 2).toFixed(6)), Number(((start[1] + end[1]) / 2).toFixed(6))];
}

function hexWithAlpha(color: string, alpha: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${alpha}`;

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color;
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }

  return `#1E3A8A${alpha}`;
}

function zoneTitle(zone: ZoneMapZone): string {
  return zone.restaurant_name ? `${zone.name} · ${zone.restaurant_name}` : zone.name;
}

function sortedZones(zones: ZoneMapZone[], activeZoneId?: string | null): ZoneMapZone[] {
  return [...zones].sort((left, right) => Number(left.id === activeZoneId) - Number(right.id === activeZoneId));
}

function loadYandexMaps(apiKey: string): Promise<YandexApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("Yandex maps can be loaded only in browser"));

  if (window.ymaps) {
    return new Promise((resolve) => {
      window.ymaps?.ready(() => resolve(window.ymaps as YandexApi));
    });
  }

  if (!yandexMapsLoader) {
    yandexMapsLoader = new Promise((resolve, reject) => {
      const ready = () => {
        if (!window.ymaps) {
          reject(new Error("Yandex maps API is not available"));
          return;
        }

        window.ymaps.ready(() => resolve(window.ymaps as YandexApi));
      };

      const existing = document.querySelector<HTMLScriptElement>("script[data-zone-yandex-maps]");
      if (existing) {
        existing.addEventListener("load", ready, { once: true });
        existing.addEventListener("error", () => reject(new Error("Yandex maps script failed")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.dataset.zoneYandexMaps = "true";
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
      script.addEventListener("load", ready, { once: true });
      script.addEventListener("error", () => reject(new Error("Yandex maps script failed")), { once: true });
      document.head.appendChild(script);
    });
  }

  return yandexMapsLoader;
}

function makeLeafletBounds(points: Point[], center?: { latitude: number; longitude: number } | null): L.LatLngBounds | null {
  const bounds = L.latLngBounds([]);

  points.forEach((point) => bounds.extend(toMap(point)));
  if (center) bounds.extend([center.latitude, center.longitude]);

  return bounds.isValid() ? bounds : null;
}

function makeYandexBounds(points: Point[], center?: { latitude: number; longitude: number } | null): [MapPoint, MapPoint] | null {
  const mapPoints = points.map(toMap);
  if (center) mapPoints.push([center.latitude, center.longitude]);
  if (mapPoints.length === 0) return null;

  const latitudes = mapPoints.map((point) => point[0]);
  const longitudes = mapPoints.map((point) => point[1]);
  return [
    [Math.min(...latitudes), Math.min(...longitudes)],
    [Math.max(...latitudes), Math.max(...longitudes)],
  ];
}

function vertexIcon(index: number, color: string, selected: boolean): L.DivIcon {
  const active = selected ? " is-active" : "";
  return L.divIcon({
    className: "zone-vertex-icon-shell",
    html: `<span class="zone-vertex${active}" style="--zone-color:${color}">${index + 1}</span>`,
    iconAnchor: [13, 13],
    iconSize: [26, 26],
  });
}

function midpointIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "zone-midpoint-icon-shell",
    html: `<span class="zone-midpoint" style="--zone-color:${color}"></span>`,
    iconAnchor: [7, 7],
    iconSize: [14, 14],
  });
}

function leafletPolygonStyle(zone: ZoneMapZone, active: boolean, hasSelection: boolean): L.PolylineOptions {
  return {
    color: zone.is_active === false ? "#78716c" : zone.color,
    dashArray: zone.is_active === false ? "6 6" : undefined,
    fillColor: zone.color,
    fillOpacity: active ? 0.18 : hasSelection ? 0 : 0.025,
    lineJoin: "round",
    opacity: active ? 1 : zone.is_active === false ? 0.34 : 0.44,
    weight: active ? 5 : 2,
  };
}

const LeafletZoneMap = forwardRef<ZoneMapHandle, Props>(function LeafletZoneMap(
  {
    activeZoneId,
    center,
    color,
    editable = false,
    fitNonce = 0,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    selectedPointIndex = null,
    snapToAxes = true,
    zones = [],
  },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const backgroundLayer = useRef<L.LayerGroup | null>(null);
  const currentLayer = useRef<L.LayerGroup | null>(null);
  const didFit = useRef(false);
  const latest = useRef({
    center,
    editable,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    snapToAxes,
    zones,
  });

  latest.current = {
    center,
    editable,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    snapToAxes,
    zones,
  };

  const fitPoints = (points: Point[]) => {
    const active = map.current;
    if (!active) return;

    const bounds = makeLeafletBounds(points, latest.current.center);
    if (bounds) {
      active.fitBounds(bounds, { maxZoom: 14, padding: [30, 30] });
    } else {
      active.setView(
        latest.current.center ? [latest.current.center.latitude, latest.current.center.longitude] : FALLBACK_CENTER,
        11,
      );
    }

    window.setTimeout(() => active.invalidateSize(), 60);
  };

  useImperativeHandle(ref, () => ({
    centerOn: (nextCenter, zoom = 13) => {
      map.current?.setView([nextCenter.latitude, nextCenter.longitude], zoom);
      window.setTimeout(() => map.current?.invalidateSize(), 60);
    },
    fitAll: () => {
      const allPoints = latest.current.zones.flatMap((zone) => zone.outline);
      fitPoints([...allPoints, ...latest.current.outline]);
    },
    fitCurrent: () => fitPoints(latest.current.outline),
  }));

  useEffect(() => {
    if (!box.current || map.current) return;

    const created = L.map(box.current, {
      attributionControl: false,
      doubleClickZoom: false,
      zoomControl: true,
    }).setView(center ? [center.latitude, center.longitude] : FALLBACK_CENTER, 11);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(created);

    backgroundLayer.current = L.layerGroup().addTo(created);
    currentLayer.current = L.layerGroup().addTo(created);

    created.on("click", (event: L.LeafletMouseEvent) => {
      const state = latest.current;
      if (!state.editable || !state.onChange) return;

      state.onChange(insertPoint(state.outline, fromLeaflet(event.latlng, state.outline, state.snapToAxes)));
      state.onSelectPoint?.(state.outline.length < 3 ? state.outline.length : null);
    });

    window.setTimeout(() => created.invalidateSize(), 80);
    map.current = created;

    return () => {
      created.remove();
      backgroundLayer.current = null;
      currentLayer.current = null;
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = backgroundLayer.current;
    if (!layer) return;

    layer.clearLayers();

    sortedZones(zones, activeZoneId).forEach((zone) => {
      if (zone.outline.length < 3) return;

      const isActiveZone = zone.id === activeZoneId;
      if (isActiveZone) {
        L.polygon(zone.outline.map(toMap), {
          color: "#ffffff",
          fillOpacity: 0,
          interactive: false,
          opacity: 0.92,
          weight: 11,
        }).addTo(layer);
      }

      const polygon = L.polygon(zone.outline.map(toMap), leafletPolygonStyle(zone, isActiveZone, Boolean(activeZoneId)));

      polygon.on("click", (event: L.LeafletMouseEvent) => {
        event.originalEvent.stopPropagation();
        latest.current.onZoneClick?.(zone.id);
      });
      polygon.bindTooltip(zoneTitle(zone), {
        direction: "top",
        sticky: true,
      });
      polygon.addTo(layer);
    });

    if (center) {
      L.circleMarker([center.latitude, center.longitude], {
        color: "#ffffff",
        fillColor: "#1E3A8A",
        fillOpacity: 1,
        opacity: 1,
        radius: 6,
        weight: 3,
      }).addTo(layer);
    }

    const allPoints = zones.flatMap((zone) => zone.outline);
    if (!didFit.current && (allPoints.length > 0 || outline.length > 0 || center)) {
      fitPoints([...allPoints, ...outline]);
      didFit.current = true;
    }
  }, [activeZoneId, center, outline, zones]);

  useEffect(() => {
    const active = map.current;
    const layer = currentLayer.current;
    if (!active || !layer) return;

    layer.clearLayers();

    const paintCurrent = editable || zones.length === 0;

    if (paintCurrent && outline.length >= 3) {
      L.polygon(outline.map(toMap), {
        color: "#ffffff",
        fillOpacity: 0,
        interactive: false,
        opacity: 0.92,
        weight: 11,
      }).addTo(layer);
      L.polygon(outline.map(toMap), {
        color,
        fillColor: color,
        fillOpacity: editable ? 0.18 : 0.2,
        lineJoin: "round",
        opacity: 1,
        weight: editable ? 4 : 5,
      }).addTo(layer);
    } else if (paintCurrent && outline.length >= 2) {
      L.polyline(outline.map(toMap), {
        color,
        dashArray: "6 6",
        opacity: 1,
        weight: 4,
      }).addTo(layer);
    }

    if (!editable) return;

    if (outline.length >= 2) {
      outline.forEach((point, index) => {
        const middle = midpoint(point, outline[(index + 1) % outline.length]);
        const handle = L.marker(toMap(middle), {
          icon: midpointIcon(color),
          keyboard: false,
          zIndexOffset: 350,
        });

        handle.on("click", (event: L.LeafletMouseEvent) => {
          event.originalEvent.stopPropagation();
          const next = [...latest.current.outline];
          next.splice(index + 1, 0, middle);
          latest.current.onChange?.(next);
          latest.current.onSelectPoint?.(index + 1);
        });

        handle.addTo(layer);
      });
    }

    outline.forEach((point, index) => {
      const marker = L.marker(toMap(point), {
        draggable: true,
        icon: vertexIcon(index, color, index === selectedPointIndex),
        keyboard: false,
        zIndexOffset: 500,
      });

      marker.on("click", (event: L.LeafletMouseEvent) => {
        event.originalEvent.stopPropagation();
        latest.current.onSelectPoint?.(index);
      });

      marker.on("dragstart", () => {
        active.dragging.disable();
        latest.current.onSelectPoint?.(index);
      });

      marker.on("dragend", () => {
        active.dragging.enable();
        const moved = [...latest.current.outline];
        moved[index] = fromLeaflet(marker.getLatLng(), moved.filter((_, at) => at !== index), latest.current.snapToAxes);
        latest.current.onChange?.(moved);
      });

      marker.addTo(layer);
    });
  }, [color, editable, outline, selectedPointIndex, zones.length]);

  useEffect(() => {
    if (fitNonce > 0) fitPoints(outline);
  }, [fitNonce, outline]);

  return (
    <div className="zone-map-wrap" data-editable={editable || undefined} data-provider="leaflet">
      <div ref={box} className="zone-map-box" />
    </div>
  );
});

const YandexZoneMap = forwardRef<ZoneMapHandle, Props & { apiKey: string }>(function YandexZoneMap(
  {
    activeZoneId,
    apiKey,
    center,
    color,
    editable = false,
    fitNonce = 0,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    selectedPointIndex = null,
    snapToAxes = true,
    zones = [],
  },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<YandexMapInstance | null>(null);
  const backgroundLayer = useRef<YandexGeoObjectCollection | null>(null);
  const currentLayer = useRef<YandexGeoObjectCollection | null>(null);
  const didFit = useRef(false);
  const [ymaps, setYmaps] = useState<YandexApi | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({
    center,
    editable,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    snapToAxes,
    zones,
  });

  latest.current = {
    center,
    editable,
    onChange,
    onSelectPoint,
    onZoneClick,
    outline,
    snapToAxes,
    zones,
  };

  const fitPoints = (points: Point[]) => {
    const active = map.current;
    if (!active) return;

    const bounds = makeYandexBounds(points, latest.current.center);
    if (bounds) {
      active.setBounds(bounds, {
        checkZoomRange: true,
        duration: 160,
        zoomMargin: 38,
      });
    } else {
      active.setCenter(
        latest.current.center ? [latest.current.center.latitude, latest.current.center.longitude] : FALLBACK_CENTER,
        11,
      );
    }

    window.setTimeout(() => active.container.fitToViewport(), 60);
  };

  useImperativeHandle(ref, () => ({
    centerOn: (nextCenter, zoom = 13) => {
      map.current?.setCenter([nextCenter.latitude, nextCenter.longitude], zoom, { duration: 160 });
      window.setTimeout(() => map.current?.container.fitToViewport(), 60);
    },
    fitAll: () => {
      const allPoints = latest.current.zones.flatMap((zone) => zone.outline);
      fitPoints([...allPoints, ...latest.current.outline]);
    },
    fitCurrent: () => fitPoints(latest.current.outline),
  }));

  useEffect(() => {
    let cancelled = false;

    void loadYandexMaps(apiKey)
      .then((api) => {
        if (cancelled || !box.current || map.current) return;

        const created = new api.Map(
          box.current,
          {
            center: center ? [center.latitude, center.longitude] : FALLBACK_CENTER,
            controls: ["zoomControl", "typeSelector"],
            zoom: 11,
          },
          {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
          },
        );

        created.behaviors.disable("dblClickZoom");
        backgroundLayer.current = new api.GeoObjectCollection();
        currentLayer.current = new api.GeoObjectCollection();
        created.geoObjects.add(backgroundLayer.current);
        created.geoObjects.add(currentLayer.current);
        created.events.add("click", (event) => {
          const state = latest.current;
          if (!state.editable || !state.onChange) return;

          const point = fromYandex(event.get("coords"), state.outline, state.snapToAxes);
          if (!point) return;

          state.onChange(insertPoint(state.outline, point));
          state.onSelectPoint?.(state.outline.length < 3 ? state.outline.length : null);
        });

        map.current = created;
        setYmaps(api);
        window.setTimeout(() => created.container.fitToViewport(), 80);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      map.current?.destroy();
      map.current = null;
      backgroundLayer.current = null;
      currentLayer.current = null;
      setYmaps(null);
    };
  }, [apiKey]);

  useEffect(() => {
    if (!ymaps || !backgroundLayer.current) return;

    backgroundLayer.current.removeAll();

    sortedZones(zones, activeZoneId).forEach((zone) => {
      if (zone.outline.length < 3) return;

      const isActiveZone = zone.id === activeZoneId;
      const ring = zone.outline.map(toMap);

      if (isActiveZone) {
        backgroundLayer.current?.add(
          new ymaps.Polygon(
            [ring],
            {},
            {
              fillColor: "#FFFFFF00",
              strokeColor: "#FFFFFFE6",
              strokeWidth: 11,
            },
          ),
        );
      }

      const polygon = new ymaps.Polygon(
        [ring],
        {
          hintContent: zoneTitle(zone),
        },
        {
          fillColor: hexWithAlpha(zone.color, isActiveZone ? "30" : activeZoneId ? "00" : "06"),
          strokeColor: hexWithAlpha(zone.is_active === false ? "#78716c" : zone.color, isActiveZone ? "FF" : "70"),
          strokeStyle: zone.is_active === false ? "dash" : "solid",
          strokeWidth: isActiveZone ? 5 : 2,
        },
      );

      polygon.events.add("click", (event) => {
        event.stopPropagation?.();
        latest.current.onZoneClick?.(zone.id);
      });

      backgroundLayer.current?.add(polygon);
    });

    if (center) {
      backgroundLayer.current.add(
        new ymaps.Placemark(
          [center.latitude, center.longitude],
          { hintContent: "Ресторан" },
          {
            iconColor: "#1E3A8A",
            preset: "islands#circleIcon",
            zIndex: 650,
          },
        ),
      );
    }

    const allPoints = zones.flatMap((zone) => zone.outline);
    if (!didFit.current && (allPoints.length > 0 || outline.length > 0 || center)) {
      fitPoints([...allPoints, ...outline]);
      didFit.current = true;
    }
  }, [activeZoneId, center, outline, ymaps, zones]);

  useEffect(() => {
    if (!ymaps || !currentLayer.current) return;

    currentLayer.current.removeAll();
    const paintCurrent = editable || zones.length === 0;

    if (paintCurrent && outline.length >= 3) {
      const ring = outline.map(toMap);

      currentLayer.current.add(
        new ymaps.Polygon(
          [ring],
          {},
          {
            fillColor: "#FFFFFF00",
            strokeColor: "#FFFFFFE6",
            strokeWidth: 11,
          },
        ),
      );
      currentLayer.current.add(
        new ymaps.Polygon(
          [ring],
          {},
          {
            fillColor: hexWithAlpha(color, editable ? "2E" : "36"),
            strokeColor: hexWithAlpha(color, "FF"),
            strokeWidth: editable ? 4 : 5,
          },
        ),
      );
    } else if (paintCurrent && outline.length >= 2) {
      currentLayer.current.add(
        new ymaps.Polyline(outline.map(toMap), {}, {
          strokeColor: hexWithAlpha(color, "FF"),
          strokeStyle: "dash",
          strokeWidth: 4,
        }),
      );
    }

    if (!editable) return;

    if (outline.length >= 2) {
      outline.forEach((point, index) => {
        const middle = midpoint(point, outline[(index + 1) % outline.length]);
        const handle = new ymaps.Placemark(
          toMap(middle),
          { hintContent: "Добавить точку" },
          {
            iconColor: color,
            preset: "islands#circleDotIcon",
            zIndex: 700,
          },
        );

        handle.events.add("click", (event) => {
          event.stopPropagation?.();
          const next = [...latest.current.outline];
          next.splice(index + 1, 0, middle);
          latest.current.onChange?.(next);
          latest.current.onSelectPoint?.(index + 1);
        });

        currentLayer.current?.add(handle);
      });
    }

    outline.forEach((point, index) => {
      const marker = new ymaps.Placemark(
        toMap(point),
        {
          hintContent: `Точка ${index + 1}`,
          iconContent: String(index + 1),
        },
        {
          draggable: true,
          iconColor: color,
          preset: selectedPointIndex === index ? "islands#dotIcon" : "islands#circleIcon",
          zIndex: selectedPointIndex === index ? 900 : 760,
        },
      );

      marker.events.add("click", (event) => {
        event.stopPropagation?.();
        latest.current.onSelectPoint?.(index);
      });

      marker.events.add("dragstart", () => {
        latest.current.onSelectPoint?.(index);
      });

      marker.events.add("dragend", () => {
        const coords = marker.geometry?.getCoordinates?.();
        const movedPoint = fromYandex(coords, latest.current.outline.filter((_, at) => at !== index), latest.current.snapToAxes);
        if (!movedPoint) return;

        const moved = [...latest.current.outline];
        moved[index] = movedPoint;
        latest.current.onChange?.(moved);
      });

      currentLayer.current?.add(marker);
    });
  }, [color, editable, outline, selectedPointIndex, ymaps, zones.length]);

  useEffect(() => {
    if (fitNonce > 0) fitPoints(outline);
  }, [fitNonce, outline]);

  if (failed) {
    return (
      <LeafletZoneMap
        ref={ref}
        activeZoneId={activeZoneId}
        center={center}
        color={color}
        editable={editable}
        fitNonce={fitNonce}
        outline={outline}
        selectedPointIndex={selectedPointIndex}
        snapToAxes={snapToAxes}
        zones={zones}
        onChange={onChange}
        onSelectPoint={onSelectPoint}
        onZoneClick={onZoneClick}
      />
    );
  }

  return (
    <div className="zone-map-wrap" data-editable={editable || undefined} data-provider="yandex">
      <div ref={box} className="zone-map-box" />
      {!ymaps ? <div className="zone-map-loading">Загружаем Яндекс.Карты</div> : null}
    </div>
  );
});

export const ZoneMap = forwardRef<ZoneMapHandle, Props>(function ZoneMap(props, ref) {
  if (YANDEX_MAPS_KEY) {
    return <YandexZoneMap ref={ref} {...props} apiKey={YANDEX_MAPS_KEY} />;
  }

  return <LeafletZoneMap ref={ref} {...props} />;
});
