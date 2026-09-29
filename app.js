/* ==========================================================================
   Regional Route Explorer

   How it works, in short:
   1. A CSV file (eu.csv / us.csv / na.csv) describes borders as graph edges:
        region1, region2, city1, city2, distance_km
   2. GeoJSON files provide the region outlines drawn on the map.
   3. When the user picks two regions, we run
        - BFS      -> route crossing the FEWEST borders (unweighted graph)
        - Dijkstra -> route with the SHORTEST total distance (weighted graph)
      and draw both on the Leaflet map.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Configuration: one entry per selectable map.
   The keys (europe / usa / northAmerica) must match the data-map attributes
   on the buttons in index.html.
   -------------------------------------------------------------------------- */
const MAPS = {
  europe: {
    label: "Europe",
    csvUrl: "eu.csv",                       // graph data (borders + distances)
    geoJsonUrls: ["https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"],
    // Populated places are used to look up accurate city coordinates
    cityGeoJsonUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
    continent: "Europe",                    // keep every GeoJSON country on this continent, even if not in the CSV
    mapBounds: [[34, -12], [72, 45]],       // [[south, west], [north, east]] used by "Fit" and Reset
    center: [54, 15],
    zoom: 4
  },
  usa: {
    label: "USA",
    csvUrl: "us.csv",
    geoJsonUrls: ["https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json"],
    cityGeoJsonUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
    mapBounds: [[24, -126], [50, -66]],
    center: [39.5, -98.35],
    zoom: 4
  },
  northAmerica: {
    label: "US + CA",
    csvUrl: "na.csv",
    // Two files are merged: U.S. states and Canadian provinces/territories
    geoJsonUrls: [
      "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json",
      "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/canada.geojson"
    ],
    cityGeoJsonUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
    mapBounds: [[24, -141], [84, -50]],
    center: [53, -103],
    zoom: 3
  }
};

/* --------------------------------------------------------------------------
   Application state: everything that changes at runtime lives here, which
   makes it easy to reset when the user switches maps.
   -------------------------------------------------------------------------- */
const state = {
  mapId: "europe",            // key of the active map in MAPS
  mapReady: false,            // true once CSV + GeoJSON + markers have all loaded
  graph: new Map(),           // region -> [{ neighbor, neighborCapital, distance }]  (adjacency list)
  capitals: new Map(),        // region -> city/capital name
  capitalCoords: new Map(),   // region -> [lat, lng] of that city (used to draw routes)
  regionCoords: new Map(),    // region -> [lat, lng] centre of its outline
  regionGeometries: new Map(),// region -> GeoJSON geometry (used for point-in-polygon checks)
  geoLayer: null,             // Leaflet layer with the region polygons
  capitalLayer: null,         // Leaflet layer with the city markers
  labelLayer: null,           // Leaflet layer with the text labels
  routeLayer: null,           // Leaflet layer holding the drawn route lines
  markerLayer: null,          // Leaflet layer holding start/finish markers
  countryLayers: new Map(),   // region -> its polygon layer (so we can restyle it on selection)
  startCountry: "",
  finishCountry: "",
  activeEndpoint: "start",    // which endpoint the next map click will set; alternates start/finish
  bfsResult: null,            // { distance, paths: [[...], ...] }
  dijkstraResult: null,       // { distance, path: [...] }
  selectedBfsIndex: 0         // which of the tied BFS routes is currently shown
};

// Short helper for document.getElementById
const $ = (id) => document.getElementById(id);

// Frequently used DOM elements, cached once
const startSelect = $("startSelect");
const finishSelect = $("finishSelect");
const resultsPanel = $("resultsPanel");
const statusTitle = $("statusTitle");
const statusText = $("statusText");
const loading = $("loading");
const dataStatus = $("dataStatus");
const bfsRouteSelector = $("bfsRouteSelector");

/* --------------------------------------------------------------------------
   Leaflet map setup
   -------------------------------------------------------------------------- */
const map = L.map("map", {
  zoomControl: false,     // we add our own zoom control below so we can position it
  minZoom: 3,
  maxZoom: 8,
  preferCanvas: true      // draws vector shapes on a canvas: much faster for many polygons
}).setView(MAPS.europe.center, MAPS.europe.zoom);

// Background tiles from OpenStreetMap ({z}/{x}/{y} are filled in by Leaflet)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

/* ==========================================================================
   Name matching helpers
   The CSV and the GeoJSON files spell region names differently
   (e.g. "Czechia" vs "Czech Republic"), so we normalise before comparing.
   ========================================================================== */

/**
 * Lowercases, trims and strips accents so "Zürich" and "zurich" compare equal.
 * NFD splits "ü" into "u" + a combining mark; the regex then deletes the mark.
 */
