import { useEffect, useMemo, useState } from 'react';
import './App.css';
import type { BattleConditions } from './engine/damage';
import { gm } from './engine/gamemaster';
import type { WeatherCondition } from './engine/types';
import { activeProfile, loadStore, saveStore, updateRoster, type ProfileStore } from './storage/profiles';
import { BossPicker, type BossListEntry } from './ui/BossPicker';
import { ProfileBar } from './ui/ProfileBar';
import { Results } from './ui/Results';
import { RosterEditor } from './ui/RosterEditor';
import { ScanTab } from './ui/ScanTab';
import { speciesName } from './ui/format';

type Tab = 'boss' | 'roster' | 'scan' | 'results';

const WEATHER: Array<{ value: WeatherCondition | 'NONE'; label: string }> = [
  { value: 'NONE', label: 'No boost' },
  { value: 'CLEAR', label: 'Sunny / Clear' },
  { value: 'RAINY', label: 'Rain' },
  { value: 'PARTLY_CLOUDY', label: 'Partly cloudy' },
  { value: 'OVERCAST', label: 'Cloudy' },
  { value: 'WINDY', label: 'Windy' },
  { value: 'SNOW', label: 'Snow' },
  { value: 'FOG', label: 'Fog' },
];

export default function App() {
  const [store, setStore] = useState<ProfileStore>(loadStore);
  const [tab, setTab] = useState<Tab>('boss');
  const [boss, setBoss] = useState<BossListEntry | null>(null);
  const [weather, setWeather] = useState<WeatherCondition | 'NONE'>('NONE');
  const [friendship, setFriendship] = useState(0);

  // Persist on every change; there is no explicit save button by design.
  useEffect(() => saveStore(store), [store]);

  const profile = activeProfile(store);
  const conditions = useMemo<BattleConditions>(
    () => ({
      weather: weather === 'NONE' ? undefined : weather,
      friendshipLevel: friendship,
    }),
    [weather, friendship],
  );

  return (
    <div className="app">
      <h1>Raid Planner</h1>
      <p className="small muted" style={{ marginTop: 0 }}>
        {boss ? `${speciesName(boss.speciesId)} · ` : 'No boss selected · '}
        {profile.name} · {profile.roster.length} Pokémon
      </p>

      {tab === 'boss' && (
        <>
          <BossPicker
            selected={boss}
            onSelect={(b) => setBoss(b)}
            onChangeMoves={(b) => setBoss(b)}
          />
          <h2>Conditions</h2>
          <div className="card grid-2">
            <div className="field">
              <label htmlFor="weather">Weather</label>
              <select id="weather" value={weather} onChange={(e) => setWeather(e.target.value as WeatherCondition | 'NONE')}>
                {WEATHER.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="friendship">Friendship</label>
              <select id="friendship" value={friendship} onChange={(e) => setFriendship(Number(e.target.value))}>
                {gm.friendshipAttackMultipliers.map((m, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? 'Not friends' : `Level ${i} (+${Math.round((m - 1) * 100)}%)`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="small muted">
            Friendship only applies when you're raiding alongside a friend — it does
            nothing on a true solo.
          </p>
        </>
      )}

      {tab === 'roster' && (
        <>
          <ProfileBar store={store} onChange={setStore} />
          <RosterEditor
            roster={profile.roster}
            onChange={(roster) => setStore(updateRoster(store, profile.id, roster))}
          />
        </>
      )}

      {tab === 'scan' && (
        <ScanTab
          onImport={(entries) => {
            setStore(updateRoster(store, profile.id, [...profile.roster, ...entries]));
            setTab('roster');
          }}
        />
      )}

      {tab === 'results' && <Results boss={boss} roster={profile.roster} conditions={conditions} />}

      <nav className="tabs">
        {([['boss', 'Boss'], ['roster', 'Roster'], ['scan', 'Scan'], ['results', 'Results']] as const).map(([id, label]) => (
          <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
