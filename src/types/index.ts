// Yhden ajosuunnan päätepysäkkitieto (Digitransitin Pattern-tyypistä).
export interface DirectionInfo {
  directionId: number;
  headsign: string;
  /** Reitin ajolinja kartalle piirrettäväksi, [lat, lon]-pisteinä. Tyhjä, jos geometriaa ei saatu. */
  shape: [number, number][];
}

// Linjan staattinen tieto Digitransit GraphQL -rajapinnasta.
export interface RouteInfo {
  gtfsId: string;
  shortName: string;
  longName: string;
  mode: string;
  directions: DirectionInfo[];
}

// Suppea hakutulos linjan autocomplete-listaan.
export interface RouteSuggestion {
  gtfsId: string;
  shortName: string;
  longName: string;
}

// Yhden ajoneuvon reaaliaikainen sijaintitieto, sellaisena kuin
// oma Node-välipalvelin sen GTFS-RT-syötteestä suodattaa ja tarjoaa.
export interface VehiclePosition {
  id: string;
  vehicleId: string;
  label: string | null;
  routeId: string;
  directionId: number | null;
  lat: number;
  lon: number;
  bearing: number | null;
  speed: number | null;
  timestamp: number | null;
}

export interface VehiclesResponse {
  vehicles: VehiclePosition[];
  feedTimestamp: number | null;
}