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
  Search,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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

const navigation = [
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
  return (
    <SidebarProvider className="neiro-console">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4"
      >
        Skip to content
      </a>
      <Sidebar collapsible="icon" className="border-r-border">
        <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-2">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="Neiro home"
          >
            <span className="console-mark flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Network className="size-5" />
            </span>
            <span className="text-xl font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              neiro<span className="text-primary">.</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1">
          <p className="mb-3 px-2 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
            Workspace
          </p>
          <SidebarMenu>
            {navigation.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === href}
                  tooltip={label}
                  className="h-11"
                >
                  <Link href={href}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="card-trendy mt-8 p-4 group-data-[collapsible=icon]:hidden">
            <Layers3 className="mb-3 size-4 text-primary" />
            <p className="text-sm font-medium">A team, not a chatbot.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Plan, build, verify. Give your agents a mission and a place to
              work.
            </p>
            <Link
              href="/agents"
              className="mt-4 flex items-center gap-2 text-xs font-medium"
            >
              Meet your team <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </SidebarContent>
        <SidebarFooter className="gap-4 border-t p-4 group-data-[collapsible=icon]:p-2">
          <Button
            variant="outline"
            className="justify-start text-muted-foreground group-data-[collapsible=icon]:hidden"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" /> Quick navigation{" "}
            <kbd className="ml-auto text-[10px]">⌘ K</kbd>
          </Button>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                OP
              </span>
              <div>
                <p className="text-xs font-medium">Operator workspace</p>
                <p className="text-[10px] text-muted-foreground">
                  Local preview
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="console-main min-w-0">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <span className="h-4 border-l" />
            <span className="text-xs text-muted-foreground">Workspace</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm">
              {navigation.find((item) => item.href === pathname)?.label}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <Activity className="size-3.5" /> Offline preview
            </span>
            <span className="rounded border px-2 py-1 font-mono text-[10px] text-muted-foreground">
              DEMO
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Open command palette"
              onClick={() => setCommandOpen(true)}
            >
              <Command className="size-4" />
            </Button>
          </div>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/30 px-4 py-2.5 text-xs md:px-8">
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
      </SidebarInset>
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
    </SidebarProvider>
  );
}
