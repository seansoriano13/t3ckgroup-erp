import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hrSettingsService } from '../../services/hrSettingsService';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/button';
import { Edit2, Plus, Trash2, CheckCircle2, XCircle, ChevronUp, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '../ui/input';

export default function LeaveCategoriesConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['hrLeaveCategories'],
    queryFn: () => hrSettingsService.getLeaveCategories(true),
  });

  const addMutation = useMutation({
    mutationFn: (label) => hrSettingsService.addLeaveCategory(label, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveCategories'] });
      toast.success('Category added successfully');
      setNewLabel('');
    },
    onError: (err) => toast.error('Failed to add category: ' + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }) => hrSettingsService.updateLeaveCategory(id, updates, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveCategories'] });
      toast.success('Category updated successfully');
      setEditingId(null);
    },
    onError: (err) => toast.error('Failed to update category: ' + err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (ordering) => hrSettingsService.reorderLeaveCategories(ordering, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveCategories'] });
      queryClient.invalidateQueries({ queryKey: ['activeLeaveCategories'] });
    },
    onError: (err) => toast.error('Failed to reorder categories: ' + err.message),
  });

  const moveCategory = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const reordered = [...categories];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    reorderMutation.mutate(
      reordered.map((cat, i) => ({ id: cat.id, sort_order: i + 1 }))
    );
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    addMutation.mutate(newLabel.trim());
  };

  const handleSaveEdit = (id) => {
    if (!editLabel.trim()) return;
    updateMutation.mutate({ id, updates: { label: editLabel.trim() } });
  };

  const toggleActive = (id, currentStatus) => {
    updateMutation.mutate({ id, updates: { is_active: !currentStatus } });
  };

  if (isLoading) return <div className="p-4 text-muted-foreground text-sm font-semibold">Loading leave categories...</div>;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 max-w-3xl">
      <div className="mb-6 border-b border-border pb-4">
        <h2 className="text-base font-black text-foreground uppercase tracking-wide">Leave Categories</h2>
        <p className="text-sm text-muted-foreground mt-1 font-medium">Manage the categories available to employees when applying for leaves.</p>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="New category name..."
          className="flex-1"
          disabled={addMutation.isPending}
        />
        <Button type="submit" disabled={!newLabel.trim() || addMutation.isPending} className="shrink-0 rounded-xl font-bold">
          <Plus size={16} /> Add Category
        </Button>
      </form>

      <div className="space-y-2">
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground font-semibold italic p-4 text-center">No categories configured.</p>
        ) : (
          categories.map((cat, index) => (
            <div key={cat.id} className={`flex items-center justify-between p-3 rounded-xl border ${cat.is_active ? 'bg-card border-border' : 'bg-muted/30 border-dashed border-border/50 opacity-75'}`}>
              <div className="flex items-center gap-3 flex-1">
                <div className="flex flex-col -my-1">
                  <button
                    onClick={() => moveCategory(index, -1)}
                    disabled={index === 0 || reorderMutation.isPending}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveCategory(index, 1)}
                    disabled={index === categories.length - 1 || reorderMutation.isPending}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className={`w-2 h-2 rounded-full ${cat.is_active ? 'bg-green-10' : 'bg-muted-foreground'}`} />
                {editingId === cat.id ? (
                  <Input
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="flex-1 h-9"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(cat.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span className={`font-semibold text-sm ${!cat.is_active && 'text-muted-foreground line-through'}`}>{cat.label}</span>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                {editingId === cat.id ? (
                  <>
                    <button onClick={() => handleSaveEdit(cat.id)} className="p-1.5 text-green-11 hover:bg-green-3 rounded-lg transition-colors">
                      <CheckCircle2 size={16} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg transition-colors">
                      <XCircle size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(cat.id);
                        setEditLabel(cat.label);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                      title="Rename Category"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => toggleActive(cat.id, cat.is_active)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${cat.is_active ? 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20' : 'bg-green-3 text-green-11 border-green-6 hover:bg-green-4'}`}
                    >
                      {cat.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
