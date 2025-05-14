
import { db } from '../firebase/firebase-config.js';

// Função para carregar dados do jogo
export function carregarJogo(jogoId) {
  const jogoRef = db.collection("jogos").doc(jogoId);
  return jogoRef.get().then((doc) => {
    if (doc.exists) {
      return doc.data();
    } else {
      throw new Error("Jogo não encontrado");
    }
  });
}

// Exemplo de uso: carregarJogo('idDoJogo').then(jogo => console.log(jogo));
