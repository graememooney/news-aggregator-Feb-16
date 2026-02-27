# app/config.py
from pydantic import BaseModel
import os


def _env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    try:
        return int(v)
    except ValueError:
        return default


def _env_str(name: str, default: str) -> str:
    v = os.getenv(name)
    return default if v is None else v


class Settings(BaseModel):
    # OpenAI
    openai_api_key: str = _env_str("OPENAI_API_KEY", "")
    openai_model: str = _env_str("OPENAI_MODEL", "gpt-4o-mini")

    # Worker controls
    worker_enabled: bool = _env_str("WORKER_ENABLED", "1") == "1"
    worker_interval_seconds: int = _env_int("WORKER_INTERVAL_SECONDS", 180)
    worker_batch_size: int = _env_int("WORKER_BATCH_SIZE", 20)
    worker_max_per_cycle: int = _env_int("WORKER_MAX_PER_CYCLE", 60)

    # Cache aging (TTL)
    # How long an enrichment is considered fresh.
    cache_ttl_seconds: int = _env_int("CACHE_TTL_SECONDS", 7 * 24 * 3600)  # default 7 days

    # SQLite
    sqlite_path: str = _env_str("SQLITE_PATH", "data/enrich_cache.sqlite3")


settings = Settings()