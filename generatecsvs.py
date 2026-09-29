#!/usr/bin/env python3
"""Generates europe.csv, usa.csv and usa_canada.csv.

Row format: country1,country2,city1,city2,distance_km
 - country1 sorted ascending, country2 (its neighbours) sorted ascending
 - every pair appears in both directions
 - distance = great-circle (haversine, R = 6371 km) between the city-centre
   coordinates defined below, rounded to whole km
"""
import csv
import math
from pathlib import Path

R = 6371.0088  # mean Earth radius, km


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ----------------------------------------------------------------------------
# EUROPE: country -> (city, lat, lon)   (point chosen = historic/political centre)
# ----------------------------------------------------------------------------
EUROPE = {
    "Albania": ("Tirana", 41.3275, 19.8187),            # Skanderbeg Square
    "Andorra": ("Andorra la Vella", 42.5078, 1.5211),   # Casa de la Vall (parliament)
    "Armenia": ("Yerevan", 40.1776, 44.5126),           # Republic Square
    "Austria": ("Vienna", 48.2082, 16.3738),            # St. Stephen's Cathedral
    "Azerbaijan": ("Baku", 40.3663, 49.8372),           # Maiden Tower / Old City
    "Belarus": ("Minsk", 53.8961, 27.5477),             # Independence Square
    "Belgium": ("Brussels", 50.8467, 4.3525),           # Grand-Place
    "Bosnia and Herzegovina": ("Sarajevo", 43.8598, 18.4313),  # Bascarsija / Sebilj
    "Bulgaria": ("Sofia", 42.6977, 23.3219),            # Largo / St. Nedelya
    "Croatia": ("Zagreb", 45.8131, 15.9772),            # Ban Jelacic Square
    "Czech Republic": ("Prague", 50.0875, 14.4213),     # Old Town Square
    "Denmark": ("Copenhagen", 55.6761, 12.5683),        # City Hall Square
    "Estonia": ("Tallinn", 59.4370, 24.7454),           # Town Hall Square
    "Finland": ("Helsinki", 60.1695, 24.9522),          # Senate Square
    "France": ("Paris", 48.8534, 2.3488),               # Point zero, Notre-Dame
    "Georgia": ("Tbilisi", 41.6934, 44.8015),           # Freedom Square
    "Germany": ("Berlin", 52.5163, 13.3777),            # Brandenburg Gate
    "Greece": ("Athens", 37.9755, 23.7348),             # Syntagma Square
    "Hungary": ("Budapest", 47.4979, 19.0402),          # Deak Ferenc ter
    "Ireland": ("Dublin", 53.3472, -6.2592),            # O'Connell Bridge
    "Italy": ("Rome", 41.8986, 12.4769),                # Pantheon
    "Kosovo": ("Prishtina", 42.6629, 21.1655),          # Mother Teresa Square
    "Latvia": ("Riga", 56.9516, 24.1133),               # Freedom Monument
    "Liechtenstein": ("Vaduz", 47.1410, 9.5215),        # Staedtle
    "Lithuania": ("Vilnius", 54.6858, 25.2879),         # Cathedral Square
    "Luxembourg": ("Luxembourg City", 49.6117, 6.1319), # Place Guillaume II
    "Moldova": ("Chisinau", 47.0245, 28.8323),          # Great National Assembly Sq
    "Monaco": ("Monaco", 43.7311, 7.4198),              # Prince's Palace (Monaco-Ville)
    "Montenegro": ("Podgorica", 42.4413, 19.2626),      # Independence Square
    "Netherlands": ("Amsterdam", 52.3731, 4.8926),      # Dam Square
    "North Macedonia": ("Skopje", 41.9961, 21.4316),    # Macedonia Square
    "Norway": ("Oslo", 59.9130, 10.7387),               # Stortinget / Karl Johans gate
    "Poland": ("Warsaw", 52.2318, 21.0060),             # Palace of Culture (zero point)
    "Portugal": ("Lisbon", 38.7140, -9.1394),           # Rossio
    "Romania": ("Bucharest", 44.4353, 26.1025),         # University Square
    "Russia": ("Moscow", 55.7539, 37.6208),             # Red Square / Kremlin
    "San Marino": ("San Marino", 43.9367, 12.4463),     # Piazza della Liberta
    "Serbia": ("Belgrade", 44.8161, 20.4600),           # Republic Square
    "Slovakia": ("Bratislava", 48.1439, 17.1097),       # Main Square
    "Slovenia": ("Ljubljana", 46.0514, 14.5060),        # Presern Square
    "Spain": ("Madrid", 40.4168, -3.7038),              # Puerta del Sol (km 0)
    "Sweden": ("Stockholm", 59.3325, 18.0645),          # Sergels torg
    "Switzerland": ("Bern", 46.9466, 7.4441),           # Federal Palace
    "Turkey": ("Ankara", 39.9208, 32.8541),             # Kizilay Square
    "Ukraine": ("Kyiv", 50.4501, 30.5234),              # Maidan Nezalezhnosti
    "United Kingdom": ("London", 51.5074, -0.1278),     # Charing Cross
    "Vatican City": ("Vatican City", 41.9022, 12.4539), # St. Peter's Square
}

