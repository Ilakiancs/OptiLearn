/**
 * LiveQuizCodeEntry.jsx — Student entry point at /join
 *
 * Students type the 6-digit PIN the teacher wrote on the board.
 * On success, they are redirected to the nickname screen.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, GameController, HourglassHigh, WarningCircle } from '@phosphor-icons/react'
import { findGameByCode } from '../../api/client'

export default function LiveQuizCodeEntry() {
  const navigate = useNavigate()
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const code = digits.join('')

  function handleInput(e) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 6)
    const arr = raw.split('').concat(Array(6).fill('')).slice(0, 6)
    setDigits(arr)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const clean = code.replace(/\s/g, '')
    if (clean.length !== 6) {
      setError('Please enter the full 6-digit code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await findGameByCode(clean)
      navigate(`/live-quiz/join/${result.game_id}`)
    } catch (err) {
      setError(err.message || 'Game not found. Check the code and continue.')
      setLoading(false)
    }
  }

  const formatted = `${code.slice(0, 3)}${code.length > 3 ? ' ' + code.slice(3) : ''}`

  return (
    <div style={{
      minHeight: '100vh',
      backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.09), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
      backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
      backgroundColor: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      position: 'relative',
    }}>
      <button
        onClick={() => navigate('/')}
        style={{
          position: 'absolute', top: 20, left: 20,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '8px 14px',
          color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: '0.85rem', fontWeight: 600,
        }}
      >
        <ArrowLeft size={15} weight="bold" />
        Back
      </button>

      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            borderRadius: 24,
            background: 'linear-gradient(135deg, #4c8ff5, #43b89c)',
            marginBottom: 22,
            boxShadow: 'var(--shadow)',
          }}>
            <GameController size={42} weight="fill" color="#fff" />
          </div>

          <h1 style={{
            color: 'var(--text)',
            fontSize: '2.2rem',
            fontWeight: 900,
            margin: '0 0 10px',
            letterSpacing: '-0.03em',
          }}>
            Join a Quiz
          </h1>
          <p style={{
            color: 'var(--text-muted)',
            margin: '0 0 36px',
            fontSize: '1rem',
            lineHeight: 1.5,
          }}>
            Ask your teacher for the <strong style={{ color: 'var(--text)' }}>6-digit PIN</strong><br />
            and enter it below
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 20 }}>
          <div style={{ position: 'relative' }}>
            <input
              id="pin-input"
              type="text"
              inputMode="numeric"
              autoFocus
              autoComplete="off"
              maxLength={7}
              value={formatted.trim()}
              onChange={handleInput}
              placeholder="000 000"
              style={{
                width: '100%',
                height: 90,
                borderRadius: 20,
                border: error
                  ? '2px solid #2f9fe8'
                  : code.length === 6
                  ? '2px solid var(--success)'
                  : '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '3rem',
                fontWeight: 900,
                textAlign: 'center',
                letterSpacing: '0.25em',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border 0.2s',
                caretColor: 'var(--accent)',
              }}
            />
            <div style={{
              position: 'absolute',
              bottom: 12,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 6,
            }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: i < code.length ? 'var(--success)' : 'var(--border)',
                    transition: 'background 0.15s',
                  }}
                />
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(47,159,232,0.10), rgba(67,184,156,0.08))',
              border: '1px solid rgba(47,159,232,0.28)',
              borderRadius: 12,
              padding: '12px 16px',
              color: '#2f9fe8',
              fontWeight: 600,
              fontSize: '0.9rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <WarningCircle size={16} weight="fill" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            id="enter-code-btn"
            disabled={loading || code.length < 6}
            style={{
              height: 58,
              borderRadius: 16,
              border: 'none',
              background: code.length === 6 && !loading
                ? 'linear-gradient(135deg, #4c8ff5, #43b89c)'
                : 'var(--surface)',
              color: code.length === 6 ? '#fff' : 'var(--text-muted)',
              fontWeight: 800,
              fontSize: '1.1rem',
              cursor: loading || code.length < 6 ? 'default' : 'pointer',
              transition: 'all 0.25s',
              boxShadow: code.length === 6 && !loading
                ? 'var(--shadow)'
                : 'none',
              letterSpacing: '0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? <><HourglassHigh size={18} weight="bold" /><span>Finding game…</span></> : <><ArrowRight size={18} weight="bold" /><span>Enter Game</span></>}
          </button>
        </form>

        <p style={{
          marginTop: 28,
          color: 'var(--text-muted)',
          fontSize: '0.82rem',
          lineHeight: 1.6,
        }}>
          The PIN is shown on your teacher's screen.<br />
          No account needed.
        </p>
      </div>
    </div>
  )
}
