import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { Plus, FolderOpen } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useAuth } from '../../../context/AuthContext';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';

export default function FlowPlansPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');

  const { data: plans, isLoading } = useQuery({
    queryKey: ['flow_plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flow_plans')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name) => {
      const { data, error } = await supabase
        .from('flow_plans')
        .insert({ name, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Flow Plan created.');
      queryClient.invalidateQueries({ queryKey: ['flow_plans'] });
      setIsCreating(false);
      setNewPlanName('');
      navigate(`/super-admin/flow-plans/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newPlanName.trim()) return;
    createMutation.mutate(newPlanName);
  };

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-mauve-2">
        <header className="flex items-center justify-between border-b border-mauve-5 bg-card px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Flow Plans
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Collaborative sandboxes to draft and design processes.
            </p>
          </div>
          {!isCreating && (
            <Button onClick={() => setIsCreating(true)} className="gap-2">
              <Plus size={16} /> New Plan
            </Button>
          )}
        </header>

        <main className="flex-1 overflow-auto p-6">
          {isCreating && (
            <form onSubmit={handleCreate} className="mb-6 flex max-w-md items-end gap-3 rounded-2xl bg-card p-5 outline outline-1 -outline-offset-1 outline-mauve-6 shadow-sm">
              <Input
                autoFocus
                label="Plan Name"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="e.g. Q4 Sales Flow Draft"
                className="flex-1"
                required
              />
              <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                Create
              </Button>
            </form>
          )}

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 rounded-2xl bg-mauve-a2 animate-pulse" />
              ))}
            </div>
          ) : plans?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-mauve-4 text-mauve-9">
                <FolderOpen size={32} />
              </div>
              <h2 className="text-lg font-bold text-foreground">No Flow Plans yet</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Create a Sandbox Plan to experiment with new processes without affecting production data.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans?.map(plan => (
                <div
                  key={plan.id}
                  role="button"
                  onClick={() => navigate(`/super-admin/flow-plans/${plan.id}`)}
                  className="group flex cursor-pointer flex-col justify-between rounded-2xl bg-card p-5 outline outline-1 -outline-offset-1 outline-mauve-6 transition-all hover:shadow-md hover:outline-primary"
                >
                  <div>
                    <h3 className="font-bold text-foreground group-hover:text-primary transition-colors">
                      {plan.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last updated {new Date(plan.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
