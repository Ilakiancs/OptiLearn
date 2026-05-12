import { useEffect, useState } from 'react'
import { ArrowSquareOut, X } from '@phosphor-icons/react'
import { getMaterialFileUrl } from '../api/client'

function fileExt(path) {
  return (path || '').split('.').pop().toLowerCase()
}

function fileLabel(path) {
  const ext = fileExt(path)
  if (ext === 'pdf') return { label: 'PDF', bg: '#21103a', color: '#a78bfa', border: '#7c3aed' }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { label: 'Image', bg: '#061e2e', color: '#67e8f9', border: '#0891b2' }
  return { label: 'Text', bg: '#0a2a18', color: '#86efac', border: '#16a34a' }
}

function TypeBadge({ path }) {
  const { label, bg, color, border } = fileLabel(path)
  return (
    <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.7rem', fontWeight: 700, background: bg, color, border: `1px solid ${border}`, flexShrink: 0 }}>
      {label}
    </span>
  )
}

export default function MaterialViewer({ material, onClose }) {
  const [txt, setTxt] = useState(null)
  const url = getMaterialFileUrl(material.id)
  const ext = fileExt(material.file_path)
  const isPdf = ext === 'pdf'
  const isImg = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
  const isTxt = ext === 'txt'

  useEffect(() => {
    let active = true
    setTxt(null)
    if (!isTxt) return () => { active = false }
    fetch(url)
      .then((r) => r.text())
      .then((text) => { if (active) setTxt(text) })
      .catch(() => { if (active) setTxt('This file could not be loaded.') })
    return () => { active = false }
  }, [isTxt, url])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38 }}>
          <X size={14} />
          <span>Close</span>
        </button>
        <span style={{ fontWeight: 700, flex: '1 1 180px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{material.title}</span>
        <TypeBadge path={material.file_path} />
        <a href={url} target="_blank" rel="noreferrer" style={{ padding: '6px 10px', minHeight: 38, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowSquareOut size={14} />
          <span>Open</span>
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isPdf && <iframe src={url} style={{ width: '100%', height: '100%', border: 'none' }} title={material.title} />}
        {isImg && (
          <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24 }}>
            <img src={url} alt={material.title} style={{ maxWidth: '100%', borderRadius: 'var(--radius-lg)' }} />
          </div>
        )}
        {isTxt && (
          <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.95rem', lineHeight: 1.7, maxWidth: 760, margin: '0 auto', color: 'var(--color-text)' }}>{txt ?? 'Loading...'}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
