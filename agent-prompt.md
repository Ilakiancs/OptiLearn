You are a senior full-stack engineer implementing PolyTutor — an offline-first, multilingual adaptive learning agent built for refugee camp classrooms. You will implement this project incrementally, one verified layer at a time.

Read every instruction carefully before writing a single line of code. Do not skip steps. Do not combine steps. After each step, confirm what was built and what the next step is before proceeding.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCT CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PolyTutor runs on a single teacher's laptop with no internet (in production). A student photographs a textbook page. Gemma (via API now, local Ollama later) reads the image, detects the student's language, retrieves relevant curriculum passages via FAISS, explains the concept in the student's language at their level, generates an adaptive quiz, and records progress to SQLite. The teacher sees all student progress in a real-time dashboard. No data leaves the room in production. During development we use the Gemma API.

The architecture has 5 layers:
  1. Client      — React 18 PWA (Phase 2, not now)
  2. Gateway     — FastAPI + uvicorn, serves API + static frontend
  3. AI core     — model_client.py talking to Gemma API (swappable to Ollama)
  4. Tools       — 4 agent tools executed locally by FastAPI
  5. Storage     — SQLite (WAL mode) + FAISS vector index

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPOSITORY STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create this exact structure. Do not add extra files or folders unless instructed.

polytutor/
├── backend/
│   ├── main.py              # FastAPI app — all routes
│   ├── model_client.py      # Gemma API client (swappable to Ollama)
│   ├── tools.py             # 4 agent tool implementations
│   ├── db.py                # SQLite schema + async helpers
│   └── faiss_store.py       # FAISS index loader + query wrapper
├── frontend/                # Scaffold only in Phase 1 — not implemented yet
│   ├── src/
│   │   ├── screens/
│   │   └── components/
│   ├── public/
│   │   └── manifest.json
│   └── vite.config.js
├── data/
│   ├── build_index.py       # One-time FAISS index builder
│   ├── curriculum/          # Raw .txt files (one topic per file)
│   └── .gitkeep
├── models/                  # GGUF weights go here later (Phase 3)
│   └── .gitkeep
├── .env                     # Never committed — copy from .env.example
├── .env.example             # Committed — all keys with placeholder values
├── .gitignore
├── requirements.txt
├── setup.sh                 # One-shot installer
├── start.sh                 # Start the server
├── stop.sh                  # Stop the server
├── SETUP.md                 # Human-readable setup guide
└── TEST.md                  # curl commands to verify every endpoint

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENVIRONMENT VARIABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write .env.example with these exact keys and placeholder values.
The real .env is created by the user — never generate it with real secrets.

# Model backend — set USE_LOCAL_OLLAMA=true when going offline
USE_LOCAL_OLLAMA=false

# Gemma API (used when USE_LOCAL_OLLAMA=false)
GEMMA_API_KEY=your_google_ai_studio_key_here
GEMMA_MODEL=gemma-2.0-flash-exp

# Ollama (used when USE_LOCAL_OLLAMA=true)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma4:9b

# Language detection
LANGDETECT_CONFIDENCE_THRESHOLD=0.85

# Storage
DB_PATH=./data/polytutor.db
FAISS_INDEX_PATH=./data/curriculum.index
FAISS_META_PATH=./data/curriculum_meta.json
CURRICULUM_DIR=./data/curriculum

# Embeddings
EMBED_MODEL=paraphrase-multilingual-MiniLM-L12-v2

# Image processing
IMAGE_MAX_PX=1024

# Server
HOST=0.0.0.0
PORT=8000
FRONTEND_DIST=./frontend/dist

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIREMENTS.TXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pin every version exactly as listed below. Do not upgrade or substitute.

# Web framework
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.9

# Gemma / Google AI
google-generativeai==0.7.2

# HTTP client (Ollama path)
httpx==0.27.2

# Validation
pydantic==2.8.2
pydantic-settings==2.4.0

# Image processing
Pillow==10.4.0

# Vector store
faiss-cpu==1.8.0

# Embeddings
sentence-transformers==3.1.1
torch==2.4.1
transformers==4.44.2

# Language detection fallback
langdetect==1.0.9

# Database
aiosqlite==0.20.0

# Retry logic
tenacity==9.0.0

# Logging
loguru==0.7.2

