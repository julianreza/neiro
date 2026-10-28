"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RECENT_KEY = "neiro.workspace.recent";
const MAX_RECENT = 5;

type Listing = {
  path: string;
  home: string;
  parent: string | null;
  git: boolean;
  entries: { name: string; path: string; git: boolean }[];
};

export function readRecentFolders(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberFolder(path: string) {
  const clean = path.trim();
  if (!clean) return;
  try {
    const next = [clean, ...readRecentFolders().filter((p) => p !== clean)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

function folderName(path: string) {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/** "/Users/me/Documents/app" -> "~/Documents" (the folder the project sits in). */
function shortParent(path: string, home: string | null) {
  const parent = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
  return home && (parent === home || parent.startsWith(`${home}/`)) ? `~${parent.slice(home.length)}` : parent;
}

function repoName(url: string) {
  return url.trim().replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "") ?? "";
}

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `Request failed (${res.status})` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** Project folder for a mission or question: recent folders, a folder browser, or a fresh clone. */
export function FolderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const [recent, setRecent] = useState<string[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"folder" | "clone" | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState("");

  async function browse(path?: string) {
    setLoading(true);
    setBrowseError("");
    const res = await post<Listing>("/api/folders", { path });
    setLoading(false);
    if (!res.ok) {
      setBrowseError(res.error);
      return;
    }
    setListing(res.data);
    setHome(res.data.home);
  }

  function open(kind: "folder" | "clone") {
    setDialog(kind);
    setCloneError("");
    const start = kind === "clone" && value ? value.replace(/\/+$/, "").split("/").slice(0, -1).join("/") : value;
    browse(start || undefined);
  }

  function pick(path: string) {
    onChange(path);
    rememberFolder(path);
    setRecent(readRecentFolders());
  }

  async function clone() {
    if (!listing) return;
    setCloning(true);
    setCloneError("");
    const res = await post<{ path: string; name: string }>("/api/folders/clone", {
      url: url.trim(),
      parent: listing.path,
      name: name.trim() || undefined,
    });
    setCloning(false);
    if (!res.ok) {
      setCloneError(res.error);
      return;
    }
    pick(res.data.path);
    setDialog(null);
    setUrl("");
    setName("");
    setNameTouched(false);
    toast.success(`Cloned ${res.data.name}`);
  }

  const crumbs = listing
    ? (() => {
        const rel = listing.path.slice(listing.home.length).split("/").filter(Boolean);
        return [
          { label: "~", path: listing.home },
          ...rel.map((part, i) => ({ label: part, path: `${listing.home}/${rel.slice(0, i + 1).join("/")}` })),
        ];
      })()
    : [];
  const cloneName = (nameTouched ? name : repoName(url)).trim();

  return (
    <>
      <DropdownMenu onOpenChange={(isOpen) => isOpen && setRecent(readRecentFolders())}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="folder-chip" aria-label={`Project folder: ${value || "none"}. Change`}>
            <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
            {value ? (
              <>
                <span className="font-semibold">{folderName(value)}</span>
                <span className="folder-chip-path">{shortParent(value, home)}</span>
              </>
            ) : (
              <span>Pick a project folder</span>
            )}
            <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {recent.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Recent</DropdownMenuLabel>
              {recent.map((path) => (
                <DropdownMenuItem key={path} onSelect={() => pick(path)}>
                  <Folder className="size-4" aria-hidden="true" />
                  <span className="truncate">{folderName(path)}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                    {path === value ? <Check className="size-3.5" aria-label="Current" /> : shortParent(path, home)}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => open("folder")}>
            <Folder className="size-4" aria-hidden="true" />
            Choose another folder…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open("clone")}>
            <GitBranch className="size-4" aria-hidden="true" />
            Clone a repo…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(isOpen) => !isOpen && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog === "clone" ? "Clone a repo" : "Choose a project folder"}</DialogTitle>
            <DialogDescription>
              {dialog === "clone"
                ? "Neiro runs git clone on this machine, into the folder you open below."
                : "Open the folder of the project. Folders on the machine running Neiro."}
            </DialogDescription>
          </DialogHeader>

          <div className="folder-tabs" role="tablist" aria-label="Folder source">
            {(["folder", "clone"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={dialog === kind}
                onClick={() => setDialog(kind)}
              >
                {kind === "folder" ? <Folder className="size-3.5" /> : <GitBranch className="size-3.5" />}
                {kind === "folder" ? "Choose folder" : "Clone a repo"}
              </button>
            ))}
          </div>

          {dialog === "clone" && (
            <div className="space-y-2">
              <Label htmlFor="clone-url">Repository URL</Label>
              <Input
                id="clone-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <Label htmlFor="clone-name" className="pt-1">
                Folder name
              </Label>
              <Input
                id="clone-name"
                value={nameTouched ? name : repoName(url)}
                onChange={(event) => {
                  setNameTouched(true);
                  setName(event.target.value);
                }}
                placeholder="repo"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <p className="pt-1 text-sm font-medium">Put it in</p>
            </div>
          )}

          <div className="space-y-2">
            <nav aria-label="Folder path" className="folder-crumbs">
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3 opacity-60" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => browse(crumb.path)}
                    aria-current={i === crumbs.length - 1 ? "location" : undefined}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
              {loading && <Loader2 className="ml-1 size-3.5 animate-spin" aria-label="Loading" />}
            </nav>
            <ul className="folder-list" aria-label="Folders">
              {listing?.entries.map((entry) => (
                <li key={entry.path}>
                  <button type="button" onClick={() => browse(entry.path)}>
                    <Folder className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{entry.name}</span>
                    {entry.git && <span className="folder-git">git</span>}
                    <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-50" aria-hidden="true" />
                  </button>
                </li>
              ))}
              {listing && listing.entries.length === 0 && (
                <li className="px-3 py-4 text-sm text-muted-foreground">No folders here.</li>
              )}
            </ul>
            {browseError && (
              <p role="alert" className="text-sm text-destructive">
                {browseError}
              </p>
            )}
          </div>

          {dialog === "clone" && listing && cloneName && (
            <p className="folder-dest">→ {listing.path}/{cloneName}</p>
          )}
          {cloneError && (
            <p role="alert" className="text-sm text-destructive">
              {cloneError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {dialog === "folder" && listing
                ? `${listing.path}${listing.git ? "  ·  git repo" : ""}`
                : "Private repos use git's login on this machine."}
            </span>
            {dialog === "folder" ? (
              <Button
                disabled={!listing || loading}
                onClick={() => {
                  if (!listing) return;
                  pick(listing.path);
                  setDialog(null);
                }}
              >
                <Check className="size-4" />
                Use this folder
              </Button>
            ) : (
              <Button disabled={!listing || !url.trim() || !cloneName || cloning} onClick={clone}>
                {cloning ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}
                {cloning ? "Cloning…" : "Clone here"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
