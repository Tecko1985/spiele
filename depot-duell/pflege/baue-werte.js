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
const STAND = '2026-08-17';
const EUR_USD = 1.1567; // 1 EUR = 1.1567 USD (EZB via frankfurter.dev, 2026-08-14)

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
  CAD: 1.6049,
  CHF: 0.939,
  GBP: 0.8545,
  HKD: 9.077,
  JPY: 183.93,
  KRW: 1632.42,
  USD: 1.1567,
};

/**
 * Aktien.
 * [name, kuerzel, kurs, waehrung, kgv, divRenditeProzent, sektor, land, quelle]
 * kgv === null bedeutet: kein sinnvolles KGV (Verlustjahr) -> die App zeigt einen Strich.
 * quelle ist der Pfad bei stockanalysis.com, den hole-kurse.js abruft.
 */
const AKTIEN = [





  // ---------- Deutschland (DAX), Kurse in Euro, Xetra 2026-08-07 11:34 ----------
  ['SAP'                         , 'SAP'   ,  180.14, 'EUR',  26.98, 1.39, 'Technologie' , 'Deutschland'    , 'quote/etr/SAP'],
  ['Siemens'                     , 'SIE'   ,     284, 'EUR',  28.39, 1.88, 'Industrie'   , 'Deutschland'    , 'quote/etr/SIE'],
  ['Allianz'                     , 'ALV'   ,   442.7, 'EUR',  14.52, 3.86, 'Versicherung', 'Deutschland'    , 'quote/etr/ALV'],
  ['Rheinmetall'                 , 'RHM'   ,    1202, 'EUR',  46.06, 0.96, 'Ruestung'    , 'Deutschland'    , 'quote/etr/RHM'],
  ['Mercedes-Benz Group'         , 'MBG'   ,  46.025, 'EUR',   8.72,  7.6, 'Automobil'   , 'Deutschland'    , 'quote/etr/MBG'],
  ['BMW'                         , 'BMW'   ,    59.4, 'EUR',   5.64, 7.41, 'Automobil'   , 'Deutschland'    , 'quote/etr/BMW'],
  ['Volkswagen Vorzuege'         , 'VOW3'  ,   73.72, 'EUR',   7.05, 7.14, 'Automobil'   , 'Deutschland'    , 'quote/etr/VOW3'],
  ['Deutsche Bank'               , 'DBK'   ,  33.385, 'EUR',  10.78,    3, 'Banken'      , 'Deutschland'    , 'quote/etr/DBK'],
  ['Commerzbank'                 , 'CBK'   ,   39.74, 'EUR',  15.26, 2.77, 'Banken'      , 'Deutschland'    , 'quote/etr/CBK'],
  ['adidas'                      , 'ADS'   ,  157.55, 'EUR',  20.24, 1.78, 'Konsum'      , 'Deutschland'    , 'quote/etr/ADS'],
  ['Zalando'                     , 'ZAL'   ,    23.6, 'EUR',     64,    0, 'Handel'      , 'Deutschland'    , 'quote/etr/ZAL'],
  ['Infineon'                    , 'IFX'   ,   61.73, 'EUR',  67.07, 0.57, 'Halbleiter'  , 'Deutschland'    , 'quote/etr/IFX'],
  ['BASF'                        , 'BAS'   ,   51.15, 'EUR',  21.62,  4.4, 'Chemie'      , 'Deutschland'    , 'quote/etr/BAS'],
  ['Bayer'                       , 'BAYN'  ,   47.79, 'EUR', null  , 0.23, 'Pharma'      , 'Deutschland'    , 'quote/etr/BAYN'],
  ['Merck'                       , 'MRK1'  ,   136.3, 'EUR',  25.01, 1.61, 'Pharma'      , 'Deutschland'    , 'quote/etr/MRK'],
  ['Deutsche Telekom'            , 'DTE'   ,   28.67, 'EUR',  16.05, 3.49, 'Telekom'     , 'Deutschland'    , 'quote/etr/DTE'],
  ['DHL Group'                   , 'DHL'   ,   55.26, 'EUR',  16.83, 3.44, 'Logistik'    , 'Deutschland'    , 'quote/etr/DHL'],
  ['E.ON'                        , 'EOAN'  ,   17.45, 'EUR',  13.52, 3.27, 'Versorger'   , 'Deutschland'    , 'quote/etr/EOAN'],
  ['RWE'                         , 'RWE'   ,    58.9, 'EUR',  13.04, 2.04, 'Versorger'   , 'Deutschland'    , 'quote/etr/RWE'],
  ['Siemens Energy'              , 'ENR'   ,  160.72, 'EUR',  52.28, 0.44, 'Versorger'   , 'Deutschland'    , 'quote/etr/ENR'],
  ['Muenchener Rueck'            , 'MUV2'  ,   517.8, 'EUR',   9.64, 4.63, 'Versicherung', 'Deutschland'    , 'quote/etr/MUV2'],
  ['Hannover Rueck'              , 'HNR1'  ,   253.4, 'EUR',  11.18, 4.93, 'Versicherung', 'Deutschland'    , 'quote/etr/HNR1'],
  ['Deutsche Boerse'             , 'DB1'   ,   272.9, 'EUR',  23.54, 1.54, 'Finanzen'    , 'Deutschland'    , 'quote/etr/DB1'],
  ['Beiersdorf'                  , 'BEI'   ,    78.1, 'EUR',  18.26, 1.28, 'Konsum'      , 'Deutschland'    , 'quote/etr/BEI'],
  ['Henkel Vorzuege'             , 'HEN3'  ,   76.32, 'EUR',  16.27, 2.71, 'Konsum'      , 'Deutschland'    , 'quote/etr/HEN3'],
  ['Continental'                 , 'CON'   ,   69.38, 'EUR', null  , 3.89, 'Automobil'   , 'Deutschland'    , 'quote/etr/CON'],
  ['Daimler Truck'               , 'DTG'   ,    45.1, 'EUR',  31.98, 4.21, 'Automobil'   , 'Deutschland'    , 'quote/etr/DTG'],
  ['MTU Aero Engines'            , 'MTX'   ,   382.7, 'EUR',  22.17, 0.94, 'Luftfahrt'   , 'Deutschland'    , 'quote/etr/MTX'],
  ['Heidelberg Materials'        , 'HEI'   ,  161.75, 'EUR',  14.05, 2.23, 'Bau'         , 'Deutschland'    , 'quote/etr/HEI'],
  ['Vonovia'                     , 'VNA'   ,   20.58, 'EUR',   4.82, 6.07, 'Immobilien'  , 'Deutschland'    , 'quote/etr/VNA'],

  // ---------- Europa ohne Deutschland, Kurse in Euro ----------
  ['ASML'                        , 'ASML'  ,  1579.6, 'EUR',  57.36, 0.47, 'Halbleiter'  , 'Niederlande'    , 'quote/ams/ASML'],
  ['LVMH'                        , 'MC'    ,   458.4, 'EUR',   20.9, 2.84, 'Luxus'       , 'Frankreich'     , 'quote/epa/MC'],
  ['Hermes'                      , 'RMS'   ,    1576, 'EUR',  36.65, 1.14, 'Luxus'       , 'Frankreich'     , 'quote/epa/RMS'],
  ['LOreal'                      , 'OR'    ,   379.5, 'EUR',  32.22,  1.9, 'Konsum'      , 'Frankreich'     , 'quote/epa/OR'],
  ['TotalEnergies'               , 'TTE'   ,   75.78, 'EUR',  10.79, 4.49, 'Energie'     , 'Frankreich'     , 'quote/epa/TTE'],
  ['Sanofi'                      , 'SAN'   ,   75.52, 'EUR',  23.25, 5.46, 'Pharma'      , 'Frankreich'     , 'quote/epa/SAN'],
  ['Air Liquide'                 , 'AI'    ,  168.26, 'EUR',  30.28,    2, 'Chemie'      , 'Frankreich'     , 'quote/epa/AI'],
  ['Schneider Electric'          , 'SU'    ,   306.4, 'EUR',  36.86, 1.37, 'Industrie'   , 'Frankreich'     , 'quote/epa/SU'],
  ['SAFRAN'                      , 'SAF'   ,   360.5, 'EUR',  38.72, 0.93, 'Luftfahrt'   , 'Frankreich'     , 'quote/epa/SAF'],
  ['AXA'                         , 'CS'    ,   45.05, 'EUR',  12.16, 5.15, 'Versicherung', 'Frankreich'     , 'quote/epa/CS'],
  ['BNP Paribas'                 , 'BNP'   ,   112.1, 'EUR',   9.71, 4.59, 'Banken'      , 'Frankreich'     , 'quote/epa/BNP'],
  ['VINCI'                       , 'DG'    ,  120.85, 'EUR',   13.4, 4.14, 'Bau'         , 'Frankreich'     , 'quote/epa/DG'],
  ['Danone'                      , 'BN'    ,   67.24, 'EUR',  22.27, 3.35, 'Nahrung'     , 'Frankreich'     , 'quote/epa/BN'],
  ['EssilorLuxottica'            , 'EL'    ,  162.55, 'EUR',  30.37, 2.46, 'Konsum'      , 'Frankreich'     , 'quote/epa/EL'],
  ['Airbus'                      , 'AIR'   ,   215.4, 'EUR',  28.68, 1.49, 'Luftfahrt'   , 'Niederlande'    , 'quote/epa/AIR'],
  ['Ferrari'                     , 'RACE'  ,   356.8, 'EUR',  38.67, 1.01, 'Automobil'   , 'Italien'        , 'quote/bit/RACE'],
  ['Adyen'                       , 'ADYEN' ,  1061.6, 'EUR',  29.77,    0, 'Finanzen'    , 'Niederlande'    , 'quote/ams/ADYEN'],
  ['ING Group'                   , 'INGA'  ,  30.885, 'EUR',  10.34, 4.24, 'Banken'      , 'Niederlande'    , 'quote/ams/INGA'],
  ['AB InBev'                    , 'ABI'   ,   68.62, 'EUR',   16.9, 1.68, 'Nahrung'     , 'Belgien'        , 'quote/ebr/ABI'],
  ['Inditex'                     , 'ITX'   ,    57.6, 'EUR',  28.55, 3.04, 'Handel'      , 'Spanien'        , 'quote/bme/ITX'],
  ['Banco Santander'             , 'SAN2'  ,  12.898, 'EUR',  14.62, 1.94, 'Banken'      , 'Spanien'        , 'quote/bme/SAN'],
  ['Iberdrola'                   , 'IBE'   ,    20.2, 'EUR',  24.75, 3.37, 'Versorger'   , 'Spanien'        , 'quote/bme/IBE'],
  ['Enel'                        , 'ENEL'  ,   9.495, 'EUR',  22.76, 5.16, 'Versorger'   , 'Italien'        , 'quote/bit/ENEL'],
  ['Eni'                         , 'ENI'   ,  23.695, 'EUR',  12.43, 4.56, 'Energie'     , 'Italien'        , 'quote/bit/ENI'],
  ['UniCredit'                   , 'UCG'   ,   85.23, 'EUR',  12.11, 3.69, 'Banken'      , 'Italien'        , 'quote/bit/UCG'],
  ['Intesa Sanpaolo'             , 'ISP'   ,   6.917, 'EUR',  12.46, 5.49, 'Banken'      , 'Italien'        , 'quote/bit/ISP'],

  // ---------- USA, Kurse in Dollar ----------
  ['NVIDIA'                      , 'NVDA'  ,  225.16, 'USD',  34.48, 0.44, 'Halbleiter'  , 'USA'            , 'stocks/nvda'],
  ['Apple'                       , 'AAPL'  ,  305.93, 'USD',   35.1, 0.35, 'Technologie' , 'USA'            , 'stocks/aapl'],
  ['Alphabet'                    , 'GOOGL' ,   345.9, 'USD',  17.36, 0.25, 'Technologie' , 'USA'            , 'stocks/googl'],
  ['Microsoft'                   , 'MSFT'  ,   495.4, 'USD',   27.6, 0.73, 'Technologie' , 'USA'            , 'stocks/msft'],
  ['Amazon'                      , 'AMZN'  ,  262.65, 'USD',  21.12,    0, 'Handel'      , 'USA'            , 'stocks/amzn'],
  ['Broadcom'                    , 'AVGO'  ,  392.99, 'USD',   65.4, 0.66, 'Halbleiter'  , 'USA'            , 'stocks/avgo'],
  ['Meta Platforms'              , 'META'  ,  589.85, 'USD',  22.23, 0.36, 'Technologie' , 'USA'            , 'stocks/meta'],
  ['Tesla'                       , 'TSLA'  ,  342.27, 'USD', 355.18,    0, 'Automobil'   , 'USA'            , 'stocks/tsla'],
  ['Berkshire Hathaway'          , 'BRK.B' ,  504.03, 'USD',  12.58,    0, 'Finanzen'    , 'USA'            , 'stocks/brk.b'],
  ['Micron Technology'           , 'MU'    ,  971.66, 'USD',  21.93, 0.06, 'Halbleiter'  , 'USA'            , 'stocks/mu'],
  ['JPMorgan Chase'              , 'JPM'   ,  362.84, 'USD',  15.57, 1.65, 'Banken'      , 'USA'            , 'stocks/jpm'],
  ['Walmart'                     , 'WMT'   ,  115.27, 'USD',  40.58, 0.86, 'Handel'      , 'USA'            , 'stocks/wmt'],
  ['AMD'                         , 'AMD'   ,  514.39, 'USD', 131.29,    0, 'Halbleiter'  , 'USA'            , 'stocks/amd'],
  ['Visa'                        , 'V'     ,  364.15, 'USD',     31, 0.74, 'Finanzen'    , 'USA'            , 'stocks/v'],
  ['Johnson & Johnson'           , 'JNJ'   ,  260.35, 'USD',  30.18, 2.06, 'Pharma'      , 'USA'            , 'stocks/jnj'],
  ['Cisco'                       , 'CSCO'  ,  111.68, 'USD',  33.54,  1.5, 'Technologie' , 'USA'            , 'stocks/csco'],
  ['Costco'                      , 'COST'  ,   961.1, 'USD',  48.34, 0.61, 'Handel'      , 'USA'            , 'stocks/cost'],
  ['Applied Materials'           , 'AMAT'  ,  507.18, 'USD',  43.75, 0.42, 'Halbleiter'  , 'USA'            , 'stocks/amat'],
  ['Caterpillar'                 , 'CAT'   ,  856.57, 'USD',  36.91, 0.76, 'Industrie'   , 'USA'            , 'stocks/cat'],
  ['Lam Research'                , 'LRCX'  ,  332.36, 'USD',   57.7, 0.31, 'Halbleiter'  , 'USA'            , 'stocks/lrcx'],
  ['Palantir'                    , 'PLTR'  ,  174.04, 'USD', 148.85,    0, 'Technologie' , 'USA'            , 'stocks/pltr'],
  ['Coca-Cola'                   , 'KO'    ,   87.71, 'USD',  26.36, 2.42, 'Nahrung'     , 'USA'            , 'stocks/ko'],
  ['Chevron'                     , 'CVX'   ,     200, 'USD',  19.21, 3.56, 'Energie'     , 'USA'            , 'stocks/cvx'],
  ['UnitedHealth'                , 'UNH'   ,  401.73, 'USD',  25.86, 2.31, 'Gesundheit'  , 'USA'            , 'stocks/unh'],
  ['Home Depot'                  , 'HD'    ,  338.86, 'USD',  24.07, 2.75, 'Handel'      , 'USA'            , 'stocks/hd'],
  ['Procter & Gamble'            , 'PG'    ,  144.55, 'USD',  21.82, 3.01, 'Konsum'      , 'USA'            , 'stocks/pg'],
  ['Merck & Co'                  , 'MRK'   ,  135.84, 'USD', 106.72,  2.5, 'Pharma'      , 'USA'            , 'stocks/mrk'],
  ['Goldman Sachs'               , 'GS'    , 1039.42, 'USD',  16.08, 1.92, 'Banken'      , 'USA'            , 'stocks/gs'],
  ['Netflix'                     , 'NFLX'  ,   78.16, 'USD',  24.62,    0, 'Medien'      , 'USA'            , 'stocks/nflx'],
  ['Texas Instruments'           , 'TXN'   ,  279.58, 'USD',  42.47, 2.03, 'Halbleiter'  , 'USA'            , 'stocks/txn'],
  ['KLA'                         , 'KLAC'  ,  203.72, 'USD',  55.66, 0.45, 'Halbleiter'  , 'USA'            , 'stocks/klac'],
  ['American Express'            , 'AXP'   ,  342.48, 'USD',  20.79, 1.11, 'Finanzen'    , 'USA'            , 'stocks/axp'],
  ['Palo Alto Networks'          , 'PANW'  ,  384.27, 'USD', 371.55,    0, 'Technologie' , 'USA'            , 'stocks/panw'],
  ['Intel'                       , 'INTC'  ,   102.5, 'USD', null  ,    0, 'Halbleiter'  , 'USA'            , 'stocks/intc'],
  ['Mastercard'                  , 'MA'    ,  569.29, 'USD',  31.31, 0.61, 'Finanzen'    , 'USA'            , 'stocks/ma'],
  ['Eli Lilly'                   , 'LLY'   , 1180.16, 'USD',  39.62, 0.59, 'Pharma'      , 'USA'            , 'stocks/lly'],
  ['ExxonMobil'                  , 'XOM'   ,   160.1, 'USD',  20.64, 2.57, 'Energie'     , 'USA'            , 'stocks/xom'],
  ['Oracle'                      , 'ORCL'  ,  150.52, 'USD',  25.82, 1.33, 'Technologie' , 'USA'            , 'stocks/orcl'],
  ['GE Aerospace'                , 'GE'    ,  368.38, 'USD',  43.42, 0.51, 'Luftfahrt'   , 'USA'            , 'stocks/ge'],
  ['Bank of America'             , 'BAC'   ,   64.49, 'USD',   14.9, 1.74, 'Banken'      , 'USA'            , 'stocks/bac'],

  // ---------- Asien und Sonstige, Kurse in Dollar (Zweitnotiz in New York) ----------
  ['TSMC'                        , 'TSM'   ,  426.35, 'USD',  27.86, 0.65, 'Halbleiter'  , 'Taiwan'         , 'stocks/tsm'],
  ['SK hynix'                    , 'SKHY'  , 1645000, 'KRW',   7.21, 0.18, 'Halbleiter'  , 'Suedkorea'      , 'quote/krx/000660'],
  ['Alibaba'                     , 'BABA'  ,  123.81, 'USD',  19.41, 0.85, 'Handel'      , 'China'          , 'stocks/baba'],
  ['Mitsubishi UFJ'              , 'MUFG'  ,   23.06, 'USD',  21.27, 1.92, 'Banken'      , 'Japan'          , 'stocks/mufg'],
  ['Arm Holdings'                , 'ARM'   ,  279.44, 'USD', 285.23,    0, 'Halbleiter'  , 'Grossbritannien', 'stocks/arm'],
  ['Shell'                       , 'SHEL'  ,   90.47, 'USD',   9.62, 3.34, 'Energie'     , 'Grossbritannien', 'stocks/shel'],
  ['AstraZeneca'                 , 'AZN'   ,  156.45, 'USD',  23.05, 2.07, 'Pharma'      , 'Grossbritannien', 'stocks/azn'],
  ['HSBC'                        , 'HSBC'  ,  103.79, 'USD',  16.83, 3.59, 'Banken'      , 'Grossbritannien', 'stocks/hsbc'],
  ['Novartis'                    , 'NVS'   ,  150.88, 'USD',  22.48, 2.04, 'Pharma'      , 'Schweiz'        , 'stocks/nvs'],
  ['Royal Bank of Canada'        , 'RY'    ,  216.56, 'USD',  18.98, 2.19, 'Banken'      , 'Kanada'         , 'stocks/ry'],

  // ---------- Deutschland (MDAX/DAX-Nachzuegler) ----------
  ['Porsche AG'                  , 'P911'  ,   44.42, 'EUR',     48, 2.27, 'Automobil'   , 'Deutschland'    , 'quote/etr/P911'],
  ['Fresenius'                   , 'FRE'   ,   47.08, 'EUR',  16.97, 2.23, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FRE'],
  ['Fresenius Medical Care'      , 'FME'   ,   41.04, 'EUR',  12.27, 3.63, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FME'],
  ['Symrise'                     , 'SY1'   ,   89.04, 'EUR',  50.36,  1.4, 'Chemie'      , 'Deutschland'    , 'quote/etr/SY1'],
  ['Sartorius Vorzuege'          , 'SRT3'  ,   237.5, 'EUR',  75.32, 0.31, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/SRT3'],
  ['Talanx'                      , 'TLX'   ,   118.5, 'EUR',  11.76, 3.04, 'Versicherung', 'Deutschland'    , 'quote/etr/TLX'],

  // ---------- Europa ohne Deutschland ----------
  ['Publicis Groupe'             , 'PUB'   ,   101.8, 'EUR',  15.86, 3.68, 'Medien'      , 'Frankreich'     , 'quote/epa/PUB'],
  ['Stellantis'                  , 'STLA'  ,    4.61, 'EUR', null  ,    0, 'Automobil'   , 'Niederlande'    , 'quote/epa/STLAP'],
  ['Prosus'                      , 'PRX'   ,  37.395, 'EUR',   8.24, 0.75, 'Technologie' , 'Niederlande'    , 'quote/ams/PRX'],
  ['Generali'                    , 'G'     ,   44.06, 'EUR',  14.95, 3.72, 'Versicherung', 'Italien'        , 'quote/bit/G'],
  ['BBVA'                        , 'BBVA'  ,   24.95, 'EUR',  13.19, 3.69, 'Banken'      , 'Spanien'        , 'quote/bme/BBVA'],
  ['Telefonica'                  , 'TEF'   ,   3.683, 'EUR', null  , 8.15, 'Telekom'     , 'Spanien'        , 'quote/bme/TEF'],
  ['KBC Group'                   , 'KBC'   ,   131.7, 'EUR',   14.6, 3.87, 'Banken'      , 'Belgien'        , 'quote/ebr/KBC'],

  // ---------- Grossbritannien, Kurse in Pence (GBX) an der LSE ----------
  ['Unilever'                    , 'ULVR'  ,  4589.5, 'GBX',  20.91, 3.76, 'Konsum'      , 'Grossbritannien', 'quote/lon/ULVR'],
  ['BP'                          , 'BP1'   ,   522.9, 'GBX',  20.13, 4.89, 'Energie'     , 'Grossbritannien', 'quote/lon/BP'],
  ['GSK'                         , 'GSK'   ,  1817.5, 'GBX',  15.42, 3.96, 'Pharma'      , 'Grossbritannien', 'quote/lon/GSK'],
  ['Diageo'                      , 'DGE'   ,    1764, 'GBX',  30.04, 2.09, 'Nahrung'     , 'Grossbritannien', 'quote/lon/DGE'],
  ['Rio Tinto'                   , 'RIO'   ,    7059, 'GBX',  12.69,  4.2, 'Industrie'   , 'Grossbritannien', 'quote/lon/RIO'],
  ['Barclays'                    , 'BARC'  ,   520.5, 'GBX',  10.82, 1.65, 'Banken'      , 'Grossbritannien', 'quote/lon/BARC'],
  ['Lloyds Banking Group'        , 'LLOY'  ,   115.2, 'GBX',  14.44, 3.17, 'Banken'      , 'Grossbritannien', 'quote/lon/LLOY'],
  ['BAE Systems'                 , 'BA1'   ,    2258, 'GBX',  32.35, 1.61, 'Ruestung'    , 'Grossbritannien', 'quote/lon/BA'],
  ['Rolls-Royce'                 , 'RR'    ,    1541, 'GBX',  42.59, 0.78, 'Luftfahrt'   , 'Grossbritannien', 'quote/lon/RR'],

  // ---------- Schweiz, Kurse in Franken an der SIX ----------
  ['Nestle'                      , 'NESN'  ,   81.01, 'CHF',  28.02, 3.83, 'Nahrung'     , 'Schweiz'        , 'quote/swx/NESN'],
  ['Roche'                       , 'RO'    ,   361.8, 'CHF',  22.98, 2.89, 'Pharma'      , 'Schweiz'        , 'quote/swx/RO'],
  ['Zurich Insurance'            , 'ZURN'  ,   592.8, 'CHF',  14.87, 5.06, 'Versicherung', 'Schweiz'        , 'quote/swx/ZURN'],
  ['ABB'                         , 'ABBN'  ,   82.78, 'CHF',  37.66, 1.14, 'Industrie'   , 'Schweiz'        , 'quote/swx/ABBN'],
  ['UBS Group'                   , 'UBSG'  ,   43.55, 'CHF',  18.37, 2.05, 'Banken'      , 'Schweiz'        , 'quote/swx/UBSG'],
  ['Richemont'                   , 'CFR'   ,  192.45, 'CHF',  35.42, 1.71, 'Luxus'       , 'Schweiz'        , 'quote/swx/CFR'],
  ['Holcim'                      , 'HOLN'  ,   71.64, 'CHF',  101.8, 2.37, 'Bau'         , 'Schweiz'        , 'quote/swx/HOLN'],
  ['Sika'                        , 'SIKA'  ,  190.85, 'CHF',  29.45, 1.94, 'Chemie'      , 'Schweiz'        , 'quote/swx/SIKA'],
  ['Swiss Re'                    , 'SREN'  ,  139.45, 'CHF',  10.51, 4.66, 'Versicherung', 'Schweiz'        , 'quote/swx/SREN'],
  ['Lonza'                       , 'LONN'  ,   562.6, 'CHF',  36.37, 0.89, 'Pharma'      , 'Schweiz'        , 'quote/swx/LONN'],

  // ---------- Japan, Kurse in Yen an der Boerse Tokio ----------
  ['Toyota Motor'                , '7203'  ,    3012, 'JPY',   8.64, 3.31, 'Automobil'   , 'Japan'          , 'quote/tyo/7203'],
  ['Sony Group'                  , '6758'  ,    3787, 'JPY',  20.88, 0.89, 'Technologie' , 'Japan'          , 'quote/tyo/6758'],
  ['Nintendo'                    , '7974'  ,    8778, 'JPY',  21.72, 1.82, 'Medien'      , 'Japan'          , 'quote/tyo/7974'],
  ['Keyence'                     , '6861'  ,   86970, 'JPY',  43.19, 0.63, 'Industrie'   , 'Japan'          , 'quote/tyo/6861'],
  ['Tokyo Electron'              , '8035'  ,   60030, 'JPY',  43.66, 1.27, 'Halbleiter'  , 'Japan'          , 'quote/tyo/8035'],
  ['Advantest'                   , '6857'  ,   37660, 'JPY',   58.5, 0.16, 'Halbleiter'  , 'Japan'          , 'quote/tyo/6857'],
  ['SoftBank Group'              , '9984'  ,    5874, 'JPY',   6.67, 0.19, 'Technologie' , 'Japan'          , 'quote/tyo/9984'],
  ['Hitachi'                     , '6501'  ,    5588, 'JPY',   32.6, 0.97, 'Industrie'   , 'Japan'          , 'quote/tyo/6501'],
  ['Mitsubishi Corporation'      , '8058'  ,    4716, 'JPY',  19.95, 2.62, 'Handel'      , 'Japan'          , 'quote/tyo/8058'],
  ['Shin-Etsu Chemical'          , '4063'  ,    6381, 'JPY',  24.87, 1.82, 'Chemie'      , 'Japan'          , 'quote/tyo/4063'],
  ['Takeda Pharmaceutical'       , '4502'  ,    5524, 'JPY', null  , 3.64, 'Pharma'      , 'Japan'          , 'quote/tyo/4502'],
  ['Honda Motor'                 , '7267'  ,  1697.5, 'JPY', null  , 4.22, 'Automobil'   , 'Japan'          , 'quote/tyo/7267'],
  ['Sumitomo Mitsui Financial'   , '8316'  ,    6934, 'JPY',  21.14, 2.58, 'Banken'      , 'Japan'          , 'quote/tyo/8316'],
  ['Fast Retailing'              , '9983'  ,   76830, 'JPY',  45.57, 0.83, 'Handel'      , 'Japan'          , 'quote/tyo/9983'],
  ['Nippon Telegraph & Telephone', '9432'  ,   161.8, 'JPY',  12.67, 3.32, 'Telekom'     , 'Japan'          , 'quote/tyo/9432'],

  // ---------- Suedkorea, Kurse in Won an der KRX ----------
  ['Samsung Electronics'         , '005930',  274500, 'KRW',  12.09, 0.82, 'Technologie' , 'Suedkorea'      , 'quote/krx/005930'],
  ['Hyundai Motor'               , '005380',  453000, 'KRW',  14.33, 2.21, 'Automobil'   , 'Suedkorea'      , 'quote/krx/005380'],
  ['Kia'                         , '000270',  141700, 'KRW',   7.87,  4.8, 'Automobil'   , 'Suedkorea'      , 'quote/krx/000270'],
  ['NAVER'                       , '035420',  228000, 'KRW',  18.99, 1.15, 'Technologie' , 'Suedkorea'      , 'quote/krx/035420'],
  ['Samsung Biologics'           , '207940', 1548000, 'KRW',  38.49,    0, 'Pharma'      , 'Suedkorea'      , 'quote/krx/207940'],
  ['POSCO Holdings'              , '005490',  334000, 'KRW',  19.51,  2.4, 'Industrie'   , 'Suedkorea'      , 'quote/krx/005490'],
  ['LG Energy Solution'          , '373220',  369500, 'KRW', null  ,    0, 'Industrie'   , 'Suedkorea'      , 'quote/krx/373220'],

  // ---------- Hongkong, Kurse in Hongkong-Dollar ----------
  ['Tencent Holdings'            , '0700'  ,   448.8, 'HKD',  14.98,  1.2, 'Technologie' , 'Hongkong'       , 'quote/hkg/0700'],
  ['AIA Group'                   , '1299'  ,   73.05, 'HKD',  15.33, 2.74, 'Versicherung', 'Hongkong'       , 'quote/hkg/1299'],
  ['Hong Kong Exchanges'         , '0388'  ,     407, 'HKD',  27.31, 3.21, 'Finanzen'    , 'Hongkong'       , 'quote/hkg/0388'],

  // ---------- Kanada, Kurse in kanadischen Dollar an der TSX ----------
  ['Shopify'                     , 'SHOP'  ,  214.35, 'CAD', 100.64,    0, 'Technologie' , 'Kanada'         , 'quote/tsx/SHOP'],
  ['Toronto-Dominion Bank'       , 'TD'    ,  172.61, 'CAD',  20.39,  2.6, 'Banken'      , 'Kanada'         , 'quote/tsx/TD'],
  ['Bank of Nova Scotia'         , 'BNS'   ,  126.98, 'CAD',  17.49, 3.59, 'Banken'      , 'Kanada'         , 'quote/tsx/BNS'],
  ['Bank of Montreal'            , 'BMO'   ,  257.88, 'CAD',  19.81, 2.65, 'Banken'      , 'Kanada'         , 'quote/tsx/BMO'],
  ['Enbridge'                    , 'ENB'   ,   70.61, 'CAD',  27.26,  5.5, 'Energie'     , 'Kanada'         , 'quote/tsx/ENB'],
  ['Canadian Natural Resources'  , 'CNQ'   ,   66.41, 'CAD',  11.81, 3.76, 'Energie'     , 'Kanada'         , 'quote/tsx/CNQ'],
  ['Canadian National Railway'   , 'CNR'   ,  175.87, 'CAD',  22.57, 2.08, 'Logistik'    , 'Kanada'         , 'quote/tsx/CNR'],
  ['Canadian Pacific Kansas City', 'CP'    ,  129.78, 'CAD',  30.19, 0.83, 'Logistik'    , 'Kanada'         , 'quote/tsx/CP'],
  ['BCE'                         , 'BCE'   ,   32.57, 'CAD',   4.84, 5.37, 'Telekom'     , 'Kanada'         , 'quote/tsx/BCE'],
  ['Brookfield Corporation'      , 'BN1'   ,   60.86, 'CAD',  79.73, 0.64, 'Finanzen'    , 'Kanada'         , 'quote/tsx/BN'],

  // ---------- USA ----------
  ['Boeing'                      , 'BA'    ,  231.67, 'USD',  86.39,    0, 'Luftfahrt'   , 'USA'            , 'stocks/ba'],
  ['Walt Disney'                 , 'DIS'   ,  106.85, 'USD',  22.09,  1.4, 'Medien'      , 'USA'            , 'stocks/dis'],
  ['Verizon Communications'      , 'VZ'    ,   48.48, 'USD',  12.63, 5.84, 'Telekom'     , 'USA'            , 'stocks/vz'],
  ['Lockheed Martin'             , 'LMT'   ,  608.68, 'USD',  22.43, 2.27, 'Ruestung'    , 'USA'            , 'stocks/lmt'],
  ['American Tower'              , 'AMT'   ,  175.58, 'USD',  24.15, 4.08, 'Immobilien'  , 'USA'            , 'stocks/amt'],
  ['Salesforce'                  , 'CRM'   ,  196.21, 'USD',  22.78,  0.9, 'Technologie' , 'USA'            , 'stocks/crm'],
  ['Adobe'                       , 'ADBE'  ,  264.02, 'USD',   15.1,    0, 'Technologie' , 'USA'            , 'stocks/adbe'],
  ['Qualcomm'                    , 'QCOM'  ,  165.79, 'USD',  19.29, 2.22, 'Halbleiter'  , 'USA'            , 'stocks/qcom'],
  ['IBM'                         , 'IBM'   ,  234.32, 'USD',  20.83, 2.89, 'Technologie' , 'USA'            , 'stocks/ibm'],
  ['Pfizer'                      , 'PFE'   ,   26.79, 'USD',  35.22, 6.42, 'Pharma'      , 'USA'            , 'stocks/pfe'],
  ['AbbVie'                      , 'ABBV'  ,  249.46, 'USD',  70.47, 2.77, 'Pharma'      , 'USA'            , 'stocks/abbv'],
  ['McDonald\'s'                 , 'MCD'   ,  272.83, 'USD',  22.16, 2.73, 'Nahrung'     , 'USA'            , 'stocks/mcd'],
  ['Nike'                        , 'NKE'   ,   40.73, 'USD',   19.4, 4.03, 'Konsum'      , 'USA'            , 'stocks/nke'],
  ['PepsiCo'                     , 'PEP'   ,  140.79, 'USD',  18.45, 4.21, 'Nahrung'     , 'USA'            , 'stocks/pep'],
  ['Coinbase'                    , 'COIN'  ,  148.47, 'USD', null  ,    0, 'Finanzen'    , 'USA'            , 'stocks/coin'],




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





  ['Vanguard S&P 500 ETF'                             , 'VOO' , 713.61,  1050,   520, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/voo'],
  ['Invesco QQQ Trust'                                , 'QQQ' , 731.07, 496.1,   105, 0.18, true, 'USA Technologie' , 'Aktien'  , 'etf/qqq'],
  ['Vanguard Total World Stock ETF'                   , 'VT'  , 162.25,    82, 10144, 0.06, true, 'Welt'            , 'Aktien'  , 'etf/vt'],
  ['Vanguard FTSE Developed Markets ETF'              , 'VEA' ,  73.58, 239.2,  3877, 0.03, true, 'Welt ohne USA'   , 'Aktien'  , 'etf/vea'],
  ['Vanguard FTSE Emerging Markets ETF'               , 'VWO' ,  60.11, 125.3,  5063, 0.06, true, 'Schwellenlaender', 'Aktien'  , 'etf/vwo'],
  ['iShares MSCI EAFE ETF'                            , 'EFA' , 108.64,  80.2,   699, 0.32, true, 'Europa/Asien'    , 'Aktien'  , 'etf/efa'],
  ['iShares Russell 2000 ETF'                         , 'IWM' , 305.09,  83.3,  1971, 0.19, true, 'USA klein'       , 'Aktien'  , 'etf/iwm'],
  ['iShares Core S&P Mid-Cap ETF'                     , 'IJH' ,  78.67, 128.7,   414, 0.05, true, 'USA mittel'      , 'Aktien'  , 'etf/ijh'],
  ['SPDR Dow Jones Industrial Average ETF'            , 'DIA' ,  536.8,  46.9,    31, 0.16, true, 'USA Standard'    , 'Aktien'  , 'etf/dia'],
  ['Invesco S&P 500 Equal Weight ETF'                 , 'RSP' , 222.77,  98.8,   509,  0.2, true, 'USA breit'       , 'Aktien'  , 'etf/rsp'],
  ['Vanguard Growth ETF'                              , 'VUG' ,  89.34, 229.8,   151, 0.03, true, 'USA Wachstum'    , 'Aktien'  , 'etf/vug'],
  ['Vanguard Value ETF'                               , 'VTV' , 227.51, 194.5,   326, 0.03, true, 'USA Substanz'    , 'Aktien'  , 'etf/vtv'],
  ['Schwab US Dividend Equity ETF'                    , 'SCHD',  34.52, 109.2,   103, 0.06, true, 'Dividenden'      , 'Aktien'  , 'etf/schd'],
  ['Vanguard High Dividend Yield ETF'                 , 'VYM' , 166.52,  84.3,   618, 0.04, true, 'Dividenden'      , 'Aktien'  , 'etf/vym'],
  ['Technology Select Sector SPDR'                    , 'XLK' , 190.01,   124,    76, 0.08, true, 'Technologie'     , 'Aktien'  , 'etf/xlk'],
  ['iShares Semiconductor ETF'                        , 'SOXX', 550.42,  43.5,    34, 0.33, true, 'Halbleiter'      , 'Aktien'  , 'etf/soxx'],
  ['Health Care Select Sector SPDR'                   , 'XLV' , 167.37,  43.7,    63, 0.08, true, 'Gesundheit'      , 'Aktien'  , 'etf/xlv'],
  ['Financial Select Sector SPDR'                     , 'XLF' ,  58.16,  58.3,    80, 0.08, true, 'Finanzen'        , 'Aktien'  , 'etf/xlf'],
  ['Energy Select Sector SPDR'                        , 'XLE' ,  61.91,  40.5,    24, 0.08, true, 'Energie'         , 'Aktien'  , 'etf/xle'],
  ['Vanguard Real Estate ETF'                         , 'VNQ' ,  98.83,  39.2,   157, 0.13, true, 'Immobilien'      , 'Aktien'  , 'etf/vnq'],
  ['SPDR Gold Shares'                                 , 'GLD' , 401.48, 144.5,     2,  0.4, true, 'Rohstoffe'       , 'Rohstoff', 'etf/gld'],
  ['iShares Core US Aggregate Bond ETF'               , 'AGG' ,  97.48,   138, 13371, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/agg'],
  ['iShares 20+ Year Treasury Bond ETF'               , 'TLT' ,  82.04,  45.7,    48, 0.15, true, 'Anleihen'        , 'Anleihen', 'etf/tlt'],
  ['Vanguard Interm.-Term Corp. Bond ETF'             , 'VCIT',  81.23,  67.9,  2268, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/vcit'],
  ['iShares Bitcoin Trust'                            , 'IBIT',  35.63,    47,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/ibit'],

  // ---------- Ausbau 2026-08-08 ----------
  ['SPDR S&P 500 ETF Trust'                           , 'SPY' , 776.34,   824,   505, 0.09, true, 'USA breit'       , 'Aktien'  , 'etf/spy'],
  ['iShares Core S&P 500 ETF'                         , 'IVV' , 780.04, 905.5,   508, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/ivv'],
  ['Vanguard Total Stock Market ETF'                  , 'VTI' , 383.85, 696.1,  3498, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/vti'],
  ['iShares Core MSCI EAFE ETF'                       , 'IEFA', 101.19, 195.8,  2641, 0.07, true, 'Europa/Asien'    , 'Aktien'  , 'etf/iefa'],
  ['iShares Core MSCI Emerging Markets ETF'           , 'IEMG',  81.19,   159,  2896, 0.09, true, 'Schwellenlaender', 'Aktien'  , 'etf/iemg'],
  ['iShares MSCI Japan ETF'                           , 'EWJ' ,  98.21,  23.1,   175, 0.49, true, 'Japan'           , 'Aktien'  , 'etf/ewj'],
  ['iShares MSCI Eurozone ETF'                        , 'EZU' ,  71.99,    10,   226,  0.5, true, 'Eurozone'        , 'Aktien'  , 'etf/ezu'],
  ['iShares China Large-Cap ETF'                      , 'FXI' ,  34.89,   4.2,    59, 0.74, true, 'China'           , 'Aktien'  , 'etf/fxi'],
  ['iShares MSCI India ETF'                           , 'INDA',  49.78,   6.7,   173, 0.61, true, 'Indien'          , 'Aktien'  , 'etf/inda'],
  ['Industrial Select Sector SPDR'                    , 'XLI' , 186.51,  34.7,    86, 0.08, true, 'Industrie'       , 'Aktien'  , 'etf/xli'],
  ['Consumer Discretionary Select Sector SPDR'        , 'XLY' ,  118.2,  23.4,    50, 0.08, true, 'Konsum'          , 'Aktien'  , 'etf/xly'],
  ['Consumer Staples Select Sector SPDR'              , 'XLP' ,  86.09,  14.9,    38, 0.08, true, 'Nahrung'         , 'Aktien'  , 'etf/xlp'],
  ['Utilities Select Sector SPDR'                     , 'XLU' ,  44.31,  22.9,    34, 0.08, true, 'Versorger'       , 'Aktien'  , 'etf/xlu'],
  ['Communication Services Select Sector SPDR'        , 'XLC' , 112.95,  22.7,    26, 0.08, true, 'Medien'          , 'Aktien'  , 'etf/xlc'],
  ['iShares Silver Trust'                             , 'SLV' ,  58.48,  31.8,     1,  0.5, true, 'Rohstoffe'       , 'Rohstoff', 'etf/slv'],
  ['Invesco DB Commodity Index Tracking Fund'         , 'DBC' ,     30,   1.8,    41, 0.84, true, 'Rohstoffe'       , 'Rohstoff', 'etf/dbc'],
  ['iShares iBoxx Investment Grade Corporate Bond ETF', 'LQD' , 106.12,  33.2,  3143, 0.14, true, 'Anleihen'        , 'Anleihen', 'etf/lqd'],
  ['iShares iBoxx High Yield Corporate Bond ETF'      , 'HYG' ,  79.71,    18,  1333, 0.49, true, 'Anleihen'        , 'Anleihen', 'etf/hyg'],
  ['iShares Ethereum Trust'                           , 'ETHA',  14.18,   5.6,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/etha'],




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





  ['Bitcoin'     , 'BTC' ,    54812, 1100117254842,     20071346,     21000000,   107662, 'coingecko/bitcoin'],
  ['Ethereum'    , 'ETH' ,  1639.35,  197832270281,    120681932, null        ,  4229.76, 'coingecko/ethereum'],
  ['XRP'         , 'XRP' , 0.865586,   54248301400,  62676938832, 100000000000,     3.28, 'coingecko/ripple'],
  ['Solana'      , 'SOL' ,     65.1,   37945038260,    582899583, null        ,    285.6, 'coingecko/solana'],
  ['Dogecoin'    , 'DOGE', 0.060569,    9420046959, 155526026384, null        , 0.601466, 'coingecko/dogecoin'],
  ['Cardano'     , 'ADA' , 0.152477,    5696822250,  37359859978,  45000000000,     2.61, 'coingecko/cardano'],
  ['Chainlink'   , 'LINK',     8.14,    6089826707,    748099970,   1000000000,    43.32, 'coingecko/chainlink'],
  ['Litecoin'    , 'LTC' ,    38.13,    2955010505,     77503154,     84000000,   337.56, 'coingecko/litecoin'],
  ['Avalanche'   , 'AVAX',     5.47,    2362434855,    431771961,    720000000,   128.43, 'coingecko/avalanche-2'],
  ['Polkadot'    , 'DOT' , 0.659194,    1119651977,   1698389301,   2100000000,     47.6, 'coingecko/polkadot'],

  // ---------- Ausbau 2026-08-08 ----------
  ['BNB'         , 'BNB' ,   522.42,   69563792240,    133163748,    200000000,  1182.86, 'coingecko/binancecoin'],
  ['Tron'        , 'TRX' , 0.286756,   27213590926,  94904800478, null        , 0.410308, 'coingecko/tron'],
  ['Toncoin'     , 'TON' ,     1.15,    3175334451,   2759533209, null        ,      7.7, 'coingecko/the-open-network'],
  ['Aave'        , 'AAVE',    74.42,    1147675656,     15422794,     16000000,   541.28, 'coingecko/aave'],
  ['Stellar'     , 'XLM' , 0.136856,    4725440672,  34530901002, null        , 0.729104, 'coingecko/stellar'],
  ['Bitcoin Cash', 'BCH' ,   177.02,    3553459196,     20076359,     21000000,  3187.12, 'coingecko/bitcoin-cash'],
  ['Monero'      , 'XMR' ,   359.11,    6748386140,     18792300, null        ,   685.48, 'coingecko/monero'],
  ['Uniswap'     , 'UNI' ,      2.8,    1748731350,    623982424,   1000000000,    37.37, 'coingecko/uniswap'],




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
