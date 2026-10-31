"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type Ref, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/textarea";

export type MentionBot = { handle: string; name: string; role: string };

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  bots: MentionBot[];
  inputRef?: Ref<HTMLTextAreaElement>;
};

/** The "@word" being typed right before the caret, or null. */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([a-z0-9-]*)$/i.exec(before);
  return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null;
}

let botsCache: { at: number; bots: MentionBot[] } | null = null;

/** Every bot's @handle, read once a minute from /api/bots. */
export function useMentionBots(): MentionBot[] {
  const [bots, setBots] = useState<MentionBot[]>(botsCache?.bots ?? []);
  useEffect(() => {
    if (botsCache && Date.now() - botsCache.at < 60_000) return;
    let alive = true;
    fetch("/api/bots")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { bots?: MentionBot[] } | null) => {
        const list = (b?.bots ?? []).map((x) => ({ handle: x.handle, name: x.name, role: x.role }));
        botsCache = { at: Date.now(), bots: list };
        if (alive) setBots(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return bots;
}

/** A text box with an @ picker: type "@" to pick a bot by name or handle. */
export function MentionInput({ value, onValueChange, bots, onKeyDown, inputRef, ...rest }: Props) {
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const mention = closed ? null : activeMention(value, caret);
  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query;
    return bots
      .filter((b) => b.handle.includes(q) || b.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mention, bots]);
  const open = matches.length > 0;
  const current = Math.min(index, Math.max(matches.length - 1, 0));

  function pick(bot: MentionBot, el: HTMLTextAreaElement | null) {
    if (!mention) return;
    const next = `${value.slice(0, mention.start)}@${bot.handle} ${value.slice(caret)}`;
    const pos = mention.start + bot.handle.length + 2;
    onValueChange(next);
    setCaret(pos);
    requestAnimationFrame(() => el?.setSelectionRange(pos, pos));
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setIndex((current + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[current], event.currentTarget);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setClosed(true);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="mention-input">
      <Textarea
        {...rest}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setIndex(0);
          setClosed(false);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={keyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="mention-list" aria-label="Bots to mention">
          {matches.map((bot, i) => (
            <li
              key={bot.handle}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseDown={(event) => {
                event.preventDefault();
                const el = (event.currentTarget.closest(".mention-input")?.querySelector("textarea") ?? null) as HTMLTextAreaElement | null;
                pick(bot, el);
              }}
            >
              <span className="font-mono">@{bot.handle}</span>
              <span className="text-muted-foreground">{bot.name}{bot.role ? ` · ${bot.role}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
