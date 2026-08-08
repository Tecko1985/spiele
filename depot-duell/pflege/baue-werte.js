/**
 * Erzeugt werte.json aus den Rohdaten der woechentlichen Pflegerunde.
 *
 * Aufruf:  node pflege/baue-werte.js
 * Ergebnis: depot-duell/werte.json
 *
 * WARUM EIN SKRIPT UND NICHT VON HAND:
 * Die US-Kurse stehen in Dollar, das Spiel rechnet in Euro. 60 Umrechnungen
 * von Hand sind die sicherste Art, unbemerkt einen Zahlendreher einzubauen.
 * Das Skript rechnet, prueft und meldet, wenn etwas fehlt.
 *
 * WOECHENTLICHE PFLEGE:
 * 1. finanzen.net/index/dax/werte          -> Kurse DAX
 * 2. finanzen.net/index/dax/fundamental    -> KGV + Dividendenrendite DAX
 * 3. finanzen.net/index/euro_stoxx_50/...  -> dasselbe fuer Europa
 * 4. finanzen.net/index/nasdaq_100/fundamental + dow_jones/fundamental -> KGV US
 * 5. stockanalysis.com/list/biggest-companies/ -> Kurse US in Dollar
 * 6. api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=... -> Krypto
 * 7. api.frankfurter.dev/v1/latest?from=EUR&to=USD -> Wechselkurs
 * Danach unten die Zahlen ersetzen und das Skript laufen lassen.
 */

const fs = require('fs');
const path = require('path');

// Stand der Daten. Wird in werte.json mitgeschrieben und in der App angezeigt.
const STAND = '2026-08-07';
const EUR_USD = 1.1542; // 1 EUR = 1,1542 USD (EZB via frankfurter.dev, 2026-08-06)

/**
 * Aktien.
 * [name, kuerzel, kurs, waehrung, kgv, divRenditeProzent, sektor, land]
 * kgv === null bedeutet: kein sinnvolles KGV (Verlustjahr) -> die App zeigt einen Strich.
 */
