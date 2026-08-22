"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Ban,
  BarChart2,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Dumbbell,
  Flag,
  Heart,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  Stethoscope,
  Trash2,
  Trophy,
  UtensilsCrossed,
  Users,
  X,
} from "lucide-react";
import { DashboardIcon } from "@/components/DashboardIcon";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab =
  | "analytics"
  | "challenges"
  | "recipes"
  | "workouts"
  | "therapists"
  | "dad_dates"
  | "expert_events"
  | "circles"
  | "moderation";

interface Challenge {
  id: string;
  title: string;
  description?: string;
  active: boolean;
  created_at?: string;
}

interface Recipe {
  id: string;
  title: string;
  description?: string;
  difficulty: "easy" | "medium";
  age_min: number;
  prep_mins: number;
  cook_together: boolean;
  image_url?: string;
  ingredients?: unknown[];
  steps?: unknown[];
  created_at?: string;
}

interface WorkoutExercise {
  name: string;
  sets: number;
  reps_or_duration: string;
  rest_period: string;
  muscle_group: string;
  beginner_modification: string;
}

interface WorkoutItem {
  id: string;
  title: string;
  duration_mins: 10 | 20 | 30 | 45;
  equipment: "none" | "dumbbells" | "full_gym";
  focus: "full_body" | "upper" | "lower" | "core";
  exercises: WorkoutExercise[];
  source: "admin" | "ai_generated";
  created_at?: string;
}

interface Therapist {
  id: string;
  name: string;
  spec?: string;
  availability?: string;
  price_per_hour: number;
}

interface DadDate {
  id: string;
  icon: string;
  name: string;
  age_range: string;
  budget: string;
  duration_minutes: number;
  time_of_day?: string;
}

interface ExpertEvent {
  id: string;
  title: string;
  description?: string;
  expert_name: string;
  event_date: string;
  booking_url?: string;
  active: boolean;
}

interface CircleItem {
  id: string;
  icon: string;
  name: string;
  members_count: number | null;
}

interface Post {
  id: string;
  content: string;
  tag: string;
  anonymous: boolean;
  author_name?: string;
  author_meta?: string;
  created_at?: string;
  user_id?: string;
}

interface Analytics {
  dau: number;
  pro_users: number;
  checkins_this_week: number;
  total_users: number;
  workouts_this_week: number;
  pageviews_7d: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function adminFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "include",
  });
}

async function adminErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

// ── Sub-components ───────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
const labelCls = "block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-all hover:brightness-110 disabled:opacity-60 cursor-pointer";
const btnGhost =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-all hover:border-primary hover:text-primary cursor-pointer";
const btnDanger =
  "inline-flex items-center gap-1 rounded-full border border-red-500/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer";

