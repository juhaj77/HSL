# HSL-bussikartta

Selainpohjainen reaaliaikainen karttanäkymä yhden HSL-bussilinjan kaikkiin
liikenteessä oleviin ajoneuvoihin, molempiin suuntiin yhtä aikaa. Kirjoita
esim. **550**, **510**, **560** tai **39**, niin kartalle ilmestyvät kaikki
kyseisen linjan bussit ja niiden sijainnit päivittyvät 10 sekunnin välein.

## Teknologiat

- **Frontend:** React + Vite + TypeScript
- **Kartta:** Leaflet + OpenStreetMap-laatat (ei API-avainta)
- **Linjatiedot (numero, suunnat, päätepysäkit):** Digitransit GraphQL -rajapinta
- **Ajoneuvojen GPS-sijainnit:** HSL:n GTFS-Realtime "Vehicle Positions" -syöte,
  jota lukee pieni oma Node.js-välipalvelin (`server/index.mjs`)

## Projektirakenne

```
src/
  components/   LineSelector (linjan haku), MapView (Leaflet-kartta)
  services/     digitransitService (GraphQL), vehicleService (oma /api)
  hooks/        useRouteInfo, useVehiclePositions (10s pollaus)
  types/        yhteiset TypeScript-tyypit
  App.tsx
  main.tsx
server/
  index.mjs     Node-välipalvelin: hakee ja purkaa GTFS-RT-protobufin
```

## 1. Asennus

```bash
npm install
```

Tämä asentaa sekä React-frontendin että pienen Node-välipalvelimen
riippuvuudet (`express`, `cors`, `gtfs-realtime-bindings`) samaan
`package.json`-tiedostoon.

## 2. API-avain: Digitransit (vaaditaan linjahakuun)

HSL:n ajoneuvojen **GPS-sijainnit eivät vaadi mitään avainta** – ne haetaan
suoraan HSL:n julkisesta, avoimesta GTFS-RT-syötteestä. Sen sijaan
**linjan tietojen haku** (linjan numeron vahvistus, ajosuuntien ja
päätepysäkkien nimet) käyttää Digitransitin GraphQL-rajapintaa, joka vaatii
nykyään ilmaisen rekisteröinnin:

1. Mene osoitteeseen **https://portal-api.digitransit.fi/** ja luo ilmainen tili.
2. Vahvista sähköposti / kaksivaiheinen tunnistautuminen.
3. Siirry **"Products"**-välilehdelle ja tilaa (Subscribe) nimenomaan tuote
   **"Routing v2 HSL GTFS GraphQL"** (ei "Routing v1" tai muu Routing v2 -variantti –
   juuri tämä vastaa koodin käyttämää osoitetta `routing/v2/hsl/gtfs/v1`).
4. Avaa **"Profile"**-sivu ja sen **"Subscriptions"**-välilehti. Jokaisen
   tilatun tuotteen kohdalla on Primary/Secondary key piilotettuna – paina
   **"Show"** paljastaaksesi `digitransit-subscription-key`-avaimesi
   (avain ei näy suoraan Products-listauksessa, vaan vasta täällä).
5. Kopioi avain projektin juureen:

```bash
cp .env.example .env
```

ja muokkaa `.env`:

```
VITE_DIGITRANSIT_KEY=liitä_oma_avaimesi_tähän
```

Jos avainta ei ole asetettu, sovellus näyttää linjaa haettaessa selkeän
virheilmoituksen ("Digitransitin linjahaku vaatii ilmaisen API-avaimen...").
Ajoneuvokartta itsessään ei koskaan vaadi maksullista palvelua.

## 3. Käynnistys

```bash
npm run dev
```

Tämä käynnistää **samanaikaisesti**:

- Vite-devpalvelimen osoitteessa `http://localhost:5173` (React-sovellus)
- Node-välipalvelimen osoitteessa `http://localhost:3001` (GTFS-RT-proxy)

Avaa selaimessa **http://localhost:5173**, kirjoita linjan numero (esim.
`550`) ja paina Hae. Voit myös avata suoraan esim.
`http://localhost:5173/?line=550`.

## 4. Mistä reaaliaikainen GPS-data tulee?

1. **HSL:n GTFS-Realtime "Vehicle Positions" -syöte**
   (`https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl`) julkaisee
   *kaikkien* HSL-alueen ajoneuvojen GPS-sijainnit binäärisenä
   Protocol Buffers -viestinä n. sekunnin välein, ilman API-avainta.
2. Oma **Node-välipalvelin** (`server/index.mjs`) hakee tämän koko syötteen,
   purkaa sen `gtfs-realtime-bindings`-kirjastolla ja suodattaa siitä **vain**
   pyydetyn linjan ajoneuvot (`GET /api/vehicles?routeId=HSL:2550`), jotta
   selain ei koskaan käsittele koko HSL:n kalustoa – vain muutamaa
   ajoneuvoa per haettu linja.
3. Vastaus välimuistoidaan palvelimella 5 sekunniksi, jotta useampi
   samanaikainen pyyntö ei kuormita HSL:n julkista syötettä turhaan.
4. **React-frontend pollaa** `/api/vehicles`-endpointtia 10 sekunnin
   välein (`useVehiclePositions`-hook) ja piirtää tuloksen Leaflet-kartalle;
   vanhat merkit korvautuvat uusilla joka päivityksellä.