# Progress bars (setup scripts)
tqdm==4.66.5

# Utilities
python-dotenv==1.0.1

# Dev / testing
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODING STANDARDS — APPLY TO EVERY FILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Python 3.11+. Type hints on every function signature.
- Use loguru for all logging. Zero print() statements anywhere.
- All DB operations must be async via aiosqlite. Never use synchronous sqlite3 in async paths.
- All model calls go through model_client.py — never call google-generativeai or httpx directly from main.py or tools.py.
- Pydantic v2 models for every request body and response body.
- UUIDs (uuid.uuid4()) for all primary keys.
- Textbook images must be deleted from disk immediately after base64 encoding. Never persist them.
- Every function and class must have a docstring.
- No bare except clauses. Catch specific exception types.
- Load all config from .env via pydantic-settings BaseSettings. No hardcoded strings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1 — IMPLEMENTATION STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implement in this exact order. Verify each step before starting the next.

──────────────────────────────────────
STEP 1 — Project scaffold
──────────────────────────────────────

Create the full directory structure above.
Write .env.example, .gitignore, requirements.txt.

Write setup.sh that does the following in order:
  1. Check Python 3.11+ is installed — exit with clear error if not
  2. Create .venv/ and activate it
  3. pip install -r requirements.txt (show progress)
  4. Copy .env.example to .env if .env does not already exist
  5. Run backend/db.py directly to initialise the SQLite schema
  6. Check that data/curriculum/ contains at least one .txt file — warn if empty
  7. Run data/build_index.py to build the FAISS index (skip if index already exists)
  8. Print: "Setup complete. Edit .env with your GEMMA_API_KEY, then run ./start.sh"

Write start.sh:
  source .venv/bin/activate
  uvicorn backend.main:app --host $HOST --port $PORT --reload

Write stop.sh:
  pkill -f "uvicorn backend.main:app" || true

