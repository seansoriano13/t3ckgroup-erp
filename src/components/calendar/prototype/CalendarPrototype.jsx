/**
 * PROTOTYPE — Calendar redesign (branch prototype/calendar-redesign). Throwaway.
 *
 * Three layouts of the Calendar tab on the real /calendar route, switched with
 * `?variant=` and a bar at the bottom (← / → also step). `?sample=0` swaps the
 * sample month for the live calendar_entries() read. "0" is today's Calendar,
 * for comparison. Loaded only on staging and local builds (see the page).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import Calendar from '../Calendar.jsx';
import { parseCalendarParams } from '../calendarNav.js';
import { useCalendarLayers } from '../useCalendarLayers';
import VariantMonthRail from './VariantMonthRail.jsx';
import VariantLedger from './VariantLedger.jsx';
import VariantBoard from './VariantBoard.jsx';
import VariantQuiet from './VariantQuiet.jsx';
import VariantPulse from './VariantPulse.jsx';
import VariantRiver from './VariantRiver.jsx';
import { ProtoDetail } from './protoParts.jsx';

const VARIANTS = [
  { key: 'A', name: 'Month + day rail', Component: VariantMonthRail },
  { key: 'B', name: 'Agenda ledger', Component: VariantLedger },
  { key: 'C', name: 'Who & where board', Component: VariantBoard },
  { key: 'D', name: 'Quiet list (minimal)', Component: VariantQuiet },
  { key: 'E', name: 'Pulse (experimental)', Component: VariantPulse },
  { key: 'F', name: 'Time river (experimental)', Component: VariantRiver },
  { key: '0', name: 'Current Calendar', Component: null },
];

function Switcher({ index, step, sample, setSample }) {
  const current = VARIANTS[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-mauve-12 py-1 pr-3 pl-1 text-mauve-1 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)]">
      <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous layout" className="rounded-full text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1">
        <ChevronLeft size={16} />
      </Button>
      <span className="min-w-48 text-center text-sm font-bold">
        <span className="mr-1.5 font-mono text-mauve-8">{current.key}</span>
        {current.name}
      </span>
      <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next layout" className="rounded-full text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1">
        <ChevronRight size={16} />
      </Button>
      <span className={cn('ml-2 flex items-center gap-2 border-l border-mauve-11 pl-3 text-xs font-semibold', !current.Component && 'opacity-40')}>
        <Switch size="sm" checked={sample} onCheckedChange={setSample} disabled={!current.Component} aria-label="Sample data" />
        Sample data
      </span>
    </div>
  );
}

export default function CalendarPrototype({ onPickSlot, onWithdraw = null }) {
  const { user } = useAuth();
  useMeetingRealtime();
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, VARIANTS.findIndex((v) => v.key === params.get('variant')));
  const variant = VARIANTS[index];
  const sample = params.get('sample') !== '0';
  const { date: anchor } = parseCalendarParams(params);

  const set = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        Object.entries(next).forEach(([k, v]) => out.set(k, v));
        return out;
      },
      { replace: true },
    );
  const step = (dir) => set({ variant: VARIANTS[(index + dir + VARIANTS.length) % VARIANTS.length].key });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable || el?.getAttribute('role') === 'tab') return;
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const [layers, toggleLayer] = useCalendarLayers();
  const [showPending, setShowPending] = useState(false);
  const [selected, setSelected] = useState(null);

  const Component = variant.Component;
  return (
    <div className="pb-20">
      {Component ? (
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
        />
      ) : (
        <Calendar onPickSlot={onPickSlot} />
      )}
      <ProtoDetail entry={selected} onClose={() => setSelected(null)} entries={[]} viewerId={user?.id} onWithdraw={onWithdraw} />
      <Switcher index={index} step={step} sample={sample} setSample={(on) => set({ sample: on ? '1' : '0' })} />
    </div>
  );
}
