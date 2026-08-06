"use client";

/**
 * Single feed post: parent passes like/save/delete-post + auth only.
 *
 * Comments, nested replies, add/remove comment are **fully internal** via
 * `useComments`, `useAddComment`, `useDeleteComment` — no `reply` / `addComment` props.
 * Expand the thread with the REPLIES control; top-level composer and per-comment Reply
 * require sign-in at submit time.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { COMMUNITY_POST_SUBLINE } from "@/lib/constants";
import {
  ANONYMOUS_AUTHOR_NAME,
  DEFAULT_DISPLAY_FALLBACK,
  initialsFromDisplayName,
  resolveDisplayName,
  type ProfileDisplay,
} from "@/lib/userDisplay";
import { format } from "date-fns";
import {
  BookmarkIcon,
  ChatBubbleLeftRightIcon,
  HandThumbUpIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolidIcon } from "@heroicons/react/24/solid";
import {
  useComments,
  useAddComment,
  useDeleteComment,
  groupCommentThreads,
  threadIdKey,
  type EnrichedComment,
} from "@/hooks/useComments";
import type { User } from "@supabase/supabase-js";
import LimeButton from "@/components/LimeButton";

function safeString(val: unknown, fallback = ""): string {
  if (val == null) return fallback;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function safeNumber(val: unknown, fallback = 0): number {
  if (val == null) return fallback;
  if (typeof val === "number") return val;
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

/** Names / labels from Supabase or enriched comments — never pass through to the DOM raw. */
function safeDisplayName(val: unknown, fallback = DEFAULT_DISPLAY_FALLBACK): string {
  const s = safeString(val, fallback).trim();
  return s.length > 0 ? s : fallback;
}

function safeFormatDate(value: unknown, fmt: string): string | null {
  if (value == null || value === "") return null;
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return format(d, fmt);
  } catch {
    return null;
  }
}

