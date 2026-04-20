# CLAUDE CODE — OptiLearn LMS Build Session

## YOUR FIRST TASK: READ BEFORE WRITING A SINGLE LINE OF CODE

You are building the LMS layer of OptiLearn. Before touching anything, complete
these four reading steps in order. Do not skip any of them.

---

### STEP 1 — Read CLAUDE.md in full

Open CLAUDE.md at the repo root. Read it completely. Understand:
- What OptiLearn is (offline AI tutor for refugee classrooms)
- All 7 features and their exact specs
- The full API route list
- The complete DB schema (8 tables)
- The tech stack and why each choice was made
- The prize tracks and what they require

Do not proceed until you can answer: "What does Feature 2 do and what routes does it need?"

---

### STEP 2 — Audit the entire existing repo

Run this and read every file that isn't in .claudeignore:

```bash
find . -type f \
  ! -path "*/.bmad/*" ! -path "*/.agent/*" ! -path "*/.claude/*" \
  ! -path "*/.cursor/*" ! -path "*/.github/skills/*" \
  ! -path "*/node_modules/*" ! -path "*/__pycache__/*" \
  ! -path "*/dist/*" ! -path "*/.git/*" \
  | sort
```

Read every Python file under polytutor/app/ — main.py, all routes, all services,
all tools, schemas, config. Read every JSX/JS file under polytutor/frontend/src/.
Read requirements.txt, .env.example, Modelfile, setup.sh, start.sh.

For each file you read, internally note:
- What it does
- What's working correctly
- What's broken, incomplete, or misnamed
- What's missing that CLAUDE.md requires

Do not proceed until you have a clear picture of what exists and what doesn't.

---

### STEP 3 — Identify the gaps

After reading everything, produce a written gap analysis in this exact format
(print it so I can see it before you write any code):

```
=== GAP ANALYSIS ===

NAMING ISSUES:
- [list every file/string/variable still saying polytutor, PolyTutor, gemma3, gemma-3]

DATABASE GAPS:
- [list which of the 8 required tables are missing from db.py]

BACKEND GAPS:
- [list every route from CLAUDE.md's API table that has no implementation]
- [list every service file that CLAUDE.md requires but doesn't exist]

FRONTEND GAPS:
- [list every screen/component from CLAUDE.md that has no implementation]

LMS FEATURE GAPS (what this session will build):
- Teacher dashboard: [what exists vs what's needed]
- Material upload: [what exists vs what's needed]
- Quiz builder: [what exists vs what's needed]
- Student roster: [what exists vs what's needed]
- Progress reports: [what exists vs what's needed]

OPTILEARN AI FEATURE GAPS (NOT building today — just flag):
- whisper_client.py: [exists/missing]
- tts_client.py: [exists/missing]
- live translation routes: [exists/missing]
- note_generator.py: [exists/missing]

=== END GAP ANALYSIS ===
```

Print this. Wait for me to confirm it looks correct before proceeding.

---

### STEP 4 — Ask your clarifying questions

After printing the gap analysis, ask me every question you have. Do not assume.
Ask about anything ambiguous. Examples of things you should ask if unclear:

- "The Modelfile still references gemma3. Should I fix this now or leave it?"
- "The existing dashboard.py has X — should I extend it or replace it?"
- "Should the teacher quiz builder let teachers assign quizzes to individual students or only 'all'?"
- "For material upload, should I extract text from PDFs now (PyMuPDF) or stub it with a placeholder?"
- "Should the student progress report stream via SSE or return JSON?"
- "Should I rename the polytutor/ directory to optilearn/ now, or keep the directory name and just update internal references?"

List ALL your questions at once. I will answer them all. Then you build.

---

## WHAT YOU ARE BUILDING THIS SESSION: LMS FEATURES ONLY

Your scope is strictly these features. Do not touch whisper, TTS, live
translation, or the AI agent tools (those are Phase 4–6 in CLAUDE.md).

### LMS Feature 1 — Teacher Dashboard (backend + frontend)

Backend routes to implement (add to routes/dashboard.py):

| Method | Route | Returns |
|---|---|---|
| GET | /api/teacher/students | list all students, mastery avg, last_active, level badge, alert flags |
| GET | /api/teacher/heatmap | {topics[], students[], grid[][]} mastery grid |
| GET | /api/teacher/alerts | students matching alert conditions |
| GET | /api/teacher/report | PDF weekly class report (?week=YYYY-WW) |

Alert logic (implement exactly):
- `inactive_3_days`: last_active < now - 3 days
- `stuck_on_topic`: same topic mastery < 0.40 for last 3 quiz_results
- `level_dropped`: level changed downward in last topic_mastery update

