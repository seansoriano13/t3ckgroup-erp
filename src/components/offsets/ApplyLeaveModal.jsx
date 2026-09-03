import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { hrSettingsService } from '../../services/hrSettingsService';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Calendar, PlusCircle } from 'lucide-react';
import TabGroup from '../ui/TabGroup';
import { Button } from '../ui/button';
import { AttachmentField } from '../ui/Attachments';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { safeDeriveHours } from '../../utils/time';
import { enumerateDateRange } from '../../utils/dateUtils';

const DEFAULT_DAY_HOURS = 8;

/**
 * Lets an employee cover several consecutive days in one submission (ticket
 * #63) instead of applying day by day. Each day defaults to 8 hours and is
 * individually editable, so a half-day inside the range stays expressible;
 * the actual grouping into one `leave_group_id` happens server-side.
 */
function RangeDayEditor({ startDate, endDate, onStartDateChange, onEndDateChange, dayHours, onDayHoursChange, accentClass }) {
  const days = enumerateDateRange(startDate, endDate);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            required
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
            To
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            required
          />
        </div>
      </div>

      {days.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {days.map((date) => (
            <div key={date} className="flex items-center justify-between gap-3 bg-muted/60 border border-border rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-foreground">
                {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={dayHours[date] ?? DEFAULT_DAY_HOURS}
                  onChange={(e) => onDayHoursChange(date, e.target.value)}
                  className={`w-16 px-2 py-1 bg-card border border-border rounded-md text-xs font-bold text-right text-foreground focus:outline-none focus:ring-2 ${accentClass}`}
                />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">hrs</span>
              </div>
            </div>
          ))}
          <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-0.5">
            {days.length} day{days.length > 1 ? 's' : ''} · {days.reduce((sum, d) => sum + (parseFloat(dayHours[d] ?? DEFAULT_DAY_HOURS) || 0), 0)} hrs total
          </p>
        </div>
      )}
    </div>
  );
}

