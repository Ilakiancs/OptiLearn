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
import { submitLiveAnswer, getLiveGameResults, getLiveGameState } from '../../api/client'
import { useLiveQuizSocket } from '../../hooks/useLiveQuizSocket'

const CHOICE_STYLES = [
  { bg: 'linear-gradient(135deg, #e74c3c, #c0392b)', emoji: '🔴', label: 'A' },
  { bg: 'linear-gradient(135deg, #3498db, #2980b9)', emoji: '🔵', label: 'B' },
  { bg: 'linear-gradient(135deg, #f39c12, #e67e22)', emoji: '🟡', label: 'C' },
  { bg: 'linear-gradient(135deg, #2ecc71, #27ae60)', emoji: '🟢', label: 'D' },
]

function CountdownRing({ seconds, total }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const progress = seconds / total
  const offset = circumference * (1 - progress)
  const color = seconds > 10 ? '#43b89c' : seconds > 5 ? '#f9a825' : '#ff6584'

  return (
    <svg width={100} height={100} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={50} cy={50} r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={8} />
      <circle
        cx={50} cy={50} r={radius}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
      />
      <text
        x={50} y={50}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ transform: 'rotate(90deg)', transformOrigin: '50px 50px', fill: color, fontSize: '1.6rem', fontWeight: 800 }}
      >
        {seconds}
      </text>
    </svg>
  )
}

