// Run: bun tests/history-browser.mjs, then open the printed URL.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/tests.js") {
      const bundle = await Bun.build({
        entrypoints: [new URL("./history-browser.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "process.env": '{"NODE_ENV":"development"}' },
      });
      if (!bundle.success) throw new AggregateError(bundle.logs, "Browser test build failed");
      return new Response(bundle.outputs[0], { headers: { "Content-Type": "text/javascript" } });
    }
    return new Response('<!doctype html><title>History regressions</title><h1>Running…</h1><ol id="results"></ol><div id="root"></div><script type="module" src="/tests.js"></script>', {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});
console.log(`History regression tests: ${server.url}`);
