
import { auth, db } from '../firebase/firebase-config.js';

// Exemplo: verificar se usuário logado é admin
export function verificarAdmin(callback) {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const docRef = db.collection('usuarios').doc(user.uid);
      const docSnap = await docRef.get();
      if (docSnap.exists && docSnap.data().admin === true) {
        callback(true);
      } else {
        alert('Acesso negado.');
        window.location.href = '../usuario/login.html';
      }
    } else {
      window.location.href = '../usuario/login.html';
    }
  });
}
