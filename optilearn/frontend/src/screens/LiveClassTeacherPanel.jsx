import { useState, useRef, useEffect } from 'react'
import { Radio, StopCircle, Pause, Play, Copy, Users, CheckCircle, DownloadSimple as Download, FileText } from '@phosphor-icons/react'
import {
  startLiveClass, pauseLiveClass, resumeLiveClass, endLiveClass,
  getLiveClassStreamToken,
} from '../api/client'
import {
  LIVE_AUDIO_SAMPLE_RATE, startAudioCapture, stopAudioCapture, drainPcmToWavBlob,
} from '../utils/audioCapture'
import Spinner from '../components/Spinner'

const LANGUAGES = [
  { code: 'en', name: 'English' }, { code: 'si', name: 'Sinhala' }, { code: 'ta', name: 'Tamil' },
  { code: 'ar', name: 'Arabic' }, { code: 'fr', name: 'French' }, { code: 'sw', name: 'Swahili' },
  { code: 'so', name: 'Somali' }, { code: 'am', name: 'Amharic' }, { code: 'hi', name: 'Hindi' },
  { code: 'ur', name: 'Urdu' }, { code: 'fa', name: 'Dari / Farsi' }, { code: 'my', name: 'Burmese' },
  { code: 'bn', name: 'Bengali' }, { code: 'tr', name: 'Turkish' }, { code: 'ps', name: 'Pashto' },
]

function getHttpsUrl() {
  return `https://${window.location.hostname}:8443${window.location.pathname}`
}

