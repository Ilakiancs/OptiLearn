/**
 * LiveQuizJoin.jsx — Public student entry screen.
 *
 * Accessible via QR code at /live-quiz/join/:gameId
 * Students enter a nickname and join the lobby.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { joinLiveGame } from '../../api/client'

const COLORS = ['#6c63ff', '#ff6584', '#43b89c', '#f9a825']

export default function LiveQuizJoin() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin(e) {
    e.preventDefault()
    const name = nickname.trim()
    if (!name) return setError('Please enter a nickname.')
    if (name.length > 32) return setError('Nickname too long (max 32 characters).')
    setError('')
    setLoading(true)
    try {
      const result = await joinLiveGame(gameId, name)
      // Store participant info for the play screen
      sessionStorage.setItem(`lq_participant_${gameId}`, JSON.stringify(result))
      navigate(`/live-quiz/play/${gameId}`)
    } catch (err) {
      setError(err.message || 'Could not join. Is the game still in the lobby?')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 440,
        textAlign: 'center',
      }}>
        {/* Logo / Title */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
            height: 72,
            borderRadius: 20,
            background: 'var(--accent)',
            marginBottom: 18,
            fontSize: '2rem',
            boxShadow: 'var(--shadow)',
          }}>
            🎮
          </div>
          <h1 style={{
            margin: '0 0 8px',
            fontSize: '2rem',
            fontWeight: 800,
            color: 'var(--text)',
            letterSpacing: '-0.03em',
          }}>
            Live Quiz
          </h1>
          <p style={{
            margin: 0,
            color: 'var(--text-muted)',
            fontSize: '0.95rem',
          }}>
            Enter your nickname to join the game
          </p>
        </div>

        <form
          onSubmit={handleJoin}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 24,
            padding: '32px 28px',
            display: 'grid',
            gap: 18,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
            <label style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.88rem' }}>
              Your Nickname
            </label>
            <input
              autoFocus
              id="nickname-input"
              type="text"
              maxLength={32}
              placeholder="e.g. StarLearner42"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              style={{
                height: 52,
                borderRadius: 14,
                border: error ? '2px solid var(--danger)' : '1px solid var(--border)',
                background: 'var(--surface-soft)',
                color: 'var(--text)',
                fontSize: '1.1rem',
                padding: '0 18px',
                outline: 'none',
                transition: 'border 0.2s',
              }}
            />
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.84rem', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>

          {/* Color dots decoration */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {COLORS.map((c, i) => (
              <div key={i} style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: c,
                opacity: 0.7,
              }} />
            ))}
          </div>

          <button
            type="submit"
            id="join-game-btn"
            disabled={loading || !nickname.trim()}
            style={{
              height: 52,
              borderRadius: 14,
              border: 'none',
              background: loading
                ? 'var(--surface-soft)'
                : 'var(--accent)',
              color: loading ? 'var(--text-muted)' : '#fff',
              fontWeight: 800,
              fontSize: '1.05rem',
              cursor: loading || !nickname.trim() ? 'default' : 'pointer',
              opacity: !nickname.trim() ? 0.55 : 1,
              transition: 'all 0.2s',
              boxShadow: loading ? 'none' : 'var(--shadow)',
            }}
          >
            {loading ? '⏳ Joining…' : '🚀 Join Game'}
          </button>
        </form>

        <p style={{
          marginTop: 20,
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
        }}>
          Powered by OptiLearn
        </p>
      </div>
    </div>
  )
}
