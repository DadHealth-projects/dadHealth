"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import HappeningImageCropper from "@/components/admin/HappeningImageCropper";
import {
  HappeningImageError,
  prepareHappeningImageSource,
} from "@/lib/happeningImageProcessing";

interface HappeningItem {
  id: string;
  title: string;
  event_at: string;
  summary: string;
  image_url: string | null;
  button_label: string | null;
  button_url: string | null;
  show_until: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface CropSource {
  url: string;
  name: string;
}

const BLANK_FORM = {
  title: "",
  event_at: "",
  summary: "",
  image_url: "",
  button_label: "",
  button_url: "",
  show_until: "",
};

const inputClass =
  "min-h-12 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

const labelClass =
  "mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

const primaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

const ghostButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60";

const dangerButton =
  "inline-flex min-h-11 items-center gap-1 rounded-full border border-destructive/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60";

async function adminFetch(
  path: string,
  options: RequestInit = {},
) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "include",
  });
}

async function responseError(
  response: Response,
  fallback: string,
) {
  try {
    const body = (await response.json()) as {
      error?: unknown;
    };

    return typeof body.error === "string" && body.error.trim()
      ? body.error
      : fallback;
  } catch {
    return fallback;
  }
}

function toLocalDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return local.toISOString().slice(0, 16);
}

