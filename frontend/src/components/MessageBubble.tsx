import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Components } from "react-markdown";
import type { ChatMessage } from "../api/types";
import { BlockedNotice } from "./BlockedNotice";

interface Props {
  message: ChatMessage;
  onFeedback?: (rating: 1 | -1) => void;
}

// 백엔드는 지식 공백(grounding 실패) 탐지에 답변 속 [1], [4] 같은 인용 번호 유무를 쓰므로
// 프롬프트/DB에는 그대로 남겨두고, 화면에 보여줄 때만 제거한다.
function stripCitationMarkers(text: string): string {
  return text
    .replace(/\s*\[\d+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// 한글 음절/자모는 URL에 쓰이지 않으므로 여기서 매칭을 끊는다.
// (예: "...(https://a.com)에서" 처럼 공백 없이 조사가 바로 붙는 경우)
const URL_REGEX = /(https?:\/\/[^\s"'<>ᄀ-ᇿ㄰-㆏가-힣]+)/g;
const TRAILING_PUNCT = ".,!?;:]}'\"”’";

// 답변 속 bare URL을 마크다운 링크 문법으로 바꿔서 react-markdown이 인식하게 한다.
// (react-markdown/remark-gfm의 기본 autolink는 공백 없이 붙은 한글 조사까지 URL에 포함시켜버린다)
function preprocessUrls(text: string): string {
  return text.replace(URL_REGEX, (match) => {
    let url = match;
    let trailing = "";
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
    const label = url.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\*/g, "\\*");
    const dest = url.replace(/\\/g, "\\\\").replace(/</g, "%3C").replace(/>/g, "%3E");
    return `[${label}](<${dest}>)${trailing}`;
  });
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-current/30 pl-2 italic opacity-90">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-current/20" />,
  h1: ({ children }) => <p className="mt-1 mb-1 text-lg font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-1 mb-1 text-base font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-1 mb-1 text-[15px] font-semibold">{children}</p>,
  code: ({ children }) => (
    <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[13px] dark:bg-white/10">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded-lg bg-black/5 p-2 font-mono text-[13px] dark:bg-white/5">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-current/20 px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
};

function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
      {preprocessUrls(stripCitationMarkers(text))}
    </ReactMarkdown>
  );
}

export function MessageBubble({ message, onFeedback }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words ${
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
            <MarkdownContent text={message.content} />
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
