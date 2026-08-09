import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineSelector } from './components/LineSelector';
import { MapView, type RouteGroup } from './components/MapView';
import { useRouteInfo } from './hooks/useRouteInfo';
import { useRouteInfoList } from './hooks/useRouteInfoList';
import { useVehiclePositions } from './hooks/useVehiclePositions';
import { useMultiVehiclePositions } from './hooks/useMultiVehiclePositions';
import './App.css';

// "Keskiovilinjat" (bonus): näyttää kartalla yhtä aikaa kaikki linjat, joilla
// saa nousta kyytiin myös keski-/takaovesta (avoin ovi -periaate, ei tarvitse
// näyttää lippua kuljettajalle). Käytännössä tämä tarkoittaa HSL:n
// bussirunkolinjoja sekä raitiovaunuja - alkuperäinen Jokeri-bussilinja 550
// korvautui 2023 pikaraitiolinjalla 15 (Raide-Jokeri), joka on tästä hyvä
// esimerkki myös raidepuolella.
const KESKIOVI_BUS_LINES = ['20', '30', '40', '200', '300', '400', '500', '510', '520', '530', '560', '570', '600'];
const KESKIOVI_TRAM_LINES = ['15'];
const KESKIOVI_LINES = [...KESKIOVI_BUS_LINES, ...KESKIOVI_TRAM_LINES];

// Jokainen linja saa oman värinsä, jotta 14 päällekkäinkin kulkevaa linjaa
// erottuu kartalla toisistaan (ei enää pelkkää bussi/spora-jakoa). 14 sävyä on
// enemmän kuin mitä värillä voi taata täysin luotettavasti erottuvan kaikille
// (myös värisokeille) - siksi hover näyttää aina tarkan linjanumeron tekstinä,
// eikä värillä tarvitse kantaa koko tunnistetta.
const KESKIOVI_LINE_COLORS: Record<string, string> = {
  '20': '#c32222',
  '30': '#c36722',
  '40': '#c3ac22',
  '200': '#95c322',
  '300': '#50c322',
  '400': '#22c339',
  '500': '#22c37e',
  '510': '#22c3c3',
  '520': '#227ec3',
  '530': '#2239c3',
  '560': '#5022c3',
  '570': '#9522c3',
  '600': '#c322ac',
  '15': '#c32267',
};
const KESKIOVI_LINE_FALLBACK_COLOR = '#6b7280';

function keskioviColor(shortName: string): string {
  return KESKIOVI_LINE_COLORS[shortName] ?? KESKIOVI_LINE_FALLBACK_COLOR;
}

function readLineFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('line')?.trim() ?? '';
}

function readKeskioviModeFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('keskiovi') === '1';
}

