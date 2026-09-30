# Route Explorer

An interactive, browser-based map for exploring routes across Europe, the contiguous United States, and the United States plus Canada. Choose two regions to compare a route with the fewest borders against one with the shortest total distance.

## Screenshot
<img width="1920" height="888" alt="image" src="https://github.com/user-attachments/assets/eae324c7-c0ee-45e5-a734-489ff6308697" />

## Link
https://m-sat.github.io/Route-Explorer/

## Features

- Switch between Europe, USA, and US + Canada datasets.
- Select start and finish regions from dropdowns or click regions on the map.
- Compare two graph algorithms:
  - **Breadth-first search (BFS)** finds routes crossing the fewest borders. You can browse alternative routes when there is a tie.
  - **Dijkstra's algorithm** finds the route with the lowest sum of the distances in the graph.
- View region and city markers, highlighted endpoints, route lines, and step-by-step route lists.
- Use the responsive layout on desktop, tablet, and mobile screens.

## Run locally

The app has no build step or package installation. It does need to be served over HTTP because the browser loads the CSV files with `fetch`; opening `index.html` directly as a `file://` URL will not work reliably.

1. Open a terminal in this folder.
2. Start a local server:

   ```sh
   python -m http.server 8000
   ```

   On Windows, `py -m http.server 8000` can be used if the `python` command is unavailable.

3. Open <http://localhost:8000> in a browser.

The map also loads Leaflet from unpkg and map tiles, boundaries, and city data from external services. An internet connection is required for those resources.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and Leaflet/script references. |
| `styles.css` | Layout, visual styles, map overlays, and responsive rules. |
| `app.js` | Dataset loading, map setup, name matching, route algorithms, and UI interactions. |
| `eu.csv` | European region connections and distances. |
| `us.csv` | Contiguous U.S. state connections and distances. |
| `na.csv` | U.S. and Canadian region connections and distances. |
| `generatecsvs.py` | Rebuilds the three CSV datasets from the region coordinates and edge lists in the script. |

## Data and distance model

Each CSV is headerless and contains one connection per row:

```text
region1,region2,city1,city2,distance_km
```

The CSVs list connections in both directions. The app builds a bidirectional graph from those rows. The edge lists determine which regions are connected; they are a simplified model for route exploration, not a complete representation of every border, road, ferry, or travel restriction.

Distances are rounded great-circle distances between the representative city coordinates defined in `generatecsvs.py`, calculated with the Haversine formula. They are not road distances or travel times. Dijkstra's result is shortest according to these graph weights, not necessarily the fastest or most practical real-world trip.

To regenerate the CSVs after changing the coordinates or edge lists, run from this folder:

```sh
python generatecsvs.py
```

This overwrites `eu.csv`, `us.csv`, and `na.csv` in the current folder.

## External map data

The map outlines and city locations are fetched at runtime from these sources:

- [Natural Earth vector data](https://github.com/nvkelso/natural-earth-vector) for European country boundaries and populated places.
- [PublicaMundi US states GeoJSON](https://github.com/PublicaMundi/MappingAPI) for U.S. state boundaries.
- [Click That Hood Canada GeoJSON](https://github.com/codeforgermany/click_that_hood) for Canadian boundaries.
- [OpenStreetMap](https://www.openstreetmap.org/) for map tiles.
- [Leaflet](https://leafletjs.com/) for the interactive map library, loaded from unpkg.
