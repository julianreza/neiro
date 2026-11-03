import { answerDelta, appendStep, isTerminalRunEventType, parseRunEvent, removeInterim, type LogStep } from "@/lib/run-events";

export type RunStreamSnapshot = {
  steps: LogStep[];
  answer: string;
  lastSeq: number | null;
  incomplete: boolean;
  awaitingResume: boolean;
};

export function emptyRunStream(): RunStreamSnapshot {
  return { steps: [], answer: "", lastSeq: null, incomplete: false, awaitingResume: false };
}

/** Continue from a verified cursor. Legacy streams must rebuild from their available replay. */
export function beginRunStream(state: RunStreamSnapshot): RunStreamSnapshot {
  return state.lastSeq === null
    ? { ...emptyRunStream(), incomplete: true }
    : { ...state, awaitingResume: true };
}

export function consumeRunFrame(previous: RunStreamSnapshot, raw: string): { state: RunStreamSnapshot; terminal: boolean } {
  let name: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return { state: previous, terminal: false };
  const payload = data.join("\n");
  let event: { type?: unknown; event?: unknown; text?: unknown; already_streamed?: unknown; seq?: unknown } = {};
  try { event = JSON.parse(payload); } catch { /* parseRunEvent handles non-JSON frames. */ }
  const type = typeof event?.type === "string" ? event.type : typeof event?.event === "string" ? event.event : name ?? "";
  if (type === "replay.truncated") return { state: { ...previous, answer: "", incomplete: true, awaitingResume: false }, terminal: false };
  const sequenceValue = id && /^\d+$/.test(id) ? Number(id) : typeof event?.seq === "number" ? event.seq : null;
  const sequence = typeof sequenceValue === "number" && Number.isSafeInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : null;
  let state = previous;
  if (state.awaitingResume && sequence === null) state = { ...emptyRunStream(), incomplete: true };
  else if (state.awaitingResume) state = { ...state, awaitingResume: false };
  if (sequence !== null && state.lastSeq !== null && sequence <= state.lastSeq) return { state, terminal: false };
  if (sequence !== null && state.lastSeq !== null && sequence > state.lastSeq + 1) state = { ...state, answer: "", incomplete: true };
  const delta = answerDelta(payload, name);
  const answer = delta !== null ? state.answer + delta : removeInterim(state.answer, payload, name);
  let step = parseRunEvent(payload, name);
  if (!step && type === "message.interim" && event?.already_streamed === true && typeof event.text === "string") step = { kind: "commentary", text: event.text, at: null };
  const steps = step ? appendStep(state.steps, { ...step, at: step.at ?? new Date().toISOString() }) : state.steps;
  return { state: { ...state, answer, steps, lastSeq: sequence ?? state.lastSeq }, terminal: payload.trim() === "[DONE]" || isTerminalRunEventType(type) };
}
