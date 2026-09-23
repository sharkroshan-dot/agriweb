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

async function geocodeWithNominatim(address: string): Promise<Coords | null> {
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates: string[] = [address];
  for (let i = 0; i < parts.length; i++) {
    const q = parts.slice(i).join(", ");
    if (!candidates.includes(q)) candidates.push(q);
  }
  for (const q of candidates) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await r.json();
      if (data && data[0]) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
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
  return geocodeWithNominatim(trimmed);
}
