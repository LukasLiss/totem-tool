import { InitialModelUpload } from "@/components/InitialModelUpload";
import { ProjectWorkspacePicker } from "@/components/ProjectWorkspacePicker";
import { FileUploadValidator } from "@/react_component/fileuploadvalidator";
import UserFileSelect from "@/react_component/userfileselect";

export function UploadView() {
  return (
    <div className="min-h-dvh px-4 py-8 md:px-8">
      <main className="mx-auto w-full max-w-6xl space-y-6">
        <header className="border-b pb-4">
          <h1 className="text-2xl font-semibold tracking-normal">Project workspace</h1>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <ProjectWorkspacePicker />
          <FileUploadValidator />
          <InitialModelUpload />
          <UserFileSelect />
        </div>
      </main>
    </div>
  );
}

export default UploadView;
