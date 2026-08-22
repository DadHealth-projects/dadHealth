"use client";

import { format } from "date-fns";

import { DashboardIcon } from "@/components/DashboardIcon";
import MiniBarChart from "@/components/dashboard/MiniBarChart";
import SectionHeader from "@/components/dashboard/SectionHeader";
import type { DashboardGoal, ReminderItem, ScoreItem } from "./types";
import { useProStatus } from "@/components/ProProvider";


type HomeScreenProps = {
  isFullDashboard: boolean;
  user: { id?: string } | null;
  displayNameShort: string;
  now: Date;
  dadsCount: number;
  hasCheckedInToday: boolean;
  selectedMood: number;
  selectedSleep: string;
  setSelectedSleep: (value: string) => void;
  onMoodSelect: (value: number) => void;
  onDailyCheckIn: () => void;
  checkInPending: boolean;
  isCheckinBlocked: boolean;
  score: number | null;
  scoreItems: ScoreItem[];
  dailyGoals: DashboardGoal[];
  onGoalAction: (index: number) => void;
  getGoalActionLabel: (status: DashboardGoal["status"]) => string;
  moodWeek: number[];
  moodSummary: { label: string; scoreText: string };
  reminders: ReminderItem[];
  challenge: { id: string; title: string; participants_count: number } | null;
  onOpenChallenge: () => void;
};

