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
const STAND = '2026-08-28';
const EUR_USD = 1.1643; // 1 EUR = 1.1643 USD (EZB via frankfurter.dev, 2026-08-28)

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
  CAD: 1.613,
  CHF: 0.9364,
  GBP: 0.8572,
  HKD: 9.1276,
  JPY: 185.92,
  KRW: 1600.39,
  USD: 1.1643,
};

/**
 * Aktien.
 * [name, kuerzel, kurs, waehrung, kgv, divRenditeProzent, sektor, land, quelle]
 * kgv === null bedeutet: kein sinnvolles KGV (Verlustjahr) -> die App zeigt einen Strich.
 * quelle ist der Pfad bei stockanalysis.com, den hole-kurse.js abruft.
 */
const AKTIEN = [







  // ---------- Deutschland (DAX), Kurse in Euro, Xetra 2026-08-07 11:34 ----------
  ['SAP'                         , 'SAP'   ,  191.32, 'EUR',  28.64, 1.37, 'Technologie' , 'Deutschland'    , 'quote/etr/SAP'],
  ['Siemens'                     , 'SIE'   ,  289.85, 'EUR',  28.68, 1.93, 'Industrie'   , 'Deutschland'    , 'quote/etr/SIE'],
  ['Allianz'                     , 'ALV'   ,     453, 'EUR',  14.84, 3.87, 'Versicherung', 'Deutschland'    , 'quote/etr/ALV'],
  ['Rheinmetall'                 , 'RHM'   ,  1154.6, 'EUR',  44.96, 0.98, 'Ruestung'    , 'Deutschland'    , 'quote/etr/RHM'],
  ['Mercedes-Benz Group'         , 'MBG'   ,  46.945, 'EUR',    8.9, 7.77, 'Automobil'   , 'Deutschland'    , 'quote/etr/MBG'],
  ['BMW'                         , 'BMW'   ,   62.64, 'EUR',    5.7, 7.34, 'Automobil'   , 'Deutschland'    , 'quote/etr/BMW'],
  ['Volkswagen Vorzuege'         , 'VOW3'  ,   77.42, 'EUR',   7.17, 7.03, 'Automobil'   , 'Deutschland'    , 'quote/etr/VOW3'],
  ['Deutsche Bank'               , 'DBK'   ,  34.905, 'EUR',  11.12, 3.07, 'Banken'      , 'Deutschland'    , 'quote/etr/DBK'],
  ['Commerzbank'                 , 'CBK'   ,   40.48, 'EUR',  15.29, 2.82, 'Banken'      , 'Deutschland'    , 'quote/etr/CBK'],
  ['adidas'                      , 'ADS'   ,   154.2, 'EUR',  19.67, 1.81, 'Konsum'      , 'Deutschland'    , 'quote/etr/ADS'],
  ['Zalando'                     , 'ZAL'   ,   24.16, 'EUR',  65.09,    0, 'Handel'      , 'Deutschland'    , 'quote/etr/ZAL'],
  ['Infineon'                    , 'IFX'   ,   57.08, 'EUR',  62.12, 0.63, 'Halbleiter'  , 'Deutschland'    , 'quote/etr/IFX'],
  ['BASF'                        , 'BAS'   ,   52.52, 'EUR',  21.77, 4.41, 'Chemie'      , 'Deutschland'    , 'quote/etr/BAS'],
  ['Bayer'                       , 'BAYN'  ,   48.67, 'EUR', null  , 0.22, 'Pharma'      , 'Deutschland'    , 'quote/etr/BAYN'],
  ['Merck'                       , 'MRK1'  ,  140.25, 'EUR',  25.71, 1.59, 'Pharma'      , 'Deutschland'    , 'quote/etr/MRK'],
  ['Deutsche Telekom'            , 'DTE'   ,   28.52, 'EUR',  15.78, 3.43, 'Telekom'     , 'Deutschland'    , 'quote/etr/DTE'],
  ['DHL Group'                   , 'DHL'   ,   56.52, 'EUR',  17.18, 3.44, 'Logistik'    , 'Deutschland'    , 'quote/etr/DHL'],
  ['E.ON'                        , 'EOAN'  ,   17.83, 'EUR',  13.95, 3.25, 'Versorger'   , 'Deutschland'    , 'quote/etr/EOAN'],
  ['RWE'                         , 'RWE'   ,    59.1, 'EUR',  13.07,  2.1, 'Versorger'   , 'Deutschland'    , 'quote/etr/RWE'],
  ['Siemens Energy'              , 'ENR'   ,   149.7, 'EUR',  48.87, 0.45, 'Versorger'   , 'Deutschland'    , 'quote/etr/ENR'],
  ['Muenchener Rueck'            , 'MUV2'  ,     518, 'EUR',   9.58, 4.58, 'Versicherung', 'Deutschland'    , 'quote/etr/MUV2'],
  ['Hannover Rueck'              , 'HNR1'  ,   257.4, 'EUR',   11.3, 4.88, 'Versicherung', 'Deutschland'    , 'quote/etr/HNR1'],
  ['Deutsche Boerse'             , 'DB1'   ,   291.2, 'EUR',  24.91, 1.51, 'Finanzen'    , 'Deutschland'    , 'quote/etr/DB1'],
  ['Beiersdorf'                  , 'BEI'   ,   80.42, 'EUR',  18.75, 1.28, 'Konsum'      , 'Deutschland'    , 'quote/etr/BEI'],
  ['Henkel Vorzuege'             , 'HEN3'  ,   75.82, 'EUR',  16.14, 2.74, 'Konsum'      , 'Deutschland'    , 'quote/etr/HEN3'],
  ['Continental'                 , 'CON'   ,      70, 'EUR', null  , 3.98, 'Automobil'   , 'Deutschland'    , 'quote/etr/CON'],
  ['Daimler Truck'               , 'DTG'   ,   46.77, 'EUR',   33.3,  4.2, 'Automobil'   , 'Deutschland'    , 'quote/etr/DTG'],
  ['MTU Aero Engines'            , 'MTX'   ,   359.6, 'EUR',  20.77,    1, 'Luftfahrt'   , 'Deutschland'    , 'quote/etr/MTX'],
  ['Heidelberg Materials'        , 'HEI'   ,  170.05, 'EUR',  14.62, 2.28, 'Bau'         , 'Deutschland'    , 'quote/etr/HEI'],
  ['Vonovia'                     , 'VNA'   ,   19.85, 'EUR',   4.65, 6.27, 'Immobilien'  , 'Deutschland'    , 'quote/etr/VNA'],

  // ---------- Europa ohne Deutschland, Kurse in Euro ----------
  ['ASML'                        , 'ASML'  ,  1494.4, 'EUR',  53.98,  0.5, 'Halbleiter'  , 'Niederlande'    , 'quote/ams/ASML'],
  ['LVMH'                        , 'MC'    ,  458.15, 'EUR',  20.89,  2.9, 'Luxus'       , 'Frankreich'     , 'quote/epa/MC'],
  ['Hermes'                      , 'RMS'   ,    1598, 'EUR',  36.35, 1.14, 'Luxus'       , 'Frankreich'     , 'quote/epa/RMS'],
  ['LOreal'                      , 'OR'    ,   388.5, 'EUR',  32.67, 1.88, 'Konsum'      , 'Frankreich'     , 'quote/epa/OR'],
  ['TotalEnergies'               , 'TTE'   ,   74.67, 'EUR',  10.56, 4.85, 'Energie'     , 'Frankreich'     , 'quote/epa/TTE'],
  ['Sanofi'                      , 'SAN'   ,   77.25, 'EUR',  23.79, 5.24, 'Pharma'      , 'Frankreich'     , 'quote/epa/SAN'],
  ['Air Liquide'                 , 'AI'    ,   169.8, 'EUR',  30.01, 2.02, 'Chemie'      , 'Frankreich'     , 'quote/epa/AI'],
  ['Schneider Electric'          , 'SU'    ,  301.75, 'EUR',   36.3, 1.42, 'Industrie'   , 'Frankreich'     , 'quote/epa/SU'],
  ['SAFRAN'                      , 'SAF'   ,   344.2, 'EUR',  36.86, 0.96, 'Luftfahrt'   , 'Frankreich'     , 'quote/epa/SAF'],
  ['AXA'                         , 'CS'    ,   43.61, 'EUR',  11.58, 5.28, 'Versicherung', 'Frankreich'     , 'quote/epa/CS'],
  ['BNP Paribas'                 , 'BNP'   ,  102.56, 'EUR',   8.72, 4.79, 'Banken'      , 'Frankreich'     , 'quote/epa/BNP'],
  ['VINCI'                       , 'DG'    ,  114.35, 'EUR',  12.73, 4.15, 'Bau'         , 'Frankreich'     , 'quote/epa/DG'],
  ['Danone'                      , 'BN'    ,    64.4, 'EUR',  21.43, 3.44, 'Nahrung'     , 'Frankreich'     , 'quote/epa/BN'],
  ['EssilorLuxottica'            , 'EL'    ,  161.35, 'EUR',  29.43, 2.45, 'Konsum'      , 'Frankreich'     , 'quote/epa/EL'],
  ['Airbus'                      , 'AIR'   ,  203.05, 'EUR',  27.09, 1.54, 'Luftfahrt'   , 'Niederlande'    , 'quote/epa/AIR'],
  ['Ferrari'                     , 'RACE'  ,  362.65, 'EUR',  38.56,    1, 'Automobil'   , 'Italien'        , 'quote/bit/RACE'],
  ['Adyen'                       , 'ADYEN' ,  1090.4, 'EUR',  30.35,    0, 'Finanzen'    , 'Niederlande'    , 'quote/ams/ADYEN'],
  ['ING Group'                   , 'INGA'  ,   30.46, 'EUR',  10.09,  4.4, 'Banken'      , 'Niederlande'    , 'quote/ams/INGA'],
  ['AB InBev'                    , 'ABI'   ,   68.28, 'EUR',  16.57, 1.73, 'Nahrung'     , 'Belgien'        , 'quote/ebr/ABI'],
  ['Inditex'                     , 'ITX'   ,   58.32, 'EUR',  28.91,    3, 'Handel'      , 'Spanien'        , 'quote/bme/ITX'],
  ['Banco Santander'             , 'SAN2'  ,  12.712, 'EUR',  14.22, 1.97, 'Banken'      , 'Spanien'        , 'quote/bme/SAN'],
  ['Iberdrola'                   , 'IBE'   ,   20.28, 'EUR',  24.58, 3.37, 'Versorger'   , 'Spanien'        , 'quote/bme/IBE'],
  ['Enel'                        , 'ENEL'  ,    9.46, 'EUR',  22.46, 5.17, 'Versorger'   , 'Italien'        , 'quote/bit/ENEL'],
  ['Eni'                         , 'ENI'   ,   22.79, 'EUR',  11.96, 4.74, 'Energie'     , 'Italien'        , 'quote/bit/ENI'],
  ['UniCredit'                   , 'UCG'   ,   84.71, 'EUR',  12.03, 3.82, 'Banken'      , 'Italien'        , 'quote/bit/UCG'],
  ['Intesa Sanpaolo'             , 'ISP'   ,    6.78, 'EUR',  12.15,  5.6, 'Banken'      , 'Italien'        , 'quote/bit/ISP'],

  // ---------- USA, Kurse in Dollar ----------
  ['NVIDIA'                      , 'NVDA'  ,  218.57, 'USD',  28.83, 0.46, 'Halbleiter'  , 'USA'            , 'stocks/nvda'],
  ['Apple'                       , 'AAPL'  ,  319.67, 'USD',  36.09, 0.34, 'Technologie' , 'USA'            , 'stocks/aapl'],
  ['Alphabet'                    , 'GOOGL' ,  346.88, 'USD',  17.09, 0.25, 'Technologie' , 'USA'            , 'stocks/googl'],
  ['Microsoft'                   , 'MSFT'  ,  515.01, 'USD',  28.14, 0.71, 'Technologie' , 'USA'            , 'stocks/msft'],
  ['Amazon'                      , 'AMZN'  , 265.095, 'USD',  20.61,    0, 'Handel'      , 'USA'            , 'stocks/amzn'],
  ['Broadcom'                    , 'AVGO'  ,  368.23, 'USD',  61.83, 0.71, 'Halbleiter'  , 'USA'            , 'stocks/avgo'],
  ['Meta Platforms'              , 'META'  ,     576, 'USD',  21.52, 0.36, 'Technologie' , 'USA'            , 'stocks/meta'],
  ['Tesla'                       , 'TSLA'  ,  346.49, 'USD', 368.19,    0, 'Automobil'   , 'USA'            , 'stocks/tsla'],
  ['Berkshire Hathaway'          , 'BRK.B' ,  505.62, 'USD',  12.57,    0, 'Finanzen'    , 'USA'            , 'stocks/brk.b'],
  ['Micron Technology'           , 'MU'    ,  930.83, 'USD',  21.11, 0.06, 'Halbleiter'  , 'USA'            , 'stocks/mu'],
  ['JPMorgan Chase'              , 'JPM'   ,  355.83, 'USD',   15.2, 1.69, 'Banken'      , 'USA'            , 'stocks/jpm'],
  ['Walmart'                     , 'WMT'   ,  102.95, 'USD',  37.19, 0.96, 'Handel'      , 'USA'            , 'stocks/wmt'],
  ['AMD'                         , 'AMD'   ,   470.2, 'USD', 121.66,    0, 'Halbleiter'  , 'USA'            , 'stocks/amd'],
  ['Visa'                        , 'V'     ,  382.31, 'USD',  32.32,  0.7, 'Finanzen'    , 'USA'            , 'stocks/v'],
  ['Johnson & Johnson'           , 'JNJ'   , 265.625, 'USD',  30.81, 2.02, 'Pharma'      , 'USA'            , 'stocks/jnj'],
  ['Cisco'                       , 'CSCO'  ,  110.32, 'USD',  33.68, 1.52, 'Technologie' , 'USA'            , 'stocks/csco'],
  ['Costco'                      , 'COST'  ,  947.25, 'USD',  47.01, 0.62, 'Handel'      , 'USA'            , 'stocks/cost'],
  ['Applied Materials'           , 'AMAT'  ,  463.46, 'USD',  41.61, 0.46, 'Halbleiter'  , 'USA'            , 'stocks/amat'],
  ['Caterpillar'                 , 'CAT'   ,  802.81, 'USD',  35.21, 0.81, 'Industrie'   , 'USA'            , 'stocks/cat'],
  ['Lam Research'                , 'LRCX'  ,  305.45, 'USD',  55.31, 0.34, 'Halbleiter'  , 'USA'            , 'stocks/lrcx'],
  ['Palantir'                    , 'PLTR'  ,   185.8, 'USD', 159.02,    0, 'Technologie' , 'USA'            , 'stocks/pltr'],
  ['Coca-Cola'                   , 'KO'    ,  89.785, 'USD',  26.77, 2.36, 'Nahrung'     , 'USA'            , 'stocks/ko'],
  ['Chevron'                     , 'CVX'   ,  201.55, 'USD',  19.19, 3.53, 'Energie'     , 'USA'            , 'stocks/cvx'],
  ['UnitedHealth'                , 'UNH'   ,  394.52, 'USD',  25.43, 2.35, 'Gesundheit'  , 'USA'            , 'stocks/unh'],
  ['Home Depot'                  , 'HD'    ,  328.65, 'USD',  22.99, 2.84, 'Handel'      , 'USA'            , 'stocks/hd'],
  ['Procter & Gamble'            , 'PG'    ,  143.29, 'USD',  21.61, 3.04, 'Konsum'      , 'USA'            , 'stocks/pg'],
  ['Merck & Co'                  , 'MRK'   ,  147.55, 'USD', 117.49,  2.3, 'Pharma'      , 'USA'            , 'stocks/mrk'],
  ['Goldman Sachs'               , 'GS'    ,    1033, 'USD',   16.1, 1.94, 'Banken'      , 'USA'            , 'stocks/gs'],
  ['Netflix'                     , 'NFLX'  ,    81.5, 'USD',  25.15,    0, 'Medien'      , 'USA'            , 'stocks/nflx'],
  ['Texas Instruments'           , 'TXN'   ,  257.62, 'USD',  40.49, 2.21, 'Halbleiter'  , 'USA'            , 'stocks/txn'],
  ['KLA'                         , 'KLAC'  ,  176.08, 'USD',  50.21, 0.52, 'Halbleiter'  , 'USA'            , 'stocks/klac'],
  ['American Express'            , 'AXP'   ,   333.2, 'USD',  20.29, 1.14, 'Finanzen'    , 'USA'            , 'stocks/axp'],
  ['Palo Alto Networks'          , 'PANW'  ,  369.61, 'USD', 346.83,    0, 'Technologie' , 'USA'            , 'stocks/panw'],
  ['Intel'                       , 'INTC'  ,   89.35, 'USD', null  ,    0, 'Halbleiter'  , 'USA'            , 'stocks/intc'],
  ['Mastercard'                  , 'MA'    ,  596.03, 'USD',  32.54, 0.58, 'Finanzen'    , 'USA'            , 'stocks/ma'],
  ['Eli Lilly'                   , 'LLY'   ,    1168, 'USD',  39.48, 0.59, 'Pharma'      , 'USA'            , 'stocks/lly'],
  ['ExxonMobil'                  , 'XOM'   ,  155.73, 'USD',  20.17, 2.65, 'Energie'     , 'USA'            , 'stocks/xom'],
  ['Oracle'                      , 'ORCL'  ,  150.58, 'USD',  26.06, 1.33, 'Technologie' , 'USA'            , 'stocks/orcl'],
  ['GE Aerospace'                , 'GE'    ,  342.24, 'USD',   40.4, 0.55, 'Luftfahrt'   , 'USA'            , 'stocks/ge'],
  ['Bank of America'             , 'BAC'   ,   62.32, 'USD',  14.13, 2.06, 'Banken'      , 'USA'            , 'stocks/bac'],

  // ---------- Asien und Sonstige, Kurse in Dollar (Zweitnotiz in New York) ----------
  ['TSMC'                        , 'TSM'   ,  419.88, 'USD',  28.43, 0.77, 'Halbleiter'  , 'Taiwan'         , 'stocks/tsm'],
  ['SK hynix'                    , 'SKHY'  , 1653000, 'KRW',   7.26, 0.18, 'Halbleiter'  , 'Suedkorea'      , 'quote/krx/000660'],
  ['Alibaba'                     , 'BABA'  ,  118.24, 'USD',  26.55, 0.89, 'Handel'      , 'China'          , 'stocks/baba'],
  ['Mitsubishi UFJ'              , 'MUFG'  ,   22.83, 'USD',  21.08, 1.94, 'Banken'      , 'Japan'          , 'stocks/mufg'],
  ['Arm Holdings'                , 'ARM'   ,  241.41, 'USD',  260.5,    0, 'Halbleiter'  , 'Grossbritannien', 'stocks/arm'],
  ['Shell'                       , 'SHEL'  ,   90.71, 'USD',   9.59, 3.33, 'Energie'     , 'Grossbritannien', 'stocks/shel'],
  ['AstraZeneca'                 , 'AZN'   , 161.785, 'USD',   24.1,    2, 'Pharma'      , 'Grossbritannien', 'stocks/azn'],
  ['HSBC'                        , 'HSBC'  ,  103.42, 'USD',   16.6, 3.61, 'Banken'      , 'Grossbritannien', 'stocks/hsbc'],
  ['Novartis'                    , 'NVS'   ,  153.09, 'USD',  23.11, 2.01, 'Pharma'      , 'Schweiz'        , 'stocks/nvs'],
  ['Royal Bank of Canada'        , 'RY'    ,  204.29, 'USD',  18.07, 2.41, 'Banken'      , 'Kanada'         , 'stocks/ry'],

  // ---------- Deutschland (MDAX/DAX-Nachzuegler) ----------
  ['Porsche AG'                  , 'P911'  ,   45.95, 'EUR',  49.53, 2.26, 'Automobil'   , 'Deutschland'    , 'quote/etr/P911'],
  ['Fresenius'                   , 'FRE'   ,  45.855, 'EUR',  16.65, 2.26, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FRE'],
  ['Fresenius Medical Care'      , 'FME'   ,   39.92, 'EUR',     12, 3.66, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/FME'],
  ['Symrise'                     , 'SY1'   ,    92.9, 'EUR',  51.96, 1.43, 'Chemie'      , 'Deutschland'    , 'quote/etr/SY1'],
  ['Sartorius Vorzuege'          , 'SRT3'  ,   253.5, 'EUR',  78.62, 0.32, 'Gesundheit'  , 'Deutschland'    , 'quote/etr/SRT3'],
  ['Talanx'                      , 'TLX'   ,   125.4, 'EUR',  12.31, 3.06, 'Versicherung', 'Deutschland'    , 'quote/etr/TLX'],

  // ---------- Europa ohne Deutschland ----------
  ['Publicis Groupe'             , 'PUB'   ,  101.65, 'EUR',  15.78, 3.68, 'Medien'      , 'Frankreich'     , 'quote/epa/PUB'],
  ['Stellantis'                  , 'STLA'  ,   4.681, 'EUR', null  ,    0, 'Automobil'   , 'Niederlande'    , 'quote/epa/STLAP'],
  ['Prosus'                      , 'PRX'   ,   38.69, 'EUR',   8.38, 0.74, 'Technologie' , 'Niederlande'    , 'quote/ams/PRX'],
  ['Generali'                    , 'G'     ,   44.13, 'EUR',   14.9, 3.83, 'Versicherung', 'Italien'        , 'quote/bit/G'],
  ['BBVA'                        , 'BBVA'  ,   25.04, 'EUR',  13.03, 3.73, 'Banken'      , 'Spanien'        , 'quote/bme/BBVA'],
  ['Telefonica'                  , 'TEF'   ,   3.625, 'EUR', null  , 8.15, 'Telekom'     , 'Spanien'        , 'quote/bme/TEF'],
  ['KBC Group'                   , 'KBC'   ,   132.4, 'EUR',  14.59, 3.89, 'Banken'      , 'Belgien'        , 'quote/ebr/KBC'],

  // ---------- Grossbritannien, Kurse in Pence (GBX) an der LSE ----------
  ['Unilever'                    , 'ULVR'  ,    4776, 'GBX',  21.65, 3.71, 'Konsum'      , 'Grossbritannien', 'quote/lon/ULVR'],
  ['BP'                          , 'BP1'   ,   514.5, 'GBX',  19.84, 4.65, 'Energie'     , 'Grossbritannien', 'quote/lon/BP'],
  ['GSK'                         , 'GSK'   ,  1853.5, 'GBX',  15.72, 3.81, 'Pharma'      , 'Grossbritannien', 'quote/lon/GSK'],
  ['Diageo'                      , 'DGE'   ,    1709, 'GBX',  28.98, 2.13, 'Nahrung'     , 'Grossbritannien', 'quote/lon/DGE'],
  ['Rio Tinto'                   , 'RIO'   ,    7674, 'GBX',  13.82, 3.85, 'Industrie'   , 'Grossbritannien', 'quote/lon/RIO'],
  ['Barclays'                    , 'BARC'  ,  496.65, 'GBX',  10.24, 1.73, 'Banken'      , 'Grossbritannien', 'quote/lon/BARC'],
  ['Lloyds Banking Group'        , 'LLOY'  ,  109.95, 'GBX',   13.7, 3.24, 'Banken'      , 'Grossbritannien', 'quote/lon/LLOY'],
  ['BAE Systems'                 , 'BA1'   ,    2044, 'GBX',  29.97, 1.68, 'Ruestung'    , 'Grossbritannien', 'quote/lon/BA'],
  ['Rolls-Royce'                 , 'RR'    ,  1530.2, 'GBX',  42.29, 0.79, 'Luftfahrt'   , 'Grossbritannien', 'quote/lon/RR'],

  // ---------- Schweiz, Kurse in Franken an der SIX ----------
  ['Nestle'                      , 'NESN'  ,   78.62, 'CHF',  27.15, 3.91, 'Nahrung'     , 'Schweiz'        , 'quote/swx/NESN'],
  ['Roche'                       , 'RO'    ,     366, 'CHF',  23.58, 2.85, 'Pharma'      , 'Schweiz'        , 'quote/swx/RO'],
  ['Zurich Insurance'            , 'ZURN'  ,   593.8, 'CHF',  14.82, 5.12, 'Versicherung', 'Schweiz'        , 'quote/swx/ZURN'],
  ['ABB'                         , 'ABBN'  ,    80.1, 'CHF',  36.07, 1.17, 'Industrie'   , 'Schweiz'        , 'quote/swx/ABBN'],
  ['UBS Group'                   , 'UBSG'  ,   44.53, 'CHF',  18.47, 2.05, 'Banken'      , 'Schweiz'        , 'quote/swx/UBSG'],
  ['Richemont'                   , 'CFR'   ,  194.55, 'CHF',  35.16, 1.76, 'Luxus'       , 'Schweiz'        , 'quote/swx/CFR'],
  ['Holcim'                      , 'HOLN'  ,   73.02, 'CHF', 103.39, 2.44, 'Bau'         , 'Schweiz'        , 'quote/swx/HOLN'],
  ['Sika'                        , 'SIKA'  ,     193, 'CHF',  29.56,    2, 'Chemie'      , 'Schweiz'        , 'quote/swx/SIKA'],
  ['Swiss Re'                    , 'SREN'  ,  141.15, 'CHF',  10.55, 4.57, 'Versicherung', 'Schweiz'        , 'quote/swx/SREN'],
  ['Lonza'                       , 'LONN'  ,   583.8, 'CHF',  38.03, 0.88, 'Pharma'      , 'Schweiz'        , 'quote/swx/LONN'],

  // ---------- Japan, Kurse in Yen an der Boerse Tokio ----------
  ['Toyota Motor'                , '7203'  ,    3116, 'JPY',   8.92, 3.31, 'Automobil'   , 'Japan'          , 'quote/tyo/7203'],
  ['Sony Group'                  , '6758'  ,    3928, 'JPY',  20.66, 0.89, 'Technologie' , 'Japan'          , 'quote/tyo/6758'],
  ['Nintendo'                    , '7974'  ,    8993, 'JPY',  21.95, 1.89, 'Medien'      , 'Japan'          , 'quote/tyo/7974'],
  ['Keyence'                     , '6861'  ,   82960, 'JPY',  40.88, 0.69, 'Industrie'   , 'Japan'          , 'quote/tyo/6861'],
  ['Tokyo Electron'              , '8035'  ,   56230, 'JPY',  41.52, 1.37, 'Halbleiter'  , 'Japan'          , 'quote/tyo/8035'],
  ['Advantest'                   , '6857'  ,   35270, 'JPY',  55.96, 0.17, 'Halbleiter'  , 'Japan'          , 'quote/tyo/6857'],
  ['SoftBank Group'              , '9984'  ,    5161, 'JPY',   6.05,  0.2, 'Technologie' , 'Japan'          , 'quote/tyo/9984'],
  ['Hitachi'                     , '6501'  ,    5550, 'JPY',  31.37, 1.07, 'Industrie'   , 'Japan'          , 'quote/tyo/6501'],
  ['Mitsubishi Corporation'      , '8058'  ,    4786, 'JPY',  19.81, 2.69, 'Handel'      , 'Japan'          , 'quote/tyo/8058'],
  ['Shin-Etsu Chemical'          , '4063'  ,    6001, 'JPY',  23.42, 1.88, 'Chemie'      , 'Japan'          , 'quote/tyo/4063'],
  ['Takeda Pharmaceutical'       , '4502'  ,    5800, 'JPY', null  , 3.54, 'Pharma'      , 'Japan'          , 'quote/tyo/4502'],
  ['Honda Motor'                 , '7267'  ,  1702.5, 'JPY', null  , 4.09, 'Automobil'   , 'Japan'          , 'quote/tyo/7267'],
  ['Sumitomo Mitsui Financial'   , '8316'  ,    6902, 'JPY',  20.94, 2.74, 'Banken'      , 'Japan'          , 'quote/tyo/8316'],
  ['Fast Retailing'              , '9983'  ,   71260, 'JPY',  42.11, 0.85, 'Handel'      , 'Japan'          , 'quote/tyo/9983'],
  ['Nippon Telegraph & Telephone', '9432'  ,   168.6, 'JPY',  13.13, 3.35, 'Telekom'     , 'Japan'          , 'quote/tyo/9432'],

  // ---------- Suedkorea, Kurse in Won an der KRX ----------
  ['Samsung Electronics'         , '005930',  257000, 'KRW',  11.46,  0.8, 'Technologie' , 'Suedkorea'      , 'quote/krx/005930'],
  ['Hyundai Motor'               , '005380',  399500, 'KRW',  12.82,  2.4, 'Automobil'   , 'Suedkorea'      , 'quote/krx/005380'],
  ['Kia'                         , '000270',  128000, 'KRW',   7.04, 4.96, 'Automobil'   , 'Suedkorea'      , 'quote/krx/000270'],
  ['NAVER'                       , '035420',  220500, 'KRW',  16.46, 1.21, 'Technologie' , 'Suedkorea'      , 'quote/krx/035420'],
  ['Samsung Biologics'           , '207940', 1486000, 'KRW',  37.54,    0, 'Pharma'      , 'Suedkorea'      , 'quote/krx/207940'],
  ['POSCO Holdings'              , '005490',  337500, 'KRW',  19.05, 2.37, 'Industrie'   , 'Suedkorea'      , 'quote/krx/005490'],
  ['LG Energy Solution'          , '373220',  370000, 'KRW', null  ,    0, 'Industrie'   , 'Suedkorea'      , 'quote/krx/373220'],

  // ---------- Hongkong, Kurse in Hongkong-Dollar ----------
  ['Tencent Holdings'            , '0700'  ,   455.2, 'HKD',  15.49, 1.16, 'Technologie' , 'Hongkong'       , 'quote/hkg/0700'],
  ['AIA Group'                   , '1299'  ,    75.5, 'HKD',   12.6, 2.57, 'Versicherung', 'Hongkong'       , 'quote/hkg/1299'],
  ['Hong Kong Exchanges'         , '0388'  ,     424, 'HKD',  27.13, 3.53, 'Finanzen'    , 'Hongkong'       , 'quote/hkg/0388'],

  // ---------- Kanada, Kurse in kanadischen Dollar an der TSX ----------
  ['Shopify'                     , 'SHOP'  ,  212.75, 'CAD', 100.54,    0, 'Technologie' , 'Kanada'         , 'quote/tsx/SHOP'],
  ['Toronto-Dominion Bank'       , 'TD'    ,  168.32, 'CAD',  17.77, 2.67, 'Banken'      , 'Kanada'         , 'quote/tsx/TD'],
  ['Bank of Nova Scotia'         , 'BNS'   ,  128.19, 'CAD',  16.83, 3.54, 'Banken'      , 'Kanada'         , 'quote/tsx/BNS'],
  ['Bank of Montreal'            , 'BMO'   ,  237.79, 'CAD',  19.45, 2.85, 'Banken'      , 'Kanada'         , 'quote/tsx/BMO'],
  ['Enbridge'                    , 'ENB'   ,   69.78, 'CAD',  26.75,  5.6, 'Energie'     , 'Kanada'         , 'quote/tsx/ENB'],
  ['Canadian Natural Resources'  , 'CNQ'   ,  68.105, 'CAD',  12.28, 3.61, 'Energie'     , 'Kanada'         , 'quote/tsx/CNQ'],
  ['Canadian National Railway'   , 'CNR'   , 174.385, 'CAD',  22.48, 2.09, 'Logistik'    , 'Kanada'         , 'quote/tsx/CNR'],
  ['Canadian Pacific Kansas City', 'CP'    ,  130.22, 'CAD',  30.27, 0.82, 'Logistik'    , 'Kanada'         , 'quote/tsx/CP'],
  ['BCE'                         , 'BCE'   ,   32.46, 'CAD',   4.83, 5.34, 'Telekom'     , 'Kanada'         , 'quote/tsx/BCE'],
  ['Brookfield Corporation'      , 'BN1'   ,   57.42, 'CAD',  75.24, 0.67, 'Finanzen'    , 'Kanada'         , 'quote/tsx/BN'],

  // ---------- USA ----------
  ['Boeing'                      , 'BA'    ,  208.85, 'USD',  78.27,    0, 'Luftfahrt'   , 'USA'            , 'stocks/ba'],
  ['Walt Disney'                 , 'DIS'   ,  107.69, 'USD',  22.08, 1.39, 'Medien'      , 'USA'            , 'stocks/dis'],
  ['Verizon Communications'      , 'VZ'    ,   49.99, 'USD',  12.88, 5.66, 'Telekom'     , 'USA'            , 'stocks/vz'],
  ['Lockheed Martin'             , 'LMT'   ,  563.24, 'USD',  20.85, 2.45, 'Ruestung'    , 'USA'            , 'stocks/lmt'],
  ['American Tower'              , 'AMT'   ,  175.85, 'USD',  23.96, 4.07, 'Immobilien'  , 'USA'            , 'stocks/amt'],
  ['Salesforce'                  , 'CRM'   ,   260.5, 'USD',  23.36, 0.68, 'Technologie' , 'USA'            , 'stocks/crm'],
  ['Adobe'                       , 'ADBE'  ,  292.14, 'USD',  16.54,    0, 'Technologie' , 'USA'            , 'stocks/adbe'],
  ['Qualcomm'                    , 'QCOM'  ,  163.01, 'USD',  19.17, 2.26, 'Halbleiter'  , 'USA'            , 'stocks/qcom'],
  ['IBM'                         , 'IBM'   ,  235.97, 'USD',  21.23, 2.86, 'Technologie' , 'USA'            , 'stocks/ibm'],
  ['Pfizer'                      , 'PFE'   ,   27.83, 'USD',  36.83, 6.18, 'Pharma'      , 'USA'            , 'stocks/pfe'],
  ['AbbVie'                      , 'ABBV'  ,   256.1, 'USD',  72.93,  2.7, 'Pharma'      , 'USA'            , 'stocks/abbv'],
  ['McDonald\'s'                 , 'MCD'   ,  263.53, 'USD',  21.12, 2.82, 'Nahrung'     , 'USA'            , 'stocks/mcd'],
  ['Nike'                        , 'NKE'   ,  39.245, 'USD',   18.3, 4.18, 'Konsum'      , 'USA'            , 'stocks/nke'],
  ['PepsiCo'                     , 'PEP'   ,   140.8, 'USD',  18.31, 4.21, 'Nahrung'     , 'USA'            , 'stocks/pep'],
  ['Coinbase'                    , 'COIN'  ,  176.32, 'USD', null  ,    0, 'Finanzen'    , 'USA'            , 'stocks/coin'],






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







  ['Vanguard S&P 500 ETF'                             , 'VOO' ,  707.13,  1040,   518, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/voo'],
  ['Invesco QQQ Trust'                                , 'QQQ' ,  716.38, 487.6,   105, 0.18, true, 'USA Technologie' , 'Aktien'  , 'etf/qqq'],
  ['Vanguard Total World Stock ETF'                   , 'VT'  , 160.995,  81.8, 10118, 0.06, true, 'Welt'            , 'Aktien'  , 'etf/vt'],
  ['Vanguard FTSE Developed Markets ETF'              , 'VEA' ,   73.03, 240.3,  3877, 0.03, true, 'Welt ohne USA'   , 'Aktien'  , 'etf/vea'],
  ['Vanguard FTSE Emerging Markets ETF'               , 'VWO' ,   60.71, 127.1,  5063, 0.06, true, 'Schwellenlaender', 'Aktien'  , 'etf/vwo'],
  ['iShares MSCI EAFE ETF'                            , 'EFA' ,  107.67,  80.3,   699, 0.32, true, 'Europa/Asien'    , 'Aktien'  , 'etf/efa'],
  ['iShares Russell 2000 ETF'                         , 'IWM' ,  296.11,  80.9,  1971, 0.19, true, 'USA klein'       , 'Aktien'  , 'etf/iwm'],
  ['iShares Core S&P Mid-Cap ETF'                     , 'IJH' ,   75.85,   125,   414, 0.05, true, 'USA mittel'      , 'Aktien'  , 'etf/ijh'],
  ['SPDR Dow Jones Industrial Average ETF'            , 'DIA' ,  534.77,  45.5,    31, 0.16, true, 'USA Standard'    , 'Aktien'  , 'etf/dia'],
  ['Invesco S&P 500 Equal Weight ETF'                 , 'RSP' ,  220.63, 100.5,   509,  0.2, true, 'USA breit'       , 'Aktien'  , 'etf/rsp'],
  ['Vanguard Growth ETF'                              , 'VUG' ,   88.62, 224.7,   151, 0.03, true, 'USA Wachstum'    , 'Aktien'  , 'etf/vug'],
  ['Vanguard Value ETF'                               , 'VTV' ,  225.04, 193.5,   326, 0.03, true, 'USA Substanz'    , 'Aktien'  , 'etf/vtv'],
  ['Schwab US Dividend Equity ETF'                    , 'SCHD',   34.84, 112.2,   103, 0.06, true, 'Dividenden'      , 'Aktien'  , 'etf/schd'],
  ['Vanguard High Dividend Yield ETF'                 , 'VYM' ,  163.96,  83.5,   618, 0.04, true, 'Dividenden'      , 'Aktien'  , 'etf/vym'],
  ['Technology Select Sector SPDR'                    , 'XLK' ,  186.13, 118.6,    76, 0.08, true, 'Technologie'     , 'Aktien'  , 'etf/xlk'],
  ['iShares Semiconductor ETF'                        , 'SOXX',  509.49,  41.5,    34, 0.33, true, 'Halbleiter'      , 'Aktien'  , 'etf/soxx'],
  ['Health Care Select Sector SPDR'                   , 'XLV' ,  170.95,  45.1,    63, 0.08, true, 'Gesundheit'      , 'Aktien'  , 'etf/xlv'],
  ['Financial Select Sector SPDR'                     , 'XLF' ,   58.07,  56.1,    80, 0.08, true, 'Finanzen'        , 'Aktien'  , 'etf/xlf'],
  ['Energy Select Sector SPDR'                        , 'XLE' ,    62.5,  40.1,    24, 0.08, true, 'Energie'         , 'Aktien'  , 'etf/xle'],
  ['Vanguard Real Estate ETF'                         , 'VNQ' ,   97.45,  39.4,   157, 0.13, true, 'Immobilien'      , 'Aktien'  , 'etf/vnq'],
  ['SPDR Gold Shares'                                 , 'GLD' ,  409.06, 155.5,     2,  0.4, true, 'Rohstoffe'       , 'Rohstoff', 'etf/gld'],
  ['iShares Core US Aggregate Bond ETF'               , 'AGG' ,  97.515, 138.9, 13386, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/agg'],
  ['iShares 20+ Year Treasury Bond ETF'               , 'TLT' ,   82.93,  47.5,    48, 0.15, true, 'Anleihen'        , 'Anleihen', 'etf/tlt'],
  ['Vanguard Interm.-Term Corp. Bond ETF'             , 'VCIT',   81.15,  70.4,  2268, 0.03, true, 'Anleihen'        , 'Anleihen', 'etf/vcit'],
  ['iShares Bitcoin Trust'                            , 'IBIT',   44.02,  60.7,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/ibit'],

  // ---------- Ausbau 2026-08-08 ----------
  ['SPDR S&P 500 ETF Trust'                           , 'SPY' ,  769.22, 807.5,   505, 0.09, true, 'USA breit'       , 'Aktien'  , 'etf/spy'],
  ['iShares Core S&P 500 ETF'                         , 'IVV' ,  772.95, 883.9,   508, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/ivv'],
  ['Vanguard Total Stock Market ETF'                  , 'VTI' ,  379.38, 688.8,  3498, 0.03, true, 'USA breit'       , 'Aktien'  , 'etf/vti'],
  ['iShares Core MSCI EAFE ETF'                       , 'IEFA',   100.4,   196,  2641, 0.07, true, 'Europa/Asien'    , 'Aktien'  , 'etf/iefa'],
  ['iShares Core MSCI Emerging Markets ETF'           , 'IEMG',   81.87, 160.6,  2896, 0.09, true, 'Schwellenlaender', 'Aktien'  , 'etf/iemg'],
  ['iShares MSCI Japan ETF'                           , 'EWJ' ,   95.73,  22.7,   174, 0.49, true, 'Japan'           , 'Aktien'  , 'etf/ewj'],
  ['iShares MSCI Eurozone ETF'                        , 'EZU' ,  70.885,    10,   226,  0.5, true, 'Eurozone'        , 'Aktien'  , 'etf/ezu'],
  ['iShares China Large-Cap ETF'                      , 'FXI' ,  35.425,   4.2,    59, 0.74, true, 'China'           , 'Aktien'  , 'etf/fxi'],
  ['iShares MSCI India ETF'                           , 'INDA',  49.515,   6.7,   173, 0.61, true, 'Indien'          , 'Aktien'  , 'etf/inda'],
  ['Industrial Select Sector SPDR'                    , 'XLI' ,  177.01,    33,    86, 0.08, true, 'Industrie'       , 'Aktien'  , 'etf/xli'],
  ['Consumer Discretionary Select Sector SPDR'        , 'XLY' ,  116.84,  23.1,    50, 0.08, true, 'Konsum'          , 'Aktien'  , 'etf/xly'],
  ['Consumer Staples Select Sector SPDR'              , 'XLP' ,   85.44,  14.8,    38, 0.08, true, 'Nahrung'         , 'Aktien'  , 'etf/xlp'],
  ['Utilities Select Sector SPDR'                     , 'XLU' ,   42.66,  22.3,    34, 0.08, true, 'Versorger'       , 'Aktien'  , 'etf/xlu'],
  ['Communication Services Select Sector SPDR'        , 'XLC' , 112.715,  22.5,    26, 0.08, true, 'Medien'          , 'Aktien'  , 'etf/xlc'],
  ['iShares Silver Trust'                             , 'SLV' ,   60.13,  33.5,     1,  0.5, true, 'Rohstoffe'       , 'Rohstoff', 'etf/slv'],
  ['Invesco DB Commodity Index Tracking Fund'         , 'DBC' ,   30.77,   1.9,    41, 0.84, true, 'Rohstoffe'       , 'Rohstoff', 'etf/dbc'],
  ['iShares iBoxx Investment Grade Corporate Bond ETF', 'LQD' , 106.375,  33.2,  3143, 0.14, true, 'Anleihen'        , 'Anleihen', 'etf/lqd'],
  ['iShares iBoxx High Yield Corporate Bond ETF'      , 'HYG' ,   79.71,  16.5,  1333, 0.49, true, 'Anleihen'        , 'Anleihen', 'etf/hyg'],
  ['iShares Ethereum Trust'                           , 'ETHA',    18.4,   8.1,     2, 0.25, true, 'Krypto'          , 'Krypto'  , 'etf/etha'],






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







  ['Bitcoin'     , 'BTC' ,    67151, 1348195827202,     20076428,     21000000,   107662, 'coingecko/bitcoin'],
  ['Ethereum'    , 'ETH' ,  2105.88,  254133135174,    120681206, null        ,  4229.76, 'coingecko/ethereum'],
  ['XRP'         , 'XRP' ,     1.19,   74940517672,  62744504852, 100000000000,     3.28, 'coingecko/ripple'],
  ['Solana'      , 'SOL' ,     89.8,   52464072077,    584162483, null        ,    285.6, 'coingecko/solana'],
  ['Dogecoin'    , 'DOGE', 0.073305,   11410957437, 155682446384, null        , 0.601466, 'coingecko/dogecoin'],
  ['Cardano'     , 'ADA' , 0.174695,    6551112223,  37498597081,  45000000000,     2.61, 'coingecko/cardano'],
  ['Chainlink'   , 'LINK',     9.86,    7373134621,    748099970,   1000000000,    43.32, 'coingecko/chainlink'],
  ['Litecoin'    , 'LTC' ,    42.22,    3274421176,     77545367,     84000000,   337.56, 'coingecko/litecoin'],
  ['Avalanche'   , 'AVAX',     6.28,    2711697592,    431771961,    720000000,   128.43, 'coingecko/avalanche-2'],
  ['Polkadot'    , 'DOT' , 0.731423,    1243737358,   1700150638,   2100000000,     47.6, 'coingecko/polkadot'],

  // ---------- Ausbau 2026-08-08 ----------
  ['BNB'         , 'BNB' ,    597.2,   79527152925,    133162586,    200000000,  1182.86, 'coingecko/binancecoin'],
  ['Tron'        , 'TRX' , 0.293319,   27841266022,  94923701758, null        , 0.410308, 'coingecko/tron'],
  ['Toncoin'     , 'TON' ,     1.18,    3258542275,   2766369829, null        ,      7.7, 'coingecko/the-open-network'],
  ['Aave'        , 'AAVE',   105.63,    1629413194,     15425051,     16000000,   541.28, 'coingecko/aave'],
  ['Stellar'     , 'XLM' ,  0.15384,    5332491117,  34663871478, null        , 0.729104, 'coingecko/stellar'],
  ['Bitcoin Cash', 'BCH' ,   213.03,    4278167539,     20081494,     21000000,  3187.12, 'coingecko/bitcoin-cash'],
  ['Monero'      , 'XMR' ,   404.35,    7602750196,     18797296, null        ,   685.48, 'coingecko/monero'],
  ['Uniswap'     , 'UNI' ,     3.81,    2371652498,    623212424,   1000000000,    37.37, 'coingecko/uniswap'],






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
