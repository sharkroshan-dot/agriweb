// website/components/shared/Map.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

// Google's Maps API logs a console.error when its Geocoder is denied (e.g.
// billing disabled on the key). The delivery map falls back to a key-free
// geocoder, so suppress only those billing/geocoder messages in the dev overlay.
if (typeof window !== "undefined") {
  const originalError = console.error.bind(console);
  (console as any).error = (...args: unknown[]) => {
    const message = args
      .map((a) => (a instanceof Error ? a.message : String(a)))
      .join(" ");
    if (message.includes("Geocoding Service") || message.includes("must enable Billing")) {
      return;
    }
    originalError(...args);
  };
}

interface MapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: Array<{
    id: string;
    lat?: number;
    lng?: number;
    title?: string;
    icon?: string;
    color?: string;
    label?: string;
    displayLabel?: string;
    info?: string;
    address?: string;
  }>;
  route?: Array<{ lat: number; lng: number }>;
  onMarkerClick?: (marker: any) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  className?: string;
  height?: string | number;
  trackUserLocation?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  circle?: { center: { lat: number; lng: number }; radiusKm: number };
  drawRoute?: boolean;
}

let optionsSet = false;

export function Map({
  center = { lat: 28.7041, lng: 77.1025 },
  zoom = 12,
  markers = [],
  route = [],
  onMarkerClick,
  onMapClick,
  className = "",
  height = "400px",
  trackUserLocation = false,
  userLocation = null,
  circle,
  drawRoute = true,
}: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const stopsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const routeLineRef = useRef<any>(null);
  const originDrawnRef = useRef<{ lat: number; lng: number } | null>(null);
  const drawRouteRef = useRef<() => void>(() => {});
  const libsRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const rendererRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const locationButtonRef = useRef<HTMLButtonElement | null>(null);
  const fallbackFrameRef = useRef<HTMLIFrameElement | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const drawRouteEnabledRef = useRef(drawRoute);
  drawRouteEnabledRef.current = drawRoute;
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const hasGoogleMapsKey = Boolean(apiKey && apiKey.trim() && !apiKey.includes("your-google-maps"));

  // Create the map once (not on every marker/route change).
  useEffect(() => {
    if (!hasGoogleMapsKey || !mapRef.current) return;
    let cancelled = false;
    setMapLoadFailed(false);

    // Google can initialize the map object successfully and then reject map
    // tiles because the key is invalid, restricted, or billing/API access is
    // unavailable. Switch to the OpenStreetMap fallback in that case too.
    const previousAuthFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      setMapLoadFailed(true);
    };

    const initMap = async () => {
      try {
        if (!optionsSet) {
          setOptions({ key: apiKey as string, v: "weekly" });
          optionsSet = true;
        }

        const libs = await Promise.all([
          importLibrary("maps"),
          importLibrary("core"),
          importLibrary("marker"),
        ]);
        const [maps, core, marker] = libs;

        if (cancelled || !mapRef.current) return;

        libsRef.current = { maps, core, marker };

        const mapInstance = new maps.Map(mapRef.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom: zoom,
          styles: [
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });

        mapInstanceRef.current = mapInstance;

        const locationButton = document.createElement("button");
        locationButton.textContent = "Location";
        locationButton.style.cssText = `
          position: absolute;
          right: 10px;
          bottom: 20px;
          z-index: 1000;
          padding: 10px 14px;
          background: white;
          border: 1px solid #ccc;
          border-radius: 4px;
          cursor: pointer;
          font-size: 18px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        `;

        locationButton.addEventListener("click", () => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const pos = {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                };
                mapInstance.setCenter(pos);
                mapInstance.setZoom(15);
              },
              () => {
                return;
              }
            );
          }
        });

        locationButtonRef.current = locationButton;
        mapRef.current.appendChild(locationButton);

        mapInstance.addListener("click", (e: any) => {
          const lat = e?.latLng?.lat();
          const lng = e?.latLng?.lng();
          if (typeof lat === "number" && typeof lng === "number") {
            onMapClickRef.current?.({ lat, lng });
          }
        });

        setMapReady(true);
      } catch (error) {
        console.warn("Google Maps unavailable; using OpenStreetMap fallback.", error);
        if (!cancelled) setMapLoadFailed(true);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if ((window as any).gm_authFailure && (window as any).gm_authFailure !== previousAuthFailure) {
        (window as any).gm_authFailure = previousAuthFailure;
      }
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
        radiusCircleRef.current = null;
      }
      if (locationButtonRef.current && mapRef.current) {
        mapRef.current.removeChild(locationButtonRef.current);
      }
      locationButtonRef.current = null;
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      mapInstanceRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoogleMapsKey, apiKey]);

  const markersKey = JSON.stringify(markers);
  const routeKey = JSON.stringify(route);
  const circleKey = JSON.stringify(circle);

  // Update markers + route polyline on the existing map (no map re-creation).
  // Markers that only provide an `address` (no lat/lng) are geocoded so delivery
  // stops still appear even when coordinates weren't stored.
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    const libs = libsRef.current;
    if (!hasGoogleMapsKey || !mapReady || !mapInstance || !libs) return;

    const { maps: _maps, core, marker: markerLib } = libs;
    let cancelled = false;

    const clearRouteLine = () => {
      if (routeLineRef.current) {
        try {
          routeLineRef.current.setMap(null);
        } catch {
          // ignore
        }
        routeLineRef.current = null;
      }
    };

    // Clear existing markers, directions and the auto-route.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (rendererRef.current) {
      rendererRef.current.setMap(null);
      rendererRef.current = null;
    }
    clearRouteLine();
    stopsRef.current = [];
    originDrawnRef.current = null;

    // Draw an optimized driving route from the user's live location through the
    // delivery stops. Uses Google Directions when available (requires billing),
    // otherwise falls back to key-free OSRM routing so a route line still shows.
    const drawRouteNow = () => {
      if (cancelled) return;
      if (!drawRouteEnabledRef.current) return;
      const inst = mapInstanceRef.current;
      const l = libsRef.current;
      if (!inst || !l) return;
      const stops = stopsRef.current.filter(Boolean);
      if (stops.length === 0) return;
      const user = userPosRef.current;

      // A delivery marker is a destination, never a route origin. Wait for
      // the browser GPS fix when this map is tracking the driver's location.
      if (trackUserLocation && !user) return;

      // Throttle: don't re-request unless the origin moved materially.
      if (user && originDrawnRef.current && routeLineRef.current) {
        const prev = originDrawnRef.current;
        const moved = Math.abs(prev.lat - user.lat) + Math.abs(prev.lng - user.lng);
        if (moved < 0.0005) return;
      }

      clearRouteLine();
      const points = user ? [user, ...stops] : stops;
      const origin = { lat: points[0].lat, lng: points[0].lng };
      const destination = { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng };
      const waypoints = points.slice(1, -1).map((p) => ({
        location: { lat: p.lat, lng: p.lng },
        stopover: true,
      }));

      const drawStraight = () => {
        if (points.length < 2) return;
        if (routeLineRef.current) return;
        const line = new _maps.Polyline({
          path: points,
          geodesic: true,
          strokeColor: "#2563EB",
          strokeWeight: 5,
          strokeOpacity: 0.9,
          map: inst,
        });
        routeLineRef.current = line;
        originDrawnRef.current = user || origin;
      };

      const drawOsrmFallback = () => {
        const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
        fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)
          .then((r) => r.json())
          .then((data) => {
            if (cancelled) return;
            const geom = data?.routes?.[0]?.geometry?.coordinates;
            if (!geom || geom.length === 0) {
              drawStraight();
              return;
            }
            const path = geom.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
            const line = new _maps.Polyline({
              path,
              geodesic: true,
              strokeColor: "#2563EB",
              strokeWeight: 5,
              strokeOpacity: 0.9,
              map: inst,
            });
            routeLineRef.current = line;
            originDrawnRef.current = user || origin;
          })
          .catch(() => drawStraight());
      };

      // Use the key-free OSRM route directly. Google Directions can return
      // REQUEST_DENIED when billing or the Directions API is not enabled, and
      // it logs that failure before its callback reaches our fallback.
      drawOsrmFallback();
    };
    drawRouteRef.current = drawRouteNow;

    const addMarker = (marker: any) => {
      if (cancelled) return;
      const markerOptions: any = {
        position: { lat: marker.lat, lng: marker.lng },
        map: mapInstance,
        title: marker.title || "",
      };
      if (marker.displayLabel) {
        // Grouped delivery markers use a simple label above a small location
        // pin. The label is the visual summary; clicking it still opens the
        // full order details in the page panel.
        const label = String(marker.displayLabel).replace(/\s+/g, " ").trim();
        const escapeSvg = (value: string) =>
          value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        // Keep the map marker intentionally minimal: only the grouped
        // customer/product summary above a small location pin. Quantity,
        // order IDs, selection state and route details belong in the panel
        // opened after clicking the marker.
        const width = Math.min(360, Math.max(150, label.length * 7 + 28));
        const height = 62;
        const fill = marker.color || "#2563EB";
        const textX = width / 2;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <text x="${textX}" y="20" text-anchor="middle" fill="#0f172a" font-family="Arial,sans-serif" font-size="12" font-weight="700" paint-order="stroke" stroke="#ffffff" stroke-width="4" stroke-linejoin="round">📍 ${escapeSvg(label)}</text>
          <path d="M${textX - 9} 31 L${textX} 49 L${textX + 9} 31 Z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
          <circle cx="${textX}" cy="40" r="5" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
        </svg>`;
        markerOptions.icon = {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new core.Size(width, height),
          anchor: new core.Point(width / 2, height),
        };
      } else if (marker.color || marker.label) {
        // Colored pin with an optional glyph (letter/number).
        const pin = new markerLib.PinElement({
          background: marker.color || "#EF4444",
          borderColor: marker.color || "#EF4444",
          glyphColor: "#FFFFFF",
          scale: 1.2,
          glyph: marker.label || "",
        });
        markerOptions.icon = pin.element;
      } else if (marker.icon) {
        markerOptions.icon = {
          url: marker.icon,
          scaledSize: new core.Size(40, 40),
        };
      }
      const markerInstance = new markerLib.Marker(markerOptions);

      if (marker.info) {
        const infoWindow = new _maps.InfoWindow({
          content: `<div style="padding: 8px; max-width: 200px;">
            <strong>${marker.title || ""}</strong>
            <p style="margin: 4px 0; font-size: 12px;">${marker.info}</p>
          </div>`,
        });

        markerInstance.addListener("click", () => {
          infoWindow.open(mapInstance, markerInstance);
          if (onMarkerClick) onMarkerClick(marker);
        });
      }

      markersRef.current.push(markerInstance);

      if (markersRef.current.length > 1) {
        // With the modular Maps API, LatLngBounds is exported by the
        // `core` library rather than the `maps` library.
        const bounds = new core.LatLngBounds();
        markersRef.current.forEach((m) => {
          const pos = m.getPosition();
          if (pos) bounds.extend(pos);
        });
        mapInstance.fitBounds(bounds);
      }

      if (marker.lat != null && marker.lng != null) {
        const exists = stopsRef.current.some(
          (s) => Math.abs(s.lat - marker.lat) < 1e-4 && Math.abs(s.lng - marker.lng) < 1e-4
        );
        if (!exists) stopsRef.current.push({ lat: marker.lat, lng: marker.lng });
        drawRouteNow();
      }
    };

    markers
      .filter((m) => m.lat != null && m.lng != null)
      .forEach(addMarker);

    const toGeocode = markers.filter(
      (m) => (m.lat == null || m.lng == null) && m.address
    );
    if (toGeocode.length > 0) {
      // Deduplicate by address so identical stops are only geocoded once.
      const grouped = new globalThis.Map<string, any[]>();
      toGeocode.forEach((m) => {
        const key = (m.address || "").trim();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(m);
      });

      const addResolved = (address: string, lat: number, lng: number) => {
        if (cancelled) return;
        (grouped.get(address) || []).forEach((m) => addMarker({ ...m, lat, lng }));
      };

      // Free fallback (no API key / billing required) so delivery stops still
      // appear even when the Google Geocoder is denied (e.g. billing disabled).
      // Nominatim often fails on long Indian addresses, so we retry with
      // progressively shorter suffixes (down to state/country) until it resolves.
      const geocodeWithNominatim = (address: string, items: any[]): void => {
        const parts = (address || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const suffixes: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          suffixes.push(parts.slice(i).join(", "));
        }
        if (!suffixes.includes(address.trim())) suffixes.unshift(address.trim());

        const attempt = (i: number): void => {
          if (cancelled || i >= suffixes.length) return;
          fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(suffixes[i])}`,
            { headers: { "Accept-Language": "en", "User-Agent": "agri-delivery-app/1.0" } }
          )
            .then((r) => r.json())
            .then((data: any[]) => {
              if (cancelled) return;
              if (data && data[0]) {
                addResolved(address, parseFloat(data[0].lat), parseFloat(data[0].lon));
              } else {
                attempt(i + 1);
              }
            })
            .catch(() => attempt(i + 1));
        };
        attempt(0);
      };

      grouped.forEach((items, address) => {
        geocodeWithNominatim(address, items);
      });
    }

    if (markers.length === 0 && route.length === 0) {
      mapInstance.setCenter({ lat: center.lat, lng: center.lng });
      mapInstance.setZoom(zoom);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoogleMapsKey, mapReady, markersKey, routeKey]);

  // Draw the selected delivery radius as a translucent circle around the origin
  // (the farm or the farmer's live location). Re-created only when it changes.
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    const libs = libsRef.current;
    if (!hasGoogleMapsKey || !mapReady || !mapInstance || !libs) return;
    const { maps } = libs;

    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null);
      radiusCircleRef.current = null;
    }
    if (!circle || circle.center.lat == null || circle.center.lng == null) return;

    const radiusMeters = Math.max(1, Number(circle.radiusKm) || 0) * 1000;
    if (!radiusMeters) return;

    radiusCircleRef.current = new maps.Circle({
      strokeColor: "#6366F1",
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: "#6366F1",
      fillOpacity: 0.08,
      map: mapInstance,
      center: { lat: circle.center.lat, lng: circle.center.lng },
      radius: radiusMeters,
    });

    return () => {
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
        radiusCircleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoogleMapsKey, mapReady, circleKey]);

  // Live tracking: watch the user's position and keep a "you are here" blue dot
  // in sync, panning the map to follow while they deliver.
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    const libs = libsRef.current;
    // When the parent supplies its live GPS reading, use that single source
    // of truth instead of allowing this component to overwrite it with a
    // separate browser watcher.
    if (!hasGoogleMapsKey || !mapReady || !trackUserLocation || userLocation || !mapInstance || !libs) return;
    if (!("geolocation" in navigator)) return;

    const { maps: _maps, marker: markerLib, core } = libs;
    let watchId: number | undefined;

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
        userPosRef.current = pos;
        if (!userMarkerRef.current) {
          userMarkerRef.current = new markerLib.Marker({
            position: pos,
            map: mapInstance,
            title: "Your location",
            zIndex: 1000,
            icon: {
              // SymbolPath is not exposed consistently by the modular Maps
              // loader; CIRCLE is enum value 0 in the Maps API.
              path: _maps.SymbolPath?.CIRCLE ?? core.SymbolPath?.CIRCLE ?? 0,
              scale: 9,
              fillColor: "#4285F4",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });
        } else {
          userMarkerRef.current.setPosition(pos);
        }
        mapInstance.panTo(pos);
        drawRouteRef.current();
      },
      () => {
        return;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoogleMapsKey, mapReady, trackUserLocation, userLocation]);

  // Keep the map route synchronized with the page-level GPS reading. This
  // prevents the map's independent watcher from drawing a route from a stale
  // or different browser location than the navigation button uses.
  useEffect(() => {
    if (!userLocation) return;
    userPosRef.current = userLocation;
    const mapInstance = mapInstanceRef.current;
    const libs = libsRef.current;
    if (!mapInstance || !libs || !mapReady) return;

    const { marker: markerLib, maps: _maps, core } = libs;
    if (!userMarkerRef.current) {
      userMarkerRef.current = new markerLib.Marker({
        position: userLocation,
        map: mapInstance,
        title: "Your current location",
        zIndex: 1000,
        icon: {
          path: _maps.SymbolPath?.CIRCLE ?? core.SymbolPath?.CIRCLE ?? 0,
          scale: 9,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      });
    } else {
      userMarkerRef.current.setPosition(userLocation);
    }
    drawRouteRef.current();
  }, [userLocation, mapReady]);

  useEffect(() => {
    if (hasGoogleMapsKey && !mapLoadFailed) return;
    const handleFallbackMessage = (event: MessageEvent) => {
      if (!fallbackFrameRef.current || event.source !== fallbackFrameRef.current.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "agri-map-marker" && data.id != null) {
        onMarkerClick?.(markers.find((m) => String(m.id) === String(data.id)));
      }
      if (data.type === "agri-map-click" && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
        onMapClick?.({ lat: Number(data.lat), lng: Number(data.lng) });
      }
    };
    window.addEventListener("message", handleFallbackMessage);
    return () => window.removeEventListener("message", handleFallbackMessage);
  }, [hasGoogleMapsKey, mapLoadFailed, markers, onMarkerClick, onMapClick]);

  if (!hasGoogleMapsKey || mapLoadFailed) {
    const fallbackMarkers = markers.filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng))).map((m) => ({ id: String(m.id), lat: Number(m.lat), lng: Number(m.lng), title: String(m.title || ""), displayLabel: m.displayLabel ? String(m.displayLabel) : "", label: String(m.label || ""), color: String(m.color || "#10B981"), info: String(m.info || "") }));
    const fallbackRoute = route.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    const fallbackCenter = { lat: Number(center.lat), lng: Number(center.lng) };
    const fallbackCircle = circle ? { lat: Number(circle.center.lat), lng: Number(circle.center.lng), radiusKm: Number(circle.radiusKm || 0) } : null;
    const fallbackUser = userLocation ? { lat: Number(userLocation.lat), lng: Number(userLocation.lng) } : null;
    const leafletDocument = "<!doctype html>\n<html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>\n<link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css\"/>\n<style>html,body,#map{height:100%;margin:0}body{font-family:Arial,sans-serif}.leaflet-control-attribution{font-size:9px}.pin{width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}.pin span{transform:rotate(45deg);color:#fff;font-weight:700;font-size:11px}</style></head>\n<body><div id=\"map\"></div><script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\"><\\/script><script>\nconst center=__CENTER__;const markers=__MARKERS__;const route=__ROUTE__;const circle=__CIRCLE__;const user=__USER__;\nconst map=L.map('map',{zoomControl:true}).setView([center.lat,center.lng],12);\nL.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);\nconst bounds=[];\nfunction addPoint(m){const text=String(m.displayLabel||m.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');const pinColor=m.color||'#2563EB';const html=m.displayLabel?'<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)"><div style="font:700 12px Arial,sans-serif;line-height:16px;white-space:nowrap;color:#0f172a;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 6px #fff">📍 '+text+'</div><div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid '+pinColor+';margin-top:3px"></div><div style="width:10px;height:10px;border-radius:50%;background:'+pinColor+';border:2px solid #fff;margin-top:-6px;box-shadow:0 1px 4px rgba(0,0,0,.25)"></div></div>':'<div class="pin" style="background:'+pinColor+'"><span>'+String(m.label||'').replace(/</g,'&lt;')+'</span></div>';const icon=L.divIcon({className:'',html,iconSize:m.displayLabel?[300,68]:[28,28],iconAnchor:m.displayLabel?[150,67]:[14,27],popupAnchor:[0,-60]});const marker=L.marker([m.lat,m.lng],{icon}).addTo(map);marker.bindPopup('<strong>'+m.title.replace(/</g,'&lt;')+'</strong><br><small>'+m.info.replace(/</g,'&lt;')+'</small>');marker.on('click',()=>parent.postMessage({type:'agri-map-marker',id:m.id},'*'));bounds.push([m.lat,m.lng]);}markers.forEach(addPoint);\nif(user){L.circleMarker([user.lat,user.lng],{radius:9,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(map).bindTooltip('Your location');bounds.push([user.lat,user.lng]);}\nif(circle&&circle.radiusKm>0){L.circle([circle.lat,circle.lng],{radius:circle.radiusKm*1000,color:'#6366f1',weight:2,fillOpacity:.08}).addTo(map);bounds.push([circle.lat,circle.lng]);}\nif(route.length>1)L.polyline(route.map(p=>[p.lat,p.lng]),{color:'#2563eb',weight:5}).addTo(map);\nif(bounds.length>1)map.fitBounds(bounds,{padding:[30,30]});\nmap.on('click',e=>parent.postMessage({type:'agri-map-click',lat:e.latlng.lat,lng:e.latlng.lng},'*'));\n<\\/script></body></html>"
      .replace("__CENTER__", JSON.stringify(fallbackCenter))
      .replace("__MARKERS__", JSON.stringify(fallbackMarkers))
      .replace("__ROUTE__", JSON.stringify(fallbackRoute))
      .replace("__CIRCLE__", JSON.stringify(fallbackCircle))
      .replace("__USER__", JSON.stringify(fallbackUser));
    return (
      <div className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 ${className}`} style={{ height: typeof height === "number" ? `${height}px` : height }}>
        <iframe ref={fallbackFrameRef} title="Farmer delivery map" srcDoc={leafletDocument} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin" />
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/95 px-3 py-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-800">OpenStreetMap</p><p className="text-[10px] text-slate-500">Interactive delivery map</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className={`relative w-full ${className}`}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    />
  );
}

export function MapLoading() {
  return (
    <div className="flex h-[400px] w-full items-center justify-center rounded-lg bg-muted">
      <div className="flex flex-col items-center gap-2">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading map...</p>
      </div>
    </div>
  );
}

export function MapFallback() {
  return (
    <div className="flex h-[400px] w-full items-center justify-center rounded-lg border-2 border-dashed bg-muted/50">
      <div className="text-center">
        <p className="mb-2 text-4xl">Map</p>
        <p className="font-medium">Map Unavailable</p>
        <p className="text-sm text-muted-foreground">Please configure Google Maps API key</p>
      </div>
    </div>
  );
}
