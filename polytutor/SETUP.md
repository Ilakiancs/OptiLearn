# PolyTutor — Setup Guide

PolyTutor is an offline-first, multilingual adaptive learning agent for refugee camp classrooms. A student photographs a textbook page, and the system explains the concept in the student's language at their level, then assesses understanding with a quiz.

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.11 or higher |
| Node.js | 18 or higher (Phase 2, frontend only) |
| git | Any recent version |

---

## Getting a Gemma API Key

PolyTutor uses Google's Gemma model via the Gemma API during development.

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with a Google account.
3. Click **Create API key** and copy the key value.
4. You will paste this into your `.env` file in step 4 below. The key is free to use within quota limits.

---

## Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd polytutor

# 2. Run the one-shot installer
chmod +x setup.sh start.sh stop.sh
./setup.sh
```

The setup script will:
- Verify Python 3.11+
- Create a `.venv` virtual environment
- Install all pinned dependencies from `requirements.txt`
- Copy `.env.example` → `.env`
- Initialise the SQLite database schema
- Check for curriculum files
- Build the FAISS vector index

---

## Configuration

```bash
# 3. Edit .env and add your API key
nano .env      # or open with any text editor
```

Set:
```
GEMMA_API_KEY=AIzaSy...your_key_here...
```

All other defaults work out of the box for local development.

---

## Starting the Server

```bash
./start.sh
```

The API will be available at: **http://localhost:8000**

Interactive API docs: **http://localhost:8000/docs**

---

## Stopping the Server

```bash
./stop.sh
```

---

## Adding Curriculum Content

Place plain `.txt` files in `data/curriculum/`. Each file should cover one topic and be 300–800 words of clear, simple English. The FAISS index will be rebuilt the next time you run `setup.sh`.

To rebuild the index manually without re-running full setup:
```bash
source .venv/bin/activate
python data/build_index.py
```

---

## Switching to Local Ollama (Offline Mode)

When you are ready to go fully offline (Phase 3):

1. Install [Ollama](https://ollama.com) on the teacher's laptop.
2. Pull the Gemma model: `ollama pull gemma4:9b`
3. In `.env`, change these two values:
   ```
   USE_LOCAL_OLLAMA=true
   OLLAMA_MODEL=gemma4:9b
   ```
4. Restart the server: `./stop.sh && ./start.sh`

No other changes are needed — the model client routes automatically.

---

## Troubleshooting

### 1. "Python 3.11+ required"
**Cause:** Your system Python is older.
**Fix:** Download Python 3.11 or higher from [python.org](https://www.python.org/downloads/), then re-run `./setup.sh`.

### 2. "FAISS index not found" warning in logs
**Cause:** The index has not been built yet (no curriculum files when `./setup.sh` ran).
**Fix:** Add `.txt` files to `data/curriculum/`, then run `python data/build_index.py`.

### 3. "400 Bad Request" from Gemma API
**Cause:** Invalid or missing API key.
**Fix:** Check `GEMMA_API_KEY` in `.env`. Make sure there are no leading/trailing spaces.

### 4. "Port 8000 already in use"
**Cause:** Another process is using port 8000.
**Fix:** Either stop the other process, or change `PORT=8001` in `.env` and restart.

### 5. Quiz returns invalid JSON
**Cause:** Gemma occasionally wraps JSON in markdown code fences despite instructions.
**Fix:** This is handled automatically by `tools.py`. If it persists, check your model version in `.env` (`GEMMA_MODEL`).
