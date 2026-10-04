Variants and process executions
===============================

Split a log into process executions, group them into object-centric variants,
and compare executions by edit distance.

.. currentmodule:: totem_lib

Variants
--------

.. autosummary::
   :toctree: generated

   find_variants
   calculate_layout

Process executions
------------------

.. autosummary::
   :toctree: generated

   extract_process_executions
   ProcessExecutions
   partition_events
   EventPartition
   variant_assignment
   variant_ids_by_case

Edit distance
-------------

.. autosummary::
   :toctree: generated

   process_execution_edit_distance
   Edit
   EditCosts
