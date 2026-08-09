// Pieni Node.js-välipalvelin HSL:n GTFS-Realtime "Vehicle Positions" -syötteelle.
//
// Miksi tämä tarvitaan:
//  - HSL:n reaaliaikafeedi (https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl)
//    palauttaa binäärimuotoisen Protocol Buffers -viestin, ei JSONia, eikä feedin
//    HTTP-vastauksessa ole taattua CORS-tukea selainkäyttöön.
//  - Palvelin hakee koko syötteen (kaikki HSL:n ajoneuvot), purkaa sen kerran ja
//    palauttaa selaimelle VAIN pyydetyn linjan ajoneuvot pienenä JSON-listana.
//    Näin selain ei koskaan lataa koko HSL:n kalustoa, vaikka päivitys tehdään usein.
//  - Vastaus välimuistoidaan muutamaksi sekunniksi, jotta usea samanaikainen
//    pyyntö (esim. useita selainvälilehtiä) ei kuormita HSL:n julkista syötettä turhaan.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import pkg from 'gtfs-realtime-bindings';

const { transit_realtime: GtfsRt } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Renderissä ajetaan vain tätä yhtä palvelua: se tarjoilee sekä /api-reitit
// että Viten buildaaman staattisen frontendin (dist/), jotta ei tarvita
// erillistä Static Site -palvelua tai CORS-säätöä tuotannossa. Lokaalissa
// kehityksessä dist-kansiota ei ole, jolloin frontend tulee Vite-devpalvelimelta.
const DIST_DIR = path.join(__dirname, '..', 'dist');
const HAS_BUILT_CLIENT = fs.existsSync(path.join(DIST_DIR, 'index.html'));

const FEED_URL = 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl';
const CACHE_MS = 5000; // syöte päivittyy HSL:llä n. sekunnin välein, mutta 5s riittää
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

/** @type {{ feed: any | null, fetchedAt: number, inFlight: Promise<any> | null }} */
const cache = { feed: null, fetchedAt: 0, inFlight: null };

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// HSL:n julkisessa GTFS-RT-syötteessä route_id:t ovat "raakoja" GTFS-tunnisteita
// (esim. "2550"), kun taas Digitransitin GraphQL-rajapinta käyttää feed-etuliitteellä
// varustettuja gtfsId-tunnisteita (esim. "HSL:2550"). Normalisoidaan molemmat samaan
// muotoon vertailua varten, jotta linjan valinta toimii riippumatta muodosta.
function normalizeRouteId(id) {
  if (!id) return '';
  return id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

async function fetchFeed() {
  const now = Date.now();
  if (cache.feed && now - cache.fetchedAt < CACHE_MS) {
    return cache.feed;
  }
  if (cache.inFlight) {
    return cache.inFlight;
  }

  cache.inFlight = (async () => {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'hsl-bussikartta-local-dev/1.0' },
    });
    if (!res.ok) {
      throw new Error(`GTFS-RT-syöte vastasi ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const feed = GtfsRt.FeedMessage.decode(buffer);
    cache.feed = feed;
    cache.fetchedAt = Date.now();
    cache.inFlight = null;
    return feed;
  })();

  try {
    return await cache.inFlight;
  } catch (err) {
    cache.inFlight = null;
    throw err;
  }
}

const app = express();
app.use(cors());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cacheAgeMs: Date.now() - cache.fetchedAt });
});

app.get('/api/vehicles', async (req, res) => {
  const routeIdParam = req.query.routeId;
  if (!routeIdParam || typeof routeIdParam !== 'string') {
    res.status(400).json({ error: 'routeId-parametri puuttuu (esim. ?routeId=HSL:2550)' });
    return;
  }

  const wanted = normalizeRouteId(routeIdParam);

  try {
    const feed = await fetchFeed();
    const vehicles = [];

    for (const entity of feed.entity) {
      const vp = entity.vehicle;
      if (!vp || !vp.position || !vp.trip) continue;

      const rawRouteId = vp.trip.routeId;
      if (!rawRouteId || normalizeRouteId(rawRouteId) !== wanted) continue;

      vehicles.push({
        id: entity.id,
        vehicleId: vp.vehicle?.id ?? entity.id,
        label: vp.vehicle?.label ?? null,
        routeId: rawRouteId,
        directionId: vp.trip.directionId ?? null,
        lat: vp.position.latitude,
        lon: vp.position.longitude,
        bearing: vp.position.bearing ?? null,
        speed: vp.position.speed ?? null,
        timestamp: toNumber(vp.timestamp),
      });
    }

    res.json({
      vehicles,
      feedTimestamp: toNumber(feed.header?.timestamp),
    });
  } catch (err) {
    console.error('[GTFS-RT] Haku epäonnistui:', err);
    res.status(502).json({ error: 'GTFS-RT-syötteen haku tai purku epäonnistui. Yritä hetken kuluttua uudelleen.' });
  }
});

if (HAS_BUILT_CLIENT) {
  app.use(express.static(DIST_DIR));
  // SPA-fallback: kaikki muut kuin /api-pyynnöt palauttavat index.html:n,
  // jotta React Routerin (tässä: URL:n ?line=-parametrin) suora avaaminen toimii.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[server] GTFS-RT-välipalvelin käynnissä: http://localhost:${PORT}`);
  console.log(`[server] Esimerkki: http://localhost:${PORT}/api/vehicles?routeId=HSL:2550`);
  if (HAS_BUILT_CLIENT) {
    console.log(`[server] Tarjoillaan myös buildattua frontendia: ${DIST_DIR}`);
  }
});