// Inicialização Firebase compatível com v9.22.2 + compat
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

firebase.initializeApp(firebaseConfig);

// Use firebase.auth() diretamente (v9 compat usa o mesmo padrão do v8)
const db = firebase.firestore();
