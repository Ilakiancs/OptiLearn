# OptiLearn

**Offline-first multilingual adaptive AI learning agent for refugee and underserved classrooms.**

Built for the [Gemma 4 Good Hackathon 2026](https://www.kaggle.com/competitions/gemma-4-good-hackathon/overview) by Opti5 Labs. The teacher laptop becomes a local AI tutoring server — students connect via WiFi hotspot with no internet required.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Linux / macOS](#linux--macos)
  - [Windows](#windows)
- [Offline Classroom Mode (Ollama)](#offline-classroom-mode-ollama)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [API Reference](#api-reference)
- [Adding Curriculum](#adding-curriculum)
- [Model Fine-Tuning](#model-fine-tuning)
- [Troubleshooting](#troubleshooting)

---

## How It Works

```
┌───────────────────────────────────────────────────────────────────┐
│                         Teacher Laptop                            │
│                                                                   │
│  ┌──────────────┐    ┌─────────────────────────────────────────┐  │
│  │   Ollama     │◄───│           OptiLearn Server              │  │
│  │  gemma4:e2b  │    │         (FastAPI + uvicorn)             │  │
│  │  port 11434  │    │                                         │  │
│  └──────────────┘    │   ┌─────────┐  ┌────────┐  ┌──────────┐ │  │
│                      │   │  SQLite │  │ FAISS  │  │ Piper /  │ │  │
│                      │   │    DB   │  │ Index  │  │ MMS TTS  │ │  │
│                      │   └─────────┘  └────────┘  └──────────┘ │  │
│                      │  React frontend (served as static files)│  │
│                      └───────────────────────────────────────  ┘  │
│                                   ▲ port 8000                     │
│                       WiFi Hotspot│192.168.137.1                  │
└──────────────────────────────────┼────────────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
    ┌─────────▼──────┐   ┌─────────▼──────┐   ┌───────────▼────┐
    │  Student Phone │   │ Student Tablet │   │ Student Laptop │
    │  (browser)     │   │  (browser)     │   │  (browser)     │
    └────────────────┘   └────────────────┘   └────────────────┘
```

The teacher laptop runs Ollama + OptiLearn locally. Students connect from any browser on the same WiFi network at `http://192.168.137.1:8000`. No cloud, no subscriptions, no internet required in the classroom.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11 or 3.12 | 3.13+ not supported (faiss-cpu wheel availability) |
| Node.js | 18+ | Frontend build only |
| npm | 9+ | Bundled with Node.js |
| git | any | |
| Ollama | latest | Required for offline mode — [ollama.com](https://ollama.com) |
| Piper TTS binary | latest | Optional — needed for text-to-speech |

**Hardware minimum (classroom deployment):**
- 8 GB RAM (16 GB recommended for `gemma4:e4b`)
- 10 GB free disk (model + voices + dependencies)
- WiFi adapter (to create hotspot for students)

**Hardware minimum (development with Gemini API fallback):**
- Any machine with internet access
- No GPU required — the Gemini API handles inference

---

## Project Structure

```
OptiLearn/
│
├── optilearn/                          # Main application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                     # FastAPI application entry point
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── auth.py             # Authentication endpoints
│   │   │       ├── chat.py             # Chat/messaging endpoints
│   │   │       ├── dashboard.py        # Dashboard endpoints
│   │   │       ├── feature1.py         # Feature endpoints
│   │   │       ├── live_quiz.py        # Live quiz endpoints
│   │   │       ├── materials.py        # Learning materials
│   │   │       ├── network.py          # Network management
│   │   │       ├── quiz.py             # Quiz endpoints
│   │   │       ├── sessions.py         # Session management
│   │   │       ├── settings.py         # Settings endpoints
│   │   │       ├── students.py         # Student management
│   │   │       ├── teacher.py          # Teacher dashboard
│   │   │       ├── teacher_quiz.py     # Teacher quiz creation
│   │   │       └── translate.py        # Translation endpoints
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py               # App configuration
│   │   │   ├── grades.py               # Grading logic
│   │   │   └── prompts.py              # AI prompts
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── schemas.py              # Pydantic schemas
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── client_tracker.py       # Client tracking
│   │   │   ├── context_prep.py         # Context preparation
│   │   │   ├── db.py                   # Database operations
│   │   │   ├── dns_server.py           # DNS/captive portal
│   │   │   ├── faiss_store.py          # Vector store operations
│   │   │   ├── generated_cache.py      # Caching
│   │   │   ├── job_manager.py          # Async job management
│   │   │   ├── mdns_server.py          # mDNS service discovery
│   │   │   ├── model_client.py         # Gemma/Ollama client
│   │   │   ├── model_scheduler.py      # Model scheduling
│   │   │   ├── network.py              # Network utilities
│   │   │   ├── student_transfer.py     # Data transfer
│   │   │   ├── telemetry.py            # Analytics
│   │   │   ├── tts_client.py           # Text-to-speech
│   │   │   └── whisper_client.py       # Speech-to-text
│   │   └── tools/
│   │       ├── __init__.py
│   │       └── agent_tools.py          # AI agent tools
│   │
│   ├── data/
│   │   ├── curriculum.index            # FAISS vector index
│   │   ├── curriculum_meta.json        # Curriculum metadata
│   │   ├── optilearn.db                # SQLite database
│   │   ├── user_settings.json          # User preferences
│   │   ├── curriculum/                 # Plain text curriculum
│   │   │   ├── life_skills_hygiene.txt
│   │   │   ├── literacy_phonics.txt
│   │   │   ├── math_counting.txt
│   │   │   ├── math_fractions.txt
│   │   │   └── science_water_cycle.txt
│   │   ├── fonts/                      # Custom fonts
│   │   ├── materials/                  # Student learning materials
│   │   │   ├── 324c4168-1070-41f5-b0d9-1f963a6f378d/
│   │   │   └── 40e141c2-2161-43fd-a6b2-9ac1df192aa5/
│   │   └── scripts/
│   │       └── build_index.py          # FAISS index builder
│   │
│   ├── frontend/                       # React + Vite SPA
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   ├── package.json
│   │   ├── pnpm-lock.yaml
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   └── icons/
│   │   └── src/
│   │       ├── App.jsx                 # Root component
│   │       ├── main.jsx                # Entry point
│   │       ├── api/
│   │       │   └── client.js           # API client
│   │       ├── components/             # React components
│   │       ├── context/                # React context
│   │       ├── hooks/                  # Custom hooks
│   │       ├── screens/                # Page screens
│   │       └── styles/                 # CSS/styling
│   │
│   ├── models/                         # Model artifacts
│   ├── tests/
│   │   └── test_system_optimization.py
│   ├── scripts/
│   │   ├── setup.sh                    # One-shot installer (Linux/Mac)
│   │   ├── start.sh                    # Start server (Linux/Mac)
│   │   └── stop.sh                     # Stop server (Linux/Mac)
│   ├── start_admin.bat                 # Start server (Windows)
│   ├── requirements.txt                # Python dependencies
│   └── SETUP.md                        # Detailed setup guide
│
├── training/                           # Fine-tuning pipeline
│   ├── 01_prepare_dataset.py           # Dataset preparation
│   ├── 02_finetune.py                  # Fine-tuning script
│   ├── 03_evaluate.py                  # Evaluation
│   ├── 04_export.py                    # Model export
│   ├── kaggle_notebook.ipynb           # Kaggle notebook
│   ├── README_training.md              # Training guide
│   ├── requirements_training.txt       # Training dependencies
│   ├── dataset/                        # Training datasets
│   └── outputs/                        # Model outputs
│
├── fine-tuning-resources/              # SFT training data
│   ├── optilearn_sft_train.jsonl       # Training set
│   └── optilearn_sft_eval.jsonl        # Evaluation set
│
├── Modelfile                           # Ollama model definition
├── README.md                           # This file
└── test_export.py                      # Export testing
```

---

## Quick Start (Windows)

### 1. Navigate to the project

```bash
cd optilearn
```

### 2. Create Virtual Environment

```bash
python -m venv .venv
.venv\Scripts\activate
```

### Linux / macOS

```bash
# 1. Clone the repo and enter the app directory
git clone https://github.com/Ilakiancs/OptiLearn
cd Optilearn/optilearn

# 2. Run the one-shot installer
chmod +x scripts/setup.sh scripts/start.sh scripts/stop.sh
./scripts/setup.sh
```

The setup script will:
- Verify Python 3.11+
- Create a `.venv` virtual environment and install all Python dependencies
- Copy `.env.example` → `.env`
- Initialise the SQLite database schema (8 tables)
- Build the FAISS curriculum vector index

```bash
# 3. Configure your API key (dev/demo mode only)
nano .env
# Set GEMMA_API_KEY to your Google AI Studio key
# Leave USE_LOCAL_OLLAMA=false for now
```

Get a free API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

```bash
# 4. Build the React frontend
cd frontend
npm install
npm run build
cd ..

# 5. Start the server
./scripts/start.sh
```

| URL | Purpose |
|---|---|
| `http://localhost:8000` | Main app (students + teacher dashboard) |
| `http://localhost:8000/docs` | Interactive API docs (Swagger UI) |

```bash
# 6. Stop the server
./scripts/stop.sh
```

---

### Windows

Windows does not support Bash scripts directly. Use the manual steps below in PowerShell or Command Prompt.

```powershell
# 1. Clone and enter the app directory
git clone https://github.com/Ilakiancs/OptiLearn
cd Optilearn\optilearn

# 2. Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # PowerShell
# or
.venv\Scripts\activate.bat     # Command Prompt

# 3. Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 4. Copy environment file
copy .env.example .env
# Open .env in a text editor and set GEMMA_API_KEY

# 5. Initialise the database
python -c "import asyncio; from app.services.db import init_db; asyncio.run(init_db())"

# 6. Build FAISS curriculum index
python data\scripts\build_index.py

# 7. Build the React frontend
cd frontend
npm install
npm run build
cd ..
```

**For development (no hotspot needed):**
```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**For classroom deployment on Windows — use `start_admin.bat` instead** (see below).

The app will be available at `http://localhost:8000`.

> **Windows TTS note:** Piper TTS uses a subprocess launcher. On Windows, all TTS synthesis runs in a `ThreadPoolExecutor` so it works correctly under uvicorn's `SelectorEventLoop`. No extra configuration is needed.

---

### start_admin.bat — Windows Classroom Launcher

`optilearn/start_admin.bat` is the recommended way to start OptiLearn on Windows when running a live classroom session. Double-click it (or run it from Explorer) — it will prompt for administrator privileges automatically.

What it does, in order:

1. **Elevates to admin** — re-launches itself via `Start-Process -Verb RunAs` if not already elevated
2. **Opens Windows Firewall** — adds inbound rules for port 8000 (HTTP) and port 53 (DNS UDP + TCP) so student devices can connect through the hotspot
3. **Sets hotspot DNS** — points the `192.168.137.1` adapter's DNS server at itself so student browsers resolve the server address correctly
4. **Rebuilds the frontend** — runs `npm install` (if needed) and `npm run build` so the latest UI changes are always live
5. **Starts uvicorn** — launches `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`

Usage:

```
Right-click start_admin.bat → Run as administrator
```

or double-click — the script detects missing privileges and re-elevates itself.

Keep the terminal window open for the duration of the class. Close it (or press any key) to stop the server.

> **Note:** The firewall rules added by `start_admin.bat` are named `OptiLearn HTTP 8000`, `OptiLearn DNS UDP 53`, and `OptiLearn DNS TCP 53`. They are recreated cleanly each run (existing rules with those names are deleted first). To remove them manually: Windows Defender Firewall → Inbound Rules → delete the three OptiLearn entries.

---

## Offline Classroom Mode (Ollama)

For fully offline classroom deployment, Ollama serves the Gemma 4 model locally. No internet required after initial setup.

### Step 1 — Install Ollama

Download from [ollama.com](https://ollama.com) and install. Verify:

```bash
ollama --version
```

### Step 2 — Pull the Gemma 4 models

```bash
# Fast model (default — runs on most hardware)
ollama pull gemma4:e2b

# Deep model (optional — better reasoning, needs ~12 GB RAM)
ollama pull gemma4:e4b
```

> If you have a fine-tuned OptiLearn model (see [Model Fine-Tuning](#model-fine-tuning)):
> ```bash
> ollama create optilearn-gemma4 -f Modelfile
> ```

### Step 3 — Configure .env for offline mode

Open `optilearn/.env` and set:

```env
USE_LOCAL_OLLAMA=true
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b
OLLAMA_MODEL_FAST=gemma4:e2b
OLLAMA_MODEL_DEEP=gemma4:e4b
```

### Step 4 — Start Ollama and the server

```bash
# Terminal 1: keep Ollama running
ollama serve

# Terminal 2: start OptiLearn
cd optilearn
./scripts/start.sh    # Linux/macOS
```

On **Windows**, double-click `optilearn/start_admin.bat` instead — it handles firewall rules, hotspot DNS, and the frontend build automatically before starting the server.

### Step 5 — Set up the WiFi hotspot

On the teacher laptop, create a WiFi hotspot:

- **Windows:** Settings → Mobile Hotspot → Turn On
- **Linux:** `nmcli device wifi hotspot ssid OptiLearn password classroom123`
- **macOS:** System Settings → Sharing → Internet Sharing

Students connect their devices to the hotspot SSID, then open a browser at:

```
http://192.168.137.1:8000
```

The QR code for this URL is available from the Teacher Dashboard → Network tab.

---

## Troubleshooting

### Port 8000 Already in Use

```bash
# Find and kill process on port 8000
# Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -i :8000
kill -9 <PID>
```

### Virtual Environment Not Activating

**Windows:**
```bash
.venv\Scripts\activate
```

**Linux/Mac:**
```bash
source .venv/bin/activate
```

### Curriculum Index Build Fails

Ensure you have curriculum files in `data/curriculum/`:

```bash
# Rebuild manually
python data/scripts/build_index.py
```

### Ollama Connection Error

Ensure Ollama is running:

```bash
ollama serve
```

---

## Documentation

- [Training Guide](training/README_training.md) — Fine-tuning Gemma for custom datasets
- [SETUP.md](optilearn/SETUP.md) — Detailed setup instructions

All configuration is in `optilearn/.env`. The file is created from `.env.example` during setup.

| Variable | Default | Description |
|---|---|---|
| `USE_LOCAL_OLLAMA` | `true` | `true` = always use Ollama offline; `false` = Gemini API when online |
| `GEMMA_API_KEY` | _(empty)_ | Google AI Studio key — required when `USE_LOCAL_OLLAMA=false` |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model identifier (API fallback only) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `gemma4:e2b` | Default Ollama model tag |
| `OLLAMA_MODEL_FAST` | `gemma4:e2b` | Fast routing model (most routes) |
| `OLLAMA_MODEL_DEEP` | `gemma4:e4b` | Deep routing model (complex explanations) |
| `DB_PATH` | `./data/optilearn.db` | SQLite database file path |
| `FAISS_INDEX_PATH` | `./data/curriculum.index` | FAISS binary index path |
| `FAISS_META_PATH` | `./data/curriculum_meta.json` | FAISS passage metadata |
| `CURRICULUM_DIR` | `./data/curriculum` | Directory of `.txt` lesson files |
| `MATERIALS_DIR` | `./data/materials` | Uploaded student files |
| `EMBED_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | Sentence transformer for FAISS embeddings |
| `PIPER_BINARY` | `./bin/piper` | Path to Piper TTS binary |
| `VOICES_DIR` | `./data/voices` | Directory of `.onnx` voice models |
| `IMAGE_MAX_PX` | `1024` | Max image dimension before resize |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `WHISPER_BINARY` | `./bin/whisper` | Path to whisper.cpp binary (live transcription) |
| `WHISPER_MODEL` | `./data/whisper-models/ggml-base.bin` | Whisper model file |

---

## Project Structure

```
Optilearn/
├── optilearn/                          ← Main application directory
│   ├── app/                            ← FastAPI backend
│   │   ├── main.py                     ← App factory, startup, health endpoint
│   │   ├── api/routes/
│   │   │   ├── chat.py                 ← SSE streaming chat + image upload
│   │   │   ├── dashboard.py            ← Teacher dashboard aggregates
│   │   │   ├── feature1.py             ← Translate/explain/ask + TTS routes
│   │   │   ├── materials.py            ← Material upload + FAISS indexing
│   │   │   ├── quiz.py                 ← Quiz submission + EMA scoring
│   │   │   ├── sessions.py             ← Session management
│   │   │   ├── students.py             ← Student CRUD + progress reports
│   │   │   ├── teacher.py              ← Roster, heatmap, alerts, PDF report
│   │   │   └── teacher_quiz.py         ← Quiz builder CRUD
│   │   ├── core/
│   │   │   ├── config.py               ← All config via pydantic-settings + .env
│   │   │   └── prompts.py              ← Trauma-aware tutor system prompt builder
│   │   ├── models/
│   │   │   └── schemas.py              ← Pydantic request/response models
│   │   ├── services/
│   │   │   ├── db.py                   ← SQLite schema + async DB helpers (8 tables)
│   │   │   ├── faiss_store.py          ← Lazy singleton FAISS vector index
│   │   │   ├── model_client.py         ← Unified Ollama / Gemini router
│   │   │   └── tts_client.py           ← Hybrid Piper + MMS-TTS engine
│   │   └── tools/
│   │       └── agent_tools.py          ← 4 agent tools with JSON schemas
│   ├── data/
│   │   ├── optilearn.db                ← SQLite database (auto-created on first run)
│   │   ├── curriculum/                 ← Plain .txt lesson files (add your own here)
│   │   ├── curriculum.index            ← FAISS binary vector index (auto-built)
│   │   ├── curriculum_meta.json        ← FAISS passage metadata
│   │   ├── fonts/                      ← 10 Noto TTF fonts (auto-downloaded at startup)
│   │   ├── materials/                  ← Teacher-uploaded materials (per student)
│   │   ├── voices/                     ← 11 Piper ONNX voice models (~679 MB)
│   │   └── scripts/
│   │       └── build_index.py          ← Rebuild FAISS index manually
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── api/client.js           ← All API calls + streamSSE helper
│   │   │   ├── components/             ← 7 reusable UI components
│   │   │   ├── context/                ← AuthContext, ThemeContext
│   │   │   ├── hooks/                  ← useDashboard, useSSE
│   │   │   ├── screens/                ← 17 full-page screens
│   │   │   ├── App.jsx                 ← Router + all route definitions
│   │   │   └── main.jsx                ← React entry point
│   │   ├── public/
│   │   │   ├── manifest.json           ← PWA manifest
│   │   │   └── sw.js                   ← Service Worker
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   ├── scripts/
│   │   ├── setup.sh                    ← One-shot installer (Linux/macOS)
│   │   ├── start.sh                    ← Start server (Linux/macOS)
│   │   └── stop.sh                     ← Stop server (Linux/macOS)
│   ├── start_admin.bat                 ← Windows classroom launcher (run as admin)
│   ├── requirements.txt
│   ├── .env.example
│   └── .env                            ← Your config (git-ignored)
├── training/                           ← Model fine-tuning pipeline
│   ├── 01_prepare_dataset.py           ← Build 11,500-example training set
│   ├── 02_finetune.py                  ← QLoRA fine-tune on Gemma 4 E4B (Unsloth)
│   ├── 03_evaluate.py                  ← Benchmark base vs fine-tuned
│   ├── 04_export.py                    ← Export to GGUF + register with Ollama
│   └── README_training.md              ← Training pipeline guide
├── Modelfile                           ← Ollama model definition (fine-tuned)
├── CLAUDE.md                           ← Build plan (phases 0–7)
└── README.md                           ← This file
```

---

## Key Features

### For Students

| Feature | Description |
|---|---|
| **Translate & Learn** | Upload a PDF, image, or paste text — get instant translation into 100+ languages with streaming AI explanation at the student's grade level |
| **AI Tutor Chat** | Conversational tutor that knows the student's name, age, grade, language, and learning history |
| **Text-to-Speech** | Listen to any content read aloud — 11 Piper voices for Latin-script languages + 60+ MMS-TTS languages for non-Latin scripts |
| **Adaptive Quizzes** | Multiple-choice quizzes that adapt to mastery level; Exponential Moving Average tracks progress over time |
| **Multilingual PDF Export** | Download professionally formatted PDFs with Noto fonts for Arabic, Tamil, Sinhala, Ethiopic, Devanagari, and more |
| **LMS Portal** | Courses, assignments, grades, calendar, and announcements in one offline-capable interface |

### For Teachers

| Feature | Description |
|---|---|
| **Real-Time Dashboard** | Class statistics, session counts, student roster |
| **Mastery Heatmap** | Colour-coded grid — students × topics — red/amber/green by mastery score |
| **Automatic Alerts** | Flags students inactive 3+ days, stuck on a topic (<40% mastery, 3+ attempts), or showing declining scores |
| **Quiz Builder** | Create custom multiple-choice quizzes; assign to all students or specific individuals |
| **Material Upload** | Upload PDFs/images that get indexed into FAISS for student retrieval |
| **PDF Weekly Report** | One-click downloadable class progress report with per-student topic breakdown |
| **Network QR Code** | QR code display showing the hotspot URL for quick student onboarding |

### AI Model Routing

```
USE_LOCAL_OLLAMA=true   → Always Ollama (classroom deployment)
USE_LOCAL_OLLAMA=false  → Online: Gemini API
                           Offline: Ollama fallback
```

Both model sizes are available:
- **gemma4:e2b** — fast, low memory, default for most routes
- **gemma4:e4b** — deeper reasoning, used automatically when available

---

## API Reference

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | System status: Ollama, DB, FAISS, active model |

### Students

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/students` | Create student `{name, age, language, grade_level}` |
| GET | `/api/students` | List all students with mastery summaries |
| GET | `/api/students/{id}/progress` | Mastery by topic, quiz history, session log |
| GET | `/api/students/{id}/report` | SSE — AI-written narrative progress report |

### Sessions & Chat

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sessions` | Start a new session `{student_id}` |
| POST | `/api/chat` | SSE — streaming AI tutor chat with tool dispatch |
| POST | `/upload-image` | Upload image → base64 JPEG for attaching to chat |

### Feature 1 — Translate & Learn

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/feature1/languages` | List of 100+ supported target languages |
| POST | `/api/feature1/upload` | Upload PDF / image / text; extract + detect language |
| POST | `/api/feature1/translate` | SSE — stream translation token by token |
| POST | `/api/feature1/explain` | SSE — stream grade-level AI explanation |
| POST | `/api/feature1/ask` | SSE — answer follow-up questions, suggest questions |
| GET | `/api/feature1/materials/{id}/export` | Download multilingual PDF |

### Text-to-Speech

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/tts/speak` | Full text → WAV bytes (single request) |
| POST | `/api/tts/speak-stream` | Sentence-by-sentence binary WAV stream (low latency) |

### Teacher

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teacher/students` | Roster with mastery averages + alert flags |
| GET | `/api/teacher/heatmap` | Students × topics mastery grid |
| GET | `/api/teacher/alerts` | Students currently flagged |
| GET | `/api/teacher/report` | Download PDF weekly report |
| POST | `/api/materials/upload` | Upload teaching material (multipart: file + title + subject) |
| GET | `/api/materials` | List uploaded materials (`?subject=` optional) |
| POST | `/api/teacher/quiz` | Create quiz `{title, subject, questions[], assigned_to}` |
| GET | `/api/teacher/quiz` | List quizzes (`?subject=`, `?student_id=` optional) |

### Quiz

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/quiz/submit` | Submit answers → returns score + EMA mastery update |

---

## Adding Curriculum

Drop plain `.txt` files into `optilearn/data/curriculum/`. Aim for 300–800 words per file, one topic per file. Name files descriptively: `math_fractions.txt`, `science_water_cycle.txt`.

After adding files, rebuild the FAISS vector index:

```bash
# Linux / macOS
source .venv/bin/activate
python data/scripts/build_index.py

# Windows
.\.venv\Scripts\Activate.ps1
python data\scripts\build_index.py
```

New teacher-uploaded materials (via the dashboard) are indexed automatically without a restart.

---

## Model Fine-Tuning

The `training/` directory contains a complete Unsloth QLoRA pipeline for fine-tuning Gemma 4 into a trauma-aware multilingual tutor.

### Training Dataset

| File | Examples | Source |
|---|---|---|
| `dataset/khan_academy.jsonl` | 8,000 | Socratic tutoring dialogues |
| `dataset/unhcr_pedagogy.jsonl` | 500 | Trauma-informed classroom scenarios |
| `dataset/multilingual_qa.jsonl` | 3,000 | Arabic, French, Swahili, Somali, Amharic, Tigrinya, Hausa |
| `dataset/combined_train.jsonl` | 11,500+ | Merged + shuffled training set |
| `dataset/eval_set.jsonl` | 60 | Held-out evaluation set |

### Running on Kaggle (recommended — ~$13 on A100)

1. Upload the `training/` directory to a new Kaggle notebook
2. Enable GPU (Accelerator → A100)
3. Add two Kaggle secrets (Add-ons → Secrets):
   - `HF_TOKEN` — HuggingFace write token
   - `HF_USERNAME` — your HuggingFace username
4. Run all cells in order (~3.5 hours total)

What the training pipeline does:
1. `01_prepare_dataset.py` — Generates and merges 11,500+ training examples
2. `02_finetune.py` — QLoRA fine-tune on `gemma-4-e4b-it` (r=16, alpha=32, 2 epochs, lr=2e-4)
3. `03_evaluate.py` — Benchmark fine-tuned vs base model on 60 held-out examples
4. `04_export.py` — Convert weights to GGUF (q4\_K\_M), register with Ollama

### Using the Fine-Tuned Model Locally

After training completes:

```bash
# 1. Download training/outputs/optilearn-weights/ from Kaggle output panel
# 2. Clone llama.cpp for GGUF conversion
git clone https://github.com/ggerganov/llama.cpp

# 3. Run the export script
python training/04_export.py

# 4. Register the model with Ollama
ollama create optilearn-gemma4 -f Modelfile

# 5. Verify registration
ollama list
# → optilearn-gemma4 should appear

# 6. Update .env
# OLLAMA_MODEL=optilearn-gemma4
# USE_LOCAL_OLLAMA=true
```

---

## Troubleshooting

**`Python 3.11+ required`**
Install Python 3.11 or 3.12 from [python.org](https://www.python.org/downloads/). Python 3.13+ is not supported due to faiss-cpu wheel availability.

**`faiss-cpu` install fails**
Ensure you are using Python 3.11 or 3.12. Run `python --version` to confirm, then recreate the venv with the correct Python binary.

**`400 Bad Request` from Gemini**
Check `GEMMA_API_KEY` in `.env` — no spaces, no quotes around the value, key must be active.

**`Port 8000 already in use`**
Set `PORT=8001` in `.env` and restart. Or kill the existing process: `lsof -ti:8000 | xargs kill` (Linux/macOS) or `netstat -ano | findstr :8000` then `taskkill /PID <pid> /F` (Windows).

**Ollama returns 404**
Run `ollama list` and ensure the model tag matches `OLLAMA_MODEL` in `.env` exactly. Pull the model if missing: `ollama pull gemma4:e2b`.

**Model not loaded — slow first response**
The server preloads the Ollama model at startup (`keep_alive: "60m"`). Wait for the log line `OptiLearn ready` before sending the first request.

**Frontend changes not reflected**
Re-run `npm run build` inside `optilearn/frontend/`, then restart the server.

**Students cannot connect to hotspot URL**
On Windows, make sure you started the server with `start_admin.bat` (not plain `uvicorn`) — it opens the required firewall ports (8000, 53) and sets hotspot DNS automatically. Verify the teacher laptop's hotspot IP with `ipconfig` (Windows) or `ifconfig` (Linux/macOS). Update the URL if it differs from `192.168.137.1`. Use the Teacher Dashboard → Network → QR Code to regenerate.

**TTS has no audio / Piper binary missing**
Download the Piper binary for your OS from [github.com/rhasspy/piper/releases](https://github.com/rhasspy/piper/releases) and place it at `optilearn/bin/piper` (or `optilearn/bin/piper.exe` on Windows). Set `PIPER_BINARY` in `.env` accordingly. MMS-TTS (60+ languages) will still work without Piper.

**MMS-TTS model download fails**
MMS-TTS models download from HuggingFace on first use. Ensure internet access on first run, or pre-download by running:
```python
from transformers import VitsModel, VitsTokenizer
VitsModel.from_pretrained("facebook/mms-tts-som")
VitsTokenizer.from_pretrained("facebook/mms-tts-som")
```
Models are cached locally after the first download.

**`ModuleNotFoundError` on startup**
Activate the virtual environment first:
- Linux/macOS: `source .venv/bin/activate`
- Windows: `.\.venv\Scripts\Activate.ps1`

Then verify the import: `python -c "import fastapi; print('OK')"`.

---

## Design Notes

- **Trauma-aware language:** The words "wrong", "incorrect", "failed", and "mistake" are banned everywhere — UI copy, AI prompts, and system messages. Substitute: "not quite", "let's try again", "good effort".
- **SQLite over PostgreSQL:** Single-file database, WAL mode for concurrent student reads, trivial to back up. Handles 50–100 concurrent students comfortably.
- **EMA mastery tracking:** `new = 0.7 × old + 0.3 × score` — recent performance weights more than history. Novelty penalty prevents gaming by retaking the same questions.
- **SSE over WebSockets:** Unidirectional server→client streaming matches the use case. Works through proxies, has built-in reconnection, simpler server implementation.
- **Chrome/Edge for PDF export:** Reportlab cannot render Arabic, Tamil, or Sinhala correctly without complex OpenType shaping. Headless Chrome handles all Unicode scripts and RTL text automatically.

---

*OptiLearn · Gemma 4 Good Hackathon 2026 · Opti5 Labs · Submit by May 18*
