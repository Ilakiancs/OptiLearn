import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  ArrowClockwise as RotateCcw,
  ArrowRight,
  ArrowsOutSimple as Maximize2,
  BookOpen,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CheckCircle as CheckCircle2,
  Clock as Clock3,
  DownloadSimple as Download,
  FileText,
  Globe,
  Lightning as Zap,
  MagnifyingGlass as Search,
  SpeakerHigh as Volume2,
  Sparkle as Sparkles,
  StopCircle,
  Translate as Languages,
  UploadSimple as Upload,
  WarningCircle as AlertCircle,
} from '@phosphor-icons/react'
import { feature1, saveBlobAsPdf } from '../api/client'
import LanguageSelect from '../components/LanguageSelect'
import FormattedText, { normalizeOutputText } from '../components/FormattedText'
import Spinner from '../components/Spinner'
// -- Section --
const C = {
  primary: 'var(--accent)',
  primaryLight: 'var(--accent-soft)',
  surface: 'var(--surface)',
  surfaceAlt: 'var(--surface-soft)',
  border: 'var(--border)',
  textPrimary: 'var(--text)',
  textSecondary: 'var(--text-muted)',
  accentGreen: 'var(--success)',
  hover: 'var(--bg-soft)',
  danger: 'var(--accent)',
  warningSurface: 'var(--accent-soft)',
}
// -- Section --
function cleanMarkdownText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^```[a-zA-Z]*\s*$/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/`/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

function renderInlineMarkdown(text) {
  const cleaned = String(text || '').replace(/_{2}(.+?)_{2}/g, '**$1**')
  const parts = cleaned.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2).replace(/\*/g, '')}</strong>
    }
    return <span key={i}>{part.replace(/\*/g, '')}</span>
  })
}

function renderMarkdown(text, opts = {}) {
  if (!text) return null
  return <FormattedText text={text} {...opts} color={C.textPrimary} />
}

