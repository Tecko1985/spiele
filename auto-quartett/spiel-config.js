/* Was dieses Spiel von den beiden anderen Quartetts unterscheidet — die
   gesamte Oberfläche liegt gemeinsam in ../quartett/. Wer hier etwas ändert,
   ändert nur dieses eine Spiel.
   Das Kartendeck steht in mock-data.js, der Firebase-Namensraum in
   game-service.js. */
const SPIEL_CONFIG = {
  /* Welche Motivfamilie eine Karte OHNE Foto bekommt. Die Angabe steht hier
     und nicht in motive.js, weil sie am SPIEL haengt, nicht an der Rolle: die
     Rolle einer Vereinskarte ist ihre Liga, und davon gibt es rund 95 in immer
     neuen Schreibweisen -- eine Wortliste dafuer veraltet lautlos, sobald ein
     Deck eine Liga ergaenzt. Fehlt der Wert (Altbestand), raet motive.js
     anhand der Rolle weiter. */
  motivFamilie: "auto",
  zeichen: "🚗",
  titel: "Auto-Quartett",
  untertitel: "Das klassische Auto-Quartett – digital, ideal für unterwegs (z. B. auf der Busfahrt zum Auswärtsspiel).",
  infoText: "Digitales Kartenspiel nach dem Quartett-Prinzip mit Automodellen. Ein Gerät eröffnet den Raum, alle anderen treten mit dem Raumcode bei — nichts zu installieren."
};
