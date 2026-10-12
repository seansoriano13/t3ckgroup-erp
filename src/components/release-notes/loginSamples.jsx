import { useState } from "react"
import toast from "react-hot-toast"
import { Input } from "@/components/ui/input"
import { FieldBox } from "@/components/ui/FieldBox"
import { Button } from "@/components/ui/button"
import BeforeAfter from "./BeforeAfter"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"

/**
 * The sign-in screen, before and after email and password (ADR 0030). Drawn
 * with the login page's own fields and buttons, not the page itself: the real
 * one calls the sign-in service, and "Forgot password?" sends a real email.
 * Here both only say so.
 */

const FIELD = "h-auto px-4 py-3 bg-mauve-3 border-mauve-6 text-mauve-12 rounded-lg placeholder:text-mauve-8"

function Heading() {
  return (
    <div>
      <h3 className="text-2xl font-bold tracking-tight text-mauve-12">
        Welcome to T3CKGROUP
      </h3>
      <p className="mt-1 text-sm font-medium text-mauve-10">Sign in to access the employee portal.</p>
    </div>
  )
}

function GoogleButton() {
  return (
    <Button type="button" variant="outline" className="h-auto w-full gap-2 py-3 sm:w-auto" onClick={() => toast("Sample: the real button opens Google.")}>
      <span className="font-black text-blue-9">G</span>
      Sign in with Google
    </Button>
  )
}

function GoogleOnly() {
  return (
    <div className="space-y-6 p-6">
      <Heading />
      <GoogleButton />
    </div>
  )
}

function EmailAndPassword() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  return (
    <form
      className="space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        toast(SAMPLE_SAVE_BLOCKED)
      }}
    >
      <Heading />
      <div className="grid gap-2">
        <FieldBox label="Email Address" />
        <Input className={FIELD} type="email" placeholder="name@t3ckgroup.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <FieldBox label="Password" />
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs font-medium text-mauve-11 hover:underline"
            onClick={() => toast.success("Sample: the real link emails you a reset link.")}
          >
            Forgot password?
          </Button>
        </div>
        <Input className={FIELD} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="border-t border-mauve-6 pt-5">
        <p className="mb-4 text-sm font-bold text-mauve-10">Sign in with your email and password, or your corporate Google account.</p>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <Button type="submit" className="h-auto w-full bg-red-9 px-12 py-3 text-primary-foreground hover:bg-red-7 sm:w-auto">
            Sign in
          </Button>
          <GoogleButton />
        </div>
      </div>
    </form>
  )
}

export function LoginSample() {
  return (
    <SampleProvider>
      <BeforeAfter
        beforeNote="Google only"
        afterNote="Email and password, or Google"
        before={<GoogleOnly />}
        after={<EmailAndPassword />}
      />
    </SampleProvider>
  )
}
