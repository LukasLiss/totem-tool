// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RichTextRenderer from "./RichTextRenderer";
import type { RichTextDoc, RichTextMark } from "./richText";

afterEach(cleanup);

/**
 * View-mode link rendering, fed documents directly rather than through the
 * editor: rows written before links existed were never validated, and the
 * renderer is the last check before an href reaches the browser.
 */
function docWith(marks: RichTextMark[], text = "click me"): RichTextDoc {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }],
  } as RichTextDoc;
}

const linked = (href: string) => docWith([{ type: "link", attrs: { href } }]);

describe("web and email links", () => {
  it("renders a web link that cannot reach back into the app", () => {
    const { container } = render(<RichTextRenderer doc={linked("https://example.com")} />);

    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.com");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("gives a mailto link no target, so no empty tab is left behind", () => {
    const { container } = render(<RichTextRenderer doc={linked("mailto:a@b.com")} />);

    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("mailto:a@b.com");
    expect(anchor.getAttribute("target")).toBeNull();
  });

  it("ignores target and rel smuggled into the document", () => {
    const doc = docWith([
      {
        type: "link",
        attrs: {
          href: "https://example.com",
          // Not part of the mark's type, and not read by the renderer.
          target: "_self",
          rel: "opener",
        },
      } as RichTextMark,
    ]);
    const { container } = render(<RichTextRenderer doc={doc} />);

    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("looks like a link, since Tailwind's preflight strips anchor styling", () => {
    const { container } = render(<RichTextRenderer doc={linked("https://example.com")} />);

    // Only the decoration: happy-dom's CSS parser keeps a `var()` value for
    // `text-decoration` but drops it for `color`. Colour is checked in a
    // real browser instead.
    const anchor = container.querySelector("a")!;
    expect(anchor.style.textDecoration).toContain("underline");
  });

  it("keeps the run's own formatting on the anchor", () => {
    const doc = docWith([
      { type: "link", attrs: { href: "https://example.com" } },
      { type: "textStyle", attrs: { color: "#f43f5e" } },
      { type: "bold" },
    ]);
    const { container } = render(<RichTextRenderer doc={doc} />);

    const anchor = container.querySelector("a")!;
    expect(anchor.style.color).toBe("#f43f5e");
    expect(anchor.style.fontWeight).toBe("bold");
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["javascript:alert(1)//https://example.com"],
    ["data:text/html,<script>alert(1)</script>"],
    ["//evil.com/path"],
    ["/dashboards/1"],
    ["https://"],
    ["mailto:a@b.com?bcc=victim@evil.com"],
  ])("renders %s as plain text with no anchor at all", (href) => {
    const { container } = render(<RichTextRenderer doc={linked(href)} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("renders a non-string href as plain text", () => {
    const doc = docWith([{ type: "link", attrs: { href: 42 } } as unknown as RichTextMark]);
    const { container } = render(<RichTextRenderer doc={doc} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });
});

describe("dashboard links", () => {
  const toDashboard = (dashboardId: unknown) =>
    docWith([{ type: "dashboardLink", attrs: { dashboardId } } as unknown as RichTextMark]);

  it("renders a button that asks the widget to switch dashboards", () => {
    const onDashboardLink = vi.fn();
    const { container } = render(
      <RichTextRenderer
        doc={toDashboard(7)}
        onDashboardLink={onDashboardLink}
        knownDashboardIds={new Set([7])}
      />,
    );

    const button = container.querySelector("button")!;
    expect(button.style.textDecoration).toContain("underline");
    // No href: a view change, not a navigation.
    expect(container.querySelector("a")).toBeNull();
    fireEvent.click(button);
    expect(onDashboardLink).toHaveBeenCalledWith(7);
  });

  it("renders as plain text once its dashboard has been deleted", () => {
    const onDashboardLink = vi.fn();
    const { container } = render(
      <RichTextRenderer
        doc={toDashboard(7)}
        onDashboardLink={onDashboardLink}
        knownDashboardIds={new Set([1, 2])}
      />,
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("renders as plain text when the widget offers no handler", () => {
    const { container } = render(<RichTextRenderer doc={toDashboard(7)} />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it.each([[0], [-1], ["7"], [1.5], [null]])(
    "renders a malformed id (%s) as plain text",
    (dashboardId) => {
      const { container } = render(
        <RichTextRenderer
          doc={toDashboard(dashboardId)}
          onDashboardLink={vi.fn()}
          knownDashboardIds={new Set([0, -1, 7])}
        />,
      );

      expect(container.querySelector("button")).toBeNull();
    },
  );
});
