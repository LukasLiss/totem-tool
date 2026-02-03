import { Button } from "./components/ui/button";

export function Title() {
  return (
    <div className="flex flex-col items-center justify-center h-dvh gap-8">
        <h1 className="text-4xl font-bold mb-8 text-center">
            TOTeM - Process Mining Tool
        </h1>
        <Button variant="default" className="text-center" onClick={ () => { window.location.href = '/login'; } }>
            Log in
        </Button>
    </div>
    
  );
}

export default Title;