const AKTIEN = [
  // ---------- Deutschland (DAX), Kurse in Euro, Xetra 2026-08-07 11:34 ----------
  ['SAP',                 'SAP',  177.06, 'EUR',  33.92, 1.20, 'Technologie',  'Deutschland'],
  ['Siemens',             'SIE',  279.35, 'EUR',  18.71, 2.33, 'Industrie',    'Deutschland'],
  ['Allianz',             'ALV',  437.50, 'EUR',  14.10, 4.38, 'Versicherung', 'Deutschland'],
  ['Rheinmetall',         'RHM', 1157.40, 'EUR', 101.47, 0.74, 'Ruestung',     'Deutschland'],
  ['Mercedes-Benz Group', 'MBG',   46.78, 'EUR',  11.25, 5.83, 'Automobil',    'Deutschland'],
  ['BMW',                 'BMW',   59.00, 'EUR',   7.84, 4.72, 'Automobil',    'Deutschland'],
  ['Volkswagen Vorzuege', 'VOW3',  75.32, 'EUR',   7.78, 5.08, 'Automobil',    'Deutschland'],
  ['Deutsche Bank',       'DBK',   32.86, 'EUR',  10.49, 3.02, 'Banken',       'Deutschland'],
  ['Commerzbank',         'CBK',   39.27, 'EUR',  17.55, 3.05, 'Banken',       'Deutschland'],
  ['adidas',              'ADS',  164.25, 'EUR',  22.53, 1.66, 'Konsum',       'Deutschland'],
  ['Zalando',             'ZAL',   24.98, 'EUR',  30.68, 0.00, 'Handel',       'Deutschland'],
  ['Infineon',            'IFX',   62.29, 'EUR',  43.32, 1.05, 'Halbleiter',   'Deutschland'],
  ['BASF',                'BAS',   51.27, 'EUR',  24.47, 5.06, 'Chemie',       'Deutschland'],
  ['Bayer',               'BAYN',  49.32, 'EUR',   null, 0.30, 'Pharma',       'Deutschland'],
  ['Merck',               'MRK1', 144.60, 'EUR',  20.44, 1.79, 'Pharma',       'Deutschland'],
  ['Deutsche Telekom',    'DTE',   28.75, 'EUR',  14.02, 3.62, 'Telekom',      'Deutschland'],
  ['DHL Group',           'DHL',   54.96, 'EUR',  15.14, 4.07, 'Logistik',     'Deutschland'],
  ['E.ON',                'EOAN',  18.81, 'EUR',  24.30, 3.53, 'Versorger',    'Deutschland'],
  ['RWE',                 'RWE',   56.00, 'EUR',  10.52, 2.65, 'Versorger',    'Deutschland'],
  ['Siemens Energy',      'ENR',  155.30, 'EUR',  61.05, 0.70, 'Versorger',    'Deutschland'],
  ['Muenchener Rueck',    'MUV2', 504.80, 'EUR',  11.92, 4.27, 'Versicherung', 'Deutschland'],
  ['Hannover Rueck',      'HNR1', 250.20, 'EUR',  12.15, 4.70, 'Versicherung', 'Deutschland'],
  ['Deutsche Boerse',     'DB1',  273.00, 'EUR',  20.53, 1.88, 'Finanzen',     'Deutschland'],
  ['Beiersdorf',          'BEI',   80.48, 'EUR',  22.05, 1.07, 'Konsum',       'Deutschland'],
  ['Henkel Vorzuege',     'HEN3',  79.74, 'EUR',  14.17, 2.97, 'Konsum',       'Deutschland'],
  ['Continental',         'CON',   67.90, 'EUR',   null, 3.97, 'Automobil',    'Deutschland'],
  ['Daimler Truck',       'DTG',   46.20, 'EUR',  14.57, 5.09, 'Automobil',    'Deutschland'],
  ['MTU Aero Engines',    'MTX',  374.70, 'EUR',  18.81, 1.01, 'Luftfahrt',    'Deutschland'],
  ['Heidelberg Materials','HEI',  161.60, 'EUR',  20.41, 1.61, 'Bau',          'Deutschland'],
  ['Vonovia',             'VNA',   20.90, 'EUR',   5.49, 5.09, 'Immobilien',   'Deutschland'],

  // ---------- Europa ohne Deutschland, Kurse in Euro ----------
  ['ASML',                'ASML', 1488.40, 'EUR', 37.25, 0.81, 'Halbleiter',   'Niederlande'],
  ['LVMH',                'MC',    481.00, 'EUR', 29.51, 2.02, 'Luxus',        'Frankreich'],
  ['Hermes',              'RMS',  1617.50, 'EUR', 49.17, 0.85, 'Luxus',        'Frankreich'],
  ['LOreal',              'OR',    389.45, 'EUR', 31.93, 1.96, 'Konsum',       'Frankreich'],
  ['TotalEnergies',       'TTE',    74.33, 'EUR', 10.47, 6.12, 'Energie',      'Frankreich'],
  ['Sanofi',              'SAN',    74.67, 'EUR', 19.40, 4.98, 'Pharma',       'Frankreich'],
  ['Air Liquide',         'AI',    172.86, 'EUR', 26.28, 2.31, 'Chemie',       'Frankreich'],
  ['Schneider Electric',  'SU',    300.70, 'EUR', 31.72, 1.79, 'Industrie',    'Frankreich'],
  ['SAFRAN',              'SAF',   352.70, 'EUR', 17.32, 1.13, 'Luftfahrt',    'Frankreich'],
  ['AXA',                 'CS',     44.93, 'EUR',  9.02, 5.66, 'Versicherung', 'Frankreich'],
  ['BNP Paribas',         'BNP',   111.80, 'EUR',  7.85, 6.39, 'Banken',       'Frankreich'],
  ['VINCI',               'DG',    125.60, 'EUR', 13.71, 4.16, 'Bau',          'Frankreich'],
  ['Danone',              'BN',     68.32, 'EUR', 27.19, 2.93, 'Nahrung',      'Frankreich'],
  ['EssilorLuxottica',    'EL',    170.45, 'EUR', 53.52, 1.48, 'Konsum',       'Frankreich'],
  ['Airbus',              'AIR',   214.60, 'EUR', 30.00, 1.61, 'Luftfahrt',    'Niederlande'],
  ['Ferrari',             'RACE',  350.20, 'EUR', 35.55, 1.13, 'Automobil',    'Italien'],
  ['Adyen',               'ADYEN', 933.10, 'EUR', 40.78, 0.00, 'Finanzen',     'Niederlande'],
  ['ING Group',           'INGA',   30.44, 'EUR', 11.35, 4.52, 'Banken',       'Niederlande'],
  ['AB InBev',            'ABI',    73.14, 'EUR', 17.98, 1.47, 'Nahrung',      'Belgien'],
  ['Inditex',             'ITX',    58.30, 'EUR', 27.55, 2.58, 'Handel',       'Spanien'],
  ['Banco Santander',     'SAN2',   12.76, 'EUR', 11.12, 1.93, 'Banken',       'Spanien'],
  ['Iberdrola',           'IBE',    20.55, 'EUR', 19.78, 2.98, 'Versorger',    'Spanien'],
  ['Enel',                'ENEL',    9.91, 'EUR', 22.69, 5.52, 'Versorger',    'Italien'],
  ['Eni',                 'ENI',    23.33, 'EUR', 20.59, 6.51, 'Energie',      'Italien'],
  ['UniCredit',           'UCG',    84.66, 'EUR',  9.98, 4.44, 'Banken',       'Italien'],
  ['Intesa Sanpaolo',     'ISP',     6.80, 'EUR', 11.17, 6.35, 'Banken',       'Italien'],

  // ---------- USA, Kurse in Dollar ----------
  ['NVIDIA',              'NVDA',  218.99, 'USD',  38.32, 0.02, 'Halbleiter',   'USA'],
  ['Apple',               'AAPL',  312.41, 'USD',  34.22, 0.40, 'Technologie',  'USA'],
  ['Alphabet',            'GOOGL', 357.75, 'USD',  28.96, 0.27, 'Technologie',  'USA'],
  ['Microsoft',           'MSFT',  499.86, 'USD',  36.46, 0.67, 'Technologie',  'USA'],
  ['Amazon',              'AMZN',  272.26, 'USD',  32.18, 0.00, 'Handel',       'USA'],
  ['Broadcom',            'AVGO',  420.57, 'USD',  77.57, 0.64, 'Halbleiter',   'USA'],
  ['Meta Platforms',      'META',  589.90, 'USD',  28.10, 0.32, 'Technologie',  'USA'],
  ['Tesla',               'TSLA',  319.53, 'USD', 418.19, 0.00, 'Automobil',    'USA'],
  ['Berkshire Hathaway',  'BRK.B', 524.61, 'USD',   null, 0.00, 'Finanzen',     'USA'],
  ['Micron Technology',   'MU',    881.47, 'USD',  16.07, 0.38, 'Halbleiter',   'USA'],
  ['JPMorgan Chase',      'JPM',   356.30, 'USD',  16.10, 1.80, 'Banken',       'USA'],
  ['Walmart',             'WMT',   112.07, 'USD',  43.66, 0.79, 'Handel',       'USA'],
  ['AMD',                 'AMD',   489.28, 'USD',  81.13, 0.00, 'Halbleiter',   'USA'],
  ['Visa',                'V',     370.47, 'USD',  33.81, 0.69, 'Finanzen',     'USA'],
  ['Johnson & Johnson',   'JNJ',   256.98, 'USD',  18.82, 2.48, 'Pharma',       'USA'],
  ['Cisco',               'CSCO',  120.88, 'USD',  26.98, 2.36, 'Technologie',  'USA'],
  ['Costco',              'COST',  949.15, 'USD',  51.81, 0.52, 'Handel',       'USA'],
  ['Applied Materials',   'AMAT',  527.48, 'USD',  26.41, 0.78, 'Halbleiter',   'USA'],
  ['Caterpillar',         'CAT',   856.96, 'USD',  30.46, 1.04, 'Industrie',    'USA'],
  ['Lam Research',        'LRCX',  305.77, 'USD',  23.40, 0.95, 'Halbleiter',   'USA'],
  ['Palantir',            'PLTR',  155.92, 'USD', 280.58, 0.00, 'Technologie',  'USA'],
  ['Coca-Cola',           'KO',     86.85, 'USD',  23.00, 2.92, 'Nahrung',      'USA'],
  ['Chevron',             'CVX',   189.23, 'USD',  23.00, 4.49, 'Energie',      'USA'],
  ['UnitedHealth',        'UNH',   403.97, 'USD',  24.94, 2.64, 'Gesundheit',   'USA'],
  ['Home Depot',          'HD',    349.52, 'USD',  26.33, 2.46, 'Handel',       'USA'],
  ['Procter & Gamble',    'PG',    146.97, 'USD',  22.14, 2.90, 'Konsum',       'USA'],
  ['Merck & Co',          'MRK',   128.37, 'USD',  14.46, 3.12, 'Pharma',       'USA'],
  ['Goldman Sachs',       'GS',   1032.58, 'USD',  17.13, 1.59, 'Banken',       'USA'],
  ['Netflix',             'NFLX',   73.69, 'USD',  37.09, 0.00, 'Medien',       'USA'],
  ['Texas Instruments',   'TXN',   278.40, 'USD',  31.85, 3.17, 'Halbleiter',   'USA'],
  ['KLA',                 'KLAC',  193.22, 'USD',  29.50, 0.75, 'Halbleiter',   'USA'],
  ['American Express',    'AXP',   342.60, 'USD',  24.06, 0.89, 'Finanzen',     'USA'],
  ['Palo Alto Networks',  'PANW',  359.49, 'USD', 108.60, 0.00, 'Technologie',  'USA'],
  ['Intel',               'INTC',   99.81, 'USD',   null, 0.00, 'Halbleiter',   'USA'],
  ['Mastercard',          'MA',    575.95, 'USD',   null, 0.00, 'Finanzen',     'USA'],
  ['Eli Lilly',           'LLY',  1191.94, 'USD',   null, 0.00, 'Pharma',       'USA'],
  ['ExxonMobil',          'XOM',   154.84, 'USD',   null, 0.00, 'Energie',      'USA'],
  ['Oracle',              'ORCL',  143.47, 'USD',   null, 0.00, 'Technologie',  'USA'],
  ['GE Aerospace',        'GE',    374.55, 'USD',   null, 0.00, 'Luftfahrt',    'USA'],
  ['Bank of America',     'BAC',    63.00, 'USD',   null, 0.00, 'Banken',       'USA'],

  // ---------- Asien und Sonstige, Kurse in Dollar (Zweitnotiz in New York) ----------
  ['TSMC',                'TSM',   418.20, 'USD',   null, 0.00, 'Halbleiter',   'Taiwan'],
  ['SK hynix',            'SKHY',  143.53, 'USD',   null, 0.00, 'Halbleiter',   'Suedkorea'],
  ['Alibaba',             'BABA',  126.81, 'USD',   null, 0.00, 'Handel',       'China'],
  ['Mitsubishi UFJ',      'MUFG',   22.52, 'USD',   null, 0.00, 'Banken',       'Japan'],
  ['Arm Holdings',        'ARM',   286.68, 'USD', 178.73, 0.00, 'Halbleiter',   'Grossbritannien'],
  ['Shell',               'SHEL',   89.60, 'USD',   null, 0.00, 'Energie',      'Grossbritannien'],
  ['AstraZeneca',         'AZN',   161.07, 'USD',   null, 0.00, 'Pharma',       'Grossbritannien'],
  ['HSBC',                'HSBC',  102.56, 'USD',   null, 0.00, 'Banken',       'Grossbritannien'],
  ['Novartis',            'NVS',   154.21, 'USD',   null, 0.00, 'Pharma',       'Schweiz'],
  ['Royal Bank of Canada','RY',    211.45, 'USD',   null, 0.00, 'Banken',       'Kanada'],
];

