"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sprout, Loader2, CloudSun, Thermometer, Droplets, TreePine, RefreshCcw, MapPin, LocateFixed } from "lucide-react";
import { api } from "../../../lib/api/client";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

const SOIL_TYPES = ["loamy", "clay", "sandy", "black"];
const SEASONS = ["kharif", "rabi", "summer"];


export default function FarmerCropAdvisorPage() {
  const [form, setForm] = useState({
    soilType: "loamy",
    location: "",
    temperature: "",
    rainfall: "",
    previousCrop: "none",
    season: "kharif",
    areaAcres: "1",
    waterAvailability: "reliable",
    irrigationType: "drip",
  });
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationSource, setLocationSource] = useState<"live" | "manual" | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);

  const { data: harvestPlansData } = useQuery({
    queryKey: ["farmerCropAdvisorHarvests"],
    queryFn: () => api.get("/harvests/farmer/plans"),
    retry: 1,
  });

  const previousCrops = Array.from(
    new Set(
      ((harvestPlansData?.plans || []) as any[])
        .filter((plan) => plan?.status === "harvested" && String(plan?.cropName || "").trim())
        .map((plan) => String(plan.cropName).trim())
    )
  ).sort((a, b) => a.localeCompare(b));

  const weatherQuery = useQuery({
    queryKey: ["farmerCropAdvisorWeather", form.location.trim(), coordinates?.lat, coordinates?.lng],
    queryFn: () =>
      api.post("/ai/weather-impact", {
        location: coordinates
          ? { latitude: coordinates.lat, longitude: coordinates.lng }
          : { city: form.location.trim(), state: "Tamil Nadu", country: "India" },
        productId: null,
        days: 7,
      }),
    enabled: form.location.trim().length > 0 || Boolean(coordinates),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const useLiveLocation = () => {
    setLocationLoading(true);
    setLocationError(null);
    setLocationSource("live");

    const reverseGeocode = async (lat: number, lng: number) => {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!response.ok) throw new Error("Reverse geocoding failed");

      const result = await response.json();
      const address = result?.address || {};
      const locality =
        address.village ||
        address.town ||
        address.city ||
        address.hamlet ||
        address.suburb ||
        address.city_district ||
        address.municipality ||
        "";
      const district = address.state_district || address.district || "";
      const state = address.state || "";
      const country = address.country || "";

      return [locality, district, state, country]
        .filter(Boolean)
        .filter((part, index, parts) => parts.indexOf(part) === index)
        .join(", ");
    };

    const applyLocation = async (lat: number, lng: number, approximate = false, accuracy: number | null = null) => {
      setCoordinates({ lat, lng });
      setLocationAccuracy(accuracy);

      try {
        const displayLocation = await reverseGeocode(lat, lng);
        setForm((current) => ({
          ...current,
          location: displayLocation || `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        }));
        setLocationError(
          approximate
            ? "Approximate location is being used because precise browser location is unavailable."
            : null
        );
      } catch {
        setForm((current) => ({
          ...current,
          location: `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        }));
        setLocationError(
          approximate
            ? "Approximate location is being used because precise browser location is unavailable."
            : null
        );
      } finally {
        setLocationLoading(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void applyLocation(
            position.coords.latitude,
            position.coords.longitude,
            false,
            position.coords.accuracy
          );
        },
        async () => {
          try {
            const response = await fetch("https://ipapi.co/json/");
            if (!response.ok) throw new Error("Network location unavailable");

            const result = await response.json();
            const lat = Number(result?.latitude);
            const lng = Number(result?.longitude);

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              throw new Error("Invalid network location");
            }

            await applyLocation(lat, lng, true, null);
          } catch {
            setLocationLoading(false);
            setLocationError(
              "Current location is unavailable. Allow browser location access or enter your village/town/city manually."
            );
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000,
        }
      );
      return;
    }

    void (async () => {
      try {
        const response = await fetch("https://ipapi.co/json/");
        if (!response.ok) throw new Error("Network location unavailable");

        const result = await response.json();
        const lat = Number(result?.latitude);
        const lng = Number(result?.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error("Invalid network location");
        }

        await applyLocation(lat, lng, true, null);
      } catch {
        setLocationLoading(false);
        setLocationError(
          "Current location is unavailable. Enter your village/town/city manually."
        );
      }
    })();
  };

  useEffect(() => {
    const temperature = weatherQuery.data?.weather?.temperature;
    if (typeof temperature !== "number" || !Number.isFinite(temperature)) return;
    setForm((current) => {
      const next = String(Math.round(temperature * 10) / 10);
      return current.temperature === next ? current : { ...current, temperature: next };
    });
  }, [weatherQuery.data]);

  const advisorMutation = useMutation({
    mutationFn: () =>
      api.post("/ai/crop-recommendation", {
        soilType: form.soilType,
        location: form.location || "Farm",
        temperature: Number(form.temperature || weatherQuery.data?.weather?.temperature),
        rainfall: form.rainfall.trim() ? Number(form.rainfall) : null,
        previousCrop: form.previousCrop && form.previousCrop !== "none" ? form.previousCrop : null,
        season: form.season,
        areaAcres: Number(form.areaAcres),
        humidity: weatherQuery.data?.weather?.humidity ?? null,
        weatherForecast: weatherQuery.data?.forecast || [],
        waterAvailability: form.waterAvailability,
        irrigationType: form.irrigationType,
      }),
    onError: (err: any) => toast.error(err?.message || "Failed to get crop recommendations"),
  });

  const run = () => advisorMutation.mutate();
  const data = advisorMutation.data as any;

  const suitColor = (s: string) =>
    s === "high"
      ? "bg-emerald-100 text-emerald-700"
      : s === "moderate"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & decision support"
        title="Crop Advisor"
        description="Get crop suggestions based on your soil, local climate, season and field size."
      >
        <Button
          type="button"
          variant="outline"
          className="h-10 border-slate-200 bg-white"
          onClick={() => advisorMutation.reset()}
          disabled={!advisorMutation.data && !advisorMutation.isError}
        >
          <RefreshCcw className="mr-2 h-4 w-4" /> Reset results
        </Button>
      </FarmerPageHeader>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <TreePine className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-base text-slate-950">Your farm conditions</CardTitle>
                <CardDescription className="mt-1">Add accurate field details for more relevant recommendations.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">What type of soil is in your field?</label>
                <Select value={form.soilType} onValueChange={(v) => setForm({ ...form, soilType: v })}>
                  <SelectContent>
                    {SOIL_TYPES.map((s) => <SelectItem key={s} value={s}>{({ loamy: "Loamy soil", clay: "Clay soil", sandy: "Sandy soil", black: "Black soil" } as Record<string, string>)[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><RefreshCcw className="h-3.5 w-3.5" /> Which season will you plant?</label>
                <Select value={form.season} onValueChange={(v) => setForm({ ...form, season: v })}>
                  <SelectContent>
                    {SEASONS.map((s) => <SelectItem key={s} value={s}>{({ kharif: "Rainy season (Kharif)", rabi: "Cool season (Rabi)", summer: "Hot season (Summer)" } as Record<string, string>)[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><MapPin className="h-3.5 w-3.5" /> Farm location</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="min-w-0 bg-white"
                    value={form.location}
                    onChange={(e) => {
                      setLocationSource("manual");
                      setCoordinates(null);
                      setLocationAccuracy(null);
                      setForm({ ...form, location: e.target.value });
                    }}
                    placeholder="Enter village, town or city"
                  />
                  <Button type="button" variant="outline" className="shrink-0" onClick={useLiveLocation} disabled={locationLoading}>
                    {locationLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
                    Use my location
                  </Button>
                </div>
                <p className="text-xs text-slate-600">
                  Enter your village or town name, then wait for local weather to load. Or use the GPS button.
                </p>
                <p className="text-[11px] text-slate-500">
                  {locationSource === "live"
                    ? locationAccuracy != null
                      ? `Phone location found · accuracy about ${Math.round(locationAccuracy)} metres`
                      : "Finding your location..."
                    : weatherQuery.isFetching ? "Getting weather for this place..." : weatherQuery.data ? "Local weather updated." : "Weather appears here after you enter a place."}
                </p>
                {locationError && <p role="status" className="text-xs text-rose-600">{locationError}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Thermometer className="h-3.5 w-3.5" /> Today's temperature (°C)</label>
                <div className="relative">
                  <Input type="number" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} className="bg-white pr-9" />
                  {weatherQuery.isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-600" />}
                </div>
                <p className="text-[11px] text-slate-500">{weatherQuery.data?.weather?.temperature != null ? "Live temperature from local weather." : "Enter your village/town first, or type the temperature from a local weather report."}</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Previous crop</label>
                <Select value={form.previousCrop} onValueChange={(v) => setForm({ ...form, previousCrop: v })}>
                  <SelectContent>
                    <SelectItem value="none">None / no previous crop</SelectItem>
                    {previousCrops.map((crop) => <SelectItem key={crop} value={crop}>{crop}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500">Harvested crops from your farm are listed here.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Expected seasonal rain (mm) – optional</label>
                <Input type="number" min="0" value={form.rainfall} onChange={(e) => setForm({ ...form, rainfall: e.target.value })} className="bg-white" />
                <p className="text-[11px] text-slate-500">If you don't know, leave this empty. Weather forecast rain is checked separately.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">How much water is available?</label>
                <Select value={form.waterAvailability} onValueChange={(v) => setForm({ ...form, waterAvailability: v })}>
                  <SelectContent>
                    <SelectItem value="reliable">Enough water throughout the crop</SelectItem>
                    <SelectItem value="limited">Only a little water</SelectItem>
                    <SelectItem value="rainfed">Rain only (no irrigation)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">How do you water the field?</label>
                <Select value={form.irrigationType} onValueChange={(v) => setForm({ ...form, irrigationType: v })}>
                  <SelectContent>
                    <SelectItem value="drip">Pipes that drip water near plants</SelectItem>
                    <SelectItem value="sprinkler">Sprinklers (water sprays)</SelectItem>
                    <SelectItem value="flood">Water flows through field channels</SelectItem>
                    <SelectItem value="rainfed">Only rain</SelectItem>
                    <SelectItem value="other">Other / I am not sure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">How many acres will you plant?</label>
                <Input type="number" min="0.1" step="0.1" value={form.areaAcres} onChange={(e) => setForm({ ...form, areaAcres: e.target.value })} className="bg-white" />
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">Check your inputs before generating crop suggestions.</p>
              <Button className="h-11 w-full bg-emerald-700 px-6 hover:bg-emerald-800 sm:w-auto" onClick={run} disabled={advisorMutation.isPending || weatherQuery.isFetching || !form.location.trim() || (!form.temperature && weatherQuery.data?.weather?.temperature == null) || Number(form.areaAcres) <= 0 || (form.temperature !== "" && Number(form.temperature) < -20) || (form.rainfall !== "" && Number(form.rainfall) < 0)}>
                {advisorMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
                {advisorMutation.isPending ? "Analysing farm..." : weatherQuery.isFetching ? "Loading weather..." : "Get crop recommendations"}
              </Button>
            </div>
            {advisorMutation.isError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">We couldn't generate recommendations. Please check your details and try again.</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm"><CloudSun className="h-4 w-4 text-sky-600" /> Weather near your farm</CardTitle>
              <CardDescription>Live weather helps us suggest crops for your area.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">Temperature today</p>
                  <p className="mt-1 text-base font-bold text-slate-900">{weatherQuery.data?.weather?.temperature != null ? `${weatherQuery.data.weather.temperature}°C` : form.temperature ? `${form.temperature}°C (entered)` : "Waiting for location"}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">Air moisture (humidity)</p>
                  <p className="mt-1 text-base font-bold text-slate-900">{weatherQuery.data?.weather?.humidity != null ? `${weatherQuery.data.weather.humidity}%` : "Waiting for weather"}</p>
                </div>
              </div>
              {weatherQuery.isFetching && <p className="flex items-center gap-2 text-xs text-sky-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting your local weather...</p>}
              {weatherQuery.data?.forecast?.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Weather for the next 7 days</p>
                  <div className="space-y-1.5">
                    {weatherQuery.data.forecast.slice(0, 7).map((day: any, index: number) => (
                      <div key={day.date || index} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-700">{day.date ? new Date(day.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : `Day ${index + 1}`}</span>
                        <span className="text-slate-600">{day.minTemp != null ? `${day.minTemp}°–` : ""}{day.temp ?? day.temperature ?? "—"}°C</span>
                        <span className="text-sky-700">{day.rainChance != null ? `${day.rainChance}% rain chance` : day.rainfall != null ? `${day.rainfall} mm rain` : "Rain: —"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  {weatherQuery.isError ? "Weather could not be loaded. Check the village/town name or try GPS location." : form.location.trim() ? "Waiting for weather details..." : "Enter your village/town or tap Use my location to see today's weather and the 7-day forecast."}
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3">
                <span className="text-xs text-slate-600">Seasonal rain estimate</span>
                <span className="text-sm font-semibold text-slate-900">{form.rainfall ? `${form.rainfall} mm` : "Not entered"}</span>
              </div>
              <div className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{form.location.trim() || "Add your farm location to retrieve local weather."}</span>
              </div>
              {weatherQuery.isError && <p className="text-xs text-amber-700">Live weather is unavailable. You can still enter conditions manually.</p>}
              {weatherQuery.data?.weather?.temperature != null && <Badge variant="success">Weather data received</Badge>}
            </CardContent>
          </Card>
          <Card className="border-emerald-100 bg-emerald-50/50 shadow-none">
            <CardContent className="p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><Sprout className="h-4 w-4" /> Better recommendations</p>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-emerald-900/80">
                <li>• Select the correct soil type for your field.</li>
                <li>• Use your current location for local weather context.</li>
                <li>• Choose the previous crop to support crop-rotation guidance.</li>
                <li>• Enter the actual area you plan to cultivate.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {advisorMutation.data ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-emerald-700">Your farm results</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Crops that may grow well on your farm</h2>
              <p className="mt-2 text-base leading-7 text-slate-600">{data?.seasonInfo || "These suggestions use the farm details and weather information you provided."}</p>
            </div>
            <Badge variant="outline" className="w-fit border-emerald-200 bg-white text-emerald-800">AI-assisted advisory</Badge>
          </div>
          {data?.weatherSummary && (
            <Card className="border-sky-200 bg-sky-50/40 shadow-none">
              <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
                <div><p className="text-[11px] font-medium text-slate-500">Current temperature</p><p className="mt-1 text-sm font-semibold text-slate-900">{data.weatherSummary.currentTemperature ?? "—"}°C</p></div>
                <div><p className="text-[11px] font-medium text-slate-500">Forecast average high</p><p className="mt-1 text-sm font-semibold text-slate-900">{data.weatherSummary.averageForecastMax != null ? `${data.weatherSummary.averageForecastMax}°C` : "Unavailable"}</p></div>
                <div><p className="text-[11px] font-medium text-slate-500">Forecast rainfall total</p><p className="mt-1 text-sm font-semibold text-slate-900">{data.weatherSummary.forecastRainfallTotal != null ? `${data.weatherSummary.forecastRainfallTotal} mm` : "Unavailable"}</p></div>
                <div><p className="text-[11px] font-medium text-slate-500">Forecast source</p><p className="mt-1 text-sm font-semibold text-slate-900">{data.weatherSummary.source || "Weather data"}</p></div>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-emerald-200 shadow-sm">
              <CardContent className="flex items-start gap-3 p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Sprout className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Best matching crop</p>
                  <p className="mt-1 text-3xl font-bold text-emerald-800">{data?.topCrop || "Review recommendations"}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex items-start gap-3 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><CloudSun className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">About your soil</p>
                  <p className="mt-2 text-base leading-7 text-slate-700">{data?.soilHealth || "No soil information returned."}</p>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-5">
            {(data?.recommendations || []).map((rec: any, i: number) => (
              <Card key={rec.crop || i} className="overflow-hidden border-slate-200 shadow-sm">
                <CardContent className="p-5 sm:p-7">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Sprout className="h-6 w-6" /></span>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended crop {i + 1}</p>
                          <h3 className="mt-0.5 text-2xl font-bold text-slate-950 sm:text-3xl">{rec.crop}</h3>
                        </div>
                        <Badge className={cn("border-0 px-3 py-1 text-sm capitalize", suitColor(rec.suitability))}>
                          {rec.suitability === "high" ? "Good match" : rec.suitability === "moderate" ? "May be suitable" : "Low match"}
                        </Badge>
                      </div>
                      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-sm font-medium text-slate-600">Growing time</p>
                          <p className="mt-1 text-lg font-bold text-slate-900">{rec.duration || "Not available"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-sm font-medium text-slate-600">Suitable soil</p>
                          <p className="mt-1 text-lg font-bold capitalize text-slate-900">{rec.soil || "Not available"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4">
                          <p className="text-sm font-medium text-slate-600">Suitable season</p>
                          <p className="mt-1 text-lg font-bold capitalize text-slate-900">{rec.season || "Not available"}</p>
                        </div>
                        <div className="rounded-xl bg-sky-50 p-4 sm:col-span-2 xl:col-span-1">
                          <p className="text-sm font-medium text-slate-600">Water needed</p>
                          <p className="mt-1 text-lg font-bold capitalize text-slate-900">{rec.waterNeed === "high" ? "A lot of water" : rec.waterNeed === "medium" ? "Medium amount" : rec.waterNeed === "low" ? "Less water" : "Not available"}</p>
                        </div>
                      </div>
                      {rec.reasons?.length > 0 && (
                        <div className="mt-6">
                          <h4 className="text-lg font-bold text-slate-900">Why we suggest this crop</h4>
                          <ul className="mt-3 space-y-2">
                            {rec.reasons.map((reason: string, reasonIndex: number) => (
                              <li key={reasonIndex} className="flex items-start gap-3 text-base leading-7 text-slate-700">
                                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {rec.risks?.length > 0 && (
                        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
                          <h4 className="text-base font-bold text-amber-950 sm:text-lg">Things to check before planting</h4>
                          <ul className="mt-2 space-y-2">
                            {rec.risks.map((risk: string, riskIndex: number) => (
                              <li key={riskIndex} className="flex items-start gap-3 text-sm leading-6 text-amber-900 sm:text-base sm:leading-7">
                                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-amber-600" />
                                <span>{risk}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {rec.plantingGuidance && (
                        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                          <p className="text-sm font-bold text-emerald-900">Before you start</p>
                          <p className="mt-1 text-base leading-7 text-emerald-900">{rec.plantingGuidance}</p>
                        </div>
                      )}
                    </div>
                    <div className="w-full rounded-xl border border-slate-200 bg-white p-5 lg:w-52 lg:shrink-0">
                      <p className="text-sm font-semibold text-slate-600">Suitability score</p>
                      <p className="mt-1 text-4xl font-bold tabular-nums text-slate-950">{Number.isFinite(Number(rec.score)) ? `${rec.score}` : "—"}<span className="text-lg font-semibold text-slate-500"> / 100</span></p>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                        <div className={cn("h-full rounded-full", Number(rec.score) >= 70 ? "bg-emerald-500" : Number(rec.score) >= 50 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.max(0, Math.min(100, Number(rec.score) || 0))}%` }} />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{rec.suitability === "high" ? "This crop matches many of the details you entered." : rec.suitability === "moderate" ? "Check the growing conditions and warnings before choosing." : "This crop may not suit your current field conditions."}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!data?.recommendations || data.recommendations.length === 0) && (
              <Card className="border-dashed border-slate-300 shadow-none"><CardContent className="py-12 text-center text-base text-slate-600">No crop suggestions were found. Check your answers or ask your local agriculture officer for help.</CardContent></Card>
            )}
          </div>
          <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">These are guidance suggestions, not a promise of harvest or income. Before planting, check local growing advice, seed availability and your field conditions.</p>
        </section>
      ) : !advisorMutation.isPending ? (
        <Card className="border-dashed border-slate-300 bg-white shadow-none">
          <CardContent className="flex flex-col items-center px-5 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Sprout className="h-7 w-7" /></span>
            <h2 className="mt-3 text-base font-semibold text-slate-900">Your crop recommendations will appear here</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Complete your farm conditions and select Get crop recommendations to see suitable crops, suitability scores and growing details.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 shadow-none"><CardContent className="flex items-center justify-center gap-3 py-10 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /> Analysing your farm conditions...</CardContent></Card>
      )}
    </div>
  );
}
