"""
BM25 document retriever for the assistant's knowledge base.

Retrieves the most relevant chunks from knowledge/help.md to inject
into the system prompt via RAG.
"""

import os
import re

KNOWLEDGE_DIR = os.path.join(os.path.dirname(__file__), "knowledge")
KNOWLEDGE_FILE = os.path.join(KNOWLEDGE_DIR, "help.md")

# Simple in-memory cache for chunks
_chunks_cache = None


def _load_chunks():
    """Load and chunk the knowledge document."""
    global _chunks_cache
    if _chunks_cache is not None:
        return _chunks_cache

    if not os.path.exists(KNOWLEDGE_FILE):
        _chunks_cache = []
        return _chunks_cache

    with open(KNOWLEDGE_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # Split on double newlines (paragraph boundaries) or H2/H3 headings
    # to create semantic chunks.
    raw_chunks = re.split(r"\n(?=##\s)|\n\n", content)

    # Filter out empty/whitespace-only chunks
    _chunks_cache = [c.strip() for c in raw_chunks if c.strip()]
    return _chunks_cache


def retrieve_knowledge(query, top_k=3):
    """
    Retrieve the top_k most relevant knowledge chunks for a query.

    Uses a simple keyword-overlap scoring (lightweight BM25 approximation)
    since we don't want to pull in a full search library for the MVP.

    Args:
        query: The user's search query.
        top_k: Number of chunks to return.

    Returns:
        list[str]: The top_k most relevant chunks.
    """
    chunks = _load_chunks()
    if not chunks:
        return []

    # Tokenize query into lowercase words
    query_tokens = set(re.findall(r"\w+", query.lower()))

    if not query_tokens:
        return chunks[:top_k]

    scored = []
    for chunk in chunks:
        chunk_lower = chunk.lower()
        # Simple TF-based scoring: count query token occurrences in chunk
        score = sum(chunk_lower.count(token) for token in query_tokens)
        # Bonus for exact phrase match
        if query.lower() in chunk_lower:
            score += 10
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [chunk for _, chunk in scored[:top_k] if scored[0][0] > 0]
