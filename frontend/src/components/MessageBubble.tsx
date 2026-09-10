import type { ChatMessage } from "../api/types";
import { BlockedNotice } from "./BlockedNotice";

interface Props {
  message: ChatMessage;
  onFeedback?: (rating: 1 | -1) => void;
}

// 한글 음절/자모는 URL에 쓰이지 않으므로 여기서 매칭을 끊는다.
// (예: "...(https://a.com)에서" 처럼 공백 없이 조사가 바로 붙는 경우)
const URL_REGEX = /(https?:\/\/[^\s"'<>ᄀ-ᇿ㄰-㆏가-힣]+)/g;
const TRAILING_PUNCT = ".,!?;:]}'\"”’";

function linkify(text: string) {
  return text.split(URL_REGEX).map((part, i) => {
    if (i % 2 === 0) return part;
    let url = part;
    let trailing = "";
    // 문장부호나 짝이 맞지 않는 닫는 괄호는 링크에서 제외한다
    while (url.length > 0) {
      const last = url[url.length - 1];
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (TRAILING_PUNCT.includes(last) || (last === ")" && closes > opens)) {
        trailing = last + trailing;
        url = url.slice(0, -1);
      } else {
        break;
      }
    }
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
