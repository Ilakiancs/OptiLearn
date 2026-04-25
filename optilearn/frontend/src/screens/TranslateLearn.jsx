import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  BookOpen, Globe, Languages, Sparkles, Search, ArrowRight,
  ChevronLeft, ChevronRight, Maximize2, Zap, Loader2, CheckCircle2,
  Upload, FileText, RotateCcw, AlertCircle, Volume2, StopCircle, Download,
} from 'lucide-react'
import { feature1 } from '../api/client'
// -- Section --
const C = {
  primary: '#1a73e8',
  primaryLight: '#e8f0fe',
  surface: '#ffffff',
  surfaceAlt: '#f8f9fa',
  border: '#dadce0',
  textPrimary: '#202124',
  textSecondary: '#5f6368',
  accentGreen: '#639922',
  hover: '#f1f3f4',
  danger: '#d93025',
}
// -- Section --
function renderMarkdown(text, opts = {}) {
  if (!text) return null
  const { fontSize = 15, headingSize = 18 } = opts
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## '))
      return <div key={i} style={{ fontSize: headingSize, fontWeight: 700, paddingBottom: 8, borderBottom: `1px solid ${C.border}`, marginTop: 24, marginBottom: 8, color: C.textPrimary }}>{line.slice(3)}</div>
    if (line.startsWith('- ') || line.startsWith('* '))
      return <div key={i} style={{ marginLeft: 24, lineHeight: 1.7, color: C.textPrimary, display: 'flex', gap: 8, fontSize }}><span>*</span><span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} /></div>
    if (line.trim() === '') return <div key={i} style={{ height: 10 }} />
    return <p key={i} style={{ fontSize, lineHeight: 1.7, color: C.textPrimary, margin: '4px 0' }} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
  })
}