function normalize(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Builds a comparison key: normalised, common prefixes removed and
 * everything except letters/digits dropped ("Bosnia & Herz." -> "bosniaherz").
 */
function countryKey(value) {
  return normalize(value)
    .replace(/republic of /g, "")
    .replace(/kingdom of /g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Alternative spellings -> the name used in our CSV. Keys are already run through countryKey().
const COUNTRY_ALIASES = new Map([
  ["czechia", "Czech Republic"],
  ["czechrepublic", "Czech Republic"],
  ["slovakrepublic", "Slovakia"],
  ["theuk", "United Kingdom"],
  ["uk", "United Kingdom"],
  ["greatbritain", "United Kingdom"],
  ["yukonterritory", "Yukon"],
  ["russia", "Russia"],
  ["northmacedonia", "North Macedonia"],
  ["moldova", "Moldova"],
  ["republicofmoldova", "Moldova"],
  ["turkiye", "Turkey"],
  ["turkey", "Turkey"],
  ["bosniaandherzegovina", "Bosnia and Herzegovina"],
  ["bosniaherzegovina", "Bosnia and Herzegovina"]
]);

// Natural Earth also provides stable ISO3 codes. Using them avoids name-matching
// problems for countries such as the United Kingdom, Russia, Belarus, Serbia,
// Montenegro, North Macedonia and Ireland.
const GEO_ISO_TO_COUNTRY = new Map([
  ["AND", "Andorra"],
  ["ARM", "Armenia"],
  ["AUT", "Austria"],
  ["AZE", "Azerbaijan"],
  ["BLR", "Belarus"],
  ["BEL", "Belgium"],
  ["BIH", "Bosnia and Herzegovina"],
  ["BGR", "Bulgaria"],
  ["HRV", "Croatia"],
  ["CZE", "Czech Republic"],
  ["DNK", "Denmark"],
  ["EST", "Estonia"],
  ["FIN", "Finland"],
  ["FRA", "France"],
  ["GEO", "Georgia"],
  ["DEU", "Germany"],
  ["GRC", "Greece"],
  ["HUN", "Hungary"],
  ["IRL", "Ireland"],
  ["ITA", "Italy"],
  ["XKX", "Kosovo"],
  ["LVA", "Latvia"],
  ["LIE", "Liechtenstein"],
  ["LTU", "Lithuania"],
  ["LUX", "Luxembourg"],
  ["MDA", "Moldova"],
  ["MCO", "Monaco"],
  ["MNE", "Montenegro"],
  ["NLD", "Netherlands"],
  ["MKD", "North Macedonia"],
  ["NOR", "Norway"],
  ["POL", "Poland"],
  ["PRT", "Portugal"],
  ["ROU", "Romania"],
  ["RUS", "Russia"],
  ["SMR", "San Marino"],
  ["SRB", "Serbia"],
  ["SVK", "Slovakia"],
  ["SVN", "Slovenia"],
  ["ESP", "Spain"],
  ["SWE", "Sweden"],
  ["CHE", "Switzerland"],
  ["TUR", "Turkey"],
  ["UKR", "Ukraine"],
  ["GBR", "United Kingdom"],
  ["VAT", "Vatican City"]
]);

// Capital coordinates are intentionally local so the map still works if the graph CSV
// only contains capital names. Add/adjust entries here if your CSV contains territories
// or a different spelling.
const CAPITAL_COORDS = {
  "Amsterdam": [52.3676, 4.9041],
  "Andorra la Vella": [42.5063, 1.5218],
  "Athens": [37.9838, 23.7275],
  "Belgrade": [44.7866, 20.4489],
  "Berlin": [52.5200, 13.4050],
  "Bern": [46.9480, 7.4474],
  "Bratislava": [48.1486, 17.1077],
  "Brussels": [50.8503, 4.3517],
  "Bucharest": [44.4268, 26.1025],
  "Budapest": [47.4979, 19.0402],
  "Chisinau": [47.0105, 28.8638],
  "Copenhagen": [55.6761, 12.5683],
  "Dublin": [53.3498, -6.2603],
  "Helsinki": [60.1699, 24.9384],
  "Kyiv": [50.4501, 30.5234],
  "Kiev": [50.4501, 30.5234],
  "Lisbon": [38.7223, -9.1393],
  "Ljubljana": [46.0569, 14.5058],
  "London": [51.5074, -0.1278],
  "Luxembourg": [49.6116, 6.1319],
  "Luxembourg City": [49.6116, 6.1319],
  "Madrid": [40.4168, -3.7038],
  "Minsk": [53.9006, 27.5590],
  "Monaco": [43.7384, 7.4246],
  "Moscow": [55.7558, 37.6173],
  "Nicosia": [35.1856, 33.3823],
  "Oslo": [59.9139, 10.7522],
  "Paris": [48.8566, 2.3522],
  "Podgorica": [42.4304, 19.2594],
  "Prishtina": [42.6629, 21.1655],
  "Prague": [50.0755, 14.4378],
  "Reykjavik": [64.1466, -21.9426],
  "Riga": [56.9496, 24.1052],
  "Rome": [41.9028, 12.4964],
  "San Marino": [43.9424, 12.4578],
  "Sarajevo": [43.8563, 18.4131],
  "Skopje": [41.9973, 21.4280],
  "Sofia": [42.6977, 23.3219],
  "Stockholm": [59.3293, 18.0686],
  "Tallinn": [59.4370, 24.7536],
  "Tirana": [41.3275, 19.8187],
  "Vaduz": [47.1410, 9.5209],
  "Valletta": [35.8989, 14.5146],
  "Vatican City": [41.9029, 12.4534],
  "Vienna": [48.2082, 16.3738],
  "Vilnius": [54.6872, 25.2797],
  "Warsaw": [52.2297, 21.0122],
  "Zagreb": [45.8150, 15.9819]
};

// Manual overrides for city names that exist in several places (e.g. Portland, Maine vs Oregon),
// where the "one match inside the region" lookup would be ambiguous or wrong.
// Key format: "<region>|<city>", both normalised.
const REGION_CITY_COORDS = new Map([
  ["virginia|arlington", [38.87997, -77.10677]],
  ["maine|portland", [43.6591, -70.2568]]
]);

/* ==========================================================================
   Graph construction
   ========================================================================== */

/** Registers a region as a graph node (and remembers its city) if not seen yet. */
function addNode(country, capital) {
  if (!state.graph.has(country)) state.graph.set(country, []);
  if (capital && !state.capitals.has(country)) state.capitals.set(country, capital);
}

/**
 * Adds a directed edge from -> to. Called twice per CSV row (once in each direction)
 * because borders are two-way. The duplicate check protects against CSV rows repeated
 * in both orders.
 */
function addEdge(from, to, capitalTo, distance) {
  const edges = state.graph.get(from) || [];
  const exists = edges.some(e => e.neighbor === to && e.distance === distance);
  if (!exists) edges.push({ neighbor: to, neighborCapital: capitalTo, distance });
  state.graph.set(from, edges);
}

/**
 * Fetches and parses the CSV for the active map and builds the graph.
 * Expected columns: country1, country2, capital1, capital2, distanceKm (header optional).
 * Returns simple stats for the footer.
 */
async function loadCSV() {
  const config = MAPS[state.mapId];
  // cache: "no-store" so edits to the CSV show up immediately while developing
  const response = await fetch(config.csvUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${config.csvUrl} (${response.status})`);
  const text = await response.text();

  // Handles normal CSV plus quoted fields, while remaining dependency-free.
  // A comma inside "double quotes" is part of the value; "" inside quotes is a literal quote.
  const parseCSVLine = (line) => {
    const values = [];
    let value = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';   // escaped quote
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += ch;
      }
    }
    values.push(value.trim());
    return values;
  };

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let loadedEdges = 0;
  let skippedRows = 0;

  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (cols.length < 5) {
      skippedRows++;
      continue;
    }

    const [country1, country2, capital1, capital2, kmRaw] = cols;
    // Strip anything that isn't a digit (e.g. "1,234 km" -> 1234) before parsing
    const km = Number.parseInt(kmRaw.replace(/[^0-9-]/g, ""), 10);

    if (!country1 || !country2 || !Number.isFinite(km)) {
      // Allows a header such as country1,country2,... without special casing.
      if (normalize(country1) !== "country1") skippedRows++;
      continue;
    }

    // Explicitly skip a header row whose distance happened to parse
    if (normalize(country1) === "country1") continue;

    addNode(country1, capital1);
    addNode(country2, capital2);

    // Border graph is bidirectional.
    addEdge(country1, country2, capital2, km);
    addEdge(country2, country1, capital1, km);
    loadedEdges++;
  }

  if (!state.graph.size) {
    throw new Error(`No valid graph rows were found in ${config.csvUrl}.`);
  }

  // Pre-fill coordinates from the built-in capital table; loadCityCoordinates() may refine them later
  for (const [country, capital] of state.capitals) {
    if (CAPITAL_COORDS[capital]) state.capitalCoords.set(country, CAPITAL_COORDS[capital]);
  }

  return { nodes: state.graph.size, edges: loadedEdges, skippedRows };
}

/** Fills both dropdowns with "Region — City", sorted alphabetically. */
function populateSelects() {
  const countries = [...state.graph.keys()].sort((a, b) => a.localeCompare(b));

  const optionHTML = [
    `<option value="">Select a country…</option>`,
    ...countries.map(country => {
      const capital = state.capitals.get(country) || "Capital unavailable";
      return `<option value="${escapeHTML(country)}">${escapeHTML(country)} — ${escapeHTML(capital)}</option>`;
    })
  ].join("");

  startSelect.innerHTML = optionHTML;
  finishSelect.innerHTML = optionHTML;
}

/**
 * Escapes characters that have special meaning in HTML. Any text that comes from
 * a data file and is inserted with innerHTML must go through this, otherwise a
 * malformed/malicious name could inject markup.
 */
function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Updates the status box in the sidebar. */
function setStatus(title, text) {
  statusTitle.textContent = title;
  statusText.textContent = text;
}

/* ==========================================================================
   Endpoint selection & map styling
   ========================================================================== */

/**
 * Sets the start or finish region (from a map click) and syncs the dropdown.
 * After each selection the "active" endpoint flips, so the user can click
 * start, then finish, then start again, and so on.
 */
function selectEndpoint(country, endpoint = state.activeEndpoint) {
  if (!state.graph.has(country)) return;

  if (endpoint === "start") {
    state.startCountry = country;
    startSelect.value = country;
  } else {
    state.finishCountry = country;
    finishSelect.value = country;
  }

  updateEndpointStyles();

  state.activeEndpoint = endpoint === "start" ? "finish" : "start";
  const next = state.activeEndpoint === "start" ? "start" : "finish";
  setStatus(
    `${country} selected`,
    `Next map click will set the ${next} endpoint. You can also use the dropdowns.`
  );
}

/** Re-applies blue (start) / red (finish) / default styling to every region polygon. */
function updateEndpointStyles() {
  for (const [country, layer] of state.countryLayers) {
    const role = country === state.startCountry ? "start" :
                 country === state.finishCountry ? "finish" : "normal";
    layer.setStyle(countryStyle(role));
  }
}

/** Returns the Leaflet path style for a region depending on its role. */
function countryStyle(role = "normal") {
  if (role === "start") {
    return { color: "#2563eb", weight: 2, fillColor: "#2563eb", fillOpacity: .36 };
  }
  if (role === "finish") {
    return { color: "#e34a63", weight: 2, fillColor: "#e34a63", fillOpacity: .36 };
  }
  return { color: "#9aa5b5", weight: 1, fillColor: "#dbe3ed", fillOpacity: .58 };
}

/* ==========================================================================
   GeoJSON (region outlines)
   ========================================================================== */

/** Different GeoJSON sources use different property names for the region name; try each. */
function getGeoCountryName(props) {
  return props.NAME || props.ADMIN || props.NAME_EN || props.name || "";
}

/** Same idea for the 3-letter ISO country code. */
function getGeoISO(props) {
  return props.ISO_A3 || props.ADM0_A3 || props.WB_A3 || "";
}

/**
 * Finds which graph node (CSV region) a GeoJSON feature corresponds to.
 * Order matters: ISO code (most reliable) -> exact normalised name -> alias table.
 * Returns null if the feature isn't part of the loaded graph.
 */
function matchGraphCountry(geoName, props = {}) {
  const iso = getGeoISO(props);
  const isoMatch = GEO_ISO_TO_COUNTRY.get(iso);
  if (isoMatch && state.graph.has(isoMatch)) return isoMatch;

  const direct = [...state.graph.keys()].find(c => countryKey(c) === countryKey(geoName));
  if (direct) return direct;

  const alias = COUNTRY_ALIASES.get(countryKey(geoName));
  if (alias && state.graph.has(alias)) return alias;

  return null;
}

/**
 * Downloads the boundary files, merges them, and draws each region as a clickable polygon.
 * Regions that don't appear in the graph are ignored (except every European country on the
 * Europe map, which is drawn for context but isn't selectable).
 */
async function loadGeoJSON() {
  const config = MAPS[state.mapId];
  // Fetch all boundary files in parallel
  const collections = await Promise.all(config.geoJsonUrls.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${config.label} boundaries (${response.status})`);
    return response.json();
  }));
  // Merge multiple FeatureCollections (needed for US + Canada) into one
  const geojson = {
    type: "FeatureCollection",
    features: collections.flatMap(collection => collection.features || [])
  };

  state.geoLayer = L.geoJSON(geojson, {
    // Keep only features on the target continent or that match a graph node
    filter: feature => {
      const p = feature.properties || {};
      const continent = p.CONTINENT || p.continent;
      return (config.continent && continent === config.continent) ||
        !!matchGraphCountry(getGeoCountryName(p), p);
    },
    style: () => countryStyle(),
    // Runs once per feature: registers layers and wires up hover/click behaviour
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      const geoName = getGeoCountryName(props);
      const country = matchGraphCountry(geoName, props);
      if (!country) return;   // decorative region: no interaction

      state.countryLayers.set(country, layer);
      state.regionCoords.set(country, [layer.getBounds().getCenter().lat, layer.getBounds().getCenter().lng]);
      // Geometry is saved so loadCityCoordinates() can check which polygon a city lies in
      state.regionGeometries.set(country, feature.geometry);

      layer.bindTooltip(escapeHTML(country), {
        sticky: true,          // tooltip follows the cursor
        direction: "center",
        className: "country-label",
        opacity: .9
      });

      layer.on({
        // Highlight on hover, but don't override the start/finish colours
        mouseover: () => {
          if (country !== state.startCountry && country !== state.finishCountry) {
            layer.setStyle({ weight: 2, color: "#5d6a7d", fillOpacity: .72 });
          }
        },
        mouseout: () => {
          const role = country === state.startCountry ? "start" :
                       country === state.finishCountry ? "finish" : "normal";
          layer.setStyle(countryStyle(role));
        },
        click: () => selectEndpoint(country)
      });
    }
  }).addTo(map);

  addCountryLabels(geojson);

  // Developer aid: report graph nodes that have no polygon (usually a name mismatch)
  const mappedCountries = new Set(state.countryLayers.keys());
  const unmappedCountries = [...state.graph.keys()].filter(c => !mappedCountries.has(c));
  if (unmappedCountries.length) {
    console.warn("Countries loaded from CSV but not represented by the map GeoJSON:", unmappedCountries);
  }

  map.fitBounds(config.mapBounds, { padding: [12, 12] });
}