/**
 * ETFs. Kurse in Dollar von stockanalysis.com/etf/screener (2026-08-07).
 * Die Namen sind die offiziellen Produktnamen derselben Quelle - keine
 * eingedeutschten Gattungsbegriffe. Ein ETF, der schlicht 'Immobilien' heisst,
 * ist von einer Meldung ueber 'Immobilienwerte' nicht zu unterscheiden; mit
 * 'Vanguard Real Estate ETF' sieht man, dass hier ein echtes Produkt liegt.
 * [name, kuerzel, kurs, fondsvolumenMrdUsd, anzahlPositionen, bereich, anlageklasse]
 *
 * OFFEN: TER und Ausschuettungsart sind hier noch nicht erfasst - der Screener
 * fuehrt sie nicht. In der App stehen sie deshalb als Strich. Beim naechsten
 * Pflegelauf aus dem jeweiligen Anbieterdatenblatt nachtragen, NICHT schaetzen.
 */
/**
 * Laufende Kosten (TER) und Ausschuettungsart der ETFs.
 * TER am 2026-08-07 von stockanalysis.com/etf/compare abgerufen - die
 * Vergleichsseite liefert fuenf Werte auf einmal, deshalb fuenf Abrufe
 * statt fuenfundzwanzig.
 *
 * Ausschuettungsart: alle fuenfundzwanzig sind US-Produkte. Ein
 * US-Investmentfonds muss den Grossteil seiner Ertraege ausschuetten, um
 * steuerlich als Regulated Investment Company zu gelten - thesaurierende
 * ETFs gibt es dort praktisch nicht. GLD und IBIT sind die Ausnahme, aber
 * aus einem anderen Grund: sie sind Trusts auf einen Sachwert (Gold,
 * Bitcoin) und erwirtschaften ueberhaupt keine Ertraege, die auszuschuetten
 * waeren.
 */
