"""
Plot OC-Handover performance results.

Produces two figures saved next to the results file:
  OCHANDOVER_PLOT_PHASES.png   — grouped stacked bar chart (time breakdown per config)
  OCHANDOVER_PLOT_SCATTER.png  — scatter plots of BFS time vs EOG arcs / BO objects

Run from the totem_lib/ directory:
    python evaluation/ochandover_plot.py
"""

import sys
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.lines as mlines
import numpy as np

SCRIPT_DIR   = Path(__file__).parent
RESULTS_FILE = SCRIPT_DIR / "OCHANDOVER_PERFORMANCE_RESULTS.md"

# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def parse_results(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text().splitlines():
        if not line.startswith("| ") or line.startswith("| Log") or line.startswith("|---"):
            continue
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) < 14:
            continue
        try:
            rows.append({
                "log":        parts[0],
                "events":     int(parts[1]),
                "level":      parts[2],
                "parallel":   parts[5],
                "n_bo_obj":   int(parts[6]),
                "eog_arcs":   int(parts[7]),
                "t_eog":      float(parts[8]),
                "t_bfs":      float(parts[9]),
                "t_agg":      float(parts[10]),
                "t_total":    float(parts[11]),
                "n_pairs":    int(parts[12]),
                "n_res_pairs":int(parts[13]),
            })
        except (ValueError, IndexError):
            continue
    return rows


# ---------------------------------------------------------------------------
# Colours / markers
# ---------------------------------------------------------------------------

LOG_COLORS = {}
_PALETTE   = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B2"]

def _log_color(log: str) -> str:
    if log not in LOG_COLORS:
        LOG_COLORS[log] = _PALETTE[len(LOG_COLORS) % len(_PALETTE)]
    return LOG_COLORS[log]

def _marker(parallel: str) -> str:
    return "o" if parallel == "—" else "^"


# ---------------------------------------------------------------------------
# Figure 1 — stacked bar chart (phase breakdown)
# ---------------------------------------------------------------------------

def plot_phases(rows: list[dict], out: Path) -> None:
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["log"], r["level"])
        if key not in groups:
            groups[key] = {}
        variant = "on" if r["parallel"] != "—" else "off"
        groups[key][variant] = (r["t_eog"], r["t_bfs"], r["t_agg"])

    labels  = [f"{log}\nL{level}" for log, level in groups]
    n       = len(labels)
    x       = np.arange(n)
    bar_w   = 0.35

    colors = {"EOG": "#4C72B0", "BFS": "#DD8452", "Agg.": "#55A868"}

    def _vals(variant, idx):
        return [groups[k].get(variant, (0, 0, 0))[idx] for k in groups]

    fig, ax = plt.subplots(figsize=(max(10, n * 1.1), 5))

    for variant, offset in (("off", -bar_w / 2), ("on", bar_w / 2)):
        hatch = None if variant == "off" else "//"
        eog = _vals(variant, 0)
        bfs = _vals(variant, 1)
        agg = _vals(variant, 2)
        ax.bar(x + offset, eog, bar_w, color=colors["EOG"], hatch=hatch)
        ax.bar(x + offset, bfs, bar_w, bottom=eog, color=colors["BFS"], hatch=hatch)
        ax.bar(x + offset, agg, bar_w,
               bottom=[e + b for e, b in zip(eog, bfs)], color=colors["Agg."], hatch=hatch)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("Time (s)")
    ax.set_title("Handover Computation Time by Phase")

    phase_handles = [mpatches.Patch(color=c, label=p) for p, c in colors.items()]
    par_handles   = [
        mpatches.Patch(facecolor="white", edgecolor="black", label="Parallel off"),
        mpatches.Patch(facecolor="white", edgecolor="black", hatch="//", label="Parallel on"),
    ]
    ax.legend(handles=phase_handles + par_handles, loc="upper left", fontsize=8)
    ax.set_xlim(-0.6, n - 0.4)
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"Saved {out}")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figure 2 — scatter plots
# ---------------------------------------------------------------------------

