"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { KeyRound, ShieldAlert, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";

/** What the "You" lane on the rail reflects. */
type LoginStatus = "idle" | "typing" | "pending" | "error";

/** The agent lanes, in the same order as the AI team screen. */
const TEAM_LANES = [
  "Orchestrator",
  "Specification",
  "Workers",
  "QA",
  "Reviewer",
] as const;

function LoginForm({
  onStatusChange,
}: {
  onStatusChange: (status: LoginStatus) => void;
}) {
  const searchParams = useSearchParams();
  const nextUrl = searchParams?.get("next") || "/";

  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fail(message: string) {
    setError(message);
    onStatusChange("error");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!passcode) return;

    setError(null);
    onStatusChange("pending");
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          fail(data?.error || "That passcode didn't work. Check it and try again.");
          return;
        }

        window.location.href = nextUrl;
      } catch {
        fail("Couldn't reach Neiro. Check your connection and try again.");
      }
    });
  }

  const isEmpty = passcode.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="passcode" className="text-sm font-medium">
          Admin passcode
        </Label>
        <Input
          id="passcode"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your passcode"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            onStatusChange(e.target.value ? "typing" : "idle");
          }}
          required
          autoFocus
          disabled={isPending}
          aria-invalid={error ? true : undefined}
          className="h-11 text-base sm:text-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={isPending || isEmpty}
        title={isEmpty ? "Enter the passcode to continue" : undefined}
        className="console-launch w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            Joining your team…
          </>
        ) : (
          <>
            <KeyRound className="mr-2 size-4" aria-hidden="true" />
            Join your team
          </>
        )}
      </Button>
    </form>
  );
}

function LoginSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-4 w-28 rounded bg-muted" />
        <div className="h-11 w-full rounded-md bg-muted/60" />
      </div>
      <div className="h-11 w-full rounded-xl bg-muted" />
    </div>
  );
}

export default function LoginPage() {
  const [status, setStatus] = useState<LoginStatus>("idle");

  return (
    <div className="login-shell">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <main className="login-card">
        {/* Teal rail: the same shape as the dashboard nav rail. The team
            lanes are decoration; the heading on the right carries meaning. */}
        <aside className="login-rail">
          <div className="flex items-center gap-3">
            <span className="login-rail-logo">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Neiro</span>
          </div>

          <ol className="login-lanes" aria-hidden="true">
            {TEAM_LANES.map((lane, index) => (
              <li
                key={lane}
                className="login-lane"
                style={{ "--i": index } as React.CSSProperties}
              >
                <span className="login-lane-dot" />
                <span className="login-lane-label">{lane}</span>
              </li>
            ))}
            <li
              className="login-lane"
              data-you=""
              data-status={status}
              style={{ "--i": TEAM_LANES.length } as React.CSSProperties}
            >
              <span className="login-lane-dot" />
              <span className="login-lane-label">You</span>
            </li>
          </ol>

          <p className="login-rail-note">Your agents are ready.</p>
        </aside>

        <section className="login-form-side">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Join your team
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter the admin passcode to open mission control.
            </p>
          </div>

          <Suspense fallback={<LoginSkeleton />}>
            <LoginForm onStatusChange={setStatus} />
          </Suspense>

          <p className="text-xs text-muted-foreground">
            Your session is kept in a signed cookie.
          </p>
        </section>
      </main>
    </div>
  );
}
