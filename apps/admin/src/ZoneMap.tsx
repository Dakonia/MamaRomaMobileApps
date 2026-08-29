import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

import { admin } from "./theme";
import { Button } from "./ui";

/** Контур зоны хранится как [долгота, широта] — карта ждёт обратный порядок. */
type Point = [number, number];

type Props = {
  outline: Point[];
  color: string;
  /** Точка ресторана: от неё видно, куда зона тянется. */
  center?: { latitude: number; longitude: number } | null;
  onChange: (outline: Point[]) => void;
};

const toMap = (point: Point): [number, number] => [point[1], point[0]];
const fromMap = (latlng: L.LatLng): Point => [
  Number(latlng.lng.toFixed(6)),
  Number(latlng.lat.toFixed(6)),
];

/**
 * Редактор контура: точки таскаются мышкой, двойной клик по карте добавляет
 * новую, клик по точке — удаляет. Карта на открытых тайлах: админка внутренняя,
 * платить за неё незачем.
 */
export function ZoneMap({ outline, color, center, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shape = useRef<L.Polygon | null>(null);
  const dots = useRef<L.CircleMarker[]>([]);
  const latest = useRef(outline);

  const [hint, setHint] = useState<string | null>(null);

  latest.current = outline;

  // Карту создаём один раз: пересборка на каждый кадр сбрасывала бы масштаб
  useEffect(() => {
    if (!box.current || map.current) return;

    const created = L.map(box.current, { zoomControl: true, doubleClickZoom: false }).setView(
      center ? [center.latitude, center.longitude] : [59.94, 30.31],
      11,
    );

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(created);

    created.on("dblclick", (event: L.LeafletMouseEvent) => {
      // Новая точка встаёт в тот отрезок контура, к которому ближе всего клик
      const point = fromMap(event.latlng);
      const outlineNow = latest.current;

      if (outlineNow.length < 2) {
        onChange([...outlineNow, point]);
        return;
      }

      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let index = 0; index < outlineNow.length; index += 1) {
        const from = outlineNow[index];
        const to = outlineNow[(index + 1) % outlineNow.length];
        const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
        const distance = (middle[0] - point[0]) ** 2 + (middle[1] - point[1]) ** 2;

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index + 1;
        }
      }

      const next = [...outlineNow];
      next.splice(bestIndex, 0, point);
      onChange(next);
    });

    map.current = created;

    return () => {
      created.remove();
      map.current = null;
    };
  }, [center, onChange]);

  // Контур и точки перерисовываем при каждом изменении
  useEffect(() => {
    const active = map.current;
    if (!active) return;

    shape.current?.remove();
    dots.current.forEach((dot) => dot.remove());
    dots.current = [];

    if (outline.length >= 3) {
      shape.current = L.polygon(outline.map(toMap), {
        color,
        weight: 2,
        fillOpacity: 0.14,
      }).addTo(active);
    }

    outline.forEach((point, index) => {
      const dot = L.circleMarker(toMap(point), {
        radius: 6,
        color: admin.surface,
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
        // Тащить точку удобнее, чем целиться в неё указателем
        bubblingMouseEvents: false,
      }).addTo(active);

      let dragging = false;

      dot.on("mousedown", () => {
        dragging = true;
        active.dragging.disable();
      });

      active.on("mousemove", (event: L.LeafletMouseEvent) => {
        if (!dragging) return;
        dot.setLatLng(event.latlng);
        const moved = [...latest.current];
        moved[index] = fromMap(event.latlng);
        shape.current?.setLatLngs(moved.map(toMap));
      });

      active.on("mouseup", (event: L.LeafletMouseEvent) => {
        if (!dragging) return;
        dragging = false;
        active.dragging.enable();

        const moved = [...latest.current];
        moved[index] = fromMap(event.latlng);
        onChange(moved);
      });

      dot.on("click", () => {
        if (latest.current.length <= 3) {
          setHint("В контуре должно остаться хотя бы три точки");
          return;
        }
        onChange(latest.current.filter((_, at) => at !== index));
      });

      dots.current.push(dot);
    });

    if (outline.length >= 3) {
      active.fitBounds(L.polygon(outline.map(toMap)).getBounds(), { padding: [24, 24] });
    }
  }, [outline, color, onChange]);

  return (
    <div className="zone-map-wrap">
      <div ref={box} className="zone-map-box" />

      <div className="zone-map-hints">
        <span className="toolbar-note">
          Точку тащите мышкой · двойной клик по карте добавляет точку · клик по точке удаляет
        </span>

        <span className="toolbar-spacer" />

        {outline.length > 0 ? (
          <Button variant="ghost" onClick={() => onChange([])}>
            Очистить контур
          </Button>
        ) : null}
      </div>

      {hint ? <span className="form-warning">{hint}</span> : null}
    </div>
  );
}
