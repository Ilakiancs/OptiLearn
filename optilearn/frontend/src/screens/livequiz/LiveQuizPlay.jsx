/**
 * LiveQuizPlay.jsx — Student gameplay screen (waiting + questions + results).
 *
 * Handles the full student game lifecycle in one component:
 * - lobby: waiting for host to start
 * - quiz: 4-choice answer buttons + countdown
 * - result: final score + rank
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, GameController, HourglassHigh, Medal, PencilSimple, Star, Trophy, XCircle, SignOut } from '@phosphor-icons/react'
import { submitLiveAnswer, getLiveGameResults, getLiveGameState } from '../../api/client'
import { useLiveQuizSocket } from '../../hooks/useLiveQuizSocket'
import { useAuth } from '../../context/AuthContext'
import { completeLiveParticipantGame, linkLiveParticipantStudent } from '../../api/client'

const CHOICE_STYLES = [
  { bg: 'linear-gradient(135deg, #5a8ff7, #3f73e8)', badge: '#3f73e8', label: 'A' },
  { bg: 'linear-gradient(135deg, #9b6cf6, #7c4dff)', badge: '#7c4dff', label: 'B' },
  { bg: 'linear-gradient(135deg, #42d5c4, #1fb7a6)', badge: '#1fb7a6', label: 'C' },
  { bg: 'linear-gradient(135deg, #b0df5c, #7cc24a)', badge: '#7cc24a', label: 'D' },
]

function CountdownRing({ seconds, total }) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const progress = seconds / total
  const offset = circumference * (1 - progress)
  const color = seconds > 15 ? '#3f73e8' : seconds > 10 ? '#7c4dff' : seconds > 5 ? '#1fb7a6' : '#7cc24a'
  const bgColor = seconds > 15 ? '#3f73e8' : seconds > 10 ? '#7c4dff' : seconds > 5 ? '#1fb7a6' : '#7cc24a'

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={140} height={140} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={70} cy={70} r={radius} fill="none" stroke="var(--border)" strokeWidth={6} opacity={0.3} />
        <circle
          cx={70} cy={70} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s', filter: `drop-shadow(0 0 8px ${color}60)` }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}>
        <div style={{ fontSize: '2.2rem', fontWeight: 900, color, textShadow: `0 0 12px ${color}40` }}>
          {seconds}
        </div>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          sec
        </div>
      </div>
    </div>
  )
}

export default function LiveQuizPlay() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const { studentId } = useAuth() || {}
  const { state: wsState, connected } = useLiveQuizSocket(gameId)

  const [participant, setParticipant] = useState(null)
  const [phase, setPhase] = useState('lobby')
  const [gameInfo, setGameInfo] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [myAnswer, setMyAnswer] = useState(null)
  const [myScore, setMyScore] = useState(0)
  const [totalScore, setTotalScore] = useState(0)
  const [results, setResults] = useState(null)
  const [timeLeft, setTimeLeft] = useState(20)
  const [answerRevealed, setAnswerRevealed] = useState(false)
  const [currentQIndex, setCurrentQIndex] = useState(0)
  const [isKicked, setIsKicked] = useState(false)
  const timerRef = useRef(null)

  // Restore participant from sessionStorage and fetch initial game state
  useEffect(() => {
    const stored = sessionStorage.getItem(`lq_participant_${gameId}`)
    if (!stored) {
      navigate(`/live-quiz/join/${gameId}`, { replace: true })
      return
    }
    try {
      setParticipant(JSON.parse(stored))
    } catch {
      navigate(`/live-quiz/join/${gameId}`, { replace: true })
      return
    }
    // Fetch current state immediately so we don't show lobby if game already started
    getLiveGameState(gameId).then((data) => {
      setPhase(data.phase)
      setCurrentQIndex(data.current_question_index ?? 0)
      setAnswerRevealed(data.is_answer_revealed ?? false)
      setGameInfo(data)
      if (data.phase === 'result') loadResults()
    }).catch(() => {})
  }, [gameId, navigate])

  useEffect(() => {
    if (!participant?.participant_id || !studentId) return
    if (participant.student_id === studentId) return
    linkLiveParticipantStudent(gameId, participant.participant_id, studentId)
      .then(() => {
        setParticipant((prev) => (prev ? { ...prev, student_id: studentId } : prev))
        sessionStorage.setItem(`lq_participant_${gameId}`, JSON.stringify({ ...participant, student_id: studentId }))
      })
      .catch(() => {})
  }, [participant, studentId, gameId])

  // Process WebSocket state updates
  useEffect(() => {
    if (!wsState) return

    if (wsState.type === 'participant_kicked') {
      // Check if this is me being kicked
      if (participant && wsState.participant_id === participant.participant_id) {
        setIsKicked(true)
      }
      return
    }

    if (wsState.type === 'answer_submitted') {
      setGameInfo((prev) => ({ ...prev, answer_count: wsState.answer_count }))
      return
    }

    if (wsState.type === 'game_state') {
      const newPhase = wsState.phase
      const newQIndex = wsState.current_question_index ?? 0
      const revealed = wsState.is_answer_revealed ?? false

      // Detect question change — reset answered state
      if (newQIndex !== currentQIndex) {
        setAnswered(false)
        setMyAnswer(null)
        setTimeLeft(20)
        setAnswerRevealed(false)
        setCurrentQIndex(newQIndex)
      }

      setPhase(newPhase)
      setAnswerRevealed(revealed)

      if (newPhase === 'result') {
        clearInterval(timerRef.current)
        loadResults()
      }

      setGameInfo((prev) => ({ ...prev, ...wsState }))

      // Fetch full question data (with choices) only for quiz phase
      if (newPhase === 'quiz') {
        getLiveGameState(gameId).then((data) => {
          setGameInfo(data)
        }).catch(() => {})
      }
    }
  }, [wsState, currentQIndex, gameId])

  // Countdown timer — starts on each new question, stops when answered/revealed/done
  useEffect(() => {
    if (phase !== 'quiz' || answerRevealed || answered) {
      clearInterval(timerRef.current)
      return
    }
    // Only reset to 20 when the question actually changes (currentQIndex drives this)
    setTimeLeft(20)
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [phase, currentQIndex, answerRevealed, answered])

  async function loadResults() {
    try {
      const data = await getLiveGameResults(gameId)
      setResults(data)
      // Find my rank & score
      if (participant && data.leaderboard) {
        const me = data.leaderboard.find((p) => p.participant_id === participant.participant_id)
        if (me) setTotalScore(me.total_score)
      }
    } catch (_) {}
  }

  const finalizeParticipation = useCallback(async () => {
    if (!participant?.participant_id) return
    try {
      await completeLiveParticipantGame(gameId, participant.participant_id)
    } catch (_) {}
  }, [participant, gameId])

  const handleAnswer = useCallback(async (choiceIndex) => {
    if (answered || answerRevealed || !participant) return
    setAnswered(true)
    setMyAnswer(choiceIndex)
    clearInterval(timerRef.current)
    try {
      const res = await submitLiveAnswer(gameId, participant.participant_id, choiceIndex)
      setMyScore(res.score || 0)
      setTotalScore((prev) => prev + (res.score || 0))
      if ((gameInfo?.question_count ?? 0) > 0 && currentQIndex + 1 >= (gameInfo?.question_count ?? 0)) {
        await finalizeParticipation()
      }
    } catch (err) {
      console.error('Answer submit issue:', err)
    }
  }, [answered, answerRevealed, participant, gameId, gameInfo?.question_count, currentQIndex])

  useEffect(() => {
    if (phase === 'result') {
      finalizeParticipation()
    }
  }, [phase, finalizeParticipation])

  useEffect(() => {
    return () => {
      sessionStorage.removeItem(`lq_participant_${gameId}`)
    }
  }, [gameId])

  // Show kicked modal
  if (isKicked) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.08), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.04), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: '40px 32px',
          textAlign: 'center',
          maxWidth: 400,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}>
          <div style={{
            width: 72,
            height: 72,
            margin: '0 auto 24px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(124,77,255,0.15), rgba(31,183,166,0.15))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <SignOut size={40} weight="bold" color="#7c4dff" />
          </div>
          <h2 style={{
            color: 'var(--text)',
            fontSize: '1.5rem',
            fontWeight: 800,
            margin: '0 0 12px',
          }}>
            Removed from Quiz
          </h2>
          <p style={{
            color: 'var(--text-muted)',
            fontSize: '0.95rem',
            lineHeight: 1.6,
            margin: '0 0 28px',
          }}>
            The teacher has removed you from this quiz. You can join another quiz using a join code.
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              border: 'none',
              borderRadius: 12,
              padding: '10px 16px',
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)' }}
            onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)' }}
          >
            <ArrowLeft size={16} weight="bold" />
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  // ── LOBBY SCREEN ─────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.08), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.04), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
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
          Home
        </button>

        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 80,
              height: 80,
              borderRadius: 20,
              background: 'var(--accent-soft)',
              marginBottom: 24,
              boxShadow: `0 8px 24px var(--accent)20`,
            }}>
              <GameController size={40} weight="fill" color="var(--accent)" />
            </div>
            <h1 style={{ color: 'var(--text)', fontSize: '2.2rem', fontWeight: 900, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
              Ready to play?
            </h1>
            <p style={{ color: 'var(--text-muted)', margin: '0', fontSize: '1rem', lineHeight: 1.6 }}>
              Waiting for the teacher to start…
            </p>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--accent)',
            borderRadius: 20,
            padding: '28px 24px',
            display: 'inline-block',
            boxShadow: `0 8px 24px var(--accent)20`,
            marginBottom: 28,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              You're in as
            </div>
            <div style={{ color: 'var(--accent)', fontSize: '1.9rem', fontWeight: 900, letterSpacing: '0.02em' }}>
              {participant?.nickname || '…'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: connected ? 'var(--success)' : 'var(--accent)',
              animation: 'pulse 1.5s infinite',
            }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
              {connected ? 'Connected. Waiting' : 'Reconnecting'}
            </span>
          </div>
        </div>

        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    )
  }

  // ── QUIZ SCREEN ──────────────────────────────────────────────
  if (phase === 'quiz') {
    const currentQ = gameInfo?.current_question
    const choices = currentQ?.choices || []
    const currentChoice = myAnswer !== null ? choices[myAnswer] : null
    const statusIcon = answered && myAnswer !== null
      ? (answerRevealed
        ? (currentChoice?.is_correct
          ? <CheckCircle size={44} weight="fill" />
          : <XCircle size={44} weight="fill" />)
        : <PencilSimple size={44} weight="fill" />)
      : <HourglassHigh size={44} weight="fill" />
    const statusColor = answered && myAnswer !== null
      ? (answerRevealed
        ? (currentChoice?.is_correct ? '#1fb7a6' : '#7c4dff')
        : 'var(--accent)')
      : 'var(--text-muted)'

    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.06), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.05), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        {/* Header bar */}
        <div style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600, padding: '4px 8px',
            }}
          >
            <ArrowLeft size={15} weight="bold" />
          </button>
          <span style={{ color: 'var(--text)', fontSize: '0.85rem', fontWeight: 600 }}>
            {participant?.nickname}
          </span>
          <span style={{
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 20,
            padding: '4px 14px',
            fontWeight: 800,
            fontSize: '0.88rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <Star size={16} weight="fill" />
            <span>{totalScore.toLocaleString()}</span>
          </span>
        </div>

        {/* Question body */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 28px',
          gap: 32,
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
        }}>
          {/* Timer + question */}
          <div style={{ display: 'flex', gap: 36, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: 12 }}>
              {!answered && !answerRevealed && (
                <CountdownRing seconds={timeLeft} total={20} />
              )}
              {(answered || answerRevealed) && (
                <div style={{
                  width: 140, height: 140,
                  display: 'grid', placeItems: 'center',
                  color: statusColor,
                  background: 'var(--surface)',
                  borderRadius: 20,
                  boxShadow: `0 8px 20px ${statusColor}20`,
                }}>
                  {statusIcon}
                </div>
              )}
            </div>

            <div style={{ flex: 1, paddingTop: 8 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Question {(gameInfo?.current_question_index ?? 0) + 1} of {gameInfo?.question_count ?? '?'}
              </div>
              <h2 style={{
                color: 'var(--text)',
                fontSize: '1.65rem',
                fontWeight: 800,
                margin: 0,
                lineHeight: 1.35,
                letterSpacing: '-0.01em',
              }}>
                {currentQ?.body || 'Loading question…'}
              </h2>
            </div>
          </div>

          {/* Answer feedback */}
          {answered && !answerRevealed && (
            <div style={{
              background: 'var(--accent-soft)',
              border: `2px solid var(--accent)`,
              borderRadius: 16,
              padding: '14px 20px',
              color: 'var(--accent)',
              fontWeight: 700,
              textAlign: 'center',
              fontSize: '0.95rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: `0 6px 16px var(--accent)20`,
              animation: 'slideUp 0.3s ease',
            }}>
              <CheckCircle size={20} weight="fill" />
              <span>Answer submitted. Waiting for reveal.</span>
            </div>
          )}

          {answered && answerRevealed && (
            <div style={{
              background: myScore > 0 ? 'rgba(44, 155, 125, 0.15)' : 'rgba(42, 141, 191, 0.15)',
              border: `2px solid ${myScore > 0 ? 'var(--success)' : 'var(--accent)'}`,
              borderRadius: 16,
              padding: '14px 20px',
              color: myScore > 0 ? 'var(--success)' : 'var(--accent)',
              fontWeight: 800,
              textAlign: 'center',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: `0 6px 16px ${myScore > 0 ? 'var(--success)' : 'var(--accent)'}20`,
              animation: 'slideUp 0.3s ease',
            }}>
              {myScore > 0 ? <><CheckCircle size={20} weight="fill" /><span>Correct! +{myScore} points</span></> : <><span>Keep going.</span></>}
            </div>
          )}

          {/* Choice buttons */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 18,
            marginTop: 'auto',
            paddingBottom: 20,
          }}>
            {choices.map((choice, i) => {
              const style = CHOICE_STYLES[i] || CHOICE_STYLES[0]
              const isMyChoice = myAnswer === i
              const isCorrect = choice.is_correct
              const selectedBorder = isMyChoice ? `4px solid ${style.badge}` : '4px solid transparent'
              let opacity = 1
              if (answerRevealed && !isCorrect) opacity = 0.3
              if (answered && !isMyChoice && !answerRevealed) opacity = 0.4

              return (
                <button
                  key={i}
                  id={`choice-${i}`}
                  onClick={() => handleAnswer(i)}
                  disabled={answered || answerRevealed || timeLeft === 0}
                  style={{
                    background: style.bg,
                    border: selectedBorder,
                    borderRadius: 20,
                    padding: '20px 16px',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '1.02rem',
                    cursor: answered || answerRevealed || timeLeft === 0 ? 'default' : 'pointer',
                    opacity,
                    transition: 'all 0.2s ease-out',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    minHeight: 92,
                    boxShadow: isMyChoice ? `0 12px 28px ${style.badge}50` : 'var(--shadow)',
                    transform: isMyChoice ? 'scale(1.01)' : 'scale(1)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => {
                    if (!answered && !answerRevealed && timeLeft > 0) {
                      e.target.style.transform = 'scale(1.02)'
                      e.target.style.boxShadow = `0 16px 36px ${style.badge}50`
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.transform = isMyChoice ? 'scale(1.01)' : 'scale(1)'
                    e.target.style.boxShadow = isMyChoice ? `0 12px 28px ${style.badge}50` : 'var(--shadow)'
                  }}
                >
                  <span style={{
                    fontWeight: 900,
                    fontSize: '1.4rem',
                    minWidth: 40,
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.25)',
                    borderRadius: 12,
                    padding: '6px 0',
                    lineHeight: 1,
                  }}>
                    {style.label}
                  </span>
                  <span style={{ lineHeight: 1.4, flex: 1 }}>{choice.text}</span>
                  {answerRevealed && isCorrect && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                      <CheckCircle size={20} weight="fill" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ── RESULTS SCREEN ───────────────────────────────────────────
  if (phase === 'result') {
    const leaderboard = results?.leaderboard || []
    const myRank = participant
      ? leaderboard.findIndex((p) => p.participant_id === participant.participant_id) + 1
      : 0
    const totalQs = results?.question_count || 0

    return (
      <div style={{
        minHeight: '100vh',
        backgroundImage: `radial-gradient(circle at top right, rgba(42, 141, 191, 0.06), transparent 50%), radial-gradient(circle at bottom left, rgba(44, 155, 125, 0.04), transparent 45%), radial-gradient(circle, var(--dot-color) var(--dot-size), transparent calc(var(--dot-size) + 0.4px))`,
        backgroundSize: 'auto, auto, var(--dot-gap) var(--dot-gap)',
        backgroundColor: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 20px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          {/* Back button */}
          <div style={{ marginBottom: 24 }}>
            <button
              onClick={() => navigate('/')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '10px 16px',
                color: 'var(--text)', cursor: 'pointer',
                fontSize: '0.9rem', fontWeight: 600,
                transition: 'all 0.2s',
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
              Home
            </button>
          </div>

          {/* Results header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ marginBottom: 16, animation: 'bounce 0.6s ease' }}>
              <Trophy size={56} weight="fill" color="var(--accent)" />
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: '2.4rem', fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              Quiz Complete
            </h1>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>
              {gameInfo?.quiz_title || 'Live Quiz'} with {leaderboard.length} player{leaderboard.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Your Score Card */}
          {myRank > 0 && (
            <div style={{
              background: 'var(--accent-soft)',
              border: '2px solid var(--accent)',
              borderRadius: 24,
              padding: '28px 32px',
              marginBottom: 28,
              textAlign: 'center',
              boxShadow: `0 12px 32px var(--accent)25`,
              animation: 'slideUp 0.6s ease',
            }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.07em' }}>
                Your Result
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: 'var(--accent)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  flexShrink: 0,
                  fontWeight: 900,
                  fontSize: '1.6rem',
                }}>
                  {myRank === 1 ? <Trophy size={32} weight="fill" color="#fff" /> : myRank === 2 ? <Medal size={32} weight="fill" color="#fff" /> : myRank === 3 ? <Medal size={32} weight="bold" color="#fff" /> : myRank}
                </div>
                <div>
                  <div style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600 }}>
                    #{myRank} {myRank === 1 ? '1st Place' : myRank === 2 ? '2nd Place' : myRank === 3 ? '3rd Place' : `${myRank}th Place`}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                    {participant?.nickname}
                  </div>
                </div>
              </div>
              <div style={{
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: 16,
                padding: '16px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Total Score
                  </div>
                  <div style={{ color: 'var(--text)', fontSize: '1.8rem', fontWeight: 900 }}>
                    {totalScore.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Correct
                  </div>
                  <div style={{ color: 'var(--text)', fontSize: '1.8rem', fontWeight: 900 }}>
                    {(results?.leaderboard?.find((p) => p.participant_id === participant?.participant_id)?.correct_count || 0)}/{totalQs}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              Leaderboard
            </div>
            {leaderboard.slice(0, 10).map((p, i) => {
              const isMe = participant && p.participant_id === participant.participant_id
              const medalIcons = [<Trophy key={0} size={16} weight="fill" />, <Medal key={1} size={16} weight="fill" />, <Medal key={2} size={16} weight="bold" />]
              return (
                <div
                  key={p.participant_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '16px 20px',
                    borderBottom: i < leaderboard.length - 1 ? '1px solid var(--border)' : 'none',
                    background: isMe ? 'linear-gradient(90deg, var(--accent-soft), rgba(44, 155, 125, 0.06))' : 'transparent',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: i === 0 ? 'var(--accent)' : i === 1 ? '#7c4dff' : i === 2 ? '#1fb7a6' : 'var(--surface-soft)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 900,
                    fontSize: '1rem',
                    color: i < 3 ? '#fff' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}>
                    {i < 3 ? medalIcons[i] : (i + 1)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isMe ? 'var(--accent)' : 'var(--text)', fontWeight: isMe ? 800 : 600, fontSize: '0.95rem' }}>
                      {p.nickname}{isMe && ' (you)'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {p.correct_count}/{totalQs} correct
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.95rem' }}>
                      {p.total_score.toLocaleString()}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      pts
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 24, fontSize: '0.85rem', fontWeight: 500 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CheckCircle size={16} weight="fill" color="var(--text-muted)" />Great effort. Keep practicing</span>
          </p>
        </div>
      </div>
    )
  }

  return null
}
