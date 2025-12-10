import { SidebarProvider } from "@/components/ui/sidebar";
import { GridStackProvider } from "./gridstack/lib/gridstackprovider";
import { GridStackArea } from "./gridstack/lib/gridstack_area";
import { BasicWidget } from "./gridstack/widgets/basic_widget";
import { LockedWidget } from "./gridstack/widgets/locked_widget";
import { DnDSidebar } from "./components/dnd_sidebar";

export default function Grid() {
  const initialItems = [
    {
      id: "1",
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      component: <BasicWidget label="1" />,
    },
    {
      id: "locked",
      x: 4,
      y: 0,
      w: 4,
      h: 4,
      locked: true,
      component: <LockedWidget />,
    },
    {
      id: "4",
      x: 10,
      y: 0,
      w: 2,
      h: 2,
      component: <BasicWidget label="4" />,
    },
  ];

  const insertTemplate = {
    id: "new",
    h: 2,
    w: 2,
    component: <BasicWidget label="new item" />,
  };

  return (
    <SidebarProvider>
      <GridStackProvider initialItems={initialItems} insertTemplate={insertTemplate}>
        <div className="app-layout flex">
          <DnDSidebar />
          <GridStackArea />
        </div>
      </GridStackProvider>
    </SidebarProvider>
  );
}
