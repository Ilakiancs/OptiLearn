import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getStudent, startSession, uploadImage, submitQuiz } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import ChatMessage from '../components/ChatMessage'
import QuizCard from '../components/QuizCard'
import MasteryBadge from '../components/MasteryBadge'

const TOOL_LABELS = {
  detect_language: 'Detecting language...',
  retrieve_curriculum: 'Looking up curriculum...',
  generate_quiz: 'Generating quiz...',
  update_progress: 'Saving progress...',
}

function encouragement(score) {
  if (score === 1) return 'Perfect! You\'ve got this.'
  if (score >= 0.75) return 'Great work, keep it up!'
  if (score >= 0.5) return 'Good effort. Let\'s keep practicing.'
  return 'Let\'s go over this again together.'
}

export default function StudentSession() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const { connect, disconnect, isConnected } = useSSE()

  const [student, setStudent] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [currentTopic, setCurrentTopic] = useState(null)
  const [quizData, setQuizData] = useState(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState([])
  const [quizResult, setQuizResult] = useState(null)
  const [mode, setMode] = useState('chat')
  const [imageB64, setImageB64] = useState(null)
  const [isThinking, setIsThinking] = useState(false)
  const [activeToolNotice, setActiveToolNotice] = useState(null)
  const [inputText, setInputText] = useState('')
  const [pendingAnswer, setPendingAnswer] = useState(null)

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const textAreaRef = useRef(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function init() {
      try {
        const s = await getStudent(studentId)
        setStudent(s)
        const sess = await startSession(studentId)
        setSessionId(sess.id)
        // Prime the model
        sendMessage('Hello, I am ready to learn.', null, sess.id)
      } catch (err) {
        if (err.message?.includes('404') || err.message?.includes('not found')) {
          navigate('/')
        }
      }
    }
    init()
  }, [studentId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, mode])

  function appendUserMessage(content) {
    setMessages(prev => [...prev, { role: 'user', content, isStreaming: false }])
  }

  function appendAssistantMessage() {
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }])
  }

  function updateLastAssistant(token) {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = { ...last, content: last.content + token }
      }
      return copy
    })
  }

  function finalizeLastAssistant() {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = { ...last, isStreaming: false }
      }
      return copy
    })
  }

  function sendMessage(text, img = null, sessId = null) {
    const sid = sessId || sessionId
    if (!sid) return

    if (text !== 'Hello, I am ready to learn.') {
      appendUserMessage(text)
    }
    appendAssistantMessage()
    setIsThinking(true)
    setActiveToolNotice(null)

    connect(
      { student_id: studentId, session_id: sid, message: text, image_b64: img || null },
      {
        onToken(content) {
          updateLastAssistant(content)
        },
        onToolStart(tool) {
          setActiveToolNotice(TOOL_LABELS[tool] || `Using ${tool}...`)
        },
        onToolDone(tool, result) {
          setActiveToolNotice(null)
          if (tool === 'retrieve_curriculum' && result?.[0]?.passage) {
            // Extract topic hint from result source
            const src = result[0]?.source?.replace('.txt', '').replace(/_/g, ' ')
            if (src) setCurrentTopic(src)
          }
          if (tool === 'generate_quiz' && result?.questions) {
            setQuizData(result)
            setQuizIndex(0)
            setQuizAnswers([])
            setMode('quiz')
          }
        },
        onDone() {
          setIsThinking(false)
          setActiveToolNotice(null)
          finalizeLastAssistant()
        },
        onError(message) {
          setIsThinking(false)
          setActiveToolNotice(null)
          finalizeLastAssistant()
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `Something went wrong: ${message}`, isStreaming: false },
          ])
        },
      }
    )
  }

  function handleSend() {
    const text = inputText.trim()
    if (!text || isThinking) return
    const img = imageB64
    setInputText('')
    setImageB64(null)
    sendMessage(text, img)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const { image_b64 } = await uploadImage(file)
      setImageB64(image_b64)
    } catch (err) {
      console.error('Image upload failed:', err.message)
    }
    e.target.value = ''
  }

  function handleQuizAnswer(answer) {
    if (pendingAnswer !== null) return
    const question = quizData.questions[quizIndex]
    const isCorrect = answer === question.answer

    setPendingAnswer({ answer, isCorrect, correctAnswer: question.answer })

    setTimeout(async () => {
      const newAnswers = [...quizAnswers, {
        question_id: question.id,
        answer,
        correct_answer: question.answer,
      }]
      setQuizAnswers(newAnswers)
      setPendingAnswer(null)

      if (quizIndex + 1 < quizData.questions.length) {
        setQuizIndex(i => i + 1)
      } else {
        // Last question — auto-submit
        try {
          const result = await submitQuiz({
            student_id: studentId,
            session_id: sessionId,
            topic: currentTopic || 'general',
            answers: newAnswers,
          })
          setQuizResult(result)
          setMode('result')
        } catch (err) {
          setMode('chat')
        }
      }
    }, 600)
  }

  function handleKeepLearning() {
    setMode('chat')
    setQuizData(null)
    setQuizResult(null)
    setQuizAnswers([])
    setQuizIndex(0)
    setPendingAnswer(null)
  }

  const topMastery = student?.topic_mastery?.[0]

  // ── CHAT MODE ──────────────────────────────────────────────
  if (mode === 'chat') {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {/* Header */}
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexShrink: 0,
        }}>
          <Link to="/" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '1.2rem', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            ←
          </Link>
          <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {student?.name || '...'}
          </span>
          {currentTopic && <MasteryBadge level={topMastery?.level} />}
        </header>

        {/* Tool notice */}
        {activeToolNotice && (
          <div style={{
            background: 'var(--color-surface-2)',
            borderBottom: '1px solid var(--color-border)',
            padding: '6px 16px',
            fontSize: '0.82rem',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}>
            {activeToolNotice}
          </div>
        )}

        {/* Message thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} isStreaming={msg.isStreaming} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Image preview */}
        {imageB64 && (
          <div style={{
            padding: '8px 16px',
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>📎 Image attached</span>
            <button
              onClick={() => setImageB64(null)}
              style={{
                background: 'none', border: 'none', color: 'var(--color-danger)',
                cursor: 'pointer', fontSize: '1rem', padding: '4px 8px', minHeight: 44,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Input area */}
        <div style={{
          padding: '12px 12px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          flexShrink: 0,
        }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileInputRef}
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              minWidth: 44, minHeight: 44, background: 'none',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)', fontSize: '1.2rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            title="Attach photo"
          >
            📷
          </button>

          <textarea
            ref={textAreaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Type a message..."
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
              color: 'var(--color-text)',
              fontSize: '1rem',
              resize: 'none',
              maxHeight: '100px',
              overflowY: 'auto',
              lineHeight: 1.5,
              minHeight: '44px',
            }}
          />

          <button
            onClick={handleSend}
            disabled={isThinking || !inputText.trim()}
            style={{
              minWidth: 44, minHeight: 44,
              background: isThinking || !inputText.trim() ? 'var(--color-primary-dim)' : 'var(--color-primary)',
              border: 'none', borderRadius: 'var(--radius-md)',
              color: '#fff', fontSize: '1.1rem', cursor: isThinking ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ↑
          </button>
        </div>
      </div>
    )
  }

  // ── QUIZ MODE ──────────────────────────────────────────────
  if (mode === 'quiz' && quizData) {
    const q = quizData.questions[quizIndex]
    const total = quizData.questions.length

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        padding: '0 0 40px',
      }}>
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <Link to="/" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '1.2rem', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            ←
          </Link>
          <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }}>Quick check</span>
          {currentTopic && (
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{currentTopic}</span>
          )}
        </header>

        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '32px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              {quizIndex + 1} of {total}
            </span>
            <div style={{
              height: '4px', flex: 1, margin: '0 12px',
              background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${((quizIndex + 1) / total) * 100}%`,
                background: 'var(--color-primary)',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>

          <QuizCard
            question={q.question}
            options={q.options}
            onAnswer={handleQuizAnswer}
            answered={pendingAnswer !== null}
            selectedAnswer={pendingAnswer?.answer}
            correctAnswer={pendingAnswer?.correctAnswer}
          />
        </div>
      </div>
    )
  }

  // ── RESULT MODE ────────────────────────────────────────────
  if (mode === 'result' && quizResult) {
    const correct = Math.round(quizResult.score * (quizData?.questions?.length || 1))
    const total = quizData?.questions?.length || 1
    const levelChanged = quizResult.new_level !== (quizResult.previous_level || quizResult.new_level)

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}>
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <Link to="/" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '1.2rem', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            ←
          </Link>
          <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Results</span>
        </header>

        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
          <div style={{
            fontSize: '3rem',
            fontWeight: 800,
            color: quizResult.score >= 0.75 ? 'var(--color-success)' : 'var(--color-warning)',
            marginBottom: '8px',
          }}>
            {correct} / {total}
          </div>
          <p style={{ fontSize: '1rem', color: 'var(--color-text-muted)', marginBottom: '24px' }}>correct</p>

          {levelChanged && (
            <div style={{
              background: '#14532d',
              color: '#4ade80',
              borderRadius: 'var(--radius-md)',
              padding: '12px 20px',
              marginBottom: '20px',
              fontWeight: 600,
            }}>
              You reached {quizResult.new_level.charAt(0).toUpperCase() + quizResult.new_level.slice(1)}!
            </div>
          )}

          {/* Mastery bar */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 6,
            }}>
              <span>Mastery: {currentTopic || 'topic'}</span>
              <span>{Math.round(quizResult.mastery * 100)}%</span>
            </div>
            <div style={{
              height: '10px', background: 'var(--color-border)',
              borderRadius: 'var(--radius-sm)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${quizResult.mastery * 100}%`,
                background: quizResult.mastery >= 0.75 ? 'var(--color-success)' : quizResult.mastery >= 0.45 ? 'var(--color-warning)' : 'var(--color-danger)',
                transition: 'width 0.6s',
              }} />
            </div>
          </div>

          <p style={{
            fontSize: '1.1rem',
            color: 'var(--color-text)',
            marginBottom: '32px',
            fontStyle: 'italic',
          }}>
            {encouragement(quizResult.score)}
          </p>

          <button
            onClick={handleKeepLearning}
            style={{
              width: '100%',
              padding: '14px',
              minHeight: '44px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Keep learning
          </button>
        </div>
      </div>
    )
  }

  // Loading / transitional state
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--color-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 32, height: 32, border: '3px solid var(--color-border)',
        borderTopColor: 'var(--color-primary)', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
