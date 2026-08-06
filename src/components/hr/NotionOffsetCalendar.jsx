import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, X } from 'lucide-react';
import Avatar from '@/components/Avatar';

export default function NotionOffsetCalendar({ 
  approvedLeaves = [], 
  currentUserId = null,
  onWithdrawLeave = null,
  targetDate = null
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
    return approvedLeaves.filter((leave) => leave.date === dateStr);
  };

  const isToday = (dayNum) => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month && now.getDate() === dayNum;
  };

  const MAX_VISIBLE_CARDS = 2;

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
              Overview of all approved employee offset leaves
            </p>
          </div>
        </div>
      </div>

      {/* Weekday Names Header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/60 text-center py-2.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, idx) => (
          <span
            key={d}
            className={`text-[10px] font-black uppercase tracking-[0.15em] ${
              idx === 0 || idx === 6
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
              className={`min-h-[110px] p-2 transition-colors relative group flex flex-col justify-between ${
                isWeekendCell ? 'bg-muted/30' : 'bg-card hover:bg-muted/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${
                    isToday(day)
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-foreground'
                  }`}
                >
                  {day}
                </span>
                {leaves.length > 0 && (
                  <span className="text-[10px] font-black uppercase tracking-wider text-green-11 bg-green-2 border border-green-6 px-1.5 py-0.5 rounded-md">
                    {leaves.length} {leaves.length === 1 ? 'leave' : 'leaves'}
                  </span>
                )}
              </div>

              {/* Leave Cards */}
              <div className="space-y-1.5 flex-1 overflow-hidden">
                {leaves.slice(0, MAX_VISIBLE_CARDS).map((leave) => (
                  <div
                    key={leave.id}
                    onClick={() => setSelectedLeave(leave)}
                    className="p-1.5 bg-green-2 border border-green-6 rounded-lg hover:border-green-8 transition-all cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center space-x-1.5">
                      <Avatar
                        name={leave.employee?.name || 'E'}
                        size="xs"
                        className="w-5 h-5 rounded-full text-[9px]"
                      />
                      <div className="truncate">
                        <p className="text-[11px] font-bold text-green-11 truncate">
                          {leave.employee?.name || 'Employee'}
                        </p>
                        <p className="text-[9px] text-green-11 font-mono font-semibold">
                          {leave.hours}h offset
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Stacked Overflow Button */}
                {overflowCount > 0 && (
                  <button
                    onClick={() => {
                      const dateStr = new Date(year, month, day).toISOString().split('T')[0];
                      setSelectedDayLeaves({ dateStr, leaves, dayNum: day });
                    }}
                    className="w-full py-1 bg-green-3 hover:bg-green-4 border border-green-7 text-green-12 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Users size={11} />
                    <span>+{overflowCount} more...</span>
                  </button>
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-150 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center space-x-2">
                <CalendarIcon size={18} className="text-primary" />
                <h3 className="font-black text-foreground text-sm">
                  Approved Leaves on {new Date(selectedDayLeaves.dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDayLeaves(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin pr-1">
              {selectedDayLeaves.leaves.map((leave) => (
                <div
                  key={leave.id}
                  onClick={() => {
                    setSelectedLeave(leave);
                  }}
                  className="p-3 bg-muted/50 border border-border rounded-xl hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center space-x-3">
                    <Avatar
                      name={leave.employee?.name || 'E'}
                      size="md"
                      className="w-9 h-9 rounded-xl"
                    />
                    <div>
                      <p className="text-xs font-bold text-foreground">
                        {leave.employee?.name || 'Employee'}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {leave.employee?.department || 'Staff'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-green-11 bg-green-2 border border-green-6 px-2 py-0.5 rounded-lg inline-block">
                      {leave.hours} hrs
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSelectedDayLeaves(null)}
              className="w-full py-2.5 bg-muted hover:bg-mauve-4 text-foreground rounded-xl text-xs font-bold border border-border transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Individual Leave Details Modal */}
      {selectedLeave && (
        <div className="fixed inset-0 z-55 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center space-x-3 mb-4">
              <Avatar
                name={selectedLeave.employee?.name || 'E'}
                size="md"
                className="w-10 h-10 rounded-xl"
              />
              <div>
                <h3 className="font-black text-foreground text-sm">
                  {selectedLeave.employee?.name}
                </h3>
                <p className="text-xs text-muted-foreground font-medium">
                  {selectedLeave.employee?.department || 'Employee'}
                </p>
              </div>
            </div>

            <div className="space-y-2.5 bg-muted/60 p-3.5 rounded-xl border border-border mb-5 text-xs text-foreground font-medium">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarIcon size={14} /> Leave Date:
                </span>
                <span className="font-bold">
                  {new Date(selectedLeave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock size={14} /> Offset Used:
                </span>
                <span className="font-black text-green-11">{selectedLeave.hours} Hours</span>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border mt-4">
              {currentUserId === selectedLeave.employee_id && onWithdrawLeave && (
                <button
                  onClick={() => {
                    onWithdrawLeave(selectedLeave.id, selectedLeave.status);
                    setSelectedLeave(null);
                  }}
                  className="w-full py-2.5 bg-red-9 hover:bg-red-10 text-white rounded-xl text-xs font-bold border border-red-9 transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                >
                  <X size={14} /> Withdraw Leave Request
                </button>
              )}
              <button
                onClick={() => setSelectedLeave(null)}
                className="w-full py-2.5 bg-muted hover:bg-mauve-4 text-foreground rounded-xl text-xs font-bold border border-border transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
