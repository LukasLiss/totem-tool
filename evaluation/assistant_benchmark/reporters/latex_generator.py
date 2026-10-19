import os
from typing import Any, Dict, List


def generate_latex_accuracy_table(
    aggregated_runs: List[Dict[str, Any]],
    output_path: str,
    caption: str = "Empirical Evaluation of AI Assistant across Prompts and Harnesses",
    label: str = "tab:assistant_eval",
) -> str:
    """
    Generate publication-ready LaTeX table for academic research papers.
    Aggregates by (Model, Prompt Strategy, Harness).
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    latex_lines = [
        r"\begin{table*}[t]",
        r"\centering",
        r"\small",
        f"\\caption{{{caption}}}",
        f"\\label{{{label}}}",
        r"\begin{tabular}{lllcccccc}",
        r"\toprule",
        r"\textbf{Model} & \textbf{Prompt Strategy} & \textbf{Harness} & \textbf{Descriptive} & \textbf{Bottleneck} & \textbf{Lifespan} & \textbf{Discovery} & \textbf{UI Action} & \textbf{Overall Acc. (\%)} \\",
        r"\midrule",
    ]

    for run in aggregated_runs:
        model = run.get("model", "-")
        prompt = run.get("prompt", "-").replace("_", r"\_")
        harness = run.get("harness", "-").upper()
        cat_acc = run.get("category_accuracy", {})

        desc_acc = f"{cat_acc.get('descriptive', 0.0):.1f}\\%"
        bottle_acc = f"{cat_acc.get('bottleneck', 0.0):.1f}\\%"
        life_acc = f"{cat_acc.get('lifespan', 0.0):.1f}\\%"
        disc_acc = f"{cat_acc.get('discovery', 0.0):.1f}\\%"
        ui_acc = f"{cat_acc.get('ui_action', 0.0):.1f}\\%"
        overall_acc = f"\\textbf{{{run.get('accuracy_pct', 0.0):.1f}\\%}}"

        row = f"{model} & {prompt} & {harness} & {desc_acc} & {bottle_acc} & {life_acc} & {disc_acc} & {ui_acc} & {overall_acc} \\\\"
        latex_lines.append(row)

    latex_lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table*}",
        "",
    ])

    content = "\n".join(latex_lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    return content


def generate_latex_efficiency_table(
    aggregated_runs: List[Dict[str, Any]],
    output_path: str,
    caption: str = "Efficiency, Token Consumption, and Latency Comparison",
    label: str = "tab:assistant_efficiency",
) -> str:
    """
    Generate publication-ready LaTeX table for latency, token costs, and tool accuracy.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    latex_lines = [
        r"\begin{table}[ht]",
        r"\centering",
        r"\small",
        f"\\caption{{{caption}}}",
        f"\\label{{{label}}}",
        r"\begin{tabular}{llccc}",
        r"\toprule",
        r"\textbf{Prompt} & \textbf{Harness} & \textbf{Latency (s)} & \textbf{Mean Tokens} & \textbf{Tool Acc. (\%)} \\",
        r"\midrule",
    ]

    for run in aggregated_runs:
        prompt = run.get("prompt", "-").replace("_", r"\_")
        harness = run.get("harness", "-").upper()
        latency = f"{run.get('mean_latency_s', 0.0):.2f}"
        mean_tokens = f"{int(run.get('mean_tokens_per_task', 0))}"
        tool_acc = f"{run.get('tool_accuracy_pct', 0.0):.1f}\\%"

        row = f"{prompt} & {harness} & {latency} & {mean_tokens} & {tool_acc} \\\\"
        latex_lines.append(row)

    latex_lines.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
        "",
    ])

    content = "\n".join(latex_lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    return content
