const BASE = window.location.origin

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.detail || body.message || message
    } catch (_) {}
    throw new Error(message)
  }
  return res.json()
}

export function createStudent({ name, age, language, grade_level }) {
  return request('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, age, language, grade_level }),
  })
}

export function listStudents() {
  return request('/api/students')
}

export function getStudent(studentId) {
  return request(`/api/students/${studentId}`)
}

export function startSession(studentId) {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  })
}

export function uploadImage(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/api/upload-image', { method: 'POST', body: form })
}

export function submitQuiz({ student_id, session_id, topic, answers }) {
  return request('/api/quiz/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id, session_id, topic, answers }),
  })
}

export function getDashboard() {
  return request('/api/dashboard')
}

export function getTeacherStudents() {
  return request('/api/teacher/students')
}

export function getTeacherHeatmap() {
  return request('/api/teacher/heatmap')
}

export function getTeacherAlerts() {
  return request('/api/teacher/alerts')
}

export function getStudentProgress(studentId) {
  return request(`/api/students/${studentId}/progress`)
}

export function getHealth() {
  return request('/api/health')
}

export function uploadMaterial({ file, title, subject }) {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  if (subject) form.append('subject', subject)
  return request('/api/materials/upload', { method: 'POST', body: form })
}

export function listMaterials() {
  return request('/api/materials')
}

export function createTeacherQuiz(body) {
  return request('/api/teacher/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listTeacherQuizzes() {
  return request('/api/teacher/quiz')
}

export function downloadWeeklyReport(week) {
  const url = `${window.location.origin}/api/teacher/report${week ? `?week=${week}` : ''}`
  window.open(url, '_blank')
}

export function getSubjects() {
  return request('/api/materials/subjects')
}

export function getMaterialsBySubject(subject) {
  return request(`/api/materials?subject=${encodeURIComponent(subject)}`)
}

export function getMaterialFileUrl(materialId) {
  return `${BASE}/api/materials/${materialId}/file`
}

export function getQuizzesBySubject(subject, studentId) {
  return request(`/api/teacher/quiz?subject=${encodeURIComponent(subject)}&student_id=${encodeURIComponent(studentId)}`)
}

// ── SSE streaming helper ────────────────────────────────────────
export async function streamSSE(url, body, onEvent, onDone) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try { const b = await response.json(); message = b.detail || b.message || message } catch (_) {}
    throw new Error(message)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) { if (!completed) onDone?.(); break }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6))
          onEvent(event)
          if (event.type === 'done') {
            completed = true
            onDone?.()
            await reader.cancel()
            return
          }
        } catch (_) {}
      }
    }
  }
}

// ── Feature 1 — Language-Adaptive AI Tutor ─────────────────────
export const feature1 = {
  getLanguages() {
    return request('/api/feature1/languages')
  },
  upload(formData) {
    return fetch(`${BASE}/api/feature1/upload`, { method: 'POST', body: formData })
      .then(async res => {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`
          try { const b = await res.json(); msg = b.detail || b.message || msg } catch (_) {}
          throw new Error(msg)
        }
        return res.json()
      })
  },
  translateStream(body, onEvent, onDone) {
    return streamSSE(`${BASE}/api/feature1/translate`, body, onEvent, onDone)
  },
  explainStream(body, onEvent, onDone) {
    return streamSSE(`${BASE}/api/feature1/explain`, body, onEvent, onDone)
  },
  askStream(body, onEvent, onDone) {
    return streamSSE(`${BASE}/api/feature1/ask`, body, onEvent, onDone)
  },
  ask(body) {
    return request('/api/feature1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, format: 'json' }),
    })
  },
}
