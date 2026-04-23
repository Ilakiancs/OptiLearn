"""
app/core/config.py — centralised configuration via pydantic-settings BaseSettings.

All other files import `settings` from here. No file may read os.environ directly.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from the .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )

    # Model backend
    USE_LOCAL_OLLAMA: bool = False

    # Gemma API
    GEMMA_API_KEY: str = ""
    GEMMA_MODEL: str = "gemini-2.0-flash"

    # Ollama
    OLLAMA_HOST: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "optilearn-gemma4"

    # Language detection
    LANGDETECT_CONFIDENCE_THRESHOLD: float = 0.85

    # Storage
    DB_PATH: str = "./data/optilearn.db"
    FAISS_INDEX_PATH: str = "./data/curriculum.index"
    FAISS_META_PATH: str = "./data/curriculum_meta.json"
    CURRICULUM_DIR: str = "./data/curriculum"

    # Embeddings
    EMBED_MODEL: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # Image processing
    IMAGE_MAX_PX: int = 1024

    # Materials storage
    MATERIALS_DIR: str = "./data/materials"

    # Whisper / TTS (Phase 2–3, not used yet)
    WHISPER_BINARY: str = "./bin/whisper"
    WHISPER_MODEL: str = "./data/whisper-models/ggml-base.bin"
    PIPER_BINARY: str = "./bin/piper"
    VOICES_DIR: str = "./data/voices"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    FRONTEND_DIST: str = "./frontend/dist"


# Singleton — import this in all other modules
settings = Settings()
