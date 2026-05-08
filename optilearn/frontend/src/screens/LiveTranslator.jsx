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
import Spinner from '../components/Spinner'

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
        body: JSON.stringify({ text: text.slice(0, 3000), language }),
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
  const [micError, setMicError] = useState(null)
  const [translatorPreparing, setTranslatorPreparing] = useState(false)
  const [translatorStatusText, setTranslatorStatusText] = useState('Preparing live translation')
  const [translationProgress, setTranslationProgress] = useState(0)
  const [translationStatusText, setTranslationStatusText] = useState('')
  const [originalTranscriptText, setOriginalTranscriptText] = useState('')
  const [translatedTranscriptText, setTranslatedTranscriptText] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)

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

  function replaceChunks(next) {
    chunksRef.current = next
    setChunks(next)
  }

  function setChunkAt(index, chunk) {
    const next = [...chunksRef.current]
    next[index] = { ...(next[index] || {}), ...chunk }
    chunksRef.current = next
    setChunks(next)
  }

  function createChunkCommitter(index) {
    let scheduled = false
    let translatedText = chunksRef.current[index]?.translated || ''
    const commit = () => {
      scheduled = false
      setChunkAt(index, { translated: translatedText })
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
        setChunkAt(index, { translated: translatedText })
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
      setNotesText(data.notes_text || '')
      setTargetLanguage(data.notes_language || 'en')
      const ch = Array.isArray(data.translated_chunks) ? data.translated_chunks : []
      replaceChunks(ch)
      const original = data.raw_transcript || ch.map(c => c.original).filter(Boolean).join('\n\n')
      const translated = ch.map(c => c.translated).filter(Boolean).join('\n\n')
      setOriginalTranscriptText(original)
      setTranslatedTranscriptText(translated)
      setTranscriptText(translated || original)
      setPhase('notes')
    } catch (_) {
      setMicError('That saved class could not be opened. Please refresh and try again.')
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
        setMicError('Speech recognition is not ready yet. Please restart the server after the model finishes installing.')
        return false
      } else if (status?.error) {
        setTranslatorStatusText('Still preparing speech recognition')
      } else if (status?.loading) {
        setTranslatorStatusText(`Loading ${status.model || 'speech model'}`)
      }
      await sleep(1000)
    }

    setTranslatorPreparing(false)
    setMicError('Live translation is still preparing. Please try again in a moment.')
    return false
  }

  // ── Recording ────────────────────────────────────────────────
  async function startRecording() {
    setMicError(null)
    if (!(await ensureTranslatorReady())) {
      return
    }
    let micStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      await startAudioCapture(micStream)
    } catch (_) {
      if (micStream) micStream.getTracks().forEach(t => t.stop())
      setMicError('Microphone access is needed to translate your class. Please allow microphone access in your browser settings.')
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
        console.error('[Chunk] POST failed', idx, response.status)
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
      console.error('[Chunk] processing failed', idx, err)
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
      setChunkAt(translatedChunk.index, translatedChunk)
      scrollPanelsToChunk(translatedChunk.index)
    } catch (err) {
      console.error('[Translation] text chunk failed', chunk.index, err)
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

    const finalChunks = chunksRef.current.filter(c => c?.original)
    const rawTranscript = rawTranscriptPartsRef.current.join('\n\n')
    const translatedTranscript = finalChunks.map(c => c.translated || c.original).filter(Boolean).join('\n\n')
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
      if (!r.ok) return
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disp = r.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="?([^";]+)"?/)
      a.download = match?.[1]?.trim() || `optilearn_${exportType}.pdf`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (_) {}
    if (exportType === 'notes') setIsDownloadingNotes(false)
    else setIsDownloadingTranscript(false)
  }

  const langName = (code) => languages.find(l => l.code === code)?.name || code
  const featureShellStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    gap: 0,
  }
  const splitPanelsStyle = {
    flex: '1 1 auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    alignItems: 'stretch',
    gap: 10,
    padding: '10px 10px 0',
    minHeight: 0,
    overflow: 'hidden',
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
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 16px' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>

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
              <select
                value={lessonLanguage}
                onChange={e => setLessonLanguage(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer',
                  minWidth: 200, width: '100%',
                }}
              >
                {languages.map(l => (
                  <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>
                Translate to:
              </label>
              <select
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer',
                  minWidth: 200, width: '100%',
                }}
              >
                {languages.map(l => (
                  <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                ))}
              </select>
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

        {/* Two-panel split */}
        <div style={splitPanelsStyle}>

          {/* LEFT — translated */}
          <div style={panelStyle}>
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
                    {chunk.translated || (
                      <span style={{ color: C.textSecondary }}>
                        Translating this section...
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {(isProcessingChunk || isProcessingTranslation) && !isFinalizing && <TypingDots />}
            </div>
          </div>

          {/* RIGHT — original */}
          <div style={{ ...panelStyle, background: C.surfaceAlt }}>
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
          </div>
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
          display: 'flex', alignItems: 'center', padding: '8px 16px', gap: 16,
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

        {/* Two-panel split */}
        <div style={splitPanelsStyle}>

          {/* LEFT — AI Notes */}
          <div style={panelStyle}>
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
          </div>

          {/* RIGHT — Transcript */}
          <div style={{ ...panelStyle, background: C.surfaceAlt }}>
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
                <div style={{ fontSize: 14, lineHeight: 1.7, color: C.textSecondary, whiteSpace: 'pre-wrap' }}>
                  {transcriptText}
                </div>
              ) : (
                <div style={{ color: C.textSecondary, fontSize: 13 }}>No translated transcript available.</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          height: 56, background: C.surface, borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0,
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
            }}
          >
            ← Back to class
          </button>
        </div>
      </div>
    )
  }

  return null
}
