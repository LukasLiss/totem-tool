// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { isSafeHref, repairMojibake } from "../chatFormat";

const render = (md: string) => renderToStaticMarkup(<MarkdownRenderer content={md} />);

/** Render to HTML, then parse it so tests can query it like a document. */
function dom(md: string): Document {
  return new DOMParser().parseFromString(render(md), "text/html");
}

describe("MarkdownRenderer (react-markdown + remark-gfm)", () => {
  describe("block structure", () => {
    it("renders headings one level down, plus blockquotes, lists and paragraphs", () => {
      const d = dom("# Title\n## Subtitle\n### Heading 3\n\n> Quote\n\n- Bullet 1\n* Bullet 2\n\n1. Numbered 1\n\nParagraph text.");
      expect(d.querySelector("h2")?.textContent).toBe("Title");
      expect(d.querySelector("h3")?.textContent).toBe("Subtitle");
      expect(d.querySelector("h4")?.textContent).toBe("Heading 3");
      expect(d.querySelector("blockquote")?.textContent?.trim()).toBe("Quote");
      expect([...d.querySelectorAll("ul li")].map((li) => li.textContent)).toEqual(["Bullet 1", "Bullet 2"]);
      expect([...d.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Numbered 1"]);
      expect([...d.querySelectorAll("p")].map((p) => p.textContent)).toContain("Paragraph text.");
    });

    it("keeps nested lists nested", () => {
      const d = dom("- outer\n  - inner\n- second");
      expect(d.querySelectorAll("ul ul li")).toHaveLength(1);
      expect(d.querySelector("ul ul li")?.textContent).toBe("inner");
    });

    it("renders horizontal rules", () => {
      const d = dom("Paragraph 1\n\n---\n\nParagraph 2");
      expect(d.querySelectorAll("hr")).toHaveLength(1);
      expect(d.querySelectorAll("p")).toHaveLength(2);
    });

    it("renders empty and whitespace-only input without crashing", () => {
      expect(() => render("")).not.toThrow();
      expect(() => render("\n\n   \n\t\n\n")).not.toThrow();
    });

    it("handles a large mixed payload (1000 lines)", () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        if (i % 4 === 0) lines.push(`### Header ${i}`);
        else if (i % 4 === 1) lines.push(`- Bullet item ${i}`);
        else if (i % 4 === 2) lines.push(`> Blockquote notice ${i}`);
        else lines.push(`Regular paragraph text at line ${i}`);
        lines.push("");
      }
      const d = dom(lines.join("\n"));
      expect(d.querySelectorAll("h4")).toHaveLength(250);
    });
  });

  describe("code blocks", () => {
    it("renders fenced code with its language label and a copy button", () => {
      const d = dom("```python\ndef hello():\n    return 'world'\n```");
      const pre = d.querySelector("pre");
      expect(pre?.textContent).toBe("def hello():\n    return 'world'");
      expect(d.body.textContent).toContain("python");
      expect([...d.querySelectorAll("button")].map((b) => b.textContent)).toContain("Copy");
    });

    it("labels fences without a language as 'code'", () => {
      const d = dom("```\nconst x = 1;\n```");
      expect(d.querySelector("pre")?.textContent).toBe("const x = 1;");
      expect(d.body.textContent).toContain("code");
    });

    it("shows an unclosed fence (mid-stream) as code up to the end", () => {
      const d = dom("Here is the SQL query:\n```sql\nSELECT case_id\nFROM event_log\nWHERE duration > 100");
      expect(d.querySelector("p")?.textContent).toBe("Here is the SQL query:");
      expect(d.querySelector("pre")?.textContent).toContain("WHERE duration > 100");
    });

    it("keeps markdown characters inside fences literal", () => {
      const d = dom("```python\n# not a header\n- not a list item\n> not a quote\n```");
      expect(d.querySelectorAll("h2, ul, blockquote")).toHaveLength(0);
      expect(d.querySelector("pre")?.textContent).toContain("# not a header");
    });

    it("renders consecutive code blocks separately", () => {
      const d = dom("```json\n{\"step\": 1}\n```\n```typescript\nconst step = 2;\n```");
      expect([...d.querySelectorAll("pre")].map((p) => p.textContent)).toEqual(['{"step": 1}', "const step = 2;"]);
    });

    it("renders inline code as <code> outside a <pre>", () => {
      const d = dom("Run `SELECT 1` now");
      const code = d.querySelector("p code");
      expect(code?.textContent).toBe("SELECT 1");
      expect(d.querySelector("pre")).toBeNull();
    });
  });

  describe("inline formatting", () => {
    it("formats bold, italic and inline code", () => {
      const d = dom("This is **bold**, this is `code`, and this is *italic*.");
      expect(d.querySelector("strong")?.textContent).toBe("bold");
      expect(d.querySelector("em")?.textContent).toBe("italic");
      expect(d.querySelector("code")?.textContent).toBe("code");
    });

    it("tolerates unclosed markers by leaving them as text", () => {
      for (const input of ["unclosed `code", "unclosed *italic", "unclosed **bold"]) {
        const d = dom(input);
        expect(d.body.textContent).toBe(input);
      }
    });

    it("turns <br> tags into line breaks, including inside table cells", () => {
      const d = dom("Line 1 <br> Line 2 <br/> Line 3\n\n| A |\n| - |\n| x<br>y |");
      expect(d.querySelectorAll("p br")).toHaveLength(2);
      expect(d.querySelectorAll("td br")).toHaveLength(1);
      expect(d.body.textContent).not.toContain("<br");
    });

    it("never renders raw HTML (script / event handlers stay inert text)", () => {
      const malicious = '<script>alert("xss")</script> and <img src="x" onerror="stealCookie()"/>';
      const d = dom(malicious);
      expect(d.querySelector("script")).toBeNull();
      expect(d.querySelector("img")).toBeNull();
      expect(d.body.textContent).toContain("<script>");
    });

    it("repairs Latin-1 / Windows-1252 mojibake back to genuine emojis", () => {
      expect(repairMojibake("\xf0\x9f\x93\x8a Log Profile & Key Metrics")).toBe("📊 Log Profile & Key Metrics");
      expect(dom("## \xf0\x9f\x93\x8a Metrics").querySelector("h3")?.textContent).toBe("📊 Metrics");
    });
  });

  describe("links", () => {
    it("renders https and mailto links as safe anchors", () => {
      const d = dom("Visit [Totem Docs](https://totem.org) or email [Support](mailto:support@totem.org).");
      const links = [...d.querySelectorAll("a")];
      expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://totem.org", "mailto:support@totem.org"]);
      expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
      expect(links[0].getAttribute("target")).toBe("_blank");
    });

    it("renders javascript:, data: and relative links as plain text only", () => {
      const d = dom(
        "Click [Malicious](javascript:alert(1)) or [Data](data:text/html;base64,PHNjcmlwdD4=) or [Rel](/settings)."
      );
      expect(d.querySelectorAll("a")).toHaveLength(0);
      expect(d.body.textContent).toContain("Malicious");
      expect(d.body.textContent).toContain("Data");
      expect(d.body.textContent).toContain("Rel");
      expect(render("[x](javascript:alert(1))")).not.toMatch(/javascript:/i);
    });

    it("isSafeHref only allows http(s) and mailto", () => {
      expect(isSafeHref("https://a.b")).toBe(true);
      expect(isSafeHref("HTTP://a.b")).toBe(true);
      expect(isSafeHref("mailto:x@y.z")).toBe(true);
      expect(isSafeHref("javascript:alert(1)")).toBe(false);
      expect(isSafeHref("data:text/html,x")).toBe(false);
      expect(isSafeHref("/relative")).toBe(false);
      expect(isSafeHref("")).toBe(false);
      expect(isSafeHref(undefined)).toBe(false);
    });
  });

  describe("tables", () => {
    const table =
      "| Metric | Value | Interpretation |\n| :--- | :---: | ---: |\n| Total Events | 28,278 | High density |\n| Total Objects | 8,819 | Unique entities |";

    it("renders headers, rows and column alignment", () => {
      const d = dom(table);
      expect([...d.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Metric", "Value", "Interpretation"]);
      const rows = [...d.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
      expect(rows).toEqual([
        ["Total Events", "28,278", "High density"],
        ["Total Objects", "8,819", "Unique entities"],
      ]);
      const aligns = [...d.querySelectorAll("th")].map((th) => th.className.match(/text-(left|center|right)/)?.[1]);
      expect(aligns).toEqual(["left", "center", "right"]);
    });

    it("wraps tables in a horizontal scroll container", () => {
      const d = dom(table);
      const wrapper = d.querySelector('[data-testid="md-table-scroll"]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).toContain("overflow-x-auto");
      expect(wrapper?.className).toContain("max-w-full");
      expect(wrapper?.querySelector("table")).not.toBeNull();
    });

    it("formats inline markdown inside cells", () => {
      const d = dom("| A | B |\n| - | - |\n| **bold** | `code` |");
      expect(d.querySelector("td strong")?.textContent).toBe("bold");
      expect(d.querySelector("td code")?.textContent).toBe("code");
    });
  });
});
