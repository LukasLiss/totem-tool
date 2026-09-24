Playout
=======

Enumerate the complete executions that an OCPN or OCCN allows for a fixed
number of objects, and reduce them to object-centric variants.

.. currentmodule:: totem_lib

Run a playout
-------------

.. autosummary::
   :toctree: generated

   playout_from_model_dict
   run_playout
   PlayoutConfig
   PlayoutResult
   PlayoutProgress
   PlayoutVariant
   TooManyBindingsError

Engines
-------

.. autosummary::
   :toctree: generated

   create_ocpn_engine
   create_occn_engine
   PlayoutEngine
   PlayoutStep
   PlayoutEvent

Helpers
-------

.. autosummary::
   :toctree: generated

   canonicalize_execution
   event_letter
   variants_to_ocel_dict
