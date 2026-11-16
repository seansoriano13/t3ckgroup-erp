import { useEffect, useRef, useState } from "react"

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Steps a scene through its phases, `durations[i]` ms each, while it is on screen, then starts again.
 * With reduced motion it shows the last phase and does not move. Returns [ref for the scene, phase].
 * Pass `durations` as a module constant: a new array each render restarts the clock.
 */
export function useScene(durations, { loop = true } = {}) {
  const ref = useRef(null)
  const [reduce] = useState(prefersReducedMotion)
  // No IntersectionObserver (tests, old browsers): treat the scene as on screen.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined")
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return undefined
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduce || !visible) return undefined
    const last = durations.length - 1
    if (!loop && phase === last) return undefined
    const timer = setTimeout(() => setPhase((p) => (p < last ? p + 1 : 0)), durations[phase])
    return () => clearTimeout(timer)
  }, [phase, visible, reduce, durations, loop])

  return [ref, reduce ? durations.length - 1 : phase]
}
