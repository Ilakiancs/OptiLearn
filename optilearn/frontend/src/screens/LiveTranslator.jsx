import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import {
  CheckCircle as CheckCircle2,
  DownloadSimple as Download,
  FileText,
  Microphone as Mic,
  SpeakerHigh as Volume2,
  Sparkle as Sparkles,
  StopCircle,
  Translate as Languages,
} from '@phosphor-icons/react'
import FormattedText, { normalizeOutputText } from '../components/FormattedText'
import Spinner from '../components/Spinner'
import { saveBlobAsPdf } from '../api/client'
import LanguageSelect from '../components/LanguageSelect'

const C = {
  primary: 'var(--accent)',
  primaryLight: 'var(--accent-soft)',
  surface: 'var(--surface)',
  surfaceAlt: 'var(--surface-soft)',
  border: 'var(--border)',
  textPrimary: 'var(--text)',
  textSecondary: 'var(--text-muted)',
  danger: 'var(--accent)',
  dangerLight: 'var(--accent-soft)',
  green: 'var(--success)',
}

const LIVE_AUDIO_SAMPLE_RATE = 16000
const WORDS_PER_TRANSLATION_CHUNK = 20

// ── WAV conversion helpers ─────────────────────────────────────
function buildWavBuffer(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset, str) =>
    [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  new Int16Array(buffer, 44).set(samples)
  return buffer
}

function resampleFloat32Samples(samples, sourceRate, targetRate) {
  if (!sourceRate || sourceRate === targetRate || samples.length <= 1) return samples
  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate))
  const resampled = new Float32Array(targetLength)
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1)
  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = position - left
    resampled[i] = samples[left] * (1 - weight) + samples[right] * weight
  }
  return resampled
}

// ── Markdown renderer (subset) ─────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null
  return <FormattedText text={text} fontSize={15} headingSize={16} color={C.textPrimary} />
  /*
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## '))
      return (
        <div
          key={i}
          style={{
            fontSize: 16, fontWeight: 700, paddingBottom: 6,
            borderBottom: `1px solid ${C.border}`, marginTop: 20, marginBottom: 8,
            color: C.textPrimary,
          }}
        >
          {line.slice(3)}
        </div>
      )
    if (line.startsWith('- ') || line.startsWith('* '))
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginLeft: 16, lineHeight: 1.7, color: C.textPrimary, fontSize: 15 }}>
          <span>•</span><span>{line.slice(2)}</span>
        </div>
      )
    if (line.trim() === '') return <div key={i} style={{ height: 8 }} />
    return <p key={i} style={{ fontSize: 15, lineHeight: 1.7, color: C.textPrimary, margin: '3px 0' }}>{line}</p>
  })
  */
}

function cleanOutput(value) {
  return normalizeOutputText(value || '')
}

function cleanChunkOutput(chunk) {
  const next = { ...(chunk || {}) }
  if (typeof next.translated === 'string') next.translated = cleanOutput(next.translated)
  if (typeof next.text === 'string') next.text = cleanOutput(next.text)
  return next
}

// ── Pulsing dot indicator ──────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', padding: '8px 0', alignItems: 'center' }}>
      <Spinner size={18} color={C.primary} />
    </div>
  )
}

// ── TTS streaming playback (identical to TranslateLearn) ───────
function useTTS() {
  const audioCtxRef = useRef(null)
  const playingRef = useRef(null)
  const [playingId, setPlayingId] = useState(null)

  function stop() {
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch (_) {}
      audioCtxRef.current = null
    }
    playingRef.current = null
    setPlayingId(null)
  }

  async function speak(text, language, id) {
    if (playingRef.current === id) { stop(); return }
    stop()
    if (!text?.trim()) return
    playingRef.current = id
    setPlayingId(id)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      const response = await fetch('/api/tts/speak-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizeOutputText(text).slice(0, 3000), language }),
      })
      if (!response.ok) { stop(); return }
      const reader = response.body.getReader()
      let buf = new Uint8Array(0)
      let scheduledUntil = ctx.currentTime
      let lastSource = null

      const flush = async () => {
        while (buf.length >= 4) {
          const chunkLen = new DataView(buf.buffer, 0, 4).getUint32(0, true)
          if (buf.length < 4 + chunkLen) break
          const wav = buf.slice(4, 4 + chunkLen)
          buf = buf.slice(4 + chunkLen)
          try {
            const decoded = await ctx.decodeAudioData(wav.buffer)
            if (audioCtxRef.current !== ctx) return
            const src = ctx.createBufferSource()
            src.buffer = decoded
            src.connect(ctx.destination)
            const startAt = Math.max(scheduledUntil, ctx.currentTime + 0.05)
            src.start(startAt)
            scheduledUntil = startAt + decoded.duration
            lastSource = src
          } catch (_) {}
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          const merged = new Uint8Array(buf.length + value.length)
          merged.set(buf); merged.set(value, buf.length); buf = merged
          await flush()
        }
        if (done) break
      }
      if (lastSource) {
        lastSource.onended = () => {
          if (audioCtxRef.current === ctx) { playingRef.current = null; setPlayingId(null) }
        }
      } else { stop() }
    } catch (_) { stop() }
  }

  return { speak, stop, playingId }
}

