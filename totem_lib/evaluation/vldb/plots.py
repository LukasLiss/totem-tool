"""
Generate the paper figures (PDF) from the benchmark result CSVs.

Usage: python plots.py [output_dir]   (default: <repo>/paper/figures)
"""

import csv
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).parent
RESULTS = HERE / "results"
DEFAULT_OUT = HERE.parent.parent.parent / "paper" / "figures"

plt.rcParams.update({
    "font.size": 8,
    "axes.titlesize": 8,
    "axes.labelsize": 8,
    "legend.fontsize": 7,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "figure.dpi": 150,
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})

ENGINE_STYLE = {
    "duckdb":   dict(color="#1b7837", marker="o", label="TOTEM-DB (DuckDB)"),
    "polars":   dict(color="#d73027", marker="s", label="in-memory (Polars)"),
    "pm4py":    dict(color="#4575b4", marker="^", label="pm4py"),
    "window":   dict(color="#1b7837", marker="o", label="window function"),
    "selfjoin": dict(color="#d73027", marker="s", label="self-join (naive)"),
    "eager":    dict(color="#1b7837", marker="o", label="eager aggregation"),
    "lazy":     dict(color="#d73027", marker="s", label="lazy (naive)"),
}


def read(name):
    path = RESULTS / f"{name}.csv"
    if not path.exists():
        return []
    with open(path) as f:
        return list(csv.DictReader(f))


def _f(row, key):
    v = row.get(key)
    return float(v) if v not in (None, "", "None") else None


def line_panel(ax, rows, key_col, title, timeout_s=600.0):
    """One log-log runtime panel; failed points drawn as X at their budget."""
    variants = []
    for r in rows:
        if r[key_col] not in variants:
            variants.append(r[key_col])
    for variant in variants:
        sub = [r for r in rows if r[key_col] == variant]
        xs_ok = [int(r["n_events"]) for r in sub if r["status"] == "ok"]
        ys_ok = [_f(r, "elapsed_s") for r in sub if r["status"] == "ok"]
        style = ENGINE_STYLE.get(variant, dict(marker="o", label=variant))
        ax.plot(xs_ok, ys_ok, markersize=3.5, linewidth=1.2, **style)
        fail = [r for r in sub if r["status"] in ("timeout", "oom", "error")]
        for r in fail:
            y = _f(r, "elapsed_s") or timeout_s
            ax.plot([int(r["n_events"])], [y], marker="x", markersize=6,
                    color=style.get("color", "k"), linestyle="none")
            ax.annotate(r["status"].upper(),
                        (int(r["n_events"]), y), textcoords="offset points",
                        xytext=(0, 4), ha="center", fontsize=6,
                        color=style.get("color", "k"))
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("events")
    ax.set_title(title)
    ax.grid(True, which="both", alpha=0.25, linewidth=0.4)


