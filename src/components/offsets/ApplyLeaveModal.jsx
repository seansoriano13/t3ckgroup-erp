import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import toast from 'react-hot-toast';
import { X, Calendar, PlusCircle } from 'lucide-react';
import TabGroup from '../ui/TabGroup';
import { Button } from '../ui/button';
import { AttachmentField } from '../ui/Attachments';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { safeDeriveHours } from '../../utils/time';

export default function ApplyLeaveModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overtime'); // 'overtime' | 'offset' | 'sil'

  // Overtime State
  const [otDate, setOtDate] = useState('');
  const [otStartTime, setOtStartTime] = useState('');
  const [otEndTime, setOtEndTime] = useState('');
  const [otReason, setOtReason] = useState('');
  const [otSubmitting, setOtSubmitting] = useState(false);
  const otFiles = useFileAttachments();

  // Offset Leave State
  const [offsetDate, setOffsetDate] = useState('');
  const [offsetStartTime, setOffsetStartTime] = useState('');
  const [offsetEndTime, setOffsetEndTime] = useState('');
  const [offsetReason, setOffsetReason] = useState('');
  const [offsetSubmitting, setOffsetSubmitting] = useState(false);
  const offsetFiles = useFileAttachments();

  // SIL Leave State
  const [silDate, setSilDate] = useState('');
  const [silStartTime, setSilStartTime] = useState('');
  const [silEndTime, setSilEndTime] = useState('');
  const [silReason, setSilReason] = useState('');
  const [silSubmitting, setSilSubmitting] = useState(false);
  const silFiles = useFileAttachments();

  const currentOtHours = safeDeriveHours(otStartTime, otEndTime, true);
  const currentOffsetHours = safeDeriveHours(offsetStartTime, offsetEndTime, false);
  const currentSilHours = safeDeriveHours(silStartTime, silEndTime, false);

  if (!isOpen) return null;

  const handleApplyOvertime = async (e) => {
    e.preventDefault();
    if (!otDate || !otStartTime || !otEndTime || !otReason) {
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
        employeeName: user.name,
        attachments,
      });
      toast.success('Overtime application submitted!');
      setOtDate('');
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
    if (!offsetDate || !offsetStartTime || !offsetEndTime || !offsetReason) {
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
        employeeName: user.name,
        attachments,
      });
      toast.success('Offset leave application submitted!');
      setOffsetDate('');
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
    if (!silDate || !silStartTime || !silEndTime || !silReason) {
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
        employeeName: user.name,
        attachments,
      });
      toast.success('SIL leave application submitted!');
      setSilDate('');
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
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <Calendar size={16} className="text-blue-11" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  Request Offset Leave
                </h3>
              </div>
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
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <Calendar size={16} className="text-green-11" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  Request Service Incentive Leave
                </h3>
              </div>
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
