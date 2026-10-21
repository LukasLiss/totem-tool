"""Resource calendars: when a resource works, inferred from when it acted.

A calendar is a ``{weekday: [24 floats]}`` matrix. A slot's value is an
**empirically inferred availability**: the share of the resource's observed weeks
in which the log gives evidence that the resource was at work in that slot. It is
not a measured presence probability, and the distinction is not cosmetic — the
evidence is one-sided.

Activity is evidence of presence: an event at Monday 10:00 proves the resource
was there. Silence is *not* evidence of absence: a worker present all Monday
morning but not touching a tracked event at 10:00 leaves no trace, so the slot
reads low. What these calendars measure is therefore availability *as witnessed
by activity* — a lower bound on real presence, confounded with how much work
there was to do. In a sparse log the gap between the two grows.

Two levers keep that gap honest instead of papering over it: a slot is scored
against the weeks in which the resource's type actually faced work, so an idle
hour is not read as an hour off; and a resource whose activity is too thin to
support a weekly rhythm gets no calendar at all. Nothing is ever credited
between two events, so a break is never claimed away. See
:func:`discover_individual_calendars`. The pipeline on top is
``events -> individual calendars -> clusters -> shift patterns``, and a simulated
resource is given the calendar of the shift pattern it draws. The per-type
calendar (:func:`type_calendar_from_patterns`) is a derived statistic for display
and analysis, not the simulated object.
"""

import copy
import datetime as dt
import random
from dataclasses import dataclass, field

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.ndimage import gaussian_filter1d

WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
HOURS_PER_DAY = 24


def availability_probability(prob_by_weekday, timestamp_s: int) -> float:
    """Availability probability of a calendar at a given Unix-second timestamp.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``
            May be falsy/empty.
        timestamp_s: Unix timestamp in seconds (UTC).

    Returns:
        The probability in ``[0, 1]``; ``1.0`` when the calendar is empty or the
        weekday/hour is missing (treated as "always available").
    """
    if not prob_by_weekday:
        return 1.0
    t = dt.datetime.fromtimestamp(timestamp_s, tz=dt.timezone.utc)
    hours = prob_by_weekday.get(WEEKDAYS[t.weekday()])
    if not hours:
        return 1.0
    return hours[t.hour]


