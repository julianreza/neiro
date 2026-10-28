import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listHermesModelOptions } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";

/** Models for the agent form, sourced from Hermes (which routes to 9Router). */
export async function GET() {
  await connection();

  try {
    const options = await listHermesModelOptions();
    return NextResponse.json(options, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to fetch Hermes models";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
