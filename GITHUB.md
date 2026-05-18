# GITHUB.md
# OptiLearn GitHub Repository Documentation
#
# This file contains all documentation files for the GitHub repository.
# Each section is a separate file — copy each block into its own file.
#
# Files included:
#   1. README.md
#   2. SETUP.md
#   3. ARCHITECTURE.md
#
# ===========================================================================


# ============================================================
# FILE: README.md
# ============================================================

# OptiLearn

Offline-first multilingual adaptive LMS for refugee and underserved classrooms. Runs on a single $100 laptop and a $15 router. No internet required.

OptiLearn is built for environments standard edtech ignores: classrooms with 85 to 130 students per teacher, learners speaking up to 51 different languages, and children carrying the weight of displacement. The platform runs a fine-tuned Gemma 4 model locally through Ollama, serves an entire class from one device over a local network, and delivers AI-powered tutoring, live translation, and adaptive quizzing with no cloud dependency.

Submission links for the demo, video, model weights, and Kaggle writeup will be added when the final release artifacts are published.


## Who It Is For

OptiLearn was designed first for refugee classrooms, but the barriers it addresses are not exclusive to camps. Language-restricted instruction, overcrowded classrooms, limited teacher availability, and poor internet connectivity affect hundreds of millions of students across the developing world.

The system ships with support for over 30 languages covering the UNHCR priority list: Arabic, Swahili, Somali, Amharic, Dari, French, Tigrinya, and more. Every AI feature, including the tutor, live translation, text-to-speech, and curriculum search, works without an internet connection.


## Core Features

### For Students

- AI Tutor with adaptive mastery tracking using exponential moving average (EMA) scoring
- Translate and Learn: upload any PDF or photograph and receive a conceptual translation plus an AI-generated lesson summary in your language
- Live Class Translator: real-time speech transcription and translation during lessons
- Text-to-speech for all responses, supporting 30+ offline voice models via Piper TTS
- Downloadable study notes and translated transcripts as PDFs after each class
- Personal dashboard showing mastery level, recent topics, and session history
- Courses, assignments, and a calendar view for scheduled classes
- Live Quiz participation with real-time scoring
- AI Avatar tutor with voice chat for a more personal learning experience
- Session history with full chat logs, all stored locally
- PIN-based login with 30-day persistent sessions
- Data export and import as encrypted ZIP files for student record portability

### For Teachers

- Dashboard with per-student mastery heatmaps, quiz performance, and activity logs
- AI assistant for questions about students, curriculum, and the platform
- Quiz Builder for creating custom assessments assigned to all students or specific ones
- AI-generated progress reports for each student, streamed in real time
- Live Class Translator control panel
- Live Quiz hosting with real-time student response visualization
- Material upload: PDFs are extracted and indexed for student curriculum retrieval
- Student inactivity alerts for safeguarding
- Class scheduling and calendar management
- Report and transcript PDF export with multilingual font rendering

### For Administrators

- Teacher account management including creation, role assignment, and password reset
- System diagnostics with AI latency tracking, cache statistics, and error logs
- Master language toggle to switch the entire interface between English and the host country's primary language
- Network status dashboard showing connected devices, health checks, and connectivity state
- Student PIN management and account reset


## How the Network Works

The teacher's laptop runs OptiLearn and acts as the local server. Students connect to a WiFi hotspot or a $15 travel router and open a browser. The server announces itself over mDNS so students reach it at optilearn.local without typing an IP. A captive portal redirects any connection attempt to the OptiLearn interface automatically. A QR code on the teacher's screen makes device enrollment take seconds.

When internet is available and latency is below 200ms, OptiLearn upgrades AI inference from the local Gemma 4 E2B model to Gemma 4 26B through the Gemini API. This switch is transparent to students and teachers.


## Hardware Requirements

Teacher device (server):
- Any x86-64 laptop or desktop
- 8 GB RAM minimum (16 GB recommended)
- 20 GB free disk space
- Windows, macOS, or Linux

Student devices: any phone, tablet, or laptop with a browser.

Network: device WiFi hotspot or a $15 travel router.

Per-student infrastructure cost: under $200.


## Installation

```bash
git clone https://github.com/Ilakiancs/OptiLearn.git
cd optilearn/optilearn
bash scripts/setup.sh
bash scripts/start.sh
```

Then open http://localhost:8000 in a browser or launch the desktop app.

See SETUP.md for detailed configuration, Ollama setup, and troubleshooting.


## Technology

