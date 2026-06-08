"""
Temporal distance measures between two object-centric event logs.

All three measures rely on the 1D 1st Wasserstein distance (equivalent to
EMD for equal-mass distributions) between event-time histograms:

- AED (Absolute Event Distribution) — overall trend over absolute time.
- CED (Circadian Event Distribution) — seasonality across the days of the week.
- RED (Relative Event Distribution) — distribution of events relative to the
  start of their execution.

The bin keys are passed to scipy as the actual support points (hours since
epoch / relative hours / hour-of-day), so gaps between bins contribute their
true distance instead of collapsing to neighbouring indices.

Adapted from: Chapela-Campa et al. (BPM 2023)
"""

from collections import Counter
from datetime import datetime, timezone, tzinfo

from scipy.stats import wasserstein_distance

from totem_lib.simulation.evaluation._eval_utils import (
    event_timestamps,
    event_timestamps_per_execution,
    get_variants,
    wd_from_bins,
)

SECONDS_PER_HOUR = 3600
HOURS_PER_DAY = 24


def _hour_of_epoch(ts: int) -> int:
    """Integer 'hour bin' index of an epoch timestamp."""
    return ts // SECONDS_PER_HOUR


def absolute_event_distribution_distance(actual_ocel, simulated_ocel) -> float:
    """
    Absolute Event Distribution (AED) distance.

    Bins all event timestamps of both logs into hour-of-epoch bins and returns
    the weighted 1-Wasserstein distance using the bin indices as support
    points. The returned value is the average number of hours an event has to
    be shifted.

    The result is timezone-invariant: both logs are bucketed against the same
    absolute hour grid, so any uniform offset cancels out.
    """
    actual_bins = Counter(_hour_of_epoch(t) for t in event_timestamps(actual_ocel))
    sim_bins = Counter(_hour_of_epoch(t) for t in event_timestamps(simulated_ocel))
    return wd_from_bins(actual_bins, sim_bins)


def circadian_event_distribution_distance(
    actual_ocel,
    simulated_ocel,
    *,
    tz: tzinfo = timezone.utc,
) -> float:
    """
    Circadian Event Distribution (CED) distance.

    For each of the seven weekdays, computes the 1-Wasserstein distance
    between the hour-of-day distributions of actual and simulated events on
    that weekday, then averages over all seven weekdays.

    Args:
        tz: timezone used to derive weekday and hour-of-day from the unix
            timestamps. Defaults to UTC. Pass e.g. ``ZoneInfo("Europe/Berlin")``
            when the process operates on local business hours.
    """
    actual_by_wd: dict[int, list[int]] = {wd: [] for wd in range(7)}
    sim_by_wd: dict[int, list[int]] = {wd: [] for wd in range(7)}

    for ts in event_timestamps(actual_ocel):
        d = datetime.fromtimestamp(ts, tz=tz)
        actual_by_wd[d.weekday()].append(d.hour)
    for ts in event_timestamps(simulated_ocel):
        d = datetime.fromtimestamp(ts, tz=tz)
        sim_by_wd[d.weekday()].append(d.hour)

    distances = []
    for wd in range(7):
        a = actual_by_wd[wd]
        s = sim_by_wd[wd]
        if not a and not s:
            distances.append(0.0)
        elif not a or not s:
            distances.append(float(HOURS_PER_DAY - 1))
        else:
            distances.append(float(wasserstein_distance(a, s)))

    return sum(distances) / 7.0


def relative_event_distribution_distance(actual_ocel, simulated_ocel) -> float:
    """
    Relative Event Distribution (RED) distance.

    Offsets every event timestamp by its execution arrival (first event of
    the execution → time 0), bins into 1-hour relative bins and returns the
    weighted 1-Wasserstein distance with the relative-hour indices as support
    points.
    """

    def _relative_bins(ocel) -> Counter:
        bins: Counter = Counter()
        variants = get_variants(ocel)
        for ts_list in event_timestamps_per_execution(ocel, variants):
            if not ts_list:
                continue
            arrival = min(ts_list)
            for ts in ts_list:
                bins[(ts - arrival) // SECONDS_PER_HOUR] += 1
        return bins

    return wd_from_bins(_relative_bins(actual_ocel), _relative_bins(simulated_ocel))
