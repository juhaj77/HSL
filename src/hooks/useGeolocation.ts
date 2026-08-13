import { useCallback, useEffect, useRef, useState } from 'react';

export interface UserPosition {
  lat: number;
  lon: number;
  /** GPS-tarkkuus metreinä; piirretään kartalle ympyränä pisteen ympärille. */
  accuracy: number;
  /** Kompassisuunta asteina, jos laite sen tarjoaa; muuten null (pelkkä piste, ei nuolta). */
  heading: number | null;
}

interface UseGeolocationResult {
  position: UserPosition | null;
  enabled: boolean;
  error: string | null;
  toggle: () => void;
}

function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Sijaintilupa evätty.';
    case err.POSITION_UNAVAILABLE:
      return 'Sijaintia ei saatu selville.';
    case err.TIMEOUT:
      return 'Sijainnin haku aikakatkaistiin.';
    default:
      return 'Sijainnin haku epäonnistui.';
  }
}

/**
 * Seuraa selaimen omaa sijaintia (navigator.geolocation.watchPosition), kun
 * `enabled` on päällä. Käyttäjän liikkuessa selain kutsuu callbackia
 * uudestaan ja `position` päivittyy - kartalla oleva merkki seuraa siis
 * mukana ilman erillistä pollausta. Seuranta katkaistaan (clearWatch) aina
 * kun `enabled` menee pois päältä tai komponentti puretaan.
 */
export function useGeolocation(): UseGeolocationResult {
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (!('geolocation' in navigator)) {
      setError('Selain ei tue paikannusta.');
      setEnabled(false);
      return;
    }

    setError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading !== null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        });
      },
      (err) => {
        setError(geolocationErrorMessage(err));
        if (err.code === err.PERMISSION_DENIED) setEnabled(false);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setPosition(null);
        setError(null);
      }
      return next;
    });
  }, []);

  return { position, enabled, error, toggle };
}