function toValidISOString(
  value: string,
  fieldName: string,
) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Please enter a valid ${fieldName} date and time.`,
    );
  }

  return date.toISOString();
}

export default function HappeningAdminTab() {
  const [items, setItems] = useState<HappeningItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preparingImage, setPreparingImage] =
    useState(false);

  const [cropSource, setCropSource] =
    useState<CropSource | null>(null);

  const [changingId, setChangingId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] =
    useState<string | null>(null);

  const pendingUploads = useRef(new Set<string>());
  const cropSourceUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await adminFetch(
        "/api/admin/happenings",
      );

      if (!response.ok) {
        setError(
          await responseError(
            response,
            "Happening posts could not be loaded.",
          ),
        );
        return;
      }

      setItems(await response.json());
    } catch {
      setError("Happening posts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (cropSourceUrl.current) {
        URL.revokeObjectURL(cropSourceUrl.current);
      }

      for (const url of pendingUploads.current) {
        void fetch("/api/admin/happenings/upload", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url }),
          credentials: "include",
          keepalive: true,
        });
      }
    },
    [],
  );

  const closeCropper = () => {
    if (cropSourceUrl.current) {
      URL.revokeObjectURL(cropSourceUrl.current);
    }

    cropSourceUrl.current = null;
    setCropSource(null);
  };

  const cleanupUpload = async (
    url: string,
    showFailure = true,
  ) => {
    try {
      const response = await adminFetch(
        "/api/admin/happenings/upload",
        {
          method: "DELETE",
          body: JSON.stringify({ url }),
        },
      );

      if (
        !response.ok &&
        response.status !== 409
      ) {
        if (showFailure) {
          setError(
            await responseError(
              response,
              "Uploaded image could not be removed. Please try again.",
            ),
          );
        }

        return false;
      }

      pendingUploads.current.delete(url);

      return true;
    } catch {
      if (showFailure) {
        setError(
          "Uploaded image could not be removed. Please try again.",
        );
      }

      return false;
    }
  };

  const cleanupPendingUploads = async () => {
    const results = await Promise.all(
      [...pendingUploads.current].map((url) =>
        cleanupUpload(url),
      ),
    );

    return results.every(Boolean);
  };

  const resetForm = () => {
    setForm(BLANK_FORM);
    setEditId(null);
    setShowForm(false);
    setUploading(false);
    setPreparingImage(false);
    closeCropper();
  };

  const cancelForm = async () => {
    if (
      uploading ||
      saving ||
      preparingImage
    ) {
      return;
    }

    setError(null);

    if (!(await cleanupPendingUploads())) {
      return;
    }

    resetForm();
  };

  const startCreate = async () => {
    if (!(await cleanupPendingUploads())) {
      return;
    }

    setError(null);
    setNotice(null);
    setEditId(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const startEdit = async (
    item: HappeningItem,
  ) => {
    if (!(await cleanupPendingUploads())) {
      return;
    }

    setError(null);
    setNotice(null);
    setEditId(item.id);

    setForm({
      title: item.title,
      event_at: toLocalDateTime(
        item.event_at,
      ),
      summary: item.summary,
      image_url: item.image_url ?? "",
      button_label:
        item.button_label ?? "",
      button_url:
        item.button_url ?? "",
      show_until: toLocalDateTime(
        item.show_until,
      ),
    });

    setShowForm(true);
  };

  const chooseImage = async (
    file: File,
  ) => {
    setPreparingImage(true);
    setError(null);

    try {
      const source =
        await prepareHappeningImageSource(
          file,
        );

      closeCropper();

      cropSourceUrl.current =
        source.url;

      setCropSource(source);
    } catch (caught) {
      setError(
        caught instanceof
          HappeningImageError
          ? caught.message
          : "Image processing failed. Please try another photo.",
      );
    } finally {
      setPreparingImage(false);
    }
  };

  const uploadImage = async (
    file: File,
  ) => {
    setUploading(true);
    setError(null);

    try {
      const body = new FormData();

      body.set("file", file);

      const response = await fetch(
        "/api/admin/happenings/upload",
        {
          method: "POST",
          body,
          credentials: "include",
        },
      );

      if (!response.ok) {
        setError(
          await responseError(
            response,
            "Upload failed. Please check your connection and try again.",
          ),
        );

        return false;
      }

      const data =
        (await response.json()) as {
          url: string;
        };

      const previousUrl =
        form.image_url;

      pendingUploads.current.add(
        data.url,
      );

      setForm((current) => ({
        ...current,
        image_url: data.url,
      }));

      if (
        previousUrl &&
        pendingUploads.current.has(
          previousUrl,
        )
      ) {
        await cleanupUpload(
          previousUrl,
        );
      }

      return true;
    } catch {
      setError(
        "Upload failed. Please check your connection and try again.",
      );

      return false;
    } finally {
      setUploading(false);
    }
  };

  const useCroppedImage = async (
    file: File,
  ) => {
    if (await uploadImage(file)) {
      closeCropper();
    }
  };

  const removeFormImage =
    async () => {
      const url = form.image_url;

      if (
        url &&
        pendingUploads.current.has(
          url,
        ) &&
        !(await cleanupUpload(url))
      ) {
        return;
      }

      setForm((current) => ({
        ...current,
        image_url: "",
      }));
    };

  const validateForm = () => {
    if (!form.title.trim()) {
      return "Title is required.";
    }

    if (!form.event_at) {
      return "Event date and time are required.";
    }

    if (
      Number.isNaN(
        new Date(
          form.event_at,
        ).getTime(),
      )
    ) {
      return "Please enter a valid event date and time.";
    }

    if (!form.summary.trim()) {
      return "One-line summary is required.";
    }

    if (!form.show_until) {
      return "Show-until date and time are required.";
    }

    if (
      Number.isNaN(
        new Date(
          form.show_until,
        ).getTime(),
      )
    ) {
      return "Please enter a valid Show until date and time.";
    }

    if (
      Boolean(
        form.button_label.trim(),
      ) !==
      Boolean(
        form.button_url.trim(),
      )
    ) {
      return "Button label and link must be supplied together.";
    }

    if (
      form.button_url.trim()
    ) {
      try {
        const protocol = new URL(
          form.button_url.trim(),
        ).protocol;

        if (
          protocol !== "http:" &&
          protocol !== "https:"
        ) {
          return "Button link must use HTTP or HTTPS.";
        }
      } catch {
        return "Button link must be a valid URL.";
      }
    }

    return null;
  };

  const save = async () => {
    if (
      saving ||
      uploading ||
      preparingImage
    ) {
      return;
    }

    const validationError =
      validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const editing = Boolean(editId);

    try {
      const payload = {
        title: form.title.trim(),

        event_at:
          toValidISOString(
            form.event_at,
            "event",
          ),

        summary:
          form.summary.trim(),

        image_url:
          form.image_url || null,

        button_label:
          form.button_label.trim() ||
          null,

        button_url:
          form.button_url.trim() ||
          null,

        show_until:
          toValidISOString(
            form.show_until,
            "Show until",
          ),

        active: editId
          ? items.find(
              (item) =>
                item.id === editId,
            )?.active ?? true
          : true,
      };

      const response =
        await adminFetch(
          "/api/admin/happenings",
          {
            method: editId
              ? "PATCH"
              : "POST",

            body: JSON.stringify(
              editId
                ? {
                    id: editId,
                    ...payload,
                  }
                : payload,
            ),
          },
        );

      if (!response.ok) {
        setError(
          await responseError(
            response,
            "Happening post could not be saved.",
          ),
        );

        return;
      }

      const saved =
        (await response.json()) as HappeningItem;

      if (saved.image_url) {
        pendingUploads.current.delete(
          saved.image_url,
        );
      }

      const cleaned =
        await cleanupPendingUploads();

      resetForm();

      setNotice(
        editing
          ? "Happening post updated."
          : "Happening post published.",
      );

      await load();

      if (!cleaned) {
        setError(
          "Post saved, but an abandoned upload could not be removed. Refresh and try again.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error &&
          caught.message
          ? caught.message
          : "Happening post could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (
    item: HappeningItem,
  ) => {
    setChangingId(item.id);
    setError(null);
    setNotice(null);

    try {
      const response =
        await adminFetch(
          "/api/admin/happenings",
          {
            method: "PATCH",

            body: JSON.stringify({
              id: item.id,
              title: item.title,
              event_at:
                item.event_at,
              summary: item.summary,
              image_url:
                item.image_url,
              button_label:
                item.button_label,
              button_url:
                item.button_url,
              show_until:
                item.show_until,
              active: !item.active,
            }),
          },
        );

      if (!response.ok) {
        setError(
          await responseError(
            response,
            "Happening visibility could not be changed.",
          ),
        );

        return;
      }

      setNotice(
        item.active
          ? "Happening post hidden."
          : "Happening post is live.",
      );

      await load();
    } catch {
      setError(
        "Happening visibility could not be changed.",
      );
    } finally {
      setChangingId(null);
    }
  };

  const deleteItem = async (
    item: HappeningItem,
  ) => {
    if (
      !confirm(
        `Delete “${item.title}”?`,
      )
    ) {
      return;
    }

    if (
      editId === item.id &&
      !(await cleanupPendingUploads())
    ) {
      return;
    }

    setDeletingId(item.id);
    setError(null);
    setNotice(null);

    try {
      const response =
        await adminFetch(
          "/api/admin/happenings",
          {
            method: "DELETE",

            body: JSON.stringify({
              id: item.id,
            }),
          },
        );

      if (!response.ok) {
        setError(
          await responseError(
            response,
            "Happening post could not be deleted.",
          ),
        );

        return;
      }

      if (editId === item.id) {
        resetForm();
      }

      setNotice(
        "Happening post deleted.",
      );

      await load();
    } catch {
      setError(
        "Happening post could not be deleted.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const now = Date.now();

  const liveCount = items.filter(
    (item) =>
      item.active &&
      Date.parse(
        item.show_until,
      ) > now,
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      {cropSource && (
        <HappeningImageCropper
          sourceUrl={
            cropSource.url
          }
          sourceName={
            cropSource.name
          }
          onCancel={
            closeCropper
          }
          onUse={
            useCroppedImage
          }
        />
      )}

      <div className="mb-6 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Homepage
          </p>

          <h2 className="mt-2 font-heading text-3xl font-extrabold uppercase leading-none text-foreground sm:text-4xl">
            Happening
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            {liveCount} of 3
            live on the homepage
          </p>
        </div>

        {!showForm && (
          <button
            type="button"
            onClick={() =>
              void startCreate()
            }
            className={`${primaryButton} justify-center`}
          >
            <Plus className="h-4 w-4" />
            New post
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
        >
          {notice}
        </p>
      )}

      {showForm && (
        <div className="mb-8 space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h3 className="font-heading text-2xl font-extrabold uppercase leading-none text-foreground">
            {editId
              ? "Edit Happening post"
              : "New Happening post"}
          </h3>

          <div>
            <label
              className={
                labelClass
              }
              htmlFor="happening-title"
            >
              Title
            </label>

            <input
              id="happening-title"
              className={
                inputClass
              }
              maxLength={120}
              value={form.title}
              onChange={(
                event,
              ) =>
                setForm(
                  (current) => ({
                    ...current,
                    title:
                      event.target
                        .value,
                  }),
                )
              }
            />
          </div>

          <div>
            <label
              className={
                labelClass
              }
              htmlFor="happening-when"
            >
              When
            </label>

            <input
              id="happening-when"
              type="datetime-local"
              className={
                inputClass
              }
              value={
                form.event_at
              }
              onChange={(
                event,
              ) =>
                setForm(
                  (current) => ({
                    ...current,
                    event_at:
                      event.target
                        .value,
                  }),
                )
              }
            />
          </div>

          <div>
            <label
              className={
                labelClass
              }
              htmlFor="happening-summary"
            >
              One line
            </label>

            <textarea
              id="happening-summary"
              className={`${inputClass} min-h-24 resize-y`}
              maxLength={240}
              value={
                form.summary
              }
              onChange={(
                event,
              ) =>
                setForm(
                  (current) => ({
                    ...current,

                    summary:
                      event.target.value.replace(
                        /[\r\n]+/g,
                        " ",
                      ),
                  }),
                )
              }
            />

            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {
                form.summary
                  .length
              }
              /240
            </p>
          </div>

          <div>
            <span
              className={
                labelClass
              }
            >
              Image (optional)
            </span>

            {form.image_url ? (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <Image
                  src={
                    form.image_url
                  }
                  alt="Happening preview"
                  width={960}
                  height={600}
                  unoptimized
                  className="aspect-[8/5] w-full object-cover"
                />

                <div className="flex flex-wrap gap-2 p-3">
                  <label
                    className={`${ghostButton} cursor-pointer justify-center`}
                  >
                    Replace photo

                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                      className="sr-only"
                      disabled={
                        uploading ||
                        preparingImage
                      }
                      onChange={(
                        event,
                      ) => {
                        const file =
                          event
                            .target
                            .files?.[0];

                        if (
                          file
                        ) {
                          void chooseImage(
                            file,
                          );
                        }

                        event.target.value =
                          "";
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      void removeFormImage()
                    }
                    disabled={
                      uploading ||
                      preparingImage
                    }
                    className={
                      dangerButton
                    }
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background px-4 text-center text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <ImagePlus className="mb-2 h-5 w-5" />

                {preparingImage
                  ? "Preparing…"
                  : uploading
                    ? "Uploading…"
                    : "+ Add photo"}

                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  className="sr-only"
                  disabled={
                    uploading ||
                    preparingImage
                  }
                  onChange={(
                    event,
                  ) => {
                    const file =
                      event.target
                        .files?.[0];

                    if (file) {
                      void chooseImage(
                        file,
                      );
                    }

                    event.target.value =
                      "";
                  }}
                />
              </label>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className={
                  labelClass
                }
                htmlFor="happening-button-label"
              >
                Button label
                (optional)
              </label>

              <input
                id="happening-button-label"
                className={
                  inputClass
                }
                maxLength={50}
                value={
                  form.button_label
                }
                onChange={(
                  event,
                ) =>
                  setForm(
                    (current) => ({
                      ...current,

                      button_label:
                        event
                          .target
                          .value,
                    }),
                  )
                }
              />
            </div>

            <div>
              <label
                className={
                  labelClass
                }
                htmlFor="happening-button-url"
              >
                Button link
                (optional)
              </label>

              <input
                id="happening-button-url"
                type="url"
                inputMode="url"
                className={
                  inputClass
                }
                maxLength={2048}
                value={
                  form.button_url
                }
                onChange={(
                  event,
                ) =>
                  setForm(
                    (current) => ({
                      ...current,

                      button_url:
                        event
                          .target
                          .value,
                    }),
                  )
                }
                placeholder="https://"
              />
            </div>
          </div>

          <div>
            <label
              className={
                labelClass
              }
              htmlFor="happening-show-until"
            >
              Show until
            </label>

            <input
              id="happening-show-until"
              type="datetime-local"
              className={
                inputClass
              }
              value={
                form.show_until
              }
              onChange={(
                event,
              ) =>
                setForm(
                  (current) => ({
                    ...current,

                    show_until:
                      event.target
                        .value,
                  }),
                )
              }
            />
          </div>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() =>
                void save()
              }
              disabled={
                saving ||
                uploading ||
                preparingImage
              }
              className={`${primaryButton} min-h-12 justify-center sm:flex-1`}
            >
              {saving
                ? "Saving…"
                : editId
                  ? "Update →"
                  : "Publish →"}
            </button>

            <button
              type="button"
              onClick={() =>
                void cancelForm()
              }
              disabled={
                saving ||
                uploading ||
                preparingImage
              }
              className={`${ghostButton} min-h-12 justify-center sm:px-6`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm font-extrabold uppercase tracking-[0.14em] text-foreground">
          Live on the homepage
          (max 3)
        </h3>

        <button
          type="button"
          onClick={() =>
            void load()
          }
          className={
            ghostButton
          }
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          No Happening posts yet.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const expired =
              Date.parse(
                item.show_until,
              ) <= now;

            const live =
              item.active &&
              !expired;

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-heading text-lg font-extrabold uppercase leading-tight text-foreground">
                      {item.title}
                    </h4>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(
                        item.event_at,
                      ).toLocaleString()}{" "}
                      · shows until{" "}
                      {new Date(
                        item.show_until,
                      ).toLocaleString()}
                    </p>

                    <p className="mt-2 text-sm text-muted-foreground">
                      {
                        item.summary
                      }
                    </p>
                  </div>

                  <span
                    className={`shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                      live
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {live
                      ? "Live"
                      : expired
                        ? "Expired"
                        : "Hidden"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void startEdit(
                        item,
                      )
                    }
                    disabled={
                      changingId ===
                        item.id ||
                      deletingId ===
                        item.id ||
                      uploading ||
                      saving
                    }
                    className={`${ghostButton} justify-center`}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void toggleActive(
                        item,
                      )
                    }
                    disabled={
                      changingId ===
                        item.id ||
                      deletingId ===
                        item.id
                    }
                    className={`${ghostButton} justify-center`}
                  >
                    {changingId ===
                    item.id
                      ? "…"
                      : item.active
                        ? "Hide"
                        : "Unhide"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteItem(
                        item,
                      )
                    }
                    disabled={
                      deletingId ===
                        item.id ||
                      changingId ===
                        item.id
                    }
                    className={`${dangerButton} justify-center`}
                  >
                    <Trash2 className="h-3 w-3" />

                    {deletingId ===
                    item.id
                      ? "…"
                      : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}