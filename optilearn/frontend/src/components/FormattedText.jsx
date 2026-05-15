const SUBSCRIPT = {
  0: '\u2080', 1: '\u2081', 2: '\u2082', 3: '\u2083', 4: '\u2084',
  5: '\u2085', 6: '\u2086', 7: '\u2087', 8: '\u2088', 9: '\u2089',
  '+': '\u208a', '-': '\u208b', '=': '\u208c', '(': '\u208d', ')': '\u208e',
}

const SUPERSCRIPT = {
  0: '\u2070', 1: '\u00b9', 2: '\u00b2', 3: '\u00b3', 4: '\u2074',
  5: '\u2075', 6: '\u2076', 7: '\u2077', 8: '\u2078', 9: '\u2079',
  '+': '\u207a', '-': '\u207b', '=': '\u207c', '(': '\u207d', ')': '\u207e',
}

function scriptDigits(value, map) {
  return String(value || '').split('').map(ch => map[ch] || ch).join('')
}

function normalizeMathMarkup(value) {
  return String(value || '')
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/([A-Za-z0-9)\]])\^\{?([0-9+\-=()]+)\}?/g, (_, base, sup) => `${base}${scriptDigits(sup, SUPERSCRIPT)}`)
    .replace(/([A-Za-z0-9)\]])_\{?([0-9+\-=()]+)\}?/g, (_, base, sub) => `${base}${scriptDigits(sub, SUBSCRIPT)}`)
    .replace(/\\times/g, '\u00d7')
    .replace(/\\cdot/g, '\u00b7')
    .replace(/\\div/g, '\u00f7')
    .replace(/\\leq?/g, '\u2264')
    .replace(/\\geq?/g, '\u2265')
    .replace(/\\neq/g, '\u2260')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function replaceMathDelimited(text, pattern) {
  return text.replace(pattern, (match, inner) => {
    if (!/[\\_^{}]/.test(inner)) return match
    return normalizeMathMarkup(inner)
  })
}

function normalizeBareMathMarkup(value) {
  return String(value || '')
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/([A-Za-z0-9)\]])\^\{?([0-9+\-=()]+)\}?/g, (_, base, sup) => `${base}${scriptDigits(sup, SUPERSCRIPT)}`)
    .replace(/([A-Za-z0-9)\]])_\{?([0-9+\-=()]+)\}?/g, (_, base, sub) => `${base}${scriptDigits(sub, SUBSCRIPT)}`)
    .replace(/\\times/g, '\u00d7')
    .replace(/\\cdot/g, '\u00b7')
    .replace(/\\div/g, '\u00f7')
    .replace(/\\leq?/g, '\u2264')
    .replace(/\\geq?/g, '\u2265')
    .replace(/\\neq/g, '\u2260')
}

export function normalizeOutputText(text) {
  let value = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^```[a-zA-Z0-9_-]*\s*$/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/^\s*(?:translation|translated text|answer|response)\s*:\s*/i, '')
    .replace(/^\s*```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .replace(/`([^`\n]+)`/g, '$1')

  value = replaceMathDelimited(value, /\$\$([\s\S]*?)\$\$/g)
  value = replaceMathDelimited(value, /\\\[([\s\S]*?)\\\]/g)
  value = replaceMathDelimited(value, /\\\(([\s\S]*?)\\\)/g)
  value = replaceMathDelimited(value, /\$([^$\n]+)\$/g)
  value = normalizeBareMathMarkup(value)

  return value
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

function renderInline(text) {
  const cleaned = normalizeOutputText(text)
    .replace(/_{2}(.+?)_{2}/g, '**$1**')
  const parts = cleaned.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)

  return parts.filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '0.92em',
          background: 'var(--surface-soft)',
          border: '1px solid var(--border)',
          borderRadius: 5,
          padding: '0 4px',
        }}>
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export default function FormattedText({
  text,
  compact = false,
  fontSize = 15,
  headingSize = 18,
  color = 'var(--text)',
}) {
  const normalized = normalizeOutputText(text)
  if (!normalized) return null

  const blocks = normalized.split('\n')
  const gap = compact ? 6 : 8

  return (
    <div style={{
      display: 'grid',
      gap,
      color,
      fontSize,
      lineHeight: 1.65,
      whiteSpace: 'normal',
      unicodeBidi: 'plaintext',
    }}>
      {blocks.map((line, i) => {
        const trimmed = line.trim()
        const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/)
        const bulletMatch = trimmed.match(/^[-*\u2022]\s+(.+)$/)
        const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/)
        const summaryHeading = /^in summary[:\uff1a]?$/i.test(trimmed)

        if (!trimmed) return <div key={i} style={{ height: compact ? 2 : 5 }} />
        if (/^[-*_]{3,}$/.test(trimmed)) return <hr key={i} style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: compact ? '2px 0' : '6px 0' }} />

        if (headingMatch || summaryHeading) {
          const label = summaryHeading ? trimmed.replace(/[:\uff1a]$/, '') : headingMatch[1]
          return (
            <div key={i} style={{
              fontSize: compact ? Math.max(fontSize + 1, headingSize - 3) : headingSize,
              fontWeight: 800,
              lineHeight: 1.35,
              paddingTop: i === 0 ? 0 : compact ? 5 : 10,
              paddingBottom: compact ? 2 : 4,
              borderBottom: '1px solid var(--border)',
            }}>
              {renderInline(label)}
            </div>
          )
        }

        if (bulletMatch) {
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: 6, alignItems: 'start' }}>
              <span aria-hidden style={{ color: 'var(--text-muted)', lineHeight: 1.65 }}>{'\u2022'}</span>
              <span>{renderInline(bulletMatch[1])}</span>
            </div>
          )
        }

        if (numberedMatch) {
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 6, alignItems: 'start' }}>
              <span style={{ color: 'var(--text-muted)', lineHeight: 1.65 }}>{numberedMatch[1]}.</span>
              <span>{renderInline(numberedMatch[2])}</span>
            </div>
          )
        }

        return (
          <p key={i} style={{ margin: 0, color, fontSize, lineHeight: 1.65 }}>
            {renderInline(trimmed.replace(/^>\s*/, ''))}
          </p>
        )
      })}
    </div>
  )
}
