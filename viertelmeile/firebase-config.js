// Werte aus der Firebase-Konsole: Projekteinstellungen -> "Meine Apps" -> Web-App -> SDK-Konfiguration.
// Diese Werte sind NICHT geheim (der Schutz kommt über die Datenbank-Regeln, nicht über diesen Schlüssel).
//
// Gleiches Firebase-Projekt "spiele-sc1911" wie die anderen Spiele in diesem Hub,
// getrennt per Namensraum-Präfix "viertelmeile/" (siehe game-service.js).
const firebaseConfig = {
  apiKey: "AIzaSyBYY_KpRfAaLs6kxUhh17xEfkPGpNp0-4A",
  authDomain: "spiele-sc1911.firebaseapp.com",
  databaseURL: "https://spiele-sc1911-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "spiele-sc1911",
  storageBucket: "spiele-sc1911.firebasestorage.app",
  messagingSenderId: "153296982021",
  appId: "1:153296982021:web:010ddf8633f834d65d0c6c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