function SectionHeader({
  title,
  onRefresh,
  children,
}: {
  title: string;
  onRefresh?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="font-heading text-lg font-extrabold text-foreground uppercase tracking-wide">
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {children}
        {onRefresh && (
          <button type="button" onClick={onRefresh} className={btnGhost}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="font-heading text-3xl font-extrabold text-primary leading-none">{value}</div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mt-2">
        {label}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/analytics");
      if (!res.ok) throw new Error("Failed to load analytics");
      const json = await res.json();
      setData(json);
    } catch {
      setError("Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <SectionHeader title="Analytics Summary" onRefresh={load} />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Check-ins Today" value={data.dau} />
          <StatCard label="Pro Subscribers" value={data.pro_users} />
          <StatCard label="Check-ins (7 days)" value={data.checkins_this_week} />
          <StatCard label="Workouts (7 days)" value={data.workouts_this_week} />
          <StatCard label="Total Users" value={data.total_users} />
          {data.pageviews_7d != null && (
            <StatCard label="Visitors (7 days)" value={data.pageviews_7d} />
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Challenges Tab ────────────────────────────────────────────────────────────

const BLANK_CHALLENGE_FORM = { title: "", description: "" };

function ChallengesTab() {
  const [items, setItems] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingActiveId, setChangingActiveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_CHALLENGE_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/challenges");
      if (!res.ok) {
        setError(await adminErrorMessage(res, "Weekly challenges could not be loaded. Please try again."));
        return;
      }
      setItems(await res.json());
    } catch {
      setError("Weekly challenges could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setForm(BLANK_CHALLENGE_FORM);
    setEditId(null);
    setShowForm(false);
  };

  const startCreate = () => {
    setError(null);
    setNotice(null);
    setForm(BLANK_CHALLENGE_FORM);
    setEditId(null);
    setShowForm(true);
  };

  const startEdit = (item: Challenge) => {
    setError(null);
    setNotice(null);
    setForm({ title: item.title, description: item.description ?? "" });
    setEditId(item.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      setError("Enter a challenge title before saving.");
      return;
    }
    const description = form.description.trim();
    if (!description) {
      setError("Enter the challenge instruction before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch("/api/admin/challenges", {
        method: editId ? "PATCH" : "POST",
        body: JSON.stringify(editId
          ? { id: editId, title, description }
          : { title, description }),
      });
      if (!res.ok) {
        setError(await adminErrorMessage(
          res,
          editId ? "This weekly challenge could not be updated. Please try again." : "This weekly challenge could not be created. Please try again.",
        ));
        return;
      }

      const message = editId ? "Weekly challenge updated." : "Weekly challenge created. Use Make active when it is ready to appear in Dad Health.";
      resetForm();
      await load();
      setNotice(message);
    } catch {
      setError(editId ? "This weekly challenge could not be updated. Please try again." : "This weekly challenge could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const changeActiveState = async (item: Challenge) => {
    const nextActive = !item.active;
    const currentActive = items.find((candidate) => candidate.active && candidate.id !== item.id);

    if (nextActive && currentActive) {
      const confirmed = confirm(`Make “${item.title}” active? It will replace “${currentActive.title}” in Dad Health.`);
      if (!confirmed) return;
    }
    if (!nextActive) {
      const confirmed = confirm(`Deactivate “${item.title}”? Dad Health will show no active weekly challenge until another is selected.`);
      if (!confirmed) return;
    }

    setChangingActiveId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch("/api/admin/challenges", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, active: nextActive }),
      });
      if (!res.ok) {
        setError(await adminErrorMessage(
          res,
          nextActive ? "This weekly challenge could not be made active. Please try again." : "This weekly challenge could not be deactivated. Please try again.",
        ));
        return;
      }
      await load();
      setNotice(nextActive ? "Weekly challenge is now shown in Dad Health." : "Weekly challenge deactivated.");
    } catch {
      setError(nextActive ? "This weekly challenge could not be made active. Please try again." : "This weekly challenge could not be deactivated. Please try again.");
    } finally {
      setChangingActiveId(null);
    }
  };

  const handleDelete = async (item: Challenge) => {
    const activeWarning = item.active ? " Dad Health will show no active weekly challenge until another is selected." : "";
    if (!confirm(`Delete “${item.title}”? Its participation and completion history will also be removed.${activeWarning}`)) return;

    setDeletingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch("/api/admin/challenges", {
        method: "DELETE",
        body: JSON.stringify({ id: item.id }),
      });
      if (!res.ok) {
        setError(await adminErrorMessage(res, "This weekly challenge could not be deleted. Please try again."));
        return;
      }
      if (editId === item.id) resetForm();
      await load();
      setNotice("Weekly challenge deleted.");
    } catch {
      setError("This weekly challenge could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <SectionHeader title="Weekly Challenges" onRefresh={() => void load()}>
        <button type="button" onClick={startCreate} className={btnPrimary}>
          <Plus className="h-3 w-3" /> New Challenge
        </button>
      </SectionHeader>

      <p className="mb-4 text-sm text-muted-foreground">
        Only the challenge marked Shown in Dad Health appears in the web and mobile apps. Create a new challenge for each week; editing an existing challenge keeps its participation history.
      </p>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      )}

      {showForm && (
        <div className="mb-6 space-y-3 rounded-2xl border border-border bg-card p-4">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">
            {editId ? "Edit Challenge" : "Create Challenge"}
          </h3>
          <div>
            <label className={labelCls}>Title *</label>
            <input
              className={inputCls}
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="e.g. Screen-free Sunday"
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls}>Challenge instruction *</label>
            <textarea
              className={`${inputCls} min-h-[80px] resize-none`}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Challenge description…"
            />
          </div>
          {!editId && (
            <p className="text-xs text-muted-foreground">
              New challenges are created inactive. Use Make active when the challenge is ready to appear in Dad Health.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleSave()} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Update Challenge" : "Create Challenge"}
            </button>
            <button type="button" onClick={resetForm} disabled={saving} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No weekly challenges have been created yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-start justify-between gap-3 rounded-2xl border bg-card p-4 ${item.active ? "border-primary" : "border-border"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-heading text-sm font-bold uppercase text-foreground">{item.title}</div>
                {item.description && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}
                <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {item.active ? "Shown in Dad Health" : "Not currently shown"}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => startEdit(item)} disabled={changingActiveId === item.id || deletingId === item.id} className={`${btnGhost} disabled:opacity-50`}>
                  Edit
                </button>
                <button type="button" onClick={() => void changeActiveState(item)} disabled={changingActiveId === item.id || deletingId === item.id} className={`${btnGhost} disabled:opacity-50`}>
                  {changingActiveId === item.id ? "Updating…" : item.active ? "Deactivate" : "Make active"}
                </button>
                <button type="button" onClick={() => void handleDelete(item)} disabled={deletingId === item.id || changingActiveId === item.id} className={`${btnDanger} disabled:opacity-50`} aria-label={`Delete ${item.title}`}>
                  <Trash2 className="h-3 w-3" /> {deletingId === item.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recipes Tab ───────────────────────────────────────────────────────────────

const BLANK_RECIPE_FORM = {
  title: "", description: "", difficulty: "easy" as "easy" | "medium",
  age_min: 3, prep_mins: 20, cook_together: true, image_url: "",
  ingredients: "", steps: "",
};

function recipeToForm(item: Recipe) {
  const ingredientsStr = Array.isArray(item.ingredients)
    ? (item.ingredients as unknown[])
        .map((i) => (typeof i === "string" ? i : (i as Record<string, unknown>)?.name ?? ""))
        .filter(Boolean)
        .join("\n")
    : "";
  const stepsStr = Array.isArray(item.steps)
    ? (item.steps as unknown[])
        .map((s) =>
          typeof s === "string"
            ? s
            : (s as Record<string, unknown>)?.instruction ?? "",
        )
        .filter(Boolean)
        .join("\n")
    : "";
  return {
    title: item.title,
    description: item.description ?? "",
    difficulty: item.difficulty,
    age_min: item.age_min,
    prep_mins: item.prep_mins,
    cook_together: item.cook_together,
    image_url: item.image_url ?? "",
    ingredients: ingredientsStr,
    steps: stepsStr,
  };
}

function RecipesTab() {
  const [items, setItems] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<"all" | "cook_together" | "standard">("all");
  const [form, setForm] = useState(BLANK_RECIPE_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/recipes");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const buildPayload = () => {
    const ingredientsArr = form.ingredients.split("\n").map((s) => s.trim()).filter(Boolean);
    const stepsArr = form.steps
      .split("\n")
      .map((s, i) => ({ step: i + 1, instruction: s.trim() }))
      .filter((s) => s.instruction);
    return { ...form, ingredients: ingredientsArr, steps: stepsArr, image_url: form.image_url || null };
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      const res = editId
        ? await adminFetch("/api/admin/recipes", { method: "PATCH", body: JSON.stringify({ id: editId, ...payload }) })
        : await adminFetch("/api/admin/recipes", { method: "POST", body: JSON.stringify(payload) });

      if (res.ok) {
        setForm(BLANK_RECIPE_FORM);
        setEditId(null);
        setShowForm(false);
        load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (res.ok) {
        const { url } = await res.json();
        setForm((f) => ({ ...f, image_url: url }));
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Image upload failed.");
      }
    } catch {
      alert("Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (item: Recipe) => {
    setForm(recipeToForm(item));
    setEditId(item.id);
    setShowForm(true);
    // scroll form into view
    setTimeout(() => document.getElementById("recipe-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const cancelForm = () => {
    setForm(BLANK_RECIPE_FORM);
    setEditId(null);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recipe?")) return;
    await adminFetch("/api/admin/recipes", { method: "DELETE", body: JSON.stringify({ id }) });
    if (editId === id) cancelForm();
    load();
  };

  const filtered = items.filter((r) => {
    if (filter === "cook_together") return r.cook_together;
    if (filter === "standard") return !r.cook_together;
    return true;
  });

  return (
    <div>
      <SectionHeader title="Recipe Manager" onRefresh={load}>
        <button
          type="button"
          onClick={() => { cancelForm(); setShowForm((v) => !v); }}
          className={btnPrimary}
        >
          <Plus className="h-3 w-3" /> Add Recipe
        </button>
      </SectionHeader>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "cook_together", "standard"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 border text-[11px] font-bold uppercase tracking-wide transition-all ${filter === f ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>
            {f === "all" ? "All" : f === "cook_together" ? "Cook Together" : "Standard"}
          </button>
        ))}
      </div>

      {showForm && (
        <div id="recipe-form" className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">
            {editId ? "Edit Recipe" : "Add Recipe"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Title *</label>
              <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Recipe title" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short description" />
            </div>
            <div>
              <label className={labelCls}>Difficulty</label>
              <select className={inputCls} value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value as "easy" | "medium" }))}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Minimum age</label>
              <input type="number" className={inputCls} value={form.age_min} onChange={(e) => setForm((f) => ({ ...f, age_min: Number(e.target.value) }))} min={0} />
            </div>
            <div>
              <label className={labelCls}>Prep time (minutes)</label>
              <input type="number" className={inputCls} value={form.prep_mins} onChange={(e) => setForm((f) => ({ ...f, prep_mins: Number(e.target.value) }))} min={1} />
            </div>
            <div>
              <label className={labelCls}>Image URL</label>
              <input className={inputCls} value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => handleImageUpload(e.target.files?.[0])}
                disabled={uploading}
                className="mt-2 block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-bold file:uppercase file:tracking-wide file:text-primary-foreground hover:file:brightness-110 file:cursor-pointer disabled:opacity-60"
              />
              {uploading && <p className="mt-1 text-[11px] text-muted-foreground">Uploading…</p>}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Ingredients (one per line)</label>
              <textarea className={`${inputCls} min-h-[100px] resize-none`} value={form.ingredients} onChange={(e) => setForm((f) => ({ ...f, ingredients: e.target.value }))} placeholder={"200g chicken breast\n2 tbsp olive oil\n1 clove garlic"} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Steps (one instruction per line)</label>
              <textarea className={`${inputCls} min-h-[100px] resize-none`} value={form.steps} onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))} placeholder={"Preheat oven to 180°C\nMix all ingredients together\nBake for 25 minutes"} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="cook-together" checked={form.cook_together} onChange={(e) => setForm((f) => ({ ...f, cook_together: e.target.checked }))} className="h-4 w-4 accent-primary" />
            <label htmlFor="cook-together" className="text-sm text-foreground">Cook Together recipe</label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Update Recipe" : "Save Recipe"}
            </button>
            <button type="button" onClick={cancelForm} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipes found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <div key={item.id} className={`rounded-2xl border bg-card p-4 transition-colors ${editId === item.id ? "border-primary" : "border-border"}`}>
              {item.image_url && (
                <img src={item.image_url} alt={item.title} className="h-32 w-full object-cover rounded-xl mb-3" />
              )}
              <div className="font-heading text-sm font-bold uppercase text-foreground">{item.title}</div>
              {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
              <div className="flex gap-2 flex-wrap mt-2">
                <span className="text-[10px] font-bold uppercase text-primary">{item.difficulty}</span>
                <span className="text-[10px] text-muted-foreground">Age {item.age_min}+</span>
                <span className="text-[10px] text-muted-foreground">{item.prep_mins} min</span>
                {item.cook_together && (
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Cook Together</span>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => startEdit(item)} className={btnGhost}>Edit</button>
                <button type="button" onClick={() => handleDelete(item.id)} className={btnDanger}>
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Workouts Tab ──────────────────────────────────────────────────────────────

const BLANK_WORKOUT_FORM = {
  title: "",
  duration_mins: 20 as 10 | 20 | 30 | 45,
  equipment: "none" as "none" | "dumbbells" | "full_gym",
  focus: "full_body" as "full_body" | "upper" | "lower" | "core",
  exercisesText: "",
};

function workoutsToText(exercises: unknown): string {
  if (!Array.isArray(exercises)) return "";
  return (exercises as WorkoutExercise[])
    .map((ex) => {
      return [
        ex.name ?? "",
        String(ex.sets ?? ""),
        ex.reps_or_duration ?? "",
        ex.rest_period ?? "",
        ex.muscle_group ?? "",
        ex.beginner_modification ?? "",
      ].join(" | ");
    })
    .join("\n");
}

function parseExercises(text: string): WorkoutExercise[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, sets, reps_or_duration, rest_period, muscle_group, beginner_modification] =
        line.split("|").map((v) => v.trim());
      return {
        name: name || "Untitled exercise",
        sets: Math.max(1, Number(sets) || 1),
        reps_or_duration: reps_or_duration || "10 reps",
        rest_period: rest_period || "45 sec",
        muscle_group: muscle_group || "full_body",
        beginner_modification: beginner_modification || "Reduce range of motion",
      };
    });
}

function workoutToForm(item: WorkoutItem) {
  return {
    title: item.title,
    duration_mins: item.duration_mins,
    equipment: item.equipment,
    focus: item.focus,
    exercisesText: workoutsToText(item.exercises),
  };
}

function WorkoutsTab() {
  const [items, setItems] = useState<WorkoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_WORKOUT_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/workouts");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm(BLANK_WORKOUT_FORM);
    setEditId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    const exercises = parseExercises(form.exercisesText);
    if (exercises.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        duration_mins: form.duration_mins,
        equipment: form.equipment,
        focus: form.focus,
        exercises,
      };
      const res = editId
        ? await adminFetch("/api/admin/workouts", { method: "PATCH", body: JSON.stringify({ id: editId, ...payload }) })
        : await adminFetch("/api/admin/workouts", { method: "POST", body: JSON.stringify(payload) });
      if (res.ok) {
        resetForm();
        load();
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: WorkoutItem) => {
    setForm(workoutToForm(item));
    setEditId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workout?")) return;
    await adminFetch("/api/admin/workouts", { method: "DELETE", body: JSON.stringify({ id }) });
    if (editId === id) resetForm();
    load();
  };

  return (
    <div>
      <SectionHeader title="Workout Library (Free 8)" onRefresh={load}>
        <button type="button" onClick={() => { if (showForm) resetForm(); else setShowForm(true); }} className={btnPrimary}>
          <Plus className="h-3 w-3" /> Add Workout
        </button>
      </SectionHeader>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">
            {editId ? "Edit Workout" : "Add Workout"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Title *</label>
              <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Duration</label>
              <select className={inputCls} value={form.duration_mins} onChange={(e) => setForm((f) => ({ ...f, duration_mins: Number(e.target.value) as 10 | 20 | 30 | 45 }))}>
                <option value={10}>10 min</option>
                <option value={20}>20 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Equipment</label>
              <select className={inputCls} value={form.equipment} onChange={(e) => setForm((f) => ({ ...f, equipment: e.target.value as "none" | "dumbbells" | "full_gym" }))}>
                <option value="none">None</option>
                <option value="dumbbells">Dumbbells</option>
                <option value="full_gym">Full gym</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Focus</label>
              <select className={inputCls} value={form.focus} onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value as "full_body" | "upper" | "lower" | "core" }))}>
                <option value="full_body">Full body</option>
                <option value="upper">Upper body</option>
                <option value="lower">Lower body</option>
                <option value="core">Core</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Exercises *</label>
              <textarea
                className={`${inputCls} min-h-[130px] resize-none`}
                value={form.exercisesText}
                onChange={(e) => setForm((f) => ({ ...f, exercisesText: e.target.value }))}
                placeholder={"Push-up | 3 | 10 reps | 45 sec | chest | Incline push-up\nPlank | 3 | 45 sec | 30 sec | core | Knee plank"}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                One line per exercise: Name | Sets | Reps/Duration | Rest | Muscle group | Beginner modification
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Update Workout" : "Save Workout"}
            </button>
            <button type="button" onClick={resetForm} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No admin workouts yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className={`rounded-2xl border bg-card p-4 ${editId === item.id ? "border-primary" : "border-border"}`}>
              <div className="font-heading text-sm font-bold uppercase text-foreground">{item.title}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {item.duration_mins} min · {item.equipment.replace("_", " ")} · {item.focus.replace("_", " ")}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                {Array.isArray(item.exercises) ? item.exercises.length : 0} exercises
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => startEdit(item)} className={btnGhost}>Edit</button>
                <button type="button" onClick={() => handleDelete(item.id)} className={btnDanger}>
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Therapists Tab ────────────────────────────────────────────────────────────

function TherapistsTab() {
  const [items, setItems] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", spec: "", availability: "", price_per_hour: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/therapists");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, price_per_hour: Number(form.price_per_hour) };
      if (editId) {
        await adminFetch("/api/admin/therapists", { method: "PATCH", body: JSON.stringify({ id: editId, ...payload }) });
      } else {
        await adminFetch("/api/admin/therapists", { method: "POST", body: JSON.stringify(payload) });
      }
      setForm({ name: "", spec: "", availability: "", price_per_hour: "" });
      setEditId(null);
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: Therapist) => {
    setForm({ name: item.name, spec: item.spec ?? "", availability: item.availability ?? "", price_per_hour: String(item.price_per_hour) });
    setEditId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this therapist?")) return;
    await adminFetch("/api/admin/therapists", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  };

  return (
    <div>
      <SectionHeader title="Therapist Listings" onRefresh={load}>
        <button type="button" onClick={() => { setEditId(null); setForm({ name: "", spec: "", availability: "", price_per_hour: "" }); setShowForm((v) => !v); }} className={btnPrimary}>
          <Plus className="h-3 w-3" /> Add Therapist
        </button>
      </SectionHeader>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">{editId ? "Edit Therapist" : "Add Therapist"}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Name *</label>
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dr. Jane Smith" />
            </div>
            <div>
              <label className={labelCls}>Specialisation</label>
              <input className={inputCls} value={form.spec} onChange={(e) => setForm((f) => ({ ...f, spec: e.target.value }))} placeholder="e.g. Men's mental health, CBT" />
            </div>
            <div>
              <label className={labelCls}>Price per hour (£)</label>
              <input type="number" className={inputCls} value={form.price_per_hour} onChange={(e) => setForm((f) => ({ ...f, price_per_hour: e.target.value }))} placeholder="80" min={0} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Availability</label>
              <input className={inputCls} value={form.availability} onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))} placeholder="e.g. Mon–Fri, evenings available" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Update" : "Save"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No therapists listed yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="font-heading text-sm font-bold uppercase text-foreground">{item.name}</div>
              {item.spec && <p className="text-xs text-muted-foreground mt-1">{item.spec}</p>}
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                {item.price_per_hour && <span>£{item.price_per_hour}/hr</span>}
                {item.availability && <span>· {item.availability}</span>}
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => startEdit(item)} className={btnGhost}>Edit</button>
                <button type="button" onClick={() => handleDelete(item.id)} className={btnDanger}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dad Dates Tab ─────────────────────────────────────────────────────────────

