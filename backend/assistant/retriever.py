"""
Pure-Python BM25 Okapi document retriever for the assistant's knowledge base.

Chunks knowledge/help.md hierarchically by Markdown headings (H1/H2/H3),
indexes document term frequencies and document lengths, and computes
smoothed Robertson-Spärck Jones BM25 Okapi scores for query relevance.
"""

import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

KNOWLEDGE_DIR = os.path.join(os.path.dirname(__file__), "knowledge")
KNOWLEDGE_FILE = os.path.join(KNOWLEDGE_DIR, "help.md")

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
    "to", "was", "were", "will", "with", "how", "what", "where", "can",
    "i", "do", "you", "about", "or", "which",
}


def slugify_heading(heading: str) -> str:
    """Convert heading text to an anchor slug."""
    clean = re.sub(r"[^\w\s-]", "", heading.lower())
    return re.sub(r"[-\s]+", "-", clean).strip("-")


def tokenize(text: str, remove_stopwords: bool = False) -> List[str]:
    """Tokenize text into lowercase alphanumeric words."""
    tokens = re.findall(r"\b[a-zA-Z0-9_-]+\b", text.lower())
    if remove_stopwords:
        tokens = [t for t in tokens if t not in STOP_WORDS]
    return tokens


class BM25Retriever:
    """
    Pure-Python Okapi BM25 indexer and search retriever.
    
    Attributes:
        k1 (float): Term frequency saturation parameter (default: 1.5).
        b (float): Document length normalization parameter (default: 0.75).
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.chunks: List[Dict[str, Any]] = []
        self.doc_lengths: List[int] = []
        self.avg_doc_len: float = 0.0
        self.doc_freqs: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        self.corpus_size: int = 0

    def index_markdown(self, content: str) -> None:
        """
        Parse and index Markdown content by H1, H2, and H3 headings.
        """
        self.chunks = []
        lines = content.splitlines()
        current_h1 = "Overview"
        current_h2 = ""
        current_h3 = ""
        current_lines: List[str] = []

        def _flush_chunk():
            nonlocal current_lines
            body = "\n".join(current_lines).strip()
            if not body:
                current_lines = []
                return

            section_title = current_h3 or current_h2 or current_h1
            full_section = f"{current_h1} > {current_h2}" if current_h2 else current_h1
            if current_h3:
                full_section = f"{full_section} > {current_h3}"

            anchor = slugify_heading(section_title)
            tokens = tokenize(body)
            title_tokens = tokenize(f"{current_h1} {current_h2} {current_h3}")

            self.chunks.append({
                "title": section_title,
                "section": full_section,
                "anchor": anchor,
                "content": body,
                "tokens": tokens,
                "title_tokens": title_tokens,
            })
            current_lines = []

        for line in lines:
            if line.startswith("# "):
                _flush_chunk()
                current_h1 = line[2:].strip()
                current_h2 = ""
                current_h3 = ""
                current_lines.append(line)
            elif line.startswith("## "):
                _flush_chunk()
                current_h2 = line[3:].strip()
                current_h3 = ""
                current_lines.append(line)
            elif line.startswith("### "):
                _flush_chunk()
                current_h3 = line[4:].strip()
                current_lines.append(line)
            else:
                current_lines.append(line)

        _flush_chunk()

        # Build vocabulary statistics
        self.corpus_size = len(self.chunks)
        self.doc_lengths = [len(c["tokens"]) for c in self.chunks]
        self.avg_doc_len = (
            sum(self.doc_lengths) / self.corpus_size if self.corpus_size > 0 else 0.0
        )

        self.doc_freqs = {}
        for chunk in self.chunks:
            unique_terms = set(chunk["tokens"]) | set(chunk["title_tokens"])
            for term in unique_terms:
                self.doc_freqs[term] = self.doc_freqs.get(term, 0) + 1

        # Compute Robertson-Spärck Jones IDF with +1.0 smoothing
        self.idf = {}
        for term, df in self.doc_freqs.items():
            # ln((N - n(q) + 0.5) / (n(q) + 0.5) + 1.0)
            numerator = self.corpus_size - df + 0.5
            denominator = df + 0.5
            self.idf[term] = math.log((numerator / denominator) + 1.0)

    def search(
        self, query: str, top_k: int = 3, min_score: float = 0.0
    ) -> List[Tuple[Dict[str, Any], float]]:
        """
        Score and rank indexed chunks against a search query.

        Returns:
            List of (chunk_dict, score) tuples.
        """
        if (
            top_k <= 0
            or not self.chunks
            or not isinstance(query, str)
            or not query.strip()
        ):
            return []

        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        query_lower = query.lower().strip()
        scored_results: List[Tuple[Dict[str, Any], float]] = []

        for idx, chunk in enumerate(self.chunks):
            doc_len = self.doc_lengths[idx]
            if self.avg_doc_len > 0:
                len_norm = 1.0 - self.b + self.b * (doc_len / self.avg_doc_len)
            else:
                len_norm = 1.0

            # Term frequencies in document
            term_counts: Dict[str, int] = {}
            for t in chunk["tokens"]:
                term_counts[t] = term_counts.get(t, 0) + 1

            score = 0.0
            for q_term in query_tokens:
                tf = term_counts.get(q_term, 0)
                idf = self.idf.get(q_term, 0.0)

                # Okapi BM25 formula
                if tf > 0:
                    term_score = idf * ((tf * (self.k1 + 1.0)) / (tf + self.k1 * len_norm))
                    score += term_score

                # Title match bonus
                if q_term in chunk["title_tokens"]:
                    score += idf * 1.5 + 1.0

            # Phrase match bonus
            if query_lower in chunk["content"].lower():
                score += 3.0

            if score > min_score:
                scored_results.append((chunk, score))

        scored_results.sort(key=lambda item: item[1], reverse=True)
        return scored_results[:top_k]


# Singleton instance
_retriever_instance: Optional[BM25Retriever] = None


def get_retriever() -> BM25Retriever:
    """Get or lazily initialize the singleton BM25 retriever instance."""
    global _retriever_instance
    if _retriever_instance is None:
        _retriever_instance = BM25Retriever()
        if os.path.exists(KNOWLEDGE_FILE):
            with open(KNOWLEDGE_FILE, "r", encoding="utf-8") as f:
                _retriever_instance.index_markdown(f.read())
    return _retriever_instance


def reload_index(
    markdown_content: Optional[str] = None, file_path: Optional[str] = None
) -> BM25Retriever:
    """Reload or override the retriever index for runtime updates and tests."""
    global _retriever_instance
    _retriever_instance = BM25Retriever()
    if markdown_content is not None:
        _retriever_instance.index_markdown(markdown_content)
    else:
        target = file_path or KNOWLEDGE_FILE
        if os.path.exists(target):
            with open(target, "r", encoding="utf-8") as f:
                _retriever_instance.index_markdown(f.read())
    return _retriever_instance


def retrieve_knowledge(query: str, top_k: int = 3, min_score: float = 0.0) -> List[str]:
    """
    Retrieve top_k most relevant knowledge chunks as formatted markdown strings.
    """
    retriever = get_retriever()
    results = retriever.search(query=query, top_k=top_k, min_score=min_score)
    return [chunk["content"] for chunk, _ in results]


def retrieve_chunks(query: str, top_k: int = 3, min_score: float = 0.0) -> List[Dict[str, Any]]:
    """
    Retrieve top_k most relevant knowledge chunks with full metadata and scores.
    """
    retriever = get_retriever()
    results = retriever.search(query=query, top_k=top_k, min_score=min_score)
    return [{**chunk, "score": score} for chunk, score in results]
