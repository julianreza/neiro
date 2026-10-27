"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Clock3,
  Command,
  Layers3,
  Network,
} from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { TiltEffect } from "@/components/tilt-effect";
import { DesktopRail, MobileRail } from "@/components/nav-rail";
import type { NavItem } from "@/components/nav-rail";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";

const navigation: NavItem[] = [
  { href: "/", label: "Mission control", icon: Layers3 },
  { href: "/agents", label: "AI team", icon: Bot },
  { href: "/schedules", label: "Time AI", icon: Clock3 },
  { href: "/gateway", label: "9Router & VPS", icon: Network },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <DashboardSession key={pathname} pathname={pathname}>
      {children}
    </DashboardSession>
  );
}

function DashboardSession({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  function navigate(href: string) {
    setCommandOpen(false);
    if (href === "/?compose=1" && pathname === "/") {
      requestAnimationFrame(() =>
        document.getElementById("mission-prompt")?.focus(),
      );
    } else {
      router.push(href);
    }
  }
  async function signOut() {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {
      toast.error("Could not sign out. Check your connection and try again.");
      return;
    }
    router.push("/login");
    router.refresh();
  }
  const current = navigation.find((item) => item.href === pathname);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="neiro-console app-canvas min-h-svh p-2 md:p-5">
        <TiltEffect />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4"
        >
          Skip to content
        </a>

        <div className="app-frame flex min-h-[calc(100svh-1rem)] md:min-h-[calc(100svh-2.5rem)]">
        {/* Desktop: floating icon rail with a carved-out active tab. */}
        <aside className="sticky top-5 hidden h-[calc(100svh-2.5rem)] shrink-0 py-5 pl-5 md:flex">
          <DesktopRail
            items={navigation}
            pathname={pathname}
            onSignOut={() => void signOut()}
          />
        </aside>

        <main className="console-main flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 md:h-20 md:px-8">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Workspace</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm">{current?.label}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                <Activity className="size-3.5" /> Offline preview
              </span>
              <span className="rounded border px-2 py-1 text-[10px] font-medium text-muted-foreground">
                Demo
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Open command palette"
                onClick={() => setCommandOpen(true)}
              >
                <Command className="size-4" />
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <div className="mx-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/60 px-4 py-2.5 text-xs md:mx-8">
            <p className="text-muted-foreground">
              <span className="mr-2 font-medium text-foreground">
                Preview workspace
              </span>{" "}
              Sample data. Changes stay in memory; no agents are running.
            </p>
            <Link
              href="/gateway"
              className="inline-flex items-center gap-1 font-medium text-primary"
            >
              Connection setup <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </div>
        </main>
        </div>

        {/* Mobile: same rail, laid out as a floating bottom bar. */}
        <MobileRail
          items={navigation}
          pathname={pathname}
          onSignOut={() => void signOut()}
        />

        <CommandDialog
          open={commandOpen}
          onOpenChange={setCommandOpen}
          title="Workspace commands"
          description="Navigate pages and change your theme."
        >
          <CommandInput
            aria-label="Search workspace commands"
            placeholder="Where do you want to go?"
          />
          <CommandList>
            <CommandEmpty>No matching commands.</CommandEmpty>
            <CommandGroup heading="Workspace">
              {navigation.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} onSelect={() => navigate(href)}>
                  <Icon />
                  {label}
                </CommandItem>
              ))}
              <CommandItem onSelect={() => navigate("/?compose=1")}>
                New mission
              </CommandItem>
              <CommandItem onSelect={() => navigate("/agents")}>
                Restore default AI team · open team manager
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Appearance">
              {["dark", "light", "system"].map((theme) => (
                <CommandItem
                  key={theme}
                  onSelect={() => {
                    setTheme(theme);
                    setCommandOpen(false);
                  }}
                >
                  Switch theme: {theme}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    </TooltipProvider>
  );
}