/** Places a permanent text label at the centre of each matched region. */
function addCountryLabels(geojson) {
  state.labelLayer = L.layerGroup().addTo(map);

  for (const feature of geojson.features || []) {
    const country = matchGraphCountry(getGeoCountryName(feature.properties || {}), feature.properties || {});
    if (!country) continue;

    try {
      // A throwaway GeoJSON layer is the easiest way to get the feature's bounding-box centre
      const temp = L.geoJSON(feature);
      const center = temp.getBounds().getCenter();
      L.marker(center, {
        icon: L.divIcon({
          className: "country-label",
          html: escapeHTML(country),
          iconSize: null       // let the label size itself to its text
        }),
        interactive: false     // labels must not block clicks on the region underneath
      }).addTo(state.labelLayer);
    } catch (_) {
      // Malformed geometry: skip this label rather than breaking the whole map
    }
  }
}

/**
 * Improves marker positions using a worldwide list of populated places.
 * Many cities share a name, so for each region we only accept a match if exactly one
 * candidate lies inside that region's polygon. Otherwise we fall back to the manual
 * override table, then to the built-in capital table.
 * Failure here is non-fatal: the app just uses whatever coordinates it already has.
 */
async function loadCityCoordinates() {
  const url = MAPS[state.mapId].cityGeoJsonUrl;
  if (!url) return;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load city locations (${response.status})`);
    const geojson = await response.json();
    // Index: normalised city name -> list of [lng, lat] (GeoJSON order is lng, lat!)
    const citiesByName = new Map();

    for (const feature of geojson.features || []) {
      const name = feature.properties?.name || feature.properties?.NAME || feature.properties?.NAMEASCII;
      const coordinates = feature.geometry?.coordinates;
      if (name && coordinates?.length >= 2) {
        const key = normalize(name);
        const candidates = citiesByName.get(key) || [];
        candidates.push(coordinates);
        citiesByName.set(key, candidates);
      }
    }

    for (const [region, city] of state.capitals) {
      const geometry = state.regionGeometries.get(region);
      const candidates = citiesByName.get(normalize(city)) || [];
      // Keep only candidates physically inside this region
      const inRegion = geometry
        ? candidates.filter(([longitude, latitude]) => pointInGeometry([longitude, latitude], geometry))
        : [];
      const regionCityKey = `${normalize(region)}|${normalize(city)}`;
      const coords = inRegion.length === 1
        // Leaflet expects [lat, lng], so swap the GeoJSON order
        ? [inRegion[0][1], inRegion[0][0]]
        : REGION_CITY_COORDS.get(regionCityKey) || CAPITAL_COORDS[city];

      if (coords) {
        state.capitalCoords.set(region, coords);
      } else {
        console.warn(`No map coordinates found for ${city}, ${region}.`);
      }
    }
  } catch (error) {
    console.warn("City locations unavailable; unresolved markers and route lines will be omitted.", error);
  }
}

/* ---------- Point-in-polygon helpers ---------- */

/**
 * Ray-casting test: casts a horizontal ray from the point and counts how many polygon
 * edges it crosses. An odd count means the point is inside the ring.
 * Points are [x, y] = [longitude, latitude].
 */
function pointInRing(point, ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > point[1]) !== (y2 > point[1]) &&
        point[0] < ((x2 - x1) * (point[1] - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Checks a point against a GeoJSON Polygon or MultiPolygon.
 * In GeoJSON, the first ring is the outer boundary and any further rings are holes,
 * so the point must be inside the outer ring and outside all holes.
 */
function pointInGeometry(point, geometry) {
  if (geometry.type === "Polygon") {
    const [outer, ...holes] = geometry.coordinates;
    return pointInRing(point, outer) && !holes.some(ring => pointInRing(point, ring));
  }

  // MultiPolygon = several separate polygons (islands, exclaves); inside any one counts
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some(polygon => {
      const [outer, ...holes] = polygon;
      return pointInRing(point, outer) && !holes.some(ring => pointInRing(point, ring));
    });
  }

  return false;
}

/** Adds a small dot + tooltip for each city/capital; clicking one selects its region. */
function addCapitalMarkers() {
  state.capitalLayer = L.layerGroup().addTo(map);

  for (const [country, capital] of state.capitals) {
    const coords = state.capitalCoords.get(country);
    if (!coords) continue;   // no known position: skip rather than crash

    const marker = L.marker(coords, {
      icon: L.divIcon({
        className: "",   // empty string removes Leaflet's default white square background
        html: `<div class="capital-marker"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]  // centre the dot on the coordinate
      }),
      zIndexOffset: 200      // keep dots above the polygons
    }).addTo(state.capitalLayer);

    marker.bindTooltip(
      `<strong>${escapeHTML(capital)}</strong><br>${escapeHTML(country)}`,
      { direction: "top", offset: [0, -6], className: "capital-tooltip" }
    );

    marker.on("click", (event) => {
      // Stop the click from also reaching the polygon underneath (which would select twice)
      L.DomEvent.stopPropagation(event);
      selectEndpoint(country);
    });
  }
}

