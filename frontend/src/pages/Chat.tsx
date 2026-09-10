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
    <div className="flex min-h-svh items-start justify-center bg-neutral-50 px-4 py-10 dark:bg-neutral-950 sm:items-center sm:py-6">
      {/*
        grid-rows-[auto_1fr_auto] + max-height(대신 height는 안 씀): 메시지가 적을 때는
        카드 전체 높이가 내용만큼만 작아져서 입력창이 바로 밑에 붙고, 메시지가 많아지면
        카드가 max-height에서 멈추고 가운데 행(overflow-y-auto)만 내부 스크롤된다.
      */}
      <div className="grid max-h-[min(85svh,700px)] w-full max-w-2xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <header className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {domain?.name ?? "입학상담 챗봇"}
            </h1>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              지원자격 · 전형일정 · 등록금 · 커리큘럼 · 취업 관련 질문을 물어보세요
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
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
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
