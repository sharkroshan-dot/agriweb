"use client";

import { Flag, MapPin, Store } from "lucide-react";
import { cn } from "../../lib/utils";

const distanceBetweenKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const toCoords = (location: any): { lat: number; lng: number } | null => {
  if (!location) return null;
  const coords = location.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lat = Number(coords[1]);
    const lng = Number(coords[0]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const formatKm = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)} km`);

/**
 * Shows the pickup distance (partner's current location -> farm) and the
 * delivery distance (farm -> customer delivery address) for an order.
 *
 * Prefers the backend-computed `pickupDistance` / `deliveryDistance` values
 * and falls back to a client-side haversine calculation when coordinates are
 * available. Renders nothing when neither the distances nor the pickup name
 * are known.
 */
export function DeliveryDistances({
  delivery,
  origin,
  className,
  compact = false,
}: {
  delivery: any;
  origin?: { lat: number; lng: number } | null;
  className?: string;
  compact?: boolean;
}) {
  const pickup = delivery?.pickup || {};
  const pickupCoords = toCoords(pickup.location || delivery?.pickupLocation);
  const destCoords = toCoords(
    delivery?.deliveryAddress?.location
      || delivery?.deliveryAddress?.deliveryLocation
      || delivery?.deliveryLocation
      || delivery?.address?.location
      || delivery?.location
  );

  let pickupDistance: number | null = Number.isFinite(Number(delivery?.pickupDistance))
    ? Number(delivery.pickupDistance)
    : null;
  let deliveryDistance: number | null = Number.isFinite(Number(delivery?.deliveryDistance))
    ? Number(delivery.deliveryDistance)
    : null;

  if (pickupDistance == null && origin && pickupCoords) {
    pickupDistance = distanceBetweenKm({ lat: origin.lat, lng: origin.lng }, pickupCoords);
  }
  if (deliveryDistance == null && pickupCoords && destCoords) {
    deliveryDistance = distanceBetweenKm(pickupCoords, destCoords);
  }

  const hasDistances = pickupDistance != null || deliveryDistance != null;
  if (!hasDistances && !pickup.name) return null;

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-2.5",
        compact && "p-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Pickup: {pickup.name || "Farm"}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          Pickup distance
          <span className="font-semibold text-amber-800">{formatKm(pickupDistance)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Flag className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          Delivery distance
          <span className="font-semibold text-amber-800">{formatKm(deliveryDistance)}</span>
        </span>
      </div>
    </div>
  );
}
