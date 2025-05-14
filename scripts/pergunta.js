import { db } from '../firebase/firebase-config.js';

export async function cadastrarPergunta(pergunta, opcoes, resposta, timeId) {
  await db.collection('perguntas').add({
    pergunta,
    opcoes,
    resposta,
    timeId,
    criadaEm: new Date()
  });
}

export async function listarPerguntas() {
  const snap = await db.collection('perguntas').get();
  const lista = [];
  snap.forEach(doc => {
    lista.push({ id: doc.id, ...doc.data() });
  });
  return lista;
}