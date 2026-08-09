// Digitransit GraphQL -rajapinnan käyttö linjan, suuntien ja päätepysäkkien
// (headsign) hakuun. Tätä rajapintaa käytetään VAIN staattiseen tietoon
// (mikä linja, montako suuntaa, mitkä ovat niiden nimet) - ei ajoneuvojen
// reaaliaikaisiin sijainteihin, jotka haetaan erikseen GTFS-RT-syötteestä
// oman Node-välipalvelimen kautta (ks. services/vehicleService.ts).
import type { DirectionInfo, RouteInfo, RouteSuggestion } from '../types';

const DIGITRANSIT_URL = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
const API_KEY = import.meta.env.VITE_DIGITRANSIT_KEY as string | undefined;

interface RawCoordinate {
  lat: number | null;
  lon: number | null;
}

interface RawPattern {
  directionId: number | null;
  headsign: string | null;
  geometry: RawCoordinate[] | null;
}

interface RawRoute {
  gtfsId: string;
  shortName: string | null;
  longName: string | null;
  mode: string | null;
  patterns: RawPattern[] | null;
}

class DigitransitApiError extends Error {}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) {
    headers['digitransit-subscription-key'] = API_KEY;
  }

  let res: Response;
  try {
    res = await fetch(DIGITRANSIT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new DigitransitApiError(
      'Digitransit-rajapintaan ei saatu yhteyttä. Tarkista internet-yhteys.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new DigitransitApiError(
      'Digitransitin linjahaku vaatii ilmaisen API-avaimen. Hae avain osoitteesta ' +
        'https://portal-api.digitransit.fi/ ja aseta se .env-tiedostoon (VITE_DIGITRANSIT_KEY). Katso README.',
    );
  }
  if (res.status === 429) {
    throw new DigitransitApiError('Digitransit-rajapinnan pyyntöraja täyttyi hetkellisesti. Yritä hetken kuluttua uudelleen.');
  }
  if (!res.ok) {
    throw new DigitransitApiError(`Digitransit-haku epäonnistui (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new DigitransitApiError(`Digitransit-rajapinnan virhe: ${json.errors[0].message}`);
  }
  if (!json.data) {
    throw new DigitransitApiError('Digitransit-rajapinta ei palauttanut dataa.');
  }
  return json.data;
}

const ROUTE_SEARCH_QUERY = `
  query RouteSearch($name: String) {
    routes(name: $name) {
      gtfsId
      shortName
      longName
      mode
      patterns {
        directionId
        headsign
        geometry {
          lat
          lon
        }
      }
    }
  }
`;

function pickDirections(route: RawRoute): DirectionInfo[] {
  const headsignByDirection = new Map<number, string>();
  const shapeByDirection = new Map<number, [number, number][]>();

  for (const pattern of route.patterns ?? []) {
    if (pattern.directionId === null || pattern.directionId === undefined) continue;
    if (!headsignByDirection.has(pattern.directionId)) {
      headsignByDirection.set(pattern.directionId, pattern.headsign ?? '');
    }

    // Linjalla voi olla useita reittimuunnelmia (pattern) samaan suuntaan;
    // valitaan geometrialtaan pisin, koska se on tyypillisesti pääasiallinen reitti.
    const points: [number, number][] = (pattern.geometry ?? [])
      .filter((c): c is { lat: number; lon: number } => c.lat != null && c.lon != null)
      .map((c) => [c.lat, c.lon]);
    const existing = shapeByDirection.get(pattern.directionId);
    if (points.length > (existing?.length ?? 0)) {
      shapeByDirection.set(pattern.directionId, points);
    }
  }

  return Array.from(headsignByDirection.entries())
    .sort(([a], [b]) => a - b)
    .map(([directionId, headsign]) => ({
      directionId,
      headsign,
      shape: shapeByDirection.get(directionId) ?? [],
    }));
}

/** Hakee ehdotuksia linjan tekstikentän autocompleteen (esim. "55" -> 550, 551, 552...). */
export async function searchRoutes(term: string): Promise<RouteSuggestion[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const data = await graphqlRequest<{ routes: RawRoute[] }>(ROUTE_SEARCH_QUERY, { name: trimmed });
  return data.routes
    .filter((r) => r.mode === 'BUS')
    .slice(0, 12)
    .map((r) => ({
      gtfsId: r.gtfsId,
      shortName: r.shortName ?? '',
      longName: r.longName ?? '',
    }));
}

/** Hakee tarkan linjan tiedot linjanumeron perusteella (esim. "550"). */
export async function findRouteByShortName(shortName: string): Promise<RouteInfo | null> {
  const target = shortName.trim();
  if (!target) return null;

  const data = await graphqlRequest<{ routes: RawRoute[] }>(ROUTE_SEARCH_QUERY, { name: target });
  const targetLower = target.toLowerCase();
  const exactMatches = data.routes.filter((r) => (r.shortName ?? '').toLowerCase() === targetLower);

  const chosen = exactMatches.find((r) => r.mode === 'BUS') ?? exactMatches[0];
  if (!chosen) return null;

  return {
    gtfsId: chosen.gtfsId,
    shortName: chosen.shortName ?? target,
    longName: chosen.longName ?? '',
    mode: chosen.mode ?? 'BUS',
    directions: pickDirections(chosen),
  };
}

export { DigitransitApiError };