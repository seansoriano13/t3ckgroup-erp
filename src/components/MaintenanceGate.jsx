import { Wrench } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { isMaintenanceBlocked } from "../lib/maintenance"
import { Button } from "./ui/button"

// Logged-out visitors pass through so /login stays reachable; a signed-in
// non-allowlisted user gets the maintenance screen instead of any route.
export function MaintenanceGate({ children }) {
  const { user, logout } = useAuth()
  if (!user || !isMaintenanceBlocked(import.meta.env, user.email)) return children

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-mauve-1 p-6 text-center text-foreground">
      <Wrench className="size-10 text-mauve-10" />
      <h1 className="text-2xl font-black">Down for maintenance</h1>
      <p className="max-w-md text-mauve-10">
        We&apos;re upgrading the system. Please check back shortly.
      </p>
      <Button variant="outline" onClick={logout}>
        Sign out
      </Button>
    </div>
  )
}
