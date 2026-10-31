import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesDTO, probeDTO } from "./agent-capabilities";

const caps = {
  available: true,
  features: { run_approval: true },
  endpoints: { run_approval: { method: "POST", path: "/v1/runs/{run_id}/approval" } },
};
const inventory = {
  skills: [{ name: "pdf", description: "Read PDFs" }],
  toolsets: [
    { name: "web", isMcp: false, tools: ["web_search"] },
    { name: "mcp-github", isMcp: true, configured: false },
  ],
};

test("capabilities are split into core and MCP toolsets, endpoint paths hidden", () => {
  const dto = capabilitiesDTO(caps, inventory);
  assert.deepEqual(dto.capabilities.endpoints, ["run_approval"]);
  assert.deepEqual(dto.toolsets.core.map((t) => t.name), ["web"]);
  assert.deepEqual(dto.toolsets.mcp.map((t) => t.name), ["mcp-github"]);
});

test("the probe answer never carries the agent URL, key or raw health body", () => {
  const dto = probeDTO(
    { ok: true, latencyMs: 12, details: { secret: "x", url: "https://internal" }, readiness: { status: "ok" } },
    caps,
    inventory,
  );
  const text = JSON.stringify(dto);
  assert.equal(text.includes("internal"), false);
  assert.equal(text.includes("key_enc"), false);
  assert.equal("details" in dto, false);
  assert.deepEqual(dto.inventory, ["pdf", "web", "mcp-github"]);
});