EUROPE_EDGES = """
Albania-Greece Albania-Kosovo Albania-Montenegro Albania-North Macedonia
Andorra-France Andorra-Spain
Armenia-Azerbaijan Armenia-Georgia Armenia-Turkey
Austria-Czech Republic Austria-Germany Austria-Hungary Austria-Italy Austria-Liechtenstein
Austria-Slovakia Austria-Slovenia Austria-Switzerland
Azerbaijan-Georgia Azerbaijan-Russia Azerbaijan-Turkey
Belarus-Latvia Belarus-Lithuania Belarus-Poland Belarus-Russia Belarus-Ukraine
Belgium-France Belgium-Germany Belgium-Luxembourg Belgium-Netherlands
Bosnia and Herzegovina-Croatia Bosnia and Herzegovina-Montenegro Bosnia and Herzegovina-Serbia
Bulgaria-Greece Bulgaria-North Macedonia Bulgaria-Romania Bulgaria-Serbia Bulgaria-Turkey
Croatia-Hungary Croatia-Montenegro Croatia-Serbia Croatia-Slovenia
Czech Republic-Germany Czech Republic-Poland Czech Republic-Slovakia
Denmark-Germany Denmark-Sweden
Estonia-Latvia Estonia-Russia
Finland-Norway Finland-Russia Finland-Sweden
France-Germany France-Italy France-Luxembourg France-Monaco France-Spain France-Switzerland
France-United Kingdom
Georgia-Russia Georgia-Turkey
Germany-Luxembourg Germany-Netherlands Germany-Poland Germany-Switzerland
Greece-North Macedonia Greece-Turkey
Hungary-Romania Hungary-Serbia Hungary-Slovakia Hungary-Slovenia Hungary-Ukraine
Ireland-United Kingdom
Italy-San Marino Italy-Slovenia Italy-Switzerland Italy-Vatican City
Kosovo-Montenegro Kosovo-North Macedonia Kosovo-Serbia
Latvia-Lithuania Latvia-Russia
Liechtenstein-Switzerland
Lithuania-Poland Lithuania-Russia
Moldova-Romania Moldova-Ukraine
Montenegro-Serbia
North Macedonia-Serbia
Norway-Russia Norway-Sweden
Poland-Russia Poland-Slovakia Poland-Ukraine
Portugal-Spain
Romania-Serbia Romania-Ukraine
Russia-Ukraine
Slovakia-Ukraine
"""