/* ==========================================================================
   OFFEN: Ausbau auf 250 Werte (von Michel am 2026-08-07 beauftragt)
   ==========================================================================
   Das Mischungsverhaeltnis soll bleiben, nur die Zahl waechst:

     jetzt   106 Aktien (75,2 %) ·  25 ETFs (17,7 %) · 10 Krypto (7,1 %) = 141
     Ziel    188 Aktien           ·  44 ETFs          · 18 Krypto        = 250
     also    +82 Aktien           · +19 ETFs          · +8 Krypto        = 109 neu

   Quellen wie gehabt, damit die Zahlen zueinander passen:
     Aktien     stockanalysis.com (Kurs, KGV, Dividendenrendite)
     ETFs       stockanalysis.com/etf/screener + /etf/compare (fuenf TER je Abruf)
     Krypto     CoinGecko, Kurse direkt in Euro

   Bei den Aktien ist die Laenderverteilung heute stark auf USA (40) und
   Deutschland (30) gewichtet, dahinter Frankreich (13). Beim Ausbau die
   duennen Laender mit aufholen lassen - Japan, Schweiz, Kanada, Grossbritannien
   und Suedkorea haben je nur ein bis vier Werte, eine Laendernachricht trifft
   dort also fast nichts.

   ⚠️ NICHT schaetzen. Fehlt eine Kennzahl, bleibt sie null und die App zeigt
   einen Strich - so wie es bei den 19 Aktien ohne KGV schon der Fall ist.
   ========================================================================== */

