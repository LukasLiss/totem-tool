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
                "log":               parts[0],
                "events":            int(parts[1]),
                "level":             parts[2],
                "parallel":          parts[5],
                "n_bo_obj":          int(parts[6]),
                "n_bo_res_cooc":     int(parts[7]),
                "avg_res_per_event": float(parts[8]),
                "complexity_est":    float(parts[9]),
                "eog_arcs":          int(parts[10]),
                "n_eog_nodes":       int(parts[11]),
                "eog_density":       float(parts[12]),
                "t_eog":             float(parts[13]),
                "t_bfs":             float(parts[14]),
                "t_expansion":          float(parts[15]),
                "t_collapse":          float(parts[16]),
                "t_agg":             float(parts[17]),
                "t_total":           float(parts[18]),
                "avg_gap":           float(parts[19]),
                "n_raw":             int(parts[20]),
                "n_five_tuples":     int(parts[21]),
                "n_canonicals":      int(parts[22]),
                "n_pairs":           int(parts[23]),
                "n_instances":       int(parts[24]),
                "n_res_pairs":       int(parts[25]),
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
        groups[key][variant] = (r["t_eog"], r["t_bfs"], r["t_expansion"], r["t_collapse"], r["t_agg"])

    keys    = list(groups.keys())
    n       = len(keys)
    x       = np.arange(n)
    bar_w   = 0.35

    colors = {"EOG": "#4C72B0", "BFS": "#DD8452", "Expansion": "#C44E52", "Collapse": "#8172B2", "Agg.": "#55A868"}

    def _vals(variant, idx):
        return [groups[k].get(variant, (0, 0, 0, 0, 0))[idx] for k in keys]

    fig, ax = plt.subplots(figsize=(max(12, n * 1.4), 9))

    for variant, offset in (("off", -bar_w / 2), ("on", bar_w / 2)):
        hatch = None if variant == "off" else "//"
        eog    = _vals(variant, 0)
        bfs    = _vals(variant, 1)
        filt   = _vals(variant, 2)
        expand = _vals(variant, 3)
        agg    = _vals(variant, 4)
        b1 = eog
        b2 = [a + b for a, b in zip(b1, bfs)]
        b3 = [a + b for a, b in zip(b2, filt)]
        b4 = [a + b for a, b in zip(b3, expand)]
        ax.bar(x + offset, eog,    bar_w,           color=colors["EOG"],       hatch=hatch)
        ax.bar(x + offset, bfs,    bar_w, bottom=b1, color=colors["BFS"],       hatch=hatch)
        ax.bar(x + offset, filt,   bar_w, bottom=b2, color=colors["Expansion"], hatch=hatch)
        ax.bar(x + offset, expand, bar_w, bottom=b3, color=colors["Collapse"],  hatch=hatch)
        ax.bar(x + offset, agg,    bar_w, bottom=b4, color=colors["Agg."],      hatch=hatch)

    # Hierarchical x-axis: level ticks on top, log name once per group below.
    ax.set_xticks(x)
    ax.set_xticklabels([f"L{level}" for _, level in keys], fontsize=10)
    ax.tick_params(axis="x", length=4)

    # Compute log groups (consecutive runs of the same log name).
    log_groups: list[tuple[str, int, int]] = []
    cur_log, grp_start = None, 0
    for i, (log, _) in enumerate(keys):
        if log != cur_log:
            if cur_log is not None:
                log_groups.append((cur_log, grp_start, i - 1))
            cur_log, grp_start = log, i
    if cur_log is not None:
        log_groups.append((cur_log, grp_start, len(keys) - 1))

    # Draw log name labels and separator lines in axis coordinates.
    y_label = -0.05   # below the level ticks in axes fraction
    for i, (log_name, start, end) in enumerate(log_groups):
        cx = (start + end) / 2
        ax.text(cx, y_label, log_name, ha="center", va="top",
                fontsize=10, transform=ax.get_xaxis_transform())
        # Separator line before each log group (except the first).
        if start > 0:
            sep_x = (start - 1 + start) / 2
            ax.axvline(sep_x, color="grey", linewidth=0.8, linestyle="--", alpha=0.6)

    ax.set_ylabel("Time (s)", fontsize=11)
    ax.set_title("Handover Computation Time by Phase", fontsize=12)
    ax.set_xlim(-0.6, n - 0.4)

    phase_handles = [mpatches.Patch(color=c, label=p) for p, c in colors.items()]
    par_handles   = [
        mpatches.Patch(facecolor="white", edgecolor="black", label="Parallel off"),
        mpatches.Patch(facecolor="white", edgecolor="black", hatch="//", label="Parallel on"),
    ]
    ax.legend(handles=phase_handles + par_handles, loc="upper left", fontsize=10)

    fig.tight_layout()
    fig.subplots_adjust(bottom=0.08)
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
    from collections import defaultdict

    fig, ax = plt.subplots(figsize=(8, 5))

    for r in rows:
        ax.scatter(
            r[x_key], r[y_key],
            color=_log_color(r["log"]),
            marker=_marker(r["parallel"]),
            s=80, zorder=3,
        )

    # One label per (log, level) group at the midpoint; thin line connects the pair.
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        groups[(r["log"], r["level"])].append(r)

    for (log, level), grp in groups.items():
        xs = [r[x_key] for r in grp]
        ys = [r[y_key] for r in grp]
        mx = sum(xs) / len(xs)
        my = sum(ys) / len(ys)
        if len(grp) == 2:
            ax.plot(xs, ys, color=_log_color(log), linewidth=0.8, alpha=0.35, zorder=2)
        ax.annotate(
            f"L{level}",
            xy=(mx, my),
            xytext=(6, 4), textcoords="offset points",
            fontsize=7, color=_log_color(log),
        )

    ax.set_xlabel(xlabel, fontsize=10)
    ax.set_ylabel(ylabel, fontsize=10)
    if title:
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


