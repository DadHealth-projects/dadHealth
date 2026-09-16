"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PenLine, BarChart2, Stethoscope, LifeBuoy } from "lucide-react";
import SitePageShell from "@/components/SitePageShell";
import SiteFooter from "@/components/SiteFooter";
import LimeButton from "@/components/LimeButton";
import PromptModal from "@/components/PromptModal";
import { ProGate } from "@/components/ProProvider";
import { useAuth } from "@/contexts/AuthContext";
import { useMind } from "@/hooks/useMind";
import { trackEvent } from "@/lib/analytics";
import { getCurrentWeekDayKeys } from "@/lib/dashboard.utils";

const BREATH_AUDIO_VERSION = "2026-04-23-2";

const MindPage = () => {
  const router = useRouter();
  const { user, openAuthModal } = useAuth();
  const { moodLogs, therapists, journalPrompts, saveJournal } = useMind(user?.id);

  const [journalText, setJournalText] = useState("");
  const [journalSavePrompt, setJournalSavePrompt] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [breathPhase, setBreathPhase] = useState<"inhale" | "hold" | "exhale">("inhale");
  const [breathCount, setBreathCount] = useState(4);
  const [breathActive, setBreathActive] = useState(false);
  const [breathMuted, setBreathMuted] = useState(false);

  const last7 = getCurrentWeekDayKeys();
  const moodMap = new Map(moodLogs.map((m: { date: string; mood_value: number }) => [m.date, m.mood_value]));
  const moodWeekData = last7.map((d) => moodMap.get(d) ?? 0);
  const displayMood = user ? moodWeekData : [0, 0, 0, 0, 0, 0, 0];
  const avgMoodValue = displayMood.filter((v) => v > 0).length > 0
    ? displayMood.reduce((a, b) => a + b, 0) / displayMood.filter((v) => v > 0).length
    : 0;
  const avgMoodLabel = avgMoodValue >= 3.5 ? "Great" : avgMoodValue >= 3 ? "Good" : avgMoodValue >= 2 ? "Okay" : avgMoodValue > 0 ? "Low" : "—";

  const breathRef = useRef({ count: 4, phaseIdx: 0 });
  const breathMutedRef = useRef(false);
  const breathAudioRef = useRef<{
    inhale: HTMLAudioElement | null;
    hold: HTMLAudioElement | null;
    exhale: HTMLAudioElement | null;
  }>({
    inhale: null,
    hold: null,
    exhale: null,
  });
  const breathStopTimeoutRef = useRef<{
    inhale: ReturnType<typeof setTimeout> | null;
    hold: ReturnType<typeof setTimeout> | null;
    exhale: ReturnType<typeof setTimeout> | null;
  }>({
    inhale: null,
    hold: null,
    exhale: null,
  });

  const stopAllBreathAudio = () => {
    const { inhale, hold, exhale } = breathAudioRef.current;
    [inhale, hold, exhale].forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    });
    const { inhale: inhaleTimer, hold: holdTimer, exhale: exhaleTimer } = breathStopTimeoutRef.current;
    [inhaleTimer, holdTimer, exhaleTimer].forEach((timer) => {
      if (timer) clearTimeout(timer);
    });
    breathStopTimeoutRef.current = { inhale: null, hold: null, exhale: null };
  };

  const playBreathPhaseAudio = (phase: "inhale" | "hold" | "exhale") => {
    if (breathMutedRef.current) return;
    const nextAudio = breathAudioRef.current[phase];
    if (!nextAudio) return;
    const phaseStartOffsetSeconds: Record<"inhale" | "hold" | "exhale", number> = {
      inhale: 1,
      hold: 0,
      exhale: 0,
    };
    const phaseMaxPlaybackMs: Record<"inhale" | "hold" | "exhale", number> = {
      inhale: 5000,
      hold: 4000,
      exhale: 4000,
    };

    const activeTimer = breathStopTimeoutRef.current[phase];
    if (activeTimer) clearTimeout(activeTimer);

    // Keep a single phase cue audible at a time.
    stopAllBreathAudio();
    nextAudio.currentTime = Math.min(phaseStartOffsetSeconds[phase], Math.max(0, nextAudio.duration || 0));
    void nextAudio.play().catch(() => {
      // Silently ignore autoplay/playback failures.
    });

    // Hard-stop phase cues to avoid long custom audio overlaps.
    breathStopTimeoutRef.current[phase] = setTimeout(() => {
      nextAudio.pause();
      nextAudio.currentTime = 0;
      breathStopTimeoutRef.current[phase] = null;
    }, phaseMaxPlaybackMs[phase]);
  };

  useEffect(() => {
    breathMutedRef.current = breathMuted;
    const { inhale, hold, exhale } = breathAudioRef.current;
    [inhale, hold, exhale].forEach((audio) => {
      if (audio) audio.muted = breathMuted;
    });
  }, [breathMuted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const inhaleAudio = new Audio(`/sounds/inhale.mp3?v=${BREATH_AUDIO_VERSION}`);
    const holdAudio = new Audio(`/sounds/hold.mp3?v=${BREATH_AUDIO_VERSION}`);
    const exhaleAudio = new Audio(`/sounds/exhale.mp3?v=${BREATH_AUDIO_VERSION}`);

    inhaleAudio.preload = "auto";
    holdAudio.preload = "auto";
    exhaleAudio.preload = "auto";
    inhaleAudio.load();
    holdAudio.load();
    exhaleAudio.load();

    inhaleAudio.volume = 0.35;
    holdAudio.volume = 0.35;
    exhaleAudio.volume = 0.35;

    breathAudioRef.current = {
      inhale: inhaleAudio,
      hold: holdAudio,
      exhale: exhaleAudio,
    };

    return () => {
      stopAllBreathAudio();
      breathAudioRef.current = { inhale: null, hold: null, exhale: null };
    };
  }, []);

  useEffect(() => {
    if (!breathActive) return;
    const phases: Array<"inhale" | "hold" | "exhale"> = ["inhale", "hold", "exhale"];
    breathRef.current = { count: 4, phaseIdx: 0 };
    setBreathPhase(phases[0]);
    setBreathCount(4);
    playBreathPhaseAudio("inhale");
    const id = setInterval(() => {
      const { count, phaseIdx } = breathRef.current;
      const nextCount = count - 1;
      if (nextCount < 1) {
        const nextPhaseIdx = (phaseIdx + 1) % 3;
        const nextPhase = phases[nextPhaseIdx];
        breathRef.current = { count: 4, phaseIdx: nextPhaseIdx };
        setBreathPhase(nextPhase);
        setBreathCount(4);
        playBreathPhaseAudio(nextPhase);
      } else {
        breathRef.current = { count: nextCount, phaseIdx };
        setBreathCount(nextCount);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [breathActive]);

  useEffect(() => {
    if (breathActive) return;
    stopAllBreathAudio();
  }, [breathActive]);

  const therapistsList = therapists;

  const handleBreathToggle = async () => {
    if (!breathActive) {
      trackEvent("breath_session_started", {
        pattern: "4-4-4",
      });

      // Unlock all phase clips from this user gesture (improves mobile/browser reliability).
      const { inhale, hold, exhale } = breathAudioRef.current;
      for (const audio of [inhale, hold, exhale]) {
        if (!audio) continue;
        const originalMuted = audio.muted;
        audio.muted = true;
        try {
          await audio.play();
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // Ignore unlock failures; regular phase playback will retry.
        }
        audio.muted = breathMutedRef.current || originalMuted;
      }
    }

    setBreathActive((active) => !active);
  };

  return (
    <SitePageShell>
      {/* Hero */}
      <section className="bg-background w-full">
        <div className="max-w-[1400px] mx-auto px-5 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div>
            <span className="section-label mb-2 block">MENTAL HEALTH</span>
            <h1 className="font-heading text-[42px] lg:text-[56px] font-extrabold text-foreground uppercase leading-none tracking-wide mb-6">
              MENTAL HEALTH
            </h1>
            <p className="text-sm text-muted-foreground leading-[1.75] mb-4">
              Listen chaps, mental health is just as important for men as it is for women. Opening
              up about feelings and seeking help is not a sign of weakness, but of strength.
            </p>
            <p className="text-sm text-muted-foreground leading-[1.75] mb-8">
              It's okay to not be okay; reaching out for help is a vital step in maintaining mental
              wellness. Inhale 4 · Hold 4 · Exhale 4. Reduces cortisol.
            </p>
            <a
              href="https://www.samaritans.org"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full lg:w-auto bg-destructive/10 text-primary border border-destructive/30 px-4 py-3 font-heading font-bold text-xs tracking-wider uppercase cursor-pointer flex items-center justify-between hover:bg-destructive/20 transition-colors"
            >
              <span className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} aria-hidden="true" />
                CRISIS SUPPORT — SAMARITANS · CALM · MIND
              </span>
            </a>
          </div>

          {/* Breathing circle - client only */}
          <div className="flex flex-col items-center">
            <div className="w-[200px] h-[200px] border-4 border-primary rounded-full flex flex-col items-center justify-center">
              <span className="font-heading text-lg font-extrabold text-primary uppercase tracking-wide">{breathPhase.toUpperCase()}</span>
              <span className="font-heading text-[56px] font-extrabold text-primary leading-none">{breathCount}</span>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Inhale 4 · Hold 4 · Exhale 4.<br />Reduces cortisol.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleBreathToggle}
                className="bg-background text-foreground border-2 border-foreground px-8 py-3 font-heading font-extrabold text-sm tracking-wider uppercase cursor-pointer hover:border-primary hover:text-primary transition-colors"
              >
                {breathActive ? "STOP" : "BEGIN"}
              </button>
              <button
                type="button"
                onClick={() => setBreathMuted((muted) => !muted)}
                className="bg-background text-foreground border border-foreground px-4 py-3 font-heading font-bold text-xs tracking-wider uppercase cursor-pointer hover:border-primary hover:text-primary transition-colors"
                aria-pressed={breathMuted}
                aria-label={breathMuted ? "Unmute breathing audio" : "Mute breathing audio"}
              >
                {breathMuted ? "UNMUTE" : "MUTE"}
              </button>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="bg-card border-t border-border">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
          {/* Journal */}
          <div className="bg-card p-6">
            <PenLine className="h-8 w-8 mb-3 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <h3 className="font-heading text-lg font-extrabold text-foreground uppercase tracking-wide mb-2">
              EVENING JOURNAL
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              Pick a starter below or write freely — this is just for you.
            </p>
            <ul className="flex flex-wrap gap-1.5 mb-3" aria-label="Journal prompts">
              {journalPrompts.map((line) => (
                <li key={line}>
                  <button
                    type="button"
                    onClick={() => setJournalText((prev) => (prev ? `${prev}\n\n${line} ` : `${line} `))}
                    className="text-left text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-1.5 rounded-sm border border-border/80 bg-white/[0.03] text-primary/90 hover:border-primary hover:bg-primary/10 transition-colors max-w-full"
                  >
                    {line}
                  </button>
                </li>
              ))}
            </ul>
            {journalPrompts.length === 0 && (
              <p className="text-[11px] text-muted-foreground mb-3">No prompt suggestions available yet.</p>
            )}
            <textarea
              placeholder="Write freely..."
              value={journalText}
              onChange={(e) => setJournalText(e.target.value)}
              className="w-full bg-white/[0.04] border border-border p-3 text-foreground text-sm resize-none h-[100px] outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
            />
            <LimeButton
              small
              className="mt-3"
              onClick={() => {
                if (!journalText.trim()) return;
                if (!user) {
                  openAuthModal();
                  return;
                }
                saveJournal.mutate(journalText, {
                  onSuccess: () => {
                    setJournalText("");
                    setJournalSavePrompt({
                      title: "JOURNAL SAVED",
                      message: "Your journal entry has been saved to your account.",
                    });
                  },
                  onError: (error) => {
                    setJournalSavePrompt({
                      title: "SAVE FAILED",
                      message:
                        error instanceof Error
                          ? error.message
                          : "We could not save your journal entry. Please try again.",
                    });
                  },
                });
              }}
              disabled={!journalText.trim() || saveJournal.isPending}
            >
              {saveJournal.isPending ? "..." : "SAVE ENTRY"} →
            </LimeButton>
          </div>

          {/* Mood Trend - Pro gated */}
          <ProGate featureName="Mood trend graphs" lockMessage="Your mood today is one data point. Your mood over 30 days is a pattern. Patterns change lives.">
            <div className="bg-card p-6">
              <BarChart2 className="h-8 w-8 mb-3 text-primary" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="font-heading text-lg font-extrabold text-foreground uppercase tracking-wide mb-2">
                MOOD TREND
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                Your 7-day mood pattern — tracked daily and correlated with sleep data to spot what's affecting you.
              </p>
              <div className="flex items-end gap-1.5 h-[80px] mb-2">
                {displayMood.map((v: number, i: number) => {
                  const h = v > 0 ? Math.round((v / 4) * 68) + 8 : 8;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`w-full transition-all ${v >= 3 ? "bg-primary" : v > 0 ? "bg-muted" : "bg-muted/50"}`}
                        style={{ height: `${h}px` }}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Avg: <span className="text-primary font-semibold">{avgMoodLabel}</span>
                {user && avgMoodValue > 0 ? ` (${avgMoodValue.toFixed(1)}/4)` : ""}
              </p>
            </div>
          </ProGate>

          {/* Find a Therapist/Counsellor - Pro gated */}
          <ProGate featureName="Therapist and counsellor booking" lockMessage="The gap between 'I should talk to someone' and actually doing it is where most men get stuck. We close that gap.">
            <div className="bg-card p-6">
              <Stethoscope className="h-8 w-8 mb-3 text-primary" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="font-heading text-lg font-extrabold text-foreground uppercase tracking-wide mb-2">
                FIND A THERAPIST OR COUNSELLOR
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                Filtered for dad-friendly sessions, evening & weekend slots. Verified by the Dad Health community.
              </p>
              {therapistsList.length > 0 ? therapistsList.map((t: { name: string; spec?: string; slots?: string; price?: string }) => (
                <div key={t.name} className="therapist-card mb-2 last:mb-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="font-heading text-sm font-extrabold text-foreground">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {t.spec ?? "—"} · {t.slots ?? "—"} · {t.price ?? "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push("/pricing")}
                    className="bg-transparent text-foreground border border-foreground font-heading font-bold text-[10px] tracking-wider uppercase px-3 py-1.5 cursor-pointer shrink-0 hover:border-primary hover:text-primary transition-colors"
                  >
                    Book
                  </button>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">No therapists or counsellors available yet.</p>
              )}
            </div>
          </ProGate>
        </div>
      </section>

      <SiteFooter />
      {journalSavePrompt && (
        <PromptModal
          title={journalSavePrompt.title}
          message={journalSavePrompt.message}
          onClose={() => setJournalSavePrompt(null)}
        />
      )}
    </SitePageShell>
  );
};

export default MindPage;
