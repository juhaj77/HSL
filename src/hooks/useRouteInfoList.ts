import { useEffect, useRef, useState } from 'react';
import { findRouteByShortName } from '../services/digitransitService';
import type { RouteInfo } from '../types';

export interface RouteLookupResult {
  query: string;
  routeInfo: RouteInfo | null;
  notFound: boolean;
}

interface UseRouteInfoListResult {
  results: RouteLookupResult[];
  loading: boolean;
  error: string | null;
}

/**
 * Hakee usean linjan tiedot Digitransitista rinnakkain (esim. "Runkolinjat"-tila,
 * jossa näytetään monta linjaa kartalla yhtä aikaa). Käyttäytyy kuten useRouteInfo,
 * mutta kiinteälle listalle linjanumeroita.
 */
export function useRouteInfoList(lineQueries: string[]): UseRouteInfoListResult {
  const [results, setResults] = useState<RouteLookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const key = lineQueries.join(',');

  useEffect(() => {
    if (lineQueries.length === 0) {
      setResults([]);
      setError(null);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);

    Promise.all(
      lineQueries.map(async (query) => {
        const routeInfo = await findRouteByShortName(query);
        return { query, routeInfo, notFound: !routeInfo };
      }),
    )
      .then((data) => {
        if (currentRequest !== requestId.current) return; // vanhentunut pyyntö, ohitetaan
        setResults(data);
      })
      .catch((err: unknown) => {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setError(err instanceof Error ? err.message : 'Linjojen haku epäonnistui.');
      })
      .finally(() => {
        if (currentRequest !== requestId.current) return;
        setLoading(false);
      });
    // key kattaa lineQueries-sisällön; itse taulukko-instanssi vaihtuu joka renderillä.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { results, loading, error };
}