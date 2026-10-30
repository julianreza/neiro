"use client";

import { ChevronRight, Clock3, FileCode, FolderOpen } from "lucide-react";
import { timeAgo } from "@/lib/client-api";

function clock(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function took(from: string, to: string): string {
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Under a reply bubble: the time, how long ago, and how long the answer took. */
export function ReplyTime({ at, finishedAt }: { at: string | null | undefined; finishedAt?: string | null }) {
  const time = at ? clock(at) : "";
  if (!at || !time) return null;
  const spent = finishedAt ? took(at, finishedAt) : "";
  return (
    <p className="chat-when">
      <Clock3 aria-hidden="true" />
      <time dateTime={at}>{time}</time>
      <span>· {timeAgo(at)}</span>
      {spent && <span>· took {spent}</span>}
    </p>
  );
}

/** "N files read", folded; opens to a row of file chips. */
export function FilesRead({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <details className="chat-reads">
      <summary>
        <FolderOpen aria-hidden="true" />
        {files.length} {files.length === 1 ? "file" : "files"} read
        <ChevronRight className="chat-reads-chevron" aria-hidden="true" />
      </summary>
      <div>
        {files.map((file) => (
          <code key={file} className="chat-file-chip">
            <FileCode aria-hidden="true" />
            {file}
          </code>
        ))}
      </div>
    </details>
  );
}
