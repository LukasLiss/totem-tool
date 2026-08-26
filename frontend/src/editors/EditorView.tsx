import { useContext } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import TotemEditor from "./totem/TotemEditor";
import OccnEditor from "./occn/OccnEditor";
import OcpnEditor from "./ocpn/OcpnEditor";
import OcdfgEditor from "./ocdfg/OcdfgEditor";

export function EditorView() {
  const { viewMode } = useContext(DashboardContext);

  if (viewMode.type !== 'editor') return null;

  const renderEditor = () => {
    switch (viewMode.component) {
      case 'totem':
        return <TotemEditor />;
      case 'occn':
        return <OccnEditor />;
      case 'ocpn':
        return <OcpnEditor />;
      case 'ocdfg':
        return <OcdfgEditor />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen min-h-0">
      <SidebarTrigger className="m-2 shrink-0" />
      <div className="flex-1 min-h-0 flex justify-center p-4 pt-0">
        <div className="w-full max-w-[1600px] min-h-0 flex">
          {renderEditor()}
        </div>
      </div>
    </div>
  );
}

export default EditorView;
