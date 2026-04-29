class ProcessArea:
    """
    Represents a single process area discovered by MLPA.

    A process area groups a set of object types and their associated activities
    that belong together at a specific level in the multi-level process hierarchy.
    """

    def __init__(self, object_types: list[str], activities: list[str], level: float = None):
        self.object_types = list(object_types)
        self.activities = list(activities)
        self.level = level

    def __repr__(self):
        return (
            f"<ProcessArea level={self.level}, "
            f"object_types={self.object_types}, "
            f"activities={[a for a in self.activities[:3]]}{'...' if len(self.activities) > 3 else ''}>"
        )
