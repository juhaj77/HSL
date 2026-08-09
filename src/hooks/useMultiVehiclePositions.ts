import { useEffect, useRef, useState } from 'react';
import { fetchVehiclesForRoute } from '../services/vehicleService';
import type { VehiclePosition } from '../types';

const POLL_INTERVAL_MS = 10_000;

interface UseMultiVehiclePositionsResult {
  vehiclesByRoute: Record<string, VehiclePosition[]>;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

/**
 * Pollaa usean linjan (gtfsId) ajoneuvosijainnit rinnakkain 10 sekunnin välein
 * (esim. "Runkolinjat"-tila). Käyttäytyy kuten useVehiclePositions, mutta
 * kiinteälle listalle gtfsId:itä; palauttaa tulokset avaimena gtfsId.
 */
export function useMultiVehiclePositions(gtfsIds: string[]): UseMultiVehiclePositionsResult {
  const [vehiclesByRoute, setVehiclesByRoute] = useState<Record<string, VehiclePosition[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);
  const key = gtfsIds.join(',');

  useEffect(() => {
    if (gtfsIds.length === 0) {
      setVehiclesByRoute({});
      setError(null);
      setLastUpdated(null);
      return;
    }

    let cancelled = false;
    const currentRequest = ++requestId.current;

    async function poll() {
      setLoading(true);
      try {
        const entries = await Promise.all(
          gtfsIds.map(async (gtfsId) => {
            const data = await fetchVehiclesForRoute(gtfsId);
            return [gtfsId, data.vehicles] as const;
          }),
        );
        if (cancelled || currentRequest !== requestId.current) return;
        setVehiclesByRoute(Object.fromEntries(entries));
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
    // key kattaa gtfsIds-sisällön; itse taulukko-instanssi vaihtuu joka renderillä.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { vehiclesByRoute, loading, error, lastUpdated };
}