export default function HomeScreen({
  isFullDashboard,
  user,
  displayNameShort,
  now,
  dadsCount,
  hasCheckedInToday,
  selectedMood,
  setSelectedSleep,
  selectedSleep,
  onMoodSelect,
  onDailyCheckIn,
  checkInPending,
  isCheckinBlocked,
  score,
  scoreItems,
  dailyGoals,
  onGoalAction,
  getGoalActionLabel,
  moodWeek,
  moodSummary,
  reminders,
  challenge,
  onOpenChallenge,
}: HomeScreenProps) {
  const { isPro } = useProStatus();
  return (
    <>
      <div className={`bg-background p-5 ${isFullDashboard ? "min-h-full" : ""}`}>
        <div className="mb-4">
          <span className="block text-[10px] font-heading font-bold tracking-[2px] text-muted-foreground uppercase !p-0">
            good morning dads
          </span>
          <div className="font-heading text-[24px] font-extrabold text-foreground uppercase leading-tight mt-1">
            {(user ? displayNameShort : "—").toUpperCase()}
            <br />
            {format(now, "EEEE")}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isPro && <span className="tag-pill">PRO</span>}
            <span className="text-xs text-muted-foreground">{format(now, "d MMM")}</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">{dadsCount > 0 ? dadsCount.toLocaleString() : "—"} dads in community</span>
          </div>
        </div>

        {user && !hasCheckedInToday && (
          <div className="border border-primary/20 p-4 mb-4">
            <div className="font-heading text-[11px] font-bold tracking-wider uppercase text-primary mb-3">DAILY CHECK-IN</div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] text-muted-foreground uppercase mb-1.5">Mood (1-4)</label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onMoodSelect(value)}
                      aria-label={`Set mood to ${value}`}
                      className={`min-w-[2rem] h-8 px-2 font-heading text-xs font-bold border cursor-pointer ${
                        selectedMood === value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3 sm:gap-4">
                <div className="min-w-0 shrink-0">
                  <label htmlFor="checkin-sleep" className="block text-[10px] text-muted-foreground uppercase mb-1.5">
                    Sleep (h)
                  </label>
                    <input
                    id="checkin-sleep"
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    value={selectedSleep}
                    onChange={(e) => setSelectedSleep(e.target.value)}
                    className="w-[4.5rem] box-border bg-white/[0.04] border border-border px-2 py-2 text-foreground text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={onDailyCheckIn}
                  disabled={checkInPending}
                  aria-label="Save daily check-in"
                  className="bg-primary text-primary-foreground font-heading font-bold text-[10px] tracking-wider uppercase px-4 py-2 border-none cursor-pointer hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {checkInPending ? "..." : "SAVE"}
                </button>
              </div>
              {/* {isCheckinBlocked && (
                <p className="text-[10px] text-muted-foreground">
                  Mood 1, 2, and 4 are view-only in this dashboard check-in.
                </p>
              )} */}
            </div>
          </div>
        )}

        <div className="bg-primary text-primary-foreground p-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="text-center shrink-0">
              <div className="font-heading text-[42px] font-extrabold leading-none">{score ?? "—"}</div>
              <div className="font-heading text-[9px] font-bold tracking-wider uppercase opacity-50">DAD SCORE</div>
            </div>
            <div className="flex-1">
              <div className="font-heading text-[12px] font-extrabold uppercase mb-2">This week's health</div>
              {scoreItems.map((item) => (
                <div key={item.label} className="mb-1.5">
                  <div className="flex justify-between font-heading text-[9px] font-bold uppercase opacity-60 mb-0.5">
                    <span>{item.label}</span>
                    <span>{item.value}%</span>
                  </div>
                  <div className="h-1 bg-primary-foreground/20">
                    <div className="h-1 bg-primary-foreground transition-all duration-500" style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {!isPro && (

          <div className="border border-primary/20 p-3 mb-4">
            <div className="font-heading text-[11px] font-bold tracking-wider uppercase text-primary mb-0.5">
              UPGRADE TO PRO
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">Unlock full score, graphs & more</p>
            <button type="button" className="bg-primary text-primary-foreground font-heading font-bold text-[10px] tracking-wider uppercase px-3 py-1.5 w-full cursor-pointer border-none hover:bg-primary/90 transition-colors">
              7-day free trial
            </button>
          </div>
        )}


        <SectionHeader title="TODAY'S PLAN" className="mb-2 block" />
        <div className="pb-4">
          {dailyGoals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Add goals in onboarding to build your daily plan.
            </p>
          ) : (
            dailyGoals.map((task, index) => (
              <div key={task.name} className="flex items-center gap-3 py-3 border-b border-primary/20 last:border-b-0">
                <div className="w-9 h-9 bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <DashboardIcon icon={task.iconKey} size="md" />
                </div>
                <div className="flex-1">
                  <div className="font-heading text-[13px] font-bold tracking-wide text-foreground">{task.name}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{task.time}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onGoalAction(index)}
                  disabled={task.status === "done"}
                  className={`font-heading font-bold text-[10px] tracking-wider uppercase px-2.5 py-1 border cursor-pointer transition-colors ${
                    task.status === "done"
                      ? "bg-primary text-primary-foreground border-primary cursor-not-allowed"
                      : "bg-transparent text-primary border-primary hover:bg-primary hover:text-primary-foreground"
                  }`}
                >
                  {getGoalActionLabel(task.status)}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={`bg-background p-5 ${isFullDashboard ? "min-h-full" : ""}`}>
        <SectionHeader title="MOOD THIS WEEK" className="mb-3 block" />
        <MiniBarChart values={moodWeek} labels={["M", "T", "W", "T", "F", "S", "S"]} maxValue={4} />
        <p className="text-xs text-muted-foreground">
          Avg mood: <span className="text-primary font-semibold">{moodSummary.label}</span>
          {moodSummary.scoreText}
        </p>

        <div className="mt-6">
          <SectionHeader title="SMART REMINDERS" className="mb-3 block" />
          {reminders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reminders yet</p>
          ) : (
            reminders.map((reminder) => (
              <div key={reminder.id} className="text-xs text-muted-foreground py-1.5 border-b border-border last:border-b-0 flex items-center gap-2">
                <DashboardIcon icon={reminder.type || "bell"} size="sm" />
                {reminder.text}
              </div>
            ))
          )}
        </div>

        <div className="mt-6 border border-primary/20 p-4">
          <div className="font-heading text-[10px] font-bold tracking-[2px] uppercase text-primary mb-1">
            THIS WEEK'S CHALLENGE
          </div>
          <div className="line-clamp-2 font-heading text-[16px] font-extrabold text-foreground uppercase tracking-wide mb-1">
            {challenge?.title ?? "NO ACTIVE CHALLENGE"}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {challenge?.participants_count ?? 0} {(challenge?.participants_count ?? 0) === 1 ? "dad" : "dads"} taking part
          </p>
          <button
            type="button"
            onClick={onOpenChallenge}
            disabled={!challenge}
            className="bg-transparent border-[1.5px] font-heading font-bold tracking-wider uppercase cursor-pointer inline-flex gap-1.5 py-2 px-3.5 text-[11px] text-foreground border-foreground hover:border-primary hover:text-primary transition-all duration-200 disabled:cursor-default disabled:opacity-50"
          >
            TAKE ACTION →
          </button>
        </div>
      </div>
    </>
  );
}