/** Removes old route lines/markers and creates fresh empty layers to draw into. */
function clearRoutes() {
  if (state.routeLayer) state.routeLayer.remove();
  if (state.markerLayer) state.markerLayer.remove();
  state.routeLayer = L.layerGroup().addTo(map);
  state.markerLayer = L.layerGroup().addTo(map);
}

/* ==========================================================================
   Algorithms
   ========================================================================== */

/**
 * Breadth-first search: finds the minimum NUMBER OF BORDERS between two regions.
 * Every edge counts as 1, regardless of kilometres.
 *
 * Unlike a basic BFS that stores one parent per node, this stores ALL parents that
 * reach a node at the shortest depth. That lets us reconstruct every route with the
 * same minimal border count (ties), which the UI lets the user switch between.
 *
 * Returns { distance, paths } or null if the finish isn't reachable.
 */
function bfs(start, finish) {
  const distance = new Map([[start, 0]]);   // region -> number of borders from start
  const parents = new Map();                // region -> all predecessors on shortest paths
  const queue = [start];
  let head = 0;   // moving an index is O(1); Array.shift() would be O(n)

  while (head < queue.length) {
    const current = queue[head++];

    // BFS explores level by level, so once we dequeue the finish every shortest path is known
    if (current === finish) break;

    for (const edge of state.graph.get(current) || []) {
      if (!distance.has(edge.neighbor)) {
        // First time we reach this neighbour
        distance.set(edge.neighbor, distance.get(current) + 1);
        parents.set(edge.neighbor, [current]);
        queue.push(edge.neighbor);
      } else if (distance.get(edge.neighbor) === distance.get(current) + 1) {
        // Reached again at the same depth via a different parent: another equally short route
        const p = parents.get(edge.neighbor) || [];
        if (!p.includes(current)) p.push(current);
        parents.set(edge.neighbor, p);
      }
    }
  }

  if (!distance.has(finish)) return null;

  // Rebuild every shortest path by walking parents backwards from finish to start
  const allPaths = [];
  const path = [];

  function collect(current) {
    path.push(current);
    if (current === start) {
      allPaths.push([...path].reverse());   // path was built finish->start, so reverse it
    } else {
      for (const parent of parents.get(current) || []) {
        collect(parent);
        if (allPaths.length >= 40) break;   // safety cap: tie counts can explode on big graphs
      }
    }
    path.pop();   // backtrack
  }

  collect(finish);
  return { distance: distance.get(finish), paths: allPaths };
}

