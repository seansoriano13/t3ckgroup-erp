import { useState } from "react"
import { Bell, MonitorSmartphone } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { showNotificationPopup } from "../../utils/notificationPopup"
import SampleProvider from "./SampleProvider"
import { PEOPLE, SAMPLE_ACTOR } from "./sampleData"

/**
 * Notifications, triggered on demand (ADR 0030), in the two places they
 * appear. In the app: each button raises the app's own pop-up, the one a live
 * notification shows top right. On the desktop: one button raises a real
 * operating-system notification, the kind Desktop Notifications sends with the
 * portal closed. It asks the browser's permission first, on that click, and
 * only shows the notification here: nothing is subscribed, sent or saved. The
 * notification drawer is not mounted: it listens on the signed-in employee's
 * real channel. The samples carry no reference, so clicking one goes nowhere.
 */

const NOTIFICATIONS = [
  {
    label: "An SOR calls you in",
    notif: {
      type: "OPPORTUNITY_STAGE_CHANGED",
      title: "You were called into Demo Province",
      message: "Lara Mendoza moved it to Technical Review and needs your input. Click to open it.",
      sender: { id: PEOPLE.lara.id, name: PEOPLE.lara.name },
    },
  },
  {
    label: "A task is assigned to you",
    notif: {
      type: "TASK_ASSIGNED",
      title: "New task: Confirm specs",
      message: "Paolo Reyes assigned you a task for Demo City Hall.",
      sender: { id: PEOPLE.paolo.id, name: PEOPLE.paolo.name },
    },
  },
  {
    label: "You are added to a Group Task",
    notif: {
      type: "GROUP_ASSIGNED",
      title: "Added to Group Task: Bid documents",
      message: "Joy Villanueva added you as a member.",
      sender: { id: PEOPLE.joy.id, name: PEOPLE.joy.name },
    },
  },
]

let counter = 0

const DESKTOP_SAMPLE = {
  title: "You were called into Demo Province",
  body: "Lara Mendoza moved it to Technical Review and needs your input.",
}

const supported = () => typeof window !== "undefined" && "Notification" in window

/** Shows one operating-system notification, asking permission on the way. */
async function sendDesktopSample() {
  if (!supported()) return "unsupported"
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
  if (permission !== "granted") return "blocked"
  // The same title, body and icon the real push shows (public/sw.js).
  new Notification(DESKTOP_SAMPLE.title, { body: DESKTOP_SAMPLE.body, icon: "/tg-logo.svg", tag: "release-notes-sample" })
  return "sent"
}

const DESKTOP_MESSAGE = {
  sent: "Sent. Look outside this window: it appears on your desktop, as a real one does with the portal closed.",
  blocked: "Your browser is blocking notifications for this site, so nothing was shown. Allow them in the address bar's site settings to try it.",
  unsupported: "This browser cannot show desktop notifications.",
}

export function NotificationsSample() {
  const [desktop, setDesktop] = useState(null)
  const trigger = ({ notif }) =>
    // No reference_id: the pop-up's click handler has nowhere to route to.
    showNotificationPopup({ id: `sample-${++counter}`, sender_id: notif.sender.id, ...notif }, () => {}, { id: SAMPLE_ACTOR }, null)

  return (
    <SampleProvider>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">In the app</p>
          <div className="flex flex-wrap items-center gap-3">
            {NOTIFICATIONS.map((n) => (
              <Button key={n.label} type="button" variant="outline" onClick={() => trigger(n)}>
                <Bell />
                {n.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">On your desktop, outside the browser</p>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const result = await sendDesktopSample().catch(() => "unsupported")
              setDesktop(result)
              if (result !== "sent") toast(DESKTOP_MESSAGE[result], { id: "sample-desktop" })
            }}
          >
            <MonitorSmartphone />
            Send me a desktop notification
          </Button>
          <p className="text-sm text-muted-foreground">
            {desktop ? DESKTOP_MESSAGE[desktop] : "Your browser asks permission first. It shows this one notification and turns nothing on: Desktop Notifications stays off until you switch it on in Settings."}
          </p>
        </div>
      </div>
    </SampleProvider>
  )
}