export default function ApplyLeaveModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overtime'); // 'overtime' | 'offset' | 'sil'

  // Overtime State
  const [otDate, setOtDate] = useState('');
  const [otCategoryId, setOtCategoryId] = useState('');
  const [otStartTime, setOtStartTime] = useState('');
  const [otEndTime, setOtEndTime] = useState('');
  const [otReason, setOtReason] = useState('');
  const [otSubmitting, setOtSubmitting] = useState(false);
  const otFiles = useFileAttachments();

  // Offset Leave State
  const [offsetApplyMode, setOffsetApplyMode] = useState('single'); // 'single' | 'range'
  const [offsetDate, setOffsetDate] = useState('');
  const [offsetCategoryId, setOffsetCategoryId] = useState('');
  const [offsetStartTime, setOffsetStartTime] = useState('');
  const [offsetEndTime, setOffsetEndTime] = useState('');
  const [offsetRangeStart, setOffsetRangeStart] = useState('');
  const [offsetRangeEnd, setOffsetRangeEnd] = useState('');
  const [offsetDayHours, setOffsetDayHours] = useState({});
  const [offsetReason, setOffsetReason] = useState('');
  const [offsetSubmitting, setOffsetSubmitting] = useState(false);
  const offsetFiles = useFileAttachments();

  // SIL Leave State
  const [silApplyMode, setSilApplyMode] = useState('single'); // 'single' | 'range'
  const [silDate, setSilDate] = useState('');
  const [silCategoryId, setSilCategoryId] = useState('');
  const [silStartTime, setSilStartTime] = useState('');
  const [silEndTime, setSilEndTime] = useState('');
  const [silRangeStart, setSilRangeStart] = useState('');
  const [silRangeEnd, setSilRangeEnd] = useState('');
  const [silDayHours, setSilDayHours] = useState({});
  const [silReason, setSilReason] = useState('');
  const [silSubmitting, setSilSubmitting] = useState(false);
  const silFiles = useFileAttachments();

  const currentOtHours = safeDeriveHours(otStartTime, otEndTime, true);
  const currentOffsetHours = safeDeriveHours(offsetStartTime, offsetEndTime, false);
  const currentSilHours = safeDeriveHours(silStartTime, silEndTime, false);

  const { data: categories = [] } = useQuery({
    queryKey: ['activeLeaveCategories'],
    queryFn: () => hrSettingsService.getLeaveCategories(false),
  });

  if (!isOpen) return null;

  const handleApplyOvertime = async (e) => {
    e.preventDefault();
    if (!otDate || !otStartTime || !otEndTime || !otReason || !otCategoryId) {
      toast.error('Please fill in all fields.');
      return;
    }

    setOtSubmitting(true);
    try {
      const attachments = await otFiles.upload();
      await offsetService.applyOvertime({
        employeeId: user.id,
        date: otDate,
        startTime: otStartTime,
        endTime: otEndTime,
        reason: otReason,
        categoryId: otCategoryId,
        employeeName: user.name,
        attachments,
      });
      toast.success('Overtime application submitted!');
      setOtDate('');
      setOtCategoryId('');
      setOtStartTime('');
      setOtEndTime('');
      setOtReason('');
      otFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit overtime application.');
    } finally {
      setOtSubmitting(false);
    }
  };

  const handleApplyOffsetLeave = async (e) => {
    e.preventDefault();

    if (offsetApplyMode === 'range') {
      const days = enumerateDateRange(offsetRangeStart, offsetRangeEnd);
      if (days.length === 0 || !offsetReason || !offsetCategoryId) {
        toast.error('Please fill in all fields.');
        return;
      }

      setOffsetSubmitting(true);
      try {
        const attachments = await offsetFiles.upload();
        await offsetService.applyOffsetLeaveRange({
          employeeId: user.id,
          days: days.map((date) => ({ date, hours: parseFloat(offsetDayHours[date] ?? DEFAULT_DAY_HOURS) })),
          reason: offsetReason,
          categoryId: offsetCategoryId,
          employeeName: user.name,
          attachments,
        });
        toast.success(`Offset leave application submitted for ${days.length} day${days.length > 1 ? 's' : ''}!`);
        setOffsetRangeStart('');
        setOffsetRangeEnd('');
        setOffsetDayHours({});
        setOffsetCategoryId('');
        setOffsetReason('');
        offsetFiles.clear();
        onSuccess?.();
        onClose();
      } catch (err) {
        toast.error(err.message || 'Failed to submit offset leave.');
      } finally {
        setOffsetSubmitting(false);
      }
      return;
    }

    if (!offsetDate || !offsetStartTime || !offsetEndTime || !offsetReason || !offsetCategoryId) {
      toast.error('Please fill in all fields.');
      return;
    }

    setOffsetSubmitting(true);
    try {
      const attachments = await offsetFiles.upload();
      await offsetService.applyOffsetLeave({
        employeeId: user.id,
        date: offsetDate,
        startTime: offsetStartTime,
        endTime: offsetEndTime,
        reason: offsetReason,
        categoryId: offsetCategoryId,
        employeeName: user.name,
        attachments,
      });
      toast.success('Offset leave application submitted!');
      setOffsetDate('');
      setOffsetCategoryId('');
      setOffsetStartTime('');
      setOffsetEndTime('');
      setOffsetReason('');
      offsetFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit offset leave.');
    } finally {
      setOffsetSubmitting(false);
    }
  };

  const handleApplySilLeave = async (e) => {
    e.preventDefault();

    if (silApplyMode === 'range') {
      const days = enumerateDateRange(silRangeStart, silRangeEnd);
      if (days.length === 0 || !silReason || !silCategoryId) {
        toast.error('Please fill in all fields.');
        return;
      }

      setSilSubmitting(true);
      try {
        const attachments = await silFiles.upload();
        await silService.applySilLeaveRange({
          employeeId: user.id,
          days: days.map((date) => ({ date, hours: parseFloat(silDayHours[date] ?? DEFAULT_DAY_HOURS) })),
          reason: silReason,
          categoryId: silCategoryId,
          employeeName: user.name,
          attachments,
        });
        toast.success(`SIL leave application submitted for ${days.length} day${days.length > 1 ? 's' : ''}!`);
        setSilRangeStart('');
        setSilRangeEnd('');
        setSilDayHours({});
        setSilCategoryId('');
        setSilReason('');
        silFiles.clear();
        onSuccess?.();
        onClose();
      } catch (err) {
        console.error('SIL Submission Error:', err);
        toast.error(err.message || 'Failed to submit SIL leave.');
      } finally {
        setSilSubmitting(false);
      }
      return;
    }

    if (!silDate || !silStartTime || !silEndTime || !silReason || !silCategoryId) {
      console.log('Validation failed!', { silDate, silStartTime, silEndTime, silReason, silCategoryId });
      toast.error('Please fill in all fields.');
      return;
    }

    setSilSubmitting(true);
    try {
      const attachments = await silFiles.upload();
      await silService.applySilLeave({
        employeeId: user.id,
        date: silDate,
        startTime: silStartTime,
        endTime: silEndTime,
        reason: silReason,
        categoryId: silCategoryId,
        employeeName: user.name,
        attachments,
      });
      toast.success('SIL leave application submitted!');
      setSilDate('');
      setSilCategoryId('');
      setSilStartTime('');
      setSilEndTime('');
      setSilReason('');
      silFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit SIL leave.');
    } finally {
      setSilSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100005] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl flex flex-col relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            Leaves & Overtime
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <TabGroup
            variant="pill"
            tabs={[
              { value: 'overtime', label: 'Overtime' },
              { value: 'offset', label: 'Offset' },
              { value: 'sil', label: 'SIL' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="sm"
          />

          {activeTab === 'overtime' && (
            <form onSubmit={handleApplyOvertime} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <PlusCircle size={16} className="text-primary" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  Request Overtime
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Category
                  </label>
                  <select
                    value={otCategoryId}
                    onChange={(e) => setOtCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                    required
                  >
                    <option value="" disabled>Select...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Date Worked
                  </label>
                  <input
                    type="date"
                    value={otDate}
                    onChange={(e) => setOtDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={otStartTime}
                    onChange={(e) => setOtStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={otEndTime}
                    onChange={(e) => setOtEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    required
                  />
                </div>
              </div>
              {currentOtHours > 0 && (
                <div className="text-xs font-semibold text-primary/80 px-1">
                  Derived: {currentOtHours} hrs
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Reason
                </label>
                <textarea
                  value={otReason}
                  onChange={(e) => setOtReason(e.target.value)}
                  placeholder="Reason for the overtime request"
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={otFiles}
                disabled={otSubmitting}
                hint={`Optional — approval email, logbook photo, or similar. Up to ${otFiles.max} files, 10.0 MB each.`}
              />
              <Button
                type="submit"
                disabled={otSubmitting}
                className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer mt-4"
              >
                {otSubmitting
                  ? otFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Submit Request'}
              </Button>
            </form>
          )}

          {activeTab === 'offset' && (
            <form onSubmit={handleApplyOffsetLeave} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <Calendar size={16} className="text-blue-11" />
                  <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                    Request Offset Leave
                  </h3>
                </div>
                <TabGroup
                  variant="pill"
                  tabs={[
                    { value: 'single', label: 'Single day' },
                    { value: 'range', label: 'Date range' },
                  ]}
                  activeTab={offsetApplyMode}
                  onChange={setOffsetApplyMode}
                  size="sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Category
                </label>
                <select
                  value={offsetCategoryId}
                  onChange={(e) => setOffsetCategoryId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                  required
                >
                  <option value="" disabled>Select category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              {offsetApplyMode === 'range' ? (
                <RangeDayEditor
                  startDate={offsetRangeStart}
                  endDate={offsetRangeEnd}
                  onStartDateChange={setOffsetRangeStart}
                  onEndDateChange={setOffsetRangeEnd}
                  dayHours={offsetDayHours}
                  onDayHoursChange={(date, hours) => setOffsetDayHours((prev) => ({ ...prev, [date]: hours }))}
                  accentClass="focus:ring-blue-8"
                />
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Leave Date (Mon-Fri)
                    </label>
                    <input
                      type="date"
                      value={offsetDate}
                      onChange={(e) => setOffsetDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={offsetStartTime}
                        onChange={(e) => setOffsetStartTime(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        End Time
                      </label>
                      <input
                        type="time"
                        value={offsetEndTime}
                        onChange={(e) => setOffsetEndTime(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        required
                      />
                    </div>
                  </div>
                  {currentOffsetHours > 0 && (
                    <div className="text-xs font-semibold text-blue-11 px-1">
                      Derived: {currentOffsetHours} hrs
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Reason
                </label>
                <textarea
                  value={offsetReason}
                  onChange={(e) => setOffsetReason(e.target.value)}
                  placeholder="Reason for the offset leave"
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={offsetFiles}
                disabled={offsetSubmitting}
                hint={`Optional — up to ${offsetFiles.max} files, 10.0 MB each. Images, PDFs and documents.`}
              />
              <Button
                type="submit"
                disabled={offsetSubmitting}
                className="w-full h-11 rounded-xl font-bold bg-blue-9 hover:bg-blue-10 text-white shadow-md cursor-pointer mt-4"
              >
                {offsetSubmitting
                  ? offsetFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Apply for Leave'}
              </Button>
            </form>
          )}

          {activeTab === 'sil' && (
            <form onSubmit={handleApplySilLeave} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <Calendar size={16} className="text-green-11" />
                  <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                    Request Service Incentive Leave
                  </h3>
                </div>
                <TabGroup
                  variant="pill"
                  tabs={[
                    { value: 'single', label: 'Single day' },
                    { value: 'range', label: 'Date range' },
                  ]}
                  activeTab={silApplyMode}
                  onChange={setSilApplyMode}
                  size="sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Category
                </label>
                <select
                  value={silCategoryId}
                  onChange={(e) => setSilCategoryId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                  required
                >
                  <option value="" disabled>Select category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              {silApplyMode === 'range' ? (
                <RangeDayEditor
                  startDate={silRangeStart}
                  endDate={silRangeEnd}
                  onStartDateChange={setSilRangeStart}
                  onEndDateChange={setSilRangeEnd}
                  dayHours={silDayHours}
                  onDayHoursChange={(date, hours) => setSilDayHours((prev) => ({ ...prev, [date]: hours }))}
                  accentClass="focus:ring-green-8"
                />
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Leave Date
                    </label>
                    <input
                      type="date"
                      value={silDate}
                      onChange={(e) => setSilDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={silStartTime}
                        onChange={(e) => setSilStartTime(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        End Time
                      </label>
                      <input
                        type="time"
                        value={silEndTime}
                        onChange={(e) => setSilEndTime(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        required
                      />
                    </div>
                  </div>
                  {currentSilHours > 0 && (
                    <div className="text-xs font-semibold text-green-11 px-1">
                      Derived: {currentSilHours} hrs
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Reason
                </label>
                <textarea
                  value={silReason}
                  onChange={(e) => setSilReason(e.target.value)}
                  placeholder="Reason for taking leave"
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={silFiles}
                disabled={silSubmitting}
                hint={`Optional — medical certificate or similar. Up to ${silFiles.max} files, 10.0 MB each.`}
              />
              <Button
                type="submit"
                disabled={silSubmitting}
                className="w-full h-11 rounded-xl font-bold bg-green-9 hover:bg-green-10 text-white shadow-md cursor-pointer mt-4"
              >
                {silSubmitting
                  ? silFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Apply for Leave'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
