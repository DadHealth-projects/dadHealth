"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import { NAV_LINKS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useProStatus } from "@/components/ProProvider";
import { initialsFromDisplayName, resolveDisplayName } from "@/lib/userDisplay";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, User, Settings, HelpCircle, Shield, CreditCard, Package } from "lucide-react";

const SiteHeader = () => {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { user, signOut, openAuthModal } = useAuth();
  const { isPro } = useProStatus();
  const { data: profile } = useUserProfile(user?.id);

  const resolvedName = resolveDisplayName(profile, user);
  const avatarInitials = initialsFromDisplayName(resolvedName, user?.email);
  const getNavHref = (href: string) => (user && href === "/" ? "/home" : href);
  const isNavActive = (href: string) => {
    if (href === "/" && pathname === "/home") return true;
    return pathname === href;
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    try {
      setIsSigningOut(true);
      await signOut();
    } catch (error) {
      console.error("Sign out failed", error);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full shrink-0 bg-black border-b border-white/10">
      <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
        <Link href="/" className="inline-flex shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm">
          <Logo />
        </Link>

        <nav className="hidden md:flex flex-wrap items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={getNavHref(link.href)}
              className={cn(
                "font-heading text-[11px] font-bold tracking-[1.5px] uppercase transition-colors duration-200",
                isNavActive(link.href)
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 max-w-full items-center gap-3">
          {user && isPro ? (
            <span
              className="hidden lg:inline-flex font-heading text-[10px] font-bold tracking-wider uppercase text-primary-foreground bg-primary border border-primary px-2 py-0.5"
              title="Dad Health Pro is active"
            >
              PRO
            </span>
          ) : (
            <Link
              href="/pricing"
              className="hidden lg:inline-flex font-heading text-[10px] font-bold tracking-wider uppercase text-primary border border-primary px-2 py-0.5 hover:bg-primary hover:text-primary-foreground transition-all duration-200"
            >
              GO PRO
            </Link>
          )}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  aria-label="Open profile menu"
                >
                  <span className="w-8 h-8 rounded-full bg-primary/20 border border-primary flex items-center justify-center font-heading text-xs font-bold text-primary">
                    {avatarInitials}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{resolvedName || "KB Profile"}</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                  <Link href="/progress" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link href="/pricing" className="cursor-pointer">
                    <Package className="mr-2 h-4 w-4" />
                    My Plan
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem disabled>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Billing
                </DropdownMenuItem>

                <DropdownMenuItem disabled>
                  <Shield className="mr-2 h-4 w-4" />
                  Privacy & Security
                </DropdownMenuItem>

                <DropdownMenuItem disabled>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Help
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={handleSignOut} disabled={isSigningOut} className="text-red-400 focus:text-red-400">
                  <LogOut className="mr-2 h-4 w-4" />
                  {isSigningOut ? "Signing out..." : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              onClick={openAuthModal}
              className="bg-primary text-primary-foreground font-heading font-bold text-[11px] tracking-wider uppercase px-4 py-2.5 hover:brightness-110 hover:shadow-[0_0_20px_hsl(78,89%,65%,0.3)] transition-all duration-200"
            >
              START FREE — 7 DAYS
            </button>
          )}

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-foreground p-1 cursor-pointer bg-transparent border-none"
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav */}

      {mobileOpen && (
        <nav className="md:hidden border-t border-border bg-background px-5 py-4 space-y-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={getNavHref(link.href)}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block font-heading text-[12px] font-bold tracking-[1.5px] uppercase py-2 transition-colors",
                isNavActive(link.href)
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          {user && (
            <Link
              href="/settings"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block font-heading text-[12px] font-bold tracking-[1.5px] uppercase py-2 transition-colors",
                pathname === "/settings" ? "text-primary" : "text-muted-foreground"
              )}
            >
              Settings
            </Link>
          )}
        </nav>
      )}
    </header>
  );
};

export default SiteHeader;