Heatmap grid: rows = students, cols = topics, cells = mastery float.
Include color metadata in API response (frontend renders the color):
- 0.0–0.39 → `"red"` (#E24B4A) — struggling
- 0.40–0.74 → `"amber"` (#EF9F27) — progressing
- 0.75–1.0 → `"green"` (#639922) — mastered
- null → `"grey"` (#AAAAAA) — not attempted

PDF report: use reportlab. Add `reportlab>=4.2.2` to requirements.txt if missing.

Frontend — TeacherDashboard.jsx already exists. Extend it with:
- Student roster grid: name, level badge, mastery avg, last active, alert icon
- Mastery heatmap component (TopicHeatmap.jsx exists — wire it to /api/teacher/heatmap)
- Alerts panel: flagged students with one-line explanation
- "Download Weekly Report" button → GET /api/teacher/report → PDF download
- React Query `refetchInterval: 10000` (10 seconds — live classroom updates)
- Sort order: flagged students float to top

---

### LMS Feature 2 — Material Upload

Backend (add to routes/dashboard.py):

| Method | Route | Action |
|---|---|---|
| POST | /api/materials/upload | multipart: file + title + subject |
| GET | /api/materials | list all materials |

Upload flow:
1. Save file to `data/materials/{uuid}_{filename}`
2. If PDF: use PyMuPDF to extract text per page
3. Chunk text (~200 words, 50-word overlap), embed with MiniLM, add to FAISS
4. Insert into materials table with `faiss_indexed=1`
5. Return `{id, title, subject, passage_count}`

Add to requirements.txt if missing: `PyMuPDF>=1.24.0`

Materials table (add to db.py if missing):
```sql
CREATE TABLE IF NOT EXISTS materials (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    title         TEXT NOT NULL,
    subject       TEXT,
    file_path     TEXT NOT NULL,
    uploaded_by   TEXT,
    faiss_indexed INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);
```

FAISS integration note: call `faiss_store.add_passages()` after extraction.
This makes teacher-uploaded content immediately available to the AI tutor's
`curriculum_retrieval` tool. This is the integration bridge — get it right.

Frontend (add to TeacherDashboard.jsx):
- "Upload Material" button → file picker (PDF, image, txt)
- Title + Subject text inputs
- Upload progress indicator
- Materials list: title, subject, passage count, upload date
- Drag-and-drop support

---

### LMS Feature 3 — Teacher Quiz Builder

Backend (add to routes/quiz.py or new routes/teacher_quiz.py):

| Method | Route | Action |
|---|---|---|
| POST | /api/teacher/quiz | Create quiz |
| GET | /api/teacher/quiz | List all teacher quizzes |
| GET | /api/teacher/quiz/{id} | Single quiz with full questions |

Request body for POST:
```json
{
  "title": "string",
  "subject": "string",
  "questions": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A",
      "explanation": "string"
    }
  ],
  "assigned_to": "all | {student_id}"
}
```

Teacher_quizzes table (add to db.py if missing):
```sql
CREATE TABLE IF NOT EXISTS teacher_quizzes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    title       TEXT NOT NULL,
    subject     TEXT,
    questions   TEXT NOT NULL,
    assigned_to TEXT DEFAULT 'all',
    created_at  TEXT DEFAULT (datetime('now'))
);
```

Integration hook: when a student's quiz session starts, `/api/quiz/generate`
must also check `teacher_quizzes` for quizzes assigned to this `student_id`
or `'all'`. Merge teacher quizzes with AI-generated ones. Teacher quizzes
take priority and appear first.

Frontend:
- Quiz builder form: title, subject, assigned_to dropdown (All / per student)
- Per-question form: question text, 4 option inputs, mark-correct toggle, explanation
- "Add Question" button — builds question list dynamically
- Preview pane showing how quiz will render in student view
- Save → POST /api/teacher/quiz
- Quiz list: title, subject, question count, assigned_to, created date
- **CRITICAL**: trauma-aware language throughout — never "wrong answer", "incorrect", "failed". Use "Let's look at this again" everywhere.

---

### LMS Feature 4 — Student Progress View

Backend (add to routes/students.py):

| Method | Route | Returns |
|---|---|---|
| GET | /api/students/{id}/progress | mastery_by_topic, recent_quizzes, sessions, level, last_active |
| GET | /api/students/{id}/report | SSE stream — AI-generated progress report |

Progress report SSE — use this prompt exactly:
```
Generate a 3-paragraph progress report for teacher use.
Be specific: what the student has mastered, what they struggle with,
one concrete recommendation for tomorrow's lesson.
Student: {name}, age {age}, grade {grade_level}, language {language}
Mastery: {topic_mastery_dict}
Recent quizzes: {last_10_results}
```

Stream via SSE using the existing `model_client` — do not rewrite it.

Frontend:
- Per-student page reachable by clicking a student name in the teacher roster
- Mastery breakdown: per-topic bars colored red/amber/green
- Session history: list with message count, topics_covered
- Quiz score timeline: sparkline of last 10 quiz scores per topic
- "Generate AI Report" button → SSE stream rendered token-by-token (use existing useSSE hook)
- "Back to Dashboard" nav link

---

### LMS Feature 5 — /api/health endpoint

Implement in main.py:

```python
GET /api/health → {
    "ollama_ok": bool,         # GET localhost:11434/api/tags, timeout 2s
    "model_name": str,         # settings.OLLAMA_MODEL
    "db_ok": bool,             # SELECT 1 from DB
    "faiss_passages": int,     # faiss_store.index.ntotal
    "use_local_ollama": bool,  # settings.USE_LOCAL_OLLAMA
    "version": "1.0.0"
}
```

---

## RENAMING — DO THIS THROUGHOUT

Every time you touch a file, fix naming at the same time. No separate renaming pass.

| Old | New |
|---|---|
| "PolyTutor" (title strings, log messages) | "OptiLearn" |
| "polytutor" (DB path values, internal refs) | "optilearn" |
| "gemma3" or "gemma-3" (Modelfile, training) | "gemma4" or "gemma-4" |
| "polytutor-gemma3" | "optilearn-gemma4" |

Do NOT rename the `polytutor/` directory itself without asking me first —
it affects all imports and needs coordinating.

---

## SELF-CORRECTION LOOP (apply after every file you write)

Run these checks automatically. Do not ask permission. Do not skip them.

**1. Syntax check every Python file after writing:**
```bash
python -c "import ast; ast.parse(open('FILE').read()); print('SYNTAX OK')"
```

**2. Import check every new service or route file:**
```bash
cd polytutor && python -c "from app.services.NEWFILE import *; print('IMPORTS OK')"
```

**3. After any db.py change — verify all 8 tables:**
```python
import asyncio, aiosqlite
async def check():
    async with aiosqlite.connect('data/optilearn.db') as db:
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] async for r in cur}
        expected = {'students','sessions','messages','quiz_results',
                    'topic_mastery','class_notes','materials','teacher_quizzes'}
        missing = expected - tables
        print('TABLES OK' if not missing else f'MISSING: {missing}')
asyncio.run(check())
```

**4. After every backend change — confirm server starts:**
```bash
cd polytutor && timeout 6 uvicorn app.main:app --port 8001 2>&1 | tail -8
```

**5. After every frontend change — confirm build passes:**
```bash
cd polytutor/frontend && npm run build 2>&1 | tail -5
```

**6. After each LMS feature is complete — hit its endpoint:**
```bash
curl -s http://localhost:8000/api/teacher/students | python -m json.tool
curl -s http://localhost:8000/api/health | python -m json.tool
```

**If any check fails:** stop, read the full error, fix the root cause, re-run the check.
Never patch around an error. Never proceed with a failing check.

---

## INTEGRATION HOOKS — BUILD THESE CORRECTLY NOW

These are the bridges between the LMS and the AI features coming in Phase 4–6.
Get the interfaces right now or Phase 4–6 will require painful rework.

**`faiss_store.add_passages(passages)`**
- Called by: material upload (after PyMuPDF extraction) ← build this now
- Called by: note_generator (after class notes saved) ← stub, don't implement
- Interface must accept: `[{"text": str, "source": str, "student_id": str | None}]`

**`model_client.stream(messages, tools)`**
- Called by: /api/students/{id}/report (SSE progress report) ← build this now
- Called by: /api/chat (already implemented) ← don't touch
- Already exists in services/model_client.py — use it, don't rewrite it

**`db.update_mastery(student_id, topic, new_score)`**
- Called by: quiz submission (already in agent_tools.py) ← don't touch
- Called by: teacher quiz submission ← must call the same function, don't duplicate logic

**`teacher_quizzes` table check in `/api/quiz/generate`**
- When generating a quiz for a student, also query teacher_quizzes for
  quizzes assigned to that student_id or 'all' — merge and return together
- This is the integration point between LMS and AI quiz system

---

## QUESTION AND LOOP PROTOCOL

After printing the gap analysis, follow this loop:

**Round 1 — Questions**
Ask all your questions at once as a numbered list.
Wait for my answers before writing any code.

**Round 2 — Before each feature**
State in one sentence what you're about to build and what files you'll touch.
Wait for a "go ahead" or correction before starting.

**Round 3 — After each feature**
Print this summary:
```
FEATURE COMPLETE: [name]
Files changed: [list]
Verification result: [output of curl or check command]
Issues noticed: [anything that needs attention, or "none"]
Ready to move to: [next feature name]?
```

**End of session**
Print this:
```
=== SESSION COMPLETE ===
Built: [list of completed features]
Remaining gaps from CLAUDE.md: [honest list of what's still missing]
build_state.txt updated: [yes/no]
Next session should start with: [Phase X — description]
=== END ===
```

---

## DO NOT BUILD THESE TODAY

Out of scope for this session. Flag gaps but do not implement:

- `whisper_client.py` — live transcription (Phase 2 in CLAUDE.md)
- `tts_client.py` — text to speech (Phase 3 in CLAUDE.md)
- `/api/translate/*` routes — live class translation (Phase 4)
- `note_generator.py` — end-of-class notes (Phase 5)
- `LiveTranslator.jsx` — frontend screen (Phase 6)
- Training pipeline changes — flag the Gemma 3 → 4 issue, do not touch
- PWA service worker changes

---

## NOW BEGIN

Read CLAUDE.md. Read the repo. Print the gap analysis. Ask your questions.
