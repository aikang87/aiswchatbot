import type {
  ConversationDetail,
  ConversationSummary,
  DomainMeta,
  DomainSettings,
  GapCluster,
  KnowledgeItem,
  Stats,
  StoredMessage,
} from "./types";

// 주의: `||`를 쓰면 VITE_API_BASE=""(같은 출처 배포에서 상대경로를 쓰려는 의도)가
// falsy라서 항상 fallback으로 대체돼버린다. undefined일 때만 fallback하도록 `??`를 쓴다.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const ADMIN_TOKEN_KEY = "aisw_admin_token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

// ---------- 클라이언트(익명 세션) API ----------

export async function createSession(): Promise<{ conversation_id: number; domain_name: string }> {
  const res = await fetch(`${API_BASE}/api/chat/sessions`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function getDomainMeta(): Promise<DomainMeta> {
  const res = await fetch(`${API_BASE}/api/meta/domain`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function getConversationMessages(conversationId: number): Promise<StoredMessage[]> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
    credentials: "include",
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  return res.json();
}

export async function submitFeedback(messageId: number, rating: 1 | -1): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/messages/${messageId}/feedback`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
}

export type StreamEvent =
  | { type: "citations"; data: { rank: number; question: string; answer: string; score: number }[] }
  | { type: "delta"; data: string }
  | { type: "blocked"; data: { reason?: string; top_score?: number } }
  | { type: "done"; data: Record<string, never> };

export async function streamMessage(
  conversationId: number,
  content: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, content }),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, await parseErrorDetail(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      let eventType = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine);
        onEvent({ type: eventType, data } as StreamEvent);
      } catch {
        // 파싱 실패한 프레임은 무시
      }
    }
  }
}

// ---------- 관리자 API ----------

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function adminLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, await parseErrorDetail(res));
  const body = await res.json();
  return body.access_token as string;
}

export interface ConversationFilters {
  blocked?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listConversations(filters: ConversationFilters = {}): Promise<ConversationSummary[]> {
  const params = new URLSearchParams();
  if (filters.blocked !== undefined) params.set("blocked", String(filters.blocked));
  if (filters.q) params.set("q", filters.q);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return adminFetch(`/api/admin/conversations${qs ? `?${qs}` : ""}`);
}

export async function getAdminConversation(id: number): Promise<ConversationDetail> {
  return adminFetch(`/api/admin/conversations/${id}`);
}

export async function getGaps(limit = 20): Promise<GapCluster[]> {
  return adminFetch(`/api/admin/gaps?limit=${limit}`);
}

export async function dismissGap(messageIds: number[]): Promise<void> {
  await adminFetch(`/api/admin/gaps/dismiss`, {
    method: "POST",
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

export async function getStats(): Promise<Stats> {
  return adminFetch(`/api/admin/stats`);
}

export async function listKnowledge(status?: string): Promise<KnowledgeItem[]> {
  return adminFetch(`/api/admin/knowledge${status ? `?status=${status}` : ""}`);
}

export interface KnowledgeInput {
  question: string;
  answer: string;
  tags?: string[] | null;
  status?: string;
}

export async function createKnowledge(input: KnowledgeInput): Promise<KnowledgeItem> {
  return adminFetch(`/api/admin/knowledge`, { method: "POST", body: JSON.stringify(input) });
}

export async function updateKnowledge(id: number, input: Partial<KnowledgeInput>): Promise<KnowledgeItem> {
  return adminFetch(`/api/admin/knowledge/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export async function deleteKnowledge(id: number): Promise<void> {
  await adminFetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
}

export async function reindexKnowledge(id: number): Promise<void> {
  await adminFetch(`/api/admin/knowledge/${id}/reindex`, { method: "POST" });
}

export interface PromoteInput {
  message_id: number;
  question: string;
  answer: string;
  tags?: string[] | null;
  status?: string;
}

export async function promoteKnowledge(input: PromoteInput): Promise<KnowledgeItem> {
  return adminFetch(`/api/admin/knowledge/promote`, { method: "POST", body: JSON.stringify(input) });
}

export async function getDomainSettings(): Promise<DomainSettings> {
  return adminFetch(`/api/admin/domain`);
}

export async function updateDomainSettings(input: Partial<DomainSettings>): Promise<DomainSettings> {
  return adminFetch(`/api/admin/domain`, { method: "PUT", body: JSON.stringify(input) });
}