def plot_gap_vs_total(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="avg_gap", y_key="t_total",
        xlabel="Avg Gap Size", ylabel="Total Time (s)",
        title="Total Computation Time vs Avg Gap Size", out=out)


def plot_cooc_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_bo_res_cooc", y_key="t_bfs",
        xlabel="BO × Resource Event Co-occurrences", ylabel="BFS Time (s)",
        title="BFS Time vs BO×Resource Co-occurrences", out=out)


def plot_density_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="eog_density", y_key="t_bfs",
        xlabel="EOG Density (arcs / nodes)", ylabel="BFS Time (s)",
        title="BFS Time vs EOG Density", out=out)


def plot_avg_res_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="avg_res_per_event", y_key="t_bfs",
        xlabel="Avg Resource Objects per Event", ylabel="BFS Time (s)",
        title="BFS Time vs Avg Resources per Event", out=out)


def plot_complexity_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="complexity_est", y_key="t_bfs",
        xlabel="Complexity Estimate (BO×Res Co-occ × EOG Density × Avg Res/Event)",
        ylabel="BFS Time (s)",
        title="BFS Time vs Complexity Estimate", out=out)


def plot_instances_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_instances", y_key="t_bfs",
        xlabel="Handover Instances (total raw resource-pair observations)",
        ylabel="BFS Time (s)",
        title="BFS Time vs Handover Instances", out=out)


def plot_canonicals_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_canonicals", y_key="t_bfs",
        xlabel="Canonical Bridges",
        ylabel="BFS Time (s)",
        title="BFS Time vs Canonical Bridges", out=out)


def plot_raw_vs_bfs(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_raw", y_key="t_bfs",
        xlabel="Raw 3-Tuples |S| (resource segments)",
        ylabel="BFS Time (s)",
        title="BFS Time vs Raw Resource Segments", out=out)


def plot_raw_vs_total(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_raw", y_key="t_total",
        xlabel="Number of Resource Segments |S|",
        ylabel="Total Time (s)",
        title="", out=out)


def plot_five_tuples_vs_expansion(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_five_tuples", y_key="t_expansion",
        xlabel="5-Tuples |H| (handover instances)",
        ylabel="Expansion Time (s)",
        title="Expansion Time vs Handover 5-Tuples", out=out)


def plot_five_tuples_vs_total(rows: list[dict], out: Path) -> None:
    _annotated_scatter(rows,
        x_key="n_five_tuples", y_key="t_total",
        xlabel="Number of Handover Instances |H|",
        ylabel="Total Time (s)",
        title="", out=out)


