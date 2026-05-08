const BASE = window.location.origin

function authHeaders(headers = {}) {
  const token = localStorage.getItem('teacher_token')
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.detail || body.message || message
    } catch (_) {}
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function requestBlob(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.detail || body.message || message
    } catch (_) {}
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  return res.blob()
}

export function createStudent({ name, age, language, grade_level }) {
  return request('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, age, language, grade_level }),
  })
}

export function getSetupRequired() {
  return request('/api/auth/setup-required')
}

export function setupAdmin(body) {
  return request('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function loginTeacher(body) {
  return request('/api/auth/teacher/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function logoutTeacher() {
  return request('/api/auth/teacher/logout', { method: 'POST' })
}

export function getTeacherMe() {
  return request('/api/auth/teacher/me')
}

export function changeTeacherPassword(body) {
  return request('/api/auth/teacher/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function signupStudent(body) {
  return request('/api/auth/student/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function loginStudent(body) {
  return request('/api/auth/student/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function checkStudentUsername(username) {
  return request(`/api/auth/student/username-available?username=${encodeURIComponent(username)}`)
}

export function listAdminTeachers() {
  return request('/api/auth/admin/teachers')
}

export function createAdminTeacher(body) {
  return request('/api/auth/admin/teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateAdminTeacher(teacherId, body) {
  return request(`/api/auth/admin/teachers/${encodeURIComponent(teacherId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function resetAdminTeacherPassword(teacherId, newPassword) {
  return request(`/api/auth/admin/teachers/${encodeURIComponent(teacherId)}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export function deactivateAdminTeacher(teacherId) {
  return request(`/api/auth/admin/teachers/${encodeURIComponent(teacherId)}`, { method: 'DELETE' })
}

export function listAdminStudents() {
  return request('/api/auth/admin/students')
}

export function resetAdminStudentPin(studentId, newPin) {
  return request(`/api/auth/admin/students/${encodeURIComponent(studentId)}/reset-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_pin: newPin }),
  })
}

export function createAdminStudent(body) {
  return request('/api/auth/admin/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function changeStudentPin(body) {
  return request('/api/auth/student/change-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export function getChatSessions(studentId) {
  return request(`/api/sessions/student/${encodeURIComponent(studentId)}/chats`)
}

export function getSessionMessages(sessionId, studentId) {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}/messages?student_id=${encodeURIComponent(studentId)}`)
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

export function getPerformanceDiagnostics(limit = 100) {
  return request(`/api/diagnostics/performance?limit=${encodeURIComponent(limit)}`)
}

export function getJob(jobId) {
  return request(`/api/jobs/${encodeURIComponent(jobId)}`)
}

export function getNetworkStatus() {
  return request('/api/network/status')
}

export function refreshNetworkStatus() {
  return request('/api/network/refresh')
}

export function getNetworkQrUrl(cacheKey = '') {
  const suffix = cacheKey ? `?t=${encodeURIComponent(cacheKey)}` : ''
  return `${BASE}/api/network/qr.png${suffix}`
}

export function getNetworkQrData(cacheKey = '') {
  const suffix = cacheKey ? `?t=${encodeURIComponent(cacheKey)}` : ''
  return request(`/api/network/qr-data${suffix}`)
}

export function getNetworkMode() {
  return request('/api/settings/network-mode')
}

export function setNetworkMode(mode) {
  return request('/api/settings/network-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
}

export function uploadMaterial({ file, title, subject }) {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  if (subject) form.append('subject', subject)
  return request('/api/materials/upload', { method: 'POST', body: form })
}

export function listMaterials() {
  return request('/api/materials?teacher_only=true')
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

export function listStudentQuizzes(studentId) {
  return request(`/api/student/quiz?student_id=${encodeURIComponent(studentId)}`)
}

export async function downloadWeeklyReport(week) {
  const path = `/api/teacher/report${week ? `?week=${week}` : ''}`
  const blob = await requestBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `OptiLearn_Report_${week || 'current'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function getSubjects() {
  return request('/api/materials/subjects')
}

export function getMaterialsBySubject(subject) {
  return request(`/api/materials?subject=${encodeURIComponent(subject)}&teacher_only=true`)
}

export function getMaterialFileUrl(materialId) {
  return `${BASE}/api/materials/${materialId}/file`
}

export function getQuizzesBySubject(subject, studentId) {
  return request(`/api/student/quiz?subject=${encodeURIComponent(subject)}&student_id=${encodeURIComponent(studentId)}`)
}

// ── Schedule ────────────────────────────────────────────────────
export function getTeacherSchedule() {
  return request('/api/teacher/schedule')
}
export function createScheduledClass(body) {
  return request('/api/teacher/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
export function updateScheduledClass(id, body) {
  return request(`/api/teacher/schedule/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
export function deleteScheduledClass(id) {
  return request(`/api/teacher/schedule/${id}`, { method: 'DELETE' })
}
export function getStudentSchedule() {
  return request('/api/student/schedule')
}

// ── Teacher settings ─────────────────────────────────────────────
export function getTeacherSettings() {
  return request('/api/teacher/settings')
}
export function updateTeacherSettings(body) {
  return request('/api/teacher/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

// ── SSE streaming helper ────────────────────────────────────────
export async function streamSSE(url, body, onEvent, onDone) {
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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
  let firstTokenDelivered = false
  let tokenBatch = null
  let flushScheduled = false
  const scheduleFlush = () => {
    if (flushScheduled) return
    flushScheduled = true
    const run = () => {
      flushScheduled = false
      if (tokenBatch) {
        onEvent(tokenBatch)
        tokenBatch = null
      }
    }
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(run)
    } else {
      setTimeout(run, 32)
    }
  }
  const flushTokens = () => {
    if (!tokenBatch) return
    const batch = tokenBatch
    tokenBatch = null
    flushScheduled = false
    onEvent(batch)
  }
  const handleEvent = (event) => {
    if (event.type === 'token' && typeof event.content === 'string') {
      if (!firstTokenDelivered) {
        firstTokenDelivered = true
        onEvent(event)
        return
      }
      const samePage = (tokenBatch?.page ?? null) === (event.page ?? null)
      if (tokenBatch && samePage) {
        tokenBatch = { ...tokenBatch, content: `${tokenBatch.content || ''}${event.content || ''}` }
      } else {
        flushTokens()
        tokenBatch = { ...event }
      }
      scheduleFlush()
      return
    }
    flushTokens()
    onEvent(event)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) { flushTokens(); if (!completed) onDone?.(); break }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'model_switch') {
            window.dispatchEvent(new CustomEvent('optilearn:model-switch', { detail: event }))
          }
          handleEvent(event)
          if (event.type === 'done') {
            flushTokens()
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

export function teacherChat(body, onEvent, onDone) {
  return streamSSE(`${BASE}/api/teacher/chat`, body, onEvent, onDone)
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
  getSessions(studentId) {
    return request(`/api/feature1/sessions/${encodeURIComponent(studentId)}`)
  },
  getSession(studentId, materialId) {
    return request(`/api/feature1/sessions/${encodeURIComponent(studentId)}/${encodeURIComponent(materialId)}`)
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

// ── Live Quiz (Kahoot-style) ─────────────────────────────────
export function createLiveGame(quizId) {
  return request('/api/live-quiz/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz_id: quizId }),
  })
}

export function getLiveGameState(gameId) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}`)
}

export function joinLiveGame(gameId, nickname) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
}

export function submitLiveAnswer(gameId, participantId, choiceIndex) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_id: participantId, choice_index: choiceIndex }),
  })
}

export function nextLiveQuestion(gameId) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/next`, { method: 'POST' })
}

export function revealLiveAnswer(gameId) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/reveal`, { method: 'POST' })
}

export function endLiveGame(gameId) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/end`, { method: 'POST' })
}

export function getLiveGameResults(gameId) {
  return request(`/api/live-quiz/games/${encodeURIComponent(gameId)}/results`)
}

export function findGameByCode(joinCode) {
  return request(`/api/live-quiz/find/${encodeURIComponent(joinCode.replace(/\s/g, ''))}`)
}
