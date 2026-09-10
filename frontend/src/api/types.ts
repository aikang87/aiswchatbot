export interface DomainMeta {
  name: string;
  description: string;
  session_max_questions: number;
}

export interface Citation {
  rank: number;
  question: string;
  answer: string;
  score: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  blocked?: boolean;
  blockReason?: string;
  citations?: Citation[];
  pending?: boolean;
  feedback?: 1 | -1 | null;
  serverId?: number;
}

export interface StoredMessage {
  id: number;
  role: MessageRole;
  content: string;
  blocked: boolean;
  created_at: string;
}

export interface ConversationSummary {
  id: number;
  session_id: string;
  started_at: string;
  last_message_at: string | null;
  message_count: number;
  blocked_count: number;
}

export interface ConversationMessageDetail {
  id: number;
  role: MessageRole;
  content: string;
  blocked: boolean;
  block_stage: string | null;
  block_reason: string | null;
  top_score: number | null;
  created_at: string;
  citations: { chunk_id: number; score: number; rank: number }[];
}

export interface ConversationDetail {
  id: number;
  session_id: string;
  started_at: string;
  last_message_at: string | null;
  messages: ConversationMessageDetail[];
}

export interface GapCluster {
  representative: string;
  representative_message_id: number;
  message_ids: number[];
  count: number;
  examples: string[];
  last_seen: string;
  last_block_reason: string | null;
}

export interface Stats {
  total_conversations: number;
  total_answers: number;
  blocked_answers: number;
  block_rate: number;
  daily_conversations: { date: string; count: number }[];
  feedback: { positive: number; negative: number };
  top_gaps: { representative: string; count: number; examples: string[] }[];
}

export interface KnowledgeItem {
  id: number;
  question: string;
  answer: string;
  tags: string[] | null;
  status: "draft" | "published" | "archived";
  source: "manual" | "promoted" | "document";
  source_message_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface DomainSettings {
  name: string;
  system_prompt: string;
  scope_threshold: number;
  retrieval_threshold: number;
}
