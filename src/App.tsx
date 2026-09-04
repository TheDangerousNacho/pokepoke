import { useEffect, useMemo, useState } from 'react';
import './App.css';
import type { BattleConditions } from './engine/damage';
import { gm } from './engine/gamemaster';
import type { WeatherCondition } from './engine/types';
import {
  activeProfile, loadStore, removeParty, saveParty, saveStore, updateRoster,
  type ProfileStore,
} from './storage/profiles';
import { BossPicker, type BossListEntry } from './ui/BossPicker';
import { PartyManager } from './ui/PartyManager';
import { ProfileBar } from './ui/ProfileBar';
import { SyncPanel } from './ui/SyncPanel';
import { TabIcon } from './ui/TabIcon';
import { Results } from './ui/Results';
import { RosterEditor } from './ui/RosterEditor';
import { ScanTab } from './ui/ScanTab';
import { Upgrades } from './ui/Upgrades';
import { loadRotation, refreshRotation, type Rotation } from './storage/rotation';
import { bossName, speciesName } from './ui/format';

type Tab = 'boss' | 'roster' | 'scan' | 'results' | 'upgrades';

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
  /**
   * One level of undo for destructive edits.
   *
   * Snapshotting the whole store rather than the deleted item means the same
   * mechanism covers removing a Pokémon, a party and a whole trainer, and it
   * restores them to exactly where they were rather than appending them back
   * at the end.
   */
  const [undo, setUndo] = useState<{ label: string; store: ProfileStore } | null>(null);
  const [tab, setTab] = useState<Tab>('boss');
  const [boss, setBoss] = useState<BossListEntry | null>(null);
  const [rotation, setRotation] = useState<Rotation>(loadRotation);
  const [weather, setWeather] = useState<WeatherCondition | 'NONE'>('NONE');
  const [friendship, setFriendship] = useState(0);

  // Persist on every change; there is no explicit save button by design.
  useEffect(() => saveStore(store), [store]);

  // Let an undo offer lapse rather than lingering forever. Long enough to
  // notice a mistake, short enough not to become furniture.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 12_000);
    return () => clearTimeout(timer);
  }, [undo]);

  /** Applies a change, keeping the previous store so it can be taken back. */
  const undoable = (label: string, next: ProfileStore) => {
    setUndo({ label, store });
    setStore(next);
  };

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
        {boss ? `${bossName(boss)} · ` : 'No boss selected · '}
        {profile.name} · {profile.roster.length} Pokémon
      </p>

      {tab === 'boss' && (
        <>
          <BossPicker
            rotation={rotation}
            onRefresh={async () => setRotation(await refreshRotation())}
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
          <ProfileBar store={store} onChange={setStore} onUndoableChange={undoable} />
          <SyncPanel store={store} onSynced={undoable} />
          <PartyManager
            profile={profile}
            onSave={(party) => setStore(saveParty(store, profile.id, party))}
            onDelete={(partyId) => {
              const party = profile.parties.find((q) => q.id === partyId);
              undoable(`Deleted “${party?.name ?? 'party'}”`, removeParty(store, profile.id, partyId));
            }}
          />
          <RosterEditor
            roster={profile.roster}
            onChange={(roster, removed) => {
              const next = updateRoster(store, profile.id, roster);
              if (removed) undoable(`Removed ${speciesName(removed.speciesId)}`, next);
              else setStore(next);
            }}
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

      {tab === 'results' && (
        <Results
          boss={boss}
          profiles={store.profiles}
          activeProfileId={profile.id}
          conditions={conditions}
        />
      )}

      {tab === 'upgrades' && (
        <Upgrades
          roster={profile.roster}
          rotation={rotation.bosses}
          selectedBoss={boss}
          conditions={conditions}
        />
      )}

      {undo && (
        <div className="undo-bar" role="status">
          <span className="grow">{undo.label}</span>
          <button
            onClick={() => {
              setStore(undo.store);
              setUndo(null);
            }}
          >
            Undo
          </button>
          <button className="ghost" onClick={() => setUndo(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <nav className="tabs">
        {([['boss', 'Boss'], ['roster', 'Roster'], ['scan', 'Scan'], ['results', 'Results'], ['upgrades', 'TMs']] as const).map(([id, label]) => (
          <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>
            <TabIcon name={id} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