/**
 * Dijkstra's algorithm: finds the route with the smallest TOTAL DISTANCE (km).
 * Uses a min-heap as the priority queue so the closest unvisited region is always
 * processed next. Returns { distance, path } or null if unreachable.
 */
function dijkstra(start, finish) {
  const distance = new Map();   // best known km from start to each region
  const parent = new Map();     // predecessor on that best route
  const heap = new MinHeap();

  distance.set(start, 0);
  heap.push([0, start]);

  while (!heap.isEmpty()) {
    const [currentDistance, current] = heap.pop();
    // The heap can hold outdated entries for a node (we push again whenever we find a
    // shorter route instead of updating in place). Skip those stale entries.
    if (currentDistance !== distance.get(current)) continue;
    if (current === finish) break;   // shortest route to finish is now final

    for (const edge of state.graph.get(current) || []) {
      const nextDistance = currentDistance + edge.distance;
      // "Relaxation": keep this route if it beats what we knew
      if (!distance.has(edge.neighbor) || nextDistance < distance.get(edge.neighbor)) {
        distance.set(edge.neighbor, nextDistance);
        parent.set(edge.neighbor, current);
        heap.push([nextDistance, edge.neighbor]);
      }
    }
  }

  if (!distance.has(finish)) return null;

  // Walk parents back from finish to start, then reverse into travel order
  const path = [];
  let current = finish;
  while (current !== start) {
    path.push(current);
    current = parent.get(current);
    if (!current) return null;   // broken chain: shouldn't happen, but avoids an infinite loop
  }
  path.push(start);
  path.reverse();

  return { distance: distance.get(finish), path };
}

