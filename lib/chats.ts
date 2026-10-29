import type { AskQuestionDTO, AskStatus } from "@/lib/ask-history";

/**
 * A chat is a chain of questions: each follow-up names the run it follows
 * (`followUpOf`). The first question is the chat's root and gives its id and
 * title. A chat belongs to the project of its root question, or to none.
 */
export type ChatThread = {
  id: string;
  title: string;
  projectId: string | null;
  /** Oldest first. */
  messages: AskQuestionDTO[];
  lastAt: string;
  status: AskStatus;
};

/** Group question rows into chats, newest activity first. */
export function groupThreads(rows: AskQuestionDTO[]): ChatThread[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (row: AskQuestionDTO): AskQuestionDTO => {
    const seen = new Set<string>();
    let at = row;
    while (at.followUpOf && byId.has(at.followUpOf) && !seen.has(at.id)) {
      seen.add(at.id);
      at = byId.get(at.followUpOf)!;
    }
    return at;
  };

  const threads = new Map<string, AskQuestionDTO[]>();
  for (const row of rows) {
    const root = rootOf(row);
    const list = threads.get(root.id) ?? [];
    list.push(row);
    threads.set(root.id, list);
  }

  return [...threads.entries()]
    .map(([id, messages]) => {
      messages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const root = byId.get(id)!;
      const last = messages[messages.length - 1];
      return {
        id,
        title: root.question.split("\n")[0].slice(0, 120),
        projectId: root.projectId,
        messages,
        lastAt: last.createdAt,
        status: last.status,
      };
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** Chats with no project first, then each project's chats. Projects keep the order of their newest chat. */
export function groupByProject(threads: ChatThread[]): { projectId: string | null; threads: ChatThread[] }[] {
  const groups = new Map<string | null, ChatThread[]>();
  for (const t of threads) {
    const list = groups.get(t.projectId) ?? [];
    list.push(t);
    groups.set(t.projectId, list);
  }
  const loose = groups.get(null);
  groups.delete(null);
  const out = [...groups.entries()].map(([projectId, list]) => ({ projectId, threads: list }));
  if (loose) out.unshift({ projectId: null, threads: loose });
  return out;
}