// ── Main component ─────────────────────────────────────────────
export default function LiveTranslator() {
  const { student, studentId } = useOutletContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const selectedSessionId = searchParams.get('session')
  const tts = useTTS()

  // Phase: "idle" | "recording" | "ending" | "notes"
  const [phase, setPhase] = useState('idle')
  const [sessionId, setSessionId] = useState(null)
  const [targetLanguage, setTargetLanguage] = useState(student?.language || 'en')
  const [lessonLanguage, setLessonLanguage] = useState('en')
  const [languages, setLanguages] = useState([])
  const [chunks, setChunks] = useState([])
  const [isProcessingChunk, setIsProcessingChunk] = useState(false)
  const [isProcessingTranslation, setIsProcessingTranslation] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [transcriptText, setTranscriptText] = useState('')
  const [detectedTeacherLanguage, setDetectedTeacherLanguage] = useState('en')
  const [pastSessions, setPastSessions] = useState([])
  const [loadingPast, setLoadingPast] = useState(false)
  const [isDownloadingNotes, setIsDownloadingNotes] = useState(false)
  const [isDownloadingTranscript, setIsDownloadingTranscript] = useState(false)
  const [pdfToast, setPdfToast] = useState(null)
  const [micError, setMicError] = useState(null)
  const [translatorPreparing, setTranslatorPreparing] = useState(false)
  const [translatorStatusText, setTranslatorStatusText] = useState('Preparing live translation')
  const [translationProgress, setTranslationProgress] = useState(0)
  const [translationStatusText, setTranslationStatusText] = useState('')
  const [originalTranscriptText, setOriginalTranscriptText] = useState('')
  const [translatedTranscriptText, setTranslatedTranscriptText] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [recordingTab, setRecordingTab] = useState('translation')
  const [notesTab, setNotesTab] = useState('notes')
  const isCompact = viewportWidth < 860

  // ── Shared Live Class (teacher-led) join state ─────────────────
  const [activeSessions, setActiveSessions] = useState([])
  const [joinedSession, setJoinedSession] = useState(null) // {session_id, title, source_language, status}
  const [joinLang, setJoinLang] = useState(student?.language || 'en')
  const [joiningId, setJoiningId] = useState(null)
  const [liveChunks, setLiveChunks] = useState([])
  const [liveStatus, setLiveStatus] = useState(null)
  const [liveNotes, setLiveNotes] = useState('')
  const [liveSourceChunks, setLiveSourceChunks] = useState([])
  const [liveError, setLiveError] = useState(null)
  const [isDownloadingLiveNotes, setIsDownloadingLiveNotes] = useState(false)
  const [isDownloadingLiveTranscript, setIsDownloadingLiveTranscript] = useState(false)
  const [livePdfToast, setLivePdfToast] = useState(null)
  const [liveNotesTab, setLiveNotesTab] = useState('notes') // compact mode tab
  const [liveNotesStreaming, setLiveNotesStreaming] = useState(false)
  const [pastLiveSessions, setPastLiveSessions] = useState([])
  const [loadingPastLive, setLoadingPastLive] = useState(false)
  const liveSSEAbortRef = useRef(null)

  // Refs
  const sessionIdRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const audioCaptureRef = useRef(null)
  const pcmChunksRef = useRef([])
  const sampleRateRef = useRef(44100)
  const chunksRef = useRef([])
  const chunkQueueRef = useRef([])
  const processingQueueRef = useRef(false)
  const queueWaitersRef = useRef([])
  const chunkIndexRef = useRef(0)
  const leftPanelRef = useRef(null)
  const rightPanelRef = useRef(null)
  const chunkCountRef = useRef(0)
  const finalizingRef = useRef(false)
  const rawTranscriptPartsRef = useRef([])
  const pendingWordsRef = useRef([])
  const translationQueueRef = useRef([])
  const processingTranslationRef = useRef(false)
  const translationWaitersRef = useRef([])
  const translationIndexRef = useRef(0)
  const stopTranslationDoneRef = useRef(0)
  const stopTranslationTotalRef = useRef(0)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function replaceChunks(next) {
    chunksRef.current = next
    setChunks(next)
  }

  function setChunkAt(index, chunk) {
    const next = [...chunksRef.current]
    next[index] = { ...(next[index] || {}), ...cleanChunkOutput(chunk) }
    chunksRef.current = next
    setChunks(next)
  }

  function createChunkCommitter(index) {
    let scheduled = false
    let translatedText = chunksRef.current[index]?.translated || ''
    const commit = () => {
      scheduled = false
      setChunkAt(index, { translated: cleanOutput(translatedText) })
    }
    return {
      append(token) {
        translatedText += token
        if (!scheduled) {
          scheduled = true
          requestAnimationFrame(commit)
        }
      },
      flush(finalText) {
        if (typeof finalText === 'string') translatedText = finalText
        if (scheduled) scheduled = false
        setChunkAt(index, { translated: cleanOutput(translatedText) })
      },
      value() {
        return translatedText
      },
    }
  }

  function resolveQueueWaiters() {
    const waiters = queueWaitersRef.current
    queueWaitersRef.current = []
    waiters.forEach(resolve => resolve())
  }

  function enqueueChunk(item) {
    chunkQueueRef.current.push(item)
    processChunkQueue()
  }

  async function processChunkQueue() {
    if (processingQueueRef.current) return
    processingQueueRef.current = true
    setIsProcessingChunk(true)
    while (chunkQueueRef.current.length > 0) {
      const item = chunkQueueRef.current.shift()
      await sendChunk(item.wavBlob, item.idx, item.sessionId, item.targetLanguage, item.lessonLanguage)
    }
    processingQueueRef.current = false
    setIsProcessingChunk(false)
    resolveQueueWaiters()
  }

  async function waitForQueuedChunks() {
    if (!processingQueueRef.current && chunkQueueRef.current.length === 0) return
    await new Promise(resolve => queueWaitersRef.current.push(resolve))
  }

  function resolveTranslationWaiters() {
    const waiters = translationWaitersRef.current
    translationWaitersRef.current = []
    waiters.forEach(resolve => resolve())
  }

  function wordsFromTranscript(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean)
  }

  function enqueueTranslation(item) {
    translationQueueRef.current.push(item)
    processTranslationQueue()
  }

  function updateStopTranslationProgress() {
    const total = stopTranslationTotalRef.current
    if (!finalizingRef.current || total <= 0) return
    stopTranslationDoneRef.current = Math.min(total, stopTranslationDoneRef.current + 1)
    const done = stopTranslationDoneRef.current
    const progress = Math.round((done / total) * 100)
    setTranslationProgress(progress)
    setTranslationStatusText(`Translating ${done} of ${total} remaining sections`)
  }

  async function processTranslationQueue() {
    if (processingTranslationRef.current) return
    processingTranslationRef.current = true
    setIsProcessingTranslation(true)
    while (translationQueueRef.current.length > 0) {
      const item = translationQueueRef.current.shift()
      await sendTextChunk(item)
      updateStopTranslationProgress()
    }
    processingTranslationRef.current = false
    setIsProcessingTranslation(false)
    resolveTranslationWaiters()
  }

  async function waitForTranslationQueue() {
    if (!processingTranslationRef.current && translationQueueRef.current.length === 0) return
    await new Promise(resolve => translationWaitersRef.current.push(resolve))
  }

  function queueTranscriptWords(text, timestamp, detectedLanguage, sid) {
    const words = wordsFromTranscript(text)
    if (words.length === 0) return
    pendingWordsRef.current.push(...words)
    while (pendingWordsRef.current.length >= WORDS_PER_TRANSLATION_CHUNK) {
      queueTranslationWords(
        pendingWordsRef.current.splice(0, WORDS_PER_TRANSLATION_CHUNK),
        timestamp,
        detectedLanguage,
        sid,
      )
    }
  }

  function queueTranslationWords(words, timestamp, detectedLanguage, sid) {
    if (!words.length) return
    const index = translationIndexRef.current++
    const original = words.join(' ')
    const chunk = {
      index,
      original,
      translated: '',
      timestamp: timestamp || new Date().toTimeString().slice(0, 5),
      detected_language: detectedLanguage || lessonLanguage || 'en',
      session_id: sid || sessionIdRef.current || sessionId,
    }
    setChunkAt(index, chunk)
    enqueueTranslation(chunk)
  }

  function flushPendingTranscriptWords() {
    if (pendingWordsRef.current.length === 0) return
    const words = pendingWordsRef.current.splice(0, pendingWordsRef.current.length)
    queueTranslationWords(words, new Date().toTimeString().slice(0, 5), detectedTeacherLanguage)
  }

  async function startAudioCapture(micStream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    let audioCtx
    try {
      audioCtx = new AudioContextCtor({ sampleRate: LIVE_AUDIO_SAMPLE_RATE })
    } catch (_) {
      audioCtx = new AudioContextCtor()
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }

    const source = audioCtx.createMediaStreamSource(micStream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    const silentGain = audioCtx.createGain()
    silentGain.gain.value = 0
    pcmChunksRef.current = []
    sampleRateRef.current = audioCtx.sampleRate

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      pcmChunksRef.current.push(new Float32Array(input))
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(audioCtx.destination)
    audioCaptureRef.current = { audioCtx, source, processor, silentGain }
  }

  async function stopAudioCapture() {
    const capture = audioCaptureRef.current
    audioCaptureRef.current = null
    if (!capture) return
    try { capture.processor.onaudioprocess = null } catch (_) {}
    try { capture.source.disconnect() } catch (_) {}
    try { capture.processor.disconnect() } catch (_) {}
    try { capture.silentGain.disconnect() } catch (_) {}
    try { await capture.audioCtx.close() } catch (_) {}
    pcmChunksRef.current = []
  }

  function drainPcmToWavBlob() {
    const pcmChunks = pcmChunksRef.current
    pcmChunksRef.current = []
    const totalSamples = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalSamples === 0) return null

    const sourceSamples = new Float32Array(totalSamples)
    let offset = 0
    for (const chunk of pcmChunks) {
      sourceSamples.set(chunk, offset)
      offset += chunk.length
    }

    const audioSamples = resampleFloat32Samples(
      sourceSamples,
      sampleRateRef.current,
      LIVE_AUDIO_SAMPLE_RATE,
    )
    let energy = 0
    let voicedSamples = 0
    for (let i = 0; i < audioSamples.length; i++) {
      const abs = Math.abs(audioSamples[i])
      energy += abs * abs
      if (abs > 0.012) voicedSamples += 1
    }
    const rms = Math.sqrt(energy / Math.max(1, audioSamples.length))
    const voicedRatio = voicedSamples / Math.max(1, audioSamples.length)
    if (rms < 0.006 || voicedRatio < 0.015) {
      return null
    }
    const samples = new Int16Array(audioSamples.length)
    for (let i = 0; i < audioSamples.length; i++) {
      const value = Math.max(-1, Math.min(1, audioSamples[i]))
      samples[i] = value < 0 ? value * 32768 : value * 32767
    }

    return new Blob([buildWavBuffer(samples, LIVE_AUDIO_SAMPLE_RATE)], { type: 'audio/wav' })
  }

  // ── Poll for active teacher-led sessions ──────────────────────
  useEffect(() => {
    if (joinedSession) return
    let active = true
    async function poll() {
      try {
        const res = await fetch('/api/live-class/active')
        if (res.ok && active) {
          const data = await res.json()
          setActiveSessions(Array.isArray(data) ? data : [])
        }
      } catch (_) {}
    }
    poll()
    const id = setInterval(poll, 10000)
    return () => { active = false; clearInterval(id) }
  }, [joinedSession])

  async function joinLiveSession(sessionId) {
    setJoiningId(sessionId)
    try {
      await fetch(`/api/live-class/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, target_language: joinLang }),
      })
      const session = activeSessions.find(s => s.id === sessionId)
      setJoinedSession({ session_id: sessionId, ...(session || {}), status: session?.status || 'active' })
      setLiveChunks([])
      setLiveStatus(session?.status || 'active')
      setLiveNotes('')
      startLiveStream(sessionId, joinLang)
    } catch (err) {
      setMicError('Could not join the live class. Please continue in a moment.')
    }
    setJoiningId(null)
  }

  function startLiveStream(sid, lang) {
    liveSSEAbortRef.current?.abort()
    const ctrl = new AbortController()
    liveSSEAbortRef.current = ctrl
    ;(async () => {
      try {
        const url = `/api/live-class/${sid}/stream?student_id=${encodeURIComponent(studentId)}&target_language=${encodeURIComponent(lang)}`
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok) {
          setLiveError('Could not connect to the live class stream. Please try rejoining.')
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let sessionEnded = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.type === 'translated_chunk') {
                setLiveChunks(prev => {
                  const exists = prev.find(c => c.chunk_index === ev.chunk_index)
                  if (exists) return prev
                  return [...prev, { chunk_index: ev.chunk_index, text: cleanOutput(ev.text), timestamp: ev.timestamp }]
                    .sort((a, b) => a.chunk_index - b.chunk_index)
                })
              }
              if (ev.type === 'session_status') {
                setLiveStatus(ev.status)
                setJoinedSession(prev => prev ? { ...prev, status: ev.status } : prev)
                if (ev.status === 'ended' && !sessionEnded) {
                  sessionEnded = true
                  // Fetch original source chunks for the post-session view
                  fetch(`/api/live-class/${sid}/source-chunks`)
                    .then(r => r.ok ? r.json() : [])
                    .then(data => { if (Array.isArray(data)) setLiveSourceChunks(data) })
                    .catch(() => {})
                  // Stream notes word-by-word
                  streamLiveClassNotes(sid, lang)
                }
              } else if (ev.type === 'notes_ready' && ev.notes_text) {
                setLiveNotes(cleanOutput(ev.notes_text))
                setLiveNotesStreaming(false)
              }
            } catch (_) {}
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') setLiveError('Connection to live class was lost.')
      }
    })()
  }

  async function changeLiveLanguage(lang) {
    if (!joinedSession) return
    setJoinLang(lang)
    setLiveChunks([])
    try {
      await fetch(`/api/live-class/${joinedSession.session_id}/language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, target_language: lang }),
      })
    } catch (_) {}
    startLiveStream(joinedSession.session_id, lang)
  }

  async function leaveLiveSession() {
    if (!joinedSession) return
    liveSSEAbortRef.current?.abort()
    try {
      await fetch(`/api/live-class/${joinedSession.session_id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId }),
      })
    } catch (_) {}
    setJoinedSession(null)
    setLiveChunks([])
    setLiveStatus(null)
    setLiveNotes('')
    setLiveSourceChunks([])
    setLiveError(null)
    setLiveNotesStreaming(false)
    loadPastLiveSessions()
  }

  async function loadPastLiveSessions() {
    setLoadingPastLive(true)
    try {
      const r = await fetch(`/api/live-class/student/${studentId}/sessions`)
      if (r.ok) {
        const data = await r.json()
        setPastLiveSessions(Array.isArray(data) ? data : [])
      }
    } catch (_) {}
    setLoadingPastLive(false)
  }

  async function loadPastLiveSession(sessionId, targetLang) {
    setLiveError(null)
    setLiveNotes('')
    setLiveChunks([])
    setLiveSourceChunks([])
    setLiveNotesStreaming(false)
    setJoinedSession({ session_id: sessionId, status: 'ended', _isPast: true })
    setLiveStatus('ended')

    // Load translated chunks
    try {
      const r = await fetch(`/api/live-class/${sessionId}/translations?target_language=${encodeURIComponent(targetLang)}`)
      if (r.ok) {
        const data = await r.json()
        if (Array.isArray(data)) {
          setLiveChunks(data.map(c => ({ chunk_index: c.chunk_index, text: cleanOutput(c.translated_text), timestamp: c.created_at })))
        }
      }
    } catch (_) {}

    // Load source chunks
    try {
      const r2 = await fetch(`/api/live-class/${sessionId}/source-chunks`)
      if (r2.ok) {
        const data2 = await r2.json()
        if (Array.isArray(data2)) setLiveSourceChunks(data2)
      }
    } catch (_) {}

    // Stream notes
    setLiveNotesStreaming(true)
    try {
      const r3 = await fetch(`/api/live-class/${sessionId}/notes-stream?target_language=${encodeURIComponent(targetLang)}`)
      if (!r3.ok) { setLiveNotesStreaming(false); return }
      const reader = r3.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') setLiveNotes(prev => prev + ev.content)
            else if (ev.type === 'done') { setLiveNotes(prev => cleanOutput(prev)); setLiveNotesStreaming(false) }
            else if (ev.type === 'error') { setLiveError(ev.message); setLiveNotesStreaming(false) }
          } catch (_) {}
        }
      }
    } catch (_) {
      setLiveNotesStreaming(false)
    }
  }

  async function streamLiveClassNotes(sessionId, targetLang) {
    setLiveNotesStreaming(true)
    try {
      const r = await fetch(`/api/live-class/${sessionId}/notes-stream?target_language=${encodeURIComponent(targetLang)}`)
      if (!r.ok) { setLiveNotesStreaming(false); return }
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') setLiveNotes(prev => prev + ev.content)
            else if (ev.type === 'done') { setLiveNotes(prev => cleanOutput(prev)); setLiveNotesStreaming(false) }
            else if (ev.type === 'error') { setLiveError(ev.message); setLiveNotesStreaming(false) }
          } catch (_) {}
        }
      }
    } catch (_) {
      setLiveNotesStreaming(false)
    }
  }

  async function downloadLivePdf(exportType) {
    if (exportType === 'notes') setIsDownloadingLiveNotes(true)
    else setIsDownloadingLiveTranscript(true)
    try {
      const r = await fetch('/api/live-class/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: joinedSession.session_id,
          student_id: studentId,
          export_type: exportType,
          target_language: joinLang,
        }),
      })
      if (!r.ok) {
        let msg = 'The PDF could not be downloaded. Please continue in a moment.'
        try { const b = await r.json(); msg = b.detail || b.message || msg } catch (_) {}
        setLivePdfToast({ ok: false, msg })
        setTimeout(() => setLivePdfToast(null), 5000)
        return
      }
      const blob = await r.blob()
      const disp = r.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="?([^";]+)"?/)
      const filename = match?.[1]?.trim() || `optilearn_live_${exportType}.pdf`
      const result = await saveBlobAsPdf(blob, filename)
      setLivePdfToast({ ok: true, msg: result?.path ? 'Saved to Downloads' : 'PDF saved' })
      setTimeout(() => setLivePdfToast(null), 3500)
    } catch (_) {
      setLivePdfToast({ ok: false, msg: 'Download could not be completed. Please continue in a moment.' })
      setTimeout(() => setLivePdfToast(null), 5000)
    } finally {
      if (exportType === 'notes') setIsDownloadingLiveNotes(false)
      else setIsDownloadingLiveTranscript(false)
    }
  }

  // Load languages
  useEffect(() => {
    fetch('/api/feature1/languages').then(r => r.json()).then(setLanguages).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/translate/warmup', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    if (student?.language) setTargetLanguage(student.language)
  }, [student])

  // Load past session if ?session= param present
  useEffect(() => {
    if (selectedSessionId) loadPastSession(selectedSessionId)
    else loadPastSessions()
    loadPastLiveSessions()
  }, [studentId, selectedSessionId])

  async function loadPastSessions() {
    setLoadingPast(true)
    try {
      const r = await fetch(`/api/translate/sessions/${studentId}`)
      const data = await r.json()
      setPastSessions(Array.isArray(data) ? data : [])
    } catch (_) {}
    setLoadingPast(false)
  }

  async function loadPastSession(sid) {
    try {
      setMicError(null)
      setNotesText('')
      setTranscriptText('')
      const r = await fetch(`/api/translate/${sid}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setSessionId(sid)
      sessionIdRef.current = sid
      setNotesText(cleanOutput(data.notes_text))
      setTargetLanguage(data.notes_language || 'en')
      const ch = Array.isArray(data.translated_chunks) ? data.translated_chunks : []
      replaceChunks(ch.map(cleanChunkOutput))
      const original = data.raw_transcript || ch.map(c => c.original).filter(Boolean).join('\n\n')
      const translated = cleanOutput(ch.map(c => c.translated).filter(Boolean).join('\n\n'))
      setOriginalTranscriptText(original)
      setTranslatedTranscriptText(translated)
      setTranscriptText(translated || original)
      setPhase('notes')
    } catch (_) {
      setMicError('That saved class could not be opened. Please refresh, then continue.')
    }
  }

  function openPastSession(sid) {
    navigate(`/student/${studentId}/live-translator?session=${sid}`)
    loadPastSession(sid)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function fetchTranslatorStatus() {
    const response = await fetch('/api/translate/status')
    if (!response.ok) return null
    return response.json()
  }

  async function ensureTranslatorReady() {
    setMicError(null)
    let status = await fetchTranslatorStatus().catch(() => null)
    if (status?.ready) return true

    setTranslatorPreparing(true)
    setTranslatorStatusText('Preparing live translation')
    await fetch('/api/translate/warmup', { method: 'POST' }).catch(() => {})

    const startedAt = Date.now()
    while (Date.now() - startedAt < 180000) {
      status = await fetchTranslatorStatus().catch(() => null)
      if (status?.ready) {
        setTranslatorPreparing(false)
        return true
      }
      if (status?.error && !status.loading) {
        setTranslatorPreparing(false)
        setMicError('Speech recognition could not load. Check the server logs for details, then restart.')
        return false
      } else if (status?.error) {
        setTranslatorStatusText('Still preparing speech recognition…')
      } else if (status?.loading) {
        setTranslatorStatusText(`Loading ${status.model || 'speech model'}…`)
      }
      await sleep(1000)
    }

    setTranslatorPreparing(false)
    setMicError('Live translation is still preparing. Please continue in a moment.')
    return false
  }

  // ── Recording ────────────────────────────────────────────────
  async function startRecording() {
    setMicError(null)

    // getUserMedia requires a secure context (HTTPS or localhost).
    // Students connecting over plain http://IP:8000 must use the HTTPS port instead.
    if (!window.isSecureContext) {
      setMicError(
        'This feature needs OptiLearn installed to work. If you are in a lesson, remind your teacher to start a live class session and you will be able to join.'
      )
      return
    }

    if (!(await ensureTranslatorReady())) {
      return
    }
    let micStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      await startAudioCapture(micStream)
    } catch (err) {
      if (micStream) micStream.getTracks().forEach(t => t.stop())
      const msg = err?.name === 'NotFoundError'
        ? 'No microphone was found on this device. Please connect a microphone, then continue.'
        : 'Microphone access was blocked. Please allow microphone access in your browser settings, then continue.'
      setMicError(msg)
      return
    }

    // Create session
    const r = await fetch('/api/translate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, target_language: targetLanguage }),
    })
    const { session_id } = await r.json()
    setSessionId(session_id)
    sessionIdRef.current = session_id
    chunkIndexRef.current = 0
    chunkCountRef.current = 0
    chunkQueueRef.current = []
    processingQueueRef.current = false
    queueWaitersRef.current = []
    rawTranscriptPartsRef.current = []
    pendingWordsRef.current = []
    translationQueueRef.current = []
    processingTranslationRef.current = false
    translationWaitersRef.current = []
    translationIndexRef.current = 0
    stopTranslationDoneRef.current = 0
    stopTranslationTotalRef.current = 0
    finalizingRef.current = false
    setIsProcessingChunk(false)
    setIsProcessingTranslation(false)
    setTranslationProgress(0)
    setTranslationStatusText('')
    setOriginalTranscriptText('')
    setTranslatedTranscriptText('')
    setTranscriptText('')
    setNotesText('')
    setIsFinalizing(false)
    replaceChunks([])
    setDetectedTeacherLanguage('en')

    streamRef.current = micStream
    const recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      const wavBlob = drainPcmToWavBlob()
      if (wavBlob && wavBlob.size > 44) {
        const idx = chunkIndexRef.current++
        enqueueChunk({
          wavBlob,
          idx,
          sessionId: session_id,
          targetLanguage,
          lessonLanguage,
        })
      } else if (e.data && e.data.size > 0) {
        console.warn('[Chunk] recorder tick had no PCM samples to send')
      }
    }
    recorder.start(5000)
    setPhase('recording')
  }

  async function sendChunk(wavBlob, idx, sid, lang, hintLang) {
    try {
      const fd = new FormData()
      fd.append('audio', wavBlob, `chunk-${idx}.wav`)
      fd.append('session_id', sid)
      fd.append('target_language', lang)
      fd.append('chunk_index', String(idx))
      if (hintLang) fd.append('hint_language', hintLang)

      const response = await fetch('/api/translate/chunk', { method: 'POST', body: fd })
      if (!response.ok) {
        console.error('[Chunk] POST issue', idx, response.status)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let chunkCommitter = null
      let doneReceived = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'skip') break
            if (event.type === 'original') {
              const timestamp = new Date().toTimeString().slice(0, 5)
              if (idx === 0 && event.detected_language) {
                setDetectedTeacherLanguage(event.detected_language)
              }
              rawTranscriptPartsRef.current.push(event.content)
              setChunkAt(idx, {
                index: idx,
                original: event.content,
                translated: '',
                timestamp,
                detected_language: event.detected_language,
              })
              chunkCommitter = createChunkCommitter(idx)
              setIsProcessingTranslation(true)
            } else if (event.type === 'translated_token') {
              if (!chunkCommitter) chunkCommitter = createChunkCommitter(idx)
              chunkCommitter.append(event.content || '')
            } else if (event.type === 'translated_chunk') {
              const translatedChunk = event.chunk || {}
              if (!chunkCommitter) chunkCommitter = createChunkCommitter(idx)
              chunkCommitter.flush(translatedChunk.translated || chunkCommitter.value())
              setChunkAt(translatedChunk.index ?? idx, translatedChunk)
              scrollPanelsToChunk(translatedChunk.index ?? idx)
            } else if (event.type === 'model_switch') {
              window.dispatchEvent(new CustomEvent('optilearn:model-switch', { detail: event }))
            } else if (event.type === 'done') {
              doneReceived = true
              chunkCountRef.current++
              setIsProcessingTranslation(false)
              // Scroll panels to bottom
              scrollPanelsToChunk(idx)
            }
          } catch (_) {}
        }
      }
      if (!doneReceived && chunkCommitter) {
        chunkCommitter.flush()
      }
    } catch (err) {
      console.error('[Chunk] processing issue', idx, err)
    } finally {
      setIsProcessingTranslation(false)
    }
  }

  async function sendTextChunk(chunk) {
    try {
      const response = await fetch('/api/translate/text-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chunk.session_id || sessionIdRef.current || sessionId,
          student_id: studentId,
          target_language: targetLanguage,
          index: chunk.index,
          original: chunk.original,
          timestamp: chunk.timestamp,
          detected_language: chunk.detected_language || detectedTeacherLanguage || 'en',
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const translatedChunk = await response.json()
      if (translatedChunk.model_switched) {
        window.dispatchEvent(new CustomEvent('optilearn:model-switch', {
          detail: {
            type: 'model_switch',
            message: 'Connection interrupted. Switching to local model.',
            color: '#EF9F27',
          },
        }))
      }
      setChunkAt(translatedChunk.index, cleanChunkOutput(translatedChunk))
      scrollPanelsToChunk(translatedChunk.index)
    } catch (err) {
      console.error('[Translation] text chunk issue', chunk.index, err)
      setChunkAt(chunk.index, { ...chunk, translated: chunk.original })
    }
  }

  function scrollPanelsToChunk(idx) {
    requestAnimationFrame(() => {
      const leftEl = leftPanelRef.current?.querySelector(`[data-chunk="${idx}"]`)
      const rightEl = rightPanelRef.current?.querySelector(`[data-chunk="${idx}"]`)
      leftEl?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      rightEl?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }

  async function stopListeningAndTranslate() {
    if (finalizingRef.current || !sessionId) return
    finalizingRef.current = true
    setIsFinalizing(true)
    setTranslationProgress(0)
    setTranslationStatusText('Stopping microphone and finishing transcription')

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      await new Promise(resolve => {
        recorder.addEventListener('stop', resolve, { once: true })
        recorder.stop()
      })
    }
    recorderRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    await stopAudioCapture()
    await waitForQueuedChunks()

    flushPendingTranscriptWords()

    const remainingTranslations = translationQueueRef.current.length + (processingTranslationRef.current ? 1 : 0)
    stopTranslationDoneRef.current = 0
    stopTranslationTotalRef.current = remainingTranslations
    if (remainingTranslations > 0) {
      setTranslationStatusText(`Translating 0 of ${remainingTranslations} remaining sections`)
      setTranslationProgress(0)
      await waitForTranslationQueue()
    }

    setTranslationProgress(100)
    setTranslationStatusText('Preparing study notes')

    const finalChunks = chunksRef.current.filter(c => c?.original).map(cleanChunkOutput)
    const rawTranscript = rawTranscriptPartsRef.current.join('\n\n')
    const translatedTranscript = cleanOutput(finalChunks.map(c => c.translated || c.original).filter(Boolean).join('\n\n'))
    setOriginalTranscriptText(rawTranscript)
    setTranslatedTranscriptText(translatedTranscript)
    setTranscriptText(translatedTranscript || rawTranscript)

    try {
      const response = await fetch('/api/translate/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          target_language: targetLanguage,
          student_id: studentId,
          raw_transcript: rawTranscript,
          translated_chunks: finalChunks,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } catch (_) {
      setMicError('Study notes could not start. Please try ending the class again.')
      setIsFinalizing(false)
      finalizingRef.current = false
      return
    }

    setPhase('notes')
    streamNotes(sessionId)
  }

  async function streamNotes(sid) {
    try {
      const response = await fetch(`/api/translate/${sid}/notes`)
      if (!response.ok) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'token') {
              setNotesText(prev => prev + event.content)
            } else if (event.type === 'done') {
              setNotesText(prev => cleanOutput(prev))
              setIsFinalizing(false)
              finalizingRef.current = false
            } else if (event.type === 'error') {
              setMicError(event.message || 'Notes could not be generated.')
              setIsFinalizing(false)
              finalizingRef.current = false
            }
          } catch (_) {}
        }
      }
    } catch (_) {
      setIsFinalizing(false)
      finalizingRef.current = false
    }
  }

  // ── PDF download ─────────────────────────────────────────────
  async function downloadPdf(exportType) {
    if (exportType === 'notes') setIsDownloadingNotes(true)
    else setIsDownloadingTranscript(true)
    try {
      const r = await fetch('/api/translate/export-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, export_type: exportType }),
      })
      if (!r.ok) {
        let message = 'The PDF could not be downloaded. Please continue in a moment.'
        try {
          const body = await r.json()
          message = body.detail || body.message || message
        } catch (_) {}
        setPdfToast({ ok: false, msg: message })
        setTimeout(() => setPdfToast(null), 5000)
        return
      }
      const blob = await r.blob()
      const disp = r.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="?([^";]+)"?/)
      const filename = match?.[1]?.trim() || `optilearn_${exportType}.pdf`
      const result = await saveBlobAsPdf(blob, filename)
      setPdfToast({ ok: true, msg: result?.path ? 'Saved to Downloads' : 'PDF saved' })
      setTimeout(() => setPdfToast(null), 4000)
    } catch (_) {
      setPdfToast({ ok: false, msg: 'The PDF could not be downloaded. Please continue in a moment.' })
      setTimeout(() => setPdfToast(null), 5000)
    } finally {
      if (exportType === 'notes') setIsDownloadingNotes(false)
      else setIsDownloadingTranscript(false)
    }
  }

  const langName = (code) => languages.find(l => l.code === code)?.name || code
  const featureShellStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: isCompact ? 'auto' : '100%',
    minHeight: 0,
    overflow: isCompact ? 'visible' : 'hidden',
    gap: 0,
  }
  const splitPanelsStyle = {
    flex: '1 1 auto',
    display: 'grid',
    gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    alignItems: 'stretch',
    gap: 10,
    padding: '10px 10px 0',
    minHeight: isCompact ? 'min(68dvh, 620px)' : 0,
    overflow: isCompact ? 'visible' : 'hidden',
  }
  const panelStyle = {
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    maxHeight: '100%',
    alignSelf: 'stretch',
    boxSizing: 'border-box',
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  const panelScrollStyle = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 14,
  }
  const compactTabsStyle = {
    position: 'sticky',
    top: 0,
    zIndex: 3,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    padding: '10px 10px 0',
    background: C.surfaceAlt,
  }
  const compactTabButtonStyle = (active) => ({
    minHeight: 42,
    borderRadius: 12,
    border: `1px solid ${active ? C.primary : C.border}`,
    background: active ? C.primary : C.surface,
    color: active ? '#fff' : C.textPrimary,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  })

  // ── JOINED TEACHER SESSION VIEW ───────────────────────────────
  if (joinedSession) {
    const LANG_NAMES = { en:'English',si:'Sinhala',ta:'Tamil',ar:'Arabic',fr:'French',sw:'Swahili',so:'Somali',am:'Amharic',hi:'Hindi',ur:'Urdu',fa:'Dari/Farsi',my:'Burmese',bn:'Bengali',tr:'Turkish',ps:'Pashto' }
    const ALL_LANGS = Object.entries(LANG_NAMES).map(([code, name]) => ({ code, name }))
    const statusColor = joinedSession.status === 'active' ? '#16a34a' : joinedSession.status === 'paused' ? '#f59e0b' : '#6b7280'
    const statusLabel = joinedSession.status === 'active' ? 'Live' : joinedSession.status === 'paused' ? 'Paused' : 'Ended'
    const isEnded = liveStatus === 'ended' || joinedSession.status === 'ended'

    // ── POST-SESSION: two-panel notes + transcript (mirrors personal mode notes phase) ──
    if (isEnded) {
      const liveNotesParagraphs = liveNotes ? liveNotes.split('\n\n').filter(p => p.trim()) : []
      const liveTranscriptText = liveChunks.map(c => c.text).filter(Boolean).join('\n\n')

      return (
        <div style={featureShellStyle}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          {isCompact && (
            <div style={compactTabsStyle}>
              <button type="button" onClick={() => setLiveNotesTab('notes')} style={compactTabButtonStyle(liveNotesTab === 'notes')}>Notes</button>
              <button type="button" onClick={() => setLiveNotesTab('transcript')} style={compactTabButtonStyle(liveNotesTab === 'transcript')}>Transcript</button>
            </div>
          )}

          <div style={splitPanelsStyle}>
            {/* LEFT — Study Notes */}
            {(!isCompact || liveNotesTab === 'notes') && (
              <div style={panelStyle}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Sparkles size={16} color={C.primary} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, flex: 1 }}>Study Notes</span>
                  <button
                    onClick={() => downloadLivePdf('notes')}
                    disabled={!liveNotes || isDownloadingLiveNotes}
                    title="Download notes as PDF"
                    style={{ background: 'transparent', border: 'none', cursor: liveNotes ? 'pointer' : 'default', color: C.textSecondary, padding: 4, display: 'flex', alignItems: 'center', opacity: liveNotes ? 1 : 0.4 }}
                  >
                    {isDownloadingLiveNotes ? <Spinner size={16} color={C.primary} /> : <Download size={16} />}
                  </button>
                </div>
                <div style={panelScrollStyle}>
                  {!liveNotes && <TypingDots />}
                  {liveNotesParagraphs.map((para, i) => (
                    <div key={i} style={{ marginBottom: 16, position: 'relative', paddingRight: 28 }}>
                      {renderMarkdown(para)}
                      <button
                        onClick={() => tts.speak(para, joinLang, `lc-note-para-${i}`)}
                        style={{ position: 'absolute', top: 0, right: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: tts.playingId === `lc-note-para-${i}` ? C.primary : C.textSecondary, padding: 2 }}
                        title="Read aloud"
                      >
                        {tts.playingId === `lc-note-para-${i}` ? <StopCircle size={14} /> : <Volume2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RIGHT — Translated Transcript */}
            {(!isCompact || liveNotesTab === 'transcript') && (
              <div style={{ ...panelStyle, background: C.surfaceAlt }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <FileText size={16} color={C.textSecondary} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, flex: 1 }}>Translated Transcript</span>
                  <button
                    onClick={() => tts.speak(liveTranscriptText, joinLang, 'lc-transcript-full')}
                    disabled={!liveTranscriptText}
                    style={{ background: 'transparent', border: 'none', cursor: liveTranscriptText ? 'pointer' : 'default', color: tts.playingId === 'lc-transcript-full' ? C.primary : C.textSecondary, padding: 4, display: 'flex', alignItems: 'center', opacity: liveTranscriptText ? 1 : 0.4 }}
                    title="Read aloud"
                  >
                    {tts.playingId === 'lc-transcript-full' ? <StopCircle size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button
                    onClick={() => downloadLivePdf('transcript')}
                    disabled={!liveTranscriptText || isDownloadingLiveTranscript}
                    title="Download transcript as PDF"
                    style={{ background: 'transparent', border: 'none', cursor: liveTranscriptText ? 'pointer' : 'default', color: C.textSecondary, padding: 4, display: 'flex', alignItems: 'center', opacity: liveTranscriptText ? 1 : 0.4 }}
                  >
                    {isDownloadingLiveTranscript ? <Spinner size={16} color={C.primary} /> : <Download size={16} />}
                  </button>
                </div>
                <div style={panelScrollStyle}>
                  {liveChunks.length === 0 ? (
                    <div style={{ color: C.textSecondary, fontSize: 13 }}>No translated transcript available.</div>
                  ) : (
                    liveChunks.map((c, i) => (
                      <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                        {c.timestamp && <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 4 }}>{typeof c.timestamp === 'string' ? c.timestamp.slice(11, 16) : c.timestamp}</div>}
                        <FormattedText text={c.text} compact fontSize={14} headingSize={15} color={C.textSecondary} />
                      </div>
                    ))
                  )}
                  {/* Original language panel (after class ends) */}
                  {liveSourceChunks.length > 0 && (
                    <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.textSecondary, marginBottom: 8 }}>
                        Original ({joinedSession.source_language || 'teacher'})
                      </div>
                      {liveSourceChunks.map((c, i) => (
                        <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: C.textSecondary, marginBottom: 6, paddingBottom: 6, borderBottom: i < liveSourceChunks.length - 1 ? `1px solid ${C.border}` : 'none', opacity: 0.75 }}>
                          {c.source_text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom bar */}
          <div style={{ minHeight: 56, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: isCompact ? '10px' : '0 20px', gap: isCompact ? 10 : 16, flexShrink: 0, flexWrap: 'wrap' }}>
            <CheckCircle2 size={18} color={C.green} />
            <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>Session saved</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={leaveLiveSession}
              style={{ fontSize: 13, color: C.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, minHeight: 38, width: isCompact ? '100%' : 'auto', textAlign: isCompact ? 'center' : 'left' }}
            >
              ← Back to classes
            </button>
          </div>

          {livePdfToast && (
            <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: livePdfToast.ok ? '#1e7e34' : '#c62828', color: '#fff', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', whiteSpace: 'normal', maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>
              {livePdfToast.msg}
            </div>
          )}
        </div>
      )
    }

    // ── ACTIVE / PAUSED: live translation view ───────────────────
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {/* Session header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: '1rem', color: C.textPrimary }}>{joinedSession.title || 'Live Class'}</span>
            <span style={{ fontSize: '0.78rem', color: statusColor, background: `${statusColor}20`, borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>{statusLabel}</span>
          </div>
          {joinedSession.teacher_display_name && (
            <span style={{ fontSize: '0.82rem', color: C.textSecondary }}>{joinedSession.teacher_display_name}</span>
          )}
          <button onClick={leaveLiveSession} style={{ minHeight: 36, padding: '6px 14px', border: '1px solid var(--border,#ddd)', borderRadius: 8, background: 'transparent', color: C.textSecondary, fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
            Leave
          </button>
        </div>

        {/* Error banner */}
        {liveError && (
          <div style={{ background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 10, padding: '10px 16px', color: C.danger, fontSize: 13, marginBottom: 16 }}>
            {liveError}
          </div>
        )}

        {/* Language selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: C.textSecondary, fontWeight: 600 }}>Translate to:</span>
          <select value={joinLang} onChange={e => changeLiveLanguage(e.target.value)}
            style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', background: C.surface, color: C.textPrimary, fontSize: '0.9rem', minHeight: 36 }}>
            {ALL_LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>

        {/* Live transcript with timestamps */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, minHeight: 200, maxHeight: 420, overflowY: 'auto', marginBottom: 16 }}>
          {liveChunks.length === 0 ? (
            <div style={{ color: C.textSecondary, fontSize: '0.9rem', textAlign: 'center', paddingTop: 48 }}>
              {joinedSession.status === 'paused' ? 'Class is paused…' : 'Waiting for the teacher to speak…'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {liveChunks.map(c => (
                <div key={c.chunk_index} style={{ paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                  {c.timestamp && (
                    <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 3 }}>
                      {typeof c.timestamp === 'string' ? c.timestamp.slice(11, 16) : c.timestamp}
                    </div>
                  )}
                  <FormattedText text={c.text} compact fontSize={15} headingSize={16} color={C.textPrimary} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── IDLE PHASE ────────────────────────────────────────────────
  if (phase === 'idle' && translatorPreparing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 72px)', padding: 24 }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ display: 'inline-flex', marginBottom: 18 }}>
            <Spinner size={54} color={C.primary} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
            Preparing live translation
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: C.textSecondary }}>
            {translatorStatusText}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'idle') {
    const LANG_NAMES_SIMPLE = { en:'English',si:'Sinhala',ta:'Tamil',ar:'Arabic',fr:'French',sw:'Swahili',so:'Somali',am:'Amharic',hi:'Hindi',ur:'Urdu',fa:'Dari/Farsi',my:'Burmese',bn:'Bengali',tr:'Turkish',ps:'Pashto' }
    const ALL_LANGS_SIMPLE = Object.entries(LANG_NAMES_SIMPLE).map(([code, name]) => ({ code, name }))
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 16px' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>

        {/* Active teacher sessions banner */}
        {activeSessions.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            {activeSessions.map(session => (
              <div key={session.id} style={{ background: 'linear-gradient(135deg,rgba(42,141,191,0.12) 0%,rgba(42,141,191,0.05) 100%)', border: `1.5px solid ${C.primary}`, borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: '0.97rem', color: C.textPrimary }}>{session.title}</span>
                      <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>LIVE</span>
                    </div>
                    {session.teacher_display_name && (
                      <div style={{ fontSize: '0.83rem', color: C.textSecondary, marginBottom: 6 }}>Teacher: {session.teacher_display_name}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: C.textSecondary }}>Translate to:</span>
                      <select value={joinLang} onChange={e => setJoinLang(e.target.value)}
                        style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', background: C.surface, color: C.textPrimary, fontSize: '0.85rem' }}>
                        {ALL_LANGS_SIMPLE.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={() => joinLiveSession(session.id)}
                    disabled={joiningId === session.id}
                    style={{ minHeight: 40, padding: '8px 18px', border: 'none', borderRadius: 10, background: C.primary, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', flexShrink: 0, opacity: joiningId === session.id ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {joiningId === session.id ? <Spinner size={14} color="#fff" /> : null}
                    Join
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            onClick={startRecording}
            style={{
              width: 120, height: 120, borderRadius: '50%', background: C.primaryLight,
              border: `2px solid ${C.border}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 20px', cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.primaryLight; e.currentTarget.style.transform = 'scale(1.05)' }}
            onMouseLeave={e => { e.currentTarget.style.background = C.primaryLight; e.currentTarget.style.transform = 'scale(1)' }}
          >
            <Mic size={80} color={C.primary} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
            Tap to start translating your class
          </div>
          <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 20 }}>
            Your teacher's words will appear in{' '}
            <strong>{langName(targetLanguage)}</strong>
          </div>

          {micError && (
            <div style={{
              background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 10,
              padding: '10px 16px', color: C.danger, fontSize: 13, marginBottom: 16, textAlign: 'left',
            }}>
              {micError}
            </div>
          )}

          {/* Language selectors */}
          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
            <div>
              <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>
                Lesson language (teacher is speaking in):
              </label>
              <LanguageSelect
                languages={languages}
                value={lessonLanguage}
                onChange={e => setLessonLanguage(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer',
                  minWidth: 200, width: '100%',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>
                Translate to:
              </label>
              <LanguageSelect
                languages={languages}
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer',
                  minWidth: 200, width: '100%',
                }}
              />
            </div>
          </div>
        </div>

        {/* Past sessions */}
        {(loadingPast || pastSessions.length > 0) && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 12 }}>
              Past Classes
            </div>
            {loadingPast ? (
              <div style={{ color: C.textSecondary, fontSize: 13 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pastSessions.map(s => (
                  <div
                    key={s.id}
                    style={{
                      background: C.surface, border: `1px solid ${C.border}`,
                      borderRadius: 12, padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
                          {s.created_at ? new Date(s.created_at).toLocaleString() : 'Past class'}
                          {s.notes_language ? ` · ${langName(s.notes_language)}` : ''}
                        </div>
                        {s.notes_preview && (
                          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.notes_preview.slice(0, 100)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => openPastSession(s.id)}
                        style={{
                          padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.primary}`,
                          background: C.primaryLight, color: C.primary, fontSize: 13,
                          fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        View Notes
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Past Live Classes (teacher-led sessions) */}
        {(loadingPastLive || pastLiveSessions.length > 0) && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 12 }}>
              Past Live Classes
            </div>
            {loadingPastLive ? (
              <div style={{ color: C.textSecondary, fontSize: 13 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pastLiveSessions.map((s, i) => (
                  <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary, marginBottom: 2 }}>
                          {s.title || 'Live Class'}
                          {s.subject ? <span style={{ fontWeight: 400, color: C.textSecondary }}> · {s.subject}</span> : null}
                        </div>
                        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
                          {s.joined_at ? new Date(s.joined_at).toLocaleString() : ''}
                          {s.target_language ? ` · ${langName(s.target_language)}` : ''}
                          {s.notes_status === 'ready' ? ' · Notes ready' : s.notes_status === 'pending' ? ' · Notes generating…' : ''}
                        </div>
                        {s.notes_preview && (
                          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.notes_preview.slice(0, 100)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => loadPastLiveSession(s.session_id, s.target_language || 'en')}
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.primary}`, background: C.primaryLight, color: C.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                      >
                        View Notes
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── RECORDING PHASE ───────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div style={featureShellStyle}>
        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        `}</style>

        {isCompact && (
          <div style={compactTabsStyle}>
            <button type="button" onClick={() => setRecordingTab('translation')} style={compactTabButtonStyle(recordingTab === 'translation')}>
              Translation
            </button>
            <button type="button" onClick={() => setRecordingTab('original')} style={compactTabButtonStyle(recordingTab === 'original')}>
              Original
            </button>
          </div>
        )}

        {/* Two-panel split */}
        <div style={splitPanelsStyle}>

          {/* LEFT — translated */}
          {(!isCompact || recordingTab === 'translation') && <div style={panelStyle}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              <Languages size={16} color={C.primary} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Translation</span>
              <span style={{ fontSize: 12, color: C.textSecondary }}>— {langName(targetLanguage)}</span>
            </div>
            <div ref={leftPanelRef} style={panelScrollStyle}>
              {chunks.filter(c => c).map((chunk, i) => (
                <div
                  key={i}
                  data-chunk={i}
                  style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}
                >
                  <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 4 }}>
                    {chunk.timestamp}
                  </div>
                  <div style={{ fontSize: 15, lineHeight: 1.7, color: C.textPrimary }}>
                    {chunk.translated ? (
                      <FormattedText text={chunk.translated} compact fontSize={15} headingSize={16} color={C.textPrimary} />
                    ) : (
                      <span style={{ color: C.textSecondary }}>
                        Translating this section...
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {(isProcessingChunk || isProcessingTranslation) && !isFinalizing && <TypingDots />}
            </div>
          </div>}

          {/* RIGHT — original */}
          {(!isCompact || recordingTab === 'original') && <div style={{ ...panelStyle, background: C.surfaceAlt }}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              <Mic size={16} color={C.textSecondary} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Original</span>
              <span style={{ fontSize: 12, color: C.textSecondary }}>— {langName(lessonLanguage)}</span>
            </div>
            <div ref={rightPanelRef} style={panelScrollStyle}>
              {chunks.filter(c => c).map((chunk, i) => (
                <div
                  key={i}
                  data-chunk={i}
                  style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}
                >
                  <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 4 }}>
                    {chunk.timestamp}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: C.textSecondary }}>
                    {chunk.original}
                  </div>
                </div>
              ))}
            </div>
          </div>}
        </div>

        {isFinalizing && (
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 8, margin: '8px 10px 0',
            padding: '10px 14px 12px', flexShrink: 0, minHeight: 62,
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 7, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, minWidth: 0, lineHeight: 1.35 }}>
                {translationStatusText || 'Translating class transcript'}
              </span>
              <span style={{ fontSize: 13, color: C.textSecondary, fontWeight: 600, flexShrink: 0 }}>
                {translationProgress}%
              </span>
            </div>
            <div style={{
              height: 8, borderRadius: 999, background: C.primaryLight,
              overflow: 'hidden', border: `1px solid ${C.border}`,
            }}>
              <div style={{
                height: '100%', width: `${Math.max(0, Math.min(100, translationProgress))}%`,
                background: C.primary, transition: 'width .25s ease',
              }} />
            </div>
          </div>
        )}

        {/* Bottom bar */}
        <div style={{
          minHeight: 60, background: C.surface, borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', padding: isCompact ? '10px' : '8px 16px', gap: isCompact ? 10 : 16,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          {/* Recording indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isFinalizing ? (
              <Spinner size={14} color={C.primary} />
            ) : (
              <div style={{
                width: 10, height: 10, borderRadius: '50%', background: C.primary,
                animation: 'pulse 1.2s ease-in-out infinite',
              }} />
            )}
            <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>
              {isFinalizing ? 'Translating' : 'Recording'}
            </span>
          </div>

          {/* Chunk counter */}
          <div style={{ flex: '1 1 240px', minWidth: 180, textAlign: 'center', fontSize: 13, color: C.textSecondary }}>
            {isFinalizing
              ? `${translationProgress}% translated`
              : `${chunks.filter(c => c?.translated).length} of ${chunks.filter(c => c?.original).length} sections translated`}
          </div>

          {/* Finish button */}
          {isFinalizing ? null : (
            <button
              onClick={stopListeningAndTranslate}
              style={{
                height: 44, padding: '0 18px', borderRadius: 12, border: 'none',
                background: C.primary, color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                justifyContent: 'center', width: isCompact ? '100%' : 'auto',
              }}
            >
              <StopCircle size={18} />
              Finish Class
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── ENDING PHASE ──────────────────────────────────────────────
  if (phase === 'ending') {
    return (
      <div style={{ ...featureShellStyle, alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', marginBottom: 16 }}>
            <Spinner size={40} color={C.primary} />
          </div>
          <div style={{ fontSize: 16, color: C.textSecondary }}>Generating your study notes…</div>
        </div>
      </div>
    )
  }

  // ── NOTES PHASE ───────────────────────────────────────────────
  if (phase === 'notes') {
    const notesParagraphs = notesText
      ? notesText.split('\n\n').filter(p => p.trim())
      : []

    return (
      <div style={featureShellStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {isCompact && (
          <div style={compactTabsStyle}>
            <button type="button" onClick={() => setNotesTab('notes')} style={compactTabButtonStyle(notesTab === 'notes')}>
              Notes
            </button>
            <button type="button" onClick={() => setNotesTab('transcript')} style={compactTabButtonStyle(notesTab === 'transcript')}>
              Transcript
            </button>
          </div>
        )}

        {/* Two-panel split */}
        <div style={splitPanelsStyle}>

          {/* LEFT — AI Notes */}
          {(!isCompact || notesTab === 'notes') && <div style={panelStyle}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              <Sparkles size={16} color={C.primary} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, flex: 1 }}>Study Notes</span>
              <button
                onClick={() => downloadPdf('notes')}
                disabled={!notesText || isDownloadingNotes}
                title="Download notes as PDF"
                style={{
                  background: 'transparent', border: 'none', cursor: notesText ? 'pointer' : 'default',
                  color: C.textSecondary, padding: 4, display: 'flex', alignItems: 'center',
                  opacity: notesText ? 1 : 0.4,
                }}
              >
                {isDownloadingNotes
                  ? <Spinner size={16} color={C.primary} />
                  : <Download size={16} />}
              </button>
            </div>

            <div style={panelScrollStyle}>
              {!notesText && <TypingDots />}
              {notesParagraphs.map((para, i) => (
                <div key={i} style={{ marginBottom: 16, position: 'relative', paddingRight: 28 }}>
                  {renderMarkdown(para)}
                  {/* Per-paragraph TTS button */}
                  <button
                    onClick={() => tts.speak(para, targetLanguage, `note-para-${i}`)}
                    style={{
                      position: 'absolute', top: 0, right: 0,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: tts.playingId === `note-para-${i}` ? C.primary : C.textSecondary,
                      padding: 2,
                    }}
                    title="Read aloud"
                  >
                    {tts.playingId === `note-para-${i}`
                      ? <StopCircle size={14} />
                      : <Volume2 size={14} />}
                  </button>
                </div>
              ))}
            </div>
          </div>}

          {/* RIGHT — Transcript */}
          {(!isCompact || notesTab === 'transcript') && <div style={{ ...panelStyle, background: C.surfaceAlt }}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              <FileText size={16} color={C.textSecondary} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, flex: 1 }}>Translated Transcript</span>
              <button
                onClick={() => tts.speak(transcriptText, targetLanguage, 'transcript-full')}
                disabled={!transcriptText}
                style={{
                  background: 'transparent', border: 'none',
                  cursor: transcriptText ? 'pointer' : 'default',
                  color: tts.playingId === 'transcript-full' ? C.primary : C.textSecondary,
                  padding: 4, display: 'flex', alignItems: 'center', opacity: transcriptText ? 1 : 0.4,
                }}
                title="Read aloud"
              >
                {tts.playingId === 'transcript-full' ? <StopCircle size={16} /> : <Volume2 size={16} />}
              </button>
              <button
                onClick={() => downloadPdf('transcript')}
                disabled={!transcriptText || isDownloadingTranscript}
                title="Download transcript as PDF"
                style={{
                  background: 'transparent', border: 'none',
                  cursor: transcriptText ? 'pointer' : 'default',
                  color: C.textSecondary, padding: 4, display: 'flex', alignItems: 'center',
                  opacity: transcriptText ? 1 : 0.4,
                }}
              >
                {isDownloadingTranscript
                  ? <Spinner size={16} color={C.primary} />
                  : <Download size={16} />}
              </button>
            </div>

            <div style={panelScrollStyle}>
              {transcriptText ? (
                <FormattedText text={transcriptText} fontSize={14} headingSize={16} color={C.textSecondary} />
              ) : (
                <div style={{ color: C.textSecondary, fontSize: 13 }}>No translated transcript available.</div>
              )}
            </div>
          </div>}
        </div>

        {/* Bottom bar */}
        <div style={{
          minHeight: 56, background: C.surface, borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', padding: isCompact ? '10px' : '0 20px', gap: isCompact ? 10 : 16,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <CheckCircle2 size={18} color={C.green} />
          <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>Session saved</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              setPhase('idle')
              setNotesText('')
              setTranscriptText('')
              setOriginalTranscriptText('')
              setTranslatedTranscriptText('')
              setTranslationProgress(0)
              setTranslationStatusText('')
              setIsFinalizing(false)
              finalizingRef.current = false
              replaceChunks([])
              loadPastSessions()
              navigate(`/student/${studentId}/live-translator`)
            }}
            style={{
              fontSize: 13, color: C.primary, background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: 600,
              minHeight: 38, width: isCompact ? '100%' : 'auto', textAlign: isCompact ? 'center' : 'left',
            }}
          >
            ← Back to class
          </button>
        </div>
      {pdfToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: pdfToast.ok ? '#1e7e34' : '#c62828',
          color: '#fff', borderRadius: 10, padding: '12px 24px',
          fontSize: 14, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          whiteSpace: 'normal', maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
        }}>
          {pdfToast.msg}
        </div>
      )}
      </div>
    )
  }

  return null
}
