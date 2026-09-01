import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { formatWindow } from '../../utils/time';

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
                  <span className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-md">
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
                          {leave.hours}h {leave.type} {leave.start_time && leave.end_time ? `(${formatWindow(leave.start_time, leave.end_time)})` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Stacked Overflow Button */}
                {overflowCount > 0 && (
                  <button
                    onClick={() => {
                      const dateStr = new Date(year, month, day).toISOString().split('T')[0];
                      setSelectedDayLeaves({ dateStr, leaves, dayNum: day });
                    }}
                    className="w-full py-1 bg-muted hover:bg-muted/80 border border-border text-foreground rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-xs"
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
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {formatWindow(leave.start_time, leave.end_time)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Individual Leave Detail Modal */}
      {selectedLeave && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in duration-150 overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex justify-between items-center bg-muted/30">
              <h3 className="font-black text-sm uppercase text-foreground">Leave Details</h3>
              <button
                onClick={() => setSelectedLeave(null)}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-5 space-y-5">
              <div className="flex items-center space-x-4">
                <Avatar src={selectedLeave.employee?.avatar_path} name={selectedLeave.employee?.name} size="lg" />
                <div>
                  <h4 className="font-bold text-foreground">{selectedLeave.employee?.name}</h4>
                  <p className="text-xs text-muted-foreground font-medium">{selectedLeave.employee?.department}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 p-3 rounded-xl border border-border">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">Date</p>
                  <p className="text-sm font-bold text-foreground">
                    {new Date(selectedLeave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-xl border border-border">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">Duration</p>
                  <p className="text-sm font-bold text-foreground">
                    {selectedLeave.hours} Hours
                    {selectedLeave.start_time && selectedLeave.end_time && (
                      <span className="block text-xs font-medium text-muted-foreground mt-0.5">
                        {formatWindow(selectedLeave.start_time, selectedLeave.end_time)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="col-span-2 bg-muted/50 p-3 rounded-xl border border-border">
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">Type</p>
                  <p className="text-sm font-bold text-foreground">
                    {selectedLeave.type} Leave
                  </p>
                </div>
              </div>

              {selectedLeave.reason && (canViewAllReasons || currentUserId === selectedLeave.employee_id) && (
                <div className="bg-muted/30 p-3 rounded-xl border border-border">
                   <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">Reason</p>
                   <p className="text-sm font-medium text-foreground">{selectedLeave.reason}</p>
                </div>
              )}

              {/* Action for Employee to Withdraw their own future leave */}
              {currentUserId === selectedLeave.employee_id && 
               new Date(selectedLeave.date) > new Date() && 
               onWithdrawLeave && (
                <button
                  onClick={() => {
                    onWithdrawLeave(selectedLeave.id, selectedLeave.status, selectedLeave.type);
                    setSelectedLeave(null);
                  }}
                  className="w-full py-2.5 mt-2 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white border border-destructive/20 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                >
                  Withdraw Leave
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
