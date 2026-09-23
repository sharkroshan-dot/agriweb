"use client";

import { useState, useCallback, useRef } from "react";
import { MapPin, Crosshair, Trash2, Search, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Map } from "../shared/map";

export interface LocationValue {
  lat: number;
  lng: number;
  address?: string;
}

interface LocationPickerProps {
  value?: LocationValue | null;
  onChange: (location: LocationValue | null) => void;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
}

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleGetCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }
    setLoading(true);
    setError(null);

    const success = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      onChange({ lat: latitude, lng: longitude, address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
      setLoading(false);
    };

    const fallbackError = (fallbackErr: GeolocationPositionError) => {
      setError(`Couldn't get your location. ${fallbackErr.message || ""}`.trim());
      setLoading(false);
    };

    const error = (err: GeolocationPositionError) => {
      // TIMEOUT (code 3): retry with low accuracy instead of giving up
      if (err.code === 3) {
        navigator.geolocation.getCurrentPosition(success, fallbackError, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000,
        });
        return;
      }
      if (err.code === 1) {
        setError("Location permission denied. Please allow location access and try again.");
      } else if (err.code === 2) {
        setError("Location unavailable. Try again or use the search box instead.");
      } else {
        setError(err.message || "Failed to get current location");
      }
      setLoading(false);
    };

    navigator.geolocation.getCurrentPosition(success, error, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  }, [onChange]);

  // Search places via Nominatim
  const searchPlaces = useCallback(async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=20&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!res.ok) throw new Error("Search failed");
      const data: SearchResult[] = await res.json();
      setSearchResults(data);
      setShowResults(data.length > 0);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchPlaces(val), 400);
  };

  const handleSelectResult = (result: SearchResult) => {
    onChange({ lat: parseFloat(result.lat), lng: parseFloat(result.lon), address: result.display_name });
    setSearchQuery(result.display_name.split(",")[0]);
    setShowResults(false);
    setSearchResults([]);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-medium">Product Location</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGetCurrentLocation}
              disabled={loading}
            >
              <Crosshair className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Getting location..." : "Use current location"}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search for any place (village, town, city)..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-9 pr-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
            )}
            {showResults && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((result, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 transition-colors border-b last:border-0 flex items-start gap-2"
                    onClick={() => handleSelectResult(result)}
                  >
                    {result.type && result.class === "place" && (
                      <span className="shrink-0 mt-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 uppercase">
                        {result.type}
                      </span>
                    )}
                    <span className="truncate">{result.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
            <div className="rounded-md border bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-400">Latitude</span>
              <p className="font-mono">{value ? value.lat.toFixed(6) : "—"}</p>
            </div>
            <div className="rounded-md border bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-400">Longitude</span>
              <p className="font-mono">{value ? value.lng.toFixed(6) : "—"}</p>
            </div>
          </div>

          {value ? (
            <Map
              center={{ lat: value.lat, lng: value.lng }}
              zoom={15}
              height="260px"
              className="rounded-lg border"
              markers={[
                {
                  id: "picked-location",
                  lat: value.lat,
                  lng: value.lng,
                  title: "Selected location",
                  color: "#059669",
                  info: value.address || `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`,
                },
              ]}
              drawRoute={false}
              onMapClick={({ lat, lng }) =>
                onChange({ lat, lng, address: value?.address })
              }
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border bg-gradient-to-br from-emerald-50 to-green-50">
              <div className="text-center">
                <MapPin className="mx-auto h-10 w-10 text-emerald-300" />
                <p className="mt-2 text-sm font-medium text-emerald-700">Set your product location</p>
                <p className="mt-1 text-xs text-emerald-500">Search a place, use current location, or enter coordinates</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="number"
              step="any"
              placeholder="Lat"
              className="w-24 px-2 py-1.5 text-sm border rounded-md"
              value={value?.lat ?? ""}
              onChange={(e) => {
                const lat = parseFloat(e.target.value);
                if (!isNaN(lat)) {
                  onChange({ lat, lng: value?.lng || 0, address: value?.address });
                }
              }}
            />
            <input
              type="number"
              step="any"
              placeholder="Lng"
              className="w-24 px-2 py-1.5 text-sm border rounded-md"
              value={value?.lng ?? ""}
              onChange={(e) => {
                const lng = parseFloat(e.target.value);
                if (!isNaN(lng)) {
                  onChange({ lat: value?.lat || 0, lng, address: value?.address });
                }
              }}
            />
          </div>
          {value && (
            <p className="text-xs text-gray-400">
              Click anywhere on the map to move the pin to a new spot
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}
