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
import { ArrowLeft, ArrowRight, CheckCircle, ClipboardText, Eye, GameController, HourglassHigh, Medal, RocketLaunch, Trophy, X } from '@phosphor-icons/react'
import {
  getLiveGameState,
  getLiveGameResults,
  nextLiveQuestion,
  revealLiveAnswer,
  endLiveGame,
  kickLiveParticipant,
} from '../../api/client'
import { useLiveQuizSocket } from '../../hooks/useLiveQuizSocket'

const CHOICE_COLORS = ['#3f73e8', '#7c4dff', '#1fb7a6', '#7cc24a']
const CHOICE_LABELS = ['A', 'B', 'C', 'D']

function AnswerBar({ choice, count, total, isCorrect, label, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{
        width: '100%',
        height: 160,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        position: 'relative',
        background: 'var(--surface-soft)',
        borderRadius: '12px 12px 0 0',
        overflow: 'hidden',
      }}>
        <div style={{
          width: '100%',
          borderRadius: '12px 12px 0 0',
          background: color,
          height: `${Math.max(pct, 2)}%`,
          transition: 'height 0.6s cubic-bezier(.22,1,.36,1)',
          position: 'relative',
          boxShadow: `0 4px 12px ${color}40`,
        }}>
          <div style={{
            position: 'absolute',
            top: -32,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: color,
            fontWeight: 900,
            fontSize: '1.4rem',
            textShadow: '0 1px 2px rgba(0,0,0,0.1)',
          }}>
            {count}
          </div>
        </div>
      </div>
      <div style={{
        background: color,
        borderRadius: 12,
        padding: '8px 12px',
        color: '#fff',
        fontWeight: 800,
        fontSize: '0.9rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: '100%',
        boxShadow: `0 4px 12px ${color}40`,
      }}>
        <span style={{ fontSize: '1rem' }}>{label}</span>
        {isCorrect && <CheckCircle size={16} weight="fill" />}
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
        setAnswerDist(data.answer_distribution || {})
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
        { nickname: wsState.nickname, id: wsState.participant_id },
      ])
    }

    if (wsState.type === 'participant_kicked') {
      setParticipantCount(wsState.participant_count)
      setParticipants((prev) => 
        prev.filter((p) => p.id !== wsState.participant_id)
      )
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
      setAnswerDist(wsState.answer_distribution || {})
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
      setAnswerDist(wsState.answer_distribution || {})
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

  // Define these early so they can be used in dependencies
  const currentQ = gameInfo?.current_question
  const totalQ = gameInfo?.question_count || 0

  const handleNext = useCallback(async () => {
    setActionLoading(true)
    try {
      // If we're on the last question, end the game instead of advancing
      if (currentQIndex + 1 >= totalQ) {
        if (!window.confirm('End the game and show results? This will save all student progress.')) {
          setActionLoading(false)
          return
        }
        await endLiveGame(gameId)
        // WebSocket will update phase to 'result' automatically
      } else {
        await nextLiveQuestion(gameId)
        setIsRevealed(false)
        setAnswerDist({})
        setAnswerCount(0)
      }
    } catch (err) {
      alert(err.message || 'Could not complete action.')
    } finally {
      setActionLoading(false)
    }
  }, [gameId, currentQIndex, totalQ])

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

  const handleBack = useCallback(async () => {
    // If a quiz is in progress, end it before leaving.
    if (phase === 'quiz') {
      if (!window.confirm('Leaving will end the game and show results. End now?')) return
      setActionLoading(true)
      try {
        await endLiveGame(gameId)
      } catch (err) {
        alert(err.message || 'Could not end game.')
        return
      } finally {
        setActionLoading(false)
      }
    }
    navigate('/teacher')
  }, [gameId, phase, navigate])

  const handleKick = useCallback(async (participantId, nickname) => {
    if (!window.confirm(`Remove ${nickname} from the quiz?`)) return
    try {
      await kickLiveParticipant(gameId, participantId)
      // Participant will be removed when WebSocket broadcasts the participant_kicked message
    } catch (err) {
      alert(err.message || 'Could not remove student.')
    }
  }, [gameId])

  // ── LOBBY SCREEN ─────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.06), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        padding: '32px 24px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={() => navigate('/teacher')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '10px 16px',
                  color: 'var(--text)', cursor: 'pointer',
                  fontSize: '0.9rem', fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--accent-soft)'
                  e.target.style.color = 'var(--accent)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--surface)'
                  e.target.style.color = 'var(--text)'
                }}
              >
                <ArrowLeft size={16} weight="bold" />
                Dashboard
              </button>
              <div>
                <h1 style={{ margin: '0 0 8px', fontSize: '2rem', fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: 12, color: 'var(--text)' }}>
                  <span style={{ 
                    width: 48, height: 48, 
                    borderRadius: 14,
                    background: 'var(--accent-soft)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <GameController size={28} weight="fill" color="var(--accent)" />
                  </span>
                  <span>{gameInfo?.quiz_title || 'Live Quiz'}</span>
                </h1>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', fontWeight: 500 }}>
                  {totalQ} questions • {participantCount} players
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: connected ? 'rgba(44, 155, 125, 0.1)' : 'rgba(42, 141, 191, 0.1)', borderRadius: 12, padding: '10px 16px' }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: connected ? 'var(--success)' : 'var(--accent)',
                animation: connected ? 'pulse 2s infinite' : 'none',
              }} />
              <span style={{ color: connected ? 'var(--success)' : 'var(--accent)', fontSize: '0.9rem', fontWeight: 600 }}>
                {connected ? 'Live Connection' : 'Reconnecting…'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 32, alignItems: 'start' }}>
            {/* Player list */}
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 24,
              padding: 32,
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Players Joined
                </h2>
                <span style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontWeight: 900,
                  fontSize: '1.15rem',
                }}>
                  {participantCount}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, minHeight: 100 }}>
                {participants.map((p, idx) => (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--accent-soft)',
                      border: '2px solid var(--accent)',
                      color: 'var(--accent)',
                      borderRadius: 16,
                      padding: '12px 14px',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      animation: `slideIn 0.3s ease ${idx * 0.05}s both`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: 'var(--accent)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '0.9rem',
                        flexShrink: 0,
                      }}>
                        {p.nickname.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25, fontSize: '0.88rem' }}>{p.nickname}</span>
                    </div>
                    <button
                      onClick={() => handleKick(p.id, p.nickname)}
                      style={{
                        background: 'rgba(0,0,0,0)',
                        border: '1px solid var(--accent)',
                        borderRadius: 8,
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background = 'var(--accent)'
                        e.target.style.color = '#fff'
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(0,0,0,0)'
                        e.target.style.color = 'var(--accent)'
                      }}
                      title="Remove student"
                    >
                      <X size={18} weight="bold" />
                    </button>
                  </div>
                ))}
                {participants.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', padding: '20px 0', gridColumn: '1 / -1', textAlign: 'center' }}>
                    No players yet. Share the PIN below.
                  </div>
                )}
              </div>
            </div>

            {/* PIN card + start */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{
                background: 'var(--surface)',
                border: '2px solid var(--accent)',
                borderRadius: 24,
                padding: '32px 28px',
                textAlign: 'center',
                boxShadow: `0 8px 24px var(--accent)20`,
              }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginBottom: 16, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Game PIN
                </div>

                <div style={{
                  fontSize: '4.5rem',
                  fontWeight: 900,
                  letterSpacing: '0.2em',
                  color: 'var(--accent)',
                  lineHeight: 1,
                  marginBottom: 20,
                  fontFamily: 'Monaco, monospace',
                }}>
                  {joinCode ? `${joinCode.slice(0,3)} ${joinCode.slice(3)}` : '······'}
                </div>

                <div style={{
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  fontSize: '0.88rem',
                  color: 'var(--text)',
                  lineHeight: 1.5,
                }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 4 }}>Share with students:</div>
                  <strong style={{ color: 'var(--accent)' }}>{joinUrl}</strong>
                </div>
              </div>

              <button
                id="start-game-btn"
                onClick={handleNext}
                disabled={actionLoading}
                style={{
                  height: 56,
                  borderRadius: 16,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '1.05rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                  boxShadow: `0 8px 20px var(--accent)40`,
                  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  opacity: actionLoading ? 0.7 : 1,
                  transform: actionLoading ? 'scale(0.98)' : 'scale(1)',
                }}
                onMouseEnter={(e) => !actionLoading && (e.target.style.transform = 'scale(1.02)')}
                onMouseLeave={(e) => !actionLoading && (e.target.style.transform = 'scale(1)')}
              >
                {actionLoading ? <><HourglassHigh size={20} weight="bold" /><span>Starting…</span></> : <><RocketLaunch size={20} weight="bold" /><span>{`Start Game (${participantCount})`}</span></>}
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes fadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
          @keyframes slideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        `}</style>
      </div>
    )
  }

  // ── QUIZ SCREEN ──────────────────────────────────────────────
  if (phase === 'quiz') {
    const choices = currentQ?.choices || []

    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.06), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        {/* Top bar */}
        <div style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}>
          <button
            onClick={handleBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 12, padding: '8px 14px',
              color: 'var(--text)', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: 600,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--accent-soft)'
              e.target.style.borderColor = 'var(--accent)'
              e.target.style.color = 'var(--accent)'
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent'
              e.target.style.borderColor = 'var(--border)'
              e.target.style.color = 'var(--text)'
            }}
          >
            <ArrowLeft size={16} weight="bold" />
            Dashboard
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text)' }}>
              {gameInfo?.quiz_title || 'Live Quiz'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500 }}>
              Q{currentQIndex + 1} of {totalQ} • {participantCount} players
            </div>
          </div>

          <div style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            borderRadius: 12,
            padding: '10px 16px',
            fontSize: '0.9rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid var(--accent)',
          }}>
            <ClipboardText size={18} weight="bold" />
            <span>{answerCount}/{participantCount} answered</span>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 28, gap: 28, maxWidth: 1000, margin: '0 auto', width: '100%' }}>
          {/* Question card */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 24,
            padding: '36px 40px',
            textAlign: 'center',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 14, letterSpacing: '0.07em' }}>
              Question {currentQIndex + 1} of {totalQ}
            </div>
            <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.4, color: 'var(--text)' }}>
              {currentQ?.body || 'Loading question…'}
            </h2>
          </div>

          {/* Answer stats or waiting message */}
          {isRevealed ? (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 24,
              padding: '28px 32px',
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 24, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Answer Distribution
              </div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', height: 220 }}>
                {choices.map((choice, i) => (
                  <AnswerBar
                    key={i}
                    choice={choice}
                    count={answerDist[i] || 0}
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
              borderRadius: 24,
              padding: 32,
              textAlign: 'center',
            }}>
              <div style={{ marginBottom: 16 }}><HourglassHigh size={52} weight="fill" color="var(--accent)" /></div>
              <div style={{ color: 'var(--text-muted)', fontSize: '1.05rem', fontWeight: 600, marginBottom: 20 }}>
                Waiting for students to answer…
              </div>
              <div style={{
                marginTop: 20,
                height: 8,
                background: 'var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  background: 'var(--accent)',
                  width: participantCount > 0 ? `${(answerCount / participantCount) * 100}%` : '0%',
                  transition: 'width 0.5s ease',
                  borderRadius: 6,
                }} />
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 12, fontWeight: 600 }}>
                {answerCount} / {participantCount} answered
              </div>
            </div>
          )}

          {/* Choice labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {choices.map((choice, i) => (
              <div
                key={i}
                style={{
                  background: `linear-gradient(135deg, ${CHOICE_COLORS[i]}18, ${CHOICE_COLORS[i]}28)`,
                  border: `2px solid ${CHOICE_COLORS[i]}55`,
                  borderRadius: 18,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  opacity: isRevealed && !choice.is_correct ? 0.4 : 1,
                  transition: 'all 0.3s',
                  cursor: 'default',
                }}
              >
                <span style={{
                  background: CHOICE_COLORS[i],
                  borderRadius: 10,
                  width: 32,
                  height: 32,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: '0.95rem',
                  color: '#fff',
                  flexShrink: 0,
                }}>
                  {CHOICE_LABELS[i]}
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>{choice.text}</span>
                {isRevealed && choice.is_correct && (
                  <span style={{ marginLeft: 'auto', color: CHOICE_COLORS[i], fontWeight: 900 }}><CheckCircle size={20} weight="fill" /></span>
                )}
              </div>
            ))}
          </div>

          {/* Control buttons */}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
            {!isRevealed && (
              <button
                id="reveal-btn"
                onClick={handleReveal}
                disabled={actionLoading}
                style={{
                  height: 56,
                  padding: '0 36px',
                  borderRadius: 16,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '1rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  boxShadow: `0 8px 20px var(--accent)40`,
                  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  opacity: actionLoading ? 0.7 : 1,
                  transform: actionLoading ? 'scale(0.98)' : 'scale(1)',
                }}
                onMouseEnter={(e) => !actionLoading && (e.target.style.transform = 'scale(1.04)')}
                onMouseLeave={(e) => !actionLoading && (e.target.style.transform = 'scale(1)')}
              >
                <Eye size={20} weight="bold" />
                <span>Reveal Answer</span>
              </button>
            )}
            {isRevealed && (
              <button
                id="next-question-btn"
                onClick={handleNext}
                disabled={actionLoading}
                style={{
                  height: 56,
                  padding: '0 36px',
                  borderRadius: 16,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '1rem',
                  cursor: actionLoading ? 'default' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  boxShadow: `0 8px 20px var(--accent)40`,
                  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  opacity: actionLoading ? 0.7 : 1,
                  transform: actionLoading ? 'scale(0.98)' : 'scale(1)',
                }}
                onMouseEnter={(e) => !actionLoading && (e.target.style.transform = 'scale(1.04)')}
                onMouseLeave={(e) => !actionLoading && (e.target.style.transform = 'scale(1)')}
              >
                {currentQIndex + 1 >= totalQ ? <><Trophy size={20} weight="bold" /><span>Show Results</span></> : <><ArrowRight size={20} weight="bold" /><span>Next Question</span></>}
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
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.06), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        padding: '40px 24px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: 'var(--text)',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ marginBottom: 12 }}><Trophy size={48} weight="fill" /></div>
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
                  background: i === 0 ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: i === 0 ? 'var(--accent)' : i === 1 ? 'var(--surface-soft)' : i === 2 ? 'var(--surface-soft)' : 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: i < 3 ? '1.2rem' : '0.95rem',
                }}>
                  {i < 3 ? <Medal size={20} weight={i === 0 ? 'fill' : 'bold'} /> : i + 1}
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
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <ArrowLeft size={16} weight="bold" />
              Back to Dashboard
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