function sameUser(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

type FeedPost = Record<string, unknown>;

type ToggleLikeMutation = {
  mutate: (args: { postId: string; liked: boolean }) => void;
  isPending: boolean;
  variables?: { postId: string; liked: boolean };
};

type ToggleSaveMutation = {
  mutate: (args: { postId: string; saved: boolean }) => void;
  isPending: boolean;
  variables?: { postId: string; saved: boolean };
};

/** Props from `CommunityPage` — thread/reply behaviour is not passed in from the parent. */
interface CommunityFeedPostProps {
  p: FeedPost;
  user: User | null;
  userLikedIds: Set<string>;
  userSavedIds: Set<string>;
  anonymousOwnedIds: Set<string>;
  toggleLike: ToggleLikeMutation;
  toggleSave: ToggleSaveMutation;
  deletePost: { mutate: (id: string) => void; isPending: boolean };
  openAuthModal: () => void;
  /** Current user profile — keeps your posts’ title in sync with settings without refetching every row. */
  viewerProfile?: ProfileDisplay;
}
/** Supabase / JSON may return `id` as string or another serializable type — avoid strict typeof === "string" only. */
function resolvePostId(p: FeedPost): string | null {
  const raw = p.id;
  if (raw == null || raw === "") {
    return null;
  }
  const s = String(raw);
  if (s.length === 0 || s === "[object Object]" || s === "undefined" || s === "null") return null;
  return s;
}

export default function CommunityFeedPost({
  p,
  user,
  userLikedIds,
  userSavedIds,
  anonymousOwnedIds,
  toggleLike,
  toggleSave,
  deletePost,
  openAuthModal,
  viewerProfile,
}: CommunityFeedPostProps) {
  const postId = resolvePostId(p);
  const replyCount = safeNumber(p.replies_count ?? p.replies);
  const [expanded, setExpanded] = useState(() => replyCount > 0);
  const prevReplyCount = useRef(replyCount);
  const [draft, setDraft] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState("");

  useEffect(() => {
    if (replyCount > 0 && prevReplyCount.current === 0) {
      setExpanded(true);
    }
    prevReplyCount.current = replyCount;
  }, [replyCount]);

  const { data: comments = [], isLoading: commentsLoading } = useComments(expanded && postId ? postId : null);
  const { roots, repliesByParentId } = groupCommentThreads(comments);
  const replyingToLabel = useMemo(() => {
    if (!replyingToId) return null;
    const t = comments.find((x) => String(x.id) === String(replyingToId));
    if (!t) return null;
    if (sameUser(t.user_id, user?.id) && !t.anonymous) return "You";
    return safeDisplayName(t.author_label, DEFAULT_DISPLAY_FALLBACK);
  }, [replyingToId, comments, user?.id]);
  const addComment = useAddComment(user?.id);
  const deleteComment = useDeleteComment();

  const isAnon = p.anonymous === true;
  const liked = postId ? userLikedIds.has(postId) : false;
  const saved = postId ? userSavedIds.has(postId) : false;
  const ownerRaw = p.user_id ?? p.author_id;
  const authorUserId =
    ownerRaw != null && ownerRaw !== "" ? safeString(ownerRaw) : null;
  const isOwner = !!(user?.id && ((authorUserId && sameUser(authorUserId, user.id)) || (postId && anonymousOwnedIds.has(postId))));

  const storedName = safeString(p.author_name ?? p.name, "").trim();
  const displayTitle = useMemo(() => {
    if (isAnon) {
      const s = storedName;
      if (!s || s === "Anonymous Dad") return ANONYMOUS_AUTHOR_NAME;
      return s;
    }
    if (isOwner) {
      return resolveDisplayName(viewerProfile, user);
    }
    if (!storedName || storedName === "Dad") return DEFAULT_DISPLAY_FALLBACK;
    return storedName;
  }, [isAnon, isOwner, viewerProfile, storedName, user]);

  const avatarInitials = useMemo(() => {
    if (isAnon) {
      const ai = safeString(p.author_initials ?? p.initials, "?");
      return ai !== "?" && ai.length > 0 ? ai.slice(0, 2).toUpperCase() : "?";
    }
    const raw = safeString(p.author_initials ?? p.initials, "").trim();
    const storedLooksValid =
      raw.length > 0 &&
      raw !== "?" &&
      raw !== "??" &&
      !/^\?+$/.test(raw);
    if (storedLooksValid) {
      return raw.slice(0, 2).toUpperCase();
    }
    const nameForAvatar =
      storedName && storedName !== "Dad" ? storedName : displayTitle;
    return initialsFromDisplayName(nameForAvatar, isOwner ? user?.email : undefined);
  }, [isAnon, isOwner, p.author_initials, p.initials, displayTitle, storedName, user?.email]);

  const shortHandle = useMemo(() => {
    if (isAnon) return null;
    const t = displayTitle.trim();
    if (!t || t === DEFAULT_DISPLAY_FALLBACK) return null;
    const first = t.split(/\s+/).filter(Boolean)[0];
    return first ? first.toLowerCase() : null;
  }, [isAnon, displayTitle]);

  const hasCommentsOrStatus =
    commentsLoading || (roots.length === 0 && replyCount > 0) || roots.length > 0;

  const likeBusy = toggleLike.isPending && toggleLike.variables?.postId === postId;

  useEffect(() => {
    if (!expanded) {
      setReplyingToId(null);
      setInlineDraft("");
    }
  }, [expanded]);

  /** Toggle thread visibility — works without login so comments/replies can be read. */
  const handleReplyClick = () => {
    if (!postId) return;
    setExpanded((e) => !e);
  };

  const handleSubmitTopComment = () => {
    if (!postId) {
      return;
    }
    if (!user?.id) {
      openAuthModal();
      return;
    }
    if (!draft.trim()) return;
    addComment.mutate(
      { postId, content: draft.trim(), userId: user.id, parentId: null },
      { onSuccess: () => setDraft("") }
    );
  };

  const handleSubmitInlineReply = () => {
    if (!postId || !replyingToId) return;
    if (!user?.id) {
      openAuthModal();
      return;
    }
    if (!inlineDraft.trim()) return;
    addComment.mutate(
      { postId, content: inlineDraft.trim(), userId: user.id, parentId: replyingToId },
      {
        onSuccess: () => {
          setInlineDraft("");
          setReplyingToId(null);
        },
      }
    );
  };

  const toggleReplyTo = (commentId: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    setReplyingToId((prev) => {
      if (prev === commentId) {
        setInlineDraft("");
        return null;
      }
      setInlineDraft("");
      return commentId;
    });
  };

  return (
    <div className="relative isolate px-4 sm:px-5 py-3.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className={`w-9 h-9 flex items-center justify-center font-heading text-xs font-extrabold shrink-0 tracking-tight ${
            isAnon
              ? "bg-white/[0.08] border border-white/15 text-muted-foreground"
              : "bg-primary/10 border border-primary text-primary"
          }`}
          title={!isAnon ? displayTitle : undefined}
        >
          {avatarInitials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-heading text-[13px] font-bold text-foreground tracking-wide flex items-center gap-1.5">
            {displayTitle}
            {isAnon && (
              <span className="bg-white/[0.08] border border-white/10 font-heading text-[9px] font-bold tracking-wider text-muted-foreground px-1.5 py-0.5 uppercase">
                ANON
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {safeString(p.author_meta ?? p.meta, isAnon ? "Anonymous · " : COMMUNITY_POST_SUBLINE)}
            {!isAnon && shortHandle && (
              <span className="text-primary/75 normal-case font-heading font-bold tracking-wide ml-1">
                @{shortHandle}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {safeString(p.tag).trim() && <span className="tag-pill">{safeString(p.tag)}</span>}
          {isOwner && postId && (
            <button
              type="button"
              onClick={() => deletePost.mutate(postId)}
              disabled={deletePost.isPending}
              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-sm"
              aria-label="Delete post"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-foreground/70 leading-relaxed mb-3">{safeString(p.body ?? p.content)}</p>
      <div className="relative z-[60] flex flex-wrap gap-2 items-center pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            if (!user) {
              openAuthModal();
              return;
            }
            if (!postId) {
              return;
            }
            toggleLike.mutate({ postId, liked });
          }}
          disabled={likeBusy}
          className={`post-action inline-flex items-center gap-1.5 min-h-9 ${liked ? "text-primary" : ""} ${!postId ? "opacity-50" : ""}`}
        >
          <HandThumbUpIcon className="w-4 h-4 shrink-0" aria-hidden />
          <span>
            {safeNumber(p.likes_count ?? p.respect)} RESPECT
          </span>
        </button>
        <button
          type="button"
          onClick={handleReplyClick}
          aria-expanded={expanded}
          aria-controls={postId ? `post-thread-${postId}` : undefined}
          className={`post-action inline-flex items-center gap-1.5 min-h-9 ${expanded ? "text-primary" : ""} ${!postId ? "opacity-50" : ""}`}
        >
          <ChatBubbleLeftRightIcon className="w-4 h-4 shrink-0" aria-hidden />
                  <span>
            {replyCount} REPLIES
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (!user) {
              openAuthModal();
              return;
            }
            if (!postId) {
              return;
            }
            toggleSave.mutate({ postId, saved });
          }}
          className={`post-action inline-flex items-center gap-1.5 min-h-9 ${saved ? "text-primary" : ""} ${!postId ? "opacity-50" : ""}`}
        >
          {saved ? (
            <BookmarkSolidIcon className="w-4 h-4 shrink-0" aria-hidden />
          ) : (
            <BookmarkIcon className="w-4 h-4 shrink-0" aria-hidden />
          )}
          <span>SAVE</span>
        </button>
      </div>

      {expanded && postId && (
        <div
          id={`post-thread-${postId}`}
          className="mt-2 rounded-md border border-border/60 bg-white/[0.03] p-2.5"
          role="region"
          aria-label="Comments and replies"
        >
          {commentsLoading ? (
            <p className="text-xs text-muted-foreground">Loading replies…</p>
          ) : roots.length === 0 && replyCount > 0 ? (
            <p className="text-xs text-muted-foreground">Couldn’t load replies. Refresh the page.</p>
          ) : roots.length > 0 ? (
            <ul className="list-none m-0 p-0 space-y-4 mb-2">
              {roots.map((c: EnrichedComment, rootIdx: number) => {
                const cid = safeString(c.id);
                const name = sameUser(c.user_id, user?.id) && !c.anonymous
                  ? "You"
                  : safeDisplayName(c.author_label, DEFAULT_DISPLAY_FALLBACK);
                const childReplies = repliesByParentId.get(threadIdKey(c.id)) ?? [];
                const createdLabel = safeFormatDate(c.created_at, "d MMM, h:mm a");
                return (
                  <li key={cid || `root-${rootIdx}`} className="rounded-sm border border-border/50 bg-white/[0.02] p-3">
  <div className="flex gap-2 justify-between items-start text-[12px]">
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
        <span className="font-heading font-bold text-foreground/90">{name}</span>
        {createdLabel && (
          <span className="text-[10px] text-muted-foreground font-normal tabular-nums">
            {createdLabel}
          </span>
        )}
      </div>
      <p className="text-foreground/80 leading-snug m-0 mt-0.5">{safeString(c.content)}</p>
    </div>
                      {sameUser(user?.id, c.user_id) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!user?.id) return;
                            deleteComment.mutate({ commentId: cid, postId, userId: user.id });
                          }}
                          disabled={deleteComment.isPending}
                          className="shrink-0 p-1 text-muted-foreground hover:text-destructive rounded-sm"
                          aria-label="Delete comment"
                        >
                          <TrashIcon className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleReplyTo(cid)}
                        className="font-heading text-[9px] font-bold uppercase tracking-wider text-primary hover:underline"
                      >
                        {replyingToId === cid ? "Cancel" : "Reply"}
                      </button>
                    </div>
                    {replyingToId === cid && user && (
                      <div className="flex flex-col gap-1.5 pt-0.5">
                        {replyingToLabel && (
                          <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wide">
                            Replying to{" "}
                            <span className="text-primary">{safeDisplayName(replyingToLabel, DEFAULT_DISPLAY_FALLBACK)}</span>
                          </p>
                        )}
                        <textarea
                          value={inlineDraft}
                          onChange={(e) => setInlineDraft(e.target.value)}
                          placeholder="Write a reply…"
                          rows={2}
                          className="w-full bg-white/[0.04] border border-border p-2 text-foreground text-xs resize-none outline-none focus:border-primary placeholder:text-muted-foreground/40"
                        />
                        <LimeButton
                          small
                          type="button"
                          className="self-start"
                          onClick={handleSubmitInlineReply}
                          disabled={!inlineDraft.trim() || addComment.isPending}
                        >
                          {addComment.isPending ? "..." : "REPLY"}
                        </LimeButton>
                      </div>
                    )}
                    {childReplies.length > 0 && (
                      <ul className="mt-2 ml-5 pl-3 border-l border-border/70 space-y-3">
                        {childReplies.map((r: EnrichedComment, replyIdx: number) => {
                          const rid = safeString(r.id);
                          const rName =
                            sameUser(r.user_id, user?.id) && !r.anonymous
                              ? "You"
                              : safeDisplayName(r.author_label, DEFAULT_DISPLAY_FALLBACK);
                          const rCreated = safeFormatDate(r.created_at, "d MMM, h:mm a");
                          return (
                            <li key={rid || `reply-${rootIdx}-${replyIdx}`} className="flex gap-2 justify-between items-start text-[11px] text-foreground/75">
                              <span className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                                  <span className="font-heading font-bold text-foreground/85">{rName}</span>
                                  {rCreated && (
                                    <span className="text-[9px] text-muted-foreground font-normal tabular-nums">
                                      {rCreated}
                                    </span>
                                  )}
                                </div>
                                <p className="text-foreground/75 leading-relaxed">{safeString(r.content)}</p>
                              </span>
                              {sameUser(user?.id, r.user_id) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!user?.id) return;
                                    deleteComment.mutate({ commentId: rid, postId, userId: user.id });
                                  }}
                                  disabled={deleteComment.isPending}
                                  className="shrink-0 p-1 text-muted-foreground hover:text-destructive rounded-sm"
                                  aria-label="Delete reply"
                                >
                                  <TrashIcon className="w-3 h-3" aria-hidden />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {user && (
            <div
              className={`flex flex-col gap-1.5 ${hasCommentsOrStatus ? "pt-1.5 mt-1 border-t border-border/40" : "pt-0"}`}
            >
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-heading">
                Add a comment
              </span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What's on your mind?"
                rows={2}
                className="w-full bg-white/[0.04] border border-border px-2 py-1.5 text-foreground text-xs leading-snug resize-none outline-none focus:border-primary placeholder:text-muted-foreground/40 min-h-[2.5rem]"
              />
              <LimeButton
                small
                type="button"
                className="self-start mt-0.5"
                onClick={handleSubmitTopComment}
                disabled={!draft.trim() || addComment.isPending}
              >
                {addComment.isPending ? "..." : "POST"}
              </LimeButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
