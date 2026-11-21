"""
One look for every evaluation figure: the style of the TOTeM conformance paper.

Each log has one colour, one marker and one short name, and keeps them in every figure
of every chapter, so a reader can follow a log across the dissertation. The first eight
are exactly those of the conformance paper's figures (tab10, markers in the order the
paper's notebook assigned them to the alphabetically sorted names). Logs added later
continue with the two unused tab10 colours and then five colours in tab10's own
lightness and saturation range (OKLab L 0.5-0.7, chroma 0.12-0.18), chosen so that every
pair of the fifteen colours is at least as far apart (OKLab distance 12.2) as the
closest pair within tab10 itself (11.3). Fifteen colours cannot all be told apart by
colour-blind readers, so every log also has a marker of its own: the marker, not the
colour, is what identifies a log in greyscale print or for a colour-blind reader.

Never derive a log's style from its position in a list: a figure that leaves a log out
would then repaint all the others. Add new logs to LOG_STYLES instead.
"""

from __future__ import annotations

from dataclasses import dataclass

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402


@dataclass(frozen=True)
class LogStyle:
    label: str
    color: str
    marker: str


LOG_STYLES: dict[str, LogStyle] = {
    # The TOTeM conformance paper (BPM 2026), unchanged.
    "age-of-empires": LogStyle("AoE", "#1f77b4", "o"),
    "bundestag": LogStyle("Bundestag", "#ff7f0e", "s"),
    "container_logistics": LogStyle("ContLog", "#2ca02c", "^"),
    "enron": LogStyle("Enron", "#d62728", "D"),
    "hinge-production": LogStyle("Hinge", "#9467bd", "v"),
    "order-management": LogStyle("OrderMgmt", "#8c564b", "P"),
    "ocel2-p2p": LogStyle("P2P", "#e377c2", "*"),
    "lrms-reasoning-steps": LogStyle("ReasonBM", "#7f7f7f", "X"),
    # The OCCN and process-area papers' logs.
    "o2c": LogStyle("O2C", "#bcbd22", "h"),
    "recruiting": LogStyle("Recruiting", "#17becf", "p"),
    "transfer-order": LogStyle("Transfer", "#4c701a", "d"),
    "p2p": LogStyle("P2P (SAP)", "#a02a83", "<"),
    "github-pm4py": LogStyle("GitHub", "#7a97fb", ">"),
    "windows-events": LogStyle("Windows", "#ac8b26", "H"),
    "angular-github-commits": LogStyle("Angular", "#ce6f70", "8"),
}

_FALLBACK = LogStyle("?", "#ffffff", ".")


def log_style(name: str) -> LogStyle:
    """The style of a log; an unknown log is drawn black with its own name."""
    style = LOG_STYLES.get(name)
    if style is None:
        return LogStyle(name, _FALLBACK.color, _FALLBACK.marker)
    return style


def legend_order(names) -> list[str]:
    """Logs sorted by their short name, as the paper's legends are."""
    return sorted(set(names), key=lambda name: log_style(name).label.lower())


# Point and axis settings of the paper's notebook.
SCATTER = dict(s=60, alpha=0.8, edgecolors="black", linewidths=0.5)
LINE = dict(markersize=5, linewidth=1.5)
GRID = dict(alpha=0.3)
LABEL_SIZE = 14
TICK_SIZE = 12
LEGEND_SIZE = 12
PANEL_SIZE = (5, 4.5)  # one panel of the paper's 15 x 4.5 three-panel figure

RC = {
    "font.size": 12,
    "axes.labelsize": LABEL_SIZE,
    "axes.titlesize": 16,
    "xtick.labelsize": TICK_SIZE,
    "ytick.labelsize": TICK_SIZE,
    "legend.fontsize": LEGEND_SIZE,
    "pdf.fonttype": 42,  # editable text in the PDF, as LaTeX expects
    "savefig.bbox": "tight",
}
plt.rcParams.update(RC)


def scatter_log(ax, name: str, xs, ys, **kwargs):
    """One log's points in its own colour and marker."""
    style = log_style(name)
    return ax.scatter(xs, ys, label=style.label, marker=style.marker, color=style.color,
                      **{**SCATTER, **kwargs})


def plot_log(ax, name: str, xs, ys, **kwargs):
    """One log's line, with its marker at every point."""
    style = log_style(name)
    return ax.plot(xs, ys, label=style.label, marker=style.marker, color=style.color,
                   **{**LINE, **kwargs})


def finish_axes(ax, xlabel: str | None = None, ylabel: str | None = None, *,
                log_x: bool = False, log_y: bool = False) -> None:
    if log_x:
        ax.set_xscale("log")
    if log_y:
        ax.set_yscale("log")
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=LABEL_SIZE)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=LABEL_SIZE)
    ax.tick_params(labelsize=TICK_SIZE)
    ax.grid(True, **GRID)


def legend_right(fig, axes) -> None:
    """One legend for the whole figure, right of the last panel, logs sorted by name."""
    entries = {}
    for ax in axes:
        for handle, label in zip(*ax.get_legend_handles_labels()):
            entries.setdefault(label, handle)
    if not entries:
        return
    ordered = sorted(entries, key=str.lower)
    special = [label for label in ordered if label not in _log_labels()]
    logs = [label for label in ordered if label in _log_labels()]
    labels = logs + special
    fig.legend([entries[label] for label in labels], labels, loc="center left",
               bbox_to_anchor=(1.0, 0.5), borderaxespad=0.0, frameon=True,
               fontsize=LEGEND_SIZE)


def legend_below(fig, axes, ncol: int = 5) -> None:
    """The paper's legend for a grid of panels: centred under the figure."""
    entries = {}
    for ax in axes:
        for handle, label in zip(*ax.get_legend_handles_labels()):
            entries.setdefault(label, handle)
    if not entries:
        return
    labels = sorted(entries, key=str.lower)
    fig.legend([entries[label] for label in labels], labels, loc="upper center",
               bbox_to_anchor=(0.5, 0.0), ncol=ncol, fontsize=LEGEND_SIZE)


def _log_labels() -> set[str]:
    return {style.label for style in LOG_STYLES.values()}