/**
 * Binary min-heap (priority queue) keyed on item[0].
 * JavaScript has no built-in one; this keeps Dijkstra at O((V+E) log V)
 * instead of O(V²) with a simple array scan.
 * Items look like [priority, value].
 */
class MinHeap {
  constructor() { this.items = []; }
  isEmpty() { return this.items.length === 0; }

  /** Adds an item and "sifts up" until the parent is no larger than it. */
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);   // parent index in the array-backed tree
      if (this.items[p][0] <= item[0]) break;
      this.items[i] = this.items[p];       // move parent down instead of swapping (fewer writes)
      i = p;
    }
    this.items[i] = item;
  }

  /** Removes and returns the smallest item, then "sifts down" the replacement. */
  pop() {
    const root = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return root;   // heap had a single item
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.items.length && this.items[left][0] < this.items[smallest][0]) smallest = left;
      if (right < this.items.length && this.items[right][0] < this.items[smallest][0]) smallest = right;
      if (smallest === i) break;
      this.items[i] = this.items[smallest];
      i = smallest;
    }
    this.items[i] = last;
    return root;
  }
}

/* ==========================================================================
   Drawing routes on the map
   ========================================================================== */

/** Convenience wrapper: the [lat, lng] of a region's city, or null if unknown. */
function capitalCoordsForCountry(country) {
  return state.capitalCoords.get(country) || null;
}

/**
 * Draws a path as a polyline connecting the cities in order.
 * Returns false (and draws nothing) if any city has no coordinates, because a line
 * with missing points would be misleading.
 */
