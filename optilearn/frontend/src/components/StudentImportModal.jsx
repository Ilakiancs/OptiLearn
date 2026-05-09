import { useState } from 'react'
import { importStudentArchive } from '../api/client'

export default function StudentImportModal({ students = [], onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [pin, setPin] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!file) return setError('Choose a file to import')
    if (!pin) return setError('Enter the student PIN')
    setError(null)
    setBusy(true)
    try {
      const res = await importStudentArchive({ file, pin, targetStudentId: target || null })
      setBusy(false)
      onImported && onImported(res)
      onClose && onClose()
    } catch (err) {
      setBusy(false)
      setError(err.message || String(err))
    }
  }

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Import Student Profile</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <input placeholder="Student PIN (4 digits)" value={pin} onChange={(e) => setPin(e.target.value)} />
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Create new student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.username}</option>
            ))}
          </select>
          {error && <div style={{ color: '#FF9800' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button onClick={submit} className="primary" disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
