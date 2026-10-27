"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { KeyRound, ShieldAlert, Sparkles, Loader2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/theme-toggle";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextUrl = searchParams?.get("next") || "/";

  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!passcode) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error || "Authentication failed. Check your passcode.");
          return;
        }

        window.location.href = nextUrl;
      } catch {
        setError("Network error occurred while connecting to the orchestrator.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="passcode" className="text-xs tracking-wider uppercase text-muted-foreground font-mono">
          Admin Passcode
        </Label>
        <Input
          id="passcode"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••••"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          required
          autoFocus
          disabled={isPending}
          className="text-base sm:text-sm font-mono tracking-widest bg-background/50 border-border/80 focus-visible:ring-amber-500/50"
        />
      </div>

      <Button
        type="submit"
        disabled={isPending || !passcode}
        className="w-full font-medium transition-all duration-200"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Authenticating...
          </>
        ) : (
          <>
            <KeyRound className="mr-2 size-4" />
            Authenticate
          </>
        )}
      </Button>
    </form>
  );
}

function LoginSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-10 w-full bg-muted/60 rounded-md" />
      </div>
      <div className="h-10 w-full bg-muted rounded-md" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center px-4 py-12 bg-background selection:bg-amber-500/20 selection:text-amber-300">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 shadow-sm shadow-amber-500/10 mb-1">
            <Sparkles className="size-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">
            NEIRO ORCHESTRATOR
          </h1>
          <p className="text-xs text-muted-foreground max-w-xs">
            Autonomous mission control & Hermes agent management cluster
          </p>
        </div>

        <Card className="border-border/80 shadow-lg bg-card/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-base font-semibold">Access Verification</CardTitle>
            <CardDescription className="text-xs">
              Enter your dashboard secret key to unlock mission control.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<LoginSkeleton />}>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60 font-mono">
          Protected by signed HMAC-SHA256 session token
        </p>
      </div>
    </div>
  );
}
