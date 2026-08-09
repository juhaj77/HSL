import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DirectionInfo, VehiclePosition } from '../types';
import './MapView.css';

// Helsingin seudun oletuskeskitys, kun sovellus avataan ensimmäistä kertaa.
const HELSINKI_CENTER: L.LatLngTuple = [60.1719, 24.9414];
const HELSINKI_ZOOM = 11;

// Eri suunnat eri väreillä. Sama pari kelpaa sekä ajoneuvomerkeille (yhden
// linjan tilassa) että reittiviivoille (aina) - näin saman linjan kaksi
// suuntaa erottuvat toisistaan silloinkin, kun ne kulkevat lähes samaa katua.
// Tuntematon suunta -> harmaa.
const DIRECTION_COLORS: Record<number, string> = {
  0: '#0072ce',
  1: '#e8590c',
};
const UNKNOWN_COLOR = '#6b7280';
const ROUTE_LINE_OPACITY = 0.6;
const ROUTE_LINE_HIGHLIGHT_OPACITY = 0.95;

// Kuinka lähelle (pikseleinä) hiiren pitää osua reittiviivasta, jotta se
// lasketaan hoveratuksi. Sama karttatason liikkeenkuuntelija tarkistaa KAIKKI
// piirretyt reittiviivat, ei vain ylimpänä olevaa - näin päällekkäin kulkevat
// linjat (esim. sama katu, monta runkolinjaa) näkyvät kaikki yhdessä tooltipissä.
const HOVER_TOLERANCE_PX = 6;

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

// Yksi kartalle piirretty reittiviiva-segmentti (yhden linjan yksi suunta)
// hover-tunnistusta ja korostusta varten.
interface RouteLineEntry {
  layer: L.Polyline;
  shortName: string;
  direction: DirectionInfo;
}

// Etsii kaikki reittiviivat, jotka kulkevat hiiren kohdalla (ei vain
// päällimmäistä) laskemalla pikselietäisyyden jokaisen viivan jokaiseen
// segmenttiin kartan nykyisessä zoomissa/panoroinnissa.
function findLineHits(map: L.Map, latlng: L.LatLng, lines: RouteLineEntry[]): RouteLineEntry[] {
  const point = map.latLngToContainerPoint(latlng);
  const hits: RouteLineEntry[] = [];

  for (const entry of lines) {
    const containerPoints = entry.direction.shape.map(([lat, lon]) => map.latLngToContainerPoint([lat, lon]));
    for (let i = 0; i < containerPoints.length - 1; i++) {
      if (L.LineUtil.pointToSegmentDistance(point, containerPoints[i], containerPoints[i + 1]) <= HOVER_TOLERANCE_PX) {
        hits.push(entry);
        break;
      }
    }
  }

  return hits.sort((a, b) => {
    const na = Number(a.shortName);
    const nb = Number(b.shortName);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.shortName.localeCompare(b.shortName);
  });
}

// Korostaa hoveratut viivat (paksumpi, peittävämpi, tuodaan eteen) ja
// palauttaa niiden joukon; edellisen kutsun osumat, jotka eivät enää osu,
// palautetaan normaalityyliin. Vain muuttuneisiin viivoihin kosketaan.
function applyHoverHighlight(previous: Set<L.Polyline>, hits: RouteLineEntry[]): Set<L.Polyline> {
  const next = new Set(hits.map((h) => h.layer));

  for (const layer of previous) {
    if (!next.has(layer)) {
      layer.setStyle({ weight: 4, opacity: ROUTE_LINE_OPACITY });
    }
  }
  for (const layer of next) {
    if (!previous.has(layer)) {
      layer.setStyle({ weight: 6, opacity: ROUTE_LINE_HIGHLIGHT_OPACITY });
      layer.bringToFront();
    }
  }

  return next;
}

function routeTooltipHtml(shortName: string, direction: DirectionInfo): string {
  const headsign = direction.headsign || 'tuntematon';
  return `
    <div class="route-tooltip">
      <div class="route-tooltip__line">Linja ${escapeHtml(shortName)}</div>
      <div>Suunta: ${escapeHtml(headsign)}</div>
    </div>
  `;
}

