# OptiLearn

**Offline-first multilingual adaptive AI learning agent for refugee and underserved classrooms.**

Built for the [Gemma 4 Good Hackathon 2026](https://www.kaggle.com/competitions/gemma-4-good-hackathon/overview) by Opti5 Labs. The teacher laptop becomes a local AI tutoring server — students connect via WiFi hotspot with no internet required.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Running the App](#running-the-app)
  - [Desktop App (Recommended)](#desktop-app-recommended)
  - [Web App — Linux / macOS](#web-app--linux--macos)
  - [Web App — Windows](#web-app--windows)
- [Offline Classroom Mode (Ollama)](#offline-classroom-mode-ollama)
- [First-Launch Teacher Setup](#first-launch-teacher-setup)
- [Admin Tools](#admin-tools)
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
│  └──────────────┘    │   ┌─────────┐  ┌────────┐  ┌──────────┐│  │
│                      │   │  SQLite │  │ FAISS  │  │ Piper /  ││  │
│                      │   │    DB   │  │ Index  │  │ MMS TTS  ││  │
│                      │   └─────────┘  └────────┘  └──────────┘│  │
│                      │  React frontend (served as static files) │  │
│                      └─────────────────────────────────────────┘  │
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

## Running the App

### Desktop App (Recommended)

The easiest way to run OptiLearn — no Python or Node setup required. Download the installer for your platform from the [Releases](https://github.com/Ilakiancs/OptiLearn/releases) page.

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `OptiLearn-1.0.0.dmg` |
| Windows x64 | `OptiLearn Setup 1.0.0.exe` |
| Windows ARM64 | `OptiLearn Setup 1.0.0-arm64.exe` |

**macOS note:** The app is unsigned. Right-click → Open to bypass the Gatekeeper warning (one time only).

**Windows note:** Click "More info" → "Run anyway" to bypass SmartScreen.

#### First-launch wizard

On first open, a setup wizard guides you through:

1. **API Keys** — optional Gemini and Beyond Presence keys (or skip for offline-only)
2. **Ollama** — checks if Ollama is installed; opens the download page if not
3. **AI Model** — downloads Gemma 4 2B (~1.5 GB) or 4B (~2.5 GB) directly in the app

After setup, the app starts automatically and remembers your configuration. Subsequent launches go straight to the loading screen.

App data (database, materials, settings) is stored in:
- **Mac**: `~/Library/Application Support/OptiLearn/`
- **Windows**: `%APPDATA%\OptiLearn\`

To re-run the setup wizard, delete `.setup-done` from the data directory above.

---

### Web App — Linux / macOS

```bash
# 1. Clone and enter the app directory
git clone https://github.com/Ilakiancs/OptiLearn
cd OptiLearn/optilearn

# 2. Run the one-shot installer
chmod +x scripts/setup.sh scripts/start.sh scripts/stop.sh
./scripts/setup.sh
```

The setup script will:
- Verify Python 3.11 or 3.12
- Create a `.venv` and install all Python dependencies
- Copy `.env.example` → `.env`
- Initialise the SQLite database
- Build the FAISS curriculum vector index

```bash
# 3. Build the React frontend
cd frontend && npm install && npm run build && cd ..

# 4. Start the server
./scripts/start.sh
```

On **first start**, if no teacher account exists, the script prompts for:
- Display name, username, email (optional), password

This creates the admin account before the server starts.

| URL | Purpose |
|---|---|
| `http://localhost:8000` | Main app |
| `http://localhost:8000/docs` | Interactive API docs |

```bash
# Stop the server
./scripts/stop.sh
```

---

### Web App — Windows

```powershell
# 1. Clone and enter the app directory
git clone https://github.com/Ilakiancs/OptiLearn
cd OptiLearn\optilearn

# 2. Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 4. Copy environment file and set API key
copy .env.example .env
# Open .env and set GEMMA_API_KEY if using online mode

# 5. Initialise database
python -c "import asyncio; from app.services.db import init_db; asyncio.run(init_db())"

# 6. Build FAISS index
python data\scripts\build_index.py

# 7. Build frontend
cd frontend && npm install && npm run build && cd ..
```

For classroom deployment on Windows, use `start_admin.bat` (see below) — it handles firewall rules, hotspot DNS, and the frontend build automatically.

For development: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`

#### start_admin.bat — Windows Classroom Launcher

Double-click `optilearn/start_admin.bat` (or right-click → Run as administrator). It will:

1. Elevate to admin if needed
2. Open Windows Firewall for ports 8000 and 53
3. Set hotspot DNS to `192.168.137.1`
4. Build the frontend
5. Start uvicorn

Keep the terminal open for the duration of the class. Close it to stop the server.

---

## Offline Classroom Mode (Ollama)

### 1 — Install Ollama

Download from [ollama.com](https://ollama.com). Verify: `ollama --version`

### 2 — Pull models

```bash
ollama pull gemma4:e2b    # fast, default — runs on most hardware
ollama pull gemma4:e4b    # optional — better reasoning, ~12 GB RAM
```

### 3 — Configure .env

```env
USE_LOCAL_OLLAMA=true
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL_FAST=gemma4:e2b
OLLAMA_MODEL_DEEP=gemma4:e4b
```

### 4 — Set up WiFi hotspot

- **Windows:** Settings → Mobile Hotspot → Turn On
- **Linux:** `nmcli device wifi hotspot ssid OptiLearn password classroom123`
- **macOS:** System Settings → Sharing → Internet Sharing

Students connect to the hotspot SSID and open: `http://192.168.137.1:8000`

The QR code for this URL is available from Teacher Dashboard → Network tab.

---

## First-Launch Teacher Setup

### Desktop app
The setup wizard handles this — enter your display name, username, and password on the final screen of first launch.

### Web app (script)
`scripts/start.sh` detects if no teacher account exists and prompts interactively before starting the server:

```
Display name: Ms. Amara
Username: teacher
Email (optional): amara@school.org
Password: ••••••••
Confirm password: ••••••••
```

### Web app (browser)
Navigate to `http://localhost:8000/setup` — the setup screen appears automatically if no teacher account exists.

---

## Admin Tools

### Reset forgotten credentials

```bash
cd optilearn
./scripts/reset-admin.sh
```

Options:
1. **Reset password** for an existing teacher account
2. **Create a new admin** teacher account
3. **`--nuke-db`** flag — wipe the entire database (requires typing `DELETE` to confirm)

### Update API keys without restart

The running server exposes an endpoint to update keys live:

```bash
curl -X POST http://localhost:8000/api/settings/api-keys \
  -H "Content-Type: application/json" \
  -d '{"gemma_api_key": "AIza...", "use_local_ollama": false}'
```

Changes are written to `.env` and applied immediately — no server restart needed.

---

## Environment Variables

All configuration lives in `optilearn/.env` (created from `.env.example` during setup).

| Variable | Default | Description |
|---|---|---|
| `USE_LOCAL_OLLAMA` | `true` | `true` = always use Ollama; `false` = Gemini API when online |
| `GEMMA_API_KEY` | _(empty)_ | Google AI Studio key — required when `USE_LOCAL_OLLAMA=false` |
| `GEMINI_MODEL` | `gemma-4-31b-it` | Gemini model for online fallback |
| `BEY_API_KEY` | _(empty)_ | Beyond Presence key — enables AI avatar voice chat |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL_FAST` | `gemma4:e2b` | Fast routing model |
| `OLLAMA_MODEL_DEEP` | `gemma4:e4b` | Deep routing model |
| `DB_PATH` | `./data/optilearn.db` | SQLite database path |
| `FAISS_INDEX_PATH` | `./data/curriculum.index` | FAISS index path |
| `CURRICULUM_DIR` | `./data/curriculum` | Directory of `.txt` lesson files |
| `MATERIALS_DIR` | `./data/materials` | Teacher-uploaded materials |
| `EMBED_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | Sentence transformer for embeddings |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `PIPER_BINARY` | `./bin/piper` | Path to Piper TTS binary |
| `VOICES_DIR` | `./data/voices` | Piper `.onnx` voice models |
| `IMAGE_MAX_PX` | `1024` | Max image dimension before resize |
| `WHISPER_BINARY` | `./bin/whisper` | Whisper binary for live transcription |
| `WHISPER_MODEL` | `./data/whisper-models/ggml-base.bin` | Whisper model file |

In the desktop app, configuration is stored in the OS user data directory and managed through the setup wizard. The `ENV_FILE` environment variable points the server to the correct location automatically.

---

## Project Structure

```
OptiLearn/
├── optilearn/                          ← Main web application
│   ├── app/
│   │   ├── main.py                     ← App factory, startup, lifespan
│   │   ├── api/routes/
│   │   │   ├── auth.py                 ← Teacher login, setup, session
│   │   │   ├── chat.py                 ← SSE streaming chat + image upload
│   │   │   ├── dashboard.py            ← Teacher dashboard aggregates
│   │   │   ├── feature1.py             ← Translate/explain/ask + TTS routes
│   │   │   ├── live_class.py           ← Live class session management
│   │   │   ├── materials.py            ← Material upload + FAISS indexing
│   │   │   ├── persona.py              ← AI avatar (Beyond Presence) integration
│   │   │   ├── quiz.py                 ← Quiz submission + EMA scoring
│   │   │   ├── sessions.py             ← Session management
│   │   │   ├── settings.py             ← Network mode + API key management
│   │   │   ├── students.py             ← Student CRUD + progress reports
│   │   │   └── teacher.py              ← Roster, heatmap, alerts, PDF report
│   │   ├── core/
│   │   │   ├── config.py               ← pydantic-settings; reads ENV_FILE in desktop mode
│   │   │   └── prompts.py              ← Trauma-aware tutor system prompt builder
│   │   ├── models/schemas.py           ← Pydantic request/response models
│   │   └── services/
│   │       ├── db.py                   ← SQLite schema + async helpers (teachers + students)
│   │       ├── faiss_store.py          ← Lazy singleton FAISS vector index
│   │       ├── model_client.py         ← Unified Ollama / Gemini router + force-offline toggle
│   │       └── tts_client.py           ← Hybrid Piper + MMS-TTS engine
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── api/client.js           ← All API calls + streamSSE helper
│   │   │   ├── components/             ← Reusable UI components
│   │   │   ├── screens/                ← Full-page screens (home, dashboard, live class, etc.)
│   │   │   ├── App.jsx                 ← Router + route definitions
│   │   │   └── main.jsx                ← React entry point
│   │   ├── vite.config.js
│   │   └── package.json
│   ├── data/
│   │   ├── curriculum/                 ← Plain .txt lesson files (add your own)
│   │   ├── curriculum.index            ← FAISS vector index (auto-built)
│   │   └── scripts/build_index.py      ← Rebuild FAISS index manually
│   ├── scripts/
│   │   ├── setup.sh                    ← One-shot installer (Linux/macOS)
│   │   ├── start.sh                    ← Start server + first-run teacher setup prompt
│   │   ├── stop.sh                     ← Stop server
│   │   └── reset-admin.sh             ← Reset password / create admin / nuke DB
│   ├── start_admin.bat                 ← Windows classroom launcher (run as admin)
│   ├── requirements.txt
│   └── .env.example
├── desktop/                            ← Electron desktop wrapper
│   ├── electron/
│   │   ├── main.js                     ← Main process: setup wizard, server spawn, tray
│   │   ├── preload.js                  ← Context bridge for main app window
│   │   ├── preload-setup.js            ← IPC bridge for setup wizard
│   │   └── setup.html                  ← First-launch setup wizard UI
│   ├── scripts/
│   │   ├── build.sh                    ← Build script (frontend + python bundle + electron-builder)
│   │   ├── bundle_python.py            ← Copies .venv into python-runtime/
│   │   └── dev.sh                      ← Run in dev mode without building
│   ├── assets/                         ← App icons
│   ├── package.json                    ← Electron + electron-builder config
│   └── README.md                       ← Desktop-specific build and release guide
├── finetuning/                         ← Model fine-tuning pipeline
│   ├── 01_prepare_dataset.py
│   ├── 02_finetune.py
│   ├── 03_evaluate.py
│   ├── 04_export.py
│   ├── Modelfile
│   └── README.md
└── README.md                           ← This file
```

---

## Key Features

### For Students

| Feature | Description |
|---|---|
| **Translate & Learn** | Upload a PDF, image, or paste text — instant translation into 100+ languages with streaming AI explanation at the student's grade level |
| **AI Tutor Chat** | Conversational tutor that knows the student's name, age, grade, language, and learning history |
| **Text-to-Speech** | Listen to any content read aloud — 11 Piper voices for Latin-script languages + 60+ MMS-TTS languages for non-Latin scripts |
| **Adaptive Quizzes** | Multiple-choice quizzes that adapt to mastery level; EMA tracks progress over time |
| **Multilingual PDF Export** | Professionally formatted PDFs with Noto fonts for Arabic, Tamil, Sinhala, Ethiopic, Devanagari, and more |
| **AI Avatar Chat** | Voice-enabled AI persona powered by Beyond Presence (online mode, API key required) |

### For Teachers

| Feature | Description |
|---|---|
| **Real-Time Dashboard** | Class statistics, session counts, student roster |
| **Mastery Heatmap** | Colour-coded grid — students × topics — red/amber/green by mastery score |
| **Automatic Alerts** | Flags students inactive 3+ days, stuck on a topic, or showing declining scores |
| **Quiz Builder** | Create custom quizzes; assign to all students or specific individuals |
| **Material Upload** | Upload PDFs/images indexed into FAISS for student retrieval |
| **PDF Weekly Report** | One-click downloadable class progress report |
| **Live Class Mode** | Real-time class session with live translation and AI notes |
| **Network QR Code** | QR code of the hotspot URL for quick student onboarding |

### AI Model Routing

```
USE_LOCAL_OLLAMA=true   → Always Ollama (classroom, offline)
USE_LOCAL_OLLAMA=false  → Online: Gemini API
                           Offline: Ollama fallback (automatic)
```

The teacher can toggle online/offline mode from the dashboard at any time without restarting the server.

---

## API Reference

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | System status: Ollama, DB, FAISS, active model |

### Auth

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/setup-required` | Check if first-time setup is needed |
| POST | `/api/auth/setup` | Create first teacher account |
| POST | `/api/auth/login` | Teacher login |
| POST | `/api/auth/logout` | Teacher logout |

### Students

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/students` | Create student |
| GET | `/api/students` | List all students |
| GET | `/api/students/{id}/progress` | Mastery by topic, quiz history, session log |
| GET | `/api/students/{id}/report` | SSE — AI-written progress report |

### Sessions & Chat

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sessions` | Start session |
| POST | `/api/chat` | SSE — streaming AI tutor chat |
| POST | `/upload-image` | Upload image for chat |

### Feature 1 — Translate & Learn

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/feature1/languages` | 100+ supported languages |
| POST | `/api/feature1/upload` | Upload PDF / image / text |
| POST | `/api/feature1/translate` | SSE — stream translation |
| POST | `/api/feature1/explain` | SSE — stream AI explanation |
| POST | `/api/feature1/ask` | SSE — follow-up questions |
| GET | `/api/feature1/materials/{id}/export` | Download PDF |

### Text-to-Speech

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/tts/speak` | Full text → WAV |
| POST | `/api/tts/speak-stream` | Sentence-by-sentence binary stream |

### Teacher

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teacher/students` | Roster with mastery + alert flags |
| GET | `/api/teacher/heatmap` | Students × topics mastery grid |
| GET | `/api/teacher/alerts` | Currently flagged students |
| GET | `/api/teacher/report` | PDF weekly report |
| POST | `/api/materials/upload` | Upload teaching material |
| POST | `/api/teacher/quiz` | Create quiz |
| GET | `/api/teacher/quiz` | List quizzes |

### Settings

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/settings/network-mode` | Current mode + network status |
| POST | `/api/settings/network-mode` | Toggle `offline` / `auto` |
| GET | `/api/settings/api-keys` | Check which keys are configured (masked) |
| POST | `/api/settings/api-keys` | Update API keys live (no restart needed) |

---

## Adding Curriculum

Drop plain `.txt` files into `optilearn/data/curriculum/`. One topic per file, 300–800 words. Name files descriptively: `math_fractions.txt`, `science_water_cycle.txt`.

Rebuild the FAISS index after adding files:

```bash
# Linux / macOS
source .venv/bin/activate
python data/scripts/build_index.py

# Windows
.\.venv\Scripts\Activate.ps1
python data\scripts\build_index.py
```

Teacher-uploaded materials (via the dashboard) are indexed automatically without a restart.

---

## Model Fine-Tuning

The `finetuning/` directory contains a complete Unsloth QLoRA pipeline for fine-tuning Gemma 4 into a trauma-aware multilingual tutor.

| File | Examples | Source |
|---|---|---|
| `dataset/khan_academy.jsonl` | 8,000 | Socratic tutoring dialogues |
| `dataset/unhcr_pedagogy.jsonl` | 500 | Trauma-informed classroom scenarios |
| `dataset/multilingual_qa.jsonl` | 3,000 | Arabic, French, Swahili, Somali, Amharic, Tigrinya, Hausa |

### Running on Kaggle (~$13 on A100)

1. Upload the `finetuning/` directory to a new Kaggle notebook
2. Enable GPU (A100)
3. Add Kaggle secrets: `HF_TOKEN`, `HF_USERNAME`
4. Run all cells in order (~3.5 hours)

### Using the fine-tuned model

```bash
ollama create optilearn-gemma4 -f finetuning/Modelfile
# Then set OLLAMA_TUTOR_MODEL=optilearn-gemma4 in .env
```

---

## Troubleshooting

**"This app can't run on your PC" (Windows)**
Download the correct installer — `arm64` for Surface/Snapdragon devices, `x64` for everything else. To check: `(Get-WmiObject Win32_Processor).Architecture` in PowerShell (`9` = x64, `12` = ARM64).

**API keys not switching to online mode**
The `.env` must be edited before the server starts — the server reads it once at startup. In the desktop app this is handled automatically by the setup wizard. In the web app, edit `optilearn/.env` then restart the server. You can also update keys live via `POST /api/settings/api-keys` (see API Reference).

**`Python 3.11+ required`**
Install Python 3.11 or 3.12. Python 3.13+ is not supported (faiss-cpu wheel availability).

**`faiss-cpu` install fails**
Confirm `python --version` is 3.11 or 3.12, then recreate the venv.

**`400 Bad Request` from Gemini**
Check `GEMMA_API_KEY` in `.env` — no spaces, no quotes, key must be active.

**Port 8000 already in use**
`lsof -ti:8000 | xargs kill` (Linux/macOS) or `netstat -ano | findstr :8000` + `taskkill /PID <pid> /F` (Windows).

**Ollama returns 404**
`ollama list` — confirm the model tag matches `OLLAMA_MODEL_FAST` in `.env`. Pull if missing: `ollama pull gemma4:e2b`.

**Frontend changes not reflected**
Re-run `npm run build` inside `optilearn/frontend/`, then restart the server.

**Students cannot connect to hotspot**
On Windows, use `start_admin.bat` — it opens firewall ports 8000 and 53. Verify the hotspot IP with `ipconfig` and check the Teacher Dashboard → Network → QR Code.

**Forgot teacher password**
Run `./scripts/reset-admin.sh` (Linux/macOS) and choose option 1 to reset the password.

**TTS has no audio / Piper binary missing**
Download the Piper binary from [github.com/rhasspy/piper/releases](https://github.com/rhasspy/piper/releases) and place it at `optilearn/bin/piper`. MMS-TTS (60+ languages) still works without Piper.

---

## Design Notes

- **Trauma-aware language:** "Wrong", "incorrect", "failed", and "mistake" are banned in all UI copy, AI prompts, and system messages. Substitute: "not quite", "let's try again", "good effort".
- **SQLite over PostgreSQL:** Single-file database, WAL mode for concurrent reads, trivial to back up.
- **EMA mastery tracking:** `new = 0.7 × old + 0.3 × score` — recent performance weights more than history.
- **SSE over WebSockets:** Unidirectional streaming matches the use case, works through proxies, has built-in reconnection.
- **Desktop app:** Electron wraps the web app unchanged — the same FastAPI server and React frontend run inside a native window. No code duplication.

---

*OptiLearn · Gemma 4 Good Hackathon 2026 · Opti5 Labs*
