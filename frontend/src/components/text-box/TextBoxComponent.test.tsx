// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TextBoxComponent } from "@/components/componentMap";
import type { ComponentProps } from "@/components/componentMap";

// The widget resolves dashboard links against the project's dashboards.
vi.mock("@/api/dashboardApi", () => ({
  getDashboards: vi.fn(async () => [{ id: 4, name: "Sibling Board" }]),
}));

afterEach(cleanup);

/**
 * The grid hands each widget a mutable GridStack node and an `onUpdate` that
 * does `Object.assign(node, updates)` — it mutates, and never schedules a
 * React render. These drive the real widget through that exact contract.
 *
 * Per-selection behaviour lives in `richTextCommands.test.ts`, which drives
 * the shipped extension set directly; this file covers what the widget does
 * around the editor: rendering, the box-level controls, and the plumbing
 * back onto the node.
 */
function renderWidget(
  initial: Record<string, unknown> = {},
  isEditMode = true,
  extra: Partial<ComponentProps> = {},
) {
  const node: Record<string, unknown> = {
    component_id: 1,
    component_name: "TextBoxComponent",
    text: "hello",
    ...initial,
  };
  const onUpdate = vi.fn((updates: Record<string, unknown>) => {
    Object.assign(node, updates); // exactly what gridstackprovider does
  });
  const view = render(
    <TextBoxComponent
      node={node as unknown as ComponentProps["node"]}
      onUpdate={onUpdate}
      isEditMode={isEditMode}
      dashboardId={1}
      {...extra}
    />,
  );
  return { node, onUpdate, ...view };
}

const doc = (...paragraphs: Array<Record<string, unknown>>) => ({
  type: "doc",
  content: paragraphs,
});
const para = (content: unknown[], attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content,
});
const run = (text: string, marks?: Array<Record<string, unknown>>) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

