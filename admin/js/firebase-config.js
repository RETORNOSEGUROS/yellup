const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_DOMINIO",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

// Inicialização
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
