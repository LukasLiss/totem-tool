import { Button } from "./ui/button";
import { saveLayout } from "@/api/componentsApi";
import { useGridStackContext } from "@/gridstack/lib";


export function SaveGridButton({ dashboardId, token}: any) {
    const { saveOptions } = useGridStackContext();

    async function handleSave() {
    if (!saveOptions) return;
    const layout = saveOptions(); // GridStackWidget[]

    // Convert to backend format:
    const serialized = layout.map(item => {
      const parsed = JSON.parse(item.content ?? "{}");
      return {
        id: item.id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        component_name: parsed.name,
        props: parsed.props ?? {},
      };
    });

    await saveLayout(dashboardId, serialized, token);
    alert("Saved!");
  }

  return (
    <Button
      type="button"
      onClick={handleSave}
    >
      Save Layout
    </Button>
  );
}
