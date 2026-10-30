"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  Activity,
  Bot,
  Clock3,
  Command,
  FolderGit2,
  MessagesSquare,
  Inbox,
  LayoutDashboard,
  Network,
  ScanSearch,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { useRole } from "@/hooks/use-role";
import { TiltEffect } from "@/components/tilt-effect";
import { DesktopRail, MobileRail } from "@/components/nav-rail";
import type {
  NavItem,
  RailMemory,
  RailMemoryStore,
} from "@/components/nav-rail";
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
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/reviews", label: "Code review", icon: ScanSearch },
  { href: "/needs-you", label: "Needs you", icon: Inbox },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/agents", label: "AI team", icon: Bot },
  { href: "/schedules", label: "Time AI", icon: Clock3 },
  { href: "/gateway", label: "Gateway", icon: Network },
  { href: "/users", label: "Users", icon: Users },
];

const RAIL_KEY = "neiro.rail.expanded";
const railListeners = new Set<() => void>();

function subscribeRail(listener: () => void) {
  railListeners.add(listener);
  return () => railListeners.delete(listener);
}

/** Expanded by default; only an explicit collapse is remembered. */
function readRail() {
  try {
    return localStorage.getItem(RAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeRail(expanded: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, expanded ? "1" : "0");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  railListeners.forEach((listener) => listener());
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Lives outside the pathname-keyed session, so the nav rail can slide
  // from the previous page's item after the session remounts.
  const railRef = useRef<RailMemory>({ desktopIndex: null, mobileX: null });
  const [railMemory] = useState<RailMemoryStore>(() => ({
    get: (key) => railRef.current[key],
    set: (key, value) => {
      railRef.current[key] = value;
    },
  }));
  return (
    <DashboardSession
      key={pathname}
      pathname={pathname}
      railMemory={railMemory}
    >
      {children}
    </DashboardSession>
  );
}

function DashboardSession({
  children,
  pathname,
  railMemory,
}: {
  children: React.ReactNode;
  pathname: string;
  railMemory: RailMemoryStore;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const railExpanded = useSyncExternalStore(subscribeRail, readRail, () => true);
  const router = useRouter();
  const { setTheme } = useTheme();
  const role = useRole();
  // Waiting count for the phone bar's Needs you badge. The session remounts
  // on every page change, so this refreshes on each navigation.
  const [needsYou, setNeedsYou] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/needs-you", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { count?: unknown } | null) => {
        if (!cancelled) setNeedsYou(Number(data?.count) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
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
    // "New mission" inside a project's Mission control just focuses its prompt.
    const prompt = href === "new-mission" ? document.getElementById("mission-prompt") : null;
    if (prompt) {
      requestAnimationFrame(() => prompt.focus());
    } else {
      router.push(href === "new-mission" ? "/projects" : href);
    }
  }
  async function signOut() {
    const failed = "Could not sign out. Check your connection and try again.";
    try {
      const res = await fetch("/api/auth", { method: "DELETE" });
      if (!res.ok) {
        // The session may still be valid server-side; don't pretend it ended.
        toast.error(failed);
        return;
      }
    } catch {
      toast.error(failed);
      return;
    }
    router.push("/login");
    router.refresh();
  }
  // Viewers cannot manage users, so the Users page is hidden from them.
  const items = role === "viewer" ? navigation.filter((item) => item.href !== "/users") : navigation;
  // A sub-page (e.g. /projects/<id>) lights up its section's menu item.
  const current = items.find((item) => item.href === pathname || pathname.startsWith(`${item.href}/`));
  const section = current?.href ?? pathname;

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
            items={items}
            pathname={section}
            memory={railMemory}
            onSignOut={() => void signOut()}
            expanded={railExpanded}
            onToggle={() => writeRail(!railExpanded)}
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
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <div id="main-content" tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </div>
        </main>
        </div>

        {/* Mobile: same rail, laid out as a floating bottom bar. */}
        <MobileRail
          items={items}
          pathname={section}
          memory={railMemory}
          onSignOut={() => void signOut()}
          badges={{ "/needs-you": needsYou }}
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
              {items.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} onSelect={() => navigate(href)}>
                  <Icon />
                  {label}
                </CommandItem>
              ))}
              <CommandItem onSelect={() => navigate("new-mission")}>
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