- Backend: FastAPI, uvicorn, SQLite (aiosqlite), Python 3.11
- AI: Gemma 4 E2B via Ollama (local), Gemma 4 26B via Gemini API (online fallback)
- Vectors: FAISS with paraphrase-multilingual-MiniLM-L12 embeddings
- Audio: Piper TTS (offline), Whisper ASR (offline), librosa
- PDF: PyMuPDF (extraction), ReportLab with Noto fonts (generation)
- Frontend: React 18, Vite, TanStack Query, PWA (Workbox)
- Desktop: PyWebView
- Network: mDNS (zeroconf), captive portal (dnslib), self-signed TLS (cryptography)
- Auth: JWT (teachers), PIN (students), bcrypt


## Fine-Tuned Model

The Gemma 4 E2B model was fine-tuned with Unsloth using LoRA on 11,500+ examples covering Socratic tutoring, multilingual explanations, and trauma-aware pedagogical patterns. It never uses discouraging feedback language. Weights and benchmark reports are available on HuggingFace.

Training configuration: r=16, alpha=32, 2 epochs, lr=2e-4, GCP A100.


## Trauma-Aware Design

The words "wrong," "incorrect," "failed," and "mistake" do not appear anywhere in the OptiLearn interface or in model outputs. Mastery is shown through private levels and encouraging feedback only. Student progress is never displayed publicly or compared between peers. When a student stops responding, the teacher receives an alert so they check in personally.

This is not a UI style choice. Between 10% and 33% of displaced children show clinical signs of depression. Among unaccompanied youth, PTSD rates reach up to 85%. The platform is built with that in mind throughout, from the choice of palette colors to the phrasing of every AI response.


## License

MIT License. See LICENSE for details.


## Built by Students, for Students

OptiLearn was built by three undergraduate students from Sri Lanka for the Gemma 4 Good Hackathon (2026). We built the system we wish existed when we were navigating education systems with limited resources and restricted languages of instruction.

For 250 million students facing systemic barriers to quality education worldwide.


# ============================================================
# FILE: SETUP.md
# ============================================================

# OptiLearn Setup Guide

This guide covers installation, configuration, running the server, and common troubleshooting steps.


## Prerequisites

- Python 3.11 (required; 3.12+ is not supported due to PyWebView dependency constraints)
- Node.js 18+ and npm (for building the frontend)
- Git
- 8 GB RAM minimum; 16 GB recommended
- 20 GB free disk space


## Step 1 — Clone and Install

```bash
git clone https://github.com/Ilakiancs/OptiLearn.git
cd optilearn/optilearn
```

Run the setup script. This creates the Python virtual environment, installs all backend dependencies, builds the frontend, initializes the SQLite database, downloads Noto fonts for multilingual PDF rendering, and builds the FAISS curriculum index.

```bash
bash scripts/setup.sh
```

On Windows, run the setup from Git Bash or WSL. Alternatively, double-click OptiLearn.bat to launch the desktop app directly; it runs setup automatically on the first launch.


## Step 2 — Configure Environment

Copy the example configuration:

```bash
cp .env.example .env
```

Edit .env with your settings:

```
# AI Model Settings
USE_LOCAL_OLLAMA=true
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=optilearn-gemma4          # Your local model name
OLLAMA_MODEL_FAST=gemma4:e2b           # Fast local model
OLLAMA_MODEL_DEEP=gemma4:e4b           # Deep local model

# Google Gemini API (optional — used when internet is available)
GEMMA_API_KEY=your_gemini_api_key_here

# Paths
DB_PATH=./data/optilearn.db
FAISS_INDEX_PATH=./data/curriculum.index
EMBED_MODEL=./models/embeddings/paraphrase-multilingual-MiniLM-L12-v2
MATERIALS_DIR=./data/materials
VOICES_DIR=./data/voices

# Audio
PIPER_BINARY=./bin/piper
WHISPER_BINARY=./bin/whisper-main
WHISPER_MODEL=./data/whisper-models/ggml-base.bin

# Network
PORT=8000
HTTPS_PORT=8443
LATENCY_THRESHOLD_MS=200

# Frontend
FRONTEND_DIST=./frontend/dist
```

To run fully offline, set USE_LOCAL_OLLAMA=true and leave GEMMA_API_KEY empty.

To use the Gemini API as an online fallback, set GEMMA_API_KEY to your key from Google AI Studio.


## Step 3 — Set Up Ollama

Install Ollama from ollama.com.

Pull or create the OptiLearn model:

```bash
ollama pull gemma4:e2b
```

To use the fine-tuned model:

```bash
ollama create optilearn-gemma4 -f finetuning/Modelfile
```

Verify the model is running:

```bash
ollama list
```

