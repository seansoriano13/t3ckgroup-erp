import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UtensilsCrossed } from 'lucide-react';
import { mealBreakService } from '../../services/mealBreakService';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

const LABELS = { lunch: 'Lunch', dinner: 'Dinner', breakfast: 'Breakfast' };
const ORDER = ['breakfast', 'lunch', 'dinner'];

/**
 * HR's Meal Break windows: the hour each meal covers and whether it is taken
 * off a filed leave or overtime window. A meal is taken off only when the
 * filed window fully covers its hour.
 */
export default function MealBreakConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: windows = [], isLoading } = useQuery({
    queryKey: ['mealBreakWindows'],
    queryFn: () => mealBreakService.getWindows(),
  });

  const save = useMutation({
    mutationFn: (win) => mealBreakService.saveWindow(win, user?.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mealBreakWindows'] }),
    onError: (err) => toast.error(err.message || 'Could not save the meal break.'),
  });

  const rows = ORDER.map((key) => windows.find((w) => w.key === key)).filter(Boolean);

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
          <UtensilsCrossed size={14} className="text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Meal Break</h2>
          <p className="text-xs text-muted-foreground">An hour comes off only when a filed window covers the meal hour and the meal is switched on.</p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {isLoading && <li className="px-5 py-4 text-sm text-muted-foreground">Loading…</li>}
        {rows.map((win) => (
          <li key={win.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Switch
              checked={win.enabled}
              onCheckedChange={(enabled) => save.mutate({ ...win, enabled })}
              aria-label={`${LABELS[win.key]} on`}
            />
            <span className="w-24 text-sm font-semibold text-foreground">{LABELS[win.key]}</span>
            <Input
              type="time"
              className="w-32"
              defaultValue={win.start}
              aria-label={`${LABELS[win.key]} starts`}
              onBlur={(e) => e.target.value && e.target.value !== win.start && save.mutate({ ...win, start: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="time"
              className="w-32"
              defaultValue={win.end}
              aria-label={`${LABELS[win.key]} ends`}
              onBlur={(e) => e.target.value && e.target.value !== win.end && save.mutate({ ...win, end: e.target.value })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
