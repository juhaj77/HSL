import { useEffect, useRef, useState } from 'react';
import { searchRoutes } from '../services/digitransitService';
import type { RouteSuggestion } from '../types';
import './LineSelector.css';

interface LineSelectorProps {
  value: string;
  onSubmit: (line: string) => void;
}

const DEBOUNCE_MS = 300;

export function LineSelector({ value, onSubmit }: LineSelectorProps) {
  const [text, setText] = useState(value);
  const [suggestions, setSuggestions] = useState<RouteSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  // Pidä kenttä synkassa, jos linja vaihtuu ulkoapäin (esim. ?line=550 -parametrista).
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    const query = text.trim();
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      searchRoutes(query)
        .then(setSuggestions)
        .catch(() => setSuggestions([])); // autocomplete-virheet eivät saa häiritä käyttöä
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(debounceRef.current);
  }, [text]);

  function commit(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    setSuggestionsOpen(false);
    onSubmit(trimmed);
  }

  return (
    <form
      className="line-selector"
      onSubmit={(e) => {
        e.preventDefault();
        commit(text);
      }}
    >
      <label htmlFor="line-input" className="line-selector__label">
        Linja
      </label>
      <div className="line-selector__input-wrap">
        <input
          id="line-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="esim. 550, 510, 560, 39"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSuggestionsOpen(true);
          }}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 150)}
        />
        {suggestionsOpen && suggestions.length > 0 && (
          <ul className="line-selector__suggestions">
            {suggestions.map((s) => (
              <li key={s.gtfsId}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(s.shortName)}
                >
                  <span className="line-selector__badge">{s.shortName}</span>
                  <span className="line-selector__longname">{s.longName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" className="line-selector__submit">
        Hae
      </button>
    </form>
  );
}