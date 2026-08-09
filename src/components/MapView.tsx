import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DirectionInfo, VehiclePosition } from '../types';
import './MapView.css';

// Helsingin seudun oletuskeskitys, kun sovellus avataan ensimmäistä kertaa.
const HELSINKI_CENTER: L.LatLngTuple = [60.1719, 24.9414];
const HELSINKI_ZOOM = 11;

// Eri suunnat eri väreillä (bonusominaisuus). Käytössä vain kun näytetään
// yhtä linjaa kerrallaan (RouteGroup.color puuttuu). Tuntematon suunta -> harmaa.
const DIRECTION_COLORS: Record<number, string> = {
  0: '#0072ce',
  1: '#e8590c',
};
const UNKNOWN_COLOR = '#6b7280';

// Yhden linjan reittiviiva piirretään punaisena, puoliläpinäkyvänä (erottuu
// ajoneuvojen suuntaväreistä, mutta ei peitä karttapohjaa alleen kokonaan).
const ROUTE_LINE_COLOR = '#dc2626';
const ROUTE_LINE_OPACITY = 0.5;

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

function tileLayerConfig(): { url: string; attribution: string } {
  if (MAPTILER_KEY) {
    // Vaihtoehto B: MapTiler Cloud -laatat (vaatii ilmaisen avaimen, ks. README).
    return {
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">MapTiler</a> ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    };
  }
  // Vaihtoehto A (oletus): OpenStreetMap-laatat, ei API-avainta.
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  };
}

function directionColor(directionId: number | null): string {
  if (directionId === null) return UNKNOWN_COLOR;
  return DIRECTION_COLORS[directionId] ?? UNKNOWN_COLOR;
}

