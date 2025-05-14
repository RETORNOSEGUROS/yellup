
import { db } from '../firebase/firebase-config.js';

export async function carregarRanking(limite = 10) {
  const rankingRef = db.collection('usuarios').orderBy('pontos', 'desc').limit(limite);
  const snapshot = await rankingRef.get();

  const ranking = [];
  snapshot.forEach((doc) => {
    ranking.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return ranking;
}
