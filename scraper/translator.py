"""Language detection and English normalization for scraped AI coding agent rules."""

from __future__ import annotations

import logging
import re
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Non-Latin script ranges that immediately indicate non-English natural language
NON_LATIN_SCRIPT_RE = re.compile(
    r"[\u0400-\u04FF"  # Cyrillic
    r"\u0590-\u05FF"  # Hebrew
    r"\u0600-\u06FF"  # Arabic
    r"\u0900-\u097F"  # Devanagari
    r"\u0E00-\u0E7F"  # Thai
    r"\u3040-\u30FF"  # Hiragana / Katakana
    r"\u3400-\u4DBF"  # CJK Extension A
    r"\u4E00-\u9FFF"  # CJK Unified Ideographs
    r"\uAC00-\uD7AF]"  # Hangul
)

# Common non-English Latin-script stopwords (German, Spanish, French, Portuguese, Italian, Dutch)
NON_ENGLISH_LATIN_WORDS = frozenset(
    {
        # German
        "und", "oder", "nicht", "bitte", "immer", "niemals", "keine", "keinen",
        "einen", "einer", "wird", "werden", "muss", "müssen", "soll", "sollte",
        "für", "über", "vor", "nach", "auf", "bei", "mit", "aus", "nur", "zum",
        "zur", "benutzers", "bestätigung", "anweisung", "verwenden", "prüfen",
        # Portuguese / Spanish
        "não", "para", "com", "sem", "uma", "como", "mais", "sempre", "nunca",
        "deve", "devem", "fazer", "usar", "código", "arquivos", "antes", "após",
        "los", "las", "del", "con", "sin", "por", "pero", "siempre", "debe",
        "usar", "evitar", "todos", "todas", "cuando", "antes", "después",
        # French
        "les", "des", "une", "dans", "pour", "avec", "sans", "toujours", "jamais",
        "doit", "doivent", "utiliser", "éviter", "avant", "après", "fichiers",
        # Italian / Dutch
        "non", "per", "con", "senza", "sempre", "mai", "usare", "evitare",
        "niet", "altijd", "nooit", "voor", "met", "zonder", "gebruik",
    }
)

INLINE_CODE_RE = re.compile(r"`[^`]+`")

# Normalize fullwidth / smart punctuation to clean ASCII
PUNCT_TRANSLATION = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\uff1a": ": ",
        "\uff1b": "; ",
        "\uff0c": ", ",
        "\u3002": ". ",
        "\u3001": ", ",
        "\uff08": "(",
        "\uff09": ")",
    }
)


def normalize_typography(text: str) -> str:
    """Normalize smart quotes, fullwidth punctuation, and whitespace."""
    cleaned = text.translate(PUNCT_TRANSLATION)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _strip_code_spans(text: str) -> str:
    """Remove inline backtick code spans before language detection so identifiers don't skew it."""
    return INLINE_CODE_RE.sub(" ", text).strip()


def is_english(text: str) -> bool:
    """Return True if the natural language prose in `text` is English."""
    if not text or not text.strip():
        return True

    prose = _strip_code_spans(text)
    if not prose:
        return True

    # Any non-Latin script characters (CJK, Hangul, Cyrillic, Arabic, etc.) => not English
    if NON_LATIN_SCRIPT_RE.search(prose):
        return False

    # Check non-English Latin stopwords first (catches short German/Portuguese/Spanish/French rules)
    words = re.findall(r"[a-zA-ZÀ-ÿ]+", prose.lower())
    if len(words) >= 3:
        non_en_hits = sum(1 for w in words if w in NON_ENGLISH_LATIN_WORDS)
        if non_en_hits >= 2 or (non_en_hits >= 1 and any(ord(ch) > 127 for ch in prose)):
            return False

    # Use langdetect when available for longer prose
    if len(prose) >= 24:
        try:
            from langdetect import DetectorFactory, detect_langs

            DetectorFactory.seed = 0
            langs = detect_langs(prose)
            if langs:
                top = langs[0]
                if top.lang == "en":
                    return True
                # High-confidence non-English detection
                if top.prob >= 0.75:
                    return False
                # If English is not even in the top candidates with reasonable probability
                en_prob = next((l.prob for l in langs if l.lang == "en"), 0.0)
                if en_prob < 0.25 and top.prob >= 0.55:
                    return False
        except Exception:
            pass

    return True


