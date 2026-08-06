"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import SitePageShell from "@/components/SitePageShell";
import SiteFooter from "@/components/SiteFooter";
import LimeButton from "@/components/LimeButton";
import { CheckIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/contexts/AuthContext";
import CommunityFeedPost from "@/components/CommunityFeedPost";
import { useCommunity } from "@/hooks/useCommunity";
import { useUserProfile } from "@/hooks/useUserProfile";
import { supabase } from "@/utils/supabaseClient";
import { communityQueryKey } from "@/lib/communityQueryKey";
import {
  ANONYMOUS_AUTHOR_NAME,
  communityPostMeta,
  initialsFromDisplayName,
  resolveDisplayName,
} from "@/lib/userDisplay";

const CommunityPage = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, openAuthModal } = useAuth();
  const { data: profile } = useUserProfile(user?.id);
  const {
    posts,
    dadsCount,
    trendingTags,
    userLikedIds,
    userSavedIds,
    anonymousOwnedIds,
    circles,
    liveSessions,
    userCircleIds,
    createPost,
    toggleLike,
    toggleSave,
    deletePost,
    joinCircle,
  } = useCommunity(user?.id);

  useEffect(() => {
    const channel = supabase
      .channel("community-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        () => {
          queryClient.invalidateQueries({ queryKey: communityQueryKey(user?.id) });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "likes" },
        () => {
          queryClient.invalidateQueries({ queryKey: communityQueryKey(user?.id) });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  const [postBody, setPostBody] = useState("");
  const [postTag, setPostTag] = useState("FITNESS");
  const [postAnon, setPostAnon] = useState(false);

  const displayCircles = circles;
  const displayPosts = posts;

  const handlePost = () => {
    if (!postBody.trim()) return;
    const name = resolveDisplayName(profile, user);
    const initials = postAnon ? "?" : initialsFromDisplayName(name, user?.email);
    createPost.mutate({
      body: postBody.trim(),
      tag: postTag,
      anonymous: postAnon,
      author_initials: initials,
      author_name: postAnon ? ANONYMOUS_AUTHOR_NAME : name,
      author_meta: communityPostMeta(postAnon),
    });
    setPostBody("");
  };

  return (
    <SitePageShell>
      {/* Hero */}
      <section className="bg-primary text-primary-foreground">
        <div className="max-w-[1400px] mx-auto px-5 lg:px-8 py-12">
          <span className="font-heading text-[10px] font-bold tracking-[2.5px] uppercase opacity-60 mb-2 block">
            DAD HEALTH COMMUNITY
          </span>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <h1 className="font-heading text-[42px] lg:text-[56px] font-extrabold uppercase leading-none tracking-wide">
              COMMUNITY FEED
            </h1>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary-foreground" />
              <span className="font-heading text-[11px] font-bold tracking-wider uppercase opacity-70">
                {dadsCount > 0 ? dadsCount.toLocaleString() : "—"} MEMBERS
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-0">
        {/* Left - Circles */}
        <div className="px-5 lg:px-8 py-8 border-r border-border">
          <span className="section-label !p-0 mb-4 block">CIRCLES</span>
          <div className="space-y-3">
            {displayCircles.length > 0 ? displayCircles.map((c: { id: string; icon?: string; name: string; members_count?: number }) => {
              const joined = user && userCircleIds.includes(c.id);
              return (
                <div key={c.id} className="circle-card">
                  <div className="text-xl mb-2">{c.icon}</div>
                  <div className="font-heading text-xs font-extrabold text-foreground tracking-wide mb-1">
                    {c.name}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground">
                      {(c.members_count ?? 0).toLocaleString()} members
                    </span>
                    {user && (
                      <button
                        onClick={() => joinCircle.mutate({ circleId: c.id, join: !joined })}
                        disabled={joinCircle.isPending}
                        className="font-heading text-[9px] font-bold text-primary uppercase tracking-wider cursor-pointer bg-transparent border-none"
                      >
                        {joined ? (
                          <span className="inline-flex items-center gap-0.5 font-heading text-[9px] font-bold text-primary uppercase tracking-wider">
                            JOINED <CheckIcon className="w-3 h-3" aria-hidden />
                          </span>
                        ) : (
                          "JOIN"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            }) : (
              <p className="text-sm text-muted-foreground">No circles yet.</p>
            )}
          </div>
        </div>

        {/* Center - Feed */}
        <div className="border-r border-border">
          {/* Compose */}
          <div className="px-5 py-4 border-b border-border">
            <textarea
              placeholder="Share something with the community…"
              value={postBody}
              onChange={(e) => setPostBody(e.target.value)}
              className="w-full bg-white/[0.04] border border-border p-3 text-foreground text-sm resize-none h-[60px] outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40 mb-2"
            />
            <div className="flex justify-between items-center">
              <div className="flex gap-1.5">
                {["FITNESS", "MIND", "BOND"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setPostTag(t)}
                    className={`tag-pill cursor-pointer ${postTag === t ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    {t}
                  </button>
                ))}
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postAnon}
                    onChange={(e) => setPostAnon(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-[10px] uppercase">Anon</span>
                </label>
              </div>
              <LimeButton
                small
                onClick={handlePost}
                disabled={!user || !postBody.trim() || createPost.isPending}
              >
                {createPost.isPending ? "..." : "POST"}
              </LimeButton>
            </div>
          </div>

          {/* Posts — each row owns comments/replies via hooks; no reply/addComment props */}
          {displayPosts.length > 0 ? displayPosts.map((p: Record<string, unknown>) => (
            <CommunityFeedPost
              key={String(p.id)}
              p={p}
              user={user}
              viewerProfile={profile ?? undefined}
              userLikedIds={userLikedIds}
              userSavedIds={userSavedIds}
              anonymousOwnedIds={anonymousOwnedIds}
              toggleLike={toggleLike}
              toggleSave={toggleSave}
              deletePost={deletePost}
              openAuthModal={openAuthModal}
            />
          )) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">No posts yet. Be the first to share!</p>
            </div>
          )}
        </div>

        {/* Right — expert sessions: no mock data; add CMS or table later */}
        <div className="px-5 lg:px-8 py-8">
          <span className="section-label !p-0 mb-4 block">LIVE SESSIONS</span>
          {liveSessions.length === 0 ? (
            <div className="border border-border border-dashed p-4 mb-3 rounded-sm bg-white/[0.02]">
              <p className="text-sm text-muted-foreground">No live sessions are scheduled yet.</p>
            </div>
          ) : (
            liveSessions.map((session: { id: string; title: string; host_name?: string; starts_at?: string; summary?: string }) => (
              <div key={session.id} className="border border-border p-4 mb-3 rounded-sm bg-white/[0.02]">
                <p className="font-heading text-xs font-bold tracking-wide uppercase text-primary">{session.title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {session.host_name ? `Host: ${session.host_name}` : "Host TBD"}
                  {session.starts_at ? ` · ${new Date(session.starts_at).toLocaleString()}` : ""}
                </p>
                {session.summary && (
                  <p className="text-sm text-foreground/85 leading-relaxed mt-2">{session.summary}</p>
                )}
              </div>
            ))
          )}
          <button
            type="button"
            onClick={() => router.push("/pricing")}
            className="mt-1 font-heading font-bold text-[10px] tracking-wider uppercase text-primary border border-primary px-3 py-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            View Pro
          </button>

          {/* Trending */}
          <div className="mt-6">
            <span className="section-label !p-0 mb-3 block">TRENDING</span>
            {trendingTags.length > 0 ? trendingTags.map((t: { tag: string; count: number }) => (
              <div key={t.tag} className="py-1.5">
                <span className="text-sm text-primary font-medium">{t.tag}</span>
                <span className="text-xs text-muted-foreground ml-2">{t.count}</span>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">No trending tags yet.</p>
            )}
          </div>
        </div>
      </div>

      <SiteFooter />
    </SitePageShell>
  );
};

export default CommunityPage;
