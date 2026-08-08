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
const STAND = '2026-08-08';
const EUR_USD = 1.1535; // 1 EUR = 1.1535 USD (EZB via frankfurter.dev, 2026-08-07)

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
  CAD: 1.616,
  CHF: 0.9347,
  GBP: 0.85765,
  HKD: 9.0491,
  JPY: 182.64,
  KRW: 1633.3,
  USD: 1.1535,
};

/**
 * Aktien.
 * [name, kuerzel, kurs, waehrung, kgv, divRenditeProzent, sektor, land, quelle]
 * kgv === null bedeutet: kein sinnvolles KGV (Verlustjahr) -> die App zeigt einen Strich.
 * quelle ist der Pfad bei stockanalysis.com, den hole-kurse.js abruft.
 */
const AKTIEN = [



  // ---------- Deutschland (DAX), Kurse in Euro, Xetra 2026-08-07 11:34 ----------
  ['SAP'                         , 'SAP'   ,  177.96001, 'EUR',  26.65, 1.46, 'Technologie' , 'Deutschland'    , 'quote/etr/SAP'],
  ['Siemens'                     , 'SIE'   ,  279.79999, 'EUR',  27.97, 1.96, 'Industrie'   , 'Deutschland'    , 'quote/etr/SIE'],
  ['Allianz'                     , 'ALV'   ,      433.5, 'EUR',  14.22, 3.94, 'Versicherung', 'Deutschland'    , 'quote/etr/ALV'],
  ['Rheinmetall'                 , 'RHM'   , 1146.40002, 'EUR',  43.93, 0.99, 'Ruestung'    , 'Deutschland'    , 'quote/etr/RHM'],
  ['Mercedes-Benz Group'         , 'MBG'   ,     47.085, 'EUR',   8.92, 7.48, 'Automobil'   , 'Deutschland'    , 'quote/etr/MBG'],
  ['BMW'                         , 'BMW'   ,      59.78, 'EUR',   5.68, 7.51, 'Automobil'   , 'Deutschland'    , 'quote/etr/BMW'],
  ['Volkswagen Vorzuege'         , 'VOW3'  ,      76.32, 'EUR',    7.3, 6.96, 'Automobil'   , 'Deutschland'    , 'quote/etr/VOW3'],
  ['Deutsche Bank'               , 'DBK'   ,      32.89, 'EUR',  10.62, 3.04, 'Banken'      , 'Deutschland'    , 'quote/etr/DBK'],
  ['Commerzbank'                 , 'CBK'   ,         39, 'EUR',  14.29, 2.86, 'Banken'      , 'Deutschland'    , 'quote/etr/CBK'],
  ['adidas'                      , 'ADS'   ,     164.05, 'EUR',  21.08,  1.7, 'Konsum'      , 'Deutschland'    , 'quote/etr/ADS'],
  ['Zalando'                     , 'ZAL'   ,      24.61, 'EUR',  66.74,    0, 'Handel'      , 'Deutschland'    , 'quote/etr/ZAL'],
  ['Infineon'                    , 'IFX'   ,      62.08, 'EUR',  67.45, 0.58, 'Halbleiter'  , 'Deutschland'    , 'quote/etr/IFX'],
  ['BASF'                        , 'BAS'   ,       51.5, 'EUR',  21.76, 4.38, 'Chemie'      , 'Deutschland'    , 'quote/etr/BAS'],
  ['Bayer'                       , 'BAYN'  ,      49.81, 'EUR', null  , 0.22, 'Pharma'      , 'Deutschland'    , 'quote/etr/BAYN'],
  ['Merck'                       , 'MRK1'  ,     143.65, 'EUR',  26.36, 1.52, 'Pharma'      , 'Deutschland'    , 'quote/etr/MRK'],
  ['Deutsche Telekom'            , 'DTE'   ,      29.04, 'EUR',  16.26, 3.43, 'Telekom'     , 'Deutschland'    , 'quote/etr/DTE'],
  ['DHL Group'                   , 'DHL'   ,      55.32, 'EUR',  16.84, 3.43, 'Logistik'    , 'Deutschland'    , 'quote/etr/DHL'],
  ['E.ON'                        , 'EOAN'  ,     19.025, 'EUR',  14.47, 3.01, 'Versorger'   , 'Deutschland'    , 'quote/etr/EOAN'],
  ['RWE'                         , 'RWE'   ,      56.22, 'EUR',  17.18, 2.13, 'Versorger'   , 'Deutschland'    , 'quote/etr/RWE'],
  ['Siemens Energy'              , 'ENR'   ,  153.53999, 'EUR',  49.94, 0.46, 'Versorger'   , 'Deutschland'    , 'quote/etr/ENR'],
  ['Muenchener Rueck'            , 'MUV2'  ,  515.40002, 'EUR',    9.6, 4.59, 'Versicherung', 'Deutschland'    , 'quote/etr/MUV2'],
  ['Hannover Rueck'              , 'HNR1'  ,      253.6, 'EUR',  10.65, 4.93, 'Versicherung', 'Deutschland'    , 'quote/etr/HNR1'],
  ['Deutsche Boerse'             , 'DB1'   ,  274.10001, 'EUR',  23.64, 1.56, 'Finanzen'    , 'Deutschland'    , 'quote/etr/DB1'],
  ['Beiersdorf'                  , 'BEI'   ,      81.38, 'EUR',  18.93, 1.22, 'Konsum'      , 'Deutschland'    , 'quote/etr/BEI'],
  ['Henkel Vorzuege'             , 'HEN3'  ,       79.8, 'EUR',  17.01, 2.59, 'Konsum'      , 'Deutschland'    , 'quote/etr/HEN3'],
  ['Continental'                 , 'CON'   ,       68.3, 'EUR', null  , 3.95, 'Automobil'   , 'Deutschland'    , 'quote/etr/CON'],
  ['Daimler Truck'               , 'DTG'   ,      46.72, 'EUR',  33.05, 3.95, 'Automobil'   , 'Deutschland'    , 'quote/etr/DTG'],
  ['MTU Aero Engines'            , 'MTX'   ,      370.8, 'EUR',  21.48, 0.96, 'Luftfahrt'   , 'Deutschland'    , 'quote/etr/MTX'],
  ['Heidelberg Materials'        , 'HEI'   ,  160.85001, 'EUR',  13.97, 2.24, 'Bau'         , 'Deutschland'    , 'quote/etr/HEI'],
  ['Vonovia'                     , 'VNA'   ,      21.05, 'EUR',   4.93, 6.03, 'Immobilien'  , 'Deutschland'    , 'quote/etr/VNA'],

  // ---------- Europa ohne Deutschland, Kurse in Euro ----------
  ['ASML'                        , 'ASML'  ,       1499, 'EUR',  54.43,  0.5, 'Halbleiter'  , 'Niederlande'    , 'quote/ams/ASML'],
  ['LVMH'                        , 'MC'    ,        480, 'EUR',  21.88,  2.7, 'Luxus'       , 'Frankreich'     , 'quote/epa/MC'],
  ['Hermes'                      , 'RMS'   ,     1635.5, 'EUR',  38.03,  1.1, 'Luxus'       , 'Frankreich'     , 'quote/epa/RMS'],
  ['LOreal'                      , 'OR'    ,      385.9, 'EUR',  32.76, 1.84, 'Konsum'      , 'Frankreich'     , 'quote/epa/OR'],
  ['TotalEnergies'               , 'TTE'   ,      74.09, 'EUR',  10.55, 4.61, 'Energie'     , 'Frankreich'     , 'quote/epa/TTE'],
  ['Sanofi'                      , 'SAN'   ,      75.31, 'EUR',  23.19, 5.54, 'Pharma'      , 'Frankreich'     , 'quote/epa/SAN'],
  ['Air Liquide'                 , 'AI'    ,     172.38, 'EUR',  31.02, 1.95, 'Chemie'      , 'Frankreich'     , 'quote/epa/AI'],
  ['Schneider Electric'          , 'SU'    ,  303.70001, 'EUR',  36.53,  1.4, 'Industrie'   , 'Frankreich'     , 'quote/epa/SU'],
  ['SAFRAN'                      , 'SAF'   ,  357.39999, 'EUR',  38.38, 0.94, 'Luftfahrt'   , 'Frankreich'     , 'quote/epa/SAF'],
  ['AXA'                         , 'CS'    ,      45.05, 'EUR',  12.16, 5.15, 'Versicherung', 'Frankreich'     , 'quote/epa/CS'],
  ['BNP Paribas'                 , 'BNP'   ,     112.44, 'EUR',   9.74, 4.56, 'Banken'      , 'Frankreich'     , 'quote/epa/BNP'],
  ['VINCI'                       , 'DG'    ,     125.35, 'EUR',   13.9, 3.95, 'Bau'         , 'Frankreich'     , 'quote/epa/DG'],
  ['Danone'                      , 'BN'    ,      68.22, 'EUR',   22.6,  3.3, 'Nahrung'     , 'Frankreich'     , 'quote/epa/BN'],
  ['EssilorLuxottica'            , 'EL'    ,      172.3, 'EUR',   32.2, 2.34, 'Konsum'      , 'Frankreich'     , 'quote/epa/EL'],
  ['Airbus'                      , 'AIR'   ,  213.60001, 'EUR',  28.44, 1.51, 'Luftfahrt'   , 'Niederlande'    , 'quote/epa/AIR'],
  ['Ferrari'                     , 'RACE'  ,  355.64999, 'EUR',  38.54, 1.02, 'Automobil'   , 'Italien'        , 'quote/bit/RACE'],
  ['Adyen'                       , 'ADYEN' ,      930.3, 'EUR',  27.68,    0, 'Finanzen'    , 'Niederlande'    , 'quote/ams/ADYEN'],
  ['ING Group'                   , 'INGA'  ,      30.49, 'EUR',  10.21, 4.29, 'Banken'      , 'Niederlande'    , 'quote/ams/INGA'],
  ['AB InBev'                    , 'ABI'   ,      72.86, 'EUR',  17.95, 1.57, 'Nahrung'     , 'Belgien'        , 'quote/ebr/ABI'],
  ['Inditex'                     , 'ITX'   ,      58.66, 'EUR',  29.08, 2.98, 'Handel'      , 'Spanien'        , 'quote/bme/ITX'],
  ['Banco Santander'             , 'SAN2'  ,     12.858, 'EUR',  14.45, 1.94, 'Banken'      , 'Spanien'        , 'quote/bme/SAN'],
  ['Iberdrola'                   , 'IBE'   ,       20.7, 'EUR',  25.37, 3.28, 'Versorger'   , 'Spanien'        , 'quote/bme/IBE'],
  ['Enel'                        , 'ENEL'  ,     10.044, 'EUR',  23.86, 4.91, 'Versorger'   , 'Italien'        , 'quote/bit/ENEL'],
  ['Eni'                         , 'ENI'   ,      23.28, 'EUR',  12.22, 4.64, 'Energie'     , 'Italien'        , 'quote/bit/ENI'],
  ['UniCredit'                   , 'UCG'   ,       84.4, 'EUR',  11.99, 3.73, 'Banken'      , 'Italien'        , 'quote/bit/UCG'],
  ['Intesa Sanpaolo'             , 'ISP'   ,      6.824, 'EUR',  12.29, 5.57, 'Banken'      , 'Italien'        , 'quote/bit/ISP'],

  // ---------- USA, Kurse in Dollar ----------
  ['NVIDIA'                      , 'NVDA'  ,     223.96, 'USD',   34.3, 0.45, 'Halbleiter'  , 'USA'            , 'stocks/nvda'],
  ['Apple'                       , 'AAPL'  ,     313.33, 'USD',  35.94, 0.34, 'Technologie' , 'USA'            , 'stocks/aapl'],
  ['Alphabet'                    , 'GOOGL' ,      354.3, 'USD',  17.78, 0.25, 'Technologie' , 'USA'            , 'stocks/googl'],
  ['Microsoft'                   , 'MSFT'  ,     499.99, 'USD',  27.85, 0.73, 'Technologie' , 'USA'            , 'stocks/msft'],
  ['Amazon'                      , 'AMZN'  ,     274.48, 'USD',  22.07,    0, 'Handel'      , 'USA'            , 'stocks/amzn'],
  ['Broadcom'                    , 'AVGO'  ,     427.76, 'USD',  71.19, 0.61, 'Halbleiter'  , 'USA'            , 'stocks/avgo'],
  ['Meta Platforms'              , 'META'  ,      592.1, 'USD',  22.31, 0.35, 'Technologie' , 'USA'            , 'stocks/meta'],
  ['Tesla'                       , 'TSLA'  ,     328.58, 'USD', 340.97,    0, 'Automobil'   , 'USA'            , 'stocks/tsla'],
  ['Berkshire Hathaway'          , 'BRK.B' ,      521.8, 'USD',  15.51,    0, 'Finanzen'    , 'USA'            , 'stocks/brk.b'],
  ['Micron Technology'           , 'MU'    ,     877.57, 'USD',   19.8, 0.07, 'Halbleiter'  , 'USA'            , 'stocks/mu'],
  ['JPMorgan Chase'              , 'JPM'   ,     357.52, 'USD',  15.34, 1.68, 'Banken'      , 'USA'            , 'stocks/jpm'],
  ['Walmart'                     , 'WMT'   ,     111.85, 'USD',  39.37, 0.89, 'Handel'      , 'USA'            , 'stocks/wmt'],
  ['AMD'                         , 'AMD'   ,     483.36, 'USD', 123.37,    0, 'Halbleiter'  , 'USA'            , 'stocks/amd'],
  ['Visa'                        , 'V'     ,      362.5, 'USD',  30.86, 0.74, 'Finanzen'    , 'USA'            , 'stocks/v'],
  ['Johnson & Johnson'           , 'JNJ'   ,     259.24, 'USD',  30.05, 2.07, 'Pharma'      , 'USA'            , 'stocks/jnj'],
  ['Cisco'                       , 'CSCO'  ,     121.43, 'USD',  40.47, 1.38, 'Technologie' , 'USA'            , 'stocks/csco'],
  ['Costco'                      , 'COST'  ,     947.82, 'USD',  47.67, 0.62, 'Handel'      , 'USA'            , 'stocks/cost'],
  ['Applied Materials'           , 'AMAT'  ,     539.14, 'USD',  50.71, 0.39, 'Halbleiter'  , 'USA'            , 'stocks/amat'],
  ['Caterpillar'                 , 'CAT'   ,     842.19, 'USD',  36.29, 0.77, 'Industrie'   , 'USA'            , 'stocks/cat'],
  ['Lam Research'                , 'LRCX'  ,     311.35, 'USD',  54.05, 0.33, 'Halbleiter'  , 'USA'            , 'stocks/lrcx'],
  ['Palantir'                    , 'PLTR'  ,     172.01, 'USD', 147.11,    0, 'Technologie' , 'USA'            , 'stocks/pltr'],
  ['Coca-Cola'                   , 'KO'    ,      87.05, 'USD',  26.16, 2.44, 'Nahrung'     , 'USA'            , 'stocks/ko'],
  ['Chevron'                     , 'CVX'   ,     186.56, 'USD',  17.92, 3.82, 'Energie'     , 'USA'            , 'stocks/cvx'],
  ['UnitedHealth'                , 'UNH'   ,     407.08, 'USD',  26.21, 2.28, 'Gesundheit'  , 'USA'            , 'stocks/unh'],
  ['Home Depot'                  , 'HD'    ,     355.62, 'USD',  25.26, 2.62, 'Handel'      , 'USA'            , 'stocks/hd'],
  ['Procter & Gamble'            , 'PG'    ,     145.79, 'USD',  22.01, 2.99, 'Konsum'      , 'USA'            , 'stocks/pg'],
  ['Merck & Co'                  , 'MRK'   ,     128.58, 'USD', 101.02, 2.64, 'Pharma'      , 'USA'            , 'stocks/mrk'],
  ['Goldman Sachs'               , 'GS'    ,    1039.61, 'USD',  16.08, 1.94, 'Banken'      , 'USA'            , 'stocks/gs'],
  ['Netflix'                     , 'NFLX'  ,      74.14, 'USD',  23.36,    0, 'Medien'      , 'USA'            , 'stocks/nflx'],
  ['Texas Instruments'           , 'TXN'   ,     286.08, 'USD',  43.46, 1.99, 'Halbleiter'  , 'USA'            , 'stocks/txn'],
  ['KLA'                         , 'KLAC'  ,     198.11, 'USD',  54.13, 0.46, 'Halbleiter'  , 'USA'            , 'stocks/klac'],
  ['American Express'            , 'AXP'   ,     340.91, 'USD',   20.7, 1.11, 'Finanzen'    , 'USA'            , 'stocks/axp'],
  ['Palo Alto Networks'          , 'PANW'  ,     363.86, 'USD', 351.82,    0, 'Technologie' , 'USA'            , 'stocks/panw'],
  ['Intel'                       , 'INTC'  ,     101.65, 'USD', null  ,    0, 'Halbleiter'  , 'USA'            , 'stocks/intc'],
  ['Mastercard'                  , 'MA'    ,     562.95, 'USD',  30.96, 0.62, 'Finanzen'    , 'USA'            , 'stocks/ma'],
  ['Eli Lilly'                   , 'LLY'   ,    1185.71, 'USD',   39.8, 0.58, 'Pharma'      , 'USA'            , 'stocks/lly'],
  ['ExxonMobil'                  , 'XOM'   ,     153.04, 'USD',  19.73, 2.69, 'Energie'     , 'USA'            , 'stocks/xom'],
  ['Oracle'                      , 'ORCL'  ,     147.02, 'USD',  25.22, 1.36, 'Technologie' , 'USA'            , 'stocks/orcl'],
  ['GE Aerospace'                , 'GE'    ,     370.08, 'USD',  43.62,  0.5, 'Luftfahrt'   , 'USA'            , 'stocks/ge'],
  ['Bank of America'             , 'BAC'   ,      63.17, 'USD',  14.59, 2.03, 'Banken'      , 'USA'            , 'stocks/bac'],

  // ---------- Asien und Sonstige, Kurse in Dollar (Zweitnotiz in New York) ----------
  ['TSMC'                        , 'TSM'   ,     420.04, 'USD',  27.31, 0.66, 'Halbleiter'  , 'Taiwan'         , 'stocks/tsm'],
  ['SK hynix'                    , 'SKHY'  ,    1422000, 'KRW',   6.23,  0.2, 'Halbleiter'  , 'Suedkorea'      , 'quote/krx/000660'],
  ['Alibaba'                     , 'BABA'  ,     128.41, 'USD',  20.13, 0.83, 'Handel'      , 'China'          , 'stocks/baba'],
  ['Mitsubishi UFJ'              , 'MUFG'  ,      22.49, 'USD',  20.75, 1.97, 'Banken'      , 'Japan'          , 'stocks/mufg'],
  ['Arm Holdings'                , 'ARM'   ,     282.57, 'USD', 288.43,    0, 'Halbleiter'  , 'Grossbritannien', 'stocks/arm'],
  ['Shell'                       , 'SHEL'  ,       88.5, 'USD',   9.46, 3.42, 'Energie'     , 'Grossbritannien', 'stocks/shel'],
  ['AstraZeneca'                 , 'AZN'   ,     161.42, 'USD',  23.84,    2, 'Pharma'      , 'Grossbritannien', 'stocks/azn'],
  ['HSBC'                        , 'HSBC'  ,     103.73, 'USD',  16.78,  3.6, 'Banken'      , 'Grossbritannien', 'stocks/hsbc'],
  ['Novartis'                    , 'NVS'   ,     156.33, 'USD',  23.24, 1.97, 'Pharma'      , 'Schweiz'        , 'stocks/nvs'],
  ['Royal Bank of Canada'        , 'RY'    ,     211.08, 'USD',  18.51, 2.25, 'Banken'      , 'Kanada'         , 'stocks/ry'],

  // ---------- Deutschland (MDAX/DAX-Nachzuegler) ----------
  ['Porsche AG'                  , 'P911'  ,       44.1, 'EUR',  47.66, 2.29, 'Automobil'   , 'Deutschland'    , 'quote/etr/P911'],
  ['Fresenius'                   , 'FRE'   ,      47.06, 'EUR',  16.96, 2.23, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FRE'],
  ['Fresenius Medical Care'      , 'FME'   ,      42.05, 'EUR',  12.57, 3.56, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FME'],
  ['Symrise'                     , 'SY1'   ,      91.92, 'EUR',  51.99, 1.36, 'Chemie'      , 'Deutschland'    , 'quote/etr/SY1'],
  ['Sartorius Vorzuege'          , 'SRT3'  ,      232.2, 'EUR',  74.38, 0.32, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/SRT3'],
  ['Talanx'                      , 'TLX'   ,      116.5, 'EUR',  11.36, 3.09, 'Versicherung', 'Deutschland'    , 'quote/etr/TLX'],

  // ---------- Europa ohne Deutschland ----------
  ['Publicis Groupe'             , 'PUB'   ,        100, 'EUR',  15.58, 3.78, 'Medien'      , 'Frankreich'     , 'quote/epa/PUB'],
  ['Stellantis'                  , 'STLA'  ,     4.7965, 'EUR', null  ,    0, 'Automobil'   , 'Niederlande'    , 'quote/epa/STLAP'],
  ['Prosus'                      , 'PRX'   ,      42.48, 'EUR',   9.37, 0.66, 'Technologie' , 'Niederlande'    , 'quote/ams/PRX'],
  ['Generali'                    , 'G'     ,      44.81, 'EUR',  15.23, 3.66, 'Versicherung', 'Italien'        , 'quote/bit/G'],
  ['BBVA'                        , 'BBVA'  ,       24.6, 'EUR',     13, 3.74, 'Banken'      , 'Spanien'        , 'quote/bme/BBVA'],
  ['Telefonica'                  , 'TEF'   ,      3.671, 'EUR', null  , 8.12, 'Telekom'     , 'Spanien'        , 'quote/bme/TEF'],
  ['KBC Group'                   , 'KBC'   ,      127.9, 'EUR',  14.18, 3.99, 'Banken'      , 'Belgien'        , 'quote/ebr/KBC'],

  // ---------- Grossbritannien, Kurse in Pence (GBX) an der LSE ----------
  ['Unilever'                    , 'ULVR'  ,       4670, 'GBX',  21.28, 3.66, 'Konsum'      , 'Grossbritannien', 'quote/lon/ULVR'],
  ['BP'                          , 'BP1'   ,      517.2, 'GBX',  19.91, 4.95, 'Energie'     , 'Grossbritannien', 'quote/lon/BP'],
  ['GSK'                         , 'GSK'   ,     1960.5, 'GBX',  16.64, 3.72, 'Pharma'      , 'Grossbritannien', 'quote/lon/GSK'],
  ['Diageo'                      , 'DGE'   ,       1790, 'GBX',  30.49, 2.07, 'Nahrung'     , 'Grossbritannien', 'quote/lon/DGE'],
  ['Rio Tinto'                   , 'RIO'   ,       7528, 'GBX',  13.53, 4.01, 'Industrie'   , 'Grossbritannien', 'quote/lon/RIO'],
  ['Barclays'                    , 'BARC'  ,        516, 'GBX',  10.73, 1.65, 'Banken'      , 'Grossbritannien', 'quote/lon/BARC'],
  ['Lloyds Banking Group'        , 'LLOY'  ,     115.15, 'GBX',  14.43, 3.18, 'Banken'      , 'Grossbritannien', 'quote/lon/LLOY'],
  ['BAE Systems'                 , 'BA1'   ,       2220, 'GBX',   31.8, 1.65, 'Ruestung'    , 'Grossbritannien', 'quote/lon/BA'],
  ['Rolls-Royce'                 , 'RR'    ,       1530, 'GBX',  42.29, 0.78, 'Luftfahrt'   , 'Grossbritannien', 'quote/lon/RR'],

  // ---------- Schweiz, Kurse in Franken an der SIX ----------
  ['Nestle'                      , 'NESN'  ,      81.21, 'CHF',  28.09, 3.82, 'Nahrung'     , 'Schweiz'        , 'quote/swx/NESN'],
  ['Roche'                       , 'RO'    ,  372.60001, 'CHF',  23.76, 2.98, 'Pharma'      , 'Schweiz'        , 'quote/swx/RO'],
  ['Zurich Insurance'            , 'ZURN'  ,  593.20001, 'CHF',  14.88, 4.75, 'Versicherung', 'Schweiz'        , 'quote/swx/ZURN'],
  ['ABB'                         , 'ABBN'  ,      81.76, 'CHF',   37.2, 1.14, 'Industrie'   , 'Schweiz'        , 'quote/swx/ABBN'],
  ['UBS Group'                   , 'UBSG'  ,      43.46, 'CHF',  18.33, 2.08, 'Banken'      , 'Schweiz'        , 'quote/swx/UBSG'],
  ['Richemont'                   , 'CFR'   ,     195.45, 'CHF',  35.97, 1.69, 'Luxus'       , 'Schweiz'        , 'quote/swx/CFR'],
  ['Holcim'                      , 'HOLN'  ,      70.82, 'CHF', 100.63,  2.4, 'Bau'         , 'Schweiz'        , 'quote/swx/HOLN'],
  ['Sika'                        , 'SIKA'  ,        194, 'CHF',  29.94, 1.91, 'Chemie'      , 'Schweiz'        , 'quote/swx/SIKA'],
  ['Swiss Re'                    , 'SREN'  ,      138.5, 'CHF',  10.44, 4.74, 'Versicherung', 'Schweiz'        , 'quote/swx/SREN'],
  ['Lonza'                       , 'LONN'  ,      572.2, 'CHF',  36.99, 0.87, 'Pharma'      , 'Schweiz'        , 'quote/swx/LONN'],

  // ---------- Japan, Kurse in Yen an der Boerse Tokio ----------
  ['Toyota Motor'                , '7203'  ,       2980, 'JPY',   8.53, 3.35, 'Automobil'   , 'Japan'          , 'quote/tyo/7203'],
  ['Sony Group'                  , '6758'  ,       3721, 'JPY',  19.86, 0.94, 'Technologie' , 'Japan'          , 'quote/tyo/6758'],
  ['Nintendo'                    , '7974'  ,       8043, 'JPY',  19.63, 2.01, 'Medien'      , 'Japan'          , 'quote/tyo/7974'],
  ['Keyence'                     , '6861'  ,      85110, 'JPY',  41.94, 0.65, 'Industrie'   , 'Japan'          , 'quote/tyo/6861'],
  ['Tokyo Electron'              , '8035'  ,      54500, 'JPY',  40.24, 1.37, 'Halbleiter'  , 'Japan'          , 'quote/tyo/8035'],
  ['Advantest'                   , '6857'  ,      32190, 'JPY',  51.08, 0.18, 'Halbleiter'  , 'Japan'          , 'quote/tyo/6857'],
  ['SoftBank Group'              , '9984'  ,       5552, 'JPY',   6.45, 0.19, 'Technologie' , 'Japan'          , 'quote/tyo/9984'],
  ['Hitachi'                     , '6501'  ,       5620, 'JPY',  31.77, 1.02, 'Industrie'   , 'Japan'          , 'quote/tyo/6501'],
  ['Mitsubishi Corporation'      , '8058'  ,       4868, 'JPY',  20.36, 2.57, 'Handel'      , 'Japan'          , 'quote/tyo/8058'],
  ['Shin-Etsu Chemical'          , '4063'  ,       6116, 'JPY',  23.87,  1.9, 'Chemie'      , 'Japan'          , 'quote/tyo/4063'],
  ['Takeda Pharmaceutical'       , '4502'  ,       5540, 'JPY', null  , 3.68, 'Pharma'      , 'Japan'          , 'quote/tyo/4502'],
  ['Honda Motor'                 , '7267'  ,       1683, 'JPY', null  , 4.28, 'Automobil'   , 'Japan'          , 'quote/tyo/7267'],
  ['Sumitomo Mitsui Financial'   , '8316'  ,       6782, 'JPY',  20.58, 2.65, 'Banken'      , 'Japan'          , 'quote/tyo/8316'],
  ['Fast Retailing'              , '9983'  ,      79310, 'JPY',  46.86, 0.81, 'Handel'      , 'Japan'          , 'quote/tyo/9983'],
  ['Nippon Telegraph & Telephone', '9432'  ,      158.5, 'JPY',  12.34, 3.41, 'Telekom'     , 'Japan'          , 'quote/tyo/9432'],

  // ---------- Suedkorea, Kurse in Won an der KRX ----------
  ['Samsung Electronics'         , '005930',     231000, 'KRW',  10.17, 0.98, 'Technologie' , 'Suedkorea'      , 'quote/krx/005930'],
  ['Hyundai Motor'               , '005380',     395500, 'KRW',  12.51,  2.5, 'Automobil'   , 'Suedkorea'      , 'quote/krx/005380'],
  ['Kia'                         , '000270',     134900, 'KRW',   7.49, 5.04, 'Automobil'   , 'Suedkorea'      , 'quote/krx/000270'],
  ['NAVER'                       , '035420',     210000, 'KRW',  17.49, 1.16, 'Technologie' , 'Suedkorea'      , 'quote/krx/035420'],
  ['Samsung Biologics'           , '207940',    1556000, 'KRW',  59.49,    0, 'Pharma'      , 'Suedkorea'      , 'quote/krx/207940'],
  ['POSCO Holdings'              , '005490',     331000, 'KRW',  19.34, 2.51, 'Industrie'   , 'Suedkorea'      , 'quote/krx/005490'],
  ['LG Energy Solution'          , '373220',     360000, 'KRW', null  ,    0, 'Industrie'   , 'Suedkorea'      , 'quote/krx/373220'],

  // ---------- Hongkong, Kurse in Hongkong-Dollar ----------
  ['Tencent Holdings'            , '0700'  ,      478.8, 'HKD',  16.63, 1.11, 'Technologie' , 'Hongkong'       , 'quote/hkg/0700'],
  ['AIA Group'                   , '1299'  ,      74.15, 'HKD',  16.14, 2.64, 'Versicherung', 'Hongkong'       , 'quote/hkg/1299'],
  ['Hong Kong Exchanges'         , '0388'  ,      411.6, 'HKD',  27.66, 3.18, 'Finanzen'    , 'Hongkong'       , 'quote/hkg/0388'],

  // ---------- Kanada, Kurse in kanadischen Dollar an der TSX ----------
  ['Shopify'                     , 'SHOP'  ,     211.37, 'CAD',  99.31,    0, 'Technologie' , 'Kanada'         , 'quote/tsx/SHOP'],
  ['Toronto-Dominion Bank'       , 'TD'    ,      169.3, 'CAD',     20, 2.64, 'Banken'      , 'Kanada'         , 'quote/tsx/TD'],
  ['Bank of Nova Scotia'         , 'BNS'   ,        124, 'CAD',  17.08, 3.68, 'Banken'      , 'Kanada'         , 'quote/tsx/BNS'],
  ['Bank of Montreal'            , 'BMO'   ,     253.24, 'CAD',  19.45,  2.7, 'Banken'      , 'Kanada'         , 'quote/tsx/BMO'],
  ['Enbridge'                    , 'ENB'   ,      71.55, 'CAD',  27.62, 5.42, 'Energie'     , 'Kanada'         , 'quote/tsx/ENB'],
  ['Canadian Natural Resources'  , 'CNQ'   ,      63.45, 'CAD',  11.29, 3.94, 'Energie'     , 'Kanada'         , 'quote/tsx/CNQ'],
  ['Canadian National Railway'   , 'CNR'   ,     176.52, 'CAD',  22.66, 2.07, 'Logistik'    , 'Kanada'         , 'quote/tsx/CNR'],
  ['Canadian Pacific Kansas City', 'CP'    ,     127.68, 'CAD',   29.7, 0.85, 'Logistik'    , 'Kanada'         , 'quote/tsx/CP'],
  ['BCE'                         , 'BCE'   ,      31.67, 'CAD',   4.71, 5.49, 'Telekom'     , 'Kanada'         , 'quote/tsx/BCE'],
  ['Brookfield Corporation'      , 'BN1'   ,       61.5, 'CAD',  86.97, 0.64, 'Finanzen'    , 'Kanada'         , 'quote/tsx/BN'],

  // ---------- USA ----------
  ['Boeing'                      , 'BA'    ,     234.42, 'USD',  87.42,    0, 'Luftfahrt'   , 'USA'            , 'stocks/ba'],
  ['Walt Disney'                 , 'DIS'   ,     104.91, 'USD',  21.69, 1.43, 'Medien'      , 'USA'            , 'stocks/dis'],
  ['Verizon Communications'      , 'VZ'    ,      47.06, 'USD',  12.26, 6.01, 'Telekom'     , 'USA'            , 'stocks/vz'],
  ['Lockheed Martin'             , 'LMT'   ,     587.95, 'USD',  21.66, 2.35, 'Ruestung'    , 'USA'            , 'stocks/lmt'],
  ['American Tower'              , 'AMT'   ,     172.54, 'USD',  23.73, 4.15, 'Immobilien'  , 'USA'            , 'stocks/amt'],
  ['Salesforce'                  , 'CRM'   ,     192.74, 'USD',  22.37, 0.91, 'Technologie' , 'USA'            , 'stocks/crm'],
  ['Adobe'                       , 'ADBE'  ,     265.21, 'USD',  15.17,    0, 'Technologie' , 'USA'            , 'stocks/adbe'],
  ['Qualcomm'                    , 'QCOM'  ,     167.86, 'USD',  19.53, 2.19, 'Halbleiter'  , 'USA'            , 'stocks/qcom'],
  ['IBM'                         , 'IBM'   ,     237.28, 'USD',   21.1, 2.85, 'Technologie' , 'USA'            , 'stocks/ibm'],
  ['Pfizer'                      , 'PFE'   ,      26.76, 'USD',  35.18, 6.43, 'Pharma'      , 'USA'            , 'stocks/pfe'],
  ['AbbVie'                      , 'ABBV'  ,     246.04, 'USD',  69.51, 2.81, 'Pharma'      , 'USA'            , 'stocks/abbv'],
  ['McDonald\'s'                 , 'MCD'   ,     274.48, 'USD',   22.3, 2.71, 'Nahrung'     , 'USA'            , 'stocks/mcd'],
  ['Nike'                        , 'NKE'   ,       41.7, 'USD',  19.86, 3.93, 'Konsum'      , 'USA'            , 'stocks/nke'],
  ['PepsiCo'                     , 'PEP'   ,     139.02, 'USD',  18.22, 4.26, 'Nahrung'     , 'USA'            , 'stocks/pep'],
  ['Coinbase'                    , 'COIN'  ,      153.6, 'USD', null  ,    0, 'Finanzen'    , 'USA'            , 'stocks/coin'],


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



  ['Vanguard S&P 500 ETF'                             , 'VOO' , 710.71,  1030,   520, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/voo'],
  ['Invesco QQQ Trust'                                , 'QQQ' , 723.03, 479.2,   106, 0.18, true, 'USA Technologie' , 'Aktien'  , 'etf/qqq'],
  ['Vanguard Total World Stock ETF'                   , 'VT'  ,  161.3,  80.9, 10070, 0.06, true, 'Welt'            , 'Aktien'  , 'etf/vt'],
  ['Vanguard FTSE Developed Markets ETF'              , 'VEA' ,  72.89,   235,  3881, 0.03, true, 'Welt ohne USA'   , 'Aktien'  , 'etf/vea'],
  ['Vanguard FTSE Emerging Markets ETF'               , 'VWO' ,  60.47, 124.9,  5077, 0.06, true, 'Schwellenlaender', 'Aktien'  , 'etf/vwo'],
  ['iShares MSCI EAFE ETF'                            , 'EFA' , 108.55,  79.3,   699, 0.32, true, 'Europa/Asien'    , 'Aktien'  , 'etf/efa'],
  ['iShares Russell 2000 ETF'                         , 'IWM' , 301.56,  82.2,  1972, 0.19, true, 'USA klein'       , 'Aktien'  , 'etf/iwm'],
  ['iShares Core S&P Mid-Cap ETF'                     , 'IJH' ,  77.79, 126.1,   413, 0.05, true, 'USA mittel'      , 'Aktien'  , 'etf/ijh'],
  ['SPDR Dow Jones Industrial Average ETF'            , 'DIA' , 539.62,  47.6,    31, 0.16, true, 'USA Standard'    , 'Aktien'  , 'etf/dia'],
  ['Invesco S&P 500 Equal Weight ETF'                 , 'RSP' , 220.09,  97.5,   509,  0.2, true, 'USA breit'       , 'Aktien'  , 'etf/rsp'],
  ['Vanguard Growth ETF'                              , 'VUG' ,   89.4, 229.6,   151, 0.03, true, 'USA Wachstum'    , 'Aktien'  , 'etf/vug'],
  ['Vanguard Value ETF'                               , 'VTV' , 224.31, 191.4,   326, 0.03, true, 'USA Substanz'    , 'Aktien'  , 'etf/vtv'],
  ['Schwab US Dividend Equity ETF'                    , 'SCHD',   33.9, 105.7,   103, 0.06, true, 'Dividenden'      , 'Aktien'  , 'etf/schd'],
  ['Vanguard High Dividend Yield ETF'                 , 'VYM' , 165.63,  83.4,   618, 0.04, true, 'Dividenden'      , 'Aktien'  , 'etf/vym'],
  ['Technology Select Sector SPDR'                    , 'XLK' , 187.97, 122.8,    76, 0.08, true, 'Technologie'     , 'Aktien'  , 'etf/xlk'],
  ['iShares Semiconductor ETF'                        , 'SOXX', 543.27,  47.6,    34, 0.34, true, 'Halbleiter'      , 'Aktien'  , 'etf/soxx'],
  ['Health Care Select Sector SPDR'                   , 'XLV' , 165.68,  41.9,    63, 0.08, true, 'Gesundheit'      , 'Aktien'  , 'etf/xlv'],
  ['Financial Select Sector SPDR'                     , 'XLF' ,   57.6,  59.2,    80, 0.08, true, 'Finanzen'        , 'Aktien'  , 'etf/xlf'],
  ['Energy Select Sector SPDR'                        , 'XLE' ,   57.5,  38.5,    24, 0.08, true, 'Energie'         , 'Aktien'  , 'etf/xle'],
  ['Vanguard Real Estate ETF'                         , 'VNQ' ,  98.43,  39.3,   157, 0.13, true, 'Immobilien'      , 'Aktien'  , 'etf/vnq'],
  ['SPDR Gold Shares'                                 , 'GLD' , 398.47, 132.5,     2,  0.4, true, 'Rohstoffe'       , 'Rohstoff', 'etf/gld'],
  ['iShares Core US Aggregate Bond ETF'               , 'AGG' ,   97.6, 137.7, 13314, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/agg'],
  ['iShares 20+ Year Treasury Bond ETF'               , 'TLT' ,  82.76,  41.6,    48, 0.15, true, 'Anleihen'        , 'Anleihen', 'etf/tlt'],
  ['Vanguard Interm.-Term Corp. Bond ETF'             , 'VCIT',  81.42,  67.6,  2268, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/vcit'],
  ['iShares Bitcoin Trust'                            , 'IBIT',   36.8,  47.5,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/ibit'],

  // ---------- Ausbau 2026-08-08 ----------
  ['SPDR S&P 500 ETF Trust'                           , 'SPY' , 773.26, 812.1,   505, 0.09, true, 'USA breit'       , 'Aktien'  , 'etf/spy'],
  ['iShares Core S&P 500 ETF'                         , 'IVV' , 776.73,   901,   508, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/ivv'],
  ['Vanguard Total Stock Market ETF'                  , 'VTI' , 381.78, 696.4,  3498, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/vti'],
  ['iShares Core MSCI EAFE ETF'                       , 'IEFA', 101.08, 193.5,  2642, 0.07, true, 'Europa/Asien'    , 'Aktien'  , 'etf/iefa'],
  ['iShares Core MSCI Emerging Markets ETF'           , 'IEMG',  79.99, 156.6,  3224, 0.09, true, 'Schwellenlaender', 'Aktien'  , 'etf/iemg'],
  ['iShares MSCI Japan ETF'                           , 'EWJ' ,   96.9,  22.4,   174, 0.49, true, 'Japan'           , 'Aktien'  , 'etf/ewj'],
  ['iShares MSCI Eurozone ETF'                        , 'EZU' ,  71.57,   9.8,   226,  0.5, true, 'Eurozone'        , 'Aktien'  , 'etf/ezu'],
  ['iShares China Large-Cap ETF'                      , 'FXI' ,  36.17,   4.3,    59, 0.74, true, 'China'           , 'Aktien'  , 'etf/fxi'],
  ['iShares MSCI India ETF'                           , 'INDA', 50.365,   6.6,   171, 0.61, true, 'Indien'          , 'Aktien'  , 'etf/inda'],
  ['Industrial Select Sector SPDR'                    , 'XLI' , 185.18,  34.2,    85, 0.08, true, 'Industrie'       , 'Aktien'  , 'etf/xli'],
  ['Consumer Discretionary Select Sector SPDR'        , 'XLY' , 119.86,  23.4,    50, 0.08, true, 'Konsum'          , 'Aktien'  , 'etf/xly'],
  ['Consumer Staples Select Sector SPDR'              , 'XLP' ,  85.12,  14.7,    38, 0.08, true, 'Nahrung'         , 'Aktien'  , 'etf/xlp'],
  ['Utilities Select Sector SPDR'                     , 'XLU' ,  43.61,    23,    34, 0.08, true, 'Versorger'       , 'Aktien'  , 'etf/xlu'],
  ['Communication Services Select Sector SPDR'        , 'XLC' , 111.25,  21.7,    26, 0.08, true, 'Medien'          , 'Aktien'  , 'etf/xlc'],
  ['iShares Silver Trust'                             , 'SLV' ,   57.5,  28.6,     1,  0.5, true, 'Rohstoffe'       , 'Rohstoff', 'etf/slv'],
  ['Invesco DB Commodity Index Tracking Fund'         , 'DBC' ,  28.91,   1.7,    41, 0.84, true, 'Rohstoffe'       , 'Rohstoff', 'etf/dbc'],
  ['iShares iBoxx Investment Grade Corporate Bond ETF', 'LQD' , 106.55,  32.4,  3143, 0.14, true, 'Anleihen'        , 'Anleihen', 'etf/lqd'],
  ['iShares iBoxx High Yield Corporate Bond ETF'      , 'HYG' ,  79.61,  17.4,  1333, 0.49, true, 'Anleihen'        , 'Anleihen', 'etf/hyg'],
  ['iShares Ethereum Trust'                           , 'ETHA',  14.47,   5.4,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/etha'],


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



  ['Bitcoin'     , 'BTC' ,    56199, 1127771826290,     20067309,     21000000,   107662, 'coingecko/bitcoin'],
  ['Ethereum'    , 'ETH' ,   1657.3,  200005852287,    120682085, null        ,  4229.76, 'coingecko/ethereum'],
  ['XRP'         , 'XRP' , 0.894762,   55952402612,  62533271955, 100000000000,     3.28, 'coingecko/ripple'],
  ['Solana'      , 'SOL' ,    64.72,   37671416734,    582051273, null        ,    285.6, 'coingecko/solana'],
  ['Dogecoin'    , 'DOGE', 0.060753,    9441305815, 155404696384, null        , 0.601466, 'coingecko/dogecoin'],
  ['Cardano'     , 'ADA' , 0.173141,    6467443173,  37353519634,  45000000000,     2.61, 'coingecko/cardano'],
  ['Chainlink'   , 'LINK',     7.15,    5349879725,    748099970,   1000000000,    43.32, 'coingecko/chainlink'],
  ['Litecoin'    , 'LTC' ,    39.43,    3054904550,     77471660,     84000000,   337.56, 'coingecko/litecoin'],
  ['Avalanche'   , 'AVAX',     5.65,    2440741847,    431771961,    720000000,   128.43, 'coingecko/avalanche-2'],
  ['Polkadot'    , 'DOT' , 0.709104,    1203366795,   1697023952,   2100000000,     47.6, 'coingecko/polkadot'],

  // ---------- Ausbau 2026-08-08 ----------
  ['BNB'         , 'BNB' ,   513.68,   68403963789,    133164534,    200000000,  1182.86, 'coingecko/binancecoin'],
  ['Tron'        , 'TRX' , 0.283431,   26895780793,  94893551778, null        , 0.410308, 'coingecko/tron'],
  ['Toncoin'     , 'TON' ,     1.17,    3210622427,   2741250732, null        ,      7.7, 'coingecko/the-open-network'],
  ['Aave'        , 'AAVE',    78.22,    1206403177,     15422477,     16000000,   541.28, 'coingecko/aave'],
  ['Stellar'     , 'XLM' ,  0.14169,    4875995862,  34413166508, null        , 0.729104, 'coingecko/stellar'],
  ['Bitcoin Cash', 'BCH' ,   187.86,    3770840837,     20072281,     21000000,  3187.12, 'coingecko/bitcoin-cash'],
  ['Monero'      , 'XMR' ,   329.86,    6197506087,     18788474, null        ,   685.48, 'coingecko/monero'],
  ['Uniswap'     , 'UNI' ,     3.47,    2164814996,    624674424,   1000000000,    37.37, 'coingecko/uniswap'],


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