function DadDatesTab() {
  const [items, setItems] = useState<DadDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ icon: "", name: "", age_range: "", budget: "", duration_minutes: "", time_of_day: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/dad_dates");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await adminFetch("/api/admin/dad_dates", {
        method: "POST",
        body: JSON.stringify({ ...form, duration_minutes: Number(form.duration_minutes) }),
      });
      setForm({ icon: "", name: "", age_range: "", budget: "", duration_minutes: "", time_of_day: "" });
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this dad date idea?")) return;
    await adminFetch("/api/admin/dad_dates", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  };

  return (
    <div>
      <SectionHeader title="Dad Date Ideas" onRefresh={load}>
        <button type="button" onClick={() => setShowForm((v) => !v)} className={btnPrimary}>
          <Plus className="h-3 w-3" /> Add Idea
        </button>
      </SectionHeader>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">Add Dad Date Idea</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Emoji icon</label>
              <input className={inputCls} value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="🎬" />
            </div>
            <div>
              <label className={labelCls}>Activity name *</label>
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Cinema trip" />
            </div>
            <div>
              <label className={labelCls}>Age range</label>
              <input className={inputCls} value={form.age_range} onChange={(e) => setForm((f) => ({ ...f, age_range: e.target.value }))} placeholder="3-10" />
            </div>
            <div>
              <label className={labelCls}>Budget</label>
              <input className={inputCls} value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} placeholder="Under £15" />
            </div>
            <div>
              <label className={labelCls}>Duration (minutes)</label>
              <input type="number" className={inputCls} value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))} min={1} placeholder="90" />
            </div>
            <div>
              <label className={labelCls}>Time of day</label>
              <input className={inputCls} value={form.time_of_day} onChange={(e) => setForm((f) => ({ ...f, time_of_day: e.target.value }))} placeholder="Evening" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setShowForm(false)} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dad date ideas yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border bg-card p-3">
              <div className="text-2xl mb-1">{item.icon}</div>
              <div className="font-heading text-sm font-bold uppercase text-foreground">{item.name}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Age {item.age_range} · {item.budget}
              </div>
              <button type="button" onClick={() => handleDelete(item.id)} className={`${btnDanger} mt-2`}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Expert Events Tab ─────────────────────────────────────────────────────────

