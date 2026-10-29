import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-logout";
import { LOCAL_MODE } from "@/lib/env";

// In the desktop build the only account is the auto-logged-in Guest, so
// "Log out" would just drop the user's place and log them straight back in.
export function LogoutButton() {
  const logout = useLogout();
  if (LOCAL_MODE) return null;

  return (
    <Button variant="outline" className="cursor-pointer" onClick={logout}>
      <LogOut />
      Log out
    </Button>
  );
}
