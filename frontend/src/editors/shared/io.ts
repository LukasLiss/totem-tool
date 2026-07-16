/**
 * JSON file input/output helpers shared by the model editors.
 * Models are saved as plain JSON files and can be re-imported later.
 */

/** Trigger a browser download of `data` serialized as pretty-printed JSON. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
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
