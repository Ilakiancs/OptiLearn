# OptiLearn

## Prerequisites

| Tool    | Version | Notes                                                |
| ------- | ------- | ---------------------------------------------------- |
| Python  | 3.11+   | [python.org](https://www.python.org/downloads/)      |
| Node.js | 18+     | [nodejs.org](https://nodejs.org/) — frontend only    |
| git     | any     |                                                      |
| Ollama  | latest  | Offline mode only — [ollama.com](https://ollama.com) |

---

## Quick Start

### 1. Clone and enter the project

```bash
git clone https://github.com/Ilakiancs/OptiLearn
cd Optilearn/optilearn
```

### 2. Run the one-shot installer

```bash
chmod +x scripts/setup.sh scripts/start.sh scripts/stop.sh
./scripts/setup.sh
```

This will:

- Verify Python 3.11+
- Create a `.venv` virtual environment and install all dependencies
- Copy `.env.example` → `.env`
- Initialise the SQLite database
- Build the FAISS curriculum index

### 3. Add your API key

```bash
nano .env
```

Set `GEMMA_API_KEY` to your [Google AI Studio](https://aistudio.google.com/app/apikey) key (free within quota):

```
GEMMA_API_KEY=your_key
```

### 4. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

### 5. Start the server

```bash
./scripts/start.sh
```

| URL                          | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `http://localhost:8000`      | Main app (students + teacher dashboard) |
| `http://localhost:8000/docs` | Interactive API docs                    |

### 6. Stop the server

```bash
./scripts/stop.sh
```

---

## Offline Mode (Ollama)

For fully offline classroom use:

```bash
# Install Ollama, then pull the model
ollama pull optilearn-gemma4
```

In `.env`, switch:

```
USE_LOCAL_OLLAMA=true
OLLAMA_MODEL=optilearn-gemma4
```

Restart: `./scripts/stop.sh && ./scripts/start.sh`

Students connect via the teacher laptop's hotspot at `http://192.168.137.1:8000`.

---

## Environment Variables

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
