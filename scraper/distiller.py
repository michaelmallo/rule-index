"""Semantic embedding, clustering, categorization, and optional LLM canonicalization."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import requests

from config import (
    ALL_CATEGORIES,
    CATEGORY_KEYWORDS,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_SIMILARITY_THRESHOLD,
    MAX_EXAMPLES_PER_RULE,
)

logger = logging.getLogger(__name__)


@dataclass
class RawRuleObservation:
    """A single extracted rule tied to a repository and agent file."""

    text: str
    repo_full_name: str
    repo_url: str
    stars: int
    file_path: str
    file_url: str
    agents: tuple[str, ...]
    observed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class RuleExample:
    """A real-world verbatim example of a canonical rule."""

    text: str
    repo: str
    repo_url: str
    file_path: str
    file_url: str
    stars: int
    agent: str


@dataclass
class CanonicalRule:
    """A distilled, deduplicated canonical rule cluster."""

    id: str
    title: str
    summary: str
    category: str
    agents: list[str]
    adoption_count: int
    weighted_score: float
    examples: list[RuleExample]
    first_seen: str
    last_updated: str


def classify_category(text: str) -> str:
    """Classify a rule string into one of the 7 canonical categories via keyword scoring."""
    lower = text.lower()
    best_cat = "Code Style & Architecture"
    best_score = 0

    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in lower)
        if score > best_score:
            best_score = score
            best_cat = category

    return best_cat


def compute_weighted_score(repo_stars: dict[str, int]) -> float:
    """Compute star-weighted adoption score across unique repositories."""
    total = sum(1.0 + math.log10(1 + max(0, stars)) for stars in repo_stars.values())
    return round(total, 1)


def make_rule_id(title: str) -> str:
    """Create a deterministic, URL-safe slug + short hash ID for a canonical rule."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]
    digest = hashlib.sha1(title.lower().encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}" if slug else f"rule-{digest}"