def _scatter_ax(ax, rows, x_key, y_key, xlabel, ylabel, title):
    for r in rows:
        ax.scatter(
            r[x_key], r[y_key],
            color=_log_color(r["log"]),
            marker=_marker(r["parallel"]),
            s=70, zorder=3,
        )
    ax.set_xlabel(xlabel, fontsize=9)
    ax.set_ylabel(ylabel, fontsize=9)
    ax.set_title(title, fontsize=10)
    ax.grid(True, linestyle="--", alpha=0.4)


def plot_scatter(rows: list[dict], out: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    _scatter_ax(axes[0], rows,
                x_key="eog_arcs", y_key="t_bfs",
                xlabel="EOG Arcs", ylabel="BFS Time (s)",
                title="BFS Time vs EOG Arc Count")

    _scatter_ax(axes[1], rows,
                x_key="n_bo_obj", y_key="t_bfs",
                xlabel="BO Object Instances", ylabel="BFS Time (s)",
                title="BFS Time vs BO Object Count")

    # Shared legend — log colours
    logs = sorted({r["log"] for r in rows})
    color_handles = [mpatches.Patch(color=_log_color(l), label=l) for l in logs]
    par_handles   = [
        mlines.Line2D([], [], color="black", marker="o", linestyle="None", label="Parallel off"),
        mlines.Line2D([], [], color="black", marker="^", linestyle="None", label="Parallel on"),
    ]
    fig.legend(
        handles=color_handles + par_handles,
        loc="lower center", ncol=len(logs) + 2,
        fontsize=8, bbox_to_anchor=(0.5, -0.05),
    )

    fig.suptitle("BFS Time Scaling", fontsize=12, y=1.01)
    fig.tight_layout()
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print(f"Saved {out}")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Shared helper for annotated scatter
# ---------------------------------------------------------------------------

def _annotated_scatter(rows, x_key, y_key, xlabel, ylabel, title, out):
    fig, ax = plt.subplots(figsize=(8, 5))

    for r in rows:
        ax.scatter(
            r[x_key], r[y_key],
            color=_log_color(r["log"]),
            marker=_marker(r["parallel"]),
            s=80, zorder=3,
        )
        label = f"{r['log'].split('-')[0]} L{r['level']}"
        ax.annotate(
            label,
            xy=(r[x_key], r[y_key]),
            xytext=(6, 4), textcoords="offset points",
            fontsize=7, color=_log_color(r["log"]),
        )

    ax.set_xlabel(xlabel, fontsize=10)
    ax.set_ylabel(ylabel, fontsize=10)
    ax.set_title(title, fontsize=11)
    ax.grid(True, linestyle="--", alpha=0.4)

    logs          = sorted({r["log"] for r in rows})
    color_handles = [mpatches.Patch(color=_log_color(l), label=l) for l in logs]
    par_handles   = [
        mlines.Line2D([], [], color="black", marker="o", linestyle="None", label="Parallel off"),
        mlines.Line2D([], [], color="black", marker="^", linestyle="None", label="Parallel on"),
    ]
    ax.legend(handles=color_handles + par_handles, fontsize=8, loc="upper left")

    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"Saved {out}")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Figure 3 — BFS time vs EOG arcs (dedicated, annotated)
# ---------------------------------------------------------------------------

def plot_bfs_vs_eog_arcs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="eog_arcs", y_key="t_bfs",
        xlabel="EOG Arc Count", ylabel="BFS Time (s)",
        title="BFS Time vs EOG Arc Count", out=out)


def plot_bfs_vs_handovers(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_pairs", y_key="t_bfs",
        xlabel="Handover Pairs", ylabel="BFS Time (s)",
        title="BFS Time vs Handover Pairs", out=out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not RESULTS_FILE.exists():
        print(f"Results file not found: {RESULTS_FILE}")
        sys.exit(1)

    rows = parse_results(RESULTS_FILE)
    if not rows:
        print("No data rows found.")
        sys.exit(1)

    plot_phases(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_PHASES.png")
    plot_scatter(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_SCATTER.png")
    plot_bfs_vs_eog_arcs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_BFS_VS_EOG.png")
    plot_bfs_vs_handovers(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_BFS_VS_HANDOVERS.png")


if __name__ == "__main__":
    main()
