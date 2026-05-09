# OptiLearn

An offline-first, multilingual adaptive learning system for refugee camp classrooms. Students photograph textbook pages, and the system explains concepts in their language at their level, then assesses understanding with personalized quizzes.

---

## Prerequisites

| Tool    | Version | Notes                                           |
| ------- | ------- | ----------------------------------------------- |
| Python  | 3.11+   | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+     | [nodejs.org](https://nodejs.org/)              |
| pnpm    | latest  | Frontend package manager                        |
| Ollama  | latest  | Optional — for offline mode only                |

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

### 3. Install Backend Dependencies

```bash
pip install -r requirements.txt
```

### 4. Install & Build Frontend

```bash
cd frontend
pnpm install
pnpm run build
cd ..
```

### 5. Configure API Key

Create a `.env` file in the `optilearn/` directory:

```bash
copy .env.example .env
```

Edit `.env` and set your Google Gemma API key (get it free from [Google AI Studio](https://aistudio.google.com/app/apikey)):

```
GEMMA_API_KEY=AIzaSy_your_key_here
USE_LOCAL_OLLAMA=false
```

### 6. Initialize Database & Build Curriculum Index

```bash
python -c "from app.services.db import init_db; init_db()"
python data/scripts/build_index.py
```

### 7. Start the Server

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Access the application:**
- Main app: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

---

## Quick Start (Linux/Mac)

### 1. Navigate to the project

```bash
cd optilearn
```

### 2. Run the Automated Setup

```bash
chmod +x scripts/setup.sh scripts/start.sh scripts/stop.sh
./scripts/setup.sh
```

This script will:
- Verify Python 3.11+
- Create `.venv` virtual environment
- Install all dependencies from `requirements.txt`
- Copy `.env.example` → `.env`
- Initialize the SQLite database
- Build the FAISS curriculum index

### 3. Configure API Key

```bash
nano .env
```

Add your Google Gemma API key:

```
GEMMA_API_KEY=AIzaSy_your_key_here
```

### 4. Start the Server

```bash
./scripts/start.sh
```

**Access the application:**
- Main app: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

### 5. Stop the Server

```bash
./scripts/stop.sh
```

---

## Offline Mode (Ollama)

For fully offline operation without requiring internet or external API keys:

### 1. Install Ollama

Download from [ollama.com](https://ollama.com)

### 2. Pull the Model

```bash
ollama pull gemma2
```

### 3. Update Configuration

Edit `.env`:

```
USE_LOCAL_OLLAMA=true
OLLAMA_MODEL=gemma2
OLLAMA_BASE_URL=http://localhost:11434
```

### 4. Restart the Server

**On Windows:**
```bash
# Kill the running server and restart
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**On Linux/Mac:**
```bash
./scripts/stop.sh
./scripts/start.sh
```

### 5. Classroom Hotspot Access

Students can connect via the teacher's machine hotspot at:
```
http://192.168.137.1:8000
```

---

## Development

### Run Backend Only (No Frontend Build)

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Run Frontend Development Server

```bash
cd frontend
pnpm run dev
```

This starts Vite dev server on `http://localhost:5173`

### Rebuild Frontend

```bash
cd frontend
pnpm run build
```

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `GEMMA_API_KEY` | (required) | Google AI API key for Gemma model |
| `USE_LOCAL_OLLAMA` | `false` | Use local Ollama instead of Google API |
| `OLLAMA_MODEL` | `gemma2` | Ollama model to use |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `DATABASE_URL` | `sqlite:///./data/optilearn.db` | SQLite database path |

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

| Variable           | Default                 | Description                                   |
| ------------------ | ----------------------- | --------------------------------------------- |
| `USE_LOCAL_OLLAMA` | `false`                 | `true` = Ollama offline, `false` = Gemini API |
| `GEMMA_API_KEY`    | _(required when false)_ | Google AI Studio key                          |
| `GEMMA_MODEL`      | `gemini-2.0-flash`      | Gemini model name                             |
| `OLLAMA_MODEL`     | `optilearn-gemma4`      | Ollama model tag                              |
| `DB_PATH`          | `./data/optilearn.db`   | SQLite database path                          |
| `PORT`             | `8000`                  | Server port                                   |

Full list in `.env.example`.

---

## Structure

```
optilearn/
├── app/
│   ├── main.py                  # FastAPI entry point
│   ├── api/routes/              # chat, sessions, students, dashboard, quiz
│   ├── core/                    # config, prompts
│   ├── models/schemas.py        # Pydantic models
│   ├── services/                # db, faiss_store, model_client
│   └── tools/agent_tools.py    # agent tool definitions
├── data/
│   ├── curriculum/              # .txt lesson files (add your own here)
│   └── scripts/build_index.py  # rebuild FAISS index manually
├── frontend/                    # React + Vite (npm run build → dist/)
├── scripts/                     # setup.sh, start.sh, stop.sh
├── requirements.txt
└── .env.example
```

---

## Adding Curriculum

Drop plain `.txt` files (300–800 words each, one topic per file) into `data/curriculum/`, then rebuild the index:

```bash
source .venv/bin/activate
python data/scripts/build_index.py
```

---

## Problems

**`Python 3.11+ required`** — install a newer Python and re-run `./scripts/setup.sh`.

**`faiss-cpu` install fails** — make sure you have Python 3.11–3.12. faiss-cpu wheels are not published for all Python versions; downgrade if needed.

**`400 Bad Request` from Gemini** — check `GEMMA_API_KEY` in `.env` (no spaces, no quotes).

**`Port 8000 already in use`** — set `PORT=8001` in `.env` and restart.

**Ollama returns 404** — run `ollama list` and make sure the model tag matches `OLLAMA_MODEL` in `.env` exactly.

**Frontend changes not reflected** — re-run `npm run build` inside `frontend/`, then restart the server.
