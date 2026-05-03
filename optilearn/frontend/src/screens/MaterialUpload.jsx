import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadMaterial, listMaterials } from '../api/client'
import { Link } from 'react-router-dom'
import { FileText } from '@phosphor-icons/react'
import SubjectComboInput from '../components/SubjectComboInput'
import Spinner from '../components/Spinner'

const ALLOWED = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.webp']

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  return Math.floor(diff / 86400000) + 'd ago'
}

export default function MaterialUpload() {
  const qc = useQueryClient()
  const fileInputRef = useRef(null)

  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)

  const { data: materials, isLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: listMaterials,
    refetchInterval: 15000,
  })

  const mutation = useMutation({
    mutationFn: uploadMaterial,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['materials'] })
      setSelectedFile(null)
      setTitle('')
      setSubject('')
      setError('')
      setUploadProgress(null)
    },
    onError: (err) => {
      setError(err.message)
      setUploadProgress(null)
    },
  })

  function validateFile(file) {
    if (!file) return 'No file selected.'
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!ALLOWED.includes(ext)) return `File type not supported. Allowed: ${ALLOWED.join(', ')}`
    if (file.size > 50 * 1024 * 1024) return 'File too large — max 50 MB.'
    return null
  }

  function handleFile(file) {
    const err = validateFile(file)
    if (err) { setError(err); return }
    setError('')
    setSelectedFile(file)
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [title])

  function handleSubmit(e) {
    e.preventDefault()
    if (!selectedFile) { setError('Please select a file.'); return }
    if (!title.trim()) { setError('Title is required.'); return }
    if (!subject.trim()) { setError('Subject is required. Choose an existing subject or press Add to confirm a new one.'); return }
    setError('')
    setUploadProgress('Uploading…')
    mutation.mutate({ file: selectedFile, title: title.trim(), subject: subject.trim() || undefined })
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
    color: 'var(--color-text)', fontSize: '1rem', boxSizing: 'border-box',
  }
  const card = {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)', padding: '20px 16px', marginBottom: 24,
  }
  const sectionHead = { fontSize: '1rem', fontWeight: 700, marginBottom: 16, marginTop: 0 }

  return (
    <div className="page-shell">
      <header style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/teacher" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem', minHeight: 44, display: 'inline-flex', alignItems: 'center', paddingRight: 12 }}>
          ← Back to Dashboard
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Upload Teaching Materials</span>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>

        {/* Upload form */}
        <section style={card}>
          <h2 style={sectionHead}>Add New Material</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '32px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'var(--color-surface-2)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {selectedFile ? (
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-primary)' }}>{selectedFile.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{formatSize(selectedFile.size)}</div>
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={30} /></div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>Drag & drop a file here, or click to browse</div>
                  <div style={{ color: 'var(--color-text-hint)', fontSize: '0.8rem', marginTop: 6 }}>PDF, TXT, PNG, JPG, WEBP — max 50 MB</div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED.join(',')}
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = '' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Title *</label>
              <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Grade 3 Fractions Worksheet" required />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>Subject *</label>
              <SubjectComboInput value={subject} onChange={setSubject} required error={error.startsWith('Subject') ? error : ''} />
            </div>

            {error && <p style={{ color: 'var(--color-danger)', margin: 0, fontSize: '0.9rem' }}>{error}</p>}
            {uploadProgress && <p style={{ color: 'var(--color-primary)', margin: 0, fontSize: '0.9rem' }}>{uploadProgress}</p>}
            {mutation.isSuccess && <p style={{ color: 'var(--color-success)', margin: 0, fontSize: '0.9rem' }}>Uploaded and indexed successfully.</p>}

            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                padding: '12px', minHeight: 44,
                background: mutation.isPending ? 'var(--color-primary-dim)' : 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                fontSize: '1rem', fontWeight: 600, cursor: mutation.isPending ? 'default' : 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              {mutation.isPending ? 'Uploading…' : 'Upload Material'}
            </button>
          </form>
        </section>

        {/* Materials list */}
        <section style={card}>
          <h2 style={sectionHead}>Uploaded Materials</h2>
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner /></div>
          ) : !materials?.length ? (
            <p style={{ color: 'var(--color-text-hint)' }}>No materials uploaded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Title', 'Subject', 'Indexed', 'Uploaded'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: i < materials.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{m.title}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>{m.subject || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', fontWeight: 600,
                          background: m.faiss_indexed ? '#14532d' : 'var(--color-surface-2)',
                          color: m.faiss_indexed ? '#4ade80' : 'var(--color-text-muted)',
                        }}>
                          {m.faiss_indexed ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>{relativeTime(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