# ----------------------------------------------------------------------------
# USA (contiguous): state -> (city, lat, lon)   (downtown / civic centre)
# ----------------------------------------------------------------------------
US = {
    "Alabama": ("Birmingham", 33.5186, -86.8104),        # City Hall / Linn Park
    "Arizona": ("Phoenix", 33.4484, -112.0740),          # City Hall
    "Arkansas": ("Little Rock", 34.7465, -92.2896),      # Downtown / Riverfront
    "California": ("Los Angeles", 34.0537, -118.2428),   # City Hall
    "Colorado": ("Denver", 39.7392, -104.9903),          # State Capitol
    "Connecticut": ("Hartford", 41.7658, -72.6734),      # Downtown / Bushnell Park
    "Delaware": ("Wilmington", 39.7459, -75.5466),       # Rodney Square
    "Florida": ("Miami", 25.7743, -80.1937),             # Downtown / Government Center
    "Georgia": ("Atlanta", 33.7490, -84.3880),           # City Hall / Five Points area
    "Idaho": ("Boise", 43.6175, -116.1997),              # State Capitol
    "Illinois": ("Chicago", 41.8781, -87.6298),          # The Loop
    "Indiana": ("Indianapolis", 39.7684, -86.1581),      # Monument Circle
    "Iowa": ("Des Moines", 41.5868, -93.6250),           # Downtown
    "Kansas": ("Wichita", 37.6872, -97.3301),            # Downtown
    "Kentucky": ("Louisville", 38.2527, -85.7585),       # Downtown / Waterfront
    "Louisiana": ("New Orleans", 29.9511, -90.0715),     # Jackson Square
    "Maine": ("Portland", 43.6591, -70.2568),            # Old Port / Monument Sq
    "Maryland": ("Baltimore", 39.2904, -76.6122),        # Inner Harbor / downtown
    "Massachusetts": ("Boston", 42.3601, -71.0589),      # Government Center / Faneuil
    "Michigan": ("Detroit", 42.3314, -83.0458),          # Campus Martius
    "Minnesota": ("Minneapolis", 44.9778, -93.2650),     # Downtown / City Hall area
    "Mississippi": ("Jackson", 32.2988, -90.1848),       # State Capitol
    "Missouri": ("St. Louis", 38.6270, -90.1994),        # Gateway Arch
    "Montana": ("Billings", 45.7833, -108.5007),         # Downtown
    "Nebraska": ("Omaha", 41.2565, -95.9345),            # Downtown
    "Nevada": ("Las Vegas", 36.1716, -115.1391),         # Downtown / Fremont St
    "New Hampshire": ("Manchester", 42.9956, -71.4548),  # Downtown / Veterans Park
    "New Jersey": ("Newark", 40.7357, -74.1724),         # City Hall
    "New Mexico": ("Albuquerque", 35.0844, -106.6504),   # Downtown
    "New York": ("New York", 40.7127, -74.0059),         # City Hall
    "North Carolina": ("Charlotte", 35.2271, -80.8431),  # Trade & Tryon (Uptown)
    "North Dakota": ("Fargo", 46.8772, -96.7898),        # Downtown
    "Ohio": ("Columbus", 39.9612, -82.9988),             # Statehouse / downtown
    "Oklahoma": ("Oklahoma City", 35.4676, -97.5164),    # Downtown
    "Oregon": ("Portland", 45.5152, -122.6784),          # Pioneer Courthouse Square
    "Pennsylvania": ("Philadelphia", 39.9524, -75.1636), # City Hall
    "Rhode Island": ("Providence", 41.8240, -71.4128),   # Downtown / Kennedy Plaza
    "South Carolina": ("Greenville", 34.8526, -82.3940), # Main St / Falls Park
    "South Dakota": ("Sioux Falls", 43.5446, -96.7311),  # Downtown
    "Tennessee": ("Nashville", 36.1627, -86.7816),       # Public Square / Capitol area
    "Texas": ("Dallas", 32.7767, -96.7970),              # City Hall / downtown
    "Utah": ("Salt Lake City", 40.7608, -111.8910),      # Temple Square
    "Vermont": ("Burlington", 44.4759, -73.2121),        # Church Street
    "Virginia": ("Virginia Beach", 36.8529, -75.9780),   # Oceanfront (15th St)
    "Washington": ("Seattle", 47.6062, -122.3321),       # Downtown / Pioneer Sq
    "West Virginia": ("Charleston", 38.3498, -81.6326),  # Downtown
    "Wisconsin": ("Milwaukee", 43.0389, -87.9065),       # Downtown / City Hall
    "Wyoming": ("Cheyenne", 41.1400, -104.8202),         # Downtown / Capitol area
}

US_EDGES = """
Alabama-Florida Alabama-Georgia Alabama-Mississippi Alabama-Tennessee
Arizona-California Arizona-Colorado Arizona-Nevada Arizona-New Mexico Arizona-Utah
Arkansas-Louisiana Arkansas-Mississippi Arkansas-Missouri Arkansas-Oklahoma Arkansas-Tennessee Arkansas-Texas
California-Nevada California-Oregon
Colorado-Kansas Colorado-Nebraska Colorado-New Mexico Colorado-Oklahoma Colorado-Utah Colorado-Wyoming
Connecticut-Massachusetts Connecticut-New York Connecticut-Rhode Island
Delaware-Maryland Delaware-New Jersey Delaware-Pennsylvania
Florida-Georgia
Georgia-North Carolina Georgia-South Carolina Georgia-Tennessee
Idaho-Montana Idaho-Nevada Idaho-Oregon Idaho-Utah Idaho-Washington Idaho-Wyoming
Illinois-Indiana Illinois-Iowa Illinois-Kentucky Illinois-Missouri Illinois-Wisconsin
Indiana-Kentucky Indiana-Michigan Indiana-Ohio
Iowa-Minnesota Iowa-Missouri Iowa-Nebraska Iowa-South Dakota Iowa-Wisconsin
Kansas-Missouri Kansas-Nebraska Kansas-Oklahoma
Kentucky-Missouri Kentucky-Ohio Kentucky-Tennessee Kentucky-Virginia Kentucky-West Virginia
Louisiana-Mississippi Louisiana-Texas
Maine-New Hampshire
Maryland-Pennsylvania Maryland-Virginia Maryland-West Virginia
Massachusetts-New Hampshire Massachusetts-New York Massachusetts-Rhode Island Massachusetts-Vermont
Michigan-Ohio Michigan-Wisconsin
Minnesota-North Dakota Minnesota-South Dakota Minnesota-Wisconsin
Mississippi-Tennessee
Missouri-Nebraska Missouri-Oklahoma Missouri-Tennessee
Montana-North Dakota Montana-South Dakota Montana-Wyoming
Nebraska-South Dakota Nebraska-Wyoming
Nevada-Oregon Nevada-Utah
New Hampshire-Vermont
New Jersey-New York New Jersey-Pennsylvania
New Mexico-Oklahoma New Mexico-Texas New Mexico-Utah
New York-Pennsylvania New York-Vermont
North Carolina-South Carolina North Carolina-Tennessee North Carolina-Virginia
North Dakota-South Dakota
Ohio-Pennsylvania Ohio-West Virginia
Oklahoma-Texas
Oregon-Washington
Pennsylvania-West Virginia
South Dakota-Wyoming
Tennessee-Virginia
Utah-Wyoming
Virginia-West Virginia
"""

