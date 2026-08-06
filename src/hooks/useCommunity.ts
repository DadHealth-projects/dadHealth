"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/utils/supabaseClient";
import { communityQueryKey } from "@/lib/communityQueryKey";
import { trackEvent } from "@/lib/analytics";
import {
  ANONYMOUS_AUTHOR_NAME,
  DEFAULT_DISPLAY_FALLBACK,
  communityPostMeta,
  initialsFromDisplayName,
} from "@/lib/userDisplay";

/** Legacy denormalized values from older clients / DB defaults. */
function normalizeStoredAuthorName(raw: string, anonymous: boolean): string {
  const s = raw.trim();
  if (anonymous) {
    if (!s || s === "Anonymous Dad") return ANONYMOUS_AUTHOR_NAME;
    return s;
  }
  if (!s || s === "Dad") return DEFAULT_DISPLAY_FALLBACK;
  return s;
}

/** Normalize denormalized author fields; recompute initials from resolved name (matches avatar + title). */
function enrichCommunityPostRow(p: Record<string, unknown>): Record<string, unknown> {
  const anon = p.anonymous === true;
  const name = normalizeStoredAuthorName(String(p.author_name ?? ""), anon);
  const initials = anon
    ? String(p.author_initials ?? "?").slice(0, 2).toUpperCase()
    : initialsFromDisplayName(name, undefined);
  return {
    ...p,
    author_name: name,
    author_initials: initials,
    body: p.content ?? p.body,
  };
}

async function fetchPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, content, tag, anonymous, author_initials, author_name, author_meta, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const posts = (data ?? []) as Record<string, unknown>[];
  const postIds = posts.map((p: { id: unknown }) => String(p.id)).filter((id) => id.length > 0 && id !== "undefined" && id !== "null");
  if (postIds.length === 0) {
    return posts.map((p: Record<string, unknown>) => {
      const enriched = enrichCommunityPostRow(p);
      return { ...enriched, likes_count: 0, replies_count: 0 };
    });
  }
  const [likesRes, commentsRes] = await Promise.all([
    supabase.from("likes").select("post_id").in("post_id", postIds),
    supabase.from("comments").select("post_id").in("post_id", postIds),
  ]);
  if (likesRes.error) throw likesRes.error;
  if (commentsRes.error) throw commentsRes.error;

  const likeCounts: Record<string, number> = {};
  (likesRes.data ?? []).forEach((r: { post_id: unknown }) => {
    const pid = String(r.post_id);
    likeCounts[pid] = (likeCounts[pid] ?? 0) + 1;
  });
  const commentCounts: Record<string, number> = {};
  (commentsRes.data ?? []).forEach((r: { post_id: unknown }) => {
    const pid = String(r.post_id);
    commentCounts[pid] = (commentCounts[pid] ?? 0) + 1;
  });
  return posts.map((p: Record<string, unknown>) => {
    const id = String(p.id);
    const enriched = enrichCommunityPostRow(p);
    return {
      ...enriched,
      likes_count: likeCounts[id] ?? 0,
      replies_count: commentCounts[id] ?? 0,
    };
  });
}

