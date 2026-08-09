import { useEffect, useRef, useState } from 'react';
import { fetchVehiclesForRoute } from '../services/vehicleService';
import type { VehiclePosition } from '../types';

interface UseVehiclePositionsResult {
  vehicles: VehiclePosition[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

const POLL_INTERVAL_MS = 10_000;

/**
 * Pollaa valitun linjan (gtfsId) ajoneuvosijainnit 10 sekunnin välein.
 * Vanha ajoneuvolista korvataan aina kokonaan uudella - React päivittää
 * kartan merkit tehokkaasti niiden avaimen (vehicleId) perusteella, joten
 * kadonneet ajoneuvot poistuvat ja uudet ilmestyvät automaattisesti.
 */
export function useVehiclePositions(routeGtfsId: string | null): UseVehiclePositionsResult {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!routeGtfsId) {
      setVehicles([]);
      setError(null);
      setLastUpdated(null);
      return;
    }

    let cancelled = false;
    const currentRequest = ++requestId.current;

    async function poll() {
      setLoading(true);
      try {
        const data = await fetchVehiclesForRoute(routeGtfsId as string);
        if (cancelled || currentRequest !== requestId.current) return;
        setVehicles(data.vehicles);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (cancelled || currentRequest !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Ajoneuvodatan haku epäonnistui.');
      } finally {
        if (!cancelled && currentRequest === requestId.current) setLoading(false);
      }
    }

    poll(); // hae heti, älä odota ensimmäistä 10s intervallia
    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [routeGtfsId]);

  return { vehicles, loading, error, lastUpdated };
}