function SkeletonLines() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 0' }}>
      {['100%', '85%', '95%', '60%'].map((w, i) => (
        <div key={i} style={{ height: i % 2 === 0 ? 16 : 12, width: w, background: C.border, borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite alternate' }} />
      ))}
      <style>{`@keyframes pulse{from{opacity:.4}to{opacity:1}} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  )
}
// -- Section --
export default function TranslateLearn() {
  const { student, studentId } = useOutletContext()

  // State
  const [appState, setAppState]             = useState('idle')
  const [mainPanel, setMainPanel]           = useState('upload')
  const [material, setMaterial]             = useState(null)
  const [targetLanguage, setTargetLanguage] = useState(student?.language || 'en')
  const [languages, setLanguages]           = useState([])
  const [currentPage, setCurrentPage]       = useState(1)
  const [translatedPages, setTranslatedPages] = useState({})
  const [tutorHistory, setTutorHistory]     = useState([])   // {type:'summary'|'question'|'answer', content:string, isStreaming:bool}
  const [isStreaming, setIsStreaming]        = useState(false)
  const [suggestedQs, setSuggestedQs]       = useState([])
  const [highlightedText, setHighlightedText] = useState(null)
  const [tooltipPos, setTooltipPos]         = useState(null)
  const [isDragging, setIsDragging]         = useState(false)
  const [pasteMode, setPasteMode]           = useState(false)
  const [pasteText, setPasteText]           = useState('')
  const [detectedLang, setDetectedLang]     = useState(null)
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [searchQuery, setSearchQuery]       = useState('')
  const [error, setError]                   = useState(null)
  const [translationProgress, setTranslationProgress] = useState({ current: 0, total: 0 })
  const [modelPreference, setModelPreference]         = useState('fast')
  const [e4bAvailable, setE4bAvailable]               = useState(false)
  const [fileObjectURL, setFileObjectURL]             = useState(null)
  const [fileType, setFileType]                       = useState(null) // "pdf" | "image" | "text"
  const [playingPanel, setPlayingPanel]               = useState(null) // "upload"|"translate"|"explain"|null
  const [isDownloadingPdf, setIsDownloadingPdf]       = useState(false)
  const [pdfToast, setPdfToast]                       = useState(null)
  const [pastSessions, setPastSessions]               = useState([])
  const [sessionsLoading, setSessionsLoading]         = useState(false)
  const [openingSession, setOpeningSession]           = useState(null)
  const audioCtxRef                                   = useRef(null)
  const playingPanelRef                               = useRef(null)

  const fileInputRef     = useRef(null)
  const searchInputRef   = useRef(null)
  const isCancelledRef   = useRef(false)
  const historyScrollRef = useRef(null)
  const uploadInFlightRef = useRef(false)
  const pdfDownloadRef = useRef(false)
  const activeTranslationRef = useRef(null)
  const activeExplanationRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const isCompact = viewportWidth < 860

  useEffect(() => { feature1.getLanguages().then(setLanguages).catch(() => {}) }, [])
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { if (student?.language) setTargetLanguage(student.language) }, [student])
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setE4bAvailable(!!d.e4b_available)).catch(() => {})
  }, [])
  useEffect(() => {
    if (studentId) loadPastSessions()
  }, [studentId])
  useEffect(() => {
    const clear = () => setTooltipPos(null)
    window.addEventListener('scroll', clear)
    return () => window.removeEventListener('scroll', clear)
  }, [])
  useEffect(() => {
    if (historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight
    }
  }, [tutorHistory])
  useEffect(() => {
    return () => {
      if (fileObjectURL) URL.revokeObjectURL(fileObjectURL)
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch (_) {} }
    }
  }, [fileObjectURL])
// -- Section --
  async function loadPastSessions() {
    if (!studentId) return
    setSessionsLoading(true)
    try {
      const data = await feature1.getSessions(studentId)
      setPastSessions(data.sessions || [])
    } catch (_) {
      setPastSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }

  async function openSavedSession(session) {
    const materialId = session?.material_id
    if (!materialId || openingSession) return
    setOpeningSession(materialId)
    setError(null)
    isCancelledRef.current = true
    activeTranslationRef.current = null
    activeExplanationRef.current = null
    uploadInFlightRef.current = false
    stopAudio()
    setPlayingPanel(null)
    setIsStreaming(false)

    try {
      const data = await feature1.getSession(studentId, materialId)
      if (fileObjectURL) {
        URL.revokeObjectURL(fileObjectURL)
        setFileObjectURL(null)
      }
      const restoredLanguage = data.target_language || targetLanguage
      const restoredType = data.type || 'text'
      const restoredHistory = []
      if (data.tutor_summary?.trim()) {
        restoredHistory.push({ type: 'summary', content: data.tutor_summary, isStreaming: false })
      }
      ;(data.tutor_history || []).forEach(entry => {
        if ((entry.type === 'question' || entry.type === 'answer') && entry.content) {
          restoredHistory.push({ type: entry.type, content: entry.content, isStreaming: false })
        }
      })

      setMaterial({
        material_id: data.material_id,
        type: restoredType,
        page_count: data.page_count || 1,
        preview: data.preview || data.translated_preview || '',
      })
      setFileType(restoredType)
      setPasteMode(false)
      setPasteText(restoredType === 'text' ? (data.preview || '') : '')
      setTargetLanguage(restoredLanguage)
      setDetectedLang(data.detected_language || data.source_language || null)
      setTranslatedPages({ 1: data.translated_text || '' })
      setCurrentPage(1)
      setTranslationProgress({ current: data.page_count || 1, total: data.page_count || 1 })
      setTutorHistory(restoredHistory)
      setSuggestedQs([])
      setHighlightedText(null)
      setTooltipPos(null)
      setSearchQuery('')
      setAppState('translated')
      setMainPanel('translate')
    } catch (err) {
      setError(err.message || 'Saved session could not be opened.')
    } finally {
      isCancelledRef.current = false
      setOpeningSession(null)
    }
  }

  function stopAudio() {
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch (_) {}
      audioCtxRef.current = null
    }
    playingPanelRef.current = null
  }

  function handleReset() {
    isCancelledRef.current = true
    activeTranslationRef.current = null
    activeExplanationRef.current = null
    uploadInFlightRef.current = false
    pdfDownloadRef.current = false
    stopAudio()
    setPlayingPanel(null)
    setIsDownloadingPdf(false)
    if (fileObjectURL) { URL.revokeObjectURL(fileObjectURL); setFileObjectURL(null) }
    setFileType(null)
    setAppState('idle')
    setMainPanel('upload')
    setMaterial(null)
    setCurrentPage(1)
    setTranslatedPages({})
    setTranslationProgress({ current: 0, total: 0 })
    setTutorHistory([])
    setIsStreaming(false)
    setSuggestedQs([])
    setHighlightedText(null)
    setTooltipPos(null)
    setIsDragging(false)
    setPasteMode(false)
    setPasteText('')
    setDetectedLang(null)
    setSourceLanguage('auto')
    setSearchQuery('')
    setError(null)
  }
// -- Section --
  function gridAreaFor(panel) {
    const map = {
      upload:    { upload: 'main', translate: 'topLeft',    explain: 'bottomLeft' },
      translate: { upload: 'topLeft', translate: 'main',    explain: 'bottomLeft' },
      explain:   { upload: 'bottomLeft', translate: 'topLeft', explain: 'main'    },
    }
    return map[mainPanel][panel]
  }

  function panelContainerStyle(panel) {
    const area = gridAreaFor(panel)
    const base = { borderRadius: 12, overflow: 'hidden', position: 'relative', transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)', gridArea: area, minHeight: 0, minWidth: 0 }
    return area === 'main'
      ? { ...base, background: C.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }
      : { ...base, background: C.surfaceAlt, border: `1px solid ${C.border}`, cursor: 'pointer' }
  }
// -- Section --
  async function handleUpload(fileOrNull) {
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setError(null)
    setAppState('uploading')
    setMaterial(null)
    setTranslatedPages({})
    setTutorHistory([])
    setSuggestedQs([])
    setHighlightedText(null)
    setTooltipPos(null)
    setCurrentPage(1)

    try {
      const fd = new FormData()
      fd.append('student_id', studentId)
      fd.append('target_language', targetLanguage)
      if (sourceLanguage && sourceLanguage !== 'auto') fd.append('source_language_hint', sourceLanguage)
      if (fileOrNull) fd.append('file', fileOrNull)
      else fd.append('text_input', pasteText)

      const result = await feature1.upload(fd)
      setMaterial(result)
      setDetectedLang(result.detected_language)
      setAppState('translating')
      await startTranslation(result, targetLanguage)
    } catch (err) {
      setError(err.message || 'Upload needs another try. Please check the file or text.')
      setAppState('idle')
    } finally {
      uploadInFlightRef.current = false
    }
  }

  async function startTranslation(mat, lang) {
    const key = `${mat.material_id}:${lang}:${modelPreference}`
    if (activeTranslationRef.current?.key === key) return
    const run = { key, cancelled: false }
    activeTranslationRef.current = run
    isCancelledRef.current = false
    setIsStreaming(true)
    setTranslationProgress({ current: 0, total: mat.page_count || 1 })
    setTranslatedPages({})
    let hasContent = false

    try {
      await feature1.translateStream(
        { material_id: mat.material_id, student_id: studentId, target_language: lang, model_preference: modelPreference },
        (event) => {
          if (isCancelledRef.current || activeTranslationRef.current !== run) return
          if (event.type === 'token') {
            hasContent = true
            setTranslatedPages(prev => ({ ...prev, [event.page]: (prev[event.page] || '') + event.content }))
          } else if (event.type === 'model_switch') {
            if (event.page) {
              setTranslatedPages(prev => ({ ...prev, [event.page]: '' }))
            }
          } else if (event.type === 'page_complete') {
            if (typeof event.full_text === 'string') {
              hasContent = hasContent || event.full_text.trim().length > 0
              setTranslatedPages(prev => ({ ...prev, [event.page]: event.full_text }))
            }
            setTranslationProgress(prev => ({ ...prev, current: event.page }))
          } else if (event.type === 'error') {
            setError(event.message || 'Translation needs another pass. Check your API key quota and continue.')
          }
        },
        () => {
          if (isCancelledRef.current || activeTranslationRef.current !== run) return
          setIsStreaming(false)
          activeTranslationRef.current = null
          if (hasContent) {
            setAppState('translated')
            setMainPanel('translate')
            setTimeout(loadPastSessions, 900)
            startExplanation(mat, lang)
          } else {
            setError(prev => prev || 'Translation returned no content. Please check your input and continue.')
            setAppState('idle')
          }
        }
      )
    } catch (err) {
      if (isCancelledRef.current || activeTranslationRef.current !== run) return
      activeTranslationRef.current = null
      setIsStreaming(false)
      setError(err.message || 'Translation needs another try.')
      setAppState('idle')
    }
  }

  async function startExplanation(mat, lang) {
    const key = `${mat.material_id}:${lang}:${modelPreference}`
    if (activeExplanationRef.current?.key === key) return
    const run = { key }
    activeExplanationRef.current = run
    setTutorHistory([{ type: 'summary', content: '', isStreaming: true }])
    setIsStreaming(true)
    try {
      await feature1.explainStream(
        { material_id: mat.material_id, student_id: studentId, language: lang, model_preference: modelPreference },
        (event) => {
          if (isCancelledRef.current || activeExplanationRef.current !== run) return
          if (event.type === 'token') {
            setTutorHistory(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.type === 'summary') next[next.length - 1] = { ...last, content: last.content + event.content }
              return next
            })
          } else if (event.type === 'error') {
            setError(event.message || 'Explanation needs another try.')
          }
        },
        async () => {
          if (isCancelledRef.current || activeExplanationRef.current !== run) return
          activeExplanationRef.current = null
          setTutorHistory(prev => {
            const next = [...prev]
            if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], isStreaming: false }
            return next
          })
          setIsStreaming(false)
          loadPastSessions()
          try {
            const res = await feature1.ask({ material_id: mat.material_id, student_id: studentId, question: '', language: lang, format: 'json', model_preference: modelPreference })
            if (!isCancelledRef.current) setSuggestedQs(res.questions || [])
          } catch (_) {}
        }
      )
    } catch (err) {
      if (isCancelledRef.current || activeExplanationRef.current !== run) return
      activeExplanationRef.current = null
      setTutorHistory(prev => {
        const next = [...prev]
        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], isStreaming: false }
        return next
      })
      setIsStreaming(false)
      setError(err.message || 'Explanation needs another try.')
    }
  }

  async function handleAsk(question, highlighted) {
    if (!material || !question.trim()) return
    setIsStreaming(true)
    setMainPanel('explain')
    setAppState('explaining')
    setSearchQuery('')
    setTutorHistory(prev => [
      ...prev,
      { type: 'question', content: question, isStreaming: false },
      { type: 'answer', content: '', isStreaming: true },
    ])
    try {
      await feature1.askStream(
        { material_id: material.material_id, student_id: studentId, question, language: targetLanguage, highlighted_text: highlighted || null, model_preference: modelPreference },
        (event) => {
          if (!isCancelledRef.current && event.type === 'token') {
            setTutorHistory(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.type === 'answer') next[next.length - 1] = { ...last, content: last.content + event.content }
              return next
            })
          }
        },
        () => {
          if (!isCancelledRef.current) {
            setTutorHistory(prev => {
              const next = [...prev]
              if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], isStreaming: false }
              return next
            })
            setIsStreaming(false)
          }
        }
      )
    } catch (err) {
      if (isCancelledRef.current) return
      setTutorHistory(prev => {
        const next = [...prev]
        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], isStreaming: false }
        return next
      })
      setIsStreaming(false)
      setError(err.message || 'Question needs another try.')
    }
  }
// -- Section --
  function createBlobURLForFile(file) {
    const url = URL.createObjectURL(file)
    setFileObjectURL(url)
    if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) setFileType('pdf')
    else if (file.type.startsWith('image/')) setFileType('image')
    else setFileType('text')
  }

  function onDragOver(e) { e.preventDefault(); setIsDragging(true) }
  function onDragLeave()  { setIsDragging(false) }
  function onDrop(e)      { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) { createBlobURLForFile(f); handleUpload(f) } }
// -- Section --
  function onTranslateMouseUp() {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (text && text.length > 5) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setHighlightedText(text)
      setTooltipPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX })
    } else {
      setHighlightedText(null); setTooltipPos(null)
    }
  }

  const translatedText = translatedPages[currentPage] || ''
  const pageCount      = material?.page_count || 1
  const langName       = (code) => languages.find(l => l.code === code)?.name || code
  const detectedSourceLanguage = detectedLang && detectedLang !== 'unknown' ? detectedLang : null
  const sourceReadLanguage = (sourceLanguage !== 'auto' ? sourceLanguage : null) || detectedSourceLanguage || student?.language || 'en'
  const hasQuestions   = tutorHistory.some(e => e.type === 'question')

  function sessionDateLabel(value) {
    if (!value) return 'Saved'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Saved'
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function sessionPreview(session) {
    return (session.translated_preview || session.tutor_preview || session.preview || 'Translated learning material')
      .replace(/\s+/g, ' ')
      .trim()
  }
// -- Section --
  async function speakText(text, language, panelName) {
    if (playingPanelRef.current === panelName) {
      stopAudio()
      setPlayingPanel(null)
      return
    }
    if (!text || text.trim().length === 0) return

    stopAudio()
    playingPanelRef.current = panelName
    setPlayingPanel(panelName)

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()

      const response = await fetch('/api/tts/speak-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizeOutputText(text).slice(0, 3000), language }),
      })
      if (!response.ok) {
        if (playingPanelRef.current === panelName) {
          playingPanelRef.current = null
          setPlayingPanel(null)
        }
        return
      }

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
          } catch (e) {
            console.error('TTS decode error:', e)
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          const merged = new Uint8Array(buf.length + value.length)
          merged.set(buf)
          merged.set(value, buf.length)
          buf = merged
          await flush()
        }
        if (done) break
      }

      if (lastSource) {
        lastSource.onended = () => {
          if (audioCtxRef.current === ctx) {
            playingPanelRef.current = null
            setPlayingPanel(null)
          }
        }
      } else {
        playingPanelRef.current = null
        setPlayingPanel(null)
      }
    } catch (e) {
      console.error('TTS error:', e)
      if (playingPanelRef.current === panelName) playingPanelRef.current = null
      setPlayingPanel(null)
    }
  }
  function TTSButton({ panelName, text, language, small }) {
    const isPlaying = playingPanel === panelName
    const size = small ? 14 : 18
    return (
      <button
        onClick={e => { e.stopPropagation(); speakText(text, language, panelName) }}
        disabled={!text || text.trim().length === 0}
        title={isPlaying ? 'Stop' : 'Read aloud'}
        style={{ background: 'transparent', border: 'none', cursor: text ? 'pointer' : 'default', color: isPlaying ? C.primary : C.textSecondary, padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', opacity: text ? 1 : 0.4, flexShrink: 0 }}>
        {isPlaying ? <StopCircle size={size} /> : <Volume2 size={size} />}
      </button>
    )
  }
// -- Section --
  function filenameFromDisposition(disposition) {
    if (!disposition) return 'translation.pdf'
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
      try { return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, '')) } catch {}
    }
    const asciiMatch = disposition.match(/filename="?([^";]+)"?/i)
    return asciiMatch?.[1]?.trim() || 'translation.pdf'
  }

  async function downloadTranslation() {
    if (!material?.material_id || pdfDownloadRef.current) return
    pdfDownloadRef.current = true
    setIsDownloadingPdf(true)
    const params = new URLSearchParams({ student_id: studentId, target_language: targetLanguage })
    try {
      const response = await fetch(`/api/feature1/materials/${material.material_id}/export?${params}`)
      if (!response.ok) {
        let message = 'The PDF could not be downloaded. Please continue in a moment.'
        try {
          const body = await response.json()
          message = body.detail || body.message || message
        } catch (_) {}
        setPdfToast({ ok: false, msg: message })
        setTimeout(() => setPdfToast(null), 5000)
        return
      }
      const blob = await response.blob()
      const filename = filenameFromDisposition(response.headers.get('Content-Disposition'))
      const result = await saveBlobAsPdf(blob, filename)
      const msg = result?.path ? `Saved to Downloads` : 'PDF saved'
      setPdfToast({ ok: true, msg: result?.ok === false ? 'Could not save the PDF. Please continue in a moment.' : msg })
      setTimeout(() => setPdfToast(null), 4000)
    } catch (e) {
      console.error('PDF export error:', e)
      setPdfToast({ ok: false, msg: 'Could not save the PDF. Please continue in a moment.' })
      setTimeout(() => setPdfToast(null), 4000)
    } finally {
      pdfDownloadRef.current = false
      setIsDownloadingPdf(false)
    }
  }
// -- Section --
  function renderUploadPanel() {
    const isSmall = gridAreaFor('upload') !== 'main'

    if (isSmall) return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
          <FileText size={13} color={C.primary} />
          <span style={{ fontSize: 11, fontWeight: 600, color: C.textPrimary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {material ? (material.type === 'text' ? 'Text input' : 'Uploaded file') : 'No file'}
          </span>
          {(appState === 'uploading' || appState === 'translating') && <Spinner size={12} color={C.primary} />}
          <TTSButton panelName="upload" text={pasteText || material?.preview || ''} language={sourceReadLanguage} small />
          <Maximize2 size={12} color={C.textSecondary} style={{ flexShrink: 0 }} />
        </div>
        {material ? (
          fileType === 'pdf' && fileObjectURL ? (
            <div style={{ overflow: 'hidden', height: '100%', width: '100%' }}>
              <iframe src={fileObjectURL} title="Uploaded document" style={{ transform: 'scale(0.35)', transformOrigin: 'top left', width: '285%', height: '285%', border: 'none', pointerEvents: 'none' }} />
            </div>
          ) : fileType === 'image' && fileObjectURL ? (
            <img src={fileObjectURL} alt="Uploaded material" style={{ width: '100%', objectFit: 'cover', flex: 1, minHeight: 0 }} />
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 12, color: C.textSecondary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {pasteText || material.preview || ''}
            </div>
          )
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: C.textSecondary }}>No file uploaded yet</span>
          </div>
        )}
      </div>
    )

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <BookOpen size={22} color={C.primary} />
          <Globe size={18} color={C.primary} />
          <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>Translate and Learn</span>
          {material && <TTSButton panelName="upload" text={pasteText || material?.preview || ''} language={sourceReadLanguage} />}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {pasteMode && (
              <button onClick={() => setPasteMode(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSecondary, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <ChevronLeft size={14} /> File upload
              </button>
            )}
            {(material || pasteMode || appState !== 'idle') && (
              <button onClick={handleReset} title="Start over"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSecondary, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <RotateCcw size={14} /> Start over
              </button>
            )}
          {e4bAvailable && (
            <div style={{ display: 'flex', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 20, padding: 3, gap: 2 }}>
              {[{ key: 'fast', label: 'Fast', icon: <Zap size={12} /> }, { key: 'deep', label: 'Deep', icon: <Sparkles size={12} /> }].map(({ key, label, icon }) => (
                <button key={key} onClick={() => setModelPreference(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: modelPreference === key ? C.primary : 'transparent', color: modelPreference === key ? '#fff' : C.textSecondary, transition: 'all 0.15s' }}>
                  {icon}{label}
                </button>
              ))}
            </div>
          )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>Material language:</label>
            <LanguageSelect
              languages={languages}
              value={sourceLanguage}
              onChange={e => setSourceLanguage(e.target.value)}
              disabled={!!material}
              includeAutoDetect
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontSize: 14, cursor: material ? 'default' : 'pointer', opacity: material ? 0.6 : 1 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>Translate to:</label>
            <LanguageSelect
              languages={languages}
              value={targetLanguage}
              onChange={e => setTargetLanguage(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer' }}
            />
          </div>
        </div>

        {error && (
          <div style={{ display: 'flex', gap: 8, background: C.warningSurface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.textPrimary, alignItems: 'flex-start' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {!pasteMode ? (
          fileObjectURL && fileType === 'pdf' ? (
            <iframe src={fileObjectURL} width="100%" height="100%" style={{ border: 'none', borderRadius: 8, minHeight: 400, flex: 1, marginBottom: 14, display: 'block' }} title="Uploaded document" />
          ) : fileObjectURL && fileType === 'image' ? (
            <img src={fileObjectURL} alt="Uploaded material" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8, maxHeight: 600, flex: 1, marginBottom: 14, display: 'block' }} />
          ) : (
          <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            style={{ flex: 1, border: `2px ${isDragging ? 'solid' : 'dashed'} ${isDragging ? C.primary : C.border}`, background: isDragging ? C.primaryLight : C.surfaceAlt, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, transition: 'all 0.15s', marginBottom: 14, minHeight: 140 }}>
            {appState === 'uploading' || appState === 'translating' ? (
              <>
                <Spinner size={36} color={C.primary} />
                <span style={{ fontSize: 14, color: C.textSecondary }}>
                  {appState === 'uploading'
                    ? 'Uploading...'
                    : translationProgress.total > 1
                      ? `Translating page ${translationProgress.current + 1} of ${translationProgress.total}...`
                      : 'Translating - this may take a moment...'}
                </span>
              </>
            ) : (
              <>
                <Upload size={36} color={C.textSecondary} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, color: C.textPrimary, fontSize: 15 }}>Drop a PDF, photo, or paste text</div>
                  <div style={{ color: C.textSecondary, fontSize: 13, marginTop: 4 }}>Supports PDF, JPG, PNG</div>
                </div>
              </>
            )}
          </div>
          )
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste or type your learning material here"
              style={{ flex: 1, resize: 'none', border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, fontSize: 14, color: C.textPrimary, background: C.surfaceAlt, lineHeight: 1.6, minHeight: 120, boxSizing: 'border-box' }} />
            <div style={{ textAlign: 'right', fontSize: 11, color: C.textSecondary, marginTop: 4 }}>{pasteText.length} chars</div>
            {pasteText.trim().length > 0 && (
              <button onClick={() => { setFileType('text'); handleUpload(null) }} style={{ width: '100%', height: 44, borderRadius: 8, background: C.primary, color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>Translate</button>
            )}
          </div>
        )}

        {(sourceLanguage !== 'auto' || detectedSourceLanguage) && !error && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 12px', fontSize: 13, marginBottom: 12, color: C.textPrimary }}>
            <CheckCircle2 size={14} color={C.accentGreen} />
            {sourceLanguage !== 'auto'
              ? `Source: ${langName(sourceLanguage)}`
              : `Auto-detected: ${langName(detectedSourceLanguage)}`}
          </div>
        )}

        {!material && !pasteMode && (sessionsLoading || pastSessions.length > 0) && (
          <div style={{ flexShrink: 0, marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
              <Clock3 size={14} color={C.primary} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, flex: 1 }}>Recent translations</span>
              {sessionsLoading && <Spinner size={13} color={C.primary} />}
            </div>
            <div style={{ maxHeight: 132, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pastSessions.slice(0, 6).map(session => {
                const loadingThis = openingSession === session.material_id
                return (
                  <button key={session.material_id} onClick={() => openSavedSession(session)} disabled={!!openingSession}
                    style={{ textAlign: 'left', border: `1px solid ${C.border}`, background: C.surfaceAlt, borderRadius: 8, padding: '8px 10px', cursor: openingSession ? 'default' : 'pointer', color: C.textPrimary, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sessionDateLabel(session.updated_at || session.created_at)} - {langName(session.target_language || targetLanguage)}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: C.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                        {sessionPreview(session)}
                      </span>
                    </span>
                    {loadingThis ? <Spinner size={14} color={C.primary} /> : <ArrowRight size={14} color={C.primary} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {!pasteMode ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => fileInputRef.current?.click()} disabled={appState === 'uploading' || appState === 'translating'}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Upload File
            </button>
            <button onClick={() => setPasteMode(true)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Paste Text
            </button>
          </div>
        ) : null}
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { createBlobURLForFile(f); handleUpload(f) } }} />
      </div>
    )
  }
// -- Section --
  function renderTranslatePanel() {
    const isSmall = gridAreaFor('translate') !== 'main'

    if (isSmall) return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
          <Languages size={13} color={C.primary} />
          <span style={{ fontSize: 11, fontWeight: 600, color: C.textPrimary, flex: 1 }}>Translation</span>
          {pageCount > 1 && <span style={{ fontSize: 10, background: C.primaryLight, color: C.primary, borderRadius: 10, padding: '1px 5px' }}>{currentPage}/{pageCount}</span>}
          {appState === 'translating' && <Spinner size={12} color={C.primary} />}
          <TTSButton panelName="translate" text={translatedText} language={targetLanguage} small />
          {translatedText && <button onClick={e => { e.stopPropagation(); downloadTranslation() }} disabled={isDownloadingPdf} title={isDownloadingPdf ? 'Preparing PDF' : 'Save PDF'} style={{ background: 'transparent', border: 'none', cursor: isDownloadingPdf ? 'default' : 'pointer', color: isDownloadingPdf ? C.primary : C.textSecondary, padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0, opacity: isDownloadingPdf ? 0.8 : 1 }}>{isDownloadingPdf ? <Spinner size={14} color={C.primary} /> : <Download size={14} />}</button>}
          <Maximize2 size={12} color={C.textSecondary} style={{ flexShrink: 0 }} />
        </div>
        {translatedText ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            <FormattedText text={translatedText} compact fontSize={12} headingSize={14} color={C.textPrimary} />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <span style={{ fontSize: 11, color: C.textSecondary, textAlign: 'center' }}>
              {appState === 'translating' ? 'Translating...' : 'Translation will appear here'}
            </span>
          </div>
        )}
      </div>
    )

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <Languages size={18} color={C.primary} />
          <span style={{ fontSize: 14, color: C.textSecondary }}>{detectedSourceLanguage ? langName(detectedSourceLanguage) : 'Source'}</span>
          <ArrowRight size={14} color={C.textSecondary} />
          <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{langName(targetLanguage)}</span>
          {appState === 'translating' && <Spinner size={15} color={C.primary} />}
          <TTSButton panelName="translate" text={translatedText} language={targetLanguage} />
          {translatedText && (
            <button onClick={downloadTranslation} disabled={isDownloadingPdf} title={isDownloadingPdf ? 'Preparing PDF' : 'Save PDF'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 10px', fontSize: 13, color: isDownloadingPdf ? C.primary : C.textSecondary, cursor: isDownloadingPdf ? 'default' : 'pointer', opacity: isDownloadingPdf ? 0.8 : 1 }}>
              {isDownloadingPdf ? <Spinner size={14} color={C.primary} /> : <Download size={14} />} {isDownloadingPdf ? 'Preparing' : 'Save PDF'}
            </button>
          )}
        </div>

        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Page {currentPage} of {pageCount}</span>
            <button onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}><ChevronRight size={14} /></button>
          </div>
        )}

        <div style={{ height: 1, background: C.border, marginBottom: 16, flexShrink: 0 }} />

        <div onMouseUp={onTranslateMouseUp} style={{ flex: 1, overflowY: 'auto', userSelect: 'text', lineHeight: 1.7 }}>
          {appState === 'translating' && !translatedText ? (
            <SkeletonLines />
          ) : translatedText ? (
            <div style={{ fontSize: 15, color: C.textPrimary }}>
              <FormattedText text={translatedText} fontSize={15} headingSize={18} color={C.textPrimary} />
              {appState === 'translating' && <span style={{ borderRight: '2px solid currentColor', animation: 'blink 1s step-end infinite', marginLeft: 2 }}>&nbsp;</span>}
            </div>
          ) : (
            <div style={{ color: C.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 40 }}>
              {appState === 'idle' ? 'Upload a document to see the translation here.' : 'Translation will appear here...'}
            </div>
          )}
        </div>

        {tooltipPos && highlightedText && (
          <div onClick={() => { setTooltipPos(null); handleAsk(`Explain: "${highlightedText}"`, highlightedText) }}
            style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, background: C.primary, color: '#fff', padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
            <Zap size={13} /> Learn More
          </div>
        )}
      </div>
    )
  }
// -- Section --
  function renderExplainPanel() {
    const isSmall = gridAreaFor('explain') !== 'main'
    const anyStreaming = tutorHistory.some(e => e.isStreaming)

    if (isSmall) return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
          <Sparkles size={13} color={C.primary} />
          <span style={{ fontSize: 11, fontWeight: 600, color: C.textPrimary, flex: 1 }}>AI Tutor</span>
          {anyStreaming && <Spinner size={12} color={C.primary} />}
          <TTSButton panelName="explain" text={[...tutorHistory].reverse().find(e => e.type === 'summary' || e.type === 'answer')?.content || ''} language={targetLanguage} small />
          <Maximize2 size={12} color={C.textSecondary} style={{ flexShrink: 0 }} />
        </div>

        {tutorHistory.length > 0 ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
            {tutorHistory.slice(-3).map((entry, i) => {
              if (entry.type === 'summary') return (
                <div key={i} style={{ padding: 8, lineHeight: 1.5, WebkitMaskImage: 'linear-gradient(to bottom,black 70%,transparent 100%)', maskImage: 'linear-gradient(to bottom,black 70%,transparent 100%)' }}>
                  {renderMarkdown(entry.content, { fontSize: 12, headingSize: 14 })}
                  {entry.isStreaming && <span style={{ borderRight: '2px solid currentColor', animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
                </div>
              )
              if (entry.type === 'question') return (
                <div key={i} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', margin: '4px 8px', fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>
                  {entry.content}
                </div>
              )
              if (entry.type === 'answer') return (
                <div key={i} style={{ background: C.surfaceAlt, borderRadius: 8, padding: '8px 12px', margin: '4px 8px', lineHeight: 1.5 }}>
                  {renderMarkdown(entry.content, { fontSize: 12, headingSize: 14 })}
                  {entry.isStreaming && <span style={{ borderRight: '2px solid currentColor', animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
                </div>
              )
              return null
            })}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <span style={{ fontSize: 11, color: C.textSecondary, textAlign: 'center' }}>AI Tutor will explain your material here</span>
          </div>
        )}

        <div onClick={e => e.stopPropagation()}
          style={{ margin: 8, height: 36, borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6, flexShrink: 0 }}>
          <Search size={12} color={C.textSecondary} />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && searchQuery.trim()) { setMainPanel('explain'); handleAsk(searchQuery, null) } }}
            onClick={e => e.stopPropagation()}
            placeholder="Ask anything..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: C.textPrimary, background: 'transparent' }} />
          <button onClick={e => { e.stopPropagation(); if (searchQuery.trim()) { setMainPanel('explain'); handleAsk(searchQuery, null) } }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <ArrowRight size={14} color={C.primary} />
          </button>
        </div>
      </div>
    )
// -- Section --
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexShrink: 0 }}>
          <Sparkles size={18} color={C.primary} />
          <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>AI Tutor</span>
          <TTSButton panelName="explain" text={[...tutorHistory].reverse().find(e => e.type === 'summary' || e.type === 'answer')?.content || ''} language={targetLanguage} />
          {hasQuestions && (
            <button onClick={() => {
              const summary = tutorHistory.find(e => e.type === 'summary')
              if (summary) {
                setTutorHistory([summary])
              } else if (material) {
                startExplanation(material, targetLanguage)
              }
            }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.primary, cursor: 'pointer', fontSize: 13 }}>
              Back to overview
            </button>
          )}
        </div>

        <div ref={historyScrollRef} style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {tutorHistory.length === 0 ? (
            <div style={{ color: C.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 40 }}>
              {appState === 'idle' ? 'Upload and translate a document first.' : 'Explanation will appear here after translation...'}
            </div>
          ) : (
            tutorHistory.map((entry, i) => {
              if (entry.type === 'summary') return (
                <div key={i} style={{ padding: 16 }}>
                  {isStreaming && !entry.content ? <SkeletonLines /> : renderMarkdown(entry.content)}
                  {entry.isStreaming && entry.content && <span style={{ borderRight: `2px solid ${C.primary}`, animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
                </div>
              )
              if (entry.type === 'question') return (
                <div key={i} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.textPrimary, fontWeight: 500, margin: '8px 0' }}>
                  {entry.content}
                </div>
              )
              if (entry.type === 'answer') return (
                <div key={i} style={{ background: C.surfaceAlt, borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.textPrimary, lineHeight: 1.7, margin: '8px 0' }}>
                  {entry.isStreaming && !entry.content ? <SkeletonLines /> : renderMarkdown(entry.content)}
                  {entry.isStreaming && entry.content && <span style={{ borderRight: `2px solid ${C.primary}`, animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
                </div>
              )
              return null
            })
          )}
        </div>

        {!isStreaming && suggestedQs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, flexShrink: 0 }}>
            {suggestedQs.map((q, i) => (
              <button key={i} onClick={() => handleAsk(q, null)}
                style={{ border: `1px solid ${C.border}`, borderRadius: 20, padding: '6px 14px', fontSize: 13, cursor: 'pointer', background: C.surface, color: C.textPrimary }}
                onMouseEnter={e => e.currentTarget.style.background = C.hover}
                onMouseLeave={e => e.currentTarget.style.background = C.surface}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div style={{ height: 52, borderRadius: 26, border: `1px solid ${C.border}`, background: C.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
          <Search size={16} color={C.textSecondary} />
          <input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAsk(searchQuery, null) }}
            placeholder="Ask anything about this material..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: C.textPrimary, background: 'transparent' }} />
          <button onClick={() => handleAsk(searchQuery, null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <ArrowRight size={18} color={C.primary} />
          </button>
        </div>
      </div>
    )
  }
// -- Section --
  const panelTabs = [
    ['upload', 'Source', FileText],
    ['translate', 'Translation', Languages],
    ['explain', 'Tutor', Sparkles],
  ]

  const toast = pdfToast && (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: pdfToast.ok ? '#1e7e34' : '#c62828',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 600, zIndex: 9999,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
    }}>
      {pdfToast.msg}
    </div>
  )

  if (isCompact) {
    return (
      <div style={{ position: 'relative', display: 'grid', gap: 10, minHeight: 'calc(100dvh - 116px)', background: C.surfaceAlt, borderRadius: 12, padding: 10, boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, position: 'sticky', top: 0, zIndex: 5, background: C.surfaceAlt, paddingBottom: 2 }}>
          {panelTabs.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMainPanel(key)}
              style={{
                minHeight: 42,
                borderRadius: 10,
                border: `1px solid ${mainPanel === key ? C.primary : C.border}`,
                background: mainPanel === key ? C.primaryLight : C.surface,
                color: mainPanel === key ? C.primary : C.textSecondary,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 6px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, minHeight: 'calc(100dvh - 174px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {mainPanel === 'upload' && renderUploadPanel()}
          {mainPanel === 'translate' && renderTranslatePanel()}
          {mainPanel === 'explain' && renderExplainPanel()}
        </div>
        {toast}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateAreas: '"topLeft main" "bottomLeft main"', height: '100%', minHeight: 0, overflow: 'hidden', gap: 10, padding: 12, boxSizing: 'border-box', background: C.surfaceAlt }}>
      {/* Upload panel */}
      <div style={panelContainerStyle('upload')} onClick={gridAreaFor('upload') !== 'main' ? () => setMainPanel('upload') : undefined}>
        {renderUploadPanel()}
      </div>

      {/* Translate panel */}
      <div style={panelContainerStyle('translate')} onClick={gridAreaFor('translate') !== 'main' ? () => setMainPanel('translate') : undefined}>
        {renderTranslatePanel()}
      </div>

      {/* AI Tutor panel */}
      <div style={panelContainerStyle('explain')} onClick={gridAreaFor('explain') !== 'main' ? () => { setMainPanel('explain'); setTimeout(() => searchInputRef.current?.focus(), 450) } : undefined}>
        {renderExplainPanel()}
      </div>

      {toast}
    </div>
  )
}

