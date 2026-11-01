"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendJson } from "@/lib/client-api";
import type { MissionTask } from "@/lib/types";

/** The server validates the graph and locks the mission against concurrent approval. */
export function TaskPlanEditor({ missionId, tasks, onChanged }: { missionId: string; tasks: MissionTask[]; onChanged: () => void }) {
  const [selected, setSelected] = useState("");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState("");
  const [agent, setAgent] = useState("");
  const [depends, setDepends] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const base = `/api/missions/${encodeURIComponent(missionId)}/tasks`;
  function choose(id: string) {
    if (dirty && !window.confirm("Discard unsaved task edits?")) return;
    const task = tasks.find((item) => item.id === id);
    setSelected(id); setKey(task?.taskKey ?? ""); setTitle(task?.title ?? ""); setResult(task?.result ?? "");
    setAgent(task?.agentName ?? ""); setDepends(task?.depends.join(", ") ?? ""); setDirty(false);
  }
  async function save(remove = false) {
    if (remove && !window.confirm("Delete this task from the plan?")) return;
    setBusy(true);
    const res = await sendJson(base, remove ? "DELETE" : selected ? "PATCH" : "POST", remove
      ? { taskId: selected }
      : { ...(selected ? { taskId: selected } : { task_key: key.trim() }), title, result, agent_name: agent, depends: depends.split(",").map((x) => x.trim()).filter(Boolean) });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(remove ? "Task removed" : "Task plan saved");
    setSelected(""); setKey(""); setTitle(""); setResult(""); setAgent(""); setDepends(""); setDirty(false); onChanged();
  }
  return <details className="space-y-3 rounded-xl border p-3">
    <summary className="cursor-pointer text-sm font-semibold">Edit Task Plan</summary>
    <p className="text-xs text-muted-foreground">Dependencies use task keys. Changes apply before the plan is approved.</p>
    <label className="block text-xs" htmlFor="plan-task">Task</label>
    <select id="plan-task" value={selected} onChange={(event) => choose(event.target.value)} className="w-full rounded-md border bg-background p-2 text-sm">
      <option value="">Add a task</option>
      {tasks.map((task) => <option key={task.id} value={task.id}>{task.taskKey ?? task.id} · {task.title}</option>)}
    </select>
    <label className="block text-xs" htmlFor="plan-key">Task key</label><Input id="plan-key" value={key} disabled={Boolean(selected)} onChange={(event) => { setKey(event.target.value); setDirty(true); }} placeholder="T3" />
    <label className="block text-xs" htmlFor="plan-title">Title</label><Input id="plan-title" value={title} maxLength={200} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
    <label className="block text-xs" htmlFor="plan-result">Requirements</label><Textarea id="plan-result" value={result} maxLength={8000} onChange={(event) => { setResult(event.target.value); setDirty(true); }} />
    <label className="block text-xs" htmlFor="plan-agent">Specialty</label><Input id="plan-agent" value={agent} maxLength={200} onChange={(event) => { setAgent(event.target.value); setDirty(true); }} />
    <label className="block text-xs" htmlFor="plan-deps">Dependencies (comma-separated task keys)</label><Input id="plan-deps" value={depends} onChange={(event) => { setDepends(event.target.value); setDirty(true); }} />
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !title.trim() || (!selected && !key.trim())} onClick={() => void save()}>{selected ? "Save task" : "Add task"}</Button>{selected && <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(true)}>Delete task</Button>}</div>
  </details>;
}
