import { auth } from '../firebase/firebase-config.js';

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  auth.signOut().then(() => {
    window.location.href = '../usuario/login.html';
  });
});