import pm4py
import os
from totem_lib import (
    import_ocel,
    discover_oc_petri_net_polars,
    ocpns_are_similar,
    convert_ocel_polars_to_pm4py,
)
from datetime import datetime

import pandas as pd
from pm4py.objects.ocel.obj import OCEL


def analyze_ocel_diff(
    ocel1: OCEL, ocel2: OCEL, ocel1_name="OCEL 1", ocel2_name="OCEL 2"
):
    """
    Compares two PM4Py OCEL objects and prints a detailed analysis of their
    differences in stats, columns, and entity IDs.
    """
    print(f"--- 🔍 Starting OCEL Comparison: {ocel1_name} vs {ocel2_name} ---")

    # === 1. Compare Basic Statistics ===
    print("\n## 📊 Summary Statistics")
    stats = {
        "Events": (len(ocel1.events), len(ocel2.events)),
        "Objects": (len(ocel1.objects), len(ocel2.objects)),
        "Relations": (len(ocel1.relations), len(ocel2.relations)),
    }
    print(f"| Metric | {ocel1_name} | {ocel2_name} | Difference |")
    print(f"|---|---|---|---|")
    for metric, (v1, v2) in stats.items():
        diff = v2 - v1
        status = "✅" if diff == 0 else "⚠️"
        print(f"| {metric} | {v1} | {v2} | {diff:+} {status} |")

    # === 2. Compare DataFrame Columns ===
    print("\n## 🏛️ DataFrame Column Comparison")

    def compare_cols(name, cols1, cols2):
        print(f"### {name} Columns")
        cols1, cols2 = set(cols1), set(cols2)
        if cols1 == cols2:
            print(f"✅ Columns are identical.")
            return

        print(f"⚠️ Columns are DIFFERENT.")
        if cols1 - cols2:
            print(f"  - Only in {ocel1_name}: {sorted(list(cols1 - cols2))}")
        if cols2 - cols1:
            print(f"  - Only in {ocel2_name}: {sorted(list(cols2 - cols1))}")

    compare_cols("Events", ocel1.events.columns, ocel2.events.columns)
    compare_cols("Objects", ocel1.objects.columns, ocel2.objects.columns)
    compare_cols("Relations", ocel1.relations.columns, ocel2.relations.columns)

    # === 3. Compare Entity IDs ===
    print("\n## 🆔 ID Content Comparison")

    def compare_ids(name, set1, set2):
        print(f"### {name} IDs")
        if set1 == set2:
            print(f"✅ All {name} IDs are identical.")
            return

        only_in_1 = set1 - set2
        only_in_2 = set2 - set1

        if only_in_1:
            print(f"  - ❗️ {len(only_in_1)} IDs found only in {ocel1_name}.")
            if len(only_in_1) < 10:
                print(f"    - Sample: {list(only_in_1)[:5]}")

        if only_in_2:
            print(f"  - ❗️ {len(only_in_2)} IDs found only in {ocel2_name}.")
            if len(only_in_2) < 10:
                print(f"    - Sample: {list(only_in_2)[:5]}")

        # Specific check for the object that caused the error
        if name == "Object" and "vh130" in only_in_1:
            print(
                f"  - 🚨 NOTE: 'vh130' is in {ocel1_name} but missing from {ocel2_name}."
            )
        if name == "Object" and "vh130" in only_in_2:
            print(
                f"  - 🚨 NOTE: 'vh130' is in {ocel2_name} but missing from {ocel1_name}."
            )

    # Get sets of IDs
    eids1 = set(ocel1.events["ocel:eid"])
    eids2 = set(ocel2.events["ocel:eid"])
    oids1 = set(ocel1.objects["ocel:oid"])
    oids2 = set(ocel2.objects["ocel:oid"])

    compare_ids("Event", eids1, eids2)
    compare_ids("Object", oids1, oids2)

    # === 4. Check Relational Integrity (Source of your KeyError) ===
    print("\n## 🔗 Relational Integrity Check")

    def check_integrity(name, ocel, oids_set):
        print(f"### Checking {name}...")
        rel_oids = set(ocel.relations["ocel:oid"])
        missing_oids = rel_oids - oids_set

        if not missing_oids:
            print(f"✅ All related objects exist in the objects table.")
        else:
            print(
                f"  - ❌ ERROR: {len(missing_oids)} object IDs are in the relations table but NOT in the objects table!"
            )
            print(f"    - Sample missing: {list(missing_oids)[:5]}")
            if "vh130" in missing_oids:
                print(
                    f"    - 🚨 CRITICAL: 'vh130' is one of the missing objects. This is the cause of your KeyError."
                )

    check_integrity(ocel1_name, ocel1, oids1)
    check_integrity(ocel2_name, ocel2, oids2)

    print("\n--- ✅ Comparison Finished ---")


import pandas as pd
from pm4py.objects.ocel.obj import OCEL


