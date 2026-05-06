/**
 * LiveQuizHost.jsx — Teacher game control screen.
 *
 * Handles all three host phases in one component:
 * - lobby: waiting room, player list, QR code
 * - quiz: current question display, live answer stats bar chart, controls
 * - result: final leaderboard with confetti
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getLiveGameState,
  getLiveGameResults,
  nextLiveQuestion,
  revealLiveAnswer,
  endLiveGame,
} from '../../api/client'
import { useLiveQuizSocket } from '../../hooks/useLiveQuizSocket'

const CHOICE_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71']
const CHOICE_LABELS = ['A', 'B', 'C', 'D']

function AnswerBar({ choice, count, total, isCorrect, label, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{
        width: '100%',
        height: 140,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        position: 'relative',
      }}>
        <div style={{
          width: '100%',
          borderRadius: '8px 8px 0 0',
          background: color,
          height: `${Math.max(pct, 3)}%`,
          transition: 'height 0.6s cubic-bezier(.22,1,.36,1)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: -26,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#fff',
            fontWeight: 800,
            fontSize: '1.1rem',
          }}>
            {count}
          </div>
        </div>
      </div>
      <div style={{
        background: color,
        borderRadius: 10,
        padding: '6px 10px',
        color: '#fff',
        fontWeight: 700,
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        justifyContent: 'center',
      }}>
        {label}
        {isCorrect && <span>✓</span>}
      </div>
    </div>
  )
}

export default function LiveQuizHost() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const { state: wsState, connected } = useLiveQuizSocket(gameId)

  const [gameInfo, setGameInfo] = useState(null)
  const [phase, setPhase] = useState('lobby')
  const [joinCode, setJoinCode] = useState('')
  const [participants, setParticipants] = useState([])
  const [participantCount, setParticipantCount] = useState(0)
  const [answerCount, setAnswerCount] = useState(0)
  const [isRevealed, setIsRevealed] = useState(false)
  const [currentQIndex, setCurrentQIndex] = useState(0)
  const [results, setResults] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Current question's answer distribution (updated via WS answer_submitted events)
  const [answerDist, setAnswerDist] = useState({}) // { choiceIndex: count }

  const joinUrl = `${window.location.origin}/join`

  // Note: join_code is displayed on screen — students type it at /join

  // Initial load
  useEffect(() => {
    getLiveGameState(gameId)
      .then((data) => {
        setGameInfo(data)
        setPhase(data.phase)
        setJoinCode(data.join_code || '')
        setParticipantCount(data.participant_count)
        setAnswerCount(data.answer_count)
        setIsRevealed(data.is_answer_revealed)
        setCurrentQIndex(data.current_question_index)
      })
      .catch(() => {
        alert('Game not found or has expired.')
        navigate('/teacher')
      })
  }, [gameId, navigate])

  // Handle WebSocket messages
  useEffect(() => {
    if (!wsState) return

    if (wsState.type === 'participant_joined') {
      setParticipantCount(wsState.participant_count)
      setParticipants((prev) => [
        ...prev,
        { nickname: wsState.nickname, id: Date.now() },
      ])
    }

    if (wsState.type === 'game_state') {
      const newPhase = wsState.phase
      const newQIndex = wsState.current_question_index ?? 0

      if (newQIndex !== currentQIndex) {
        setAnswerDist({})
        setAnswerCount(0)
        setCurrentQIndex(newQIndex)
      }

      setPhase(newPhase)
      setParticipantCount(wsState.participant_count)
      setAnswerCount(wsState.answer_count ?? 0)
      setIsRevealed(wsState.is_answer_revealed)

      if (newPhase === 'result') {
        getLiveGameResults(gameId).then(setResults).catch(() => {})
      }

      // Refresh game info for current question
      getLiveGameState(gameId).then((data) => {
        setGameInfo(data)
      }).catch(() => {})
    }

    if (wsState.type === 'answer_submitted') {
      setAnswerCount(wsState.answer_count ?? 0)
    }
  }, [wsState])

  // Refresh answer distribution when answer is revealed
  useEffect(() => {
    if (isRevealed && gameInfo) {
      getLiveGameState(gameId).then((data) => {
        setGameInfo(data)
      }).catch(() => {})
    }
  }, [isRevealed])

  const handleNext = useCallback(async () => {
    setActionLoading(true)
    try {
      await nextLiveQuestion(gameId)
      setIsRevealed(false)
      setAnswerDist({})
      setAnswerCount(0)
    } catch (err) {
      alert(err.message || 'Could not advance.')
    } finally {
      setActionLoading(false)
    }
  }, [gameId])

  const handleReveal = useCallback(async () => {
    setActionLoading(true)
    try {
      await revealLiveAnswer(gameId)
    } catch (err) {
      alert(err.message || 'Could not reveal.')
    } finally {
      setActionLoading(false)
    }
  }, [gameId])

  const handleEnd = useCallback(async () => {
    if (!window.confirm('End the game now and show results?')) return
    setActionLoading(true)
    try {
      await endLiveGame(gameId)
    } catch (err) {
      alert(err.message || 'Could not end game.')
    } finally {
      setActionLoading(false)
    }
  }, [gameId])

  const currentQ = gameInfo?.current_question
  const totalQ = gameInfo?.question_count || 0

  // ── LOBBY SCREEN ─────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '32px 24px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
            <div>
              <h1 style={{ margin: '0 0 6px', fontSize: '1.8rem', fontWeight: 800 }}>
                🎮 {gameInfo?.quiz_title || 'Live Quiz'}
              </h1>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {totalQ} questions • Waiting for players…
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: connected ? 'var(--success)' : 'var(--danger)',
              }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {connected ? 'Live' : 'Reconnecting…'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
            {/* Player list */}
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: 24,
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  PLAYERS JOINED
                </h2>
                <span style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  borderRadius: 20,
                  padding: '4px 14px',
                  fontWeight: 800,
                  fontSize: '1.1rem',
                }}>
                  {participantCount}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, minHeight: 80 }}>
                {participants.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--accent-soft)',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                      borderRadius: 10,
                      padding: '6px 14px',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      animation: 'fadeIn 0.3s ease',
                    }}
                  >
                    {p.nickname}
                  </div>
                ))}
                {participants.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '10px 0' }}>
                    No players yet — share the PIN on the board!
                  </div>
                )}
              </div>
            </div>

            {/* PIN card + start */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '24px 20px',
                textAlign: 'center',
                boxShadow: 'var(--shadow)',
              }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14, fontWeight: 700, letterSpacing: '0.06em' }}>
                  GAME PIN
                </div>

                <div style={{
                  fontSize: '3.8rem',
                  fontWeight: 900,
                  letterSpacing: '0.15em',
                  color: 'var(--text)',
                  lineHeight: 1,
                  marginBottom: 14,
                }}>
                  {joinCode ? `${joinCode.slice(0,3)} ${joinCode.slice(3)}` : '……'}
                </div>

                <div style={{
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  borderRadius: 10,
                  padding: '8px 14px',
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.4,
                }}>
                  Students go to <strong style={{ color: 'var(--accent)' }}>{joinUrl}</strong><br />
                  and type this PIN
                </div>
              </div>

              <button
                id="start-game-btn"
                onClick={handleNext}
                disabled={actionLoading}
                style={{
                  height: 52,
                  borderRadius: 14,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                  boxShadow: 'var(--shadow)',
                  transition: 'all 0.2s',
                }}
              >
                {actionLoading ? '⏳ Starting…' : `🚀 Start Game (${participantCount} player${participantCount !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>
        </div>

        <style>{`@keyframes fadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }`}</style>
      </div>
    )
  }

  // ── QUIZ SCREEN ──────────────────────────────────────────────
  if (phase === 'quiz') {
    const choices = currentQ?.choices || []

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        {/* Top bar */}
        <div style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem' }}>
              {gameInfo?.quiz_title || 'Live Quiz'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Q{currentQIndex + 1} of {totalQ} • {participantCount} players
            </div>
          </div>

          <div style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            borderRadius: 10,
            padding: '8px 14px',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}>
            📝 {answerCount}/{participantCount} answered
          </div>

          <button
            onClick={handleEnd}
            style={{
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              borderRadius: 10,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: '0.82rem',
            }}
          >
            End Game
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 24, gap: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
          {/* Question card */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '28px 32px',
            textAlign: 'center',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.4 }}>
              {currentQ?.body || 'Loading question…'}
            </h2>
          </div>

          {/* Answer stats or waiting message */}
          {isRevealed ? (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: '24px 32px',
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20, fontWeight: 700, textAlign: 'center' }}>
                ANSWER DISTRIBUTION
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 200 }}>
                {choices.map((choice, i) => (
                  <AnswerBar
                    key={i}
                    choice={choice}
                    count={0} // Placeholder — detailed answer counts need an extra endpoint
                    total={Math.max(answerCount, 1)}
                    isCorrect={choice.is_correct}
                    label={CHOICE_LABELS[i]}
                    color={CHOICE_COLORS[i]}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: 28,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '3rem', marginBottom: 10 }}>⏳</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                Waiting for players to answer…
              </div>
              <div style={{
                marginTop: 16,
                height: 6,
                background: 'var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  background: 'var(--accent)',
                  width: participantCount > 0 ? `${(answerCount / participantCount) * 100}%` : '0%',
                  transition: 'width 0.5s ease',
                  borderRadius: 4,
                }} />
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 8 }}>
                {answerCount} / {participantCount} answered
              </div>
            </div>
          )}

          {/* Choice labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {choices.map((choice, i) => (
              <div
                key={i}
                style={{
                  background: CHOICE_COLORS[i] + '22',
                  border: `2px solid ${CHOICE_COLORS[i]}55`,
                  borderRadius: 14,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  opacity: isRevealed && !choice.is_correct ? 0.45 : 1,
                  transition: 'opacity 0.3s',
                }}
              >
                <span style={{
                  background: CHOICE_COLORS[i],
                  borderRadius: 8,
                  width: 28,
                  height: 28,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: '0.88rem',
                  flexShrink: 0,
                }}>
                  {CHOICE_LABELS[i]}
                </span>
                <span style={{ fontWeight: 600 }}>{choice.text}</span>
                {isRevealed && choice.is_correct && (
                  <span style={{ marginLeft: 'auto', color: '#43b89c', fontWeight: 900 }}>✓</span>
                )}
              </div>
            ))}
          </div>

          {/* Control buttons */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
            {!isRevealed && (
              <button
                id="reveal-btn"
                onClick={handleReveal}
                disabled={actionLoading}
                style={{
                  height: 52,
                  padding: '0 32px',
                  borderRadius: 14,
                  border: 'none',
                  background: 'var(--warning)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                }}
              >
                👁️ Reveal Answer
              </button>
            )}
            {isRevealed && (
              <button
                id="next-question-btn"
                onClick={handleNext}
                disabled={actionLoading}
                style={{
                  height: 52,
                  padding: '0 32px',
                  borderRadius: 14,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                }}
              >
                {currentQIndex + 1 >= totalQ ? '🏆 Show Results' : '→ Next Question'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── RESULTS SCREEN ───────────────────────────────────────────
  if (phase === 'result') {
    const leaderboard = results?.leaderboard || []
    const totalQs = results?.question_count || totalQ

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '40px 24px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏆</div>
            <h1 style={{ margin: '0 0 6px', fontSize: '2rem', fontWeight: 800 }}>
              Game Over!
            </h1>
            <div style={{ color: 'var(--text-muted)' }}>
              {gameInfo?.quiz_title || 'Live Quiz'} • {leaderboard.length} players
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '0.8rem',
              letterSpacing: '0.05em',
            }}>
              FINAL LEADERBOARD
            </div>
            {leaderboard.length === 0 && (
              <div style={{ padding: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                No players participated.
              </div>
            )}
            {leaderboard.map((p, i) => (
              <div
                key={p.participant_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 24px',
                  borderBottom: '1px solid var(--border)',
                  background: i === 0 ? 'var(--warning)' : 'transparent',
                }}
              >
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: i === 0 ? 'var(--warning)' : i === 1 ? 'var(--surface-soft)' : i === 2 ? 'var(--surface-soft)' : 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: i < 3 ? '1.2rem' : '0.95rem',
                }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </div>
                <div style={{ flex: 1, fontWeight: 700, fontSize: '1rem' }}>
                  {p.nickname}
                </div>
                <div style={{ color: 'var(--success)', fontWeight: 800, fontSize: '1.1rem' }}>
                  {p.total_score.toLocaleString()}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', width: 44, textAlign: 'right' }}>
                  {p.correct_count}/{totalQs}
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button
              onClick={() => navigate('/teacher')}
              style={{
                height: 48,
                padding: '0 28px',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.95rem',
              }}
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      Loading game…
    </div>
  )
}