function createVehicleIcon(directionId: number | null, bearing: number | null, colorOverride?: string): L.DivIcon {
  const color = colorOverride ?? directionColor(directionId);
  const rotation = bearing ?? 0;
  // Nuoli, joka osoittaa kompassisuuntaan (bearing) - näyttää ajoneuvon liikesuunnan.
  // Jos GPS-syöte ei sisällä bearingia, näytetään pelkkä väripiste ilman nuolta.
  const inner =
    bearing === null
      ? `<div class="vehicle-icon__dot" style="background:${color}"></div>`
      : `<svg class="vehicle-icon__arrow" style="transform: rotate(${rotation}deg)" width="26" height="26" viewBox="0 0 24 24">
           <path d="M12 2 L19 20 L12 16 L5 20 Z" fill="${color}" stroke="white" stroke-width="1.2" />
         </svg>`;

  return L.divIcon({
    className: 'vehicle-icon',
    html: inner,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function formatTimestamp(ts: number | null): string {
  if (ts === null) return 'tuntematon';
  return new Date(ts * 1000).toLocaleTimeString('fi-FI');
}

function tooltipHtml(vehicle: VehiclePosition, shortName: string, directions: DirectionInfo[]): string {
  const direction = directions.find((d) => d.directionId === vehicle.directionId);
  const headsign = direction?.headsign || 'tuntematon';
  const vehicleLabel = vehicle.label ?? vehicle.vehicleId;

  return `
    <div class="vehicle-tooltip">
      <div class="vehicle-tooltip__line">Linja ${escapeHtml(shortName)}</div>
      <div>Määränpää: ${escapeHtml(headsign)}</div>
      <div>Ajoneuvo: ${escapeHtml(vehicleLabel)}</div>
      <div>Päivitetty: ${escapeHtml(formatTimestamp(vehicle.timestamp))}</div>
    </div>
  `;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Yksi kartalla näytettävä linja: sen tiedot, ajoneuvot ja (monen linjan
// tilassa) oma erotteleva väri. Yhden linjan tilassa `color` jätetään pois,
// jolloin käytetään reitille punaista ja ajoneuvoille suuntakohtaisia värejä.
export interface RouteGroup {
  key: string;
  shortName: string;
  directions: DirectionInfo[];
  vehicles: VehiclePosition[];
  color?: string;
}

interface MapViewProps {
  routeGroups: RouteGroup[];
  /** Kasvata tätä lukua pyytääksesi karttaa sovittamaan näkymän kaikkiin ajoneuvoihin. */
  fitRequestId: number;
}

export function MapView({ routeGroups, fitRequestId }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef(false);

  const groupsKey = routeGroups.map((g) => g.key).join(',');
  const allVehicles = routeGroups.flatMap((g) => g.vehicles);

  // Alustetaan Leaflet-kartta kerran komponentin elinkaaren ajaksi.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: HELSINKI_CENTER,
      zoom: HELSINKI_ZOOM,
      scrollWheelZoom: true, // zoomaus hiirellä
      zoomControl: true,
    });

    const { url, attribution } = tileLayerConfig();
    L.tileLayer(url, { attribution, maxZoom: 19, subdomains: 'abc' }).addTo(map);

    // Reittiviiva-kerros lisätään ennen ajoneuvokerrosta, jotta ajoneuvomerkit
    // piirtyvät aina viivan päälle.
    const routeLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    routeLayerRef.current = routeLayer;
    markersLayerRef.current = markersLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  // Nollataan "on jo sovitettu" -tila, kun näytettävä linjavalikoima vaihtuu
  // (esim. linja 550 -> 39, tai yhden linjan tila -> "Runkolinjat"), jotta
  // uuteen valikoimaan sovitetaan näkymä automaattisesti kerran.
  useEffect(() => {
    hasAutoFittedRef.current = false;
  }, [groupsKey]);

  // Piirretään jokaisen näytettävän linjan reitti (molemmat suunnat) aina,
  // kun linjavalikoima tai sen geometria muuttuu.
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    if (!routeLayer) return;

    routeLayer.clearLayers();

    for (const group of routeGroups) {
      for (const direction of group.directions) {
        if (direction.shape.length < 2) continue;
        L.polyline(direction.shape, {
          color: group.color ?? ROUTE_LINE_COLOR,
          weight: 4,
          opacity: ROUTE_LINE_OPACITY,
          lineJoin: 'round',
        }).addTo(routeLayer);
      }
    }
  }, [groupsKey, routeGroups]);

  // Piirretään ajoneuvomerkit aina, kun sijainnit päivittyvät.
  // Vanha kerros tyhjennetään ja korvataan uusilla merkeillä (10s välein).
  useEffect(() => {
    const markersLayer = markersLayerRef.current;
    const map = mapRef.current;
    if (!markersLayer || !map) return;

    markersLayer.clearLayers();

    for (const group of routeGroups) {
      for (const vehicle of group.vehicles) {
        const marker = L.marker([vehicle.lat, vehicle.lon], {
          icon: createVehicleIcon(vehicle.directionId, vehicle.bearing, group.color),
        });
        marker.bindTooltip(tooltipHtml(vehicle, group.shortName, group.directions), {
          direction: 'top',
          offset: [0, -10],
          sticky: true,
        });
        marker.addTo(markersLayer);
      }
    }

    // Sovita näkymä kerran per linjavalikoima: ajoneuvoihin jos niitä on
    // liikenteessä, muuten reittien viivoihin (esim. yöllä ilman kalustoa).
    if (!hasAutoFittedRef.current) {
      const points: L.LatLngTuple[] =
        allVehicles.length > 0
          ? allVehicles.map((v) => [v.lat, v.lon] as L.LatLngTuple)
          : routeGroups.flatMap((g) => g.directions.flatMap((d) => d.shape as L.LatLngTuple[]));
      if (points.length > 0) {
        hasAutoFittedRef.current = true;
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
      }
    }
  }, [groupsKey, routeGroups]);

  // Manuaalinen "Sovita kartta" -pyyntö (bonus): sovita näkymä nykyisiin ajoneuvoihin.
  useEffect(() => {
    if (fitRequestId === 0) return;
    const map = mapRef.current;
    if (!map || allVehicles.length === 0) return;
    const bounds = L.latLngBounds(allVehicles.map((v) => [v.lat, v.lon] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequestId]);

  return <div ref={containerRef} className="map-view" role="application" aria-label="HSL-bussikartta" />;
}