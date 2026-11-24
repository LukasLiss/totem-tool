/**
 * File input/output helpers shared by the model editors and the project
 * export. Models are saved as plain JSON files and can be re-imported later;
 * a whole project is saved as a `.totem` archive.
 */

/**
 * What a save attempt actually did:
 *
 * - `saved`      the user chose a location and the bytes reached the disk.
 * - `cancelled`  the user dismissed the save dialog; nothing was written.
 * - `downloaded` there is no save picker here, so the browser took the file
 *                from us. We cannot know where it went, or whether it was
 *                kept at all.
 *
 * Callers need the distinction to say something true: "Saved x.json" is a
 * claim about the filesystem, and only `saved` supports it.
 */
export type JsonSaveOutcome = 'saved' | 'cancelled' | 'downloaded';

/** The pre-File-System-Access path: hand the blob over and hope for the best. */
function anchorDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** The user dismissed the picker: not a failure, and nothing to report. */
function isAbort(error: unknown) {
  // Not `instanceof DOMException`: the picker is stubbed in tests, and not
  // every environment exposes that constructor.
  return (error as Error | undefined)?.name === 'AbortError';
}

/**
 * Write `blob` to a file of the user's choosing, and report what happened —
 * see `JsonSaveOutcome`.
 *
 * Prefers `showSaveFilePicker`, which resolves only once the file has been
 * written, so a caller can confirm a save instead of guessing at one. Where it
 * does not exist (Firefox, Safari) the anchor download still runs.
 *
 * Shared by every exporter rather than copied per format: the activation,
 * abort and fallback rules below are subtle enough that two copies would
 * drift.
 */
export async function saveBlob(
  name: string,
  blob: Blob,
  pickerType: { description: string; accept: Record<string, string[]> },
): Promise<JsonSaveOutcome> {
  let handle: FileSystemFileHandle | null = null;
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [pickerType],
      });
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // The picker needs *recent* user activation. Callers that fetch their
      // data first can outlive it (SecurityError), and some embeddings refuse
      // the picker outright — neither should cost the user the export.
      handle = null;
    }
  }

  if (handle) {
    // Deliberately outside the catch above: once a location has been chosen, a
    // failure here is a real write failure and belongs to the caller. It is not
    // a reason to also download the file somewhere else.
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      // Discard the swap file so a half-written export never replaces the
      // target; the abort's own failure must not mask the real one.
      await writable.abort().catch(() => {});
      throw error;
    }
    return 'saved';
  }

  anchorDownload(name, blob);
  return 'downloaded';
}

/**
 * Write `data` to a file of the user's choosing as pretty-printed JSON.
 * Thin wrapper over `saveBlob`, kept because most callers save JSON.
 */
export async function downloadJson(
  filename: string,
  data: unknown,
): Promise<JsonSaveOutcome> {
  const name = filename.endsWith('.json') ? filename : `${filename}.json`;
  return saveBlob(
    name,
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    { description: 'JSON file', accept: { 'application/json': ['.json'] } },
  );
}

/**
 * Write an exported project to a `.totem` file.
 *
 * `.totem` rather than `.totem.zip` although the contents are a zip: Safari
 * expands downloaded zip archives on arrival, which would leave someone who
 * clicked a sample-project link holding a folder and nothing to drag back in.
 */
export async function saveProjectBundle(
  filename: string,
  blob: Blob,
): Promise<JsonSaveOutcome> {
  const name = filename.endsWith('.totem') ? filename : `${filename}.totem`;
  return saveBlob(name, blob, {
    description: 'TOTeM project',
    accept: { 'application/zip': ['.totem'] },
  });
}

/**
 * Open a file picker restricted to .json files and resolve with the parsed
 * content. Resolves with `null` when the user cancels the picker.
 * Rejects when the file cannot be parsed as JSON.
 */
export function openJsonFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch {
          reject(new Error(`"${file.name}" is not valid JSON.`));
        }
      };
      reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
      reader.readAsText(file);
    };

    // If the user closes the picker without choosing a file no event fires in
    // some browsers; `cancel` is supported in all modern ones.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Turn a model name into a safe filename stem. */
export function toFilename(name: string, fallback: string) {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-');
  return stem.length > 0 ? stem : fallback;
}
