

class OCProcessAreaSimulationModel:
    """
    Represents the Object-Centric Simulation Model for a specific process area.
    
    This model captures the behavior of objects, resources and their apearance in activities based on the OCEL and the discovered variants. 
    It can be used to simulate the execution of the process area under different scenarios, such as varying arrival rates, resource availability, and object interactions.
    It includes: 
    - ToTem Model: The discovered ToTem model for the process, giving higher-level information about the process
    - PlayoutStrategy: Strategy for the playout of the simulation model. This can be a simple playout based on the discovered variants, or a more complex playout based on the stochastic state-space of the process.
    - Resource Constraints: Constraints captued from the OCEL or coming from user input, that represent extra knowledge about the resources used by different events
    - Resource Allocation Strategy: A strategy for allocating resources to events during the simulation, based on the observed behavior in the OCEL or from user input.
    - Resource Cooldown Distribution: A distribution capturing the cooldown times of resources after being used in specific events. 
    """

    def __init__(self, playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_distribution, totem_model):
        self.playout_strategy = playout_strategy
        self.resource_constraints = resource_constraints
        self.resource_allocation_strategy = resource_allocation_strategy
        self.resource_cooldown_distribution = resource_cooldown_distribution
        self.totem_model = totem_model

    def run(self):
        return self.playout_strategy.run(self)

    @classmethod
    def for_simple_simulation(cls, ocel, process_area):

        # Calculate Resource Cooldown Distribution
        resource_cooldown_dist = resource_cooldown_distribution(ocel, process_area.object_types, process_area.activities)
        
        # Filter event log on Process Area
        mlpa = mlpaDiscovery(cls.totem_model)
        filtered_ocel = ocel.filter_by_process_area(mlpa, get_level_of_process_area(mlpa, process_area), process_area)

        # Calculate Variants
        variants = find_object_variants_connected_component(filtered_ocel)

        # Calculate Variants Arrival Distribution
        variant_arrival_distribution = variant_arrival_distribution(filtered_ocel, variants)

        # Initilize Playout Strategy
        playout_strategy = VariantPlayoutStrategy(variants, variant_arrival_distribution)

        # Calculate Resource Constraints
        resource_constraints = generate_resource_constraints(filtered_ocel, process_area, 0.8, 2, 5)

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(filtered_ocel, resource_cooldown_dist, ocel.obj_type_map)
        
        return cls(playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_dist)

    @classmethod
    def for_advanced_simulation(cls, ocel, process_area):
        # TODO: Implement advanced simulation model (state-space, connected components + arrival distribution)

        # Calculate Resource Cooldown Distribution
        resource_cooldown_dist = resource_cooldown_distribution(ocel, process_area.object_types, process_area.activities)
        
        # Filter event log on Process Area
        mlpa = mlpaDiscovery(cls.totem_model)
        filtered_ocel = ocel.filter_by_process_area(mlpa, get_level_of_process_area(mlpa, process_area), process_area)

        # Calculate State-Space

        # Calculate Connected Components

        # Calculate Connected Component Arrival Distribution

        # Initilize Playout Strategy
        playout_strategy = StateSpacePlayoutStrategy()

        # Calculate Resource Constraints
        resource_constraints = generate_resource_constraints(filtered_ocel, process_area, 0.8, 2, 5)

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(filtered_ocel, resource_cooldown_dist, ocel.obj_type_map)
        
        return cls(playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_dist)


class VariantPlayoutStrategy:
    """
    A simple playout strategy that simulates the execution of the process based on the discovered variants. 
    It can be used to simulate the process under the assumption that the behavior of the process is well captured by the discovered variants, and that the arrival of new cases follows the observed variant distribution.
    Input needed:
    - Variants: The discovered variants from the OCEL, giving the possible execution paths in the process
    - Variant Arrival Distribution: Distribution of variant arrivals, used for simulating the arrival of new cases in the process
    """
    def __init__(self, variants, variant_arrival_distribution):
        self.variants = variants
        self.variant_arrival_distribution = variant_arrival_distribution
        return
    
    def run(self, simulation_model):
        return

class StateSpacePlayoutStrategy:
    """
    A more complex playout strategy that simulates the execution of the process based on the stochastic state-space of the process. 
    It can be used to simulate the process using a Stochastic State-space approach, receiving just Connected-Components of Objects as Input, and calculating the connected Events, based on the state space.
    Input needed:
    - Stochastic State-space: A representation of the process behavior in terms of states and transitions, capturing the probabilities of events appearances and object interactions.
    - Connected Component Distribution: A distribution of the connected components of objects, used for simulating the arrival of new cases in the process.
    """
    def __init__(self, state_space, connected_component_distribution):
        self.state_space = state_space
        self.connected_component_distribution = connected_component_distribution
        return
    
    def run(self, simulation_model):
        return



def get_level_of_process_area(mlpa, process_area):
    process_area_activities = set(process_area.activities)
    for level in sorted(mlpa.keys()):
        for _, activities in mlpa[level]:
            if process_area_activities & activities:
                return level
    return None


if __name__ == "__main__":
    from datetime import datetime
    import networkx as nx
    from totem_lib import totemDiscovery, import_ocel, mlpaDiscovery
    from totem_lib.variants.ocvariants import find_object_variants_connected_component
    from totem_lib.simulation.utils.resource_constraints import generate_resource_constraints
    from totem_lib.simulation.utils.basic_simulation_statistics import (
        variant_arrival_distribution,
        object_distribution_of_variants,
        resource_distribution_of_variants,
    )
    from totem_lib.simulation.utils.resource_statistics import (
        resource_cooldown_distribution,
        calculate_resource_allocation_strategy
    )

    # load a sample OCEL
    print(f'Start importing Event Log, start time: {datetime.now()}')
    ocel = import_ocel(r'C:\Users\basti\Documents\Studium\MA\container_logistics.json')
    #ocel = import_ocel(r'C:\Users\basti\Documents\Studium\MA\ocel2-export.xml')

    print(f'Start totem Discovery, start time: {datetime.now()}')
    totem = totemDiscovery(ocel)

    print(f'Start MLPA Discovery, start time: {datetime.now()}')
    mlpa = mlpaDiscovery(totem)
    print(mlpa)

    filtered_ocel = ocel.filter_by_process_area(mlpa, 2, ['Transport Document', 'Customer Order', 'Container'])
    #print (filtered_ocel.events)

    connected_components = find_object_variants_connected_component(ocel)
    #for variant in connected_components:
        #print(variant)
        #print(variant.graph.nodes(data=True))
    #print(generate_resource_constraints(filtered_ocel, connected_components, 0.8, 2, 5))

    cooldown = resource_cooldown_distribution(ocel, ['Transport Document', 'Customer Order', 'Container'], ['Reschedule Container', 'Register Customer Order', 'Load Truck'])
    #print(cooldown)

    #print(calculate_resource_allocation_strategy(filtered_ocel, cooldown, ocel.obj_type_map))