// Desktop (Electron) builds set VITE_LOCAL_MODE=1: there is no login and the
// frontend auto-logs-in as the Guest user. Env values are strings, so parse
// explicitly — Boolean("false") would be true.
export const LOCAL_MODE = ["1", "true", "yes"].includes(
  (import.meta.env.VITE_LOCAL_MODE ?? "").trim().toLowerCase()
);
