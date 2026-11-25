"use client";

interface Coords {
  lat: number;
  lng: number;
}

// Keep geocoding on the same origin. Calling public geocoders from the browser
// triggers CORS failures, while the server route can apply caching and fallback
// providers consistently.
export async function geocodeAddress(address: string): Promise<Coords | null> {
  const trimmed = (address || "").trim();
  if (!trimmed) return null;

  try {
    const response = await fetch(`/api/geocode?address=${encodeURIComponent(trimmed)}`, {
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