def plot_expansion_ratio(rows: list[dict], out: Path) -> None:
    """Bar chart of |H| / |S| per log-level-parallel configuration."""
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["log"], r["level"])
        if key not in groups:
            groups[key] = {}
        variant = "on" if r["parallel"] != "—" else "off"
        ratio = round(r["n_five_tuples"] / r["n_raw"], 2) if r["n_raw"] > 0 else 0.0
        groups[key][variant] = ratio

    keys  = list(groups.keys())
    n     = len(keys)
    x     = np.arange(n)
    bar_w = 0.35

    fig, ax = plt.subplots(figsize=(max(12, n * 1.4), 6))

    for variant, offset in (("off", -bar_w / 2), ("on", bar_w / 2)):
        hatch  = None if variant == "off" else "//"
        vals   = [groups[k].get(variant, 0.0) for k in keys]
        colors = [_log_color(log) for log, _ in keys]
        ax.bar(x + offset, vals, bar_w, color=colors, hatch=hatch, edgecolor="white", alpha=0.85)

    ax.axhline(1.0, color="grey", linewidth=0.8, linestyle="--", alpha=0.6)

    ax.set_xticks(x)
    ax.set_xticklabels([f"L{level}" for _, level in keys], fontsize=10)
    ax.tick_params(axis="x", length=4)
    ax.set_ylabel("|H| / |S|", fontsize=11)

    # Log group labels and separators.
    log_groups: list[tuple[str, int, int]] = []
    cur_log, grp_start = None, 0
    for i, (log, _) in enumerate(keys):
        if log != cur_log:
            if cur_log is not None:
                log_groups.append((cur_log, grp_start, i - 1))
            cur_log, grp_start = log, i
    if cur_log is not None:
        log_groups.append((cur_log, grp_start, len(keys) - 1))

    for log_name, start, end in log_groups:
        cx = (start + end) / 2
        ax.text(cx, -0.05, log_name, ha="center", va="top",
                fontsize=10, transform=ax.get_xaxis_transform())
        if start > 0:
            ax.axvline((start - 1 + start) / 2, color="grey", linewidth=0.8, linestyle="--", alpha=0.6)

    par_handles = [
        mpatches.Patch(facecolor="white", edgecolor="black", label="Parallel off"),
        mpatches.Patch(facecolor="white", edgecolor="black", hatch="//", label="Parallel on"),
    ]
    logs          = sorted({log for log, _ in keys})
    color_handles = [mpatches.Patch(color=_log_color(l), label=l) for l in logs]
    ax.legend(handles=color_handles + par_handles, fontsize=10, loc="upper left")

    fig.tight_layout()
    fig.subplots_adjust(bottom=0.08)
    fig.savefig(out, dpi=150)
    print(f"Saved {out}")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Per-log phase breakdown — one file per event log, saved in a subfolder
# ---------------------------------------------------------------------------

