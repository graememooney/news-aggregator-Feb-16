# app/worker.py
import threading
import time
from typing import Callable, Dict, Any, List, Set

from .config import settings
from .enrichment import get_cached_enrichment, enrich_if_needed


class WorkerState:
    def __init__(self):
        self.running = False
        self.last_cycle_utc = None
        self.last_error = None
        self.total_enriched = 0


class EnrichmentWorker:
    def __init__(self, fetch_recent_articles: Callable[[], List[Dict[str, Any]]]):
        self.fetch_recent_articles = fetch_recent_articles
        self.state = WorkerState()
        self._thread = None
        self._stop = threading.Event()
        self._in_flight: Set[str] = set()
        self._lock = threading.Lock()

    def start(self) -> None:
        if not settings.worker_enabled:
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": settings.worker_enabled,
            "running": self.state.running,
            "last_cycle_utc": self.state.last_cycle_utc,
            "last_error": self.state.last_error,
            "total_enriched": self.state.total_enriched,
            "interval_seconds": settings.worker_interval_seconds,
            "batch_size": settings.worker_batch_size,
            "max_per_cycle": settings.worker_max_per_cycle,
            "cache_ttl_seconds": settings.cache_ttl_seconds,
        }

    def _mark_in_flight(self, link: str) -> bool:
        with self._lock:
            if link in self._in_flight:
                return False
            self._in_flight.add(link)
            return True

    def _unmark_in_flight(self, link: str) -> None:
        with self._lock:
            self._in_flight.discard(link)

    def _run(self) -> None:
        from datetime import datetime, timezone

        while not self._stop.is_set():
            self.state.running = True
            self.state.last_error = None
            self.state.last_cycle_utc = datetime.now(timezone.utc).isoformat()

            try:
                articles = self.fetch_recent_articles()

                # Identify candidates (missing or expired)
                candidates: List[Dict[str, Any]] = []
                for a in articles:
                    link = (a.get("link") or "").strip()
                    if not link:
                        continue

                    title_en, summary_en, fresh = get_cached_enrichment(link)
                    missing = not (title_en and summary_en)
                    expired = (title_en and summary_en and not fresh)

                    if missing or expired:
                        candidates.append(a)

                # Enrich with caps
                to_process = candidates[: max(0, settings.worker_max_per_cycle)]
                batch_size = max(1, settings.worker_batch_size)

                for i in range(0, len(to_process), batch_size):
                    if self._stop.is_set():
                        break
                    batch = to_process[i : i + batch_size]
                    for a in batch:
                        link = (a.get("link") or "").strip()
                        if not link:
                            continue
                        if not self._mark_in_flight(link):
                            continue
                        try:
                            # force=False lets enrich_if_needed refresh stale automatically
                            enrich_if_needed(a, force=False)
                            self.state.total_enriched += 1
                        except Exception as e:
                            # Keep going; do not kill cycle
                            self.state.last_error = str(e)
                        finally:
                            self._unmark_in_flight(link)

            except Exception as e:
                self.state.last_error = str(e)

            self.state.running = False
            # Sleep in small chunks so stop() is responsive
            for _ in range(settings.worker_interval_seconds):
                if self._stop.is_set():
                    break
                time.sleep(1)