const ETF_KOSTEN = {
  'VOO':  { ter: 0.03, ausschuettend: true },
  'QQQ':  { ter: 0.18, ausschuettend: true },
  'VT':   { ter: 0.06, ausschuettend: true },
  'VEA':  { ter: 0.03, ausschuettend: true },
  'VWO':  { ter: 0.06, ausschuettend: true },
  'EFA':  { ter: 0.32, ausschuettend: true },
  'IWM':  { ter: 0.19, ausschuettend: true },
  'IJH':  { ter: 0.05, ausschuettend: true },
  'DIA':  { ter: 0.16, ausschuettend: true },
  'RSP':  { ter: 0.20, ausschuettend: true },
  'VUG':  { ter: 0.03, ausschuettend: true },
  'VTV':  { ter: 0.03, ausschuettend: true },
  'SCHD': { ter: 0.06, ausschuettend: true },
  'VYM':  { ter: 0.04, ausschuettend: true },
  'XLK':  { ter: 0.08, ausschuettend: true },
  'SOXX': { ter: 0.34, ausschuettend: true },
  'XLV':  { ter: 0.08, ausschuettend: true },
  'XLF':  { ter: 0.08, ausschuettend: true },
  'XLE':  { ter: 0.08, ausschuettend: true },
  'VNQ':  { ter: 0.13, ausschuettend: true },
  'GLD':  { ter: 0.40, ausschuettend: false },
  'AGG':  { ter: 0.03, ausschuettend: true },
  'TLT':  { ter: 0.15, ausschuettend: true },
  'VCIT': { ter: 0.03, ausschuettend: true },
  'IBIT': { ter: 0.25, ausschuettend: false },
};

