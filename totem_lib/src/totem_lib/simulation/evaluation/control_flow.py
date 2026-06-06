"""
Control-flow evaluation measures between OCELs

Implements:
- N-Gram Distance absolute (NGDa) — The Distance between N-Grams of Events, which is equal to the (n-1)th-Markovian Distance. 
For n=2, this corresponds to the DFG-based distance. For n>2, this captures longer-range dependencies at the cost of higher sensitivity to infrequent n-grams.
from: Chapela-Campa et al. "Can I Trust My Simulation Model? Measuring the
    Quality of Business Process Simulation Models." BPM 2023.
- N-Gram Distance relative (NGDr) — Similar to NGDa but compares the relative frequencies of n-grams instead of absolute counts, thus ignoring differences in the total number of n-grams between the two logs.
Adapted from the implementation of NGDa from Chapela-Campa et al. "Can I Trust My Simulation Model? Measuring the
    Quality of Business Process Simulation Models." BPM 2023.
"""
from collections import Counter
from _eval_utils import get_variants

_DUMMY_TOKEN = "<>"


def _build_ngram_counter(sequences: list[list[str]], n: int) -> Counter:
    """Counts all n-grams across the given activity sequences with start/end padding.
    
    Args:
        sequences: List of activity-label sequences.
        n: N-gram size.

    Returns:
        Counter of n-grams and their frequencies.
    """
    counts: Counter = Counter()
    pad = [_DUMMY_TOKEN] * (n - 1)
    for seq in sequences:
        padded = pad + list(seq) + pad
        for i in range(len(padded) - n + 1):
            counts[tuple(padded[i : i + n])] += 1
    return counts

def _execution_sequences(ocel, variants: Variants | None = None) -> list[list[str]]:
    """
    For every process execution, return its activity sequence sorted by
    timestamp (ties broken by event id).

    Args:
        ocel:     ObjectCentricEventLog
        variants: Optional pre-computed Variants object.

    Returns:
        List of activity-label sequences, one per execution.
    """
    if variants is None:
        variants = get_variants(ocel)

    sequences = []
    for variant in variants:
        for execution in variant.executions:
            events = [
                (ocel.get_event_timestamp(eid), eid, ocel.get_event_activity(eid))
                for eid in execution
            ]
            events = [e for e in events if e[0] is not None and e[2] is not None]
            events.sort(key=lambda t: (t[0], t[1]))
            sequences.append([a for _, _, a in events])

    return sequences


def n_gram_distance_absolute(actual_ocel, simulated_ocel, n: int = 2) -> float:
    """
    N-Gram Distance absolute (NGDa).

    Maps both logs to their histograms of activity n-grams (with start/end
    padding so every activity instance is counted in exactly n n-grams) and
    returns the sum of absolute frequency differences, normalized by the sum
    of frequencies in both histograms. Result is in [0, 1].
    As it is normalzed by the total count of n-grams a difference in the absolute nummber of n-grams within the two logs is also punished.

    Args:
        actual_ocel:     reference log (e.g. test/holdout).
        simulated_ocel:  log produced by the simulation.
        n:               n-gram size. n=2 corresponds to the DFG-based distance

    Returns:
        NGDa in [0, 1]. 0 means perfectly equal n-gram histograms.
    """
    if n < 1:
        raise ValueError("n must be >= 1.")
    # Calculate the frequncies of n-grams in both logs
    actual_counts = _build_ngram_counter(_execution_sequences(actual_ocel), n)
    sim_counts = _build_ngram_counter(_execution_sequences(simulated_ocel), n)

    # Collect all n-grams the appear in either log
    all_ngrams = set(actual_counts) | set(sim_counts)
    if not all_ngrams:
        return 0.0

    # Calculate the sum of absolute differences & sum of frequencies
    diff = sum(abs(actual_counts.get(g, 0) - sim_counts.get(g, 0)) for g in all_ngrams)
    total = sum(actual_counts.values()) + sum(sim_counts.values())

    # Return Absolute N-Gram Distance
    return diff / total if total > 0 else 0.0

def _normalize_counts(counts: Counter) -> dict:
    total = sum(counts.values())
    if total == 0:
        return {}
    return {g: c / total for g, c in counts.items()}


def n_gram_distance_relative(actual_ocel, simulated_ocel, n: int = 2) -> float:
    """
    N-Gram Distance relative (NGDr).

    Maps both logs to their histograms of activity n-grams (with start/end
    padding so every activity instance is counted in exactly n n-grams) and
    returns the sum of relative frequency differences. Result is in [0, 1].

    Args:
        actual_ocel:     reference log (e.g. test/holdout).
        simulated_ocel:  log produced by the simulation.
        n:               n-gram size. n=2 corresponds to the DFG-based distance


    Returns:
        NGDr in [0, 1]. 0 means perfectly equal n-gram histograms.
    """
    if n < 1:
        raise ValueError("n must be >= 1.")
    
    # Calculate the frequncies of n-grams in both logs
    actual_counts = _build_ngram_counter(_execution_sequences(actual_ocel), n)
    sim_counts = _build_ngram_counter(_execution_sequences(simulated_ocel), n)

    # Normalize frequencies for each log
    actual_freq = _normalize_counts(actual_counts)
    sim_freq = _normalize_counts(sim_counts)

    # Collect all n-grams the appear in either log
    all_ngrams = set(actual_freq) | set(sim_freq)
    if not all_ngrams:
        return 0.0

    # Return difference in relative frequencies
    return 0.5 * sum(
        abs(actual_freq.get(g, 0.0) - sim_freq.get(g, 0.0))
        for g in all_ngrams
    )