The model name in OLLAMA_MODEL must exactly match what appears in ollama list.


## Step 4 — Start the Server

```bash
bash scripts/start.sh
```

The server starts on http://localhost:8000 (HTTP) and https://localhost:8443 (HTTPS).

Open http://localhost:8000 in a browser to access OptiLearn.

For the desktop app:

```bash
py -3.11 desktop.py
```

Or on Windows, run OptiLearn.bat.


## Step 5 — First-Time Admin Setup

On first launch, navigate to http://localhost:8000 and complete the admin setup form. This creates the first teacher account with admin privileges. Subsequent teacher accounts are created from the admin panel.


## Classroom Network Setup

1. Enable WiFi hotspot on the teacher's laptop (Windows: Mobile Hotspot settings) or connect a $15 travel router to the laptop via USB or Ethernet.
2. Students connect their devices to the hotspot or router.
3. OptiLearn announces itself over mDNS. Students open a browser and navigate to http://optilearn.local.
4. The QR code displayed on the teacher's screen provides an instant enrollment link.

For microphone access in the Live Class feature, students must use the HTTPS address. Self-signed certificates are generated automatically at startup covering all detected LAN IP addresses.


## Downloading Voice Models

Voice models for text-to-speech are stored in data/voices/. Each language model is 50 to 80 MB in ONNX format. The setup script downloads common models (English, Arabic, French, Swahili). Additional voices are fetched on first use.

Manual download from piper-tts/piper-voices on HuggingFace. Place files in data/voices/ following the naming pattern in app/services/tts_client.py.


## Troubleshooting

Ollama returns 404:
Run ollama list and ensure the model name in OLLAMA_MODEL exactly matches. Model names are case-sensitive.

Port 8000 already in use:
Change PORT in .env. Kill the existing process with lsof -ti:8000 | xargs kill (Linux/Mac) or netstat -ano | findstr :8000 then taskkill /PID <pid> (Windows).

FAISS index fails to load:
Delete data/curriculum.index and data/curriculum_meta.json, then re-run setup.sh to rebuild the index.

PDF generation missing glyphs (empty boxes):
The Noto fonts are missing. Run the font download step from setup.sh manually or download NotoSansArabic-Regular.ttf and other Noto variants to data/fonts/.

