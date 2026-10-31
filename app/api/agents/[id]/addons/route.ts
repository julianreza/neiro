import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  asAddonKind,
  installAddon,
  listAddons,
  removeAddon,
  searchAddons,
  setAddonEnabled,
} from "@/lib/hermes-addons";
import { saveMcpKeys } from "@/lib/hermes-mcp-keys";
import { hermesCliFailure, localAgentProfile } from "@/lib/hermes-local-profile";
import { usersAdminSession } from "@/lib/users-api";

type RouteContext = { params: Promise<{ id: string }> };

/** GET ?kind=mcp|plugin|toolset → what the profile has; add &q=… → catalog search. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const kind = asAddonKind(request.nextUrl.searchParams.get("kind"));
    const profile = await localAgentProfile(id);
    const q = request.nextUrl.searchParams.get("q");
    if (q !== null) {
      return NextResponse.json({ profile, results: await searchAddons(kind, q) });
    }
    return NextResponse.json({ profile, items: await listAddons(kind, profile) });
  } catch (err) {
    return hermesCliFailure(err);
  }
}

/** POST {kind, action: "install"|"remove"|"toggle"|"keys", id, enabled?, values?}. Admin only. Key values are never sent back. */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!(await usersAdminSession(request))) {
    return NextResponse.json({ error: "Only an admin can change Hermes add-ons." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = asAddonKind(body?.kind);
    const profile = await localAgentProfile(id);
    let note = "";
    switch (body?.action) {
      case "install":
        note = await installAddon(kind, profile, body.id);
        break;
      case "remove":
        await removeAddon(kind, profile, body.id);
        break;
      case "toggle":
        await setAddonEnabled(kind, profile, body.id, body.enabled === true);
        break;
      case "keys":
        if (kind !== "mcp") return NextResponse.json({ error: "Keys are only for MCP servers." }, { status: 400 });
        await saveMcpKeys(profile, String(body.id ?? ""), body.values);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, profile, note, items: await listAddons(kind, profile) });
  } catch (err) {
    return hermesCliFailure(err);
  }
}