function drawPath(path, color, options = {}) {
  const coords = path
    .map(capitalCoordsForCountry)
    .filter(Boolean);

  if (coords.length !== path.length || coords.length < 2) return false;

  L.polyline(coords, {
    color,
    weight: options.weight || 5,
    opacity: options.opacity ?? .9,
    dashArray: options.dashArray || null,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.routeLayer);

  return true;
}

/**
 * Redraws both routes plus start/finish markers, then zooms to fit them.
 * BFS is drawn first and dashed so that when both routes overlap, the solid green
 * Dijkstra line on top still lets the purple dashes show through.
 */
function drawRoutes(bfsResult = state.bfsResult, dijkstraResult = state.dijkstraResult) {
  clearRoutes();

  const bfsPath = bfsResult?.paths?.[state.selectedBfsIndex];
  if (bfsPath) drawPath(bfsPath, "#7c3aed", { weight: 5, opacity: .82, dashArray: "8 7" });

  if (dijkstraResult?.path) {
    drawPath(dijkstraResult.path, "#0f9d76", { weight: 6, opacity: .94 });
  }

  addRouteMarker(state.startCountry, "start");
  addRouteMarker(state.finishCountry, "finish");

  // Zoom so every point of both routes is visible
  const allCoords = [
    ...(bfsPath || []).map(capitalCoordsForCountry).filter(Boolean),
    ...(dijkstraResult?.path || []).map(capitalCoordsForCountry).filter(Boolean)
  ];

  if (allCoords.length) {
    map.fitBounds(L.latLngBounds(allCoords), { padding: [70, 70], maxZoom: 6 });
  }
}

/** Places the big blue "start" or red "finish" dot on a region's city. */
function addRouteMarker(country, type) {
  const coords = capitalCoordsForCountry(country);
  if (!coords) return;

  const capital = state.capitals.get(country) || country;
  const cls = type === "start" ? "route-start-marker" : "route-finish-marker";

  L.marker(coords, {
    icon: L.divIcon({
      className: "",
      html: `<div class="${cls}"></div>`,
      iconSize: [17, 17],
      iconAnchor: [8.5, 8.5]
    }),
    zIndexOffset: 1000    // always on top of the small capital dots
  }).bindTooltip(
    `<strong>${type === "start" ? "Start" : "Finish"}</strong><br>${escapeHTML(capital)} · ${escapeHTML(country)}`,
    { direction: "top", offset: [0, -8], className: "capital-tooltip" }
  ).addTo(state.markerLayer);
}

/* ==========================================================================
   Sidebar results rendering
   ========================================================================== */

/**
 * Renders a path as the vertical timeline in the sidebar.
 * Long paths are truncated to `max` rows with a "+ N more" note so the panel
 * doesn't grow unreasonably tall.
 */
function renderPath(container, path, max = 12) {
  if (!path || !path.length) {
    container.innerHTML = `<span class="route-note">No route available.</span>`;
    return;
  }

  const shown = path.slice(0, max);
  let html = "";

  shown.forEach((country, index) => {
    const capital = state.capitals.get(country) || "";
    html += `
      <div class="route-node">
        <span class="route-node-dot"></span>
        <span class="route-node-text">
          <span class="route-node-country">${escapeHTML(country)}</span>
          ${capital ? `<span class="route-node-capital">${escapeHTML(capital)}</span>` : ""}
        </span>
        <span class="route-node-index">${index + 1}</span>
      </div>`;
  });

  if (path.length > max) {
    html += `<div class="route-note">+ ${path.length - max} more countries</div>`;
  }

  container.innerHTML = html;
}

/** Fills in the headline numbers, the BFS tie selector and both route lists. */
function renderResults(bfsResult, dijkstraResult) {
  const start = state.startCountry;
  const finish = state.finishCountry;

  $("routeTitle").textContent =
    `${state.capitals.get(start) || start} → ${state.capitals.get(finish) || finish}`;

  // Pluralise "border(s)" correctly
  $("bfsMetric").textContent =
    bfsResult ? `${bfsResult.distance} border${bfsResult.distance === 1 ? "" : "s"}` : "No route";

  $("dijkstraMetric").textContent =
    dijkstraResult ? `${dijkstraResult.distance.toLocaleString()} km` : "No route";

  // Build the dropdown of tied BFS routes; show it only when there is a real choice (2+)
  const bfsPaths = bfsResult?.paths || [];
  bfsRouteSelector.innerHTML = bfsPaths.map((path, index) => {
    const sequence = path.map(escapeHTML).join(" → ");
    return `<option value="${index}">Route ${index + 1}: ${sequence}</option>`;
  }).join("");
  bfsRouteSelector.value = String(state.selectedBfsIndex);
  bfsRouteSelector.hidden = bfsPaths.length < 2;
  $("bfsRouteLabel").hidden = bfsPaths.length < 2;
  $("bfsPathList").innerHTML = "";
  if (!bfsPaths.length) {
    $("bfsPathList").innerHTML = `<span class="path-note">No border route found.</span>`;
  } else {
    renderPath($("bfsPathList"), bfsPaths[state.selectedBfsIndex]);
  }

  renderPath($("dijkstraPathList"), dijkstraResult?.path);

  resultsPanel.classList.remove("hidden");
}

/* ==========================================================================
   Main actions (buttons)
   ========================================================================== */

/** Runs both algorithms for the chosen endpoints and updates the UI and map. */
function calculate() {
  const start = startSelect.value;
  const finish = finishSelect.value;

  if (!start || !finish) {
    setStatus("Choose both endpoints", "Select a starting and finishing country/capital first.");
    return;
  }

  // Special case: same start and finish -> trivial 0-border, 0-km route.
  // Handled separately so we don't run the algorithms for nothing.
  if (start === finish) {
    state.startCountry = start;
    state.finishCountry = finish;
    resultsPanel.classList.remove("hidden");
    $("routeTitle").textContent = `${state.capitals.get(start) || start}`;
    $("bfsMetric").textContent = "0 borders";
    $("dijkstraMetric").textContent = "0 km";
    renderPath($("bfsPathList"), [start]);
    renderPath($("dijkstraPathList"), [start]);
    state.bfsResult = { distance: 0, paths: [[start]] };
    state.dijkstraResult = { distance: 0, path: [start] };
    state.selectedBfsIndex = 0;
    bfsRouteSelector.hidden = true;
    $("bfsRouteLabel").hidden = true;
    clearRoutes();
    addRouteMarker(start, "start");
    addRouteMarker(finish, "finish");
    updateEndpointStyles();
    setStatus("Same endpoint", "Start and finish are the same location.");
    return;
  }

  state.startCountry = start;
  state.finishCountry = finish;
  updateEndpointStyles();

  const bfsResult = bfs(start, finish);
  const dijkstraResult = dijkstra(start, finish);
  state.bfsResult = bfsResult;
  state.dijkstraResult = dijkstraResult;
  state.selectedBfsIndex = 0;   // always show the first tied route for a new search

  // Both null = the two regions are in disconnected parts of the graph (e.g. islands)
  if (!bfsResult && !dijkstraResult) {
    resultsPanel.classList.add("hidden");
    clearRoutes();
    setStatus("No route found", "There is no connected route between the selected countries in the current graph.");
    return;
  }

  renderResults(bfsResult, dijkstraResult);
  drawRoutes(bfsResult, dijkstraResult);

  setStatus(
    "Routes calculated",
    `BFS minimizes the number of borders. Dijkstra minimizes the weighted distance from ${MAPS[state.mapId].csvUrl}.`
  );

  // On small screens the results appear below the fold, so scroll them into view.
  // Short landscape phones scroll the whole window; other narrow layouts scroll the sidebar.
  if (window.matchMedia("(max-width: 900px) and (max-height: 650px)").matches) {
    window.scrollTo({
      top: window.scrollY + resultsPanel.getBoundingClientRect().top,
      behavior: "auto"
    });
  } else if (window.matchMedia("(max-width: 900px)").matches) {
    const sidebar = document.querySelector(".sidebar");
    const resultOffset = resultsPanel.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    sidebar.scrollTop += resultOffset;
  }
}

/** Clears selections, results and route lines, and returns the map to its default view. */
function reset() {
  state.startCountry = "";
  state.finishCountry = "";
  state.activeEndpoint = "start";
  startSelect.value = "";
  finishSelect.value = "";
  resultsPanel.classList.add("hidden");
  state.bfsResult = null;
  state.dijkstraResult = null;
  state.selectedBfsIndex = 0;
  clearRoutes();
  updateEndpointStyles();
  map.fitBounds(MAPS[state.mapId].mapBounds, { padding: [12, 12] });
  setStatus("Ready", "Load the graph, then choose two endpoints.");
}

/* ==========================================================================
   Event listeners
   ========================================================================== */

$("runBtn").addEventListener("click", calculate);

$("resetBtn").addEventListener("click", reset);

// Swap start/finish; re-run immediately only if both are chosen
$("swapBtn").addEventListener("click", () => {
  const a = startSelect.value;
  const b = finishSelect.value;
  startSelect.value = b;
  finishSelect.value = a;
  if (a && b) calculate();
});

// Keep state and map colouring in sync when the user changes a dropdown
startSelect.addEventListener("change", () => {
  if (startSelect.value) {
    state.startCountry = startSelect.value;
    updateEndpointStyles();
  }
});

finishSelect.addEventListener("change", () => {
  if (finishSelect.value) {
    state.finishCountry = finishSelect.value;
    updateEndpointStyles();
  }
});

$("fitBtn").addEventListener("click", () => {
  map.fitBounds(MAPS[state.mapId].mapBounds, { padding: [12, 12] });
});

// Choosing a different tied BFS route only redraws; no need to re-run the algorithm
bfsRouteSelector.addEventListener("change", () => {
  state.selectedBfsIndex = Number(bfsRouteSelector.value);
  if (state.bfsResult?.paths?.[state.selectedBfsIndex]) {
    renderPath($("bfsPathList"), state.bfsResult.paths[state.selectedBfsIndex]);
    drawRoutes();
  }
});

/* ==========================================================================
   Map switching & startup
   ========================================================================== */

/**
 * Switches to another dataset: wipes all state and layers of the old map,
 * then loads CSV -> dropdowns -> boundaries -> city positions -> markers for the new one.
 * Buttons are disabled while loading to prevent overlapping loads.
 */
async function selectMap(mapId) {
  if (mapId === state.mapId && state.mapReady) return;   // already showing this map

  const mapButtons = [...document.querySelectorAll("[data-map]")];
  mapButtons.forEach((button) => { button.disabled = true; });

  // --- Reset all per-map state ---
  state.mapReady = false;
  state.mapId = mapId;
  state.graph.clear();
  state.capitals.clear();
  state.capitalCoords.clear();
  state.regionCoords.clear();
  state.regionGeometries.clear();
  state.countryLayers.clear();
  state.startCountry = "";
  state.finishCountry = "";
  state.activeEndpoint = "start";
  state.bfsResult = null;
  state.dijkstraResult = null;
  state.selectedBfsIndex = 0;
  // Remove old Leaflet layers from the map (each may be null on the first switch)
  for (const layer of [state.geoLayer, state.capitalLayer, state.labelLayer, state.routeLayer, state.markerLayer]) {
    if (layer) layer.remove();
  }
  state.geoLayer = state.capitalLayer = state.labelLayer = state.routeLayer = state.markerLayer = null;

  // --- Reset UI ---
  resultsPanel.classList.add("hidden");
  startSelect.innerHTML = "";
  finishSelect.innerHTML = "";
  loading.style.opacity = "1";
  loading.querySelector("span").textContent = `Loading ${MAPS[mapId].label} map…`;
  $("mapTitle").textContent = MAPS[mapId].label;
  $("fitBtn").textContent = `Fit ${MAPS[mapId].label}`;
  setStatus("Loading map", `Loading the ${MAPS[mapId].label} graph and boundaries.`);

  try {
    // Order matters: the graph must exist before boundaries (they're matched to it),
    // and boundaries must exist before city lookup (it uses their geometry).
    const graphInfo = await loadCSV();
    populateSelects();
    await loadGeoJSON();
    await loadCityCoordinates();
    addCapitalMarkers();
    clearRoutes();
    dataStatus.textContent = `${graphInfo.nodes} regions · ${graphInfo.edges} CSV edges`;
    state.mapReady = true;
    loading.style.opacity = "0";
    setStatus("Ready", `${graphInfo.nodes} regions loaded from ${MAPS[mapId].csvUrl}. Choose endpoints from the dropdowns or map.`);
  } catch (error) {
    console.error(error);
    state.mapReady = false;
    loading.style.opacity = "1";
    loading.querySelector("span").textContent = "Could not load the selected map data.";
    dataStatus.textContent = "Data load error";
    setStatus("Setup required", error.message);
  } finally {
    // Always re-enable the buttons, even if loading failed, so the user can retry
    mapButtons.forEach((button) => { button.disabled = false; });
  }
}

// Map switcher buttons: update aria-pressed (which drives the "selected" CSS) and load the map
document.querySelectorAll("[data-map]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-map]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
    selectMap(button.dataset.map);
  });
});

