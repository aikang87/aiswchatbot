import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDomainMeta } from "../api/client";
import { useChatStream } from "../hooks/useChatStream";
import { MessageBubble } from "../components/MessageBubble";

export function Chat() {
  const { messages, ready, sending, error, questionCount, send, setFeedback } = useChatStream();
  const { data: domain } = useQuery({ queryKey: ["domain-meta"], queryFn: getDomainMeta });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  }

  return (
    // 모바일(<sm)에서는 카드가 화면(dvh: 키보드/주소창으로 줄어든 실제 보이는 높이 기준)에
    // 꽉 차게 고정해 헤더·입력창이 항상 보이게 하고, sm 이상에서는 기존처럼 가운데 뜬 카드로 보여준다.
    <div className="flex h-dvh flex-col bg-white dark:bg-neutral-900 sm:h-auto sm:min-h-svh sm:items-center sm:justify-center sm:bg-neutral-50 sm:px-4 sm:py-6 sm:dark:bg-neutral-950">
      <div className="grid h-full w-full grid-rows-[auto_1fr_auto] overflow-hidden sm:h-auto sm:max-h-[min(85svh,700px)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-neutral-200 sm:bg-white sm:shadow-sm sm:dark:border-neutral-800 sm:dark:bg-neutral-900">
        <header className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {domain?.name ?? "입학상담 챗봇"}
            </h1>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              지원자격 · 전형일정 · 등록금 · 커리큘럼 · 취업에 관해 물어보세요.
            </p>
          </div>
          {domain && (
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              질문 {questionCount} / {domain.session_max_questions}
            </span>
          )}
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
          {!ready && <p className="text-center text-sm text-neutral-400">연결 중...</p>}
          {ready && messages.length === 0 && (
            <p className="text-center text-sm text-neutral-400">첫 질문을 입력해 보세요.</p>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onFeedback={m.serverId ? (rating) => setFeedback(m.id, m.serverId as number, rating) : undefined}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!ready || sending}
            placeholder="메시지를 입력하세요"
            autoFocus
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-base outline-none focus:border-blue-500 disabled:opacity-50 sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            disabled={!ready || sending || !input.trim()}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            보내기
          </button>
        </form>
      </div>
    </div>
  );
}