const ETFS = [
  ['Vanguard S&P 500 ETF',       'VOO',  706.40, 1030.0,  520, 'USA breit',        'Aktien'],
  ['Invesco QQQ Trust',          'QQQ',  714.65,  479.2,  106, 'USA Technologie',  'Aktien'],
  ['Vanguard Total World Stock ETF', 'VT',   159.92,   80.9, 10070, 'Welt',            'Aktien'],
  ['Vanguard FTSE Developed Markets ETF', 'VEA',   72.12,  235.0, 3881, 'Welt ohne USA',    'Aktien'],
  ['Vanguard FTSE Emerging Markets ETF', 'VWO',   59.96,  124.9, 5077, 'Schwellenlaender', 'Aktien'],
  ['iShares MSCI EAFE ETF',      'EFA',  107.36,   79.3,  704, 'Europa/Asien',     'Aktien'],
  ['iShares Russell 2000 ETF',   'IWM',  298.25,   82.2, 1973, 'USA klein',        'Aktien'],
  ['iShares Core S&P Mid-Cap ETF', 'IJH',   76.75,  126.1,  413, 'USA mittel',       'Aktien'],
  ['SPDR Dow Jones Industrial Average ETF', 'DIA',  538.19,   47.6,   31, 'USA Standard',     'Aktien'],
  ['Invesco S&P 500 Equal Weight ETF', 'RSP',  218.58,   97.5,  509, 'USA breit',        'Aktien'],
  ['Vanguard Growth ETF',        'VUG',   88.68,  229.6,  151, 'USA Wachstum',     'Aktien'],
  ['Vanguard Value ETF',         'VTV',  223.37,  191.4,  326, 'USA Substanz',     'Aktien'],
  ['Schwab US Dividend Equity ETF', 'SCHD',  33.70,  105.7,  103, 'Dividenden',       'Aktien'],
  ['Vanguard High Dividend Yield ETF', 'VYM',  164.77,   83.4,  618, 'Dividenden',       'Aktien'],
  ['Technology Select Sector SPDR', 'XLK',  185.33,  122.8,   76, 'Technologie',      'Aktien'],
  ['iShares Semiconductor ETF',  'SOXX', 532.52,   47.6,   34, 'Halbleiter',       'Aktien'],
  ['Health Care Select Sector SPDR', 'XLV',  164.45,   41.9,   63, 'Gesundheit',       'Aktien'],
  ['Financial Select Sector SPDR', 'XLF',   57.81,   59.2,   80, 'Finanzen',         'Aktien'],
  ['Energy Select Sector SPDR',  'XLE',   58.16,   38.5,   24, 'Energie',          'Aktien'],
  ['Vanguard Real Estate ETF',   'VNQ',   98.04,   39.3,  157, 'Immobilien',       'Aktien'],
  ['SPDR Gold Shares',           'GLD',  389.67,  132.5,    2, 'Rohstoffe',        'Rohstoff'],
  ['iShares Core US Aggregate Bond ETF', 'AGG',   97.43,  137.7, 13314, 'Anleihen',        'Anleihen'],
  ['iShares 20+ Year Treasury Bond ETF', 'TLT',   82.52,   41.6,   48, 'Anleihen',         'Anleihen'],
  ['Vanguard Interm.-Term Corp. Bond ETF', 'VCIT',  81.28,   67.6, 2268, 'Anleihen',         'Anleihen'],
  ['iShares Bitcoin Trust',      'IBIT',  36.49,   47.5,    2, 'Krypto',           'Krypto'],
];

/**
 * Kryptowaehrungen. Kurse und Kennzahlen direkt in Euro von CoinGecko,
 * abgerufen 2026-08-07. [name, kuerzel, kurs, marktkapitalisierung,
 * umlaufmenge, hoechstmenge, allzeithoch]
 */
