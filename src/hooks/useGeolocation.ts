import { useCallback, useEffect, useRef, useState } from 'react';
import { createFilterState, filterPosition, type FilterState, type RawFix } from '../services/positionFilter';

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
 *
 * Raa'at GPS-mittaukset kulkevat positionFilter.ts:n läpi ennen kuin ne
 * päätyvät `position`-tilaan: puhelin harhailee ajoittain hetkeksi todelliselta
 * sijainniltaan (multipath, kylmä kiinnitys), ja suodatin sekä lukitsee
 * merkin paikoilleen mittausten kohinan sisällä että hylkää yksittäiset
 * epäuskottavan nopeat hypyt kunnes seuraava mittaus vahvistaa ne.
 */
export function useGeolocation(): UseGeolocationResult {
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const filterStateRef = useRef<FilterState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (!('geolocation' in navigator)) {
      setError('Selain ei tue paikannusta.');
      setEnabled(false);
      return;
    }

    setError(null);
    filterStateRef.current = null; // uusi paikannusjakso -> aloitetaan suodatus puhtaalta pöydältä

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        const raw: RawFix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading !== null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          timestamp: pos.timestamp,
        };

        filterStateRef.current = filterStateRef.current
          ? filterPosition(filterStateRef.current, raw)
          : createFilterState(raw);

        const { accepted } = filterStateRef.current;
        setPosition({ lat: accepted.lat, lon: accepted.lon, accuracy: accepted.accuracy, heading: accepted.heading });
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