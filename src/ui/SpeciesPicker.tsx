import { useMemo, useState } from 'react';
import { searchSpecies } from './search';
import { TypeChip } from './TypeChip';

interface Props {
  onPick: (speciesId: string) => void;
  onCancel: () => void;
}

/** Search-first species chooser. Typing beats scrolling 1194 entries. */
export function SpeciesPicker({ onPick, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSpecies(query, 60), [query]);

  return (
    <div className="card">
      <div className="row">
        <input
          className="grow"
          autoFocus
          placeholder="Search species…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={onCancel}>Cancel</button>
      </div>

      {results.length === 0 ? (
        <p className="empty small">No species matches “{query}”.</p>
      ) : (
        <div className="picker-results">
          {results.map((s) => (
            <button key={s.id} onClick={() => onPick(s.id)}>
              <span className="spread">
                <span>{s.name}</span>
                <span className="types">
                  {s.types.map((t) => (
                    <TypeChip key={t} type={t} />
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
