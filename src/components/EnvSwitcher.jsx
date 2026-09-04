import { useState } from 'react';
import { Database, Server } from 'lucide-react';

export function EnvSwitcher() {
  // Read once, as the initial value. Reading it in an effect instead meant the
  // switch painted "DEV DB" first and corrected itself a frame later, which on
  // a control whose whole job is to say which database you are on is the one
  // thing it must not do.
  // No setter: switching writes the flag and hard-reloads, so this value is
  // read once per page load and never changes under us.
  const [isProdDb] = useState(
    () => localStorage.getItem('t3ckgroup-use-prod-db') === 'true',
  );

  const toggleDb = () => {
    const newValue = !isProdDb;
    localStorage.setItem('t3ckgroup-use-prod-db', String(newValue));
    // Clear auth session so we don't try to use DEV JWT in PROD and vice-versa
    localStorage.removeItem('t3ckgroup-auth-session');
    
    // Hard reload the app so the singleton supabase client gets recreated with the new url
    window.location.reload();
  };

  // A development-only affordance. The guard sits below the hooks rather than
  // above them: hooks must run in the same order on every render, and an early
  // return ahead of them is the one arrangement React does not allow.
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-[999999] flex items-center gap-2 bg-mauve-2 border border-mauve-6 p-2 rounded-xl shadow-lg backdrop-blur-sm opacity-50 hover:opacity-100 transition-opacity">
      <button 
        onClick={toggleDb}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
          isProdDb 
            ? 'bg-red-9 text-white hover:bg-red-10' 
            : 'bg-green-9 text-white hover:bg-green-10'
        }`}
        title={isProdDb ? 'Currently connected to PROD DB. Click to switch to DEV.' : 'Currently connected to DEV DB. Click to switch to PROD.'}
      >
        {isProdDb ? <Server size={14} /> : <Database size={14} />}
        <span>{isProdDb ? 'PROD DB' : 'DEV DB'}</span>
      </button>
    </div>
  );
}
