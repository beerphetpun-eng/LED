import { useMemo, useState } from "react";
import { Marker, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { mapPinLabel } from "./catalog-api";
import type { Property } from "./catalog-types";

export type PropertyPin = {
  p: Property;
  v: { latitude: number; longitude: number };
  key: string;
  area: string;
};

const labelWidth = 116;
const exactHeight = 30;
const approximateHeight = 45;
const gap = 6;

function placePins(map: L.Map, pins: PropertyPin[], zoom: number) {
  const occupied: L.Bounds[] = [];
  const positions = new Map<string, L.LatLng>();
  const sorted = [...pins].sort(
    (a, b) => Number(!!a.area) - Number(!!b.area) || a.key.localeCompare(b.key),
  );
  for (const pin of sorted) {
    const base = L.latLng(pin.v.latitude, pin.v.longitude);
    const origin = map.project(base, zoom);
    const height = pin.area ? approximateHeight : exactHeight;
    const boundsAt = (point: L.Point) =>
      L.bounds(
        [point.x - labelWidth / 2 - gap / 2, point.y - height - gap / 2],
        [point.x + labelWidth / 2 + gap / 2, point.y + gap / 2],
      );
    let point = origin;
    let bounds = boundsAt(point);
    if (pin.area && occupied.some((other) => bounds.overlaps(other))) {
      // Search outward until a slot clears both approximate and exact labels.
      let found = false;
      for (let ring = 1; !found; ring++) {
        for (let y = -ring; y <= ring && !found; y++) {
          for (let x = -ring; x <= ring && !found; x++) {
            if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
            point = origin.add([x * (labelWidth + gap), y * (height + gap)]);
            bounds = boundsAt(point);
            found = !occupied.some((other) => bounds.overlaps(other));
          }
        }
      }
    }
    occupied.push(bounds);
    positions.set(
      pin.key,
      point === origin ? base : map.unproject(point, zoom),
    );
  }
  return positions;
}

export function PropertyMarkers({
  pins,
  highlightedPin,
  onSelect,
}: {
  pins: PropertyPin[];
  highlightedPin: string | null;
  onSelect: (pin: PropertyPin) => void;
}) {
  const [zoom, setZoom] = useState<number>();
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const positions = useMemo(
    () => placePins(map, pins, zoom ?? map.getZoom()),
    [map, pins, zoom],
  );
  return pins
    .map((pin) => {
      const { p, key, area } = pin;
      const highlighted = highlightedPin === key;
      const height = area ? approximateHeight : exactHeight;
      const label = document.createElement("span");
      label.textContent = mapPinLabel(p);
      if (area) {
        const caption = document.createElement("small");
        caption.textContent = "พิกัดโดยประมาณ";
        label.append(caption);
      }
      const position = positions.get(key)!;
      return (
        <Marker
          key={key}
          position={position}
          zIndexOffset={highlighted ? 1000 : area ? -1 : 0}
          title={area ? `พิกัดโดยประมาณ · ${area}` : undefined}
          autoPanOnFocus={false}
          bubblingMouseEvents={false}
          icon={L.divIcon({
            className: `price-marker${area ? " approximate" : ""}${highlighted ? " highlighted" : ""}`,
            html: label,
            iconSize: [labelWidth, height],
            iconAnchor: [labelWidth / 2, height],
          })}
          eventHandlers={{ click: () => onSelect(pin) }}
        />
      );
    })
    .concat(
      pins.flatMap(({ key, v, area }) => {
        const position = positions.get(key);
        if (
          !area ||
          highlightedPin !== key ||
          !position ||
          position.equals([v.latitude, v.longitude])
        )
          return [];
        return [
          <Polyline
            key={key + ":reference"}
            positions={[[v.latitude, v.longitude], position]}
            interactive={false}
            pathOptions={{ color: "#53665a", dashArray: "4 5", weight: 2 }}
          />,
        ];
      }),
    );
}
