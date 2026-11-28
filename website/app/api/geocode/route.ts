import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeoResult = { lat: number; lng: number } | null;

async function searchPhoton(query: string): Promise<GeoResult> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  url.searchParams.set("q", query);
  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json", "User-Agent": "AgriConnect/1.0 (farm pickup geocoding)" },
    signal: AbortSignal.timeout(10000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const coordinates = data?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function searchNominatim(query: string): Promise<GeoResult> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en",
      "User-Agent": "AgriConnect/1.0 (farm pickup geocoding)",
    },
    signal: AbortSignal.timeout(10000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) return null;

  const rows = await response.json();
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

export async function GET(request: NextRequest) {
  const address = (request.nextUrl.searchParams.get("address") || "").trim();
  if (!address) return NextResponse.json({ error: "Address is required" }, { status: 400 });
  if (address.length > 500) return NextResponse.json({ error: "Address is too long" }, { status: 400 });

  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const candidates = [address];
  // Retry progressively shorter address suffixes, but never fall back to a
  // country/state-only result that would place every farm at one generic pin.
  // Strip only the leading street/building segment. Keep locality,
  // district, state and country together so a broad district/state centroid
  // is never returned as if it were the farm's exact location.
  for (let start = 1; start <= parts.length - 4; start += 1) {
    const candidate = parts.slice(start).join(", ");
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }

  try {
    for (const candidate of candidates) {
      // Nominatim is preferred, but its public endpoint can rate-limit or be
      // temporarily unreachable. Try Photon before marking the address failed.
      try {
        const result = await searchNominatim(candidate);
        if (result) return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
      } catch (error) {
        console.warn("Nominatim lookup unavailable; trying fallback provider.", error);
      }
      try {
        const result = await searchPhoton(candidate);
        if (result) return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
      } catch (error) {
        console.warn("Photon lookup unavailable for farm address.", error);
      }
    }
    return NextResponse.json({ error: "No matching farm location found from available geocoding providers" }, { status: 404 });
  } catch (error) {
    console.error("Farm address geocoding failed:", error);
    return NextResponse.json({ error: "Geocoding service is temporarily unavailable" }, { status: 502 });
  }
}
