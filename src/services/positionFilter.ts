// Suodattaa raa'an GPS-paikannussarjan niin, että yksittäiset harhautuneet
// mittaukset (multipath, kylmä kiinnitys, sisätila) eivät saa sijaintimerkkiä
// hyppimään kartalla. Puhdas, testattava funktio - ei riipu Reactista eikä
// selaimen geolocation-APIsta, jotta logiikkaa on helppo testata erikseen.

export interface RawFix {
  lat: number;
  lon: number;
  /** GPS:n ilmoittama tarkkuussäde metreinä. */
  accuracy: number;
  heading: number | null;
  /** Mittauksen aikaleima millisekunteina (pos.timestamp). */
  timestamp: number;
}

export interface FilterState {
  /** Tällä hetkellä näytettävä, hyväksytty sijainti. */
  accepted: RawFix;
  /** Epäilyttävän nopea hyppy, joka odottaa vahvistusta seuraavalta mittaukselta. */
  pending: RawFix | null;
}

const EARTH_RADIUS_M = 6_371_000;

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Kuinka monta kertaa mittausten yhteenlasketun GPS-tarkkuussäteen verran
// pitää liikkua, ennen kuin muutosta pidetään oikeana liikkeenä eikä
// pelkkänä kohinana. 1 = "jos uusi piste mahtuu molempien mittausten
// yhteiseen epävarmuusympyrään, se on sama paikka".
const STATIONARY_FACTOR = 1;
// Lattiataso yhteissäteelle, jos GPS ilmoittaa epärealistisen pienen
// tarkkuuden (esim. 0-1 m) - ettei ihan pienikin kohina rekisteröidy liikkeeksi.
const MIN_STATIONARY_RADIUS_M = 5;
// Uskottavan liikkeen yläraja (m/s), n. 200 km/h - sallii kävelyn, pyöräilyn,
// bussin ja myös junan/metron. Tätä nopeampi hyppy on käytännössä aina
// GPS-heitto, ei oikeaa liikettä.
const MAX_PLAUSIBLE_SPEED_MPS = 55;

function stationaryRadius(a: RawFix, b: RawFix): number {
  return Math.max((a.accuracy + b.accuracy) * STATIONARY_FACTOR, MIN_STATIONARY_RADIUS_M);
}

export function createFilterState(first: RawFix): FilterState {
  return { accepted: first, pending: null };
}

/**
 * Käsittelee yhden uuden raa'an GPS-mittauksen ja palauttaa päivitetyn
 * suodatintilan. `state.accepted` on aina se sijainti, joka pitäisi näyttää
 * kartalla.
 */
export function filterPosition(state: FilterState, candidate: RawFix): FilterState {
  const { accepted, pending } = state;
  const distance = distanceMeters(accepted, candidate);
  const radius = stationaryRadius(accepted, candidate);

  if (distance <= radius) {
    // Kohinaa mittaustarkkuuden sisällä - pysytään paikallaan. Tarkkuus
    // päivittyy parempaan suuntaan (min), jotta ympyrä voi kaventua kun
    // vastaanotto paranee, mutta ei kasva yksittäisestä huonosta lukemasta.
    // Suunta (heading) nollataan, koska se on merkityksetön paikallaan ollessa.
    return {
      accepted: {
        lat: accepted.lat,
        lon: accepted.lon,
        accuracy: Math.min(accepted.accuracy, candidate.accuracy),
        heading: null,
        timestamp: candidate.timestamp,
      },
      pending: null,
    };
  }

  const dtSeconds = Math.max((candidate.timestamp - accepted.timestamp) / 1000, 0.001);
  const impliedSpeed = distance / dtSeconds;

  if (impliedSpeed <= MAX_PLAUSIBLE_SPEED_MPS) {
    // Uskottava liike ajassa ja matkassa - hyväksytään heti.
    return { accepted: candidate, pending: null };
  }

  // Epäuskottavan nopea hyppy - todennäköisesti yksittäinen GPS-heitto.
  // Jos edellinen mittaus oli samanlainen hylätty hyppy JA se osuu lähelle
  // tätä uutta pistettä, kaksi peräkkäistä mittausta ovat samaa mieltä ->
  // hyväksytään (oikea nopea liike, esim. juna), muuten jäädään odottamaan.
  if (pending && distanceMeters(pending, candidate) <= stationaryRadius(pending, candidate)) {
    return { accepted: candidate, pending: null };
  }

  return { accepted, pending: candidate };
}