Microphone not working in browser:
Students must access via HTTPS (https://[server-ip]:8443). The browser requires a secure context for MediaRecorder. Self-signed cert warnings are expected on first visit; students click through once.

Desktop app opens a blank screen:
The frontend may not be built. Run cd frontend && npm install && npm run build from the optilearn/ directory, then restart.

Model responses are very slow:
For CPU-only inference, Gemma 4 E2B on 8 GB RAM produces roughly 8 to 15 tokens per second. Set OLLAMA_MODEL_FAST=gemma4:e2b for all routes to keep latency manageable. Use OLLAMA_NUM_THREADS to pin to available cores.

Student cannot log in with PIN:
PINs are set by the teacher from the dashboard. Check the Students tab and confirm the student record exists.


## Stopping the Server

```bash
bash scripts/stop.sh
```

Or close the desktop app window.


# ============================================================
# FILE: ARCHITECTURE.md
# ============================================================

# OptiLearn Architecture

This document describes the technical architecture of the OptiLearn system for contributors and deployers who need a complete picture of how the components fit together.


## System Overview

OptiLearn runs as a single-process Python server with a React frontend. In a classroom deployment, one teacher laptop runs the server and acts as a WiFi access point. Students connect their devices to the local network and access the full platform through a browser with no app installation required.

```
[Teacher Laptop — OptiLearn Server]
        |
    [WiFi Router / Hotspot]
        |
   +-----------+----------+----------+
   |           |          |          |
[Phone]   [Tablet]   [Laptop]   [Phone]
(Student) (Student)  (Student) (Student)
```

The server process runs two uvicorn instances: HTTP on port 8000 for general access and HTTPS on port 8443 for pages requiring microphone access (live translation). Both serve the same FastAPI application.


## Directory Structure

```
optilearn/
  app/
    main.py                 Application factory, lifespan hooks, middleware
    core/
      config.py             Pydantic settings, reads from .env
      grades.py             Grade normalization (Pre-K through 12th)
      prompts.py            System prompt builders per feature
    api/
      routes/
        auth.py             Teacher JWT auth, student PIN auth, admin CRUD
        chat.py             SSE streaming AI tutor with tool dispatch
        quiz.py             Quiz grading and mastery update
        students.py         Student CRUD, progress, export/import
        sessions.py         Chat session management
        dashboard.py        Teacher aggregated view
        teacher_quiz.py     Quiz builder endpoints
        materials.py        PDF upload, extraction, curriculum indexing
        translate.py        Live translation SSE pipeline
        live_class.py       Classroom synchronization
        live_quiz.py        Real-time collaborative quiz (WebSocket)
        persona.py          AI avatar tutor agent
        feature1.py         Speech-to-text endpoints
        network.py          Health check, captive portal, client tracker
    models/
      schemas.py            Pydantic request/response models
    services/
      db.py                 Async SQLite operations
      model_client.py       Dual-path AI router (Ollama + Gemini)
      faiss_store.py        FAISS curriculum retrieval
      tts_client.py         Piper TTS text-to-speech
      whisper_client.py     Offline ASR
      job_manager.py        Background job registry
      generated_cache.py    Persistent cache for AI outputs
      context_prep.py       Chat history selection
      telemetry.py          AI latency and error tracking
      client_tracker.py     Connected device tracking
      dns_server.py         Captive portal DNS redirect
      mdns_server.py        mDNS service announcement
    tools/
      agent_tools.py        Four runtime tools: detect_language, retrieve_curriculum,
                            generate_quiz, update_progress
  frontend/
    src/
      App.jsx               Router, auth guards, network gate
      main.jsx              PWA registration, PyWebView detection
      api/client.js         HTTP and SSE client with auth injection
      screens/              Page components
      components/           Reusable UI components
      context/
        AuthContext.jsx     Student and teacher auth state
        ThemeContext.jsx    Theme and accessibility settings
      hooks/                Custom React hooks
      utils/                Audio capture, persona icons
  data/
    optilearn.db            SQLite database (WAL mode)
    curriculum/             Plain-text curriculum passages (300-800 words each)
    curriculum.index        FAISS binary index
    curriculum_meta.json    FAISS metadata
    materials/              Teacher-uploaded PDFs
    voices/                 Piper TTS ONNX voice models
    fonts/                  Noto TTF fonts for PDF generation
    ssl/                    Auto-generated TLS cert and key
    whisper-models/         Offline ASR model
    models/embeddings/      Multilingual sentence embedding model
  finetuning/
    01_prepare_dataset.py   Synthetic dataset generation (11,500+ examples)
    02_finetune.py          Unsloth LoRA fine-tuning on Gemma 4
    03_evaluate.py          Evaluation on held-out quiz questions
    04_export.py            Export to GGUF + register with Ollama
    Modelfile               Ollama model definition (fine-tuned)
    real-data/              Real SFT data (2,169 examples)
  scripts/
    setup.sh                One-shot installer
    start.sh                Start servers
    stop.sh                 Stop servers
  desktop.py                PyWebView desktop launcher
```


## AI Pipeline

### Dual-Path Model Router

Every AI request goes through app/services/model_client.py, which makes a routing decision before sending to the model.

Path A (offline): The request goes to Ollama, which serves the fine-tuned Gemma 4 E2B model locally. This path is always available and requires no network connection.

Path B (online): When the server detects internet connectivity and measures first-token latency below LATENCY_THRESHOLD_MS (default 200ms), the request is routed to Gemma 4 26B through the Gemini API. This path activates automatically and falls back to Path A if the connection degrades.

The client uses tenacity for retry logic with exponential backoff on transient failures.

### Agent Tool Dispatch

The chat endpoint (POST /api/chat) runs the tutor agent with four tools available:

detect_language(text): Runs langdetect on the input and returns an ISO 639-1 code with confidence. Falls back to English on error.

retrieve_curriculum(topic, grade_level, language): Runs a FAISS similarity search using the multilingual MiniLM-L12 embedding of the query. Returns the three closest curriculum passages with source references.

generate_quiz(topic, level, language, n): Calls the model with a structured prompt and extracts a JSON array of questions, options, correct answers, and explanations from the response.

update_progress(student_id, topic, score): Applies the EMA formula (new = 0.7 × old + 0.3 × score) and writes the updated mastery value to the mastery_progress table. Maps the result to one of four levels.

Tool calls and their results stream as SSE events alongside token output. The frontend displays tool activity in real time.

### Streaming

All AI responses stream as Server-Sent Events. The event types are: token (model output chunk), tool_call (tool being invoked), tool_result (tool output), and done (stream complete). The client.js SSE handler batches tokens for smooth rendering.


## Database Schema

Eight tables stored in SQLite (WAL mode) via aiosqlite:

students: id (UUID), name, age, language, grade_level, pin_hash, created_at

sessions: id, student_id (FK), title, created_at

messages: id, session_id (FK), role (user/assistant/tool), content, tool_name, created_at

mastery_progress: id, student_id (FK), topic, mastery (0.0 to 1.0), level, updated_at

quiz_results: id, student_id (FK), topic, score, answers (JSON array), created_at

teachers: id, username (unique), password_hash (bcrypt), display_name, is_admin, created_at

teacher_quizzes: id, title, questions (JSON), subject, assigned_to (all or comma-separated IDs), created_by (FK), created_at

generated_cache: cache_key (SHA-256 hash of feature + input), feature, payload, metadata (JSON), created_at

Materials, class notes, and session metadata are stored in the materials and class_notes tables created during Phase 1 migration.


## Frontend Architecture

The frontend is a React 18 SPA built with Vite. It is served as static files from the FastAPI backend and works as a PWA with Workbox offline caching.

Auth state is managed in AuthContext.jsx. Teacher sessions use Bearer JWT tokens stored in localStorage with 8-hour expiry. Student sessions use a student ID and PIN with 30-day expiry.

NetworkGate polls /api/health every 5 seconds. After two consecutive failures, it renders an offline screen. The NetworkHeartbeat component sends a heartbeat from each student device every 10 seconds so the teacher dashboard reflects active connections in real time.

Route protection is enforced by TeacherRoute and StudentRoute wrapper components.

In desktop mode (PyWebView), the service worker is not registered. File downloads go through the Python js_api bridge (window.pywebview.api.save_file) instead of blob URLs.


## Network Stack

mDNS: zeroconf announces the server as optilearn.local on all detected network interfaces. Students do not need to know the server's IP address.

Captive portal: dnslib runs a DNS server that responds to all A record queries with the server's LAN IP. When a new device connects to the classroom WiFi, its OS fires a captive portal check and is redirected to OptiLearn.

TLS: The cryptography library generates a self-signed certificate at startup. The certificate covers 127.0.0.1 and all detected private IPv4 addresses, making it valid for student browsers connecting from the LAN. This enables MediaRecorder (microphone) access without external certificate authorities.

Client tracking: client_tracker.py records the IP, user-agent, last path, and last-seen timestamp of every device that hits an API endpoint. The teacher dashboard uses this to show how many students are currently active.


## Live Features

Live Class Translator: Audio from the teacher's device is captured in 5-second MediaRecorder chunks, converted to WAV, and posted to /api/translate/chunk. The server runs Whisper ASR offline, passes the transcript to Gemma for translation, and streams the result as SSE. When class ends, /api/translate/end assembles the full transcript and generates structured study notes as a background task.

Live Quiz: The quiz host (teacher) creates a quiz and broadcasts questions to all connected student clients via WebSocket. Student answers are collected in real time, scored, and shown on the teacher's screen as a live leaderboard. The WebSocket handler is in routes/live_quiz.py.

AI Persona: The persona tutor is a named character with a visual avatar and voice. It uses the same dual-path model client but with a persona-specific system prompt. Voice responses are synthesized by Piper TTS and returned as WAV audio streamed back to the browser.


## Fine-Tuning Pipeline

Dataset preparation (01_prepare_dataset.py): Generates 11,500+ JSONL examples. Sources include Khan Academy content patterns, UNHCR educational guidelines, and synthetic multilingual Socratic dialogues. Examples cover confusion patterns, analogy-based explanations, checking questions, and encouragement without any discouraging feedback language.

Fine-tuning (02_finetune.py): Loads Gemma 4 E2B base from Unsloth. Applies LoRA with rank 16, alpha 32. Trains for 2 epochs at lr=2e-4 on a GCP A100. Saves to optilearn-weights/.

Evaluation (03_evaluate.py): Tests on a held-out set of curriculum quiz questions. Records accuracy, refusal rate, and language accuracy on multilingual test inputs.

Export (04_export.py): Converts weights to GGUF format for Ollama. Uses finetuning/Modelfile with the OptiLearn system prompt and PARAMETER settings.


## Telemetry

app/services/telemetry.py tracks AI request latency (time-to-first-token and total generation time), cache hit and miss rates, error events, and per-lane request counts (student, teacher, admin). The /api/health endpoint exposes a summary for the admin diagnostics view. Telemetry records are in-memory and reset on server restart.


## Security Notes

Teacher passwords are hashed with bcrypt before storage. JWT tokens are signed with a server-generated secret stored in .env. Student PINs are hashed before storage. The self-signed TLS certificate is generated fresh at each startup. No student data is sent to external services when USE_LOCAL_OLLAMA=true. When the Gemini API is enabled, the message content is sent to Google's servers; operators should disclose this to users where required by local regulations.
