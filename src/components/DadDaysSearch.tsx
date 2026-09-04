"use client";

import { useState, useEffect } from "react";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import LimeButton from "@/components/LimeButton";
import { useProStatus } from "@/components/ProProvider";
import { useUserProfile } from "@/hooks/useUserProfile";
import { supabase } from "@/utils/supabaseClient";
import { trackEvent } from "@/lib/analytics";
import type { DadDaysBudget, DadDaysChildAge, DadDaysSearchResult } from "@/types/dadDays";

interface DadDaysSearchProps {
  userId: string | undefined;
  onResultsSaved?: () => void;
}

const RADIUS_OPTIONS = [5, 10, 20, 50] as const;
const SEARCHES_PER_MONTH = 3;
const QUICK_FILTERS = [
  ["60_minutes", "I have 60 minutes"],
  ["under_20", "I have £20"],
  ["raining", "It’s raining"],
  ["active", "Active"],
  ["creative", "Creative"],
  ["at_home", "At-home"],
] as const;

const DadDaysSearch = ({ userId, onResultsSaved }: DadDaysSearchProps) => {
  const { isPro, showPaywall } = useProStatus();
  const { data: userProfile } = useUserProfile(userId);

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [postcode, setPostcode] = useState("");
  const [postcodeInput, setPostcodeInput] = useState("");
  const [locationMethod, setLocationMethod] = useState<"gps" | "postcode" | null>(null);
  const [budget, setBudget] = useState<DadDaysBudget | null>(null);
  const [radius, setRadius] = useState<number>(20);
  const [childAgeOverride, setChildAgeOverride] = useState<DadDaysChildAge | null>(null);
  const [quickFilters, setQuickFilters] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DadDaysSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchesUsed, setSearchesUsed] = useState(0);
  const [savingResultId, setSavingResultId] = useState<string | null>(null);
  // Removed show/hide gating for search controls so the UI never disappears on search.


  // Load saved radius preference and fetch search count on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedRadius = localStorage.getItem("dadDaysRadius");
      if (savedRadius) {
        setRadius(Number(savedRadius));
      }
    }

    if (userId && !isPro) {
      fetchSearchCount();
    }
  }, [userId, isPro]);

  const fetchSearchCount = async () => {
    if (!userId) return;
    try {
      const startOfMonthDate = new Date();
      startOfMonthDate.setDate(1);
      startOfMonthDate.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from("dad_day_searches")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("searched_at", startOfMonthDate.toISOString());

      setSearchesUsed(count || 0);
    } catch (err) {
      console.error("Failed to fetch search count:", err);
    }
  };

  const requestGPS = async () => {
    setLoading(true);
    setError(null);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude);
          setLongitude(position.coords.longitude);
          setLocationMethod("gps");
          setPostcode("");
          setPostcodeInput("");
          setLoading(false);
        },
        () => {
          setLocationMethod("postcode");
          setLoading(false);
        }
      );
    } catch (err) {
      setError("Could not access location. Please enter a postcode instead.");
      setLocationMethod("postcode");
      setLoading(false);
    }
  };

  const convertPostcodeToCoords = async (pc: string) => {
    if (!pc.trim()) {
      setError("Please enter a postcode");
      return false;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const data = await res.json();

      if (!data.result) {
        setError("We couldn't find that postcode — please check and try again");
        setLoading(false);
        return false;
      }

      setLatitude(data.result.latitude);
      setLongitude(data.result.longitude);
      setPostcode(pc);
      setLocationMethod("postcode");
      setLoading(false);
      return true;
    } catch (err) {
      setError("We couldn't find that postcode — please check and try again");
      setLoading(false);
      return false;
    }
  };

  const determineChildAge = (): DadDaysChildAge => {
    if (childAgeOverride) return childAgeOverride;
    if (userProfile?.child_age) return userProfile.child_age;
    return "primary";
  };

  const handleSearch = async () => {
    if (!userId) {
      setError("Please sign in to search");
      return;
    }

    if (!latitude || !longitude) {
      setError("Please provide your location");
      return;
    }

    if (!budget) {
      setError("Please select a budget");
      return;
    }

    if (!isPro && searchesUsed >= SEARCHES_PER_MONTH) {
      showPaywall("unlimited Dad Days searches");
      return;
    }

    setSearching(true);
    setError(null);
    setResults([]);

    try {
      const finalChildAge = determineChildAge();

      const response = await fetch("/api/dad_days_searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude,
          longitude,
          postcode,
          budget,
          radius,
          childAge: finalChildAge,
          quickFilters,
          userId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "search_limit_reached") {
          trackEvent("dad_days_search_limit_reached", { searchesUsed: data.searchesUsed });
          showPaywall("unlimited Dad Days searches");
        } else if (data.error === "rate_limit_exceeded") {
          setError("You're searching too quickly. Please wait a moment and try again.");
        } else if (data.error === "invalid_request") {
          setError("Invalid search parameters. Please try again.");
        } else {
          setError("Something went wrong with the search — please try again in a moment");
        }
        setSearching(false);
        return;
      }

      if (data.results.length === 0) {
        setError(
          "No activities found nearby — try increasing your radius or changing your budget"
        );
        setResults([]);
      } else {
        setResults(data.results);
        setShowResults(true);
      // keep search controls visible (removed show/hide gating)

      }

      trackEvent("dad_days_search_completed", {
        budget,
        radius,
        childAge: finalChildAge,
        quickFilters,
        resultCount: data.results.length,
        isPro,
      });

      if (!isPro && data.searchesUsed !== undefined) {
        setSearchesUsed(data.searchesUsed);
      }
    } catch (err) {
      setError("Something went wrong with the search — please try again in a moment");
      console.error("Search error:", err);
    } finally {
      setSearching(false);
    }
  };

  const handleSaveToList = async (result: DadDaysSearchResult) => {
    if (!userId) {
      setError("Please sign in to save activities");
      return;
    }

    setSavingResultId(result.name);

    try {
      const { error: err } = await supabase.from("dad_dates").insert({
  user_id: userId,
  icon: "📍",
  name: result.name,
  age_range: result.ageRange,
  budget: result.estimatedCost,
  duration_minutes: 120,
  time_of_day: "Any time",
  source: "ai_search",
  booking_url: result.websiteUrl,
  address: result.address,
  requires_booking: result.requiresBooking,
});

      if (err) throw err;

      trackEvent("dad_days_result_saved", {
        activityName: result.name,
        budget,
      });

      if (onResultsSaved) {
        onResultsSaved();
      }
    } catch (err) {
      console.error("Failed to save activity:", err);
      setError("Failed to save activity. Please try again.");
    } finally {
      setSavingResultId(null);
    }
  };

  const handleRadiusChange = (newRadius: number) => {
    setRadius(newRadius);
    localStorage.setItem("dadDaysRadius", String(newRadius));
  };

  const hasLocation = latitude !== null && longitude !== null;
  const canSearch = hasLocation && budget && !searching;
  const searchesRemaining = SEARCHES_PER_MONTH - searchesUsed;
  const limitReached = !isPro && searchesUsed >= SEARCHES_PER_MONTH;

  return (
    <section className="py-8 border-b border-border w-full">
      <span className="section-label !p-0 mb-6 block">FIND DAD DAYS NEAR YOU</span>

      <div className="space-y-6 w-full">

        {/* Location Section */}
          <div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={requestGPS}
              disabled={loading}
              className="px-4 py-2.5 border border-border font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Getting location...
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4" />
                  Use my location
                </>
              )}
            </button>
            <span className="text-xs text-muted-foreground flex items-center">Or enter a postcode below</span>
          </div>

          {hasLocation && (
            <div>
              <label className="text-xs font-heading font-bold tracking-wide uppercase text-muted-foreground mb-2 block">Quick filters</label>
              <div className="flex gap-2 flex-wrap">
                {QUICK_FILTERS.map(([value, label]) => {
                  const selected = quickFilters.includes(value);
                  return <button key={value} onClick={() => { setQuickFilters((current) => selected ? current.filter((item) => item !== value) : [...current, value]); if (value === "under_20" && !selected) setBudget("under_20"); }} disabled={searching} className={`px-3 py-1.5 border rounded-full font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all disabled:opacity-50 ${selected ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>{label}</button>;
                })}
              </div>
            </div>
          )}

          {locationMethod === "postcode" && (
            <div className="flex gap-2">
              <input
                type="text"
                value={postcodeInput}
                onChange={(e) => setPostcodeInput(e.target.value)}
                placeholder="e.g. SW1A 1AA"
                className="px-3 py-2 border border-border text-sm font-heading flex-1 focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={searching}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    convertPostcodeToCoords(postcodeInput);
                  }
                }}
              />
              <button
                onClick={() => convertPostcodeToCoords(postcodeInput)}
                disabled={searching || !postcodeInput.trim()}
                className="px-4 py-2 border border-border font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go
              </button>
            </div>
          )}

          {hasLocation && (
            <div className="text-xs text-primary mt-2">
              ✓ Location set {locationMethod === "gps" ? "(GPS)" : `(${postcode})`}
            </div>
          )}
          </div>

        {/* Budget Filter */}
        {hasLocation && (
          <div>
            <label className="text-xs font-heading font-bold tracking-wide uppercase text-muted-foreground mb-2 block">
              Budget
            </label>
            <div className="flex gap-2 flex-wrap">
              {(["free", "under_20", "over_20"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBudget(b)}
                  disabled={searching}
                  className={`px-3 py-1.5 border font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all disabled:opacity-50 ${
                    budget === b
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {b === "free" ? "Free" : b === "under_20" ? "Under £20" : "Over £20"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Radius & Age */}
        {hasLocation && budget && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Radius */}
            <div>
              <label className="text-xs font-heading font-bold tracking-wide uppercase text-muted-foreground mb-2 block">
                Search Radius (default {radius}mi)
              </label>
              <div className="flex gap-2 flex-wrap">
                {RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRadiusChange(r)}
                    disabled={searching}
                    className={`px-3 py-1.5 border font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all disabled:opacity-50 ${
                      radius === r
                        ? "border-primary text-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {r}mi
                  </button>
                ))}
              </div>
            </div>

            {/* Child Age */}
            <div>
              <label className="text-xs font-heading font-bold tracking-wide uppercase text-muted-foreground mb-2 block">
                Child Age
              </label>
              <div className="flex gap-2 flex-wrap">
                {(["toddler", "primary", "teen"] as const).map((age) => {
                  const label =
                    age === "toddler" ? "Toddler (0–4)" : age === "primary" ? "Primary (5–11)" : "Teen (12+)";
                  const isActive = childAgeOverride === age || (!childAgeOverride && determineChildAge() === age);
                  return (
                    <button
                      key={age}
                      onClick={() => setChildAgeOverride(age)}
                      disabled={searching}
                      className={`px-3 py-1.5 border font-heading text-[11px] font-bold tracking-wide uppercase cursor-pointer transition-all disabled:opacity-50 ${
                        isActive
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex gap-2 items-start p-3 border border-border text-red-600 text-xs rounded">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Search Button or Upgrade Prompt */}
        {hasLocation && budget && (
          <div className="space-y-3">
            {limitReached ? (
              <div className="space-y-3 p-4 border border-border rounded-lg bg-primary/[0.06]">
                <p className="text-sm font-heading font-bold">You've used your 3 free Dad Days searches this month.</p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro for unlimited searches, plus everything else Dad Health has to offer.
                </p>
                <button
                  onClick={() => showPaywall("unlimited Dad Days searches")}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground font-heading font-bold text-sm uppercase cursor-pointer hover:brightness-110 transition-all"
                >
                  Unlock unlimited searches →
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  Resets on the 1st of next month
                </p>
              </div>
            ) : (
              <>
                <LimeButton
                  onClick={handleSearch}
                  disabled={!canSearch}
                  full
                  className={searching ? "opacity-75" : ""}
                >
                  {searching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    "Search for Dad Days →"
                  )}
                </LimeButton>

                {!isPro && (
                  <p className="text-xs text-muted-foreground text-center">
                    {searchesRemaining === 1 ? (
                      <span className="text-amber-600 font-medium">
                        {searchesRemaining} of {SEARCHES_PER_MONTH} free searches remaining
                      </span>
                    ) : (
                      <span>
                        {searchesRemaining} of {SEARCHES_PER_MONTH} free searches remaining
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Results */}
        {showResults && results.length > 0 && (
          <div className="space-y-4 pt-6 border-t border-border">
            <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-wide">
              Activities Found ({results.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.map((result, index) => (
                <div
                  key={result.name}
                  className={`${index === 0 ? "border-primary/60 bg-primary/[0.06]" : "border-border"} border p-4 rounded-lg hover:border-primary transition-all group`}
                >
                  {index === 0 ? <div className="text-[10px] font-heading font-bold uppercase tracking-wide text-primary mb-2">Featured family day</div> : null}
                  <h4 className="font-heading text-sm font-bold text-foreground mb-1 group-hover:text-primary transition-colors">
                    {result.name}
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{result.description}</p>

                  <div className="flex gap-2 mb-3 flex-wrap">
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">
                      {result.distanceMiles.toFixed(1)} miles
                    </span>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">
                      {result.estimatedCost}
                    </span>
                    <span className="text-[10px] bg-border text-muted-foreground px-2 py-1 rounded">
                      {result.ageRange}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3">{result.address}</p>

                  <div className="flex gap-2">
                    <a
                      href={result.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[11px] bg-primary text-primary-foreground font-bold uppercase rounded cursor-pointer hover:brightness-110 transition-all text-center"
                    >
                      Find out more
                    </a>
                    <button
                      onClick={() => handleSaveToList(result)}
                      disabled={savingResultId === result.name}
                      className="flex-1 px-3 py-2 text-[11px] border border-primary text-primary font-bold uppercase rounded cursor-pointer hover:bg-primary/10 transition-all disabled:opacity-50"
                    >
                      {savingResultId === result.name ? "Saving..." : "Save to list"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </section>

  );
};

export default DadDaysSearch;