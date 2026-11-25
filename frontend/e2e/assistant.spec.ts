import { expect, test } from "@playwright/test";

/**
 * Smoke test for the AI assistant using the offline demo provider: no API key,
 * no network LLM. The demo provider makes one real tool call (get_log_overview)
 * through the backend harness and then answers, so this exercises the whole
 * stream: SSE events -> reducer -> tool chip -> markdown answer.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Only on the first load of the test: keep the chat history the test builds up.
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    sessionStorage.setItem("totem_splash_seen", "1");
    localStorage.setItem("totem_llm_provider", "demo");
    localStorage.removeItem("totem_llm_api_key");
    localStorage.setItem("totem_chat_mode", "act");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("totem_chat_messages") || key.startsWith("totem_chat_conversation")) {
        localStorage.removeItem(key);
      }
    }
  });
});

test("assistant answers with a tool call and handles a follow-up (demo provider)", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();

  const input = drawer.locator("textarea");
  // Final demo answers: either the overview facts or the tool error, depending on the selected log.
  const answers = drawer.getByText(/Here is what the log overview returned|The lookup failed/);

  // First question: a tool chip appears, then the demo answer.
  await input.fill("Give me an overview of this log");
  await input.press("Enter");

  await expect(drawer.getByText("Give me an overview of this log")).toBeVisible();
  const chip = drawer.getByTestId("tool-chip").first();
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute("data-status", "executing");
  await expect(answers).toHaveCount(1);
  await expect(input).toBeEnabled();

  // The chip expands to show the tool's name and duration.
  await chip.getByRole("button").click();
  const details = chip.getByTestId("tool-chip-details");
  await expect(details).toContainText("get_log_overview");
  await expect(details).toContainText("Duration");

  // Follow-up in the same conversation also completes.
  const chipsBefore = await drawer.getByTestId("tool-chip").count();
  await input.fill("And what about the bottlenecks?");
  await input.press("Enter");

  await expect(drawer.getByText("And what about the bottlenecks?")).toBeVisible();
  await expect(drawer.getByTestId("tool-chip")).toHaveCount(chipsBefore + 1);
  await expect(drawer.getByTestId("tool-chip").last()).not.toHaveAttribute("data-status", "executing");
  await expect(input).toBeEnabled();
  await expect(answers).toHaveCount(2);
  await expect(drawer.getByText("Stop generating")).toHaveCount(0);
});
