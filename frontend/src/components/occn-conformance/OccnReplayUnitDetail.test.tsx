// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  type OCCNReplayUnitDetailResponse,
  type OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";

import { OccnReplayUnitDetail } from "./OccnReplayUnitDetail";
import type { OccnReplayUnitDetailState } from "./useOccnReplayUnitDetail";

afterEach(cleanup);

function replayUnit(
  overrides: Partial<OCCNReplayUnitResult> = {}
): OCCNReplayUnitResult {
  return {
    unit_id: "connected_components:000001",
    status: "fitting",
    replayable: true,
    event_count: 3,
    explored_state_count: 12,
    object_types: ["Item", "Order"],
    failure_event_index: null,
    failure_event_id: null,
    limit_reason: null,
    ...overrides,
  };
}

function detailResponse(
  overrides: Partial<OCCNReplayUnitDetailResponse> = {}
): OCCNReplayUnitDetailResponse {
  return {
    file_id: 12,
    unit_id: "connected_components:000001",
    replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    event_count: 3,
    object_types: ["Item", "Order"],
    pagination: {
      offset: 0,
      limit: 50,
      returned_count: 3,
      total_count: 3,
      has_previous: false,
      has_next: false,
      previous_offset: null,
      next_offset: null,
    },
    events: [
      {
        event_index: 0,
        event_id: "event-created",
        activity: "Create Order",
        timestamp_unix: 1_735_689_600,
        objects_by_type: {
          Order: ["order-1"],
        },
      },
      {
        event_index: 1,
        event_id: "event-shipped",
        activity: "Ship Order",
        timestamp_unix: 1_735_689_660,
        objects_by_type: {
          Item: ["item-1", "item-2"],
          Order: ["order-1"],
        },
      },
      {
        event_index: 2,
        event_id: "event-objectless",
        activity: "System Check",
        timestamp_unix: 1_735_689_720,
        objects_by_type: {},
      },
    ],
    ...overrides,
  };
}

function detailState(
  overrides: Partial<OccnReplayUnitDetailState> = {}
): OccnReplayUnitDetailState {
  return {
    detail: detailResponse(),
    loading: false,
    error: null,
    requestedOffset: 0,
    loadPage: vi.fn(async () => null),
    retry: vi.fn(async () => null),
    previousPage: vi.fn(async () => null),
    nextPage: vi.fn(async () => null),
    ...overrides,
  };
}