function App() {
  const [line, setLine] = useState<string>(() => readLineFromUrl());
  const [keskioviMode, setKeskioviMode] = useState<boolean>(() => readKeskioviModeFromUrl());
  const [fitRequestId, setFitRequestId] = useState(0);

  // Yhden linjan tila (oletus).
  const { routeInfo, loading: routeLoading, error: routeError, notFound } = useRouteInfo(keskioviMode ? '' : line);
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    lastUpdated,
  } = useVehiclePositions(keskioviMode ? null : routeInfo?.gtfsId ?? null);

  // "Keskiovilinjat" -tila: kaikki avoimen oven linjat kartalla yhtä aikaa.
  const { results: keskioviResults, loading: keskioviRoutesLoading, error: keskioviRoutesError } = useRouteInfoList(
    keskioviMode ? KESKIOVI_LINES : [],
  );
  const keskioviGtfsIds = useMemo(
    () => keskioviResults.map((r) => r.routeInfo?.gtfsId).filter((id): id is string => Boolean(id)),
    [keskioviResults],
  );
  const {
    vehiclesByRoute: keskioviVehiclesByRoute,
    loading: keskioviVehiclesLoading,
    error: keskioviVehiclesError,
    lastUpdated: keskioviLastUpdated,
  } = useMultiVehiclePositions(keskioviGtfsIds);

  // Pidä URL:n ?line= / ?keskiovi=1 -parametrit synkassa valitun tilan kanssa (jaettava linkki, bonus).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (keskioviMode) {
      url.searchParams.set('keskiovi', '1');
      url.searchParams.delete('line');
    } else {
      url.searchParams.delete('keskiovi');
      if (line) {
        url.searchParams.set('line', line);
      } else {
        url.searchParams.delete('line');
      }
    }
    window.history.replaceState({}, '', url);
  }, [line, keskioviMode]);

  const handleSubmit = useCallback((newLine: string) => {
    setKeskioviMode(false);
    setLine(newLine);
  }, []);

  const handleToggleKeskioviMode = useCallback(() => {
    setKeskioviMode((prev) => !prev);
  }, []);

  const routeGroups: RouteGroup[] = keskioviMode
    ? keskioviResults
        .filter((r): r is typeof r & { routeInfo: NonNullable<typeof r.routeInfo> } => r.routeInfo !== null)
        .map((r) => ({
          key: r.routeInfo.gtfsId,
          shortName: r.routeInfo.shortName,
          directions: r.routeInfo.directions,
          vehicles: keskioviVehiclesByRoute[r.routeInfo.gtfsId] ?? [],
          color: keskioviColor(r.routeInfo.shortName),
        }))
    : routeInfo
      ? [
          {
            key: routeInfo.gtfsId,
            shortName: routeInfo.shortName,
            directions: routeInfo.directions,
            vehicles,
          },
        ]
      : [];

  const totalVehicles = routeGroups.reduce((sum, g) => sum + g.vehicles.length, 0);
  const directionSummary = routeInfo?.directions.map((d) => d.headsign).join(' ↔ ');

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <span className="app__title-emoji" aria-hidden="true">🚌</span>
          <h1>HSL-bussikartta</h1>
        </div>
        <LineSelector value={line} onSubmit={handleSubmit} />
        <button
          type="button"
          className={`app__keskiovi-button${keskioviMode ? ' app__keskiovi-button--active' : ''}`}
          onClick={handleToggleKeskioviMode}
          title={`Näytä kaikki keskiovesta nousun sallivat linjat kartalla yhtä aikaa: ${KESKIOVI_LINES.join(', ')}`}
        >
          {keskioviMode ? '✓ Keskiovilinjat' : 'Keskiovilinjat'}
        </button>
        <button
          type="button"
          className="app__fit-button"
          onClick={() => setFitRequestId((n) => n + 1)}
          disabled={totalVehicles === 0}
          title="Sovita kartta näkyviin ajoneuvoihin"
        >
          Sovita kartta
        </button>
      </header>

      <div className="app__status">
        {keskioviMode && (
          <span>
            <strong>Keskiovilinjat</strong> ({KESKIOVI_BUS_LINES.join(', ')} + spora {KESKIOVI_TRAM_LINES.join(', ')}) ·{' '}
            {(keskioviRoutesLoading || keskioviVehiclesLoading) && totalVehicles === 0
              ? 'haetaan…'
              : `${totalVehicles} ajoneuvoa liikenteessä`}
            {keskioviLastUpdated && ` · päivitetty ${keskioviLastUpdated.toLocaleTimeString('fi-FI')}`}
          </span>
        )}
        {keskioviMode && keskioviRoutesError && <span className="app__status-error">{keskioviRoutesError}</span>}
        {keskioviMode && keskioviVehiclesError && <span className="app__status-error">{keskioviVehiclesError}</span>}

        {!keskioviMode && !line && (
          <span className="app__status-hint">Kirjoita linjan numero yllä, esim. 550, 510, 560 tai 39.</span>
        )}
        {!keskioviMode && line && routeLoading && <span>Haetaan linjan {line} tietoja…</span>}
        {!keskioviMode && line && notFound && !routeLoading && (
          <span className="app__status-error">Linjaa "{line}" ei löytynyt HSL:n verkostosta.</span>
        )}
        {!keskioviMode && routeError && <span className="app__status-error">{routeError}</span>}
        {!keskioviMode && vehiclesError && <span className="app__status-error">{vehiclesError}</span>}
        {!keskioviMode && routeInfo && (
          <span>
            <strong>Linja {routeInfo.shortName}</strong>
            {directionSummary ? ` · ${directionSummary}` : ''} ·{' '}
            {vehiclesLoading && vehicles.length === 0 ? 'haetaan ajoneuvoja…' : `${vehicles.length} ajoneuvoa liikenteessä`}
            {lastUpdated && ` · päivitetty ${lastUpdated.toLocaleTimeString('fi-FI')}`}
          </span>
        )}
      </div>

      <main className="app__map">
        <MapView routeGroups={routeGroups} fitRequestId={fitRequestId} />
      </main>
    </div>
  );
}

export default App;