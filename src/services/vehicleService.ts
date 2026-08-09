// Hakee valitun linjan reaaliaikaiset ajoneuvosijainnit omalta Node-välipalvelimelta
// (server/index.mjs), joka puolestaan lukee ja suodattaa HSL:n GTFS-RT-syötteen.
// Vite-devpalvelin ohjaa /api-polut automaattisesti osoitteeseen http://localhost:3001
// (ks. vite.config.ts), joten selain kutsuu aina vain omaa originiaan - ei CORS-ongelmia.
import type { VehiclesResponse } from '../types';

class VehicleApiError extends Error {}

export async function fetchVehiclesForRoute(routeGtfsId: string): Promise<VehiclesResponse> {
  const res = await fetch(`/api/vehicles?routeId=${encodeURIComponent(routeGtfsId)}`);

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new VehicleApiError(
      body?.error ??
        `Ajoneuvodatan haku epäonnistui (HTTP ${res.status}). Onko "npm run dev" käynnistänyt myös API-palvelimen?`,
    );
  }

  return (await res.json()) as VehiclesResponse;
}

export { VehicleApiError };