"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { KeyRound, ShieldAlert, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { BotRig, agentLook, followPointer, resetPointer } from "@/components/agent-bot";
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

/** Bots that peek out from behind the card. Decoration only. */
const PEEKERS = [
  { role: "PM", side: "top", pos: "8%", delay: "0s" },
  { role: "Backend", side: "top", pos: "42%", delay: "-1.7s" },
  { role: "Frontend", side: "top", pos: "68%", delay: "-3.4s" },
  { role: "QA", side: "side", pos: "52%", delay: "-2.5s" },
] as const;

/** Background cable paths (1440×900 space). Each runs from a screen edge
    into the middle, where the card covers its end. */
const WIRES = [
  { d: "M0 120 H180 Q200 120 200 140 V450 H720", delay: "0s", dur: "3.4s" },
  { d: "M1440 90 H1260 Q1240 90 1240 110 V450 H720", delay: "-1.1s", dur: "3.4s" },
  { d: "M260 900 V780 Q260 760 280 760 H720 V450", delay: "-2.3s", dur: "3.4s" },
  { d: "M1440 820 H1180 Q1160 820 1160 800 V640 H720 V450", delay: "-0.6s", dur: "4s" },
  { d: "M560 0 V60 Q560 80 580 80 H720 V450", delay: "-1.8s", dur: "2.9s" },
  { d: "M0 700 H400 Q420 700 420 680 V450 H720", delay: "-2.9s", dur: "3.7s" },
] as const;

function LoginForm({
  onStatusChange,
}: {
  onStatusChange: (status: LoginStatus) => void;
}) {
  const searchParams = useSearchParams();
  const nextUrl = searchParams?.get("next") || "/";

  const [passcode, setPasscode] = useState("");
  const [mode, setMode] = useState<"passcode" | "account">("passcode");
  const [username, setUsername] = useState("");
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
          body: JSON.stringify(
            mode === "account" ? { username: username.trim(), password: passcode } : { passcode }
          ),
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

  const isEmpty = passcode.length === 0 || (mode === "account" && username.trim().length === 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {mode === "account" && (
        <div className="space-y-2">
          <Label htmlFor="username" className="text-sm font-medium">
            Username
          </Label>
          <Input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            disabled={isPending}
            aria-invalid={error ? true : undefined}
            className="h-11 text-base sm:text-sm"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="passcode" className="text-sm font-medium">
          {mode === "account" ? "Password" : "Admin passcode"}
        </Label>
        <Input
          id="passcode"
          type="password"
          autoComplete="current-password"
          placeholder={mode === "account" ? undefined : "Enter your passcode"}
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            onStatusChange(e.target.value ? "typing" : "idle");
          }}
          required
          autoFocus={mode === "passcode"}
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

      <button
        type="button"
        className="mx-auto block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => {
          setMode(mode === "passcode" ? "account" : "passcode");
          setError(null);
          onStatusChange("idle");
        }}
      >
        {mode === "passcode" ? "Sign in with a username" : "Use the admin passcode"}
      </button>
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
    <div
      className="login-shell"
      onPointerMove={followPointer}
      onPointerLeave={resetPointer}
    >
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Cable paths: pressed-in grooves with teal sparks flowing to the
          card. Faster while signing in, red on an error. */}
      <svg
        className="login-wires"
        data-status={status}
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {WIRES.map((wire) => (
          <g key={wire.d}>
            <path className="login-wire-lo" d={wire.d} fill="none" vectorEffect="non-scaling-stroke" />
            <path className="login-wire-hi" d={wire.d} fill="none" vectorEffect="non-scaling-stroke" />
            <path className="login-wire-base" d={wire.d} fill="none" vectorEffect="non-scaling-stroke" />
            <path
              className="login-wire-spark"
              d={wire.d}
              fill="none"
              pathLength={400}
              vectorEffect="non-scaling-stroke"
              style={{ "--d": wire.delay, "--dur": wire.dur } as React.CSSProperties}
            />
          </g>
        ))}
      </svg>

      <div className="login-stage">

        {PEEKERS.map((bot) => (
          <span
            key={bot.role}
            className={`agent-bot login-peek login-peek-${bot.side}`}
            style={
              {
                ...agentLook(bot.role),
                [bot.side === "top" ? "left" : "top"]: bot.pos,
                "--d": bot.delay,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            <BotRig role={bot.role} />
          </span>
        ))}

        <span className="login-badge" aria-hidden="true">
          <ShieldCheck className="size-6" />
        </span>

        <div className="login-card-shadow">
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
      </div>
    </div>
  );
}
