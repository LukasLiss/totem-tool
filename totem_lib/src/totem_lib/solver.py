"""
Shared MILP solving for the PuLP models in totem_lib.

HiGHS (via the ``highspy`` wheel) is the primary solver: it ships native builds
for every platform we target, including Apple Silicon, so results do not depend
on which external solver binary happens to be installed. CBC is kept as a
fallback (PuLP's bundled binary, or one on ``PATH``).
"""

import logging
import shutil

from pulp import HiGHS, PULP_CBC_CMD, LpProblem, LpStatus

logger = logging.getLogger(__name__)


def _solvers():
    # gapRel=0: insist on the true optimum rather than HiGHS's default 0.01 %
    # gap, so results match the exact optimum CBC reports for these small models.
    yield "HiGHS", lambda: HiGHS(msg=False, gapRel=0)
    sys_cbc = shutil.which("cbc")
    yield "CBC", lambda: PULP_CBC_CMD(path=sys_cbc, msg=0) if sys_cbc else PULP_CBC_CMD(msg=0)


def solve(problem: LpProblem) -> str:
    """
    Solve ``problem`` in place and return its PuLP status string.

    Tries HiGHS first, then CBC, and returns the first ``"Optimal"`` result.
    If no solver reaches optimality, the last status seen is returned
    (``"Not Solved"`` if no solver could run at all) and a warning is logged.
    """
    status = "Not Solved"
    for name, make_solver in _solvers():
        try:
            status = LpStatus[problem.solve(make_solver())]
        except Exception as exc:  # missing binary, broken install, solver crash
            logger.warning("%s solver unavailable for %r: %s", name, problem.name, exc)
            continue
        if status == "Optimal":
            return status
        logger.warning("%s returned %r for %r", name, status, problem.name)
    logger.warning("No solver found an optimal solution for %r", problem.name)
    return status