/**
 * First load: same pipeline as selectMap(), but for the default (Europe) map.
 * Note: the app expects to be served over HTTP (e.g. `npx serve` or VS Code Live Server),
 * because fetch() cannot read eu.csv from a file:// URL.
 */
async function init() {
  const mapButtons = [...document.querySelectorAll("[data-map]")];
  mapButtons.forEach((button) => { button.disabled = true; });

  try {
    const graphInfo = await loadCSV();
    populateSelects();

    await loadGeoJSON();
    await loadCityCoordinates();
    addCapitalMarkers();
    clearRoutes();

    dataStatus.textContent = `${graphInfo.nodes} regions · ${graphInfo.edges} CSV edges`;
    state.mapReady = true;
    loading.style.opacity = "0";

    setStatus(
      "Ready",
      `${graphInfo.nodes} regions loaded from ${MAPS[state.mapId].csvUrl}. Choose endpoints from the dropdowns or click regions/cities directly on the map.`
    );
  } catch (error) {
    console.error(error);
    state.mapReady = false;
    loading.innerHTML = `<span>Could not load the project data.</span>`;
    dataStatus.textContent = "Data load error";
    setStatus("Setup required", error.message);
  } finally {
    mapButtons.forEach((button) => { button.disabled = false; });
  }
}

init();
