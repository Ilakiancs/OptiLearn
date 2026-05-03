import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSubjects } from '../api/client'

export default function SubjectComboInput({ value, onChange, required, error }) {
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: getSubjects })
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState(value || '')
  const [pendingSubject, setPendingSubject] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setFilter(value || '')
    if (value) setPendingSubject('')
  }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const trimmed = filter.trim()
  const committed = String(value || '').trim()
  const filtered = subjects.filter(s => s.toLowerCase().includes(filter.toLowerCase()))
  const matchesExisting = !!trimmed && subjects.some(s => s.toLowerCase() === trimmed.toLowerCase())
  const isCommitted = !!trimmed && trimmed.toLowerCase() === committed.toLowerCase()
  const showAddPrompt = !!trimmed && !matchesExisting && !isCommitted
  const awaitingConfirm = showAddPrompt && pendingSubject.toLowerCase() === trimmed.toLowerCase()

  function select(val) {
    const clean = String(val || '').trim()
    onChange(clean)
    setFilter(clean)
    setPendingSubject('')
    setOpen(false)
  }

  function requestAdd(e) {
    e?.preventDefault()
    e?.stopPropagation()
    if (!trimmed) return
    setPendingSubject(trimmed)
    setOpen(false)
  }

  function confirmNew(e) {
    e?.preventDefault()
    e?.stopPropagation()
    const clean = (pendingSubject || trimmed).trim()
    if (clean) select(clean)
  }

  function cancelNew(e) {
    e?.preventDefault()
    e?.stopPropagation()
    setPendingSubject('')
    inputRef.current?.focus()
  }

  function handleDraftChange(next) {
    setFilter(next)
    setOpen(true)

    const clean = next.trim()
    if (pendingSubject && clean.toLowerCase() !== pendingSubject.toLowerCase()) {
      setPendingSubject('')
    }

    if (!clean) {
      onChange('')
      return
    }

    if (committed && clean.toLowerCase() !== committed.toLowerCase()) {
      onChange('')
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
    border: `1px solid ${error ? '#dc2626' : 'var(--color-border)'}`,
    background: 'var(--color-surface)', color: 'var(--color-text)',
    fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={filter}
        onChange={e => handleDraftChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (awaitingConfirm) confirmNew(e)
            else if (showAddPrompt) requestAdd(e)
            else if (filtered.length > 0) select(filtered[0])
          }
          if (e.key === 'Escape') {
            setPendingSubject('')
            setOpen(false)
          }
        }}
        placeholder="e.g. Mathematics"
        aria-required={required ? 'true' : undefined}
        style={inputStyle}
        autoComplete="off"
      />

      {error && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 4 }}>{error}</div>}

      {open && filtered.length > 0 && (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          marginTop: 4, maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => { e.preventDefault(); select(s) }}
              style={{
                width: '100%', textAlign: 'left', border: 'none',
                padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem',
                background: s === value ? 'var(--color-surface-2)' : 'transparent',
                color: 'var(--color-text)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = s === value ? 'var(--color-surface-2)' : 'transparent'}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {showAddPrompt && (
        <div style={{
          marginTop: 6, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          borderRadius: 10, padding: '8px 10px', fontSize: '0.82rem', color: 'var(--color-text)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          flexWrap: 'wrap',
        }}>
          <span>
            {awaitingConfirm
              ? `Confirm adding "${pendingSubject}" as a subject?`
              : `Add "${trimmed}" as a new subject?`}
          </span>
          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
            {awaitingConfirm && (
              <button
                type="button"
                onMouseDown={cancelNew}
                onClick={cancelNew}
                style={{
                  background: 'transparent', color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  padding: '4px 10px', fontSize: '0.8rem', fontWeight: 600,
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onMouseDown={awaitingConfirm ? confirmNew : requestAdd}
              onClick={awaitingConfirm ? confirmNew : requestAdd}
              style={{
                background: 'var(--color-primary)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '4px 10px', fontSize: '0.8rem',
                fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}
            >
              {awaitingConfirm ? 'Confirm' : 'Add'}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
