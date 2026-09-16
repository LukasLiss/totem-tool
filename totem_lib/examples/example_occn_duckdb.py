"""
End-to-end OCCN example: DuckDB import -> discovery -> thresholding -> JSON.

This is the same pipeline the TOTeM web application runs behind its
/api/occn/ endpoint. See examples/OCCN.md for the full documentation and
the JSON schema, and https://doi.org/10.1007/978-3-031-94571-7_6 for the
underlying paper (original miner: https://github.com/LukasLiss/OCCN-Miner).

Run from the totem_lib directory:

    python3 examples/example_occn_duckdb.py
"""

import json
from pathlib import Path

from totem_lib import discover_occn, serialize_occn
from totem_lib.ocel import import_ocel_db

DATASET = Path(__file__).parent.parent / "test_data" / "small" / "container_logistics.duckdb"


def main():
    db = import_ocel_db(str(DATASET))

    # Discovery is the expensive step, so mine once without filtering ...
    base_occn = discover_occn(db, relativeOccuranceThreshold=0)

    filtered_occn = base_occn.apply_relative_occurrence_threshold(0.4)

    for label, occn in [("threshold 0.0", base_occn), ("threshold 0.4", filtered_occn)]:
        n_groups = sum(len(mgs) for mgs in occn.input_marker_groups.values()) + sum(
            len(mgs) for mgs in occn.output_marker_groups.values()
        )
        print(
            f"{label}: {len(occn.activities)} activities, "
            f"{len(occn.object_types)} object types, {n_groups} marker groups"
        )

    # Serialize for the frontend; the result is plain JSON.
    payload = serialize_occn(filtered_occn)
    print(f"serialized payload: {len(json.dumps(payload)) / 1024:.1f} KiB")

    busiest = max(payload["activities"], key=lambda a: a["count"])
    print(f"most frequent activity: {busiest['id']} ({busiest['count']} events)")

    db.close()


if __name__ == "__main__":
    main()
