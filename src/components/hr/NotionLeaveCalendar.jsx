import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import SlideOver, { SlideOverBody, SlideOverFooter } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection } from '@/components/ui/DetailParts';
import { compareByStartTime, formatWindow, formatWindowCompact } from '../../utils/time';

const leaveIdentity = (leave) => ({
  ref: leave.type,
  title: 'Leave details',
});

export default function NotionLeaveCalendar({
  approvedLeaves = [], // Should be an array of objects with a 'type' property ('SIL' or 'OFFSET')
  currentUserId = null,
  onWithdrawLeave = null,
  targetDate = null,
  canViewAllReasons = false // Only HR sees other employees' leave reasons
}) {
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [selectedDayLeaves, setSelectedDayLeaves] = useState(null); // { dateStr, leaves }

  // Sync with FloatingMonthPicker targetDate
  let year = new Date().getFullYear();
  let month = new Date().getMonth();
  if (targetDate) {
    const parts = targetDate.split('-');
    if (parts.length >= 2) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
    }
  }


  /**
   * Whether the leave this card belongs to has already been taken — the same
   * question `withdraw_offset_leave` and `cancel_sil_leave` ask before they
   * refuse a refund (issue #111, ADR 0015), asked here so the button is absent
   * rather than present and rejected.
   *
   * A multi-day leave is one application, so what matters is the group's first
   * day, not the day whose card was clicked — otherwise a range that started
   * yesterday would still offer "Withdraw" on tomorrow's card. Falls back to
   * the card's own date for a leave with no group, which is a group of one.
   *
   * Compared as `YYYY-MM-DD` strings against today in UTC, which is exactly
   * what the SQL does: `first_date < CURRENT_DATE`. Parsing either side into a
   * `Date` would put the boundary eight hours into the Manila working day and
   * would also exclude the start day itself, which ADR 0015 deliberately keeps
   * withdrawable.
   */
  const hasAlreadyBeenTaken = (leave) => {
    const groupDates = leave.leave_group_id
      ? approvedLeaves.filter((l) => l.leave_group_id === leave.leave_group_id).map((l) => l.date)
      : [leave.date];
    const firstDate = (groupDates.sort()[0] || leave.date || '').slice(0, 10);
    return Boolean(firstDate) && firstDate < new Date().toISOString().slice(0, 10);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const prevMonthDays = Array.from({ length: firstDayOfMonth }, (_, i) => daysInPrevMonth - firstDayOfMonth + i + 1);
  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const totalGridCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const nextMonthDays = Array.from({ length: totalGridCells - (firstDayOfMonth + daysInMonth) }, (_, i) => i + 1);

  const getLeavesForDate = (dayNum, monthOffset = 0) => {
    const target = new Date(year, month + monthOffset, dayNum);
    const yStr = target.getFullYear().toString();
    const mStr = (target.getMonth() + 1).toString().padStart(2, '0');
    const dStr = target.getDate().toString().padStart(2, '0');
    const dateStr = `${yStr}-${mStr}-${dStr}`;
    return approvedLeaves
      .filter((leave) => leave.date === dateStr)
      .sort(compareByStartTime);
  };

  const isToday = (dayNum) => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month && now.getDate() === dayNum;
  };

  const MAX_VISIBLE_CARDS = 2;

  const getLeaveColorStyles = (type) => {
    if (type === 'SIL') {
      return {
        dot: 'bg-green-9',
        hoverBg: 'hover:bg-green-a3'
      };
    }
    // Default Offset colors
    return {
      dot: 'bg-blue-9',
      hoverBg: 'hover:bg-blue-a3'
    };
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden transition-all">
      {/* Calendar Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-muted text-foreground rounded-xl border border-border">
            <CalendarIcon size={18} />
          </div>
          <div>
            <h2 className="text-base font-black text-foreground tracking-tight">
              {monthNames[month]} {year}
            </h2>
            <p className="text-[11px] font-medium text-muted-foreground">
              Overview of all approved employee leaves
            </p>
          </div>
        </div>
      </div>

      {/* Weekday Names Header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/60 text-center py-2.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, idx) => (
          <span
            key={d}
            className={`text-label font-black uppercase tracking-[0.15em] ${idx === 0 || idx === 6
              ? 'text-red-11'
              : 'text-muted-foreground'
              }`}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Grid Cells */}
      <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-border">
        {/* Previous Month Days */}
        {prevMonthDays.map((day) => (
          <div key={`prev-${day}`} className="min-h-[110px] p-2 bg-muted/20 text-muted-foreground/40">
            <span className="text-xs font-bold">{day}</span>
          </div>
        ))}

        {/* Current Month Days */}
        {currentMonthDays.map((day) => {
          const leaves = getLeavesForDate(day, 0);
          const isWeekendCell = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;
          const overflowCount = leaves.length - MAX_VISIBLE_CARDS;

          return (
            <div
              key={`curr-${day}`}
              className={`min-h-[110px] p-2 transition-colors relative group flex flex-col justify-between ${isWeekendCell ? 'bg-muted/30' : 'bg-card hover:bg-muted/40'
                }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${isToday(day)
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-foreground'
                    }`}
                >
                  {day}
                </span>
                {leaves.length > 0 && (
                  <span className="text-label font-black uppercase tracking-wider border border-mauve-6 px-1.5 py-0.5 rounded-md">
                    {leaves.length} {leaves.length === 1 ? 'leave' : 'leaves'}
                  </span>
                )}
              </div>

              {/* Leave Cards */}
              <div className="space-y-1.5 flex-1 overflow-hidden">
                {leaves.slice(0, MAX_VISIBLE_CARDS).map((leave) => {
                  const colors = getLeaveColorStyles(leave.type);
                  return (
                    <div
                      key={leave.type + '-' + leave.id}
                      onClick={() => setSelectedLeave(leave)}
                      className={`flex items-center gap-1.5 px-1 py-1 rounded-md ${colors.hoverBg} transition-colors cursor-pointer`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
                      <Avatar
                        name={leave.employee?.name || 'E'}
                        size="xs"
                        className="w-4 h-4 rounded-full text-[8px] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-foreground truncate leading-tight">
                          {leave.employee?.name || 'Employee'}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-mono truncate leading-tight">
                          {leave.start_time && leave.end_time
                            ? `${leave.hours}h · ${formatWindowCompact(leave.start_time, leave.end_time)}`
                            : `${leave.hours}h ${leave.type}`}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Stacked Overflow Button */}
                {overflowCount > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const dateStr = new Date(year, month, day).toISOString().split('T')[0];
                      setSelectedDayLeaves({ dateStr, leaves, dayNum: day });
                    }}
                    className="w-full h-auto py-1 bg-muted hover:bg-muted/80 border-border text-foreground rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Users size={11} />
                    <span>+{overflowCount} more...</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {/* Next Month Days */}
        {nextMonthDays.map((day) => (
          <div key={`next-${day}`} className="min-h-[110px] p-2 bg-muted/20 text-muted-foreground/40">
            <span className="text-xs font-bold">{day}</span>
          </div>
        ))}
      </div>

      {/* Stacked Group Day View Modal */}
      {selectedDayLeaves && (
        <Dialog open onOpenChange={(open) => !open && setSelectedDayLeaves(null)}>
          <DialogContent showCloseButton={false} className="max-w-md sm:max-w-md p-6 gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center space-x-2">
                <CalendarIcon size={18} className="text-primary" />
                <h3 className="font-black text-foreground text-sm">
                  Approved Leaves on {new Date(selectedDayLeaves.dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedDayLeaves(null)}
                className="h-auto w-auto p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer"
              >
                <X size={16} />
              </Button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {selectedDayLeaves.leaves.map((leave) => {
                const colors = getLeaveColorStyles(leave.type);
                return (
                  <div
                    key={leave.type + '-' + leave.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-muted/60 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedLeave(leave);
                      setSelectedDayLeaves(null);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                      <Avatar src={leave.employee?.avatar_path} name={leave.employee?.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{leave.employee?.name}</p>
                        <p className="text-xs text-muted-foreground font-medium truncate">{leave.employee?.department || '-'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-xs font-mono font-semibold text-muted-foreground">
                        {leave.hours} hrs {leave.type}
                      </span>
                      {leave.start_time && leave.end_time && (
                        <span className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                          {formatWindow(leave.start_time, leave.end_time)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Individual leave detail: a slide-over (DESIGN.md "Container rule") */}
      <SlideOver
        record={selectedLeave}
        icon={CalendarIcon}
        crumb="Leave calendar"
        identity={leaveIdentity}
        onClose={() => setSelectedLeave(null)}
      >
        {(leave) => {
          const canWithdraw =
            currentUserId === leave.employee_id && !hasAlreadyBeenTaken(leave) && onWithdrawLeave;
          return (
            <>
              <SlideOverBody>
                <div className="flex items-center gap-3">
                  <Avatar src={leave.employee?.avatar_path} name={leave.employee?.name} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-foreground">{leave.employee?.name}</p>
                    <p className="truncate text-xs font-medium text-muted-foreground">{leave.employee?.department}</p>
                  </div>
                </div>

                <DetailSection title="Details">
                  <dl className="divide-y divide-border">
                    <DetailRow label="Date">
                      {new Date(leave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                    </DetailRow>
                    <DetailRow label="Duration">
                      {leave.hours} hours
                      {leave.start_time && leave.end_time && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {formatWindow(leave.start_time, leave.end_time)}
                        </span>
                      )}
                    </DetailRow>
                    <DetailRow label="Type">{leave.type === "OFFSET" ? "OFFSET" : `${leave.type} Leave`}</DetailRow>
                  </dl>
                </DetailSection>

                {leave.reason && (canViewAllReasons || currentUserId === leave.employee_id) && (
                  <DetailSection title="Reason">
                    <p className="text-[13px] text-foreground">{leave.reason}</p>
                  </DetailSection>
                )}
              </SlideOverBody>

              {/* Action for Employee to Withdraw their own future leave */}
              {canWithdraw && (
                <SlideOverFooter>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => {
                      onWithdrawLeave(leave.id, leave.status, leave.type);
                      setSelectedLeave(null);
                    }}
                  >
                    Withdraw Leave
                  </Button>
                </SlideOverFooter>
              )}
            </>
          );
        }}
      </SlideOver>

    </div>
  );
}
