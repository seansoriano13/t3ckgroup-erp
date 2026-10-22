/**
 * PROTOTYPE — Calendar redesign (branch prototype/calendar-redesign). Throwaway.
 *
 * The Calendar tab with two layouts the viewer switches between: Calendar
 * (month + day rail) and Gantt (rooms and people across weeks). The pick lives
 * in `?layout=` and is remembered per browser. `?sample=0` swaps the sample
 * month for the live calendar_entries() read. Loaded only on staging and local
 * builds (see the page).
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, ChartGantt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import { parseCalendarParams } from '../calendarNav.js';
import { useCalendarLayers } from '../useCalendarLayers';
import VariantMonthRail from './VariantMonthRail.jsx';
import VariantBoard from './VariantBoard.jsx';
import { ProtoDetail } from './protoParts.jsx';

const LAYOUTS = [
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, Component: VariantMonthRail },
  { key: 'gantt', label: 'Gantt', icon: ChartGantt, Component: VariantBoard },
];
const STORAGE_KEY = 'calendar.layout';

function remembered() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function LayoutSwitch({ layout, onChange }) {
  return (
    <div className="flex rounded-xl bg-muted p-1" role="group" aria-label="Layout">
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          variant="ghost"
          aria-pressed={layout === key}
          onClick={() => onChange(key)}
          className={cn('gap-2 rounded-lg px-3.5 font-semibold', layout === key ? 'bg-card text-foreground shadow-sm hover:bg-card' : 'text-muted-foreground')}
        >
          <Icon size={16} />
          {label}
        </Button>
      ))}
    </div>
  );
}

export default function CalendarPrototype({ onPickSlot, onWithdraw = null }) {
  const { user } = useAuth();
  useMeetingRealtime();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('layout');
  const layout = LAYOUTS.find((l) => l.key === fromUrl)?.key ?? LAYOUTS.find((l) => l.key === remembered())?.key ?? 'calendar';
  const sample = params.get('sample') !== '0';
  const { date: anchor } = parseCalendarParams(params);

  const set = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        Object.entries(next).forEach(([k, v]) => out.set(k, v));
        out.delete('variant');
        return out;
      },
      { replace: true },
    );
  const pickLayout = (key) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Not remembered; the link still carries it.
    }
    set({ layout: key });
  };

  const [layers, toggleLayer] = useCalendarLayers();
  const [showPending, setShowPending] = useState(false);
  const [selected, setSelected] = useState(null);
  const { Component } = LAYOUTS.find((l) => l.key === layout);

  return (
    <div className="pb-16">
      <Component
        anchor={anchor}
        go={(date) => set({ date })}
        layers={layers}
        toggleLayer={toggleLayer}
        showPending={showPending}
        setShowPending={setShowPending}
        sample={sample}
        onPickSlot={onPickSlot}
        onOpen={setSelected}
        switcher={<LayoutSwitch layout={layout} onChange={pickLayout} />}
      />
      <ProtoDetail entry={selected} onClose={() => setSelected(null)} entries={[]} viewerId={user?.id} onWithdraw={onWithdraw} />
      <div className="fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-full bg-mauve-12 px-3.5 py-2 text-xs font-semibold text-mauve-1 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)]">
        <span className="text-mauve-8">Prototype</span>
        <Switch size="sm" checked={sample} onCheckedChange={(on) => set({ sample: on ? '1' : '0' })} aria-label="Sample data" />
        Sample data
      </div>
    </div>
  );
}