function aggregateTrendingFromPosts(posts: { tag?: string }[]) {
  const tagCounts: Record<string, number> = {};
  posts.forEach((p) => {
    if (!p.tag) return;
    const tag = `#${p.tag}`;
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  });
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

/** Dads count + trending tags from DB (RPC over all posts); falls back to last page of posts if RPC missing. */
async function fetchCommunityStats() {
  const [{ count: dadsCount, error: dadsError }, rpcRes] = await Promise.all([
    supabase.from("user_profile").select("id", { count: "exact", head: true }),
    supabase.rpc("trending_post_tags", { limit_n: 5 }),
  ]);

  let trendingTags: { tag: string; count: number }[] = [];
  if (!rpcRes.error && rpcRes.data && (rpcRes.data as { tag: string; count: number }[]).length > 0) {
    trendingTags = (rpcRes.data as { tag: string; count: number }[]).map((r) => ({
      tag: `#${r.tag}`,
      count: Number(r.count),
    }));
  } else {
    const posts = await fetchPosts();
    trendingTags = aggregateTrendingFromPosts(posts as { tag?: string }[]);
  }

  return { dadsCount: dadsError ? 0 : (dadsCount ?? 0), trendingTags };
}

export function useCommunity(userId?: string) {
  const queryClient = useQueryClient();

  const { data: postsData, isLoading } = useQuery({
    queryKey: communityQueryKey(userId),
    queryFn: fetchPosts,
  });

  const { data: communityStats } = useQuery({
    queryKey: ["community_stats"],
    queryFn: fetchCommunityStats,
  });

  const userLikesQuery = useQuery({
    queryKey: ["user_likes", userId],
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase.from("likes").select("post_id").eq("user_id", userId);
      if (error) throw error;
      return new Set((data ?? []).map((r: { post_id: unknown }) => String(r.post_id)));
    },
    enabled: !!userId,
  });

  const userSavesQuery = useQuery({
    queryKey: ["user_saves", userId],
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase.from("saved_posts").select("post_id").eq("user_id", userId);
      // Missing table / migration: keep rest of community working
      if (error) {
        return new Set<string>();
      }
      return new Set((data ?? []).map((r: { post_id: unknown }) => String(r.post_id)));
    },
    enabled: !!userId,
  });

  const anonymousOwnersQuery = useQuery({
    queryKey: ["anonymous_post_owners", userId],
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase.from("anonymous_post_owners").select("post_id").eq("user_id", userId);
      if (error) return new Set<string>();
      return new Set((data ?? []).map((row: { post_id: unknown }) => String(row.post_id)));
    },
    enabled: !!userId,
  });

  const circlesQuery = useQuery({
    queryKey: ["circles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("circles").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const liveSessionsQuery = useQuery({
    queryKey: ["live_sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_sessions")
        .select("id, title, starts_at, host_name, summary")
        .order("starts_at", { ascending: true })
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
  });

  const userCirclesQuery = useQuery({
    queryKey: ["user_circles", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase.from("user_circles").select("circle_id").eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.circle_id);
    },
    enabled: !!userId,
  });

  useEffect(() => {
    const invalidateCommunity = () => {
      queryClient.invalidateQueries({ queryKey: ["community"] });
      queryClient.invalidateQueries({ queryKey: ["community_stats"] });
    };
    const channel = supabase
      .channel("community-posts")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, invalidateCommunity)
      .on("postgres_changes", { event: "*", schema: "public", table: "likes" }, () => {
        invalidateCommunity();
        queryClient.invalidateQueries({ queryKey: ["user_likes", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, invalidateCommunity)
      .on("postgres_changes", { event: "*", schema: "public", table: "saved_posts" }, () => {
        invalidateCommunity();
        queryClient.invalidateQueries({ queryKey: ["user_saves", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_circles" }, () => {
        queryClient.invalidateQueries({ queryKey: ["user_circles", userId] });
        queryClient.invalidateQueries({ queryKey: ["circles"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  const createPost = useMutation({
    mutationFn: async ({
      body,
      tag,
      anonymous,
      author_initials,
      author_name,
      author_meta,
    }: {
      body: string;
      tag: string;
      anonymous: boolean;
      author_initials?: string;
      author_name?: string;
      author_meta?: string;
    }) => {
      const resolvedName = anonymous
        ? ANONYMOUS_AUTHOR_NAME
        : (author_name?.trim() || DEFAULT_DISPLAY_FALLBACK);
      const resolvedMeta = (author_meta?.trim() || communityPostMeta(!!anonymous)) as string;
      const resolvedInitials = anonymous
        ? "?"
        : String(author_initials ?? "").trim().length > 0
          ? String(author_initials).slice(0, 2).toUpperCase()
          : initialsFromDisplayName(resolvedName, undefined);
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: anonymous ? null : userId,
          content: body,
          tag,
          anonymous: !!anonymous,
          author_initials: resolvedInitials,
          author_name: resolvedName,
          author_meta: resolvedMeta,
        })
        .select()
        .single();
      if (error) throw error;
      trackEvent("community_post_created", {
        tag,
        anonymous: !!anonymous,
        content_length: body.length,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: communityQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: ["community_stats"] });
      queryClient.invalidateQueries({ queryKey: ["anonymous_post_owners", userId] });
    },
  });

  /** Like / unlike — separate from save; variables are always `{ postId, liked }`. */
  const toggleLike = useMutation({
    mutationFn: async ({ postId, liked }: { postId: string; liked: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      const pid = String(postId);
      if (liked) {
        const { error } = await supabase.from("likes").delete().eq("user_id", userId).eq("post_id", pid);
        if (error) throw error;
        trackEvent("like_clicked", {
          action: "unlike",
          post_id: pid,
        });
      } else {
        const { error } = await supabase.from("likes").insert({ user_id: userId, post_id: pid });
        if (error) throw error;
        trackEvent("like_clicked", {
          action: "like",
          post_id: pid,
        });
      }
    },
    onMutate: async ({ postId, liked }) => {
      const pid = String(postId);
      const ck = communityQueryKey(userId);
      await queryClient.cancelQueries({ queryKey: ck });
      await queryClient.cancelQueries({ queryKey: ["user_likes", userId] });
      const prevPosts = queryClient.getQueryData<Record<string, unknown>[]>(ck);
      const prevLikes = queryClient.getQueryData<Set<string>>(["user_likes", userId]);
      queryClient.setQueryData<Record<string, unknown>[]>(ck, (old) => {
        if (!old) return old;
        return old.map((row) => {
          if (String(row.id) !== pid) return row;
          const n = Number(row.likes_count ?? 0);
          const delta = liked ? -1 : 1;
          return { ...row, likes_count: Math.max(0, n + delta) };
        });
      });
      queryClient.setQueryData<Set<string>>(["user_likes", userId], (old) => {
        const next = new Set(old ?? []);
        if (liked) next.delete(pid);
        else next.add(pid);
        return next;
      });
      return { prevPosts, prevLikes };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevPosts !== undefined) queryClient.setQueryData(communityQueryKey(userId), ctx.prevPosts);
      if (ctx?.prevLikes !== undefined) queryClient.setQueryData(["user_likes", userId], ctx.prevLikes);
      toast.error("Could not update respect");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["community"] });
      queryClient.invalidateQueries({ queryKey: ["user_likes", userId] });
    },
  });

  /** Save / unsave — separate from like; variables are always `{ postId, saved }` (includes `user_id` for RLS). */
  const toggleSave = useMutation({
    mutationFn: async ({ postId, saved }: { postId: string; saved: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      const pid = String(postId);
      if (saved) {
        const { error } = await supabase.from("saved_posts").delete().eq("user_id", userId).eq("post_id", pid);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("saved_posts").insert({ user_id: userId, post_id: pid });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community"] });
      queryClient.invalidateQueries({ queryKey: ["user_saves", userId] });
    },
    onError: () => {
      toast.error("Could not save");
    },
  });

  const deletePost = useMutation({
    mutationFn: async (postId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.rpc("delete_own_community_post", { p_post_id: postId });
      if (error || data !== true) throw error ?? new Error("Post could not be deleted");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community"] });
      queryClient.invalidateQueries({ queryKey: ["community_stats"] });
    },
    onError: () => toast.error("Could not delete post"),
  });

  const joinCircle = useMutation({
    mutationFn: async ({ circleId, join }: { circleId: string; join: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      if (join) {
        const { error } = await supabase.from("user_circles").insert({ user_id: userId, circle_id: circleId });
        if (error) throw error;
        trackEvent("circle_joined", {
          circle_id: circleId,
        });
      } else {
        const { error } = await supabase.from("user_circles").delete().eq("user_id", userId).eq("circle_id", circleId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user_circles", userId] });
      queryClient.invalidateQueries({ queryKey: ["circles"] });
    },
  });

  return {
    posts: postsData ?? [],
    dadsCount: communityStats?.dadsCount ?? 0,
    trendingTags: communityStats?.trendingTags ?? [],
    userLikedIds: userLikesQuery.data ?? new Set<string>(),
    userSavedIds: userSavesQuery.data ?? new Set<string>(),
    anonymousOwnedIds: anonymousOwnersQuery.data ?? new Set<string>(),
    circles: circlesQuery.data ?? [],
    liveSessions: liveSessionsQuery.data ?? [],
    userCircleIds: userCirclesQuery.data ?? [],
    loading: isLoading,
    createPost,
    toggleLike,
    toggleSave,
    deletePost,
    joinCircle,
  };
}