class SemanticEmbedder:
    """Computes L2-normalized dense embeddings using sentence-transformers with TF-IDF fallback."""

    def __init__(self, model_name: str = DEFAULT_EMBEDDING_MODEL) -> None:
        self.model_name = model_name
        self._st_model = None
        self._backend = "uninitialized"

    def _init_backend(self) -> None:
        if self._backend != "uninitialized":
            return
        try:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading sentence-transformers model: %s", self.model_name)
            self._st_model = SentenceTransformer(self.model_name)
            self._backend = "sentence-transformers"
        except Exception as exc:
            logger.warning(
                "sentence-transformers unavailable (%s); falling back to TF-IDF character+word embeddings.",
                exc,
            )
            self._backend = "tfidf"

    @property
    def backend(self) -> str:
        self._init_backend()
        return self._backend

    def encode(self, texts: list[str]) -> np.ndarray:
        """Encode texts into an (N, D) L2-normalized float32 numpy array."""
        if not texts:
            return np.zeros((0, 1), dtype=np.float32)

        self._init_backend()

        if self._backend == "sentence-transformers" and self._st_model is not None:
            vectors = self._st_model.encode(
                texts,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            return np.asarray(vectors, dtype=np.float32)

        # Fallback: scikit-learn TF-IDF (word + char_wb n-grams for robust lexical overlap)
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.pipeline import FeatureUnion

            vectorizer = FeatureUnion(
                [
                    (
                        "word",
                        TfidfVectorizer(
                            ngram_range=(1, 2),
                            stop_words="english",
                            sublinear_tf=True,
                            norm="l2",
                        ),
                    ),
                    (
                        "char",
                        TfidfVectorizer(
                            analyzer="char_wb",
                            ngram_range=(3, 5),
                            sublinear_tf=True,
                            norm="l2",
                        ),
                    ),
                ]
            )
            mat = vectorizer.fit_transform(texts).toarray().astype(np.float32)
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            mat = mat / norms
            if mat.shape[1] == 0:
                return np.ones((len(texts), 1), dtype=np.float32)
            return mat
        except ImportError:
            return self._pure_numpy_tfidf(texts)

    @staticmethod
    def _pure_numpy_tfidf(texts: list[str]) -> np.ndarray:
        """Zero-dependency TF-IDF fallback using numpy only."""
        tokenized = [re.findall(r"[a-z0-9]+", t.lower()) for t in texts]
        vocab: dict[str, int] = {}
        for tokens in tokenized:
            for tok in tokens:
                if tok not in vocab:
                    vocab[tok] = len(vocab)
        if not vocab:
            return np.ones((len(texts), 1), dtype=np.float32)

        mat = np.zeros((len(texts), len(vocab)), dtype=np.float32)
        for i, tokens in enumerate(tokenized):
            for tok in tokens:
                mat[i, vocab[tok]] += 1.0

        df = np.count_nonzero(mat > 0, axis=0)
        idf = np.log((1.0 + len(texts)) / (1.0 + df)) + 1.0
        mat *= idf
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms


def cluster_embeddings(
    embeddings: np.ndarray,
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
) -> list[list[int]]:
    """Cluster normalized embeddings by cosine similarity into index groups."""
    n = embeddings.shape[0]
    if n == 0:
        return []
    if n == 1:
        return [[0]]

    # Use AgglomerativeClustering if scikit-learn is available; else greedy centroid clustering
    try:
        from sklearn.cluster import AgglomerativeClustering

        distance_threshold = max(0.05, min(0.95, 1.0 - similarity_threshold))
        clustering = AgglomerativeClustering(
            n_clusters=None,
            metric="cosine",
            linkage="average",
            distance_threshold=distance_threshold,
        )
        labels = clustering.fit_predict(embeddings)
        groups: dict[int, list[int]] = {}
        for idx, label in enumerate(labels):
            groups.setdefault(int(label), []).append(idx)
        return list(groups.values())
    except ImportError:
        clusters: list[list[int]] = []
        centroids: list[np.ndarray] = []

        for idx in range(n):
            vec = embeddings[idx]
            best_c = -1
            best_sim = -1.0
            for c_idx, centroid in enumerate(centroids):
                sim = float(np.dot(vec, centroid))
                if sim > best_sim:
                    best_sim = sim
                    best_c = c_idx
            if best_c >= 0 and best_sim >= similarity_threshold:
                clusters[best_c].append(idx)
                updated = np.mean(embeddings[clusters[best_c]], axis=0)
                norm = np.linalg.norm(updated)
                centroids[best_c] = updated / norm if norm > 0 else updated
            else:
                clusters.append([idx])
                centroids.append(vec.copy())
        return clusters


def canonicalize_with_llm(
    variations: list[str],
    default_title: str,
    default_summary: str,
    default_category: str,
) -> tuple[str, str, str]:
    """Optionally refine a cluster's canonical title, summary, and category via an LLM API.

    Supports GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY when set.
    Falls back cleanly to the deterministic medoid title/summary if no key is present or on error.
    """
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    if not any((gemini_key, openai_key, anthropic_key)):
        return default_title, default_summary, default_category

    sample_lines = "\n".join(f"- {v}" for v in variations[:8])
    categories_str = ", ".join(ALL_CATEGORIES)
    prompt = (
        "You are distilling AI coding agent rules into one crisp canonical rule.\n"
        f"Variations:\n{sample_lines}\n\n"
        f"Choose one category from: {categories_str}.\n"
        "Respond ONLY with valid JSON: "
        '{"title": "short imperative rule <= 12 words", '
        '"summary": "1-2 sentence explanation of why and how to apply this rule", '
        '"category": "exact category name"}'
    )

    raw_json_text: str | None = None
    try:
        if gemini_key:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"gemini-2.0-flash:generateContent?key={gemini_key}"
            )
            resp = requests.post(
                url,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
                },
                timeout=20,
            )
            if resp.status_code == 200:
                raw_json_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        elif openai_key:
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                },
                timeout=20,
            )
            if resp.status_code == 200:
                raw_json_text = resp.json()["choices"][0]["message"]["content"]
        elif anthropic_key:
            resp = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-3-5-haiku-latest",
                    "max_tokens": 256,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20,
            )
            if resp.status_code == 200:
                raw_json_text = resp.json()["content"][0]["text"]

        if raw_json_text:
            parsed = json.loads(raw_json_text)
            title = str(parsed.get("title", "")).strip() or default_title
            summary = str(parsed.get("summary", "")).strip() or default_summary
            category = str(parsed.get("category", "")).strip()
            if category not in ALL_CATEGORIES:
                category = default_category
            return title, summary, category
    except Exception as exc:
        logger.debug("LLM canonicalization fallback triggered: %s", exc)

    return default_title, default_summary, default_category