def plot_phases_per_log(rows: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(exist_ok=True)

    colors = {"EOG": "#4C72B0", "BFS": "#DD8452", "Expansion": "#C44E52", "Collapse": "#8172B2", "Agg.": "#55A868"}

    # Group: log → level → variant → (t_eog, t_bfs, t_expansion, t_collapse, t_agg)
    by_log: dict[str, dict] = {}
    for r in rows:
        log   = r["log"]
        level = r["level"]
        variant = "on" if r["parallel"] != "—" else "off"
        by_log.setdefault(log, {}).setdefault(level, {})[variant] = (
            r["t_eog"], r["t_bfs"], r["t_expansion"], r["t_collapse"], r["t_agg"]
        )

    for log, levels in by_log.items():
        sorted_levels = sorted(levels.keys())
        n      = len(sorted_levels)
        x      = np.arange(n)
        bar_w  = 0.35

        fig, ax = plt.subplots(figsize=(max(4, n * 1.6 + 1), 5))

        for variant, offset in (("off", -bar_w / 2), ("on", bar_w / 2)):
            hatch  = None if variant == "off" else "//"
            z      = (0, 0, 0, 0, 0)
            eog    = [levels[l].get(variant, z)[0] for l in sorted_levels]
            bfs    = [levels[l].get(variant, z)[1] for l in sorted_levels]
            filt   = [levels[l].get(variant, z)[2] for l in sorted_levels]
            expand = [levels[l].get(variant, z)[3] for l in sorted_levels]
            agg    = [levels[l].get(variant, z)[4] for l in sorted_levels]
            b1 = eog
            b2 = [a + b for a, b in zip(b1, bfs)]
            b3 = [a + b for a, b in zip(b2, filt)]
            b4 = [a + b for a, b in zip(b3, expand)]
            ax.bar(x + offset, eog,    bar_w,          color=colors["EOG"],    hatch=hatch, edgecolor="white")
            ax.bar(x + offset, bfs,    bar_w, bottom=b1, color=colors["BFS"],    hatch=hatch, edgecolor="white")
            ax.bar(x + offset, filt,   bar_w, bottom=b2, color=colors["Expansion"], hatch=hatch, edgecolor="white")
            ax.bar(x + offset, expand, bar_w, bottom=b3, color=colors["Collapse"], hatch=hatch, edgecolor="white")
            ax.bar(x + offset, agg,    bar_w, bottom=b4, color=colors["Agg."],   hatch=hatch, edgecolor="white")

        ax.set_xticks(x)
        ax.set_xticklabels([f"Level {l}" for l in sorted_levels], fontsize=10)
        ax.set_ylabel("Time (s)")
        ax.set_title(f"{log} — Handover Computation Time by Phase")
        ax.set_xlim(-0.6, n - 0.4)

        phase_handles = [mpatches.Patch(color=c, label=p) for p, c in colors.items()]
        par_handles   = [
            mpatches.Patch(facecolor="white", edgecolor="black",
                           label="Parallel off"),
            mpatches.Patch(facecolor="white", edgecolor="black", hatch="//",
                           label="Parallel on"),
        ]
        ax.legend(handles=phase_handles + par_handles, fontsize=9, loc="upper left")

        fig.tight_layout()
        out = out_dir / f"{log}.png"
        fig.savefig(out, dpi=150)
        print(f"Saved {out}")
        plt.close(fig)


# ---------------------------------------------------------------------------
# Expansion ratio table
# ---------------------------------------------------------------------------

EXPANSION_RATIO_FILE = SCRIPT_DIR / "OCHANDOVER_EXPANSION_RATIO.md"

def write_expansion_ratio_table(rows: list[dict]) -> None:
    header = "| Log | Level | Parallel | Resource Segments |S| | Handover Instances |H| | |H| / |S| | Total Time (s) |"
    sep    = "|---|---|---|---|---|---|---|"
    with open(EXPANSION_RATIO_FILE, "w") as f:
        f.write("# OC-Handover — Expansion Ratio |H| / |S|\n\n")
        f.write(f"{header}\n{sep}\n")
        for r in rows:
            ratio = round(r["n_five_tuples"] / r["n_raw"], 2) if r["n_raw"] > 0 else "—"
            f.write(
                f"| {r['log']} | {r['level']} | {r['parallel']} "
                f"| {r['n_raw']} | {r['n_five_tuples']} | {ratio} | {r['t_total']} |\n"
            )
    print(f"Expansion ratio table written to {EXPANSION_RATIO_FILE}")


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
    plot_gap_vs_total(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_GAP_VS_TOTAL.png")
    plot_cooc_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_COOC_VS_BFS.png")
    plot_density_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_DENSITY_VS_BFS.png")
    plot_avg_res_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_AVG_RES_VS_BFS.png")
    plot_complexity_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_COMPLEXITY_VS_BFS.png")
    plot_instances_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_INSTANCES_VS_BFS.png")
    plot_raw_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_RAW_VS_BFS.png")
    plot_raw_vs_total(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_RAW_VS_TOTAL.png")
    plot_five_tuples_vs_expansion(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_FIVETUPLES_VS_EXPANSION.png")
    plot_five_tuples_vs_total(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_FIVETUPLES_VS_TOTAL.png")
    plot_expansion_ratio(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_EXPANSION_RATIO.png")
    write_expansion_ratio_table(rows)
    plot_canonicals_vs_bfs(rows, SCRIPT_DIR / "OCHANDOVER_PLOT_CANONICALS_VS_BFS.png")
    plot_phases_per_log(rows, SCRIPT_DIR / "phases")


if __name__ == "__main__":
    main()