const KRYPTO = [
  ['Bitcoin',   'BTC',  56194,    1127647737878, 20066859,     21000000,     107662],
  ['Ethereum',  'ETH',   1658.37,  200136636045, 120682112,    null,           4229.76],
  ['XRP',       'XRP',      0.897422, 56118984606, 62533271955, 100000000000,     3.28],
  ['Solana',    'SOL',     63.78,     37123963865, 582052039,   null,           285.60],
  ['Dogecoin',  'DOGE',     0.060262,  9364321783, 155391626384, null,            0.601466],
  ['Cardano',   'ADA',      0.174281,  6508964016, 37347307716, 45000000000,      2.61],
  ['Chainlink', 'LINK',     7.12,      5327321279, 748099970,   1000000000,      43.32],
  ['Litecoin',  'LTC',     39.63,      3069736187, 77468673,    84000000,       337.56],
  ['Avalanche', 'AVAX',     5.59,      2412554516, 431771961,   720000000,      128.43],
  ['Polkadot',  'DOT',      0.704118,  1194812938, 1696883321,  2100000000,      47.60],
];

// ---------------------------------------------------------------------------

function nachEuro(kurs, waehrung) {
  if (waehrung === 'EUR') return kurs;
  if (waehrung === 'USD') return kurs / EUR_USD;
  throw new Error('Unbekannte Waehrung: ' + waehrung);
}

// Auf sinnvolle Stellen runden: teure Werte auf Cent, billige Coins feiner.
function runde(zahl) {
  if (zahl >= 100) return Math.round(zahl * 100) / 100;
  if (zahl >= 1) return Math.round(zahl * 10000) / 10000;
  return Math.round(zahl * 1000000) / 1000000;
}

const werte = [];
const fehler = [];
const kuerzelGesehen = new Set();

for (const [name, kuerzel, kurs, waehrung, kgv, divRendite, sektor, land] of AKTIEN) {
  if (kuerzelGesehen.has(kuerzel)) fehler.push('Kuerzel doppelt: ' + kuerzel);
  kuerzelGesehen.add(kuerzel);
  if (!(kurs > 0)) fehler.push('Kurs fehlt oder ist nicht positiv: ' + name);

  const kursEur = runde(nachEuro(kurs, waehrung));

  // Gewinn je Aktie aus Kurs und KGV. Das ist der Anker, an dem das KGV
  // waehrend der Partie mitwandert: KGV = Kurs / Gewinn je Aktie.
  const gewinnJeAktie = kgv && kgv > 0 ? runde(kursEur / kgv) : null;

  // Dividende je Aktie aus der Rendite. Wird im Spiel jaehrlich gebucht.
  const dividende = divRendite > 0 ? runde((kursEur * divRendite) / 100) : 0;

  werte.push({
    id: kuerzel.toLowerCase().replace(/[^a-z0-9]/g, ''),
    art: 'aktie',
    name,
    kuerzel,
    kurs: kursEur,
    kursOriginal: waehrung === 'EUR' ? null : kurs,
    waehrungOriginal: waehrung === 'EUR' ? null : waehrung,
    kgv,
    gewinnJeAktie,
    dividende,
    divRendite: divRendite || 0,
    sektor,
    land,
  });
}

for (const [name, kuerzel, kurs, volumenMrd, positionen, bereich, anlageklasse] of ETFS) {
  if (kuerzelGesehen.has(kuerzel)) fehler.push('Kuerzel doppelt: ' + kuerzel);
  kuerzelGesehen.add(kuerzel);
  if (!(kurs > 0)) fehler.push('Kurs fehlt: ' + name);

  werte.push({
    id: kuerzel.toLowerCase(),
    art: 'etf',
    name,
    kuerzel,
    kurs: runde(nachEuro(kurs, 'USD')),
    kursOriginal: kurs,
    waehrungOriginal: 'USD',
    fondsvolumenMrd: volumenMrd,
    anzahlPositionen: positionen,
    ter: (ETF_KOSTEN[kuerzel] || {}).ter === undefined ? null : ETF_KOSTEN[kuerzel].ter,
    ausschuettend: (ETF_KOSTEN[kuerzel] || {}).ausschuettend === undefined ? null : ETF_KOSTEN[kuerzel].ausschuettend,
    sektor: bereich,
    anlageklasse,
    land: null,
  });
}

