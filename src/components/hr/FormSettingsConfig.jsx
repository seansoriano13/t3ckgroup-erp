import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hrSettingsService } from '../../../services/hrSettingsService';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '../../ui/button';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '../../ui/input';

export default function FormSettingsConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    supervisor_name: '',
    supervisor_title: '',
    approver_name: '',
    approver_title: ''
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['hrFormSettings'],
    queryFn: () => hrSettingsService.getFormSettings(),
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        supervisor_name: settings.supervisor_name || '',
        supervisor_title: settings.supervisor_title || '',
        approver_name: settings.approver_name || '',
        approver_title: settings.approver_title || ''
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (updates) => hrSettingsService.updateFormSettings(updates, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrFormSettings'] });
      toast.success('Form settings updated successfully');
    },
    onError: (err) => toast.error('Failed to update form settings: ' + err.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm font-semibold">Loading form settings...</div>;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 max-w-3xl">
      <div className="mb-6 border-b border-border pb-4">
        <h2 className="text-base font-black text-foreground uppercase tracking-wide">Printed Form Settings</h2>
        <p className="text-sm text-muted-foreground mt-1 font-medium">Configure the names and titles printed on the bottom of leave application forms.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground">Supervisor / Manager</h3>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">Name</label>
              <Input
                name="supervisor_name"
                value={formData.supervisor_name}
                onChange={handleChange}
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">Title</label>
              <Input
                name="supervisor_title"
                value={formData.supervisor_title}
                onChange={handleChange}
                placeholder="e.g. Operations Manager"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-foreground">Approver / HR</h3>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">Name</label>
              <Input
                name="approver_name"
                value={formData.approver_name}
                onChange={handleChange}
                placeholder="e.g. Jane Smith"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">Title</label>
              <Input
                name="approver_title"
                value={formData.approver_title}
                onChange={handleChange}
                placeholder="e.g. 201 File Custodian"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending} className="rounded-xl font-bold min-w-[120px]">
            <Save size={16} /> Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
