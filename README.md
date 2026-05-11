# OptiLearn

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.11 or 3.12 (3.13+ not supported) |
| Node.js | 18+ |
| npm | 9+ |
| Ollama | latest — [ollama.com](https://ollama.com) |

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Ilakiancs/OptiLearn
cd OptiLearn/optilearn
```

### 2. Pull the Ollama model

```bash
ollama pull gemma4:e2b
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set your values:

```env
# Offline only (classroom mode)
USE_LOCAL_OLLAMA=true
OLLAMA_MODEL=gemma4:e2b
OLLAMA_MODEL_FAST=gemma4:e2b

# Online mode (uses Gemma 26B API when internet is available)
USE_LOCAL_OLLAMA=false
GEMMA_26B_API_KEY=your_google_ai_studio_key_here
GEMMA_26B_MODEL=gemma-4-31b-it

# Persona voice chat (optional — requires Beyond Presence account)
BEY_API_KEY=your_bey_api_key_here
```

Get a free Google AI Studio key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

---

## Run — Linux / macOS

```bash
# Install everything and build the FAISS index
chmod +x scripts/setup.sh scripts/start.sh scripts/stop.sh
./scripts/setup.sh

# Build the frontend
cd frontend && npm install && npm run build && cd ..

# Start Ollama (keep this running in a separate terminal)
ollama serve

# Start OptiLearn
./scripts/start.sh
```

Stop the server:

```bash
./scripts/stop.sh
```

---

## Run — Windows

```powershell
# Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Initialise the database
python -c "import asyncio; from app.services.db import init_db; asyncio.run(init_db())"

# Build FAISS curriculum index
python data\scripts\build_index.py

# Build the frontend
cd frontend
npm install
npm run build
cd ..
```

Start the server:

```powershell
# Development
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Classroom deployment (handles firewall + hotspot DNS automatically)
# Right-click start_admin.bat → Run as administrator
```

---

## Open the app

| URL | Purpose |
|---|---|
| `http://localhost:8000` | Main app |
| `http://localhost:8000/docs` | API docs |

For classroom use, students connect from their devices at `http://<teacher-laptop-ip>:8000`. The QR code is available in the Teacher Dashboard → Network tab.

---

## Troubleshooting

**Port already in use**
```bash
# Linux/macOS
lsof -ti:8000 | xargs kill

# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**Ollama not running**
```bash
ollama serve
```

**Model not found**
```bash
ollama pull gemma4:e2b
ollama list  # verify tag matches OLLAMA_MODEL in .env
```

**Frontend changes not showing**
```bash
cd frontend && npm run build
```

**`ModuleNotFoundError` on startup**
```bash
# Linux/macOS
source .venv/bin/activate

# Windows
.\.venv\Scripts\Activate.ps1
```

**Students can't connect on Windows**  
Use `start_admin.bat` instead of plain `uvicorn` — it opens the required firewall ports (8000, 53) and configures hotspot DNS automatically.
