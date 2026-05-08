import { CheckCircle, ImageSquare } from '@phosphor-icons/react'
import LoadingDots from './LoadingDots'

const cursorStyle = `
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
.chat-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-muted);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.8s ease-in-out infinite;
}
`

export default function ChatMessage({ role, content, isStreaming, attachment }) {
  const isUser = role === 'user'

  return (
    <>
      <style>{cursorStyle}</style>
      <div style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '12px',
        padding: '0 4px',
      }}>
        <div style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser
            ? 'var(--radius-md) var(--radius-md) var(--radius-sm) var(--radius-md)'
            : 'var(--radius-md) var(--radius-md) var(--radius-md) var(--radius-sm)',
          background: isUser ? 'var(--color-primary-dim)' : 'var(--color-surface-2)',
          color: isUser ? '#ffffff' : 'var(--color-text)',
          fontSize: '1rem',
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}>
          {attachment?.type === 'image' && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 9px',
              marginBottom: content ? 8 : 0,
              borderRadius: 10,
              border: isUser ? '1px solid rgba(255,255,255,0.34)' : '1px solid var(--border)',
              background: isUser ? 'rgba(255,255,255,0.14)' : 'var(--surface)',
              color: isUser ? '#fff' : 'var(--text-muted)',
              fontSize: '0.82rem',
              fontWeight: 700,
            }}>
              <ImageSquare size={17} weight="duotone" />
              <span>{attachment.label || 'Image attached'}</span>
              {isUser && <CheckCircle size={16} weight="fill" />}
            </div>
          )}
          {isStreaming && !content
            ? <LoadingDots />
            : <>
                {content}
                {isStreaming && <span className="chat-cursor" />}
              </>
          }
        </div>
      </div>
    </>
  )
}
