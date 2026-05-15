/**
 * LiveQuizJoin.jsx — Public student entry screen.
 *
 * Accessible via QR code at /live-quiz/join/:gameId
 * Students enter a nickname and join the lobby.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, GameController, HourglassHigh, RocketLaunch, WarningCircle } from '@phosphor-icons/react'
import { joinLiveGame } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

const COLORS = ['#4c8ff5', '#2f9fe8', '#43b89c', '#58b86f']

export default function LiveQuizJoin() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const auth = useAuth() || {}
  const { studentId } = auth
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // If not logged in, redirect to student login
  if (!studentId) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.08), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
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
          background: 'var(--surface)',
          borderRadius: 24,
          padding: '32px 28px',
          boxShadow: 'var(--shadow)',
        }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1.5rem', fontWeight: 700 }}>Login Required</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--text-muted)' }}>
            Please log in as a student to join this live quiz.
          </p>
          <button
            onClick={() => navigate(`/join?redirect=/live-quiz/join/${gameId}`)}
            style={{
              padding: '12px 24px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  async function handleJoin(e) {
    e.preventDefault()
    const name = nickname.trim()
    if (!name) return setError('Please enter a nickname.')
    if (name.length > 32) return setError('Nickname too long (max 32 characters).')
    setError('')
    setLoading(true)
    try {
      const result = await joinLiveGame(gameId, name, studentId)
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
      backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.08), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
      backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
      backgroundColor: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      position: 'relative',
    }}>
      {/* Back button */}
      <button
        onClick={() => navigate('/join')}
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
            background: 'linear-gradient(135deg, #4c8ff5, #43b89c)',
            marginBottom: 18,
            boxShadow: 'var(--shadow)',
          }}>
            <GameController size={36} weight="fill" color="#fff" />
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
                border: error ? '2px solid #2f9fe8' : '1px solid rgba(76,143,245,0.22)',
                background: 'var(--surface-soft)',
                color: 'var(--text)',
                fontSize: '1.1rem',
                padding: '0 18px',
                outline: 'none',
                transition: 'border 0.2s',
              }}
            />
            {error && (
              <div style={{ color: '#2f9fe8', fontSize: '0.84rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <WarningCircle size={16} weight="fill" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Color dots decoration */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {COLORS.map((c, i) => (
              <div key={i} style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: c,
                opacity: 0.95,
                boxShadow: `0 0 0 4px ${c}22`,
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
                : 'linear-gradient(135deg, #4c8ff5, #43b89c)',
              color: loading ? 'var(--text-muted)' : '#fff',
              fontWeight: 800,
              fontSize: '1.05rem',
              cursor: loading || !nickname.trim() ? 'default' : 'pointer',
              opacity: !nickname.trim() ? 0.55 : 1,
              transition: 'all 0.2s',
              boxShadow: loading ? 'none' : 'var(--shadow)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? <><HourglassHigh size={18} weight="bold" /><span>Joining…</span></> : <><RocketLaunch size={18} weight="bold" /><span>Join Game</span></>}
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
