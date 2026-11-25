"use client";

// Forward geocoding helper mirroring the fallback chain used by the shared
// map component: Google Geocoder when a key is configured, then the free
// Nominatim service with progressive suffix shortening (long Indian
// addresses often only resolve down to city/state level).

interface Coords {
  lat: number;
  lng: number;
}

let optionsSet = false;

async function getGoogleGeocoder(): Promise<any | null> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey.includes("your-google-maps")) return null;
    const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
    if (!optionsSet) {
      setOptions({ key: apiKey, v: "weekly" });
      optionsSet = true;
    }
    const geocoding = await importLibrary("geocoding");
    return new geocoding.Geocoder();
  } catch {
    return null;
  }
}

async function geocodeThroughServer(address: string): Promise<Coords | null> {
  try {
    const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    if (!response.ok) return null;
    const data = await response.json();
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<Coords | null> {
  const trimmed = (address || "").trim();
  if (!trimmed) return null;

  const geocoder = await getGoogleGeocoder();
  if (geocoder) {
    try {
      const results: any = await new Promise((resolve, reject) => {
        geocoder.geocode(
          { address: trimmed },
          (res: any, status: any) => {
            if (status === "OK" && res && res[0]) resolve(res);
            else reject(new Error(String(status)));
          }
        );
      });
      const loc = results[0].geometry.location;
      return { lat: loc.lat(), lng: loc.lng() };
    } catch {
      // fall through to Nominatim
    }
  }
  return geocodeThroughServer(trimmed);
}
