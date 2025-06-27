import { db } from '../../firebase/firebase-init.js';

// Utilidade para formatar data
function formatarData(dataFirestore) {
  if (!dataFirestore || !dataFirestore.toDate) return '-';
  const data = dataFirestore.toDate();
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  const hora = String(data.getHours()).padStart(2, '0');
  const minuto = String(data.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${ano}, ${hora}:${minuto}`;
}

// Extrai ID da URL
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get('id');

// Referência aos elementos do HTML
const tituloJogoEl = document.getElementById('tituloJogo');
const inicioEl = document.getElementById('inicio');
const entradaEl = document.getElementById('entrada');

// Função principal para buscar dados
async function carregarDadosJogo() {
  if (!jogoId) return;

  try {
    const jogoSnap = await db.collection('jogos').doc(jogoId).get();
    if (!jogoSnap.exists) return;

    const jogo = jogoSnap.data();

    const timeCasaSnap = await db.collection('times').doc(jogo.timeCasaId).get();
    const timeForaSnap = await db.collection('times').doc(jogo.timeForaId).get();

    const nomeTimeCasa = timeCasaSnap.exists ? timeCasaSnap.data().nome : 'Time A';
    const nomeTimeFora = timeForaSnap.exists ? timeForaSnap.data().nome : 'Time B';

    tituloJogoEl.innerHTML = `<i class="fas fa-calendar-alt"></i> ${nomeTimeCasa} vs ${nomeTimeFora}`;
    inicioEl.innerHTML = `<i class="fas fa-clock"></i> Início: ${formatarData(jogo.dataInicio)}`;
    entradaEl.innerHTML = `<i class="fas fa-ticket-alt"></i> Entrada: ${jogo.valorEntrada || 0} créditos`;

  } catch (e) {
    console.error('Erro ao carregar dados do jogo:', e);
  }
}

carregarDadosJogo();
