/**
 * `showSaveFilePicker` is missing from TypeScript 5.8's `lib.dom.d.ts`, even
 * though the handle types it resolves to (`FileSystemFileHandle`,
 * `FileSystemWritableFileStream`) are there. Declared here so `io.ts` can call
 * it without casting `window` to `any` at the call site.
 *
 * No top-level import/export: that would make this a module and stop it
 * augmenting the global `Window`.
 */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  /** Absent in Firefox and Safari — always feature-detect before calling. */
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
