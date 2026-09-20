import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock } from "lucide-react";
import { dayShiftService } from "../../services/dayShiftService";
import { useAuth } from "../../context/AuthContext";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * One weekday's row: start/end time commit on blur (so a Super Admin can
 * type both fields before firing two separate saves), the working-day
 * switch commits immediately. Local state seeds from the fetched row and is
 * the source of truth while editing; the parent remounts this component
 * (via a key derived from startTime/endTime) whenever those change from
 * outside — a save, or a refetch after another admin's edit — so state
 * never needs to be reconciled with an effect.
 */
function DayShiftRow({ day, onSave, isPending }) {
  const [startTime, setStartTime] = useState(day.startTime || "");
  const [endTime, setEndTime] = useState(day.endTime || "");

  const commitTimes = () => {
    if (startTime !== (day.startTime || "") || endTime !== (day.endTime || "")) {
      onSave(day.weekday, { startTime: startTime || null, endTime: endTime || null });
    }
  };

  return (
    <div className="p-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
      <div className="w-24 shrink-0">
        <p className="font-bold text-foreground text-sm">{WEEKDAY_LABELS[day.weekday]}</p>
      </div>
      <div className="flex items-center gap-2 flex-1 justify-center">
        <input
          type="time"
          aria-label={`${WEEKDAY_LABELS[day.weekday]} start time`}
          value={startTime}
          disabled={!day.isWorkingDay || isPending}
          onChange={(e) => setStartTime(e.target.value)}
          onBlur={commitTimes}
          className="px-2.5 py-1.5 bg-muted border border-border rounded-lg text-sm font-semibold text-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="time"
          aria-label={`${WEEKDAY_LABELS[day.weekday]} end time`}
          value={endTime}
          disabled={!day.isWorkingDay || isPending}
          onChange={(e) => setEndTime(e.target.value)}
          onBlur={commitTimes}
          className="px-2.5 py-1.5 bg-muted border border-border rounded-lg text-sm font-semibold text-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <div
        role="switch"
        aria-checked={day.isWorkingDay}
        aria-label={`${WEEKDAY_LABELS[day.weekday]} is a working day`}
        onClick={() => !isPending && onSave(day.weekday, { isWorkingDay: !day.isWorkingDay })}
        className={`w-11 h-6 rounded-full relative cursor-pointer transition-all duration-200 shrink-0 ${
          day.isWorkingDay ? "bg-primary shadow-sm" : "bg-mauve-5"
        } ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div
          className={`absolute top-1 bg-mauve-1 w-4 h-4 rounded-full shadow transition-all duration-200 ${
            day.isWorkingDay ? "right-1" : "left-1"
          }`}
        />
      </div>
    </div>
  );
}

/**
 * The Super Admin surface for issue #150/#152: the working day used to be
 * three string literals, written twice, that disagreed about how to read a
 * date. This edits the one table everything else now reads — Wednesday's
 * later finish is just a row here, not a special case anywhere in code.
 */
export default function DayShiftConfig() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: days = [], isLoading } = useQuery({
    queryKey: ["dayShiftConfig"],
    queryFn: () => dayShiftService.getDayShiftConfig(),
  });

  const mutation = useMutation({
    mutationFn: ({ weekday, updates }) => dayShiftService.updateDayShiftDay(weekday, updates, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dayShiftConfig"] });
      toast.success("Working week updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const sortedDays = [...days].sort((a, b) => a.weekday - b.weekday);

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5 relative z-10">
        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <Clock size={14} className="text-primary" />
        </div>
        <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
          Working Week
        </h2>
      </div>
      <p className="px-5 pt-4 text-xs text-muted-foreground leading-relaxed relative z-10">
        Pre-fills leave and overtime forms with a normal day's hours. Changing a
        day here never rewrites a record already filed against it.
      </p>
      <div className="divide-y divide-border relative z-10 mt-2">
        {isLoading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading...</div>
        ) : (
          sortedDays.map((day) => (
            <DayShiftRow
              key={`${day.weekday}-${day.startTime}-${day.endTime}`}
              day={day}
              isPending={mutation.isPending}
              onSave={(weekday, updates) => mutation.mutate({ weekday, updates })}
            />
          ))
        )}
      </div>
    </div>
  );
}
