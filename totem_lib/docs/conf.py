"""Sphinx configuration for the totem-lib documentation.

Build the docs from the totem_lib folder:

    pip install -e ".[docs]"
    sphinx-build -W --keep-going docs docs/_build/html
"""

import inspect
from importlib.metadata import version as package_version

project = "totem-lib"
author = "Lukas Liss"
copyright = "2025, Lukas Liss"
release = package_version("totem-lib")
version = release

extensions = [
    "myst_nb",  # Markdown pages and Jupyter notebooks
    "sphinx.ext.autodoc",  # API pages from docstrings
    "sphinx.ext.autosummary",
    "sphinx.ext.napoleon",  # Google and NumPy style docstrings
    "sphinx.ext.viewcode",  # "[source]" links to the code
    "sphinx_copybutton",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "jupyter_execute", "**.ipynb_checkpoints"]

# -- API reference -------------------------------------------------------------

# Write one page per function or class listed in docs/api/*.rst.
autosummary_generate = True
# Show type hints in the parameter list instead of the signature.
autodoc_typehints = "description"
autodoc_member_order = "bysource"
# Class pages show the class docstring and the __init__ docstring.
autoclass_content = "both"
# Many docstrings mark code with `single backticks`, like Markdown.
# Show that as code instead of italics.
default_role = "code"

# -- Notebooks -----------------------------------------------------------------

# Run every notebook on every build, so a broken example fails the build.
nb_execution_mode = "force"
nb_execution_timeout = 300
nb_execution_raise_on_error = True
nb_execution_show_tb = True
# Leave stderr (warnings from dependencies) out of the rendered pages.
nb_output_stderr = "remove"

# -- HTML output ---------------------------------------------------------------

# To try another theme, install it and change this line.
html_theme = "furo"
html_title = "totem-lib"
html_favicon = "_static/favicon.svg"


def _drop_type_docstrings(app, what, name, obj, options, lines):
    """Hide a docstring that a value only has because of its type.

    Without this, a constant like ``CONNECTED_COMPONENTS_REPLAY_STRATEGY``
    shows the docstring of ``str``.
    """
    type_doc = inspect.getdoc(type(obj))
    if what in ("data", "attribute") and type_doc and "\n".join(lines).strip() == type_doc:
        lines.clear()


def setup(app):
    # Run before napoleon, which changes the lines.
    app.connect("autodoc-process-docstring", _drop_type_docstrings, priority=100)
