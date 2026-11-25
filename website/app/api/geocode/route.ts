import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeoResult = { lat: number; lng: number } | null;

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
    // Nominatim results are safe to cache briefly and this avoids repeated lookups.
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
  for (let start = 1; start < parts.length - 1; start += 1) {
    const candidate = parts.slice(start).join(", ");
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }

  try {
    for (const candidate of candidates) {
      const result = await searchNominatim(candidate);
      if (result) return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
    }
    return NextResponse.json({ error: "No matching farm location found" }, { status: 404 });
  } catch (error) {
    console.error("Farm address geocoding failed:", error);
    return NextResponse.json({ error: "Geocoding service is temporarily unavailable" }, { status: 502 });
  }
}
