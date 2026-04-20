export default function QuizCard({
  question,
  options,
  onAnswer,
  answered,
  selectedAnswer,
  correctAnswer,
}) {
  function optionStyle(opt) {
    const base = {
      display: 'block',
      width: '100%',
      minHeight: '52px',
      padding: '12px 16px',
      marginBottom: '10px',
      border: '2px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface-2)',
      color: 'var(--color-text)',
      fontSize: '1rem',
      textAlign: 'left',
      cursor: answered ? 'default' : 'pointer',
      transition: 'background 0.2s, border-color 0.2s',
    }
    if (!answered) return base
    if (opt === correctAnswer) {
      return { ...base, background: '#14532d', borderColor: '#4ade80', color: '#4ade80' }
    }
    if (opt === selectedAnswer && opt !== correctAnswer) {
      return { ...base, background: '#7f1d1d', borderColor: '#ef4444', color: '#ef4444' }
    }
    return { ...base, opacity: 0.5 }
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <p style={{
        fontSize: '1.1rem',
        fontWeight: 600,
        color: 'var(--color-text)',
        marginBottom: '20px',
        lineHeight: 1.5,
      }}>
        {question}
      </p>
      {options.map(opt => (
        <button
          key={opt}
          style={optionStyle(opt)}
          disabled={answered}
          onClick={() => !answered && onAnswer(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
