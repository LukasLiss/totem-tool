import { createContext } from "react";

type SelectedFileContextType = {
  selectedFile: any; // Replace `any` with your actual file type
  setSelectedFile: (file: any) => void;
};

export const SelectedFileContext = createContext<SelectedFileContextType>({
  selectedFile: null,
  setSelectedFile: () => {},
});