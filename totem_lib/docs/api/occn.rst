Causal nets
===========

Object-centric causal nets (OCCN): discovery, saving and loading, playout, and
conformance checking.

.. currentmodule:: totem_lib

The model
---------

.. autosummary::
   :toctree: generated

   OCCausalNet
   OCCausalNetState
   OCCausalNetSemantics

Discovery
---------

.. autosummary::
   :toctree: generated

   discover_occn

Saving and loading
------------------

.. autosummary::
   :toctree: generated

   occn_to_dict
   occn_from_dict
   validate_occn_dict
   serialize_occn

Playout
-------

.. autosummary::
   :toctree: generated

   occn_playout

Replay fitness
--------------

.. autosummary::
   :toctree: generated

   occn_replay_fitness
   OCCNReplayFitnessResult
   OCCNReplayUnitResult
   OCCNReplayStatus

Precision
---------

.. autosummary::
   :toctree: generated

   occn_precision
   OCCNPrecisionResult
   OCCNContextDetail

Replay units
------------

Replay fitness checks replay units: sets of events that are replayed together.

.. autosummary::
   :toctree: generated

   extract_occn_replay_units
   extract_occn_replay_events
   build_connected_component_replay_units
   build_leading_object_replay_units
   build_stored_column_replay_units
   project_replay_events
   replay_events_from_ocel
   replay_events_from_duckdb
   OCCNReplayEvent
   OCCNReplayUnit
   CONNECTED_COMPONENTS_REPLAY_STRATEGY
   LEADING_OBJECT_REPLAY_STRATEGY
   STORED_COLUMN_REPLAY_STRATEGY
   REPLAY_UNIT_STRATEGIES
