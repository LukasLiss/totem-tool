import axios from "axios";
import type { PlayoutRequest, PlayoutResult, PlayoutVariant } from "../playout/model";

export async function runPlayout(
  request: PlayoutRequest,
  signal?: AbortSignal,
): Promise<PlayoutResult> {
  const { data } = await axios.post("http://localhost:8000/api/playout/", request, { signal });
  return data;
}

export async function exportPlayoutOcel(
  variants: readonly PlayoutVariant[],
  signal?: AbortSignal,
) {
  const { data } = await axios.post(
    "http://localhost:8000/api/playout/export-ocel/",
    { variants },
    { signal },
  );
  return data;
}
