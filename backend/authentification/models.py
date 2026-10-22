"""This app defines no models.

The module still has to exist: Django only sends ``post_migrate`` to apps
that have a models module, and ``ensure_guest_user`` (see ``apps.py``) relies
on that signal to create or repair the local Guest account on every
``migrate``. Without this file the handler never runs, and the account is only
seeded if the very first ``migrate`` of a database happens in local mode.
"""
