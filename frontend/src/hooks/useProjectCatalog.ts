import { useCallback, useEffect, useState } from "react";

import {
  createProject,
  listProjects,
  type Project,
} from "@/api/projectApi";
import { useWorkspace } from "@/contexts/useWorkspace";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Project request failed.";
}

export function useProjectCatalog() {
  const { selectProject } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setProjects(await listProjects());
    } catch (error) {
      setProjects([]);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const addProject = useCallback(
    async (name: string) => {
      setIsCreating(true);
      setErrorMessage(null);
      try {
        const project = await createProject(name.trim() || undefined);
        setProjects((current) => [...current, project]);
        selectProject(project);
        return project;
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        throw error;
      } finally {
        setIsCreating(false);
      }
    },
    [selectProject],
  );

  return {
    projects,
    isLoading,
    isCreating,
    errorMessage,
    refreshProjects,
    addProject,
  };
}