def analyze_ocel_diff(
    ocel1: OCEL, ocel2: OCEL, ocel1_name="OCEL 1", ocel2_name="OCEL 2"
):
    """
    Compares two PM4Py OCEL objects and prints a detailed analysis of their
    differences, including FULL LISTS of differing IDs.
    """
    print(f"--- 🔍 Starting OCEL Comparison: {ocel1_name} vs {ocel2_name} ---")

    # === 1. Compare Basic Statistics ===
    print("\n## 📊 Summary Statistics")
    stats = {
        "Events": (len(ocel1.events), len(ocel2.events)),
        "Objects": (len(ocel1.objects), len(ocel2.objects)),
        "Relations": (len(ocel1.relations), len(ocel2.relations)),
    }
    print(f"| Metric | {ocel1_name} | {ocel2_name} | Difference |")
    print(f"|---|---|---|---|")
    for metric, (v1, v2) in stats.items():
        diff = v2 - v1
        status = "✅" if diff == 0 else "⚠️"
        print(f"| {metric} | {v1} | {v2} | {diff:+} {status} |")

    # === 2. Compare DataFrame Columns ===
    print("\n## 🏛️ DataFrame Column Comparison")

    def compare_cols(name, cols1, cols2):
        print(f"### {name} Columns")
        cols1, cols2 = set(cols1), set(cols2)
        if cols1 == cols2:
            print(f"✅ Columns are identical.")
            return

        print(f"⚠️ Columns are DIFFERENT.")
        if cols1 - cols2:
            print(f"  - Only in {ocel1_name}: {sorted(list(cols1 - cols2))}")
        if cols2 - cols1:
            print(f"  - Only in {ocel2_name}: {sorted(list(cols2 - cols1))}")

    compare_cols("Events", ocel1.events.columns, ocel2.events.columns)
    compare_cols("Objects", ocel1.objects.columns, ocel2.objects.columns)
    compare_cols("Relations", ocel1.relations.columns, ocel2.relations.columns)

    # === 3. Compare Entity IDs ===
    print("\n## 🆔 ID Content Comparison")

    def compare_ids(name, set1, set2):
        print(f"### {name} IDs")
        if set1 == set2:
            print(f"✅ All {name} IDs are identical.")
            return

        only_in_1 = set1 - set2
        only_in_2 = set2 - set1

        if only_in_1:
            print(f"  - ❗️ {len(only_in_1)} IDs found only in {ocel1_name}:")
            # *** CHANGED: Print full sorted list ***
            print(f"    {sorted(list(only_in_1))}")

        if only_in_2:
            print(f"  - ❗️ {len(only_in_2)} IDs found only in {ocel2_name}:")
            # *** CHANGED: Print full sorted list ***
            print(f"    {sorted(list(only_in_2))}")

        # Specific check for the object that caused the error
        if name == "Object" and "vh130" in only_in_1:
            print(
                f"  - 🚨 NOTE: 'vh130' is in {ocel1_name} but missing from {ocel2_name}."
            )
        if name == "Object" and "vh130" in only_in_2:
            print(
                f"  - 🚨 NOTE: 'vh130' is in {ocel2_name} but missing from {ocel1_name}."
            )

    # Get sets of IDs
    eids1 = set(ocel1.events["ocel:eid"])
    eids2 = set(ocel2.events["ocel:eid"])
    oids1 = set(ocel1.objects["ocel:oid"])
    oids2 = set(ocel2.objects["ocel:oid"])

    compare_ids("Event", eids1, eids2)
    compare_ids("Object", oids1, oids2)

    # === 4. Check Relational Integrity (Source of your KeyError) ===
    print("\n## 🔗 Relational Integrity Check")

    def check_integrity(name, ocel, oids_set):
        print(f"### Checking {name}...")
        rel_oids = set(ocel.relations["ocel:oid"])
        missing_oids = rel_oids - oids_set

        if not missing_oids:
            print(f"✅ All related objects exist in the objects table.")
        else:
            print(
                f"  - ❌ ERROR: {len(missing_oids)} object IDs are in the relations table but NOT in the objects table!"
            )
            # *** CHANGED: Print full sorted list ***
            print(f"    - Full list of missing IDs: {sorted(list(missing_oids))}")
            if "vh130" in missing_oids:
                print(
                    f"    - 🚨 CRITICAL: 'vh130' is one of the missing objects. This is the cause of your KeyError."
                )

    check_integrity(ocel1_name, ocel1, oids1)
    check_integrity(ocel2_name, ocel2, oids2)

    print("\n--- ✅ Comparison Finished ---")


# Using pm4py
start_pm4py = datetime.now()
ocel_1 = pm4py.read_ocel2_json(os.path.join("example_data", "ContainerLogistics.json"))
print(ocel_1)
print("Events in the imported OCEL:")
ocel_events_1 = ocel_1.events
print(ocel_events_1)
print("Objects in the imported OCEL:")
ocel_objects_1 = ocel_1.objects
print(ocel_objects_1)

ocpn_from_pm4py = pm4py.discover_oc_petri_net(ocel_1)
end_pm4py = datetime.now()
print(f"PM4Py OCPN discovery took: {end_pm4py - start_pm4py}")
pm4py.save_vis_ocpn(
    ocpn_from_pm4py, os.path.join("figures", "ContainerLogistics_ocpn_pm4py.png")
)

# Using totem_lib with Polars and the adapter
start_lib = datetime.now()
ocel_2 = import_ocel(os.path.join("example_data", "ContainerLogistics.json"))
ocel_2 = convert_ocel_polars_to_pm4py(ocel_2)  # convert to PM4Py OCEL
print(ocel_2)
print("Events in the imported OCEL:")
ocel_events_2 = ocel_2.events
print(ocel_events_2)
print("Objects in the imported OCEL:")
ocel_objects_2 = ocel_2.objects
print(ocel_objects_2)


print("Analyzing differences between the two OCEL imports:")
analyze_ocel_diff(
    ocel1=ocel_1, ocel2=ocel_2, ocel1_name="PM4Py Import", ocel2_name="totem_lib Import"
)

# ocpn_from_lib = discover_oc_petri_net_polars(ocel)  # uses an adapter internally
ocpn_from_lib = pm4py.discover_oc_petri_net(ocel_2)  # directly use PM4Py function
end_lib = datetime.now()
print(f"totem_lib OCPN discovery took: {end_lib - start_lib}")
pm4py.save_vis_ocpn(
    ocpn_from_lib, os.path.join("figures", "ContainerLogistics_ocpn_lib.png")
)

print("Are the two OCPNs similar?", ocpns_are_similar(ocpn_from_pm4py, ocpn_from_lib))
