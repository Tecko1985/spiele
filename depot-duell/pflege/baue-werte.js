/**
 * Erzeugt werte.js aus den Rohdaten der woechentlichen Pflegerunde.
 *
 * Aufruf:  node pflege/baue-werte.js
 * Ergebnis: depot-duell/werte.js
 *
 * WARUM EIN SKRIPT UND NICHT VON HAND:
 * Die auslaendischen Kurse stehen in Dollar, Franken, Yen, Pfund, Won und
 * Hongkong-Dollar, das Spiel rechnet in Euro. Ueber 200 Umrechnungen von Hand
 * sind die sicherste Art, unbemerkt einen Zahlendreher einzubauen. Das Skript
 * rechnet, prueft und meldet, wenn etwas fehlt.
 *
 * WOECHENTLICHE PFLEGE:
 * Die Zahlen holt `node pflege/hole-kurse.js --schreiben` selbst und traegt
 * sie unten ein - je Wert steht seine Quelle in der letzten Spalte. Danach
 * dieses Skript laufen lassen. Der Ablauf im Ganzen steht in
 * pflege/PFLEGE.md, samt dem Prompt der Routine, die ihn ausloest.
 *
 * Quellen (eine je Wertart, damit die Zahlen zueinander passen):
 *   Aktien   stockanalysis.com    Kurs, KGV, Dividendenrendite
 *   ETFs     stockanalysis.com    Kurs, Fondsvolumen, Positionen, TER
 *   Krypto   CoinGecko            Kurse direkt in Euro
 *   Devisen  frankfurter.dev/EZB  alle Wechselkurse in einem Abruf
 *
 * Von Hand gepflegt bleibt, was keine Quelle liefert und was das Spiel
 * ausmacht: welcher Wert ueberhaupt dabei ist, sein Sektor und sein Land.
 */

const fs = require('fs');
const path = require('path');

// Stand der Daten. Wird in werte.js mitgeschrieben und in der App unter
// "Die Werte sind echt" sowie in der Quellenangabe angezeigt.
const STAND = '2026-08-22';
const EUR_USD = 1.1699; // 1 EUR = 1.1699 USD (EZB via frankfurter.dev, 2026-08-21)

/**
 * Wechselkurse, 1 EUR = x Fremdwaehrung (EZB via frankfurter.dev).
 *
 * Seit dem Ausbau auf 250 Werte notieren nicht mehr nur Dollar-Werte im
 * Ausland: die duenn besetzten Laender wurden mit ihren HEIMATboersen
 * aufgefuellt, weil es fuer die meisten japanischen, schweizer und
 * koreanischen Unternehmen keine liquide US-Zweitnotiz gibt. Ein OTC-Schein
 * mit drei Umsaetzen am Tag waere ein schlechterer Startkurs als der echte.
 *
 * GBX ist kein Tippfehler: London notiert in Pence. Wer das uebersieht, hat
 * Shell mit dem Hundertfachen im Spiel - und es faellt nicht auf, weil 3277
 * eine voellig plausible Zahl ist.
 */
const WECHSELKURSE = {
  CAD: 1.6074,
  CHF: 0.9353,
  GBP: 0.8567,
  HKD: 9.1726,
  JPY: 185.66,
  KRW: 1619.41,
  USD: 1.1699,
};

/**
 * Aktien.
 * [name, kuerzel, kurs, waehrung, kgv, divRenditeProzent, sektor, land, quelle]
 * kgv === null bedeutet: kein sinnvolles KGV (Verlustjahr) -> die App zeigt einen Strich.
 * quelle ist der Pfad bei stockanalysis.com, den hole-kurse.js abruft.
 */
