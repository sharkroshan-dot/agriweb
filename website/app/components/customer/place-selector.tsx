"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, ChevronDown, Loader2 } from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";

export interface PlaceSelection {
  country: string;
  state: string;
  district: string;
  city: string;
}

interface PlaceSelectorProps {
  value: PlaceSelection;
  onChange: (value: PlaceSelection) => void;
  className?: string;
  includeAll?: boolean;
}

const ALL = "__all__";

export function PlaceSelector({ value, onChange, className, includeAll = false }: PlaceSelectorProps) {
  const { data: countriesData, isLoading: countriesLoading } = useQuery({
    queryKey: ["marketplace", "country-list"],
    queryFn: () => api.get("/marketplace/country-list"),
  });

  const countries = useMemo(() => {
    const raw = countriesData?.data?.countries || countriesData?.countries || [];
    return raw.map((c: any) => (typeof c === "string" ? c : c.name || c.country || ""));
  }, [countriesData]);

  const { data: statesData, isLoading: statesLoading } = useQuery({
    queryKey: ["marketplace", "state-list", value.country],
    queryFn: () =>
      api.get("/marketplace/state-list", {
        params: value.country ? { country: value.country } : undefined,
      }),
  });

  const states = useMemo(() => {
    const raw = statesData?.data?.states || statesData?.states || [];
    return raw.map((s: any) => (typeof s === "string" ? s : s.name || s.state || ""));
  }, [statesData]);

  const { data: districtsData, isLoading: districtsLoading } = useQuery({
    queryKey: ["marketplace", "district-list", value.country, value.state],
    queryFn: () =>
      api.get("/marketplace/district-list", {
        params: { country: value.country || undefined, state: value.state },
      }),
    enabled: !!value.state,
  });

  const districts = useMemo(() => {
    const raw = districtsData?.data?.districts || districtsData?.districts || [];
    return raw.map((d: any) => (typeof d === "string" ? d : d.name || d.district || ""));
  }, [districtsData]);

  const handleCountry = (country: string) => {
    if (country === ALL) {
      onChange({ country: "", state: "", district: "", city: "" });
      return;
    }
    onChange({ country, state: "", district: "", city: "" });
  };

  const handleState = (state: string) => {
    if (state === ALL) {
      onChange({ ...value, state: "", district: "", city: "" });
      return;
    }
    onChange({ ...value, state, district: "", city: "" });
  };

  const handleDistrict = (district: string) => {
    if (district === value.district) {
      onChange({ ...value, district: "", city: "" });
      return;
    }
    onChange({ ...value, district, city: "" });
  };

  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-4 py-1.5 text-sm font-medium transition",
      active
        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
    );

  const selectClass =
    "h-10 appearance-none rounded-xl border border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

  const iconClass = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400";
  const chevronClass = "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative max-w-md">
        {countriesLoading ? (
          <Loader2 className={cn(iconClass, "animate-spin")} />
        ) : (
          <MapPin className={iconClass} />
        )}
        <select value={value.country || ALL} onChange={(e) => handleCountry(e.target.value)} className={cn(selectClass, "w-full")}>
          {includeAll && <option value={ALL}>All Countries</option>}
          {!includeAll && <option value={ALL}>{value.country ? "Select country" : "Select country to get started"}</option>}
          {countries.map((c: string) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ChevronDown className={chevronClass} />
      </div>

      {value.country && (
        <div className="relative max-w-md">
          {statesLoading ? (
            <Loader2 className={cn(iconClass, "animate-spin")} />
          ) : (
            <MapPin className={iconClass} />
          )}
          <select value={value.state || ALL} onChange={(e) => handleState(e.target.value)} className={cn(selectClass, "w-full")}>
            {includeAll && <option value={ALL}>All States</option>}
            {!includeAll && <option value={ALL}>{value.state ? "Select state" : "Select state to get started"}</option>}
            {states.map((s: string) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ChevronDown className={chevronClass} />
        </div>
      )}

      {value.country && value.state && (
        <div>
          {districtsLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading districts...
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onChange({ ...value, district: "", city: "" })}
                className={chipClass(!value.district)}
              >
                All Districts
              </button>
              {districts.map((d: string) => (
                <button
                  key={d}
                  onClick={() => handleDistrict(d)}
                  className={chipClass(value.district === d)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
