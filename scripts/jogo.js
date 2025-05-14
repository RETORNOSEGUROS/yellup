import { db, auth } from '../firebase/firebase-config.js';

export async function registrarTorcida(jogoId, timeEscolhido) {
  const user = auth.currentUser;
  if (!user) return;

  await db.collection('torcidas').add({
    uid: user.uid,
    jogoId,
    timeEscolhido,
    timestamp: new Date()
  });
}

export async function carregarJogoAtual() {
  const snap = await db.collection('jogos').where('status', '==', 'em andamento').limit(1).get();
  if (!snap.empty) {
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}