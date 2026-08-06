import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import toast from 'react-hot-toast';
import { X, Clock, Calendar, PlusCircle } from 'lucide-react';
import TabGroup from '../ui/TabGroup';
import { Button } from '../ui/button';

export default function ApplyOffsetModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overtime'); // 'overtime' | 'leave'

  // Overtime State
  const [otDate, setOtDate] = useState('');
  const [otHours, setOtHours] = useState('');
  const [otSubmitting, setOtSubmitting] = useState(false);

  // Leave State
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveHours, setLeaveHours] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleApplyOvertime = async (e) => {
    e.preventDefault();
    if (!otDate || !otHours) {
      toast.error('Please fill in all fields.');
      return;
    }

    setOtSubmitting(true);
    try {
      await offsetService.applyOvertime({
        employeeId: user.id,
        date: otDate,
        hours: otHours,
        employeeName: user.name,
      });
      toast.success('Overtime application submitted!');
      setOtDate('');
      setOtHours('');
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
    if (!leaveDate || !leaveHours) {
      toast.error('Please fill in all fields.');
      return;
    }

    setLeaveSubmitting(true);
    try {
      await offsetService.applyOffsetLeave({
        employeeId: user.id,
        date: leaveDate,
        hours: leaveHours,
        employeeName: user.name,
      });
      toast.success('Offset leave application submitted!');
      setLeaveDate('');
      setLeaveHours('');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit offset leave.');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100005] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl flex flex-col relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            Offset & Overtime
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
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
              { value: 'leave', label: 'Offset Leave' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="sm"
          />

          {activeTab === 'overtime' ? (
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
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Hours Worked (e.g. 1.0, 1.5)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  placeholder="1.0"
                  value={otHours}
                  onChange={(e) => setOtHours(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={otSubmitting}
                className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer mt-4"
              >
                {otSubmitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleApplyOffsetLeave} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <Calendar size={16} className="text-green-11" />
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
                  value={leaveDate}
                  onChange={(e) => setLeaveDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Offset Hours to Use
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  placeholder="1.0"
                  value={leaveHours}
                  onChange={(e) => setLeaveHours(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={leaveSubmitting}
                className="w-full h-11 rounded-xl font-bold bg-green-9 hover:bg-green-10 text-white shadow-md cursor-pointer mt-4"
              >
                {leaveSubmitting ? 'Submitting...' : 'Apply for Leave'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