// Kun useampi linja osuu hoverin alle samaan aikaan, listataan ne kaikki
// yhdessä tooltipissä sen sijaan että näytettäisiin vain ylin/ensimmäinen.
function combinedRouteTooltipHtml(hits: RouteLineEntry[]): string {
  if (hits.length === 1) {
    return routeTooltipHtml(hits[0].shortName, hits[0].direction);
  }

  const items = hits
    .map(
      (h) =>
        `<div class="route-tooltip__item"><strong>Linja ${escapeHtml(h.shortName)}</strong> · ${escapeHtml(h.direction.headsign || 'tuntematon')}</div>`,
    )
    .join('');

  return `
    <div class="route-tooltip">
      <div class="route-tooltip__line">${hits.length} linjaa tässä kohtaa</div>
      ${items}
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
// tilassa) oma erotteleva väri sekä reittiviivalle että ajoneuvomerkeille.
// Yhden linjan tilassa `color` jätetään pois, jolloin sekä reittiviiva että
// ajoneuvot saavat suuntakohtaisen värin (ks. directionColor).
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
  // Kaikki tällä hetkellä piirretyt reittiviivat (metatietoineen) hover-tunnistusta
  // varten, sekä mitkä niistä ovat parhaillaan korostettuina ja jaettu hover-tooltip.
  const routeLinesRef = useRef<RouteLineEntry[]>([]);
  const highlightedLayersRef = useRef<Set<L.Polyline>>(new Set());
  const hoverTooltipRef = useRef<L.Tooltip | null>(null);

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

    // Jaettu tooltip reittiviivojen hoverille. Ei sidota mihinkään yksittäiseen
    // viivaan (bindTooltip näyttäisi vain päällimmäisen), vaan sijoitetaan ja
    // täytetään käsin sen mukaan mitä findLineHits löytää kursorin kohdalta.
    const hoverTooltip = L.tooltip({ direction: 'top', offset: [0, -6] });
    hoverTooltipRef.current = hoverTooltip;

    let rafId: number | null = null;

    function handleMouseMove(e: L.LeafletMouseEvent) {
      if (rafId !== null) return; // pyynnöt niputetaan yhteen per ruudunpäivitys
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const hits = findLineHits(map, e.latlng, routeLinesRef.current);
        highlightedLayersRef.current = applyHoverHighlight(highlightedLayersRef.current, hits);

        if (hits.length === 0) {
          if (map.hasLayer(hoverTooltip)) map.removeLayer(hoverTooltip);
          return;
        }
        hoverTooltip.setLatLng(e.latlng).setContent(combinedRouteTooltipHtml(hits));
        if (!map.hasLayer(hoverTooltip)) hoverTooltip.addTo(map);
      });
    }

    function handleMouseOut() {
      highlightedLayersRef.current = applyHoverHighlight(highlightedLayersRef.current, []);
      if (map.hasLayer(hoverTooltip)) map.removeLayer(hoverTooltip);
    }

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      markersLayerRef.current = null;
      hoverTooltipRef.current = null;
    };
  }, []);

  // Nollataan "on jo sovitettu" -tila, kun näytettävä linjavalikoima vaihtuu
  // (esim. linja 550 -> 39, tai yhden linjan tila -> "Runkolinjat"), jotta
  // uuteen valikoimaan sovitetaan näkymä automaattisesti kerran.
  useEffect(() => {
    hasAutoFittedRef.current = false;
  }, [groupsKey]);

  // Piirretään jokaisen näytettävän linjan reitti (molemmat suunnat) aina,
  // kun linjavalikoima tai sen geometria muuttuu. Yhden linjan tilassa suunnat
  // väritetään eri väreillä (group.color puuttuu); monen linjan tilassa
  // jokainen linja saa oman värinsä (group.color), jotta päällekkäiset linjat
  // erottuvat kartalla toisistaan. Hover näyttää aina tarkan linjan+suunnan
  // tooltipissä riippumatta väristä.
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    if (!routeLayer) return;

    routeLayer.clearLayers();
    // Vanhat viivaviitteet eivät enää päde uudelleenpiirron jälkeen - nollataan
    // korostus ja piilotetaan mahdollisesti auki oleva hover-tooltip.
    highlightedLayersRef.current = new Set();
    const map = mapRef.current;
    const hoverTooltip = hoverTooltipRef.current;
    if (map && hoverTooltip && map.hasLayer(hoverTooltip)) {
      map.removeLayer(hoverTooltip);
    }

    const lines: RouteLineEntry[] = [];
    for (const group of routeGroups) {
      for (const direction of group.directions) {
        if (direction.shape.length < 2) continue;
        const line = L.polyline(direction.shape, {
          // Monen linjan tilassa (group.color asetettu) jokainen linja saa
          // oman värinsä, jotta päällekkäin kulkevat linjat erottuvat
          // toisistaan; yhden linjan tilassa värjätään suunnan mukaan.
          color: group.color ?? directionColor(direction.directionId),
          weight: 4,
          opacity: ROUTE_LINE_OPACITY,
          lineJoin: 'round',
          interactive: false, // hover hoidetaan itse kartan mousemove-kuuntelijalla
        });
        line.addTo(routeLayer);
        lines.push({ layer: line, shortName: group.shortName, direction });
      }
    }
    routeLinesRef.current = lines;
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