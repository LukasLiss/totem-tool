import { useContext } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { InitialModelUpload } from "@/components/InitialModelUpload";
import { ProjectWorkspacePicker } from "@/components/ProjectWorkspacePicker";
import { DashboardContext } from "@/contexts/DashboardContext";
import { useWorkspace } from "@/contexts/useWorkspace";
import { FileUploadValidator } from "@/react_component/fileuploadvalidator";
import UserFileSelect from "@/react_component/userfileselect";

export function UploadView() {
  const { selectedProject } = useWorkspace();
  const { setViewMode } = useContext(DashboardContext);
  const navigate = useNavigate();

  const launchProject = () => {
    if (!selectedProject) return;
    setViewMode({ type: "eventLogs" });
    navigate("/overview");
  };

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
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            size="lg"
            className="min-w-52"
            disabled={!selectedProject}
            onClick={launchProject}
          >
            Launch project
            <ArrowRight />
          </Button>
        </div>
      </main>
    </div>
  );
}

export default UploadView;