5. **Digitransitin GraphQL-rajapinta** vastaa vain staattisesta tiedosta:
   mikä linjan `gtfsId` on, montako ajosuuntaa sillä on ja mitkä ovat niiden
   päätepysäkit (headsign) – näitä käytetään tooltipin tekstiin ja
   ajoneuvojen suodattamiseen oikean linjan mukaan.

Ajoneuvon `directionId` (0 tai 1) yhdistää GTFS-RT-sijainnin oikeaan
ajosuuntaan/päätepysäkkiin – tämä on HSL:n omankin dokumentaation
suosittelema tapa tunnistaa reitin suunta, koska sijaintisyötteessä ei ole
mukana `trip_id`:tä.

## 5. CORS-ongelmat ja niiden ratkaisu

- HSL:n GTFS-RT-syöte palauttaa binääridataa eikä sen HTTP-vastauksessa ole
  taattua CORS-tukea selainkäyttöön, joten sitä **ei lueta suoraan
  selaimesta** – tähän on juuri oma Node-välipalvelin, joka hakee syötteen
  palvelimelta palvelimelle (ei selaimen CORS-rajoituksia) ja tarjoaa sen
  eteenpäin omana JSON-rajapintana.
- Devissä `vite.config.ts` sisältää proxy-asetuksen, joka ohjaa kaikki
  `/api/*`-kutsut Vite-devpalvelimelta (`:5173`) suoraan Node-palvelimelle
  (`:3001`). Selaimen näkökulmasta kaikki pyynnöt menevät siis samaan
  originiin – CORS-ongelmaa ei pääse edes syntymään.
- Digitransitin GraphQL-rajapinta sallii suorat selainkutsut (CORS on
  tuettu), joten `digitransitService.ts` kutsuu sitä suoraan selaimesta.

## Vaihtoehto B: MapTiler Cloud -karttalaatat (valinnainen)

Oletuksena kartta käyttää ilmaisia OpenStreetMap-laattoja eikä vaadi mitään
avainta. Jos haluat myöhemmin tyylikkäämmän ulkoasun:

1. Rekisteröidy ilmaiseksi osoitteessa **https://cloud.maptiler.com/**.
2. Luo API-avain ("Keys"-välilehti).
3. Lisää `.env`-tiedostoon:

```
VITE_MAPTILER_KEY=liitä_oma_avaimesi_tähän
```

4. Käynnistä `npm run dev` uudelleen. `MapView.tsx` havaitsee avaimen
   automaattisesti ja vaihtaa laatat MapTiler-tyyliin ("streets-v2");
   ilman avainta käytetään aina OpenStreetMap-laattoja.

## Ominaisuudet

- ✅ Hiirizoomaus ja panorointi, automaattinen keskitys Helsingin seudulle
- ✅ Linjan haku tekstikentästä (myös autocomplete-ehdotukset)
- ✅ Molemmat ajosuunnat kartalla yhtä aikaa, eri väreillä
- ✅ Linjan reitti piirretään kartalle viivana (molemmat suunnat, saman
  värikoodauksen mukaisesti kuin ajoneuvot), Digitransitin pattern-geometrian
  perusteella
- ✅ Tooltip: linjan numero, määränpää, ajoneuvon tunnus, viimeisin aikaleima
- ✅ Päivitys 10 sekunnin välein, vain valitun linjan ajoneuvot ladataan
- ✅ Ajoneuvon kulkusuuntaa näyttävä kääntyvä nuolimerkki (bearing)
- ✅ URL-parametri `?line=550` linkin jakamista varten
- ✅ "Sovita kartta" -nappi + automaattinen kartan sovitus ensimmäisellä
  haulla niin, että kaikki linjan bussit näkyvät ruudulla

## Deployaus Renderiin

Tuotannossa yksi ainoa **Render Web Service** riittää: se buildaa Reactin ja
ajaa sitten Node-palvelimen (`server/index.mjs`), joka tarjoilee sekä
buildatun frontendin (`dist/`) että `/api`-reitit samasta originista - ei
erillistä Static Site -palvelua eikä CORS-säätöä tarvita.

1. Pushaa repo GitHubiin.
2. Render Dashboard → **New** → **Blueprint** → valitse tämä repo. Render
   löytää juuresta `render.yaml`:n automaattisesti (Build: `npm install &&
   npm run build`, Start: `npm run start`).
3. Deployn jälkeen: **Environment**-välilehdellä aseta
   `VITE_DIGITRANSIT_KEY` (pakollinen) ja tarvittaessa `VITE_MAPTILER_KEY`.
   Koska nämä ovat `VITE_`-alkuisia, ne leipoutuvat build-aikana selaimen
   JS-koodiin - Render aja buildin uudelleen (**Manual Deploy**) muutoksen
   jälkeen, jotta se ottaa uudet arvot käyttöön.
4. `PORT`-ympäristömuuttujan Render asettaa itse; palvelin lukee sen jo
   valmiiksi (`server/index.mjs`).

Ilman `render.yaml`:ia palvelun voi perustaa myös käsin (**New → Web
Service**) samoilla build-/start-komennoilla.

## Tunnetut rajoitteet

- HSL:n GTFS-RT-syöte ei sisällä `trip_id`:tä, joten päätepysäkki
  päätellään ajosuunnan (`directionId`) perusteella. Jos linjalla on
  poikkeuksellisen paljon eri reittimuunnelmia samaan suuntaan, tooltipin
  määränpää voi joskus näyttää linjan "pääasiallisen" päätepysäkin.
- Öisin (n. klo 01–05) monilla päiväreiteillä ei ole yhtään aktiivista
  ajoneuvoa – kartta näyttää tällöin oikein tyhjän tuloksen.