function ExpertEventsTab() {
  const [items, setItems] = useState<ExpertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", expert_name: "", event_date: "", booking_url: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/expert_events");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.expert_name.trim() || !form.event_date) return;
    setSaving(true);
    try {
      await adminFetch("/api/admin/expert_events", { method: "POST", body: JSON.stringify(form) });
      setForm({ title: "", description: "", expert_name: "", event_date: "", booking_url: "" });
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: ExpertEvent) => {
    await adminFetch("/api/admin/expert_events", { method: "PATCH", body: JSON.stringify({ id: item.id, active: !item.active }) });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this event?")) return;
    await adminFetch("/api/admin/expert_events", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  };

  return (
    <div>
      <SectionHeader title="Expert Q&A Events" onRefresh={load}>
        <button type="button" onClick={() => setShowForm((v) => !v)} className={btnPrimary}>
          <Plus className="h-3 w-3" /> New Event
        </button>
      </SectionHeader>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">Create Q&A Event</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Event title *</label>
              <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Live Q&A: Men's Health with Dr. Smith" />
            </div>
            <div>
              <label className={labelCls}>Expert name *</label>
              <input className={inputCls} value={form.expert_name} onChange={(e) => setForm((f) => ({ ...f, expert_name: e.target.value }))} placeholder="Dr. Jane Smith" />
            </div>
            <div>
              <label className={labelCls}>Event date & time *</label>
              <input type="datetime-local" className={inputCls} value={form.event_date} onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What topics will be covered?" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Booking URL</label>
              <input className={inputCls} value={form.booking_url} onChange={(e) => setForm((f) => ({ ...f, booking_url: e.target.value }))} placeholder="https://calendly.com/…" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save Event"}</button>
            <button type="button" onClick={() => setShowForm(false)} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events scheduled yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <div className="font-heading text-sm font-bold uppercase text-foreground">{item.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {item.expert_name} · {new Date(item.event_date).toLocaleString()}
                </div>
                {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${item.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {item.active ? "Active" : "Inactive"}
                  </span>
                  {item.booking_url && (
                    <a href={item.booking_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      Booking link →
                    </a>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => toggleActive(item)} className={btnGhost}>{item.active ? "Hide" : "Show"}</button>
                <button type="button" onClick={() => handleDelete(item.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Circles Tab ──────────────────────────────────────────────────────────────

// Circles catalogue management. Memberships remain user-owned.
const CIRCLE_ICON_OPTIONS = [
  { value: "community", label: "Community" },
  { value: "baby", label: "New dads" },
  { value: "grad", label: "School age" },
  { value: "fitness", label: "Fitness" },
  { value: "mind", label: "Mind" },
  { value: "bond", label: "Bond" },
  { value: "gaming", label: "Gaming" },
  { value: "camping", label: "Outdoors" },
  { value: "kickabout", label: "Football" },
  { value: "run", label: "Running" },
  { value: "story", label: "Stories" },
  { value: "journal", label: "Journal" },
] as const;

const BLANK_CIRCLE_FORM = { name: "", icon: "community" };

function CirclesTab() {
  const [items, setItems] = useState<CircleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_CIRCLE_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch("/api/admin/circles");
      if (!response.ok) {
        setError(await adminErrorMessage(response, "Dad Circles could not be loaded. Please try again."));
        return;
      }
      setItems(await response.json());
    } catch {
      setError("Dad Circles could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setForm(BLANK_CIRCLE_FORM);
    setEditId(null);
    setShowForm(false);
  };

  const startCreate = () => {
    setError(null);
    setNotice(null);
    setForm(BLANK_CIRCLE_FORM);
    setEditId(null);
    setShowForm(true);
  };

  const startEdit = (item: CircleItem) => {
    setError(null);
    setNotice(null);
    setForm({ name: item.name, icon: item.icon });
    setEditId(item.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("Enter a Circle name before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin/circles", {
        method: editId ? "PATCH" : "POST",
        body: JSON.stringify(editId ? { id: editId, name, icon: form.icon } : { name, icon: form.icon }),
      });
      if (!response.ok) {
        setError(await adminErrorMessage(
          response,
          editId ? "This Circle could not be updated. Please try again." : "This Circle could not be created. Please try again.",
        ));
        return;
      }

      const message = editId ? "Circle updated." : "Circle created.";
      resetForm();
      await load();
      setNotice(message);
    } catch {
      setError(editId ? "This Circle could not be updated. Please try again." : "This Circle could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: CircleItem) => {
    const memberCount = item.members_count ?? 0;
    const membershipCopy = memberCount === 1 ? "1 membership" : `${memberCount} memberships`;
    if (!confirm(`Delete ${item.name}? This removes ${membershipCopy}. Community posts are not affected.`)) return;

    setDeletingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin/circles", {
        method: "DELETE",
        body: JSON.stringify({ id: item.id }),
      });
      if (!response.ok) {
        setError(await adminErrorMessage(response, "This Circle could not be deleted. Please try again."));
        return;
      }
      if (editId === item.id) resetForm();
      await load();
      setNotice("Circle deleted.");
    } catch {
      setError("This Circle could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <SectionHeader title="Dad Circles" onRefresh={() => void load()}>
        <button type="button" onClick={startCreate} className={btnPrimary}>
          <Plus className="h-3 w-3" /> Add Circle
        </button>
      </SectionHeader>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      )}

      {showForm && (
        <div className="mb-6 space-y-3 rounded-2xl border border-border bg-card p-4">
          <h3 className="font-heading text-sm font-extrabold uppercase text-foreground">
            {editId ? "Edit Circle" : "Add Circle"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Circle name *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. New dads"
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>Icon</label>
              <select
                className={inputCls}
                value={form.icon}
                onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}
              >
                {CIRCLE_ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <DashboardIcon icon={form.icon} size="lg" />
            <div>
              <div className="font-heading text-sm font-bold uppercase text-foreground">{form.name.trim() || "Circle preview"}</div>
              <div className="text-[11px] text-muted-foreground">Member count is managed automatically.</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleSave()} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editId ? "Update Circle" : "Create Circle"}
            </button>
            <button type="button" onClick={resetForm} disabled={saving} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {editId ? null : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Dad Circles have been created yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className={`rounded-2xl border bg-card p-4 ${editId === item.id ? "border-primary" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2"><DashboardIcon icon={item.icon} size="lg" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-heading text-sm font-bold uppercase text-foreground">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {(item.members_count ?? 0).toLocaleString()} {(item.members_count ?? 0) === 1 ? "member" : "members"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => startEdit(item)} className={btnGhost}>Edit</button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item)}
                  disabled={deletingId === item.id}
                  className={`${btnDanger} disabled:opacity-50`}
                >
                  <Trash2 className="h-3 w-3" /> {deletingId === item.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Moderation Tab ────────────────────────────────────────────────────────────

function ModerationTab() {
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [banning, setBanning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/posts");
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await adminFetch("/api/admin/posts", { method: "DELETE", body: JSON.stringify({ id }) });
      setItems((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBan = async (userId: string) => {
    if (!confirm("Ban this user? This permanently deletes their account and all of their data. This cannot be undone.")) return;
    setBanning(userId);
    try {
      await adminFetch("/api/admin/users", { method: "DELETE", body: JSON.stringify({ id: userId }) });
      setItems((prev) => prev.filter((p) => p.user_id !== userId));
    } finally {
      setBanning(null);
    }
  };

  return (
    <div>
      <SectionHeader title="Community Moderation" onRefresh={load}>
        <span className="text-xs text-muted-foreground">Last 100 posts</span>
      </SectionHeader>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts found.</p>
      ) : (
        <div className="space-y-2">
          {items.map((post) => (
            <div key={post.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {post.tag}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {post.anonymous ? "Anonymous" : (post.author_name ?? "Unknown")}
                  </span>
                  {post.created_at && (
                    <span className="text-[10px] text-muted-foreground">
                      · {new Date(post.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground/80 line-clamp-3">{post.content}</p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDelete(post.id)}
                  disabled={deleting === post.id}
                  className={`${btnDanger} disabled:opacity-50`}
                  aria-label="Delete post"
                >
                  <Trash2 className="h-3 w-3" />
                  {deleting === post.id ? "…" : "Delete"}
                </button>
                {post.user_id && !post.anonymous && (
                  <button
                    type="button"
                    onClick={() => handleBan(post.user_id!)}
                    disabled={banning === post.user_id}
                    className={`${btnDanger} disabled:opacity-50`}
                    aria-label="Ban user"
                  >
                    <Ban className="h-3 w-3" />
                    {banning === post.user_id ? "…" : "Ban User"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
        credentials: "include",
      });
      if (res.ok) {
        onLogin();
      } else {
        const data = await res.json();
        setError(data?.error ?? "Invalid key");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <div className="font-heading text-xl font-extrabold text-foreground uppercase tracking-wide">
              Admin
            </div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Dad Health
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Admin key</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={inputCls}
              placeholder="Enter your admin key"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !key}
            className={`${btnPrimary} w-full justify-center py-3`}
          >
            {loading ? "Verifying…" : "Enter Admin →"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "analytics", label: "Analytics", icon: <BarChart2 className="h-4 w-4" /> },
  { id: "challenges", label: "Challenges", icon: <Trophy className="h-4 w-4" /> },
  { id: "recipes", label: "Recipes", icon: <UtensilsCrossed className="h-4 w-4" /> },
  { id: "workouts", label: "Workouts", icon: <Dumbbell className="h-4 w-4" /> },
  { id: "therapists", label: "Therapists", icon: <Stethoscope className="h-4 w-4" /> },
  { id: "dad_dates", label: "Dad Dates", icon: <Heart className="h-4 w-4" /> },
  { id: "expert_events", label: "Expert Q&A", icon: <CalendarDays className="h-4 w-4" /> },
  { id: "circles", label: "Circles", icon: <Users className="h-4 w-4" /> },
  { id: "moderation", label: "Moderation", icon: <Flag className="h-4 w-4" /> },
];

// ── Main Admin Page ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authState, setAuthState] = useState<"checking" | "authed" | "guest">("checking");
  const [activeTab, setActiveTab] = useState<Tab>("analytics");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Verify existing cookie on mount — only show login if there is no valid session
  useEffect(() => {
    fetch("/api/admin/auth", { credentials: "include" })
      .then((r) => setAuthState(r.ok ? "authed" : "guest"))
      .catch(() => setAuthState("guest"));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE", credentials: "include" });
    setAuthState("guest");
  };

  if (authState === "checking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Shield className="h-5 w-5 text-primary animate-pulse" />
          <span className="text-sm">Verifying session…</span>
        </div>
      </div>
    );
  }

  if (authState === "guest") {
    return <LoginScreen onLogin={() => setAuthState("authed")} />;
  }

  const renderTab = () => {
    switch (activeTab) {
      case "analytics": return <AnalyticsTab />;
      case "challenges": return <ChallengesTab />;
      case "recipes": return <RecipesTab />;
      case "workouts": return <WorkoutsTab />;
      case "therapists": return <TherapistsTab />;
      case "dad_dates": return <DadDatesTab />;
      case "expert_events": return <ExpertEventsTab />;
      case "circles": return <CirclesTab />;
      case "moderation": return <ModerationTab />;
    }
  };

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 border-r border-border bg-card flex flex-col transform transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary shrink-0" />
            <div>
              <div className="font-heading text-sm font-extrabold uppercase text-foreground">Admin</div>
              <div className="text-[10px] text-muted-foreground">Dad Health</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                activeTab === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
              {activeTab === item.id && <ChevronRight className="h-3 w-3 ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
            aria-label="Open menu"
          >
            <BookOpen className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 text-muted-foreground">
            {activeNav?.icon}
            <h1 className="font-heading text-base font-extrabold uppercase text-foreground tracking-wide">
              {activeNav?.label}
            </h1>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {renderTab()}
        </main>
      </div>
    </div>
  );
}
