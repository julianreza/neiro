"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label?: string;
  /** Options with the same group share a heading. */
  group?: string;
  /** Small text after the label, e.g. "Laya's pick". */
  hint?: string;
};

/**
 * The one dropdown of the app: a pressed-in field that opens a raised list.
 * Long lists get a search box; `allowCustom` lets the user type a value that
 * is not in the list.
 */
export function Picker({
  id,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  size = "default",
  searchable,
  searchPlaceholder = "Search…",
  allowCustom = false,
  emptyText = "Nothing matches.",
  mono = false,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  size?: "default" | "sm";
  searchable?: boolean;
  searchPlaceholder?: string;
  allowCustom?: boolean;
  emptyText?: string;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const withSearch = searchable ?? (allowCustom || options.length > 8);
  const selected = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const map = new Map<string, PickerOption[]>();
    for (const o of options) map.set(o.group ?? "", [...(map.get(o.group ?? "") ?? []), o]);
    return [...map.entries()];
  }, [options]);
  const typed = search.trim();
  const custom = allowCustom && typed !== "" && !options.some((o) => o.value === typed);

  function pick(next: string) {
    onChange(next);
    setSearch("");
    setOpen(false);
  }

  return (
    // modal: forms live in Dialogs, which would otherwise block scrolling the list.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          data-slot="select-trigger"
          data-size={size}
          className={cn("picker-trigger", className)}
        >
          <span className={cn("truncate", !selected && !value && "text-muted-foreground", mono && "font-mono text-xs")}>
            {selected ? (selected.label ?? selected.value) : value || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="picker-panel">
        <Command>
          {withSearch && <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />}
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {custom && (
              <CommandGroup heading="Custom">
                <CommandItem value={`custom:${typed}`} onSelect={() => pick(typed)}>
                  Use “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([group, items]) => (
              <CommandGroup key={group || "_"} heading={group || undefined}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.value} ${o.label ?? ""}`}
                    keywords={group ? [group] : undefined}
                    onSelect={() => pick(o.value)}
                    data-checked={o.value === value}
                  >
                    <span className={cn("flex-1 truncate", mono && o.value && "font-mono text-xs")}>
                      {o.label ?? o.value}
                    </span>
                    {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