export default function LiveClassTeacherPanel({ onEnd }) {
  const [phase, setPhase] = useState('setup') // setup | recording | ended
  const [form, setForm] = useState({ title: '', subject: '', source_language: 'en' })
  const [formError, setFormError] = useState('')
  const [starting, setStarting] = useState(false)

  const [sessionId, setSessionId] = useState(null)
  const [joinCode, setJoinCode] = useState('')
  const [sessionStatus, setSessionStatus] = useState('active') // active | paused | ended
  const [sourceChunks, setSourceChunks] = useState([]) // {chunk_index, text}
  const [stats, setStats] = useState({ participant_count: 0, languages: {} })
  const [chunkIndex, setChunkIndex] = useState(0)
  const [micError, setMicError] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [copied, setCopied] = useState(false)

  // Post-session state
  const [completionStatus, setCompletionStatus] = useState(null)
  const completionPollRef = useRef(null)
  const [isDownloadingTranscript, setIsDownloadingTranscript] = useState(false)
  const [transcriptToast, setTranscriptToast] = useState(null)

  const audioCaptureRef = useRef(null)
  const pcmChunksRef = useRef([])
  const sampleRateRef = useRef(LIVE_AUDIO_SAMPLE_RATE)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunkIndexRef = useRef(0)
  const sseAbortRef = useRef(null)

  // ── Setup ──────────────────────────────────────────────────────
  async function handleStart(e) {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Please enter a lesson title.'); return }
    setFormError('')
    setStarting(true)
    try {
      const { session_id, join_code } = await startLiveClass({
        title: form.title.trim(),
        subject: form.subject.trim(),
        source_language: form.source_language,
      })
      setSessionId(session_id)
      setJoinCode(join_code)
      setPhase('recording')
      await beginRecording(session_id)
    } catch (err) {
      setFormError(err.message || 'Could not start class. Please check the connection and continue.')
    } finally {
      setStarting(false)
    }
  }

  // ── Recording ─────────────────────────────────────────────────
  async function beginRecording(sid) {
    setMicError('')

    if (!window.isSecureContext) {
      setMicError(
        `Microphone access needs a secure connection. Open ${getHttpsUrl()} in your browser, ` +
        `tap "Advanced" then "Proceed", then start the Live Class again.`
      )
      return
    }

    let micStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const capture = await startAudioCapture(micStream, pcmChunksRef, sampleRateRef)
      audioCaptureRef.current = capture
      streamRef.current = micStream
    } catch (err) {
      const msg = err?.name === 'NotFoundError'
        ? 'No microphone found. Please connect a microphone, then continue.'
        : 'Microphone access was blocked. Please allow microphone in your browser settings.'
      setMicError(msg)
      return
    }

    chunkIndexRef.current = 0
    setChunkIndex(0)
    setIsRecording(true)

    const recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' })
    recorderRef.current = recorder
    recorder.ondataavailable = () => sendCurrentChunk(sid)
    recorder.start(5000)

    // Start teacher SSE stream
    startTeacherStream(sid)
  }

  async function sendCurrentChunk(sid) {
    const wavBlob = drainPcmToWavBlob(pcmChunksRef, sampleRateRef)
    if (!wavBlob || wavBlob.size <= 44) return
    const idx = chunkIndexRef.current++
    setChunkIndex(idx + 1)

    const fd = new FormData()
    fd.append('audio', wavBlob, `chunk-${idx}.wav`)
    fd.append('chunk_index', String(idx))
    fd.append('hint_language', form.source_language)

    try {
      const res = await fetch(`/api/live-class/${sid}/audio-chunk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('teacher_token') || ''}` },
        body: fd,
      })
      if (!res.ok) { console.warn('[LiveClass] chunk upload issue', res.status); return }
      const data = await res.json()
      if (data.source_text) {
        setSourceChunks(prev => [...prev, { chunk_index: idx, text: data.source_text }])
      }
    } catch (err) {
      console.warn('[LiveClass] chunk upload error', err)
    }
  }

  async function startTeacherStream(sid) {
    try {
      const { token } = await getLiveClassStreamToken(sid)
      const ctrl = new AbortController()
      sseAbortRef.current = ctrl
      const res = await fetch(`/api/live-class/${sid}/teacher-stream?token=${token}`, { signal: ctrl.signal })
      if (!res.ok) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
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
            if (ev.type === 'stats') setStats({ participant_count: ev.participant_count, languages: ev.languages || {} })
            if (ev.type === 'session_ended') break
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[LiveClass] teacher-stream error', err)
    }
  }

  async function stopRecording() {
    try { recorderRef.current?.stop() } catch (_) {}
    recorderRef.current = null
    await stopAudioCapture(audioCaptureRef.current, pcmChunksRef)
    audioCaptureRef.current = null
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch (_) {}
    streamRef.current = null
    sseAbortRef.current?.abort()
    setIsRecording(false)
  }

  async function handlePause() {
    if (!sessionId) return
    await pauseLiveClass(sessionId).catch(() => {})
    try { recorderRef.current?.pause() } catch (_) {}
    setSessionStatus('paused')
  }

  async function handleResume() {
    if (!sessionId) return
    await resumeLiveClass(sessionId).catch(() => {})
    try { recorderRef.current?.resume() } catch (_) {}
    setSessionStatus('active')
  }

  async function handleEnd() {
    if (!sessionId) return
    await stopRecording()
    await endLiveClass(sessionId).catch(() => {})
    setSessionStatus('ended')
    setPhase('ended')
    startCompletionPolling(sessionId)
  }

  function startCompletionPolling(sid) {
    if (completionPollRef.current) clearInterval(completionPollRef.current)
    async function poll() {
      try {
        const token = localStorage.getItem('teacher_token') || ''
        const res = await fetch(`/api/live-class/${sid}/completion-status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        setCompletionStatus(data)
        if (data.all_complete) {
          clearInterval(completionPollRef.current)
          completionPollRef.current = null
        }
      } catch (_) {}
    }
    poll()
    completionPollRef.current = setInterval(poll, 3000)
  }

  async function downloadTeacherTranscript() {
    if (!sessionId) return
    setIsDownloadingTranscript(true)
    try {
      const token = localStorage.getItem('teacher_token') || ''
      const r = await fetch(`/api/live-class/${sessionId}/export-transcript`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        setTranscriptToast({ ok: false, msg: 'Could not download transcript.' })
        setTimeout(() => setTranscriptToast(null), 4000)
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disp = r.headers.get('Content-Disposition') || ''
      const match = disp.match(/filename="?([^";]+)"?/)
      a.download = match?.[1]?.trim() || 'lesson_transcript.pdf'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      setTranscriptToast({ ok: true, msg: 'Transcript saved' })
      setTimeout(() => setTranscriptToast(null), 3000)
    } catch (_) {
      setTranscriptToast({ ok: false, msg: 'Download could not be completed. Please continue in a moment.' })
      setTimeout(() => setTranscriptToast(null), 4000)
    } finally {
      setIsDownloadingTranscript(false)
    }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(joinCode); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch (_) {}
  }

  useEffect(() => {
    return () => {
      stopRecording()
      if (completionPollRef.current) clearInterval(completionPollRef.current)
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────
  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 20 }

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span style={{ background: 'rgba(42,141,191,0.12)', color: 'var(--color-primary)', borderRadius: 10, padding: 10, display: 'flex' }}>
            <Radio size={22} weight="duotone" />
          </span>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Start Live Class</h2>
        </div>

        <form onSubmit={handleStart} style={{ display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
            Lesson Title *
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Fractions — Part 2"
              style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', background: 'var(--color-surface-2, var(--color-surface))', color: 'var(--color-text)', fontSize: '1rem', minHeight: 44 }} />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
            Subject (optional)
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Mathematics"
              style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', background: 'var(--color-surface-2, var(--color-surface))', color: 'var(--color-text)', fontSize: '1rem', minHeight: 44 }} />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
            You are speaking in
            <select value={form.source_language} onChange={e => setForm(f => ({ ...f, source_language: e.target.value }))}
              style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', background: 'var(--color-surface-2, var(--color-surface))', color: 'var(--color-text)', fontSize: '1rem', minHeight: 44 }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          {formError && <div style={{ color: 'var(--color-danger, #dc2626)', fontSize: '0.88rem' }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onEnd} style={{ flex: 1, minHeight: 44, border: '1px solid var(--color-border)', borderRadius: 10, background: 'transparent', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}>
              Cancel
            </button>
            <button type="submit" disabled={starting} style={{ flex: 2, minHeight: 44, border: 'none', borderRadius: 10, background: 'var(--color-primary)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: starting ? 0.7 : 1 }}>
              {starting ? <><Spinner size={16} color="#fff" /> Starting…</> : <><Radio size={16} weight="bold" /> Start Live Class</>}
            </button>
          </div>
        </form>
      </div>
    )
  }

  if (phase === 'ended') {
    const langs = completionStatus?.languages || {}
    const totalChunks = completionStatus?.total_chunks ?? sourceChunks.length
    const allComplete = completionStatus?.all_complete ?? false
    const langCount = Object.keys(langs).length

    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <CheckCircle size={22} color="var(--color-success, #16a34a)" weight="duotone" />
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>Class Ended — {form.title}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onEnd}
            style={{ minHeight: 36, padding: '6px 16px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' }}
          >
            Back to Dashboard
          </button>
        </div>

        {/* Completion banner */}
        {allComplete ? (
          <div style={{ background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: 10, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: '#15803d', fontWeight: 600, fontSize: '0.9rem' }}>
            <CheckCircle size={18} color="#16a34a" weight="bold" />
            All students have their translated transcript ✓
          </div>
        ) : (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
            {langCount > 0
              ? `Study notes are being generated for ${langCount} language${langCount !== 1 ? 's' : ''}. Translations in progress…`
              : 'Generating student notes…'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* Left — Source transcript */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <FileText size={16} color="var(--color-primary)" />
              <span style={{ fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>
                Lesson Transcript ({LANGUAGES.find(l => l.code === form.source_language)?.name || form.source_language})
              </span>
              <button
                onClick={downloadTeacherTranscript}
                disabled={sourceChunks.length === 0 || isDownloadingTranscript}
                title="Download transcript as PDF"
                style={{ background: 'transparent', border: 'none', cursor: sourceChunks.length ? 'pointer' : 'default', color: 'var(--color-text-muted)', padding: 4, display: 'flex', alignItems: 'center', opacity: sourceChunks.length ? 1 : 0.4 }}
              >
                {isDownloadingTranscript ? <Spinner size={15} color="var(--color-primary)" /> : <Download size={15} />}
              </button>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sourceChunks.length === 0
                ? <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', margin: 0 }}>No transcript was captured.</p>
                : sourceChunks.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.88rem', lineHeight: 1.6, color: 'var(--color-text)', padding: '4px 0', borderBottom: i < sourceChunks.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    {c.text}
                  </div>
                ))
              }
            </div>
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              {sourceChunks.length} chunks · {totalChunks} total
            </div>
          </div>

          {/* Right — Student translation progress */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Users size={16} color="var(--color-primary)" weight="duotone" />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Student Translation Progress</span>
            </div>
            {langCount === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', margin: 0 }}>
                No students joined this session.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {Object.entries(langs).map(([lang, info]) => {
                  const pct = info.total_chunks > 0 ? Math.round((info.ready_chunks / info.total_chunks) * 100) : 0
                  return (
                    <div key={lang} style={{ background: 'var(--color-surface-2, rgba(42,141,191,0.06))', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                          {LANGUAGES.find(l => l.code === lang)?.name || lang}
                          {info.participant_count > 0 && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                              {info.participant_count} student{info.participant_count !== 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                        {info.complete
                          ? <CheckCircle size={16} color="#16a34a" weight="bold" />
                          : <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{info.ready_chunks}/{info.total_chunks}</span>
                        }
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: info.complete ? '#16a34a' : 'var(--color-primary)', transition: 'width .4s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {!completionStatus && langCount === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                <Spinner size={14} color="var(--color-primary)" /> Checking…
              </div>
            )}
          </div>
        </div>

        {transcriptToast && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: transcriptToast.ok ? '#1e7e34' : '#c62828', color: '#fff', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>
            {transcriptToast.msg}
          </div>
        )}
      </div>
    )
  }

  // Recording phase
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '16px' }}>
      {/* Header strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: sessionStatus === 'active' ? '#16a34a' : '#f59e0b', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{form.title}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '2px 8px' }}>
            {sessionStatus === 'active' ? 'Live' : 'Paused'}
          </span>
        </div>
        {/* Join code */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Join code:</span>
          <code style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: 2, color: 'var(--color-primary)' }}>{joinCode}</code>
          <button onClick={copyCode} style={{ border: '1px solid var(--color-border)', borderRadius: 6, background: 'transparent', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          {sessionStatus === 'active'
            ? <button onClick={handlePause} style={{ minHeight: 36, padding: '6px 14px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}><Pause size={14} /> Pause</button>
            : <button onClick={handleResume} style={{ minHeight: 36, padding: '6px 14px', border: 'none', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}><Play size={14} /> Resume</button>
          }
          <button onClick={handleEnd} style={{ minHeight: 36, padding: '6px 14px', border: 'none', borderRadius: 8, background: 'var(--color-danger, #dc2626)', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}><StopCircle size={14} /> End Class</button>
        </div>
      </div>

      {micError && (
        <div style={{ background: '#fef2f2', color: '#dc2626', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: '0.88rem', lineHeight: 1.5 }}>{micError}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* Source transcript */}
        <div style={card}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Source Transcript ({LANGUAGES.find(l => l.code === form.source_language)?.name})
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sourceChunks.length === 0
              ? <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: 0 }}>Waiting for speech…</p>
              : sourceChunks.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--color-text)', padding: '4px 0', borderBottom: i < sourceChunks.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    {c.text}
                  </div>
                ))
            }
          </div>
          <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {chunkIndex} chunks sent
          </div>
        </div>

        {/* Student stats */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Users size={16} color="var(--color-primary)" weight="duotone" />
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{stats.participant_count} student{stats.participant_count !== 1 ? 's' : ''} connected</span>
          </div>
          {Object.keys(stats.languages).length === 0
            ? <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', margin: 0 }}>No students have joined yet. Share join code: <strong>{joinCode}</strong></p>
            : (
              <div style={{ display: 'grid', gap: 6 }}>
                {Object.entries(stats.languages).map(([lang, count]) => (
                  <div key={lang} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface-2, rgba(42,141,191,0.06))', borderRadius: 8, padding: '6px 12px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{LANGUAGES.find(l => l.code === lang)?.name || lang}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{count} student{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}
