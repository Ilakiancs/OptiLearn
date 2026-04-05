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
