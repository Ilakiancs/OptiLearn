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
    GEMMA_MODEL: str = "gemma-2.0-flash-exp"

    # Ollama
    OLLAMA_HOST: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "gemma4:9b"

    # Language detection
    LANGDETECT_CONFIDENCE_THRESHOLD: float = 0.85

    # Storage
    DB_PATH: str = "./data/polytutor.db"
    FAISS_INDEX_PATH: str = "./data/curriculum.index"
    FAISS_META_PATH: str = "./data/curriculum_meta.json"
    CURRICULUM_DIR: str = "./data/curriculum"

    # Embeddings
    EMBED_MODEL: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # Image processing
    IMAGE_MAX_PX: int = 1024

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    FRONTEND_DIST: str = "./frontend/dist"


# Singleton — import this in all other modules
settings = Settings()
