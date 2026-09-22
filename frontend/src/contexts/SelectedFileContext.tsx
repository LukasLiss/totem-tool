import { createContext } from "react";

export interface SelectedFile {
  id: number;
  name?: string;
  filename?: string;
  file?: string;
  project?: number;
  [key: string]: unknown;
}

type SelectedFileContextType = {
  selectedFile: SelectedFile | null;
  setSelectedFile: (file: SelectedFile | null) => void;
};

export const SelectedFileContext = createContext<SelectedFileContextType>({
  selectedFile: null,
  setSelectedFile: () => {},
});