for (const [name, kuerzel, kurs, marktkap, umlauf, hoechstmenge, allzeithoch] of KRYPTO) {
  if (kuerzelGesehen.has(kuerzel)) fehler.push('Kuerzel doppelt: ' + kuerzel);
  kuerzelGesehen.add(kuerzel);
  if (!(kurs > 0)) fehler.push('Kurs fehlt: ' + name);

  werte.push({
    id: kuerzel.toLowerCase(),
    art: 'krypto',
    name,
    kuerzel,
    kurs: runde(kurs),
    marktkapitalisierung: marktkap,
    umlaufmenge: umlauf,
    hoechstmenge: hoechstmenge,
    allzeithoch: allzeithoch,
    sektor: 'Krypto',
    land: null,
  });
}

// --- Pruefungen, die verhindern, dass eine halb gefuellte Datei rausgeht ---
const anzahlAktien = werte.filter((w) => w.art === 'aktie').length;
const anzahlKrypto = werte.filter((w) => w.art === 'krypto').length;
const anzahlEtf = werte.filter((w) => w.art === 'etf').length;

if (anzahlKrypto !== 10) fehler.push('Erwartet 10 Kryptos, gefunden ' + anzahlKrypto);
if (anzahlEtf !== 25) fehler.push('Erwartet 25 ETFs, gefunden ' + anzahlEtf);
if (anzahlAktien < 100) fehler.push('Erwartet mindestens 100 Aktien, gefunden ' + anzahlAktien);

// Ein Kurs von 0 oder NaN wuerde im Kursmotor durch Division alles zerreissen.
for (const w of werte) {
  if (!Number.isFinite(w.kurs) || w.kurs <= 0) fehler.push('Unbrauchbarer Kurs bei ' + w.name);
  if (w.art === 'aktie' && w.kgv !== null && w.gewinnJeAktie === null) {
    fehler.push('KGV ohne Gewinn je Aktie bei ' + w.name);
  }
}

if (fehler.length) {
  console.error('ABBRUCH - werte.json wurde NICHT geschrieben:');
  for (const f of fehler) console.error('  - ' + f);
  process.exit(1);
}

const ausgabe = {
  stand: STAND,
  eurUsd: EUR_USD,
  hinweis:
    'Startkurse und Kennzahlen sind echte Marktdaten vom angegebenen Stand. ' +
    'Der Kursverlauf im Spiel ist simuliert und hat keinen Bezug zur Wirklichkeit.',
  quellen: [
    'finanzen.net (Xetra-Kurse, KGV, Dividendenrendite)',
    'stockanalysis.com (US-Kurse)',
    'CoinGecko (Kryptokurse)',
    'frankfurter.dev / EZB (Wechselkurs)',
  ],
  werte,
};

// Als JS-Datei, nicht als JSON: die App braucht dann keinen zweiten Netzabruf.
// Im Bus mit halbem Balken ist jeder eingesparte Request einer weniger, der
// haengen bleibt - und ohne die Werte kann das Spiel gar nicht starten.
const ziel = path.join(__dirname, '..', 'werte.js');
fs.writeFileSync(
  ziel,
  '/* Erzeugt von pflege/baue-werte.js - NICHT von Hand aendern. */\n' +
    '/* Stand ' + STAND + '. Zum Aktualisieren die Zahlen im Pflegeskript ersetzen. */\n' +
    'const WERTE = ' + JSON.stringify(ausgabe, null, 1) + ';\n',
  'utf8'
);

console.log('werte.js geschrieben: ' + werte.length + ' Werte');
console.log('  Aktien: ' + anzahlAktien + '  ETFs: ' + anzahlEtf + '  Krypto: ' + anzahlKrypto);
const ohneKgv = werte.filter((w) => w.art === 'aktie' && w.kgv === null).length;
console.log('  ohne KGV (zeigt im Spiel einen Strich): ' + ohneKgv);