def distill_observations(
    observations: list[RawRuleObservation],
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    use_llm: bool = False,
    embedder: SemanticEmbedder | None = None,
) -> list[CanonicalRule]:
    """Embed, cluster, and distill raw rule observations into canonical rules."""
    if not observations:
        return []

    embedder = embedder or SemanticEmbedder()
    texts = [obs.text for obs in observations]
    embeddings = embedder.encode(texts)

    # Adjust threshold when running on TF-IDF fallback (lexical cosine sims are lower than dense embeddings)
    effective_threshold = (
        similarity_threshold
        if embedder.backend == "sentence-transformers"
        else min(similarity_threshold, 0.15)
    )
    clusters = cluster_embeddings(embeddings, similarity_threshold=effective_threshold)

    canonical_rules: list[CanonicalRule] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for indices in clusters:
        cluster_obs = [observations[i] for i in indices]
        cluster_vecs = embeddings[indices]

        # Pick medoid (observation closest to the cluster centroid) as default canonical text
        centroid = np.mean(cluster_vecs, axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid = centroid / norm
        sims = cluster_vecs @ centroid
        medoid_local_idx = int(np.argmax(sims))
        medoid_text = cluster_obs[medoid_local_idx].text

        # Build concise title and summary
        default_title = medoid_text.rstrip(".")
        if len(default_title) > 110:
            default_title = default_title[:107].rsplit(" ", 1)[0] + "..."

        default_summary = medoid_text
        default_category = classify_category(" ".join(o.text for o in cluster_obs))

        if use_llm:
            title, summary, category = canonicalize_with_llm(
                [o.text for o in cluster_obs],
                default_title,
                default_summary,
                default_category,
            )
        else:
            title, summary, category = default_title, default_summary, default_category

        # Aggregate unique repos, star weights, and target agents
        repo_stars: dict[str, int] = {}
        agent_set: set[str] = set()
        timestamps: list[str] = []

        for obs in cluster_obs:
            prev_stars = repo_stars.get(obs.repo_full_name, -1)
            if obs.stars > prev_stars:
                repo_stars[obs.repo_full_name] = obs.stars
            agent_set.update(obs.agents)
            timestamps.append(obs.observed_at)

        # Select up to MAX_EXAMPLES_PER_RULE diverse examples, preferring higher-star repos
        sorted_obs = sorted(cluster_obs, key=lambda o: o.stars, reverse=True)
        examples: list[RuleExample] = []
        seen_example_repos: set[str] = set()
        for obs in sorted_obs:
            if obs.repo_full_name in seen_example_repos:
                continue
            seen_example_repos.add(obs.repo_full_name)
            examples.append(
                RuleExample(
                    text=obs.text,
                    repo=obs.repo_full_name,
                    repo_url=obs.repo_url,
                    file_path=obs.file_path,
                    file_url=obs.file_url,
                    stars=obs.stars,
                    agent=obs.agents[0] if obs.agents else "Universal",
                )
            )
            if len(examples) >= MAX_EXAMPLES_PER_RULE:
                break

        first_seen = min(timestamps) if timestamps else now_iso
        last_updated = max(timestamps) if timestamps else now_iso

        canonical_rules.append(
            CanonicalRule(
                id=make_rule_id(title),
                title=title,
                summary=summary,
                category=category,
                agents=sorted(agent_set),
                adoption_count=len(repo_stars),
                weighted_score=compute_weighted_score(repo_stars),
                examples=examples,
                first_seen=first_seen,
                last_updated=last_updated,
            )
        )

    canonical_rules.sort(key=lambda r: (r.adoption_count, r.weighted_score), reverse=True)
    return canonical_rules