function SkeletonLines() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 0' }}>
      {['100%', '85%', '95%', '60%'].map((w, i) => (
        <div key={i} style={{ height: i % 2 === 0 ? 16 : 12, width: w, background: '#e0e0e0', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite alternate' }} />
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
  const [searchQuery, setSearchQuery]       = useState('')
  const [error, setError]                   = useState(null)
  const [translationProgress, setTranslationProgress] = useState({ current: 0, total: 0 })
  const [modelPreference, setModelPreference]         = useState('fast')
  const [e4bAvailable, setE4bAvailable]               = useState(false)
  const [fileObjectURL, setFileObjectURL]             = useState(null)
  const [fileType, setFileType]                       = useState(null) // "pdf" | "image" | "text"
  const [playingPanel, setPlayingPanel]               = useState(null) // "upload"|"translate"|"explain"|null
  const [isDownloadingPdf, setIsDownloadingPdf]       = useState(false)
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

  useEffect(() => { feature1.getLanguages().then(setLanguages).catch(() => {}) }, [])
  useEffect(() => { if (student?.language) setTargetLanguage(student.language) }, [student])
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setE4bAvailable(!!d.e4b_available)).catch(() => {})
  }, [])
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
    const base = { borderRadius: 12, overflow: 'hidden', position: 'relative', transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)', gridArea: area }
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
      if (fileOrNull) fd.append('file', fileOrNull)
      else fd.append('text_input', pasteText)

      const result = await feature1.upload(fd)
      setMaterial(result)
      setDetectedLang(result.detected_language)
      setAppState('translating')
      await startTranslation(result, targetLanguage)
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.')
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
          } else if (event.type === 'page_complete') {
            if (typeof event.full_text === 'string') {
              hasContent = hasContent || event.full_text.trim().length > 0
              setTranslatedPages(prev => ({ ...prev, [event.page]: event.full_text }))
            }
            setTranslationProgress(prev => ({ ...prev, current: event.page }))
          } else if (event.type === 'error') {
            setError(event.message || 'Translation failed. Check your API key quota and try again.')
          }
        },
        () => {
          if (isCancelledRef.current || activeTranslationRef.current !== run) return
          setIsStreaming(false)
          activeTranslationRef.current = null
          if (hasContent) {
            setAppState('translated')
            setMainPanel('translate')
            startExplanation(mat, lang)
          } else {
            setError(prev => prev || 'Translation returned no content. The input may contain text the AI could not process - please check your input and try again.')
            setAppState('idle')
          }
        }
      )
    } catch (err) {
      if (isCancelledRef.current || activeTranslationRef.current !== run) return
      activeTranslationRef.current = null
      setIsStreaming(false)
      setError(err.message || 'Translation failed.')
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
            setError(event.message || 'Explanation failed.')
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
      setError(err.message || 'Explanation failed.')
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
      setError(err.message || 'Question failed.')
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
  const hasQuestions   = tutorHistory.some(e => e.type === 'question')
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
        body: JSON.stringify({ text: text.slice(0, 3000), language }),
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
      if (!response.ok) { console.error('PDF export failed:', response.status); return }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filenameFromDisposition(response.headers.get('Content-Disposition'))
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) {
      console.error('PDF export error:', e)
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
          {(appState === 'uploading' || appState === 'translating') && <Loader2 size={12} color={C.primary} style={{ animation: 'spin 1s linear infinite' }} />}
          <TTSButton panelName="upload" text={pasteText || material?.preview || ''} language={detectedLang || student?.language || 'en'} small />
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
            <span style={{ fontSize: 11, color: '#aaaaaa' }}>No file uploaded yet</span>
          </div>
        )}
      </div>
    )

    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <BookOpen size={22} color={C.primary} />
          <Globe size={18} color={C.primary} />
          <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>Translate and Learn</span>
          {material && <TTSButton panelName="upload" text={pasteText || material?.preview || ''} language={detectedLang || student?.language || 'en'} />}
          {e4bAvailable && (
            <div style={{ marginLeft: 'auto', display: 'flex', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 20, padding: 3, gap: 2 }}>
              {[{ key: 'fast', label: 'Fast', icon: <Zap size={12} /> }, { key: 'deep', label: 'Deep', icon: <Sparkles size={12} /> }].map(({ key, label, icon }) => (
                <button key={key} onClick={() => setModelPreference(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: modelPreference === key ? C.primary : 'transparent', color: modelPreference === key ? '#fff' : C.textSecondary, transition: 'all 0.15s' }}>
                  {icon}{label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>Translate to:</label>
          <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textPrimary, fontSize: 14, cursor: 'pointer' }}>
            {languages.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
          </select>
        </div>

        {error && (
          <div style={{ display: 'flex', gap: 8, background: '#fce8e6', border: '1px solid #f28b82', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: C.danger, alignItems: 'flex-start' }}>
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
                <Loader2 size={36} color={C.primary} style={{ animation: 'spin 1s linear infinite' }} />
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

        {detectedLang && !error && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 12px', fontSize: 13, marginBottom: 12, color: C.textPrimary }}>
            <CheckCircle2 size={14} color={C.accentGreen} /> Detected: {langName(detectedLang)}
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
        ) : (
          <button onClick={() => setPasteMode(false)} style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer', fontSize: 13 }}>Back to file upload</button>
        )}
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
          {appState === 'translating' && <Loader2 size={12} color={C.primary} style={{ animation: 'spin 1s linear infinite' }} />}
          <TTSButton panelName="translate" text={translatedText} language={targetLanguage} small />
          {translatedText && <button onClick={e => { e.stopPropagation(); downloadTranslation() }} disabled={isDownloadingPdf} title={isDownloadingPdf ? 'Preparing PDF' : 'Save PDF'} style={{ background: 'transparent', border: 'none', cursor: isDownloadingPdf ? 'default' : 'pointer', color: isDownloadingPdf ? C.primary : C.textSecondary, padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0, opacity: isDownloadingPdf ? 0.8 : 1 }}>{isDownloadingPdf ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}</button>}
          <Maximize2 size={12} color={C.textSecondary} style={{ flexShrink: 0 }} />
        </div>
        {translatedText ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 12, color: C.textPrimary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {translatedText}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <span style={{ fontSize: 11, color: '#aaaaaa', textAlign: 'center' }}>
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
          <span style={{ fontSize: 14, color: C.textSecondary }}>{langName(detectedLang || 'en')}</span>
          <ArrowRight size={14} color={C.textSecondary} />
          <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{langName(targetLanguage)}</span>
          {appState === 'translating' && <Loader2 size={15} color={C.primary} style={{ animation: 'spin 1s linear infinite', marginLeft: 8 }} />}
          <TTSButton panelName="translate" text={translatedText} language={targetLanguage} />
          {translatedText && (
            <button onClick={downloadTranslation} disabled={isDownloadingPdf} title={isDownloadingPdf ? 'Preparing PDF' : 'Save PDF'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 10px', fontSize: 13, color: isDownloadingPdf ? C.primary : C.textSecondary, cursor: isDownloadingPdf ? 'default' : 'pointer', opacity: isDownloadingPdf ? 0.8 : 1 }}>
              {isDownloadingPdf ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />} {isDownloadingPdf ? 'Preparing' : 'Save PDF'}
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
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, color: C.textPrimary }}>
              {translatedText}
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
          {anyStreaming && <Loader2 size={12} color={C.primary} style={{ animation: 'spin 1s linear infinite' }} />}
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
                <div key={i} style={{ background: '#ebebeb', borderRadius: 8, padding: '8px 12px', margin: '4px 8px', fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>
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
            <span style={{ fontSize: 11, color: '#aaaaaa', textAlign: 'center' }}>AI Tutor will explain your material here</span>
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
                  {entry.isStreaming && entry.content && <span style={{ borderRight: '2px solid #1a73e8', animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
                </div>
              )
              if (entry.type === 'question') return (
                <div key={i} style={{ background: '#ebebeb', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.textPrimary, fontWeight: 500, margin: '8px 0' }}>
                  {entry.content}
                </div>
              )
              if (entry.type === 'answer') return (
                <div key={i} style={{ background: C.surfaceAlt, borderRadius: 10, padding: '12px 16px', fontSize: 14, color: C.textPrimary, lineHeight: 1.7, margin: '8px 0' }}>
                  {entry.isStreaming && !entry.content ? <SkeletonLines /> : renderMarkdown(entry.content)}
                  {entry.isStreaming && entry.content && <span style={{ borderRight: '2px solid #1a73e8', animation: 'blink 1s step-end infinite' }}>&nbsp;</span>}
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
  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gridTemplateAreas: '"topLeft main" "bottomLeft main"', height: 'calc(100vh - 1px)', gap: 10, padding: 12, boxSizing: 'border-box', background: C.surfaceAlt }}>

      {/* Fixed Reset button - viewport-level, never overlaps panel content */}
      <button onClick={handleReset} title="Start over"
        style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSecondary, fontSize: 13, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        onMouseEnter={e => e.currentTarget.style.background = C.hover}
        onMouseLeave={e => e.currentTarget.style.background = C.surface}>
        <RotateCcw size={14} /> Reset
      </button>

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
    </div>
  )
}

