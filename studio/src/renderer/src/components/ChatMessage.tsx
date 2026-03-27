/**
 * ChatMessage — renders a single message bubble (user or assistant).
 */

import type { ChatMessage as ChatMsg } from '../store/chat'

interface Props {
  message: ChatMsg
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const isStreaming = message.isStreaming

  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-7',
          isUser
            ? 'bg-accent/15 border border-accent/30 text-text-primary rounded-br-sm'
            : isError
              ? 'bg-red-900/20 border border-red-700/40 text-red-300 rounded-bl-sm'
              : 'bg-bg-secondary border border-border text-text-primary rounded-bl-sm',
        ].join(' ')}
      >
        {/* Message text */}
        <p className="whitespace-pre-wrap break-words">
          {message.text}
          {isStreaming && (
            <span className="ml-0.5 inline-block w-[2px] h-[1em] bg-accent animate-pulse align-middle" />
          )}
        </p>

        {/* Tool calls (inline badges) */}
        {message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc, i) => (
              <div
                key={i}
                className={[
                  'flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-mono',
                  tc.done
                    ? tc.isError
                      ? 'bg-red-900/30 text-red-300'
                      : 'bg-bg-tertiary text-text-tertiary'
                    : 'bg-bg-tertiary text-accent animate-pulse',
                ].join(' ')}
              >
                <span
                  className={[
                    'h-1.5 w-1.5 rounded-full flex-shrink-0',
                    tc.done
                      ? tc.isError
                        ? 'bg-red-400'
                        : 'bg-green-500'
                      : 'bg-accent',
                  ].join(' ')}
                />
                <span className="truncate">{tc.tool}</span>
                {!tc.done && <span className="ml-auto text-text-tertiary text-[10px]">running</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
