export async function register() {
  // The ticker uses Supabase and Node timers, so only the Node.js server runs it.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLocalTicker } = await import("@/lib/local-ticker");
  startLocalTicker();
}
