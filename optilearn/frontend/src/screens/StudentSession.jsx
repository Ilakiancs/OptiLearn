import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  Camera,
  CaretRight,
  CheckCircle,
  ChatCircleText,
  ClockCounterClockwise,
  PaperPlaneTilt,
  Paperclip,
  Plus,
  Sparkle,
  Translate,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  feature1,
  getChatSessions,
  getHealth,
  getSessionMessages,
  getStudent,
  startPersonaCall,
  startSession,
  submitQuiz,
  uploadImage,
} from '../api/client'
import PersonaPickerPopup from '../components/PersonaPickerPopup'
import PersonaVoiceChat from '../components/PersonaVoiceChat'
import ChatMessage from '../components/ChatMessage'
import MasteryBadge from '../components/MasteryBadge'
import QuizCard from '../components/QuizCard'
import Spinner from '../components/Spinner'
import { useSSE } from '../hooks/useSSE'

const TOOL_LABELS = {
  detect_language: 'Checking language...',
  retrieve_curriculum: 'Looking up curriculum...',
  generate_quiz: 'Preparing a quick check...',
  update_progress: 'Saving progress...',
}

function encouragement(score) {
  if (score === 1) return "Perfect! You've got this."
  if (score >= 0.75) return 'Great work, keep it up!'
  if (score >= 0.5) return "Good effort. Let's keep practicing."
  return "Let's look at this again together."
}

function sessionDateLabel(value) {
  if (!value) return 'Saved chat'
  try {
    return new Date(value).toLocaleString()
  } catch (_) {
    return value
  }
}

