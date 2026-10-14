"""
totem_lib is MIT licensed, so none of its runtime dependencies may be under a
strong copyleft license (GPL / AGPL). pm4py (AGPL-3.0) and cvxopt (GPL-3.0)
were removed for this reason; this test keeps them, or anything like them,
from coming back through a new direct or transitive dependency.

LGPL and file-level copyleft licenses such as MPL-2.0 are fine for a
dependency and are not flagged.
"""

import re
from importlib import metadata

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

# GPL / AGPL in SPDX ids ("AGPL-3.0-or-later"), classifiers ("GNU General
# Public License v3 (GPLv3)") or free-text license fields, but not LGPL.
COPYLEFT = re.compile(r"\bA?GPL|GNU (Affero )?General Public License", re.IGNORECASE)


def _runtime_closure(root: str) -> dict:
    """Every installed distribution `root` needs at runtime (extras excluded)."""
    found, pending = {}, [root]
    while pending:
        name = canonicalize_name(pending.pop())
        if name in found:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        found[name] = dist
        for spec in dist.requires or []:
            requirement = Requirement(spec)
            if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
                pending.append(requirement.name)
    return found


def _license_texts(dist) -> list:
    md = dist.metadata
    texts = [md.get("License-Expression") or ""]
    texts += [c for c in md.get_all("Classifier") or [] if c.startswith("License ::")]
    license_field = (md.get("License") or "").strip()
    if any(texts):
        # Packages that declare their license properly sometimes also paste
        # their whole license file here, with notices about bundled
        # third-party code; only its first line names their own license.
        texts.append(license_field.split("\n")[0])
    else:
        # Otherwise the full text is all there is (cvxopt names the GPL only
        # a few paragraphs in).
        texts.append(license_field)
    return [t for t in texts if t]


def test_copyleft_pattern():
    for text in (
        "AGPL-3.0-or-later",
        "GPL-3.0",
        "License :: OSI Approved :: GNU General Public License v3 (GPLv3)",
        "License :: OSI Approved :: GNU Affero General Public License v3",
    ):
        assert COPYLEFT.search(text), text
    for text in (
        "MIT",
        "LGPL-3.0-or-later",
        "License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)",
        "MPL-2.0 AND MIT",
    ):
        assert not COPYLEFT.search(text), text


def test_no_copyleft_runtime_dependencies():
    try:
        metadata.distribution("totem-lib")
    except metadata.PackageNotFoundError:
        pytest.skip("totem-lib is not installed as a distribution")

    offenders = {
        name: matches
        for name, dist in _runtime_closure("totem-lib").items()
        if (matches := [m.group(0) for t in _license_texts(dist) if (m := COPYLEFT.search(t))])
    }
    assert not offenders, f"Copyleft-licensed runtime dependencies: {offenders}"
