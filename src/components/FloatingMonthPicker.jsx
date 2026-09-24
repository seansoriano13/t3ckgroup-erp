import { useState, useRef, useEffect, useMemo } from "react"
import Dot from "./ui/Dot"
import { Button } from "./ui/button"
import { createPortal } from "react-dom"
import Draggable from "react-draggable"
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  TrendingUp,
  LayoutGrid,
  GripVertical,
} from "lucide-react"
import DatePicker from "react-datepicker"
import "react-datepicker/dist/react-datepicker.css"
import {
  getMonthBoundaries,
  getQuarterBoundaries,
  getYearBoundaries,
  getQuarterFromMonth,
  getMonthKeysInRange,
  formatDateToYMD,
} from "../utils/dateUtils"
import { FieldBox } from "@/components/ui/FieldBox";

const MODES = ["MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"]
const MODE_LABELS = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  CUSTOM: "Custom",
}

/**
 * GlobalRangePicker (formerly FloatingMonthPicker)
 * Now supports Monthly, Quarterly, Yearly, and Custom ranges.
 * Used globally to sync all dashboard modules.
 */
export default function FloatingMonthPicker({ selectedRange, onChange }) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [globalHidden, setGlobalHidden] = useState(false)
  const panelRef = useRef(null)
  // const isInternalChange = useRef(false);
  const now = new Date()

  // Internal state for selection
  const [mode, setMode] = useState(selectedRange?.mode || "MONTHLY")
  const [month, setMonth] = useState(
    selectedRange?.mode === "MONTHLY"
      ? selectedRange.startDate.slice(0, 7)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  )
  const [quarter, setQuarter] = useState(
    selectedRange?.mode === "QUARTERLY"
      ? getQuarterFromMonth(selectedRange.startDate)
      : getQuarterFromMonth(month),
  )
  const [year, setYear] = useState(
    selectedRange?.startDate
      ? new Date(selectedRange.startDate).getFullYear()
      : now.getFullYear(),
  )
  const [customStart, setCustomStart] = useState(
    selectedRange?.mode === "CUSTOM"
      ? selectedRange.startDate
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
  )
  const [customEnd, setCustomEnd] = useState(
    selectedRange?.mode === "CUSTOM"
      ? selectedRange.endDate
      : formatDateToYMD(now),
  )

  // Helper to parse YYYY-MM-DD as local date (prevents timezone shifts)
  const parseYMD = (s) => {
    if (!s) return null
    const [y, m, d] = s.split("-").map(Number)
    return new Date(y, m - 1, d)
  }

  // Sync internal state with external prop changes during render right before computing rangeData
  // This avoids calling setState within useEffect which causes cascading re-renders
  const [prevSelectedRange, setPrevSelectedRange] = useState(selectedRange)

  if (selectedRange && selectedRange !== prevSelectedRange) {
    setPrevSelectedRange(selectedRange)

    if (selectedRange.mode !== mode) {
      setMode(selectedRange.mode)
    }

    if (selectedRange.mode === "MONTHLY") {
      const m = selectedRange.startDate?.slice(0, 7)
      if (m && m !== month) setMonth(m)
    } else if (selectedRange.mode === "QUARTERLY") {
      const y = new Date(selectedRange.startDate).getFullYear()
      const q = getQuarterFromMonth(selectedRange.startDate)
      if (y !== year) setYear(y)
      if (q !== quarter) setQuarter(q)
    } else if (selectedRange.mode === "YEARLY") {
      const y = new Date(selectedRange.startDate).getFullYear()
      if (y !== year) setYear(y)
    } else if (selectedRange.mode === "CUSTOM") {
      if (selectedRange.startDate !== customStart) {
        setCustomStart(selectedRange.startDate)
      }
      const d = parseYMD(selectedRange.endDate)
      if (d) {
        d.setDate(d.getDate() - 1)
        const inclusiveEnd = formatDateToYMD(d)
        if (inclusiveEnd !== customEnd) setCustomEnd(inclusiveEnd)
      }
    }
  }

  // Compute boundaries based on internal state
  const rangeData = useMemo(() => {
    let startDate, endDate, label

    if (mode === "MONTHLY") {
      const b = getMonthBoundaries(month)
      startDate = b.startDate
      endDate = b.endDate
      label = new Date(month + "-01").toLocaleString("default", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    } else if (mode === "QUARTERLY") {
      const b = getQuarterBoundaries(year, quarter)
      startDate = b.startDate
      endDate = b.endDate
      label = `Q${quarter} ${year}`
    } else if (mode === "YEARLY") {
      const b = getYearBoundaries(year)
      startDate = b.startDate
      endDate = b.endDate
      label = String(year)
    } else {
      startDate = customStart
      // Make custom endDate exclusive (next day) to match Monthly/Quarterly/Yearly conventions
      const nextDay = new Date(parseYMD(customEnd))
      nextDay.setDate(nextDay.getDate() + 1)
      endDate = formatDateToYMD(nextDay)
      label = `Custom Range` // Simplified for the FAB label
    }

    const monthKeys = getMonthKeysInRange(startDate, endDate)
    return { startDate, endDate, label, mode, monthKeys }
  }, [mode, month, quarter, year, customStart, customEnd])

  // Sync back to parent
  useEffect(() => {
    // Only emit if it's different to prevent loops
    if (
      rangeData.startDate !== selectedRange?.startDate ||
      rangeData.endDate !== selectedRange?.endDate ||
      rangeData.mode !== selectedRange?.mode
    ) {
      onChange?.(rangeData)
    }
  }, [rangeData, onChange, selectedRange])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        !e.target.closest(".react-datepicker-popper")
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Listen for global hide/show events
  useEffect(() => {
    const onHide = () => setGlobalHidden(true)
    const onShow = () => setGlobalHidden(false)
    window.addEventListener("FLOATING_PICKER_HIDE", onHide)
    window.addEventListener("FLOATING_PICKER_SHOW", onShow)
    return () => {
      window.removeEventListener("FLOATING_PICKER_HIDE", onHide)
      window.removeEventListener("FLOATING_PICKER_SHOW", onShow)
    }
  }, [])

  useEffect(() => {
    if (open && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      const windowHeight = window.innerHeight
      setDropUp(rect.top > windowHeight / 2)
    }
  }, [open])

  const navPrev = () => {
    if (mode === "MONTHLY") {
      const [y, m] = month.split("-").map(Number)
      const prev =
        m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
      setMonth(prev)
    } else if (mode === "QUARTERLY") {
      if (quarter === 1) {
        setQuarter(4)
        setYear(year - 1)
      } else setQuarter(quarter - 1)
    } else if (mode === "YEARLY") {
      setYear(year - 1)
    }
  }

  const navNext = () => {
    if (mode === "MONTHLY") {
      const [y, m] = month.split("-").map(Number)
      const next =
        m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
      setMonth(next)
    } else if (mode === "QUARTERLY") {
      if (quarter === 4) {
        setQuarter(1)
        setYear(year + 1)
      } else setQuarter(quarter + 1)
    } else if (mode === "YEARLY") {
      setYear(year + 1)
    }
  }

  const goToday = () => {
    setMode("MONTHLY")
    setMonth(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    )
  }

  const content = (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-100000 pointer-events-none">
      <Draggable
        handle=".drag-handle"
        nodeRef={panelRef}
        onDrag={() => {
          if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect()
            setDropUp(rect.top > window.innerHeight / 2)
          }
        }}
        onStop={() => {
          if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect()
            setDropUp(rect.top > window.innerHeight / 2)
          }
        }}
      >
        <div ref={panelRef} className="relative pointer-events-auto">
          {/* FAB TRIGGER CONTAINER — separates drag handle from click trigger */}
          <div
            className={`pointer-events-auto flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-2xl shadow-lg transition-all duration-300 border text-sm ${
              open
                ? "bg-card text-foreground border-border ring-2 ring-primary/10 shadow-xl"
                : "bg-card text-foreground border-border hover:border-border/80 hover:bg-accent/50"
            }`}
          >
            {/* DRAG HANDLE */}
            <div
              title="Drag to reposition"
              className="drag-handle cursor-grab active:cursor-grabbing p-1.5 rounded-xl hover:bg-muted/80 transition-colors flex items-center justify-center -ml-0.5 group"
            >
              <GripVertical
                size={14}
                className="text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors"
              />
            </div>

            {/* CLICKABLE TRIGGER */}
            <Button
              variant="ghost"
              onClick={() => setOpen((v) => !v)}
              className="h-auto flex items-center gap-2.5 flex-1 outline-none group/btn active:scale-95 transition-transform hover:bg-transparent"
            >
              <div
                className={`p-1.5 rounded-lg transition-colors ${open ? "bg-primary/10" : "bg-muted group-hover/btn:bg-muted/80"}`}
              >
                <Calendar
                  size={14}
                  className={open ? "text-primary" : "text-muted-foreground"}
                />
              </div>
              <div className="flex items-center gap-2 leading-none">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {mode === "MONTHLY"
                    ? "Month"
                    : mode === "QUARTERLY"
                      ? "Quarter"
                      : mode === "YEARLY"
                        ? "Year"
                        : "Range"}
                </span>
                <span className="w-px h-3 bg-border" />
                <span className="text-sm font-bold text-foreground whitespace-nowrap">
                  {rangeData.label}
                </span>
              </div>
              <LayoutGrid
                size={13}
                className={`ml-1 transition-colors ${open ? "text-primary" : "text-muted-foreground/50"}`}
              />
            </Button>
          </div>

          {/* EXPANDED PANEL — Absolutely positioned relative to the button */}
          {open && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 pointer-events-auto modal-enter ${
                dropUp
                  ? "bottom-full mb-3 origin-bottom"
                  : "top-full mt-3 origin-top"
              } bg-popover/95 backdrop-blur-md border border-border rounded-2xl shadow-2xl p-4 w-[340px] flex flex-col gap-4`}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Calendar size={13} className="text-muted-foreground" />
                  Time Range Analysis
                </p>
                <Button
                  variant="ghost"
                  onClick={goToday}
                  className="h-auto flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-all hover:bg-muted p-1.5 rounded-md active:scale-95"
                >
                  <RotateCcw size={11} />
                  Reset
                </Button>
              </div>

              {/* Mode Switcher */}
              <div className="grid grid-cols-4 gap-1 bg-muted/40 p-1 rounded-lg border border-border/50">
                {MODES.map((m) => (
                  <Button
                    key={m}
                    variant="ghost"
                    onClick={() => setMode(m)}
                    className={`h-auto py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200 active:scale-95 ${
                      mode === m
                        ? "bg-background text-foreground shadow-sm border border-border/50 hover:bg-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                    }`}
                  >
                    {MODE_LABELS[m]}
                  </Button>
                ))}
              </div>

              {/* Fixed Height Content Area */}
              <div className="h-[156px] flex flex-col gap-3">
                {mode !== "CUSTOM" ? (
                  <>
                    <div className="flex items-center justify-between border border-border bg-card rounded-lg p-1.5 shadow-sm">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={navPrev}
                        className="h-auto w-auto p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
                      >
                        <ChevronLeft size={16} />
                      </Button>

                      <div className="flex-1 text-center">
                        <span className="text-[13px] font-bold text-foreground tracking-wide">
                          {rangeData.label}
                        </span>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={navNext}
                        className="h-auto w-auto p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </div>

                    {/* Monthly Grid Quick-Jump */}
                    {mode === "MONTHLY" && (
                      <div className="grid grid-cols-4 gap-1 flex-1">
                        {Array.from({ length: 12 }, (_, i) => {
                          const isSelected =
                            i + 1 === Number(month.split("-")[1])
                          const isNow =
                            i === now.getMonth() &&
                            Number(month.split("-")[0]) === now.getFullYear()
                          const mLabel = new Date(2000, i, 1).toLocaleString(
                            "default",
                            { month: "short" },
                          )
                          return (
                            <Button
                              key={i}
                              variant="ghost"
                              onClick={() =>
                                setMonth(
                                  `${month.split("-")[0]}-${String(
                                    i + 1,
                                  ).padStart(2, "0")}`,
                                )
                              }
                              className={`relative h-auto w-full flex flex-col items-center justify-center rounded-md text-[11px] font-semibold transition-all duration-200 active:scale-95 border ${
                                isSelected
                                  ? "bg-primary text-primary-foreground shadow-sm border-transparent hover:bg-primary"
                                  : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground border-transparent hover:border-border/50"
                              }`}
                            >
                              {mLabel}
                              {isNow && !isSelected && (
                                <Dot
                                  size="w-1.5 h-1.5"
                                  color="bg-blue-9"
                                  className="absolute top-1.5 right-1.5 shadow-sm"
                                />
                              )}
                            </Button>
                          )
                        })}
                      </div>
                    )}

                    {/* Quarter Grid Quick-Jump */}
                    {mode === "QUARTERLY" && (
                      <div className="grid grid-cols-4 gap-2 flex-1">
                        {[1, 2, 3, 4].map((q) => (
                          <Button
                            key={q}
                            variant="ghost"
                            onClick={() => setQuarter(q)}
                            className={`h-full w-full flex items-center justify-center rounded-md text-[13px] font-semibold transition-all duration-200 active:scale-95 border ${
                              quarter === q
                                ? "bg-primary text-primary-foreground shadow-md border-transparent hover:bg-primary"
                                : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground border-transparent hover:border-border/50"
                            }`}
                          >
                            Q{q}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Yearly Grid Filler */}
                    {mode === "YEARLY" && (
                      <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-border/50 rounded-lg bg-muted/10">
                        <TrendingUp
                          size={24}
                          className="text-muted-foreground/30 mb-2"
                        />
                        <span className="text-[12px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                          Yearly Overview
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-4 flex-1 justify-center rounded-lg border border-border/50 bg-muted/10 p-4">
                    <div className="space-y-1.5">
                      <FieldBox label="Start Date" className="ml-0.5" />
                      <DatePicker
                        selected={parseYMD(customStart)}
                        onChange={(date) => {
                          if (!date) return
                          const y = date.getFullYear()
                          const m = String(date.getMonth() + 1).padStart(2, "0")
                          const d = String(date.getDate()).padStart(2, "0")
                          setCustomStart(`${y}-${m}-${d}`)
                        }}
                        dateFormat="MMM d, yyyy"
                        portalId="root"
                        popperClassName="!z-[100001]"
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] text-foreground font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all h-[38px] cursor-pointer"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldBox label="End Date" className="ml-0.5" />
                      <DatePicker
                        selected={parseYMD(customEnd)}
                        onChange={(date) => {
                          if (!date) return
                          const y = date.getFullYear()
                          const m = String(date.getMonth() + 1).padStart(2, "0")
                          const d = String(date.getDate()).padStart(2, "0")
                          setCustomEnd(`${y}-${m}-${d}`)
                        }}
                        dateFormat="MMM d, yyyy"
                        portalId="root"
                        popperClassName="!z-[100001]"
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] text-foreground font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all h-[38px] cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer info */}
              <div className="border-t border-border/50 pt-3 text-center">
                <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                  Syncing {mode.toLowerCase()} boundaries
                </p>
              </div>
            </div>
          )}
        </div>
      </Draggable>
    </div>
  )

  if (globalHidden) return null;

  return createPortal(content, document.body)
}
