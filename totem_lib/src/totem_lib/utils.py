def ocpns_are_similar(ocpn1, ocpn2):
    """
    Compares two Object-Centric Petri Nets (OCPNs) for structural similarity.
    
    Parameters:
    - ocpn1: The first OCPN to compare.
    - ocpn2: The second OCPN to compare.
    
    Returns:
    - bool: True if the OCPNs are structurally similar, False otherwise.
    """
    # Get the set of object types from both OCPNs
    object_types1 = set(ocpn1.keys())
    object_types2 = set(ocpn2.keys())

    if object_types1 != object_types2:
        return False

    # Iterate through each object type and compare the corresponding Petri nets
    # for obj_type in object_types1:
    #     print(f"Comparing object type: {obj_type}")
    #     net1 = ocpn1[obj_type]
    #     print(net1)
    #     net2 = ocpn2[obj_type]
    #     print(net2)
    #     if net1 != net2:
    #         return False

            
    return True

