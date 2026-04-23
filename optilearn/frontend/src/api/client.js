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
