import duckdb
from pathlib import Path
from totem_lib.ocel.importer import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json, load_objects_from_json,
    load_events_from_xml, load_objects_from_xml,
    import_ocel_from_csv, import_ocel
)

# Get paths relative to this script's location
script_dir = Path(__file__).parent.parent  # Goes to backend/

#data=duckdb.read_json(str(script_dir / 'user_files/ContainerLogistics.json'))
data=import_ocel(str(script_dir / 'user_files/order-management.sqlite'))
print(data)
duckdb.register('events', data.events.to_pandas())
duckdb.register('objects', data.objects.to_pandas())

#print(duckdb.sql('SELECT * FROM events'))
print(duckdb.sql('SELECT * FROM objects'))

print(duckdb.sql("""SELECT e._activity, e._objects, e._qualifiers FROM events e WHERE CAST(e._objects AS VARCHAR) LIKE '%Benedikt Knopp%'"""))