describe("TextBoxComponent edit mode", () => {
  it("mounts the editor with the box's existing text", () => {
    const { container } = renderWidget();
    expect(container.querySelector(".tiptap-text-box")).not.toBeNull();
    expect(container.textContent).toContain("hello");
  });

  it("offers the formatting controls", () => {
    renderWidget();
    for (const label of [
      "Font size", "Font", "Bold", "Italic", "Underline",
      "Align left", "Align center", "Align right", "Align justify",
      "Text colour", "Background colour",
      "Vertical align top", "Vertical align middle", "Vertical align bottom",
    ]) {
      expect(screen.getByLabelText(label), label).toBeDefined();
    }
  });

  it("shows an existing rich document's text", () => {
    const { container } = renderWidget({
      rich_text: doc(para([run("already", [{ type: "bold" }])])),
      text: "already",
    });
    expect(container.textContent).toContain("already");
  });

  // Background colour and vertical alignment stay box-level: neither can be
  // expressed per paragraph, so they still patch the node directly.
  it("declares the default alignment on the editor wrapper too", () => {
    const { container } = renderWidget({ text: "hello" });
    const editor = container.querySelector(".tiptap-text-box") as HTMLElement;
    const wrapper = editor.closest("[style*='text-align']") as HTMLElement | null;
    expect(wrapper?.style.textAlign).toBe("left");
  });

  it("applies a background colour change immediately and patches the node", () => {
    const { node } = renderWidget();
    fireEvent.click(screen.getByLabelText("Background colour"));
    fireEvent.click(screen.getByLabelText("#1e293b"));

    expect(node.background_color).toBe("#1e293b");
    expect(screen.getByLabelText("Background colour").textContent).toContain("#1e293b");
  });

  it("applies a vertical alignment change immediately", () => {
    const { node } = renderWidget();
    fireEvent.click(screen.getByLabelText("Vertical align bottom"));

    expect(node.vertical_align).toBe("bottom");
    expect(screen.getByLabelText("Vertical align bottom").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("TextBoxComponent view mode", () => {
  /**
   * Navigation arrives as a *prop*, never from `DashboardContext`: widgets
   * are mounted in their own `ReactDOM.createRoot` and context does not cross
   * a root boundary, so `useContext` would get a `setViewMode` that does
   * nothing and the link would go nowhere.
   */
  it("confirms before leaving, naming the destination", async () => {
    const onOpenDashboard = vi.fn();
    const { container } = renderWidget(
      {
        rich_text: doc(
          para([run("go there", [{ type: "dashboardLink", attrs: { dashboardId: 4 } }])]),
        ),
      },
      false,
      { selectedFile: { id: 1, project: 9 }, onOpenDashboard },
    );

    // The dashboard list is fetched before the link can be known to be live.
    const link = await screen.findByRole("button", { name: "go there" });
    expect(container.querySelector("a")).toBeNull();
    fireEvent.click(link);

    // Clicking asks first — it must not navigate on its own.
    expect(onOpenDashboard).not.toHaveBeenCalled();
    expect(await screen.findByText(/Sibling Board/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    expect(onOpenDashboard).toHaveBeenCalledWith(4);
  });

  it("stays put when the confirmation is declined", async () => {
    const onOpenDashboard = vi.fn();
    renderWidget(
      {
        rich_text: doc(
          para([run("go there", [{ type: "dashboardLink", attrs: { dashboardId: 4 } }])]),
        ),
      },
      false,
      { selectedFile: { id: 1, project: 9 }, onOpenDashboard },
    );

    fireEvent.click(await screen.findByRole("button", { name: "go there" }));
    fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
    expect(onOpenDashboard).not.toHaveBeenCalled();
  });

  it("renders a link to an unknown dashboard as plain text", async () => {
    const onOpenDashboard = vi.fn();
    const { container } = renderWidget(
      {
        rich_text: doc(
          // 99 is not in the project's list, i.e. deleted since it was written.
          para([run("gone", [{ type: "dashboardLink", attrs: { dashboardId: 99 } }])]),
        ),
      },
      false,
      { selectedFile: { id: 1, project: 9 }, onOpenDashboard },
    );

    await screen.findByText("gone");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders each run with its own formatting", () => {
    const { container } = renderWidget(
      {
        rich_text: doc(
          para([run("bold bit", [{ type: "bold" }]), run(" plain bit")]),
          para([run("red", [{ type: "textStyle", attrs: { color: "#f43f5e" } }])]),
        ),
      },
      false,
    );

    expect(screen.getByText("bold bit").style.fontWeight).toBe("bold");
    // The neighbouring run in the same paragraph is untouched — the whole
    // point of the feature.
    expect(container.textContent).toContain(" plain bit");
    expect(screen.getByText("red").style.color).toBe("#f43f5e");
  });

  it("aligns paragraphs independently", () => {
    const { container } = renderWidget(
      {
        rich_text: doc(
          para([run("left one")]),
          para([run("centred one")], { textAlign: "center" }),
        ),
      },
      false,
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs[0].style.textAlign).toBe("");
    expect(paragraphs[1].style.textAlign).toBe("center");
  });

  it("gives an unaligned block the default alignment rather than the grid's", () => {
    const { container } = renderWidget(
      { rich_text: doc(para([run("no alignment of its own")])) },
      false,
    );
    const p = screen.getByText("no alignment of its own");
    // The block carries nothing itself -- ProseMirror makes paragraphs that
    // way, including the one after a horizontal rule.
    expect(p.style.textAlign).toBe("");
    // So the wrapper has to say what "nothing" means. `.grid-stack-item-content`
    // sets `text-align: center` for every widget (grid_demo.css), which would
    // otherwise centre the block while the toolbar reported it left.
    expect((p.parentElement as HTMLElement).style.textAlign).toBe("left");
    void container;
  });

  it("renders a box that predates rich text from its plain text and block format", () => {
    renderWidget(
      { text: "legacy words", font_weight: "bold", text_align: "right", font_size: 24 },
      false,
    );
    const p = screen.getByText("legacy words");
    expect(p.style.fontWeight).toBe("bold");
    expect(p.style.textAlign).toBe("right");
    expect(p.style.fontSize).toBe("24px");
    expect(p.style.whiteSpace).toBe("pre-wrap");
  });

  it("renders markup in the text as literal text, never as HTML", () => {
    const { container } = renderWidget(
      {
        rich_text: doc(para([run("<img src=x onerror=alert(1)> <script>alert(2)</script>")])),
      },
      false,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders lists and headings from a document", () => {
    const { container } = renderWidget(
      {
        rich_text: doc(
          { type: "heading", attrs: { level: 2 }, content: [run("A heading")] },
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [para([run("a point")])] }],
          },
        ),
      },
      false,
    );
    expect(container.querySelector("h2")?.textContent).toBe("A heading");
    expect(container.querySelector("ul li")?.textContent).toContain("a point");
  });
});
