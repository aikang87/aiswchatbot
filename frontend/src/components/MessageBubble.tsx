import type { ChatMessage } from "../api/types";
import { BlockedNotice } from "./BlockedNotice";

interface Props {
  message: ChatMessage;
  onFeedback?: (rating: 1 | -1) => void;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkify(text: string) {
  return text.split(URL_REGEX).map((part, i) => {
    if (i % 2 === 0) return part;
    // URL 끝에 붙은 문장부호는 링크에서 제외한다 (예: "...사이트(https://a.com)를 참고")
    const match = part.match(/^(.*?)([.,!?;:)\]}'"”’]*)$/);
    const url = match ? match[1] : part;
    const trailing = match ? match[2] : "";
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}

export function MessageBubble({ message, onFeedback }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? "bg-blue-600 text-white rounded-br-sm"
              : message.blocked
                ? "bg-amber-50 text-neutral-800 rounded-bl-sm dark:bg-amber-950/40 dark:text-neutral-100"
                : "bg-neutral-100 text-neutral-900 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100"
          }`}
        >
          {message.pending && !message.content ? (
            <span className="inline-flex gap-1">
              <Dot />
              <Dot delay="0.15s" />
              <Dot delay="0.3s" />
            </span>
          ) : (
            linkify(message.content)
          )}
        </div>

        {message.blocked && <BlockedNotice reason={message.blockReason} />}

        {!isUser && !message.pending && message.serverId && onFeedback && (
          <div className="mt-1 flex gap-1.5 text-sm">
            <button
              type="button"
              aria-label="도움이 됐어요"
              onClick={() => onFeedback(1)}
              className={`rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                message.feedback === 1 ? "text-blue-600" : "text-neutral-400"
              }`}
            >
              👍
            </button>
            <button
              type="button"
              aria-label="도움이 안 됐어요"
              onClick={() => onFeedback(-1)}
              className={`rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                message.feedback === -1 ? "text-red-600" : "text-neutral-400"
              }`}
            >
              👎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
      style={{ animationDelay: delay }}
    />
  );
}