Write .gitignore — must include:
  .env, .venv/, __pycache__/, *.pyc, *.db, *.index,
  data/curriculum_meta.json, models/*.gguf, frontend/dist/,
  frontend/node_modules/

──────────────────────────────────────
STEP 2 — Config (backend/config.py)
──────────────────────────────────────

Create backend/config.py using pydantic-settings BaseSettings.
Load every variable from .env.example.
Expose a single settings singleton: `from backend.config import settings`
All other files import from here — never from os.environ directly.

──────────────────────────────────────
STEP 3 — Database layer (backend/db.py)
──────────────────────────────────────

Implement using aiosqlite. On import, expose init_db() which creates
all tables and indexes using the schema below. Call init_db() from
FastAPI's lifespan startup hook.

Schema (exact — do not alter column names or types):

  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS students (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    age         INTEGER,
    language    TEXT DEFAULT 'en',
    grade_level INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    last_active TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    student_id     TEXT REFERENCES students(id),
    started_at     TEXT DEFAULT (datetime('now')),
    ended_at       TEXT,
    message_count  INTEGER DEFAULT 0,
    topics_covered TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id             TEXT PRIMARY KEY,
    student_id     TEXT REFERENCES students(id),
    session_id     TEXT REFERENCES sessions(id),
    topic          TEXT NOT NULL,
    question_text  TEXT,
    student_answer TEXT,
    correct        INTEGER,
    score          REAL,
    timestamp      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS topic_mastery (
    student_id   TEXT REFERENCES students(id),
    topic        TEXT NOT NULL,
    mastery      REAL DEFAULT 0.0,
    level        TEXT DEFAULT 'beginner',
    last_updated TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, topic)
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_student    ON quiz_results(student_id);
  CREATE INDEX IF NOT EXISTS idx_quiz_topic      ON quiz_results(topic);
  CREATE INDEX IF NOT EXISTS idx_mastery_student ON topic_mastery(student_id);

Async helper functions to expose (all return Pydantic models or dicts):
  init_db()
  create_student(name, age, language, grade_level) -> dict
  get_student(student_id) -> dict | None
  update_last_active(student_id)
  create_session(student_id) -> dict
  end_session(session_id)
  increment_message_count(session_id)
  record_quiz_result(student_id, session_id, topic, question_text, student_answer, correct, score) -> dict
  update_mastery(student_id, topic, new_score) -> dict
    # EMA formula: mastery = 0.7 * old_mastery + 0.3 * new_score
    # Level logic: mastery > 0.75 -> "advanced" | > 0.45 -> "intermediate" | else "beginner"
    # Returns: {"mastery": float, "level": str, "previous_level": str}
  get_all_students() -> list[dict]
  get_student_mastery(student_id) -> list[dict]
  get_dashboard_data() -> dict
    # Returns: {"students": [...], "total_sessions": int, "topics_by_struggle": [...]}

──────────────────────────────────────
STEP 4 — FAISS store
──────────────────────────────────────

data/build_index.py:
  - Load all .txt files from CURRICULUM_DIR
  - Split each file into passages of ~200 words with 20-word overlap
  - Embed all passages using sentence-transformers EMBED_MODEL
  - Show tqdm progress bar during embedding
  - Save: FAISS_INDEX_PATH (binary) and FAISS_META_PATH (JSON list of {id, text, source, grade_hint})
  - Print total passages indexed on completion

backend/faiss_store.py:
  - Load index and meta at module import time (lazy-loaded singleton)
  - Expose: query(topic: str, grade_level: int, k: int = 3) -> list[dict]
  - Embed the topic string, search FAISS, return top-k passages with source metadata
  - If index file does not exist, log a warning and return [] rather than crashing

──────────────────────────────────────
STEP 5 — Model client (backend/model_client.py)
──────────────────────────────────────

This is the only file that talks to an AI model. All other files call functions from here.

Implement a ModelClient class with these public methods:

  async def stream_chat(
    self,
    messages: list[dict],        # OpenAI-style message history
    tools: list[dict],           # Tool definitions (see format below)
    image_b64: str | None        # Base64 JPEG if textbook photo present
  ) -> AsyncGenerator[str, None]
    # Yields token strings for SSE forwarding
    # If the model emits a tool call instead of text, raises ToolCallEvent

  async def complete_with_tools(
    self,
    messages: list[dict],
    tools: list[dict],
    image_b64: str | None
  ) -> "ToolCallEvent | str"
    # Returns either a ToolCallEvent (if model called a tool)
    # or the full text string (if model responded directly)

Define ToolCallEvent as a dataclass:
  @dataclass
  class ToolCallEvent:
    tool_name: str
    arguments: dict

Routing logic (read USE_LOCAL_OLLAMA from settings):

  IF USE_LOCAL_OLLAMA is False:
    Use google-generativeai SDK
    Configure with: genai.configure(api_key=settings.GEMMA_API_KEY)
    Model: genai.GenerativeModel(settings.GEMMA_MODEL)
    Convert tools list to genai.protos.Tool format
    Use generate_content(..., stream=True) for streaming
    Parse function_call from response candidates to detect tool calls
    For multimodal (image present): include image as Part in content list

  IF USE_LOCAL_OLLAMA is True:
    Use httpx async client
    POST to {OLLAMA_HOST}/api/chat
    Body: {"model": OLLAMA_MODEL, "messages": messages, "tools": tools, "stream": true}
    For streaming: iterate response lines, parse JSON per line
    Detect tool_calls field in Ollama response
    Fallback: if tool_calls absent, attempt to parse raw JSON from text field

Retry logic (both paths):
  Use tenacity: @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
  On final failure: raise with clear error message including model name and endpoint

Tool definition format expected by stream_chat and complete_with_tools:
  [
    {
      "name": "tool_name",
      "description": "what this tool does",
      "parameters": {
        "type": "object",
        "properties": {
          "param_name": {"type": "string", "description": "..."}
        },
        "required": ["param_name"]
      }
    }
  ]
  The client is responsible for converting this format to whatever the
  underlying API requires (genai.protos.Tool for Gemma API, raw JSON for Ollama).

──────────────────────────────────────
STEP 6 — Four agent tools (backend/tools.py)
──────────────────────────────────────

Each tool is a plain async Python function called by main.py after the
model emits a ToolCallEvent. Tools must not call model_client directly —
they are pure data functions (except generate_quiz which calls model_client
for structured generation).

Import settings from backend.config. Import db helpers from backend.db.
Import faiss_store from backend.faiss_store.

Define TOOL_SCHEMAS: list[dict] at module level — the 4 tool definitions
in the standard format described in Step 5. This list is passed into
every model_client call from main.py.

Tool 1 — detect_language
  Signature: async def detect_language(text: str) -> dict
  Returns: {"language": str, "confidence": float}
  Logic:
    - Use langdetect.detect_langs(text) to get language probabilities
    - If top result confidence >= LANGDETECT_CONFIDENCE_THRESHOLD: return it
    - Else: return top result but flag low confidence in logs
    - Map langdetect codes to ISO 639-1 where needed
    - Never raises — on any error return {"language": "en", "confidence": 0.0}

Tool 2 — retrieve_curriculum
  Signature: async def retrieve_curriculum(topic: str, grade_level: int, language: str) -> list[dict]
  Returns: [{"passage": str, "source": str}, ...]
  Logic:
    - Call faiss_store.query(topic, grade_level, k=3)
    - Return results directly
    - If faiss_store returns empty: return a single dict with a note that no curriculum was found

Tool 3 — generate_quiz
  Signature: async def generate_quiz(topic: str, level: str, language: str, n: int) -> dict
  Returns: {"questions": [{"id": str, "question": str, "options": list[str], "answer": str, "type": "mcq"}]}
  Logic:
    - Build a one-shot prompt asking the model to return ONLY valid JSON
      matching the return schema, in the student's language (language param),
      at the given level (beginner / intermediate / advanced)
    - Call model_client.complete_with_tools with empty tools list (no tool recursion)
    - Strip any markdown code fences from response before JSON parsing
    - Assign a UUID to each question id
    - Validate parsed JSON matches expected schema — raise ValueError if malformed
    - Return the validated dict

Tool 4 — update_progress
  Signature: async def update_progress(student_id: str, topic: str, score: float, question_ids: list[str]) -> dict
  Returns: {"new_level": str, "mastery": float, "previous_level": str}
  Logic:
    - Call db.update_mastery(student_id, topic, score)
    - Return the result dict from update_mastery

──────────────────────────────────────
STEP 7 — FastAPI app (backend/main.py)
──────────────────────────────────────

Use FastAPI lifespan context manager for startup/shutdown:
  Startup: call db.init_db(), log server ready message
  Shutdown: log graceful shutdown

Mount React static build at root: app.mount("/", StaticFiles(directory=settings.FRONTEND_DIST, html=True))
If FRONTEND_DIST does not exist, skip the mount and log a warning — server still starts.

Implement these routes (in this order):

  POST /api/students
    Body: {name: str, age: int, language: str, grade_level: int}
    Returns: full student dict
    Calls: db.create_student()

  GET /api/students
    Returns: list of all student dicts with latest mastery summary
    Calls: db.get_all_students()

  GET /api/students/{student_id}
    Returns: student dict + full topic_mastery list
    Calls: db.get_student() + db.get_student_mastery()
    404 if not found

  POST /api/sessions
    Body: {student_id: str}
    Returns: session dict
    Calls: db.create_session()

  POST /api/upload-image
    Body: multipart file upload
    Process with Pillow: resize to IMAGE_MAX_PX on longest side, convert to JPEG
    Return: {image_b64: str}
    Delete file from disk immediately after encoding
    Max file size: 10MB — return 413 if exceeded

  POST /api/chat  ← most important endpoint
    Body: {student_id: str, session_id: str, message: str, image_b64: str | None}
    Response: text/event-stream (SSE)

    SSE event format — use these exact event types:
      data: {"type": "token", "content": "..."}     # each streamed token
      data: {"type": "tool_start", "tool": "..."}   # tool execution began
      data: {"type": "tool_done", "tool": "...", "result": {...}}  # tool result
      data: {"type": "done"}                         # stream complete
      data: {"type": "error", "message": "..."}     # on exception

    Chat endpoint logic (implement exactly):
      1. Load student from DB — 404 if not found
      2. Update student last_active
      3. Build system prompt (see system prompt spec below)
      4. Build message history: [system, ...prior turns, current user message]
         - For now, message history is single-turn (no prior turns stored)
         - Image attaches to the current user message if image_b64 present
      5. Call model_client.complete_with_tools(messages, TOOL_SCHEMAS, image_b64)
      6. If result is ToolCallEvent:
           a. Yield tool_start SSE event
           b. Dispatch to correct tool function based on tool_name
           c. Yield tool_done SSE event with result
           d. Append tool result to message history as assistant + tool_result turn
           e. Call model_client.stream_chat(updated_messages, TOOL_SCHEMAS, None)
           f. Yield each token as SSE token event
         If result is str (direct response):
           Yield each word as SSE token event (simulate streaming)
      7. Yield done SSE event
      8. Increment session message_count in DB
      9. On any unhandled exception: yield error SSE event, log full traceback

  POST /api/quiz/submit
    Body: {student_id: str, session_id: str, topic: str, answers: list[{question_id: str, answer: str, correct_answer: str}]}
    Logic:
      - Score each answer (case-insensitive string match)
      - Call db.record_quiz_result() for each answer
      - Call tools.update_progress() with overall score
    Returns: {score: float, new_level: str, mastery: float, results: list[dict]}

  GET /api/dashboard
    Returns: full dashboard data from db.get_dashboard_data()
    This endpoint is polled by the teacher dashboard every 10 seconds

System prompt template (build this string in main.py, inject student data):
  "You are a patient, encouraging tutor. The student's name is {name}.
   They are {age} years old, studying at grade {grade_level} level.
   Their primary language is {language} — always respond in {language}.
   Their current topic mastery: {mastery_summary}.

   Your teaching approach:
   - Never give answers directly. Guide the student with questions.
   - If they struggle, try a different explanation or analogy.
   - Never use the words 'wrong' or 'incorrect'. Say 'not quite' or 'let's try again'.
   - Keep explanations concise — 3 to 5 sentences maximum.
   - After explaining a concept, always call the quiz_generator tool.
   - When you detect the student's language from their message, call language_detector.
   - When a concept needs curriculum grounding, call retrieve_curriculum first.
   - After a quiz is submitted and scored, call update_progress."

──────────────────────────────────────
STEP 8 — Documentation
──────────────────────────────────────

Write SETUP.md:
  - Prerequisites (Python 3.11+, Node 18+, git)
  - How to get a Gemma API key from Google AI Studio (one paragraph)
  - Exact commands to run: git clone, ./setup.sh, edit .env, ./start.sh
  - How to add curriculum files to data/curriculum/
  - How to switch to local Ollama when ready (change 2 env vars)
  - Troubleshooting: 5 most likely failure points with fixes

Write TEST.md with curl commands for every endpoint:
  - Create a student
  - List students
  - Start a session
  - Send a chat message (text only)
  - Upload a textbook image
  - Send a chat message with image_b64
  - Submit quiz answers
  - Get dashboard data
  Include expected response shapes next to each command.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAMPLE CURRICULUM FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create these 5 placeholder files in data/curriculum/ so the FAISS index
can build immediately. Keep each file plain English, 300-500 words.

  math_fractions.txt        — what fractions are, numerator/denominator, simple examples
  math_counting.txt         — counting 1-20, basic addition, number lines
  science_water_cycle.txt   — evaporation, condensation, precipitation, simple diagrams described in text
  literacy_phonics.txt      — basic letter sounds, simple word formation, CVC words
  life_skills_hygiene.txt   — handwashing steps, why hygiene matters, simple daily routine

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO DELIVER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deliver all files completely. No truncation, no placeholders, no "# TODO" comments.
Every file must be immediately runnable after the user copies their GEMMA_API_KEY into .env.

Delivery order:
  1. .env.example, .gitignore, requirements.txt
  2. setup.sh, start.sh, stop.sh
  3. backend/config.py
  4. backend/db.py
  5. data/build_index.py
  6. backend/faiss_store.py
  7. backend/model_client.py
  8. backend/tools.py
  9. backend/main.py
  10. data/curriculum/*.txt (all 5 files)
  11. SETUP.md
  12. TEST.md

After delivering all files, print a one-paragraph summary of what was built
and what the user needs to do to get the server running.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES FOR THIS SESSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Ask before changing anything in: DB schema, tool signatures, SSE event format, API route paths.
- On everything else, use your best engineering judgment.
- If a library version causes a compatibility issue, flag it and propose a specific fix before changing requirements.txt.
- Do not implement the React frontend. That is Phase 2.
- Do not implement fine-tuning scripts. That is Phase 3.
- Do not add features not described above. Build exactly what is specified.
