// Hakee valitun linjan reaaliaikaiset ajoneuvosijainnit omalta Node-välipalvelimelta
// (server/index.mjs), joka puolestaan lukee ja suodattaa HSL:n GTFS-RT-syötteen.
// Devissä Vite-devpalvelin ohjaa /api-polut automaattisesti osoitteeseen
// http://localhost:3001 (ks. vite.config.ts); tuotannossa (esim. Render)
// sama Node-palvelin tarjoilee sekä /api-reitit että buildatun frontendin
// samasta originista - selain kutsuu siis aina vain omaa originiaan.
import type { VehiclesResponse } from '../types';

class VehicleApiError extends Error {}

// Renderin ilmaistason palvelu voi olla hetken "heräämässä" (cold start):
// tällöin yksittäinen pyyntö saattaa osua alustan reunaproxyyn ennen kuin
// kontti on valmis, ja palauttaa ohimenevän 404:n vaikka sovellus itsessään
// on kunnossa. Yritetään siksi muutama kerta ennen kuin virhe näytetään käyttäjälle.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchVehiclesOnce(routeGtfsId: string): Promise<VehiclesResponse> {
  const res = await fetch(`/api/vehicles?routeId=${encodeURIComponent(routeGtfsId)}`);

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const hint = import.meta.env.DEV ? ' Onko "npm run dev" käynnistänyt myös API-palvelimen?' : '';
    throw new VehicleApiError(body?.error ?? `Ajoneuvodatan haku epäonnistui (HTTP ${res.status}).${hint}`);
  }

  return (await res.json()) as VehiclesResponse;
}

export async function fetchVehiclesForRoute(routeGtfsId: string): Promise<VehiclesResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchVehiclesOnce(routeGtfsId);
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new VehicleApiError('Ajoneuvodatan haku epäonnistui useasta yrityksestä huolimatta.');
}

export { VehicleApiError };
