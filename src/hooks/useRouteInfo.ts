import { useEffect, useRef, useState } from 'react';
import { findRouteByShortName } from '../services/digitransitService';
import type { RouteInfo } from '../types';

interface UseRouteInfoResult {
  routeInfo: RouteInfo | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
}

/** Hakee linjan (numero, suunnat, päätepysäkit) Digitransitista aina kun `lineQuery` muuttuu. */
export function useRouteInfo(lineQuery: string): UseRouteInfoResult {
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const query = lineQuery.trim();
    if (!query) {
      setRouteInfo(null);
      setError(null);
      setNotFound(false);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    setNotFound(false);

    findRouteByShortName(query)
      .then((result) => {
        if (currentRequest !== requestId.current) return; // vanhentunut pyyntö, ohitetaan
        if (!result) {
          setRouteInfo(null);
          setNotFound(true);
        } else {
          setRouteInfo(result);
          setNotFound(false);
        }
      })
      .catch((err: unknown) => {
        if (currentRequest !== requestId.current) return;
        setRouteInfo(null);
        setError(err instanceof Error ? err.message : 'Linjan haku epäonnistui.');
      })
      .finally(() => {
        if (currentRequest !== requestId.current) return;
        setLoading(false);
      });
  }, [lineQuery]);

  return { routeInfo, loading, error, notFound };
}