class EnglishNormalizer:
    """Normalizes rules to English using language detection, persistent caching, and translation."""

    def __init__(
        self,
        cache_db_path: Path | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        self._memory_cache: dict[str, str | None] = {}
        self._conn: sqlite3.Connection | None = conn
        self._owns_conn = False
        self._translator = None
        self._translator_failed = False
        self._consecutive_failures = 0
        self._last_request_ts = 0.0

        if self._conn is None and cache_db_path is not None:
            cache_db_path = Path(cache_db_path)
            cache_db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(cache_db_path)
            self._owns_conn = True

        if self._conn is not None:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS translation_cache (
                    source_text TEXT PRIMARY KEY,
                    english_text TEXT
                )
                """
            )
            self._conn.commit()

    def close(self) -> None:
        if self._owns_conn and self._conn is not None:
            self._conn.close()
        self._conn = None
        self._owns_conn = False

    def _get_cached(self, source: str) -> tuple[bool, str | None]:
        if source in self._memory_cache:
            return True, self._memory_cache[source]
        if self._conn is not None:
            row = self._conn.execute(
                "SELECT english_text FROM translation_cache WHERE source_text = ?",
                (source,),
            ).fetchone()
            if row is not None:
                self._memory_cache[source] = row[0]
                return True, row[0]
        return False, None

    def _set_cached(self, source: str, english: str | None) -> None:
        self._memory_cache[source] = english
        if self._conn is not None:
            self._conn.execute(
                """
                INSERT INTO translation_cache (source_text, english_text)
                VALUES (?, ?)
                ON CONFLICT(source_text) DO UPDATE SET english_text = excluded.english_text
                """,
                (source, english),
            )
            self._conn.commit()

    def _translate_to_english(self, text: str) -> tuple[str | None, bool]:
        """Translate text to English. Returns (translated_text, is_transient_error)."""
        if self._translator_failed:
            return None, True

        try:
            if self._translator is None:
                from deep_translator import GoogleTranslator

                self._translator = GoogleTranslator(source="auto", target="en")

            # Respect Google Translate's 5 req/sec limit
            elapsed = time.monotonic() - self._last_request_ts
            if elapsed < 0.25:
                time.sleep(0.25 - elapsed)

            # Preserve inline code spans during translation with placeholders
            code_spans: list[str] = []

            def _stash(match: re.Match[str]) -> str:
                code_spans.append(match.group(0))
                return f"__CODE_{len(code_spans) - 1}__"

            masked = INLINE_CODE_RE.sub(_stash, text)
            self._last_request_ts = time.monotonic()
            translated = self._translator.translate(masked)
            if not translated or not isinstance(translated, str):
                return None, False

            self._consecutive_failures = 0
            for idx, span in enumerate(code_spans):
                translated = translated.replace(f"__CODE_{idx}__", span)
                translated = translated.replace(f"__code_{idx}__", span)

            translated = normalize_typography(translated)
            if translated and translated[0].islower():
                translated = translated[0].upper() + translated[1:]
            if translated and translated[-1] not in ".!?":
                translated += "."

            # Verify translated output no longer contains untranslated non-Latin script
            if NON_LATIN_SCRIPT_RE.search(_strip_code_spans(translated)):
                return None, False
            return translated, False
        except ImportError:
            logger.warning("deep-translator not installed; non-English rules will be filtered.")
            self._translator_failed = True
            return None, True
        except Exception as exc:
            self._consecutive_failures += 1
            if self._consecutive_failures >= 3:
                logger.warning(
                    "Translation service rate-limited/unavailable (%s); "
                    "skipping remaining remote translations for this run.",
                    exc,
                )
                self._translator_failed = True
            else:
                logger.debug("Translation failed for '%s': %s", text[:50], exc)
            return None, True

    def normalize(self, text: str) -> str | None:
        """Return an English-normalized version of `text`, or None if it cannot be normalized."""
        cleaned = normalize_typography(text)
        if not cleaned:
            return None

        if is_english(cleaned):
            return cleaned

        hit, cached = self._get_cached(cleaned)
        if hit:
            return cached

        translated, is_transient = self._translate_to_english(cleaned)
        if translated and is_english(translated):
            self._set_cached(cleaned, translated)
            return translated

        # Only cache permanent failures; don't poison cache on transient 429/network errors
        if not is_transient:
            self._set_cached(cleaned, None)
        return None
