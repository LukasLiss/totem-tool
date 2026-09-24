Event logs
==========

Load OCEL 2.0 event logs, filter them, and add columns to their events.

.. currentmodule:: totem_lib

Load a log
----------

.. autosummary::
   :toctree: generated

   import_ocel
   ObjectCentricEventLog
   ocel.import_ocel_db
   ocel.OcelDuckDB

Filter
------

.. autosummary::
   :toctree: generated

   FilterRule
   FilterStack
   apply_filter_stack
   filter_dead_objects

Event columns
-------------

.. autosummary::
   :toctree: generated

   list_event_columns
   event_column_summary
   validate_event_column_name
   write_event_column
   write_event_columns_to_file
   EventColumnError

Convert
-------

.. autosummary::
   :toctree: generated

   convert_ocel_polars_to_pm4py