def fig_scaling(out):
    rows = read("scaling")
    if not rows:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.3))
    line_panel(axes[0], [r for r in rows if r["algo"] == "ocdfg"
                         and r["status"] != "skipped"], "engine", "OC-DFG discovery")
    line_panel(axes[1], [r for r in rows if r["algo"] == "totem"
                         and r["status"] != "skipped"], "engine", "TOTeM discovery")
    axes[0].set_ylabel("runtime [s]")
    axes[0].legend(frameon=False)
    axes[1].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "fig_scaling.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_scaling_memory(out):
    rows = [r for r in read("scaling") if r["status"] == "ok"]
    if not rows:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.3))
    for ax, algo, title in ((axes[0], "ocdfg", "OC-DFG discovery"),
                            (axes[1], "totem", "TOTeM discovery")):
        sub_rows = [r for r in rows if r["algo"] == algo]
        engines = []
        for r in sub_rows:
            if r["engine"] not in engines:
                engines.append(r["engine"])
        for engine in engines:
            sub = [r for r in sub_rows if r["engine"] == engine]
            xs = [int(r["n_events"]) for r in sub]
            ys = [_f(r, "peak_rss_mb") for r in sub]
            style = ENGINE_STYLE.get(engine, dict(marker="o", label=engine))
            ax.plot(xs, ys, markersize=3.5, linewidth=1.2, **style)
        ax.set_xscale("log")
        ax.set_yscale("log")
        ax.set_xlabel("events")
        ax.set_title(title)
        ax.grid(True, which="both", alpha=0.25, linewidth=0.4)
    axes[0].set_ylabel("peak RSS [MB]")
    axes[0].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "fig_scaling_memory.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_ablation(out):
    rows = read("ablation")
    if not rows:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.3))
    line_panel(axes[0], [r for r in rows if r["algo"] == "ocdfg"
                         and r["status"] != "skipped"], "variant",
               "OC-DFG: adjacent-pair formation")
    line_panel(axes[1], [r for r in rows if r["algo"] == "totem"
                         and r["status"] != "skipped"], "variant",
               "TOTeM: lifetime aggregation")
    axes[0].set_ylabel("runtime [s]")
    axes[0].legend(frameon=False)
    axes[1].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "fig_ablation.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_incremental(out):
    rows = [r for r in read("incremental") if r["status"] == "ok"]
    if not rows:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.3))
    width = 0.27
    for ax, algo, title in ((axes[0], "ocdfg", "OC-DFG"),
                            (axes[1], "totem", "TOTeM")):
        sub = [r for r in rows if r["algo"] == algo]
        xs = range(len(sub))
        ax.bar([x - width for x in xs], [_f(r, "mean_append_s") for r in sub],
               width, label="maintain (per batch)", color="#1b7837")
        ax.bar(list(xs), [_f(r, "mean_refresh_s") for r in sub],
               width, label="refresh model", color="#a6dba0")
        ax.bar([x + width for x in xs], [_f(r, "full_recompute_s") for r in sub],
               width, label="full recompute", color="#d73027")
        ax.set_xticks(list(xs))
        ax.set_xticklabels([f"{int(r['n_events']) // 1000}k" if int(r['n_events']) < 1_000_000
                            else f"{int(r['n_events']) // 1_000_000}M" for r in sub])
        ax.set_yscale("log")
        ax.set_xlabel("log size [events]")
        ax.set_title(title)
        ax.grid(True, axis="y", alpha=0.25, linewidth=0.4)
    axes[0].set_ylabel("time [s]")
    axes[0].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "fig_incremental.pdf", bbox_inches="tight")
    plt.close(fig)


def fig_real(out):
    rows = [r for r in read("real")
            if r["algo"] in ("ocdfg", "totem") and r["status"] == "ok"]
    if not rows:
        return
    logs = ["container_logistics", "ocel2-p2p", "order-management"]
    log_labels = ["Logistics", "P2P", "Orders"]
    combos = [("ocdfg", "duckdb"), ("ocdfg", "polars"), ("ocdfg", "pm4py"),
              ("totem", "duckdb"), ("totem", "polars")]
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.3))
    for ax, algo, title in ((axes[0], "ocdfg", "OC-DFG"),
                            (axes[1], "totem", "TOTeM")):
        engines = [e for a, e in combos if a == algo]
        width = 0.8 / len(engines)
        for i, engine in enumerate(engines):
            ys = []
            for log in logs:
                match = [r for r in rows
                         if r["log"] == log and r["algo"] == algo
                         and r["engine"] == engine]
                ys.append(_f(match[0], "elapsed_s") if match else 0.0)
            xs = [j + (i - (len(engines) - 1) / 2) * width for j in range(len(logs))]
            style = ENGINE_STYLE.get(engine, {})
            ax.bar(xs, ys, width * 0.9, label=style.get("label", engine),
                   color=style.get("color"))
        ax.set_xticks(range(len(logs)))
        ax.set_xticklabels(log_labels)
        ax.set_yscale("log")
        ax.set_title(title)
        ax.grid(True, axis="y", alpha=0.25, linewidth=0.4)
    axes[0].set_ylabel("runtime [s]")
    axes[0].legend(frameon=False)
    axes[1].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "fig_real.pdf", bbox_inches="tight")
    plt.close(fig)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.mkdir(parents=True, exist_ok=True)
    fig_scaling(out)
    fig_scaling_memory(out)
    fig_ablation(out)
    fig_incremental(out)
    fig_real(out)
    print(f"figures written to {out}")


if __name__ == "__main__":
    main()
