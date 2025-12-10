import { Trash, PlusCircle } from "lucide-react";

export function DnDSidebar() {
  return (
    <div className="sidepanel">
      <div id="trash" className="sidepanel-item">
        <Trash/>
        <div>Drop here to remove!</div>
      </div>

      <div className="grid-stack-item sidepanel-item">
        <PlusCircle/>
        <div>Drag me in the dashboard!</div>
      </div>
    </div>
  );
}