export default function LiveQuizPlay() {
  const { gameId } = useParams()
  const navigate = useNavigate()
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
  const timerRef = useRef(null)

  // Restore participant from sessionStorage
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
    }
  }, [gameId, navigate])

  // Process WebSocket state updates
  useEffect(() => {
    if (!wsState) return

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

      // Fetch the full question data (with choices)
      if (newPhase === 'quiz' || newPhase === 'result') {
        getLiveGameState(gameId).then((data) => {
          setGameInfo(data)
        }).catch(() => {})
      }
    }
  }, [wsState, currentQIndex, gameId])

  // Countdown timer — starts when phase=quiz and answer not yet revealed
  useEffect(() => {
    if (phase !== 'quiz' || answerRevealed || answered) {
      clearInterval(timerRef.current)
      return
    }
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
  }, [phase, currentQIndex, answerRevealed])

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

  const handleAnswer = useCallback(async (choiceIndex) => {
    if (answered || answerRevealed || !participant) return
    setAnswered(true)
    setMyAnswer(choiceIndex)
    clearInterval(timerRef.current)
    try {
      const res = await submitLiveAnswer(gameId, participant.participant_id, choiceIndex)
      setMyScore(res.score || 0)
      setTotalScore((prev) => prev + (res.score || 0))
    } catch (err) {
      console.error('Answer submit failed:', err)
    }
  }, [answered, answerRevealed, participant, gameId])

  // ── LOBBY SCREEN ─────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: '4rem', marginBottom: 16 }}>⏳</div>
          <h1 style={{ color: 'var(--text)', fontSize: '1.8rem', fontWeight: 800, margin: '0 0 10px' }}>
            Waiting for host…
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 28px' }}>
            The game will start soon. Get ready!
          </p>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '20px 28px',
            display: 'inline-block',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 6 }}>
              YOU'RE IN AS
            </div>
            <div style={{ color: 'var(--accent)', fontSize: '1.8rem', fontWeight: 800 }}>
              {participant?.nickname || '…'}
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--success)' : 'var(--danger)',
              animation: 'pulse 1.5s infinite',
            }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              {connected ? 'Connected' : 'Reconnecting…'}
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

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
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
          }}>
            ⭐ {totalScore.toLocaleString()}
          </span>
        </div>

        {/* Question body */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 20px 16px',
          gap: 20,
        }}>
          {/* Timer + question */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0 }}>
              {!answered && !answerRevealed && (
                <CountdownRing seconds={timeLeft} total={20} />
              )}
              {(answered || answerRevealed) && (
                <div style={{
                  width: 100, height: 100,
                  display: 'grid', placeItems: 'center',
                  fontSize: '2.5rem',
                }}>
                  {answered && myAnswer !== null
                    ? (answerRevealed
                        ? (choices[myAnswer]?.is_correct ? '✅' : '❌')
                        : '✍️')
                    : '⏱️'}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8, fontWeight: 600 }}>
                QUESTION {(gameInfo?.current_question_index ?? 0) + 1} OF {gameInfo?.question_count ?? '?'}
              </div>
              <h2 style={{
                color: 'var(--text)',
                fontSize: '1.2rem',
                fontWeight: 700,
                margin: 0,
                lineHeight: 1.4,
              }}>
                {currentQ?.body || 'Loading question…'}
              </h2>
            </div>
          </div>

          {/* Answer feedback */}
          {answered && !answerRevealed && (
            <div style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 14,
              padding: '12px 18px',
              color: 'var(--accent)',
              fontWeight: 600,
              textAlign: 'center',
              fontSize: '0.9rem',
            }}>
              ✅ Answer submitted! Waiting for reveal…
            </div>
          )}

          {answered && answerRevealed && (
            <div style={{
              background: myScore > 0
                ? 'rgba(67,184,156,0.15)'
                : 'rgba(255,101,132,0.15)',
              border: `1px solid ${myScore > 0 ? 'rgba(67,184,156,0.3)' : 'rgba(255,101,132,0.3)'}`,
              borderRadius: 14,
              padding: '12px 18px',
              color: myScore > 0 ? '#43b89c' : '#ff6584',
              fontWeight: 700,
              textAlign: 'center',
            }}>
              {myScore > 0 ? `🎉 Correct! +${myScore} points` : '❌ Incorrect'}
            </div>
          )}

          {/* Choice buttons */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
            marginTop: 'auto',
          }}>
            {choices.map((choice, i) => {
              const style = CHOICE_STYLES[i] || CHOICE_STYLES[0]
              const isMyChoice = myAnswer === i
              const isCorrect = choice.is_correct
              let opacity = 1
              if (answerRevealed && !isCorrect) opacity = 0.4
              if (answered && !isMyChoice && !answerRevealed) opacity = 0.55

              return (
                <button
                  key={i}
                  id={`choice-${i}`}
                  onClick={() => handleAnswer(i)}
                  disabled={answered || answerRevealed || timeLeft === 0}
                  style={{
                    background: style.bg,
                    border: isMyChoice
                      ? '3px solid #fff'
                      : '3px solid transparent',
                    borderRadius: 16,
                    padding: '18px 14px',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '1rem',
                    cursor: answered || answerRevealed ? 'default' : 'pointer',
                    opacity,
                    transition: 'all 0.25s',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 72,
                    boxShadow: isMyChoice ? '0 0 0 4px rgba(255,255,255,0.2)' : 'none',
                    transform: isMyChoice ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <span style={{
                    fontWeight: 900,
                    fontSize: '1.2rem',
                    minWidth: 28,
                    textAlign: 'center',
                  }}>
                    {style.label}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>{choice.text}</span>
                  {answerRevealed && isCorrect && (
                    <span style={{ marginLeft: 'auto' }}>✓</span>
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
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 20px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          {/* Score hero */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: '3rem', marginBottom: 10 }}>
              {myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🎮'}
            </div>
            <h1 style={{ color: 'var(--text)', fontWeight: 800, fontSize: '1.8rem', margin: '0 0 6px' }}>
              {participant?.nickname || 'Player'}
            </h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
              {myRank > 0 ? `Rank #${myRank} of ${leaderboard.length}` : 'Game over!'}
            </div>
            <div style={{
              display: 'inline-block',
              background: 'var(--accent)',
              borderRadius: 20,
              padding: '12px 28px',
              color: '#fff',
              fontWeight: 900,
              fontSize: '2.2rem',
              boxShadow: 'var(--shadow)',
            }}>
              {totalScore.toLocaleString()} pts
            </div>
          </div>

          {/* Leaderboard */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '0.8rem',
              letterSpacing: '0.05em',
            }}>
              LEADERBOARD
            </div>
            {leaderboard.slice(0, 10).map((p, i) => {
              const isMe = participant && p.participant_id === participant.participant_id
              return (
                <div
                  key={p.participant_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: isMe ? 'var(--accent-soft)' : 'transparent',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: i === 0 ? '#f9a825' : i === 1 ? 'rgba(255,255,255,0.3)' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.08)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 900,
                    fontSize: '0.88rem',
                    color: i < 3 ? '#fff' : 'rgba(255,255,255,0.5)',
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, color: isMe ? '#a8a4ff' : '#fff', fontWeight: isMe ? 800 : 600 }}>
                    {p.nickname}{isMe && ' (you)'}
                  </div>
                  <div style={{ color: '#43b89c', fontWeight: 800 }}>
                    {p.total_score.toLocaleString()}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.78rem' }}>
                    {p.correct_count}/{totalQs}
                  </div>
                </div>
              )
            })}
          </div>

          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: 24, fontSize: '0.82rem' }}>
            Thanks for playing on OptiLearn 🎉
          </p>
        </div>
      </div>
    )
  }

  return null
}
