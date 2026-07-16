/**
 * In-memory per-editor state cache. The editor views unmount when the user
 * switches to another sidebar entry; each editor stores its serialized model
 * here on unmount and restores it on the next mount, so switching views never
 * loses unsaved work. Deliberately module-scoped (not sessionStorage): it
 * lives exactly as long as the app instance.
 */

const cache = new Map<string, unknown>();

export function saveEditorSession(key: string, snapshot: unknown): void {
  cache.set(key, snapshot);
}

export function loadEditorSession<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