def available_seconds_between(prob_by_weekday, start_s: int, end_s: int) -> float:
    """Expected available seconds in ``[start_s, end_s)`` under a calendar.

    Weights every second by the calendar's availability probability for its
    clock hour, so an hour with probability ``p`` contributes ``p * seconds``.
    This is the working-time content of a wall-clock span: it discounts the
    time a resource is simply not present (nights, weekends) rather than busy.

    Used to discount a discovered cooldown gap to its expected occupation. The
    playout then re-realizes that occupation stochastically (Bernoulli presence
    per hour in ``_CalendarGate``), so the round trip holds in expectation.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``.
            Falsy/empty means "always available" → the full wall-clock span.
        start_s: Start Unix timestamp in seconds (UTC), inclusive.
        end_s: End Unix timestamp in seconds (UTC), exclusive.

    Returns:
        Expected available seconds in the span (``0.0`` if ``end_s <= start_s``).
    """
    if end_s <= start_s:
        return 0.0
    if not prob_by_weekday:
        return float(end_s - start_s)

    total = 0.0
    cur = start_s
    while cur < end_s:
        hour_end = (cur // 3600) * 3600 + 3600
        slice_end = min(hour_end, end_s)
        p = availability_probability(prob_by_weekday, cur)
        total += p * (slice_end - cur)
        cur = slice_end
    return total


# Safety cap for the hour-stepping burn-down below: stops runaway iteration on a
# (near-)zero calendar where available time accrues so slowly it would never reach
# the target. ~5 years of hours.
_MAX_ACCRUAL_HOURS = HOURS_PER_DAY * 365 * 5


def wall_clock_end_for_available(
    prob_by_weekday, start_s: int, work_seconds: float
) -> int:
    """Wall-clock second at which ``work_seconds`` of available time accrue.

    Deterministic inverse of :func:`available_seconds_between`: advances wall-clock
    time from ``start_s``, accumulating each hour's probability-weighted available
    seconds, until ``work_seconds`` is reached. Off-hours (low/zero probability)
    stretch the span; nights and weekends push the end further out.

    This is the counterpart to the playout's realized (Bernoulli) burn-down
    in ``_CalendarGate.cooldown_end``: it is used when analysing history — e.g. to
    re-express a calendar-discounted cooldown (measured in available seconds) back as
    the wall-clock time a resource becomes idle again — where no realized shift schedule
    exists and a deterministic estimate is wanted.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``.
            Falsy/empty means "always available" → ``start_s + work_seconds``.
        start_s: Start Unix timestamp in seconds (UTC).
        work_seconds: Available seconds to accumulate (``<= 0`` returns ``start_s``).

    Returns:
        The Unix second (UTC) at which the accumulated available time reaches
        ``work_seconds`` (rounded to the nearest second). For a (near-)zero calendar
        that never accrues enough, the remainder is added as wall clock after the cap.
    """
    if work_seconds <= 0:
        return start_s
    if not prob_by_weekday:
        return start_s + int(round(work_seconds))

    remaining = float(work_seconds)
    cur = start_s
    for _ in range(_MAX_ACCRUAL_HOURS):
        hour_end = (cur // 3600) * 3600 + 3600
        p = availability_probability(prob_by_weekday, cur)
        avail = p * (hour_end - cur)
        if avail >= remaining:
            # Finishes inside this hour
            return int(round(cur + remaining / p))
        remaining -= avail
        cur = hour_end
    return int(round(cur + remaining))


SECONDS_PER_DAY = 86400
# 1970-01-01 is a Thursday, i.e. weekday index 3; shifting by three days aligns
# day-of-epoch arithmetic to Monday-based weekdays and Monday-starting weeks.
_EPOCH_WEEKDAY_SHIFT = 3


def _day_index(timestamp_s: int) -> int:
    """Day number of a Unix timestamp (UTC), counted from the epoch."""
    return timestamp_s // SECONDS_PER_DAY


def _flatten(probability: dict) -> np.ndarray:
    """A calendar matrix as a flat ``(7 * 24,)`` vector in weekday/hour order."""
    return np.array(
        [probability[day][h] for day in WEEKDAYS for h in range(HOURS_PER_DAY)],
        dtype=float,
    )


def _unflatten(vector) -> dict[str, list[float]]:
    """Inverse of :func:`_flatten`."""
    return {
        day: [float(vector[i * HOURS_PER_DAY + h]) for h in range(HOURS_PER_DAY)]
        for i, day in enumerate(WEEKDAYS)
    }


# A slot needs this many weeks carrying demand before the demand-conditioned
# estimate is trusted; below it the slot rests on the relative estimate alone.
DEFAULT_MIN_SLOT_SUPPORT = 2
# A resource seen less than this often says nothing about a weekly rhythm, so it
# gets no calendar at all rather than a calendar made of noise.
DEFAULT_MIN_RESOURCE_EVENTS = 10
DEFAULT_MIN_RESOURCE_WEEKS = 2
# ... and it has to accompany the process rather than pass through it: a real
# resource is observed across a good part of the log's life, while a case object
# mistaken for one shows up for a few weeks and is gone. A share rather than a
# count keeps this independent of how long the log happens to be.
DEFAULT_MIN_SPAN_SHARE = 0.25


def _slot_index(day: int, hour: int) -> int:
    """Flat ``0..167`` index of a (day-of-epoch, hour) pair, Monday first."""
    return ((day + _EPOCH_WEEKDAY_SHIFT) % 7) * HOURS_PER_DAY + hour


def _collect_resource_activity(ocel, resource_types: list[str], obj_type_map):
    """One pass over the log, gathering what every calendar estimate needs.

    Returns ``(acted, window, events_of, rtype_of, demand)``:
    ``acted[rid][slot]`` are the weeks resource ``rid`` has an event in ``slot``,
    ``window[rid]`` its first and last week, ``events_of[rid]`` its event count,
    ``rtype_of[rid]`` its type, and ``demand[rtype][slot]`` the weeks in which an
    activity that type is a candidate for occurred in that slot.
    """
    resource_types_set = set(resource_types)
    acted: dict[str, dict[int, set[int]]] = {}
    window: dict[str, list[int]] = {}
    events_of: dict[str, int] = {}
    rtype_of: dict[str, str] = {}
    candidates_of: dict[str, set[str]] = {}
    occurrences: dict[str, dict[int, set[int]]] = {}

    for timestamp, activity, objects in ocel.events.select(
        ["_timestampUnix", "_activity", "_objects"]
    ).iter_rows():
        day = _day_index(timestamp)
        week = (day + _EPOCH_WEEKDAY_SHIFT) // 7
        slot = _slot_index(day, (timestamp % SECONDS_PER_DAY) // 3600)
        occurrences.setdefault(activity, {}).setdefault(slot, set()).add(week)
        for rid in objects or []:
            rtype = obj_type_map.get(rid)
            if rtype not in resource_types_set:
                continue
            candidates_of.setdefault(activity, set()).add(rtype)
            if rid not in acted:
                acted[rid] = {}
                window[rid] = [week, week]
                events_of[rid] = 0
                rtype_of[rid] = rtype
            acted[rid].setdefault(slot, set()).add(week)
            events_of[rid] += 1
            span = window[rid]
            span[0] = min(span[0], week)
            span[1] = max(span[1], week)

    demand: dict[str, dict[int, set[int]]] = {rt: {} for rt in resource_types}
    for activity, per_slot in occurrences.items():
        for rtype in candidates_of.get(activity, ()):
            target = demand[rtype]
            for slot, weeks in per_slot.items():
                target.setdefault(slot, set()).update(weeks)
    return acted, window, events_of, rtype_of, demand


def _demand_conditioned(acted_weeks, demand_weeks, first, last, min_slot_support):
    """``P_abs`` for one slot: the share of the weeks that carried work in which
    the resource acted, or 0 when the slot has too little demand to judge."""
    support = sum(1 for w in demand_weeks if first <= w <= last)
    if support < min_slot_support:
        return 0.0
    return acted_weeks / support


def discover_individual_calendars(
    ocel,
    resource_types: list[str],
    obj_type_map: dict[str, str] | None = None,
    min_slot_support: int = DEFAULT_MIN_SLOT_SUPPORT,
    min_resource_events: int = DEFAULT_MIN_RESOURCE_EVENTS,
    min_resource_weeks: int = DEFAULT_MIN_RESOURCE_WEEKS,
    min_span_share: float = DEFAULT_MIN_SPAN_SHARE,
) -> dict[str, dict[str, dict[str, list[float]]]]:
    """Infers one availability calendar per resource object from its activity.

    Availability belongs to the resource, not to a process area, so it is read
    across **all activities** the resource takes part in. Only hours carrying an
    event count as evidence of presence — nothing is credited between two
    events, because a gap is as consistent with a break as with a quiet stretch.

    Two estimates are formed per (weekday, hour) slot and the larger is kept,
    following Lopez-Pintado & Dumas (ICPM 2023):

    - **Demand-conditioned** ``P_abs = a_r(slot) / d_r(slot)`` — of the weeks in
      which there was *work for r* in that slot, the share in which r acted.
      ``a_r`` counts the weeks r has an event there, ``d_r`` the weeks in which
      any activity r's type can perform occurred there, both within r's own
      observation window. This is what stops an idle hour from reading as an
      hour off: a worker on an 08–16 shift who faces work at 10:00 in 3 of 10
      weeks and takes it every time reads 1.0, not 0.3.
    - **Relative** ``P_rel = rate_r(slot) / (highest rate of the type there)``,
      a rate being the week share over a resource's own window. It answers the
      rotation case, where a pool takes turns on the same recurring task and
      every member would otherwise look part-time. Comparing rates rather than
      raw counts keeps a late-joining resource comparable to a long-observed one.
      It needs a peer group to be meaningful, so it is only formed for a type
      with at least two qualifying resources: a lone resource is its own peak
      and would read 1.0 in every slot it ever acted in, on a single
      observation, bypassing ``min_slot_support`` entirely.

    ``P_abs`` alone penalizes lightly loaded resources and ``P_rel`` alone
    penalizes everyone but the busiest, so the maximum of the two is kept.

    A slot in which the type never faced work carries no evidence either way and
    stays 0 — read as "nothing observed here", not as "absent".

    Args:
        ocel: Unfiltered ObjectCentricEventLog. Resources are identified from each
            event's ``_objects`` by type, across every activity.
        resource_types: Object types to treat as resources.
        obj_type_map: Optional object-ID -> object-type map. Defaults to
            ``ocel.obj_type_map``.
        min_slot_support: Weeks of demand a slot needs before ``P_abs`` is
            trusted; below it the slot rests on ``P_rel``, which still carries
            the observed presence.
        min_resource_events: Events a resource needs before it gets a calendar.
        min_resource_weeks: Weeks a resource's observation window must span
            before it gets a calendar.
        min_span_share: Share of the log's own span that window must cover. It
            is what separates a resource from a case object wrongly declared one:
            the former accompanies the process, the latter passes through it.

    Returns:
        dict mapping resource_type -> {resource_id -> calendar matrix}. Resources
        below the participation thresholds are absent, as is a type without any
        qualifying resource — a missing calendar means "no schedule known", which
        the playout reads as always available.
    """
    result: dict[str, dict[str, dict[str, list[float]]]] = {
        rt: {} for rt in resource_types
    }
    if ocel.events.is_empty():
        return result
    if obj_type_map is None:
        obj_type_map = ocel.obj_type_map

    acted, window, events_of, rtype_of, demand = _collect_resource_activity(
        ocel, resource_types, obj_type_map
    )

    if not window:
        return result
    log_weeks = (
        max(w[1] for w in window.values()) - min(w[0] for w in window.values()) + 1
    )
    qualifying = [
        rid
        for rid in acted
        if events_of[rid] >= min_resource_events
        and window[rid][1] - window[rid][0] + 1 >= min_resource_weeks
        and (window[rid][1] - window[rid][0] + 1) / log_weeks >= min_span_share
    ]

    # Rates first: the relative estimate compares a resource against the busiest
    # of its type, which must itself be a qualifying resource.
    peers: dict[str, int] = {rt: 0 for rt in resource_types}
    for rid in qualifying:
        peers[rtype_of[rid]] += 1
    rates: dict[str, dict[int, float]] = {}
    peak_rate: dict[str, dict[int, float]] = {rt: {} for rt in resource_types}
    for rid in qualifying:
        first, last = window[rid]
        observed_weeks = last - first + 1
        rates[rid] = {
            slot: len(weeks) / observed_weeks for slot, weeks in acted[rid].items()
        }
        peak = peak_rate[rtype_of[rid]]
        for slot, rate in rates[rid].items():
            if rate > peak.get(slot, 0.0):
                peak[slot] = rate

    for rid in qualifying:
        rtype = rtype_of[rid]
        first, last = window[rid]
        peak = peak_rate[rtype]
        type_demand = demand[rtype]
        probability = {day: [0.0] * HOURS_PER_DAY for day in WEEKDAYS}
        for slot, weeks in acted[rid].items():
            p_abs = _demand_conditioned(
                len(weeks), type_demand.get(slot, ()), first, last, min_slot_support
            )
            p_rel = (
                rates[rid][slot] / peak[slot]
                if peers[rtype] >= 2 and peak.get(slot)
                else 0.0
            )
            value = min(1.0, max(p_abs, p_rel))
            probability[WEEKDAYS[slot // HOURS_PER_DAY]][slot % HOURS_PER_DAY] = value
        result[rtype][rid] = probability
    return result


def pooled_type_calendars(
    ocel,
    resource_types: list[str],
    obj_type_map: dict[str, str] | None = None,
    min_slot_support: int = DEFAULT_MIN_SLOT_SUPPORT,
    min_resource_weeks: int = DEFAULT_MIN_RESOURCE_WEEKS,
) -> dict[str, dict[str, list[float]]]:
    """Estimates one calendar per resource type from its objects pooled together.

    Every object of the type is treated as one pseudo-resource: a slot counts as
    worked in a week if *any* object of the type acted there, measured against
    the weeks that carried work for the type, over the span of the type's own
    objects. Only the demand-conditioned estimate applies — the relative one
    compares a resource against its peers and is vacuous for a single pooled
    resource.

    The result says **when work of this type happens**, which is a property of
    the role, not of any individual. It is the fallback for a type whose
    resources are each too thinly observed to carry a calendar of their own
    (:func:`discover_individual_calendars`), where the alternative would be to
    treat the type as available around the clock.

    Args:
        ocel: Unfiltered ObjectCentricEventLog.
        resource_types: Object types to treat as resources.
        obj_type_map: Optional object-ID -> object-type map.
        min_slot_support: See :func:`discover_individual_calendars`.
        min_resource_weeks: Weeks the pooled window must span.

    Returns:
        dict mapping resource_type -> calendar matrix. A type is omitted when it
        has no observed object, when its objects together span too few weeks, or
        when no slot carries enough demand to be judged — "no picture emerged"
        must stay a missing calendar, since an all-zero one would read as
        permanently unavailable rather than as unknown.
    """
    if ocel.events.is_empty():
        return {}
    if obj_type_map is None:
        obj_type_map = ocel.obj_type_map
    acted, window, _, rtype_of, demand = _collect_resource_activity(
        ocel, resource_types, obj_type_map
    )

    pooled_acted: dict[str, dict[int, set[int]]] = {}
    pooled_window: dict[str, list[int]] = {}
    for rid, per_slot in acted.items():
        rtype = rtype_of[rid]
        target = pooled_acted.setdefault(rtype, {})
        for slot, weeks in per_slot.items():
            target.setdefault(slot, set()).update(weeks)
        span = pooled_window.setdefault(rtype, list(window[rid]))
        span[0] = min(span[0], window[rid][0])
        span[1] = max(span[1], window[rid][1])

    calendars = {}
    for rtype, per_slot in pooled_acted.items():
        first, last = pooled_window[rtype]
        if last - first + 1 < min_resource_weeks:
            continue
        type_demand = demand[rtype]
        probability = {day: [0.0] * HOURS_PER_DAY for day in WEEKDAYS}
        evidence = False
        for slot, weeks in per_slot.items():
            value = _demand_conditioned(
                len(weeks), type_demand.get(slot, ()), first, last, min_slot_support
            )
            if value > 0:
                evidence = True
            probability[WEEKDAYS[slot // HOURS_PER_DAY]][slot % HOURS_PER_DAY] = min(
                1.0, value
            )
        if evidence:
            calendars[rtype] = probability
    return calendars


@dataclass
class ShiftPattern:
    """A recurring availability pattern shared by a group of resources of one type.

    Obtained by clustering individual resource calendars. ``probability`` is the
    cluster's slot-wise mean and the calendar a simulated resource of this
    pattern receives, ``share`` the fraction of the type's resources that follow
    it, and ``member_ids`` the resources it was mined from.

    ``spread`` is the members' slot-wise standard deviation (zero wherever they
    agree). It is a **diagnostic** of how tight the cluster is — nothing samples
    from it, because a mean and a standard deviation do not describe the
    distribution of a group of real schedules; see
    :func:`assign_shift_calendars`.
    """

    probability: dict[str, list[float]]
    spread: dict[str, list[float]]
    share: float
    member_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "probability": self.probability,
            "spread": self.spread,
            "share": self.share,
            "member_ids": list(self.member_ids),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ShiftPattern":
        return cls(
            probability=data["probability"],
            spread=data.get("spread")
            or {day: [0.0] * HOURS_PER_DAY for day in WEEKDAYS},
            share=float(data.get("share", 1.0)),
            member_ids=list(data.get("member_ids") or []),
        )


def calendar_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Fuzzy Jaccard distance between two flattened calendars, in ``[0, 1]``.

    ``sum |a - b| / sum max(a, b)``: the share of the combined presence mass the
    two calendars do not have in common. 0 for identical calendars, 1 for fully
    disjoint shifts (e.g. mornings vs. afternoons), and roughly the fraction of
    shifted hours for a time-offset copy.

    Being slot-wise, it is blind to *how far apart* the non-shared mass lies:
    Monday 07–08 is as distant from Monday 08–09 as from Friday 10–11. Use
    :func:`smoothed_calendar_distance` where that neighbourhood matters.
    """
    union = float(np.maximum(a, b).sum())
    if union <= 0.0:
        return 0.0
    return float(np.abs(a - b).sum() / union)


# Width of the smoothing kernel below. 1.5 h keeps every pair that should share a
# pattern below 0.42 and every pair that should not above 0.83 on the reference
# cases in the tests, so the 0.5 clustering threshold sits in the middle of that
# window. Raising it merges ever coarser shifts; 0 disables smoothing.
DEFAULT_SMOOTHING_HOURS = 1.5


def smooth_week(vectors: np.ndarray, sigma_hours: float) -> np.ndarray:
    """Blurs flattened calendars along the week's hour axis with a Gaussian kernel.

    The week is treated as one **circular** timeline of ``7 * 24`` hours, so the
    blur carries over midnight and from Sunday 23:00 back to Monday 00:00 — the
    adjacencies that physically exist. Total presence mass is preserved, which
    keeps a smoothed calendar comparable in magnitude to the raw one.

    Args:
        vectors: One flattened calendar of length ``7 * 24``, or a stack of them
            with the slots along the last axis.
        sigma_hours: Kernel standard deviation in hours. ``<= 0`` returns the
            input unchanged.

    Returns:
        The blurred array, same shape as ``vectors``.
    """
    if sigma_hours <= 0:
        return vectors
    return gaussian_filter1d(vectors, sigma_hours, axis=-1, mode="wrap")


def smoothed_calendar_distance(
    a: np.ndarray, b: np.ndarray, smoothing_hours: float = DEFAULT_SMOOTHING_HOURS
) -> float:
    """:func:`calendar_distance` over temporally blurred calendars, in ``[0, 1]``.

    Blurring both calendars with :func:`smooth_week` before the slot-wise
    comparison makes the distance sensitive to *when* the non-shared presence
    sits: hours near each other partially overlap after the blur, hours days
    apart do not. A shift moved by an hour therefore reads as a near-duplicate,
    while mornings and afternoons stay far apart, and sparsely observed
    calendars of the same shift stop looking disjoint. Differences in presence
    *level* (half-time vs. full-time) survive the blur unchanged.

    ``smoothing_hours = 0`` reproduces :func:`calendar_distance` exactly.

    Args:
        a: Flattened calendar of length ``7 * 24``.
        b: Flattened calendar of length ``7 * 24``.
        smoothing_hours: Kernel width in hours, see :func:`smooth_week`.

    Returns:
        The distance in ``[0, 1]``.
    """
    return calendar_distance(
        smooth_week(a, smoothing_hours), smooth_week(b, smoothing_hours)
    )


def cluster_shift_patterns(
    calendars: dict[str, dict[str, list[float]]],
    distance_threshold: float = 0.5,
    smoothing_hours: float = DEFAULT_SMOOTHING_HOURS,
) -> list[ShiftPattern]:
    """Groups individual resource calendars into shift patterns.

    Agglomerative clustering (average linkage) over
    :func:`smoothed_calendar_distance`; two calendars end up in one pattern when
    their clusters' mean distance stays below ``distance_threshold``. The number
    of patterns is not fixed in advance — it follows from where the threshold
    cuts the linkage tree.

    Clustering compares blurred calendars, but each pattern is summarized from
    the **raw** ones: ``probability`` is the members' slot-wise mean,
    ``spread`` their standard deviation, and ``share`` the fraction of the type's
    resources it covers. The blur is a tolerance for *when* presence was
    observed, not a change to the mined availability.

    Args:
        calendars: ``{resource_id: calendar matrix}`` for the resources of one type.
        distance_threshold: Maximum average-linkage distance (in ``[0, 1]``) for
            calendars to share a pattern. 0 groups only identical calendars.
        smoothing_hours: Temporal tolerance of the distance, see
            :func:`smooth_week`. 0 makes neighbouring hours as distant as
            hours days apart.

    Returns:
        Patterns sorted by descending share; empty when ``calendars`` is empty.
    """
    rids = sorted(calendars)
    if not rids:
        return []
    vectors = np.array([_flatten(calendars[r]) for r in rids])
    n = len(rids)
    if n == 1:
        labels = np.array([1])
    else:
        blurred = smooth_week(vectors, smoothing_hours)
        condensed = [
            calendar_distance(blurred[i], blurred[j])
            for i in range(n)
            for j in range(i + 1, n)
        ]
        tree = linkage(condensed, method="average")
        labels = fcluster(tree, t=distance_threshold, criterion="distance")

    patterns = []
    for label in np.unique(labels):
        idx = np.flatnonzero(labels == label)
        members = vectors[idx]
        patterns.append(
            ShiftPattern(
                probability=_unflatten(members.mean(axis=0)),
                spread=_unflatten(members.std(axis=0)),
                share=len(idx) / n,
                member_ids=[rids[i] for i in idx],
            )
        )
    patterns.sort(key=lambda p: (-p.share, p.member_ids))
    return patterns


def discover_shift_patterns(
    ocel,
    resource_types: list[str],
    obj_type_map: dict[str, str] | None = None,
    distance_threshold: float = 0.5,
    smoothing_hours: float = DEFAULT_SMOOTHING_HOURS,
    pooled_fallback: bool = True,
) -> tuple[dict[str, dict[str, dict[str, list[float]]]], dict[str, list[ShiftPattern]]]:
    """Mines individual calendars and clusters them into shift patterns per type.

    Args:
        ocel: Unfiltered ObjectCentricEventLog.
        resource_types: Object types to treat as resources.
        obj_type_map: Optional object-ID -> object-type map.
        distance_threshold: See :func:`cluster_shift_patterns`.
        smoothing_hours: See :func:`cluster_shift_patterns`.
        pooled_fallback: Whether a type none of whose resources qualifies falls
            back to a single pooled pattern, see :func:`pooled_type_calendars`.
            Such a pattern has share 1.0 and no ``member_ids``, so every instance
            of the type receives it.

    Returns:
        ``(individual, patterns)`` — the per-resource calendars keyed by type and
        id, and the patterns per type. A type is absent from ``individual`` when
        no resource of it was reliably observed; its patterns are then the pooled
        fallback, or empty when that is disabled or the type never occurs.
    """
    individual = discover_individual_calendars(ocel, resource_types, obj_type_map)
    patterns = {
        rtype: cluster_shift_patterns(
            individual.get(rtype, {}), distance_threshold, smoothing_hours
        )
        for rtype in resource_types
    }
    missing = [rtype for rtype in resource_types if not patterns[rtype]]
    if pooled_fallback and missing:
        pooled = pooled_type_calendars(ocel, missing, obj_type_map)
        flat_spread = {day: [0.0] * HOURS_PER_DAY for day in WEEKDAYS}
        for rtype, calendar in pooled.items():
            patterns[rtype] = [
                ShiftPattern(
                    probability=calendar,
                    spread=copy.deepcopy(flat_spread),
                    share=1.0,
                    member_ids=[],
                )
            ]
    return individual, patterns


def type_calendar_from_patterns(patterns: list) -> dict[str, list[float]] | None:
    """The share-weighted mean of a type's shift patterns (its expected availability).

    Args:
        patterns: ``ShiftPattern`` objects or their ``to_dict`` form.

    Returns:
        A ``{weekday: [24 floats]}`` matrix, or ``None`` for no patterns.
    """
    if not patterns:
        return None
    total = 0.0
    acc = np.zeros(len(WEEKDAYS) * HOURS_PER_DAY)
    for p in patterns:
        d = p.to_dict() if isinstance(p, ShiftPattern) else p
        acc += d["share"] * _flatten(d["probability"])
        total += d["share"]
    return _unflatten(acc / total) if total > 0 else None


def _largest_remainder(shares: list[float], n: int) -> list[int]:
    """Splits ``n`` seats over ``shares`` proportionally (Hamilton's method)."""
    total = sum(shares)
    if n <= 0 or total <= 0:
        return [0] * len(shares)
    quotas = [s / total * n for s in shares]
    counts = [int(q) for q in quotas]
    remaining = n - sum(counts)
    order = sorted(range(len(shares)), key=lambda i: -(quotas[i] - counts[i]))
    for i in order[:remaining]:
        counts[i] += 1
    return counts


def assign_shift_calendars(
    resource_pool_expanded: dict[str, list[str]],
    shift_patterns: dict[str, list[dict]],
    rng: random.Random = random,
) -> dict[str, dict[str, list[float]]]:
    """Gives every simulated resource instance the calendar of a shift pattern.

    A type's pool is split over its patterns in proportion to their shares
    (largest remainder, so a 50/50 mixture over four instances is exactly 2/2,
    without the sampling noise an i.i.d. categorical draw would add), the pattern
    slots are shuffled onto the instance ids, and each instance then takes its
    pattern's calendar **unchanged**.

    Taking the cluster mean as is keeps the model at the level that was actually
    mined: a pattern is a group of real schedules, and its mean is the one
    summary that group supports. Perturbing it per instance — e.g. by the
    slot-wise spread — would claim a parametric distribution over 168 correlated
    slots that the data does not justify, and can produce calendars unlike any
    member of the cluster. Variation between simulated resources therefore comes
    from *which* pattern they draw, not from noise inside one.

    Types without patterns get no entry and keep whatever the caller falls back
    to (typically the type calendar).

    Args:
        resource_pool_expanded: ``{resource_type: [instance_id, ...]}``.
        shift_patterns: ``{resource_type: [ShiftPattern.to_dict(), ...]}``.
        rng: Random source for shuffling patterns onto instances.

    Returns:
        ``{instance_id: {weekday: [24 floats]}}``.
    """
    assigned: dict[str, dict[str, list[float]]] = {}
    for rtype, rids in resource_pool_expanded.items():
        patterns = shift_patterns.get(rtype) or []
        if not patterns or not rids:
            continue
        counts = _largest_remainder([p["share"] for p in patterns], len(rids))
        slots = [k for k, c in enumerate(counts) for _ in range(c)]
        rng.shuffle(slots)
        for rid, k in zip(rids, slots, strict=True):
            assigned[rid] = copy.deepcopy(patterns[k]["probability"])
    return assigned