function previewText(value) {
  return String(value || 'AI Tutor conversation')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

const css = `
@keyframes spin { to { transform: rotate(360deg); } }
.tutor-workspace {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(248px, 312px);
  gap: 14px;
}
.tutor-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tutor-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.tutor-select {
  min-height: 40px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 0 12px;
  font: inherit;
  outline: none;
}
.tutor-icon-button {
  min-width: 42px;
  min-height: 42px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.tutor-input {
  flex: 1;
  min-height: 44px;
  max-height: 116px;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 10px 12px;
  background: var(--surface-soft);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
  outline: none;
}
.tutor-send {
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.tutor-send:disabled {
  cursor: default;
  opacity: 0.55;
}
.saved-chat {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text);
  border-radius: 12px;
  padding: 10px;
  text-align: left;
  cursor: pointer;
}
.saved-chat:hover {
  border-color: var(--accent);
}
@media (max-width: 1100px) {
  .tutor-workspace {
    height: auto;
    grid-template-columns: 1fr;
  }
  .tutor-panel {
    min-height: 560px;
  }
}
`

export default function StudentSession() {
  const { studentId } = useParams()
  const outlet = useOutletContext() || {}
  const navigate = useNavigate()
  const { connect, disconnect } = useSSE()

  const [student, setStudent] = useState(outlet.student || null)
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [currentTopic, setCurrentTopic] = useState(null)
  const [quizData, setQuizData] = useState(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState([])
  const [quizResult, setQuizResult] = useState(null)
  const [mode, setMode] = useState('chat')
  const [imageB64, setImageB64] = useState(null)
  const [imageAttachment, setImageAttachment] = useState(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [activeToolNotice, setActiveToolNotice] = useState(null)
  const [inputText, setInputText] = useState('')
  const [pendingAnswer, setPendingAnswer] = useState(null)
  const [languages, setLanguages] = useState([])
  const [conversationLanguage, setConversationLanguage] = useState('en')
  const [savedChats, setSavedChats] = useState([])
  const [savedChatsLoading, setSavedChatsLoading] = useState(false)
  const [openingChatId, setOpeningChatId] = useState(null)
  const [uiMessage, setUiMessage] = useState('')

  const [isOnline, setIsOnline] = useState(false)
  const [showPersonaPicker, setShowPersonaPicker] = useState(false)
  const [personaCallData, setPersonaCallData] = useState(null)
  const [personaLoading, setPersonaLoading] = useState(false)

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (outlet.student) {
      setStudent(outlet.student)
      if (outlet.student.language) setConversationLanguage(outlet.student.language)
    }
  }, [outlet.student])

  useEffect(() => {
    feature1.getLanguages().then(setLanguages).catch(() => {})
  }, [])

  useEffect(() => {
    function refreshOnlineStatus() {
      getHealth()
        .then(s => setIsOnline(s.network?.use_26b === true))
        .catch(() => setIsOnline(false))
    }
    refreshOnlineStatus()
    window.addEventListener('optilearn:model-switch', refreshOnlineStatus)
    return () => window.removeEventListener('optilearn:model-switch', refreshOnlineStatus)
  }, [])

  async function loadSavedChats() {
    if (!studentId) return
    setSavedChatsLoading(true)
    try {
      const data = await getChatSessions(studentId)
      setSavedChats(data.sessions || [])
    } catch (_) {
      setSavedChats([])
    } finally {
      setSavedChatsLoading(false)
    }
  }

  async function startFreshChat(studentRecord = student) {
    disconnect()
    setIsThinking(false)
    setActiveToolNotice(null)
    const sess = await startSession(studentId)
    setSessionId(sess.id)
    setMode('chat')
    setQuizData(null)
    setQuizResult(null)
    setQuizAnswers([])
    setQuizIndex(0)
    setCurrentTopic(null)
    setUiMessage('')
    setMessages([
      {
        role: 'assistant',
        content: `Hi ${studentRecord?.name || 'there'}! What would you like to learn today?`,
        isStreaming: false,
      },
    ])
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function init() {
      try {
        const s = outlet.student || await getStudent(studentId)
        setStudent(s)
        setConversationLanguage(s.language || 'en')
        await startFreshChat(s)
        await loadSavedChats()
      } catch (err) {
        if (err.message?.includes('404') || err.message?.includes('not found')) {
          navigate('/')
        } else {
          setUiMessage(err.message || 'The tutor is still getting ready.')
        }
      }
    }
    init()
  }, [studentId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, mode])

  function appendUserMessage(content, attachment = null) {
    setMessages(prev => [...prev, { role: 'user', content, attachment, isStreaming: false }])
  }

  function appendAssistantMessage() {
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }])
  }

  function updateLastAssistant(token) {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + token }
      return copy
    })
  }

  function finalizeLastAssistant() {
    setMessages(prev => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, isStreaming: false }
      return copy
    })
  }

  function sendMessage(text, img = null, sessId = null) {
    const sid = sessId || sessionId
    if (!sid) return

    appendUserMessage(text, img ? { type: 'image', label: imageAttachment?.name ? `Image attached: ${imageAttachment.name}` : 'Image attached' } : null)
    appendAssistantMessage()
    setIsThinking(true)
    setActiveToolNotice(null)
    setUiMessage('')

    connect(
      {
        student_id: studentId,
        session_id: sid,
        message: text,
        image_b64: img || null,
        language: conversationLanguage,
        model_preference: 'fast',
      },
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
          loadSavedChats()
        },
        onError(message) {
          setIsThinking(false)
          setActiveToolNotice(null)
          finalizeLastAssistant()
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `Something got in the way: ${message}`, isStreaming: false },
          ])
        },
      }
    )
  }

  function handleSend() {
    const text = inputText.trim()
    if ((!text && !imageB64) || isThinking) return
    const img = imageB64
    const fallbackText = 'Please help me understand this image.'
    setInputText('')
    setImageB64(null)
    setImageAttachment(null)
    sendMessage(text || fallbackText, img)
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
    setUiMessage('')
    setIsUploadingImage(true)
    setImageAttachment({
      name: file.name || 'Selected image',
      size: file.size || 0,
      preview: URL.createObjectURL(file),
      status: 'uploading',
    })
    try {
      const { image_b64 } = await uploadImage(file)
      setImageB64(image_b64)
      setImageAttachment({
        name: file.name || 'Selected image',
        size: file.size || 0,
        preview: `data:image/jpeg;base64,${image_b64}`,
        status: 'attached',
      })
    } catch (err) {
      setImageAttachment(null)
      setUiMessage(err.message || 'The image could not be attached.')
    } finally {
      setIsUploadingImage(false)
    }
    e.target.value = ''
  }

  async function openSavedChat(chat) {
    if (!chat?.id || openingChatId) return
    disconnect()
    setOpeningChatId(chat.id)
    setUiMessage('')
    setIsThinking(false)
    setActiveToolNotice(null)
    try {
      const data = await getSessionMessages(chat.id, studentId)
      const restored = (data.messages || [])
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({ role: msg.role, content: msg.content || '', isStreaming: false }))
      setSessionId(chat.id)
      setMode('chat')
      setMessages(restored.length ? restored : [{ role: 'assistant', content: 'This saved chat is ready to continue.', isStreaming: false }])
    } catch (err) {
      setUiMessage(err.message || 'This saved chat could not be opened.')
    } finally {
      setOpeningChatId(null)
    }
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
        try {
          const result = await submitQuiz({
            student_id: studentId,
            session_id: sessionId,
            topic: currentTopic || 'general',
            answers: newAnswers,
          })
          setQuizResult(result)
          setMode('result')
        } catch (_) {
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

  async function handlePersonaSelect(persona) {
    setShowPersonaPicker(false)
    setPersonaLoading(true)
    try {
      const data = await startPersonaCall(persona.id, student?.name || 'Student')
      setPersonaCallData({ ...data, persona })
    } catch (err) {
      setUiMessage(err.message || 'Could not connect to learning companion.')
    } finally {
      setPersonaLoading(false)
    }
  }

  const languageOptions = languages.length
    ? languages
    : [{ code: conversationLanguage || 'en', name: (conversationLanguage || 'en').toUpperCase(), flag: '' }]
  const languageName = languageOptions.find(lang => lang.code === conversationLanguage)?.name || conversationLanguage.toUpperCase()
  const topMastery = student?.topic_mastery?.[0]

  function renderChatPanel() {
    return (
      <section className="surface-card tutor-panel">
        <div className="tutor-toolbar">
          <span className="icon-only" aria-hidden style={{ width: 42, height: 42, borderRadius: 14 }}>
            <Sparkle size={21} weight="duotone" />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.08rem' }}>AI Tutor</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Gemma 4 E2B · {languageName}
            </div>
          </div>
          {currentTopic && <MasteryBadge level={topMastery?.level} />}
          {isOnline && (
            <button
              type="button"
              className="tutor-icon-button"
              onClick={() => setShowPersonaPicker(true)}
              disabled={personaLoading}
              title="Talk with a learning companion"
              style={{ gap: 6, paddingInline: 12, minWidth: 'auto', borderColor: 'var(--accent)', color: 'var(--accent)' }}
            >
              {personaLoading
                ? <span style={{ fontSize: '0.78rem' }}>Connecting…</span>
                : <><ChatCircleText size={18} weight="duotone" /><span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Talk</span></>
              }
            </button>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.86rem' }}>
            <Translate size={18} weight="duotone" />
            <select
              className="tutor-select"
              value={conversationLanguage}
              onChange={e => setConversationLanguage(e.target.value)}
              disabled={isThinking}
            >
              {languageOptions.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
              ))}
            </select>
          </label>
        </div>

        {activeToolNotice && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-muted)',
            background: 'var(--surface-soft)',
            fontSize: '0.84rem',
          }}>
            {activeToolNotice}
          </div>
        )}

        {uiMessage && (
          <div style={{
            margin: '12px 16px 0',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--accent-soft)',
            color: 'var(--text)',
            padding: '10px 12px',
            fontSize: '0.9rem',
          }}>
            <WarningCircle size={18} weight="duotone" />
            <span>{uiMessage}</span>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 12px' }}>
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} attachment={msg.attachment} isStreaming={msg.isStreaming} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {(imageAttachment || isUploadingImage) && (
          <div style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--surface-soft)',
          }}>
            {imageAttachment?.preview && (
              <img
                src={imageAttachment.preview}
                alt=""
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  objectFit: 'cover',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}
              />
            )}
            <span style={{ color: 'var(--text)', display: 'grid', gap: 2, minWidth: 0, flex: 1, fontSize: '0.88rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                {isUploadingImage ? <Spinner size={16} color="var(--accent)" /> : <CheckCircle size={18} weight="fill" color="var(--accent)" />}
                {isUploadingImage ? 'Attaching image...' : 'Image attached'}
              </span>
              {imageAttachment?.name && (
                <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {imageAttachment.name}
                </span>
              )}
            </span>
            <button
              type="button"
              className="tutor-icon-button"
              onClick={() => { setImageB64(null); setImageAttachment(null) }}
              aria-label="Remove image"
              disabled={isUploadingImage}
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        )}

        <div style={{
          padding: 12,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: 'var(--surface)',
        }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={fileInputRef}
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="tutor-icon-button" title="Attach photo">
            <Camera size={22} weight="duotone" />
          </button>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask anything..."
            className="tutor-input"
          />
          <button type="button" onClick={handleSend} disabled={isThinking || isUploadingImage || (!inputText.trim() && !imageB64)} className="tutor-send" aria-label="Send">
            {isThinking ? <Spinner size={22} color="#fff" /> : <PaperPlaneTilt size={22} weight="bold" />}
          </button>
        </div>
      </section>
    )
  }

  function renderSavedChats() {
    return (
      <aside className="surface-card tutor-panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <ClockCounterClockwise size={20} weight="duotone" color="var(--accent)" />
          <div style={{ fontWeight: 800, flex: 1 }}>Saved Chats</div>
          {savedChatsLoading && <Spinner size={18} color="var(--accent)" />}
        </div>
        <button
          type="button"
          className="pill-button primary"
          onClick={() => startFreshChat(student).catch(err => setUiMessage(err.message || 'A new chat could not be opened yet.'))}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        >
          <Plus size={18} weight="bold" />
          <span>New Chat</span>
        </button>
        <div style={{ display: 'grid', gap: 8, overflowY: 'auto', minHeight: 0, paddingRight: 2 }}>
          {!savedChatsLoading && savedChats.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, padding: 8 }}>
              Saved tutor chats will appear here after your first message.
            </div>
          )}
          {savedChats.map(chat => (
            <button key={chat.id} type="button" className="saved-chat" onClick={() => openSavedChat(chat)} disabled={!!openingChatId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ChatCircleText size={18} weight="duotone" color="var(--accent)" />
                <span style={{ fontWeight: 700, fontSize: '0.86rem', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sessionDateLabel(chat.last_message_at || chat.started_at)}
                </span>
                {openingChatId === chat.id ? (
                  <Spinner size={16} color="var(--accent)" />
                ) : (
                  <CaretRight size={16} weight="bold" color="var(--text-muted)" />
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.45, marginTop: 6 }}>
                {previewText(chat.preview)}
              </div>
            </button>
          ))}
        </div>
      </aside>
    )
  }

  if (mode === 'quiz' && quizData) {
    const q = quizData.questions[quizIndex]
    const total = quizData.questions.length

    return (
      <div className="tutor-workspace">
        <style>{css}</style>
        <section className="surface-card tutor-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.08rem' }}>Quick check</div>
              {currentTopic && <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>{currentTopic}</div>}
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>{quizIndex + 1} of {total}</span>
          </div>
          <div style={{ height: 6, background: 'var(--surface-soft)', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ height: '100%', width: `${((quizIndex + 1) / total) * 100}%`, background: 'var(--accent)' }} />
          </div>
          <QuizCard
            question={q.question}
            options={q.options}
            onAnswer={handleQuizAnswer}
            answered={pendingAnswer !== null}
            selectedAnswer={pendingAnswer?.answer}
            correctAnswer={pendingAnswer?.correctAnswer}
          />
        </section>
        {renderSavedChats()}
      </div>
    )
  }

  if (mode === 'result' && quizResult) {
    const correct = Math.round(quizResult.score * (quizData?.questions?.length || 1))
    const total = quizData?.questions?.length || 1
    const levelChanged = quizResult.new_level !== (quizResult.previous_level || quizResult.new_level)

    return (
      <div className="tutor-workspace">
        <style>{css}</style>
        <section className="surface-card tutor-panel" style={{ padding: 24, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
            {correct} / {total}
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>completed</p>
          {levelChanged && (
            <div style={{ background: 'var(--accent-soft)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 20px', marginBottom: 20, fontWeight: 700 }}>
              You reached {quizResult.new_level.charAt(0).toUpperCase() + quizResult.new_level.slice(1)}!
            </div>
          )}
          <div style={{ width: '100%', maxWidth: 420, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: 6 }}>
              <span>Mastery: {currentTopic || 'topic'}</span>
              <span>{Math.round(quizResult.mastery * 100)}%</span>
            </div>
            <div style={{ height: 10, background: 'var(--surface-soft)', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${quizResult.mastery * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          <p style={{ fontSize: '1.05rem', marginBottom: 28 }}>{encouragement(quizResult.score)}</p>
          <button type="button" onClick={handleKeepLearning} className="pill-button primary" style={{ minWidth: 180, justifyContent: 'center' }}>
            Keep learning
          </button>
        </section>
        {renderSavedChats()}
      </div>
    )
  }

  return (
    <div className="tutor-workspace">
      <style>{css}</style>
      {renderChatPanel()}
      {renderSavedChats()}

      {showPersonaPicker && (
        <PersonaPickerPopup
          onSelect={handlePersonaSelect}
          onDismiss={() => setShowPersonaPicker(false)}
        />
      )}

      {personaCallData && (
        <PersonaVoiceChat
          callData={personaCallData}
          onClose={() => setPersonaCallData(null)}
        />
      )}
    </div>
  )
}
