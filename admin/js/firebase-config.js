// Configuração Firebase compatível (modo compatível)

const firebaseConfig = {
  apiKey: "AIzaSyD7Qo8A62FC1dMH6ugfChfVTxpFET2nD7k",
  authDomain: "painel-retorno.firebaseapp.com",
  projectId: "painel-retorno",
  storageBucket: "painel-retorno.appspot.com",
  messagingSenderId: "568615665836",
  appId: "1:568615665836:web:cf4b053cf7911dbe122661"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
