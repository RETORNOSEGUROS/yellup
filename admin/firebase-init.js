// firebase-init.js (usando compat SDK)
const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.firebasestorage.app",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8",
  measurementId: "G-SYZ16X31KQ"
};

// Inicializa o Firebase com compat (para Firestore 9 compatível)
firebase.initializeApp(firebaseConfig);
