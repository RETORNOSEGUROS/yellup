const firebaseConfig = {
  apiKey: "AIzaSyD7Qo8A62FC1dMH6ugfChfVTxpFET2nD7k",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "568615665836",
  appId: "1:568615665836:web:cf4b053cf7911dbe122661"
};

// Inicializa o Firebase no modo compatível
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
