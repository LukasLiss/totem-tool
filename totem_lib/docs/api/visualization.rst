Visualization
=============

Draw models with Graphviz. TOTeM models, process areas, directly-follows
graphs, Petri nets and causal nets have a ``plot()`` method, and a Jupyter
notebook shows them as a picture. The two functions below do the same for any
of these models. Drawing needs the Graphviz ``dot`` program, see
:doc:`../installation`.

.. currentmodule:: totem_lib

.. autosummary::
   :toctree: generated

   plot
   to_graphviz
