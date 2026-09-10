import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, getConversationMessages, streamMessage, submitFeedback } from "../api/client";
import type { ChatMessage, Citation } from "../api/types";

const CONVERSATION_KEY = "aisw_conversation_id";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `local-${idCounter}`;
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const stored = localStorage.getItem(CONVERSATION_KEY);
      if (stored) {
        try {
          const history = await getConversationMessages(Number(stored));
          if (cancelled) return;
          setConversationId(Number(stored));
          setMessages(
            history.map((m) => ({
              id: `server-${m.id}`,
              role: m.role,
              content: m.content,
              blocked: m.blocked,
              serverId: m.id,
            })),
          );
          setQuestionCount(history.filter((m) => m.role === "user").length);
          setReady(true);
          return;
        } catch {
          localStorage.removeItem(CONVERSATION_KEY);
        }
      }
      try {
        const session = await createSession();
        if (cancelled) return;
        localStorage.setItem(CONVERSATION_KEY, String(session.conversation_id));
        setConversationId(session.conversation_id);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "세션 생성에 실패했습니다");
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId || sending || !content.trim()) return;

      const userMessage: ChatMessage = { id: nextId(), role: "user", content };
      const assistantId = nextId();
      setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "", pending: true }]);
      setSending(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let citations: Citation[] | undefined;
      let blocked = false;
      let blockReason: string | undefined;

      try {
        await streamMessage(
          conversationId,
          content,
          (event) => {
            if (event.type === "citations") {
              citations = event.data as Citation[];
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, citations } : m)),
              );
            } else if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.data, pending: false } : m)),
              );
            } else if (event.type === "blocked") {
              blocked = true;
              blockReason = (event.data as { reason?: string }).reason;
            } else if (event.type === "done") {
              const { message_id: serverId, question_count } = event.data as {
                message_id?: number;
                question_count?: number;
              };
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, pending: false, blocked, blockReason, serverId } : m)),
              );
              if (typeof question_count === "number") setQuestionCount(question_count);
            }
          },
          controller.signal,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "메시지 전송에 실패했습니다");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, pending: false, content: m.content || "(오류가 발생했습니다)" } : m)),
        );
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending],
  );

  const setFeedback = useCallback((messageId: string, serverId: number, rating: 1 | -1) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m)));
    submitFeedback(serverId, rating).catch(() => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: null } : m)));
    });
  }, []);

  return { messages, ready, sending, error, questionCount, send, setFeedback };
}
