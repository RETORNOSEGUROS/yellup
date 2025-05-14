import { auth, db } from '../firebase/firebase-config.js';

export function verificarUsuario(callback) {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const snap = await db.collection('usuarios').doc(user.uid).get();
      if (snap.exists) {
        callback(user, snap.data());
      }
    } else {
      window.location.href = '../usuario/login.html';
    }
  });
}