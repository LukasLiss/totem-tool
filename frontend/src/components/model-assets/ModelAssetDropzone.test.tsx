// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelAssetDropzone } from "./ModelAssetDropzone";

function DropzoneHarness() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <ModelAssetDropzone
      file={file}
      error={error}
      onFileChange={setFile}
      onErrorChange={setError}
    />
  );
}

function jsonFile(name: string, schema = "totem") {
  return new File([JSON.stringify({ schema, version: 1 })], name, {
    type: "application/json",
  });
}

function dropFiles(target: Element, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: {
      files,
      items: files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
      types: ["Files"],
    },
  });
}

describe("ModelAssetDropzone", () => {
  afterEach(cleanup);

  it("selects a JSON model through drag and drop", async () => {
    render(<DropzoneHarness />);

    dropFiles(
      screen.getByLabelText("Select a JSON model file"),
      [jsonFile("reference.json")]
    );

    await waitFor(() => expect(screen.getByText("reference.json")).toBeTruthy());
    expect(
      screen
        .getByLabelText("Select a JSON model file")
        .getAttribute("data-state")
    ).toBe("selected");
  });

  it("selects through the file picker and replaces the previous file", async () => {
    const { container } = render(<DropzoneHarness />);
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error("Dropzone file input not rendered");
    expect(
      screen
        .getByLabelText("Select a JSON model file")
        .getAttribute("tabindex")
    ).toBe("0");

    fireEvent.change(input, {
      target: { files: [jsonFile("first.json")] },
    });
    await waitFor(() => expect(screen.getByText("first.json")).toBeTruthy());

    fireEvent.change(input, {
      target: { files: [jsonFile("second.json")] },
    });
    await waitFor(() => expect(screen.getByText("second.json")).toBeTruthy());
    expect(screen.queryByText("first.json")).toBeNull();
  });

  it("rejects unsupported files without replacing the valid selection", async () => {
    render(<DropzoneHarness />);
    const dropzone = screen.getByLabelText("Select a JSON model file");

    dropFiles(dropzone, [jsonFile("reference.json")]);
    await waitFor(() => expect(screen.getByText("reference.json")).toBeTruthy());

    dropFiles(dropzone, [
      new File(["not json"], "notes.txt", { type: "text/plain" }),
    ]);

    await waitFor(() =>
      expect(screen.getByText("Only JSON model files are supported.")).toBeTruthy()
    );
    expect(screen.getByText("reference.json")).toBeTruthy();
    expect(dropzone.getAttribute("data-state")).toBe("rejected");
  });

  it("rejects multiple files with a specific message", async () => {
    render(<DropzoneHarness />);
    const dropzone = screen.getByLabelText("Select a JSON model file");

    dropFiles(dropzone, [jsonFile("first.json"), jsonFile("second.json")]);

    await waitFor(() =>
      expect(
        screen.getByText("Select one JSON model file at a time.")
      ).toBeTruthy()
    );
    expect(dropzone.getAttribute("data-state")).toBe("rejected");
  });
});