const AKTIEN = [






  // ---------- Deutschland (DAX), Kurse in Euro, Xetra 2026-08-07 11:34 ----------
  ['SAP'                         , 'SAP'   ,     188.12, 'EUR',  28.17, 1.37, 'Technologie' , 'Deutschland'    , 'quote/etr/SAP'],
  ['Siemens'                     , 'SIE'   ,     280.35, 'EUR',  28.03, 1.93, 'Industrie'   , 'Deutschland'    , 'quote/etr/SIE'],
  ['Allianz'                     , 'ALV'   ,      440.8, 'EUR',  14.46, 3.87, 'Versicherung', 'Deutschland'    , 'quote/etr/ALV'],
  ['Rheinmetall'                 , 'RHM'   , 1155.40002, 'EUR',  44.28, 0.98, 'Ruestung'    , 'Deutschland'    , 'quote/etr/RHM'],
  ['Mercedes-Benz Group'         , 'MBG'   ,     45.215, 'EUR',   8.56, 7.77, 'Automobil'   , 'Deutschland'    , 'quote/etr/MBG'],
  ['BMW'                         , 'BMW'   ,      58.88, 'EUR',   5.59, 7.43, 'Automobil'   , 'Deutschland'    , 'quote/etr/BMW'],
  ['Volkswagen Vorzuege'         , 'VOW3'  ,      75.02, 'EUR',   7.17, 7.03, 'Automobil'   , 'Deutschland'    , 'quote/etr/VOW3'],
  ['Deutsche Bank'               , 'DBK'   ,     32.375, 'EUR',  10.45, 3.07, 'Banken'      , 'Deutschland'    , 'quote/etr/DBK'],
  ['Commerzbank'                 , 'CBK'   ,      39.01, 'EUR',  14.98, 2.82, 'Banken'      , 'Deutschland'    , 'quote/etr/CBK'],
  ['adidas'                      , 'ADS'   ,     154.45, 'EUR',  19.84, 1.81, 'Konsum'      , 'Deutschland'    , 'quote/etr/ADS'],
  ['Zalando'                     , 'ZAL'   ,      22.78, 'EUR',  61.78,    0, 'Handel'      , 'Deutschland'    , 'quote/etr/ZAL'],
  ['Infineon'                    , 'IFX'   ,      55.97, 'EUR',  60.81, 0.63, 'Halbleiter'  , 'Deutschland'    , 'quote/etr/IFX'],
  ['BASF'                        , 'BAS'   ,      51.67, 'EUR',  21.83, 4.41, 'Chemie'      , 'Deutschland'    , 'quote/etr/BAS'],
  ['Bayer'                       , 'BAYN'  ,      48.04, 'EUR', null  , 0.22, 'Pharma'      , 'Deutschland'    , 'quote/etr/BAYN'],
  ['Merck'                       , 'MRK1'  ,     137.95, 'EUR',  25.31, 1.59, 'Pharma'      , 'Deutschland'    , 'quote/etr/MRK'],
  ['Deutsche Telekom'            , 'DTE'   ,      28.94, 'EUR',   16.2, 3.43, 'Telekom'     , 'Deutschland'    , 'quote/etr/DTE'],
  ['DHL Group'                   , 'DHL'   ,      55.98, 'EUR',  17.05, 3.44, 'Logistik'    , 'Deutschland'    , 'quote/etr/DHL'],
  ['E.ON'                        , 'EOAN'  ,      17.41, 'EUR',  13.49, 3.25, 'Versorger'   , 'Deutschland'    , 'quote/etr/EOAN'],
  ['RWE'                         , 'RWE'   ,      57.32, 'EUR',  12.69,  2.1, 'Versorger'   , 'Deutschland'    , 'quote/etr/RWE'],
  ['Siemens Energy'              , 'ENR'   ,     153.36, 'EUR',  49.88, 0.45, 'Versorger'   , 'Deutschland'    , 'quote/etr/ENR'],
  ['Muenchener Rueck'            , 'MUV2'  ,      516.4, 'EUR',   9.61, 4.58, 'Versicherung', 'Deutschland'    , 'quote/etr/MUV2'],
  ['Hannover Rueck'              , 'HNR1'  ,      250.8, 'EUR',  11.07, 4.88, 'Versicherung', 'Deutschland'    , 'quote/etr/HNR1'],
  ['Deutsche Boerse'             , 'DB1'   ,  282.89999, 'EUR',   24.4, 1.51, 'Finanzen'    , 'Deutschland'    , 'quote/etr/DB1'],
  ['Beiersdorf'                  , 'BEI'   ,      79.78, 'EUR',  18.56, 1.28, 'Konsum'      , 'Deutschland'    , 'quote/etr/BEI'],
  ['Henkel Vorzuege'             , 'HEN3'  ,      75.84, 'EUR',  16.17, 2.74, 'Konsum'      , 'Deutschland'    , 'quote/etr/HEN3'],
  ['Continental'                 , 'CON'   ,      68.78, 'EUR', null  , 3.98, 'Automobil'   , 'Deutschland'    , 'quote/etr/CON'],
  ['Daimler Truck'               , 'DTG'   ,      45.43, 'EUR',  32.22,  4.2, 'Automobil'   , 'Deutschland'    , 'quote/etr/DTG'],
  ['MTU Aero Engines'            , 'MTX'   ,  352.39999, 'EUR',  20.41,    1, 'Luftfahrt'   , 'Deutschland'    , 'quote/etr/MTX'],
  ['Heidelberg Materials'        , 'HEI'   ,      159.6, 'EUR',  13.86, 2.28, 'Bau'         , 'Deutschland'    , 'quote/etr/HEI'],
  ['Vonovia'                     , 'VNA'   ,      20.06, 'EUR',    4.7, 6.27, 'Immobilien'  , 'Deutschland'    , 'quote/etr/VNA'],

  // ---------- Europa ohne Deutschland, Kurse in Euro ----------
  ['ASML'                        , 'ASML'  ,       1506, 'EUR',  54.69,  0.5, 'Halbleiter'  , 'Niederlande'    , 'quote/ams/ASML'],
  ['LVMH'                        , 'MC'    ,      452.5, 'EUR',  20.63,  2.9, 'Luxus'       , 'Frankreich'     , 'quote/epa/MC'],
  ['Hermes'                      , 'RMS'   ,       1573, 'EUR',  36.58, 1.14, 'Luxus'       , 'Frankreich'     , 'quote/epa/RMS'],
  ['LOreal'                      , 'OR'    ,      386.6, 'EUR',  32.82, 1.88, 'Konsum'      , 'Frankreich'     , 'quote/epa/OR'],
  ['TotalEnergies'               , 'TTE'   ,      77.44, 'EUR',  11.03, 4.65, 'Energie'     , 'Frankreich'     , 'quote/epa/TTE'],
  ['Sanofi'                      , 'SAN'   ,      78.94, 'EUR',   24.3, 5.24, 'Pharma'      , 'Frankreich'     , 'quote/epa/SAN'],
  ['Air Liquide'                 , 'AI'    ,     167.12, 'EUR',  30.07, 2.02, 'Chemie'      , 'Frankreich'     , 'quote/epa/AI'],
  ['Schneider Electric'          , 'SU'    ,      296.8, 'EUR',   35.7, 1.42, 'Industrie'   , 'Frankreich'     , 'quote/epa/SU'],
  ['SAFRAN'                      , 'SAF'   ,      343.6, 'EUR',   36.9, 0.96, 'Luftfahrt'   , 'Frankreich'     , 'quote/epa/SAF'],
  ['AXA'                         , 'CS'    ,      43.72, 'EUR',   11.8, 5.28, 'Versicherung', 'Frankreich'     , 'quote/epa/CS'],
  ['BNP Paribas'                 , 'BNP'   ,      107.5, 'EUR',   9.31, 4.79, 'Banken'      , 'Frankreich'     , 'quote/epa/BNP'],
  ['VINCI'                       , 'DG'    ,      119.3, 'EUR',  13.23, 4.15, 'Bau'         , 'Frankreich'     , 'quote/epa/DG'],
  ['Danone'                      , 'BN'    ,      66.32, 'EUR',  21.97, 3.44, 'Nahrung'     , 'Frankreich'     , 'quote/epa/BN'],
  ['EssilorLuxottica'            , 'EL'    ,      163.2, 'EUR',   30.5, 2.45, 'Konsum'      , 'Frankreich'     , 'quote/epa/EL'],
  ['Airbus'                      , 'AIR'   ,      203.7, 'EUR',  27.13, 1.54, 'Luftfahrt'   , 'Niederlande'    , 'quote/epa/AIR'],
  ['Ferrari'                     , 'RACE'  ,  371.10001, 'EUR',  40.22,    1, 'Automobil'   , 'Italien'        , 'quote/bit/RACE'],
  ['Adyen'                       , 'ADYEN' ,       1074, 'EUR',   30.2,    0, 'Finanzen'    , 'Niederlande'    , 'quote/ams/ADYEN'],
  ['ING Group'                   , 'INGA'  ,      29.83, 'EUR',   9.99,  4.4, 'Banken'      , 'Niederlande'    , 'quote/ams/INGA'],
  ['AB InBev'                    , 'ABI'   ,      67.16, 'EUR',  16.54, 1.73, 'Nahrung'     , 'Belgien'        , 'quote/ebr/ABI'],
  ['Inditex'                     , 'ITX'   ,      58.22, 'EUR',  28.86,    3, 'Handel'      , 'Spanien'        , 'quote/bme/ITX'],
  ['Banco Santander'             , 'SAN2'  ,      12.55, 'EUR',  14.22, 2.01, 'Banken'      , 'Spanien'        , 'quote/bme/SAN'],
  ['Iberdrola'                   , 'IBE'   ,      20.05, 'EUR',  24.57, 3.37, 'Versorger'   , 'Spanien'        , 'quote/bme/IBE'],
  ['Enel'                        , 'ENEL'  ,      9.503, 'EUR',  22.78, 5.17, 'Versorger'   , 'Italien'        , 'quote/bit/ENEL'],
  ['Eni'                         , 'ENI'   ,      24.14, 'EUR',  12.67, 4.47, 'Energie'     , 'Italien'        , 'quote/bit/ENI'],
  ['UniCredit'                   , 'UCG'   ,      83.03, 'EUR',  11.79, 3.82, 'Banken'      , 'Italien'        , 'quote/bit/UCG'],
  ['Intesa Sanpaolo'             , 'ISP'   ,      6.769, 'EUR',   12.2,  5.6, 'Banken'      , 'Italien'        , 'quote/bit/ISP'],

  // ---------- USA, Kurse in Dollar ----------
  ['NVIDIA'                      , 'NVDA'  ,     214.72, 'USD',  32.88, 0.47, 'Halbleiter'  , 'USA'            , 'stocks/nvda'],
  ['Apple'                       , 'AAPL'  ,     309.35, 'USD',  35.49, 0.35, 'Technologie' , 'USA'            , 'stocks/aapl'],
  ['Alphabet'                    , 'GOOGL' ,     344.82, 'USD',   17.3, 0.26, 'Technologie' , 'USA'            , 'stocks/googl'],
  ['Microsoft'                   , 'MSFT'  ,     483.24, 'USD',  26.92, 0.75, 'Technologie' , 'USA'            , 'stocks/msft'],
  ['Amazon'                      , 'AMZN'  ,     258.63, 'USD',   20.8,    0, 'Handel'      , 'USA'            , 'stocks/amzn'],
  ['Broadcom'                    , 'AVGO'  ,     368.45, 'USD',  61.32, 0.71, 'Halbleiter'  , 'USA'            , 'stocks/avgo'],
  ['Meta Platforms'              , 'META'  ,      549.9, 'USD',  20.72, 0.38, 'Technologie' , 'USA'            , 'stocks/meta'],
  ['Tesla'                       , 'TSLA'  ,     362.86, 'USD', 376.55,    0, 'Automobil'   , 'USA'            , 'stocks/tsla'],
  ['Berkshire Hathaway'          , 'BRK.B' ,     495.82, 'USD',  12.37,    0, 'Finanzen'    , 'USA'            , 'stocks/brk.b'],
  ['Micron Technology'           , 'MU'    ,     966.78, 'USD',  21.82, 0.06, 'Halbleiter'  , 'USA'            , 'stocks/mu'],
  ['JPMorgan Chase'              , 'JPM'   ,     351.58, 'USD',  15.09, 1.71, 'Banken'      , 'USA'            , 'stocks/jpm'],
  ['Walmart'                     , 'WMT'   ,      103.7, 'USD',  37.58, 0.95, 'Handel'      , 'USA'            , 'stocks/wmt'],
  ['AMD'                         , 'AMD'   ,     473.25, 'USD', 120.79,    0, 'Halbleiter'  , 'USA'            , 'stocks/amd'],
  ['Visa'                        , 'V'     ,     371.04, 'USD',  31.59, 0.72, 'Finanzen'    , 'USA'            , 'stocks/v'],
  ['Johnson & Johnson'           , 'JNJ'   ,     270.24, 'USD',  31.33, 1.98, 'Pharma'      , 'USA'            , 'stocks/jnj'],
  ['Cisco'                       , 'CSCO'  ,     111.04, 'USD',  33.35, 1.51, 'Technologie' , 'USA'            , 'stocks/csco'],
  ['Costco'                      , 'COST'  ,     947.74, 'USD',  47.67, 0.62, 'Handel'      , 'USA'            , 'stocks/cost'],
  ['Applied Materials'           , 'AMAT'  ,     492.32, 'USD',  42.47, 0.43, 'Halbleiter'  , 'USA'            , 'stocks/amat'],
  ['Caterpillar'                 , 'CAT'   ,      827.9, 'USD',  35.68, 0.79, 'Industrie'   , 'USA'            , 'stocks/cat'],
  ['Lam Research'                , 'LRCX'  ,        314, 'USD',  54.51, 0.33, 'Halbleiter'  , 'USA'            , 'stocks/lrcx'],
  ['Palantir'                    , 'PLTR'  ,     179.94, 'USD',  153.9,    0, 'Technologie' , 'USA'            , 'stocks/pltr'],
  ['Coca-Cola'                   , 'KO'    ,       91.1, 'USD',  27.38, 2.33, 'Nahrung'     , 'USA'            , 'stocks/ko'],
  ['Chevron'                     , 'CVX'   ,     205.27, 'USD',  19.71, 3.47, 'Energie'     , 'USA'            , 'stocks/cvx'],
  ['UnitedHealth'                , 'UNH'   ,     390.11, 'USD',  25.11, 2.38, 'Gesundheit'  , 'USA'            , 'stocks/unh'],
  ['Home Depot'                  , 'HD'    ,     335.61, 'USD',  23.48, 2.78, 'Handel'      , 'USA'            , 'stocks/hd'],
  ['Procter & Gamble'            , 'PG'    ,     144.68, 'USD',  21.84, 3.01, 'Konsum'      , 'USA'            , 'stocks/pg'],
  ['Merck & Co'                  , 'MRK'   ,     152.55, 'USD', 119.85, 2.23, 'Pharma'      , 'USA'            , 'stocks/mrk'],
  ['Goldman Sachs'               , 'GS'    ,    1039.28, 'USD',  16.08, 1.92, 'Banken'      , 'USA'            , 'stocks/gs'],
  ['Netflix'                     , 'NFLX'  ,      79.59, 'USD',  25.07,    0, 'Medien'      , 'USA'            , 'stocks/nflx'],
  ['Texas Instruments'           , 'TXN'   ,     264.36, 'USD',  40.16, 2.15, 'Halbleiter'  , 'USA'            , 'stocks/txn'],
  ['KLA'                         , 'KLAC'  ,     183.99, 'USD',  50.27,  0.5, 'Halbleiter'  , 'USA'            , 'stocks/klac'],
  ['American Express'            , 'AXP'   ,        336, 'USD',   20.4, 1.13, 'Finanzen'    , 'USA'            , 'stocks/axp'],
  ['Palo Alto Networks'          , 'PANW'  ,     357.87, 'USD', 346.02,    0, 'Technologie' , 'USA'            , 'stocks/panw'],
  ['Intel'                       , 'INTC'  ,      90.07, 'USD', null  ,    0, 'Halbleiter'  , 'USA'            , 'stocks/intc'],
  ['Mastercard'                  , 'MA'    ,     580.63, 'USD',  31.93,  0.6, 'Finanzen'    , 'USA'            , 'stocks/ma'],
  ['Eli Lilly'                   , 'LLY'   ,     1255.4, 'USD',  42.14, 0.55, 'Pharma'      , 'USA'            , 'stocks/lly'],
  ['ExxonMobil'                  , 'XOM'   ,     165.11, 'USD',  21.29,  2.5, 'Energie'     , 'USA'            , 'stocks/xom'],
  ['Oracle'                      , 'ORCL'  ,     146.47, 'USD',  25.12, 1.37, 'Technologie' , 'USA'            , 'stocks/orcl'],
  ['GE Aerospace'                , 'GE'    ,     348.37, 'USD',  41.06, 0.54, 'Luftfahrt'   , 'USA'            , 'stocks/ge'],
  ['Bank of America'             , 'BAC'   ,      61.69, 'USD',  14.25, 2.08, 'Banken'      , 'USA'            , 'stocks/bac'],

  // ---------- Asien und Sonstige, Kurse in Dollar (Zweitnotiz in New York) ----------
  ['TSMC'                        , 'TSM'   ,     418.95, 'USD',  28.17, 0.77, 'Halbleiter'  , 'Taiwan'         , 'stocks/tsm'],
  ['SK hynix'                    , 'SKHY'  ,    1730000, 'KRW',    7.6, 0.17, 'Halbleiter'  , 'Suedkorea'      , 'quote/krx/000660'],
  ['Alibaba'                     , 'BABA'  ,     119.34, 'USD',  27.24, 0.88, 'Handel'      , 'China'          , 'stocks/baba'],
  ['Mitsubishi UFJ'              , 'MUFG'  ,      22.04, 'USD',  20.26, 2.01, 'Banken'      , 'Japan'          , 'stocks/mufg'],
  ['Arm Holdings'                , 'ARM'   ,     243.32, 'USD', 248.36,    0, 'Halbleiter'  , 'Grossbritannien', 'stocks/arm'],
  ['Shell'                       , 'SHEL'  ,      93.33, 'USD',   9.92, 3.24, 'Energie'     , 'Grossbritannien', 'stocks/shel'],
  ['AstraZeneca'                 , 'AZN'   ,     165.98, 'USD',  24.77, 1.95, 'Pharma'      , 'Grossbritannien', 'stocks/azn'],
  ['HSBC'                        , 'HSBC'  ,     104.15, 'USD',  16.81, 3.58, 'Banken'      , 'Grossbritannien', 'stocks/hsbc'],
  ['Novartis'                    , 'NVS'   ,     158.86, 'USD',  23.69, 1.94, 'Pharma'      , 'Schweiz'        , 'stocks/nvs'],
  ['Royal Bank of Canada'        , 'RY'    ,     205.23, 'USD',  17.96, 2.31, 'Banken'      , 'Kanada'         , 'stocks/ry'],

  // ---------- Deutschland (MDAX/DAX-Nachzuegler) ----------
  ['Porsche AG'                  , 'P911'  ,      45.01, 'EUR',  48.64, 2.26, 'Automobil'   , 'Deutschland'    , 'quote/etr/P911'],
  ['Fresenius'                   , 'FRE'   ,       46.6, 'EUR',  16.79, 2.26, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FRE'],
  ['Fresenius Medical Care'      , 'FME'   ,      40.14, 'EUR',     12, 3.66, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FME'],
  ['Symrise'                     , 'SY1'   ,         90, 'EUR',   50.9, 1.43, 'Chemie'      , 'Deutschland'    , 'quote/etr/SY1'],
  ['Sartorius Vorzuege'          , 'SRT3'  ,      246.8, 'EUR',  78.05, 0.32, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/SRT3'],
  ['Talanx'                      , 'TLX'   ,      120.8, 'EUR',  11.98, 3.06, 'Versicherung', 'Deutschland'    , 'quote/etr/TLX'],

  // ---------- Europa ohne Deutschland ----------
  ['Publicis Groupe'             , 'PUB'   ,     102.35, 'EUR',  15.94, 3.68, 'Medien'      , 'Frankreich'     , 'quote/epa/PUB'],
  ['Stellantis'                  , 'STLA'  ,      4.649, 'EUR', null  ,    0, 'Automobil'   , 'Niederlande'    , 'quote/epa/STLAP'],
  ['Prosus'                      , 'PRX'   ,     38.295, 'EUR',   8.44, 0.74, 'Technologie' , 'Niederlande'    , 'quote/ams/PRX'],
  ['Generali'                    , 'G'     ,      42.99, 'EUR',  14.58, 3.83, 'Versicherung', 'Italien'        , 'quote/bit/G'],
  ['BBVA'                        , 'BBVA'  ,      24.82, 'EUR',  13.12, 3.71, 'Banken'      , 'Spanien'        , 'quote/bme/BBVA'],
  ['Telefonica'                  , 'TEF'   ,      3.622, 'EUR', null  , 8.15, 'Telekom'     , 'Spanien'        , 'quote/bme/TEF'],
  ['KBC Group'                   , 'KBC'   ,     130.75, 'EUR',  14.49, 3.89, 'Banken'      , 'Belgien'        , 'quote/ebr/KBC'],

  // ---------- Grossbritannien, Kurse in Pence (GBX) an der LSE ----------
  ['Unilever'                    , 'ULVR'  ,       4681, 'GBX',  21.33, 3.71, 'Konsum'      , 'Grossbritannien', 'quote/lon/ULVR'],
  ['BP'                          , 'BP1'   ,      549.5, 'GBX',  21.15, 4.65, 'Energie'     , 'Grossbritannien', 'quote/lon/BP'],
  ['GSK'                         , 'GSK'   ,     1918.5, 'GBX',  16.28, 3.81, 'Pharma'      , 'Grossbritannien', 'quote/lon/GSK'],
  ['Diageo'                      , 'DGE'   ,       1719, 'GBX',  29.28, 2.13, 'Nahrung'     , 'Grossbritannien', 'quote/lon/DGE'],
  ['Rio Tinto'                   , 'RIO'   ,       7648, 'GBX',  13.75, 3.85, 'Industrie'   , 'Grossbritannien', 'quote/lon/RIO'],
  ['Barclays'                    , 'BARC'  ,      492.6, 'GBX',  10.24, 1.73, 'Banken'      , 'Grossbritannien', 'quote/lon/BARC'],
  ['Lloyds Banking Group'        , 'LLOY'  ,     111.25, 'GBX',  13.94, 3.24, 'Banken'      , 'Grossbritannien', 'quote/lon/LLOY'],
  ['BAE Systems'                 , 'BA1'   ,       2126, 'GBX',  30.46, 1.68, 'Ruestung'    , 'Grossbritannien', 'quote/lon/BA'],
  ['Rolls-Royce'                 , 'RR'    ,     1502.2, 'GBX',  41.52, 0.79, 'Luftfahrt'   , 'Grossbritannien', 'quote/lon/RR'],

  // ---------- Schweiz, Kurse in Franken an der SIX ----------
  ['Nestle'                      , 'NESN'  ,      79.68, 'CHF',  27.56, 3.91, 'Nahrung'     , 'Schweiz'        , 'quote/swx/NESN'],
  ['Roche'                       , 'RO'    ,  379.60001, 'CHF',  24.28, 2.94, 'Pharma'      , 'Schweiz'        , 'quote/swx/RO'],
  ['Zurich Insurance'            , 'ZURN'  ,        586, 'CHF',   14.7, 5.12, 'Versicherung', 'Schweiz'        , 'quote/swx/ZURN'],
  ['ABB'                         , 'ABBN'  ,       80.2, 'CHF',  36.49, 1.17, 'Industrie'   , 'Schweiz'        , 'quote/swx/ABBN'],
  ['UBS Group'                   , 'UBSG'  ,       42.5, 'CHF',  17.92, 2.05, 'Banken'      , 'Schweiz'        , 'quote/swx/UBSG'],
  ['Richemont'                   , 'CFR'   ,     185.75, 'CHF',  34.19, 1.76, 'Luxus'       , 'Schweiz'        , 'quote/swx/CFR'],
  ['Holcim'                      , 'HOLN'  ,       70.3, 'CHF',  99.89, 2.44, 'Bau'         , 'Schweiz'        , 'quote/swx/HOLN'],
  ['Sika'                        , 'SIKA'  ,      185.8, 'CHF',  28.67,    2, 'Chemie'      , 'Schweiz'        , 'quote/swx/SIKA'],
  ['Swiss Re'                    , 'SREN'  ,      139.3, 'CHF',   10.5, 4.57, 'Versicherung', 'Schweiz'        , 'quote/swx/SREN'],
  ['Lonza'                       , 'LONN'  ,  592.20001, 'CHF',  38.28, 0.88, 'Pharma'      , 'Schweiz'        , 'quote/swx/LONN'],

  // ---------- Japan, Kurse in Yen an der Boerse Tokio ----------
  ['Toyota Motor'                , '7203'  ,       3132, 'JPY',   8.97, 3.31, 'Automobil'   , 'Japan'          , 'quote/tyo/7203'],
  ['Sony Group'                  , '6758'  ,       3785, 'JPY',   20.2, 0.92, 'Technologie' , 'Japan'          , 'quote/tyo/6758'],
  ['Nintendo'                    , '7974'  ,       8599, 'JPY',  20.99, 1.89, 'Medien'      , 'Japan'          , 'quote/tyo/7974'],
  ['Keyence'                     , '6861'  ,      79900, 'JPY',  39.37, 0.69, 'Industrie'   , 'Japan'          , 'quote/tyo/6861'],
  ['Tokyo Electron'              , '8035'  ,      54290, 'JPY',  40.08, 1.37, 'Halbleiter'  , 'Japan'          , 'quote/tyo/8035'],
  ['Advantest'                   , '6857'  ,      35900, 'JPY',  56.96, 0.17, 'Halbleiter'  , 'Japan'          , 'quote/tyo/6857'],
  ['SoftBank Group'              , '9984'  ,       5255, 'JPY',   6.11,  0.2, 'Technologie' , 'Japan'          , 'quote/tyo/9984'],
  ['Hitachi'                     , '6501'  ,       5196, 'JPY',  29.37, 1.07, 'Industrie'   , 'Japan'          , 'quote/tyo/6501'],
  ['Mitsubishi Corporation'      , '8058'  ,       4794, 'JPY',  20.05, 2.69, 'Handel'      , 'Japan'          , 'quote/tyo/8058'],
  ['Shin-Etsu Chemical'          , '4063'  ,       6051, 'JPY',  23.62, 1.88, 'Chemie'      , 'Japan'          , 'quote/tyo/4063'],
  ['Takeda Pharmaceutical'       , '4502'  ,       5764, 'JPY', null  , 3.54, 'Pharma'      , 'Japan'          , 'quote/tyo/4502'],
  ['Honda Motor'                 , '7267'  ,       1753, 'JPY', null  , 4.09, 'Automobil'   , 'Japan'          , 'quote/tyo/7267'],
  ['Sumitomo Mitsui Financial'   , '8316'  ,       6606, 'JPY',  20.04, 2.74, 'Banken'      , 'Japan'          , 'quote/tyo/8316'],
  ['Fast Retailing'              , '9983'  ,      73510, 'JPY',  43.44, 0.85, 'Handel'      , 'Japan'          , 'quote/tyo/9983'],
  ['Nippon Telegraph & Telephone', '9432'  ,      166.1, 'JPY',  12.93, 3.35, 'Telekom'     , 'Japan'          , 'quote/tyo/9432'],

  // ---------- Suedkorea, Kurse in Won an der KRX ----------
  ['Samsung Electronics'         , '005930',     281500, 'KRW',  12.55,  0.8, 'Technologie' , 'Suedkorea'      , 'quote/krx/005930'],
  ['Hyundai Motor'               , '005380',     415000, 'KRW',  13.32,  2.4, 'Automobil'   , 'Suedkorea'      , 'quote/krx/005380'],
  ['Kia'                         , '000270',     130900, 'KRW',   7.27, 4.96, 'Automobil'   , 'Suedkorea'      , 'quote/krx/000270'],
  ['NAVER'                       , '035420',     222000, 'KRW',  16.57, 1.21, 'Technologie' , 'Suedkorea'      , 'quote/krx/035420'],
  ['Samsung Biologics'           , '207940',    1551000, 'KRW',   26.1,    0, 'Pharma'      , 'Suedkorea'      , 'quote/krx/207940'],
  ['POSCO Holdings'              , '005490',     310000, 'KRW',   17.4, 2.58, 'Industrie'   , 'Suedkorea'      , 'quote/krx/005490'],
  ['LG Energy Solution'          , '373220',     343500, 'KRW', null  ,    0, 'Industrie'   , 'Suedkorea'      , 'quote/krx/373220'],

  // ---------- Hongkong, Kurse in Hongkong-Dollar ----------
  ['Tencent Holdings'            , '0700'  ,        457, 'HKD',  15.56, 1.16, 'Technologie' , 'Hongkong'       , 'quote/hkg/0700'],
  ['AIA Group'                   , '1299'  ,      75.15, 'HKD',  12.54, 2.57, 'Versicherung', 'Hongkong'       , 'quote/hkg/1299'],
  ['Hong Kong Exchanges'         , '0388'  ,        421, 'HKD',  26.94, 3.53, 'Finanzen'    , 'Hongkong'       , 'quote/hkg/0388'],

  // ---------- Kanada, Kurse in kanadischen Dollar an der TSX ----------
  ['Shopify'                     , 'SHOP'  ,     205.61, 'CAD',  96.57,    0, 'Technologie' , 'Kanada'         , 'quote/tsx/SHOP'],
  ['Toronto-Dominion Bank'       , 'TD'    ,     161.24, 'CAD',  19.05, 2.78, 'Banken'      , 'Kanada'         , 'quote/tsx/TD'],
  ['Bank of Nova Scotia'         , 'BNS'   ,     120.57, 'CAD',  16.61, 3.78, 'Banken'      , 'Kanada'         , 'quote/tsx/BNS'],
  ['Bank of Montreal'            , 'BMO'   ,     240.25, 'CAD',  18.45, 2.86, 'Banken'      , 'Kanada'         , 'quote/tsx/BMO'],
  ['Enbridge'                    , 'ENB'   ,      69.51, 'CAD',  26.85, 5.58, 'Energie'     , 'Kanada'         , 'quote/tsx/ENB'],
  ['Canadian Natural Resources'  , 'CNQ'   ,      70.81, 'CAD',   12.6, 3.54, 'Energie'     , 'Kanada'         , 'quote/tsx/CNQ'],
  ['Canadian National Railway'   , 'CNR'   ,     178.73, 'CAD',  22.94, 2.05, 'Logistik'    , 'Kanada'         , 'quote/tsx/CNR'],
  ['Canadian Pacific Kansas City', 'CP'    ,     133.08, 'CAD',  30.95, 0.82, 'Logistik'    , 'Kanada'         , 'quote/tsx/CP'],
  ['BCE'                         , 'BCE'   ,      32.65, 'CAD',   4.86, 5.34, 'Telekom'     , 'Kanada'         , 'quote/tsx/BCE'],
  ['Brookfield Corporation'      , 'BN1'   ,       57.4, 'CAD',   75.2, 0.67, 'Finanzen'    , 'Kanada'         , 'quote/tsx/BN'],

  // ---------- USA ----------
  ['Boeing'                      , 'BA'    ,      214.2, 'USD',  79.88,    0, 'Luftfahrt'   , 'USA'            , 'stocks/ba'],
  ['Walt Disney'                 , 'DIS'   ,     107.78, 'USD',  22.28, 1.39, 'Medien'      , 'USA'            , 'stocks/dis'],
  ['Verizon Communications'      , 'VZ'    ,      49.45, 'USD',  12.88, 5.72, 'Telekom'     , 'USA'            , 'stocks/vz'],
  ['Lockheed Martin'             , 'LMT'   ,     563.57, 'USD',  20.77, 2.45, 'Ruestung'    , 'USA'            , 'stocks/lmt'],
  ['American Tower'              , 'AMT'   ,      175.8, 'USD',  24.18, 4.07, 'Immobilien'  , 'USA'            , 'stocks/amt'],
  ['Salesforce'                  , 'CRM'   ,     209.17, 'USD',  24.28, 0.84, 'Technologie' , 'USA'            , 'stocks/crm'],
  ['Adobe'                       , 'ADBE'  ,      275.3, 'USD',  15.75,    0, 'Technologie' , 'USA'            , 'stocks/adbe'],
  ['Qualcomm'                    , 'QCOM'  ,     160.75, 'USD',   18.7, 2.29, 'Halbleiter'  , 'USA'            , 'stocks/qcom'],
  ['IBM'                         , 'IBM'   ,     235.68, 'USD',  20.96, 2.87, 'Technologie' , 'USA'            , 'stocks/ibm'],
  ['Pfizer'                      , 'PFE'   ,      28.07, 'USD',   36.9, 6.13, 'Pharma'      , 'USA'            , 'stocks/pfe'],
  ['AbbVie'                      , 'ABBV'  ,     264.96, 'USD',  74.85, 2.61, 'Pharma'      , 'USA'            , 'stocks/abbv'],
  ['McDonald\'s'                 , 'MCD'   ,     270.95, 'USD',  22.01, 2.75, 'Nahrung'     , 'USA'            , 'stocks/mcd'],
  ['Nike'                        , 'NKE'   ,      40.76, 'USD',  19.41, 4.02, 'Konsum'      , 'USA'            , 'stocks/nke'],
  ['PepsiCo'                     , 'PEP'   ,     143.48, 'USD',   18.8, 4.13, 'Nahrung'     , 'USA'            , 'stocks/pep'],
  ['Coinbase'                    , 'COIN'  ,     186.49, 'USD', null  ,    0, 'Finanzen'    , 'USA'            , 'stocks/coin'],





];

/**
 * ETFs. Kurse in Dollar von stockanalysis.com.
 * Die Namen sind die offiziellen Produktnamen derselben Quelle - keine
 * eingedeutschten Gattungsbegriffe. Ein ETF, der schlicht 'Immobilien' heisst,
 * ist von einer Meldung ueber 'Immobilienwerte' nicht zu unterscheiden; mit
 * 'Vanguard Real Estate ETF' sieht man, dass hier ein echtes Produkt liegt.
 *
 * [name, kuerzel, kurs, fondsvolumenMrdUsd, anzahlPositionen, ter,
 *  ausschuettend, bereich, anlageklasse, quelle]
 *
 * TER und Ausschuettungsart standen bis 2026-08-08 in einer eigenen Tabelle
 * daneben, weil sie aus einer zweiten Quelle kamen. Sie sind hier
 * eingewandert, seit hole-kurse.js die Produktseite je ETF abruft und alles
 * aus einem Abruf hat. Zwei getrennte Tabellen waren eine Falle: wer einen
 * ETF nur in der einen ergaenzt, bekommt still ein null statt einer TER.
 *
 * Ausschuettungsart: alle sind US-Produkte. Ein US-Investmentfonds muss den
 * Grossteil seiner Ertraege ausschuetten, um steuerlich als Regulated
 * Investment Company zu gelten - thesaurierende ETFs gibt es dort praktisch
 * nicht. Die Rohstoff- und Krypto-Trusts sind die Ausnahme, aber aus einem
 * anderen Grund: sie halten einen Sachwert und erwirtschaften ueberhaupt
 * keine Ertraege, die auszuschuetten waeren. hole-kurse.js liest das am
 * gemeldeten Zahlrhythmus ab, statt es zu setzen.
 */

const ETFS = [






  ['Vanguard S&P 500 ETF'                             , 'VOO' , 703.71,  1030,   518, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/voo'],
  ['Invesco QQQ Trust'                                , 'QQQ' , 713.44, 488.9,   105, 0.18, true, 'USA Technologie' , 'Aktien'  , 'etf/qqq'],
  ['Vanguard Total World Stock ETF'                   , 'VT'  , 160.77,    81, 10144, 0.06, true, 'Welt'            , 'Aktien'  , 'etf/vt'],
  ['Vanguard FTSE Developed Markets ETF'              , 'VEA' ,  73.42, 235.4,  3877, 0.03, true, 'Welt ohne USA'   , 'Aktien'  , 'etf/vea'],
  ['Vanguard FTSE Emerging Markets ETF'               , 'VWO' ,  60.45, 124.8,  5063, 0.06, true, 'Schwellenlaender', 'Aktien'  , 'etf/vwo'],
  ['iShares MSCI EAFE ETF'                            , 'EFA' , 108.24,  79.2,   699, 0.32, true, 'Europa/Asien'    , 'Aktien'  , 'etf/efa'],
  ['iShares Russell 2000 ETF'                         , 'IWM' , 299.96,    82,  1971, 0.19, true, 'USA klein'       , 'Aktien'  , 'etf/iwm'],
  ['iShares Core S&P Mid-Cap ETF'                     , 'IJH' ,  76.77, 126.5,   414, 0.05, true, 'USA mittel'      , 'Aktien'  , 'etf/ijh'],
  ['SPDR Dow Jones Industrial Average ETF'            , 'DIA' , 532.22,  46.4,    31, 0.16, true, 'USA Standard'    , 'Aktien'  , 'etf/dia'],
  ['Invesco S&P 500 Equal Weight ETF'                 , 'RSP' , 221.67,  99.5,   509,  0.2, true, 'USA breit'       , 'Aktien'  , 'etf/rsp'],
  ['Vanguard Growth ETF'                              , 'VUG' ,   87.5, 225.9,   151, 0.03, true, 'USA Wachstum'    , 'Aktien'  , 'etf/vug'],
  ['Vanguard Value ETF'                               , 'VTV' ,  226.4, 193.6,   326, 0.03, true, 'USA Substanz'    , 'Aktien'  , 'etf/vtv'],
  ['Schwab US Dividend Equity ETF'                    , 'SCHD',  35.11, 109.5,   103, 0.06, true, 'Dividenden'      , 'Aktien'  , 'etf/schd'],
  ['Vanguard High Dividend Yield ETF'                 , 'VYM' , 164.97,  83.8,   618, 0.04, true, 'Dividenden'      , 'Aktien'  , 'etf/vym'],
  ['Technology Select Sector SPDR'                    , 'XLK' , 183.31, 121.1,    76, 0.08, true, 'Technologie'     , 'Aktien'  , 'etf/xlk'],
  ['iShares Semiconductor ETF'                        , 'SOXX', 520.05,  41.4,    34, 0.33, true, 'Halbleiter'      , 'Aktien'  , 'etf/soxx'],
  ['Health Care Select Sector SPDR'                   , 'XLV' , 174.62,  44.2,    63, 0.08, true, 'Gesundheit'      , 'Aktien'  , 'etf/xlv'],
  ['Financial Select Sector SPDR'                     , 'XLF' ,  57.48,  57.1,    80, 0.08, true, 'Finanzen'        , 'Aktien'  , 'etf/xlf'],
  ['Energy Select Sector SPDR'                        , 'XLE' ,  63.64,  41.9,    24, 0.08, true, 'Energie'         , 'Aktien'  , 'etf/xle'],
  ['Vanguard Real Estate ETF'                         , 'VNQ' ,   98.5,  38.6,   157, 0.13, true, 'Immobilien'      , 'Aktien'  , 'etf/vnq'],
  ['SPDR Gold Shares'                                 , 'GLD' , 423.36, 145.1,     2,  0.4, true, 'Rohstoffe'       , 'Rohstoff', 'etf/gld'],
  ['iShares Core US Aggregate Bond ETF'               , 'AGG' ,  97.35,   138, 13371, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/agg'],
  ['iShares 20+ Year Treasury Bond ETF'               , 'TLT' ,  82.05,  46.1,    48, 0.15, true, 'Anleihen'        , 'Anleihen', 'etf/tlt'],
  ['Vanguard Interm.-Term Corp. Bond ETF'             , 'VCIT',  81.05,    68,  2268, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/vcit'],
  ['iShares Bitcoin Trust'                            , 'IBIT',  43.68,  48.4,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/ibit'],

  // ---------- Ausbau 2026-08-08 ----------
  ['SPDR S&P 500 ETF Trust'                           , 'SPY' , 765.72, 814.5,   505, 0.09, true, 'USA breit'       , 'Aktien'  , 'etf/spy'],
  ['iShares Core S&P 500 ETF'                         , 'IVV' , 769.31,   894,   508, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/ivv'],
  ['Vanguard Total Stock Market ETF'                  , 'VTI' , 378.24, 688.6,  3498, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/vti'],
  ['iShares Core MSCI EAFE ETF'                       , 'IEFA', 100.85, 193.2,  2641, 0.07, true, 'Europa/Asien'    , 'Aktien'  , 'etf/iefa'],
  ['iShares Core MSCI Emerging Markets ETF'           , 'IEMG',  81.57, 156.5,  2896, 0.09, true, 'Schwellenlaender', 'Aktien'  , 'etf/iemg'],
  ['iShares MSCI Japan ETF'                           , 'EWJ' ,  95.18,  22.5,   174, 0.49, true, 'Japan'           , 'Aktien'  , 'etf/ewj'],
  ['iShares MSCI Eurozone ETF'                        , 'EZU' ,  71.49,   9.9,   226,  0.5, true, 'Eurozone'        , 'Aktien'  , 'etf/ezu'],
  ['iShares China Large-Cap ETF'                      , 'FXI' ,  35.86,   4.2,    59, 0.74, true, 'China'           , 'Aktien'  , 'etf/fxi'],
  ['iShares MSCI India ETF'                           , 'INDA',  49.64,   6.6,   173, 0.61, true, 'Indien'          , 'Aktien'  , 'etf/inda'],
  ['Industrial Select Sector SPDR'                    , 'XLI' , 180.25,  34.2,    86, 0.08, true, 'Industrie'       , 'Aktien'  , 'etf/xli'],
  ['Consumer Discretionary Select Sector SPDR'        , 'XLY' , 118.02,  23.1,    50, 0.08, true, 'Konsum'          , 'Aktien'  , 'etf/xly'],
  ['Consumer Staples Select Sector SPDR'              , 'XLP' ,  85.99,  14.8,    38, 0.08, true, 'Nahrung'         , 'Aktien'  , 'etf/xlp'],
  ['Utilities Select Sector SPDR'                     , 'XLU' ,  42.77,  22.8,    34, 0.08, true, 'Versorger'       , 'Aktien'  , 'etf/xlu'],
  ['Communication Services Select Sector SPDR'        , 'XLC' ,  111.4,  22.3,    26, 0.08, true, 'Medien'          , 'Aktien'  , 'etf/xlc'],
  ['iShares Silver Trust'                             , 'SLV' ,  62.72,  32.1,     1,  0.5, true, 'Rohstoffe'       , 'Rohstoff', 'etf/slv'],
  ['Invesco DB Commodity Index Tracking Fund'         , 'DBC' ,  31.26,   1.8,    41, 0.84, true, 'Rohstoffe'       , 'Rohstoff', 'etf/dbc'],
  ['iShares iBoxx Investment Grade Corporate Bond ETF', 'LQD' , 105.92,    34,  3143, 0.14, true, 'Anleihen'        , 'Anleihen', 'etf/lqd'],
  ['iShares iBoxx High Yield Corporate Bond ETF'      , 'HYG' ,  79.61,  17.8,  1333, 0.49, true, 'Anleihen'        , 'Anleihen', 'etf/hyg'],
  ['iShares Ethereum Trust'                           , 'ETHA',  18.24,   5.8,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/etha'],





];

/**
 * Kryptowaehrungen. Kurse und Kennzahlen direkt in Euro von CoinGecko -
 * deshalb steht hier keine Waehrungsspalte und nichts wird umgerechnet.
 * [name, kuerzel, kurs, marktkapitalisierung, umlaufmenge, hoechstmenge,
 *  allzeithoch, quelle]
 * hoechstmenge === null heisst: unbegrenzt (Ethereum, Solana, Dogecoin).
 *
 * ⚠️ Coins unter etwa einem Cent gehoeren hier NICHT herein, so bekannt sie
 * sein moegen. `kursText()` in bildschirme.js zeigt Kurse unter einem Euro
 * mit vier Nachkommastellen - Shiba Inu (0,0000041 EUR) staende in der
 * gesamten App als "0,0000 €", im Marktueberblick wie im Kaufdialog. Beim
 * Ausbau am 2026-08-08 deshalb gegen Aave getauscht. Wer so einen Coin
 * aufnehmen will, muss vorher die Anzeige koennen, nicht danach.
 */
const KRYPTO = [






  ['Bitcoin'     , 'BTC' ,    65948, 1323977695414,     20071518,     21000000,   107662, 'coingecko/bitcoin'],
  ['Ethereum'    , 'ETH' ,   2070.8,  250068454370,    120681574, null        ,  4229.76, 'coingecko/ethereum'],
  ['XRP'         , 'XRP' ,     1.27,   79682388101,  62744504852, 100000000000,     3.28, 'coingecko/ripple'],
  ['Solana'      , 'SOL' ,    80.21,   46809183027,    583176988, null        ,    285.6, 'coingecko/solana'],
  ['Dogecoin'    , 'DOGE', 0.077305,   12026887144, 155598386384, null        , 0.601466, 'coingecko/dogecoin'],
  ['Cardano'     , 'ADA' , 0.191627,    7191248170,  37486094748,  45000000000,     2.61, 'coingecko/cardano'],
  ['Chainlink'   , 'LINK',    10.02,    7500454815,    748099970,   1000000000,    43.32, 'coingecko/chainlink'],
  ['Litecoin'    , 'LTC' ,     44.3,    3437289555,     77523073,     84000000,   337.56, 'coingecko/litecoin'],
  ['Avalanche'   , 'AVAX',      6.4,    2765683069,    431771961,    720000000,   128.43, 'coingecko/avalanche-2'],
  ['Polkadot'    , 'DOT' , 0.790268,    1344139402,   1699205782,   2100000000,     47.6, 'coingecko/polkadot'],

  // ---------- Ausbau 2026-08-08 ----------
  ['BNB'         , 'BNB' ,   591.26,   78828608224,    133163134,    200000000,  1182.86, 'coingecko/binancecoin'],
  ['Tron'        , 'TRX' , 0.293974,   27904282970,  94912588660, null        , 0.410308, 'coingecko/tron'],
  ['Toncoin'     , 'TON' ,     1.23,    3392405643,   2762567808, null        ,      7.7, 'coingecko/the-open-network'],
  ['Aave'        , 'AAVE',   105.67,    1632750725,     15423210,     16000000,   541.28, 'coingecko/aave'],
  ['Stellar'     , 'XLM' , 0.170196,    5887511712,  34585312164, null        , 0.729104, 'coingecko/stellar'],
  ['Bitcoin Cash', 'BCH' ,   237.75,    4781889784,     20078741,     21000000,  3187.12, 'coingecko/bitcoin-cash'],
  ['Monero'      , 'XMR' ,   365.48,    6866020084,     18794607, null        ,   685.48, 'coingecko/monero'],
  ['Uniswap'     , 'UNI' ,     3.64,    2272162282,    623546424,   1000000000,    37.37, 'coingecko/uniswap'],





];

// ---------------------------------------------------------------------------

function nachEuro(kurs, waehrung) {
  if (waehrung === 'EUR') return kurs;
  // GBX sind Pence: erst durch hundert, dann wie Pfund.
  if (waehrung === 'GBX') return kurs / 100 / WECHSELKURSE.GBP;
  const kk = WECHSELKURSE[waehrung];
  // Kein Rueckfall auf 1: eine unbekannte Waehrung stillschweigend als Euro
  // zu behandeln, waere ein Kursfehler um den Faktor 180 (Yen) - und die
  // Zahl saehe im Spiel voellig normal aus.
  if (!(kk > 0)) throw new Error('Kein Wechselkurs hinterlegt fuer: ' + waehrung);
  return kurs / kk;
}

// Auf sinnvolle Stellen runden: teure Werte auf Cent, billige Coins feiner.
function runde(zahl) {
  if (zahl >= 100) return Math.round(zahl * 100) / 100;
  if (zahl >= 1) return Math.round(zahl * 10000) / 10000;
  /* Unter einem Euro auf sechs BEDEUTSAME Stellen, nicht auf sechs
     Nachkommastellen. Der Unterschied wird erst bei Kleinstkursen sichtbar:
     ein Coin bei 0,0000041 EUR haette auf sechs Nachkommastellen gerundet
     0,000004 - eine einzige bedeutsame Stelle und damit bis zu 12 % daneben,
     mitten im Startkurs, an dem die ganze Partie haengt. */
  if (!(zahl > 0)) return zahl;
  return Number(zahl.toPrecision(6));
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

for (const [name, kuerzel, kurs, volumenMrd, positionen, ter, ausschuettend, bereich, anlageklasse] of ETFS) {
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
    ter: ter === undefined ? null : ter,
    ausschuettend: ausschuettend === undefined ? null : ausschuettend,
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

/* Die Sollzahlen stehen hier als feste Erwartung, nicht als Untergrenze.
   Die Mischung ist Balance: die drei Arten haben in markt.js sehr
   verschiedene Schwankungsprofile, und wer aus Versehen zehn Kryptos
   nachlegt, verschiebt das ganze Spiel - ohne dass eine einzige Zahl nach
   einem Fehler aussieht. Wer die Mischung absichtlich aendert, aendert diese
   drei Zahlen mit und sieht dabei, was er tut. */
const SOLL_AKTIEN = 188;
const SOLL_ETF = 44;
const SOLL_KRYPTO = 18;

const anzahlAktien = werte.filter((w) => w.art === 'aktie').length;
const anzahlKrypto = werte.filter((w) => w.art === 'krypto').length;
const anzahlEtf = werte.filter((w) => w.art === 'etf').length;

if (anzahlKrypto !== SOLL_KRYPTO) fehler.push('Erwartet ' + SOLL_KRYPTO + ' Kryptos, gefunden ' + anzahlKrypto);
if (anzahlEtf !== SOLL_ETF) fehler.push('Erwartet ' + SOLL_ETF + ' ETFs, gefunden ' + anzahlEtf);
if (anzahlAktien !== SOLL_AKTIEN) fehler.push('Erwartet ' + SOLL_AKTIEN + ' Aktien, gefunden ' + anzahlAktien);

/* Jeder Wert braucht eine eindeutige Quelle - sonst ist er ab dem naechsten
   Pflegelauf ein Karteileichenkurs. Und dieselbe Quelle zweimal heisst:
   derselbe Konzern steht zweimal im Spiel. Das faellt ueber die Kuerzel NICHT
   auf, weil eine Heimatnotiz und ein US-Schein verschiedene Kuerzel tragen
   (Novartis als NVS in New York und als NOVN in Zuerich waeren zwei Zeilen,
   ein Unternehmen und zwei Positionen im selben Depot). */
const quellen = new Map();
const namen = new Map();
for (const [tabelle, zeilen, spalte] of [['Aktien', AKTIEN, 8], ['ETFs', ETFS, 9], ['Krypto', KRYPTO, 7]]) {
  for (const zeile of zeilen) {
    const quelle = zeile[spalte];
    if (!quelle) fehler.push(tabelle + ': keine Quelle bei ' + zeile[0]);
    else if (quellen.has(quelle)) fehler.push('Quelle doppelt: ' + quelle + ' (' + quellen.get(quelle) + ' und ' + zeile[0] + ')');
    else quellen.set(quelle, zeile[0]);
    if (namen.has(zeile[0])) fehler.push('Name doppelt: ' + zeile[0]);
    else namen.set(zeile[0], true);
  }
}

// Ein Kurs von 0 oder NaN wuerde im Kursmotor durch Division alles zerreissen.
for (const w of werte) {
  if (!Number.isFinite(w.kurs) || w.kurs <= 0) fehler.push('Unbrauchbarer Kurs bei ' + w.name);
  if (w.art === 'aktie' && w.kgv !== null && w.gewinnJeAktie === null) {
    fehler.push('KGV ohne Gewinn je Aktie bei ' + w.name);
  }
}

if (fehler.length) {
  console.error('ABBRUCH - werte.js wurde NICHT geschrieben:');
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
    'stockanalysis.com (Kurse, KGV, Dividendenrendite, ETF-Kennzahlen)',
    'CoinGecko (Kryptokurse)',
    'frankfurter.dev / EZB (Wechselkurse)',
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

console.log('werte.js geschrieben: ' + werte.length + ' Werte  (Stand ' + STAND + ')');
console.log('  Aktien: ' + anzahlAktien + '  ETFs: ' + anzahlEtf + '  Krypto: ' + anzahlKrypto);
const ohneKgv = werte.filter((w) => w.art === 'aktie' && w.kgv === null).length;
const ohneTer = werte.filter((w) => w.art === 'etf' && w.ter === null).length;
console.log('  ohne KGV (zeigt im Spiel einen Strich): ' + ohneKgv);
console.log('  ohne TER (zeigt im Spiel einen Strich): ' + ohneTer);

// Die Laenderverteilung entscheidet, ob eine Laendermeldung ueberhaupt ein
// Depot trifft. Steht sie im Lauf, faellt eine Schieflage beim Ausbau auf,
// statt erst in der Partie.
const jeLand = {};
for (const w of werte) if (w.land) jeLand[w.land] = (jeLand[w.land] || 0) + 1;
const laender = Object.keys(jeLand).sort((a, b) => jeLand[b] - jeLand[a]);
console.log('  Laender: ' + laender.map((l) => l + ' ' + jeLand[l]).join(', '));
