import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listCliRuntime } from "@/lib/cli-runtime";

/**
 * The local CLI runtime for the agent form: whether Oh My Pi is installed
 * and the models it can run. Hermes models stay on /api/agents/models.
 */
export async function GET() {
  await connection();
  const ohmypi = await listCliRuntime("ohmypi");
  return NextResponse.json({ ohmypi }, { status: 200 });
}