# ----------------------------------------------------------------------------
# CANADA (+ Alaska) additions
# ----------------------------------------------------------------------------
CANADA = {
    "Alaska": ("Anchorage", 61.2181, -149.9003),               # Downtown (4th Ave)
    "Alberta": ("Calgary", 51.0447, -114.0719),                # Downtown / City Hall
    "British Columbia": ("Vancouver", 49.2827, -123.1207),     # Downtown / Waterfront
    "Manitoba": ("Winnipeg", 49.8951, -97.1384),               # Portage & Main
    "New Brunswick": ("Moncton", 46.0878, -64.7782),           # Downtown
    "Newfoundland and Labrador": ("St. John's", 47.5615, -52.7126),  # Downtown / harbour
    "Northwest Territories": ("Yellowknife", 62.4540, -114.3718),    # Downtown
    "Nova Scotia": ("Halifax", 44.6488, -63.5752),             # Grand Parade / City Hall
    "Nunavut": ("Iqaluit", 63.7467, -68.5170),                 # Town centre
    "Ontario": ("Toronto", 43.6534, -79.3841),                 # City Hall / Nathan Phillips Sq
    "Quebec": ("Montreal", 45.5017, -73.5673),                 # Place Ville Marie
    "Saskatchewan": ("Saskatoon", 52.1332, -106.6700),         # Downtown
    "Yukon": ("Whitehorse", 60.7212, -135.0568),               # Downtown
}

CANADA_EDGES = """
Alaska-British Columbia Alaska-Yukon
Alberta-British Columbia Alberta-Montana Alberta-Northwest Territories Alberta-Saskatchewan
British Columbia-Idaho British Columbia-Montana British Columbia-Northwest Territories
British Columbia-Washington British Columbia-Yukon
Idaho-British Columbia
Manitoba-Minnesota Manitoba-North Dakota Manitoba-Nunavut Manitoba-Ontario Manitoba-Saskatchewan
Maine-New Brunswick Maine-Quebec
Michigan-Ontario Minnesota-Ontario
Montana-Saskatchewan
New Brunswick-Nova Scotia New Brunswick-Quebec
New Hampshire-Quebec New York-Ontario New York-Quebec
Newfoundland and Labrador-Quebec
North Dakota-Saskatchewan
Northwest Territories-Nunavut Northwest Territories-Saskatchewan Northwest Territories-Yukon
Nunavut-Saskatchewan
Ontario-Quebec
Quebec-Vermont
"""


def parse_edges(text, names):
    """Edge tokens are 'A-B' separated by whitespace, but names contain spaces and
    hyphens-free text, so match greedily against the known name list."""
    names_sorted = sorted(names, key=len, reverse=True)
    edges = set()
    for line in text.strip().splitlines():
        line = line.strip()
        while line:
            a = next(n for n in names_sorted if line.startswith(n + "-"))
            rest = line[len(a) + 1:]
            b = next(n for n in names_sorted if rest.startswith(n))
            edges.add((a, b))
            line = rest[len(b):].strip()
    return edges


def build(cities, edges, path):
    adj = {c: set() for c in cities}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    rows = []
    for c1 in sorted(adj):
        for c2 in sorted(adj[c1]):
            n1, la1, lo1 = cities[c1]
            n2, la2, lo2 = cities[c2]
            rows.append([c1, c2, n1, n2, round(haversine(la1, lo1, la2, lo2))])
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)
    return rows


if __name__ == "__main__":
    out = Path(".")
    build(EUROPE, parse_edges(EUROPE_EDGES, EUROPE), out / "eu.csv")
    build(US, parse_edges(US_EDGES, US), out / "us.csv")
    both = {**US, **CANADA}
    edges = parse_edges(US_EDGES, US) | parse_edges(CANADA_EDGES, both)
    build(both, edges, out / "na.csv")
    print("Wrote eu.csv, us.csv, na.csv")