# totem_lib
Library for the TOTeM paper.
Also includes a module for importing [OCEL 2.0](https://www.ocel-standard.org/) files.

# Example usage
```python
from totem_lib import import_ocel, mlpaDiscovery

# Importing with automatic filetype detection
ocel = import_ocel("example_data/ContainerLogistics.sqlite")

mlpaDiscovery(ocel)
```