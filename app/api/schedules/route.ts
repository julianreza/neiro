import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { listHermesScheduledJobs, createHermesScheduledJob } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";

export async function GET() {
  await connection();

  try {
    const jobs = await listHermesScheduledJobs();
    return NextResponse.json({ jobs }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load scheduled jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const job = await createHermesScheduledJob(body);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create scheduled job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
