from typing import Dict, Any, Set, Tuple, FrozenSet


def compare_ocpns(ocpn1: Dict[str, Any], ocpn2: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compares two Object-Centric Petri Nets (OCPNs) for structural and semantic equality.

    This function avoids direct dictionary comparison, which would fail due to different
    event/object identifiers and internal model naming. Instead, it compares the
    core components of the OCPNs.

    Args:
        ocpn1: The first OCPN dictionary, as produced by the pm4py mining algorithm.
        ocpn2: The second OCPN dictionary.

    Returns:
        A dictionary containing the comparison results, including an 'overall_match'
        boolean and detailed breakdowns of each compared component.
    """
    results = {"overall_match": True, "details": {}}

    # 1. Compare top-level sets of activities and object types
    activities1 = ocpn1.get("activities", set())
    activities2 = ocpn2.get("activities", set())
    results["details"]["activities_match"] = activities1 == activities2
    if not results["details"]["activities_match"]:
        results["overall_match"] = False
        results["details"]["activities"] = {
            "ocpn1_only": list(activities1 - activities2),
            "ocpn2_only": list(activities2 - activities1),
        }

    obj_types1 = set(ocpn1.get("object_types", []))
    obj_types2 = set(ocpn2.get("object_types", []))
    results["details"]["object_types_match"] = obj_types1 == obj_types2
    if not results["details"]["object_types_match"]:
        results["overall_match"] = False
        results["details"]["object_types"] = {
            "ocpn1_only": list(obj_types1 - obj_types2),
            "ocpn2_only": list(obj_types2 - obj_types1),
        }

    # 2. Compare properties for each common object type
    common_object_types = obj_types1.intersection(obj_types2)
    ot_results = {}

    for ot in sorted(list(common_object_types)):
        ot_res = {"match": True}

        # Compare start activities (just the activity names, not counts)
        sa1 = set(
            ocpn1.get("start_activities", {}).get("events", {}).get(ot, {}).keys()
        )
        sa2 = set(
            ocpn2.get("start_activities", {}).get("events", {}).get(ot, {}).keys()
        )
        ot_res["start_activities_match"] = sa1 == sa2
        if not ot_res["start_activities_match"]:
            ot_res["match"] = False

        # Compare end activities
        ea1 = set(ocpn1.get("end_activities", {}).get("events", {}).get(ot, {}).keys())
        ea2 = set(ocpn2.get("end_activities", {}).get("events", {}).get(ot, {}).keys())
        ot_res["end_activities_match"] = ea1 == ea2
        if not ot_res["end_activities_match"]:
            ot_res["match"] = False

        # Compare double arcs on activity
        da1 = ocpn1.get("double_arcs_on_activity", {}).get(ot, {})
        da2 = ocpn2.get("double_arcs_on_activity", {}).get(ot, {})
        ot_res["double_arcs_match"] = da1 == da2
        if not ot_res["double_arcs_match"]:
            ot_res["match"] = False

        # Compare Petri nets by generating a structural signature
        net1_tuple = ocpn1.get("petri_nets", {}).get(ot)
        net2_tuple = ocpn2.get("petri_nets", {}).get(ot)

        if net1_tuple and net2_tuple:
            sig1 = _get_petri_net_signature(net1_tuple)
            sig2 = _get_petri_net_signature(net2_tuple)
            ot_res["petri_net_match"] = sig1 == sig2
            if not ot_res["petri_net_match"]:
                ot_res["match"] = False
        elif net1_tuple or net2_tuple:  # one exists but not the other
            ot_res["petri_net_match"] = False
            ot_res["match"] = False
        else:  # neither exists
            ot_res["petri_net_match"] = True

        if not ot_res["match"]:
            results["overall_match"] = False

        ot_results[ot] = ot_res

    results["details"]["object_type_details"] = ot_results

    return results


def _get_petri_net_signature(petri_net_tuple: Tuple) -> Dict[str, Any]:
    """
    Generates a signature for a Petri net based on the names of its components.
    This is a simpler comparison method that assumes that for the same input data,
    two OCPN discovery implementations should produce nets with identically
    named components.

    The signature is based on:
    - The set of transition names and labels.
    - The set of place names.
    - A representation of arcs using component names.
    - Representations of initial and final markings using place names.
    """
    net, initial_marking, final_marking = petri_net_tuple

    # Use transition names and labels for the signature.
    transition_signatures = frozenset((t.name, t.label) for t in net.transitions)

    # Use place names for the signature.
    place_names = frozenset(p.name for p in net.places)

    # Generate a set of all arcs using the names of the source and target.
    arc_signatures = frozenset((arc.source.name, arc.target.name) for arc in net.arcs)

    # Generate signatures for initial and final markings based on place names.
    im_sig = frozenset(p.name for p, count in initial_marking.items() if count > 0)
    fm_sig = frozenset(p.name for p, count in final_marking.items() if count > 0)

    # The full signature includes all components that define the net's structure.
    return {
        "transitions": transition_signatures,
        "places": place_names,
        "arcs": arc_signatures,
        "initial_marking": im_sig,
        "final_marking": fm_sig,
    }


def compare_ocpns_debug(ocpn1: Dict[str, Any], ocpn2: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compares two OCPNs and provides detailed debugging information on any
    discovered differences.

    This function is designed to help diagnose discrepancies between two OCPN
    discovery implementations by showing not just *if* they are different,
    but *what* the specific differences are.

    Args:
        ocpn1: The first OCPN dictionary.
        ocpn2: The second OCPN dictionary.

    Returns:
        A detailed dictionary of comparison results, including `_diff` keys
        for any components that do not match.
    """
    results = {"overall_match": True, "details": {}}

    # 1. Compare top-level sets of activities and object types
    activities1 = ocpn1.get("activities", set())
    activities2 = ocpn2.get("activities", set())
    results["details"]["activities_match"] = activities1 == activities2
    if not results["details"]["activities_match"]:
        results["overall_match"] = False
        results["details"]["activities_diff"] = {
            "ocpn1_only": sorted(list(activities1 - activities2)),
            "ocpn2_only": sorted(list(activities2 - activities1)),
        }

    obj_types1 = set(ocpn1.get("object_types", []))
    obj_types2 = set(ocpn2.get("object_types", []))
    results["details"]["object_types_match"] = obj_types1 == obj_types2
    if not results["details"]["object_types_match"]:
        results["overall_match"] = False
        results["details"]["object_types_diff"] = {
            "ocpn1_only": sorted(list(obj_types1 - obj_types2)),
            "ocpn2_only": sorted(list(obj_types2 - obj_types1)),
        }

    # 2. Compare properties for each common object type
    common_object_types = obj_types1.union(obj_types2)
    ot_results = {}

    for ot in sorted(list(common_object_types)):
        ot_res = {"match": True}

        # Compare start activities
        sa1 = set(
            ocpn1.get("start_activities", {}).get("events", {}).get(ot, {}).keys()
        )
        sa2 = set(
            ocpn2.get("start_activities", {}).get("events", {}).get(ot, {}).keys()
        )
        ot_res["start_activities_match"] = sa1 == sa2
        if not ot_res["start_activities_match"]:
            ot_res["match"] = False
            ot_res["start_activities_diff"] = {
                "ocpn1_only": sorted(list(sa1 - sa2)),
                "ocpn2_only": sorted(list(sa2 - sa1)),
            }

        # Compare end activities
        ea1 = set(ocpn1.get("end_activities", {}).get("events", {}).get(ot, {}).keys())
        ea2 = set(ocpn2.get("end_activities", {}).get("events", {}).get(ot, {}).keys())
        ot_res["end_activities_match"] = ea1 == ea2
        if not ot_res["end_activities_match"]:
            ot_res["match"] = False
            ot_res["end_activities_diff"] = {
                "ocpn1_only": sorted(list(ea1 - ea2)),
                "ocpn2_only": sorted(list(ea2 - ea1)),
            }

        # Compare double arcs on activity
        da1 = ocpn1.get("double_arcs_on_activity", {}).get(ot, {})
        da2 = ocpn2.get("double_arcs_on_activity", {}).get(ot, {})
        ot_res["double_arcs_match"] = da1 == da2
        if not ot_res["double_arcs_match"]:
            ot_res["match"] = False
            # You could add a diff here too if needed, comparing the dictionaries key by key

        # Compare Petri nets with detailed diff
        net1_tuple = ocpn1.get("petri_nets", {}).get(ot)
        net2_tuple = ocpn2.get("petri_nets", {}).get(ot)

        if net1_tuple and net2_tuple:
            sig1 = _get_petri_net_signature(net1_tuple)
            sig2 = _get_petri_net_signature(net2_tuple)

            petri_net_diffs = {}
            for key in sig1.keys():
                if sig1[key] != sig2[key]:
                    petri_net_diffs[key] = {
                        "ocpn1_only": sorted(list(sig1[key] - sig2[key])),
                        "ocpn2_only": sorted(list(sig2[key] - sig1[key])),
                    }

            if petri_net_diffs:
                ot_res["petri_net_match"] = False
                ot_res["petri_net_diff"] = petri_net_diffs
                ot_res["match"] = False
            else:
                ot_res["petri_net_match"] = True

        elif net1_tuple or net2_tuple:
            ot_res["petri_net_match"] = False
            ot_res["match"] = False
            ot_res["petri_net_diff"] = (
                "One OCPN has a Petri net for this object type while the other does not."
            )
        else:
            ot_res["petri_net_match"] = True

        if not ot_res["match"]:
            results["overall_match"] = False

        ot_results[ot] = ot_res

    results["details"]["object_type_details"] = ot_results
    return results


def ocpns_are_similar(ocpn1, ocpn2):
    """
    Compares two Object-Centric Petri Nets (OCPNs) for structural similarity.

    Parameters:
    - ocpn1: The first OCPN to compare.
    - ocpn2: The second OCPN to compare.

    Returns:
    - bool: True if the OCPNs are structurally similar, False otherwise.
    """
    res = compare_ocpns_debug(ocpn1, ocpn2)
    print(res)

    return res["overall_match"]