describe("OccnReplayUnitDetail", () => {
  it("renders replay metadata, ordered events, objects, and objectless events", () => {
    render(
      <OccnReplayUnitDetail
        unit={replayUnit()}
        detailState={detailState()}
      />
    );

    const detail = screen.getByRole("region", { name: "Replay unit detail" });
    expect(detail.textContent).toContain("Fitting");
    expect(detail.textContent).toContain("ReplayableYes");
    expect(detail.textContent).toContain("Explored states12");
    expect(screen.getByText("Create Order")).toBeTruthy();
    expect(screen.getByText("Ship Order")).toBeTruthy();
    expect(screen.getByText("System Check")).toBeTruthy();
    expect(screen.getByText("item-1, item-2")).toBeTruthy();

    const objectlessRow = screen.getByText("event-objectless").closest("tr");
    expect(objectlessRow).not.toBeNull();
    expect(within(objectlessRow as HTMLElement).getByText("None")).toBeTruthy();
    expect(detail.querySelectorAll("time")).toHaveLength(3);
    expect(screen.getByText("Showing 1-3 of 3")).toBeTruthy();
  });

  it("shows and highlights a known failure event", () => {
    render(
      <OccnReplayUnitDetail
        unit={
          replayUnit({
            status: "non_fitting",
            replayable: false,
            failure_event_index: 1,
            failure_event_id: "event-shipped",
          })
        }
        detailState={detailState()}
      />
    );

    expect(screen.getByText("Non-fitting")).toBeTruthy();
    expect(
      screen.getByText("First failing event").parentElement?.textContent
    ).toContain("Event 2 of 3 / event-shipped");
    expect(screen.getByText("Failure point")).toBeTruthy();
    const failureRow = screen.getByText("event-shipped").closest("tr");
    expect(failureRow?.className).toContain("bg-destructive/5");
  });

  it("does not invent a failure event for a completion failure", () => {
    render(
      <OccnReplayUnitDetail
        unit={
          replayUnit({
            status: "non_fitting",
            replayable: false,
          })
        }
        detailState={detailState()}
      />
    );

    expect(
      screen.getByText("No specific failure event identified")
    ).toBeTruthy();
    expect(screen.queryByText("Failure point")).toBeNull();
    expect(screen.getByText("Not available")).toBeTruthy();
  });

  it("shows known and unavailable inconclusive reasons", () => {
    const { rerender } = render(
      <OccnReplayUnitDetail
        unit={
          replayUnit({
            status: "inconclusive",
            replayable: null,
            limit_reason: "max_states",
          })
        }
        detailState={detailState()}
      />
    );

    expect(screen.getByText("Not determined")).toBeTruthy();
    expect(
      screen.getByText(
        "The state exploration limit was reached before a result could be proven."
      )
    ).toBeTruthy();

    rerender(
      <OccnReplayUnitDetail
        unit={
          replayUnit({
            status: "inconclusive",
            replayable: null,
            limit_reason: null,
          })
        }
        detailState={detailState()}
      />
    );
    expect(
      screen.getByText("No additional limit reason is available.")
    ).toBeTruthy();
  });

  it("renders loading and unavailable states without stale events", () => {
    const unit = replayUnit();
    const { rerender } = render(
      <OccnReplayUnitDetail
        unit={unit}
        detailState={detailState({ loading: true })}
      />
    );

    const detail = screen.getByRole("region", { name: "Replay unit detail" });
    expect(detail.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading replay events")).toBeTruthy();
    expect(screen.queryByText("Create Order")).toBeNull();

    rerender(
      <OccnReplayUnitDetail
        unit={unit}
        detailState={detailState({ detail: null })}
      />
    );
    expect(
      screen.getByText("Replay event details are unavailable")
    ).toBeTruthy();
  });

  it("shows request errors and retries them", () => {
    const retry = vi.fn(async () => null);
    render(
      <OccnReplayUnitDetail
        unit={replayUnit()}
        detailState={detailState({
          detail: null,
          error: "Detail service unavailable",
          retry,
        })}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Detail service unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses backend pagination state and handles an empty page", () => {
    const previousPage = vi.fn(async () => null);
    const nextPage = vi.fn(async () => null);
    const unit = replayUnit({ event_count: 120 });
    const state = detailState({
      detail: detailResponse({
        event_count: 120,
        pagination: {
          offset: 50,
          limit: 50,
          returned_count: 1,
          total_count: 120,
          has_previous: true,
          has_next: true,
          previous_offset: 0,
          next_offset: 100,
        },
        events: [
          {
            event_index: 50,
            event_id: "event-51",
            activity: "Review Order",
            timestamp_unix: 1_735_689_600,
            objects_by_type: { Order: ["order-1"] },
          },
        ],
      }),
      previousPage,
      nextPage,
    });
    const { rerender } = render(
      <OccnReplayUnitDetail unit={unit} detailState={state} />
    );

    expect(screen.getByText("Showing 51-51 of 120")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous replay-event page" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Next replay-event page" })
    );
    expect(previousPage).toHaveBeenCalledTimes(1);
    expect(nextPage).toHaveBeenCalledTimes(1);

    rerender(
      <OccnReplayUnitDetail
        unit={unit}
        detailState={detailState({
          detail: detailResponse({
            event_count: 120,
            pagination: {
              offset: 150,
              limit: 50,
              returned_count: 0,
              total_count: 120,
              has_previous: true,
              has_next: false,
              previous_offset: 100,
              next_offset: null,
            },
            events: [],
          }),
        })}
      />
    );
    expect(screen.getByText("No replay events on this page")).toBeTruthy();
    expect(screen.getByText("Showing 0-0 of 120")).toBeTruthy();
  });
});
