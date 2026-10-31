"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { KeyRound, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { BotRig, agentLook, followPointer, resetPointer } from "@/components/agent-bot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";

/** What the "You" lane on the rail reflects. */
type LoginStatus = "idle" | "typing" | "pending" | "error";

/** The N mark: one node per agent, walked in team order along the
    letter's stroke (up, diagonal down, up). "You" closes the N. */
const N_PATH = "M40 230 V40 L160 230 V40";
const N_NODES = [
  { label: "Orchestrator", x: 40, y: 230, lx: 40, ly: 262, anchor: "middle" },
  { label: "Specification", x: 40, y: 40, lx: 40, ly: 18, anchor: "middle" },
  { label: "Workers", x: 80, y: 103, lx: 100, ly: 108, anchor: "start" },
  { label: "QA", x: 120, y: 167, lx: 100, ly: 172, anchor: "end" },
  { label: "Reviewer", x: 160, y: 230, lx: 160, ly: 262, anchor: "middle" },
  { label: "You", x: 160, y: 40, lx: 160, ly: 18, anchor: "middle" },
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
          <svg
            className="login-n"
            viewBox="-12 0 224 272"
            role="img"
            aria-label="Neiro"
          >
            <path className="login-n-track" d={N_PATH} pathLength={100} />
            <path className="login-n-line" d={N_PATH} pathLength={100} />
            <path className="login-n-spark" d={N_PATH} pathLength={100} />
            {N_NODES.map((node, index) => {
              const you = node.label === "You";
              return (
                <g
                  key={node.label}
                  className="login-n-node"
                  data-you={you ? "" : undefined}
                  data-status={you ? status : undefined}
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <circle className="login-n-halo" cx={node.x} cy={node.y} r={15} />
                  <circle className="login-n-dot" cx={node.x} cy={node.y} r={9} />
                  <text
                    className="login-n-label"
                    x={node.lx}
                    y={node.ly}
                    textAnchor={node.anchor}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
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
