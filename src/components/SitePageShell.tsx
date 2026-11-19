import SiteHeader from "./SiteHeader";

export default function SitePageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full min-w-0 flex-col bg-background text-foreground [overflow-wrap:anywhere]">
      <SiteHeader />
      <main className="flex flex-col w-full min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
