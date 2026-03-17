const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp();
const db = admin.firestore();

// =====================================================
// 📋 HELPER: LOG DE ATIVIDADE (EXTRATO UNIFICADO)
// Registra toda movimentação de créditos do usuário
// =====================================================
async function logAtividade(userId, tipo, valor, saldoAnterior, descricao, metadata = {}) {
  try {
    await db.collection('logs_atividade').add({
      userId,
      tipo,
      valor,
      saldoAnterior: saldoAnterior ?? null,
      saldoPosterior: saldoAnterior != null ? saldoAnterior + valor : null,
      descricao,
      metadata,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('⚠️ Erro ao gravar log:', e.message);
    // Não lança erro - log não pode impedir a operação principal
  }
}

// Helper para log em batch (quando precisa logar vários de uma vez)
function logAtividadeBatch(batch, userId, tipo, valor, saldoAnterior, descricao, metadata = {}) {
  const logRef = db.collection('logs_atividade').doc();
  batch.set(logRef, {
    userId,
    tipo,
    valor,
    saldoAnterior: saldoAnterior ?? null,
    saldoPosterior: saldoAnterior != null ? saldoAnterior + valor : null,
    descricao,
    metadata,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 🔄 REESTRUTURAÇÃO YELLUP v2 — HELPERS DE FUNDAÇÃO
// Fase 0: Estrutura de Passes, Limites e Rating
// =====================================================

// Configuração central — valores ajustáveis sem deploy
const CONFIG_PASSES = {
  semanal: { preco: 9.90, duracaoDias: 7, nome: 'Passe Semanal' },
  mensal: { preco: 19.90, duracaoDias: 30, nome: 'Passe Mensal' },
  anual: { preco: 199.90, duracaoDias: 365, nome: 'Passe Anual' }
};

const CONFIG_LIMITES = {
  free: { partidasPorDia: 2, pvpPorDia: 1, timerPerguntaSeg: 300, bauCreditos: 5, missoes: 3 },
  semanal: { partidasPorDia: 999, pvpPorDia: 999, timerPerguntaSeg: 180, bauCreditos: 10, missoes: 5 },
  mensal: { partidasPorDia: 999, pvpPorDia: 999, timerPerguntaSeg: 180, bauCreditos: 15, missoes: 7 },
  anual: { partidasPorDia: 999, pvpPorDia: 999, timerPerguntaSeg: 180, bauCreditos: 15, missoes: 7 }
};

const CONFIG_QUIZ = {
  perguntasIniciais: 5,       // 5 perguntas grátis ao entrar
  perguntasPorCiclo: 2,       // +2 a cada ciclo
  cooldownFree: 300,           // 5 minutos (seg) para free
  cooldownPasse: 180,          // 3 minutos (seg) para quem tem passe
  creditosPorSkip: 1,          // 1 crédito para adiantar
  perguntasPorSkip: 2          // ganha 2 perguntas por skip
};

const CONFIG_PVP = {
  taxaEntrada: 2,            // FIXO: 2 créditos por pessoa (queimados)
  premioMultiplicador: 4     // Embates: 4 créditos por participante
  // NOTA: Pênaltis usam CONFIG_PENALTI (premioSistema: 4)
};

const CONFIG_PARTIDA = {
  // Premiação fixa por faixa de jogadores
  faixas: [
    {
      // Até 9 jogadores: só top 3
      minJogadores: 0, maxJogadores: 9,
      premios: { top5: [10, 7, 5], faixas: [] }
    },
    {
      // 10-100 jogadores: top 50
      minJogadores: 10, maxJogadores: 100,
      premios: {
        top5: [18, 16, 14, 12, 10],
        faixas: [
          { de: 6, ate: 15, valor: 9 },
          { de: 16, ate: 25, valor: 7 },
          { de: 26, ate: 35, valor: 5 },
          { de: 36, ate: 45, valor: 4 },
          { de: 46, ate: 50, valor: 3 }
        ]
      }
    },
    {
      // 101-500 jogadores: top 50
      minJogadores: 101, maxJogadores: 500,
      premios: {
        top5: [30, 25, 22, 20, 18],
        faixas: [
          { de: 6, ate: 15, valor: 16 },
          { de: 16, ate: 25, valor: 14 },
          { de: 26, ate: 35, valor: 12 },
          { de: 36, ate: 45, valor: 10 },
          { de: 46, ate: 50, valor: 5 }
        ]
      }
    },
    {
      // 501+ jogadores: top 50
      minJogadores: 501, maxJogadores: Infinity,
      premios: {
        top5: [50, 45, 40, 35, 30],
        faixas: [
          { de: 6, ate: 15, valor: 25 },
          { de: 16, ate: 25, valor: 20 },
          { de: 26, ate: 35, valor: 18 },
          { de: 36, ate: 45, valor: 15 },
          { de: 46, ate: 50, valor: 10 }
        ]
      }
    }
  ],
  maxPremiados: 50,
  // Anti-bot
  tempoMinimoResposta: 1
};

const CONFIG_TORNEIO = {
  premioBase: 200,
  premioPorInscrito: 10,
  premioMax: 1000,
  distribuicao: { primeiro: 50, segundo: 30, terceiro: 20 }
};

const CONFIG_MISSAO = {
  multiplicador: { free: 1, semanal: 1.5, mensal: 2, anual: 2 }
};

const CONFIG_ESCALACAO = {
  tamanhoEscalacao: 11,
  creditosPorJogoEscalacao: 15,
  creditosTecnico: 25,
  creditosBancoReservas: 5
};

const CONFIG_RATING = {
  pesos: { quiz: 0.25, pvp: 0.20, torneios: 0.15, comunidade: 0.15, escalacao: 0.15, consistencia: 0.10 },
  decayDiario: 0.995,
  ratingMinimo: 50,
  suavizacao: { novo: 0.3, anterior: 0.7 },
  softReset: { fator: 0.6, base: 100 }
};

/**
 * HELPER: Verificar se o caller é admin
 * Admin = email admin@yellup.com (não tem documento na collection usuarios)
 * Usa o token de auth do Firebase, não precisa de Firestore
 */
function isAdminEmail(context) {
  return context.auth && context.auth.token && context.auth.token.email === 'admin@yellup.com';
}

// Campos padrão para novos usuários (inicialização)
const CAMPOS_PADRAO_USUARIO = {
  passe: {
    tipo: 'free',           // 'free', 'semanal', 'mensal', 'anual'
    ativo: false,
    dataInicio: null,
    dataExpiracao: null,
    historicoCompras: []
  },
  limitesDiarios: {
    partidasHoje: 0,
    pvpHoje: 0,
    bauColetadoHoje: false,
    ultimoReset: null
  },
  rating: 0,
  ratingFaixa: 'Reserva',
  ratingVariacao: 0,
  ratingComponents: {
    quiz: 0, pvp: 0, torneios: 0,
    comunidade: 0, escalacao: 0, consistencia: 0
  },
  ratingHistory: [],
  stats: {
    diasAtivos: 0,
    streakLogin: 0,
    ultimoLogin: null,
    totalPerguntas: 0,
    totalAcertos: 0,
    totalPvpJogados: 0,
    totalPvpVitorias: 0,
    totalTorneios: 0,
    totalMsgChat: 0,
    rivaisUnicos: []
  }
};

/**
 * HELPER: Verificar se usuário tem Passe ativo
 * Retorna { temPasse, tipo, expirado, config }
 */
async function verificarPasse(uid) {
  const userDoc = await db.collection('usuarios').doc(uid).get();
  if (!userDoc.exists) return { temPasse: false, tipo: 'free', expirado: false, config: CONFIG_LIMITES.free };

  const userData = userDoc.data();
  const passe = userData.passe || { tipo: 'free', ativo: false };

  // Free = sem passe
  if (!passe.ativo || passe.tipo === 'free') {
    return { temPasse: false, tipo: 'free', expirado: false, config: CONFIG_LIMITES.free };
  }

  // Verificar expiração
  const agora = new Date();
  const expiracao = passe.dataExpiracao?.toDate?.() || new Date(passe.dataExpiracao || 0);

  if (agora > expiracao) {
    // Passe expirou — desativar automaticamente
    await db.collection('usuarios').doc(uid).update({
      'passe.ativo': false,
      'passe.tipo': 'free'
    });
    return { temPasse: false, tipo: 'free', expirado: true, config: CONFIG_LIMITES.free };
  }

  const config = CONFIG_LIMITES[passe.tipo] || CONFIG_LIMITES.free;
  return { temPasse: true, tipo: passe.tipo, expirado: false, config };
}

/**
 * HELPER: Verificar e controlar limite diário
 * tipo: 'partida' ou 'pvp'
 * Retorna { permitido, restante, limite, tipoPasse }
 */
async function verificarLimiteDiario(uid, tipo) {
  const userDoc = await db.collection('usuarios').doc(uid).get();
  if (!userDoc.exists) return { permitido: false, restante: 0, limite: 0, tipoPasse: 'free' };

  const userData = userDoc.data();
  const passe = userData.passe || { tipo: 'free', ativo: false };
  const limites = userData.limitesDiarios || { partidasHoje: 0, pvpHoje: 0 };

  // Verificar se precisa resetar (novo dia)
  const agora = new Date();
  const ultimoReset = limites.ultimoReset?.toDate?.() || new Date(0);
  const mesmoDia = agora.toDateString() === ultimoReset.toDateString();

  if (!mesmoDia) {
    // Novo dia — resetar contadores
    await db.collection('usuarios').doc(uid).update({
      'limitesDiarios.partidasHoje': 0,
      'limitesDiarios.pvpHoje': 0,
      'limitesDiarios.bauColetadoHoje': false,
      'limitesDiarios.ultimoReset': admin.firestore.FieldValue.serverTimestamp()
    });
    // Retornar com contadores zerados
    const tipoPasse = (passe.temPasse) ? passe.tipo : 'free';
    const config = CONFIG_LIMITES[tipoPasse] || CONFIG_LIMITES.free;
    const limite = tipo === 'partida' ? config.partidasPorDia : config.pvpPorDia;
    return { permitido: true, restante: limite, limite, tipoPasse };
  }

  // Mesmo dia — verificar contadores
  const tipoPasse = (passe.temPasse) ? passe.tipo : 'free';
  const config = CONFIG_LIMITES[tipoPasse] || CONFIG_LIMITES.free;

  const usado = tipo === 'partida' ? (limites.partidasHoje || 0) : (limites.pvpHoje || 0);
  const limite = tipo === 'partida' ? config.partidasPorDia : config.pvpPorDia;
  const restante = Math.max(0, limite - usado);

  return { permitido: restante > 0, restante, limite, tipoPasse };
}

/**
 * HELPER: Incrementar contador diário
 * tipo: 'partida' ou 'pvp'
 */
async function incrementarLimiteDiario(uid, tipo) {
  const campo = tipo === 'partida' ? 'limitesDiarios.partidasHoje' : 'limitesDiarios.pvpHoje';
  await db.collection('usuarios').doc(uid).update({
    [campo]: admin.firestore.FieldValue.increment(1)
  });
}

/**
 * HELPER: Atualizar stats do usuário (para cálculo de rating)
 */
function atualizarStatsEmBatch(batch, uid, campo, valor = 1) {
  batch.update(db.collection('usuarios').doc(uid), {
    [`stats.${campo}`]: admin.firestore.FieldValue.increment(valor)
  });
}

/**
 * HELPER: Determinar faixa do rating
 */
function getFaixaRating(rating) {
  if (rating >= 850) return { nome: 'Imortal', emoji: '🏆' };
  if (rating >= 650) return { nome: 'Lenda', emoji: '🔴' };
  if (rating >= 450) return { nome: 'Fenômeno', emoji: '🟠' };
  if (rating >= 250) return { nome: 'Craque', emoji: '🟡' };
  if (rating >= 100) return { nome: 'Titular', emoji: '🟢' };
  return { nome: 'Reserva', emoji: '⚽' };
}


// =====================================================
// 🎫 FASE 1: SISTEMA DE PASSES
// =====================================================

/**
 * ATIVAR PASSE — Chamada após confirmação de pagamento MP
 * ✅ SEGURANÇA: Verifica se pagamento existe e está aprovado em pagamentos_mp
 * Recebe: { paymentId, tipoPasse: 'semanal'|'mensal'|'anual' }
 */
exports.ativarPasse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { paymentId, tipoPasse } = data;

  if (!paymentId || !tipoPasse || !['semanal', 'mensal', 'anual'].includes(tipoPasse)) {
    throw new functions.https.HttpsError('invalid-argument', 'paymentId e tipoPasse (semanal/mensal/anual) obrigatórios');
  }

  try {
    // ✅ SEGURANÇA: Verificar se este pagamento foi realmente aprovado pelo webhook
    const pagMpDoc = await db.collection('pagamentos_mp').doc(String(paymentId)).get();
    if (!pagMpDoc.exists) {
      console.error(`🚫 Tentativa de ativar passe com paymentId inexistente: ${paymentId} por ${uid}`);
      throw new functions.https.HttpsError('failed-precondition', 
        'Pagamento não encontrado. Aguarde a confirmação do Mercado Pago.');
    }
    const pagMpData = pagMpDoc.data();
    if (pagMpData.status !== 'aprovado' && pagMpData.status !== 'approved') {
      console.error(`🚫 Passe: pagamento ${paymentId} status=${pagMpData.status}, uid=${uid}`);
      throw new functions.https.HttpsError('failed-precondition', 
        'Pagamento ainda não foi aprovado.');
    }
    // Verificar que o pagamento pertence a este usuário
    if (pagMpData.usuarioId && pagMpData.usuarioId !== uid) {
      console.error(`🚫 Passe: pagamento ${paymentId} pertence a ${pagMpData.usuarioId}, chamado por ${uid}`);
      throw new functions.https.HttpsError('permission-denied', 'Pagamento não pertence a este usuário');
    }

    // Verificar duplicidade em pagamentos_passe
    const pagDoc = await db.collection('pagamentos_passe').doc(String(paymentId)).get();
    if (pagDoc.exists) {
      console.log('⚠️ Passe já ativado para este pagamento:', paymentId);
      return { success: true, jaProcessado: true };
    }

    const configPasse = CONFIG_PASSES[tipoPasse];
    const agora = new Date();
    const expiracao = new Date(agora);
    expiracao.setDate(expiracao.getDate() + configPasse.duracaoDias);

    // Ler dados atuais
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.data() || {};
    const passeAtual = userData.passe || {};

    // Se já tem passe ativo, estender a data de expiração
    let dataInicioFinal = agora;
    let dataExpiracaoFinal = expiracao;

    if (passeAtual.ativo && passeAtual.dataExpiracao) {
      const expiracaoAtual = passeAtual.dataExpiracao.toDate?.() || new Date(passeAtual.dataExpiracao);
      if (expiracaoAtual > agora) {
        // Estender a partir da expiração atual
        dataExpiracaoFinal = new Date(expiracaoAtual);
        dataExpiracaoFinal.setDate(dataExpiracaoFinal.getDate() + configPasse.duracaoDias);
      }
    }

    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    // Ativar passe
    batch.update(userRef, {
      'passe.tipo': tipoPasse,
      'passe.ativo': true,
      'passe.dataInicio': admin.firestore.Timestamp.fromDate(dataInicioFinal),
      'passe.dataExpiracao': admin.firestore.Timestamp.fromDate(dataExpiracaoFinal),
      'passe.historicoCompras': admin.firestore.FieldValue.arrayUnion({
        tipo: tipoPasse,
        paymentId: String(paymentId),
        data: admin.firestore.Timestamp.fromDate(agora),
        valor: configPasse.preco
      })
    });

    // Registrar pagamento (anti-duplicidade)
    const pagRef = db.collection('pagamentos_passe').doc(String(paymentId));
    batch.set(pagRef, {
      usuarioId: uid,
      tipoPasse,
      valor: configPasse.preco,
      dataAtivacao: admin.firestore.Timestamp.fromDate(agora),
      dataExpiracao: admin.firestore.Timestamp.fromDate(dataExpiracaoFinal),
      status: 'ativo',
      processadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log
    logAtividadeBatch(batch, uid, 'compra_passe', 0, null,
      `Passe ${configPasse.nome} ativado até ${dataExpiracaoFinal.toLocaleDateString('pt-BR')}`,
      { paymentId: String(paymentId), tipoPasse, valor: configPasse.preco });

    await batch.commit();

    // Notificação
    await criarNotificacaoHelper(uid, 'passe',
      `🎫 ${configPasse.nome} Ativado!`,
      `Seu ${configPasse.nome} está ativo até ${dataExpiracaoFinal.toLocaleDateString('pt-BR')}. Aproveite partidas ilimitadas!`
    );

    console.log(`✅ Passe ${tipoPasse} ativado: ${uid} até ${dataExpiracaoFinal.toISOString()}`);

    return {
      success: true,
      passe: {
        tipo: tipoPasse,
        nome: configPasse.nome,
        ativo: true,
        dataExpiracao: dataExpiracaoFinal.toISOString()
      }
    };

  } catch (error) {
    console.error('❌ Erro ao ativar passe:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao ativar passe');
  }
});

/**
 * VERIFICAR STATUS DO PASSE — Chamada pelo client ao abrir o app
 * Retorna status completo + limites do dia
 */
exports.verificarStatusPasse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;

  try {
    const passe = await verificarPasse(uid);
    const limitePartida = await verificarLimiteDiario(uid, 'partida');
    const limitePvp = await verificarLimiteDiario(uid, 'pvp');

    return {
      success: true,
      passe: {
        temPasse: passe.temPasse,
        tipo: passe.tipo,
        expirado: passe.expirado
      },
      limites: {
        partidas: { restante: limitePartida.restante, limite: limitePartida.limite },
        pvp: { restante: limitePvp.restante, limite: limitePvp.limite },
        timerPergunta: passe.config.timerPerguntaSeg,
        bauCreditos: passe.config.bauCreditos,
        missoes: passe.config.missoes
      }
    };

  } catch (error) {
    console.error('❌ Erro verificarStatusPasse:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao verificar passe');
  }
});


// =====================================================
// ⏰ CRON: RESET LIMITES DIÁRIOS (00:05 BRT)
// Reseta contadores de todos os usuários ativos
// =====================================================
exports.resetLimitesDiarios = functions.pubsub
  .schedule('5 0 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      // Buscar usuários que jogaram nas últimas 48h (otimização)
      const doisDiasAtras = new Date();
      doisDiasAtras.setDate(doisDiasAtras.getDate() - 2);

      const snap = await db.collection('usuarios')
        .where('limitesDiarios.ultimoReset', '>', admin.firestore.Timestamp.fromDate(doisDiasAtras))
        .get();

      if (snap.empty) {
        console.log('⏰ Nenhum usuário ativo para resetar');
        return null;
      }

      // Batch updates (máx 500 por batch)
      let batch = db.batch();
      let count = 0;

      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          'limitesDiarios.partidasHoje': 0,
          'limitesDiarios.pvpHoje': 0,
          'limitesDiarios.bauColetadoHoje': false,
          'limitesDiarios.ultimoReset': admin.firestore.FieldValue.serverTimestamp()
        });
        count++;

        if (count % 500 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }

      if (count % 500 !== 0) {
        await batch.commit();
      }

      console.log(`⏰ Limites diários resetados para ${count} usuários`);
      return null;

    } catch (error) {
      console.error('❌ Erro resetLimitesDiarios:', error);
      return null;
    }
  });


// =====================================================
// ⏰ CRON: VERIFICAR PASSES EXPIRADOS (01:00 BRT)
// Desativa passes que venceram
// =====================================================
exports.verificarPassesExpirados = functions.pubsub
  .schedule('0 1 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const agora = admin.firestore.Timestamp.now();

      const snap = await db.collection('usuarios')
        .where('passe.ativo', '==', true)
        .where('passe.dataExpiracao', '<', agora)
        .get();

      if (snap.empty) {
        console.log('🎫 Nenhum passe expirado');
        return null;
      }

      let batch = db.batch();
      let count = 0;

      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          'passe.ativo': false,
          'passe.tipo': 'free'
        });
        count++;

        if (count % 500 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }

      if (count % 500 !== 0) {
        await batch.commit();
      }

      // Notificar usuários
      for (const doc of snap.docs) {
        try {
          await criarNotificacaoHelper(doc.id, 'passe',
            '⏰ Passe Expirado',
            'Seu passe expirou. Renove para continuar com partidas ilimitadas!'
          );
        } catch (e) { /* não crítico */ }
      }

      console.log(`🎫 ${count} passes expirados desativados`);
      return null;

    } catch (error) {
      console.error('❌ Erro verificarPassesExpirados:', error);
      return null;
    }
  });


// =====================================================
// 🎁 COLETAR BAÚ DIÁRIO (v2 — com multiplicador de Passe)
// =====================================================
exports.coletarBauDiarioV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;

  try {
    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado');

    const userData = userDoc.data();
    const limites = userData.limitesDiarios || {};

    // Verificar se já coletou hoje
    const agora = new Date();
    const ultimoReset = limites.ultimoReset?.toDate?.() || new Date(0);
    const mesmoDia = agora.toDateString() === ultimoReset.toDateString();

    if (mesmoDia && limites.bauColetadoHoje) {
      throw new functions.https.HttpsError('already-exists', 'Baú já coletado hoje');
    }

    // Determinar quantidade baseado no passe
    const passe = await verificarPasse(uid);
    const creditosBau = passe.config.bauCreditos;
    const saldoAnterior = userData.creditos || 0;

    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    batch.update(userRef, {
      creditos: admin.firestore.FieldValue.increment(creditosBau),
      'limitesDiarios.bauColetadoHoje': true,
      'limitesDiarios.ultimoReset': admin.firestore.FieldValue.serverTimestamp()
    });

    logAtividadeBatch(batch, uid, 'bau_diario', creditosBau, saldoAnterior,
      `Baú diário: +${creditosBau} créditos (${passe.tipo})`,
      { tipoPasse: passe.tipo });

    await batch.commit();

    console.log(`🎁 Baú coletado: ${uid} +${creditosBau} cr (${passe.tipo})`);

    return {
      success: true,
      creditosRecebidos: creditosBau,
      saldoNovo: saldoAnterior + creditosBau,
      tipoPasse: passe.tipo
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro coletarBauDiarioV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao coletar baú');
  }
});


// =====================================================
// [DEPRECATED] FUNÇÃO: EXECUTAR COMPRA NA BOLSA
// ⚠️ Será removida na Fase 4 — manter para backward compatibility
// O SISTEMA faz a transferência, não o usuário
// =====================================================

exports.executarCompraBolsa = functions.https.onCall(async (data, context) => {
  // 1. Verificar se está logado
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const compradorId = context.auth.uid;
  const { ordemId, quantidade } = data;

  // 2. Validar dados
  if (!ordemId || !quantidade || quantidade <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos');
  }

  try {
    // 3. Buscar a ordem de venda
    const ordemDoc = await db.collection('bolsa_ordens').doc(ordemId).get();
    
    if (!ordemDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Ordem não encontrada');
    }
    
    const ordem = ordemDoc.data();
    
    // 4. Validações
    if (ordem.status !== 'ativa' && ordem.status !== 'parcial') {
      throw new functions.https.HttpsError('failed-precondition', 'Ordem não está disponível');
    }
    
    const vendedorId = ordem.userId;
    
    if (vendedorId === compradorId) {
      throw new functions.https.HttpsError('failed-precondition', 'Não pode comprar sua própria ordem');
    }
    
    const qtdDisponivel = ordem.quantidadeRestante || ordem.quantidade;
    
    if (quantidade > qtdDisponivel) {
      throw new functions.https.HttpsError('failed-precondition', `Só tem ${qtdDisponivel} disponível`);
    }
    
    // 5. Calcular valor
    const precoUnitario = ordem.precoUnitario;
    const valorTotal = quantidade * precoUnitario;
    
    // 6. Verificar créditos do comprador
    const compradorDoc = await db.collection('usuarios').doc(compradorId).get();
    const creditosComprador = compradorDoc.data()?.creditos || 0;
    
    if (creditosComprador < valorTotal) {
      throw new functions.https.HttpsError('resource-exhausted', 
        `Créditos insuficientes. Precisa: ${valorTotal}, Tem: ${creditosComprador}`);
    }
    
    // 7. Buscar cota do comprador (se já tem)
    const cotaCompradorQuery = await db.collection('bolsa_cotas')
      .where('userId', '==', compradorId)
      .where('timeId', '==', ordem.timeId)
      .limit(1)
      .get();
    
    // 8. Buscar cota do vendedor
    const cotaVendedorQuery = await db.collection('bolsa_cotas')
      .where('userId', '==', vendedorId)
      .where('timeId', '==', ordem.timeId)
      .limit(1)
      .get();
    
    // =====================================================
    // 9. EXECUTAR TUDO DE UMA VEZ (ATÔMICO)
    // =====================================================
    
    const batch = db.batch();
    
    // 9.1 DESCONTAR créditos do COMPRADOR
    batch.update(db.collection('usuarios').doc(compradorId), {
      creditos: admin.firestore.FieldValue.increment(-valorTotal)
    });
    
    // 9.2 CREDITAR o VENDEDOR
    batch.update(db.collection('usuarios').doc(vendedorId), {
      creditos: admin.firestore.FieldValue.increment(valorTotal)
    });
    
    // 9.3 Adicionar cotas ao COMPRADOR
    if (cotaCompradorQuery.empty) {
      // Criar nova cota
      const novaCotaRef = db.collection('bolsa_cotas').doc();
      batch.set(novaCotaRef, {
        userId: compradorId,
        usuarioNome: compradorDoc.data()?.usuarioUnico || compradorDoc.data()?.nome || 'Usuário',
        timeId: ordem.timeId,
        timeNome: ordem.timeNome || '',
        quantidade: quantidade,
        precoMedioAquisicao: precoUnitario,
        dataAquisicao: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Atualizar cota existente
      const cotaDoc = cotaCompradorQuery.docs[0];
      const cotaAtual = cotaDoc.data();
      const novaQtd = cotaAtual.quantidade + quantidade;
      const novoPrecoMedio = ((cotaAtual.quantidade * cotaAtual.precoMedioAquisicao) + valorTotal) / novaQtd;
      
      batch.update(cotaDoc.ref, {
        quantidade: novaQtd,
        precoMedioAquisicao: novoPrecoMedio
      });
    }
    
    // 9.4 Remover cotas do VENDEDOR
    if (!cotaVendedorQuery.empty) {
      const cotaVendedorDoc = cotaVendedorQuery.docs[0];
      const qtdVendedor = cotaVendedorDoc.data().quantidade;
      const novaQtdVendedor = qtdVendedor - quantidade;
      
      if (novaQtdVendedor <= 0) {
        batch.delete(cotaVendedorDoc.ref);
      } else {
        batch.update(cotaVendedorDoc.ref, {
          quantidade: novaQtdVendedor
        });
      }
    }
    
    // 9.5 Atualizar a ORDEM
    const novaQtdOrdem = qtdDisponivel - quantidade;
    const novoStatus = novaQtdOrdem <= 0 ? 'concluida' : 'parcial';
    
    batch.update(db.collection('bolsa_ordens').doc(ordemId), {
      quantidadeRestante: novaQtdOrdem,
      status: novoStatus,
      dataAtualizacao: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // 9.6 Registrar a TRANSAÇÃO
    const transacaoRef = db.collection('bolsa_transacoes').doc();
    batch.set(transacaoRef, {
      timeId: ordem.timeId,
      timeNome: ordem.timeNome || '',
      vendedorId: vendedorId,
      vendedorNome: ordem.usuarioNome || '',
      compradorId: compradorId,
      compradorNome: compradorDoc.data()?.usuarioUnico || compradorDoc.data()?.nome || '',
      quantidade: quantidade,
      precoUnitario: precoUnitario,
      valorTotal: valorTotal,
      dataTransacao: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // 10. EXECUTAR TUDO
    await batch.commit();
    
    // 📋 Log de atividade
    await logAtividade(compradorId, 'bolsa_compra', -valorTotal, creditosComprador,
      `Bolsa: comprou ${quantidade} cotas por ${valorTotal} cr`,
      { ordemId, quantidade, precoUnitario, vendedorId, timeId: ordem.timeId || '' });
    if (vendedorId !== compradorId) {
      const saldoVendedor = (await db.collection('usuarios').doc(vendedorId).get()).data()?.creditos || 0;
      await logAtividade(vendedorId, 'bolsa_venda', valorTotal, saldoVendedor - valorTotal,
        `Bolsa: vendeu ${quantidade} cotas por ${valorTotal} cr`,
        { ordemId, quantidade, precoUnitario, compradorId });
    }
    
    console.log(`✅ Compra executada: ${compradorId} comprou ${quantidade} cotas por ${valorTotal} cr`);
    
    return {
      success: true,
      quantidade: quantidade,
      valorTotal: valorTotal,
      mensagem: `Compra realizada! ${quantidade} cotas por ${valorTotal} créditos`
    };
    
  } catch (error) {
    console.error('❌ Erro na compra:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', 'Erro ao processar compra');
  }
});


// =====================================================
// ⚔️ EMBATES PVP - CLOUD FUNCTIONS
// =====================================================

// =====================================================
// 1. CRIAR EMBATE - Debita créditos do criador
// =====================================================
exports.criarEmbate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { embateId, aposta } = data;

  if (!embateId || !aposta || aposta <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos');
  }

  try {
    // Verificar se o embate existe e foi criado por este usuário
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    }

    const embate = embateDoc.data();
    if (embate.criadorId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Você não é o criador deste embate');
    }

    // Verificar se já foi debitado (evitar duplo débito)
    const transacaoExistente = await db.collection('transacoes')
      .where('usuarioId', '==', userId)
      .where('embateId', '==', embateId)
      .where('tipo', '==', 'debito')
      .limit(1)
      .get();

    if (!transacaoExistente.empty) {
      return { success: true, mensagem: 'Créditos já debitados' };
    }

    // Verificar créditos
    const userDoc = await db.collection('usuarios').doc(userId).get();
    const creditos = userDoc.data()?.creditos || 0;

    if (creditos < aposta) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Créditos insuficientes. Precisa: ${aposta}, Tem: ${creditos}`);
    }

    // Debitar créditos e registrar transação
    const batch = db.batch();

    batch.update(db.collection('usuarios').doc(userId), {
      creditos: admin.firestore.FieldValue.increment(-aposta)
    });

    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: userId,
      tipo: 'debito',
      valor: aposta,
      descricao: `Aposta no embate ${embate.codigo || embateId}`,
      embateId: embateId,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    await logAtividade(userId, 'debito_pvp', -aposta, creditos,
      `PvP: entrada no embate ${embate.codigo || embateId}`,
      { embateId, aposta });

    console.log(`✅ Embate criado: ${userId} debitou ${aposta} cr no embate ${embateId}`);

    return { success: true, mensagem: `Créditos debitados: ${aposta}` };

  } catch (error) {
    console.error('❌ Erro ao criar embate:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao processar criação do embate');
  }
});


// =====================================================
// 2. ACEITAR EMBATE - Debita créditos do participante
// =====================================================
exports.aceitarEmbate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { embateId } = data;

  if (!embateId) {
    throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');
  }

  try {
    // Buscar embate
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    }

    const embate = embateDoc.data();

    // Validações
    if (embate.status !== 'aguardando') {
      throw new functions.https.HttpsError('failed-precondition', 'Embate não está aguardando participantes');
    }

    if ((embate.participantes || []).includes(userId)) {
      throw new functions.https.HttpsError('already-exists', 'Você já está neste embate');
    }

    const aposta = embate.aposta;

    // Verificar créditos
    const userDoc = await db.collection('usuarios').doc(userId).get();
    const creditos = userDoc.data()?.creditos || 0;

    if (creditos < aposta) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Créditos insuficientes. Precisa: ${aposta}, Tem: ${creditos}`);
    }

    // Verificar se já foi debitado
    const transacaoExistente = await db.collection('transacoes')
      .where('usuarioId', '==', userId)
      .where('embateId', '==', embateId)
      .where('tipo', '==', 'debito')
      .limit(1)
      .get();

    if (!transacaoExistente.empty) {
      return { success: true, mensagem: 'Créditos já debitados' };
    }

    // Executar: debitar créditos + atualizar embate + registrar transação
    const batch = db.batch();

    // Debitar créditos
    batch.update(db.collection('usuarios').doc(userId), {
      creditos: admin.firestore.FieldValue.increment(-aposta)
    });

    // Atualizar embate
    batch.update(db.collection('embates').doc(embateId), {
      participantes: admin.firestore.FieldValue.arrayUnion(userId),
      totalParticipantes: admin.firestore.FieldValue.increment(1),
      prizePool: admin.firestore.FieldValue.increment(aposta)
    });

    // Registrar transação
    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: userId,
      tipo: 'debito',
      valor: aposta,
      descricao: `Aposta no embate ${embate.codigo || embateId}`,
      embateId: embateId,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    await logAtividade(userId, 'debito_pvp', -aposta, creditos,
      `PvP: entrada no embate ${embate.codigo || embateId}`,
      { embateId, aposta });

    console.log(`✅ Embate aceito: ${userId} entrou no embate ${embateId} (-${aposta} cr)`);

    return { success: true, mensagem: `Entrada confirmada! -${aposta} créditos` };

  } catch (error) {
    console.error('❌ Erro ao aceitar embate:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao aceitar embate');
  }
});


// =====================================================
// 3. FINALIZAR EMBATE - Distribui prêmios aos vencedores
// =====================================================
exports.finalizarEmbate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { embateId } = data;

  if (!embateId) {
    throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');
  }

  try {
    // Buscar embate
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    }

    const embate = embateDoc.data();

    // ✅ SEGURANÇA: Apenas participantes podem finalizar
    const isParticipante = (embate.participantes || []).includes(userId) || 
                           embate.criadorId === userId || 
                           embate.adversarioId === userId;
    if (!isParticipante) {
      throw new functions.https.HttpsError('permission-denied', 'Apenas participantes podem finalizar o embate');
    }

    // Verificar se o embate está em andamento
    if (embate.status !== 'em_andamento' && embate.status !== 'respondendo' && embate.status !== 'finalizando') {
      throw new functions.https.HttpsError('failed-precondition', 'Embate não pode ser finalizado neste status');
    }

    // Verificar se já foi finalizado (evitar dupla premiação)
    if (embate.resultado && embate.status === 'finalizado') {
      return { success: true, mensagem: 'Embate já foi finalizado', resultado: embate.resultado };
    }

    // Buscar participações para calcular ranking
    const participacoesSnap = await db.collection('embates').doc(embateId)
      .collection('participacoes').get();

    let ranking = [];
    participacoesSnap.forEach(doc => {
      ranking.push({ odId: doc.id, ...doc.data() });
    });

    // Ordenar por pontos (maior primeiro)
    ranking.sort((a, b) => (b.pontos || 0) - (a.pontos || 0));

    const premio = embate.prizePool || (embate.aposta * ranking.length);
    let resultado = {};

    const batch = db.batch();

    if (ranking.length > 0) {
      const maiorPontuacao = ranking[0].pontos || 0;
      const vencedores = ranking.filter(r => (r.pontos || 0) === maiorPontuacao);
      const perdedores = ranking.filter(r => (r.pontos || 0) < maiorPontuacao);
      const empate = vencedores.length > 1;

      resultado = {
        vencedorId: empate ? null : vencedores[0].odId,
        vencedorNome: empate ? null : (vencedores[0].odNome || ''),
        pontuacaoVencedor: maiorPontuacao,
        empate: empate,
        vencedoresEmpate: empate ? vencedores.map(v => v.odId) : null,
        ranking: ranking.map((r, i) => ({
          posicao: i + 1,
          odId: r.odId,
          odNome: r.odNome || '',
          pontos: r.pontos || 0,
          acertos: r.acertos || 0,
          erros: r.erros || 0
        }))
      };

      if (empate) {
        // Dividir prêmio entre empatados
        const premioPorJogador = Math.floor(premio / vencedores.length);

        for (const vencedor of vencedores) {
          // Creditar vencedor
          batch.update(db.collection('usuarios').doc(vencedor.odId), {
            creditos: admin.firestore.FieldValue.increment(premioPorJogador),
            'pvp.vitorias': admin.firestore.FieldValue.increment(1),
            'pvp.creditosGanhos': admin.firestore.FieldValue.increment(premioPorJogador),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
          });

          // Registrar transação
          const transRef = db.collection('transacoes').doc();
          batch.set(transRef, {
            usuarioId: vencedor.odId,
            tipo: 'credito',
            valor: premioPorJogador,
            descricao: `🏆 Empate no embate ${embate.codigo || embateId} (+${premioPorJogador} créditos)`,
            embateId: embateId,
            data: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        // Atualizar perdedores
        for (const perdedor of perdedores) {
          batch.update(db.collection('usuarios').doc(perdedor.odId), {
            'pvp.derrotas': admin.firestore.FieldValue.increment(1),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
          });
        }

      } else {
        // Vencedor único
        const vencedor = vencedores[0];

        batch.update(db.collection('usuarios').doc(vencedor.odId), {
          creditos: admin.firestore.FieldValue.increment(premio),
          'pvp.vitorias': admin.firestore.FieldValue.increment(1),
          'pvp.creditosGanhos': admin.firestore.FieldValue.increment(premio),
          'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
        });

        const transRef = db.collection('transacoes').doc();
        batch.set(transRef, {
          usuarioId: vencedor.odId,
          tipo: 'credito',
          valor: premio,
          descricao: `🏆 Vitória no embate ${embate.codigo || embateId} (+${premio} créditos)`,
          embateId: embateId,
          data: admin.firestore.FieldValue.serverTimestamp()
        });

        // Atualizar perdedores
        for (const perdedor of ranking.slice(1)) {
          batch.update(db.collection('usuarios').doc(perdedor.odId), {
            'pvp.derrotas': admin.firestore.FieldValue.increment(1),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
          });
        }
      }
    }

    // Finalizar embate
    batch.update(db.collection('embates').doc(embateId), {
      status: 'finalizado',
      resultado: resultado,
      dataFinalizacao: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log vencedores
    try {
      if (resultado.empate && resultado.vencedoresEmpate) {
        const premioPorJogador = Math.floor(premio / resultado.vencedoresEmpate.length);
        for (const odId of resultado.vencedoresEmpate) {
          await logAtividade(odId, 'premio_pvp', premioPorJogador, null,
            `PvP: empate no embate ${embate.codigo || embateId}`,
            { embateId, premio: premioPorJogador });
        }
      } else if (resultado.vencedorId) {
        await logAtividade(resultado.vencedorId, 'premio_pvp', premio, null,
          `PvP: vitória no embate ${embate.codigo || embateId}`,
          { embateId, premio });
      }
    } catch(logErr) { console.error('⚠️ Log embate:', logErr.message); }

    console.log(`✅ Embate ${embateId} finalizado. Prêmio: ${premio} cr`);

    return { success: true, resultado: resultado, premio: premio };

  } catch (error) {
    console.error('❌ Erro ao finalizar embate:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao finalizar embate');
  }
});


// =====================================================
// 4. CANCELAR EMBATE - Devolve créditos a todos
// =====================================================
exports.cancelarEmbate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { embateId } = data;

  if (!embateId) {
    throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');
  }

  try {
    // Buscar embate
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    }

    const embate = embateDoc.data();

    // Verificar se o usuário é o criador
    if (embate.criadorId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Apenas o criador pode cancelar');
    }

    // Verificar se pode cancelar
    if (embate.status === 'finalizado' || embate.status === 'cancelado') {
      throw new functions.https.HttpsError('failed-precondition', 'Embate já está finalizado ou cancelado');
    }

    // Compatível com v1 (aposta) e v2 (taxaEntrada fixa)
    const reembolso = embate.taxaEntrada || embate.aposta || CONFIG_PVP.taxaEntrada;
    const participantes = embate.participantes || [];

    const batch = db.batch();

    // Devolver créditos a todos os participantes
    for (const odId of participantes) {
      batch.update(db.collection('usuarios').doc(odId), {
        creditos: admin.firestore.FieldValue.increment(reembolso)
      });

      // Registrar transação de reembolso
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: odId,
        tipo: 'credito',
        valor: reembolso,
        descricao: `🔄 Reembolso - Embate ${embate.codigo || embateId} cancelado`,
        embateId: embateId,
        data: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Atualizar status do embate
    batch.update(db.collection('embates').doc(embateId), {
      status: 'cancelado',
      dataCancelamento: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log reembolsos
    try {
      for (const odId of participantes) {
        await logAtividade(odId, 'reembolso_pvp', reembolso, null,
          `PvP: reembolso — embate ${embate.codigo || embateId} cancelado`,
          { embateId, reembolso });
      }
    } catch(logErr) { console.error('⚠️ Log cancelamento:', logErr.message); }

    console.log(`✅ Embate ${embateId} cancelado. ${participantes.length} participantes reembolsados.`);

    return {
      success: true,
      reembolsados: participantes.length,
      mensagem: `Embate cancelado. ${participantes.length} participantes reembolsados.`
    };

  } catch (error) {
    console.error('❌ Erro ao cancelar embate:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao cancelar embate');
  }
});


// =====================================================
// 5. COLETAR PRÊMIO EMBATE - Vencedor coleta seu prêmio
// (Backup: usado quando o embate é finalizado mas o
//  vencedor não estava online para receber)
// =====================================================
exports.coletarPremioEmbate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { embateId } = data;

  if (!embateId) {
    throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');
  }

  try {
    // Buscar embate
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    }

    const embate = embateDoc.data();

    // Verificar se o embate está finalizado
    if (embate.status !== 'finalizado') {
      throw new functions.https.HttpsError('failed-precondition', 'Embate não está finalizado');
    }

    // Verificar se já recebeu o prêmio
    const transacaoExistente = await db.collection('transacoes')
      .where('usuarioId', '==', userId)
      .where('embateId', '==', embateId)
      .where('tipo', '==', 'credito')
      .limit(1)
      .get();

    if (!transacaoExistente.empty) {
      return { success: true, mensagem: 'Prêmio já coletado', jaColetou: true };
    }

    // Verificar se o usuário é um vencedor
    const resultado = embate.resultado;
    if (!resultado) {
      throw new functions.https.HttpsError('failed-precondition', 'Embate sem resultado');
    }

    let euVenci = false;
    if (resultado.empate) {
      euVenci = (resultado.vencedoresEmpate || []).includes(userId);
    } else {
      euVenci = resultado.vencedorId === userId;
    }

    if (!euVenci) {
      // Não venceu - registrar derrota se não existir
      const derrotaExistente = await db.collection('transacoes')
        .where('usuarioId', '==', userId)
        .where('embateId', '==', embateId)
        .where('tipo', '==', 'derrota')
        .limit(1)
        .get();

      if (derrotaExistente.empty) {
        const batch = db.batch();
        
        batch.update(db.collection('usuarios').doc(userId), {
          'pvp.derrotas': admin.firestore.FieldValue.increment(1),
          'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
        });

        const transRef = db.collection('transacoes').doc();
        batch.set(transRef, {
          usuarioId: userId,
          tipo: 'derrota',
          valor: 0,
          descricao: `Derrota no embate ${embate.codigo || embateId}`,
          embateId: embateId,
          data: admin.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
      }

      return { success: true, mensagem: 'Você não venceu este embate', venceu: false };
    }

    // Calcular prêmio
    const premio = embate.prizePool || (embate.aposta * (embate.participantes || []).length);
    let meuPremio;

    if (resultado.empate) {
      meuPremio = Math.floor(premio / (resultado.vencedoresEmpate || []).length);
    } else {
      meuPremio = premio;
    }

    // Creditar prêmio
    const batch = db.batch();

    batch.update(db.collection('usuarios').doc(userId), {
      creditos: admin.firestore.FieldValue.increment(meuPremio),
      'pvp.vitorias': admin.firestore.FieldValue.increment(1),
      'pvp.creditosGanhos': admin.firestore.FieldValue.increment(meuPremio),
      'pvp.totalEmbates': admin.firestore.FieldValue.increment(1)
    });

    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: userId,
      tipo: 'credito',
      valor: meuPremio,
      descricao: `🏆 Vitória no embate ${embate.codigo || embateId} (+${meuPremio} créditos)`,
      embateId: embateId,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    await logAtividade(userId, 'premio_pvp', meuPremio, null,
      `PvP: prêmio coletado — embate ${embate.codigo || embateId}`,
      { embateId, premio: meuPremio });

    console.log(`✅ Prêmio coletado: ${userId} recebeu ${meuPremio} cr do embate ${embateId}`);

    return { success: true, premio: meuPremio, venceu: true, mensagem: `+${meuPremio} créditos!` };

  } catch (error) {
    console.error('❌ Erro ao coletar prêmio:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao coletar prêmio');
  }
});

// =====================================================
// FUNÇÃO: PREMIAR JOGO
// Distribui prêmios do pool de créditos após o jogo
// 60% Ranking, 25% Cotistas, 15% Sortudos
// =====================================================

exports.premiarJogo = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const { jogoId } = data;
  if (!jogoId) {
    throw new functions.https.HttpsError('invalid-argument', 'jogoId é obrigatório');
  }

  try {
    // 1. Ler dados do jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    }

    const jogoData = jogoDoc.data();

    // ✅ Verificar se jogo realmente acabou (qualquer user pode chamar, mas só se acabou)
    if (jogoData.dataFim) {
      const fim = jogoData.dataFim.toDate ? jogoData.dataFim.toDate() : new Date(jogoData.dataFim);
      if (new Date() < fim) {
        throw new functions.https.HttpsError('failed-precondition', 'Jogo ainda não acabou');
      }
    }

    // Verificar se já foi premiado (idempotente)
    if (jogoData.premiado && jogoData.premiacaoDetalhes) {
      console.log('✅ Jogo já foi premiado, retornando detalhes existentes');
      return { success: true, jaPremiado: true, detalhes: jogoData.premiacaoDetalhes };
    }

    const timeCasaId = jogoData.timeCasaId;
    const timeForaId = jogoData.timeForaId;

    // 2. Ler nomes dos times
    let timeCasaNome = 'Time Casa';
    let timeForaNome = 'Time Fora';
    try {
      const timeCasaDoc = await db.collection('times').doc(timeCasaId).get();
      if (timeCasaDoc.exists) timeCasaNome = timeCasaDoc.data().nome || timeCasaNome;
      const timeForaDoc = await db.collection('times').doc(timeForaId).get();
      if (timeForaDoc.exists) timeForaNome = timeForaDoc.data().nome || timeForaNome;
    } catch (e) {
      console.warn('⚠️ Erro ao buscar nomes dos times:', e);
    }

    // 3. Ler participantes
    const participantesSnap = await db.collection('jogos').doc(jogoId)
      .collection('participantes').get();

    if (participantesSnap.empty) {
      console.log('⚠️ Nenhum participante');
      return { success: true, semParticipantes: true };
    }

    const participantes = [];
    const estatisticas = {
      timeCasa: { pontos: 0, torcedores: [], nome: timeCasaNome },
      timeFora: { pontos: 0, torcedores: [], nome: timeForaNome }
    };

    participantesSnap.forEach(doc => {
      const p = doc.data();
      const pontos = p.pontos || 0;
      let tempoMedio = 10;
      if (p.tempoQuantidade > 0) {
        tempoMedio = p.tempoSoma / p.tempoQuantidade;
      }

      participantes.push({
        odId: p.odId,
        nome: p.nome,
        pontos: pontos,
        tempoMedio: tempoMedio,
        timeId: p.timeId,
        timeNome: p.timeNome
      });

      if (p.timeId === timeCasaId) {
        estatisticas.timeCasa.pontos += pontos;
        estatisticas.timeCasa.torcedores.push({ odId: p.odId, nome: p.nome });
      } else if (p.timeId === timeForaId) {
        estatisticas.timeFora.pontos += pontos;
        estatisticas.timeFora.torcedores.push({ odId: p.odId, nome: p.nome });
      }
    });

    // Ordenar por pontos e tempo
    participantes.sort((a, b) => {
      if (b.pontos !== a.pontos) return b.pontos - a.pontos;
      return a.tempoMedio - b.tempoMedio;
    });

    // 4. Calcular pool
    let poolCreditos = jogoData.poolCreditos || 0;
    if (poolCreditos === 0 && jogoData.poolCreditosPagos) {
      poolCreditos = jogoData.poolCreditosPagos;
    }
    const creditosIniciais = jogoData.creditosIniciais || 0;
    const totalPoolCreditos = poolCreditos + creditosIniciais;

    if (totalPoolCreditos <= 0) {
      console.log('⚠️ Pool vazio - atualizando bolsa mesmo assim');
      
      // Mesmo sem pool, atualizar preço dos times na bolsa
      try {
        const CONFIG_BOLSA = {
          porJogo: 0.25, porTorcedor: 0.05, porVitoriaTorcida: 0.5,
          porVitoriaPontuacao: 0.9, porPonto: 0.005,
          porDerrotaTorcida: 0.3, porDerrotaPontuacao: 0.5, maxVariacao: 12
        };
        const PRECO_INICIAL = 500;
        const tc = estatisticas.timeCasa.torcedores.length;
        const tf = estatisticas.timeFora.torcedores.length;
        const pc = estatisticas.timeCasa.pontos;
        const pf = estatisticas.timeFora.pontos;

        let vc = CONFIG_BOLSA.porJogo + tc * CONFIG_BOLSA.porTorcedor + pc * CONFIG_BOLSA.porPonto;
        let vf = CONFIG_BOLSA.porJogo + tf * CONFIG_BOLSA.porTorcedor + pf * CONFIG_BOLSA.porPonto;
        if (tc > tf) { vc += CONFIG_BOLSA.porVitoriaTorcida; vf -= CONFIG_BOLSA.porDerrotaTorcida; }
        else if (tf > tc) { vf += CONFIG_BOLSA.porVitoriaTorcida; vc -= CONFIG_BOLSA.porDerrotaTorcida; }
        if (pc > pf) { vc += CONFIG_BOLSA.porVitoriaPontuacao; vf -= CONFIG_BOLSA.porDerrotaPontuacao; }
        else if (pf > pc) { vf += CONFIG_BOLSA.porVitoriaPontuacao; vc -= CONFIG_BOLSA.porDerrotaPontuacao; }
        vc = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, vc));
        vf = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, vf));

        const [mCDoc, mFDoc] = await Promise.all([
          db.collection('bolsa_metricas_time').doc(timeCasaId).get(),
          db.collection('bolsa_metricas_time').doc(timeForaId).get()
        ]);
        const mC = mCDoc.exists ? mCDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, totalJogos: 0, totalTorcedores: 0, mediaDividendos: 0 };
        const mF = mFDoc.exists ? mFDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, totalJogos: 0, totalTorcedores: 0, mediaDividendos: 0 };

        const batchBolsa = db.batch();
        batchBolsa.update(db.collection('jogos').doc(jogoId), {
          premiado: true, bolsaProcessado: true,
          premiacaoDetalhes: { totalPool: 0, processadoEm: new Date().toISOString(), processadoPor: 'cloud_function' }
        });
        batchBolsa.set(db.collection('bolsa_metricas_time').doc(timeCasaId), {
          timeId: timeCasaId, timeNome: timeCasaNome,
          precoAlgoritmo: Math.round(mC.precoAlgoritmo * (1 + vc / 100) * 100) / 100,
          precoMercado: Math.round(mC.precoAlgoritmo * (1 + vc / 100) * 100) / 100,
          variacaoDia: Math.round(((mC.variacaoDia || 0) + vc) * 100) / 100,
          mediaDividendos: mC.mediaDividendos || 0,
          totalJogos: (mC.totalJogos || 0) + 1,
          totalTorcedores: (mC.totalTorcedores || 0) + tc,
          ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        batchBolsa.set(db.collection('bolsa_metricas_time').doc(timeForaId), {
          timeId: timeForaId, timeNome: timeForaNome,
          precoAlgoritmo: Math.round(mF.precoAlgoritmo * (1 + vf / 100) * 100) / 100,
          precoMercado: Math.round(mF.precoAlgoritmo * (1 + vf / 100) * 100) / 100,
          variacaoDia: Math.round(((mF.variacaoDia || 0) + vf) * 100) / 100,
          mediaDividendos: mF.mediaDividendos || 0,
          totalJogos: (mF.totalJogos || 0) + 1,
          totalTorcedores: (mF.totalTorcedores || 0) + tf,
          ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await batchBolsa.commit();
        console.log(`📈 Bolsa (pool vazio): ${timeCasaNome} ${vc >= 0?'+':''}${vc.toFixed(2)}% | ${timeForaNome} ${vf >= 0?'+':''}${vf.toFixed(2)}%`);
      } catch (bolsaErr) {
        console.error('⚠️ Erro bolsa pool vazio:', bolsaErr);
        // Fallback: pelo menos marcar como premiado
        await db.collection('jogos').doc(jogoId).update({
          premiado: true, bolsaProcessado: true,
          premiacaoDetalhes: { totalPool: 0, processadoEm: new Date().toISOString(), processadoPor: 'cloud_function' }
        });
      }
      return { success: true, poolVazio: true };
    }

    // Função de arredondamento
    function arredondar(valor) {
      if (valor <= 0) return 0;
      const arredondado = valor % 1 >= 0.5 ? Math.ceil(valor) : Math.floor(valor);
      return Math.max(1, arredondado);
    }

    // 5. Distribuição: 60% Ranking, 25% Cotistas, 15% Sortudos
    const totalRankingCreditos = arredondar(totalPoolCreditos * 0.60);
    const totalCotistasCreditos = arredondar(totalPoolCreditos * 0.25);
    const totalSortudoCreditos = arredondar(totalPoolCreditos * 0.15);
    const creditosSortudoVencedor = arredondar(totalSortudoCreditos * 0.67);
    const creditosSortudoPopular = totalSortudoCreditos - creditosSortudoVencedor;

    const PERCENTUAIS_RANKING = [30, 20, 15, 10, 7, 5, 4, 3, 3, 3];
    const top100 = participantes.slice(0, 100);
    const numParticipantes = top100.length;

    // 6. Calcular créditos por posição
    const creditosPorPosicao = [];
    let creditosDistribuidos = 0;

    if (numParticipantes <= 10) {
      const percentuaisAjustados = PERCENTUAIS_RANKING.slice(0, numParticipantes);
      const somaPercentuais = percentuaisAjustados.reduce((a, b) => a + b, 0);
      for (let i = 0; i < numParticipantes; i++) {
        const creditos = arredondar(totalRankingCreditos * percentuaisAjustados[i] / somaPercentuais);
        creditosPorPosicao.push(creditos);
        creditosDistribuidos += creditos;
      }
    } else {
      const creditosTop10 = arredondar(totalRankingCreditos * 0.70);
      const creditosRestante = totalRankingCreditos - creditosTop10;
      for (let i = 0; i < 10; i++) {
        const creditos = arredondar(creditosTop10 * PERCENTUAIS_RANKING[i] / 100);
        creditosPorPosicao.push(creditos);
        creditosDistribuidos += creditos;
      }
      const restantes = numParticipantes - 10;
      for (let i = 10; i < numParticipantes; i++) {
        const peso = Math.max(1, restantes - (i - 10));
        const somaRestante = (restantes * (restantes + 1)) / 2;
        const creditos = arredondar(creditosRestante * peso / somaRestante);
        creditosPorPosicao.push(creditos);
        creditosDistribuidos += creditos;
      }
    }

    // Ajustar diferença no 1º lugar
    const diferencaRanking = totalRankingCreditos - creditosDistribuidos;
    if (diferencaRanking !== 0 && creditosPorPosicao.length > 0) {
      creditosPorPosicao[0] += diferencaRanking;
    }

    // 7. Premiar ranking (em batches de 400 para não exceder limite de 500)
    const premiosRanking = [];
    let batchCount = 0;
    let batch = db.batch();

    for (let i = 0; i < top100.length; i++) {
      const p = top100[i];
      const creditos = creditosPorPosicao[i] || 0;

      premiosRanking.push({
        odId: p.odId, nome: p.nome, posicao: i + 1,
        pontos: p.pontos, creditos: creditos
      });

      if (creditos > 0) {
        const userRef = db.collection('usuarios').doc(p.odId);
        batch.update(userRef, {
          creditos: admin.firestore.FieldValue.increment(creditos)
        });
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // 8. Cotistas
    const premiosCotistas = [];
    const totalPontos = estatisticas.timeCasa.pontos + estatisticas.timeFora.pontos;

    const distribuicaoCotistasJogo = {
      jogoId: jogoId,
      timeCasaId, timeCasaNome: estatisticas.timeCasa.nome,
      timeForaId, timeForaNome: estatisticas.timeFora.nome,
      totalPool: totalPoolCreditos, totalCotistas: totalCotistasCreditos,
      pontosCasa: estatisticas.timeCasa.pontos, pontosFora: estatisticas.timeFora.pontos,
      cotistasPremiados: [],
      processadoEm: admin.firestore.FieldValue.serverTimestamp()
    };

    if (totalPontos > 0 && totalCotistasCreditos > 0) {
      const proporcaoCasa = estatisticas.timeCasa.pontos / totalPontos;
      const creditosCotistaCasa = arredondar(totalCotistasCreditos * proporcaoCasa);
      const creditosCotistaFora = totalCotistasCreditos - creditosCotistaCasa;

      distribuicaoCotistasJogo.creditosCasa = creditosCotistaCasa;
      distribuicaoCotistasJogo.creditosFora = creditosCotistaFora;

      // Função helper para premiar cotistas de um time
      async function premiarCotistasTime(timeId, timeNome, creditosTotal) {
        if (creditosTotal <= 0) return;
        const cotistasSnap = await db.collection('bolsa_cotas').where('timeId', '==', timeId).get();
        if (cotistasSnap.empty) return;

        let totalCotas = 0;
        const cotistas = [];
        cotistasSnap.forEach(doc => {
          const c = doc.data();
          totalCotas += c.quantidade || 0;
          cotistas.push({ odId: c.userId, nome: c.usuarioNome, ...c });
        });

        if (totalCotas <= 0) return;

        let distribuido = 0;
        for (let i = 0; i < cotistas.length; i++) {
          const c = cotistas[i];
          const proporcao = (c.quantidade || 0) / totalCotas;
          let creditos = arredondar(creditosTotal * proporcao);
          if (i === cotistas.length - 1) creditos = creditosTotal - distribuido;

          if (creditos > 0 && c.odId) {
            const userRef = db.collection('usuarios').doc(c.odId);
            batch.update(userRef, {
              creditos: admin.firestore.FieldValue.increment(creditos)
            });
            batchCount++;

            if (batchCount >= 400) {
              await batch.commit();
              batch = db.batch();
              batchCount = 0;
            }

            const cotistaInfo = {
              odId: c.odId,
              nome: c.nome || c.usuarioNome || c.odId,
              time: timeNome, timeId: timeId,
              cotas: c.quantidade, totalCotas: totalCotas,
              creditos: creditos
            };
            premiosCotistas.push(cotistaInfo);
            distribuicaoCotistasJogo.cotistasPremiados.push(cotistaInfo);
            distribuido += creditos;
          }
        }
      }

      await premiarCotistasTime(timeCasaId, estatisticas.timeCasa.nome, creditosCotistaCasa);
      await premiarCotistasTime(timeForaId, estatisticas.timeFora.nome, creditosCotistaFora);
    }

    // 9. Sortudos
    let sortudoVencedor = null;
    const timeVencedor = estatisticas.timeCasa.pontos > estatisticas.timeFora.pontos ? 'timeCasa' :
                         estatisticas.timeFora.pontos > estatisticas.timeCasa.pontos ? 'timeFora' : null;

    if (timeVencedor && estatisticas[timeVencedor].torcedores.length > 0) {
      const torcedoresVencedor = estatisticas[timeVencedor].torcedores;
      const sorteado = torcedoresVencedor[Math.floor(Math.random() * torcedoresVencedor.length)];

      sortudoVencedor = {
        odId: sorteado.odId, nome: sorteado.nome,
        time: estatisticas[timeVencedor].nome, creditos: creditosSortudoVencedor
      };

      const userRef = db.collection('usuarios').doc(sorteado.odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(creditosSortudoVencedor)
      });
      batchCount++;
    }

    let sortudoPopular = null;
    const timePopular = estatisticas.timeCasa.torcedores.length > estatisticas.timeFora.torcedores.length ? 'timeCasa' :
                        estatisticas.timeFora.torcedores.length > estatisticas.timeCasa.torcedores.length ? 'timeFora' :
                        (Math.random() > 0.5 ? 'timeCasa' : 'timeFora');
    const timeAlternativo = timePopular === 'timeCasa' ? 'timeFora' : 'timeCasa';

    let torcedoresPopular = [...estatisticas[timePopular].torcedores];
    let timeEscolhido = timePopular;

    if (sortudoVencedor) {
      torcedoresPopular = torcedoresPopular.filter(t => t.odId !== sortudoVencedor.odId);
    }

    if (torcedoresPopular.length === 0 && estatisticas[timeAlternativo].torcedores.length > 0) {
      torcedoresPopular = [...estatisticas[timeAlternativo].torcedores];
      timeEscolhido = timeAlternativo;
      if (sortudoVencedor) {
        torcedoresPopular = torcedoresPopular.filter(t => t.odId !== sortudoVencedor.odId);
      }
    }

    if (torcedoresPopular.length > 0) {
      const sorteadoPopular = torcedoresPopular[Math.floor(Math.random() * torcedoresPopular.length)];

      sortudoPopular = {
        odId: sorteadoPopular.odId, nome: sorteadoPopular.nome,
        time: estatisticas[timeEscolhido].nome, creditos: creditosSortudoPopular
      };

      const userRef = db.collection('usuarios').doc(sorteadoPopular.odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(creditosSortudoPopular)
      });
      batchCount++;
    }

    // 10. Salvar detalhes da premiação
    const premiacaoDetalhes = {
      totalPool: totalPoolCreditos,
      creditosIniciais: creditosIniciais,
      distribuicao: {
        ranking: { percentual: 60, total: totalRankingCreditos },
        cotistas: { percentual: 25, total: totalCotistasCreditos },
        sortudos: { percentual: 15, total: totalSortudoCreditos }
      },
      ranking: premiosRanking,
      cotistas: premiosCotistas,
      sortudoVencedor: sortudoVencedor,
      sortudoPopular: sortudoPopular,
      estatisticas: {
        timeCasa: { nome: estatisticas.timeCasa.nome, pontos: estatisticas.timeCasa.pontos, torcedores: estatisticas.timeCasa.torcedores.length },
        timeFora: { nome: estatisticas.timeFora.nome, pontos: estatisticas.timeFora.pontos, torcedores: estatisticas.timeFora.torcedores.length }
      },
      processadoEm: new Date().toISOString(),
      processadoPor: 'cloud_function'
    };

    // Marcar jogo como premiado no batch
    const jogoRef = db.collection('jogos').doc(jogoId);
    batch.update(jogoRef, {
      premiado: true,
      bolsaProcessado: true,
      premiacaoDetalhes: premiacaoDetalhes
    });

    // Salvar distribuição cotistas
    if (totalPontos > 0 && totalCotistasCreditos > 0) {
      const distRef = db.collection('distribuicao_cotistas_jogo').doc(jogoId);
      batch.set(distRef, distribuicaoCotistasJogo);
    }

    // ============================================
    // 📈 ATUALIZAR MÉTRICAS DA BOLSA (no mesmo batch!)
    // ============================================
    try {
      const CONFIG_BOLSA = {
        porJogo: 0.25,
        porTorcedor: 0.05,
        porVitoriaTorcida: 0.5,
        porVitoriaPontuacao: 0.9,
        porPonto: 0.005,
        porDerrotaTorcida: 0.3,
        porDerrotaPontuacao: 0.5,
        maxVariacao: 12
      };
      const PRECO_INICIAL = 500;

      const torcidaCasa = estatisticas.timeCasa.torcedores.length;
      const torcidaFora = estatisticas.timeFora.torcedores.length;
      const pontosCasa = estatisticas.timeCasa.pontos;
      const pontosFora = estatisticas.timeFora.pontos;

      // Calcular variação Casa
      let varCasa = CONFIG_BOLSA.porJogo + (torcidaCasa * CONFIG_BOLSA.porTorcedor) + (pontosCasa * CONFIG_BOLSA.porPonto);
      let varFora = CONFIG_BOLSA.porJogo + (torcidaFora * CONFIG_BOLSA.porTorcedor) + (pontosFora * CONFIG_BOLSA.porPonto);

      if (torcidaCasa > torcidaFora) { varCasa += CONFIG_BOLSA.porVitoriaTorcida; varFora -= CONFIG_BOLSA.porDerrotaTorcida; }
      else if (torcidaFora > torcidaCasa) { varFora += CONFIG_BOLSA.porVitoriaTorcida; varCasa -= CONFIG_BOLSA.porDerrotaTorcida; }

      if (pontosCasa > pontosFora) { varCasa += CONFIG_BOLSA.porVitoriaPontuacao; varFora -= CONFIG_BOLSA.porDerrotaPontuacao; }
      else if (pontosFora > pontosCasa) { varFora += CONFIG_BOLSA.porVitoriaPontuacao; varCasa -= CONFIG_BOLSA.porDerrotaPontuacao; }

      varCasa = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, varCasa));
      varFora = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, varFora));

      // Buscar métricas atuais
      const [metCasaDoc, metForaDoc] = await Promise.all([
        db.collection('bolsa_metricas_time').doc(timeCasaId).get(),
        db.collection('bolsa_metricas_time').doc(timeForaId).get()
      ]);

      const metCasa = metCasaDoc.exists ? metCasaDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, mediaDividendos: 0, totalJogos: 0, totalTorcedores: 0 };
      const metFora = metForaDoc.exists ? metForaDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, mediaDividendos: 0, totalJogos: 0, totalTorcedores: 0 };

      const novoPrecoCasa = Math.round(metCasa.precoAlgoritmo * (1 + varCasa / 100) * 100) / 100;
      const novoPrecoFora = Math.round(metFora.precoAlgoritmo * (1 + varFora / 100) * 100) / 100;

      // Dividendos
      const divCasa = totalPontos > 0 ? totalCotistasCreditos * (pontosCasa / totalPontos) : 0;
      const divFora = totalPontos > 0 ? totalCotistasCreditos * (pontosFora / totalPontos) : 0;
      const jCasa = (metCasa.totalJogos || 0) + 1;
      const jFora = (metFora.totalJogos || 0) + 1;
      const mediaDivCasa = Math.round(((metCasa.mediaDividendos || 0) * (metCasa.totalJogos || 0) + divCasa) / jCasa * 1000) / 1000;
      const mediaDivFora = Math.round(((metFora.mediaDividendos || 0) * (metFora.totalJogos || 0) + divFora) / jFora * 1000) / 1000;

      // Adicionar ao batch
      batch.set(db.collection('bolsa_metricas_time').doc(timeCasaId), {
        timeId: timeCasaId, timeNome: timeCasaNome,
        precoAlgoritmo: novoPrecoCasa, precoMercado: novoPrecoCasa,
        variacaoDia: Math.round(((metCasa.variacaoDia || 0) + varCasa) * 100) / 100,
        mediaDividendos: mediaDivCasa, totalJogos: jCasa,
        totalTorcedores: (metCasa.totalTorcedores || 0) + torcidaCasa,
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      batch.set(db.collection('bolsa_metricas_time').doc(timeForaId), {
        timeId: timeForaId, timeNome: timeForaNome,
        precoAlgoritmo: novoPrecoFora, precoMercado: novoPrecoFora,
        variacaoDia: Math.round(((metFora.variacaoDia || 0) + varFora) * 100) / 100,
        mediaDividendos: mediaDivFora, totalJogos: jFora,
        totalTorcedores: (metFora.totalTorcedores || 0) + torcidaFora,
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`📈 Bolsa: ${timeCasaNome} ${varCasa >= 0 ? '+' : ''}${varCasa.toFixed(2)}% → ${novoPrecoCasa} cr`);
      console.log(`📈 Bolsa: ${timeForaNome} ${varFora >= 0 ? '+' : ''}${varFora.toFixed(2)}% → ${novoPrecoFora} cr`);
    } catch (bolsaErr) {
      console.error('⚠️ Erro bolsa (não impede premiação):', bolsaErr);
    }

    // Commit final
    await batch.commit();

    // 📋 Logs de atividade - premiação do jogo
    try {
      const jogoDesc = `${timeCasaNome} vs ${timeForaNome}`;
      // Log top 20 do ranking (mais relevantes)
      for (const p of premiosRanking.slice(0, 20)) {
        if (p.creditos > 0) {
          await logAtividade(p.odId, 'jogo_ranking', p.creditos, null,
            `Jogo: ${p.posicao}º lugar — ${jogoDesc} (+${p.creditos} cr)`,
            { jogoId, posicao: p.posicao, pontos: p.pontos });
        }
      }
      // Log cotistas
      for (const c of premiosCotistas) {
        if (c.creditos > 0) {
          await logAtividade(c.odId, 'jogo_cotista', c.creditos, null,
            `Cotista: dividendo ${jogoDesc} (+${c.creditos} cr)`,
            { jogoId, time: c.time, cotas: c.cotas });
        }
      }
      // Log sortudos
      if (sortudoVencedor) {
        await logAtividade(sortudoVencedor.odId, 'jogo_sortudo', sortudoVencedor.creditos, null,
          `Sortudo vencedor: ${jogoDesc} (+${sortudoVencedor.creditos} cr)`,
          { jogoId, time: sortudoVencedor.time });
      }
      if (sortudoPopular) {
        await logAtividade(sortudoPopular.odId, 'jogo_sortudo', sortudoPopular.creditos, null,
          `Sortudo popular: ${jogoDesc} (+${sortudoPopular.creditos} cr)`,
          { jogoId, time: sortudoPopular.time });
      }
    } catch(logErr) { console.error('⚠️ Log premiação jogo:', logErr.message); }

    console.log(`🏆 Premiação do jogo ${jogoId} processada com sucesso! Pool: ${totalPoolCreditos}`);

    // ============================================
    // 🔔 CRIAR NOTIFICAÇÕES (após commit, não bloqueia premiação)
    // ============================================
    try {
      const jogoNome = `${timeCasaNome} vs ${timeForaNome}`;
      const notifBatch = db.batch();
      let notifCount = 0;

      // Notificar Top 10 do ranking
      for (const p of premiosRanking.slice(0, 10)) {
        if (p.creditos > 0) {
          const emoji = p.posicao <= 3 ? ['🥇', '🥈', '🥉'][p.posicao - 1] : '🏆';
          notifBatch.set(db.collection('notificacoes').doc(), {
            para: p.odId,
            tipo: 'premiacao',
            titulo: `${emoji} ${p.posicao}º lugar - ${jogoNome}`,
            mensagem: `Você fez ${p.pontos} pts e ganhou +${p.creditos} créditos!`,
            lida: false,
            data: admin.firestore.FieldValue.serverTimestamp()
          });
          notifCount++;
        }
      }

      // Notificar Sortudos
      if (sortudoVencedor) {
        notifBatch.set(db.collection('notificacoes').doc(), {
          para: sortudoVencedor.odId,
          tipo: 'sortudo',
          titulo: `🎰 Sortudo Vencedor - ${jogoNome}`,
          mensagem: `Sorteado no time vencedor (${sortudoVencedor.time})! +${sortudoVencedor.creditos} créditos`,
          lida: false,
          data: admin.firestore.FieldValue.serverTimestamp()
        });
        notifCount++;
      }

      if (sortudoPopular) {
        notifBatch.set(db.collection('notificacoes').doc(), {
          para: sortudoPopular.odId,
          tipo: 'sortudo',
          titulo: `🎰 Sortudo Popular - ${jogoNome}`,
          mensagem: `Sorteado no time popular (${sortudoPopular.time})! +${sortudoPopular.creditos} créditos`,
          lida: false,
          data: admin.firestore.FieldValue.serverTimestamp()
        });
        notifCount++;
      }

      // Notificar Cotistas (até 20 para não exceder batch)
      for (const c of premiosCotistas.slice(0, 20)) {
        if (c.creditos > 0) {
          notifBatch.set(db.collection('notificacoes').doc(), {
            para: c.odId,
            tipo: 'cotista',
            titulo: `💰 Dividendo - ${jogoNome}`,
            mensagem: `Cotista de ${c.timeNome || 'time'}: +${c.creditos} créditos`,
            lida: false,
            data: admin.firestore.FieldValue.serverTimestamp()
          });
          notifCount++;
        }
      }

      if (notifCount > 0) {
        await notifBatch.commit();
        console.log(`🔔 ${notifCount} notificações criadas`);
      }
    } catch (notifErr) {
      console.error('⚠️ Erro notificações (não impede premiação):', notifErr);
    }

    return { success: true, detalhes: premiacaoDetalhes };

  } catch (error) {
    console.error('❌ Erro ao premiar jogo:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao processar premiação');
  }
});

// =====================================================
// FUNÇÃO: INSCREVER EM TORNEIO
// Debita entrada e registra inscrição
// =====================================================

exports.inscreverTorneio = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { torneioId } = data;

  if (!torneioId) {
    throw new functions.https.HttpsError('invalid-argument', 'torneioId é obrigatório');
  }

  try {
    const torneioDoc = await db.collection('torneios').doc(torneioId).get();
    if (!torneioDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Torneio não encontrado');
    }

    const torneio = torneioDoc.data();
    const entrada = torneio.entrada || 0;

    // Verificar se já está inscrito
    const inscritos = torneio.inscritos || [];
    if (inscritos.includes(userId)) {
      throw new functions.https.HttpsError('already-exists', 'Já está inscrito neste torneio');
    }

    // Verificar vagas
    if ((torneio.totalInscritos || 0) >= torneio.vagas && torneio.vagas < 9999) {
      throw new functions.https.HttpsError('resource-exhausted', 'Torneio cheio');
    }

    // Verificar créditos
    if (entrada > 0) {
      const userDoc = await db.collection('usuarios').doc(userId).get();
      const creditos = userDoc.data().creditos || 0;
      if (creditos < entrada) {
        throw new functions.https.HttpsError('failed-precondition', 'Créditos insuficientes');
      }
    }

    const batch = db.batch();

    // Debitar entrada
    if (entrada > 0) {
      const userRef = db.collection('usuarios').doc(userId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(-entrada)
      });

      // Registrar transação
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: userId,
        tipo: 'debito',
        valor: entrada,
        descricao: `Inscrição no torneio ${torneio.nome || 'Torneio'}`,
        torneioId: torneioId,
        data: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Atualizar torneio
    const torneioRef = db.collection('torneios').doc(torneioId);
    batch.update(torneioRef, {
      inscritos: admin.firestore.FieldValue.arrayUnion(userId),
      totalInscritos: admin.firestore.FieldValue.increment(1),
      prizePool: admin.firestore.FieldValue.increment(entrada)
    });

    await batch.commit();

    // 📋 Log
    if (entrada > 0) {
      await logAtividade(userId, 'debito_torneio', -entrada, creditos,
        `Torneio: inscrição em ${torneio.nome || 'Torneio'}`,
        { torneioId, entrada });
    }

    console.log(`✅ Usuário ${userId} inscrito no torneio ${torneioId} (entrada: ${entrada})`);
    return { success: true, entrada: entrada };

  } catch (error) {
    console.error('❌ Erro ao inscrever no torneio:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao inscrever no torneio');
  }
});

// =====================================================
// FUNÇÃO: FINALIZAR TORNEIO
// Calcula ranking, premia top 3, atualiza stats
// =====================================================

exports.finalizarTorneio = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  // ✅ SEGURANÇA: Apenas admin (admin@yellup.com) pode finalizar torneios manualmente
  if (!isAdminEmail(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Apenas administradores podem finalizar torneios');
  }

  const { torneioId } = data;
  if (!torneioId) {
    throw new functions.https.HttpsError('invalid-argument', 'torneioId é obrigatório');
  }

  try {
    const torneioDoc = await db.collection('torneios').doc(torneioId).get();
    if (!torneioDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Torneio não encontrado');
    }

    const torneioAtual = torneioDoc.data();

    // Já finalizado? Retornar resultado existente
    if (torneioAtual.status === 'finalizado' && torneioAtual.resultado) {
      return { success: true, jaFinalizado: true, resultado: torneioAtual.resultado };
    }

    // Buscar ranking
    const participacoesSnap = await db.collection('torneios').doc(torneioId)
      .collection('participacoes').orderBy('pontos', 'desc').get();

    let ranking = [];
    participacoesSnap.forEach(doc => {
      ranking.push({ odId: doc.id, ...doc.data() });
    });

    // Calcular prêmios
    const prizePool = torneioAtual.prizePool || 0;
    const distribuicao = torneioAtual.config?.distribuicaoPremio || { primeiro: 50, segundo: 30, terceiro: 20 };

    const premio1 = Math.floor(prizePool * distribuicao.primeiro / 100);
    const premio2 = Math.floor(prizePool * distribuicao.segundo / 100);
    const premio3 = Math.floor(prizePool * distribuicao.terceiro / 100);

    const resultado = {
      primeiro: ranking[0] ? { odId: ranking[0].odId, odNome: ranking[0].odNome, pontos: ranking[0].pontos, premio: premio1 } : null,
      segundo: ranking[1] ? { odId: ranking[1].odId, odNome: ranking[1].odNome, pontos: ranking[1].pontos, premio: premio2 } : null,
      terceiro: ranking[2] ? { odId: ranking[2].odId, odNome: ranking[2].odNome, pontos: ranking[2].pontos, premio: premio3 } : null,
      ranking: ranking.map((r, i) => ({
        posicao: i + 1, odId: r.odId, odNome: r.odNome,
        pontos: r.pontos || 0, acertos: r.acertos || 0, erros: r.erros || 0
      }))
    };

    const batch = db.batch();

    // Premiar 1º lugar
    if (ranking[0] && premio1 > 0) {
      const userRef = db.collection('usuarios').doc(ranking[0].odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(premio1),
        'torneios.vitorias': admin.firestore.FieldValue.increment(1),
        'torneios.creditosGanhos': admin.firestore.FieldValue.increment(premio1),
        'torneios.totalTorneios': admin.firestore.FieldValue.increment(1)
      });
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: ranking[0].odId, tipo: 'credito', valor: premio1,
        descricao: `🥇 1º lugar no torneio ${torneioAtual.nome || 'Torneio'}`,
        torneioId, data: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Premiar 2º lugar
    if (ranking[1] && premio2 > 0) {
      const userRef = db.collection('usuarios').doc(ranking[1].odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(premio2),
        'torneios.top3': admin.firestore.FieldValue.increment(1),
        'torneios.creditosGanhos': admin.firestore.FieldValue.increment(premio2),
        'torneios.totalTorneios': admin.firestore.FieldValue.increment(1)
      });
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: ranking[1].odId, tipo: 'credito', valor: premio2,
        descricao: `🥈 2º lugar no torneio ${torneioAtual.nome || 'Torneio'}`,
        torneioId, data: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Premiar 3º lugar
    if (ranking[2] && premio3 > 0) {
      const userRef = db.collection('usuarios').doc(ranking[2].odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(premio3),
        'torneios.top3': admin.firestore.FieldValue.increment(1),
        'torneios.creditosGanhos': admin.firestore.FieldValue.increment(premio3),
        'torneios.totalTorneios': admin.firestore.FieldValue.increment(1)
      });
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: ranking[2].odId, tipo: 'credito', valor: premio3,
        descricao: `🥉 3º lugar no torneio ${torneioAtual.nome || 'Torneio'}`,
        torneioId, data: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Marcar torneio como finalizado
    const torneioRef = db.collection('torneios').doc(torneioId);
    batch.update(torneioRef, {
      status: 'finalizado',
      resultado: resultado,
      dataFinalizacao: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Logs
    try {
      const tNome = torneioAtual.nome || 'Torneio';
      if (ranking[0] && premio1 > 0) await logAtividade(ranking[0].odId, 'premio_torneio', premio1, null, `Torneio: 🥇 1º lugar — ${tNome}`, { torneioId, posicao: 1 });
      if (ranking[1] && premio2 > 0) await logAtividade(ranking[1].odId, 'premio_torneio', premio2, null, `Torneio: 🥈 2º lugar — ${tNome}`, { torneioId, posicao: 2 });
      if (ranking[2] && premio3 > 0) await logAtividade(ranking[2].odId, 'premio_torneio', premio3, null, `Torneio: 🥉 3º lugar — ${tNome}`, { torneioId, posicao: 3 });
    } catch(logErr) { console.error('⚠️ Log torneio:', logErr.message); }

    console.log(`🏆 Torneio ${torneioId} finalizado! Prêmios: ${premio1}/${premio2}/${premio3}`);
    return { success: true, resultado: resultado };

  } catch (error) {
    console.error('❌ Erro ao finalizar torneio:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao finalizar torneio');
  }
});

// =====================================================
// FUNÇÃO: CREDITAR INDICAÇÃO
// Dá 2 créditos bônus ao indicador quando indicado se cadastra
// =====================================================

exports.creditarIndicacao = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const novoUserId = context.auth.uid;
  const { indicadorId } = data;

  if (!indicadorId) {
    throw new functions.https.HttpsError('invalid-argument', 'indicadorId é obrigatório');
  }

  // Evitar que alguém se auto-indique
  if (indicadorId === novoUserId) {
    throw new functions.https.HttpsError('failed-precondition', 'Não pode se auto-indicar');
  }

  try {
    // Verificar se indicador existe
    const indicadorDoc = await db.collection('usuarios').doc(indicadorId).get();
    if (!indicadorDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Indicador não encontrado');
    }

    // ✅ SEGURANÇA: Verificar se o novo usuário realmente tem este indicador registrado
    const novoUserDoc = await db.collection('usuarios').doc(novoUserId).get();
    if (!novoUserDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Usuário novo não encontrado');
    }
    const novoUserData = novoUserDoc.data();
    const indicadorData = indicadorDoc.data();
    
    if (novoUserData.indicadoPor !== indicadorId && novoUserData.codigoUsado !== indicadorId) {
      // Verificar também pelo código de indicação
      if (novoUserData.indicadoPor !== indicadorData.codigoIndicacao && 
          novoUserData.codigoUsado !== indicadorData.codigoIndicacao) {
        throw new functions.https.HttpsError('failed-precondition', 
          'Este usuário não foi indicado por este indicador');
      }
    }

    // Verificar se já foi creditado (evitar duplicidade)
    if (indicadorData.indicados && indicadorData.indicados[novoUserId]) {
      return { success: true, jaCreditado: true };
    }

    const batch = db.batch();

    // Creditar indicador
    const indicadorRef = db.collection('usuarios').doc(indicadorId);
    batch.update(indicadorRef, {
      creditos: admin.firestore.FieldValue.increment(2),
      creditosBonus: admin.firestore.FieldValue.increment(2),
      [`indicados.${novoUserId}`]: {
        nome: novoUserDoc.data().usuarioUnico || novoUserDoc.data().nome || 'Novo Usuário',
        data: new Date().toISOString()
      }
    });

    // Transação
    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: indicadorId,
      tipo: 'credito',
      valor: 2,
      descricao: 'Bônus de indicação',
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    const saldoIndicador = indicadorData.creditos || 0;
    await logAtividade(indicadorId, 'indicacao', 2, saldoIndicador,
      `Indicação: bônus por indicar ${novoUserDoc.data().usuarioUnico || 'novo usuário'}`,
      { novoUserId });

    console.log(`✅ Indicador ${indicadorId} creditado com 2 créditos por indicar ${novoUserId}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Erro ao creditar indicação:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao creditar indicação');
  }
});

// =====================================================
// FUNÇÃO: CREDITAR COMPRA
// Adiciona créditos após confirmação de pagamento
// =====================================================

// =====================================================
// [DESATIVADO] FUNÇÃO: CREDITAR COMPRA DE CRÉDITOS
// 🚫 DESATIVADO POR SEGURANÇA — Não verifica pagamento real com MP
// Créditos são processados APENAS pelo webhook (api/webhook-mp.js)
// =====================================================
exports.creditarCompra = functions.https.onCall(async (data, context) => {
  // ✅ SEGURANÇA: Função desativada — use o webhook do Mercado Pago
  console.error(`🚫 creditarCompra DESATIVADA chamada por ${context.auth?.uid}`);
  throw new functions.https.HttpsError('failed-precondition', 
    'Esta função foi desativada por segurança. Créditos são processados automaticamente pelo sistema de pagamento.');
});

// =====================================================
// FUNÇÃO: COMPLETAR MISSÃO
// Credita recompensa ao completar uma missão
// =====================================================

exports.completarMissao = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { missaoId } = data;

  if (!missaoId) {
    throw new functions.https.HttpsError('invalid-argument', 'missaoId é obrigatório');
  }

  try {
    // Verificar missão do usuário
    const missaoRef = db.collection('usuarios').doc(userId).collection('missoes').doc(missaoId);
    const missaoDoc = await missaoRef.get();

    if (!missaoDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Missão não encontrada');
    }

    const missaoData = missaoDoc.data();

    // Verificar se realmente está concluída
    if (!missaoData.concluido) {
      throw new functions.https.HttpsError('failed-precondition', 'Missão ainda não foi concluída');
    }

    const creditosRecompensa = missaoData.recompensa?.creditos || 0;

    if (creditosRecompensa <= 0) {
      return { success: true, creditos: 0 };
    }

    // Verificar se já foi creditada (campo creditada)
    if (missaoData.creditada) {
      return { success: true, jaCreditada: true };
    }

    // Ler saldo atual para log
    const userDocMissao = await db.collection('usuarios').doc(userId).get();
    const saldoAntesMissao = userDocMissao.data()?.creditos || 0;

    const batch = db.batch();

    // Creditar usuário
    const userRef = db.collection('usuarios').doc(userId);
    batch.update(userRef, {
      creditos: admin.firestore.FieldValue.increment(creditosRecompensa)
    });

    // Marcar missão como creditada
    batch.update(missaoRef, { creditada: true });

    // Registrar no extrato
    const extratoRef = db.collection('usuarios').doc(userId).collection('extrato').doc();
    batch.set(extratoRef, {
      tipo: 'entrada',
      valor: creditosRecompensa,
      descricao: `Missão: ${missaoData.titulo}`,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    await logAtividade(userId, 'missao', creditosRecompensa, saldoAntesMissao,
      `Missão: ${missaoData.titulo || missaoId}`,
      { missaoId, recompensa: creditosRecompensa });

    console.log(`✅ Missão ${missaoId} creditada para ${userId}: +${creditosRecompensa} créditos`);
    return { success: true, creditos: creditosRecompensa };

  } catch (error) {
    console.error('❌ Erro ao completar missão:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao completar missão');
  }
});


// #####################################################
// #####################################################
//
//   🤖 AUTOMAÇÕES v3.0 (adicionadas, não alteram nada acima)
//
// #####################################################
// #####################################################

// =====================================================
// HELPER: Calcular Nível por XP
// =====================================================
function calcularNivelUsuario(xp) {
  if (xp >= 5000) return { nome: "Mestre", emoji: "💜", threshold: 5000 };
  if (xp >= 3000) return { nome: "Diamante", emoji: "💎", threshold: 3000 };
  if (xp >= 1500) return { nome: "Ouro", emoji: "🥇", threshold: 1500 };
  if (xp >= 500) return { nome: "Prata", emoji: "🥈", threshold: 500 };
  if (xp >= 100) return { nome: "Bronze", emoji: "🥉", threshold: 100 };
  return { nome: "Iniciante", emoji: "🆕", threshold: 0 };
}

// =====================================================
// HELPER: Criar Notificação (dual-write)
// =====================================================
// Escreve na subcollection do usuário (sininho do app)
// E na collection global (compatibilidade com admin/notificacoes)
async function criarNotificacaoHelper(userId, tipo, titulo, corpo, extra = {}) {
  if (!userId || !titulo) return null;
  try {
    const base = {
      titulo,
      corpo: corpo || "",
      lida: false,
      data: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Subcollection do usuário (sininho no app)
    await db.collection("usuarios").doc(userId).collection("notificacoes").add(base);

    // Collection global (compatibilidade admin)
    await db.collection("notificacoes").add({
      para: userId,
      userId,
      tipo,
      titulo,
      mensagem: corpo || "",
      lida: false,
      ...extra,
      data: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`📬 [${tipo}] → ${userId}: ${titulo}`);
    return true;
  } catch (error) {
    console.error("Erro notificação helper:", error);
    return null;
  }
}


// =====================================================
// 🤖 AUTO 1: ATUALIZAR STATUS DOS JOGOS (Cron 1 min)
// =====================================================
// Verifica dataInicio/dataFim e atualiza status automaticamente.
// Não precisa mais abrir jogos.html para atualizar.
exports.atualizarStatusJogos = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    try {
      const agora = new Date();

      // Buscar jogos que NÃO estão finalizados
      const snap = await db
        .collection("jogos")
        .where("status", "in", ["agendado", "ao_vivo"])
        .get();

      if (snap.empty) return null;

      const batch = db.batch();
      let alterados = 0;

      snap.forEach((doc) => {
        const jogo = doc.data();
        const dataInicio = jogo.dataInicio?.toDate
          ? jogo.dataInicio.toDate()
          : new Date(jogo.dataInicio);
        const dataFim = jogo.dataFim?.toDate
          ? jogo.dataFim.toDate()
          : new Date(jogo.dataFim);

        let novoStatus;
        if (agora < dataInicio) {
          novoStatus = "agendado";
        } else if (agora >= dataInicio && agora <= dataFim) {
          novoStatus = "ao_vivo";
        } else {
          novoStatus = "finalizado";
        }

        if (novoStatus !== jogo.status) {
          batch.update(doc.ref, { status: novoStatus });
          alterados++;
          console.log(`🎮 ${doc.id}: ${jogo.status} → ${novoStatus}`);
        }
      });

      if (alterados > 0) {
        await batch.commit();
        console.log(`⏱️ ${alterados} jogos atualizados automaticamente`);
      }

      return null;
    } catch (error) {
      console.error("Erro atualizarStatusJogos:", error);
      return null;
    }
  });


// =====================================================
// 🤖 AUTO 3: FINALIZAR TORNEIOS AUTOMATICAMENTE (Cron 5 min)
// =====================================================
// Busca torneios com status 'ativo' cuja dataFim já passou e finaliza.
exports.finalizarTorneiosAutomatico = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    try {
      const agora = admin.firestore.Timestamp.now();

      // Buscar torneios ativos com dataFim no passado
      const snap = await db.collection('torneios')
        .where('status', 'in', ['ativo', 'em_andamento'])
        .get();

      if (snap.empty) return null;

      let finalizados = 0;
      for (const doc of snap.docs) {
        const torneio = doc.data();

        // Verificar se dataFim já passou
        const dataFim = torneio.dataFim || torneio.dataEncerramento;
        if (!dataFim) continue;

        const dataFimDate = dataFim.toDate ? dataFim.toDate() : new Date(dataFim);
        if (dataFimDate > new Date()) continue; // Ainda não terminou

        // Já finalizado?
        if (torneio.status === 'finalizado' && torneio.resultado) continue;

        try {
          await _finalizarTorneioInterno(doc.id, torneio);
          finalizados++;
        } catch (e) {
          console.error(`❌ Erro auto-finalizar torneio ${doc.id}:`, e);
        }
      }

      if (finalizados > 0) {
        console.log(`🏆 ${finalizados} torneios finalizados automaticamente`);
      }
      return null;
    } catch (error) {
      console.error("Erro finalizarTorneiosAutomatico:", error);
      return null;
    }
  });

/**
 * HELPER INTERNO: Lógica de finalização de torneio
 * Usado pelo scheduler automático e pelo onCall manual
 */
async function _finalizarTorneioInterno(torneioId, torneio) {
  // Já finalizado? Skip
  if (torneio.status === 'finalizado' && torneio.resultado) {
    return { success: true, jaFinalizado: true, resultado: torneio.resultado };
  }

  // Ranking
  const partsSnap = await db.collection('torneios').doc(torneioId)
    .collection('participacoes').orderBy('pontos', 'desc').get();

  let ranking = [];
  partsSnap.forEach(doc => ranking.push({ odId: doc.id, ...doc.data() }));

  // Prêmio do SISTEMA
  const numInscritos = ranking.length;
  const premioTotal = Math.min(
    CONFIG_TORNEIO.premioBase + (numInscritos * CONFIG_TORNEIO.premioPorInscrito),
    CONFIG_TORNEIO.premioMax
  );

  const dist = torneio.config?.distribuicaoPremio || CONFIG_TORNEIO.distribuicao;
  const premio1 = Math.floor(premioTotal * dist.primeiro / 100);
  const premio2 = Math.floor(premioTotal * dist.segundo / 100);
  const premio3 = Math.floor(premioTotal * dist.terceiro / 100);

  const resultado = {
    modeloV2: true, fontePremio: 'sistema', premioTotal,
    primeiro: ranking[0] ? { odId: ranking[0].odId, odNome: ranking[0].odNome, pontos: ranking[0].pontos, premio: premio1 } : null,
    segundo: ranking[1] ? { odId: ranking[1].odId, odNome: ranking[1].odNome, pontos: ranking[1].pontos, premio: premio2 } : null,
    terceiro: ranking[2] ? { odId: ranking[2].odId, odNome: ranking[2].odNome, pontos: ranking[2].pontos, premio: premio3 } : null,
    ranking: ranking.map((r, i) => ({
      posicao: i + 1, odId: r.odId, odNome: r.odNome,
      pontos: r.pontos || 0, acertos: r.acertos || 0
    }))
  };

  const batch = db.batch();

  // Premiar top 3
  const premios = [
    { pos: 0, premio: premio1, campo: 'torneios.vitorias' },
    { pos: 1, premio: premio2, campo: 'torneios.top3' },
    { pos: 2, premio: premio3, campo: 'torneios.top3' }
  ];

  for (const p of premios) {
    if (ranking[p.pos] && p.premio > 0) {
      batch.update(db.collection('usuarios').doc(ranking[p.pos].odId), {
        creditos: admin.firestore.FieldValue.increment(p.premio),
        [p.campo]: admin.firestore.FieldValue.increment(1),
        'torneios.creditosGanhos': admin.firestore.FieldValue.increment(p.premio),
        'torneios.totalTorneios': admin.firestore.FieldValue.increment(1)
      });
      const emoji = ['🥇', '🥈', '🥉'][p.pos];
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: ranking[p.pos].odId, tipo: 'credito', valor: p.premio,
        descricao: `${emoji} ${p.pos + 1}º lugar — ${torneio.nome || 'Torneio'}`,
        torneioId, modeloV2: true, fontePremio: 'sistema',
        data: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  batch.update(db.collection('torneios').doc(torneioId), {
    status: 'finalizado', resultado, modeloV2: true, fontePremio: 'sistema',
    dataFinalizacao: admin.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();

  // Logs
  try {
    const tNome = torneio.nome || 'Torneio';
    if (ranking[0] && premio1 > 0) await logAtividade(ranking[0].odId, 'premio_torneio_v2', premio1, null, `Torneio v2: 🥇 1º — ${tNome}`, { torneioId, fontePremio: 'sistema' });
    if (ranking[1] && premio2 > 0) await logAtividade(ranking[1].odId, 'premio_torneio_v2', premio2, null, `Torneio v2: 🥈 2º — ${tNome}`, { torneioId, fontePremio: 'sistema' });
    if (ranking[2] && premio3 > 0) await logAtividade(ranking[2].odId, 'premio_torneio_v2', premio3, null, `Torneio v2: 🥉 3º — ${tNome}`, { torneioId, fontePremio: 'sistema' });
  } catch(e) { /* log não bloqueia */ }

  console.log(`🏆 Torneio v2 ${torneioId} finalizado! Sistema: ${premioTotal} cr (${premio1}/${premio2}/${premio3})`);
  return { success: true, resultado };
}


// =====================================================
// 🤖 AUTO 2: BEM-VINDO AO NOVO USUÁRIO (Trigger)
// =====================================================
// Dispara quando um documento é criado em 'usuarios'
exports.bemVindoNovoUsuario = functions.firestore
  .document("usuarios/{userId}")
  .onCreate(async (snap, context) => {
    const userId = context.params.userId;
    const userData = snap.data();
    const nome =
      userData.nome || userData.usuario || userData.usuarioUnico || "Jogador";

    console.log(`🎉 Novo usuário: ${nome} (${userId})`);

    // ==========================================
    // FASE 0: Inicializar campos da reestruturação v2
    // ==========================================
    try {
      const camposNovos = {};

      // Passe (Free por padrão)
      if (!userData.passe) {
        camposNovos.passe = CAMPOS_PADRAO_USUARIO.passe;
      }

      // Limites diários
      if (!userData.limitesDiarios) {
        camposNovos.limitesDiarios = {
          ...CAMPOS_PADRAO_USUARIO.limitesDiarios,
          ultimoReset: admin.firestore.FieldValue.serverTimestamp()
        };
      }

      // Rating
      if (userData.rating === undefined) {
        camposNovos.rating = 0;
        camposNovos.ratingFaixa = 'Reserva';
        camposNovos.ratingVariacao = 0;
        camposNovos.ratingComponents = CAMPOS_PADRAO_USUARIO.ratingComponents;
        camposNovos.ratingHistory = [];
      }

      // Stats (para cálculo de rating)
      if (!userData.stats) {
        camposNovos.stats = CAMPOS_PADRAO_USUARIO.stats;
      }

      // Créditos iniciais de boas-vindas (50 créditos grátis)
      if (userData.creditos === undefined) {
        camposNovos.creditos = 50;
      }

      if (Object.keys(camposNovos).length > 0) {
        await db.collection('usuarios').doc(userId).update(camposNovos);
        console.log(`📦 Campos v2 inicializados para ${userId}:`, Object.keys(camposNovos));
      }
    } catch (e) {
      console.error('⚠️ Erro ao inicializar campos v2:', e.message);
      // Não bloqueia o fluxo
    }

    await criarNotificacaoHelper(
      userId,
      "sistema",
      "🎉 Bem-vindo ao Yellup!",
      `Olá ${nome}! Você ganhou 50 créditos de boas-vindas. Comece jogando e acumulando XP! ⚽`
    );

    // Se tem código de indicação, notificar quem indicou
    const codigoUsado = userData.indicadoPor || userData.codigoUsado;
    if (codigoUsado) {
      try {
        const indicadorSnap = await db
          .collection("usuarios")
          .where("codigoIndicacao", "==", codigoUsado)
          .limit(1)
          .get();

        if (!indicadorSnap.empty) {
          const indicadorId = indicadorSnap.docs[0].id;
          await criarNotificacaoHelper(
            indicadorId,
            "indicacao",
            "🔗 Nova indicação!",
            `${nome} se cadastrou usando seu código de indicação!`
          );
        }
      } catch (e) {
        console.error("Erro notificar indicador:", e);
      }
    }

    return null;
  });


// =====================================================
// 🤖 AUTO 3: VERIFICAR SUBIDA DE NÍVEL (Trigger)
// =====================================================
// Dispara quando 'usuarios/{userId}' é atualizado.
// Compara XP anterior com novo para detectar subida de nível.
exports.verificarNivel = functions.firestore
  .document("usuarios/{userId}")
  .onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const antes = change.before.data();
    const depois = change.after.data();

    const xpAntes = antes.xp || antes.pontuacao || 0;
    const xpDepois = depois.xp || depois.pontuacao || 0;

    // Só processar se XP aumentou
    if (xpDepois <= xpAntes) return null;

    const nivelAntes = calcularNivelUsuario(xpAntes);
    const nivelDepois = calcularNivelUsuario(xpDepois);

    // Subiu de nível?
    if (nivelDepois.threshold > nivelAntes.threshold) {
      const nome = depois.nome || depois.usuarioUnico || "Jogador";
      console.log(
        `⬆️ ${nome} subiu para ${nivelDepois.emoji} ${nivelDepois.nome} (${xpDepois} XP)`
      );

      await criarNotificacaoHelper(
        userId,
        "nivel",
        `${nivelDepois.emoji} Subiu de Nível!`,
        `Parabéns ${nome}! Você alcançou o nível ${nivelDepois.nome} com ${xpDepois.toLocaleString()} XP!`
      );

      // Atualizar campo de nível no documento (útil para queries)
      await db.collection("usuarios").doc(userId).update({
        nivel: nivelDepois.nome.toLowerCase(),
      });
    }

    return null;
  });


// =====================================================
// 🤖 AUTO 4: LIMPAR NOTIFICAÇÕES ANTIGAS (Cron 3h)
// =====================================================
// Remove notificações lidas com mais de 30 dias.
exports.limparNotificacoes = functions.pubsub
  .schedule("every day 03:00")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    try {
      const trintaDiasAtras = new Date();
      trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
      const timestamp30 = admin.firestore.Timestamp.fromDate(trintaDiasAtras);

      // Limpar collection global
      const snap = await db
        .collection("notificacoes")
        .where("lida", "==", true)
        .where("data", "<", timestamp30)
        .limit(500)
        .get();

      if (snap.empty) {
        console.log("🧹 Nenhuma notificação antiga para limpar");
        return null;
      }

      const batch = db.batch();
      snap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      console.log(`🧹 ${snap.size} notificações antigas removidas`);
      return null;
    } catch (error) {
      console.error("Erro limparNotificacoes:", error);
      return null;
    }
  });

// =============================================
// 🔒 RESPONDER PERGUNTA (SERVER-SIDE VALIDATION)
// =============================================
// O client NUNCA recebe a resposta correta antes de responder.
// Valida tudo server-side: resposta, créditos, pontos, streak.
exports.responderPergunta = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado");
  }

  const uid = context.auth.uid;
  const { jogoId, perguntaId, resposta, tempoResposta } = data;

  if (!jogoId || !perguntaId || !resposta) {
    throw new functions.https.HttpsError("invalid-argument", "Dados incompletos");
  }

  const tempoRespostaSegundos = Math.min(Math.max(parseFloat(tempoResposta) || 10, 0), 15);

  try {
    // 1. Buscar pergunta (server-side - seguro)
    const perguntaDoc = await db.collection("perguntas").doc(perguntaId).get();
    if (!perguntaDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Pergunta não encontrada");
    }

    const pergunta = perguntaDoc.data();
    const correta = (pergunta.correta || "").toLowerCase();
    const respostaUser = (resposta || "").toLowerCase();
    const pontuacaoBase = pergunta.pontuacao || pergunta.pontos || 10;

    // 2. Buscar dados do jogo
    const jogoDoc = await db.collection("jogos").doc(jogoId).get();
    if (!jogoDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Jogo não encontrado");
    }

    const jogo = jogoDoc.data();

    // 3. Verificar se o jogo está ao vivo
    const agora = new Date();
    const inicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio || 0);
    const fim = jogo.dataFim?.toDate?.() || null;

    if (agora < inicio) {
      throw new functions.https.HttpsError("failed-precondition", "Jogo ainda não começou");
    }
    if (fim && agora > fim) {
      throw new functions.https.HttpsError("failed-precondition", "Jogo já encerrado");
    }

    // 4. Buscar dados do usuário
    const userDoc = await db.collection("usuarios").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const timeTorcida = userData.torcidas?.[jogoId];

    if (!timeTorcida) {
      throw new functions.https.HttpsError("failed-precondition", "Usuário não está torcendo neste jogo");
    }

    // 5. Verificar se já respondeu esta pergunta (anti-replay)
    const perguntasRespondidas = userData[`perguntasRespondidas_${timeTorcida}`] || [];
    if (perguntasRespondidas.includes(perguntaId)) {
      throw new functions.https.HttpsError("already-exists", "Pergunta já respondida");
    }

    // 6. Verificar créditos
    const jogadasPorJogo = userData.jogadasGratisPorJogo || {};
    const jogadasUsadas = jogadasPorJogo[jogoId] || 0;
    const temGratis = jogadasUsadas < 5;
    const creditosTotal = userData.creditos || 0;

    if (!temGratis && creditosTotal <= 0) {
      throw new functions.https.HttpsError("resource-exhausted", "Sem créditos");
    }

    // 7. Verificar resposta (TIMEOUT = sempre errado)
    const acertou = respostaUser === correta;

    // 8. Calcular streak e multiplicador SERVER-SIDE
    const participanteRef = db.collection("jogos").doc(jogoId).collection("participantes").doc(uid);
    const participanteDoc = await participanteRef.get();
    const participante = participanteDoc.exists ? participanteDoc.data() : {};

    let streakAtual = participante.streakAtual || 0;
    let maxStreakVal = participante.maxStreak || 0;

    if (acertou) {
      streakAtual += 1;
      if (streakAtual > maxStreakVal) maxStreakVal = streakAtual;
    } else {
      streakAtual = 0;
    }

    // Multiplicador baseado no streak
    let multiplicador = 1;
    if (streakAtual >= 10) multiplicador = 3;
    else if (streakAtual >= 5) multiplicador = 2;
    else if (streakAtual >= 3) multiplicador = 1.5;

    const pontosFinais = acertou ? Math.round(pontuacaoBase * multiplicador) : 0;

    // 9. Atualizar tudo em batch (atômico)
    const batch = db.batch();
    const userRef = db.collection("usuarios").doc(uid);

    const userUpdates = {
      [`perguntasRespondidas_${timeTorcida}`]: admin.firestore.FieldValue.arrayUnion(perguntaId)
    };

    // Descontar crédito ou jogada grátis
    if (temGratis) {
      userUpdates[`jogadasGratisPorJogo.${jogoId}`] = admin.firestore.FieldValue.increment(1);
    } else {
      userUpdates.creditos = admin.firestore.FieldValue.increment(-1);
      // Pool do jogo
      batch.update(db.collection("jogos").doc(jogoId), {
        poolCreditos: admin.firestore.FieldValue.increment(1)
      });
    }

    // Pontos e XP se acertou
    if (acertou) {
      userUpdates[`pontuacoes.${jogoId}`] = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates.xp = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates[`tempoRespostas.${jogoId}.soma`] = admin.firestore.FieldValue.increment(tempoRespostaSegundos);
      userUpdates[`tempoRespostas.${jogoId}.quantidade`] = admin.firestore.FieldValue.increment(1);
    }

    batch.update(userRef, userUpdates);

    // Atualizar participante
    const acertos = (participante.acertos || 0) + (acertou ? 1 : 0);
    const erros = (participante.erros || 0) + (acertou ? 0 : 1);

    // Buscar nome do time ANTES do batch.set
    let timeNome = participante.timeNome || "Time";
    try {
      const timeDoc = await db.collection("times").doc(timeTorcida).get();
      if (timeDoc.exists) timeNome = timeDoc.data().nome || "Time";
    } catch (e) { /* não crítico */ }

    batch.set(participanteRef, {
      odId: uid,
      nome: userData.usuarioUnico || userData.usuario || userData.nome || "Anônimo",
      timeId: timeTorcida,
      timeNome: timeNome,
      pontos: (participante.pontos || 0) + pontosFinais,
      acertos,
      erros,
      streakAtual,
      maxStreak: maxStreakVal,
      tempoSoma: (participante.tempoSoma || 0) + (acertou ? tempoRespostaSegundos : 0),
      tempoQuantidade: (participante.tempoQuantidade || 0) + (acertou ? 1 : 0),
      tempoMedio: acertou
        ? ((participante.tempoSoma || 0) + tempoRespostaSegundos) / ((participante.tempoQuantidade || 0) + 1)
        : participante.tempoMedio || 0,
      atualizadoEm: admin.firestore.Timestamp.now()
    }, { merge: true });

    await batch.commit();

    // 10. Retornar resultado (resposta correta só é revelada DEPOIS de registrar)
    return {
      acertou,
      respostaCorreta: pergunta.correta,
      respostaTexto: pergunta.alternativas?.[pergunta.correta] || "",
      pontosGanhos: pontosFinais,
      pontuacaoBase,
      multiplicador,
      streak: streakAtual,
      maxStreak: maxStreakVal,
      jogadasGratisRestantes: temGratis ? Math.max(0, 4 - jogadasUsadas) : 0,
      creditosRestantes: temGratis ? creditosTotal : Math.max(0, creditosTotal - 1)
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error("Erro responderPergunta:", error);
    throw new functions.https.HttpsError("internal", "Erro interno ao processar resposta");
  }
});


// =====================================================
// 🔄 FASE 2: PvP v2 — EMBATES COM TAXA QUEIMADA + PRÊMIO DO SISTEMA
// =====================================================

/**
 * CRIAR EMBATE v2 — Taxa de entrada é QUEIMADA (não vai pro pool)
 * Prêmio vem do SISTEMA, não dos jogadores
 */
exports.criarEmbateV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { embateId } = data;

  if (!embateId) {
    throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');
  }

  const taxaEntrada = CONFIG_PVP.taxaEntrada; // FIXO: 2 créditos

  try {
    // Verificar limite diário de PvP
    const limite = await verificarLimiteDiario(uid, 'pvp');
    if (!limite.permitido) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Limite diário de PvP atingido (${limite.limite}/${limite.limite}). ${limite.tipoPasse === 'free' ? 'Adquira um Passe para jogar ilimitado!' : ''}`);
    }

    // Verificar embate
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) throw new functions.https.HttpsError('not-found', 'Embate não encontrado');

    const embate = embateDoc.data();
    if (embate.criadorId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Você não é o criador deste embate');
    }

    // Anti-duplicidade
    const transExistente = await db.collection('transacoes')
      .where('usuarioId', '==', uid)
      .where('embateId', '==', embateId)
      .where('tipo', '==', 'debito')
      .limit(1).get();
    if (!transExistente.empty) return { success: true, mensagem: 'Créditos já debitados' };

    // Verificar créditos
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const creditos = userDoc.data()?.creditos || 0;
    if (creditos < taxaEntrada) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Créditos insuficientes. Precisa: ${taxaEntrada}, Tem: ${creditos}`);
    }

    const batch = db.batch();

    // QUEIMAR taxa (não vai pro pool — vai pro nada)
    batch.update(db.collection('usuarios').doc(uid), {
      creditos: admin.firestore.FieldValue.increment(-taxaEntrada)
    });

    // Marcar embate como v2 (prêmio dinâmico do sistema)
    batch.update(db.collection('embates').doc(embateId), {
      modeloV2: true,
      taxaEntrada: taxaEntrada,
      premioMultiplicador: CONFIG_PVP.premioMultiplicador,
      // NÃO tem prizePool — prêmio = multiplicador × participantes
    });

    // Transação
    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: uid,
      tipo: 'debito',
      valor: taxaEntrada,
      descricao: `Taxa de entrada: embate ${embate.codigo || embateId}`,
      embateId, modeloV2: true,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // Incrementar limite diário
    await incrementarLimiteDiario(uid, 'pvp');

    // Log
    await logAtividade(uid, 'debito_pvp_v2', -taxaEntrada, creditos,
      `PvP v2: taxa entrada embate ${embate.codigo || embateId}`,
      { embateId, taxaEntrada, modeloV2: true });

    console.log(`✅ Embate v2 criado: ${uid} queimou ${taxaEntrada} cr (prêmio: ${CONFIG_PVP.premioMultiplicador}×participantes)`);

    return {
      success: true,
      mensagem: `Taxa cobrada: ${taxaEntrada} créditos. Prêmio: ${CONFIG_PVP.premioMultiplicador} créditos por participante!`,
      taxaEntrada,
      premioMultiplicador: CONFIG_PVP.premioMultiplicador
    };

  } catch (error) {
    console.error('❌ Erro criarEmbateV2:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao criar embate');
  }
});

/**
 * ACEITAR EMBATE v2 — Taxa queimada + verificação de limite
 */
exports.aceitarEmbateV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { embateId } = data;

  if (!embateId) throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');

  try {
    // Verificar limite
    const limite = await verificarLimiteDiario(uid, 'pvp');
    if (!limite.permitido) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Limite diário de PvP atingido. ${limite.tipoPasse === 'free' ? 'Adquira um Passe para jogar ilimitado!' : ''}`);
    }

    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    const embate = embateDoc.data();

    if (embate.status !== 'aguardando') {
      throw new functions.https.HttpsError('failed-precondition', 'Embate não está aguardando');
    }
    if ((embate.participantes || []).includes(uid)) {
      throw new functions.https.HttpsError('already-exists', 'Já está neste embate');
    }

    const taxaEntrada = CONFIG_PVP.taxaEntrada; // FIXO: 2 créditos

    // Verificar créditos
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const creditos = userDoc.data()?.creditos || 0;
    if (creditos < taxaEntrada) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Créditos insuficientes. Precisa: ${taxaEntrada}, Tem: ${creditos}`);
    }

    // Anti-duplicidade
    const transExistente = await db.collection('transacoes')
      .where('usuarioId', '==', uid).where('embateId', '==', embateId)
      .where('tipo', '==', 'debito').limit(1).get();
    if (!transExistente.empty) return { success: true, mensagem: 'Créditos já debitados' };

    const batch = db.batch();

    // QUEIMAR taxa (créditos somem da economia)
    batch.update(db.collection('usuarios').doc(uid), {
      creditos: admin.firestore.FieldValue.increment(-taxaEntrada)
    });

    // Atualizar embate (participantes, sem prizePool)
    batch.update(db.collection('embates').doc(embateId), {
      participantes: admin.firestore.FieldValue.arrayUnion(uid),
      totalParticipantes: admin.firestore.FieldValue.increment(1)
    });

    // Transação
    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: uid, tipo: 'debito', valor: taxaEntrada,
      descricao: `Taxa de entrada: embate ${embate.codigo || embateId}`,
      embateId, modeloV2: true,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    await incrementarLimiteDiario(uid, 'pvp');

    await logAtividade(uid, 'debito_pvp_v2', -taxaEntrada, creditos,
      `PvP v2: entrou no embate ${embate.codigo || embateId}`,
      { embateId, taxaEntrada });

    // Registrar rival único nas stats
    try {
      const oponente = embate.criadorId;
      if (oponente && oponente !== uid) {
        await db.collection('usuarios').doc(uid).update({
          'stats.rivaisUnicos': admin.firestore.FieldValue.arrayUnion(oponente)
        });
      }
    } catch (e) { /* não crítico */ }

    console.log(`✅ Embate v2 aceito: ${uid} entrou (-${taxaEntrada} cr)`);
    return { success: true, mensagem: `Entrada confirmada! -${taxaEntrada} créditos`, taxaEntrada };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro aceitarEmbateV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao aceitar embate');
  }
});

/**
 * FINALIZAR EMBATE v2 — Prêmio do SISTEMA = 4 créditos × nº participantes
 */
exports.finalizarEmbateV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const { embateId } = data;
  if (!embateId) throw new functions.https.HttpsError('invalid-argument', 'embateId obrigatório');

  try {
    const embateDoc = await db.collection('embates').doc(embateId).get();
    if (!embateDoc.exists) throw new functions.https.HttpsError('not-found', 'Embate não encontrado');
    const embate = embateDoc.data();

    // ✅ SEGURANÇA: Apenas participantes podem finalizar
    const uid = context.auth.uid;
    const isParticipante = (embate.participantes || []).includes(uid) || 
                           embate.criadorId === uid || 
                           embate.adversarioId === uid;
    if (!isParticipante) {
      throw new functions.https.HttpsError('permission-denied', 'Apenas participantes podem finalizar o embate');
    }

    if (!['em_andamento', 'respondendo', 'finalizando'].includes(embate.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Embate não pode ser finalizado');
    }
    if (embate.resultado && embate.status === 'finalizado') {
      return { success: true, mensagem: 'Já finalizado', resultado: embate.resultado };
    }

    // Buscar participações
    const participacoesSnap = await db.collection('embates').doc(embateId)
      .collection('participacoes').get();

    let ranking = [];
    participacoesSnap.forEach(doc => {
      ranking.push({ odId: doc.id, ...doc.data() });
    });
    ranking.sort((a, b) => (b.pontos || 0) - (a.pontos || 0));

    // PRÊMIO DINÂMICO DO SISTEMA: 4 créditos × número de participantes
    const multiplicador = embate.premioMultiplicador || CONFIG_PVP.premioMultiplicador;
    const numParticipantes = ranking.length || (embate.totalParticipantes || 1);
    const premio = multiplicador * numParticipantes;

    let resultado = {};
    const batch = db.batch();

    if (ranking.length > 0) {
      const maiorPontuacao = ranking[0].pontos || 0;
      const vencedores = ranking.filter(r => (r.pontos || 0) === maiorPontuacao);
      const empate = vencedores.length > 1;

      resultado = {
        vencedorId: empate ? null : vencedores[0].odId,
        vencedorNome: empate ? null : (vencedores[0].odNome || ''),
        pontuacaoVencedor: maiorPontuacao,
        empate, modeloV2: true,
        premioTotal: premio,
        premioMultiplicador: multiplicador,
        numParticipantes,
        vencedoresEmpate: empate ? vencedores.map(v => v.odId) : null,
        ranking: ranking.map((r, i) => ({
          posicao: i + 1, odId: r.odId, odNome: r.odNome || '',
          pontos: r.pontos || 0, acertos: r.acertos || 0, erros: r.erros || 0
        }))
      };

      if (empate) {
        const premioPorJogador = Math.floor(premio / vencedores.length);
        for (const v of vencedores) {
          batch.update(db.collection('usuarios').doc(v.odId), {
            creditos: admin.firestore.FieldValue.increment(premioPorJogador),
            'pvp.vitorias': admin.firestore.FieldValue.increment(1),
            'pvp.creditosGanhos': admin.firestore.FieldValue.increment(premioPorJogador),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1),
            'stats.totalPvpVitorias': admin.firestore.FieldValue.increment(1),
            'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
          });
          const transRef = db.collection('transacoes').doc();
          batch.set(transRef, {
            usuarioId: v.odId, tipo: 'credito', valor: premioPorJogador,
            descricao: `🏆 Prêmio Yellup: embate ${embate.codigo || embateId} (+${premioPorJogador} cr)`,
            embateId, modeloV2: true, fontePremio: 'sistema',
            data: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        // Perdedores
        for (const p of ranking.filter(r => (r.pontos || 0) < maiorPontuacao)) {
          batch.update(db.collection('usuarios').doc(p.odId), {
            'pvp.derrotas': admin.firestore.FieldValue.increment(1),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1),
            'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
          });
        }
      } else {
        const vencedor = vencedores[0];
        batch.update(db.collection('usuarios').doc(vencedor.odId), {
          creditos: admin.firestore.FieldValue.increment(premio),
          'pvp.vitorias': admin.firestore.FieldValue.increment(1),
          'pvp.creditosGanhos': admin.firestore.FieldValue.increment(premio),
          'pvp.totalEmbates': admin.firestore.FieldValue.increment(1),
          'stats.totalPvpVitorias': admin.firestore.FieldValue.increment(1),
          'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
        });
        const transRef = db.collection('transacoes').doc();
        batch.set(transRef, {
          usuarioId: vencedor.odId, tipo: 'credito', valor: premio,
          descricao: `🏆 Prêmio Yellup: embate ${embate.codigo || embateId} (+${premio} cr)`,
          embateId, modeloV2: true, fontePremio: 'sistema',
          data: admin.firestore.FieldValue.serverTimestamp()
        });
        // Perdedores
        for (const p of ranking.slice(1)) {
          batch.update(db.collection('usuarios').doc(p.odId), {
            'pvp.derrotas': admin.firestore.FieldValue.increment(1),
            'pvp.totalEmbates': admin.firestore.FieldValue.increment(1),
            'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
          });
        }
      }
    }

    // Finalizar embate
    batch.update(db.collection('embates').doc(embateId), {
      status: 'finalizado', resultado,
      modeloV2: true, fontePremio: 'sistema',
      premioTotal: premio,
      dataFinalizacao: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    console.log(`✅ Embate v2 ${embateId} finalizado. ${numParticipantes} participantes × ${multiplicador} = ${premio} cr`);
    return { success: true, resultado, premio, numParticipantes, fontePremio: 'sistema' };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro finalizarEmbateV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao finalizar embate');
  }
});


// =====================================================
// 🔄 FASE 3: QUIZ/PARTIDAS v2
// Timer-based, sem custo de crédito, prêmio do sistema
// =====================================================

/**
 * ENTRAR NA PARTIDA v2 — Verifica limite diário + registra entrada
 * Client chama ANTES de começar a responder perguntas de um jogo
 */
exports.entrarPartidaV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { jogoId, timeId } = data;

  if (!jogoId || !timeId) {
    throw new functions.https.HttpsError('invalid-argument', 'jogoId e timeId obrigatórios');
  }

  try {
    // 1. Verificar se o jogo existe e está ativo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');

    const jogo = jogoDoc.data();
    const agora = new Date();
    const inicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio || 0);
    const fim = jogo.dataFim?.toDate?.() || null;

    if (agora < inicio) throw new functions.https.HttpsError('failed-precondition', 'Jogo ainda não começou');
    if (fim && agora > fim) throw new functions.https.HttpsError('failed-precondition', 'Jogo já encerrado');

    // 2. Buscar passe do usuário
    const passe = await verificarPasse(uid);
    const temPasse = passe.temPasse;
    const cooldown = temPasse ? CONFIG_QUIZ.cooldownPasse : CONFIG_QUIZ.cooldownFree;

    // 3. Verificar se já está participando deste jogo
    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    const participanteDoc = await participanteRef.get();

    if (participanteDoc.exists && participanteDoc.data().entradaEm) {
      // Já entrou COM cooldown v2 — calcular estado atual do quiz
      const p = participanteDoc.data();
      const entradaEm = p.entradaEm.toDate();
      const elapsed = (agora.getTime() - entradaEm.getTime()) / 1000;
      const ciclosPassados = Math.floor(elapsed / cooldown);
      const totalDisponivel = CONFIG_QUIZ.perguntasIniciais + (ciclosPassados * CONFIG_QUIZ.perguntasPorCiclo) + ((p.skipsUsados || 0) * CONFIG_QUIZ.perguntasPorSkip);
      const respondidas = p.totalRespondidas || 0;
      const disponivelAgora = Math.max(0, totalDisponivel - respondidas);
      const proximoCicloEm = entradaEm.getTime() + ((ciclosPassados + 1) * cooldown * 1000);
      const segParaProximo = Math.max(0, Math.ceil((proximoCicloEm - agora.getTime()) / 1000));

      return {
        success: true, jaEntrou: true,
        tipoPasse: passe.tipo,
        cooldownSegundos: cooldown,
        perguntasDisponiveis: disponivelAgora,
        totalRespondidas: respondidas,
        totalDisponivel,
        segParaProximoCiclo: segParaProximo,
        skipsUsados: p.skipsUsados || 0
      };
    }

    // 3b. MIGRAÇÃO: participante existe (jogou antes do v2) mas SEM entradaEm
    // Apenas adicionar campos de cooldown, SEM incrementar limite diário
    if (participanteDoc.exists && !participanteDoc.data().entradaEm) {
      console.log(`🔄 Migrando participante ${uid} para v2 (adicionando entradaEm)`);
      await participanteRef.update({
        entradaEm: admin.firestore.Timestamp.now(),
        totalRespondidas: 0,
        skipsUsados: 0,
        tipoPasse: passe.tipo,
        modeloV2: true,
        atualizadoEm: admin.firestore.Timestamp.now()
      });

      return {
        success: true, jaEntrou: true,
        tipoPasse: passe.tipo,
        cooldownSegundos: cooldown,
        perguntasDisponiveis: CONFIG_QUIZ.perguntasIniciais,
        totalRespondidas: 0,
        totalDisponivel: CONFIG_QUIZ.perguntasIniciais,
        segParaProximoCiclo: cooldown,
        skipsUsados: 0
      };
    }

    // 4. Verificar limite diário de partidas (só para free)
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.data() || {};

    const limite = await verificarLimiteDiario(uid, 'partida');
    if (!limite.permitido) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Limite diário de partidas atingido (${limite.limite}/${limite.limite}). ${limite.tipoPasse === 'free' ? 'Adquira um Passe para jogar ilimitado!' : ''}`);
    }

    // 5. Verificar se o time pertence ao jogo
    if (timeId !== jogo.timeCasaId && timeId !== jogo.timeForaId) {
      throw new functions.https.HttpsError('invalid-argument', 'Time não pertence a este jogo');
    }

    // 6. Registrar entrada + inicializar estado do quiz
    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    batch.update(userRef, {
      [`torcidas.${jogoId}`]: timeId,
      'stats.ultimoLogin': admin.firestore.FieldValue.serverTimestamp()
    });

    // Estado inicial do participante com controle de cooldown
    batch.set(participanteRef, {
      odId: uid,
      nome: userData.usuarioUnico || userData.usuario || userData.nome || 'Anônimo',
      avatarUrl: userData.avatarUrl || userData.avatar || userData.photoURL || '',
      timeId: timeId,
      timeNome: '', // será preenchido na resposta
      pontos: 0,
      acertos: 0,
      erros: 0,
      streakAtual: 0,
      maxStreak: 0,
      tempoSoma: 0,
      tempoQuantidade: 0,
      tempoMedio: 0,
      // === CONTROLE DE COOLDOWN ===
      entradaEm: admin.firestore.Timestamp.now(),  // momento de entrada (âncora do timer)
      totalRespondidas: 0,                           // quantas já respondeu
      skipsUsados: 0,                                // quantos créditos usou pra adiantar
      tipoPasse: passe.tipo,                         // tipo de passe na entrada
      modeloV2: true,
      atualizadoEm: admin.firestore.Timestamp.now()
    }, { merge: true });

    await batch.commit();

    // 7. Incrementar limite diário
    await incrementarLimiteDiario(uid, 'partida');

    console.log(`⚽ ${uid} entrou no jogo ${jogoId} (time: ${timeId}, passe: ${passe.tipo})`);

    return {
      success: true,
      jaEntrou: false,
      tipoPasse: passe.tipo,
      cooldownSegundos: cooldown,
      perguntasDisponiveis: CONFIG_QUIZ.perguntasIniciais,  // 5 iniciais
      totalRespondidas: 0,
      totalDisponivel: CONFIG_QUIZ.perguntasIniciais,
      segParaProximoCiclo: cooldown,  // primeiro ciclo em X segundos
      skipsUsados: 0,
      partidasRestantes: limite.restante - 1
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro entrarPartidaV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao entrar na partida');
  }
});


/**
 * RESPONDER PERGUNTA v2 — Sistema de cooldown por ciclo fixo
 * 
 * Mecânica:
 * - 5 perguntas grátis ao entrar na partida
 * - Depois, +2 a cada ciclo (5min free / 3min passe)
 * - Timer é FIXO (baseado no relógio desde a entrada, não desde a última resposta)
 * - Créditos podem ser usados para adiantar +2 extras (via adiantarPerguntasV2)
 * - Responder NÃO custa créditos
 */
exports.responderPerguntaV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  const uid = context.auth.uid;
  const { jogoId, perguntaId, resposta, tempoResposta } = data;

  if (!jogoId || !perguntaId || !resposta) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos');
  }

  const tempoRespostaSegundos = Math.min(Math.max(parseFloat(tempoResposta) || 10, 0), 15);

  try {
    // 1. Buscar pergunta
    const perguntaDoc = await db.collection('perguntas').doc(perguntaId).get();
    if (!perguntaDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Pergunta não encontrada');
    }

    const pergunta = perguntaDoc.data();
    const correta = (pergunta.correta || '').toLowerCase();
    const respostaUser = (resposta || '').toLowerCase();
    const pontuacaoBase = pergunta.pontuacao || pergunta.pontos || 10;

    // 2. Buscar dados do jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogo = jogoDoc.data();

    // 3. Verificar se o jogo está ao vivo
    const agora = new Date();
    const inicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio || 0);
    const fim = jogo.dataFim?.toDate?.() || null;
    if (agora < inicio) throw new functions.https.HttpsError('failed-precondition', 'Jogo ainda não começou');
    if (fim && agora > fim) throw new functions.https.HttpsError('failed-precondition', 'Jogo já encerrado');

    // 4. Buscar dados do usuário
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const timeTorcida = userData.torcidas?.[jogoId];

    if (!timeTorcida) {
      throw new functions.https.HttpsError('failed-precondition', 'Use entrarPartidaV2 primeiro');
    }

    // 5. Anti-replay: já respondeu esta pergunta?
    const perguntasRespondidas = userData[`perguntasRespondidas_${timeTorcida}`] || [];
    if (perguntasRespondidas.includes(perguntaId)) {
      throw new functions.https.HttpsError('already-exists', 'Pergunta já respondida');
    }

    // 6. COOLDOWN POR CICLO FIXO — calcular perguntas disponíveis
    const passe = await verificarPasse(uid);
    const temPasse = passe.temPasse;
    const cooldown = temPasse ? CONFIG_QUIZ.cooldownPasse : CONFIG_QUIZ.cooldownFree;

    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    let participanteDoc = await participanteRef.get();

    // Auto-criar participante se não existe (nunca bloquear o usuário)
    if (!participanteDoc.exists) {
      console.log(`🔄 Auto-criando participante ${uid} no responderPerguntaV2`);
      const userDoc = await db.collection('usuarios').doc(uid).get();
      const uData = userDoc.exists ? userDoc.data() : {};
      await participanteRef.set({
        odId: uid,
        nome: uData.usuarioUnico || uData.usuario || uData.nome || 'Anônimo',
        timeId: timeTorcida,
        timeNome: '',
        pontos: 0, acertos: 0, erros: 0,
        streakAtual: 0, maxStreak: 0,
        tempoSoma: 0, tempoQuantidade: 0, tempoMedio: 0,
        entradaEm: admin.firestore.Timestamp.now(),
        totalRespondidas: 0, skipsUsados: 0,
        tipoPasse: passe.tipo, modeloV2: true,
        atualizadoEm: admin.firestore.Timestamp.now()
      }, { merge: true });
      participanteDoc = await participanteRef.get();
    }

    // Auto-migração: participante existe mas sem entradaEm (pré-v2)
    if (!participanteDoc.data().entradaEm) {
      console.log(`🔄 Auto-migrando participante ${uid} no responderPerguntaV2`);
      await participanteRef.update({
        entradaEm: admin.firestore.Timestamp.now(),
        totalRespondidas: 0,
        skipsUsados: 0,
        modeloV2: true
      });
      // Recarregar
      const reloaded = await participanteRef.get();
      var participante = reloaded.data();
    } else {
      var participante = participanteDoc.data();
    }
    const entradaEm = participante.entradaEm.toDate();
    const elapsed = (agora.getTime() - entradaEm.getTime()) / 1000;
    const ciclosPassados = Math.floor(elapsed / cooldown);
    const skipsUsados = participante.skipsUsados || 0;
    const totalRespondidas = participante.totalRespondidas || 0;

    // Total de perguntas que o jogador tem direito ATÉ AGORA
    const totalDisponivel = CONFIG_QUIZ.perguntasIniciais 
      + (ciclosPassados * CONFIG_QUIZ.perguntasPorCiclo) 
      + (skipsUsados * CONFIG_QUIZ.perguntasPorSkip);

    if (totalRespondidas >= totalDisponivel) {
      // Sem perguntas disponíveis — calcular quando libera
      const proximoCicloEm = entradaEm.getTime() + ((ciclosPassados + 1) * cooldown * 1000);
      const segParaProximo = Math.max(0, Math.ceil((proximoCicloEm - agora.getTime()) / 1000));
      
      throw new functions.https.HttpsError('resource-exhausted',
        JSON.stringify({
          tipo: 'cooldown',
          segParaProximo,
          cooldown,
          totalRespondidas,
          totalDisponivel,
          tipoPasse: passe.tipo,
          mensagem: temPasse
            ? `Próximas 2 perguntas em ${segParaProximo}s. Use 1 crédito para adiantar!`
            : `Próximas 2 perguntas em ${segParaProximo}s. Com Passe o ciclo é de apenas 3min!`
        })
      );
    }

    // 7. Anti-bot: resposta muito rápida
    if (tempoRespostaSegundos < CONFIG_PARTIDA.tempoMinimoResposta) {
      throw new functions.https.HttpsError('failed-precondition', 'Resposta muito rápida');
    }

    // 8. Verificar resposta
    const acertou = respostaUser === correta;

    // 9. Calcular streak e multiplicador
    let streakAtual = participante.streakAtual || 0;
    let maxStreakVal = participante.maxStreak || 0;

    if (acertou) {
      streakAtual += 1;
      if (streakAtual > maxStreakVal) maxStreakVal = streakAtual;
    } else {
      streakAtual = 0;
    }

    let multiplicador = 1;
    if (streakAtual >= 10) multiplicador = 3;
    else if (streakAtual >= 5) multiplicador = 2;
    else if (streakAtual >= 3) multiplicador = 1.5;

    const pontosFinais = acertou ? Math.round(pontuacaoBase * multiplicador) : 0;

    // 10. Atualizar tudo em batch
    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    const userUpdates = {
      [`perguntasRespondidas_${timeTorcida}`]: admin.firestore.FieldValue.arrayUnion(perguntaId),
      'stats.totalPerguntas': admin.firestore.FieldValue.increment(1),
      'stats.ultimoLogin': admin.firestore.FieldValue.serverTimestamp()
    };

    if (acertou) {
      userUpdates[`pontuacoes.${jogoId}`] = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates.xp = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates[`tempoRespostas.${jogoId}.soma`] = admin.firestore.FieldValue.increment(tempoRespostaSegundos);
      userUpdates[`tempoRespostas.${jogoId}.quantidade`] = admin.firestore.FieldValue.increment(1);
      userUpdates['stats.totalAcertos'] = admin.firestore.FieldValue.increment(1);
    }

    batch.update(userRef, userUpdates);

    // Atualizar participante com contagem
    const novoTotalRespondidas = totalRespondidas + 1;
    const acertos = (participante.acertos || 0) + (acertou ? 1 : 0);
    const erros = (participante.erros || 0) + (acertou ? 0 : 1);

    let timeNome = participante.timeNome || 'Time';
    try {
      const timeDoc = await db.collection('times').doc(timeTorcida).get();
      if (timeDoc.exists) timeNome = timeDoc.data().nome || 'Time';
    } catch (e) { /* não crítico */ }

    batch.set(participanteRef, {
      odId: uid,
      nome: userData.usuarioUnico || userData.usuario || userData.nome || 'Anônimo',
      timeId: timeTorcida,
      timeNome: timeNome,
      pontos: (participante.pontos || 0) + pontosFinais,
      acertos, erros,
      streakAtual, maxStreak: maxStreakVal,
      tempoSoma: (participante.tempoSoma || 0) + (acertou ? tempoRespostaSegundos : 0),
      tempoQuantidade: (participante.tempoQuantidade || 0) + (acertou ? 1 : 0),
      tempoMedio: acertou
        ? ((participante.tempoSoma || 0) + tempoRespostaSegundos) / ((participante.tempoQuantidade || 0) + 1)
        : participante.tempoMedio || 0,
      // === CONTROLE DE COOLDOWN ===
      totalRespondidas: novoTotalRespondidas,
      // entradaEm e skipsUsados NÃO mudam aqui
      modeloV2: true,
      atualizadoEm: admin.firestore.Timestamp.now()
    }, { merge: true });

    await batch.commit();

    // 11. Calcular estado pós-resposta
    const perguntasRestantes = totalDisponivel - novoTotalRespondidas;
    const proximoCicloEm = entradaEm.getTime() + ((ciclosPassados + 1) * cooldown * 1000);
    const segParaProximo = Math.max(0, Math.ceil((proximoCicloEm - agora.getTime()) / 1000));

    return {
      acertou,
      respostaCorreta: pergunta.correta,
      respostaTexto: pergunta.alternativas?.[pergunta.correta] || '',
      pontosGanhos: pontosFinais,
      pontuacaoBase,
      multiplicador,
      streak: streakAtual,
      maxStreak: maxStreakVal,
      // === INFO COOLDOWN ===
      perguntasRestantes,
      totalRespondidas: novoTotalRespondidas,
      totalDisponivel,
      segParaProximoCiclo: perguntasRestantes > 0 ? null : segParaProximo,
      cooldownSegundos: cooldown,
      tipoPasse: passe.tipo,
      modeloV2: true
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Erro responderPerguntaV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro interno ao processar resposta');
  }
});


/**
 * ADIANTAR PERGUNTAS v2 — Gastar 1 crédito para liberar +2 perguntas extras
 * 
 * O crédito é um BÔNUS — não reseta o timer.
 * Timer fixo continua rodando independente.
 * Créditos são 100% ganhos na plataforma (nunca comprados).
 */
exports.adiantarPerguntasV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { jogoId } = data;

  if (!jogoId) {
    throw new functions.https.HttpsError('invalid-argument', 'jogoId obrigatório');
  }

  try {
    // 1. Verificar se o jogo está ativo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogo = jogoDoc.data();
    const agora = new Date();
    const fim = jogo.dataFim?.toDate?.() || null;
    if (fim && agora > fim) throw new functions.https.HttpsError('failed-precondition', 'Jogo já encerrado');

    // 2. Verificar se o usuário está participando
    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    const participanteDoc = await participanteRef.get();

    if (!participanteDoc.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Você não está nesta partida');
    }

    // Auto-migração se necessário
    if (!participanteDoc.data().entradaEm) {
      await participanteRef.update({
        entradaEm: admin.firestore.Timestamp.now(),
        totalRespondidas: 0,
        skipsUsados: 0,
        modeloV2: true
      });
    }

    // 3. Verificar créditos disponíveis
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.data() || {};
    const creditosDisponiveis = userData.creditos || 0;
    const custoSkip = CONFIG_QUIZ.creditosPorSkip;

    if (creditosDisponiveis < custoSkip) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Créditos insuficientes. Você tem ${creditosDisponiveis}, precisa de ${custoSkip}.`);
    }

    // 4. Descontar crédito e incrementar skips (recarregar doc caso tenha sido migrado)
    const pDocFresh = await participanteRef.get();
    const participante = pDocFresh.data();
    const novoSkips = (participante.skipsUsados || 0) + 1;

    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    // Descontar crédito
    batch.update(userRef, {
      creditos: admin.firestore.FieldValue.increment(-custoSkip)
    });

    // Incrementar skips no participante
    batch.update(participanteRef, {
      skipsUsados: novoSkips,
      atualizadoEm: admin.firestore.Timestamp.now()
    });

    await batch.commit();

    // 5. Calcular novo estado
    const passe = await verificarPasse(uid);
    const temPasse = passe.temPasse;
    const cooldown = temPasse ? CONFIG_QUIZ.cooldownPasse : CONFIG_QUIZ.cooldownFree;
    const entradaEm = participante.entradaEm.toDate();
    const elapsed = (agora.getTime() - entradaEm.getTime()) / 1000;
    const ciclosPassados = Math.floor(elapsed / cooldown);
    const totalRespondidas = participante.totalRespondidas || 0;

    const novoTotalDisponivel = CONFIG_QUIZ.perguntasIniciais
      + (ciclosPassados * CONFIG_QUIZ.perguntasPorCiclo)
      + (novoSkips * CONFIG_QUIZ.perguntasPorSkip);

    const perguntasRestantes = novoTotalDisponivel - totalRespondidas;

    console.log(`💰 ${uid} usou ${custoSkip} crédito(s) para adiantar +${CONFIG_QUIZ.perguntasPorSkip} perguntas no jogo ${jogoId}`);

    return {
      success: true,
      creditoGasto: custoSkip,
      creditosRestantes: creditosDisponiveis - custoSkip,
      perguntasLiberadas: CONFIG_QUIZ.perguntasPorSkip,
      perguntasRestantes,
      totalDisponivel: novoTotalDisponivel,
      totalRespondidas,
      skipsUsados: novoSkips
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro adiantarPerguntasV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao adiantar perguntas');
  }
});


/**
 * PREMIAR JOGO v2 — Prêmio do SISTEMA, sem pool dos jogadores
 * Mudanças vs v1:
 * - Pool NÃO vem dos créditos dos jogadores (zero contribuição)
 * - Prêmio = base fixa + bônus por participantes (do sistema)
 * - SEM cotistas (bolsa vira apenas índice visual)
 * - SEM sortudos (premiação 100% mérito)
 * - Mantém atualização do índice da bolsa (visual)
 */
exports.premiarJogoV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  // ✅ Qualquer user pode chamar, mas só se jogo acabou
  const { jogoId } = data;
  if (!jogoId) throw new functions.https.HttpsError('invalid-argument', 'jogoId obrigatório');

  try {
    // 1. Ler dados do jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogoData = jogoDoc.data();

    // ✅ Verificar se jogo acabou
    if (jogoData.dataFim) {
      const fim = jogoData.dataFim.toDate ? jogoData.dataFim.toDate() : new Date(jogoData.dataFim);
      if (new Date() < fim) {
        throw new functions.https.HttpsError('failed-precondition', 'Jogo ainda não acabou');
      }
    }

    if (jogoData.premiado && jogoData.premiacaoDetalhes) {
      return { success: true, jaPremiado: true, detalhes: jogoData.premiacaoDetalhes };
    }

    const timeCasaId = jogoData.timeCasaId;
    const timeForaId = jogoData.timeForaId;

    // 2. Nomes dos times
    let timeCasaNome = 'Time Casa';
    let timeForaNome = 'Time Fora';
    try {
      const [cDoc, fDoc] = await Promise.all([
        db.collection('times').doc(timeCasaId).get(),
        db.collection('times').doc(timeForaId).get()
      ]);
      if (cDoc.exists) timeCasaNome = cDoc.data().nome || timeCasaNome;
      if (fDoc.exists) timeForaNome = fDoc.data().nome || timeForaNome;
    } catch (e) { /* não crítico */ }

    // 3. Ler participantes
    const participantesSnap = await db.collection('jogos').doc(jogoId)
      .collection('participantes').get();

    if (participantesSnap.empty) {
      await db.collection('jogos').doc(jogoId).update({
        premiado: true, modeloV2: true,
        premiacaoDetalhes: { totalPremio: 0, semParticipantes: true, processadoEm: new Date().toISOString() }
      });
      return { success: true, semParticipantes: true };
    }

    const participantes = [];
    const estatisticas = {
      timeCasa: { pontos: 0, torcedores: [], nome: timeCasaNome },
      timeFora: { pontos: 0, torcedores: [], nome: timeForaNome }
    };

    participantesSnap.forEach(doc => {
      const p = doc.data();
      const pontos = p.pontos || 0;
      let tempoMedio = 10;
      if (p.tempoQuantidade > 0) tempoMedio = p.tempoSoma / p.tempoQuantidade;

      participantes.push({
        odId: p.odId, nome: p.nome, pontos, tempoMedio,
        timeId: p.timeId, timeNome: p.timeNome
      });

      if (p.timeId === timeCasaId) {
        estatisticas.timeCasa.pontos += pontos;
        estatisticas.timeCasa.torcedores.push({ odId: p.odId, nome: p.nome });
      } else if (p.timeId === timeForaId) {
        estatisticas.timeFora.pontos += pontos;
        estatisticas.timeFora.torcedores.push({ odId: p.odId, nome: p.nome });
      }
    });

    // Ordenar por pontos + tempo (desempate)
    participantes.sort((a, b) => {
      if (b.pontos !== a.pontos) return b.pontos - a.pontos;
      return a.tempoMedio - b.tempoMedio;
    });

    // 4. DETERMINAR FAIXA DE PREMIAÇÃO (valores fixos por posição)
    const numParticipantes = participantes.length;
    const faixaConfig = CONFIG_PARTIDA.faixas.find(
      f => numParticipantes >= f.minJogadores && numParticipantes <= f.maxJogadores
    ) || CONFIG_PARTIDA.faixas[0];
    
    const premiosConfig = faixaConfig.premios;

    // 5. Montar créditos fixos por posição
    const maxPremiados = Math.min(CONFIG_PARTIDA.maxPremiados, numParticipantes);
    const creditosPorPosicao = [];
    let totalPremio = 0;
    
    // Top 5 (ou top 3 na faixa <10)
    for (let i = 0; i < Math.min(maxPremiados, premiosConfig.top5.length); i++) {
      creditosPorPosicao.push(premiosConfig.top5[i]);
      totalPremio += premiosConfig.top5[i];
    }
    
    // Faixas 6-50
    for (const faixa of premiosConfig.faixas) {
      for (let pos = faixa.de; pos <= faixa.ate && pos <= maxPremiados; pos++) {
        creditosPorPosicao.push(faixa.valor);
        totalPremio += faixa.valor;
      }
    }

    const topN = participantes.slice(0, maxPremiados);

    console.log(`🏆 Prêmio fixo: ${totalPremio} cr para ${topN.length} premiados (${numParticipantes} participantes, faixa ${faixaConfig.minJogadores}-${faixaConfig.maxJogadores})`);

    // 6. Distribuir prêmios em batch
    const premiosRanking = [];
    let batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < topN.length; i++) {
      const p = topN[i];
      const creditos = creditosPorPosicao[i] || 0;

      premiosRanking.push({
        odId: p.odId, nome: p.nome, posicao: i + 1,
        pontos: p.pontos, creditos
      });

      if (creditos > 0) {
        batch.update(db.collection('usuarios').doc(p.odId), {
          creditos: admin.firestore.FieldValue.increment(creditos)
        });
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // 7. Salvar detalhes
    const premiacaoDetalhes = {
      modeloV2: true,
      fontePremio: 'sistema_fixo',
      totalPremio,
      faixaJogadores: `${faixaConfig.minJogadores}-${faixaConfig.maxJogadores === Infinity ? '∞' : faixaConfig.maxJogadores}`,
      totalPremiados: creditosPorPosicao.length,
      distribuicao: { ranking: { percentual: 100, total: totalPremio } },
      ranking: premiosRanking,
      estatisticas: {
        timeCasa: { nome: timeCasaNome, pontos: estatisticas.timeCasa.pontos, torcedores: estatisticas.timeCasa.torcedores.length },
        timeFora: { nome: timeForaNome, pontos: estatisticas.timeFora.pontos, torcedores: estatisticas.timeFora.torcedores.length }
      },
      processadoEm: new Date().toISOString(),
      processadoPor: 'cloud_function_v2'
    };

    batch.update(db.collection('jogos').doc(jogoId), {
      premiado: true, modeloV2: true, fontePremio: 'sistema',
      premiacaoDetalhes
    });

    // 8. Atualizar índice da bolsa (visual — sem compra/venda)
    try {
      const CONFIG_BOLSA = {
        porJogo: 0.25, porTorcedor: 0.05, porVitoriaTorcida: 0.5,
        porVitoriaPontuacao: 0.9, porPonto: 0.005,
        porDerrotaTorcida: 0.3, porDerrotaPontuacao: 0.5, maxVariacao: 12
      };
      const PRECO_INICIAL = 500;
      const tc = estatisticas.timeCasa.torcedores.length;
      const tf = estatisticas.timeFora.torcedores.length;
      const pc = estatisticas.timeCasa.pontos;
      const pf = estatisticas.timeFora.pontos;

      let vc = CONFIG_BOLSA.porJogo + tc * CONFIG_BOLSA.porTorcedor + pc * CONFIG_BOLSA.porPonto;
      let vf = CONFIG_BOLSA.porJogo + tf * CONFIG_BOLSA.porTorcedor + pf * CONFIG_BOLSA.porPonto;
      if (tc > tf) { vc += CONFIG_BOLSA.porVitoriaTorcida; vf -= CONFIG_BOLSA.porDerrotaTorcida; }
      else if (tf > tc) { vf += CONFIG_BOLSA.porVitoriaTorcida; vc -= CONFIG_BOLSA.porDerrotaTorcida; }
      if (pc > pf) { vc += CONFIG_BOLSA.porVitoriaPontuacao; vf -= CONFIG_BOLSA.porDerrotaPontuacao; }
      else if (pf > pc) { vf += CONFIG_BOLSA.porVitoriaPontuacao; vc -= CONFIG_BOLSA.porDerrotaPontuacao; }
      vc = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, vc));
      vf = Math.max(-CONFIG_BOLSA.maxVariacao, Math.min(CONFIG_BOLSA.maxVariacao, vf));

      const [mCDoc, mFDoc] = await Promise.all([
        db.collection('bolsa_metricas_time').doc(timeCasaId).get(),
        db.collection('bolsa_metricas_time').doc(timeForaId).get()
      ]);
      const mC = mCDoc.exists ? mCDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, totalJogos: 0, totalTorcedores: 0, mediaDividendos: 0 };
      const mF = mFDoc.exists ? mFDoc.data() : { precoAlgoritmo: PRECO_INICIAL, variacaoDia: 0, totalJogos: 0, totalTorcedores: 0, mediaDividendos: 0 };

      batch.set(db.collection('bolsa_metricas_time').doc(timeCasaId), {
        timeId: timeCasaId, timeNome: timeCasaNome,
        precoAlgoritmo: Math.round(mC.precoAlgoritmo * (1 + vc / 100) * 100) / 100,
        precoMercado: Math.round(mC.precoAlgoritmo * (1 + vc / 100) * 100) / 100,
        variacaoDia: Math.round(((mC.variacaoDia || 0) + vc) * 100) / 100,
        totalJogos: (mC.totalJogos || 0) + 1,
        totalTorcedores: (mC.totalTorcedores || 0) + tc,
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      batch.set(db.collection('bolsa_metricas_time').doc(timeForaId), {
        timeId: timeForaId, timeNome: timeForaNome,
        precoAlgoritmo: Math.round(mF.precoAlgoritmo * (1 + vf / 100) * 100) / 100,
        precoMercado: Math.round(mF.precoAlgoritmo * (1 + vf / 100) * 100) / 100,
        variacaoDia: Math.round(((mF.variacaoDia || 0) + vf) * 100) / 100,
        totalJogos: (mF.totalJogos || 0) + 1,
        totalTorcedores: (mF.totalTorcedores || 0) + tf,
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`📈 Bolsa v2: ${timeCasaNome} ${vc >= 0?'+':''}${vc.toFixed(2)}% | ${timeForaNome} ${vf >= 0?'+':''}${vf.toFixed(2)}%`);
    } catch (bolsaErr) {
      console.error('⚠️ Erro bolsa v2:', bolsaErr.message);
    }

    // Commit
    await batch.commit();

    // 9. Notificações Top 10
    try {
      const jogoNome = `${timeCasaNome} vs ${timeForaNome}`;
      const notifBatch = db.batch();
      let nc = 0;

      for (const p of premiosRanking.slice(0, 10)) {
        if (p.creditos > 0) {
          const emoji = p.posicao <= 3 ? ['🥇', '🥈', '🥉'][p.posicao - 1] : '🏆';
          notifBatch.set(db.collection('notificacoes').doc(), {
            para: p.odId, tipo: 'premiacao',
            titulo: `${emoji} ${p.posicao}º lugar - ${jogoNome}`,
            mensagem: `Você fez ${p.pontos} pts e ganhou +${p.creditos} créditos!`,
            lida: false, data: admin.firestore.FieldValue.serverTimestamp()
          });
          nc++;
        }
      }
      if (nc > 0) await notifBatch.commit();
      console.log(`🔔 ${nc} notificações v2 criadas`);
    } catch (nErr) { console.error('⚠️ Notif v2:', nErr.message); }

    // 10. Logs
    try {
      const jogoDesc = `${timeCasaNome} vs ${timeForaNome}`;
      for (const p of premiosRanking.slice(0, 20)) {
        if (p.creditos > 0) {
          await logAtividade(p.odId, 'jogo_ranking_v2', p.creditos, null,
            `Jogo v2: ${p.posicao}º lugar — ${jogoDesc} (+${p.creditos} cr)`,
            { jogoId, posicao: p.posicao, pontos: p.pontos, fontePremio: 'sistema' });
        }
      }
    } catch (logErr) { console.error('⚠️ Log v2:', logErr.message); }

    console.log(`🏆 Premiação v2 jogo ${jogoId}: ${totalPremio} cr sistema (${numParticipantes} participantes)`);
    return { success: true, detalhes: premiacaoDetalhes };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro premiarJogoV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao processar premiação');
  }
});


// =====================================================
// 🔄 FASE 4: ESCALAÇÃO — Top 11 mensal por time
// Cron mensal + consulta
// =====================================================

/**
 * CALCULAR ESCALAÇÃO MENSAL — Roda dia 1 de cada mês às 00:30 BRT
 * Determina Top 11 jogadores de cada time no mês anterior
 * 1º de cada time = Técnico
 */
exports.calcularEscalacaoMensal = functions.pubsub
  .schedule('30 0 1 * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const agora = new Date();
      const mesAnterior = agora.getMonth() === 0 ? 11 : agora.getMonth() - 1;
      const anoRef = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
      const mesId = `${anoRef}-${String(mesAnterior + 1).padStart(2, '0')}`;

      console.log(`⚽ Calculando Escalação do mês ${mesId}...`);

      // Buscar todos os times
      const timesSnap = await db.collection('times').get();
      if (timesSnap.empty) { console.log('⚽ Nenhum time'); return null; }

      // Para cada time, buscar jogadores com mais pontos no mês
      let totalEscalados = 0;
      let batchGlobal = db.batch();
      let batchCount = 0;

      for (const timeDoc of timesSnap.docs) {
        const timeId = timeDoc.id;
        const timeNome = timeDoc.data().nome || 'Time';

        // Buscar participações de jogos deste time no mês anterior
        // Aggregate: somar pontos por jogador em todos os jogos do mês
        const jogosSnap = await db.collection('jogos')
          .where('status', '==', 'finalizado')
          .get();

        // Filtrar jogos do mês anterior que envolvem este time
        const jogosDoTime = [];
        jogosSnap.forEach(doc => {
          const j = doc.data();
          const dataJogo = j.dataInicio?.toDate?.() || new Date(j.dataInicio || 0);
          if (dataJogo.getMonth() === mesAnterior && dataJogo.getFullYear() === anoRef) {
            if (j.timeCasaId === timeId || j.timeForaId === timeId) {
              jogosDoTime.push(doc.id);
            }
          }
        });

        if (jogosDoTime.length === 0) continue;

        // Somar pontos por jogador em todos os jogos do time
        const pontosJogador = {}; // { odId: { pontos, nome, acertos, jogos } }

        for (const jogoId of jogosDoTime) {
          const partsSnap = await db.collection('jogos').doc(jogoId)
            .collection('participantes').where('timeId', '==', timeId).get();

          partsSnap.forEach(doc => {
            const p = doc.data();
            if (!p.odId) return;
            if (!pontosJogador[p.odId]) {
              pontosJogador[p.odId] = { pontos: 0, nome: p.nome || 'Anônimo', acertos: 0, jogos: 0 };
            }
            pontosJogador[p.odId].pontos += (p.pontos || 0);
            pontosJogador[p.odId].acertos += (p.acertos || 0);
            pontosJogador[p.odId].jogos += 1;
          });
        }

        // Ordenar e pegar Top 20
        const ranking = Object.entries(pontosJogador)
          .map(([odId, data]) => ({ odId, ...data }))
          .sort((a, b) => b.pontos - a.pontos)
          .slice(0, 20);

        if (ranking.length === 0) continue;

        // Salvar escalação do mês
        const escalacaoData = {
          timeId, timeNome, mesId,
          tecnico: ranking[0] ? { odId: ranking[0].odId, nome: ranking[0].nome, pontos: ranking[0].pontos } : null,
          titulares: ranking.slice(0, CONFIG_ESCALACAO.tamanhoEscalacao).map((r, i) => ({
            posicao: i + 1, odId: r.odId, nome: r.nome, pontos: r.pontos, jogos: r.jogos
          })),
          reservas: ranking.slice(CONFIG_ESCALACAO.tamanhoEscalacao, 20).map((r, i) => ({
            posicao: CONFIG_ESCALACAO.tamanhoEscalacao + i + 1, odId: r.odId, nome: r.nome, pontos: r.pontos
          })),
          totalJogos: jogosDoTime.length,
          processadoEm: admin.firestore.FieldValue.serverTimestamp()
        };

        batchGlobal.set(
          db.collection('escalacao').doc(`${timeId}_${mesId}`),
          escalacaoData
        );
        batchCount++;

        // Atualizar campo escalação no documento do usuário
        for (let i = 0; i < Math.min(ranking.length, 20); i++) {
          const jogador = ranking[i];
          const ehTitular = i < CONFIG_ESCALACAO.tamanhoEscalacao;
          const ehTecnico = i === 0;

          batchGlobal.update(db.collection('usuarios').doc(jogador.odId), {
            [`escalacao.${mesId}`]: {
              timeId, timeNome,
              posicao: i + 1,
              titular: ehTitular,
              tecnico: ehTecnico,
              pontos: jogador.pontos
            }
          });
          batchCount++;
          totalEscalados++;

          if (batchCount >= 450) {
            await batchGlobal.commit();
            batchGlobal = db.batch();
            batchCount = 0;
          }
        }
      }

      if (batchCount > 0) await batchGlobal.commit();

      console.log(`⚽ Escalação ${mesId}: ${totalEscalados} jogadores escalados`);
      return null;

    } catch (error) {
      console.error('❌ Erro calcularEscalacaoMensal:', error);
      return null;
    }
  });


/**
 * CREDITAR ESCALAÇÃO — Quando um jogo é finalizado, credita
 * jogadores que estão na Escalação do time que jogou
 * Chamado automaticamente pelo premiarJogoV2 ou manualmente
 */
exports.creditarEscalacao = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  // ✅ SEGURANÇA: Apenas admin (admin@yellup.com) pode creditar escalação
  if (!isAdminEmail(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Apenas administradores');
  }

  const { jogoId } = data;
  if (!jogoId) throw new functions.https.HttpsError('invalid-argument', 'jogoId obrigatório');

  try {
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogo = jogoDoc.data();

    const agora = new Date();
    const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;

    const batch = db.batch();
    let creditados = 0;

    for (const timeId of [jogo.timeCasaId, jogo.timeForaId]) {
      const escDoc = await db.collection('escalacao').doc(`${timeId}_${mesAtual}`).get();
      if (!escDoc.exists) continue;

      const esc = escDoc.data();

      // Técnico (1º lugar)
      if (esc.tecnico?.odId) {
        batch.update(db.collection('usuarios').doc(esc.tecnico.odId), {
          creditos: admin.firestore.FieldValue.increment(CONFIG_ESCALACAO.creditosTecnico)
        });
        creditados++;
      }

      // Titulares (2º-11º)
      for (const t of (esc.titulares || []).slice(1)) {
        if (t.odId) {
          batch.update(db.collection('usuarios').doc(t.odId), {
            creditos: admin.firestore.FieldValue.increment(CONFIG_ESCALACAO.creditosPorJogoEscalacao)
          });
          creditados++;
        }
      }

      // Reservas (12º-20º)
      for (const r of (esc.reservas || [])) {
        if (r.odId) {
          batch.update(db.collection('usuarios').doc(r.odId), {
            creditos: admin.firestore.FieldValue.increment(CONFIG_ESCALACAO.creditosBancoReservas)
          });
          creditados++;
        }
      }
    }

    if (creditados > 0) await batch.commit();
    console.log(`⚽ Escalação creditada: ${creditados} jogadores no jogo ${jogoId}`);
    return { success: true, creditados };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro creditarEscalacao:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao creditar escalação');
  }
});


// =====================================================
// 🔄 FASE 5: TORNEIO v2 + MISSÃO v2
// Sem taxa de entrada, prêmio do sistema, multiplicador de passe
// =====================================================

/**
 * INSCREVER TORNEIO v2 — Sem taxa de entrada
 */
exports.inscreverTorneioV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  const userId = context.auth.uid;
  const { torneioId } = data;
  if (!torneioId) throw new functions.https.HttpsError('invalid-argument', 'torneioId obrigatório');

  try {
    const torneioDoc = await db.collection('torneios').doc(torneioId).get();
    if (!torneioDoc.exists) throw new functions.https.HttpsError('not-found', 'Torneio não encontrado');

    const torneio = torneioDoc.data();

    if ((torneio.inscritos || []).includes(userId)) {
      throw new functions.https.HttpsError('already-exists', 'Já está inscrito');
    }

    if ((torneio.totalInscritos || 0) >= torneio.vagas && torneio.vagas < 9999) {
      throw new functions.https.HttpsError('resource-exhausted', 'Torneio cheio');
    }

    // Verificar se torneio Premium exige passe
    if (torneio.tipoPremium) {
      const passe = await verificarPasse(userId);
      if (!passe.temPasse) {
        throw new functions.https.HttpsError('failed-precondition',
          'Torneio Premium — requer Passe Diário ou Mensal');
      }
    }

    // NÃO cobra taxa — inscrição gratuita
    const batch = db.batch();

    batch.update(db.collection('torneios').doc(torneioId), {
      inscritos: admin.firestore.FieldValue.arrayUnion(userId),
      totalInscritos: admin.firestore.FieldValue.increment(1),
      modeloV2: true
    });

    // Stats
    batch.update(db.collection('usuarios').doc(userId), {
      'stats.totalTorneios': admin.firestore.FieldValue.increment(1)
    });

    await batch.commit();

    console.log(`✅ ${userId} inscrito no torneio v2 ${torneioId} (grátis)`);
    return { success: true, entrada: 0 };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro inscreverTorneioV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao inscrever no torneio');
  }
});

/**
 * FINALIZAR TORNEIO v2 — Prêmio do SISTEMA
 */
exports.finalizarTorneioV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  // ✅ SEGURANÇA: Apenas admin (admin@yellup.com) pode finalizar torneios manualmente
  if (!isAdminEmail(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Apenas administradores podem finalizar torneios');
  }

  const { torneioId } = data;
  if (!torneioId) throw new functions.https.HttpsError('invalid-argument', 'torneioId obrigatório');

  try {
    const torneioDoc = await db.collection('torneios').doc(torneioId).get();
    if (!torneioDoc.exists) throw new functions.https.HttpsError('not-found', 'Torneio não encontrado');
    
    return await _finalizarTorneioInterno(torneioId, torneioDoc.data());

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro finalizarTorneioV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao finalizar torneio');
  }
});


/**
 * COMPLETAR MISSÃO v2 — Com multiplicador de Passe
 * Free: 1x | Diário: 1.5x | Mensal: 2x
 */
exports.completarMissaoV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  const userId = context.auth.uid;
  const { missaoId } = data;
  if (!missaoId) throw new functions.https.HttpsError('invalid-argument', 'missaoId obrigatório');

  try {
    const missaoRef = db.collection('usuarios').doc(userId).collection('missoes').doc(missaoId);
    const missaoDoc = await missaoRef.get();
    if (!missaoDoc.exists) throw new functions.https.HttpsError('not-found', 'Missão não encontrada');

    const missao = missaoDoc.data();
    if (!missao.concluido) throw new functions.https.HttpsError('failed-precondition', 'Missão não concluída');
    if (missao.creditada) return { success: true, jaCreditada: true };

    const creditosBase = missao.recompensa?.creditos || 0;
    if (creditosBase <= 0) return { success: true, creditos: 0 };

    // Multiplicador baseado no passe
    const passe = await verificarPasse(userId);
    const multiplicador = CONFIG_MISSAO.multiplicador[passe.tipo] || 1;
    const creditosFinal = Math.round(creditosBase * multiplicador);

    const userDoc = await db.collection('usuarios').doc(userId).get();
    const saldoAntes = userDoc.data()?.creditos || 0;

    const batch = db.batch();

    batch.update(db.collection('usuarios').doc(userId), {
      creditos: admin.firestore.FieldValue.increment(creditosFinal)
    });
    batch.update(missaoRef, { creditada: true, modeloV2: true, multiplicador });

    const extratoRef = db.collection('usuarios').doc(userId).collection('extrato').doc();
    batch.set(extratoRef, {
      tipo: 'entrada', valor: creditosFinal,
      descricao: `Missão: ${missao.titulo}${multiplicador > 1 ? ` (×${multiplicador} Passe)` : ''}`,
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    await logAtividade(userId, 'missao_v2', creditosFinal, saldoAntes,
      `Missão v2: ${missao.titulo || missaoId} (×${multiplicador})`,
      { missaoId, creditosBase, multiplicador, tipoPasse: passe.tipo });

    console.log(`✅ Missão v2 ${missaoId}: ${userId} +${creditosFinal} cr (base ${creditosBase} × ${multiplicador})`);
    return { success: true, creditos: creditosFinal, creditosBase, multiplicador, tipoPasse: passe.tipo };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro completarMissaoV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao completar missão');
  }
});


// =====================================================
// 🔄 FASE 6: RATING YELLUP — Cálculo diário
// Fórmula master com 6 componentes, decay, smoothing
// =====================================================

/**
 * CALCULAR RATING DIÁRIO — Cron às 00:00 BRT
 * Recalcula rating de todos os usuários ativos
 */
exports.calcularRatingDiario = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const agora = new Date();
      const hoje = agora.toISOString().split('T')[0];
      const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();

      console.log(`📊 Calculando Rating Yellup ${hoje}...`);

      const usersSnap = await db.collection('usuarios').get();
      if (usersSnap.empty) return null;

      let batch = db.batch();
      let batchCount = 0;
      let processados = 0;

      for (const doc of usersSnap.docs) {
        const u = doc.data();
        const uid = doc.id;
        const stats = u.stats || {};
        const ratingAnterior = u.rating || 0;

        // Verificar se teve atividade hoje
        const ultimoLogin = stats.ultimoLogin?.toDate?.() || new Date(0);
        const ativoHoje = ultimoLogin.toDateString() === agora.toDateString();

        let ratingNovo;

        if (!ativoHoje) {
          // DECAY: -0.5% por dia inativo
          ratingNovo = Math.max(ratingAnterior * CONFIG_RATING.decayDiario, CONFIG_RATING.ratingMinimo);
        } else {
          // CALCULAR COMPONENTES

          // Q — Quiz (25%)
          const totalPerguntas = stats.totalPerguntas || 0;
          const totalAcertos = stats.totalAcertos || 0;
          const taxaAcerto = totalPerguntas > 0 ? totalAcertos / totalPerguntas : 0;
          const streakMaxQuiz = stats.maxStreakQuiz || 0;
          const Q = Math.min((taxaAcerto * 400) + (totalPerguntas * 2) + (streakMaxQuiz * 10), 1000);

          // P — PvP (20%)
          const pvpJogados = stats.totalPvpJogados || 0;
          const pvpVitorias = stats.totalPvpVitorias || 0;
          const winrate = pvpJogados > 0 ? pvpVitorias / pvpJogados : 0;
          const rivaisUnicos = (stats.rivaisUnicos || []).length;
          const P = Math.min((winrate * 500) + (pvpVitorias * 5) + (rivaisUnicos * 3), 1000);

          // T — Torneios (15%)
          const totalTorneios = stats.totalTorneios || 0;
          const vitTorneios = u.torneios?.vitorias || 0;
          const top3Torneios = u.torneios?.top3 || 0;
          const T = Math.min((totalTorneios * 30) + (vitTorneios * 200) + (top3Torneios * 100), 1000);

          // C — Comunidade (15%)
          const msgsChat = Math.min(stats.totalMsgChat || 0, 100);
          const C = Math.min(msgsChat * 2, 1000);

          // E — Escalação (15%)
          const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
          const escAtual = u.escalacao?.[mesAtual];
          let E = 0;
          if (escAtual) {
            if (escAtual.tecnico) E += 500;
            else if (escAtual.titular) E += 300;
            else E += 100;
            E += (escAtual.pontos || 0) * 3;
          }
          E = Math.min(E, 1000);

          // K — Consistência (10%)
          const diasAtivos = stats.diasAtivos || 0;
          const streakLogin = stats.streakLogin || 0;
          const K = Math.min(((diasAtivos / diasNoMes) * 500) + (streakLogin * 15), 1000);

          // FÓRMULA MASTER
          const pesos = CONFIG_RATING.pesos;
          const ratingCalculado = (Q * pesos.quiz) + (P * pesos.pvp) + (T * pesos.torneios) +
            (C * pesos.comunidade) + (E * pesos.escalacao) + (K * pesos.consistencia);

          // SMOOTHING: 30% novo + 70% anterior
          ratingNovo = (ratingCalculado * CONFIG_RATING.suavizacao.novo) +
            (ratingAnterior * CONFIG_RATING.suavizacao.anterior);

          // Salvar componentes
          batch.update(doc.ref, {
            ratingComponents: {
              quiz: Math.round(Q), pvp: Math.round(P), torneios: Math.round(T),
              comunidade: Math.round(C), escalacao: Math.round(E), consistencia: Math.round(K)
            }
          });
        }

        ratingNovo = Math.round(Math.max(ratingNovo, 0));
        const faixa = getFaixaRating(ratingNovo);
        const variacao = ratingNovo - ratingAnterior;

        // Atualizar streak de login
        let streakLogin = stats.streakLogin || 0;
        let diasAtivos = stats.diasAtivos || 0;
        if (ativoHoje) {
          const ontem = new Date(agora);
          ontem.setDate(ontem.getDate() - 1);
          const ativoOntem = ultimoLogin.toDateString() === ontem.toDateString() ||
            ultimoLogin.toDateString() === agora.toDateString();
          streakLogin = ativoOntem ? streakLogin + 1 : 1;
          diasAtivos += 1;
        } else {
          streakLogin = 0;
        }

        batch.update(doc.ref, {
          rating: ratingNovo,
          ratingFaixa: faixa.nome,
          ratingVariacao: variacao,
          ratingHistory: admin.firestore.FieldValue.arrayUnion({ date: hoje, rating: ratingNovo }),
          'stats.streakLogin': streakLogin,
          'stats.diasAtivos': diasAtivos
        });

        // Atualizar ranking global
        batch.set(db.collection('ratingRanking').doc(uid), {
          nome: u.usuarioUnico || u.usuario || u.nome || 'Anônimo',
          rating: ratingNovo,
          faixa: faixa.nome,
          variacao: variacao,
          timeId: u.timeFavorito || '',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        });

        batchCount += 3; // 2-3 operations per user
        processados++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();

      console.log(`📊 Rating calculado: ${processados} usuários processados`);
      return null;

    } catch (error) {
      console.error('❌ Erro calcularRatingDiario:', error);
      return null;
    }
  });


/**
 * RESET MENSAL DO RATING — Soft reset dia 1 de cada mês às 00:20 BRT
 * Rating_novo = Rating_final × 0.6 + 100
 */
exports.resetMensalRating = functions.pubsub
  .schedule('20 0 1 * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const agora = new Date();
      const mesAnterior = agora.getMonth() === 0 ? 11 : agora.getMonth() - 1;
      const anoRef = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
      const mesId = `${anoRef}-${String(mesAnterior + 1).padStart(2, '0')}`;

      console.log(`🔄 Soft Reset Rating — snapshot ${mesId}...`);

      const usersSnap = await db.collection('usuarios').get();
      let batch = db.batch();
      let count = 0;

      for (const doc of usersSnap.docs) {
        const u = doc.data();
        const ratingFinal = u.rating || 0;

        // Snapshot do mês anterior
        batch.set(db.collection('ratingSnapshots').doc(mesId).collection('usuarios').doc(doc.id), {
          ratingFinal,
          faixa: u.ratingFaixa || 'Reserva',
          components: u.ratingComponents || {},
          snapshotEm: admin.firestore.FieldValue.serverTimestamp()
        });

        // Soft Reset
        const ratingNovo = Math.round(ratingFinal * CONFIG_RATING.softReset.fator + CONFIG_RATING.softReset.base);
        const faixa = getFaixaRating(ratingNovo);

        batch.update(doc.ref, {
          rating: ratingNovo,
          ratingFaixa: faixa.nome,
          ratingVariacao: ratingNovo - ratingFinal,
          // Resetar stats mensais (manter acumulados)
          'stats.diasAtivos': 0,
          'stats.streakLogin': 0
        });

        count += 2;
        if (count >= 400) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) await batch.commit();

      console.log(`🔄 Soft Reset: ${usersSnap.size} usuários. Snapshot salvo em ${mesId}`);
      return null;

    } catch (error) {
      console.error('❌ Erro resetMensalRating:', error);
      return null;
    }
  });


// =====================================================
// 🔧 MIGRAÇÃO: Adicionar campos v2 a usuários existentes
// Executar UMA VEZ via admin dashboard ou manualmente
// =====================================================
exports.migrarUsuariosV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  }

  // Verificar se é admin (email)
  if (!isAdminEmail(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Apenas admin');
  }

  try {
    const snap = await db.collection('usuarios').get();
    let migrados = 0;
    let jaOk = 0;

    // Processar em batches de 500
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const userData = doc.data();
      const updates = {};

      // Só adicionar campos que não existem
      if (!userData.passe) {
        updates.passe = CAMPOS_PADRAO_USUARIO.passe;
      }
      if (!userData.limitesDiarios) {
        updates.limitesDiarios = {
          partidasHoje: 0, pvpHoje: 0, bauColetadoHoje: false,
          ultimoReset: admin.firestore.FieldValue.serverTimestamp()
        };
      }
      if (userData.rating === undefined) {
        updates.rating = 0;
        updates.ratingFaixa = 'Reserva';
        updates.ratingVariacao = 0;
        updates.ratingComponents = CAMPOS_PADRAO_USUARIO.ratingComponents;
        updates.ratingHistory = [];
      }
      if (!userData.stats) {
        updates.stats = {
          ...CAMPOS_PADRAO_USUARIO.stats,
          // Migrar dados existentes se houver
          totalPvpVitorias: userData.pvp?.vitorias || 0,
          totalPvpJogados: userData.pvp?.totalEmbates || 0
        };
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        migrados++;
        batchCount++;

        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      } else {
        jaOk++;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`🔧 Migração v2: ${migrados} migrados, ${jaOk} já estavam ok`);
    return { success: true, migrados, jaOk, total: snap.size };

  } catch (error) {
    console.error('❌ Erro migração:', error);
    throw new functions.https.HttpsError('internal', 'Erro na migração');
  }
});

// =====================================================
// ⚽ PÊNALTIS V2 — TODA LÓGICA NO BACKEND
// Migração de segurança: remove 33 escritas diretas do frontend
// =====================================================

const CONFIG_PENALTI = {
  taxaEntrada: 2,         // 2 créditos por pessoa (queimados)
  premioSistema: 4,       // Vencedor recebe 4 créditos do sistema
  xpTreino: 5,            // XP ganho no modo treino
  expiracaoMinutos: 5,    // Tempo para aceitar convite
  timeoutMinutos: 10,     // Inatividade = W.O.
  rodadasNormais: 10,     // 5 cobranças cada = 10 rodadas
  maxPvpDiaFree: 2        // Limite diário para free
};

/**
 * CRIAR PÊNALTI V2 — Desafio PvP
 * Recebe: { desafiadoUid, desafiadoNome, time: { id, nome, primaria, secundaria, terciaria, abreviacao } }
 */
exports.criarPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;

  // 1. Buscar dados do criador
  const userDoc = await db.collection('usuarios').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado');
  const userData = userDoc.data();
  const creditos = userData.creditos || 0;

  // 2. Verificar créditos
  if (creditos < CONFIG_PENALTI.taxaEntrada) {
    throw new functions.https.HttpsError('failed-precondition', 'Créditos insuficientes (precisa de 2 💎)');
  }

  // 3. Verificar limite diário
  const passe = userData.passe || { tipo: 'free', ativo: false };
  const tipoPasse = (passe.ativo && passe.tipo !== 'free') ? passe.tipo : 'free';
  if (tipoPasse === 'free') {
    const limites = userData.limitesDiarios || {};
    const pvpHoje = limites.pvpHoje || 0;
    if (pvpHoje >= CONFIG_PENALTI.maxPvpDiaFree) {
      throw new functions.https.HttpsError('resource-exhausted', 'Limite diário de PvP atingido (2/dia). Adquira um Passe para jogar ilimitado!');
    }
  }

  // 4. Verificar se já tem disputa aberta
  const abertas = await db.collection('penaltis')
    .where('jogador1.uid', '==', uid)
    .where('status', '==', 'aguardando')
    .limit(1).get();
  if (!abertas.empty) {
    throw new functions.https.HttpsError('already-exists', 'Você já tem uma disputa aberta. Cancele antes de criar outra.');
  }

  // 5. Montar jogador1
  const nome = userData.usuarioUnico || userData.usuario || userData.nome || 'Jogador';
  const j1 = { uid, nome, avatarUrl: userData.avatarUrl || null };
  if (data.time) j1.time = data.time;

  // 6. Executar em batch atômico
  const batch = db.batch();
  const saldoAnterior = creditos;

  // Debitar créditos
  batch.update(db.collection('usuarios').doc(uid), {
    creditos: admin.firestore.FieldValue.increment(-CONFIG_PENALTI.taxaEntrada),
    'limitesDiarios.pvpHoje': admin.firestore.FieldValue.increment(1)
  });

  // Criar match
  const matchRef = db.collection('penaltis').doc();
  const matchData = {
    jogador1: j1,
    jogador2: null,
    status: 'aguardando',
    tipo: 'pvp',
    valorAposta: CONFIG_PENALTI.taxaEntrada,
    premioSistema: CONFIG_PENALTI.premioSistema,
    modeloV2: true,
    rodadaAtual: 1,
    rodadas: [],
    placar: { jogador1: 0, jogador2: 0 },
    escolhaJogador1: null,
    escolhaJogador2: null,
    vencedor: null,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    expiraEm: new Date(Date.now() + CONFIG_PENALTI.expiracaoMinutos * 60 * 1000)
  };

  // Se desafio direto
  if (data.desafiadoUid) {
    matchData.desafiadoUid = data.desafiadoUid;
    matchData.desafiadoNome = data.desafiadoNome || 'Jogador';
  }

  batch.set(matchRef, matchData);

  // Log de atividade
  logAtividadeBatch(batch, uid, 'penalti_entrada', -CONFIG_PENALTI.taxaEntrada, saldoAnterior,
    'Pênaltis: taxa de entrada (queimada)', { matchId: matchRef.id });

  // Notificação para o desafiado
  if (data.desafiadoUid) {
    const notifRef = db.collection('notificacoes').doc();
    batch.set(notifRef, {
      para: data.desafiadoUid,
      de: uid,
      tipo: 'desafio_penalti',
      titulo: '⚽ Desafio de Pênaltis!',
      mensagem: `${nome} te desafiou para pênaltis! 🎟️ Taxa: 2 créditos • 🏆 Prêmio: 4 créditos`,
      link: 'penaltis.html',
      lida: false,
      data: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
  console.log(`⚽ Pênalti criado: ${matchRef.id} por ${uid}`);

  return {
    matchId: matchRef.id,
    creditosRestantes: saldoAnterior - CONFIG_PENALTI.taxaEntrada
  };
});

/**
 * CRIAR TREINO PÊNALTI V2 — Contra Bot (sem custo)
 * Recebe: { time: { id, nome, primaria, secundaria, terciaria, abreviacao } }
 */
exports.criarTreinoPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;

  const userDoc = await db.collection('usuarios').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado');
  const userData = userDoc.data();
  const nome = userData.usuarioUnico || userData.usuario || userData.nome || 'Jogador';

  const j1 = { uid, nome, avatarUrl: userData.avatarUrl || null };
  if (data.time) j1.time = data.time;

  const matchRef = db.collection('penaltis').doc();
  await matchRef.set({
    jogador1: j1,
    jogador2: { uid: 'bot_' + uid, nome: '🤖 Bot Yellup', avatarUrl: null },
    status: 'em_andamento',
    tipo: 'treino',
    valorAposta: 0,
    premioSistema: 0,
    modeloV2: true,
    rodadaAtual: 1,
    rodadas: [],
    placar: { jogador1: 0, jogador2: 0 },
    escolhaJogador1: null,
    escolhaJogador2: null,
    vencedor: null,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`🤖 Treino pênalti criado: ${matchRef.id} por ${uid}`);
  return { matchId: matchRef.id };
});

/**
 * ACEITAR PÊNALTI V2
 * Recebe: { matchId, time: { id, nome, primaria, secundaria, terciaria, abreviacao } }
 */
exports.aceitarPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;
  const { matchId } = data;
  if (!matchId) throw new functions.https.HttpsError('invalid-argument', 'matchId obrigatório');

  // 1. Buscar match e validar
  const matchDoc = await db.collection('penaltis').doc(matchId).get();
  if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
  const match = matchDoc.data();

  if (match.status !== 'aguardando') {
    throw new functions.https.HttpsError('failed-precondition', 'Partida não está aguardando');
  }
  if (match.jogador1.uid === uid) {
    throw new functions.https.HttpsError('failed-precondition', 'Não pode aceitar sua própria partida');
  }
  if (match.desafiadoUid && match.desafiadoUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Este desafio é para outro jogador');
  }

  // 2. Verificar créditos
  const userDoc = await db.collection('usuarios').doc(uid).get();
  const userData = userDoc.data();
  const creditos = userData.creditos || 0;
  if (creditos < CONFIG_PENALTI.taxaEntrada) {
    throw new functions.https.HttpsError('failed-precondition', 'Créditos insuficientes (precisa de 2 💎)');
  }

  // 3. Verificar limite diário
  const passe = userData.passe || { tipo: 'free', ativo: false };
  const tipoPasse = (passe.ativo && passe.tipo !== 'free') ? passe.tipo : 'free';
  if (tipoPasse === 'free') {
    const pvpHoje = (userData.limitesDiarios || {}).pvpHoje || 0;
    if (pvpHoje >= CONFIG_PENALTI.maxPvpDiaFree) {
      throw new functions.https.HttpsError('resource-exhausted', 'Limite diário de PvP atingido');
    }
  }

  // 4. Montar jogador2 e executar batch
  const nome = userData.usuarioUnico || userData.usuario || userData.nome || 'Jogador';
  const j2 = { uid, nome, avatarUrl: userData.avatarUrl || null };
  if (data.time) j2.time = data.time;

  const batch = db.batch();
  const saldoAnterior = creditos;

  batch.update(db.collection('usuarios').doc(uid), {
    creditos: admin.firestore.FieldValue.increment(-CONFIG_PENALTI.taxaEntrada),
    'limitesDiarios.pvpHoje': admin.firestore.FieldValue.increment(1)
  });

  batch.update(db.collection('penaltis').doc(matchId), {
    jogador2: j2,
    status: 'em_andamento'
  });

  logAtividadeBatch(batch, uid, 'penalti_entrada', -CONFIG_PENALTI.taxaEntrada, saldoAnterior,
    'Pênaltis: taxa de entrada (queimada)', { matchId });

  await batch.commit();
  console.log(`⚽ Pênalti aceito: ${matchId} por ${uid}`);

  return {
    success: true,
    creditosRestantes: saldoAnterior - CONFIG_PENALTI.taxaEntrada
  };
});

/**
 * CANCELAR PÊNALTI V2 — Só o criador, só se aguardando
 * Recebe: { matchId }
 */
exports.cancelarPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;
  const { matchId } = data;

  const matchDoc = await db.collection('penaltis').doc(matchId).get();
  if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
  const match = matchDoc.data();

  if (match.jogador1.uid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Só o criador pode cancelar');
  }
  if (match.status !== 'aguardando') {
    throw new functions.https.HttpsError('failed-precondition', 'Partida já iniciou, não pode cancelar');
  }

  const reembolso = match.valorAposta || CONFIG_PENALTI.taxaEntrada;
  const userDoc = await db.collection('usuarios').doc(uid).get();
  const saldoAnterior = (userDoc.data()?.creditos) || 0;

  const batch = db.batch();

  batch.update(db.collection('usuarios').doc(uid), {
    creditos: admin.firestore.FieldValue.increment(reembolso)
  });

  batch.delete(db.collection('penaltis').doc(matchId));

  logAtividadeBatch(batch, uid, 'reembolso_penalti', reembolso, saldoAnterior,
    'Pênaltis: cancelada (reembolso taxa)', { matchId });

  await batch.commit();
  console.log(`❌ Pênalti cancelado: ${matchId}, reembolso ${reembolso} para ${uid}`);

  return { success: true, creditosRestantes: saldoAnterior + reembolso };
});

/**
 * COBRAR PÊNALTI V2 — Registra escolha de canto (chute ou defesa)
 * Recebe: { matchId, escolha: 'AE'|'AC'|'AD'|'BE'|'BC'|'BD' }
 * Escolhas: Alto-Esquerdo, Alto-Centro, Alto-Direito, Baixo-Esquerdo, Baixo-Centro, Baixo-Direito
 */
exports.cobrarPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;
  const { matchId, escolha } = data;

  if (!matchId || !escolha) {
    throw new functions.https.HttpsError('invalid-argument', 'matchId e escolha obrigatórios');
  }

  const cantosValidos = ['AE', 'AC', 'AD', 'BE', 'BC', 'BD',
                         'TE', 'TC', 'TD', 'ME', 'MC', 'MD'];
  if (!cantosValidos.includes(escolha)) {
    throw new functions.https.HttpsError('invalid-argument', 'Canto inválido: ' + escolha);
  }

  const matchRef = db.collection('penaltis').doc(matchId);

  // ✅ SEGURANÇA: Usar transaction para evitar race condition
  // Sem transaction, dois jogadores simultâneos poderiam ambos ler escolhaOutro=null,
  // gravar suas escolhas, e nenhum chamar resolverRodadaBackend (rodada trava).
  const transactionResult = await db.runTransaction(async (transaction) => {
    const matchDoc = await transaction.get(matchRef);
    if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
    const match = matchDoc.data();

    if (match.status !== 'em_andamento') {
      throw new functions.https.HttpsError('failed-precondition', 'Partida não está em andamento');
    }

    // Determinar role do jogador
    let myRole;
    if (match.jogador1.uid === uid) myRole = 'jogador1';
    else if (match.jogador2.uid === uid) myRole = 'jogador2';
    else throw new functions.https.HttpsError('permission-denied', 'Você não está nesta partida');

    // Verificar se já escolheu nesta rodada
    const campoEscolha = 'escolha' + myRole.charAt(0).toUpperCase() + myRole.slice(1);
    if (match[campoEscolha]) {
      throw new functions.https.HttpsError('already-exists', 'Você já fez sua escolha nesta rodada');
    }

    // Verificar se o outro já escolheu (DENTRO da transaction = leitura consistente)
    const outroRole = myRole === 'jogador1' ? 'jogador2' : 'jogador1';
    const campoOutro = 'escolha' + outroRole.charAt(0).toUpperCase() + outroRole.slice(1);
    const escolhaOutro = match[campoOutro];

    // Registrar escolha dentro da transaction
    transaction.update(matchRef, { [campoEscolha]: escolha });

    return { escolhaOutro, myRole, match };
  });

  // Se ambos escolheram, resolver rodada (fora da transaction para evitar conflitos de escrita)
  let resultado = null;
  if (transactionResult.escolhaOutro) {
    resultado = await resolverRodadaBackend(
      matchId, transactionResult.match, 
      escolha, transactionResult.escolhaOutro, 
      transactionResult.myRole
    );
  }

  return {
    registrado: true,
    ambosEscolheram: !!transactionResult.escolhaOutro,
    resultado
  };
});

/**
 * RESOLVER RODADA — Lógica interna (não exportada)
 */
async function resolverRodadaBackend(matchId, matchData, minhaEscolha, escolhaOutro, meuRole) {
  // Re-read para evitar race condition
  const freshDoc = await db.collection('penaltis').doc(matchId).get();
  const match = freshDoc.data();

  const escolhaJ1 = meuRole === 'jogador1' ? minhaEscolha : escolhaOutro;
  const escolhaJ2 = meuRole === 'jogador2' ? minhaEscolha : escolhaOutro;

  // Determinar cobrador da rodada (alternância: rodada 1=j1, 2=j2, 3=j1...)
  const rodadaNum = match.rodadaAtual || 1;
  const cobrador = (rodadaNum % 2 === 1) ? 'jogador1' : 'jogador2';
  const goleiro = cobrador === 'jogador1' ? 'jogador2' : 'jogador1';

  const chute = cobrador === 'jogador1' ? escolhaJ1 : escolhaJ2;
  const defesa = goleiro === 'jogador1' ? escolhaJ1 : escolhaJ2;
  const gol = chute !== defesa;

  // Atualizar placar
  const rodadas = [...(match.rodadas || [])];
  const placar = { ...(match.placar || { jogador1: 0, jogador2: 0 }) };

  rodadas.push({ rodada: rodadaNum, cobrador, goleiro, chute, defesa, gol });
  if (gol) placar[cobrador]++;

  // Verificar se o jogo acabou
  let status = 'em_andamento';
  let vencedor = null;

  const rodadasFeitas = rodadas.length;
  const metade = CONFIG_PENALTI.rodadasNormais / 2; // 5

  // Lógica de finalização antecipada e normal
  if (rodadasFeitas >= CONFIG_PENALTI.rodadasNormais) {
    // 10 rodadas feitas — verificar resultado
    if (placar.jogador1 !== placar.jogador2) {
      status = 'finalizado';
      vencedor = placar.jogador1 > placar.jogador2 ? match.jogador1.uid : match.jogador2.uid;
    }
    // Empate após 10 → morte súbita (continua)
  } else if (rodadasFeitas >= metade * 2 - 2) {
    // Verificar se alguém já não pode mais alcançar (antecipação)
    const j1Cobrou = rodadas.filter(r => r.cobrador === 'jogador1').length;
    const j2Cobrou = rodadas.filter(r => r.cobrador === 'jogador2').length;
    const j1Restam = metade - j1Cobrou;
    const j2Restam = metade - j2Cobrou;

    if (placar.jogador1 > placar.jogador2 + j2Restam) {
      status = 'finalizado';
      vencedor = match.jogador1.uid;
    } else if (placar.jogador2 > placar.jogador1 + j1Restam) {
      status = 'finalizado';
      vencedor = match.jogador2.uid;
    }
  }

  // Morte súbita: após 10 rodadas, empate → pares de rodadas até desempatar
  if (rodadasFeitas > CONFIG_PENALTI.rodadasNormais && rodadasFeitas % 2 === 0) {
    if (placar.jogador1 !== placar.jogador2) {
      status = 'finalizado';
      vencedor = placar.jogador1 > placar.jogador2 ? match.jogador1.uid : match.jogador2.uid;
    }
  }

  // Montar update
  const update = {
    rodadas,
    placar,
    rodadaAtual: rodadas.length + 1,
    escolhaJogador1: null,
    escolhaJogador2: null
  };

  if (status === 'finalizado') {
    update.status = 'finalizado';
    update.vencedor = vencedor;
    update.stats = computeStatsBackend(rodadas);

    // Distribuir prêmio
    if (vencedor && match.tipo !== 'treino') {
      const premio = match.premioSistema || CONFIG_PENALTI.premioSistema;
      const vencedorDoc = await db.collection('usuarios').doc(vencedor).get();
      const saldoAnterior = (vencedorDoc.data()?.creditos) || 0;

      const batch = db.batch();

      // Creditar vencedor
      batch.update(db.collection('usuarios').doc(vencedor), {
        creditos: admin.firestore.FieldValue.increment(premio),
        'stats.totalPvpVitorias': admin.firestore.FieldValue.increment(1)
      });

      // Stats para ambos
      batch.update(db.collection('usuarios').doc(match.jogador1.uid), {
        'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
      });
      if (match.jogador2.uid && !match.jogador2.uid.startsWith('bot_')) {
        batch.update(db.collection('usuarios').doc(match.jogador2.uid), {
          'stats.totalPvpJogados': admin.firestore.FieldValue.increment(1)
        });
      }

      batch.update(db.collection('penaltis').doc(matchId), update);

      logAtividadeBatch(batch, vencedor, 'penalti_vitoria', premio, saldoAnterior,
        `Pênaltis: vitória! (+${premio} créditos)`, { matchId, placar });

      // Notificar perdedor
      const perdedorUid = vencedor === match.jogador1.uid ? match.jogador2.uid : match.jogador1.uid;
      if (perdedorUid && !perdedorUid.startsWith('bot_')) {
        const nomeVencedor = vencedor === match.jogador1.uid ? match.jogador1.nome : match.jogador2.nome;
        const notifRef = db.collection('notificacoes').doc();
        batch.set(notifRef, {
          para: perdedorUid,
          tipo: 'penalti_resultado',
          titulo: '⚽ Resultado Pênaltis',
          mensagem: `Perdeu para ${nomeVencedor} (${placar.jogador1}×${placar.jogador2}). Taxa: -${match.valorAposta || 2} créditos`,
          lida: false,
          data: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      await batch.commit();
      console.log(`🏆 Pênalti finalizado: ${matchId}, vencedor: ${vencedor}, prêmio: ${premio}`);
    } else if (match.tipo === 'treino') {
      // Treino: só dar XP
      await db.collection('usuarios').doc(match.jogador1.uid).update({
        xp: admin.firestore.FieldValue.increment(CONFIG_PENALTI.xpTreino)
      });
      await db.collection('penaltis').doc(matchId).update(update);
      console.log(`🤖 Treino finalizado: ${matchId}, +${CONFIG_PENALTI.xpTreino} XP`);
    } else {
      await db.collection('penaltis').doc(matchId).update(update);
    }
  } else {
    // Rodada resolvida mas jogo continua
    await db.collection('penaltis').doc(matchId).update(update);
  }

  return {
    rodada: rodadaNum,
    cobrador,
    chute,
    defesa,
    gol,
    placar,
    status,
    vencedor
  };
}

/**
 * TIMEOUT/W.O. PÊNALTI V2 — Finalizar por inatividade ou abandono
 * Recebe: { matchId, motivo: 'timeout' | 'abandono' }
 */
exports.finalizarPenaltiTimeoutV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;
  const { matchId, motivo } = data;

  const matchDoc = await db.collection('penaltis').doc(matchId).get();
  if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
  const match = matchDoc.data();

  if (match.status !== 'em_andamento') {
    throw new functions.https.HttpsError('failed-precondition', 'Partida não está em andamento');
  }

  // Verificar que o chamador está na partida
  const isJ1 = match.jogador1.uid === uid;
  const isJ2 = match.jogador2?.uid === uid;
  if (!isJ1 && !isJ2) {
    throw new functions.https.HttpsError('permission-denied', 'Você não está nesta partida');
  }

  const premio = match.premioSistema || CONFIG_PENALTI.premioSistema;
  const placar = match.placar || { jogador1: 0, jogador2: 0 };

  // Determinar vencedor por timeout
  let vencedorUid = null;
  if (placar.jogador1 !== placar.jogador2) {
    vencedorUid = placar.jogador1 > placar.jogador2 ? match.jogador1.uid : match.jogador2.uid;
  }
  // Se empate exato no timeout → empate (reembolso)
  const isEmpate = !vencedorUid;

  const batch = db.batch();

  if (isEmpate) {
    // Reembolso para quem chamou o timeout
    const reembolso = match.valorAposta || CONFIG_PENALTI.taxaEntrada;
    batch.update(db.collection('usuarios').doc(uid), {
      creditos: admin.firestore.FieldValue.increment(reembolso)
    });
    batch.update(db.collection('penaltis').doc(matchId), {
      status: 'finalizado',
      vencedor: 'empate_timeout',
      // O outro jogador resgata via creditoPendente
      creditoPendente: { uid: (isJ1 ? match.jogador2.uid : match.jogador1.uid), valor: reembolso, tipo: 'reembolso' }
    });
    logAtividadeBatch(batch, uid, 'reembolso_penalti', reembolso, null,
      'Pênaltis: empate por tempo (reembolso)', { matchId });
  } else {
    // Vencedor por timeout
    batch.update(db.collection('usuarios').doc(vencedorUid), {
      creditos: admin.firestore.FieldValue.increment(premio)
    });
    batch.update(db.collection('penaltis').doc(matchId), {
      status: 'finalizado',
      vencedor: vencedorUid,
      timeout: true
    });
    logAtividadeBatch(batch, vencedorUid, 'penalti_vitoria', premio, null,
      `Pênaltis: prêmio Yellup por ${motivo} (+${premio})`, { matchId });

    // Se o vencedor não é quem chamou, creditoPendente
    if (vencedorUid !== uid) {
      batch.update(db.collection('penaltis').doc(matchId), {
        creditoPendente: { uid: vencedorUid, valor: premio, tipo: 'vitoria' }
      });
    }
  }

  await batch.commit();
  console.log(`⏱️ Pênalti timeout: ${matchId}, motivo: ${motivo}, vencedor: ${vencedorUid || 'empate'}`);

  return { success: true, vencedor: vencedorUid, empate: isEmpate };
});

/**
 * RESGATAR PRÊMIO PÊNALTI V2 — Para créditos pendentes
 * Recebe: { matchId }
 */
exports.resgatarPremioPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const uid = context.auth.uid;
  const { matchId } = data;

  const matchDoc = await db.collection('penaltis').doc(matchId).get();
  if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
  const match = matchDoc.data();

  if (!match.creditoPendente || match.creditoPendente.uid !== uid) {
    throw new functions.https.HttpsError('failed-precondition', 'Sem créditos pendentes para resgatar');
  }

  const pendente = match.creditoPendente;
  const userDoc = await db.collection('usuarios').doc(uid).get();
  const saldoAnterior = (userDoc.data()?.creditos) || 0;

  const batch = db.batch();

  batch.update(db.collection('usuarios').doc(uid), {
    creditos: admin.firestore.FieldValue.increment(pendente.valor)
  });

  batch.update(db.collection('penaltis').doc(matchId), {
    creditoPendente: admin.firestore.FieldValue.delete()
  });

  const desc = pendente.tipo === 'wo' ? `Pênaltis: vitória por W.O. (+${pendente.valor})`
             : pendente.tipo === 'reembolso' ? `Pênaltis: empate por tempo (reembolso)`
             : `Pênaltis: vitória! (+${pendente.valor} créditos)`;

  logAtividadeBatch(batch, uid, 'penalti_resgate', pendente.valor, saldoAnterior, desc, { matchId });

  await batch.commit();
  console.log(`💰 Prêmio resgatado: ${matchId}, ${pendente.valor} cr para ${uid}`);

  return { success: true, valor: pendente.valor, creditosRestantes: saldoAnterior + pendente.valor };
});

/**
 * BOT RESPONDER V2 — Escolha do bot no modo treino
 * Recebe: { matchId, isCobrador: boolean }
 */
exports.botResponderPenaltiV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  const { matchId, isCobrador } = data;

  const matchDoc = await db.collection('penaltis').doc(matchId).get();
  if (!matchDoc.exists) throw new functions.https.HttpsError('not-found', 'Partida não encontrada');
  const match = matchDoc.data();

  if (match.tipo !== 'treino') {
    throw new functions.https.HttpsError('permission-denied', 'Só funciona em treino');
  }

  // Bot escolhe aleatoriamente com pesos
  const cantos = ['AE', 'AC', 'AD', 'BE', 'BC', 'BD'];
  let weights;
  if (isCobrador) {
    weights = { AE: 18, AC: 12, AD: 18, BE: 22, BC: 8, BD: 22 };
  } else {
    weights = { AE: 16, AC: 18, AD: 16, BE: 18, BC: 14, BD: 18 };
  }

  const entries = Object.entries(weights);
  const totalW = entries.reduce((s, [, w]) => s + w, 0);
  let rand = Math.random() * totalW;
  let escolha = 'BC';
  for (const [canto, peso] of entries) {
    rand -= peso;
    if (rand <= 0) { escolha = canto; break; }
  }

  // Determinar qual role é o bot
  const botRole = match.jogador2.uid.startsWith('bot_') ? 'jogador2' : 'jogador1';
  const campo = 'escolha' + botRole.charAt(0).toUpperCase() + botRole.slice(1);

  await db.collection('penaltis').doc(matchId).update({ [campo]: escolha });

  return { escolha };
});

/**
 * Helper: Calcular stats de uma partida (para backend)
 */
function computeStatsBackend(rodadas) {
  const stats = {
    jogador1: { chutes: {}, defesas: {}, gols: 0, defs: 0, tc: 0, td: 0 },
    jogador2: { chutes: {}, defesas: {}, gols: 0, defs: 0, tc: 0, td: 0 }
  };
  rodadas.forEach(r => {
    const goleiro = r.cobrador === 'jogador1' ? 'jogador2' : 'jogador1';
    stats[r.cobrador].chutes[r.chute] = (stats[r.cobrador].chutes[r.chute] || 0) + 1;
    stats[r.cobrador].tc++;
    if (r.gol) stats[r.cobrador].gols++;
    stats[goleiro].defesas[r.defesa] = (stats[goleiro].defesas[r.defesa] || 0) + 1;
    stats[goleiro].td++;
    if (!r.gol) stats[goleiro].defs++;
  });
  return stats;
}


// =====================================================
// ⚡ MOMENTUM v3 — SISTEMA DE CADEIA DE PERGUNTAS
// Substitui o cooldown fixo por sistema baseado em acertos
// =====================================================

const CONFIG_MOMENTUM = {
  perguntasIniciais: 5,         // Fase 1: 5 perguntas de aquecimento
  timerFree: 120,               // Fase 3: 2 min para free
  timerPasse: 60,               // Fase 3: 1 min para quem tem passe
  timerMinFree: 45,             // Mínimo timer free (com acertos consecutivos)
  timerMinPasse: 30,            // Mínimo timer passe
  timerReducaoPorAcerto: 15,    // -15s por acerto consecutivo no timer
  perguntasPorCicloTimer: 1,    // +1 pergunta por ciclo no timer
  multiplicadorPasse: 1.5,      // Passe: pontos 1.5x na fase timer
  creditosPorPergunta: 1,       // 1 crédito = 1 pergunta
  bonusPerfeitoFase1: 1,        // +1 bônus extra se acertar todas da fase 1
};


/**
 * RESPONDER PERGUNTA MOMENTUM V3
 * 
 * Fase 1 (Aquecimento): 5 perguntas iniciais — cada acerto = +1 bônus para Fase 2
 * Fase 2 (Momentum): Cadeia infinita — acertou = +1, errou = vai pro timer (Fase 3)
 * Fase 3 (Timer): Timer adaptativo — acertar encurta, errar reseta
 */
exports.responderPerguntaMomentumV3 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  const uid = context.auth.uid;
  const { jogoId, perguntaId, resposta, tempoResposta, usandoCredito } = data;

  if (!jogoId || !perguntaId || !resposta) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos');
  }

  const tempoRespostaSegundos = Math.min(Math.max(parseFloat(tempoResposta) || 10, 0), 15);

  try {
    // 1. Buscar pergunta
    const perguntaDoc = await db.collection('perguntas').doc(perguntaId).get();
    if (!perguntaDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Pergunta não encontrada');
    }
    const pergunta = perguntaDoc.data();
    const correta = (pergunta.correta || '').toLowerCase();
    const respostaUser = (resposta || '').toLowerCase();
    const pontuacaoBase = pergunta.pontuacao || pergunta.pontos || 10;

    // 2. Buscar dados do jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogo = jogoDoc.data();

    // 3. Verificar se o jogo está ao vivo
    const agora = new Date();
    const inicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio || 0);
    const fim = jogo.dataFim?.toDate?.() || null;
    if (agora < inicio) throw new functions.https.HttpsError('failed-precondition', 'Jogo ainda não começou');
    if (fim && agora > fim) throw new functions.https.HttpsError('failed-precondition', 'Jogo já encerrado');

    // 4. Buscar dados do usuário
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const timeTorcida = userData.torcidas?.[jogoId];
    const creditos = userData.creditos || 0;

    if (!timeTorcida) {
      throw new functions.https.HttpsError('failed-precondition', 'Use entrarPartidaV2 primeiro');
    }

    // 5. Anti-replay: já respondeu esta pergunta?
    const perguntasRespondidas = userData[`perguntasRespondidas_${timeTorcida}`] || [];
    if (perguntasRespondidas.includes(perguntaId)) {
      throw new functions.https.HttpsError('already-exists', 'Pergunta já respondida');
    }

    // 6. Verificar passe
    const passe = await verificarPasse(uid);
    const temPasse = passe.temPasse;

    // 7. Buscar participante
    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    let participanteDoc = await participanteRef.get();

    // Auto-criar participante se não existe
    if (!participanteDoc.exists) {
      console.log(`🔄 Auto-criando participante ${uid} no responderPerguntaMomentumV3`);
      await participanteRef.set({
        odId: uid,
        nome: userData.usuarioUnico || userData.usuario || userData.nome || 'Anônimo',
        timeId: timeTorcida,
        timeNome: '',
        pontos: 0, acertos: 0, erros: 0,
        streakAtual: 0, maxStreak: 0,
        tempoSoma: 0, tempoQuantidade: 0, tempoMedio: 0,
        entradaEm: admin.firestore.Timestamp.now(),
        totalRespondidas: 0, skipsUsados: 0,
        faseAtual: 1, momentumBonus: 0, fase1Acertos: 0,
        perguntasRestantesFase2: 0, timerAcertosConsecutivos: 0,
        tipoPasse: passe.tipo, modeloV3: true,
        atualizadoEm: admin.firestore.Timestamp.now()
      }, { merge: true });
      participanteDoc = await participanteRef.get();
    }

    // Auto-migração: participante pré-v3
    if (!participanteDoc.data().modeloV3) {
      console.log(`🔄 Auto-migrando participante ${uid} para MomentumV3`);
      const pData = participanteDoc.data();
      // Manter dados existentes, adicionar campos momentum
      await participanteRef.update({
        faseAtual: 1,
        momentumBonus: 0,
        fase1Acertos: 0,
        perguntasRestantesFase2: 0,
        timerAcertosConsecutivos: 0,
        modeloV3: true,
        // Se já respondeu perguntas, ajustar fase
        ...(pData.totalRespondidas >= CONFIG_MOMENTUM.perguntasIniciais ? {
          faseAtual: 3,
          fase3InicioEm: admin.firestore.Timestamp.now()
        } : {})
      });
      participanteDoc = await participanteRef.get();
    }

    const participante = participanteDoc.data();

    // 8. Estado atual do momentum
    let faseAtual = participante.faseAtual || 1;
    let momentumBonus = participante.momentumBonus || 0;
    let timerAcertosConsecutivos = participante.timerAcertosConsecutivos || 0;
    let totalRespondidas = participante.totalRespondidas || 0;
    let skipsUsados = participante.skipsUsados || 0;
    let fase1Acertos = participante.fase1Acertos || 0;
    let fase2PerguntasRestantes = participante.perguntasRestantesFase2 || 0;

    // 9. Verificar se pode responder
    let podeResponder = false;
    if (usandoCredito) {
      if (creditos < CONFIG_MOMENTUM.creditosPorPergunta) {
        throw new functions.https.HttpsError('resource-exhausted', 'Créditos insuficientes. Compre mais na loja!');
      }
      podeResponder = true;
    } else {
      if (faseAtual === 1) {
        podeResponder = totalRespondidas < CONFIG_MOMENTUM.perguntasIniciais;
      } else if (faseAtual === 2) {
        podeResponder = fase2PerguntasRestantes > 0;
      } else if (faseAtual === 3) {
        // Verificar se o timer já passou
        const fase3Inicio = participante.fase3InicioEm?.toDate?.()?.getTime() || 0;
        const timerBase = temPasse ? CONFIG_MOMENTUM.timerPasse : CONFIG_MOMENTUM.timerFree;
        const timerMin = temPasse ? CONFIG_MOMENTUM.timerMinPasse : CONFIG_MOMENTUM.timerMinFree;
        const timerAtual = Math.max(timerMin, timerBase - (timerAcertosConsecutivos * CONFIG_MOMENTUM.timerReducaoPorAcerto));
        const tempoPassado = (agora.getTime() - fase3Inicio) / 1000;
        
        // Também permitir se tem skips não verificados
        const skipsVerificados = participante.skipsVerificados || 0;
        podeResponder = tempoPassado >= timerAtual || skipsUsados > skipsVerificados;
        
        if (podeResponder && skipsUsados > skipsVerificados) {
          // Marcar skip como verificado
          await participanteRef.update({ skipsVerificados: skipsUsados });
        }
      }
    }

    if (!podeResponder) {
      throw new functions.https.HttpsError('resource-exhausted',
        JSON.stringify({
          tipo: 'cooldown',
          totalRespondidas,
          fase: faseAtual,
          mensagem: faseAtual === 3 
            ? 'Aguarde o timer ou use 💎 1 crédito para jogar agora!'
            : 'Aguarde para responder'
        })
      );
    }

    // 10. Anti-bot: resposta muito rápida
    if (tempoRespostaSegundos < CONFIG_PARTIDA.tempoMinimoResposta) {
      throw new functions.https.HttpsError('failed-precondition', 'Resposta muito rápida');
    }

    // 11. Verificar resposta
    const acertou = respostaUser === correta;

    // 12. Calcular streak e multiplicador
    let streakAtual = participante.streakAtual || 0;
    let maxStreakVal = participante.maxStreak || 0;

    if (acertou) {
      streakAtual += 1;
      if (streakAtual > maxStreakVal) maxStreakVal = streakAtual;
    } else {
      streakAtual = 0;
    }

    let multiplicador = 1;
    if (streakAtual >= 10) multiplicador = 3;
    else if (streakAtual >= 7) multiplicador = 2.5;
    else if (streakAtual >= 5) multiplicador = 2;
    else if (streakAtual >= 3) multiplicador = 1.5;

    // Bônus passe na fase 3
    if (faseAtual === 3 && temPasse) {
      multiplicador *= CONFIG_MOMENTUM.multiplicadorPasse;
    }

    const pontosFinais = acertou ? Math.round(pontuacaoBase * multiplicador) : 0;

    // 13. ⚡ CALCULAR NOVO ESTADO DO MOMENTUM
    let momentumGanhou = false;
    let momentumQuebrou = false;
    let timerEncurtou = false;
    let novaFase = faseAtual;

    totalRespondidas++;

    if (faseAtual === 1) {
      // Fase 1: Aquecimento
      if (acertou) fase1Acertos++;

      if (totalRespondidas >= CONFIG_MOMENTUM.perguntasIniciais) {
        // Acabou fase 1 → Fase 2
        novaFase = 2;
        // Cada acerto = +1 bônus. Perfeito = +1 extra
        momentumBonus = fase1Acertos;
        if (fase1Acertos === CONFIG_MOMENTUM.perguntasIniciais) {
          momentumBonus += CONFIG_MOMENTUM.bonusPerfeitoFase1;
        }
        fase2PerguntasRestantes = momentumBonus;
        console.log(`⚡ ${uid} entrou na Fase 2 com ${momentumBonus} bônus (${fase1Acertos}/${CONFIG_MOMENTUM.perguntasIniciais} acertos)`);
      }

    } else if (faseAtual === 2) {
      // Fase 2: Momentum — cadeia
      fase2PerguntasRestantes--;

      if (acertou) {
        // Cadeia: +1 pergunta desbloqueada
        fase2PerguntasRestantes++;
        momentumBonus++;
        momentumGanhou = true;
      } else {
        // Errou: se não tem mais perguntas restantes, cadeia quebra
        if (fase2PerguntasRestantes <= 0) {
          novaFase = 3;
          momentumQuebrou = true;
          timerAcertosConsecutivos = 0;
          console.log(`💔 ${uid} quebrou momentum. Total bônus acumulados: ${momentumBonus}`);
        }
        // Se ainda tem perguntas restantes, continua na fase 2
      }

    } else if (faseAtual === 3) {
      // Fase 3: Timer
      if (acertou) {
        timerAcertosConsecutivos++;
        timerEncurtou = true;
      } else {
        timerAcertosConsecutivos = 0;
      }
    }

    // Calcular timer da fase 3 (para retornar ao client)
    const timerBase = temPasse ? CONFIG_MOMENTUM.timerPasse : CONFIG_MOMENTUM.timerFree;
    const timerMin = temPasse ? CONFIG_MOMENTUM.timerMinPasse : CONFIG_MOMENTUM.timerMinFree;
    const timerSegundos = Math.max(timerMin, timerBase - (timerAcertosConsecutivos * CONFIG_MOMENTUM.timerReducaoPorAcerto));

    // Calcular perguntas restantes
    let perguntasRestantes = 0;
    if (novaFase === 1) {
      perguntasRestantes = Math.max(0, CONFIG_MOMENTUM.perguntasIniciais - totalRespondidas);
    } else if (novaFase === 2) {
      perguntasRestantes = fase2PerguntasRestantes;
    } else if (novaFase === 3) {
      perguntasRestantes = 0; // Precisa esperar timer
    }

    // 14. Montar update do participante
    let timeNome = participante.timeNome || 'Time';
    try {
      const timeDoc = await db.collection('times').doc(timeTorcida).get();
      if (timeDoc.exists) timeNome = timeDoc.data().nome || 'Time';
    } catch (e) { /* não crítico */ }

    const novoTotalRespondidas = totalRespondidas;
    const acertos = (participante.acertos || 0) + (acertou ? 1 : 0);
    const erros = (participante.erros || 0) + (acertou ? 0 : 1);

    // 15. Batch write
    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    // Update usuário
    const userUpdates = {
      [`perguntasRespondidas_${timeTorcida}`]: admin.firestore.FieldValue.arrayUnion(perguntaId),
      'stats.totalPerguntas': admin.firestore.FieldValue.increment(1),
      'stats.ultimoLogin': admin.firestore.FieldValue.serverTimestamp()
    };

    if (acertou) {
      userUpdates[`pontuacoes.${jogoId}`] = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates.xp = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates[`tempoRespostas.${jogoId}.soma`] = admin.firestore.FieldValue.increment(tempoRespostaSegundos);
      userUpdates[`tempoRespostas.${jogoId}.quantidade`] = admin.firestore.FieldValue.increment(1);
      userUpdates['stats.totalAcertos'] = admin.firestore.FieldValue.increment(1);
    }

    if (usandoCredito) {
      userUpdates.creditos = admin.firestore.FieldValue.increment(-CONFIG_MOMENTUM.creditosPorPergunta);
    }

    batch.update(userRef, userUpdates);

    // Update participante
    const participanteUpdate = {
      odId: uid,
      nome: userData.usuarioUnico || userData.usuario || userData.nome || 'Anônimo',
      timeId: timeTorcida,
      timeNome: timeNome,
      pontos: (participante.pontos || 0) + pontosFinais,
      acertos, erros,
      streakAtual, maxStreak: maxStreakVal,
      tempoSoma: (participante.tempoSoma || 0) + (acertou ? tempoRespostaSegundos : 0),
      tempoQuantidade: (participante.tempoQuantidade || 0) + (acertou ? 1 : 0),
      tempoMedio: acertou
        ? ((participante.tempoSoma || 0) + tempoRespostaSegundos) / ((participante.tempoQuantidade || 0) + 1)
        : participante.tempoMedio || 0,
      // === MOMENTUM v3 ===
      totalRespondidas: novoTotalRespondidas,
      faseAtual: novaFase,
      momentumBonus,
      fase1Acertos,
      perguntasRestantesFase2: fase2PerguntasRestantes,
      timerAcertosConsecutivos,
      modeloV3: true,
      atualizadoEm: admin.firestore.Timestamp.now()
    };

    // Se entrou na fase 3 (agora ou continuando), salvar timestamp
    if (novaFase === 3 && (faseAtual !== 3 || momentumQuebrou)) {
      participanteUpdate.fase3InicioEm = admin.firestore.Timestamp.now();
    }
    if (faseAtual === 3 && novaFase === 3 && !momentumQuebrou) {
      // Respondeu no timer → resetar início do timer para agora
      participanteUpdate.fase3InicioEm = admin.firestore.Timestamp.now();
    }

    batch.set(participanteRef, participanteUpdate, { merge: true });

    // Log de atividade
    const saldoAnterior = creditos;
    if (usandoCredito) {
      logAtividadeBatch(batch, uid, 'gasto', -CONFIG_MOMENTUM.creditosPorPergunta, saldoAnterior, 
        `Crédito usado para pergunta no jogo (Momentum v3)`, { jogoId, perguntaId, fase: novaFase });
    }

    await batch.commit();

    console.log(`⚡ MomentumV3: ${uid} | Fase ${faseAtual}→${novaFase} | ${acertou ? '✅' : '❌'} | Streak ${streakAtual} | Bônus ${momentumBonus} | Restantes ${perguntasRestantes}`);

    // 16. Retornar resultado completo
    const respostaTexto = pergunta.alternativas?.[pergunta.correta] || '';

    return {
      acertou,
      respostaCorreta: pergunta.correta,
      respostaTexto,
      pontosGanhos: pontosFinais,
      pontuacaoBase,
      multiplicador,
      streak: streakAtual,
      maxStreak: maxStreakVal,
      // === MOMENTUM ===
      totalRespondidas: novoTotalRespondidas,
      fase: novaFase,
      fase1Acertos,
      momentumBonus,
      timerAcertosConsecutivos,
      perguntasRestantes,
      timerSegundos,
      momentumGanhou,
      momentumQuebrou,
      timerEncurtou,
      creditosRestantes: usandoCredito ? Math.max(0, creditos - CONFIG_MOMENTUM.creditosPorPergunta) : creditos,
      modeloV3: true
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Erro responderPerguntaMomentumV3:', error);
    throw new functions.https.HttpsError('internal', 'Erro interno ao processar resposta');
  }
});


/**
 * ADIANTAR PERGUNTAS MOMENTUM V3
 * 
 * 1 crédito = 1 pergunta instantânea
 * Funciona em qualquer fase
 * Na fase 2: adiciona +1 pergunta ao pool
 * Na fase 3: permite responder agora (sem esperar timer)
 */
exports.adiantarPerguntasMomentumV3 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { jogoId } = data;

  if (!jogoId) {
    throw new functions.https.HttpsError('invalid-argument', 'jogoId obrigatório');
  }

  try {
    // 1. Buscar jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');

    // 2. Buscar usuário
    const userRef = db.collection('usuarios').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'Usuário não encontrado');
    const userData = userDoc.data();
    const creditos = userData.creditos || 0;

    if (creditos < CONFIG_MOMENTUM.creditosPorPergunta) {
      throw new functions.https.HttpsError('resource-exhausted',
        'Créditos insuficientes. Você precisa de pelo menos 1 crédito!');
    }

    // 3. Buscar participante
    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    const participanteDoc = await participanteRef.get();
    if (!participanteDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Participante não encontrado. Entre na partida primeiro!');
    }
    const participante = participanteDoc.data();
    const faseAtual = participante.faseAtual || 3;
    const novoSkips = (participante.skipsUsados || 0) + 1;
    const novoCreditos = creditos - CONFIG_MOMENTUM.creditosPorPergunta;

    // 4. Batch write
    const batch = db.batch();

    // Update participante
    const participanteUpdate = {
      skipsUsados: novoSkips,
      atualizadoEm: admin.firestore.Timestamp.now()
    };

    // Na fase 3: resetar timer (permite responder agora)
    if (faseAtual === 3) {
      participanteUpdate.fase3InicioEm = admin.firestore.Timestamp.fromMillis(0); // Timer "expirado"
    }

    // Na fase 2: adicionar uma pergunta ao pool
    if (faseAtual === 2) {
      participanteUpdate.perguntasRestantesFase2 = (participante.perguntasRestantesFase2 || 0) + 1;
    }

    batch.update(participanteRef, participanteUpdate);

    // Descontar crédito
    batch.update(userRef, {
      creditos: admin.firestore.FieldValue.increment(-CONFIG_MOMENTUM.creditosPorPergunta)
    });

    // Log
    logAtividadeBatch(batch, uid, 'gasto', -CONFIG_MOMENTUM.creditosPorPergunta, creditos,
      `Skip Momentum v3 (Fase ${faseAtual})`, { jogoId, fase: faseAtual });

    await batch.commit();

    console.log(`💎 MomentumV3 Skip: ${uid} usou ${CONFIG_MOMENTUM.creditosPorPergunta} crédito no jogo ${jogoId} (Fase ${faseAtual})`);

    return {
      sucesso: true,
      perguntasLiberadas: 1,
      creditosRestantes: novoCreditos,
      skipsUsados: novoSkips,
      fase: faseAtual
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Erro adiantarPerguntasMomentumV3:', error);
    throw new functions.https.HttpsError('internal', 'Erro interno ao adiantar pergunta');
  }
});



// ═══════════════════════════════════════════════════════════
// 🎯 SISTEMA DE RODADAS (substitui Momentum V3)
// 
// Rodada 1: 10 perguntas
// Rodada 2: X perguntas (X = acertos da rodada anterior)
// Rodada 3: Y perguntas (Y = acertos da rodada 2)
// ... até 0 acertos → entra em modo Timer
// Timer: 1 pergunta por intervalo (baseado no passe)
//   Free: 2min | Semanal: 1:30 | Mensal: 1min | Anual: 45s
// Pergunta não respondida não acumula
// ═══════════════════════════════════════════════════════════

const CONFIG_RODADAS = {
  perguntasIniciais: 10,
  timerFree: 120,       // 2 minutos
  timerSemanal: 90,     // 1:30
  timerMensal: 60,      // 1 minuto
  timerAnual: 45,       // 45 segundos
  creditosPorPergunta: 1,
};

function getTimerIntervalo(tipoPasse) {
  switch (tipoPasse) {
    case 'anual': return CONFIG_RODADAS.timerAnual;
    case 'mensal': return CONFIG_RODADAS.timerMensal;
    case 'semanal': return CONFIG_RODADAS.timerSemanal;
    default: return CONFIG_RODADAS.timerFree;
  }
}

exports.responderPerguntaRodadas = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  const uid = context.auth.uid;
  const { jogoId, perguntaId, resposta: respostaUser, tempoResposta, usandoCredito } = data;

  if (!jogoId || !perguntaId || !respostaUser) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos');
  }

  try {
    const batch = db.batch();
    const agora = new Date();
    const tempoRespostaSegundos = tempoResposta || 10;

    // 1. Verificar jogo
    const jogoRef = db.collection('jogos').doc(jogoId);
    const jogoDoc = await jogoRef.get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogo = jogoDoc.data();

    // 2. Buscar pergunta do server
    const perguntaRef = db.collection('perguntas').doc(perguntaId);
    const perguntaDoc = await perguntaRef.get();
    if (!perguntaDoc.exists) throw new functions.https.HttpsError('not-found', 'Pergunta não encontrada');
    const pergunta = perguntaDoc.data();
    const correta = pergunta.correta;
    const pontuacaoBase = pergunta.pontuacao || pergunta.pontos || 10;

    // 3. Buscar participante
    const participanteRef = jogoRef.collection('participantes').doc(uid);
    const participanteDoc = await participanteRef.get();

    let participante = {};
    if (participanteDoc.exists) {
      participante = participanteDoc.data();
    }

    // 4. Buscar dados do usuário (passe, créditos)
    const userRef = db.collection('usuarios').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};
    let creditos = userData.creditos || 0;

    const temPasse = await verificarPasse(uid);
    const passe = userData.passe || {};
    let tipoPasse = 'free';
    if (temPasse && passe.tipo) tipoPasse = passe.tipo;
    const timeTorcida = participante.timeId || data.timeId;

    // 5. Estado das rodadas
    let rodadaAtual = participante.rodadaAtual || 1;
    let perguntasTotalRodada = participante.perguntasTotalRodada || CONFIG_RODADAS.perguntasIniciais;
    let respondidasRodada = participante.respondidasRodada || 0;
    let acertosRodada = participante.acertosRodada || 0;
    let totalRespondidas = participante.totalRespondidas || 0;
    let emTimer = participante.emTimer || false;
    let skipsUsados = participante.skipsUsados || 0;

    // 6. Verificar se pode responder
    let podeResponder = false;

    if (usandoCredito) {
      if (creditos < CONFIG_RODADAS.creditosPorPergunta) {
        throw new functions.https.HttpsError('resource-exhausted', 'Créditos insuficientes');
      }
      podeResponder = true;
    } else if (!emTimer) {
      // Modo rodadas: tem perguntas restantes na rodada?
      podeResponder = respondidasRodada < perguntasTotalRodada;
    } else {
      // Modo timer: verificar se intervalo passou
      const ultimaResposta = participante.ultimaRespostaEm?.toDate?.()?.getTime() || 0;
      const intervalo = getTimerIntervalo(tipoPasse);
      const tempoPassado = (agora.getTime() - ultimaResposta) / 1000;
      podeResponder = tempoPassado >= intervalo || skipsUsados > (participante.skipsVerificados || 0);

      if (podeResponder && skipsUsados > (participante.skipsVerificados || 0)) {
        await participanteRef.update({ skipsVerificados: skipsUsados });
      }
    }

    if (!podeResponder) {
      const intervalo = getTimerIntervalo(tipoPasse);
      throw new functions.https.HttpsError('resource-exhausted',
        JSON.stringify({
          tipo: 'cooldown',
          totalRespondidas,
          emTimer,
          rodadaAtual,
          timerIntervalo: intervalo,
          mensagem: emTimer
            ? `Aguarde ${intervalo}s ou use 💎 1 crédito`
            : 'Aguarde para responder'
        })
      );
    }

    // 7. Anti-bot
    if (tempoRespostaSegundos < (CONFIG_PARTIDA?.tempoMinimoResposta || 1.5)) {
      throw new functions.https.HttpsError('failed-precondition', 'Resposta muito rápida');
    }

    // 8. Verificar resposta
    const acertou = respostaUser === correta;

    // 9. Streak e multiplicador
    let streakAtual = participante.streakAtual || 0;
    let maxStreakVal = participante.maxStreak || 0;

    if (acertou) {
      streakAtual += 1;
      if (streakAtual > maxStreakVal) maxStreakVal = streakAtual;
    } else {
      streakAtual = 0;
    }

    let multiplicador = 1;
    if (streakAtual >= 10) multiplicador = 3;
    else if (streakAtual >= 7) multiplicador = 2.5;
    else if (streakAtual >= 5) multiplicador = 2;
    else if (streakAtual >= 3) multiplicador = 1.5;

    const pontosFinais = acertou ? Math.round(pontuacaoBase * multiplicador) : 0;

    // 10. Atualizar estado das rodadas
    totalRespondidas++;
    let novaRodada = false;
    let entrarTimer = false;

    if (!emTimer) {
      respondidasRodada++;
      if (acertou) acertosRodada++;

      // Acabou a rodada?
      if (respondidasRodada >= perguntasTotalRodada) {
        if (acertosRodada > 0) {
          // Nova rodada com N = acertos da rodada anterior
          rodadaAtual++;
          perguntasTotalRodada = acertosRodada;
          respondidasRodada = 0;
          acertosRodada = 0;
          novaRodada = true;
          console.log(`🎯 ${uid} → Rodada ${rodadaAtual} com ${perguntasTotalRodada} perguntas`);
        } else {
          // 0 acertos → modo timer
          emTimer = true;
          entrarTimer = true;
          console.log(`⏳ ${uid} → Entrou no Timer (${tipoPasse}: ${getTimerIntervalo(tipoPasse)}s)`);
        }
      }
    }
    // Em modo timer: timer sempre reseta após responder

    // 11. Calcular restantes
    let perguntasRestantes;
    if (emTimer) {
      perguntasRestantes = 0; // Precisa esperar timer
    } else {
      perguntasRestantes = Math.max(0, perguntasTotalRodada - respondidasRodada);
    }

    const timerIntervalo = getTimerIntervalo(tipoPasse);

    // 12. Acertos/erros totais
    let acertos = (participante.acertos || 0) + (acertou ? 1 : 0);
    let erros = (participante.erros || 0) + (acertou ? 0 : 1);

    // 13. Update user
    const userUpdates = {};
    // ✅ SEMPRE salvar pergunta respondida (deduplicação)
    userUpdates[`perguntasRespondidas_${timeTorcida}`] = admin.firestore.FieldValue.arrayUnion(perguntaId);
    userUpdates['stats.totalPerguntas'] = admin.firestore.FieldValue.increment(1);
    if (acertou) {
      userUpdates[`pontuacoes.${jogoId}`] = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates.xp = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates[`tempoRespostas.${jogoId}.soma`] = admin.firestore.FieldValue.increment(tempoRespostaSegundos);
      userUpdates[`tempoRespostas.${jogoId}.quantidade`] = admin.firestore.FieldValue.increment(1);
      userUpdates['stats.totalAcertos'] = admin.firestore.FieldValue.increment(1);
    }
    if (usandoCredito) {
      userUpdates.creditos = admin.firestore.FieldValue.increment(-CONFIG_RODADAS.creditosPorPergunta);
    }
    if (Object.keys(userUpdates).length > 0) {
      batch.update(userRef, userUpdates);
    }

    // 14. Update participante
    let timeNome = participante.timeNome || 'Time';
    try {
      const timeDoc = await db.collection('times').doc(timeTorcida).get();
      if (timeDoc.exists) timeNome = timeDoc.data().nome || 'Time';
    } catch(e) {}

    const participanteUpdate = {
      odId: uid,
      nome: userData.usuarioUnico || userData.usuario || userData.nome || 'Anônimo',
      avatarUrl: userData.avatarUrl || userData.avatar || userData.photoURL || '',
      timeId: timeTorcida,
      timeNome,
      pontos: (participante.pontos || 0) + pontosFinais,
      acertos, erros,
      streakAtual, maxStreak: maxStreakVal,
      tempoSoma: (participante.tempoSoma || 0) + (acertou ? tempoRespostaSegundos : 0),
      tempoQuantidade: (participante.tempoQuantidade || 0) + (acertou ? 1 : 0),
      tempoMedio: acertou
        ? ((participante.tempoSoma || 0) + tempoRespostaSegundos) / ((participante.tempoQuantidade || 0) + 1)
        : participante.tempoMedio || 0,
      // === RODADAS ===
      totalRespondidas,
      rodadaAtual,
      perguntasTotalRodada,
      respondidasRodada,
      acertosRodada,
      emTimer,
      tipoPasse,
      skipsUsados,
      ultimaRespostaEm: admin.firestore.Timestamp.now(),
      modeloRodadas: true,
      entradaEm: participante.entradaEm || admin.firestore.Timestamp.now(),
      atualizadoEm: admin.firestore.Timestamp.now(),
    };

    batch.set(participanteRef, participanteUpdate, { merge: true });

    // Log atividade
    if (usandoCredito) {
      logAtividadeBatch(batch, uid, 'gasto', -CONFIG_RODADAS.creditosPorPergunta, creditos,
        'Crédito usado para pergunta (Rodadas)', { jogoId, perguntaId, rodadaAtual });
    }

    // Atualizar stats da pergunta
    if (acertou) {
      batch.update(perguntaRef, { totalAcertos: admin.firestore.FieldValue.increment(1) });
    } else {
      batch.update(perguntaRef, { totalErros: admin.firestore.FieldValue.increment(1) });
    }

    await batch.commit();

    console.log(`🎯 Rodadas: ${uid} | R${rodadaAtual} ${respondidasRodada}/${perguntasTotalRodada} | ${acertou ? '✅' : '❌'} | Streak ${streakAtual} | Timer ${emTimer}`);

    return {
      acertou,
      respostaCorreta: correta,
      respostaTexto: pergunta.alternativas?.[correta] || '',
      pontosGanhos: pontosFinais,
      pontuacaoBase,
      multiplicador,
      streak: streakAtual,
      maxStreak: maxStreakVal,
      // === RODADAS ===
      totalRespondidas,
      rodadaAtual,
      perguntasTotalRodada,
      respondidasRodada,
      acertosRodada,
      perguntasRestantes,
      emTimer,
      timerIntervalo,
      novaRodada,
      entrarTimer,
      tipoPasse,
      creditosRestantes: usandoCredito ? Math.max(0, creditos - CONFIG_RODADAS.creditosPorPergunta) : creditos,
      modeloRodadas: true,
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Erro responderPerguntaRodadas:', error);
    throw new functions.https.HttpsError('internal', 'Erro interno');
  }
});


/**
 * ADIANTAR PERGUNTA (RODADAS)
 * 1 crédito = 1 pergunta instantânea
 */
exports.adiantarPerguntaRodadas = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  }

  const uid = context.auth.uid;
  const { jogoId } = data;

  try {
    const userRef = db.collection('usuarios').doc(uid);
    const userDoc = await userRef.get();
    const creditos = userDoc.data()?.creditos || 0;

    if (creditos < CONFIG_RODADAS.creditosPorPergunta) {
      throw new functions.https.HttpsError('resource-exhausted', 'Créditos insuficientes');
    }

    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    const pDoc = await participanteRef.get();
    const p = pDoc.exists ? pDoc.data() : {};

    const novoSkips = (p.skipsUsados || 0) + 1;

    const batch = db.batch();
    batch.update(userRef, { creditos: admin.firestore.FieldValue.increment(-1) });

    const updates = { skipsUsados: novoSkips, atualizadoEm: admin.firestore.Timestamp.now() };

    if (p.emTimer) {
      // No timer: resetar o timestamp pra permitir responder agora
      updates.ultimaRespostaEm = admin.firestore.Timestamp.fromDate(new Date(0));
    } else {
      // Nas rodadas: adicionar +1 pergunta à rodada atual
      updates.perguntasTotalRodada = (p.perguntasTotalRodada || 10) + 1;
    }

    batch.set(participanteRef, updates, { merge: true });

    logAtividadeBatch(batch, uid, 'gasto', -1, creditos, 'Skip pergunta (Rodadas)', { jogoId });
    await batch.commit();

    return {
      sucesso: true,
      perguntasLiberadas: 1,
      creditosRestantes: creditos - 1,
      skipsUsados: novoSkips,
    };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Erro adiantarPerguntaRodadas:', error);
    throw new functions.https.HttpsError('internal', 'Erro interno');
  }
});

// =====================================================
// ⚽ API-FOOTBALL INTEGRATION (api-sports.io)
// =====================================================
const API_FOOTBALL_KEY = '35647fb22d9fa6e5ab4397cb1a0d27a3';
const API_FOOTBALL_HOST = 'v3.football.api-sports.io';

// 🎲 ODDS-API.IO — odds ao vivo Bet365 + 50 bookmakers, 12.000 ligas
// Grátis: 100 req/hora. Chave em: https://odds-api.io (sem cartão)
// INSTRUÇÃO: cole sua chave aqui após criar conta no odds-api.io
const ODDS_API_IO_KEY = process.env.ODDS_API_IO_KEY || ''; // coloque sua chave aqui

function apiFootballGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_FOOTBALL_HOST,
      path: endpoint,
      method: 'GET',
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// =====================================================
// 🧠 PLAYER PHOTO CACHE (para Goal Card estilo ESPN)
// Cache por (playerId, season) para reduzir chamadas.
// =====================================================
async function getPlayerPhotoCached(playerId, season) {
  try {
    if (!playerId || !season) return '';
    const key = `${playerId}_${season}`;
    const ref = db.collection('players_cache').doc(key);
    const snap = await ref.get();
    if (snap.exists) return snap.data().photo || '';
    // API-Football: players por id + season (algumas ligas exigem season)
    const r = await apiFootballGet(`/players?id=${playerId}&season=${season}`);
    const photo = (r.response && r.response[0] && r.response[0].player && r.response[0].player.photo) ? r.response[0].player.photo : '';
    if (photo) {
      await ref.set({
        playerId,
        season,
        photo,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return photo || '';
  } catch (e) {
    console.log('getPlayerPhotoCached skip:', e.message);
    return '';
  }
}

// 🔍 BUSCAR PARTIDA NA API (admin usa pra encontrar o ID)
exports.buscarPartidaAPIFootball = functions.https.onCall(async (data, context) => {
  try {
    const { timeA, timeB, data: dataJogo, liga } = data;
    let endpoint = '/fixtures?';
    
    if (data.fixtureId) {
      // Busca direta por ID
      endpoint += `id=${data.fixtureId}`;
    } else if (dataJogo) {
      // Busca por data
      endpoint += `date=${dataJogo}`;
      if (liga) endpoint += `&league=${liga}`;
    } else if (liga) {
      // Busca por liga (próximos jogos)
      const hoje = new Date().toISOString().split('T')[0];
      endpoint += `league=${liga}&season=2025&from=${hoje}&to=${hoje}`;
    }

    console.log(`🔍 API-Football: GET ${endpoint}`);
    const result = await apiFootballGet(endpoint);
    
    if (!result.response || result.response.length === 0) {
      return { sucesso: false, msg: 'Nenhuma partida encontrada', resultado: [] };
    }

    // Simplificar resposta
    const partidas = result.response.map(f => ({
      fixtureId: f.fixture.id,
      data: f.fixture.date,
      status: f.fixture.status.short,
      statusLong: f.fixture.status.long,
      minutos: f.fixture.status.elapsed,
      timeCasa: { id: f.teams.home.id, nome: f.teams.home.name, logo: f.teams.home.logo },
      timeFora: { id: f.teams.away.id, nome: f.teams.away.name, logo: f.teams.away.logo },
      placar: { casa: f.goals.home, fora: f.goals.away },
      liga: { id: f.league.id, nome: f.league.name, pais: f.league.country, logo: f.league.logo }
    }));

    // Filtrar por nome do time se fornecido
    let filtradas = partidas;
    if (timeA) {
      const termA = timeA.toLowerCase();
      filtradas = filtradas.filter(p => 
        p.timeCasa.nome.toLowerCase().includes(termA) || 
        p.timeFora.nome.toLowerCase().includes(termA)
      );
    }

    return { sucesso: true, total: filtradas.length, partidas: filtradas.slice(0, 20) };
  } catch (error) {
    console.error('❌ Erro buscarPartidaAPIFootball:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// 🔍 BUSCAR LIGAS NA API
exports.buscarLigasAPIFootball = functions.https.onCall(async (data, context) => {
  try {
    const { pais, busca } = data;
    let endpoint = '/leagues?';
    if (pais) endpoint += `country=${encodeURIComponent(pais)}`;
    if (data.season) endpoint += `&season=${data.season}`;
    
    const result = await apiFootballGet(endpoint);
    const ligas = (result.response || []).map(l => ({
      id: l.league.id,
      nome: l.league.name,
      tipo: l.league.type,
      logo: l.league.logo,
      pais: l.country.name,
      paisFlag: l.country.flag
    }));

    let filtradas = ligas;
    if (busca) {
      const termo = busca.toLowerCase();
      filtradas = ligas.filter(l => l.nome.toLowerCase().includes(termo) || l.pais.toLowerCase().includes(termo));
    }

    return { sucesso: true, total: filtradas.length, ligas: filtradas.slice(0, 50) };
  } catch (error) {
    console.error('❌ Erro buscarLigasAPIFootball:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ⚽ ATUALIZAR PLACAR AO VIVO (chamada por Cloud Scheduler ou manual)
exports.atualizarPlacarAoVivo = functions.https.onCall(async (data, context) => {
  try {
    // Buscar todos os jogos ao_vivo com apiFootballId
    const jogosSnap = await db.collection('jogos')
      .where('status', '==', 'ao_vivo')
      .get();

    if (jogosSnap.empty) {
      console.log('⚽ Nenhum jogo ao vivo');
      return { sucesso: true, atualizados: 0 };
    }

    let atualizados = 0;
    const batch = db.batch();

    for (const jogoDoc of jogosSnap.docs) {
      const jogo = jogoDoc.data();
      const apiId = jogo.apiFootballId;
      if (!apiId) continue;

      try {
        const result = await apiFootballGet(`/fixtures?id=${apiId}`);
        if (!result.response || result.response.length === 0) continue;

        const fixture = result.response[0];
        const statusMap = {
          'NS': 'agendado', '1H': 'ao_vivo', 'HT': 'intervalo', '2H': 'ao_vivo',
          'ET': 'ao_vivo', 'P': 'ao_vivo', 'FT': 'finalizado', 'AET': 'finalizado',
          'PEN': 'finalizado', 'BT': 'intervalo', 'SUSP': 'suspenso',
          'INT': 'interrompido', 'PST': 'adiado', 'CANC': 'cancelado',
          'ABD': 'abandonado', 'AWD': 'finalizado', 'WO': 'finalizado', 'LIVE': 'ao_vivo'
        };

        const updateData = {
          placarCasa: fixture.goals.home ?? 0,
          placarFora: fixture.goals.away ?? 0,
          minutosJogo: fixture.fixture.status.elapsed || 0,
          statusPartida: statusMap[fixture.fixture.status.short] || fixture.fixture.status.short,
          statusPartidaDetalhe: fixture.fixture.status.long,
          apiUltimaAtualizacao: admin.firestore.FieldValue.serverTimestamp()
        };

        // Buscar eventos (gols, cartões, substituições)
        const eventsResult = await apiFootballGet(`/fixtures/events?fixture=${apiId}`);
        if (eventsResult.response && eventsResult.response.length > 0) {
          // Enriquecer eventos com fotos (cache) — sem penalizar quem não tem photo
          const season = fixture.league?.season || 2025;
          const events = eventsResult.response || [];
          // Coletar IDs únicos para foto (jogador e assist)
          const ids = new Set();
          for (const e of events) {
            if (e.player?.id) ids.add(e.player.id);
            if (e.assist?.id) ids.add(e.assist.id);
          }
          const idList = Array.from(ids).slice(0, 50); // segurança
          const photos = {};
          await Promise.all(idList.map(async (pid) => {
            photos[pid] = await getPlayerPhotoCached(pid, season);
          }));

          updateData.eventosJogo = events.map(e => ({
            tempo: e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : ''),
            tipo: e.type,
            detalhe: e.detail,
            jogador: e.player?.name || '',
            jogadorId: e.player?.id || null,
            playerPhoto: e.player?.id ? (photos[e.player.id] || '') : '',
            time: e.team?.name || '',
            timeId: e.team?.id || null,
            assistencia: e.assist?.name || '',
            assistenciaId: e.assist?.id || null,
            assistenciaPhoto: e.assist?.id ? (photos[e.assist.id] || '') : ''
          }));
}

        // Buscar estatísticas
        try {
          const stResult = await apiFootballGet(`/fixtures/statistics?fixture=${apiId}`);
          if (stResult.response && stResult.response.length >= 2) {
            const parseStat = (arr) => {
              const obj = {};
              (arr || []).forEach(s => { obj[s.type] = s.value; });
              return obj;
            };
            updateData.estatisticasPartida = {
              casa: parseStat(stResult.response[0]?.statistics),
              fora: parseStat(stResult.response[1]?.statistics)
            };
          }
        } catch(stErr) { console.log('Stats skip:', stErr.message); }

        batch.update(jogoDoc.ref, updateData);
        atualizados++;
        console.log(`⚽ ${jogo.timeCasaNome || 'Casa'} ${updateData.placarCasa}x${updateData.placarFora} ${jogo.timeForaNome || 'Fora'} (${updateData.minutosJogo}')`);

      } catch (apiErr) {
        console.error(`❌ Erro API para jogo ${jogoDoc.id}:`, apiErr.message);
      }
    }

    if (atualizados > 0) await batch.commit();
    return { sucesso: true, atualizados };
  } catch (error) {
    console.error('❌ Erro atualizarPlacarAoVivo:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ⏰ SCHEDULED: Atualizar placar a cada 30 segundos (requer Blaze plan)
// Nota: Cloud Scheduler mínimo é 1 minuto. Pra 30s, usamos 2 jobs defasados.
// Alternativa: chamar atualizarPlacarAoVivo via cron externo ou do admin.
exports.schedulePlacarMinuto = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    try {
      // ── Passo 1: verificar se há jogos ao_vivo no Firestore ──
      // Se não tiver, sai sem fazer NENHUMA chamada à API
      const jogosSnap = await db.collection('jogos')
        .where('status', '==', 'ao_vivo')
        .get();

      if (jogosSnap.empty) return null;

      const jogosComApi = jogosSnap.docs.filter(d => d.data().apiFootballId);
      if (jogosComApi.length === 0) return null;

      // Montar set dos IDs que nos interessam
      const idsInteresse = new Set(jogosComApi.map(d => String(d.data().apiFootballId)));

      // ── Passo 2: UMA única chamada traz todos os jogos ao vivo do mundo ──
      // Em vez de N chamadas (1 por jogo), buscamos tudo de uma vez
      const liveResult = await apiFootballGet('/fixtures?live=all');
      const liveFixtures = liveResult.response || [];

      if (liveFixtures.length === 0) return null;

      // ── Passo 3: filtrar só os jogos que estão no nosso Firestore ──
      const fixturesNossos = liveFixtures.filter(f =>
        idsInteresse.has(String(f.fixture.id))
      );

      if (fixturesNossos.length === 0) {
        console.log('⚽ Nenhum jogo nosso ao vivo no momento');
        return null;
      }

      // ── Passo 4: buscar eventos só dos jogos nossos ──
      // Mas com throttle: no máximo 5 chamadas de eventos por execução
      // Para jogos com mudança de placar (gol), sempre busca eventos
      // Para outros, busca em rodízio (não precisa de eventos a cada minuto)
      const batch = db.batch();
      const agora = admin.firestore.FieldValue.serverTimestamp();

      // Controle de rodízio: qual índice buscar eventos agora
      const cacheRodRef = db.collection('cache_api').doc('placar_rodizio');
      const rodSnap = await cacheRodRef.get();
      const rodizioIdx = (rodSnap.data()?.idx || 0) % Math.max(fixturesNossos.length, 1);
      await cacheRodRef.set({ idx: rodizioIdx + 1 });

      for (let i = 0; i < fixturesNossos.length; i++) {
        const f = fixturesNossos[i];
        const jogoDoc = jogosComApi.find(d => String(d.data().apiFootballId) === String(f.fixture.id));
        if (!jogoDoc) continue;

        const jogoAtual = jogoDoc.data();
        const minJogo = f.fixture.status.elapsed || 0;

        const up = {
          placarCasa:    f.goals.home ?? 0,
          placarFora:    f.goals.away ?? 0,
          minutosJogo:   minJogo,
          statusPartida: f.fixture.status.long,
          apiUltimaAtualizacao: agora,
        };

        // Houve gol? Sempre busca eventos quando placar muda
        const golNovo = (f.goals.home ?? 0) !== (jogoAtual.placarCasa ?? -1) ||
                        (f.goals.away ?? 0) !== (jogoAtual.placarFora ?? -1);

        // Buscar eventos: só se teve gol OU é a vez deste jogo no rodízio
        const vezDoRodizio = (i === rodizioIdx);
        if (golNovo || vezDoRodizio) {
          try {
            const ev = await apiFootballGet(`/fixtures/events?fixture=${f.fixture.id}`);
            if (ev.response?.length > 0) {
              up.eventosJogo = ev.response.map(e => ({
                tempo:       e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : ''),
                tipo:        e.type,
                detalhe:     e.detail,
                jogador:     e.player?.name || '',
                jogadorId:   e.player?.id || null,
                time:        e.team?.name || '',
                timeId:      e.team?.id || null,
                assistencia: e.assist?.name || '',
                assistenciaId: e.assist?.id || null,
              }));
            }
          } catch(evErr) { console.log('Eventos skip:', evErr.message); }
        }

        // Estatísticas: a cada 5 minutos, só para o jogo da vez no rodízio
        if (minJogo > 0 && minJogo % 5 === 0 && vezDoRodizio) {
          try {
            const st = await apiFootballGet(`/fixtures/statistics?fixture=${f.fixture.id}`);
            if (st.response?.length >= 2) {
              const parseStat = arr => {
                const obj = {};
                (arr || []).forEach(s => { obj[s.type] = s.value; });
                return obj;
              };
              up.estatisticasPartida = {
                casa: parseStat(st.response[0]?.statistics),
                fora: parseStat(st.response[1]?.statistics),
              };
            }
          } catch(stErr) { console.log('Stats skip:', stErr.message); }
        }

        batch.update(jogoDoc.ref, up);
      }

      await batch.commit();
      console.log(`⚽ ${fixturesNossos.length} jogos atualizados — 1 chamada live + ${fixturesNossos.length <= 1 ? 1 : '~1-2'} eventos`);

      return null;
    } catch(e) {
      console.error('Erro schedulePlacarMinuto:', e);
      return null;
    }
  });

// 🔍 BUSCAR TIMES NA API (pra importar pro Firestore)
exports.buscarTimesAPIFootball = functions.https.onCall(async (data, context) => {
  try {
    const { pais, liga, busca } = data;
    let endpoint = '/teams?';
    if (liga) endpoint += `league=${liga}&season=2025`;
    else if (pais) endpoint += `country=${encodeURIComponent(pais)}`;
    else if (busca) endpoint += `search=${encodeURIComponent(busca)}`;
    else return { sucesso: false, msg: 'Informe liga, país ou busca' };

    const result = await apiFootballGet(endpoint);
    const times = (result.response || []).map(t => ({
      apiId: t.team.id,
      nome: t.team.name,
      codigo: t.team.code,
      pais: t.team.country,
      fundado: t.team.founded,
      logo: t.team.logo,
      estadio: t.venue?.name || '',
      cidade: t.venue?.city || '',
      capacidade: t.venue?.capacity || 0
    }));

    return { sucesso: true, total: times.length, times };
  } catch (error) {
    console.error('❌ Erro buscarTimesAPIFootball:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// =====================================================
// ⚽ JOGOS AO VIVO & HOJE — Página pública
// =====================================================
exports.buscarJogosHoje = functions.https.onCall(async (data, context) => {
  try {
    const { ligas, apenasAoVivo } = data || {};
    
    // Cache no Firestore (60s) pra não gastar req desnecessárias
    const cacheRef = db.collection('cache_api').doc('jogos_hoje');
    const cacheDoc = await cacheRef.get();
    const agora = Date.now();
    
    if (cacheDoc.exists) {
      const cache = cacheDoc.data();
      const idade = agora - (cache.timestamp || 0);
      if (idade < 60000) { // cache válido por 60s
        console.log('⚽ Cache hit jogos_hoje');
        return { sucesso: true, fonte: 'cache', ...cache.dados };
      }
    }

    // Buscar ao vivo
    const aoVivoResult = await apiFootballGet('/fixtures?live=all');
    let aoVivo = (aoVivoResult.response || []).map(formatFixture);

    // Buscar jogos do dia
    const hoje = new Date().toISOString().split('T')[0];
    const hojeResult = await apiFootballGet(`/fixtures?date=${hoje}`);
    let hojeJogos = (hojeResult.response || []).map(formatFixture);

    // Filtrar por ligas se especificado
    const ligasFavoritas = ligas || [71, 72, 13, 2, 3, 39, 135, 140, 61, 78]; // Brasileirão A/B, Libertadores, Champions, etc
    
    // Separar categorias
    const dados = {
      aoVivo: aoVivo.filter(j => ligasFavoritas.length === 0 || ligasFavoritas.includes(j.liga.id)),
      aoVivoOutros: aoVivo.filter(j => ligasFavoritas.length > 0 && !ligasFavoritas.includes(j.liga.id)),
      agendados: hojeJogos.filter(j => j.status === 'NS').sort((a,b) => new Date(a.data) - new Date(b.data)),
      finalizados: hojeJogos.filter(j => ['FT','AET','PEN'].includes(j.statusCode)).sort((a,b) => new Date(b.data) - new Date(a.data)),
      totalAoVivo: aoVivo.length,
      totalHoje: hojeJogos.length
    };

    // Salvar cache
    await cacheRef.set({ timestamp: agora, dados }, { merge: true });

    return { sucesso: true, fonte: 'api', ...dados };
  } catch (error) {
    console.error('❌ Erro buscarJogosHoje:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

function formatFixture(f) {
  return {
    id: f.fixture.id,
    data: f.fixture.date,
    timestamp: f.fixture.timestamp,
    status: f.fixture.status.long,
    statusCode: f.fixture.status.short,
    minutos: f.fixture.status.elapsed,
    timeCasa: { id: f.teams.home.id, nome: f.teams.home.name, logo: f.teams.home.logo, vencendo: f.teams.home.winner },
    timeFora: { id: f.teams.away.id, nome: f.teams.away.name, logo: f.teams.away.logo, vencendo: f.teams.away.winner },
    placar: { casa: f.goals.home, fora: f.goals.away },
    liga: { id: f.league.id, nome: f.league.name, pais: f.league.country, logo: f.league.logo, bandeira: f.league.flag, rodada: f.league.round }
  };
}

// =====================================================
// 📡 MAPEAMENTO API-FOOTBALL → FIRESTORE
// Vincula times/campeonatos existentes com apiFootballId
// =====================================================

// HELPER: Normalizar nome pra comparação
function normalizarNome(nome) {
  return nome
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*-\s*/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// HELPER: UF por cidade (pra criar times BR novos com padrão "Nome - UF")
function obterUF(cidade) {
  const mapa = {
    "Porto Alegre":"RS","Caxias do Sul":"RS","Novo Hamburgo":"RS","Pelotas":"RS","Passo Fundo":"RS",
    "São Paulo":"SP","Campinas":"SP","Santos":"SP","Barueri":"SP","São Bernardo do Campo":"SP","Itu":"SP","Limeira":"SP","Ribeirão Preto":"SP","Mirassol":"SP","Bragança Paulista":"SP","Diadema":"SP","Osasco":"SP","Santo André":"SP","São José dos Campos":"SP","Sorocaba":"SP","Piracicaba":"SP","Jundiaí":"SP","Mogi das Cruzes":"SP","Guarulhos":"SP","Presidente Prudente":"SP","Novo Horizonte":"SP",
    "Rio de Janeiro":"RJ","Volta Redonda":"RJ","Nova Iguaçu":"RJ","São Gonçalo":"RJ","Niterói":"RJ","Macaé":"RJ","Resende":"RJ",
    "Belo Horizonte":"MG","Uberlândia":"MG","Juiz de Fora":"MG","Pouso Alegre":"MG","Tombos":"MG","Muriaé":"MG","Ipatinga":"MG","Sete Lagoas":"MG","Governador Valadares":"MG","Patrocínio":"MG",
    "Curitiba":"PR","Londrina":"PR","Maringá":"PR","Ponta Grossa":"PR","Cascavel":"PR","Paranaguá":"PR","Cianorte":"PR",
    "Florianópolis":"SC","Joinville":"SC","Criciúma":"SC","Brusque":"SC","Chapecó":"SC","Blumenau":"SC","Concórdia":"SC","Barra Velha":"SC","Tubarão":"SC",
    "Salvador":"BA","Feira de Santana":"BA","Vitória da Conquista":"BA","Ilhéus":"BA",
    "Recife":"PE","Caruaru":"PE",
    "Fortaleza":"CE","Juazeiro do Norte":"CE","Iguatu":"CE","Horizonte":"CE",
    "Belém":"PA","Ananindeua":"PA",
    "Manaus":"AM",
    "Goiânia":"GO","Aparecida de Goiânia":"GO","Anápolis":"GO",
    "Brasília":"DF","Taguatinga":"DF",
    "São Luís":"MA",
    "Maceió":"AL",
    "João Pessoa":"PB","Campina Grande":"PB",
    "Natal":"RN",
    "Aracaju":"SE",
    "Cuiabá":"MT",
    "Campo Grande":"MS",
    "Macapá":"AP",
    "Porto Velho":"RO",
    "Rio Branco":"AC",
    "Palmas":"TO",
    "Teresina":"PI",
    "Vitória":"ES","Vila Velha":"ES","Serra":"ES","Linhares":"ES",
    "Boa Vista":"RR"
  };
  return mapa[cidade] || null;
}

// HELPER: Encontrar melhor match no Firestore
function encontrarMatch(apiNome, apiCountry, timesFirestore) {
  const apiNorm = normalizarNome(apiNome);

  // Alias conhecidos: nome API → possíveis nomes no Yellup
  const aliasMap = {
    "atletico mineiro": ["atletico mineiro mg","atletico mineiro"],
    "athletico paranaense": ["athletico pr"],
    "red bull bragantino": ["bragantino sp","bragantino"],
    "botafogo": ["botafogo rj"],
    "sport recife": ["sport recife","sport pe"],
    "ec bahia": ["bahia ba"],
    "bahia": ["bahia ba"],
    "cuiaba": ["cuiaba mt"],
    "ceara": ["ceara ce"],
    "fortaleza": ["fortaleza ce"],
    "juventude": ["juventude rs"],
    "gremio": ["gremio rs"],
    "internacional": ["internacional rs"],
    "palmeiras": ["palmeiras sp"],
    "santos": ["santos sp"],
    "sao paulo": ["sao paulo sp"],
    "corinthians": ["corinthians sp"],
    "cruzeiro": ["cruzeiro mg"],
    "flamengo": ["flamengo rj"],
    "fluminense": ["fluminense rj"],
    "vasco da gama": ["vasco rj"],
    "vitoria": ["vitoria ba"],
    "america mineiro": ["america mg"],
    "chapecoense": ["chapecoense sc"],
    "coritiba": ["coritiba pr"],
    "goias": ["goias go"],
    "avai": ["avai sc"],
    "nautico": ["nautico pe"],
    "ponte preta": ["ponte preta sp"],
    "vila nova": ["vila nova go"],
    "paysandu": ["paysandu pa"],
    "remo": ["remo pa"],
    "novorizontino": ["novorizontino sp"],
    "guarani": ["guarani sp"],
    "operario ferroviario": ["operario pr"],
    "criciuma": ["criciuma sc"],
    "ituano": ["ituano sp"],
    "mirassol": ["mirassol sp"],
    "figueirense": ["figueirense sc"],
    "brusque": ["brusque sc"],
    "crb": ["crb al","crb"],
    "csa": ["csa al"],
    "sampaio correa": ["sampaio correa ma"],
    "tombense": ["tombense"],
    "abc": ["abc rn"],
    "atletico goianiense": ["atletico go"],
    "agua santa": ["agua santa sp"],
    "sao bernardo": ["sao bernardo sp"],
    "amazonas": ["amazonas am"],
    "londrina": ["londrina pr"],
    "operario pr": ["operario pr"],
    "manchester united": ["manchester united"],
    "manchester city": ["manchester city"],
    "real madrid": ["real madrid"],
    "fc barcelona": ["barcelona"],
    "atletico madrid": ["atletico de madrid","atletico madrid"],
    "juventus": ["juventus"],
    "ac milan": ["milan"],
    "inter": ["internazionale","inter de milao"],
    "bayern munich": ["bayern de munique","bayern munchen"],
    "borussia dortmund": ["borussia dortmund"],
    "paris saint germain": ["paris saint germain","psg"],
    "river plate": ["river plate"],
    "boca juniors": ["boca juniors"],
    "penarol": ["penarol"],
    "nacional": ["nacional"],
    "al hilal": ["al hilal"],
    "al nassr": ["al nassr"],
    "al ahly": ["al ahly"],
    "al ittihad": ["al ittihad"],
  };

  // Mapa de países EN→PT pra comparação
  const paisMap = {
    "brazil":"brasil","england":"inglaterra","spain":"espanha",
    "germany":"alemanha","france":"franca","italy":"italia",
    "portugal":"portugal","netherlands":"holanda","belgium":"belgica",
    "turkey":"turquia","argentina":"argentina","mexico":"mexico",
    "japan":"japao","south-korea":"coreia do sul","south korea":"coreia do sul",
    "saudi-arabia":"arabia saudita","saudi arabia":"arabia saudita",
    "australia":"australia","usa":"estados unidos","united states":"estados unidos",
    "croatia":"croacia","serbia":"servia","colombia":"colombia",
    "uruguay":"uruguai","chile":"chile","ecuador":"equador",
    "peru":"peru","paraguay":"paraguai","venezuela":"venezuela",
    "bolivia":"bolivia","china":"china","scotland":"escocia",
    "denmark":"dinamarca","sweden":"suecia","norway":"noruega",
    "switzerland":"suica","austria":"austria","poland":"polonia",
    "romania":"romenia","greece":"grecia","czech republic":"republica tcheca",
    "ukraine":"ucrania","russia":"russia","ireland":"irlanda",
    "wales":"pais de gales","iceland":"islandia","finland":"finlandia",
    "hungary":"hungria","morocco":"marrocos","egypt":"egito",
    "nigeria":"nigeria","south africa":"africa do sul","cameroon":"camaroes",
    "ghana":"gana","senegal":"senegal","algeria":"argelia",
    "tunisia":"tunisia","iran":"ira","costa rica":"costa rica",
    "honduras":"honduras","panama":"panama","jamaica":"jamaica",
    "qatar":"catar","canada":"canada",
  };

  function mesmoPais(apiPais, fsPais) {
    const a = normalizarNome(apiPais || "");
    const b = normalizarNome(fsPais || "");
    if (a === b) return true;
    if (paisMap[a] === b) return true;
    if (paisMap[a] && normalizarNome(paisMap[a]) === b) return true;
    return false;
  }

  let melhorMatch = null;
  let melhorScore = 0;

  for (const tf of timesFirestore) {
    const tfNorm = normalizarNome(tf.nome || "");

    // Match exato
    if (apiNorm === tfNorm) return { ...tf, score: 100, matchType: "exato" };

    // Match por alias
    const aliases = aliasMap[apiNorm] || [];
    for (const alias of aliases) {
      if (tfNorm.includes(alias) || alias.includes(tfNorm)) {
        return { ...tf, score: 95, matchType: "alias" };
      }
    }

    // Match parcial
    if (tfNorm.includes(apiNorm) || apiNorm.includes(tfNorm)) {
      if (80 > melhorScore) {
        melhorScore = 80;
        melhorMatch = { ...tf, score: 80, matchType: "parcial" };
      }
    }

    // Match por primeira palavra + mesmo país
    const apiP = apiNorm.split(" ")[0];
    const tfP = tfNorm.split(" ")[0];
    if (apiP.length > 3 && apiP === tfP && mesmoPais(apiCountry, tf.pais)) {
      if (75 > melhorScore) {
        melhorScore = 75;
        melhorMatch = { ...tf, score: 75, matchType: "primeira_palavra" };
      }
    }
  }

  return melhorMatch;
}


// ═══════════════════════════════════════
// 1. MAPEAR TIMES DE UMA LIGA
// ═══════════════════════════════════════
exports.mapearTimesLiga = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const leagueId = data?.leagueId;
    const season = data?.season || 2025;
    const dryRun = data?.dryRun !== false;

    if (!leagueId) throw new functions.https.HttpsError("invalid-argument", "leagueId obrigatório");

    // Buscar times da liga na API
    const apiResult = await apiFootballGet(`/teams?league=${leagueId}&season=${season}`);
    const apiTimes = apiResult.response || [];

    // Buscar TODOS os times do Firestore
    const snapshot = await db.collection("times").get();
    const timesFirestore = [];
    snapshot.forEach(doc => { timesFirestore.push({ id: doc.id, ...doc.data() }); });

    const resultados = [];
    const batch = db.batch();
    let mapeados = 0, novos = 0;

    for (const item of apiTimes) {
      const team = item.team;
      const venue = item.venue;

      // Pular femininos/juvenis
      if (team.name && (team.name.includes("Women") || team.name.includes("Femeni") ||
          team.name.includes("U20") || team.name.includes("U17") ||
          team.name.includes("Youth") || team.name.includes("Sub-"))) continue;

      const match = encontrarMatch(team.name, team.country, timesFirestore);

      if (match && match.score >= 70) {
        const updateData = {
          apiFootballId: team.id,
          escudo: team.logo || null,
          abreviacao: team.code || team.name.substring(0, 3).toUpperCase(),
          fundacao: team.founded || null,
          nacional: team.national || false,
        };
        if (venue) {
          updateData.estadio = {
            id: venue.id, nome: venue.name, cidade: venue.city,
            capacidade: venue.capacity, superficie: venue.surface, imagem: venue.image || null
          };
        }
        if (!dryRun) batch.update(db.collection("times").doc(match.id), updateData);
        resultados.push({
          apiId: team.id, apiNome: team.name,
          firestoreId: match.id, firestoreNome: match.nome,
          score: match.score, matchType: match.matchType,
          escudo: team.logo, status: "mapeado"
        });
        mapeados++;
      } else {
        // Criar novo
        let nomeNovo = team.name;
        if (team.country === "Brazil" && venue?.city) {
          const uf = obterUF(venue.city);
          if (uf && !/\s-\s[A-Z]{2}$/.test(nomeNovo)) nomeNovo = `${nomeNovo} - ${uf}`;
        }
        const novoDoc = {
          nome: nomeNovo,
          apiFootballId: team.id,
          escudo: team.logo || null,
          abreviacao: team.code || team.name.substring(0, 3).toUpperCase(),
          primaria: "#333333", secundaria: "#FFFFFF", terciaria: "#333333",
          pais: team.country || null, codigoPais: "",
          tipo: team.national ? "selecao" : "clube",
          fundacao: team.founded || null, nacional: team.national || false,
          estadio: venue ? { id: venue.id, nome: venue.name, cidade: venue.city, capacidade: venue.capacity, superficie: venue.surface, imagem: venue.image || null } : null,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        };
        if (!dryRun) { const ref = db.collection("times").doc(); batch.set(ref, novoDoc); }
        resultados.push({
          apiId: team.id, apiNome: team.name,
          firestoreId: null, firestoreNome: null,
          score: 0, matchType: "novo",
          escudo: team.logo, status: "novo"
        });
        novos++;
      }
    }

    if (!dryRun) await batch.commit();
    console.log(`📡 mapearTimesLiga(${leagueId}): ${mapeados} mapeados, ${novos} novos`);
    return { success: true, dryRun, liga: leagueId, season, mapeados, novos, total: apiTimes.length, resultados };
  });


// ═══════════════════════════════════════
// 2. MAPEAR TODAS AS LIGAS POPULARES
// ═══════════════════════════════════════
exports.mapearTodasLigas = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const dryRun = data?.dryRun !== false;
    const season = data?.season || 2025;

    const ligas = [
      {id:71,nome:"Brasileirão A"},{id:72,nome:"Brasileirão B"},{id:73,nome:"Copa do Brasil"},{id:75,nome:"Série C"},
      {id:128,nome:"Liga Argentina"},{id:129,nome:"Copa Argentina"},
      {id:13,nome:"Libertadores"},{id:11,nome:"Sulamericana"},
      {id:39,nome:"Premier League"},{id:40,nome:"Championship"},
      {id:140,nome:"La Liga"},{id:141,nome:"La Liga 2"},
      {id:135,nome:"Serie A Itália"},{id:136,nome:"Serie B Itália"},
      {id:78,nome:"Bundesliga"},{id:79,nome:"2. Bundesliga"},
      {id:61,nome:"Ligue 1"},{id:62,nome:"Ligue 2"},
      {id:94,nome:"Liga Portugal"},{id:88,nome:"Eredivisie"},
      {id:144,nome:"Pro League Bélgica"},{id:203,nome:"Süper Lig"},
      {id:179,nome:"Scottish Premiership"},
      {id:262,nome:"Liga MX"},{id:253,nome:"MLS"},
      {id:239,nome:"Liga Colombiana"},{id:268,nome:"Liga Uruguaya"},
      {id:265,nome:"Liga Chilena"},{id:242,nome:"Liga Equatoriana"},
      {id:281,nome:"Liga Peruana"},{id:245,nome:"Liga Paraguaya"},
      {id:98,nome:"J1 League"},{id:292,nome:"K League 1"},{id:307,nome:"Saudi Pro League"},
      {id:188,nome:"A-League"},
      {id:2,nome:"Champions League"},{id:3,nome:"Europa League"},{id:848,nome:"Conference League"},
    ];

    // Buscar todos os times do Firestore UMA VEZ
    const snapshot = await db.collection("times").get();
    const timesFirestore = [];
    snapshot.forEach(doc => { timesFirestore.push({ id: doc.id, ...doc.data() }); });
    console.log(`📦 ${timesFirestore.length} times no Firestore`);

    const todosResultados = [];
    let totalMapeados = 0, totalNovos = 0;
    const jaProcessados = new Set();

    for (const liga of ligas) {
      try {
        console.log(`📋 ${liga.nome} (${liga.id})...`);
        const apiResult = await apiFootballGet(`/teams?league=${liga.id}&season=${season}`);
        const apiTimes = apiResult.response || [];

        if (!apiTimes.length) {
          todosResultados.push({ liga: liga.nome, ligaId: liga.id, status: "vazio", timesAPI: 0, mapeados: 0, novos: 0 });
          continue;
        }

        const batch = db.batch();
        let mapeados = 0, novos = 0;

        for (const item of apiTimes) {
          const team = item.team;
          const venue = item.venue;

          if (team.name && (team.name.includes("Women") || team.name.includes("Femeni") ||
              team.name.includes("U20") || team.name.includes("U17") ||
              team.name.includes("Youth") || team.name.includes("Sub-"))) continue;

          if (jaProcessados.has(team.id)) continue;
          jaProcessados.add(team.id);

          // Já mapeado?
          if (timesFirestore.find(t => t.apiFootballId === team.id)) continue;

          const match = encontrarMatch(team.name, team.country, timesFirestore);

          if (match && match.score >= 70) {
            if (!dryRun) {
              batch.update(db.collection("times").doc(match.id), {
                apiFootballId: team.id,
                escudo: team.logo || null,
                abreviacao: team.code || team.name.substring(0, 3).toUpperCase(),
                fundacao: team.founded || null,
                nacional: team.national || false,
                estadio: venue ? { id: venue.id, nome: venue.name, cidade: venue.city, capacidade: venue.capacity, superficie: venue.surface, imagem: venue.image || null } : null,
              });
              match.apiFootballId = team.id;
            }
            mapeados++; totalMapeados++;
          } else {
            let nomeNovo = team.name;
            if (team.country === "Brazil" && venue?.city) {
              const uf = obterUF(venue.city);
              if (uf && !/\s-\s[A-Z]{2}$/.test(nomeNovo)) nomeNovo = `${nomeNovo} - ${uf}`;
            }
            if (!dryRun) {
              batch.set(db.collection("times").doc(), {
                nome: nomeNovo, apiFootballId: team.id,
                escudo: team.logo || null,
                abreviacao: team.code || team.name.substring(0, 3).toUpperCase(),
                primaria: "#333333", secundaria: "#FFFFFF", terciaria: "#333333",
                pais: team.country || null, codigoPais: "",
                tipo: team.national ? "selecao" : "clube",
                fundacao: team.founded || null, nacional: team.national || false,
                estadio: venue ? { id: venue.id, nome: venue.name, cidade: venue.city, capacidade: venue.capacity, superficie: venue.surface, imagem: venue.image || null } : null,
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
              });
            }
            novos++; totalNovos++;
          }
        }

        if (!dryRun) await batch.commit();
        todosResultados.push({ liga: liga.nome, ligaId: liga.id, status: "ok", timesAPI: apiTimes.length, mapeados, novos });
        console.log(`✅ ${liga.nome}: ${mapeados} mapeados, ${novos} novos`);

        // Pausa entre ligas
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`❌ ${liga.nome}: ${err.message}`);
        todosResultados.push({ liga: liga.nome, ligaId: liga.id, status: "erro", erro: err.message, timesAPI: 0, mapeados: 0, novos: 0 });
      }
    }

    return { success: true, dryRun, totalMapeados, totalNovos, totalProcessados: jaProcessados.size, resultados: todosResultados };
  });


// ═══════════════════════════════════════
// 3. MAPEAR CAMPEONATOS
// ═══════════════════════════════════════
exports.mapearCampeonatos = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const dryRun = data?.dryRun !== false;

    const mapeamento = {
      "brasileirao-serie-a": {apiId:71}, "brasileirao-a": {apiId:71}, "brasileirao-b": {apiId:72},
      "brasileirao-c": {apiId:75}, "copa-do-brasil": {apiId:73},
      "supercopa-brasil": {apiId:490},
      "gauchao": {apiId:479}, "paulistao": {apiId:475}, "carioca": {apiId:481},
      "mineiro": {apiId:476}, "paranaense": {apiId:486},
      "liga-argentina": {apiId:128}, "copa-argentina": {apiId:129},
      "libertadores": {apiId:13}, "sulamericana": {apiId:11},
      "copa-america": {apiId:9}, "recopa": {apiId:16},
      "premier-league": {apiId:39}, "championship": {apiId:40},
      "fa-cup": {apiId:45}, "carabao-cup": {apiId:48}, "community-shield": {apiId:528},
      "la-liga": {apiId:140}, "la-liga-2": {apiId:141},
      "copa-del-rey": {apiId:143}, "supercopa-espanha": {apiId:556},
      "serie-a-ita": {apiId:135}, "serie-b-ita": {apiId:136}, "coppa-italia": {apiId:137},
      "bundesliga": {apiId:78}, "bundesliga-2": {apiId:79}, "dfb-pokal": {apiId:81},
      "ligue-1": {apiId:61}, "ligue-2": {apiId:62}, "coupe-de-france": {apiId:66},
      "liga-portugal": {apiId:94}, "taca-portugal": {apiId:96},
      "eredivisie": {apiId:88}, "knvb-cup": {apiId:90},
      "jupiler-pro": {apiId:144},
      "super-lig": {apiId:203},
      "scottish-prem": {apiId:179},
      "liga-mx": {apiId:262}, "mls": {apiId:253},
      "liga-colombia": {apiId:239}, "liga-uruguai": {apiId:268},
      "liga-chile": {apiId:265}, "liga-equador": {apiId:242},
      "liga-peru": {apiId:281}, "us-open-cup": {apiId:257},
      "j-league": {apiId:98}, "k-league": {apiId:292},
      "saudi-league": {apiId:307}, "csl": {apiId:169},
      "afc-cl": {apiId:17}, "copa-asia": {apiId:7},
      "a-league": {apiId:188},
      "ucl": {apiId:2}, "uel": {apiId:3}, "uecl": {apiId:848},
      "eurocopa": {apiId:4}, "nations-league": {apiId:5},
      "can": {apiId:6}, "caf-cl": {apiId:12},
      "concacaf-cl": {apiId:15}, "copa-ouro": {apiId:14},
      "copa-do-mundo": {apiId:1}, "mundial-clubes": {apiId:15},
    };

    const batch = db.batch();
    let count = 0;
    const resultados = [];

    for (const [docId, dados] of Object.entries(mapeamento)) {
      const docRef = db.collection("campeonatos").doc(docId);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const logo = `https://media.api-sports.io/football/leagues/${dados.apiId}.png`;
        if (!dryRun) batch.update(docRef, { apiFootballId: dados.apiId, logo });
        resultados.push({ id: docId, apiId: dados.apiId, status: "atualizado" });
        count++;
      } else {
        resultados.push({ id: docId, apiId: dados.apiId, status: "doc_nao_existe" });
      }
    }

    if (!dryRun) await batch.commit();
    console.log(`📡 mapearCampeonatos: ${count} atualizados`);
    return { success: true, dryRun, total: count, resultados };
  });


// ═══════════════════════════════════════
// 4. MAPEAR SELEÇÕES
// ═══════════════════════════════════════
exports.mapearSelecoes = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const dryRun = data?.dryRun !== false;

    // Buscar seleções via Copa do Mundo 2022 (tem todas)
    const apiResult = await apiFootballGet("/teams?league=1&season=2022");
    const apiTeams = (apiResult.response || []);

    // Buscar seleções do Firestore
    const snapshot = await db.collection("times").where("tipo", "==", "selecao").get();
    const selecoes = [];
    snapshot.forEach(doc => { selecoes.push({ id: doc.id, ...doc.data() }); });

    const paisPT = {
      "Brazil":"Brasil","Argentina":"Argentina","Uruguay":"Uruguai",
      "Paraguay":"Paraguai","Colombia":"Colômbia","Chile":"Chile",
      "Ecuador":"Equador","Peru":"Peru","Bolivia":"Bolívia",
      "Venezuela":"Venezuela","Mexico":"México","USA":"Estados Unidos",
      "Canada":"Canadá","England":"Inglaterra","Spain":"Espanha",
      "Germany":"Alemanha","France":"França","Italy":"Itália",
      "Portugal":"Portugal","Netherlands":"Holanda","Belgium":"Bélgica",
      "Croatia":"Croácia","Serbia":"Sérvia","Poland":"Polônia",
      "Turkey":"Turquia","Greece":"Grécia","Russia":"Rússia",
      "Ukraine":"Ucrânia","Switzerland":"Suíça","Austria":"Áustria",
      "Denmark":"Dinamarca","Sweden":"Suécia","Norway":"Noruega",
      "Japan":"Japão","South Korea":"Coreia do Sul","China":"China",
      "Australia":"Austrália","Saudi Arabia":"Arábia Saudita",
      "Morocco":"Marrocos","Egypt":"Egito","Nigeria":"Nigéria",
      "South Africa":"África do Sul","Cameroon":"Camarões",
      "Ghana":"Gana","Senegal":"Senegal","Algeria":"Argélia",
      "Tunisia":"Tunísia","Iran":"Irã","Qatar":"Catar",
      "Costa Rica":"Costa Rica","Honduras":"Honduras",
      "Panama":"Panamá","Jamaica":"Jamaica",
      "Romania":"Romênia","Hungary":"Hungria",
      "Czech Republic":"República Tcheca","Scotland":"Escócia",
      "Wales":"País de Gales","Ireland":"Irlanda",
      "Iceland":"Islândia","Finland":"Finlândia",
    };

    const batch = db.batch();
    let mapeados = 0;
    const resultados = [];

    for (const item of apiTeams) {
      const team = item.team;
      if (!team.national) continue;

      const nomePT = paisPT[team.name] || team.name;
      const match = selecoes.find(s => {
        const sN = normalizarNome(s.nome || s.pais || "");
        const tN = normalizarNome(nomePT);
        return sN === tN || sN.includes(tN) || tN.includes(sN);
      });

      if (match) {
        if (!dryRun) {
          batch.update(db.collection("times").doc(match.id), {
            apiFootballId: team.id,
            escudo: team.logo || null,
            abreviacao: team.code || team.name.substring(0, 3).toUpperCase(),
            nacional: true,
          });
        }
        resultados.push({ apiNome: team.name, firestoreNome: match.nome, status: "mapeado" });
        mapeados++;
      } else {
        resultados.push({ apiNome: team.name, firestoreNome: null, status: "nao_encontrado" });
      }
    }

    if (!dryRun) await batch.commit();
    console.log(`📡 mapearSelecoes: ${mapeados} mapeados de ${apiTeams.length}`);
    return { success: true, dryRun, mapeados, total: apiTeams.length, resultados };
  });


// ═══════════════════════════════════════
// 5. RELATÓRIO DE MAPEAMENTO
// ═══════════════════════════════════════
exports.verificarMapeamento = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const timesSnap = await db.collection("times").get();
    let totalTimes = 0, comApi = 0, comEscudo = 0, semApi = [];
    timesSnap.forEach(doc => {
      const d = doc.data();
      totalTimes++;
      if (d.apiFootballId) comApi++;
      if (d.escudo) comEscudo++;
      else semApi.push({ id: doc.id, nome: d.nome, pais: d.pais, tipo: d.tipo });
    });

    const campsSnap = await db.collection("campeonatos").get();
    let totalCamps = 0, campsComApi = 0, campsSemApi = [];
    campsSnap.forEach(doc => {
      const d = doc.data();
      totalCamps++;
      if (d.apiFootballId) campsComApi++;
      else campsSemApi.push({ id: doc.id, nome: d.nome });
    });

    return {
      times: {
        total: totalTimes, comApiFootballId: comApi, comEscudo,
        semApiFootballId: semApi.length,
        percentual: Math.round(comApi / totalTimes * 100) + "%",
        listaSemApi: semApi.slice(0, 50)
      },
      campeonatos: {
        total: totalCamps, comApiFootballId: campsComApi,
        semApiFootballId: campsSemApi.length,
        percentual: Math.round(campsComApi / totalCamps * 100) + "%",
        listaSemApi: campsSemApi
      }
    };
  });


// =====================================================
// 📡 IMPORTAR JOGOS AUTOMÁTICOS DA API-FOOTBALL
// Busca jogos do dia/data e cria docs no Firestore
// =====================================================
exports.importarJogosAPI = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError("permission-denied", "Apenas admin");

    const dataJogo = data?.data || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const ligasFiltro = data?.ligas || []; // IDs específicos, vazio = todas
    const fixtureIds = data?.fixtureIds || []; // IDs específicos de partidas
    const dryRun = data?.dryRun !== false;

    // 1. Buscar fixtures do dia na API
    // Consultamos também o dia anterior porque jogos das 21h-23h BRT
    // ficam no dia seguinte em UTC (API-Football usa UTC)
    const dataAnterior = new Date(dataJogo + 'T12:00:00');
    dataAnterior.setDate(dataAnterior.getDate() - 1);
    const dataAnteriorStr = dataAnterior.toISOString().split('T')[0];

    console.log(`📡 Buscando jogos de ${dataJogo} + ${dataAnteriorStr} (UTC fallback)...`);
    const [apiResult, apiResultAnterior] = await Promise.all([
      apiFootballGet(`/fixtures?date=${dataJogo}`),
      apiFootballGet(`/fixtures?date=${dataAnteriorStr}`)
    ]);

    // Filtrar dia anterior: só jogos cuja hora local BRT cai em dataJogo
    const fixturesHoje = apiResult.response || [];
    const fixturesAnterior = (apiResultAnterior.response || []).filter(f => {
      // Converter UTC para BRT (UTC-3) e pegar a data local
      const dtUTC = new Date(f.fixture.date);
      const dtBRT = new Date(dtUTC.getTime() - 3 * 60 * 60 * 1000);
      const dataBRT = dtBRT.toISOString().split('T')[0];
      return dataBRT === dataJogo;
    });

    // Merge sem duplicatas
    const idsHoje = new Set(fixturesHoje.map(f => f.fixture.id));
    let fixtures = [...fixturesHoje, ...fixturesAnterior.filter(f => !idsHoje.has(f.fixture.id))];

    // Filtrar por ligas se especificado
    if (ligasFiltro.length > 0) {
      fixtures = fixtures.filter(f => ligasFiltro.includes(f.league.id));
    }

    // Filtrar por fixtureIds específicos
    if (fixtureIds.length > 0) {
      fixtures = fixtures.filter(f => fixtureIds.includes(f.fixture.id));
    }

    if (!fixtures.length) {
      return { success: true, dryRun, total: 0, criados: 0, jaExistem: 0, semTime: 0, jogos: [] };
    }

    // 2. Carregar todos os times do Firestore (com apiFootballId)
    const timesSnap = await db.collection("times").get();
    const timesPorApiId = {}; // apiFootballId → {id, nome, primaria, secundaria, escudo}
    timesSnap.forEach(doc => {
      const d = doc.data();
      if (d.apiFootballId) {
        timesPorApiId[d.apiFootballId] = {
          id: doc.id,
          nome: d.nome,
          primaria: d.primaria || '#333',
          secundaria: d.secundaria || '#fff',
          escudo: d.escudo || null,
          pais: d.pais || ''
        };
      }
    });

    // 3. Carregar jogos existentes pra não duplicar
    const jogosExistentes = new Set();
    const jogosSnap = await db.collection("jogos").get();
    jogosSnap.forEach(doc => {
      const d = doc.data();
      if (d.apiFootballId) jogosExistentes.add(d.apiFootballId);
    });

    // 4. Carregar campeonatos (pra pegar nome em PT-BR)
    const campsSnap = await db.collection("campeonatos").get();
    const campsPorApiId = {};
    campsSnap.forEach(doc => {
      const d = doc.data();
      if (d.apiFootballId) campsPorApiId[d.apiFootballId] = d.nome;
    });

    // 5. Processar fixtures
    const batch = db.batch();
    let criados = 0, jaExistem = 0, semTime = 0;
    const jogosResultado = [];

    for (const f of fixtures) {
      const fixtureId = f.fixture.id;
      const homeApiId = f.teams.home.id;
      const awayApiId = f.teams.away.id;
      const ligaApiId = f.league.id;

      // Já existe?
      if (jogosExistentes.has(fixtureId)) {
        jaExistem++;
        jogosResultado.push({
          fixtureId,
          timeCasa: { nome: f.teams.home.name, logo: f.teams.home.logo },
          timeFora: { nome: f.teams.away.name, logo: f.teams.away.logo },
          liga: { nome: f.league.name, logo: f.league.logo, pais: f.league.country, apiId: f.league.id },
          data: f.fixture.date,
          status: 'ja_existe'
        });
        continue;
      }

      // Encontrar times no Firestore — se não existir, criar automaticamente
      let timeCasa = timesPorApiId[homeApiId];
      let timeFora = timesPorApiId[awayApiId];

      // Auto-criar time se não existe
      if (!timeCasa && !dryRun) {
        const t = f.teams.home;
        let nome = t.name;
        if (f.league.country === 'Brazil') {
          const uf = obterUF(f.fixture.venue?.city || '');
          if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`;
        }
        const novoRef = db.collection("times").doc();
        const novoTime = {
          nome, apiFootballId: t.id, escudo: t.logo || null,
          abreviacao: (t.name || '').substring(0, 3).toUpperCase(),
          primaria: '#333333', secundaria: '#FFFFFF', terciaria: '#333333',
          pais: f.league.country || null, codigoPais: '',
          tipo: t.national ? 'selecao' : 'clube',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        };
        batch.set(novoRef, novoTime);
        timeCasa = { id: novoRef.id, nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo, pais: f.league.country };
        timesPorApiId[t.id] = timeCasa;
        console.log(`🆕 Time criado: ${nome} (API: ${t.id})`);
      } else if (!timeCasa && dryRun) {
        // No dry run, simular que vai criar
        const t = f.teams.home;
        let nome = t.name;
        if (f.league.country === 'Brazil') {
          const uf = obterUF(f.fixture.venue?.city || '');
          if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`;
        }
        timeCasa = { id: 'novo', nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo, pais: f.league.country, autoCriado: true };
      }

      if (!timeFora && !dryRun) {
        const t = f.teams.away;
        let nome = t.name;
        if (f.league.country === 'Brazil') {
          const uf = obterUF(f.fixture.venue?.city || '');
          if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`;
        }
        const novoRef = db.collection("times").doc();
        const novoTime = {
          nome, apiFootballId: t.id, escudo: t.logo || null,
          abreviacao: (t.name || '').substring(0, 3).toUpperCase(),
          primaria: '#333333', secundaria: '#FFFFFF', terciaria: '#333333',
          pais: f.league.country || null, codigoPais: '',
          tipo: t.national ? 'selecao' : 'clube',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        };
        batch.set(novoRef, novoTime);
        timeFora = { id: novoRef.id, nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo, pais: f.league.country };
        timesPorApiId[t.id] = timeFora;
        console.log(`🆕 Time criado: ${nome} (API: ${t.id})`);
      } else if (!timeFora && dryRun) {
        const t = f.teams.away;
        let nome = t.name;
        if (f.league.country === 'Brazil') {
          const uf = obterUF(f.fixture.venue?.city || '');
          if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`;
        }
        timeFora = { id: 'novo', nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo, pais: f.league.country, autoCriado: true };
      }

      // Criar documento do jogo
      const dataInicio = new Date(f.fixture.date);
      const dataFim = new Date(dataInicio.getTime() + 120 * 60 * 1000); // +120 min
      const nomeLiga = campsPorApiId[ligaApiId] || f.league.name;

      const jogoDoc = {
        timeCasaId: timeCasa.id,
        timeForaId: timeFora.id,
        timeCasaNome: timeCasa.nome,
        timeForaNome: timeFora.nome,
        timeCasaEscudo: timeCasa.escudo || f.teams.home.logo,
        timeForaEscudo: timeFora.escudo || f.teams.away.logo,
        timeCasaPrimaria: timeCasa.primaria,
        timeCasaSecundaria: timeCasa.secundaria,
        timeForaPrimaria: timeFora.primaria,
        timeForaSecundaria: timeFora.secundaria,
        liga: nomeLiga,
        ligaApiId: ligaApiId,
        ligaLogo: f.league.logo,
        rodada: f.league.round || '',
        dataInicio: admin.firestore.Timestamp.fromDate(dataInicio),
        dataFim: admin.firestore.Timestamp.fromDate(dataFim),
        status: 'agendado',
        apiFootballId: fixtureId,
        placarCasa: f.goals.home,
        placarFora: f.goals.away,
        patrocinadores: [],
        participantes: 0,
        premiado: false,
        dataCriacao: admin.firestore.FieldValue.serverTimestamp()
      };

      if (!dryRun) {
        const ref = db.collection("jogos").doc();
        batch.set(ref, jogoDoc);
      }

      criados++;
      const autoCriou = timeCasa.autoCriado || timeFora.autoCriado;
      if (autoCriou) semTime++; // Count as "created team too"
      jogosResultado.push({
        fixtureId,
        timeCasa: { nome: timeCasa.nome, logo: timeCasa.escudo || f.teams.home.logo, primaria: timeCasa.primaria, secundaria: timeCasa.secundaria, firestoreId: timeCasa.id, autoCriado: !!timeCasa.autoCriado },
        timeFora: { nome: timeFora.nome, logo: timeFora.escudo || f.teams.away.logo, primaria: timeFora.primaria, secundaria: timeFora.secundaria, firestoreId: timeFora.id, autoCriado: !!timeFora.autoCriado },
        liga: { nome: nomeLiga, logo: f.league.logo, pais: f.league.country, apiId: ligaApiId },
        data: f.fixture.date,
        rodada: f.league.round || '',
        status: autoCriou ? 'criar_auto' : 'criar'
      });
    }

    if (!dryRun && criados > 0) await batch.commit();

    console.log(`📡 importarJogosAPI(${dataJogo}): ${criados} criados, ${jaExistem} já existem, ${semTime} sem time`);

    return {
      success: true,
      dryRun,
      data: dataJogo,
      total: fixtures.length,
      criados,
      jaExistem,
      semTime,
      jogos: jogosResultado
    };
  });


// =====================================================
// ⏰ IMPORTAR JOGOS AUTOMÁTICOS — SCHEDULER (diário)
// Roda todo dia às 6h e cria jogos do dia automaticamente
// =====================================================
exports.importarJogosDiario = functions.pubsub
  .schedule('every day 06:00')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    try {
      const hoje = new Date().toISOString().split('T')[0];

      // Ligas favoritas pra criar automaticamente
      const ligasFavoritas = [
        71, 72, 73,         // Brasileirão A, B, Copa do Brasil
        13, 11,             // Libertadores, Sulamericana
        2, 3, 848,          // Champions, Europa, Conference League
        39, 135, 140, 61, 78, // Premier, Serie A, La Liga, Ligue 1, Bundesliga
        128,                // Argentina
        262, 253,           // Liga MX, MLS
        98, 307,            // J-League, Saudi
      ];

      // Buscar fixtures
      const apiResult = await apiFootballGet(`/fixtures?date=${hoje}`);
      let fixtures = (apiResult.response || []).filter(f => ligasFavoritas.includes(f.league.id));

      if (!fixtures.length) {
        console.log(`📡 Nenhum jogo das ligas favoritas hoje (${hoje})`);
        return null;
      }

      // Carregar times
      const timesSnap = await db.collection("times").get();
      const timesPorApiId = {};
      timesSnap.forEach(doc => {
        const d = doc.data();
        if (d.apiFootballId) timesPorApiId[d.apiFootballId] = { id: doc.id, nome: d.nome, primaria: d.primaria || '#333', secundaria: d.secundaria || '#fff', escudo: d.escudo || null };
      });

      // Carregar existentes
      const jogosExistentes = new Set();
      const jogosSnap = await db.collection("jogos").get();
      jogosSnap.forEach(doc => { if (doc.data().apiFootballId) jogosExistentes.add(doc.data().apiFootballId); });

      // Campeonatos
      const campsSnap = await db.collection("campeonatos").get();
      const campsPorApiId = {};
      campsSnap.forEach(doc => { if (doc.data().apiFootballId) campsPorApiId[doc.data().apiFootballId] = doc.data().nome; });

      const batch = db.batch();
      let criados = 0;

      for (const f of fixtures) {
        if (jogosExistentes.has(f.fixture.id)) continue;
        let tc = timesPorApiId[f.teams.home.id];
        let tf = timesPorApiId[f.teams.away.id];

        // Auto-criar times que não existem
        if (!tc) {
          const t = f.teams.home;
          let nome = t.name;
          if (f.league.country === 'Brazil') { const uf = obterUF(f.fixture.venue?.city || ''); if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`; }
          const ref = db.collection("times").doc();
          batch.set(ref, { nome, apiFootballId: t.id, escudo: t.logo || null, abreviacao: (t.name||'').substring(0,3).toUpperCase(), primaria: '#333333', secundaria: '#FFFFFF', terciaria: '#333333', pais: f.league.country || null, codigoPais: '', tipo: 'clube', atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
          tc = { id: ref.id, nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo };
          timesPorApiId[t.id] = tc;
          console.log(`🆕 Time auto-criado: ${nome}`);
        }
        if (!tf) {
          const t = f.teams.away;
          let nome = t.name;
          if (f.league.country === 'Brazil') { const uf = obterUF(f.fixture.venue?.city || ''); if (uf && !/\s-\s[A-Z]{2}$/.test(nome)) nome = `${nome} - ${uf}`; }
          const ref = db.collection("times").doc();
          batch.set(ref, { nome, apiFootballId: t.id, escudo: t.logo || null, abreviacao: (t.name||'').substring(0,3).toUpperCase(), primaria: '#333333', secundaria: '#FFFFFF', terciaria: '#333333', pais: f.league.country || null, codigoPais: '', tipo: 'clube', atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
          tf = { id: ref.id, nome, primaria: '#333333', secundaria: '#FFFFFF', escudo: t.logo };
          timesPorApiId[t.id] = tf;
          console.log(`🆕 Time auto-criado: ${nome}`);
        }

        const dataInicio = new Date(f.fixture.date);
        const dataFim = new Date(dataInicio.getTime() + 120 * 60 * 1000);

        batch.set(db.collection("jogos").doc(), {
          timeCasaId: tc.id, timeForaId: tf.id,
          timeCasaNome: tc.nome, timeForaNome: tf.nome,
          timeCasaEscudo: tc.escudo || f.teams.home.logo,
          timeForaEscudo: tf.escudo || f.teams.away.logo,
          timeCasaPrimaria: tc.primaria, timeCasaSecundaria: tc.secundaria,
          timeForaPrimaria: tf.primaria, timeForaSecundaria: tf.secundaria,
          liga: campsPorApiId[f.league.id] || f.league.name,
          ligaApiId: f.league.id, ligaLogo: f.league.logo,
          rodada: f.league.round || '',
          dataInicio: admin.firestore.Timestamp.fromDate(dataInicio),
          dataFim: admin.firestore.Timestamp.fromDate(dataFim),
          status: 'agendado',
          apiFootballId: f.fixture.id,
          placarCasa: null, placarFora: null,
          patrocinadores: [], participantes: 0, premiado: false,
          dataCriacao: admin.firestore.FieldValue.serverTimestamp()
        });
        criados++;
      }

      if (criados > 0) await batch.commit();
      console.log(`📡 importarJogosDiario: ${criados} jogos criados para ${hoje}`);
      return null;
    } catch (e) {
      console.error('❌ Erro importarJogosDiario:', e);
      return null;
    }
  });


// =====================================================
// 🔍 buscarTimePorNome
// Busca candidatos na API pelo nome para o admin escolher
// visualmente no painel de Auditoria & Correção.
// =====================================================
exports.buscarTimePorNome = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');
  const nome = (data.nome || '').trim();
  if (!nome || nome.length < 2) throw new functions.https.HttpsError('invalid-argument', 'Nome muito curto');
  try {
    const result = await apiFootballGet(`/teams?search=${encodeURIComponent(nome)}`);
    const candidatos = (result.response || []).slice(0, 10).map(item => ({
      id:       item.team.id,
      nome:     item.team.name,
      pais:     item.team.country || '',
      escudo:   item.team.logo   || '',
      fundacao: item.team.founded || null,
      estadio:  item.venue?.name  || ''
    }));
    return { candidatos };
  } catch (e) {
    console.error('buscarTimePorNome:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// =====================================================
// 💾 confirmarMapeamentoTime
// Salva o mapeamento escolhido pelo admin e propaga
// o escudo para todos os jogos do time (opcional).
// =====================================================
exports.confirmarMapeamentoTime = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');
  const { firestoreId, apiId, propagarJogos } = data;
  if (!firestoreId || !apiId) throw new functions.https.HttpsError('invalid-argument', 'firestoreId e apiId são obrigatórios');
  try {
    const result = await apiFootballGet(`/teams?id=${apiId}`);
    const item = result.response?.[0];
    if (!item) throw new Error(`Time ${apiId} não encontrado na API`);

    await db.collection('times').doc(firestoreId).update({
      apiFootballId:  item.team.id,
      escudo:         item.team.logo    || null,
      pais:           item.team.country || null,
      fundacao:       item.team.founded || null,
      estadio:        item.venue?.name  || null,
      estadioCidade:  item.venue?.city  || null,
      atualizadoEm:   admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Mapeamento: ${firestoreId} -> API ${apiId} (${item.team.name})`);

    let jogosAtualizados = 0;
    if (propagarJogos && item.team.logo) {
      const batch = db.batch();
      let count = 0;
      const [jogosHome, jogosFora] = await Promise.all([
        db.collection('jogos').where('timeCasaId', '==', firestoreId).get(),
        db.collection('jogos').where('timeForaId', '==', firestoreId).get()
      ]);
      jogosHome.forEach(doc => { batch.update(doc.ref, { timeCasaEscudo: item.team.logo }); count++; });
      jogosFora.forEach(doc => { batch.update(doc.ref, { timeForaEscudo: item.team.logo }); count++; });
      if (count > 0) { await batch.commit(); jogosAtualizados = count; }
    }

    return {
      success: true, apiId: item.team.id, nome: item.team.name,
      escudo: item.team.logo, pais: item.team.country,
      estadio: item.venue?.name || null, jogosAtualizados
    };
  } catch (e) {
    console.error('confirmarMapeamentoTime:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// =====================================================
// 🆕 descobrirTimesFaltantes
// Times de uma liga na API que nao existem no Firestore.
// =====================================================
exports.descobrirTimesFaltantes = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');
  const { leagueId, season } = data;
  if (!leagueId) throw new functions.https.HttpsError('invalid-argument', 'leagueId obrigatório');
  const temporada = season || new Date().getFullYear();
  try {
    const result = await apiFootballGet(`/teams?league=${leagueId}&season=${temporada}`);
    const timesApi = result.response || [];
    if (!timesApi.length) return { faltantes: [], total: 0, jaExistem: 0 };

    const timesSnap = await db.collection('times').get();
    const idsExistentes = new Set();
    timesSnap.forEach(doc => { const id = doc.data().apiFootballId; if (id) idsExistentes.add(id); });

    const faltantes = [];
    let jaExistem = 0;
    for (const item of timesApi) {
      if (idsExistentes.has(item.team.id)) {
        jaExistem++;
      } else {
        faltantes.push({
          apiId: item.team.id, nome: item.team.name, pais: item.team.country || '',
          escudo: item.team.logo || '', fundacao: item.team.founded || null,
          estadio: item.venue?.name || '', estadioCidade: item.venue?.city || '',
          abreviacaoSugerida: (item.team.name || '').substring(0, 3).toUpperCase()
        });
      }
    }
    return { faltantes, total: timesApi.length, jaExistem };
  } catch (e) {
    console.error('descobrirTimesFaltantes:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// =====================================================
// ➕ criarTimeDeApi
// Cria time no Firestore com os dados revisados pelo admin.
// =====================================================
exports.criarTimeDeApi = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');
  const { apiId, nome, abreviacao, primaria, secundaria, terciaria, pais, codigoPais, tipo } = data;
  if (!apiId || !nome) throw new functions.https.HttpsError('invalid-argument', 'apiId e nome são obrigatórios');
  try {
    const jaExiste = await db.collection('times').where('apiFootballId', '==', apiId).limit(1).get();
    if (!jaExiste.empty) return { success: false, motivo: 'Já existe', firestoreId: jaExiste.docs[0].id };

    const result = await apiFootballGet(`/teams?id=${apiId}`);
    const item = result.response?.[0];

    const ref = await db.collection('times').add({
      nome: nome.trim(),
      abreviacao: (abreviacao || nome.substring(0, 3)).toUpperCase().trim(),
      apiFootballId: apiId,
      escudo: item?.team?.logo || null,
      primaria: primaria || '#333333',
      secundaria: secundaria || '#FFFFFF',
      terciaria: terciaria || '#333333',
      pais: pais || item?.team?.country || null,
      codigoPais: codigoPais || '',
      tipo: tipo || 'clube',
      estadio: item?.venue?.name || null,
      estadioCidade: item?.venue?.city || null,
      fundacao: item?.team?.founded || null,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('Time criado: ' + nome + ' (' + ref.id + ', API: ' + apiId + ')');
    return { success: true, firestoreId: ref.id, nome, escudo: item?.team?.logo || null, apiId };
  } catch (e) {
    console.error('criarTimeDeApi:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// =====================================================
// 🌍 buscarTimesApi
// Proxy geral para consultas de times na API-Football.
// Usado pela página times-selecoes.html do admin.
//
// Parâmetros:
//   modo: 'nacional' | 'pais' | 'busca' | 'liga'
//   pais:     string  (ex: "Brazil") — quando modo=pais
//   search:   string  (ex: "Palmeiras") — quando modo=busca
//   leagueId: number  (ex: 71) — quando modo=liga
//   season:   number  (ex: 2025) — opcional, padrão 2025
//
// Retorna array de times com todos os campos disponíveis
// na API: escudo, fundação, estádio, cidade, capacidade etc.
// =====================================================
exports.buscarTimesApi = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessario');

  const { modo, pais, search, leagueId, season } = data;
  let endpoint;

  if (modo === 'nacional') {
    endpoint = '/teams?national=true';
  } else if (modo === 'pais' && pais) {
    endpoint = '/teams?country=' + encodeURIComponent(pais);
  } else if (modo === 'busca' && search) {
    endpoint = '/teams?search=' + encodeURIComponent(search);
  } else if (modo === 'liga' && leagueId) {
    endpoint = '/teams?league=' + leagueId + '&season=' + (season || 2025);
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Parametros invalidos. Use modo: nacional|pais|busca|liga');
  }

  try {
    const result = await apiFootballGet(endpoint);
    const times = (result.response || []).map(item => ({
      apiId:             item.team.id,
      nome:              item.team.name,
      pais:              item.team.country        || '',
      escudo:            item.team.logo           || null,
      fundacao:          item.team.founded        || null,
      nacional:          item.team.national       || false,
      tipo:              item.team.national ? 'selecao' : 'clube',
      estadio:           item.venue ? item.venue.name     : null,
      estadioCidade:     item.venue ? item.venue.city     : null,
      estadioCapacidade: item.venue ? item.venue.capacity : null,
      estadioSuperficie: item.venue ? item.venue.surface  : null,
      estadioImagem:     item.venue ? item.venue.image    : null,
    }));
    console.log('buscarTimesApi [' + modo + ']: ' + times.length + ' times');
    return { times, total: times.length };
  } catch (e) {
    console.error('buscarTimesApi:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║          YELLUP — MOTOR DE APRENDIZADO CONTÍNUO                 ║
// ║  Sistema de log de previsões + fingerprint de times             ║
// ╚══════════════════════════════════════════════════════════════════╝


// ─────────────────────────────────────────────────────────────────
// 📝 REGISTRAR PREVISÃO (chamada pelo HTML a cada análise ao vivo)
// ─────────────────────────────────────────────────────────────────
exports.registrarPrevisao = functions.https.onCall(async (data, context) => {
  try {
    const {
      fixtureId, timeCasaId, timeForaId, ligaId,
      minuto, tipo,       // 'gol_casa','gol_fora','cartao','substituicao','expulsao'
      confianca,          // 0-100
      contexto            // snapshot dos dados que geraram a previsão
    } = data;

    if (!fixtureId || !tipo) throw new functions.https.HttpsError('invalid-argument', 'fixtureId e tipo obrigatórios');

    const db = admin.firestore();

    // Evitar duplicatas: só 1 previsão do mesmo tipo por janela de 5 minutos
    const janela = Math.floor((minuto || 0) / 5) * 5;
    const dedupeKey = `${fixtureId}_${tipo}_${janela}`;
    const dedupeRef = db.collection('previsoes-dedupe').doc(dedupeKey);
    const dedupeSnap = await dedupeRef.get();
    if (dedupeSnap.exists) return { sucesso: true, duplicata: true };

    const doc = {
      fixtureId: parseInt(fixtureId),
      timeCasaId, timeForaId, ligaId,
      minuto: minuto || 0,
      janela,
      tipo,
      confianca: Math.round(confianca || 0),
      contexto: contexto || {},
      resultado: null,         // null = pendente, true = acertou, false = errou
      processado: false,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection('previsoes').add(doc),
      dedupeRef.set({ ts: Date.now() }),
    ]);

    return { sucesso: true };
  } catch (e) {
    console.error('registrarPrevisao:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// ⏰ PROCESSAR JOGOS ENCERRADOS (scheduled — todo dia 02:00)
// Verifica previsões pendentes e preenche resultado: true/false
// ─────────────────────────────────────────────────────────────────
exports.processarPrevisoes = functions.pubsub
  .schedule('0 2 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    // Pegar previsões não processadas dos últimos 3 dias
    const limite = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    // Buscar pendentes: processado==false OU campo não existe
    const [snapFalse, snapSemCampo] = await Promise.all([
      db.collection('previsoes')
        .where('processado', '==', false)
        .where('criadoEm', '>=', limite)
        .limit(200).get(),
      db.collection('previsoes')
        .where('criadoEm', '>=', limite)
        .orderBy('criadoEm', 'desc')
        .limit(200).get(),
    ]);

    // Merge: todos os docs recentes onde resultado ainda é null
    const todosDocs = new Map();
    snapFalse.docs.forEach(d => todosDocs.set(d.id, d));
    snapSemCampo.docs.forEach(d => {
      const data = d.data();
      if (data.resultado === null || data.resultado === undefined) {
        todosDocs.set(d.id, d);
      }
    });

    const snap = { empty: todosDocs.size === 0, docs: [...todosDocs.values()] };

    if (snap.empty) { console.log('Nenhuma previsão pendente'); return null; }

    // Agrupar por fixtureId para minimizar chamadas de API
    const porFixture = {};
    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!porFixture[d.fixtureId]) porFixture[d.fixtureId] = [];
      porFixture[d.fixtureId].push({ id: doc.id, ...d });
    });

    const batch = db.batch();

    for (const [fixtureId, previsoes] of Object.entries(porFixture)) {
      try {
        // Buscar resultado final + eventos do jogo
        const [fixR, evR] = await Promise.all([
          axios.get(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
            { headers: { 'x-apisports-key': API_KEY } }),
          axios.get(`https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
            { headers: { 'x-apisports-key': API_KEY } }),
        ]);

        const fix = fixR.data?.response?.[0];
        if (!fix) continue;

        const status = fix.fixture?.status?.short;
        if (!['FT', 'AET', 'PEN'].includes(status)) continue; // jogo ainda não encerrou

        const eventos = evR.data?.response || [];
        const golsCasa = fix.goals?.home || 0;
        const golsFora = fix.goals?.away || 0;
        const cartoes = eventos.filter(e => e.type === 'Card').length;
        const substituicoes = eventos.filter(e => e.type === 'subst').length;
        const expulsoes = eventos.filter(e => e.type === 'Card' &&
          (e.detail?.includes('Red') || e.detail?.includes('Second Yellow'))).length;

        // Para cada previsão deste jogo, verificar se acertou
        for (const prev of previsoes) {
          let resultado = false;
          const minPrev = prev.minuto || 0;

          // Eventos após o minuto da previsão
          const evDepois = eventos.filter(e => (e.time?.elapsed || 0) > minPrev);

          if (prev.tipo === 'gol_casa') {
            resultado = evDepois.some(e =>
              e.type === 'Goal' && e.team?.id === prev.timeCasaId &&
              e.detail !== 'Own Goal' &&
              (e.time?.elapsed || 0) <= minPrev + 15
            );
          } else if (prev.tipo === 'gol_fora') {
            resultado = evDepois.some(e =>
              e.type === 'Goal' && e.team?.id === prev.timeForaId &&
              e.detail !== 'Own Goal' &&
              (e.time?.elapsed || 0) <= minPrev + 15
            );
          } else if (prev.tipo === 'cartao') {
            resultado = evDepois.some(e =>
              e.type === 'Card' &&
              (e.time?.elapsed || 0) <= minPrev + 10
            );
          } else if (prev.tipo === 'substituicao') {
            resultado = evDepois.some(e =>
              e.type === 'subst' &&
              (e.time?.elapsed || 0) <= minPrev + 15
            );
          } else if (prev.tipo === 'expulsao') {
            resultado = evDepois.some(e =>
              e.type === 'Card' &&
              (e.detail?.includes('Red') || e.detail?.includes('Second Yellow')) &&
              (e.time?.elapsed || 0) <= minPrev + 20
            );
          } else if (prev.tipo === 'virada') {
            // Verificar se o time perdendo virou ou empatou
            const scPrev = prev.contexto?.placar || [0, 0];
            const perdendo = scPrev[0] < scPrev[1] ? 'casa' : 'fora';
            if (perdendo === 'casa') resultado = golsCasa >= golsFora;
            else resultado = golsFora >= golsCasa;
          }

          batch.update(db.collection('previsoes').doc(prev.id), {
            resultado,
            processado: true,
            processadoEm: admin.firestore.FieldValue.serverTimestamp(),
            // Guardar contexto do resultado para calibração
            resultadoContexto: {
              golsCasa, golsFora, cartoes, substituicoes, expulsoes,
              statusFinal: status,
            }
          });
        }

        // Atualizar fingerprint dos times após processar o jogo
        await atualizarFingerprint(db, fix, eventos);
        // Atualizar fingerprint de odds (correlação odds pré-jogo × resultado)
        await atualizarFingerprintOdds(db, fixtureId, golsCasa, golsFora);
        // 🧠 YELLUP LEARN — salvar correlação odds × resultado para aprendizado
        await coletarCorrelacaoOdds(db, fixtureId, golsCasa, golsFora, eventos, fix.statistics || []);

        // Pequeno delay para não estourar rate limit da API
        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        console.error(`Erro processando fixture ${fixtureId}:`, e.message);
      }
    }

    await batch.commit();
    console.log(`✅ Processadas ${snap.docs.length} previsões`);
    return null;
  });

// ─────────────────────────────────────────────────────────────────
// 🧠 ATUALIZAR FINGERPRINT DO TIME (chamado após cada jogo encerrado)
// Perfil acumulativo que melhora a cada partida
// ─────────────────────────────────────────────────────────────────
async function atualizarFingerprint(db, fix, eventos) {
  const timeCasaId = fix.teams?.home?.id;
  const timeForaId = fix.teams?.away?.id;
  if (!timeCasaId || !timeForaId) return;

  const golsCasa = fix.goals?.home || 0;
  const golsFora = fix.goals?.away || 0;

  // Gols por faixa de 10 minutos (0-9, 10-19, ..., 80-89, 90+)
  const golsEventos = eventos.filter(e => e.type === 'Goal');
  const bucketMinuto = (min) => Math.min(8, Math.floor((min || 0) / 10));

  for (const [teamId, isHome] of [[timeCasaId, true], [timeForaId, false]]) {
    const fpRef = db.collection('fingerprints-times').doc(String(teamId));
    const fpSnap = await fpRef.get();
    const fp = fpSnap.exists ? fpSnap.data() : criarFingerprintBase();

    // Gols marcados por faixa
    const golsMarcados = golsEventos.filter(e =>
      e.team?.id === teamId && e.detail !== 'Own Goal'
    );
    const golsSofridos = golsEventos.filter(e =>
      e.team?.id !== teamId && e.detail !== 'Own Goal'
    );

    golsMarcados.forEach(g => {
      const b = bucketMinuto(g.time?.elapsed);
      fp.golsMarcadosPorFaixa[b] = (fp.golsMarcadosPorFaixa[b] || 0) + 1;
    });
    golsSofridos.forEach(g => {
      const b = bucketMinuto(g.time?.elapsed);
      fp.golsSofridosPorFaixa[b] = (fp.golsSofridosPorFaixa[b] || 0) + 1;
    });

    // Acumular estatísticas do jogo
    const cartoes = eventos.filter(e => e.type === 'Card' && e.team?.id === teamId).length;
    const subs = eventos.filter(e => e.type === 'subst' && e.team?.id === teamId).length;

    fp.totalJogos = (fp.totalJogos || 0) + 1;
    fp.totalGolsMarcados = (fp.totalGolsMarcados || 0) + (isHome ? golsCasa : golsFora);
    fp.totalGolsSofridos = (fp.totalGolsSofridos || 0) + (isHome ? golsFora : golsCasa);
    // Separação casa vs fora
    if (isHome) {
      fp.jogosEmCasa = (fp.jogosEmCasa || 0) + 1;
      fp.golsMarcadosCasa = (fp.golsMarcadosCasa || 0) + golsCasa;
      fp.golsSofridosCasa  = (fp.golsSofridosCasa  || 0) + golsFora;
      if (golsCasa > golsFora)       fp.vitoriasCasa  = (fp.vitoriasCasa  || 0) + 1;
      else if (golsCasa === golsFora) fp.empatesCasa   = (fp.empatesCasa   || 0) + 1;
      else                            fp.derrotasCasa  = (fp.derrotasCasa  || 0) + 1;
    } else {
      fp.jogosForaDeCasa = (fp.jogosForaDeCasa || 0) + 1;
      fp.golsMarcadosFora = (fp.golsMarcadosFora || 0) + golsFora;
      fp.golsSofridosFora  = (fp.golsSofridosFora  || 0) + golsCasa;
      if (golsFora > golsCasa)       fp.vitoriasForaDeCasa  = (fp.vitoriasForaDeCasa  || 0) + 1;
      else if (golsFora === golsCasa) fp.empatesForaDeCasa   = (fp.empatesForaDeCasa   || 0) + 1;
      else                            fp.derrotasForaDeCasa  = (fp.derrotasForaDeCasa  || 0) + 1;
    }
    fp.totalCartoes = (fp.totalCartoes || 0) + cartoes;
    fp.totalSubs = (fp.totalSubs || 0) + subs;

    const marcados = isHome ? golsCasa : golsFora;
    const sofridos = isHome ? golsFora : golsCasa;
    if (marcados > sofridos) fp.vitorias = (fp.vitorias || 0) + 1;
    else if (marcados === sofridos) fp.empates = (fp.empates || 0) + 1;
    else fp.derrotas = (fp.derrotas || 0) + 1;

    // Padrão de reação pós-gol sofrido
    for (let i = 0; i < golsSofridos.length; i++) {
      const minSofrido = golsSofridos[i].time?.elapsed || 0;
      const respondeu = golsMarcados.some(g =>
        (g.time?.elapsed || 0) > minSofrido &&
        (g.time?.elapsed || 0) <= minSofrido + 15
      );
      fp.totalGolsSofridosComResposta = (fp.totalGolsSofridosComResposta || 0) + 1;
      if (respondeu) fp.respostasAposGol = (fp.respostasAposGol || 0) + 1;
    }

    // Médias derivadas (calculadas na hora da leitura, mas pré-calculamos para performance)
    const n = fp.totalJogos || 1;
    fp.mediaGolsMarcados = fp.totalGolsMarcados / n;
    fp.mediaGolsSofridos = fp.totalGolsSofridos / n;
    // Médias separadas
    if ((fp.jogosEmCasa || 0) > 0) {
      fp.mediaGolsMarcadosCasa = +(fp.golsMarcadosCasa / fp.jogosEmCasa).toFixed(2);
      fp.mediaGolsSofridosCasa  = +(fp.golsSofridosCasa  / fp.jogosEmCasa).toFixed(2);
      fp.taxaVitoriaCasa = +((fp.vitoriasCasa || 0) / fp.jogosEmCasa).toFixed(3);
    }
    if ((fp.jogosForaDeCasa || 0) > 0) {
      fp.mediaGolsMarcadosFora = +(fp.golsMarcadosFora / fp.jogosForaDeCasa).toFixed(2);
      fp.mediaGolsSofridosFora  = +(fp.golsSofridosFora  / fp.jogosForaDeCasa).toFixed(2);
      fp.taxaVitoriaFora = +((fp.vitoriasForaDeCasa || 0) / fp.jogosForaDeCasa).toFixed(3);
    }
    fp.mediaCartoes = fp.totalCartoes / n;
    fp.taxaVitoria = (fp.vitorias || 0) / n;
    fp.pctRespostaAposGol = fp.totalGolsSofridosComResposta > 0
      ? (fp.respostasAposGol || 0) / fp.totalGolsSofridosComResposta
      : 0;

    // Janela "quente" = faixa de 10min com mais gols marcados
    const maxBucket = Math.max(...fp.golsMarcadosPorFaixa);
    fp.janelaMaisPerigosa = fp.golsMarcadosPorFaixa.indexOf(maxBucket);

    // Janela "frágil" = faixa com mais gols sofridos
    const maxSof = Math.max(...fp.golsSofridosPorFaixa);
    fp.janelaMaisFragil = fp.golsSofridosPorFaixa.indexOf(maxSof);

    fp.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
    fp.ultimoJogoId = fix.fixture?.id;

    await fpRef.set(fp, { merge: true });
  }
}

function criarFingerprintBase() {
  return {
    totalJogos: 0,
    totalGolsMarcados: 0,
    totalGolsSofridos: 0,
    totalCartoes: 0,
    totalSubs: 0,
    vitorias: 0,
    empates: 0,
    derrotas: 0,
    respostasAposGol: 0,
    totalGolsSofridosComResposta: 0,
    // 9 faixas: 0-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80+
    golsMarcadosPorFaixa: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    golsSofridosPorFaixa: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

// ─────────────────────────────────────────────────────────────────
// 📊 BUSCAR FINGERPRINT DO TIME (para o HTML usar na análise)
// ─────────────────────────────────────────────────────────────────
exports.buscarFingerprint = functions.https.onCall(async (data, context) => {
  try {
    const { timeCasaId, timeForaId } = data;
    if (!timeCasaId || !timeForaId) throw new functions.https.HttpsError('invalid-argument', 'ids obrigatórios');
    const db = admin.firestore();
    const [fpCasa, fpFora] = await Promise.all([
      db.collection('fingerprints-times').doc(String(timeCasaId)).get(),
      db.collection('fingerprints-times').doc(String(timeForaId)).get(),
    ]);
    return {
      sucesso: true,
      casa: fpCasa.exists ? fpCasa.data() : null,
      fora: fpFora.exists ? fpFora.data() : null,
    };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 📈 BUSCAR CALIBRAÇÃO (acurácia histórica do algoritmo)
// ─────────────────────────────────────────────────────────────────
exports.buscarCalibracaoAlgoritmo = functions.https.onCall(async (data, context) => {
  try {
    const db = admin.firestore();
    const { ligaId, timeCasaId, timeForaId } = data || {};

    // Buscar previsões — inclui processadas e pendentes (campo pode não existir)
    const [snapProcessadas, snapPendentes] = await Promise.all([
      db.collection('previsoes').where('processado', '==', true).limit(1000).get()
        .catch(() => ({ empty: true, docs: [] })),
      db.collection('previsoes').where('processado', '==', false).limit(200).get()
        .catch(() => ({ empty: true, docs: [] })),
    ]);

    // Diagnóstico: contar total real (sem filtro, limitado)
    const snapTotal = await db.collection('previsoes').limit(500).get()
      .catch(() => ({ size: 0 }));
    const totalReal = snapTotal.size || 0;
    const pendentes = snapPendentes.docs?.length || 0;
    const processadas = snapProcessadas.docs?.length || 0;

    if (snapProcessadas.empty) {
      return {
        sucesso: true,
        dados: null,
        diagnostico: {
          totalReal,
          pendentes,
          processadas: 0,
          msg: totalReal === 0
            ? 'Nenhuma previsão salva ainda. O sistema registra em tempo real durante jogos monitorados.'
            : `${totalReal} previsões salvas, ${pendentes} aguardando processamento (rodada automaticamente às 02h).`,
        }
      };
    }

    const snap = snapProcessadas;

    // Agrupar por tipo com métricas detalhadas
    const porTipo = {};
    const porConfianca = {}; // faixas: 40-49, 50-59, 60-69, 70-79, 80+
    const ligas = new Set();
    let totalAcertos = 0;

    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.tipo) return;
      if (d.ligaId) ligas.add(String(d.ligaId));

      // Por tipo
      if (!porTipo[d.tipo]) porTipo[d.tipo] = { total: 0, acertos: 0 };
      porTipo[d.tipo].total++;
      if (d.resultado === true) { porTipo[d.tipo].acertos++; totalAcertos++; }

      // Por faixa de confiança
      const faixaKey = Math.floor((d.confianca || 0) / 10) * 10;
      const fk = `${faixaKey}`;
      if (!porConfianca[fk]) porConfianca[fk] = { faixa: faixaKey, total: 0, acertos: 0 };
      porConfianca[fk].total++;
      if (d.resultado === true) porConfianca[fk].acertos++;
    });

    const total = snap.docs.length;

    // Formatar porTipo para o front (espera {tipo: {total, acertos}})
    const porTipoFormatado = {};
    Object.entries(porTipo).forEach(([tipo, v]) => {
      porTipoFormatado[tipo] = {
        total: v.total,
        acertos: v.acertos,
        pct: v.total > 0 ? Math.round(v.acertos / v.total * 100) : null,
      };
    });

    // Faixas de confiança ordenadas (calibração)
    const calibracaoConfianca = Object.values(porConfianca)
      .sort((a, b) => a.faixa - b.faixa)
      .map(f => ({
        faixa: `${f.faixa}-${f.faixa + 9}%`,
        total: f.total,
        acertos: f.acertos,
        pct: f.total > 0 ? Math.round(f.acertos / f.total * 100) : null,
        // Gap: se confiança 70% → deveria acertar 70%. Gap positivo = subestimado, negativo = superestimado
        gap: f.total > 0 ? Math.round(f.acertos / f.total * 100) - f.faixa : null,
      }));

    // Tipo mais preciso e menos preciso
    const tiposOrdenados = Object.entries(porTipo)
      .filter(([, v]) => v.total >= 5)
      .map(([tipo, v]) => ({ tipo, pct: Math.round(v.acertos / v.total * 100) }))
      .sort((a, b) => b.pct - a.pct);

    // Contar pendentes para o botão de reprocessar no Cérebro
    // Só usa processado==false (índice simples, sem risco)
    const snapPend = await db.collection('previsoes')
      .where('processado', '==', false)
      .limit(500).get().catch(()=>({docs:[], size:0}));
    // Também contar docs recentes sem campo resultado (filtro em memória)
    const snapRecPend = await db.collection('previsoes')
      .orderBy('criadoEm', 'desc').limit(300)
      .get().catch(()=>({docs:[]}));
    const semProcessar = (snapRecPend.docs||[]).filter(d=>{
      const dat = d.data();
      return dat.resultado === null || dat.resultado === undefined || dat.processado === false;
    }).length;
    const totalPendentes = Math.max(snapPend.size||0, semProcessar);

    return {
      sucesso: true,
      dados: {
        total,
        acertos: totalAcertos,
        pct: total > 0 ? Math.round(totalAcertos / total * 100) : null,
        porTipo: porTipoFormatado,
        calibracaoConfianca,
        melhorTipo: tiposOrdenados[0] || null,
        piorTipo:   tiposOrdenados[tiposOrdenados.length - 1] || null,
        ligas: [...ligas],
        ultimaAtualizacao: new Date().toISOString(),
      },
      diagnostico: {
        totalReal: total + totalPendentes,
        pendentes: totalPendentes,
        processadas: total,
        msg: totalPendentes > 0
          ? `${totalPendentes} previsões novas aguardando processamento.`
          : 'Tudo processado.',
      }
    };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═════════════════════════════════════════════════════════════════
// 💾 SALVAR RELATÓRIO PÓS-JOGO NO FIRESTORE
// Chamado pelo HTML quando jogo encerra (FT/AET/PEN)
// ═════════════════════════════════════════════════════════════════
exports.processarPrevisoesManual = functions.https.onCall(async (data, context) => {
  try {
    const limite = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const [snapFalse, snapRecentes] = await Promise.all([
      db.collection('previsoes').where('processado','==',false).where('criadoEm','>=',limite).limit(300).get()
        .catch(()=>({docs:[]})),
      db.collection('previsoes').where('criadoEm','>=',limite).orderBy('criadoEm','desc').limit(300).get()
        .catch(()=>({docs:[]})),
    ]);

    const todosDocs = new Map();
    snapFalse.docs.forEach(d => todosDocs.set(d.id, d));
    snapRecentes.docs.forEach(d => {
      const dat = d.data();
      if (dat.resultado === null || dat.resultado === undefined) todosDocs.set(d.id, d);
    });

    if (!todosDocs.size) return { sucesso: true, processadas: 0, msg: 'Nenhuma previsao pendente nos ultimos 5 dias.' };

    const porFixture = {};
    todosDocs.forEach((doc) => {
      const d = doc.data();
      if (!porFixture[d.fixtureId]) porFixture[d.fixtureId] = [];
      porFixture[d.fixtureId].push({ id: doc.id, ...d });
    });

    const batch = db.batch();
    let processadas = 0; let jogosOk = 0;

    for (const [fixtureId, previsoes] of Object.entries(porFixture)) {
      try {
        // Usar apiFootballGet (nativo https — sem axios)
        const fixData = await apiFootballGet(`/fixtures?id=${fixtureId}`);
        const fix = fixData?.response?.[0];
        if (!fix) continue;
        if (!['FT','AET','PEN'].includes(fix.fixture?.status?.short)) continue;

        const evData = await apiFootballGet(`/fixtures/events?fixture=${fixtureId}`);
        const eventos = evData?.response || [];
        const golsCasa = fix.goals?.home || 0;
        const golsFora = fix.goals?.away || 0;
        jogosOk++;

        for (const prev of previsoes) {
          const minPrev = prev.minuto || 0;
          const evDepois = eventos.filter(e => (e.time?.elapsed||0) > minPrev);
          let resultado = false;
          if (prev.tipo === 'gol_casa')
            resultado = evDepois.some(e => e.type==='Goal' && e.team?.id===prev.timeCasaId && e.detail!=='Own Goal' && (e.time?.elapsed||0)<=minPrev+15);
          else if (prev.tipo === 'gol_fora')
            resultado = evDepois.some(e => e.type==='Goal' && e.team?.id===prev.timeForaId && e.detail!=='Own Goal' && (e.time?.elapsed||0)<=minPrev+15);
          else if (prev.tipo === 'cartao')
            resultado = evDepois.some(e => e.type==='Card' && (e.time?.elapsed||0)<=minPrev+10);

          batch.update(db.collection('previsoes').doc(prev.id), {
            resultado, processado: true,
            processadoEm: admin.firestore.FieldValue.serverTimestamp(),
            resultadoContexto: { golsCasa, golsFora, statusFinal: fix.fixture?.status?.short },
          });
          processadas++;
        }
      } catch(e) { console.warn('Fixture '+fixtureId+' erro:', e.message); }
    }

    if (processadas > 0) await batch.commit();
    return { sucesso: true, processadas, jogosOk, totalPendentes: todosDocs.size,
      msg: processadas+' previsoes processadas em '+jogosOk+' jogos.' };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

exports.salvarRelatorioJogo = functions.https.onCall(async (data, context) => {
  try {
    const {
      fixtureId, timeCasaId, timeForaId, ligaId,
      placarCasa, placarFora,
      xgCasa, xgFora,
      posseCasa,
      totalChutes, chutesAlvoCasa, chutesAlvoFora,
      escanteiosCasa, escanteiosFora,
      cartoesCasa, cartoesFora,
      faultasCasa, faultasFora,
      mediaGolsFingerprint,
      previsoesSessao,   // array do PREV_HISTORICO do front
      totalSnapshots,
      narrativa,
      insights,
    } = data;

    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();

    // Evitar duplicata
    const ref = db.collection('relatorios-jogos').doc(String(fixtureId));
    const existe = await ref.get();
    if (existe.exists) return { sucesso: true, duplicata: true };

    // Calcular aproveitamento das previsões da sessão
    const acertos  = (previsoesSessao || []).filter(p => p.resultado === 'acerto').length;
    const erros    = (previsoesSessao || []).filter(p => p.resultado === 'erro').length;
    const pctSessao = (acertos + erros) > 0 ? Math.round(acertos / (acertos + erros) * 100) : null;

    const doc = {
      fixtureId: parseInt(fixtureId),
      timeCasaId, timeForaId, ligaId,
      placar: { casa: placarCasa, fora: placarFora },
      xg:     { casa: xgCasa || 0, fora: xgFora || 0 },
      posse:  { casa: posseCasa || 50, fora: 100 - (posseCasa || 50) },
      chutes: { totalCasa: totalChutes, alvoCasa: chutesAlvoCasa, alvoFora: chutesAlvoFora },
      escanteios: { casa: escanteiosCasa || 0, fora: escanteiosFora || 0 },
      cartoes:    { casa: cartoesCasa || 0, fora: cartoesFora || 0 },
      faultas:    { casa: faultasCasa || 0, fora: faultasFora || 0 },
      previsoes: {
        total: (previsoesSessao || []).length,
        acertos, erros,
        aproveitamento: pctSessao,
        detalhes: (previsoesSessao || []).slice(0, 50), // máx 50
      },
      totalSnapshots: totalSnapshots || 0,
      narrativa: narrativa || null,
      insights:  insights  || [],
      salvoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(doc);
    return { sucesso: true };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═════════════════════════════════════════════════════════════════
// 📊 ODDS PRÉ-JOGO — capturar e salvar fingerprint de odds
// ═════════════════════════════════════════════════════════════════
// 🏦 SCHEDULE DEDICADO — CAPTURA DE ODDS PRÉ-JOGO
// Roda a cada 15 minutos, INDEPENDENTE de ter jogos ao vivo
// Busca jogos agendados nas próximas 3h e captura odds
// ═════════════════════════════════════════════════════════════════
exports.scheduleOddsPrejogo = functions.pubsub
  .schedule('every 15 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const agora    = new Date();
      const em3h     = new Date(Date.now() + 3 * 60 * 60 * 1000);  // até 3h à frente
      const em10min  = new Date(Date.now() + 10 * 60 * 1000);      // mín 10min no futuro

      // Buscar jogos agendados que começam entre agora+10min e agora+3h
      // (evita capturar jogo que já vai começar em segundos)
      const snap = await db.collection('jogos')
        .where('status', '==', 'agendado')
        .get();

      if (snap.empty) {
        console.log('📭 Nenhum jogo agendado encontrado');
        return null;
      }

      // Filtrar por janela de tempo e apiFootballId presente
      const jogosAlvo = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => {
          if (!d.apiFootballId) return false;
          const dataJogo = d.data
            ? (typeof d.data === 'string' ? new Date(d.data) : d.data.toDate?.() || new Date(d.data))
            : d.dataInicio
              ? (d.dataInicio.toDate?.() || new Date(d.dataInicio))
              : null;
          if (!dataJogo) return false;
          return dataJogo >= em10min && dataJogo <= em3h;
        });

      if (jogosAlvo.length === 0) {
        console.log('⏰ Nenhum jogo na janela de 10min–3h');
        return null;
      }

      console.log(`🏦 ${jogosAlvo.length} jogo(s) na janela — capturando odds...`);

      let capturados = 0;
      for (const jogo of jogosAlvo) {
        try {
          // Verificar se já capturamos odds para este jogo
          const oddsRef  = db.collection('odds-prejogo').doc(String(jogo.apiFootballId));
          const oddsSnap = await oddsRef.get();

          if (oddsSnap.exists) {
            const capturaMs = oddsSnap.data()?.capturaMs || 0;
            const horasAtras = (Date.now() - capturaMs) / 3600000;
            // Re-capturar se a última foi há mais de 1h (odds mudam)
            if (horasAtras < 1) {
              console.log(`⏭ ${jogo.apiFootballId} já capturado há ${horasAtras.toFixed(1)}h — pulando`);
              continue;
            }
          }

          await capturarOddsPrejogo(
            db,
            jogo.apiFootballId,
            jogo.timeCasaId,
            jogo.timeForaId,
            jogo.liga?.id || jogo.ligaId
          );
          capturados++;

          // Pausa entre chamadas para não estourar rate limit da API
          if (capturados < jogosAlvo.length) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch(err) {
          console.warn(`⚠️ Erro odds jogo ${jogo.apiFootballId}:`, err.message);
        }
      }

      console.log(`✅ Odds capturadas: ${capturados}/${jogosAlvo.length} jogos`);
      return null;

    } catch(e) {
      console.error('Erro scheduleOddsPrejogo:', e);
      return null;
    }
  });

// ═════════════════════════════════════════════════════════════════
// 🎲 CAPTURAR ODDS ON-DEMAND — chamado pelo frontend ao abrir jogo
// Funciona para qualquer status (agendado, ao_vivo, etc.)
// Salva em odds-prejogo/{fixtureId} e retorna os dados
// ═════════════════════════════════════════════════════════════════
exports.capturarOddsOnDemand = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, timeCasaId, timeForaId, ligaId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    // Checar cache — se tem odds de menos de 2h, retorna direto
    const ref = db.collection('odds-prejogo').doc(String(fixtureId));
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      const horasAtras = (Date.now() - (d.capturaMs || 0)) / 3600000;
      if (horasAtras < 2 && d.odds?.resultados?.odd1) {
        console.log(`🎲 odds-prejogo cache hit para ${fixtureId} (${horasAtras.toFixed(1)}h atrás)`);
        return { sucesso: true, fonte: 'cache', odds: d.odds, probImplicitas: d.probImplicitas, casasUsadas: d.casasUsadas };
      }
    }

    // Buscar odds da API-Football
    console.log(`🎲 Buscando odds da API para fixture ${fixtureId}...`);
    const r = await apiFootballGet(`/odds?fixture=${fixtureId}`);
    const bookmakers = r.response?.[0]?.bookmakers || [];

    console.log(`🎲 Bookmakers retornados: ${bookmakers.map(b=>b.name).join(', ') || 'nenhum'} (total=${bookmakers.length})`);

    if (!bookmakers.length) {
      // Tentar odds live como fallback
      const rLive = await apiFootballGet(`/odds/live?fixture=${fixtureId}`);
      const bkLive = rLive.response?.[0]?.bookmakers || [];
      console.log(`🎲 Live bookmakers: ${bkLive.map(b=>b.name).join(', ') || 'nenhum'}`);

      if (!bkLive.length) {
        return { sucesso: false, erro: 'Sem odds disponíveis para este jogo na API-Football' };
      }
      bookmakers.push(...bkLive);
    }

    // Extrair odds de cada mercado
    const getOdd = (bk, betName, valueName) => {
      const bet = bk.bets?.find(b => b.name === betName || b.id === (betName === 'Match Winner' ? 1 : betName === 'Goals Over/Under' ? 5 : betName === 'Both Teams Score' ? 8 : -1));
      return parseFloat(bet?.values?.find(v => v.value === valueName)?.odd) || null;
    };

    // Agregar probabilidades de múltiplos bookmakers
    const probs = { odd1: [], oddX: [], odd2: [], over25: [], under25: [], ambosSim: [] };
    const casasUsadas = [];

    for (const bk of bookmakers.slice(0, 6)) {
      const o1 = getOdd(bk, 'Match Winner', 'Home');
      const oX = getOdd(bk, 'Match Winner', 'Draw');
      const o2 = getOdd(bk, 'Match Winner', 'Away');
      if (!o1 || !oX || !o2) continue;

      casasUsadas.push(bk.name);
      probs.odd1.push(o1); probs.oddX.push(oX); probs.odd2.push(o2);

      const ov25  = getOdd(bk, 'Goals Over/Under', 'Over 2.5');
      const un25  = getOdd(bk, 'Goals Over/Under', 'Under 2.5');
      const ov15  = getOdd(bk, 'Goals Over/Under', 'Over 1.5');
      const amSim = getOdd(bk, 'Both Teams Score', 'Yes');
      if (ov25)  probs.over25.push(ov25);
      if (un25)  probs.under25.push(un25);
      if (amSim) probs.ambosSim.push(amSim);
    }

    if (!probs.odd1.length) {
      return { sucesso: false, erro: 'Bookmakers sem odds de Match Winner' };
    }

    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
    const medOdd1 = avg(probs.odd1);
    const medOddX = avg(probs.oddX);
    const medOdd2 = avg(probs.odd2);
    const medOver25 = avg(probs.over25);
    const medUnder25 = avg(probs.under25);
    const medAmbosSim = avg(probs.ambosSim);

    // Probabilidades implícitas normalizadas (sem margem)
    const imp1 = 1/medOdd1, impX = 1/medOddX, imp2 = 1/medOdd2;
    const soma = imp1 + impX + imp2;
    const probImplicitas = {
      casa:   Math.round(imp1/soma*100),
      empate: Math.round(impX/soma*100),
      fora:   Math.round(imp2/soma*100),
      over25: medOver25  ? Math.round((1/medOver25) / ((1/medOver25)+(1/(medUnder25||2))) * 100) : null,
      ambasMarcam: medAmbosSim ? Math.round((1/medAmbosSim)*100) : null,
    };

    // xG pelas odds (Poisson inverso simplificado)
    const xGolsOdds = medOver25 ? parseFloat((1.5 + (1/medOver25)).toFixed(1)) : null;

    // Tipo de jogo pela odd1
    const tipoJogo = medOdd1 < 1.5 ? 'favorito_forte_casa' :
                     medOdd2 < 1.5 ? 'favorito_forte_fora' :
                     medOdd1 < 2.0 ? 'favorito_moderado_casa' :
                     medOdd2 < 2.0 ? 'favorito_moderado_fora' :
                     medOdd1 < 2.5 ? 'equilibrado_casa' :
                     medOdd2 < 2.5 ? 'equilibrado_fora' : 'equilibrado';

    const oddsDoc = {
      fixtureId,
      capturaMs: Date.now(),
      casasUsadas,
      tipoJogo,
      xGolsOdds,
      probImplicitas,
      odds: {
        resultados: { odd1: medOdd1, oddX: medOddX, odd2: medOdd2 },
        overUnder: { over25: medOver25, under25: medUnder25 },
        ambasMarcam: { sim: medAmbosSim },
      },
    };

    await ref.set(oddsDoc, { merge: true });
    console.log(`🎲 Odds salvas para fixture ${fixtureId}: 1=${medOdd1?.toFixed(2)} X=${medOddX?.toFixed(2)} 2=${medOdd2?.toFixed(2)}`);

    return { sucesso: true, fonte: 'api', odds: oddsDoc.odds, probImplicitas, casasUsadas, tipoJogo, xGolsOdds };

  } catch (e) {
    console.error('❌ capturarOddsOnDemand:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// Chamado pelo schedulePlacarMinuto ao detectar jogo ainda NS (not started)
// ═════════════════════════════════════════════════════════════════
async function capturarOddsPrejogo(db, fixtureId, timeCasaId, timeForaId, ligaId) {
  try {
    // Verificar se já capturamos recentemente (< 1h)
    const ref = db.collection('odds-prejogo').doc(String(fixtureId));
    const snap = await ref.get();
    if (snap.exists) {
      const capturaMs = snap.data()?.capturaMs || 0;
      const horasAtras = (Date.now() - capturaMs) / 3600000;
      if (horasAtras < 1) return snap.data(); // capturado há menos de 1h, reutilizar
    }

    const r = await apiFootballGet(`/odds?fixture=${fixtureId}`);
    const bookmakers = r.response?.[0]?.bookmakers || [];

    // Casas prioritárias: Bet365 (id=8), Unibet (id=5), William Hill (id=6)
    // Fallback: usar todas disponíveis
    const CASAS_PRIO = [8, 5, 6, 1, 2, 3];
    const casasSorted = [...bookmakers].sort((a, b) => {
      const ia = CASAS_PRIO.indexOf(a.id), ib = CASAS_PRIO.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    // Extrair odds das 3 principais casas disponíveis
    const top3 = casasSorted.slice(0, 3);

    const extrairOdds = (casa, betName) => {
      const bet = casa.bets?.find(b => b.name === betName);
      if (!bet) return null;
      return Object.fromEntries(bet.values.map(v => [v.value, parseFloat(v.odd)]));
    };

    // Calcular médias entre casas
    const mediaOdd = (betName, value) => {
      const vals = top3.map(c => {
        const bet = c.bets?.find(b => b.name === betName);
        const v   = bet?.values?.find(b => b.value === value);
        return v ? parseFloat(v.odd) : null;
      }).filter(Boolean);
      return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(3) : null;
    };

    // Probabilidade implícita (removendo margem estimada de 5%)
    const oddParaProb = (odd) => odd ? +((1/odd) / 1.05 * 100).toFixed(1) : null;

    // 1X2
    const odd1  = mediaOdd('Match Winner', 'Home');
    const oddX  = mediaOdd('Match Winner', 'Draw');
    const odd2  = mediaOdd('Match Winner', 'Away');

    // Over/Under
    const oddO25 = mediaOdd('Goals Over/Under', 'Over 2.5');
    const oddU25 = mediaOdd('Goals Over/Under', 'Under 2.5');
    const oddO15 = mediaOdd('Goals Over/Under', 'Over 1.5');
    const oddO35 = mediaOdd('Goals Over/Under', 'Over 3.5');

    // Ambas marcam
    const oddAmbS = mediaOdd('Both Teams Score', 'Yes');
    const oddAmbN = mediaOdd('Both Teams Score', 'No');

    // Resultado esperado de gols baseado nas odds (modelo de Poisson simplificado)
    // Over 2.5 < 1.70 → esperado ~3.2 gols; > 2.20 → esperado ~1.8 gols
    const xGolsOdds = oddO25
      ? +(2.5 - Math.log(oddO25 - 1) * 0.8).toFixed(2)
      : null;

    // Classificação de jogo pelas odds
    const tipoJogo = !odd1 ? 'indefinido'
      : odd1 < 1.40 ? 'favorito_claro_casa'
      : odd2 < 1.40 ? 'favorito_claro_fora'
      : (odd1 > 2.60 && odd2 > 2.60) ? 'equilibrado_aberto'
      : oddX < 3.00 ? 'equilibrado_empatavel'
      : 'levemente_favorito';

    const doc = {
      fixtureId: parseInt(fixtureId),
      timeCasaId, timeForaId, ligaId,
      capturaMs: Date.now(),
      casasUsadas: top3.map(c => c.name),
      odds: {
        resultados: { odd1, oddX, odd2 },
        overUnder: { over15: oddO15, over25: oddO25, under25: oddU25, over35: oddO35 },
        ambasMarcam: { sim: oddAmbS, nao: oddAmbN },
      },
      probImplicitas: {
        casa: oddParaProb(odd1),
        empate: oddParaProb(oddX),
        fora: oddParaProb(odd2),
        over25: oddParaProb(oddO25),
        ambasMarcam: oddParaProb(oddAmbS),
      },
      xGolsOdds,
      tipoJogo,
      resultado: null,       // preenchido pelo processarPrevisoes após jogo
      golsReais: null,
    };

    // Calcular movimento em relação à captura anterior
    let movimento = null;
    if (snap.exists) {
      const prev = snap.data().odds?.resultados || {};
      const prevO25 = snap.data().odds?.overUnder?.over25;
      movimento = {
        ts: Date.now(),
        deltaOdd1:  odd1  && prev.odd1  ? +(odd1  - prev.odd1 ).toFixed(3) : null,
        deltaOddX:  oddX  && prev.oddX  ? +(oddX  - prev.oddX ).toFixed(3) : null,
        deltaOdd2:  odd2  && prev.odd2  ? +(odd2  - prev.odd2 ).toFixed(3) : null,
        deltaO25:   oddO25 && prevO25   ? +(oddO25 - prevO25  ).toFixed(3) : null,
        odd1Novo: odd1, odd2Novo: odd2, oddXNovo: oddX, oddO25Novo: oddO25,
      };
    }

    // Gravar histórico de snapshots de odds (máx 10 entradas)
    const historicoAtual = snap.exists ? (snap.data().historicoOdds || []) : [];
    if (historicoAtual.length > 0 || snap.exists) {
      // Guardar estado anterior no histórico
      const snapAnterior = snap.exists ? {
        ts: snap.data().capturaMs,
        odd1: snap.data().odds?.resultados?.odd1,
        oddX: snap.data().odds?.resultados?.oddX,
        odd2: snap.data().odds?.resultados?.odd2,
        oddO25: snap.data().odds?.overUnder?.over25,
      } : null;
      if (snapAnterior && historicoAtual.length === 0) {
        historicoAtual.push(snapAnterior);
      }
    }
    // Adicionar captura atual ao histórico
    historicoAtual.push({
      ts: Date.now(),
      odd1, oddX, odd2,
      oddO25,
    });
    // Manter máx 10 snapshots
    const historicoFinal = historicoAtual.slice(-10);

    // Detectar sinal sharp: movimento > 0.10 em menos de 1h = dinheiro sério entrando
    const sinalSharp = movimento && (
      Math.abs(movimento.deltaOdd1 || 0) >= 0.10 ||
      Math.abs(movimento.deltaOdd2 || 0) >= 0.10 ||
      Math.abs(movimento.deltaO25  || 0) >= 0.12
    );

    await ref.set({
      ...doc,
      historicoOdds: historicoFinal,
      ultimoMovimento: movimento,
      sinalSharp: sinalSharp || false,
    });

    if (sinalSharp) {
      console.log(`🚨 SINAL SHARP fixture ${fixtureId}: odd1 ${movimento.deltaOdd1>0?'+':''}${movimento.deltaOdd1} odd2 ${movimento.deltaOdd2>0?'+':''}${movimento.deltaOdd2} o25 ${movimento.deltaO25>0?'+':''}${movimento.deltaO25}`);
    } else {
      console.log(`✅ Odds capturadas: fixture ${fixtureId}${movimento?' (movimento registrado)':''}`);
    }
    return doc;
  } catch (e) {
    console.warn(`Odds pré-jogo falhou fixture ${fixtureId}:`, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// 🧠 FINGERPRINT DE ODDS — aprender padrões após jogo encerrar
// Correlaciona odds pré-jogo com resultado real
// ─────────────────────────────────────────────────────────────────
async function atualizarFingerprintOdds(db, fixtureId, golsCasa, golsFora) {
  try {
    const oddsSnap = await db.collection('odds-prejogo').doc(String(fixtureId)).get();
    if (!oddsSnap.exists) return;

    const o = oddsSnap.data();
    const golsTotal = golsCasa + golsFora;
    const over25  = golsTotal > 2.5;
    const over15  = golsTotal > 1.5;
    const over35  = golsTotal > 3.5;
    const ambasMarcam = golsCasa > 0 && golsFora > 0;

    // Atualizar o doc de odds com resultado
    await db.collection('odds-prejogo').doc(String(fixtureId)).update({
      resultado: golsCasa > golsFora ? 'casa' : golsFora > golsCasa ? 'fora' : 'empate',
      golsReais: golsTotal,
      over25Real: over25,
      over15Real: over15,
      over35Real: over35,
      ambasMarcamReal: ambasMarcam,
    });

    if (!o.odds?.overUnder?.over25) return; // sem odds, sem fingerprint

    // Bucket de odd over2.5 (arredondado para 0.1)
    const bucketO25 = Math.round((o.odds.overUnder.over25 || 2.0) * 10) / 10;
    const fpRef = db.collection('fingerprint-odds').doc(`over25_${bucketO25.toFixed(1).replace('.','_')}`);
    const fpSnap = await fpRef.get();
    const fp = fpSnap.exists ? fpSnap.data() : { bucket: bucketO25, tipo: 'over25', total: 0, over25Count: 0 };

    fp.total++;
    if (over25) fp.over25Count++;
    fp.pctOver25 = +(fp.over25Count / fp.total * 100).toFixed(1);
    fp.mediaGolsTotal = fp.mediaGolsTotal
      ? +((fp.mediaGolsTotal * (fp.total - 1) + golsTotal) / fp.total).toFixed(2)
      : golsTotal;
    fp.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();

    await fpRef.set(fp);

    // Bucket por tipo de jogo (favorito claro vs equilibrado)
    if (o.tipoJogo) {
      const fpTipoRef = db.collection('fingerprint-odds').doc(`tipo_${o.tipoJogo}`);
      const fpTipoSnap = await fpTipoRef.get();
      const fpTipo = fpTipoSnap.exists ? fpTipoSnap.data() : {
        tipo: o.tipoJogo, total: 0, over25: 0, over15: 0, ambasMarcam: 0, somaGols: 0
      };
      fpTipo.total++;
      if (over25) fpTipo.over25++;
      if (over15) fpTipo.over15++;
      if (ambasMarcam) fpTipo.ambasMarcam++;
      fpTipo.somaGols += golsTotal;
      fpTipo.mediaGols = +(fpTipo.somaGols / fpTipo.total).toFixed(2);
      fpTipo.pctOver25 = +(fpTipo.over25 / fpTipo.total * 100).toFixed(1);
      fpTipo.pctAmbasMarcam = +(fpTipo.ambasMarcam / fpTipo.total * 100).toFixed(1);
      fpTipo.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
      await fpTipoRef.set(fpTipo);
    }

    console.log(`✅ Fingerprint odds atualizado: fixture ${fixtureId}`);
  } catch (e) {
    console.warn('atualizarFingerprintOdds:', e.message);
  }
}

// ═════════════════════════════════════════════════════════════════
// 📈 BUSCAR FINGERPRINT DE ODDS (para enriquecer previsões)
// ═════════════════════════════════════════════════════════════════
exports.buscarFingerprintOdds = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();

    // Buscar odds pré-jogo salvas
    const oddsSnap = await db.collection('odds-prejogo').doc(String(fixtureId)).get();
    const odds = oddsSnap.exists ? oddsSnap.data() : null;

    if (!odds) {
      // Tentar capturar agora se ainda não foi
      return { sucesso: true, odds: null, fingerprint: null };
    }

    // Buscar fingerprint acumulado para o bucket desta odd
    const bucketO25 = odds.odds?.overUnder?.over25
      ? Math.round(odds.odds.overUnder.over25 * 10) / 10
      : null;
    const tipoJogo = odds.tipoJogo;

    const [fpBucketSnap, fpTipoSnap] = await Promise.all([
      bucketO25
        ? db.collection('fingerprint-odds').doc(`over25_${bucketO25.toFixed(1).replace('.','_')}`).get()
        : Promise.resolve(null),
      tipoJogo
        ? db.collection('fingerprint-odds').doc(`tipo_${tipoJogo}`).get()
        : Promise.resolve(null),
    ]);

    return {
      sucesso: true,
      odds: {
        resultados:    odds.odds?.resultados,
        overUnder:     odds.odds?.overUnder,
        ambasMarcam:   odds.odds?.ambasMarcam,
        probImplicitas: odds.probImplicitas,
        xGolsOdds:     odds.xGolsOdds,
        tipoJogo:      odds.tipoJogo,
        casasUsadas:   odds.casasUsadas,
        capturaMs:     odds.capturaMs,
      },
      movimento: {
        historico:      odds.historicoOdds     || [],
        ultimoMovimento: odds.ultimoMovimento  || null,
        sinalSharp:     odds.sinalSharp        || false,
      },
      fingerprint: {
        porBucket: fpBucketSnap?.exists ? fpBucketSnap.data() : null,
        porTipo:   fpTipoSnap?.exists   ? fpTipoSnap.data()   : null,
      }
    };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═════════════════════════════════════════════════════════════════
// 🤖 CALIBRAÇÃO AUTOMÁTICA DE PESOS — roda toda madrugada
// Com 100+ previsões verificadas, ajusta pesos para maximizar acurácia
// ═════════════════════════════════════════════════════════════════
exports.calibrarPesosAutomatico = functions.pubsub
  .schedule('30 3 * * *')  // 03:30 BRT todo dia
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const db = admin.firestore();

    // Buscar previsões verificadas (mín 100 para calibrar com segurança)
    const snap = await db.collection('previsoes')
      .where('processado', '==', true)
      .limit(2000)
      .get();

    if (snap.docs.length < 100) {
      console.log(`Calibração automática: apenas ${snap.docs.length} previsões — mínimo 100. Pulando.`);
      return null;
    }

    // Agrupar previsões por tipo e analisar correlação com contexto
    // Contexto salvo: { placar, xgCasa, xgFora, momentumCasa, ataquesCasa, posseCasa, ... }
    const porTipo = {};

    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.tipo || d.resultado === null) return;
      if (!porTipo[d.tipo]) porTipo[d.tipo] = { acertos: [], erros: [] };
      const grupo = d.resultado === true ? 'acertos' : 'erros';
      porTipo[d.tipo][grupo].push(d.contexto || {});
    });

    // Para cada tipo, calcular médias dos contextos que levaram a acerto vs erro
    // Isso nos diz: "quando xgDef era alto, acertamos mais?" → aumentar peso xgDef
    const novosAjustes = {};

    for (const [tipo, grupos] of Object.entries(porTipo)) {
      const totalA = grupos.acertos.length;
      const totalE = grupos.erros.length;
      if (totalA + totalE < 20) continue; // mínimo por tipo

      const mediaContexto = (arr, campo) => {
        const vals = arr.map(c => Number(c[campo] || 0)).filter(v => !isNaN(v));
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
      };

      // Campos de contexto relevantes
      const campos = ['xgDef', 'momentum', 'ataquePerigosos', 'precisaoTiro', 'pressaoAcumulada'];
      const ajuste = { tipo, totalAcertos: totalA, totalErros: totalE };

      campos.forEach(campo => {
        const mediaAcerto = mediaContexto(grupos.acertos, campo);
        const mediaErro   = mediaContexto(grupos.erros,   campo);
        // Se acertos têm valor muito maior → este campo tem poder preditivo real
        const diff = mediaAcerto - mediaErro;
        const ratio = mediaErro > 0 ? mediaAcerto / mediaErro : 1;
        ajuste[campo] = { mediaAcerto: +mediaAcerto.toFixed(3), mediaErro: +mediaErro.toFixed(3), diff: +diff.toFixed(3), ratio: +ratio.toFixed(3) };
      });

      novosAjustes[tipo] = ajuste;
    }

    // Calcular sugestão de pesos derivada da análise
    // Campos com alto ratio de acerto/erro merecem peso maior
    const sugestaoPesos = {};
    const PESOS_BASE = { xgDef: 12, precisaoTiro: 20, momentum: 4, faseJogo: 15, janelaFP: 12, faultaCartao: 8, amareloPeso: 7 };

    // Agregar ratio de xgDef e momentum de todos os tipos gol
    const tiposGol = ['gol_casa', 'gol_fora', 'gol'];
    const ratiosXg  = tiposGol.map(t => novosAjustes[t]?.xgDef?.ratio   || 1).filter(r=>r>0);
    const ratiosMom = tiposGol.map(t => novosAjustes[t]?.momentum?.ratio || 1).filter(r=>r>0);
    const ratioAcc  = tiposGol.map(t => novosAjustes[t]?.precisaoTiro?.ratio || 1).filter(r=>r>0);

    const mediaRatioXg  = ratiosXg.length  ? ratiosXg.reduce((a,b)=>a+b)/ratiosXg.length   : 1;
    const mediaRatioMom = ratiosMom.length ? ratiosMom.reduce((a,b)=>a+b)/ratiosMom.length  : 1;
    const mediaRatioAcc = ratioAcc.length  ? ratioAcc.reduce((a,b)=>a+b)/ratioAcc.length    : 1;

    // Ajustar peso proporcionalmente ao ratio, limitado a ±40% do base
    const ajustarPeso = (base, ratio) => {
      const fator = Math.min(1.4, Math.max(0.6, ratio));
      return Math.round(base * fator);
    };

    sugestaoPesos.xgDef       = ajustarPeso(PESOS_BASE.xgDef,       mediaRatioXg);
    sugestaoPesos.precisaoTiro= ajustarPeso(PESOS_BASE.precisaoTiro, mediaRatioAcc);
    sugestaoPesos.momentum    = ajustarPeso(PESOS_BASE.momentum,     mediaRatioMom);
    // Outros pesos mantêm base até ter dados suficientes por tipo
    sugestaoPesos.faseJogo    = PESOS_BASE.faseJogo;
    sugestaoPesos.janelaFP    = PESOS_BASE.janelaFP;
    sugestaoPesos.faultaCartao= PESOS_BASE.faultaCartao;
    sugestaoPesos.amareloPeso = PESOS_BASE.amareloPeso;

    const totalPrevisoes = snap.docs.length;
    const totalAcertosGeral = snap.docs.filter(d => d.data().resultado === true).length;
    const acuraciaAtual = Math.round(totalAcertosGeral / totalPrevisoes * 100);

    // Salvar resultado da calibração
    await db.collection('calibracao-algoritmo').doc('latest').set({
      rodarEm: admin.firestore.FieldValue.serverTimestamp(),
      totalPrevisoes,
      acuraciaAtual,
      analise: novosAjustes,
      sugestaoPesos,
      // Somente aplicar automaticamente se tiver 500+ previsões
      // Abaixo disso, apenas sugerir via painel admin
      aplicadoAutomaticamente: totalPrevisoes >= 500,
    });

    // Com 500+ previsões: aplicar automaticamente
    if (totalPrevisoes >= 500) {
      await db.collection('config-algoritmo').doc('pesos').set({
        ...sugestaoPesos,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        fonte: 'calibracao_automatica',
        baseadoEm: totalPrevisoes,
      });
      console.log(`✅ Pesos atualizados automaticamente — ${totalPrevisoes} previsões, acurácia ${acuraciaAtual}%`);
    } else {
      console.log(`📊 Análise salva — ${totalPrevisoes}/500 previsões (abaixo do mínimo para auto-aplicar). Sugestão disponível no painel admin.`);
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────────
// 📡 BUSCAR SUGESTÃO DE PESOS (painel admin)
// ─────────────────────────────────────────────────────────────────
exports.buscarSugestaoPesos = functions.https.onCall(async (data, context) => {
  try {
    const db = admin.firestore();
    const [calibSnap, pesosSnap] = await Promise.all([
      db.collection('calibracao-algoritmo').doc('latest').get(),
      db.collection('config-algoritmo').doc('pesos').get(),
    ]);
    return {
      sucesso: true,
      calibracao: calibSnap.exists ? calibSnap.data() : null,
      pesosAtivos: pesosSnap.exists ? pesosSnap.data() : null,
    };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═════════════════════════════════════════════════════════════════
// 🎙️ COMENTARISTA YELLUP — Cloud Function (resolve CORS)
// Chama Claude API pelo backend com o contexto do jogo
// ═════════════════════════════════════════════════════════════════
exports.gerarComentarioYellup = functions.https.onCall(async (data, context) => {
  try {
    const { contexto } = data;
    if (!contexto) throw new functions.https.HttpsError('invalid-argument', 'contexto obrigatório');

    const ANTHROPIC_KEY = functions.config().anthropic?.key || process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) throw new functions.https.HttpsError('internal', 'API key não configurada');

    const systemPrompt = `Você é o comentarista esportivo da plataforma Yellup Analytics. Analisa jogos de futebol em tempo real com base em dados estatísticos avançados.

REGRAS DE COMPORTAMENTO:
- Fale diretamente ao usuário, como um comentarista experiente e analítico
- Use os dados para dizer algo INTELIGENTE e NÃO ÓBVIO — não repita o placar, não diga "o jogo está em andamento"
- Cada comentário deve trazer UMA insight específica e acionável
- Varie entre: análise tática, alerta de jogador, previsão baseada em padrão, insight de odds, aviso de risco
- Seja conciso: 2-3 frases no máximo
- Use nomes dos times e jogadores quando relevante
- Quando um jogador está muito abaixo da média histórica → sugira substituição com dados
- Quando há padrão histórico relevante (fingerprint/janela) → mencione
- Quando termômetro está subindo → alerte
- Se o jogo ainda não começou (status NS): faça análise pré-jogo com odds, lesões, H2H, forma — prepare o usuário para o jogo
- Se jogo encerrado (FT): faça análise final do que aconteceu
- NÃO repita insights que já aparecem no feedAnterior
- Responda SOMENTE em JSON válido, sem markdown: {"texto": "...", "tipo": "alerta|destaque|jogador|tatica|previsao"}`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Dados do jogo: ' + JSON.stringify(contexto) }]
    });

    // Chamada HTTPS nativa (sem SDK — evita dependência extra)
    const resultado = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch(e) { reject(new Error('Parse error: ' + raw.slice(0,200))); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const txt = resultado.content?.[0]?.text || '';
    let parsed;
    try { parsed = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
    catch { parsed = { texto: txt.trim(), tipo: 'destaque' }; }

    if (!parsed.texto || parsed.texto.length < 10) {
      throw new functions.https.HttpsError('internal', 'Resposta inválida do modelo');
    }

    return { sucesso: true, comentario: parsed };

  } catch(e) {
    console.error('gerarComentarioYellup:', e.message);
    if (e instanceof functions.https.HttpsError) throw e;
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═════════════════════════════════════════════════════════════════
// 👤 HISTÓRICO DE JOGADOR — últimos 10 jogos + média de rating
// ═════════════════════════════════════════════════════════════════
exports.buscarHistoricoJogador = functions.https.onCall(async (data, context) => {
  try {
    const { jogadorId, temporada } = data;
    if (!jogadorId) throw new functions.https.HttpsError('invalid-argument', 'jogadorId obrigatório');

    const db    = admin.firestore();
    const season = temporada || new Date().getFullYear();
    const cacheKey = `jogador_${jogadorId}_${season}`;

    // Cache no Firestore por 6h (stats não mudam durante o jogo)
    const cacheRef  = db.collection('cache-jogadores').doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const age = (Date.now() - (cacheSnap.data().cachedMs || 0)) / 3600000;
      if (age < 6) return { sucesso: true, dados: cacheSnap.data().dados };
    }

    // Buscar estatísticas do jogador na temporada
    const r = await apiFootballGet(`/players?id=${jogadorId}&season=${season}`);
    const jogador = r.response?.[0];
    if (!jogador) return { sucesso: true, dados: null };

    // Buscar fixtures do jogador para pegar ratings por jogo
    const fixR = await apiFootballGet(`/players?id=${jogadorId}&season=${season}&page=1`);
    const allPages = fixR.paging?.total || 1;

    // Coletar todos os jogos (máx 2 páginas = 40 jogos)
    let jogos = [];
    const pag1 = fixR.response || [];
    pag1.forEach(entry => {
      const s = entry.statistics?.[0];
      if (!s) return;
      const rating = parseFloat(s.games?.rating);
      const minutos = s.games?.minutes || 0;
      if (minutos < 10) return; // ignorar entradas irrelevantes
      jogos.push({
        fixtureId:  s.games?.appearences ? null : null,
        minutos,
        rating:     isNaN(rating) ? null : +rating.toFixed(2),
        gols:       s.goals?.total || 0,
        assistencias: s.goals?.assists || 0,
        chutes:     s.shots?.total || 0,
        passes:     s.passes?.total || 0,
        precisaoPasses: s.passes?.accuracy || null,
        dribles:    s.dribbles?.success || 0,
        duelos:     { vencidos: s.duels?.won || 0, total: s.duels?.total || 0 },
        faltas:     s.fouls?.committed || 0,
        amarelos:   s.cards?.yellow || 0,
      });
    });

    // Pegar últimos 10 com rating
    const comRating = jogos.filter(j => j.rating !== null).slice(-10);

    // Calcular médias
    const mediaRating    = comRating.length
      ? +(comRating.reduce((a,j) => a + j.rating, 0) / comRating.length).toFixed(2)
      : null;
    const mediaGols      = comRating.length
      ? +(comRating.reduce((a,j) => a + j.gols, 0) / comRating.length).toFixed(2)
      : null;
    const mediaMinutos   = comRating.length
      ? Math.round(comRating.reduce((a,j) => a + j.minutos, 0) / comRating.length)
      : null;

    // Último jogo (para fallback de rating)
    const ultimoJogo = comRating.length > 0 ? comRating[comRating.length - 1] : null;

    // Forma recente: últimos 5 ratings para sparkline
    const ultimosRatings = comRating.slice(-5).map(j => j.rating);

    const dados = {
      jogadorId,
      temporada: season,
      info: {
        nome:        jogador.player?.name,
        foto:        jogador.player?.photo,
        posicao:     jogador.statistics?.[0]?.games?.position,
        numero:      jogador.statistics?.[0]?.games?.number,
        timeNome:    jogador.statistics?.[0]?.team?.name,
      },
      historico:      comRating,
      totalJogos:     comRating.length,
      medias: {
        rating:    mediaRating,
        gols:      mediaGols,
        minutos:   mediaMinutos,
      },
      ultimoJogo,
      ultimosRatings,
    };

    // Salvar cache
    await cacheRef.set({ dados, cachedMs: Date.now() });

    return { sucesso: true, dados };
  } catch(e) {
    console.warn('buscarHistoricoJogador:', e.message);
    return { sucesso: false, erro: e.message, dados: null };
  }
});

// ═════════════════════════════════════════════════════════════════
// 🧠 YELLUP LEARN — SISTEMA DE CORRELAÇÃO ODDS × RESULTADO
// 4 camadas: Coleta → Agregação → Palpite → Exibição
// ═════════════════════════════════════════════════════════════════

// ── HELPER: converter odd para bucket de 0.25 ──
function oddParaBucket(odd) {
  if (!odd || odd <= 0) return null;
  return Math.round(odd * 4) / 4; // arredonda para múltiplo de 0.25
}

// ── HELPER: gerar chave de assinatura das odds ──
// Ex: odd1=3.60, oddX=2.80, odd2=2.20 → "3.5_2.75_2.25"
function gerarChaveOdds(odd1, oddX, odd2) {
  const b1 = oddParaBucket(odd1);
  const bX = oddParaBucket(oddX);
  const b2 = oddParaBucket(odd2);
  if (!b1 || !bX || !b2) return null;
  return b1.toFixed(2) + '_' + bX.toFixed(2) + '_' + b2.toFixed(2);
}

// ── HELPER: bucket de escanteios (grupos de 2) ──
function bucketEscanteios(total) {
  if (total <= 4)  return '0-4';
  if (total <= 6)  return '5-6';
  if (total <= 8)  return '7-8';
  if (total <= 10) return '9-10';
  if (total <= 12) return '11-12';
  return '13+';
}

// ════════════════════════════════════════════════════════════════
// CAMADA 1 — COLETA
// Chamada dentro do processarPrevisoes quando jogo encerra
// Salva em correlacao-odds um documento completo por jogo
// ════════════════════════════════════════════════════════════════
async function coletarCorrelacaoOdds(db, fixtureId, golsCasa, golsFora, eventos, estatisticas) {
  try {
    // Buscar odds pré-jogo que já capturamos
    const oddsSnap = await db.collection('odds-prejogo').doc(String(fixtureId)).get();
    if (!oddsSnap.exists) {
      console.log('coletarCorrelacaoOdds: sem odds pré-jogo para fixture', fixtureId);
      return;
    }

    // Evitar duplicata
    const ref = db.collection('correlacao-odds').doc(String(fixtureId));
    if ((await ref.get()).exists) return;

    const o = oddsSnap.data();
    const odd1 = o.odds?.resultados?.odd1;
    const oddX = o.odds?.resultados?.oddX;
    const odd2 = o.odds?.resultados?.odd2;
    const oddO25 = o.odds?.overUnder?.over25;
    const oddO15 = o.odds?.overUnder?.over15;
    const oddO35 = o.odds?.overUnder?.over35;
    const oddAmb = o.odds?.ambasMarcam?.sim;

    const chave = gerarChaveOdds(odd1, oddX, odd2);
    if (!chave) return;

    // Resultado real
    const resultado = golsCasa > golsFora ? 'casa' : golsFora > golsCasa ? 'fora' : 'empate';
    const golsTotal = golsCasa + golsFora;

    // Gols por tempo (eventos)
    const golsPT = eventos.filter(e =>
      e.type === 'Goal' && e.detail !== 'Own Goal' && (e.time?.elapsed || 0) <= 45
    ).length;
    const golsST = eventos.filter(e =>
      e.type === 'Goal' && e.detail !== 'Own Goal' && (e.time?.elapsed || 0) > 45
    ).length;

    // Escanteios
    const getEst = (teamId, key) => {
      const t = (estatisticas || []).find(s => s.team?.id === teamId || s.time?.id === teamId);
      if (!t) return 0;
      const stats = t.statistics || t.stats || {};
      const v = Object.entries(stats).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
      return v ? parseFloat(String(v[1]).replace('%','')) || 0 : 0;
    };
    const escanteiosCasa = getEst(o.timeCasaId, 'Corner');
    const escanteiosFora = getEst(o.timeForaId, 'Corner');
    const escanteiosTotal = escanteiosCasa + escanteiosFora;

    // Cartões
    const cartoes = eventos.filter(e => e.type === 'Card').length;

    // Probabilidades implícitas do mercado
    const probMercadoCasa = odd1 ? +((1/odd1)/1.05*100).toFixed(1) : null;
    const probMercadoEmp  = oddX ? +((1/oddX)/1.05*100).toFixed(1) : null;
    const probMercadoFora = odd2 ? +((1/odd2)/1.05*100).toFixed(1) : null;

    // Verificar se o mercado "errou" (favorito perdeu)
    const favorito = odd1 && odd2 ? (odd1 < odd2 ? 'casa' : odd2 < odd1 ? 'fora' : 'equilibrado') : null;
    const favoritoVenceu = favorito === resultado;
    const azarao = favorito && favorito !== 'equilibrado' && resultado !== favorito && resultado !== 'empate';

    const doc = {
      fixtureId: parseInt(fixtureId),
      timeCasaId: o.timeCasaId,
      timeForaId: o.timeForaId,
      ligaId: o.ligaId,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),

      // ── Assinatura de odds ──
      chaveOdds: chave,
      chaveOddsComOver: chave + '_o' + (oddParaBucket(oddO25) || '?'),
      odds: { odd1, oddX, odd2, oddO25, oddO15, oddO35, oddAmb },
      oddsArredondadas: {
        odd1: oddParaBucket(odd1),
        oddX: oddParaBucket(oddX),
        odd2: oddParaBucket(odd2),
        oddO25: oddParaBucket(oddO25),
      },
      tipoJogo: o.tipoJogo || null,
      probMercado: { casa: probMercadoCasa, empate: probMercadoEmp, fora: probMercadoFora },
      casasUsadas: o.casasUsadas || [],
      sinalSharp: o.sinalSharp || false,

      // ── Resultado real ──
      resultado,
      golsCasa,
      golsFora,
      golsTotal,
      golsPrimeiroTempo: golsPT,
      golsSegundoTempo: golsST,
      ambasMarcaram: golsCasa > 0 && golsFora > 0,
      over15: golsTotal > 1.5,
      over25: golsTotal > 2.5,
      over35: golsTotal > 3.5,
      over45: golsTotal > 4.5,
      exatoGols: golsCasa + '-' + golsFora,

      // ── Escanteios ──
      escanteiosCasa,
      escanteiosFora,
      escanteiosTotal,
      bucketEscanteios: bucketEscanteios(escanteiosTotal),
      over85Escanteios: escanteiosTotal > 8.5,
      over105Escanteios: escanteiosTotal > 10.5,

      // ── Contexto adicional ──
      cartoes,
      favoritoVenceu,
      azaraoVenceu: azarao,
      favorito,

      // ── Desvio do mercado ──
      // Se mercado dizia 70% casa e casa ganhou → desvio 0
      // Se mercado dizia 25% fora e fora ganhou → surpresa alta
      surpresaMercado: (() => {
        if (!probMercadoCasa) return null;
        const probPrevista = resultado === 'casa' ? probMercadoCasa
          : resultado === 'empate' ? probMercadoEmp
          : probMercadoFora;
        return probPrevista ? +(100 - probPrevista).toFixed(1) : null;
      })(),
    };

    await ref.set(doc);
    console.log('✅ Correlação odds salva: fixture', fixtureId, '| chave:', chave, '| resultado:', resultado, golsTotal, 'gols');

  } catch(e) {
    console.warn('coletarCorrelacaoOdds:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// CAMADA 2 — AGREGAÇÃO DIÁRIA
// Roda 1x/dia, lê toda a correlacao-odds e calcula padrões
// por chave de odds → salva em padroes-odds
// ════════════════════════════════════════════════════════════════
exports.agregarPadroesDiario = functions.pubsub
  .schedule('every day 06:00')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const db = admin.firestore();
      const snap = await db.collection('correlacao-odds').get();

      if (snap.empty) {
        console.log('agregarPadroes: sem dados ainda');
        return null;
      }

      // Agrupar por chaveOdds
      const grupos = {};
      snap.docs.forEach(doc => {
        const d = doc.data();
        const chave = d.chaveOdds;
        if (!chave) return;
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(d);
      });

      const batch = db.batch();

      for (const [chave, jogos] of Object.entries(grupos)) {
        const total = jogos.length;
        if (total < 3) continue; // mínimo para salvar

        // Contagens
        const vCasa   = jogos.filter(j => j.resultado === 'casa').length;
        const empate  = jogos.filter(j => j.resultado === 'empate').length;
        const vFora   = jogos.filter(j => j.resultado === 'fora').length;
        const over15  = jogos.filter(j => j.over15).length;
        const over25  = jogos.filter(j => j.over25).length;
        const over35  = jogos.filter(j => j.over35).length;
        const over45  = jogos.filter(j => j.over45).length;
        const ambas   = jogos.filter(j => j.ambasMarcaram).length;
        const azarao  = jogos.filter(j => j.azaraoVenceu).length;

        // Médias numéricas
        const mediaGols = +(jogos.reduce((a,j) => a + (j.golsTotal||0), 0) / total).toFixed(2);
        const mediaEsc  = +(jogos.reduce((a,j) => a + (j.escanteiosTotal||0), 0) / total).toFixed(1);
        const mediaCart = +(jogos.reduce((a,j) => a + (j.cartoes||0), 0) / total).toFixed(1);

        // Distribuição de gols (0, 1, 2, 3, 4, 5+)
        const distGols = [0,1,2,3,4,5].reduce((acc, n) => {
          acc[n === 5 ? '5+' : String(n)] = jogos.filter(j =>
            n === 5 ? j.golsTotal >= 5 : j.golsTotal === n
          ).length;
          return acc;
        }, {});

        // Placar mais frequente
        const placarCount = {};
        jogos.forEach(j => {
          const k = j.exatoGols || '?-?';
          placarCount[k] = (placarCount[k] || 0) + 1;
        });
        const placarMaisFrequente = Object.entries(placarCount)
          .sort((a,b) => b[1] - a[1]).slice(0, 3)
          .map(([p, c]) => ({ placar: p, vezes: c, pct: +(c/total*100).toFixed(0) }));

        // Bucket de escanteios mais frequente
        const escBuckets = {};
        jogos.forEach(j => {
          const b = j.bucketEscanteios || '?';
          escBuckets[b] = (escBuckets[b] || 0) + 1;
        });
        const escMaisFrequente = Object.entries(escBuckets)
          .sort((a,b) => b[1] - a[1])[0]?.[0] || null;

        // Odds médias desta chave
        const oddMed = (campo) => {
          const vals = jogos.map(j => j.odds?.[campo]).filter(Boolean);
          return vals.length ? +(vals.reduce((a,b) => a+b,0)/vals.length).toFixed(2) : null;
        };

        // Resultado mais provável
        const resultadoMaisProvavel =
          vCasa >= empate && vCasa >= vFora ? 'casa' :
          vFora >= empate && vFora >= vCasa ? 'fora' : 'empate';

        // Confiança (0-5 estrelas baseada no volume)
        const estrelas = total >= 100 ? 5 : total >= 50 ? 4 : total >= 25 ? 3 : total >= 10 ? 2 : 1;

        const padrao = {
          chaveOdds: chave,
          totalJogos: total,
          estrelas,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),

          // Odds representativas
          oddsRef: {
            odd1: oddMed('odd1'), oddX: oddMed('oddX'), odd2: oddMed('odd2'),
            oddO25: oddMed('oddO25'),
          },

          // Resultados
          resultado: {
            vitoriasCasa: vCasa, empates: empate, vitoriasFora: vFora,
            pctCasa:  +(vCasa/total*100).toFixed(1),
            pctEmpate:+(empate/total*100).toFixed(1),
            pctFora:  +(vFora/total*100).toFixed(1),
            maisProvavel: resultadoMaisProvavel,
          },

          // Gols
          gols: {
            media: mediaGols,
            pctOver15: +(over15/total*100).toFixed(1),
            pctOver25: +(over25/total*100).toFixed(1),
            pctOver35: +(over35/total*100).toFixed(1),
            pctOver45: +(over45/total*100).toFixed(1),
            pctAmbasMarcam: +(ambas/total*100).toFixed(1),
            distribuicao: distGols,
            placaresFrequentes: placarMaisFrequente,
            faixaMaisProvavel: mediaGols < 1.5 ? '0-1' : mediaGols < 2.5 ? '1-2' : mediaGols < 3.5 ? '2-3' : '3+',
          },

          // Escanteios
          escanteios: {
            media: mediaEsc,
            bucketMaisFrequente: escMaisFrequente,
            pctOver85: +(jogos.filter(j=>j.over85Escanteios).length/total*100).toFixed(1),
            pctOver105: +(jogos.filter(j=>j.over105Escanteios).length/total*100).toFixed(1),
          },

          // Surpresas
          surpresas: {
            pctAzaraoVenceu: +(azarao/total*100).toFixed(1),
            mediaCartoes: mediaCart,
          },
        };

        const ref = db.collection('padroes-odds').doc(chave.replace(/\./g, '_'));
        batch.set(ref, padrao);
      }

      await batch.commit();
      console.log('✅ Padrões agregados:', Object.keys(grupos).length, 'chaves | total jogos:', snap.size);
      return null;

    } catch(e) {
      console.error('agregarPadroesDiario:', e);
      return null;
    }
  });

// ════════════════════════════════════════════════════════════════
// CAMADA 3 — GERADOR DE PALPITES PRÉ-JOGO
// Roda 2h antes do jogo, cruza odds capturadas com padroes-odds
// Salva palpite em palpites-yellup para exibir ao usuário
// ════════════════════════════════════════════════════════════════
exports.gerarPalpitesRodada = functions.pubsub
  .schedule('every 30 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const db  = admin.firestore();
      const agora = new Date();
      const em4h  = new Date(Date.now() + 4 * 3600000);
      const em30m = new Date(Date.now() + 30 * 60000);

      // Jogos que começam entre 30min e 4h
      const jogosSnap = await db.collection('jogos').where('status', '==', 'agendado').get();
      const jogosAlvo = jogosSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => {
        const dt = j.data ? new Date(j.data) : j.dataInicio?.toDate?.() || null;
        return dt && dt >= em30m && dt <= em4h && j.apiFootballId;
      });

      if (!jogosAlvo.length) return null;

      let gerados = 0;
      for (const jogo of jogosAlvo) {
        try {
          // Buscar odds pré-jogo
          const oddsSnap = await db.collection('odds-prejogo').doc(String(jogo.apiFootballId)).get();
          if (!oddsSnap.exists) continue;
          const o = oddsSnap.data();
          const chave = gerarChaveOdds(o.odds?.resultados?.odd1, o.odds?.resultados?.oddX, o.odds?.resultados?.odd2);
          if (!chave) continue;

          // Buscar padrão para essa chave de odds
          const padraoSnap = await db.collection('padroes-odds').doc(chave.replace(/\./g,'_')).get();

          // Montar palpite (com ou sem dados históricos)
          const temDados = padraoSnap.exists && padraoSnap.data().totalJogos >= 5;
          const padrao = temDados ? padraoSnap.data() : null;

          const odd1 = o.odds?.resultados?.odd1;
          const oddX = o.odds?.resultados?.oddX;
          const odd2 = o.odds?.resultados?.odd2;
          const oddO25 = o.odds?.overUnder?.over25;

          // Probabilidade implícita do mercado (base quando não temos dados)
          const probMktCasa  = odd1 ? +((1/odd1)/1.05*100).toFixed(1) : 33;
          const probMktEmp   = oddX ? +((1/oddX)/1.05*100).toFixed(1) : 33;
          const probMktFora  = odd2 ? +((1/odd2)/1.05*100).toFixed(1) : 33;
          const probMktO25   = oddO25 ? +((1/oddO25)/1.05*100).toFixed(1) : 50;

          // Se temos dados históricos, usar. Senão, usar probabilidade do mercado
          const palpite = {
            fixtureId: jogo.apiFootballId,
            jogoId: jogo.id,
            timeCasaNome: jogo.timeCasa?.nome || jogo.timeCasaNome,
            timeForaNome: jogo.timeFora?.nome || jogo.timeForaNome,
            ligaNome: jogo.liga?.nome || jogo.ligaNome,
            dataJogo: jogo.data || jogo.dataInicio,
            geradoEm: admin.firestore.FieldValue.serverTimestamp(),

            chaveOdds: chave,
            odds: { odd1, oddX, odd2, oddO25 },
            temDadosHistoricos: temDados,
            totalJogosBase: padrao?.totalJogos || 0,
            estrelas: padrao?.estrelas || 0,

            // Resultado
            resultado: {
              // Dados reais se tiver, senão mercado
              pctCasa:   padrao ? padrao.resultado.pctCasa   : probMktCasa,
              pctEmpate: padrao ? padrao.resultado.pctEmpate : probMktEmp,
              pctFora:   padrao ? padrao.resultado.pctFora   : probMktFora,
              maisProvavel: padrao?.resultado?.maisProvavel || (
                probMktCasa > probMktEmp && probMktCasa > probMktFora ? 'casa' :
                probMktFora > probMktEmp ? 'fora' : 'empate'
              ),
              fonte: padrao ? 'historico' : 'mercado',
              placaresFrequentes: padrao?.gols?.placaresFrequentes || [],
            },

            // Gols
            gols: {
              mediaEsperada: padrao ? padrao.gols.media : (oddO25 ? +(2.5 - Math.log(oddO25-1)*0.8).toFixed(1) : null),
              pctOver25: padrao ? padrao.gols.pctOver25 : probMktO25,
              pctOver35: padrao?.gols?.pctOver35 || null,
              pctAmbasMarcam: padrao?.gols?.pctAmbasMarcam || null,
              faixaMaisProvavel: padrao?.gols?.faixaMaisProvavel || null,
              fonte: padrao ? 'historico' : 'mercado',
            },

            // Escanteios
            escanteios: {
              media: padrao?.escanteios?.media || null,
              bucketMaisFrequente: padrao?.escanteios?.bucketMaisFrequente || null,
              pctOver85: padrao?.escanteios?.pctOver85 || null,
              pctOver105: padrao?.escanteios?.pctOver105 || null,
              fonte: padrao ? 'historico' : null,
            },

            // Alertas
            alertas: [
              o.sinalSharp ? '🚨 Movimento sharp nas odds antes do jogo' : null,
              padrao?.surpresas?.pctAzaraoVenceu > 35 ? '⚠️ Azarão venceu em ' + padrao.surpresas.pctAzaraoVenceu + '% de jogos similares' : null,
            ].filter(Boolean),
          };

          // Salvar/atualizar palpite
          await db.collection('palpites-yellup').doc(String(jogo.apiFootballId)).set(palpite);
          gerados++;

        } catch(err) {
          console.warn('palpite jogo', jogo.apiFootballId, err.message);
        }
      }

      console.log('✅ Palpites gerados:', gerados, '/', jogosAlvo.length);
      return null;

    } catch(e) {
      console.error('gerarPalpitesRodada:', e);
      return null;
    }
  });

// ════════════════════════════════════════════════════════════════
// CAMADA 4 — API PARA O FRONT
// Busca palpites do dia para exibir na página do usuário
// ════════════════════════════════════════════════════════════════
exports.buscarPalpitesDia = functions.https.onCall(async (data, context) => {
  try {
    const db   = admin.firestore();
    const data_param = data?.data; // opcional: filtrar por data específica

    // Buscar palpites gerados nas últimas 12h
    const limite = new Date(Date.now() - 12 * 3600000);
    const snap = await db.collection('palpites-yellup')
      .orderBy('geradoEm', 'desc')
      .limit(30)
      .get();

    const palpites = snap.docs.map(d => d.data()).filter(p => {
      // Só jogos futuros ou das últimas horas
      const dt = p.dataJogo ? new Date(p.dataJogo) : null;
      return dt && dt > new Date(Date.now() - 3 * 3600000);
    });

    return { sucesso: true, palpites, total: palpites.length };

  } catch(e) {
    console.error('buscarPalpitesDia:', e);
    return { sucesso: false, palpites: [] };
  }
});

// ════════════════════════════════════════════════════════════════
// BUSCAR PALPITE DE UM JOGO ESPECÍFICO (para dados-jogoadmin)
// ════════════════════════════════════════════════════════════════
exports.buscarPalpiteJogo = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
    const db = admin.firestore();
    const snap = await db.collection('palpites-yellup').doc(String(fixtureId)).get();
    if (!snap.exists) return { sucesso: true, palpite: null };
    return { sucesso: true, palpite: snap.data() };
  } catch(e) {
    return { sucesso: false, palpite: null };
  }
});

// ═════════════════════════════════════════════════════════════════
// 🔬 MOTOR DE CONVERGÊNCIA — YELLUP PATTERNS
// Aprende padrões de estados pré-evento e gera alertas em tempo real
//
// Fluxo:
//   registrarSnapshotLive (enriquecido com delta)
//     → salvarEstadoPreEvento (quando gol/escanteio ocorre, salva o estado que precedeu)
//     → agregarBibliotecaPadroes (consolida padrões diariamente)
//     → buscarConvergencia (matching em tempo real durante o jogo)
// ═════════════════════════════════════════════════════════════════

// ── HELPER: normalizar métrica para 0-100 ──
function norm(val, min, max) {
  if (val === null || val === undefined) return null;
  return Math.min(100, Math.max(0, Math.round((val - min) / (max - min) * 100)));
}

// ── HELPER: calcular vetor de estado normalizado de um time ──
// Cada dimensão é 0-100, permite comparar times de ligas diferentes
function calcularVetorEstado(snap, time, minuto) {
  const s = snap[time] || {};
  return {
    // Pressão ofensiva (0-100)
    pressao:      norm(s.ataquesPerigosos, 0, 60),
    // Posse de bola (0-100 direto)
    posse:        s.posse !== null ? s.posse : null,
    // Eficiência ofensiva: xG por chute
    eficiencia:   s.chutesTotais > 0 ? norm(s.xg / s.chutesTotais, 0, 0.3) : 0,
    // Volume de chutes no alvo
    precisao:     norm(s.chutesAlvo, 0, 10),
    // Ritmo de escanteios (acumulado / minuto)
    ritmoEsc:     minuto > 0 ? norm(s.escanteios / minuto * 90, 0, 15) : 0,
    // xG acumulado
    xg:           norm(s.xg, 0, 3),
    // Rating médio do time
    ratingMedio:  s.ratingMedio ? norm(s.ratingMedio, 5, 9) : null,
    // Intensidade (ações físicas)
    intensidade:  norm(s.intensidadeIntervalo || s.ataquesPerigosos, 0, 40),
    // Momentum (delta de posse nos últimos snapshots)
    deltaPressao: s.deltaPressao || 0,
    deltaPosse:   s.deltaPosse || 0,
    deltaRating:  s.deltaRating || 0,
  };
}

// ── HELPER: similaridade entre dois vetores (0-1) ──
function similaridadeVetores(v1, v2) {
  const campos = ['pressao','posse','eficiencia','precisao','xg','ratingMedio'];
  let soma = 0, total = 0;
  for (const c of campos) {
    if (v1[c] === null || v2[c] === null) continue;
    const diff = Math.abs((v1[c] || 0) - (v2[c] || 0));
    soma += Math.max(0, 1 - diff / 50); // tolerância de 50 pontos
    total++;
  }
  return total > 0 ? soma / total : 0;
}

// ════════════════════════════════════════════════════════════════
// BLOCO 1 — SNAPSHOT ENRIQUECIDO (substitui registrarSnapshotLive)
// Adiciona: delta vs snapshot anterior, vetor de estado, pressão acumulada
// ════════════════════════════════════════════════════════════════
exports.registrarSnapshotEnriquecido = functions.https.onCall(async (data, context) => {
  try {
    const {
      fixtureId, minuto, estatisticas, timeCasaId, timeForaId,
      placarCasa, placarFora, eventosRecentes, ratingsTime,
    } = data;
    if (!fixtureId || minuto === undefined) throw new functions.https.HttpsError('invalid-argument', 'ids obrigatórios');

    const db = admin.firestore();

    const getS = (sts, teamId, key) => {
      const t = (sts || []).find(t => t.time?.id === teamId || t.team?.id === teamId);
      if (!t) return null;
      const stats = t.stats || t.statistics || {};
      const v = Object.entries(stats).find(([k]) => k === key || k.toLowerCase() === key.toLowerCase());
      if (!v) return null;
      const s = String(v[1]).replace('%','').trim();
      return isNaN(s) ? null : parseFloat(s);
    };

    const G = (id, k) => getS(estatisticas, id, k) || 0;

    // Montar snapshot atual
    const snapAtual = {
      minuto,
      placar: { casa: placarCasa || 0, fora: placarFora || 0 },
      casa: {
        posse:              G(timeCasaId, 'Ball Possession'),
        ataquesPerigosos:   G(timeCasaId, 'Dangerous Attacks') || G(timeCasaId, 'Attacks'),
        ataques:            G(timeCasaId, 'Attacks'),
        chutesAlvo:         G(timeCasaId, 'Shots on Goal'),
        chutesTotais:       G(timeCasaId, 'Total Shots'),
        escanteios:         G(timeCasaId, 'Corner Kicks'),
        faltas:             G(timeCasaId, 'Fouls'),
        xg:                 G(timeCasaId, 'expected_goals'),
        passesOk:           G(timeCasaId, 'Passes accurate'),
        passesTotal:        G(timeCasaId, 'Total passes'),
        ratingMedio:        ratingsTime?.[timeCasaId]?.media || null,
        ratingAtaque:       ratingsTime?.[timeCasaId]?.ataque || null,
        ratingDefesa:       ratingsTime?.[timeCasaId]?.defesa || null,
        ratingMeio:         ratingsTime?.[timeCasaId]?.meio || null,
      },
      fora: {
        posse:              G(timeForaId, 'Ball Possession'),
        ataquesPerigosos:   G(timeForaId, 'Dangerous Attacks') || G(timeForaId, 'Attacks'),
        ataques:            G(timeForaId, 'Attacks'),
        chutesAlvo:         G(timeForaId, 'Shots on Goal'),
        chutesTotais:       G(timeForaId, 'Total Shots'),
        escanteios:         G(timeForaId, 'Corner Kicks'),
        faltas:             G(timeForaId, 'Fouls'),
        xg:                 G(timeForaId, 'expected_goals'),
        passesOk:           G(timeForaId, 'Passes accurate'),
        passesTotal:        G(timeForaId, 'Total passes'),
        ratingMedio:        ratingsTime?.[timeForaId]?.media || null,
        ratingAtaque:       ratingsTime?.[timeForaId]?.ataque || null,
        ratingDefesa:       ratingsTime?.[timeForaId]?.defesa || null,
        ratingMeio:         ratingsTime?.[timeForaId]?.meio || null,
      },
    };

    // Buscar últimos 3 snapshots para calcular deltas e tendência
    const histSnaps = await db.collection('partidas-live')
      .doc(String(fixtureId)).collection('snapshots-v2')
      .orderBy('minuto', 'desc').limit(3).get();

    const historico = histSnaps.docs.map(d => d.data()).filter(s => s.minuto < minuto);

    if (historico.length >= 1) {
      const ant = historico[0]; // snapshot imediatamente anterior
      const janela = Math.max(1, minuto - ant.minuto);

      // Delta em relação ao snapshot anterior
      for (const side of ['casa', 'fora']) {
        const cur = snapAtual[side], prv = ant[side] || {};
        snapAtual[side].deltaPressao  = (cur.ataquesPerigosos - (prv.ataquesPerigosos || 0));
        snapAtual[side].deltaPosse    = (cur.posse - (prv.posse || 0));
        snapAtual[side].deltaChutes   = (cur.chutesAlvo - (prv.chutesAlvo || 0));
        snapAtual[side].deltaXg       = +(cur.xg - (prv.xg || 0)).toFixed(3);
        snapAtual[side].deltaRating   = cur.ratingMedio && prv.ratingMedio
          ? +(cur.ratingMedio - prv.ratingMedio).toFixed(2) : 0;
        snapAtual[side].deltaEscanteios = cur.escanteios - (prv.escanteios || 0);
        // Ritmo: ataques perigosos por minuto na janela
        snapAtual[side].ritmoAtaques  = +(snapAtual[side].deltaPressao / janela).toFixed(2);
        snapAtual[side].intensidadeIntervalo =
          snapAtual[side].deltaPressao + snapAtual[side].deltaChutes * 2 + snapAtual[side].deltaEscanteios;
      }
    }

    if (historico.length >= 2) {
      const ant2 = historico[1]; // 2 snapshots atrás
      for (const side of ['casa', 'fora']) {
        const cur = snapAtual[side], prv2 = ant2[side] || {};
        // Aceleração: delta do delta (está acelerando ou desacelerando?)
        const deltaPressaoAnt = (historico[0][side]?.ataquesPerigosos || 0) - (prv2.ataquesPerigosos || 0);
        snapAtual[side].aceleracaoPressao = snapAtual[side].deltaPressao - deltaPressaoAnt;
        // Tendência de rating (crescendo, estável, caindo)
        const rAnt2 = prv2.ratingMedio, rAnt1 = historico[0][side]?.ratingMedio, rCur = cur.ratingMedio;
        if (rAnt2 && rAnt1 && rCur) {
          const tendR = (rCur - rAnt1) + (rAnt1 - rAnt2);
          snapAtual[side].tendenciaRating = tendR > 0.1 ? 'subindo' : tendR < -0.1 ? 'caindo' : 'estavel';
        }
      }
    }

    // Calcular vetores de estado normalizados
    snapAtual.vetorCasa = calcularVetorEstado(snapAtual, 'casa', minuto);
    snapAtual.vetorFora = calcularVetorEstado(snapAtual, 'fora', minuto);

    // ── YAI (Yellup Attack Index) ─────────────────────────────────────
    // Reconstrói Dangerous Attacks via stats disponíveis em todas as ligas
    const _calcYAI = (side) => {
      const s = snapAtual[side];
      const sOnGoal  = s.chutesAlvo     || 0;
      const sOff     = G(side === 'casa' ? timeCasaId : timeForaId, 'Shots off Goal');
      const sBlocked = G(side === 'casa' ? timeCasaId : timeForaId, 'Blocked Shots');
      const corners  = s.escanteios     || 0;
      const offside  = G(side === 'casa' ? timeCasaId : timeForaId, 'Offsides');
      if (!sOnGoal && !sOff && !sBlocked && !corners) return null;
      return +((sOnGoal * 3.0) + (sOff * 1.2) + (sBlocked * 1.0) + (corners * 0.6) + (offside * 0.3)).toFixed(1);
    };
    snapAtual.yai = { casa: _calcYAI('casa'), fora: _calcYAI('fora') };

    // ── GCS (Game Control Score 0–100) ────────────────────────────────
    // Combina posse + precisão de passes + share de chutes no alvo
    const _calcGCS = () => {
      const posC    = snapAtual.casa.posse || 50;
      const paC     = snapAtual.casa.passesOk && snapAtual.casa.passesTotal
        ? Math.round(snapAtual.casa.passesOk / snapAtual.casa.passesTotal * 100)
        : G(timeCasaId, 'Passes %') || 75;
      const sOnC    = snapAtual.casa.chutesAlvo || 0;
      const sOnF    = snapAtual.fora.chutesAlvo || 0;
      const sTotal  = sOnC + sOnF;
      const shotShare = sTotal > 0 ? sOnC / sTotal : 0.5;
      return Math.min(100, Math.max(0, Math.round(posC * 0.35 + paC * 0.25 + shotShare * 100 * 0.4)));
    };
    snapAtual.gcs = (snapAtual.casa.chutesAlvo != null || snapAtual.casa.posse != null) ? _calcGCS() : null;

    // Contexto do momento
    snapAtual.contexto = {
      fase: minuto <= 15 ? 'abertura' : minuto <= 30 ? 'primeiro_quarto' :
            minuto <= 45 ? 'fechamento_1t' : minuto <= 60 ? 'abertura_2t' :
            minuto <= 75 ? 'segundo_quarto' : 'reta_final',
      placarStatus: {
        casa: placarCasa > placarFora ? 'vencendo' : placarCasa < placarFora ? 'perdendo' : 'empatando',
        fora: placarFora > placarCasa ? 'vencendo' : placarFora < placarCasa ? 'perdendo' : 'empatando',
      },
      golsTotal: (placarCasa || 0) + (placarFora || 0),
    };

    snapAtual.ts = admin.firestore.FieldValue.serverTimestamp();
    snapAtual.timeCasaId = timeCasaId;
    snapAtual.timeForaId = timeForaId;

    // Salvar snapshot enriquecido
    await db.collection('partidas-live')
      .doc(String(fixtureId)).collection('snapshots-v2')
      .doc(String(minuto)).set(snapAtual);

    // Também manter compatibilidade com o antigo registrarSnapshotLive
    await db.collection('partidas-live')
      .doc(String(fixtureId)).collection('snapshots')
      .doc(String(minuto)).set({
        minuto,
        placarCasa: placarCasa || 0,    // ← novo: necessário para Pulso
        placarFora: placarFora || 0,    // ← novo: necessário para Pulso
        placar: { casa: placarCasa || 0, fora: placarFora || 0 }, // compatibilidade
        posse: { casa: snapAtual.casa.posse, fora: snapAtual.fora.posse },
        chutesAlvo: { casa: snapAtual.casa.chutesAlvo, fora: snapAtual.fora.chutesAlvo },
        ataquePerigoso: { casa: snapAtual.casa.ataquesPerigosos, fora: snapAtual.fora.ataquesPerigosos },
        escanteios: { casa: snapAtual.casa.escanteios, fora: snapAtual.fora.escanteios },
        xg: { casa: snapAtual.casa.xg, fora: snapAtual.fora.xg },
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { sucesso: true, delta: {
      casa: { deltaPressao: snapAtual.casa.deltaPressao, deltaPosse: snapAtual.casa.deltaPosse },
      fora: { deltaPressao: snapAtual.fora.deltaPressao, deltaPosse: snapAtual.fora.deltaPosse },
    }};

  } catch(e) {
    console.error('registrarSnapshotEnriquecido:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════
// BLOCO 2 — SALVAR ESTADO PRÉ-EVENTO
// Chamado quando um gol/escanteio/virada ocorre
// Olha para trás e extrai o vetor de estado que precedeu o evento
// Isso alimenta a biblioteca de padrões
// ════════════════════════════════════════════════════════════════
exports.salvarEstadoPreEvento = functions.https.onCall(async (data, context) => {
  try {
    const {
      fixtureId, tipoEvento, minutoEvento, timeId, timeCasaId, timeForaId,
      ligaId, placarAntes, oddsPrejogo,
    } = data;
    // tipoEvento: 'gol_casa' | 'gol_fora' | 'escanteio_sequencia' | 'virada' | 'gol_defesa'

    if (!fixtureId || !tipoEvento) throw new functions.https.HttpsError('invalid-argument', 'campos obrigatórios');

    const db = admin.firestore();

    // Buscar snapshots dos últimos 15 minutos antes do evento
    const snapsSnap = await db.collection('partidas-live')
      .doc(String(fixtureId)).collection('snapshots-v2')
      .where('minuto', '>=', Math.max(0, minutoEvento - 15))
      .where('minuto', '<', minutoEvento)
      .orderBy('minuto', 'desc')
      .limit(5).get();

    if (snapsSnap.empty) {
      console.log('salvarEstadoPreEvento: sem snapshots disponíveis para fixture', fixtureId);
      return { sucesso: false, motivo: 'sem snapshots' };
    }

    const snaps = snapsSnap.docs.map(d => d.data());
    const snapMaisRecente = snaps[0];
    const side = timeId === timeCasaId ? 'casa' : 'fora';
    const sideAdv = side === 'casa' ? 'fora' : 'casa';

    // Estado no momento imediatamente antes do evento
    const estadoTime = snapMaisRecente[side] || {};
    const estadoAdv  = snapMaisRecente[sideAdv] || {};
    const vetor      = snapMaisRecente['vetor' + side.charAt(0).toUpperCase() + side.slice(1)] || {};

    // Calcular tendência 10min antes vs 5min antes (se tiver snapshots suficientes)
    let tendencia10m = null;
    if (snaps.length >= 3) {
      const snapOld = snaps[snaps.length - 1];
      const snapRec = snaps[0];
      tendencia10m = {
        pressao:  (snapRec[side]?.ataquesPerigosos || 0) - (snapOld[side]?.ataquesPerigosos || 0),
        posse:    (snapRec[side]?.posse || 0) - (snapOld[side]?.posse || 0),
        xg:       +((snapRec[side]?.xg || 0) - (snapOld[side]?.xg || 0)).toFixed(3),
        rating:   snapRec[side]?.ratingMedio && snapOld[side]?.ratingMedio
          ? +(snapRec[side].ratingMedio - snapOld[side].ratingMedio).toFixed(2) : null,
      };
    }

    // Odds pré-jogo como contexto (bucket)
    const buckOdd = (v) => v ? Math.round(v * 4) / 4 : null;
    const odd1Bkt = buckOdd(oddsPrejogo?.odd1);
    const odd2Bkt = buckOdd(oddsPrejogo?.odd2);

    // Chave de padrão: tipo de evento + fase do jogo + situação de placar
    const fase = snapMaisRecente.contexto?.fase || 'desconhecido';
    const statusPlacar = snapMaisRecente.contexto?.placarStatus?.[side] || 'empatando';
    const chavesPadrao = [
      `${tipoEvento}__${fase}`,                             // ex: gol_casa__reta_final
      `${tipoEvento}__${statusPlacar}`,                     // ex: gol_casa__perdendo
      `${tipoEvento}__${fase}__${statusPlacar}`,            // ex: gol_casa__reta_final__perdendo
      odd1Bkt ? `${tipoEvento}__odd1_${odd1Bkt}` : null,   // ex: gol_casa__odd1_2.25
    ].filter(Boolean);

    // Documento de estado pré-evento
    const docEstado = {
      fixtureId: parseInt(fixtureId),
      tipoEvento,
      minutoEvento,
      timeId,
      timeCasaId,
      timeForaId,
      ligaId: ligaId || null,
      side,
      fase,
      statusPlacar,
      chavesPadrao,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),

      // Estado bruto no momento anterior ao evento
      estadoMomentoAntes: {
        minuto:            snapMaisRecente.minuto,
        posse:             estadoTime.posse,
        ataquesPerigosos:  estadoTime.ataquesPerigosos,
        chutesAlvo:        estadoTime.chutesAlvo,
        chutesTotais:      estadoTime.chutesTotais,
        escanteios:        estadoTime.escanteios,
        xg:                estadoTime.xg,
        faltas:            estadoTime.faltas,
        ratingMedio:       estadoTime.ratingMedio,
        ratingAtaque:      estadoTime.ratingAtaque,
        ratingDefesa:      estadoTime.ratingDefesa,
        ratingMeio:        estadoTime.ratingMeio,
        deltaPressao:      estadoTime.deltaPressao,
        deltaPosse:        estadoTime.deltaPosse,
        deltaChutes:       estadoTime.deltaChutes,
        deltaXg:           estadoTime.deltaXg,
        deltaRating:       estadoTime.deltaRating,
        deltaEscanteios:   estadoTime.deltaEscanteios,
        ritmoAtaques:      estadoTime.ritmoAtaques,
        aceleracaoPressao: estadoTime.aceleracaoPressao,
        tendenciaRating:   estadoTime.tendenciaRating,
        intensidadeIntervalo: estadoTime.intensidadeIntervalo,
      },
      // Estado do adversário no mesmo momento
      estadoAdversario: {
        posse:            estadoAdv.posse,
        ataquesPerigosos: estadoAdv.ataquesPerigosos,
        ratingMedio:      estadoAdv.ratingMedio,
        ratingDefesa:     estadoAdv.ratingDefesa,
      },
      // Vetor normalizado
      vetorNormalizado: vetor,
      // Tendência 10 min
      tendencia10m,
      // Contexto odds
      odds: oddsPrejogo || null,
      oddsArredondadas: { odd1: odd1Bkt, odd2: odd2Bkt, oddO25: buckOdd(oddsPrejogo?.oddO25) },
      // Placar antes do evento
      placarAntes: placarAntes || null,
    };

    // Salvar na coleção de estados pré-evento (biblioteca bruta)
    await db.collection('estados-pre-evento').add(docEstado);

    // Atualizar contadores nas chaves de padrão
    const batch = db.batch();
    for (const chave of chavesPadrao) {
      const ref = db.collection('biblioteca-padroes').doc(chave.replace(/[./]/g, '_'));
      batch.set(ref, {
        chave,
        totalEventos: admin.firestore.FieldValue.increment(1),
        ultimoEvento: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();

    console.log('✅ Estado pré-evento salvo:', tipoEvento, 'min', minutoEvento, 'chaves:', chavesPadrao);
    return { sucesso: true, chavesPadrao };

  } catch(e) {
    console.error('salvarEstadoPreEvento:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════
// BLOCO 3 — AGREGAÇÃO DA BIBLIOTECA DE PADRÕES (DIÁRIA)
// Para cada chave, calcula os limiares estatísticos que precedem eventos
// Ex: "quando gol_casa__reta_final: pressão média = 34, posse = 52, xg = 1.8"
// ════════════════════════════════════════════════════════════════
exports.agregarBibliotecaPadroes = functions.pubsub
  .schedule('every day 05:00')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const db = admin.firestore();
      const snap = await db.collection('estados-pre-evento').get();
      if (snap.empty) { console.log('biblioteca: sem dados ainda'); return null; }

      // Agrupar por chave
      const grupos = {};
      snap.docs.forEach(doc => {
        const d = doc.data();
        (d.chavesPadrao || []).forEach(chave => {
          if (!grupos[chave]) grupos[chave] = [];
          grupos[chave].push(d.estadoMomentoAntes);
        });
      });

      const batch = db.batch();

      for (const [chave, estados] of Object.entries(grupos)) {
        const n = estados.length;
        if (n < 5) continue; // mínimo para ser confiável

        // Calcular percentis das métricas (p25, p50, p75)
        const percentil = (arr, p) => {
          const sorted = arr.filter(v => v !== null && v !== undefined).sort((a,b)=>a-b);
          if (!sorted.length) return null;
          const idx = Math.floor(sorted.length * p / 100);
          return +sorted[Math.min(idx, sorted.length-1)].toFixed(2);
        };
        const media = (arr) => {
          const vals = arr.filter(v => v !== null && v !== undefined);
          return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null;
        };

        const campos = ['posse','ataquesPerigosos','chutesAlvo','chutesTotais',
                        'escanteios','xg','ratingMedio','deltaPressao','deltaPosse',
                        'deltaChutes','deltaXg','deltaRating','ritmoAtaques','intensidadeIntervalo'];

        const limiares = {};
        for (const campo of campos) {
          const vals = estados.map(e => e[campo]);
          limiares[campo] = {
            media: media(vals),
            p25:   percentil(vals, 25),
            p50:   percentil(vals, 50),
            p75:   percentil(vals, 75),
          };
        }

        // Frequência de tendência de rating
        const tendencias = estados.map(e => e.tendenciaRating).filter(Boolean);
        const freqTendencia = tendencias.reduce((acc, t) => { acc[t]=(acc[t]||0)+1; return acc; }, {});

        // Confiança (estrelas)
        const estrelas = n >= 50 ? 5 : n >= 25 ? 4 : n >= 15 ? 3 : n >= 8 ? 2 : 1;

        const padrao = {
          chave,
          totalEventos: n,
          estrelas,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          limiares,
          tendenciaRatingFreq: freqTendencia,
          // Resumo narrativo dos limites de alerta (p75 = "quando atingir esse nível, prepare-se")
          alertaLimiares: {
            pressao:    limiares.ataquesPerigosos?.p75,
            posse:      limiares.posse?.p75,
            xg:         limiares.xg?.p75,
            chutesAlvo: limiares.chutesAlvo?.p75,
            escanteios: limiares.escanteios?.p75,
            deltaPressao: limiares.deltaPressao?.p50,
            ritmoAtaques: limiares.ritmoAtaques?.p75,
          },
        };

        const ref = db.collection('biblioteca-padroes').doc(chave.replace(/[./]/g,'_'));
        batch.set(ref, padrao, { merge: true });
      }

      await batch.commit();
      console.log('✅ Biblioteca de padrões atualizada:', Object.keys(grupos).length, 'chaves');
      return null;

    } catch(e) {
      console.error('agregarBibliotecaPadroes:', e);
      return null;
    }
  });

// ════════════════════════════════════════════════════════════════
// BLOCO 4 — BUSCAR CONVERGÊNCIA EM TEMPO REAL
// Compara estado atual com biblioteca e retorna índice 0-100
// + narrativa explicando o que está convergindo e o que falta
// ════════════════════════════════════════════════════════════════
exports.buscarConvergencia = functions.https.onCall(async (data, context) => {
  try {
    const {
      fixtureId, minuto, timeCasaId, timeForaId, placarCasa, placarFora,
      estadoCasa, estadoFora, oddsPrejogo,
    } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();

    // Contexto atual
    const fase = minuto <= 15 ? 'abertura' : minuto <= 30 ? 'primeiro_quarto' :
                 minuto <= 45 ? 'fechamento_1t' : minuto <= 60 ? 'abertura_2t' :
                 minuto <= 75 ? 'segundo_quarto' : 'reta_final';
    const statusCasa = placarCasa > placarFora ? 'vencendo' : placarCasa < placarFora ? 'perdendo' : 'empatando';
    const statusFora = placarFora > placarCasa ? 'vencendo' : placarFora < placarCasa ? 'perdendo' : 'empatando';

    // Chaves relevantes para buscar padrões
    const chavesBusca = [
      `gol_casa__${fase}`,
      `gol_casa__${statusCasa}`,
      `gol_casa__${fase}__${statusCasa}`,
      `gol_fora__${fase}`,
      `gol_fora__${statusFora}`,
      `gol_fora__${fase}__${statusFora}`,
      `escanteio_sequencia__${fase}`,
    ];

    // Buscar padrões da biblioteca
    const padroes = {};
    await Promise.all(chavesBusca.map(async chave => {
      const snap = await db.collection('biblioteca-padroes').doc(chave.replace(/[./]/g,'_')).get();
      if (snap.exists && snap.data().totalEventos >= 5) padroes[chave] = snap.data();
    }));

    // Calcular índice de convergência para cada time
    const calcConvergencia = (estadoTime, statusPlacar, sideLabel, tipoGol) => {
      const chaves = [`${tipoGol}__${fase}`, `${tipoGol}__${statusPlacar}`, `${tipoGol}__${fase}__${statusPlacar}`];
      const padroesRel = chaves.map(c => padroes[c]).filter(Boolean);

      if (!padroesRel.length) {
        // Sem dados históricos — usar heurística baseada nos valores atuais
        return calcHeuristica(estadoTime, minuto);
      }

      const melhorPadrao = padroesRel.sort((a,b) => b.totalEventos - a.totalEventos)[0];
      const L = melhorPadrao.limiares;
      const A = melhorPadrao.alertaLimiares;

      // Para cada métrica, verificar se o estado atual está acima do p50 histórico
      let pontos = 0, maxPontos = 0;
      const fatoresAtivos = [], fatoresFaltando = [];

      const chk = (label, valorAtual, limiar, peso, complemento) => {
        if (limiar === null || valorAtual === null) return;
        maxPontos += peso;
        if (valorAtual >= limiar) {
          pontos += peso;
          fatoresAtivos.push(label);
        } else {
          fatoresFaltando.push({ fator: label, atual: valorAtual, falta: +(limiar - valorAtual).toFixed(1), complemento });
        }
      };

      chk('Pressão',      estadoTime.ataquesPerigosos, L.ataquesPerigosos?.p50, 20, 'ataques perigosos');
      chk('Posse',        estadoTime.posse,            L.posse?.p50,            15, '%');
      chk('xG',           estadoTime.xg,               L.xg?.p50,               20, 'xG');
      chk('Chutes alvo',  estadoTime.chutesAlvo,       L.chutesAlvo?.p50,       15, 'chutes');
      chk('Aceleração',   estadoTime.deltaPressao,     L.deltaPressao?.p50,     15, 'ataques crescentes');
      chk('Ritmo',        estadoTime.ritmoAtaques,     L.ritmoAtaques?.p50,     10, 'ataques/min');
      chk('Escanteios',   estadoTime.escanteios,       L.escanteios?.p50,       5,  'escanteios');

      const indice = maxPontos > 0 ? Math.round(pontos / maxPontos * 100) : 0;

      return {
        indice,
        base: melhorPadrao.totalEventos,
        estrelas: melhorPadrao.estrelas,
        fatoresAtivos,
        fatoresFaltando: fatoresFaltando.sort((a,b) => b.falta - a.falta),
        limiares: A,
      };
    };

    const calcHeuristica = (est, min) => {
      // Heurística quando não temos dados históricos
      let pontos = 0;
      const fatoresAtivos = [], fatoresFaltando = [];
      if (est.ataquesPerigosos >= 15) { pontos += 20; fatoresAtivos.push('Pressão'); }
      else fatoresFaltando.push({ fator: 'Pressão', atual: est.ataquesPerigosos, falta: 15 - est.ataquesPerigosos, complemento: 'ataques perigosos' });
      if (est.xg >= 1.0) { pontos += 20; fatoresAtivos.push('xG'); }
      else fatoresFaltando.push({ fator: 'xG', atual: est.xg, falta: +(1.0 - est.xg).toFixed(2), complemento: 'xG' });
      if (est.chutesAlvo >= 3) { pontos += 15; fatoresAtivos.push('Chutes alvo'); }
      else fatoresFaltando.push({ fator: 'Chutes alvo', atual: est.chutesAlvo, falta: 3 - est.chutesAlvo, complemento: 'chutes' });
      if (est.posse >= 50) { pontos += 15; fatoresAtivos.push('Posse'); }
      else fatoresFaltando.push({ fator: 'Posse', atual: est.posse, falta: +(50 - est.posse).toFixed(0), complemento: '%' });
      if (est.deltaPressao > 2) { pontos += 15; fatoresAtivos.push('Aceleração'); }
      if (est.deltaPosse > 3) { pontos += 15; fatoresAtivos.push('Crescendo'); }
      return { indice: pontos, base: 0, estrelas: 0, fatoresAtivos, fatoresFaltando };
    };

    const convCasa = calcConvergencia(estadoCasa, statusCasa, 'casa', 'gol_casa');
    const convFora = calcConvergencia(estadoFora, statusFora, 'fora', 'gol_fora');

    // Montar narrativas
    const gerarNarrativa = (conv, nomeTime, statusPlacar, lado) => {
      if (!conv) return null;
      const { indice, base, estrelas, fatoresAtivos, fatoresFaltando } = conv;
      const msgs = [];

      if (indice >= 75) {
        msgs.push(`🔴 ${nomeTime} em estado de alto risco de gol — ${fatoresAtivos.slice(0,3).join(', ')} convergindo simultaneamente.`);
        if (base > 0) msgs.push(`Em ${base} situações similares no banco, o gol saiu na maioria dos casos.`);
      } else if (indice >= 55) {
        msgs.push(`🟡 ${nomeTime} acumulando pressão — ${fatoresAtivos.join(', ')} ativos.`);
        if (fatoresFaltando.length > 0) {
          const f = fatoresFaltando[0];
          msgs.push(`Falta: ${f.fator} chegar a ${+(f.atual + f.falta).toFixed(1)} ${f.complemento} (atual: ${f.atual}).`);
        }
      } else if (indice >= 35) {
        msgs.push(`⚪ ${nomeTime} em construção — alguns fatores presentes mas ainda sem convergência.`);
        if (fatoresFaltando.length >= 2) {
          msgs.push(`Principais lacunas: ${fatoresFaltando.slice(0,2).map(f => f.fator).join(' e ')}.`);
        }
      } else {
        if (statusPlacar === 'perdendo' && minuto >= 60) {
          msgs.push(`⚪ ${nomeTime} perdendo e com perfil baixo de reação — padrão histórico desfavorável para virada neste cenário.`);
        } else {
          msgs.push(`⚪ ${nomeTime} sem fatores de pressão convergentes no momento.`);
        }
      }

      return { indice, base, estrelas, mensagens: msgs, fatoresAtivos, fatoresFaltando };
    };

    const nomCasa = data.timeCasaNome || 'Casa';
    const nomFora = data.timeForaNome || 'Fora';

    return {
      sucesso: true,
      minuto,
      casa: gerarNarrativa(convCasa, nomCasa, statusCasa, 'casa'),
      fora: gerarNarrativa(convFora, nomFora, statusFora, 'fora'),
      temDados: Object.keys(padroes).length > 0,
    };

  } catch(e) {
    console.error('buscarConvergencia:', e);
    return { sucesso: false, casa: null, fora: null };
  }
});

// ═════════════════════════════════════════════════════════════════
// 🧹 LIMPEZA AUTOMÁTICA DE DADOS ANTIGOS
// Roda todo domingo às 04:00 — remove dados desnecessários
// Mantém: fingerprints (permanente), previsões (90 dias), snapshots (30 dias)
// ═════════════════════════════════════════════════════════════════
exports.limparDadosAntigos = functions.pubsub
  .schedule('0 4 * * 0')  // domingo 04:00
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const db = admin.firestore();
    const agora = Date.now();
    const LIMITE_PREVISOES = 90 * 24 * 60 * 60 * 1000; // 90 dias
    const LIMITE_SNAPSHOTS = 30 * 24 * 60 * 60 * 1000; // 30 dias
    const LIMITE_DEDUPE    = 7  * 24 * 60 * 60 * 1000; // 7 dias
    const LIMITE_CACHE     = 24 * 60 * 60 * 1000;       // 1 dia
    let totalRemovidos = 0;

    // 1. Previsões antigas (>90 dias)
    try {
      const limitePrevisoes = new Date(agora - LIMITE_PREVISOES);
      const snap = await db.collection('previsoes')
        .where('criadoEm', '<', limitePrevisoes)
        .limit(500)
        .get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalRemovidos += snap.docs.length;
      console.log(`🗑️ Previsões antigas: ${snap.docs.length} removidas`);
    } catch(e) { console.warn('Limpeza previsões:', e.message); }

    // 2. Dedupe expirado (>7 dias)
    try {
      const limiteDedupe = new Date(agora - LIMITE_DEDUPE);
      const snap = await db.collection('previsoes-dedupe')
        .where('ts', '<', limiteDedupe.getTime())
        .limit(1000)
        .get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalRemovidos += snap.docs.length;
      console.log(`🗑️ Dedupe: ${snap.docs.length} removidos`);
    } catch(e) { console.warn('Limpeza dedupe:', e.message); }

    // 3. Cache de contexto >24h
    try {
      const limiteCache = new Date(agora - LIMITE_CACHE);
      const snap = await db.collection('cache-contexto')
        .where('ts', '<', limiteCache.getTime())
        .limit(200)
        .get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalRemovidos += snap.docs.length;
      console.log(`🗑️ Cache contexto: ${snap.docs.length} removidos`);
    } catch(e) { console.warn('Limpeza cache:', e.message); }

    // 4. Snapshots de jogos encerrados há >30 dias
    try {
      const limiteSnaps = new Date(agora - LIMITE_SNAPSHOTS);
      const snap = await db.collection('snapshots-live')
        .where('criadoEm', '<', limiteSnaps)
        .limit(500)
        .get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalRemovidos += snap.docs.length;
      console.log(`🗑️ Snapshots antigos: ${snap.docs.length} removidos`);
    } catch(e) { console.warn('Limpeza snapshots:', e.message); }

    // 5. Relatório da limpeza
    await db.collection('sistema-saude').doc('ultima-limpeza').set({
      rodarEm:        admin.firestore.FieldValue.serverTimestamp(),
      totalRemovidos,
      colecoes:       ['previsoes', 'previsoes-dedupe', 'cache-contexto', 'snapshots-live'],
    });

    console.log(`✅ Limpeza completa — ${totalRemovidos} documentos removidos`);
    return null;
  });

// ═════════════════════════════════════════════════════════════════
// 📊 DASHBOARD DE SAÚDE DO SISTEMA
// Retorna métricas operacionais para o painel admin
// ═════════════════════════════════════════════════════════════════
exports.buscarSaudeSistema = functions.https.onCall(async (data, context) => {
  try {
    const db = admin.firestore();

    // Buscar múltiplas coleções em paralelo com contagens
    const [
      previsSnap,
      fingerprintSnap,
      oddsSnap,
      relatorioSnap,
      ultimaLimpezaSnap,
      ultimaCalibSnap,
      jogosSnap,
    ] = await Promise.all([
      db.collection('previsoes').count().get(),
      db.collection('fingerprints').count().get(),
      db.collection('odds-prejogo').count().get(),
      db.collection('relatorios-jogos').count().get(),
      db.collection('sistema-saude').doc('ultima-limpeza').get(),
      db.collection('calibracao-algoritmo').doc('latest').get(),
      db.collection('jogos').where('status','==','ao_vivo').count().get(),
    ]);

    // Previsões das últimas 24h
    const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const previsRecentes = await db.collection('previsoes')
      .where('criadoEm', '>=', h24)
      .count().get();

    // Previsões verificadas vs pendentes
    const prevsPendentes = await db.collection('previsoes')
      .where('processado', '==', false)
      .count().get();

    // Árbitros no banco
    const arbitrosSnap = await db.collection('perfis-arbitros').count().get();

    const calibracao = ultimaCalibSnap.exists ? ultimaCalibSnap.data() : null;

    return {
      sucesso: true,
      dados: {
        colecoes: {
          previsoes:     previsSnap.data().count,
          fingerprints:  fingerprintSnap.data().count,
          oddsPrejogo:   oddsSnap.data().count,
          relatorios:    relatorioSnap.data().count,
          arbitros:      arbitrosSnap.data().count,
        },
        previsoes: {
          total:        previsSnap.data().count,
          ultimas24h:   previsRecentes.data().count,
          pendentes:    prevsPendentes.data().count,
          processadas:  previsSnap.data().count - prevsPendentes.data().count,
        },
        jogoAoVivo:    jogosSnap.data().count,
        calibracao: calibracao ? {
          acuraciaAtual:    calibracao.acuraciaAtual,
          totalPrevisoes:   calibracao.totalPrevisoes,
          rodarEm:          calibracao.rodarEm,
          aplicadoAuto:     calibracao.aplicadoAutomaticamente,
        } : null,
        ultimaLimpeza: ultimaLimpezaSnap.exists ? {
          rodarEm:       ultimaLimpezaSnap.data().rodarEm,
          totalRemovidos: ultimaLimpezaSnap.data().totalRemovidos,
        } : null,
        timestamp: new Date().toISOString(),
      }
    };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 🔄 PROCESSAR FINGERPRINT MANUAL (admin — para jogos passados)
// Permite "alimentar" o sistema com jogos históricos já encerrados
// ─────────────────────────────────────────────────────────────────
exports.processarFingerprintHistorico = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.email === 'admin@yellup.com') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
  try {
    const { fixtureIds } = data; // array de IDs para processar em lote
    if (!fixtureIds?.length) throw new functions.https.HttpsError('invalid-argument', 'fixtureIds obrigatório');

    let processados = 0;

    for (const fId of fixtureIds.slice(0, 20)) { // máx 20 por chamada
      try {
        const [fixData, evData] = await Promise.all([
          apiFootballGet(`/fixtures?id=${fId}`),
          apiFootballGet(`/fixtures/events?fixture=${fId}`),
        ]);
        const fix = fixData?.response?.[0];
        const eventos = evData?.response || [];
        if (fix && ['FT','AET','PEN'].includes(fix.fixture?.status?.short)) {
          await atualizarFingerprint(db, fix, eventos);
          processados++;
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error(`Fixture ${fId}:`, e.message);
      }
    }
    return { sucesso: true, processados };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║   YELLUP — PLAYERS SNAPSHOT AO VIVO + PREDICTIONS + ODDS       ║
// ╚══════════════════════════════════════════════════════════════════╝

// ─────────────────────────────────────────────────────────────────
// 📸 SNAPSHOT DE JOGADORES AO VIVO
// Chamado a cada 2 minutos durante jogos ao vivo.
// Grava stats individuais + calcula médias e diffs do time.
// ─────────────────────────────────────────────────────────────────
exports.registrarSnapshotPlayers = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, minuto } = data;
    if (!fixtureId || minuto === undefined)
      throw new functions.https.HttpsError('invalid-argument', 'fixtureId e minuto obrigatórios');

    const db = admin.firestore();

    // Buscar stats dos jogadores ao vivo
    const r = await apiFootballGet(`/fixtures/players?fixture=${fixtureId}`);
    const times = r.response || [];
    if (!times.length) return { sucesso: false, motivo: 'sem dados de jogadores' };

    const snapshot = { minuto, ts: admin.firestore.FieldValue.serverTimestamp(), times: [] };

    for (const t of times) {
      const jogadores = (t.players || []).map(p => {
        const s = p.statistics?.[0] || {};
        return {
          id:       p.player.id,
          nome:     p.player.name,
          rating:   parseFloat(s.games?.rating) || null,
          minutos:  s.games?.minutes || 0,
          posicao:  s.games?.position || null,
          // Ofensivo
          chutes:        s.shots?.total || 0,
          chutesAlvo:    s.shots?.on || 0,
          gols:          s.goals?.total || 0,
          assistencias:  s.goals?.assists || 0,
          passesChave:   s.passes?.key || 0,
          passesTotal:   s.passes?.total || 0,
          precisaoPasses: parseFloat(s.passes?.accuracy) || null,
          dribles:       s.dribbles?.attempts || 0,
          drilesSuccess: s.dribbles?.success || 0,
          // Defensivo
          desarmes:      s.tackles?.total || 0,
          bloqueios:     s.tackles?.blocks || 0,
          interceptacoes:s.tackles?.interceptions || 0,
          // Duelos
          duelosTotal:   s.duels?.total || 0,
          duelosVencidos:s.duels?.won || 0,
          // Disciplinar
          faltasCometidas: s.fouls?.committed || 0,
          faltasSofridas:  s.fouls?.drawn || 0,
          amarelos: s.cards?.yellow || 0,
          vermelhos: s.cards?.red || 0,
          // Goleiro
          defesas: s.goalkeeper?.saves || 0,
        };
      });

      // Calcular métricas agregadas do time
      const comRating = jogadores.filter(j => j.rating);
      const mediaRating = comRating.length
        ? comRating.reduce((a, j) => a + j.rating, 0) / comRating.length
        : null;

      // Índice de intensidade = soma de ações físicas por jogador
      const intensidade = jogadores.reduce((a, j) =>
        a + j.chutes + j.desarmes + j.dribles + j.interceptacoes + j.bloqueios, 0);

      snapshot.times.push({
        teamId:   t.team.id,
        nome:     t.team.name,
        mediaRating: mediaRating ? parseFloat(mediaRating.toFixed(2)) : null,
        intensidade,
        jogadores,
      });
    }

    // Buscar snapshot anterior para calcular diffs
    const anterior = await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots-players')
      .orderBy('minuto', 'desc')
      .limit(1)
      .get();

    // Calcular diffs por jogador (o que mudou desde o último snapshot)
    if (!anterior.empty) {
      const antData = anterior.docs[0].data();
      for (const tNow of snapshot.times) {
        const tAnt = antData.times?.find(t => t.teamId === tNow.teamId);
        if (!tAnt) continue;
        tNow.diff = {};
        for (const jNow of tNow.jogadores) {
          const jAnt = tAnt.jogadores?.find(j => j.id === jNow.id);
          if (!jAnt) continue;
          const d = {
            chutes:        jNow.chutes - jAnt.chutes,
            desarmes:      jNow.desarmes - jAnt.desarmes,
            dribles:       jNow.dribles - jAnt.dribles,
            interceptacoes:jNow.interceptacoes - jAnt.interceptacoes,
            passesChave:   jNow.passesChave - jAnt.passesChave,
          };
          // Só guardar diff se houve atividade
          const ativo = Object.values(d).some(v => v > 0);
          if (ativo) tNow.diff[jNow.id] = d;
        }
        // Intensidade do intervalo = soma dos diffs de ações
        tNow.intensidadeIntervalo = Object.values(tNow.diff)
          .reduce((a, d) => a + d.chutes + d.desarmes + d.dribles + d.interceptacoes, 0);
      }
    }

    await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots-players')
      .doc(String(minuto))
      .set(snapshot);

    return { sucesso: true, snapshot };
  } catch (e) {
    console.error('registrarSnapshotPlayers:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 📡 BUSCAR SNAPSHOTS DE PLAYERS (para o HTML)
// ─────────────────────────────────────────────────────────────────
exports.buscarSnapshotsPlayers = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
    const db = admin.firestore();
    const snaps = await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots-players')
      .orderBy('minuto', 'asc')
      .get();
    return {
      sucesso: true,
      snapshots: snaps.docs.map(d => d.data()),
    };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 🔮 BUSCAR PREDICTIONS PRÉ-JOGO (API-Football)
// Cache 6h — chamado 1x por jogo ao abrir
// ─────────────────────────────────────────────────────────────────
exports.buscarPredictions = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();
    const cacheRef = db.collection('cache-predictions').doc(String(fixtureId));
    const cacheSnap = await cacheRef.get();

    // Cache 6h
    if (cacheSnap.exists) {
      const age = Date.now() - (cacheSnap.data().ts || 0);
      if (age < 6 * 60 * 60 * 1000)
        return { sucesso: true, fonte: 'cache', dados: cacheSnap.data().dados };
    }

    const [predR, h2hR, oddsPreR] = await Promise.all([
      apiFootballGet(`/predictions?fixture=${fixtureId}`),
      apiFootballGet(`/fixtures/headtohead?h2h=${fixtureId}`), // precisa dos 2 team IDs — ajuste abaixo
      apiFootballGet(`/odds?fixture=${fixtureId}`), // todos bookmakers disponíveis
    ]);

    const pred = predR.response?.[0];
    if (!pred) return { sucesso: false, motivo: 'sem predictions para este jogo' };

    const dados = {
      // Previsão da API
      vencedor: {
        id:   pred.predictions?.winner?.id,
        nome: pred.predictions?.winner?.name,
        comentario: pred.predictions?.winner?.comment,
      },
      conselho: pred.predictions?.advice,
      percentuais: {
        casa: pred.predictions?.percent?.home,   // "65%"
        empate: pred.predictions?.percent?.draw,
        fora: pred.predictions?.percent?.away,
      },
      gols: {
        casa: pred.predictions?.goals?.home,
        fora: pred.predictions?.goals?.away,
      },
      // Comparativos entre os times
      comparacao: {
        forma:    { casa: pred.comparison?.form?.home,    fora: pred.comparison?.form?.away },
        ataque:   { casa: pred.comparison?.att?.home,     fora: pred.comparison?.att?.away },
        defesa:   { casa: pred.comparison?.def?.home,     fora: pred.comparison?.def?.away },
        posse:    { casa: pred.comparison?.poisson_distribution?.home, fora: pred.comparison?.poisson_distribution?.away },
        h2h:      { casa: pred.comparison?.h2h?.home,    fora: pred.comparison?.h2h?.away },
        gols:     { casa: pred.comparison?.goals?.home,  fora: pred.comparison?.goals?.away },
        total:    { casa: pred.comparison?.total?.home,  fora: pred.comparison?.total?.away },
      },
      // Lesões/forma dos times
      timeCasa: {
        id:        pred.teams?.home?.id,
        nome:      pred.teams?.home?.name,
        ultimaForma: pred.teams?.home?.last_5 || null,
      },
      timeFora: {
        id:        pred.teams?.away?.id,
        nome:      pred.teams?.away?.name,
        ultimaForma: pred.teams?.away?.last_5 || null,
      },
      // Odds pré-jogo (Bet365 bookmaker=6)
      oddsPre: extrairOdds(oddsPreR),
    };

    await cacheRef.set({ ts: Date.now(), dados });
    return { sucesso: true, fonte: 'api', dados };
  } catch (e) {
    console.error('buscarPredictions:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 📊 BUSCAR ODDS AO VIVO (In-play)
// Chamado a cada 3 minutos durante jogo ao vivo
// ─────────────────────────────────────────────────────────────────
exports.buscarOddsLive = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, nomeCasa, nomeFora } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    let dados = null;

    // ══════════════════════════════════════════════════════════════
    // PRIORIDADE 1 — Odds-API.io (Bet365 ao vivo real, ~60s delay)
    // Cobre UCL, Premier League e ligas que API-Football não entrega
    // ao vivo. Cache interno de 90s para não estourar cota.
    // ══════════════════════════════════════════════════════════════
    if (nomeCasa && nomeFora) {
      try {
        const oddsApiIo = await buscarOddsApiIo(nomeCasa, nomeFora, fixtureId);
        if (oddsApiIo && oddsApiIo.casa) {
          dados = oddsApiIo; // já tem { bookmaker, fonte:'odds_api_io', casa, empate, fora, over25, ... }
          console.log(`🎲 [ODDS-API.IO] ✅ ${oddsApiIo.bookmaker}: ${oddsApiIo.casa} / ${oddsApiIo.empate} / ${oddsApiIo.fora} (match=${oddsApiIo.matchScore?.toFixed(2)})`);
        } else {
          console.log(`🎲 [ODDS-API.IO] sem resultado para "${nomeCasa}" vs "${nomeFora}"`);
        }
      } catch (eApiIo) {
        console.warn(`🎲 [ODDS-API.IO] erro: ${eApiIo.message}`);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PRIORIDADE 2 — API-Football /odds/live
    // Cobertura limitada (~20 bookmakers) mas é grátis e imediato
    // quando disponível. Só chama se Odds-API.io não retornou.
    // ══════════════════════════════════════════════════════════════
    if (!dados) {
      try {
        const rLive = await apiFootballGet(`/odds/live?fixture=${fixtureId}`);
        const rawLive = rLive.response || [];
        if (rLive.results === 0 && !rLive.errors?.length) {
          console.log(`🎲 [API-FOOTBALL LIVE] results=0 — provavelmente plano Free (requer Basic+) ou jogo sem cobertura de odds ao vivo`);
        } else {
          console.log(`🎲 [API-FOOTBALL LIVE] results=${rLive.results}, bookmakers=${rawLive[0]?.bookmakers?.map(b=>b.name).join(', ')||'nenhum'}`);
          const extraido = extrairOddsLive(rawLive[0]);
          if (extraido && extraido.casa) {
            dados = { ...extraido, fonte: 'apifootball_live' };
            console.log(`🎲 [API-FOOTBALL LIVE] ✅ ${dados.bookmaker}: ${dados.casa}/${dados.empate}/${dados.fora}`);
          }
        }
      } catch (eAF) {
        console.warn(`🎲 [API-FOOTBALL LIVE] erro: ${eAF.message}`);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PRIORIDADE 3 — Odds pré-jogo (fallback estático)
    // Retorna o que estava antes do jogo começar. Marcado como
    // 'pre_jogo' para o front exibir com aviso visual.
    // ══════════════════════════════════════════════════════════════
    if (!dados) {
      try {
        let rPre = await apiFootballGet(`/odds?fixture=${fixtureId}&bookmaker=6`).catch(() => null);
        if (!rPre?.response?.length)
          rPre = await apiFootballGet(`/odds?fixture=${fixtureId}`).catch(() => null);

        if (rPre?.response?.length) {
          const bookmakers = rPre.response[0]?.bookmakers || [];
          const bk = bookmakers.find(b => b.name === 'Bet365' || b.id === 6) || bookmakers[0];
          if (bk) {
            const mw = bk.bets?.find(b => b.name === 'Match Winner' || b.id === 1);
            if (mw?.values) {
              const casaOdd   = mw.values.find(v => v.value === 'Home')?.odd;
              const empateOdd = mw.values.find(v => v.value === 'Draw')?.odd;
              const foraOdd   = mw.values.find(v => v.value === 'Away')?.odd;
              const ou        = bk.bets?.find(b => b.name === 'Goals Over/Under');
              const over25    = ou?.values?.find(v => v.value === 'Over 2.5')?.odd;
              const under25   = ou?.values?.find(v => v.value === 'Under 2.5')?.odd;
              dados = {
                bookmaker: bk.name || 'Bet365',
                fonte:     'pre_jogo',
                minuto:    null,
                casa:      parseFloat(casaOdd)   || null,
                empate:    parseFloat(empateOdd) || null,
                fora:      parseFloat(foraOdd)   || null,
                over25:    parseFloat(over25)    || null,
                under25:   parseFloat(under25)   || null,
                implCasa:   oddToProb(casaOdd),
                implEmpate: oddToProb(empateOdd),
                implFora:   oddToProb(foraOdd),
              };
              console.log(`🎲 [PRÉ-JOGO fallback] ${bk.name}: ${dados.casa}/${dados.empate}/${dados.fora}`);
            }
          }
        }
      } catch (ePre) {
        console.warn(`🎲 [PRÉ-JOGO fallback] erro: ${ePre.message}`);
      }
    }

    console.log(`🎲 Resultado final: ${dados ? `✅ ${dados.bookmaker} (${dados.fonte}) ${dados.casa}/${dados.empate}/${dados.fora}` : '❌ sem odds'}`);
    return { sucesso: true, dados };
  } catch (e) {
    console.error('❌ buscarOddsLive:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 🏥 BUSCAR LESÕES + H2H (chamado 1x ao abrir o jogo)
// ─────────────────────────────────────────────────────────────────
exports.buscarContextoJogo = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, timeCasaId, timeForaId, temporada } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();
    const cacheRef = db.collection('cache-contexto').doc(String(fixtureId));
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const age = Date.now() - (cacheSnap.data().ts || 0);
      if (age < 6 * 60 * 60 * 1000)
        return { sucesso: true, fonte: 'cache', dados: cacheSnap.data().dados };
    }

    const [lesoesCasaR, leoesForaR, h2hR] = await Promise.all([
      apiFootballGet(`/injuries?team=${timeCasaId}&fixture=${fixtureId}`),
      apiFootballGet(`/injuries?team=${timeForaId}&fixture=${fixtureId}`),
      apiFootballGet(`/fixtures/headtohead?h2h=${timeCasaId}-${timeForaId}&last=10`),
    ]);

    const mapLesoes = (r) => (r.response || []).map(l => ({
      id:        l.player?.id,
      nome:      l.player?.name,
      foto:      l.player?.photo,
      tipo:      l.player?.type,   // 'Missing Fixture' | 'Doubtful'
      motivo:    l.player?.reason,
    }));

    const h2h = (h2hR.response || []).slice(0, 10).map(f => ({
      data:   f.fixture?.date,
      casa:   { id: f.teams?.home?.id, nome: f.teams?.home?.name, gols: f.goals?.home },
      fora:   { id: f.teams?.away?.id, nome: f.teams?.away?.name, gols: f.goals?.away },
      status: f.fixture?.status?.short,
    }));

    const dados = {
      lesoesCasa: mapLesoes(lesoesCasaR),
      lesoesFora: mapLesoes(leoesForaR),
      h2h,
      // Resumo H2H
      h2hResumo: calcH2HResumo(h2h, timeCasaId, timeForaId),
    };

    await cacheRef.set({ ts: Date.now(), dados });
    return { sucesso: true, fonte: 'api', dados };
  } catch (e) {
    console.error('buscarContextoJogo:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// 🔧 HELPERS
// ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// 🎲 ODDS-API.IO — INTEGRAÇÃO PRINCIPAL DE ODDS AO VIVO
// Documentação: https://docs.odds-api.io
// ══════════════════════════════════════════════════════════════════

// Cache em memória: evita req duplicadas na mesma execução
const _oddsApiCache = new Map();

function oddsApiGet(path) {
  return new Promise((resolve, reject) => {
    const fullPath = `/v3${path}apiKey=${ODDS_API_IO_KEY}`; // path já tem trailing & ou ? — só adicionar apiKey
    const opts = {
      hostname: 'api.odds-api.io',
      path: fullPath,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'yellup-admin/1.0' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout odds-api.io')); });
    req.end();
  });
}

// Normaliza nome de time para comparação fuzzy
function _normTime(nome) {
  return (nome || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/fc|sc|ac|sf|ca/gi, '')
    .replace(/[^a-z0-9 ]/g, '').trim();
}

// Score de similaridade entre dois nomes (0-1)
function _similaridade(a, b) {
  const na = _normTime(a), nb = _normTime(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = na.split(' '), wb = nb.split(' ');
  const matches = wa.filter(w => w.length > 3 && wb.some(x => x.includes(w) || w.includes(x)));
  return matches.length / Math.max(wa.length, wb.length);
}

/**
 * Busca odds ao vivo de um fixture no odds-api.io.
 * Estratégia: busca eventos de futebol ao vivo → encontra pelo nome dos times → retorna odds.
 * @param {string} nomeCasa - nome do time da casa (da API-Football)
 * @param {string} nomeFora - nome do time visitante
 * @param {number} fixtureId - ID para cache
 * @returns {object|null} odds ou null se não encontrado
 */
async function buscarOddsApiIo(nomeCasa, nomeFora, fixtureId) {
  if (!ODDS_API_IO_KEY) {
    console.log('⚠️ ODDS_API_IO_KEY não configurado');
    return null;
  }

  const cacheKey = `odds_${fixtureId}`;
  const cached = _oddsApiCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < 90000) { // cache 90s
    return cached.data;
  }

  try {
    // 1. Buscar todos os eventos de futebol ao vivo
    const evRes = await oddsApiGet('/events?sport=football&status=live&');
    // Nota: API-Football /odds/live requer plano Basic+ — retorna results=0 em plano Free
    if (evRes.status !== 200 || !evRes.body?.data) {
      console.log(`🎲 odds-api.io events: status=${evRes.status}, body=${JSON.stringify(evRes.body).slice(0,200)}`);
      return null;
    }

    const eventos = evRes.body.data || [];
    console.log(`🎲 odds-api.io: ${eventos.length} eventos ao vivo de futebol`);

    // 2. Encontrar o evento pelo nome dos times (fuzzy match)
    let melhorEvento = null;
    let melhorScore = 0;

    for (const ev of eventos) {
      const simCasa = _similaridade(ev.home, nomeCasa);
      const simFora = _similaridade(ev.away, nomeFora);
      const score = (simCasa + simFora) / 2;
      if (score > melhorScore) {
        melhorScore = score;
        melhorEvento = ev;
      }
    }

    if (!melhorEvento || melhorScore < 0.4) {
      // Tentar pré-jogo (o evento pode ainda não ter começado ou ter nome diferente)
      const evPreRes = await oddsApiGet('/events?sport=football&status=upcoming&');
      const proximos = evPreRes.body?.data || [];
      for (const ev of proximos) {
        const simCasa = _similaridade(ev.home, nomeCasa);
        const simFora = _similaridade(ev.away, nomeFora);
        const score = (simCasa + simFora) / 2;
        if (score > melhorScore) {
          melhorScore = score;
          melhorEvento = ev;
        }
      }
    }

    if (!melhorEvento || melhorScore < 0.35) {
      console.log(`🎲 odds-api.io: nenhum evento encontrado para ${nomeCasa} vs ${nomeFora} (melhorScore=${melhorScore.toFixed(2)})`);
      return null;
    }

    console.log(`🎲 odds-api.io: match encontrado — ${melhorEvento.home} vs ${melhorEvento.away} (score=${melhorScore.toFixed(2)}, id=${melhorEvento.id})`);

    // 3. Buscar odds desse evento — Bet365 prioritário
    const oddsRes = await oddsApiGet(`/odds?eventId=${melhorEvento.id}&bookmakers=Bet365,Pinnacle,Bwin,1xBet&`);
    if (oddsRes.status !== 200 || !oddsRes.body?.data) {
      console.log(`🎲 odds-api.io odds: status=${oddsRes.status}`);
      return null;
    }

    const oddsData = oddsRes.body.data;
    const bookmakers = oddsData.bookmakers || {};

    // Extrair 1X2 e Over/Under 2.5
    const prioridade = ['Bet365', 'Pinnacle', 'Bwin', '1xBet'];
    let resultado = null;

    for (const bk of prioridade) {
      const bkData = bookmakers[bk];
      if (!bkData) continue;

      // Mercado 1X2 (ML = moneyline)
      const ml = (bkData.ML || bkData['Match Result'] || bkData['1X2'] || []);
      const mlArr = Array.isArray(ml) ? ml : [];
      const casaOdd   = mlArr.find(m => m.name === '1' || m.name === 'Home' || m.name === 'W1')?.odds;
      const empateOdd = mlArr.find(m => m.name === 'X' || m.name === 'Draw')?.odds;
      const foraOdd   = mlArr.find(m => m.name === '2' || m.name === 'Away' || m.name === 'W2')?.odds;

      if (!casaOdd) continue;

      // Over/Under 2.5
      const ou = (bkData['Totals'] || bkData['Over/Under'] || bkData['Goals'] || []);
      const ouArr = Array.isArray(ou) ? ou : [];
      const over25  = ouArr.find(m => (m.name||'').includes('2.5') && (m.name||'').toLowerCase().includes('over'))?.odds;
      const under25 = ouArr.find(m => (m.name||'').includes('2.5') && (m.name||'').toLowerCase().includes('under'))?.odds;

      resultado = {
        bookmaker: bk,
        fonte: 'odds_api_io',
        eventId: melhorEvento.id,
        matchScore: melhorScore,
        casa:   parseFloat(casaOdd)   || null,
        empate: parseFloat(empateOdd) || null,
        fora:   parseFloat(foraOdd)   || null,
        over25: parseFloat(over25)    || null,
        under25:parseFloat(under25)   || null,
        implCasa:   oddToProb(casaOdd),
        implEmpate: oddToProb(empateOdd),
        implFora:   oddToProb(foraOdd),
        atualizadoEm: new Date().toISOString(),
      };

      console.log(`🎲 ${bk}: casa=${casaOdd} empate=${empateOdd} fora=${foraOdd} over25=${over25}`);
      break; // pega o primeiro bookmaker com dados
    }

    _oddsApiCache.set(cacheKey, { ts: Date.now(), data: resultado });
    return resultado;

  } catch (e) {
    console.error('🎲 odds-api.io erro:', e.message);
    return null;
  }
}

function extrairOdds(r) {
  try {
    const bookmakers = r.response?.[0]?.bookmakers || [];
    if (!bookmakers.length) return null;
    
    // Tentar cada bookmaker até achar Match Winner
    let odds = null;
    for (const b of bookmakers) {
      const match = b.bets?.find(bt => bt.name === 'Match Winner' || bt.id === 1);
      if (match?.values?.length >= 3) {
        odds = {
          bookmaker: b.name,
          casa:   match.values.find(v => v.value === 'Home')?.odd,
          empate: match.values.find(v => v.value === 'Draw')?.odd,
          fora:   match.values.find(v => v.value === 'Away')?.odd,
        };
        break;
      }
    }
    if (!odds) return null;
    // Se tiver múltiplos bookmakers, calcular média das probabilidades implícitas
    if (bookmakers.length > 1) {
      const probs = { casa: [], empate: [], fora: [] };
      bookmakers.slice(0, 5).forEach(b => {
        const m = b.bets?.find(bt => bt.name === 'Match Winner' || bt.id === 1);
        if (!m) return;
        const h = parseFloat(m.values?.find(v => v.value === 'Home')?.odd);
        const d = parseFloat(m.values?.find(v => v.value === 'Draw')?.odd);
        const a = parseFloat(m.values?.find(v => v.value === 'Away')?.odd);
        if (h && d && a) {
          probs.casa.push(1/h); probs.empate.push(1/d); probs.fora.push(1/a);
        }
      });
      const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
      const aC=avg(probs.casa), aE=avg(probs.empate), aF=avg(probs.fora);
      if (aC && aE && aF) {
        const soma = aC+aE+aF;
        odds.mediaImplCasa = Math.round(aC/soma*100);
        odds.mediaImplEmpate = Math.round(aE/soma*100);
        odds.mediaImplFora = Math.round(aF/soma*100);
        odds.numBookmakers = bookmakers.length;
      }
    }
    return odds;
  } catch { return null; }
}

function extrairOddsLive(r) {
  try {
    if (!r) return null;

    // A API-Football /odds/live retorna estrutura bookmakers[].bets[]
    // (mesmo formato de /odds pré-jogo, não r.odds[])
    const bookmakers = r.bookmakers || [];

    // Fallback: algumas respostas usam r.odds[] (estrutura antiga)
    const legacyBets = r.odds || [];

    let vals = null;
    let bookmakerNome = null;

    // Tenta bookmakers moderno primeiro
    for (const bk of bookmakers) {
      const mw = bk.bets?.find(b => b.name === 'Match Winner' || b.id === 1);
      if (mw?.values?.length >= 3) {
        vals = mw.values;
        bookmakerNome = bk.name;
        break;
      }
    }

    // Fallback legado (r.odds[])
    if (!vals && legacyBets.length) {
      const mw = legacyBets.find(b => b.id === 1 || b.name === 'Match Winner');
      if (mw?.values?.length >= 3) {
        vals = mw.values;
        bookmakerNome = 'live';
      }
    }

    if (!vals) return null;

    const casaOdd   = vals.find(v => v.value === 'Home')?.odd;
    const empateOdd = vals.find(v => v.value === 'Draw')?.odd;
    const foraOdd   = vals.find(v => v.value === 'Away')?.odd;

    // Over/Under 2.5 — procura em todos os bookmakers
    let over25 = null, under25 = null;
    for (const bk of bookmakers) {
      const ou = bk.bets?.find(b => b.name === 'Goals Over/Under' || b.name === 'Over/Under');
      if (ou?.values) {
        over25  = parseFloat(ou.values.find(v => v.value === 'Over 2.5')?.odd) || null;
        under25 = parseFloat(ou.values.find(v => v.value === 'Under 2.5')?.odd) || null;
        if (over25) break;
      }
    }

    return {
      status:    r.status,
      minuto:    r.fixture?.status?.elapsed,
      bookmaker: bookmakerNome,
      casa:      casaOdd,
      empate:    empateOdd,
      fora:      foraOdd,
      over25,
      under25,
      // Probabilidades implícitas
      implCasa:   oddToProb(casaOdd),
      implEmpate: oddToProb(empateOdd),
      implFora:   oddToProb(foraOdd),
    };
  } catch { return null; }
}

function oddToProb(odd) {
  if (!odd) return null;
  const o = parseFloat(odd);
  if (!o || o <= 0) return null;
  return Math.round((1 / o) * 100);
}

function calcH2HResumo(h2h, casaId, foraId) {
  let vCasa = 0, vFora = 0, emp = 0;
  let golsCasa = 0, golsFora = 0;
  h2h.forEach(f => {
    if (!['FT','AET','PEN'].includes(f.status)) return;
    const gc = f.casa.id === casaId ? f.casa.gols : f.fora.gols;
    const gf = f.casa.id === foraId ? f.casa.gols : f.fora.gols;
    golsCasa += gc || 0;
    golsFora += gf || 0;
    if (gc > gf) vCasa++;
    else if (gc < gf) vFora++;
    else emp++;
  });
  const n = h2h.length || 1;
  return { vCasa, vFora, emp, golsCasa, golsFora,
    mediaGolsCasa: (golsCasa/n).toFixed(1), mediaGolsFora: (golsFora/n).toFixed(1) };
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║   YELLUP — PERFIL DE ÁRBITRO                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

// Helper interno — chamado pelo processarPrevisoes após cada jogo encerrado
async function _atualizarPerfilArbitro(db, fixture, eventos) {
  const nomeArbitro = fixture?.fixture?.referee;
  if (!nomeArbitro) return;

  const ligaId  = fixture?.league?.id ? String(fixture.league.id) : null;
  const ligaNome = fixture?.league?.name || null;

  const refId = nomeArbitro.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  // Atualizar perfil geral + perfil por liga (se ligaId disponível)
  const refs = [db.collection('perfis-arbitros').doc(refId)];
  if (ligaId) {
    refs.push(db.collection('perfis-arbitros').doc(`${refId}_liga_${ligaId}`));
  }

  for (const ref of refs) {
    const snap = await ref.get();
    const isLigaDoc = ref.id.includes('_liga_');
    const p = snap.exists ? snap.data() : {
      nome: nomeArbitro,
      ligaId:   isLigaDoc ? ligaId   : null,
      ligaNome: isLigaDoc ? ligaNome : null,
      totalJogos: 0,
      totalAmarelos: 0, totalVermelhos: 0, totalExpulsoes: 0,
      totalPenaltis: 0, totalVar: 0, amarelos1T: 0, amarelos2T: 0,
      histMinutosCartao: Array(9).fill(0),
    };

  p.totalJogos = (p.totalJogos || 0) + 1;

  const evArr = eventos || [];
  const amarelos     = evArr.filter(e => e.type === 'Card' && e.detail === 'Yellow Card');
  const vermelhos    = evArr.filter(e => e.type === 'Card' && (e.detail === 'Red Card' || e.detail === 'Second Yellow card'));
  const penaltis     = evArr.filter(e => e.type === 'Goal' && (e.detail === 'Penalty' || e.detail === 'Missed Penalty'));
  const vars         = evArr.filter(e => e.type === 'Var');

  p.totalAmarelos  = (p.totalAmarelos  || 0) + amarelos.length;
  p.totalVermelhos = (p.totalVermelhos || 0) + vermelhos.length;
  p.totalExpulsoes = (p.totalExpulsoes || 0) + vermelhos.length;
  p.totalPenaltis  = (p.totalPenaltis  || 0) + penaltis.length;
  p.totalVar       = (p.totalVar       || 0) + vars.length;
  p.amarelos1T     = (p.amarelos1T     || 0) + amarelos.filter(e => (e.time?.elapsed || 0) <= 45).length;
  p.amarelos2T     = (p.amarelos2T     || 0) + amarelos.filter(e => (e.time?.elapsed || 0) > 45).length;

  if (!Array.isArray(p.histMinutosCartao)) p.histMinutosCartao = Array(9).fill(0);
  amarelos.forEach(e => {
    const b = Math.min(8, Math.floor((e.time?.elapsed || 0) / 10));
    p.histMinutosCartao[b] = (p.histMinutosCartao[b] || 0) + 1;
  });

  const n = p.totalJogos;
  p.mediaAmarelos  = +(p.totalAmarelos / n).toFixed(2);
  p.mediaVermelhos = +(p.totalVermelhos / n).toFixed(2);
  p.mediaExpulsoes = +(p.totalExpulsoes / n).toFixed(2);
  p.mediaPenaltis  = +(p.totalPenaltis / n).toFixed(2);
  p.mediaVar       = +(p.totalVar / n).toFixed(2);
  p.pctJogosComExpulsao = +(p.totalExpulsoes / n).toFixed(3);
  p.pctJogosComPenalti  = +(Math.min(1, p.totalPenaltis / n)).toFixed(3);

  // Perfil textual
  const tags = [];
  if (p.mediaAmarelos >= 5)           tags.push('Rigoroso');
  else if (p.mediaAmarelos <= 2)      tags.push('Permissivo');
  else                                tags.push('Equilibrado');
  if (p.pctJogosComExpulsao >= 0.25)  tags.push('Alta chance de expulsão');
  if (p.mediaPenaltis >= 0.4)         tags.push('Marca muitos pênaltis');
  if (p.amarelos2T > p.amarelos1T * 1.8) tags.push('Mais rígido no 2T');
  if (p.mediaVar >= 1.5)              tags.push('VAR frequente');
    p.perfil = tags.join(' · ');
    p.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(p, { merge: true });
  }
  console.log(`👤 Perfil árbitro atualizado: ${nomeArbitro}${ligaId ? ' + por liga' : ''}`);
}

// ─────────────────────────────────────────────────────────────────
// 📡 BUSCAR PERFIL DO ÁRBITRO (para o HTML)
// ─────────────────────────────────────────────────────────────────
exports.buscarPerfilArbitro = functions.https.onCall(async (data, context) => {
  try {
    const { nomeArbitro, ligaId } = data;
    if (!nomeArbitro) return { sucesso: false, motivo: 'sem árbitro' };
    const db = admin.firestore();
    const refId = nomeArbitro.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // Buscar perfil geral + por liga em paralelo
    const [snapGeral, snapLiga] = await Promise.all([
      db.collection('perfis-arbitros').doc(refId).get(),
      ligaId
        ? db.collection('perfis-arbitros').doc(`${refId}_liga_${ligaId}`).get()
        : Promise.resolve(null),
    ]);

    const snap = snapLiga?.exists ? snapLiga : snapGeral; // prioridade: por liga
    if (!snap.exists) return { sucesso: true, dados: null };
    return { sucesso: true, dados: snap.data() };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});



// =====================================================
// 📚 BUSCAR HISTÓRICO DO TIME (últimos 50 jogos)
// =====================================================
exports.buscarHistoricoTime = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
  try {
    const { season, leagueId } = data;
    const teamId = parseInt(data.teamId); // API retorna IDs como number — garantir tipo correto
    if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId obrigatório');

    const db = admin.firestore();
    const cacheKey = `historico_v4_${teamId}_${season||'cur'}`; // v4: fix golsMinuto (teamId parseInt)
    const cacheRef = db.collection('cache-historico').doc(cacheKey);
    const cacheSnap = await cacheRef.get();

    // TTL: 24h (reduzido consumo de API)
    if (cacheSnap.exists) {
      const age = Date.now() - cacheSnap.data().ts;
      if (age < 24 * 60 * 60 * 1000) {
        return { sucesso: true, fonte: 'cache', jogos: cacheSnap.data().jogos };
      }
    }

    // Buscar últimos 35 jogos da temporada atual + 15 da anterior
    const curSeason = season || new Date().getFullYear();
    const [last35, prev15] = await Promise.all([
      apiFootballGet(`/fixtures?team=${teamId}&season=${curSeason}&last=35`),
      apiFootballGet(`/fixtures?team=${teamId}&season=${curSeason - 1}&last=15`),
    ]);

    const allFixtures = [
      ...(last35.response || []),
      ...(prev15.response || []),
    ].filter(f => ['FT','AET','PEN'].includes(f.fixture.status.short));

    // Montar jogos a partir dos fixtures já obtidos — SEM chamar API por jogo
    // Isso reduz de ~100 chamadas para apenas 2 chamadas por time
    const jogos = allFixtures.slice(0, 40).map(fix => {
      try {
        const isHome = Number(fix.teams.home.id) === teamId;
        const golosFeitos = isHome ? (fix.goals.home || 0) : (fix.goals.away || 0);
        const golosSofr   = isHome ? (fix.goals.away || 0) : (fix.goals.home || 0);
        const adversario  = isHome ? fix.teams.away : fix.teams.home;
        // Stats básicos que vêm no payload do fixture (sem chamada extra)
        const statsBasicos = fix.statistics || [];
        const stats = {};
        statsBasicos.forEach(t => {
          const isMyTeam = Number(t.team?.id) === teamId;
          const side = isMyTeam ? 'time' : 'adversario';
          stats[side] = {};
          (t.statistics || []).forEach(s => { stats[side][s.type] = s.value; });
        });
        return {
          fixtureId: fix.fixture.id,
          data:      fix.fixture.date,
          casa:      isHome,
          adversario: { id: adversario.id, nome: adversario.name, logo: adversario.logo },
          liga:      { id: fix.league.id, nome: fix.league.name },
          gols:      golosFeitos,
          golsSofridos: golosSofr,
          resultado: golosFeitos > golosSofr ? 'V' : golosFeitos === golosSofr ? 'E' : 'D',
          golsMinuto: [],
          golsSofridosMinuto: [],
          stats,
        };
      } catch(e) { return null; }
    }).filter(Boolean);

    await cacheRef.set({ ts: Date.now(), jogos, teamId });
    return { sucesso: true, fonte: 'api', jogos };
  } catch (error) {
    console.error('❌ buscarHistoricoTime:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// =====================================================
// 📡 REGISTRAR SNAPSHOT AO VIVO (chamado a cada 60s)
// =====================================================
exports.registrarSnapshotLive = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, minuto, estatisticas, timeCasaId, timeForaId } = data;
    if (!fixtureId || minuto === undefined) throw new functions.https.HttpsError('invalid-argument', 'fixtureId e minuto obrigatórios');

    const db = admin.firestore();
    const snap = {};

    // Extrair métricas-chave de cada time
    const getS = (sts, teamId, key) => {
      const t = (sts || []).find(t => t.time?.id === teamId);
      if (!t) return null;
      const v = t.stats?.[key];
      if (v === null || v === undefined) return null;
      const s = String(v).replace('%','').trim();
      return isNaN(s) ? null : parseFloat(s);
    };

    snap.minuto = minuto;
    snap.ts = admin.firestore.FieldValue.serverTimestamp();
    snap.posse = {
      casa: getS(estatisticas, timeCasaId, 'Ball Possession'),  // null se indisponível
      fora: getS(estatisticas, timeForaId, 'Ball Possession'),
    };
    snap.chutesAlvo = {
      casa: getS(estatisticas, timeCasaId, 'Shots on Goal') || 0,
      fora: getS(estatisticas, timeForaId, 'Shots on Goal') || 0,
    };
    snap.chutesTotais = {
      casa: getS(estatisticas, timeCasaId, 'Total Shots') || 0,
      fora: getS(estatisticas, timeForaId, 'Total Shots') || 0,
    };
    snap.ataquePerigoso = {
      casa: getS(estatisticas, timeCasaId, 'Dangerous Attacks') || getS(estatisticas, timeCasaId, 'Attacks') || 0,
      fora: getS(estatisticas, timeForaId, 'Dangerous Attacks') || getS(estatisticas, timeForaId, 'Attacks') || 0,
    };
    snap.ataques = {
      casa: getS(estatisticas, timeCasaId, 'Attacks') || 0,
      fora: getS(estatisticas, timeForaId, 'Attacks') || 0,
    };
    snap.escanteios = {
      casa: getS(estatisticas, timeCasaId, 'Corner Kicks') || 0,
      fora: getS(estatisticas, timeForaId, 'Corner Kicks') || 0,
    };
    snap.faltas = {
      casa: getS(estatisticas, timeCasaId, 'Fouls') || 0,
      fora: getS(estatisticas, timeForaId, 'Fouls') || 0,
    };
    snap.xg = {
      casa: getS(estatisticas, timeCasaId, 'expected_goals') || 0,
      fora: getS(estatisticas, timeForaId, 'expected_goals') || 0,
    };

    await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots')
      .doc(String(minuto))
      .set(snap);

    return { sucesso: true };
  } catch (error) {
    console.error('❌ registrarSnapshotLive:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// =====================================================
// 📈 BUSCAR SNAPSHOTS DA PARTIDA (série temporal)
// =====================================================
exports.buscarSnapshotsPartida = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
    const db = admin.firestore();
    const snaps = await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots')
      .orderBy('minuto', 'asc')
      .get();
    const snapshots = snaps.docs.map(d => d.data());
    return { sucesso: true, snapshots };
  } catch (error) {
    console.error('❌ buscarSnapshotsPartida:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});



// =====================================================
// 🔬 BUSCAR DADOS COMPLETOS DE UM JOGO (admin)
// =====================================================
exports.buscarDadosJogo = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    // Buscar tudo em paralelo
    const [fixResult, eventsResult, lineupsResult, statsResult, playersResult] =
      await Promise.all([
        apiFootballGet(`/fixtures?id=${fixtureId}`),
        apiFootballGet(`/fixtures/events?fixture=${fixtureId}`),
        apiFootballGet(`/fixtures/lineups?fixture=${fixtureId}`),
        apiFootballGet(`/fixtures/statistics?fixture=${fixtureId}`),
        apiFootballGet(`/fixtures/players?fixture=${fixtureId}`),
      ]);

    const fixture = fixResult.response?.[0];
    if (!fixture) throw new Error('Jogo não encontrado na API');

    // Eventos ordenados por minuto
    const eventos = (eventsResult.response || []).map(e => ({
      minuto:     e.time.elapsed,
      minutoExtra:e.time.extra || null,
      time:       { id: e.team.id, nome: e.team.name, logo: e.team.logo },
      jogador:    e.player   ? { id: e.player.id,   nome: e.player.name   } : null,
      assistente: e.assist   ? { id: e.assist.id,   nome: e.assist.name   } : null,
      tipo:       e.type,    // 'Goal','Card','subst','Var'
      detalhe:    e.detail,  // 'Normal Goal','Yellow Card','Substitution 1' etc
      comentarios:e.comments || null,
    })).sort((a,b) => (a.minuto||0)-(b.minuto||0));

    // Escalações
    const escalacoes = (lineupsResult.response || []).map(l => ({
      time:      { id: l.team.id, nome: l.team.name, logo: l.team.logo, cores: l.team.colors },
      tecnico:   l.coach ? { id: l.coach.id, nome: l.coach.name, foto: l.coach.photo } : null,
      formacao:  l.formation,
      titulares: (l.startXI || []).map(p => ({
        id:       p.player.id,
        nome:     p.player.name,
        numero:   p.player.number,
        posicao:  p.player.pos,
        grade:    p.player.grid, // ex: "1:1" (linha:coluna)
      })),
      reservas:  (l.substitutes || []).map(p => ({
        id:     p.player.id,
        nome:   p.player.name,
        numero: p.player.number,
        posicao:p.player.pos,
      })),
    }));

    // Estatísticas do jogo
    const estatisticas = (statsResult.response || []).map(t => ({
      time: { id: t.team.id, nome: t.team.name, logo: t.team.logo },
      stats: (t.statistics || []).reduce((acc, s) => {
        // Preservar null como null — frontend distingue "sem dado" de "0 real"
        acc[s.type] = s.value !== undefined ? s.value : null;
        return acc;
      }, {}),
    }));

    // Diagnóstico ao vivo
    const _hasStats = estatisticas.length >= 2;
    const _apC = estatisticas[0]?.stats?.['Dangerous Attacks'];
    const _apF = estatisticas[1]?.stats?.['Dangerous Attacks'];
    console.log(`📊 buscarDadosJogo ${fixtureId}: stats=${_hasStats}, DA=${_apC}x${_apF}, status=${fixture.fixture.status.short}/${fixture.fixture.status.elapsed}'`);

    // Estatísticas dos jogadores
    const jogadoresStats = (playersResult.response || []).map(t => ({
      time: { id: t.team.id, nome: t.team.name },
      jogadores: (t.players || []).map(p => ({
        id:      p.player.id,
        nome:    p.player.name,
        foto:    p.player.photo,
        stats:   p.statistics?.[0] || {},
      })),
    }));

    return {
      sucesso: true,
      fixture: {
        id:        fixture.fixture.id,
        data:      fixture.fixture.date,
        status:    { long: fixture.fixture.status.long, short: fixture.fixture.status.short, elapsed: fixture.fixture.status.elapsed },
        arbitro:   fixture.fixture.referee,
        venue:     fixture.fixture.venue,
        timeCasa:  { id: fixture.teams.home.id, nome: fixture.teams.home.name, logo: fixture.teams.home.logo, vencendo: fixture.teams.home.winner },
        timeFora:  { id: fixture.teams.away.id, nome: fixture.teams.away.name, logo: fixture.teams.away.logo, vencendo: fixture.teams.away.winner },
        placar:    { casa: fixture.goals.home, fora: fixture.goals.away },
        placarIntervalo: { casa: fixture.score.halftime.home, fora: fixture.score.halftime.away },
        placarFinal:     { casa: fixture.score.fulltime.home, fora: fixture.score.fulltime.away },
        placarPror:      { casa: fixture.score.extratime?.home, fora: fixture.score.extratime?.away },
        placarPen:       { casa: fixture.score.penalty?.home,   fora: fixture.score.penalty?.away   },
        liga: { id: fixture.league.id, nome: fixture.league.name, logo: fixture.league.logo, pais: fixture.league.country, rodada: fixture.league.round, temporada: fixture.league.season },
      },
      eventos,
      escalacoes,
      estatisticas,
      jogadoresStats,
    };
  } catch (error) {
    console.error('❌ buscarDadosJogo:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});



// =====================================================
// 🔬 BUSCAR DADOS COMPLETOS DE UM JOGO (admin)
// =====================================================

// ═══════════════════════════════════════════════════════════════
// 🧠 BUSCAR DADOS DO CÉREBRO — dashboard de aprendizado
// ═══════════════════════════════════════════════════════════════
exports.buscarDadosCerebro = functions.https.onCall(async (data, context) => {
  try {
    const db = admin.firestore();

    // 1. Biblioteca de padrões de convergência
    const bibSnap = await db.collection('biblioteca-padroes')
      .orderBy('confiancaEstrelas', 'desc')
      .limit(40)
      .get().catch(() => ({ empty: true, docs: [], size: 0 }));

    const biblioteca = bibSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 2. Padrões de odds
    const oddsSnap = await db.collection('padroes-odds')
      .orderBy('totalJogos', 'desc')
      .limit(25)
      .get().catch(() => ({ empty: true, docs: [], size: 0 }));

    const padroes_odds = oddsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 3. Contagem de estados pré-evento
    const estadosSnap = await db.collection('estados-pre-evento')
      .limit(500)
      .get().catch(() => ({ size: 0 }));
    const totalEstados = estadosSnap.size || 0;

    // 4. Contagem de snapshots enriquecidos
    const snapsSnap = await db.collection('snapshots-v2')
      .limit(500)
      .get().catch(() => ({ size: 0 }));
    const totalSnaps = snapsSnap.size || 0;

    // 5. Última calibração
    const calibDoc = await db.collection('calibracao-algoritmo').doc('latest')
      .get().catch(() => null);
    const calibracao = calibDoc?.exists ? calibDoc.data() : null;

    return {
      sucesso: true,
      biblioteca,
      padroes_odds,
      totalEstados,
      totalSnaps,
      calibracao,
      ts: new Date().toISOString(),
    };
  } catch (e) {
    console.error('buscarDadosCerebro:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🔄 INTELIGÊNCIA DE SUBSTITUIÇÃO — BACKEND
// ═══════════════════════════════════════════════════════════════════

// ── CF 1: Registrar impacto de uma substituição ──
// Chamado quando detectamos uma sub nos eventos — grava estado pré/pós
exports.registrarImpactoSubstituicao = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, jogadorEntrou, jogadorSaiu, timeId, minuto, snapPre, snapPos } = data;
    if (!fixtureId || !jogadorEntrou?.id) throw new functions.https.HttpsError('invalid-argument', 'Dados insuficientes');

    const db = admin.firestore();

    // Documento de impacto por jogador
    const docId = `${fixtureId}_${minuto}_${jogadorEntrou.id}`;
    await db.collection('impacto-substituicoes').doc(docId).set({
      fixtureId, minuto,
      jogadorEntrou: { id: jogadorEntrou.id, nome: jogadorEntrou.nome },
      jogadorSaiu:   { id: jogadorSaiu?.id||null, nome: jogadorSaiu?.nome||null },
      timeId,
      // Estado dos indicadores do TIME 5 min antes e 10 min depois
      snapPre:  snapPre  || null,  // { ap, chutesAlvo, posse, xg, placar }
      snapPos:  snapPos  || null,  // idem, 10 min depois
      // Calculado na agregação noturna
      deltaAP:       snapPos && snapPre ? (snapPos.ap      - snapPre.ap)      : null,
      deltaChutes:   snapPos && snapPre ? (snapPos.chutes  - snapPre.chutes)  : null,
      deltaPosse:    snapPos && snapPre ? (snapPos.posse   - snapPre.posse)   : null,
      deltaXg:       snapPos && snapPre ? (snapPos.xg      - snapPre.xg)      : null,
      golAconteceu:  snapPos ? (snapPos.placar > snapPre?.placar) : null,
      contexto: {
        placarPre: snapPre?.placar || null,
        minuto,
        isSegundoTempo: minuto > 45,
      },
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { sucesso: true };
  } catch (e) {
    console.error('registrarImpactoSubstituicao:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ── CF 2: Buscar perfil de impacto de um jogador ──
exports.buscarPerfilSubstituicao = functions.https.onCall(async (data, context) => {
  try {
    const { jogadorId } = data;
    if (!jogadorId) throw new functions.https.HttpsError('invalid-argument', 'jogadorId obrigatório');

    const db = admin.firestore();

    // Cache de 2h
    const cacheRef = db.collection('cache-substituicoes').doc(String(jogadorId));
    const cache = await cacheRef.get();
    if (cache.exists) {
      const d = cache.data();
      const ageH = (Date.now() - (d.ts?.toMillis()||0)) / 3600000;
      if (ageH < 2) return { sucesso: true, perfil: d.perfil, cached: true };
    }

    // Buscar todos os registros de impacto deste jogador
    const snap = await db.collection('impacto-substituicoes')
      .where('jogadorEntrou.id', '==', jogadorId)
      .orderBy('criadoEm', 'desc')
      .limit(50)
      .get();

    if (snap.empty) return { sucesso: false, motivo: 'Sem histórico de substituições' };

    const registros = snap.docs.map(d => d.data());
    const n = registros.length;

    // Calcular médias de impacto
    const comDelta = registros.filter(r => r.deltaAP !== null);
    const avg = (arr, fn) => arr.length ? arr.reduce((a, r) => a + (fn(r)||0), 0) / arr.length : 0;

    const mediaImpacto = {
      ap:     avg(comDelta, r => r.deltaAP),
      chutes: avg(comDelta, r => r.deltaChutes),
      posse:  avg(comDelta, r => r.deltaPosse),
      xg:     avg(comDelta, r => r.deltaXg),
    };

    // Taxa de gol após entrada
    const comResultado = registros.filter(r => r.golAconteceu !== null);
    const taxaGol = comResultado.length
      ? Math.round(comResultado.filter(r => r.golAconteceu).length / comResultado.length * 100)
      : null;

    // Melhor contexto (2T vs 1T)
    const r2T = registros.filter(r => r.contexto?.isSegundoTempo);
    const taxaGol2T = r2T.length
      ? Math.round(r2T.filter(r => r.golAconteceu).length / r2T.length * 100)
      : null;

    // Pontos fortes (indicadores com delta > 0 em >60% dos casos)
    const pontosFortes = [];
    if (comDelta.filter(r => r.deltaAP > 1).length / comDelta.length > 0.5) pontosFortes.push('ap');
    if (comDelta.filter(r => r.deltaChutes > 0.5).length / comDelta.length > 0.5) pontosFortes.push('chutes');
    if (comDelta.filter(r => r.deltaPosse > 2).length / comDelta.length > 0.5) pontosFortes.push('posse');
    if (comDelta.filter(r => r.deltaXg > 0.1).length / comDelta.length > 0.5) pontosFortes.push('xg');

    const perfil = {
      jogadorId,
      totalEntradas: n,
      mediaImpacto,
      taxaGol,
      taxaGol2T,
      pontosFortes,
      confianca: n >= 10 ? 'alta' : n >= 5 ? 'media' : 'baixa',
    };

    await cacheRef.set({ perfil, ts: admin.firestore.FieldValue.serverTimestamp() });
    return { sucesso: true, perfil };
  } catch (e) {
    console.error('buscarPerfilSubstituicao:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ── CF 3: Sugerir substituição para fechar gap de cenário ──
exports.sugerirSubstituicao = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId, timeId, gapIndicador, jogadoresBanco } = data;
    // gapIndicador: 'ap' | 'chutes' | 'posse' | 'xg'
    // jogadoresBanco: array de { id, nome, stats }

    const db = admin.firestore();

    if (!jogadoresBanco?.length) return { sucesso: false, motivo: 'Sem jogadores no banco' };

    // Buscar perfil de cada jogador do banco em paralelo
    const perfis = await Promise.all(
      jogadoresBanco.map(async j => {
        try {
          const ref = db.collection('cache-substituicoes').doc(String(j.id));
          const doc = await ref.get();
          if (doc.exists) return { jogador: j, perfil: doc.data().perfil };
          return { jogador: j, perfil: null };
        } catch { return { jogador: j, perfil: null }; }
      })
    );

    // Filtrar os que têm perfil e resolvem o gap
    const candidatos = perfis
      .filter(p => p.perfil?.pontosFortes?.includes(gapIndicador))
      .sort((a, b) => {
        const dA = a.perfil.mediaImpacto[gapIndicador] || 0;
        const dB = b.perfil.mediaImpacto[gapIndicador] || 0;
        return dB - dA;
      });

    return {
      sucesso: true,
      gapIndicador,
      candidatos: candidatos.slice(0, 3).map(c => ({
        jogador: c.jogador,
        impactoEsperado: c.perfil.mediaImpacto[gapIndicador],
        taxaGol: c.perfil.taxaGol,
        taxaGol2T: c.perfil.taxaGol2T,
        totalEntradas: c.perfil.totalEntradas,
        confianca: c.perfil.confianca,
        pontosFortes: c.perfil.pontosFortes,
      })),
    };
  } catch (e) {
    console.error('sugerirSubstituicao:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// ════════════════════════════════════════════════════════════════════════
// ⚡ SCHEDULE SNAPSHOT AUTOMÁTICO — roda a cada minuto sem admin aberto
// Detecta jogos ao_vivo no Firestore → busca stats + odds → grava snapshot
// enriquecido com deltas 1min e 3min + odds das 3 principais bets
// ════════════════════════════════════════════════════════════════════════
exports.scheduleSnapshotAutomatico = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      // ── 1. Jogos ao_vivo com apiFootballId ──────────────────────────
      const jogosSnap = await db.collection('jogos-admin')
        .where('status', '==', 'ao_vivo')
        .get();

      if (jogosSnap.empty) return null;

      const jogos = jogosSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(j => j.apiFootballId);

      if (!jogos.length) return null;

      // ── 2. Uma chamada traz todos ao vivo ───────────────────────────
      const liveData = await apiFootballGet('/fixtures?live=all');
      const liveAll  = liveData?.response || [];
      if (!liveAll.length) return null;

      const idsSet = new Set(jogos.map(j => String(j.apiFootballId)));
      const nossos = liveAll.filter(f => idsSet.has(String(f.fixture.id)));
      if (!nossos.length) return null;

      // ── 3. Para cada jogo nosso → stats + odds + snapshot ───────────
      for (const fixture of nossos) {
        const fxId  = String(fixture.fixture.id);
        const minuto = fixture.fixture.status.elapsed || 0;
        const jogoLocal = jogos.find(j => String(j.apiFootballId) === fxId);
        if (!jogoLocal) continue;

        // Buscar stats e odds em paralelo (2 chamadas por jogo)
        const [statsData, oddsData] = await Promise.all([
          apiFootballGet(`/fixtures/statistics?fixture=${fxId}`).catch(() => null),
          apiFootballGet(`/odds/live?fixture=${fxId}`).catch(() => null),
        ]);

        const casaId = fixture.teams?.home?.id;
        const foraId = fixture.teams?.away?.id;

        const getS = (arr, teamId, key) => {
          const t = (arr || []).find(t => t.team?.id === teamId);
          const s = (t?.statistics || []).find(s => s.type === key);
          if (!s?.value && s?.value !== 0) return 0;
          const v = String(s.value).replace('%','').trim();
          return isNaN(v) ? 0 : parseFloat(v);
        };

        const sts = statsData?.response || [];

        // Montar snapshot
        const snap = {
          minuto,
          placar: { casa: fixture.goals?.home || 0, fora: fixture.goals?.away || 0 },
          timeCasaId: casaId,
          timeForaId: foraId,
          timeCasaNome: fixture.teams?.home?.name || jogoLocal.timeCasa || '',
          timeForaNome: fixture.teams?.away?.name || jogoLocal.timeFora || '',
          casa: {
            posse:            getS(sts, casaId, 'Ball Possession'),
            ataquesPerigosos: getS(sts, casaId, 'Dangerous Attacks'),
            ataques:          getS(sts, casaId, 'Attacks'),
            chutesAlvo:       getS(sts, casaId, 'Shots on Goal'),
            chutesTotais:     getS(sts, casaId, 'Total Shots'),
            escanteios:       getS(sts, casaId, 'Corner Kicks'),
            faltas:           getS(sts, casaId, 'Fouls'),
            xg:               getS(sts, casaId, 'expected_goals'),
            passesOk:         getS(sts, casaId, 'Passes accurate'),
            passesTotal:      getS(sts, casaId, 'Total passes'),
          },
          fora: {
            posse:            getS(sts, foraId, 'Ball Possession'),
            ataquesPerigosos: getS(sts, foraId, 'Dangerous Attacks'),
            ataques:          getS(sts, foraId, 'Attacks'),
            chutesAlvo:       getS(sts, foraId, 'Shots on Goal'),
            chutesTotais:     getS(sts, foraId, 'Total Shots'),
            escanteios:       getS(sts, foraId, 'Corner Kicks'),
            faltas:           getS(sts, foraId, 'Fouls'),
            xg:               getS(sts, foraId, 'expected_goals'),
            passesOk:         getS(sts, foraId, 'Passes accurate'),
            passesTotal:      getS(sts, foraId, 'Total passes'),
          },
          ts: admin.firestore.FieldValue.serverTimestamp(),
        };

        // ── Odds das 3 principais bets ───────────────────────────────
        const betsAlvo = [6, 1, 8]; // Bet365=6, Bwin=1, 1xBet=8
        const betsNomes = {6:'Bet365', 1:'Bwin', 8:'1xBet'};
        const oddsCapturadas = {};

        const bookmakers = oddsData?.response?.[0]?.bookmakers || [];
        for (const bId of betsAlvo) {
          const book = bookmakers.find(b => b.id === bId);
          if (!book) continue;

          // Match Winner (1X2)
          const mw = book.bets?.find(b => b.name === 'Match Winner');
          if (mw?.values) {
            const o1   = mw.values.find(v => v.value === 'Home')?.odd;
            const ox   = mw.values.find(v => v.value === 'Draw')?.odd;
            const o2   = mw.values.find(v => v.value === 'Away')?.odd;
            oddsCapturadas[betsNomes[bId]] = {
              casa: o1 ? parseFloat(o1) : null,
              empate: ox ? parseFloat(ox) : null,
              fora: o2 ? parseFloat(o2) : null,
            };
          }

          // Over/Under 2.5
          const ou = book.bets?.find(b => b.name === 'Goals Over/Under');
          if (ou?.values) {
            const over  = ou.values.find(v => v.value === 'Over 2.5')?.odd;
            const under = ou.values.find(v => v.value === 'Under 2.5')?.odd;
            if (oddsCapturadas[betsNomes[bId]]) {
              oddsCapturadas[betsNomes[bId]].over25  = over  ? parseFloat(over)  : null;
              oddsCapturadas[betsNomes[bId]].under25 = under ? parseFloat(under) : null;
            }
          }
        }

        if (Object.keys(oddsCapturadas).length) snap.odds = oddsCapturadas;

        // ── Calcular deltas vs snapshots anteriores ──────────────────
        const histRef = db.collection('partidas-live')
          .doc(fxId).collection('snapshots-v2');

        const hist = await histRef
          .orderBy('minuto', 'desc').limit(4).get();

        const anteriores = hist.docs
          .map(d => d.data())
          .filter(s => s.minuto < minuto);

        // Delta 1 snapshot atrás
        if (anteriores.length >= 1) {
          const ant = anteriores[0];
          const janela = Math.max(1, minuto - (ant.minuto || 0));
          for (const side of ['casa', 'fora']) {
            const c = snap[side], p = ant[side] || {};
            snap[side].deltaPressao    = c.ataquesPerigosos - (p.ataquesPerigosos || 0);
            snap[side].deltaPosse      = +(c.posse - (p.posse || 0)).toFixed(1);
            snap[side].deltaChutes     = c.chutesAlvo - (p.chutesAlvo || 0);
            snap[side].deltaXg         = +(c.xg - (p.xg || 0)).toFixed(3);
            snap[side].deltaEscanteios = c.escanteios - (p.escanteios || 0);
            snap[side].ritmoAtaques    = +(snap[side].deltaPressao / janela).toFixed(2);
          }
        }

        // Delta 3 snapshots atrás (janela de ~3 minutos)
        if (anteriores.length >= 3) {
          const ant3 = anteriores[2];
          const janela3 = Math.max(1, minuto - (ant3.minuto || 0));
          for (const side of ['casa', 'fora']) {
            const c = snap[side], p3 = ant3[side] || {};
            snap[side].delta3Pressao    = c.ataquesPerigosos - (p3.ataquesPerigosos || 0);
            snap[side].delta3Posse      = +(c.posse - (p3.posse || 0)).toFixed(1);
            snap[side].delta3Chutes     = c.chutesAlvo - (p3.chutesAlvo || 0);
            snap[side].delta3Xg         = +(c.xg - (p3.xg || 0)).toFixed(3);
            snap[side].delta3Escanteios = c.escanteios - (p3.escanteios || 0);
            snap[side].ritmo3Ataques    = +(snap[side].delta3Pressao / janela3).toFixed(2);
          }

          // Aceleração (mudança no ritmo entre a janela 1 e janela 3)
          for (const side of ['casa', 'fora']) {
            const r1 = snap[side].ritmoAtaques || 0;
            const r3 = snap[side].ritmo3Ataques || 0;
            snap[side].aceleracao = +(r1 - r3).toFixed(2);
          }
        }

        // Métricas derivadas extra (além do tradicional)
        for (const side of ['casa', 'fora']) {
          const s = snap[side];
          // Eficiência de finalizações: chutes no alvo / chutes totais
          s.eficienciaFinalizacao = s.chutesTotais > 0
            ? +(s.chutesAlvo / s.chutesTotais * 100).toFixed(1) : 0;
          // Pressão de sequência: AP por minuto acumulado
          s.pressaoPorMinuto = minuto > 0
            ? +(s.ataquesPerigosos / minuto).toFixed(2) : 0;
          // xG por chute (qualidade das oportunidades)
          s.xgPorChute = s.chutesTotais > 0
            ? +(s.xg / s.chutesTotais).toFixed(3) : 0;
          // Precisão de passe %
          s.precisaoPasse = s.passesTotal > 0
            ? +(s.passesOk / s.passesTotal * 100).toFixed(1) : 0;
        }

        // Salvar na sub-coleção snapshots-v2
        await histRef.doc(String(minuto)).set(snap);

        // ── Atualizar placar/minuto em jogos-admin (para o apostas.html polling) ──
        try {
          await db.collection('jogos-admin').doc(jogoLocal.id).update({
            placarCasa: fixture.goals?.home ?? 0,
            placarFora: fixture.goals?.away ?? 0,
            minuto:     minuto,
            status:     'ao_vivo',
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch(eu) { console.warn('update jogos-admin placar skip:', eu.message); }

        // Compatibilidade com snapshots legado
        await db.collection('partidas-live')
          .doc(fxId).collection('snapshots')
          .doc(String(minuto)).set({
            minuto,
            posse:          { casa: snap.casa.posse, fora: snap.fora.posse },
            chutesAlvo:     { casa: snap.casa.chutesAlvo, fora: snap.fora.chutesAlvo },
            ataquePerigoso: { casa: snap.casa.ataquesPerigosos, fora: snap.fora.ataquesPerigosos },
            escanteios:     { casa: snap.casa.escanteios, fora: snap.fora.escanteios },
            xg:             { casa: snap.casa.xg, fora: snap.fora.xg },
            odds:           snap.odds || null,
            ts:             admin.firestore.FieldValue.serverTimestamp(),
          });

        // ── DETECTAR EVENTOS E SALVAR PRÉ-ESTADO ──────────────────
        // Compara snapshot atual vs anterior → registra fotografia pré-evento
        try {
          await detectarERegistrarPreEventos(db, fxId, snap, anteriores, jogoLocal);
        } catch(pe) { console.warn('preEvento skip:', pe.message); }
      }

      // ── 4. Detectar jogos que encerraram (FT/AET/PEN) ──────────────
      // Jogos que estão como ao_vivo no Firestore mas a API já mostra FT
      const STATUS_FT = ['FT', 'AET', 'PEN'];
      const encerrados = liveAll.filter(f => {
        const s = f.fixture?.status?.short;
        return idsSet.has(String(f.fixture.id)) && STATUS_FT.includes(s);
      });

      // Também verificar jogos ao_vivo que não aparecem mais no /fixtures?live=all
      // (API remove da lista live quando encerra — verificar esses separadamente)
      const idsAoVivoNossos = new Set(jogos.map(j => String(j.apiFootballId)));
      const idsNaAPIAoVivo  = new Set(liveAll.map(f => String(f.fixture.id)));
      const idsSumidos = [...idsAoVivoNossos].filter(id => !idsNaAPIAoVivo.has(id));

      // Para os sumidos, buscar individualmente para confirmar se é FT
      for (const apiId of idsSumidos.slice(0, 3)) { // max 3 por ciclo
        try {
          const checkData = await apiFootballGet(`/fixtures?id=${apiId}`);
          const checkFix  = checkData?.response?.[0];
          if (checkFix && STATUS_FT.includes(checkFix.fixture?.status?.short)) {
            encerrados.push(checkFix);
          }
        } catch(ce) { /* ignora erro de check individual */ }
      }

      // Processar cada jogo encerrado
      for (const fixture of encerrados) {
        const fxId     = String(fixture.fixture.id);
        const jogoLocal = jogos.find(j => String(j.apiFootballId) === fxId);
        if (!jogoLocal) continue;

        // Verificar se já foi processado (tem encerradoEm em partidas-live)
        const partidaDoc = await db.collection('partidas-live').doc(fxId).get();
        if (partidaDoc.exists && partidaDoc.data()?.encerradoEm) {
          // Já processado — só atualiza status se ainda ao_vivo
          if (jogoLocal.status === 'ao_vivo') {
            const ftPlacar = { casa: fixture.goals?.home ?? 0, fora: fixture.goals?.away ?? 0 };
            // Atualiza AMBAS as coleções
            await Promise.all([
              db.collection('jogos').doc(jogoLocal.id).update({
                status: 'encerrado',
                placarFinal: ftPlacar,
              }).catch(() => {}),
              db.collection('jogos-admin').doc(jogoLocal.id).update({
                status: 'encerrado',
                placarCasa: ftPlacar.casa,
                placarFora: ftPlacar.fora,
                minuto: 90,
                encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
              }).catch(() => {}),
            ]);
          }
          continue;
        }

        console.log(`🏁 Auto-FT detectado: fixture ${fxId} — iniciando pipeline pós-jogo`);

        try {
          const pC = fixture.goals?.home ?? 0;
          const pF = fixture.goals?.away ?? 0;
          const casaId = fixture.teams?.home?.id;
          const foraId = fixture.teams?.away?.id;
          const ligaId = fixture.league?.id ?? jogoLocal.liga?.id ?? null;
          const temporada = fixture.league?.season ?? new Date().getFullYear();

          // Buscar eventos e pré-odds em paralelo
          const [eventsData, preOddsDoc] = await Promise.all([
            apiFootballGet(`/fixtures/events?fixture=${fxId}`).catch(() => ({ response: [] })),
            db.collection('partidas-live').doc(fxId).get().catch(() => null),
          ]);

          const eventos = (eventsData?.response || []).map(e => ({
            tipo:   e.type,
            minuto: e.time?.elapsed ?? 0,
            timeId: e.team?.id ?? null,
          }));

          const oddsPrejogo = preOddsDoc?.data()?.oddsPrejogo ?? null;

          // ── Pipeline 1: vincular resultado ──────────────────────────
          const totalGols     = pC + pF;
          const resultadoFinal = pC > pF ? '1' : pC < pF ? '2' : 'X';
          const ambasMarcaram  = pC > 0 && pF > 0;
          const over25         = totalGols > 2;
          const over35         = totalGols > 3;
          let favoritoPrejogo  = null;
          if (oddsPrejogo?.odd1 && oddsPrejogo?.odd2) {
            favoritoPrejogo = oddsPrejogo.odd1 < oddsPrejogo.odd2 ? 'casa'
              : oddsPrejogo.odd2 < oddsPrejogo.odd1 ? 'fora' : 'empate';
          }
          const azaraoVenceu = favoritoPrejogo && (
            (favoritoPrejogo === 'casa' && resultadoFinal === '2') ||
            (favoritoPrejogo === 'fora' && resultadoFinal === '1')
          );

          const blocoResultado = {
            'resultado.totalGols':       totalGols,
            'resultado.resultadoFinal':  resultadoFinal,
            'resultado.placarFinal':     { casa: pC, fora: pF },
            'resultado.ambasMarcaram':   ambasMarcaram,
            'resultado.over25':          over25,
            'resultado.over35':          over35,
            'resultado.favoritoPrejogo': favoritoPrejogo,
            'resultado.azaraoVenceu':    azaraoVenceu,
            'resultado.processado':      true,
            'resultado.processadoEm':    admin.firestore.FieldValue.serverTimestamp(),
          };
          if (oddsPrejogo) {
            blocoResultado['oddsPrejogo.odd1']   = oddsPrejogo.odd1   ?? null;
            blocoResultado['oddsPrejogo.oddX']   = oddsPrejogo.oddX   ?? null;
            blocoResultado['oddsPrejogo.odd2']   = oddsPrejogo.odd2   ?? null;
            blocoResultado['oddsPrejogo.over25'] = oddsPrejogo.over25 ?? null;
          }

          // Atualizar snapshots com resultado
          const CHUNK = 400;
          const [sv1, sv2] = await Promise.all([
            db.collection('partidas-live').doc(fxId).collection('snapshots').get(),
            db.collection('partidas-live').doc(fxId).collection('snapshots-v2').get(),
          ]);
          const todasOps = [...sv1.docs, ...sv2.docs].map(d => ({ ref: d.ref, data: blocoResultado }));
          for (let i = 0; i < todasOps.length; i += CHUNK) {
            const batch = db.batch();
            todasOps.slice(i, i+CHUNK).forEach(op => batch.update(op.ref, op.data));
            await batch.commit();
          }

          // Salvar root doc de partidas-live com resultado
          await db.collection('partidas-live').doc(fxId).set({
            fixtureId: parseInt(fxId),
            ligaId, timeCasaId: casaId, timeForaId: foraId, temporada,
            resultado: {
              totalGols, resultadoFinal,
              placarFinal: { casa: pC, fora: pF },
              ambasMarcaram, over25, over35, favoritoPrejogo, azaraoVenceu,
            },
            oddsPrejogo: oddsPrejogo ?? null,
            encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          // ── Pipeline 2: enriquecimento de padrões ────────────────────
          // Reutiliza a lógica de enriquecerSnapshotsPosFT inline
          const snapV2 = await db.collection('partidas-live').doc(fxId)
            .collection('snapshots-v2').orderBy('minuto', 'asc').get();

          if (!snapV2.empty) {
            const snaps = snapV2.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
            const evGols    = eventos.filter(e => e.tipo === 'Goal');
            const evCartoes = eventos.filter(e => e.tipo === 'Card');

            const golNoInt      = (m,j) => evGols.some(e => e.minuto > m && e.minuto <= m+j);
            const cartaoNoInt   = (m,j) => evCartoes.some(e => e.minuto > m && e.minuto <= m+j);
            const golTimeNoInt  = (m,j,tId) => evGols.some(e => e.minuto > m && e.minuto <= m+j && e.timeId === tId);
            const possePor10Min = (arr, m) => {
              const jan = arr.filter(s => s.minuto >= m-10 && s.minuto < m);
              const vals = jan.map(s => s.casa?.posse).filter(v => v != null && v > 0);
              return vals.length ? Math.round(vals.reduce((a,b)=>a+b)/vals.length) : null;
            };
            const yaiPorMin = (arr, m, side) => {
              const ref = arr.filter(s => s.minuto >= m-10 && s.minuto < m);
              if (ref.length < 2) return null;
              const k = side === 'casa' ? 'casa' : 'fora';
              const yN = arr.find(s => s.minuto === m)?.yai?.[k] ?? null;
              const yO = ref[0]?.yai?.[k] ?? null;
              if (yN === null || yO === null) return null;
              return +((yN - yO) / Math.max(1, m - ref[0].minuto)).toFixed(3);
            };
            const faseJogo = (m) => m<=25?'0_25':m<=45?'26_45':m<=65?'46_65':'66_mais';
            const situacaoPlacar = (m, tId) => {
              const gT = evGols.filter(e => e.minuto <= m && e.timeId === tId).length;
              const gA = evGols.filter(e => e.minuto <= m && e.timeId !== tId).length;
              return gT > gA ? 'vencendo' : gT < gA ? 'perdendo' : 'empatando';
            };
            const classForça = (odd) => !odd ? 'desconhecido' : odd<1.50?'top':odd<2.20?'forte':odd<3.20?'equilibrado':'fraco';
            const forcaCasa = classForça(oddsPrejogo?.odd1);
            const forcaFora = classForça(oddsPrejogo?.odd2);
            const resFinalTime = (tId) => {
              const gT = evGols.length ? evGols.filter(e=>e.timeId===tId).length : (tId===casaId?pC:pF);
              const gA = evGols.length ? evGols.filter(e=>e.timeId!==tId).length : (tId===casaId?pF:pC);
              return gT>gA?'vitoria':gT<gA?'derrota':'empate';
            };

            const enricOps = [];
            const padroesGerais = [];

            for (const snap of snaps) {
              const min = snap.minuto || 0;
              enricOps.push({ ref: snap.ref, data: {
                'padraoEnriquecido.golNos5min':       golTimeNoInt(min,5,casaId),
                'padraoEnriquecido.golNos10min':      golTimeNoInt(min,10,casaId),
                'padraoEnriquecido.golNos15min':      golTimeNoInt(min,15,casaId),
                'padraoEnriquecido.qualquerGolNos5':  golNoInt(min,5),
                'padraoEnriquecido.qualquerGolNos10': golNoInt(min,10),
                'padraoEnriquecido.qualquerGolNos15': golNoInt(min,15),
                'padraoEnriquecido.cartaoNos10min':   cartaoNoInt(min,10),
                'padraoEnriquecido.situacaoPlacarCasa': situacaoPlacar(min,casaId),
                'padraoEnriquecido.situacaoPlacarFora': situacaoPlacar(min,foraId),
                'padraoEnriquecido.faseJogo':           faseJogo(min),
                'padraoEnriquecido.forcaAdversarioCasa': forcaFora,
                'padraoEnriquecido.forcaAdversarioFora': forcaCasa,
                'padraoEnriquecido.placarFinal':   `${pC}-${pF}`,
                'padraoEnriquecido.totalGolsFinal': pC + pF,
                'padraoEnriquecido.processado':     true,
                'padraoEnriquecido.processadoEm':   admin.firestore.FieldValue.serverTimestamp(),
              }});

              if (min >= 5 && min <= 85) {
                const base = {
                  fixtureId: parseInt(fxId), timeCasaId: casaId, timeForaId: foraId,
                  ligaId, temporada, minuto: min, faseJogo: faseJogo(min),
                  odd1: oddsPrejogo?.odd1??null, oddX: oddsPrejogo?.oddX??null,
                  odd2: oddsPrejogo?.odd2??null, over25: oddsPrejogo?.over25??null,
                  golNos5: golNoInt(min,5), golNos10: golNoInt(min,10), golNos15: golNoInt(min,15),
                  cartaoNos10: cartaoNoInt(min,10),
                  totalGolsFinal: pC+pF, placarFinal: `${pC}-${pF}`,
                  processadoEm: admin.firestore.FieldValue.serverTimestamp(),
                };
                padroesGerais.push({ docId: `${fxId}_${min}_casa`, data: {
                  ...base, timeId: casaId, localJogo: 'casa',
                  forcaAdversario: forcaFora, situacaoPlacar: situacaoPlacar(min,casaId),
                  posse: snap.casa?.posse??null, posseMedia10min: possePor10Min(snaps,min),
                  yaiAtual: snap.yai?.casa??null, yaiPorMin: yaiPorMin(snaps,min,'casa'),
                  xg: snap.casa?.xg??null, chutesAlvo: snap.casa?.chutesAlvo??null,
                  gcs: snap.gcs??null,
                  golTimeNos5: golTimeNoInt(min,5,casaId), golTimeNos10: golTimeNoInt(min,10,casaId),
                  golTimeNos15: golTimeNoInt(min,15,casaId),
                  resultadoFinal: resFinalTime(casaId),
                  golsAoMinuto: evGols.filter(e=>e.minuto<=min&&e.timeId===casaId).length,
                  golsRestantes: evGols.filter(e=>e.minuto>min&&e.timeId===casaId).length,
                }});
                padroesGerais.push({ docId: `${fxId}_${min}_fora`, data: {
                  ...base, timeId: foraId, localJogo: 'fora',
                  forcaAdversario: forcaCasa, situacaoPlacar: situacaoPlacar(min,foraId),
                  posse: snap.fora?.posse??null, posseMedia10min: null,
                  yaiAtual: snap.yai?.fora??null, yaiPorMin: yaiPorMin(snaps,min,'fora'),
                  xg: snap.fora?.xg??null, chutesAlvo: snap.fora?.chutesAlvo??null,
                  gcs: snap.gcs ? 100-snap.gcs : null,
                  golTimeNos5: golTimeNoInt(min,5,foraId), golTimeNos10: golTimeNoInt(min,10,foraId),
                  golTimeNos15: golTimeNoInt(min,15,foraId),
                  resultadoFinal: resFinalTime(foraId),
                  golsAoMinuto: evGols.filter(e=>e.minuto<=min&&e.timeId===foraId).length,
                  golsRestantes: evGols.filter(e=>e.minuto>min&&e.timeId===foraId).length,
                }});
              }
            }

            // Commit enriquecimento
            for (let i = 0; i < enricOps.length; i += CHUNK) {
              const batch = db.batch();
              enricOps.slice(i, i+CHUNK).forEach(op => batch.update(op.ref, op.data));
              await batch.commit();
            }
            // Commit padrões globais
            const padCol = db.collection('padroes-globais');
            for (let i = 0; i < padroesGerais.length; i += CHUNK) {
              const batch = db.batch();
              padroesGerais.slice(i, i+CHUNK).forEach(p => batch.set(padCol.doc(p.docId), p.data));
              await batch.commit();
            }
            // Atualizar índice por time
            for (const t of [{ tId: casaId, fAdv: forcaFora }, { tId: foraId, fAdv: forcaCasa }]) {
              await db.collection('indice-times').doc(String(t.tId)).set({
                ultimoJogo: parseInt(fxId), ultimaLiga: ligaId, ultimaTemporada: temporada,
                totalJogos: admin.firestore.FieldValue.increment(1),
                ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
            }

            console.log(`✅ Auto-FT ${fxId}: ${enricOps.length} snaps enriquecidos, ${padroesGerais.length} padrões salvos`);
          }

          // ── Atualizar status do jogo nas duas coleções ──────────────
          await Promise.all([
            db.collection('jogos').doc(jogoLocal.id).update({
              status: 'encerrado',
              placarFinal: { casa: pC, fora: pF },
              encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {}),
            db.collection('jogos-admin').doc(jogoLocal.id).update({
              status: 'encerrado',
              placarCasa: pC,
              placarFora: pF,
              minuto: 90,
              encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {}),
          ]);

        } catch(ftErr) {
          console.error(`Auto-FT erro fixture ${fxId}:`, ftErr.message);
        }
      }

      console.log(`⚡ Snapshots automáticos: ${nossos.length} jogos ao vivo, ${encerrados.length} encerrados processados`);
      return null;

    } catch(e) {
      console.error('scheduleSnapshotAutomatico:', e.message);
      return null;
    }
  });

// ════════════════════════════════════════════════════════════════════════
// 📡 BUSCAR SNAPSHOTS PULSO — retorna série temporal completa do jogo
// com deltas calculados e odds por minuto para a aba Pulso do admin
// ════════════════════════════════════════════════════════════════════════
exports.buscarSnapshotsPulso = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const snap = await db.collection('partidas-live')
      .doc(String(fixtureId))
      .collection('snapshots-v2')
      .orderBy('minuto', 'asc')
      .get();

    if (snap.empty) return { sucesso: true, snapshots: [] };

    const snapshots = snap.docs.map(d => {
      const s = d.data();
      // Remover campos Firebase que não serializamos
      delete s.ts;
      return s;
    });

    return { sucesso: true, snapshots, total: snapshots.length };

  } catch(e) {
    console.error('buscarSnapshotsPulso:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════
// 🔬 DETECTOR DE PRÉ-EVENTOS — chamado pelo scheduler a cada minuto
// Compara snapshot atual com anterior para detectar eventos relevantes
// e registrar a "fotografia" do jogo antes de cada acontecimento
// ════════════════════════════════════════════════════════════════════════
async function detectarERegistrarPreEventos(db, fxId, snapAtual, anteriores, jogoLocal) {
  if (!anteriores || anteriores.length < 1) return;

  const ant = anteriores[0]; // snapshot imediatamente anterior
  const ant3 = anteriores[2] || anteriores[0]; // ~3min atrás
  const ant5 = anteriores[4] || anteriores[0]; // ~5min atrás
  const minuto = snapAtual.minuto || 0;

  // ── Detectar gols ────────────────────────────────────────────
  const golCasa = (snapAtual.placar?.casa || 0) > (ant.placar?.casa || 0);
  const golFora = (snapAtual.placar?.fora || 0) > (ant.placar?.fora || 0);

  // ── Detectar sequência de escanteios (3+ em 5min) ────────────
  const escC3 = (snapAtual.casa?.escanteios || 0) - (ant3.casa?.escanteios || 0);
  const escF3 = (snapAtual.fora?.escanteios || 0) - (ant3.fora?.escanteios || 0);
  const seqEscCasa = escC3 >= 3;
  const seqEscFora = escF3 >= 3;

  // ── Detectar pressão explosiva (+4 AP em 2min) ────────────────
  const dAPCasa2 = (snapAtual.casa?.ataquesPerigosos || 0) - (ant.casa?.ataquesPerigosos || 0);
  const dAPFora2 = (snapAtual.fora?.ataquesPerigosos || 0) - (ant.fora?.ataquesPerigosos || 0);
  const pressaoExplosivaCasa = dAPCasa2 >= 4;
  const pressaoExplosivaFora = dAPFora2 >= 4;

  // ── Detectar virada de posse (±10% em 3min) ──────────────────
  const dPosseCasa3 = (snapAtual.casa?.posse || 0) - (ant3.casa?.posse || 0);
  const viradaPosseCasa = Math.abs(dPosseCasa3) >= 10;

  // ── Detectar paradoxo tático ──────────────────────────────────
  // Time com alta posse mas adversário com mais ataques perigosos
  // Este é o padrão que o usuário mencionou explicitamente
  const posseCasaAlta = (snapAtual.casa?.posse || 0) >= 60;
  const posseForaAlta = (snapAtual.fora?.posse || 0) >= 60;
  const apForaMaior   = (snapAtual.fora?.ataquesPerigosos || 0) > (snapAtual.casa?.ataquesPerigosos || 0) * 1.5;
  const apCasaMaior   = (snapAtual.casa?.ataquesPerigosos || 0) > (snapAtual.fora?.ataquesPerigosos || 0) * 1.5;
  const paradoxoCasa  = posseCasaAlta && apForaMaior; // casa domina posse mas fora pressiona mais
  const paradoxoFora  = posseForaAlta && apCasaMaior; // fora domina posse mas casa pressiona mais

  // ── Detectar momentum de odds (queda > 0.15 em 5min) ─────────
  const oddsCasaAtual = snapAtual.odds?.Bet365?.casa || snapAtual.odds?.Bwin?.casa;
  const oddsCasaAnt5  = ant5.odds?.Bet365?.casa || ant5.odds?.Bwin?.casa;
  const oddsForaAtual = snapAtual.odds?.Bet365?.fora || snapAtual.odds?.Bwin?.fora;
  const oddsForaAnt5  = ant5.odds?.Bet365?.fora || ant5.odds?.Bwin?.fora;
  const quedaOddsCasa = oddsCasaAtual && oddsCasaAnt5 && (oddsCasaAnt5 - oddsCasaAtual) >= 0.15;
  const quedaOddsFora = oddsForaAtual && oddsForaAnt5 && (oddsForaAnt5 - oddsForaAtual) >= 0.15;

  // ── Montar fotografia completa do estado pré-evento ──────────
  const foto = (side) => {
    const s = snapAtual[side] || {};
    const p = ant[side] || {};
    const p3 = ant3[side] || {};
    const p5 = ant5[side] || {};
    const adv = side === 'casa' ? 'fora' : 'casa';
    const sAdv = snapAtual[adv] || {};

    return {
      // Estado absoluto
      posse:              s.posse,
      ataquesPerigosos:   s.ataquesPerigosos,
      ataques:            s.ataques,
      chutesAlvo:         s.chutesAlvo,
      chutesTotais:       s.chutesTotais,
      escanteios:         s.escanteios,
      faltas:             s.faltas,
      xg:                 s.xg,
      passesOk:           s.passesOk,
      passesTotal:        s.passesTotal,
      eficienciaFinalizacao: s.eficienciaFinalizacao,
      pressaoPorMinuto:   s.pressaoPorMinuto,
      xgPorChute:         s.xgPorChute,
      precisaoPasse:      s.precisaoPasse,
      ratingMedio:        s.ratingMedio,
      ratingAtaque:       s.ratingAtaque,
      ratingDefesa:       s.ratingDefesa,

      // Deltas 1 min
      delta1_ap:          (s.ataquesPerigosos||0) - (p.ataquesPerigosos||0),
      delta1_posse:       +((s.posse||0) - (p.posse||0)).toFixed(1),
      delta1_xg:          +((s.xg||0) - (p.xg||0)).toFixed(3),
      delta1_chutes:      (s.chutesAlvo||0) - (p.chutesAlvo||0),
      delta1_escanteios:  (s.escanteios||0) - (p.escanteios||0),

      // Deltas 3 min
      delta3_ap:          (s.ataquesPerigosos||0) - (p3.ataquesPerigosos||0),
      delta3_posse:       +((s.posse||0) - (p3.posse||0)).toFixed(1),
      delta3_xg:          +((s.xg||0) - (p3.xg||0)).toFixed(3),
      delta3_chutes:      (s.chutesAlvo||0) - (p3.chutesAlvo||0),
      delta3_escanteios:  (s.escanteios||0) - (p3.escanteios||0),

      // Deltas 5 min
      delta5_ap:          (s.ataquesPerigosos||0) - (p5.ataquesPerigosos||0),
      delta5_posse:       +((s.posse||0) - (p5.posse||0)).toFixed(1),
      delta5_xg:          +((s.xg||0) - (p5.xg||0)).toFixed(3),

      // Aceleração (ritmo mudando?)
      aceleracao:         s.aceleracao || 0,
      ritmoAtaques:       s.ritmoAtaques || 0,

      // Contexto relacional (comparação com adversário)
      posseRelativa:      +((s.posse||0) - (sAdv.posse||0)).toFixed(1), // positivo = domina posse
      apRelativo:         (s.ataquesPerigosos||0) - (sAdv.ataquesPerigosos||0), // positivo = mais perigoso
      xgRelativo:         +((s.xg||0) - (sAdv.xg||0)).toFixed(3),
      paradoxoTatico:     side === 'casa' ? paradoxoCasa : paradoxoFora, // domina posse mas pressiona menos

      // Odds no momento
      oddsPropria:        side === 'casa' ? oddsCasaAtual : oddsForaAtual,
      oddsAdversario:     side === 'casa' ? oddsForaAtual : oddsCasaAtual,
      quedaOdds5min:      side === 'casa' ? (quedaOddsCasa ? (oddsCasaAnt5 - oddsCasaAtual) : 0)
                                          : (quedaOddsFora ? (oddsForaAnt5 - oddsForaAtual) : 0),
    };
  };

  // Contexto do jogo
  const fase = minuto <= 15 ? 'abertura' : minuto <= 30 ? 'primeiro_quarto' :
               minuto <= 45 ? 'fechamento_1t' : minuto <= 60 ? 'abertura_2t' :
               minuto <= 75 ? 'segundo_quarto' : 'reta_final';
  const pc = snapAtual.placar?.casa || 0;
  const pf = snapAtual.placar?.fora || 0;
  const statusCasa = pc > pf ? 'vencendo' : pc < pf ? 'perdendo' : 'empatando';
  const statusFora = pf > pc ? 'vencendo' : pf < pc ? 'perdendo' : 'empatando';
  const diferencaPlacar = Math.abs(pc - pf);

  const baseDoc = {
    fixtureId:    parseInt(fxId),
    minutoEvento: minuto,
    timeCasaId:   snapAtual.timeCasaId || null,
    timeForaId:   snapAtual.timeForaId || null,
    timeCasaNome: snapAtual.timeCasaNome || jogoLocal?.timeCasa || '',
    timeForaNome: snapAtual.timeForaNome || jogoLocal?.timeFora || '',
    ligaId:       jogoLocal?.ligaId || jogoLocal?.liga || null,
    fase,
    diferencaPlacar,
    placar:       { casa: pc, fora: pf },
    criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
    fotoCasa:     foto('casa'),
    fotoFora:     foto('fora'),
    oddsSnapshot: snapAtual.odds || null,
  };

  const eventos = [];

  if (golCasa) eventos.push({
    ...baseDoc, tipoEvento: 'gol_casa', side: 'casa',
    statusPlacarAntes: statusCasa,
    chaves: [`gol_casa__${fase}`, `gol_casa__${statusCasa}`, `gol_casa__${fase}__${statusCasa}`,
             paradoxoCasa ? 'gol_casa__paradoxo_posse' : null,
             quedaOddsCasa ? 'gol_casa__queda_odds' : null].filter(Boolean),
  });

  if (golFora) eventos.push({
    ...baseDoc, tipoEvento: 'gol_fora', side: 'fora',
    statusPlacarAntes: statusFora,
    chaves: [`gol_fora__${fase}`, `gol_fora__${statusFora}`, `gol_fora__${fase}__${statusFora}`,
             paradoxoFora ? 'gol_fora__paradoxo_posse' : null,
             quedaOddsFora ? 'gol_fora__queda_odds' : null].filter(Boolean),
  });

  if (seqEscCasa) eventos.push({
    ...baseDoc, tipoEvento: 'sequencia_escanteio_casa', side: 'casa',
    chaves: [`esc_seq_casa__${fase}`, `esc_seq_casa__${statusCasa}`],
  });

  if (seqEscFora) eventos.push({
    ...baseDoc, tipoEvento: 'sequencia_escanteio_fora', side: 'fora',
    chaves: [`esc_seq_fora__${fase}`, `esc_seq_fora__${statusFora}`],
  });

  if (pressaoExplosivaCasa) eventos.push({
    ...baseDoc, tipoEvento: 'pressao_explosiva_casa', side: 'casa',
    chaves: [`pressao_exp_casa__${fase}`],
  });

  if (pressaoExplosivaFora) eventos.push({
    ...baseDoc, tipoEvento: 'pressao_explosiva_fora', side: 'fora',
    chaves: [`pressao_exp_fora__${fase}`],
  });

  if (paradoxoCasa) eventos.push({
    ...baseDoc, tipoEvento: 'paradoxo_posse_casa', side: 'casa',
    descricao: `Casa com ${snapAtual.casa?.posse}% posse mas Fora tem ${snapAtual.fora?.ataquesPerigosos} AP`,
    chaves: [`paradoxo_posse_casa__${fase}`],
  });

  if (paradoxoFora) eventos.push({
    ...baseDoc, tipoEvento: 'paradoxo_posse_fora', side: 'fora',
    descricao: `Fora com ${snapAtual.fora?.posse}% posse mas Casa tem ${snapAtual.casa?.ataquesPerigosos} AP`,
    chaves: [`paradoxo_posse_fora__${fase}`],
  });

  if (quedaOddsCasa) eventos.push({
    ...baseDoc, tipoEvento: 'queda_odds_casa', side: 'casa',
    quedaValor: +(oddsCasaAnt5 - oddsCasaAtual).toFixed(2),
    chaves: [`queda_odds_casa__${fase}`, `queda_odds_casa__${statusCasa}`],
  });

  if (quedaOddsFora) eventos.push({
    ...baseDoc, tipoEvento: 'queda_odds_fora', side: 'fora',
    quedaValor: +(oddsForaAnt5 - oddsForaAtual).toFixed(2),
    chaves: [`queda_odds_fora__${fase}`, `queda_odds_fora__${statusFora}`],
  });

  // Salvar todos os eventos detectados em batch
  if (eventos.length > 0) {
    const batch = db.batch();
    for (const ev of eventos) {
      const ref = db.collection('estados-pre-evento').doc();
      batch.set(ref, ev);
      // Incrementar contadores na biblioteca
      for (const chave of (ev.chaves || [])) {
        const bRef = db.collection('biblioteca-padroes').doc(chave.replace(/[./\s]/g,'_'));
        batch.set(bRef, {
          chave,
          totalEventos: admin.firestore.FieldValue.increment(1),
          ultimoEvento: admin.firestore.FieldValue.serverTimestamp(),
          tipoEvento: ev.tipoEvento,
        }, { merge: true });
      }
    }
    await batch.commit();
    console.log(`🔬 Pré-eventos registrados: ${eventos.map(e=>e.tipoEvento).join(', ')} — fixture ${fxId} min ${minuto}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// 📊 AGREGAÇÃO EXPANDIDA — roda às 03h, processa estados-pre-evento
// Gera limiares estatísticos para TODOS os indicadores e padrões
// incluindo paradoxo de posse, correlações de odds, séries temporais
// ════════════════════════════════════════════════════════════════════════
exports.agregarPadroesExpandido = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    try {
      const snap = await db.collection('estados-pre-evento').get();
      if (snap.empty) { console.log('agregarExpandido: sem dados'); return null; }

      // Agrupar por tipo de evento (mais granular que por chave)
      const porTipo = {};
      snap.docs.forEach(doc => {
        const d = doc.data();
        const tipo = d.tipoEvento;
        if (!tipo) return;
        if (!porTipo[tipo]) porTipo[tipo] = [];
        porTipo[tipo].push(d);
      });

      const media    = arr => { const v=arr.filter(x=>x!=null&&!isNaN(x)); return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3):null; };
      const percentil = (arr,p) => { const s=arr.filter(x=>x!=null&&!isNaN(x)).sort((a,b)=>a-b); if(!s.length)return null; return +s[Math.min(Math.floor(s.length*p/100),s.length-1)].toFixed(3); };
      const desvio    = arr => { const v=arr.filter(x=>x!=null&&!isNaN(x)); if(!v.length)return null; const m=v.reduce((a,b)=>a+b)/v.length; return +(Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length)).toFixed(3); };

      const camposAnalise = [
        // Estado absoluto
        'fotoCasa.posse','fotoCasa.ataquesPerigosos','fotoCasa.chutesAlvo','fotoCasa.chutesTotais',
        'fotoCasa.escanteios','fotoCasa.xg','fotoCasa.faltas','fotoCasa.eficienciaFinalizacao',
        'fotoCasa.pressaoPorMinuto','fotoCasa.xgPorChute','fotoCasa.precisaoPasse',
        'fotoFora.posse','fotoFora.ataquesPerigosos','fotoFora.chutesAlvo','fotoFora.chutesTotais',
        'fotoFora.escanteios','fotoFora.xg','fotoFora.faltas','fotoFora.eficienciaFinalizacao',
        // Deltas
        'fotoCasa.delta1_ap','fotoCasa.delta3_ap','fotoCasa.delta5_ap',
        'fotoCasa.delta1_posse','fotoCasa.delta3_posse','fotoCasa.delta5_posse',
        'fotoCasa.delta1_xg','fotoCasa.delta3_xg',
        'fotoFora.delta1_ap','fotoFora.delta3_ap','fotoFora.delta5_ap',
        'fotoFora.delta1_posse','fotoFora.delta3_posse','fotoFora.delta5_posse',
        'fotoFora.delta1_xg','fotoFora.delta3_xg',
        // Contexto relacional
        'fotoCasa.posseRelativa','fotoCasa.apRelativo','fotoCasa.xgRelativo',
        'fotoCasa.quedaOdds5min','fotoFora.quedaOdds5min',
        'fotoCasa.ritmoAtaques','fotoFora.ritmoAtaques',
        'fotoCasa.aceleracao','fotoFora.aceleracao',
      ];

      const batch = db.batch();

      for (const [tipo, eventos] of Object.entries(porTipo)) {
        const n = eventos.length;
        if (n < 3) continue; // mínimo útil

        const estat = {};
        for (const campo of camposAnalise) {
          const [obj, key] = campo.split('.');
          const vals = eventos.map(e => e[obj]?.[key]).filter(v => v != null && !isNaN(v));
          if (!vals.length) continue;
          estat[campo.replace('.','_')] = {
            media:   media(vals),
            p25:     percentil(vals, 25),
            p50:     percentil(vals, 50),
            p75:     percentil(vals, 75),
            p90:     percentil(vals, 90),
            desvio:  desvio(vals),
            n:       vals.length,
          };
        }

        // Taxa de paradoxo tático (% dos eventos com domínio de posse mas pressão menor)
        const comParadoxo = eventos.filter(e => e.fotoCasa?.paradoxoTatico || e.fotoFora?.paradoxoTatico).length;
        const taxaParadoxo = n > 0 ? +(comParadoxo / n * 100).toFixed(1) : 0;

        // Taxa com queda de odds prévia
        const comQuedaOdds = eventos.filter(e => (e.fotoCasa?.quedaOdds5min||0) > 0.1 || (e.fotoFora?.quedaOdds5min||0) > 0.1).length;
        const taxaQuedaOdds = n > 0 ? +(comQuedaOdds / n * 100).toFixed(1) : 0;

        // Distribuição de fases do jogo
        const distFase = {};
        eventos.forEach(e => { if(e.fase) distFase[e.fase] = (distFase[e.fase]||0)+1; });

        // Distribuição de status do placar
        const distStatus = {};
        eventos.forEach(e => { const s=e.statusPlacarAntes||'desconhecido'; distStatus[s]=(distStatus[s]||0)+1; });

        // Limiares de alerta — p75 define quando fica "provável"
        const alerta = {
          apCasa:        estat['fotoCasa_ataquesPerigosos']?.p75,
          apFora:        estat['fotoFora_ataquesPerigosos']?.p75,
          xgCasa:        estat['fotoCasa_xg']?.p75,
          xgFora:        estat['fotoFora_xg']?.p75,
          delta3ApCasa:  estat['fotoCasa_delta3_ap']?.p50,
          delta3ApFora:  estat['fotoFora_delta3_ap']?.p50,
          quedaOdds:     0.12, // threshold fixo para queda de odds
        };

        // Narrativa automática (texto explicativo)
        const narrativa = gerarNarrativaAgregado(tipo, estat, taxaParadoxo, taxaQuedaOdds, n);

        const docFinal = {
          tipoEvento: tipo,
          totalEventos: n,
          estrelas: n >= 100 ? 5 : n >= 50 ? 4 : n >= 20 ? 3 : n >= 8 ? 2 : 1,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          estatisticas: estat,
          taxaParadoxo,
          taxaQuedaOdds,
          distFase,
          distStatus,
          alerta,
          narrativa,
        };

        const ref = db.collection('biblioteca-eventos').doc(tipo.replace(/[./\s]/g,'_'));
        batch.set(ref, docFinal);
      }

      await batch.commit();
      console.log(`✅ Agregação expandida: ${Object.keys(porTipo).length} tipos processados`);
      return null;

    } catch(e) {
      console.error('agregarPadroesExpandido:', e.message);
      return null;
    }
  });

function gerarNarrativaAgregado(tipo, estat, taxaParadoxo, taxaQuedaOdds, n) {
  const s = e => estat[e];
  const m = e => s(e)?.media;
  const p75 = e => s(e)?.p75;
  const linhas = [];

  if (tipo.includes('gol_casa')) {
    linhas.push(`Antes dos gols da casa (${n} registros):`);
    if (m('fotoCasa_ataquesPerigosos')) linhas.push(`  • AP casa: média ${m('fotoCasa_ataquesPerigosos')}, limiar alerta ≥ ${p75('fotoCasa_ataquesPerigosos')}`);
    if (m('fotoCasa_xg'))               linhas.push(`  • xG casa: média ${m('fotoCasa_xg')}, limiar alerta ≥ ${p75('fotoCasa_xg')}`);
    if (m('fotoCasa_delta3_ap'))         linhas.push(`  • ΔAP 3min casa: média ${m('fotoCasa_delta3_ap')} (aceleração pré-gol)`);
    if (m('fotoCasa_delta3_posse'))      linhas.push(`  • ΔPosse 3min: ${m('fotoCasa_delta3_posse')}% — ${m('fotoCasa_delta3_posse') > 0 ? 'crescente' : 'decrescente'}`);
    if (taxaParadoxo > 15)               linhas.push(`  ⚠️ ${taxaParadoxo}% dos gols ocorreram com paradoxo tático (posse alta mas pressão adversária)`);
    if (taxaQuedaOdds > 20)              linhas.push(`  📉 ${taxaQuedaOdds}% dos gols tiveram queda de odds ≥0.15 nos 5min anteriores`);
  } else if (tipo === 'paradoxo_posse_casa' || tipo === 'paradoxo_posse_fora') {
    const lado = tipo.includes('casa') ? 'casa' : 'fora';
    linhas.push(`Paradoxo de posse — ${lado} (${n} ocorrências):`);
    linhas.push(`  • Situação: time domina posse mas adversário cria mais perigo`);
    if (m(`foto${lado.charAt(0).toUpperCase()+lado.slice(1)}_posse`)) linhas.push(`  • Posse média nestes momentos: ${m(`foto${lado.charAt(0).toUpperCase()+lado.slice(1)}_posse`)}%`);
    linhas.push(`  • Este padrão pode preceder gol do adversário`);
  } else if (tipo.includes('queda_odds')) {
    linhas.push(`Queda de odds (${n} registros):`);
    if (m('fotoCasa_quedaOdds5min')) linhas.push(`  • Queda média em 5min: ${m('fotoCasa_quedaOdds5min')} pontos`);
    linhas.push(`  • Mercado sinaliza gol antes dos indicadores táticos`);
  }

  return linhas.join('\n') || `Padrão ${tipo} — ${n} ocorrências registradas`;
}

// ════════════════════════════════════════════════════════════════════════
// 🔭 CORRELACIONADOR AO VIVO — compara estado atual com biblioteca
// Retorna score 0-100 + narrativa + alertas de padrões detectados

// ══════════════════════════════════════════════════════════════════
// 🔬 DIAGNÓSTICO — chame via console do Firebase para ver raw da API
// fns.httpsCallable('diagnosticarApiFixture')({ fixtureId: 12345 })
// ══════════════════════════════════════════════════════════════════
exports.diagnosticarApiFixture = functions.https.onCall(async (data, context) => {
  const { fixtureId } = data;
  if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
  const fxId = parseInt(fixtureId);

  // Status da conta
  const status = await apiFootballGet('/status').catch(e => ({ _erro: e.message }));

  // Endpoints ao vivo
  const [statsR, oddsLiveR, oddsPrejR] = await Promise.all([
    apiFootballGet(`/fixtures/statistics?fixture=${fxId}`).catch(e => ({ _erro: e.message })),
    apiFootballGet(`/odds/live?fixture=${fxId}`).catch(e => ({ _erro: e.message })),
    apiFootballGet(`/odds?fixture=${fxId}&bookmaker=6`).catch(e => ({ _erro: e.message })),
  ]);

  const resumo = {
    conta: {
      plano: status.response?.subscription?.plan,
      requests: status.response?.requests,
      erros: status.errors,
    },
    stats: {
      results: statsR.results,
      erros: statsR.errors,
      times: (statsR.response || []).map(t => ({
        time: t.team?.name,
        statCount: (t.statistics || []).length,
        dangerousAttacks: (t.statistics || []).find(s => s.type === 'Dangerous Attacks')?.value,
        xg: (t.statistics || []).find(s => s.type === 'expected_goals')?.value,
        possession: (t.statistics || []).find(s => s.type === 'Ball Possession')?.value,
      })),
    },
    oddsLive: {
      results: oddsLiveR.results,
      erros: oddsLiveR.errors,
      bookmakerCount: oddsLiveR.response?.[0]?.bookmakers?.length || 0,
      primeiroBookmaker: oddsLiveR.response?.[0]?.bookmakers?.[0]?.name || null,
    },
    oddsPrejogo: {
      results: oddsPrejR.results,
      erros: oddsPrejR.errors,
      bookmakerCount: oddsPrejR.response?.[0]?.bookmakers?.length || 0,
      primeiroBookmaker: oddsPrejR.response?.[0]?.bookmakers?.[0]?.name || null,
    },
  };

  console.log('🔬 DIAGNÓSTICO:', JSON.stringify(resumo, null, 2));
  return { sucesso: true, fixtureId: fxId, resumo };
});

// ════════════════════════════════════════════════════════════════════════
exports.correlacionarEstadoAtual = functions.https.onCall(async (data, context) => {
  try {
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    // Buscar últimos 6 snapshots (últimos ~6min)
    const histSnap = await db.collection('partidas-live')
      .doc(String(fixtureId)).collection('snapshots-v2')
      .orderBy('minuto', 'desc').limit(6).get();

    if (histSnap.empty) return { sucesso: true, alertas: [], score: { casa: 0, fora: 0 } };

    const snaps = histSnap.docs.map(d => d.data()).sort((a,b)=>(a.minuto||0)-(b.minuto||0));
    const snap = snaps[snaps.length - 1]; // mais recente
    const snap3 = snaps[Math.max(0, snaps.length - 4)]; // ~3min atrás
    const snap5 = snaps[0]; // ~5-6min atrás
    const minuto = snap.minuto || 0;
    const fase = minuto <= 15 ? 'abertura' : minuto <= 30 ? 'primeiro_quarto' :
                 minuto <= 45 ? 'fechamento_1t' : minuto <= 60 ? 'abertura_2t' :
                 minuto <= 75 ? 'segundo_quarto' : 'reta_final';

    // Buscar padrões da biblioteca para este tipo de evento e fase
    const tiposRelevantes = [
      `gol_casa__${fase}`, `gol_fora__${fase}`,
      `pressao_exp_casa__${fase}`, `pressao_exp_fora__${fase}`,
      `paradoxo_posse_casa__${fase}`, `paradoxo_posse_fora__${fase}`,
      `queda_odds_casa__${fase}`, `queda_odds_fora__${fase}`,
    ];

    const biblioteca = {};
    await Promise.all(tiposRelevantes.map(async tipo => {
      try {
        const d = await db.collection('biblioteca-eventos').doc(tipo.replace(/[./\s]/g,'_')).get();
        if (d.exists && d.data().totalEventos >= 3) biblioteca[tipo] = d.data();
      } catch {}
    }));

    const alertas = [];
    const scores = { casa: 0, fora: 0 };

    // ── Helper: verificar se indicador está acima do limiar ──────
    const acima = (val, limiar) => val != null && limiar != null && val >= limiar;

    for (const [side, adv, nomeSide] of [['casa','fora','Casa'],['fora','casa','Fora']]) {
      const s    = snap[side] || {};
      const sAdv = snap[adv]  || {};
      const s3   = snap3[side] || {};
      const s5   = snap5[side] || {};

      const tipGol = `gol_${side}__${fase}`;
      const bib    = biblioteca[tipGol];

      // ── Score baseado na biblioteca ───────────────────────────
      if (bib?.alerta) {
        let pts = 0, max = 0;
        const chk = (v, lim, peso) => { if(lim==null)return; max+=peso; if(acima(v,lim))pts+=peso; };
        chk(s.ataquesPerigosos,              bib.alerta.apCasa||bib.alerta.apFora, 25);
        chk(s.xg,                            bib.alerta.xgCasa||bib.alerta.xgFora, 25);
        chk((s.ataquesPerigosos||0)-(s3.ataquesPerigosos||0), bib.alerta.delta3ApCasa||bib.alerta.delta3ApFora, 20);
        chk(s.chutesAlvo,                    (bib.alerta.apCasa||4)*0.5, 15);
        chk(s.eficienciaFinalizacao,         40, 15);
        if (max > 0) scores[side] = Math.round(pts/max*100);
      }

      // ── Alertas de padrões específicos ───────────────────────
      const dAP1 = (s.ataquesPerigosos||0) - (snap3[side]?.ataquesPerigosos||0);
      const dAP3 = (s.ataquesPerigosos||0) - (s3.ataquesPerigosos||0);
      const dAP5 = (s.ataquesPerigosos||0) - (s5.ataquesPerigosos||0);
      const dPosse3 = (s.posse||0) - (s3.posse||0);
      const dXg3 = (s.xg||0) - (s3.xg||0);
      const posseAlta = (s.posse||0) >= 60;
      const apAdvMaior = (sAdv.ataquesPerigosos||0) > (s.ataquesPerigosos||0) * 1.5;

      if (dAP3 >= 4) alertas.push({
        tipo:'pressao_explosiva', side, nivel:'alto',
        titulo:`${nomeSide} — Explosão de pressão`,
        detalhe:`+${dAP3} AP em 3 minutos (de ${s3.ataquesPerigosos||0} para ${s.ataquesPerigosos||0})`,
        scoreExtra: 20,
      });

      if (dXg3 >= 0.3) alertas.push({
        tipo:'salto_xg', side, nivel:'alto',
        titulo:`${nomeSide} — Salto de xG`,
        detalhe:`+${dXg3.toFixed(2)} xG em 3 minutos. Oportunidades de alta qualidade.`,
        scoreExtra: 15,
      });

      if (posseAlta && apAdvMaior) alertas.push({
        tipo:'paradoxo_posse', side: adv, nivel:'medio',
        titulo:`⚠️ Paradoxo tático — ${nomeSide} com ${s.posse||0}% de posse`,
        detalhe:`${nomeSide} domina posse mas adversário tem ${(sAdv.ataquesPerigosos||0)-(s.ataquesPerigosos||0)} AP a mais. Padrão associado a gol do adversário.`,
        scoreExtra: 12,
      });

      const escRecentes = (s.escanteios||0) - (s3.escanteios||0);
      if (escRecentes >= 3) alertas.push({
        tipo:'seq_escanteios', side, nivel:'medio',
        titulo:`${nomeSide} — Sequência de escanteios`,
        detalhe:`+${escRecentes} escanteios em 3 minutos. Pressão lateral intensa.`,
        scoreExtra: 10,
      });

      // Queda de odds ao vivo
      const oddsAtual = snap.odds?.Bet365?.[side] || snap.odds?.Bwin?.[side];
      const oddsAnt   = snap5.odds?.Bet365?.[side] || snap5.odds?.Bwin?.[side];
      if (oddsAtual && oddsAnt && (oddsAnt - oddsAtual) >= 0.15) alertas.push({
        tipo:'queda_odds', side, nivel:'alto',
        titulo:`📉 ${nomeSide} — Mercado sinalizando`,
        detalhe:`Odds caíram ${(oddsAnt-oddsAtual).toFixed(2)} (de ${oddsAnt.toFixed(2)} para ${oddsAtual.toFixed(2)}) em ~5min. Mercado sabe antes.`,
        scoreExtra: 18,
      });

      // Somar score extras dos alertas
      alertas.filter(a => a.side === side).forEach(a => {
        scores[side] = Math.min(100, scores[side] + (a.scoreExtra || 0));
      });
    }

    // Narrativa resumo
    const narrativa = gerarNarrativaAoVivo(snap, scores, alertas);

    return {
      sucesso: true,
      minuto,
      scores,
      alertas: alertas.sort((a,b) => {
        const ord = {alto:0,medio:1,baixo:2};
        return (ord[a.nivel]||1) - (ord[b.nivel]||1);
      }),
      narrativa,
      comBiblioteca: Object.keys(biblioteca).length > 0,
      totalPadroesDisponiveis: Object.keys(biblioteca).length,
    };

  } catch(e) {
    console.error('correlacionarEstadoAtual:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

function gerarNarrativaAoVivo(snap, scores, alertas) {
  const linhas = [];
  const min = snap.minuto || 0;

  if (alertas.length === 0 && scores.casa < 30 && scores.fora < 30) {
    return `Min ${min} — Jogo equilibrado. Nenhum padrão de alerta ativo.`;
  }

  if (scores.casa >= 60) linhas.push(`⚡ Casa com score ${scores.casa}/100 de pressão pré-gol`);
  if (scores.fora >= 60) linhas.push(`⚡ Fora com score ${scores.fora}/100 de pressão pré-gol`);

  alertas.slice(0,3).forEach(a => linhas.push(`• ${a.titulo}: ${a.detalhe}`));

  return linhas.join('\n') || `Min ${min} — Monitorando padrões.`;
}


// ══════════════════════════════════════════════════════════════════════════
// ██████████████████████████████████████████████████████████████████████████
//
//  YELLUP ADMIN — BLOCO v11 — APRENDIZADO AUTOMÁTICO + SPEED OF ODDS
//
//  Funções adicionadas ao index.js existente sem remover nenhuma função.
//  Integram com os dados já coletados (estados-pre-evento, calibracao-algoritmo)
//  e adicionam novas coleções: janelas-pre-evento, velocidade-odds, 
//  fingerprints-times, log-calibracao, config-algoritmo/pesos-globais
//
//  DEPLOY apenas estas funções (não redeployar o arquivo inteiro):
//  firebase deploy --only functions:registrarJanelaPreEvento,\
//  functions:registrarVelocidadeOdds,functions:registrarLogCalibracao,\
//  functions:buscarPadroesPreEvento,functions:buscarSugestaoPesosV2
//
// ██████████████████████████████████████████████████████████████████████████
// ══════════════════════════════════════════════════════════════════════════

// Helpers locais deste bloco
const _n = (v, fb = null) => { const x = parseFloat(v); return isNaN(x) ? fb : x; };
const _i = (v, fb = null) => { const x = parseInt(v);   return isNaN(x) ? fb : x; };
const _minFaixa = m => m<=10?0:m<=20?1:m<=30?2:m<=40?3:m<=45?4:m<=60?5:m<=70?6:m<=80?7:8;


// ════════════════════════════════════════════════════════════════════════
//  1. registrarJanelaPreEvento
//  ────────────────────────────────────────────────────────────────────────
//  COMPLEMENTA salvarEstadoPreEvento (que é server-side e usa snapshots-v2).
//  Esta função recebe dados já calculados pelo front-end v11 e é mais leve:
//  - Salva em janelas-pre-evento (dados do client)
//  - Atualiza fingerprints-times (perfil acumulativo por time)
//  - Atualiza agregados-liga (padrões por liga)
//
//  Chamada pelo front-end quando: gol / cartão / VAR detectado
// ════════════════════════════════════════════════════════════════════════
exports.registrarJanelaPreEvento = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

  const fixtureId  = _i(data.fixtureId);
  const tipo       = String(data.tipo || '').trim();      // 'Goal' | 'Card' | 'Var'
  const minuto     = _i(data.minuto, 0);
  const timeCasaId = _i(data.timeCasaId);
  const timeForaId = _i(data.timeForaId);

  if (!fixtureId || !tipo || !timeCasaId || !timeForaId)
    throw new functions.https.HttpsError('invalid-argument', 'fixtureId, tipo, timeCasaId, timeForaId obrigatórios.');

  const v  = data.variacoes  || {};
  const oa = data.oddsAntes  || null;

  const doc = {
    fixtureId,
    tipo,
    detalhe:    String(data.detalhe || ''),
    minuto,
    isCasa:     Boolean(data.isCasa),
    timeId:     _i(data.timeId) || null,
    timeCasaId,
    timeForaId,
    ligaId:     _i(data.ligaId) || null,
    placarCasa: _i(data.placarCasa, 0),
    placarFora: _i(data.placarFora, 0),

    // Variações nos 5min antes do evento (calculadas pelo front v11)
    variacoes: {
      delta_ap_casa:      _n(v.delta_ap_casa),
      delta_ap_fora:      _n(v.delta_ap_fora),
      delta_xg_casa:      _n(v.delta_xg_casa),
      delta_xg_fora:      _n(v.delta_xg_fora),
      delta_chutes_casa:  _n(v.delta_chutes_casa),
      delta_chutes_fora:  _n(v.delta_chutes_fora),
      ap_casa_abs:        _n(v.ap_casa_abs),
      ap_fora_abs:        _n(v.ap_fora_abs),
      xg_casa_abs:        _n(v.xg_casa_abs),
      xg_fora_abs:        _n(v.xg_fora_abs),
      posse_casa:         _n(v.posse_casa),
      taxa_ap_casa:       _n(v.taxa_ap_casa),
      taxa_ap_fora:       _n(v.taxa_ap_fora),
      n_snaps:            _i(v.n_snaps, 0),
    },

    // Estado das odds imediatamente antes do evento
    oddsAntes: oa ? {
      minuto:  _i(oa.minuto, 0),
      casa:    _n(oa.casa),
      fora:    _n(oa.fora),
      empate:  _n(oa.empate),
      over25:  _n(oa.over25),
      fonte:   String(oa.fonte || ''),
      velCasa: _n(oa.velCasa),   // velocidade de variação (de registrarVelocidadeOdds)
      velFora: _n(oa.velFora),
    } : null,

    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    versao:   11,
  };

  // Salvar janela pré-evento
  const docId = `${fixtureId}_${tipo}_${minuto}_${data.timeId || 'x'}`;
  await db.collection('janelas-pre-evento').doc(docId).set(doc, { merge: true });

  // Atualizar fingerprint acumulativo do time
  await _fpAtualizarEventos(doc);

  // Atualizar agregado da liga
  if (doc.ligaId) await _fpAtualizarLiga(doc);

  return { sucesso: true, docId };
});


// ── Atualiza fingerprint de eventos do time (médias acumulativas) ──
async function _fpAtualizarEventos(doc) {
  try {
    const teamId = doc.timeId || (doc.isCasa ? doc.timeCasaId : doc.timeForaId);
    if (!teamId) return;

    const chave = doc.tipo === 'Goal'
      ? (doc.isCasa ? 'gols_marcados' : 'gols_sofridos')
      : doc.tipo === 'Card' ? 'cartoes' : 'outros_eventos';

    const ref  = db.collection('fingerprints-times').doc(String(teamId));
    const snap = await ref.get();
    const fp   = snap.exists ? snap.data() : {};
    const ant  = fp[chave] || {
      total:0, soma_delta_ap:0, soma_taxa_ap:0, soma_delta_xg:0,
      soma_posse:0, n_com_posse:0, n_com_odds:0, soma_odds_vel:0,
      faixas: [0,0,0,0,0,0,0,0,0],
    };

    const vv     = doc.variacoes;
    const isCasa = doc.isCasa;
    const faixa  = _minFaixa(doc.minuto);

    const novo = {
      total:         ant.total + 1,
      soma_delta_ap: ant.soma_delta_ap + (isCasa ? (vv.delta_ap_casa||0) : (vv.delta_ap_fora||0)),
      soma_taxa_ap:  ant.soma_taxa_ap  + (isCasa ? (vv.taxa_ap_casa||0)  : (vv.taxa_ap_fora||0)),
      soma_delta_xg: ant.soma_delta_xg + (isCasa ? (vv.delta_xg_casa||0) : (vv.delta_xg_fora||0)),
      soma_posse:    ant.soma_posse    + (vv.posse_casa != null ? (isCasa ? vv.posse_casa : 100 - vv.posse_casa) : 0),
      n_com_posse:   ant.n_com_posse   + (vv.posse_casa != null ? 1 : 0),
      n_com_odds:    ant.n_com_odds    + (doc.oddsAntes ? 1 : 0),
      soma_odds_vel: ant.soma_odds_vel + (doc.oddsAntes?.velCasa != null
        ? (isCasa ? (doc.oddsAntes.velCasa||0) : (doc.oddsAntes.velFora||0)) : 0),
      faixas: ant.faixas.map((val, i) => i === faixa ? val + 1 : val),
    };
    // Médias calculadas inline (leitura rápida no front)
    novo.media_delta_ap  = +(novo.soma_delta_ap / novo.total).toFixed(3);
    novo.media_taxa_ap   = +(novo.soma_taxa_ap  / novo.total).toFixed(3);
    novo.media_delta_xg  = +(novo.soma_delta_xg / novo.total).toFixed(3);
    novo.media_posse     = novo.n_com_posse > 0 ? +(novo.soma_posse / novo.n_com_posse).toFixed(1) : null;
    novo.media_odds_vel  = novo.n_com_odds  > 0 ? +(novo.soma_odds_vel / novo.n_com_odds).toFixed(4) : null;
    novo.atualizado_em   = admin.firestore.FieldValue.serverTimestamp();

    await ref.set({ [chave]: novo }, { merge: true });
  } catch(e) { console.warn('_fpAtualizarEventos:', e.message); }
}

// ── Atualiza agregado por liga ──
async function _fpAtualizarLiga(doc) {
  try {
    const ref  = db.collection('agregados-liga').doc(`${doc.ligaId}_${doc.tipo}`);
    const snap = await ref.get();
    const ag   = snap.exists ? snap.data() : { total:0, soma_delta_ap:0, soma_delta_xg:0 };
    const vv   = doc.variacoes;
    const novoTotal  = ag.total + 1;
    const novaSomAP  = ag.soma_delta_ap + (vv.delta_ap_casa||0) + (vv.delta_ap_fora||0);
    const novaSomXG  = ag.soma_delta_xg + (vv.delta_xg_casa||0) + (vv.delta_xg_fora||0);
    await ref.set({
      ligaId:        doc.ligaId,
      tipo:          doc.tipo,
      total:         novoTotal,
      soma_delta_ap: novaSomAP,
      soma_delta_xg: novaSomXG,
      media_delta_ap: +(novaSomAP / novoTotal).toFixed(3),
      media_delta_xg: +(novaSomXG / novoTotal).toFixed(3),
      atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch(e) { console.warn('_fpAtualizarLiga:', e.message); }
}


// ════════════════════════════════════════════════════════════════════════
//  2. registrarVelocidadeOdds
//  ────────────────────────────────────────────────────────────────────────
//  Speed of odds: registra velocidade de variação minuto a minuto.
//  Detecta "sharp money" — odd variando > 0.15/min = dinheiro inteligente.
//
//  Coleções:
//    velocidade-odds/{fixtureId}/registros/{minuto}
//    alertas-sharp/{autoId}
// ════════════════════════════════════════════════════════════════════════
exports.registrarVelocidadeOdds = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

  const fixtureId = _i(data.fixtureId);
  const minuto    = _i(data.minuto, 0);
  if (!fixtureId || minuto <= 0)
    throw new functions.https.HttpsError('invalid-argument', 'fixtureId e minuto (>0) são obrigatórios.');

  const alertas = Array.isArray(data.alertas) ? data.alertas : [];
  const isSharp = alertas.length > 0;

  const doc = {
    fixtureId,
    minuto,
    oddsCasa:    _n(data.oddsCasa),
    oddsFora:    _n(data.oddsFora),
    oddsEmpate:  _n(data.oddsEmpate),
    velCasa:     _n(data.velCasa),
    velFora:     _n(data.velFora),
    velEmpate:   _n(data.velEmpate),
    isSharp,
    alertas: alertas.map(a => ({
      lado:   String(a.lado || ''),
      vel:    _n(a.vel, 0),
      odd:    _n(a.odd),
      minuto: _i(a.minuto, minuto),
    })),
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    versao:   11,
  };

  // Salvar minuto a minuto
  await db.collection('velocidade-odds')
    .doc(String(fixtureId))
    .collection('registros')
    .doc(String(minuto))
    .set(doc, { merge: true });

  if (isSharp) {
    // Salvar alerta para relatórios cruzados
    await db.collection('alertas-sharp').add({ ...doc, tipo: 'sharp_money', ts: data.ts || Date.now() });

    // Atualizar contador de sharps no documento-pai do fixture
    await db.collection('velocidade-odds').doc(String(fixtureId)).set({
      fixtureId,
      totalSharps:   admin.firestore.FieldValue.increment(1),
      ultimoSharp:   { minuto, velCasa: doc.velCasa, velFora: doc.velFora,
                       oddsCasa: doc.oddsCasa, oddsFora: doc.oddsFora },
      atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`⚡ SHARP registrado — fixture ${fixtureId} min ${minuto}' | velCasa=${doc.velCasa} velFora=${doc.velFora}`);
  }

  return { sucesso: true, isSharp };
});


// ════════════════════════════════════════════════════════════════════════
//  3. registrarLogCalibracao
//  ────────────────────────────────────────────────────────────────────────
//  Chamado ao encerrar cada jogo (ajustarPesosAutomatico no front v11).
//  Complementa calibrarPesosAutomatico (cron diário que usa coleção previsoes).
//  Esta função registra ajuste por jogo e atualiza média ponderada global.
//
//  Coleções:
//    log-calibracao/{autoId}
//    config-algoritmo/pesos-globais   ← consumido por buscarSugestaoPesosV2
// ════════════════════════════════════════════════════════════════════════
exports.registrarLogCalibracao = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

  const fixtureId     = _i(data.fixtureId);
  const taxaAcerto    = _n(data.taxaAcerto);
  const totalPrev     = _i(data.totalPrevisoes, 0);
  const pesosAntes    = _sanitizarPesos(data.pesosAntes  || {});
  const pesosDepois   = _sanitizarPesos(data.pesosDepois || {});
  const analise       = data.analise || {};

  if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório.');

  // Diff de pesos — o que mudou de fato neste jogo
  const deltaPesos = {};
  Object.keys(pesosDepois).forEach(k => {
    const antes  = pesosAntes[k]  || 0;
    const depois = pesosDepois[k] || 0;
    if (Math.abs(depois - antes) > 0.001)
      deltaPesos[k] = { antes, depois, delta: +(depois - antes).toFixed(4) };
  });

  const doc = {
    fixtureId,
    taxaAcerto,
    totalPrevisoes: totalPrev,
    pesosAntes,
    pesosDepois,
    deltaPesos,
    analise: {
      xgForteNosAcertos:       Boolean(analise.xgForteNosAcertos),
      xgForteNosErros:         Boolean(analise.xgForteNosErros),
      apForteNosAcertos:       Boolean(analise.apForteNosAcertos),
      apForteNosErros:         Boolean(analise.apForteNosErros),
      precisaoForteNosAcertos: Boolean(analise.precisaoForteNosAcertos),
      taxaGeral:               _n(analise.taxaGeral),
    },
    ts:       data.ts || Date.now(),
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    versao:   11,
  };

  const ref = await db.collection('log-calibracao').add(doc);

  // Atualizar média global ponderada de pesos (usada por buscarSugestaoPesosV2)
  if (taxaAcerto !== null && totalPrev >= 3) {
    await _atualizarPesosGlobais(taxaAcerto, totalPrev, pesosDepois);
  }

  console.log(`📊 Log calibração salvo — fixture ${fixtureId}, acerto ${taxaAcerto != null ? Math.round(taxaAcerto*100)+'%' : 'n/d'}`);
  return { sucesso: true, docId: ref.id };
});

function _sanitizarPesos(obj) {
  const r = {};
  Object.entries(obj).forEach(([k, v]) => { const n = parseFloat(v); if (!isNaN(n)) r[k] = n; });
  return r;
}

// Média ponderada de pesos × taxa de acerto — jogos com alta acurácia têm mais peso
async function _atualizarPesosGlobais(taxaAcerto, totalPrev, pesos) {
  try {
    const ref  = db.collection('config-algoritmo').doc('pesos-globais');
    const snap = await ref.get();
    const cur  = snap.exists ? snap.data() : { total_jogos:0, soma_taxa:0, pesos_ponderados:{} };

    // Peso desta sessão: proporcional à taxa de acerto × volume (cap em 1.0)
    const pesoSessao   = Math.min(taxaAcerto * (Math.min(totalPrev, 20) / 20), 1.0);
    const novoTotal    = cur.total_jogos + 1;
    const novaSomaTaxa = (cur.soma_taxa || 0) + taxaAcerto;

    const novosPP = {};
    Object.keys(pesos).forEach(k => {
      const vCur  = _n(pesos[k], 0);
      const vAcum = _n((cur.pesos_ponderados || {})[k], vCur);
      novosPP[k]  = +((vAcum * (novoTotal - 1) + vCur * pesoSessao) / novoTotal).toFixed(4);
    });

    await ref.set({
      total_jogos:        novoTotal,
      soma_taxa:          novaSomaTaxa,
      media_taxa_global:  +(novaSomaTaxa / novoTotal).toFixed(4),
      pesos_ponderados:   novosPP,
      ultima_atualizacao: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch(e) { console.warn('_atualizarPesosGlobais:', e.message); }
}


// ════════════════════════════════════════════════════════════════════════
//  4. buscarPadroesPreEvento
//  ────────────────────────────────────────────────────────────────────────
//  Consultado pelo front-end ao abrir um jogo ao vivo.
//  Retorna padrões históricos cruzando DUAS fontes:
//  a) fingerprints-times    — acumulado via registrarJanelaPreEvento (v11)
//  b) estados-pre-evento    — acumulado via salvarEstadoPreEvento (v1)
//  Quanto mais dados, mais confiável e detalhado o retorno.
// ════════════════════════════════════════════════════════════════════════
exports.buscarPadroesPreEvento = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');

  const tipo       = String(data.tipo       || 'Goal');
  const timeCasaId = _i(data.timeCasaId);
  const timeForaId = _i(data.timeForaId);
  const ligaId     = _i(data.ligaId) || null;

  if (!timeCasaId || !timeForaId)
    throw new functions.https.HttpsError('invalid-argument', 'timeCasaId e timeForaId são obrigatórios.');

  try {
    // ── Fonte 1: fingerprints-times (v11) ───────────────────────────
    const [fpCasaSnap, fpForaSnap] = await Promise.all([
      db.collection('fingerprints-times').doc(String(timeCasaId)).get(),
      db.collection('fingerprints-times').doc(String(timeForaId)).get(),
    ]);

    // ── Fonte 2: estados-pre-evento (v1, mais detalhados) ───────────
    // Buscar os 10 mais recentes para amostras enriquecidas
    const tipoEstadoMapa = { Goal: ['gol_casa', 'gol_fora'], Card: ['cartao'], Var: ['var'] };
    const tiposEstado    = tipoEstadoMapa[tipo] || [tipo.toLowerCase()];

    const estadosSnaps = await Promise.all(tiposEstado.map(te =>
      db.collection('estados-pre-evento')
        .where('tipoEvento', '==', te)
        .where('timeCasaId', '==', timeCasaId)
        .orderBy('criadoEm', 'desc')
        .limit(5)
        .get()
        .catch(() => ({ docs: [] }))
    ));

    const amostrasRicas = estadosSnaps
      .flatMap(s => s.docs.map(d => {
        const dd = d.data();
        return {
          fixtureId:  dd.fixtureId,
          minuto:     dd.minutoEvento,
          fase:       dd.fase,
          // Estado pré-evento (formato v1 rico com vetores)
          estadoAntes:       dd.estadoMomentoAntes    || null,
          estadoAdversario:  dd.estadoAdversario      || null,
          vetorNormalizado:  dd.vetorNormalizado       || null,
          tendencia10m:      dd.tendencia10m           || null,
        };
      }))
      .slice(0, 10);

    // ── Fonte 3: amostras v11 (janelas-pre-evento) ──────────────────
    const janelasSnap = await db.collection('janelas-pre-evento')
      .where('tipo', '==', tipo)
      .where('timeCasaId', '==', timeCasaId)
      .orderBy('criadoEm', 'desc')
      .limit(5)
      .get()
      .catch(() => ({ docs: [] }));

    const amostrasV11 = janelasSnap.docs.map(d => {
      const dd = d.data();
      return { fixtureId: dd.fixtureId, minuto: dd.minuto, variacoes: dd.variacoes, oddsAntes: dd.oddsAntes };
    });

    // ── Padrão de liga ──────────────────────────────────────────────
    let padroesLiga = null;
    if (ligaId) {
      const lgSnap = await db.collection('agregados-liga').doc(`${ligaId}_${tipo}`).get().catch(() => null);
      if (lgSnap?.exists) padroesLiga = lgSnap.data();
    }

    // ── Biblioteca de eventos v1 (padrões agregados) ────────────────
    let bibliotecaEvento = null;
    const bKey = `gol_casa__segundo_quarto`; // exemplo mais comum
    const bSnap = await db.collection('biblioteca-eventos').doc(bKey.replace(/[./\s]/g,'_')).get().catch(()=>null);
    if (bSnap?.exists && bSnap.data().totalEventos >= 3) bibliotecaEvento = bSnap.data();

    return {
      sucesso: true,
      // Fingerprints v11 — médias acumulativas
      casa: fpCasaSnap.exists ? {
        gols_marcados: fpCasaSnap.data().gols_marcados || null,
        gols_sofridos: fpCasaSnap.data().gols_sofridos || null,
        cartoes:       fpCasaSnap.data().cartoes       || null,
      } : null,
      fora: fpForaSnap.exists ? {
        gols_marcados: fpForaSnap.data().gols_marcados || null,
        gols_sofridos: fpForaSnap.data().gols_sofridos || null,
        cartoes:       fpForaSnap.data().cartoes       || null,
      } : null,
      // Amostras individuais (v1 rica + v11)
      amostrasRicas,
      amostrasV11,
      // Padrões de liga e biblioteca
      liga:           padroesLiga,
      bibliotecaEvento,
      // Meta
      fontes: {
        fingerprints:  fpCasaSnap.exists || fpForaSnap.exists,
        estadosPreV1:  amostrasRicas.length,
        janelasV11:    amostrasV11.length,
        liga:          !!padroesLiga,
        biblioteca:    !!bibliotecaEvento,
      },
    };

  } catch(e) {
    console.error('buscarPadroesPreEvento:', e);
    throw new functions.https.HttpsError('internal', 'Erro: ' + e.message);
  }
});


// ════════════════════════════════════════════════════════════════════════
//  5. buscarSugestaoPesosV2
//  ────────────────────────────────────────────────────────────────────────
//  Retorna pesos globais ótimos calculados pelo aprendizado por jogo.
//  COMPLEMENTA buscarSugestaoPesos (que lê calibracao-algoritmo/latest).
//  Esta v2 lê config-algoritmo/pesos-globais (populado por registrarLogCalibracao).
//
//  O front-end pode usar os dois endpoints e fazer a média — v1 = análise
//  estatística robusta (500+ previsões), v2 = feedback por jogo (acumula rápido).
// ════════════════════════════════════════════════════════════════════════
exports.buscarSugestaoPesosV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
  try {
    const [globSnap, logSnap] = await Promise.all([
      db.collection('config-algoritmo').doc('pesos-globais').get(),
      db.collection('log-calibracao').orderBy('criadoEm','desc').limit(5).get().catch(()=>({docs:[]})),
    ]);

    if (!globSnap.exists)
      return { sucesso: false, motivo: 'Sem dados de calibração v11 ainda. Continue usando buscarSugestaoPesos.' };

    const g       = globSnap.data();
    const recentes = logSnap.docs.map(d => {
      const dd = d.data();
      return { fixtureId: dd.fixtureId, taxaAcerto: dd.taxaAcerto, totalPrevisoes: dd.totalPrevisoes, ts: dd.ts };
    });

    return {
      sucesso:         true,
      totalJogos:      g.total_jogos  || 0,
      mediaTaxaGlobal: g.media_taxa_global || null,
      pesosOtimos:     g.pesos_ponderados  || {},
      ultimaAtualizacao: g.ultima_atualizacao || null,
      confianca:
        (g.total_jogos||0) >= 50 ? 'alta'   :
        (g.total_jogos||0) >= 20 ? 'media'  :
        (g.total_jogos||0) >= 5  ? 'baixa'  : 'insuficiente',
      ultimosJogos: recentes,
    };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// ════════════════════════════════════════════════════════════════════════
//  📐 CENÁRIOS DINÂMICOS — bloco v11
//  ────────────────────────────────────────────────────────────────────────
//  registrarCenarioAtivado  — salva ativação (cenário ≥90% ao vivo)
//  registrarResultadoCenario — salva se o gatilho aconteceu ou não
//  buscarEstatisticasCenarios — retorna taxas reais por cenário
//
//  Coleções:
//    cenarios-ativados/{fixtureId}_{cenarioId}_{minuto}
//    cenarios-resultados/{fixtureId}_{cenarioId}
//    cenarios-stats/{cenarioId}
//      → totalAtivacoes, totalAcertos, taxaAcerto, ultimaAtualizacao
// ════════════════════════════════════════════════════════════════════════

exports.registrarCenarioAtivado = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
  try {
    const { fixtureId, cenarioId, cenarioNome, pct, minuto, placarCasa, placarFora } = data;
    if (!fixtureId || !cenarioId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId e cenarioId obrigatórios.');

    const docId = `${fixtureId}_${cenarioId}_${minuto}`;
    await db.collection('cenarios-ativados').doc(docId).set({
      fixtureId,
      cenarioId,
      cenarioNome: cenarioNome || cenarioId,
      pct:         pct || 0,
      minuto:      minuto || 0,
      placarCasa:  placarCasa ?? 0,
      placarFora:  placarFora ?? 0,
      resultado:   null,   // será preenchido por registrarResultadoCenario
      criadoEm:    admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { sucesso: true, docId };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
//  Chamado ao encerrar o jogo para marcar se cada cenário acertou
//  data.cenarios = [{cenarioId, minuto, acertou: true/false}]
// ─────────────────────────────────────────────────────────────────
exports.registrarResultadoCenario = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
  try {
    const { fixtureId, cenarios } = data;
    if (!fixtureId || !Array.isArray(cenarios) || !cenarios.length)
      throw new functions.https.HttpsError('invalid-argument', 'fixtureId e cenarios[] obrigatórios.');

    const batch = db.batch();

    for (const c of cenarios.slice(0, 30)) {
      const { cenarioId, minuto, acertou } = c;
      if (!cenarioId) continue;

      // 1. Atualizar doc de ativação com resultado
      const ativDocId = `${fixtureId}_${cenarioId}_${minuto ?? 0}`;
      batch.set(
        db.collection('cenarios-ativados').doc(ativDocId),
        { resultado: !!acertou, resolvidoEm: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();

    // 2. Atualizar cenarios-stats para cada cenário (fora do batch — requer read+write)
    const cenarioIds = [...new Set(cenarios.map(c => c.cenarioId).filter(Boolean))];
    await Promise.all(cenarioIds.map(async (cenarioId) => {
      const resultadosDoId = cenarios.filter(c => c.cenarioId === cenarioId);
      const acertos  = resultadosDoId.filter(c => c.acertou).length;
      const total    = resultadosDoId.length;

      const statsRef = db.collection('cenarios-stats').doc(cenarioId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(statsRef);
        const atual = snap.exists ? snap.data() : { totalAtivacoes: 0, totalAcertos: 0 };
        const novoTotal  = (atual.totalAtivacoes || 0) + total;
        const novosAcert = (atual.totalAcertos   || 0) + acertos;
        tx.set(statsRef, {
          totalAtivacoes:   novoTotal,
          totalAcertos:     novosAcert,
          taxaAcerto:       novoTotal > 0 ? +(novosAcert / novoTotal * 100).toFixed(1) : null,
          ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }));

    return { sucesso: true, processados: cenarios.length };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
//  Retorna taxas de acerto reais para todos os cenários
// ─────────────────────────────────────────────────────────────────
exports.buscarEstatisticasCenarios = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Não autenticado.');
  try {
    const snap = await db.collection('cenarios-stats').get();
    const stats = {};
    snap.docs.forEach(doc => {
      stats[doc.id] = doc.data();
    });
    return { sucesso: true, stats };
  } catch(e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════
//  ESTRUTURA DAS NOVAS COLEÇÕES FIRESTORE (bloco v11)
//  ────────────────────────────────────────────────────────────────────────
//
//  cenarios-ativados/{fixtureId}_{cenarioId}_{minuto}
//    fixtureId, cenarioId, cenarioNome, pct, minuto, placarCasa, placarFora
//    resultado: null → true/false (preenchido por registrarResultadoCenario)
//
//  cenarios-resultados/{fixtureId}_{cenarioId}   (reservado para uso futuro)
//
//  cenarios-stats/{cenarioId}
//    totalAtivacoes, totalAcertos, taxaAcerto, ultimaAtualizacao
//
//  janelas-pre-evento/{fixtureId}_{tipo}_{minuto}_{timeId}
//    variacoes: { delta_ap_casa, delta_xg_*, taxa_ap_*, ... }
//    oddsAntes: { casa, fora, empate, velCasa, velFora }
//
//  velocidade-odds/{fixtureId}/registros/{minuto}
//    velCasa, velFora, isSharp, alertas[]
//
//  alertas-sharp/{autoId}
//    (cópia enriquecida dos registros sharp — para queries rápidas)
//
//  fingerprints-times/{teamId}
//    gols_marcados: { total, media_delta_ap, media_taxa_ap, faixas[9] }
//    gols_sofridos: { ... }
//    cartoes:       { ... }
//
//  agregados-liga/{ligaId}_{tipo}
//    total, media_delta_ap, media_delta_xg
//
//  log-calibracao/{autoId}
//    fixtureId, taxaAcerto, deltaPesos, analise
//
//  config-algoritmo/pesos-globais
//    total_jogos, media_taxa_global, pesos_ponderados
//    (complementa config-algoritmo/pesos que é populado pelo cron v1)
//
//  ÍNDICES FIRESTORE NECESSÁRIOS (criar no console):
//    janelas-pre-evento: tipo ASC + timeCasaId ASC + criadoEm DESC
//    janelas-pre-evento: tipo ASC + ligaId    ASC + criadoEm DESC
//    log-calibracao:     criadoEm DESC
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// 🏦 buscarPreOddsMultiCasa
// Busca odds 1X2 + Over/Under + Ambas das principais casas via API-Football
// e via Odds-API.io. Salva no Firestore + atualiza fingerprint de aprendizado.
// ════════════════════════════════════════════════════════════════════════
exports.buscarPreOddsMultiCasa = functions.https.onCall(async (data, context) => {
  const { fixtureId, nomeCasa = '', nomeFora = '', salvar = false, apenasLeitura = false } = data;
  if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

  const db = admin.firestore();
  const docRef = db.collection('pre-odds-multi').doc(String(fixtureId));

  // ── Modo leitura: só retorna o que está salvo ──────────────────────────
  if (apenasLeitura) {
    const snap = await docRef.get();
    if (!snap.exists) return { sucesso: true, casas: [] };
    const d = snap.data();
    return {
      sucesso: true,
      casas: d.casas || [],
      capturadoEm: d.capturadoEm || null,
      insights: d.insights || [],
      historico: d.historico || {},
      totalGolsRealizado: d.totalGolsRealizado ?? null,
    };
  }

  // ── Busca real ─────────────────────────────────────────────────────────
  const API_KEY = functions.config().apifootball?.key || process.env.API_FOOTBALL_KEY;
  const ODDS_IO_KEY = functions.config().oddsapi?.key || process.env.ODDS_API_KEY;

  const casasMap = {}; // { bookmakerKey: {odd1, oddX, odd2, over25, under25, ambas_sim} }

  // ── Fonte 1: API-Football /odds ──────────────────────────────────────
  try {
    const url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}&bookmaker=6,8,16,1,3`;
    const resp = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
    const json = await resp.json();
    const bookmakers = json?.response?.[0]?.bookmakers || [];

    // Mapeamento interno API-Football id → nossa chave
    const BM_MAP = { 6:'bet365', 8:'sportingbet', 16:'betano', 1:'pinnacle', 3:'betfair' };

    bookmakers.forEach(bm => {
      const key = BM_MAP[bm.id] || String(bm.id);
      if (!casasMap[key]) casasMap[key] = { bookmaker: key };
      bm.bets?.forEach(bet => {
        if (bet.name === 'Match Winner') {
          bet.values?.forEach(v => {
            if (v.value==='Home')  casasMap[key].odd1 = parseFloat(v.odd);
            if (v.value==='Draw')  casasMap[key].oddX = parseFloat(v.odd);
            if (v.value==='Away')  casasMap[key].odd2 = parseFloat(v.odd);
          });
        }
        if (bet.name === 'Goals Over/Under') {
          bet.values?.forEach(v => {
            if (v.value==='Over 2.5')  casasMap[key].over25  = parseFloat(v.odd);
            if (v.value==='Under 2.5') casasMap[key].under25 = parseFloat(v.odd);
          });
        }
        if (bet.name === 'Both Teams Score') {
          bet.values?.forEach(v => {
            if (v.value==='Yes') casasMap[key].ambas_sim = parseFloat(v.odd);
            if (v.value==='No')  casasMap[key].ambas_nao = parseFloat(v.odd);
          });
        }
      });
    });
  } catch(e) {
    console.warn('PreOdds API-Football:', e.message);
  }

  // ── Fonte 2: Odds-API.io (Bet365 ao vivo + cobertura UCL) ──────────
  if (ODDS_IO_KEY) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${ODDS_IO_KEY}&regions=eu&markets=h2h,totals,both_teams_to_score&oddsFormat=decimal&bookmakers=bet365,pinnacle,betfair_ex_eu,unibet`;
      const resp = await fetch(url);
      const json = await resp.json();

      // Fuzzy match pelo nome dos times
      const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g,'');
      const nC = normalize(nomeCasa), nF = normalize(nomeFora);
      const jogo = json.find(g => {
        const hm = normalize(g.home_team), aw = normalize(g.away_team);
        return (hm.includes(nC.slice(0,5)) || nC.includes(hm.slice(0,5)))
            && (aw.includes(nF.slice(0,5)) || nF.includes(aw.slice(0,5)));
      });

      if (jogo) {
        const BM_IO = { 'bet365':'bet365', 'pinnacle':'pinnacle', 'betfair_ex_eu':'betfair', 'unibet':'unibet' };
        jogo.bookmakers?.forEach(bm => {
          const key = BM_IO[bm.key] || bm.key;
          if (!casasMap[key]) casasMap[key] = { bookmaker: key };
          bm.markets?.forEach(mkt => {
            if (mkt.key==='h2h') {
              mkt.outcomes?.forEach(o => {
                if (o.name === jogo.home_team) casasMap[key].odd1  = o.price;
                if (o.name === 'Draw')          casasMap[key].oddX  = o.price;
                if (o.name === jogo.away_team)  casasMap[key].odd2  = o.price;
              });
            }
            if (mkt.key==='totals') {
              mkt.outcomes?.forEach(o => {
                if (o.name==='Over'  && o.point===2.5) casasMap[key].over25  = o.price;
                if (o.name==='Under' && o.point===2.5) casasMap[key].under25 = o.price;
              });
            }
            if (mkt.key==='both_teams_to_score') {
              mkt.outcomes?.forEach(o => {
                if (o.name==='Yes') casasMap[key].ambas_sim = o.price;
                if (o.name==='No')  casasMap[key].ambas_nao = o.price;
              });
            }
          });
        });
      }
    } catch(e) {
      console.warn('PreOdds Odds-API.io:', e.message);
    }
  }

  const casas = Object.values(casasMap).filter(c => c.odd1 && c.oddX && c.odd2);

  if (!casas.length) {
    return { sucesso: false, erro: 'Nenhuma casa retornou odds para este jogo.', casas: [] };
  }

  // ── Média para fingerprint ──────────────────────────────────────────
  const avg = (key) => {
    const vals = casas.map(c=>c[key]).filter(v=>v>0&&!isNaN(v));
    return vals.length ? parseFloat((vals.reduce((a,b)=>a+b)/vals.length).toFixed(2)) : null;
  };
  const mediaO1 = avg('odd1'), mediaOX = avg('oddX'), mediaO2 = avg('odd2');
  const mediaO25 = avg('over25');

  // Classificação de perfil de jogo para fingerprint
  const perfil = mediaO25
    ? (mediaO25 < 1.7 ? 'alto_gols' : mediaO25 < 2.0 ? 'medio_gols' : 'baixo_gols')
    : 'unknown';
  const bucketO25 = mediaO25 ? Math.round(mediaO25*10)/10 : null;

  // ── Buscar histórico de aprendizado no Firestore ────────────────────
  let historico = {};
  try {
    const fpKey = bucketO25 ? `over25_${bucketO25.toFixed(1).replace('.','_')}` : null;
    if (fpKey) {
      const fpSnap = await db.collection('fingerprint-preodds').doc(fpKey).get();
      if (fpSnap.exists) {
        const fp = fpSnap.data();
        historico = {
          total:       fp.total || 0,
          pctOver25:   fp.total ? Math.round((fp.totalOver25||0)/fp.total*100) : null,
          pct3gols:    fp.total ? Math.round((fp.total3gols||0)/fp.total*100) : null,
          pct4gols:    fp.total ? Math.round((fp.total4gols||0)/fp.total*100) : null,
          pctAmbas:    fp.total ? Math.round((fp.totalAmbas||0)/fp.total*100) : null,
          mediaGols:   fp.total ? parseFloat((fp.somaGols||0)/fp.total).toFixed(1) : null,
          bucket:      fp.bucket || bucketO25,
        };
      }
    }
  } catch(e) {
    console.warn('PreOdds fingerprint:', e.message);
  }

  // Insights gerados automaticamente
  const insights = [];
  if (historico.pct4gols >= 30)
    insights.push({ icone:'🔥', cor:'var(--red)', texto:`Over 3.5 — historicamente ${historico.pct4gols}% com estas odds.` });
  if (historico.pctOver25 && historico.pctOver25 >= 70)
    insights.push({ icone:'📈', cor:'var(--grn)', texto:`Over 2.5 muito provável (${historico.pctOver25}% histórico).` });

  const resultado = {
    sucesso: true,
    casas,
    capturadoEm: Date.now(),
    mediaOdds: { odd1: mediaO1, oddX: mediaOX, odd2: mediaO2, over25: mediaO25 },
    perfil,
    historico,
    insights,
  };

  // ── Salvar no Firestore ─────────────────────────────────────────────
  if (salvar) {
    await docRef.set({
      ...resultado,
      fixtureId: String(fixtureId),
      totalGolsRealizado: null, // será preenchido após o jogo por registrarResultadoPreOdds
    }, { merge: true });
  }

  return resultado;
});

// ════════════════════════════════════════════════════════════════════════
// 📚 registrarResultadoPreOdds
// Chamada após encerramento do jogo para associar resultado às odds salvas
// e atualizar o fingerprint de aprendizado.
// Firestore: pre-odds-multi/{fixtureId} + fingerprint-preodds/{bucket}
// ════════════════════════════════════════════════════════════════════════
exports.registrarResultadoPreOdds = functions.https.onCall(async (data, context) => {
  const { fixtureId, totalGols, ambasMarcaram } = data;
  if (!fixtureId || totalGols == null) throw new functions.https.HttpsError('invalid-argument', 'fixtureId + totalGols obrigatórios');

  const db = admin.firestore();
  const docRef = db.collection('pre-odds-multi').doc(String(fixtureId));
  const snap = await docRef.get();
  if (!snap.exists) return { sucesso: false, erro: 'Odds não encontradas para este jogo.' };

  const d = snap.data();
  const bucketO25 = d.mediaOdds?.over25 ? Math.round(d.mediaOdds.over25*10)/10 : null;

  // Atualizar doc do jogo
  await docRef.update({ totalGolsRealizado: totalGols, ambasMarcaram: ambasMarcaram ?? null });

  // Atualizar fingerprint
  if (bucketO25) {
    const fpKey = `over25_${bucketO25.toFixed(1).replace('.','_')}`;
    const fpRef = db.collection('fingerprint-preodds').doc(fpKey);
    await db.runTransaction(async tx => {
      const fpSnap = await tx.get(fpRef);
      const fp = fpSnap.exists ? fpSnap.data() : { total:0, totalOver25:0, total3gols:0, total4gols:0, totalAmbas:0, somaGols:0 };
      tx.set(fpRef, {
        bucket:      bucketO25,
        total:       (fp.total||0) + 1,
        totalOver25: (fp.totalOver25||0) + (totalGols > 2 ? 1 : 0),
        total3gols:  (fp.total3gols||0)  + (totalGols >= 3 ? 1 : 0),
        total4gols:  (fp.total4gols||0)  + (totalGols >= 4 ? 1 : 0),
        totalAmbas:  (fp.totalAmbas||0)  + (ambasMarcaram ? 1 : 0),
        somaGols:    (fp.somaGols||0) + totalGols,
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }

  return { sucesso: true };
});

// ════════════════════════════════════════════════════════════════════════
// Coleções Firestore utilizadas pelas CFs acima:
//
//  pre-odds-multi/{fixtureId}
//    casas: [{bookmaker, odd1, oddX, odd2, over25, under25, ambas_sim}]
//    mediaOdds: {odd1, oddX, odd2, over25}
//    capturadoEm: timestamp ms
//    perfil: 'alto_gols'|'medio_gols'|'baixo_gols'
//    totalGolsRealizado: null → número após o jogo
//    ambasMarcaram: null → boolean após o jogo
//
//  fingerprint-preodds/{over25_bucket}   ex: over25_1_8
//    bucket: 1.8
//    total: 47
//    totalOver25: 31  → 66%
//    total3gols: 24
//    total4gols: 11
//    totalAmbas: 28
//    somaGols: 124    → média = 124/47 = 2.6 gols
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// 🔗 vincularResultadoSnapshots
//
// Chamada ao encerrar o jogo (FT/AET/PEN).
// Faz batch update em TODOS os snapshots das duas coleções do fixtureId,
// adicionando o resultado real — isso permite queries futuras do tipo
// "quando YAI > 12 no min 60 E over25 abriu < 1.8, saiu over em X%?"
//
// Firestore escrita:
//   partidas-live/{fixtureId}/snapshots/{minuto}      → resultado.*
//   partidas-live/{fixtureId}/snapshots-v2/{minuto}   → resultado.* + yai + gcs
//   partidas-live/{fixtureId}                         → resultado.* (root doc)
//   relatorios-jogos/{fixtureId}                      → resultado.* (merge)
// ════════════════════════════════════════════════════════════════════════
exports.vincularResultadoSnapshots = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
  try {
    const {
      fixtureId,
      placarCasa, placarFora,
      ligaId, timeCasaId, timeForaId,
      oddsPrejogo,          // { odd1, oddX, odd2, over25 } das pré-odds capturadas
      temporada,
    } = data;

    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db = admin.firestore();
    const fxStr = String(fixtureId);

    // ── Resultado derivado ──────────────────────────────────────────
    const pC = placarCasa ?? 0, pF = placarFora ?? 0;
    const totalGols      = pC + pF;
    const resultadoFinal = pC > pF ? '1' : pC < pF ? '2' : 'X';
    const ambasMarcaram  = pC > 0 && pF > 0;
    const over25         = totalGols > 2;
    const over35         = totalGols > 3;

    // Favorito pré-jogo (pela odd mais baixa 1X2)
    let favoritoPrejogo = null;
    if (oddsPrejogo?.odd1 && oddsPrejogo?.odd2) {
      favoritoPrejogo = oddsPrejogo.odd1 < oddsPrejogo.odd2 ? 'casa'
        : oddsPrejogo.odd2 < oddsPrejogo.odd1 ? 'fora' : 'empate';
    }
    const azaraoVenceu = favoritoPrejogo && (
      (favoritoPrejogo === 'casa' && resultadoFinal === '2') ||
      (favoritoPrejogo === 'fora' && resultadoFinal === '1')
    );

    // Bloco de resultado que vai em cada snapshot
    const blocoResultado = {
      'resultado.totalGols':       totalGols,
      'resultado.resultadoFinal':  resultadoFinal,
      'resultado.placarFinal':     { casa: pC, fora: pF },
      'resultado.ambasMarcaram':   ambasMarcaram,
      'resultado.over25':          over25,
      'resultado.over35':          over35,
      'resultado.favoritoPrejogo': favoritoPrejogo,
      'resultado.azaraoVenceu':    azaraoVenceu,
      'resultado.processado':      true,
      'resultado.processadoEm':    admin.firestore.FieldValue.serverTimestamp(),
    };

    // Incluir odds pré-jogo como contexto (para cruzar com campo nas queries)
    if (oddsPrejogo) {
      blocoResultado['oddsPrejogo.odd1']   = oddsPrejogo.odd1   ?? null;
      blocoResultado['oddsPrejogo.oddX']   = oddsPrejogo.oddX   ?? null;
      blocoResultado['oddsPrejogo.odd2']   = oddsPrejogo.odd2   ?? null;
      blocoResultado['oddsPrejogo.over25'] = oddsPrejogo.over25 ?? null;
    }

    // ── Lê as duas subcoleções ──────────────────────────────────────
    const [snapV1Snap, snapV2Snap] = await Promise.all([
      db.collection('partidas-live').doc(fxStr).collection('snapshots').get(),
      db.collection('partidas-live').doc(fxStr).collection('snapshots-v2').get(),
    ]);

    const totalDocs = snapV1Snap.size + snapV2Snap.size;

    if (totalDocs === 0) {
      console.log(`vincularResultado: nenhum snapshot encontrado para ${fixtureId}`);
    }

    // ── Batch write (máx 500 por batch; jogos têm ~90 snaps × 2 = 180) ──
    // Dividir em chunks de 400 para margem de segurança
    const CHUNK = 400;
    const todasOps = [
      ...snapV1Snap.docs.map(d => ({ ref: d.ref, data: blocoResultado })),
      ...snapV2Snap.docs.map(d => ({ ref: d.ref, data: blocoResultado })),
    ];

    for (let i = 0; i < todasOps.length; i += CHUNK) {
      const chunk = todasOps.slice(i, i + CHUNK);
      const batch = db.batch();
      chunk.forEach(op => batch.update(op.ref, op.data));
      await batch.commit();
    }

    // ── Root doc: partidas-live/{fixtureId} ────────────────────────
    // Cria/atualiza com resultado final (merge: true para não sobrescrever snapshots)
    await db.collection('partidas-live').doc(fxStr).set({
      fixtureId:   parseInt(fixtureId),
      ligaId:      ligaId  ?? null,
      timeCasaId:  timeCasaId ?? null,
      timeForaId:  timeForaId ?? null,
      temporada:   temporada ?? new Date().getFullYear(),
      resultado: {
        totalGols, resultadoFinal,
        placarFinal: { casa: pC, fora: pF },
        ambasMarcaram, over25, over35,
        favoritoPrejogo, azaraoVenceu,
      },
      oddsPrejogo: oddsPrejogo ?? null,
      encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // ── relatorios-jogos/{fixtureId}: adicionar resultado ──────────
    await db.collection('relatorios-jogos').doc(fxStr).set({
      resultado: {
        totalGols, resultadoFinal,
        placarFinal: { casa: pC, fora: pF },
        ambasMarcaram, over25, over35,
        favoritoPrejogo, azaraoVenceu,
      },
      oddsPrejogo: oddsPrejogo ?? null,
    }, { merge: true });

    console.log(`✅ vincularResultado: ${totalDocs} snapshots atualizados para fixture ${fixtureId} — ${pC}x${pF} (${resultadoFinal}, ${totalGols} gols)`);

    return {
      sucesso: true,
      snapshotsAtualizados: totalDocs,
      resultado: { totalGols, resultadoFinal, ambasMarcaram, over25, over35 },
    };

  } catch(e) {
    console.error('vincularResultadoSnapshots:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════
// Índices Firestore recomendados para queries de análise futura:
//
//  partidas-live/{id}/snapshots-v2:
//    resultado.over25 ASC + minuto ASC
//    resultado.resultadoFinal ASC + minuto ASC
//    oddsPrejogo.over25 ASC + resultado.totalGols ASC
//    resultado.processado ASC + oddsPrejogo.over25 ASC
//
//  Exemplo de query de aprendizado (no futuro):
//    db.collectionGroup('snapshots-v2')
//      .where('minuto', '==', 60)
//      .where('oddsPrejogo.over25', '>=', 1.70)
//      .where('oddsPrejogo.over25', '<=', 1.85)
//      .where('yai.casa', '>=', 10)
//      .where('resultado.processado', '==', true)
//    → retorna jogos similares com resultado real para calcular % over
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ██████████████████████████████████████████████████████████████████████████
//  YELLUP PATTERN ENGINE — Motor de Reconhecimento de Padrões
//  Implementa os itens 3, 5, 6, 7, 8 da roadmap
// ██████████████████████████████████████████████████████████████████████████
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ITEM 3 — enriquecerSnapshotsPosFT
//
// Chamada após FT. Lê todos os snapshots-v2 do jogo e enriquece cada um com:
//   golNos5min / golNos10min / golNos15min  → gol saiu entre minuto e min+N?
//   cartaoNos10min                          → cartão nos próximos 10min?
//   forcaAdversario                         → bucket da odd inicial do adversário
//   forcaCategoria                          → 'top'|'forte'|'equilibrado'|'fraco'
//   situacaoPlacar                          → 'vencendo'|'empatando'|'perdendo'
//   localJogo                               → 'casa'|'fora'
//   faseJogo                                → '0_25'|'26_45'|'46_65'|'66_mais'
//   posseMedia10min                         → média de posse nos 10min anteriores
//   momentumAtual                           → momC ou momF do snapshot
//   yaiPorMin                               → YAI/min na janela de 10min
//
// Firestore: partidas-live/{fixtureId}/snapshots-v2/{minuto} (batch update)
//            padroes-time/{timeCasaId}_{fixtureId}           (índice por time)
//            padroes-gerais/{fixtureId}_{minuto}             (banco global)
// ════════════════════════════════════════════════════════════════════════════
exports.enriquecerSnapshotsPosFT = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
  try {
    const {
      fixtureId,
      timeCasaId, timeForaId,
      placarFinalCasa, placarFinalFora,
      oddsPrejogo,        // { odd1, oddX, odd2, over25 }
      eventos,            // array de eventos [{tipo, minuto, timeId}]
      ligaId, temporada,
    } = data;

    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');

    const db     = admin.firestore();
    const fxStr  = String(fixtureId);
    const pC     = placarFinalCasa ?? 0;
    const pF     = placarFinalFora ?? 0;

    // ── Classificar força dos adversários via odds iniciais ──────────────
    const classForça = (odd) => {
      if (!odd) return 'desconhecido';
      if (odd < 1.50) return 'top';
      if (odd < 2.20) return 'forte';
      if (odd < 3.20) return 'equilibrado';
      return 'fraco';
    };
    const forcaCasa = classForça(oddsPrejogo?.odd1);  // força do time da casa como favorito
    const forcaFora = classForça(oddsPrejogo?.odd2);  // força do time visitante

    // ── Ler todos os snapshots-v2 ────────────────────────────────────────
    const snapCol = db.collection('partidas-live').doc(fxStr).collection('snapshots-v2');
    const snapSnap = await snapCol.orderBy('minuto', 'asc').get();

    if (snapSnap.empty) {
      return { sucesso: false, motivo: 'sem snapshots-v2 para este jogo' };
    }

    const snaps = snapSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

    // ── Índice de eventos por minuto ─────────────────────────────────────
    // eventos = [{ tipo: 'Goal'|'Card', minuto, timeId }]
    const evGols   = (eventos || []).filter(e => e.tipo === 'Goal');
    const evCartoes= (eventos || []).filter(e => e.tipo === 'Card');

    const golNoIntervalo = (minAtual, janela) =>
      evGols.some(e => e.minuto > minAtual && e.minuto <= minAtual + janela);
    const cartaoNoIntervalo = (minAtual, janela) =>
      evCartoes.some(e => e.minuto > minAtual && e.minuto <= minAtual + janela);
    const golTimeNoIntervalo = (minAtual, janela, timeId) =>
      evGols.some(e => e.minuto > minAtual && e.minuto <= minAtual + janela && e.timeId === timeId);

    // ── Pré-calcular médias de posse nos 10min anteriores ────────────────
    const possePor10Min = (snapsArr, minAtual) => {
      const janela = snapsArr.filter(s => s.minuto >= minAtual - 10 && s.minuto < minAtual);
      if (!janela.length) return null;
      const vals = janela.map(s => s.casa?.posse).filter(v => v != null && v > 0);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b)/vals.length) : null;
    };

    // ── Calcular YAI/min na janela de 10min (ritmo de pressão) ──────────
    const yaiPorMin = (snapsArr, minAtual, side) => {
      const ref = snapsArr.filter(s => s.minuto >= minAtual - 10 && s.minuto < minAtual);
      if (ref.length < 2) return null;
      const yaiNow = snapsArr.find(s => s.minuto === minAtual)?.[side === 'casa' ? 'yai' : 'yai']?.[side === 'casa' ? 'casa' : 'fora'] ?? null;
      const yaiOld = ref[0]?.yai?.[side === 'casa' ? 'casa' : 'fora'] ?? null;
      if (yaiNow === null || yaiOld === null) return null;
      const janelaMins = Math.max(1, minAtual - ref[0].minuto);
      return +((yaiNow - yaiOld) / janelaMins).toFixed(3);
    };

    // ── Determinar fase do jogo ──────────────────────────────────────────
    const faseJogo = (min) =>
      min <= 25 ? '0_25' : min <= 45 ? '26_45' : min <= 65 ? '46_65' : '66_mais';

    // ── Situação no placar para cada time em cada minuto ─────────────────
    const situacaoPlacar = (minAtual, timeId) => {
      // Conta gols marcados até aquele minuto
      const golsTime = evGols.filter(e => e.minuto <= minAtual && e.timeId === timeId).length;
      const golsAdv  = evGols.filter(e => e.minuto <= minAtual && e.timeId !== timeId).length;
      if (golsTime > golsAdv) return 'vencendo';
      if (golsTime < golsAdv) return 'perdendo';
      return 'empatando';
    };

    // ── Resultado final pela perspectiva do time ─────────────────────────
    const resultadoFinalTime = (timeId) => {
      const gT = evGols.length
        ? evGols.filter(e => e.timeId === timeId).length
        : (timeId === timeCasaId ? pC : pF);
      const gA = evGols.length
        ? evGols.filter(e => e.timeId !== timeId).length
        : (timeId === timeCasaId ? pF : pC);
      return gT > gA ? 'vitoria' : gT < gA ? 'derrota' : 'empate';
    };

    // ── Gols marcados pelo time ATÉ aquele minuto ────────────────────────
    const golsAoMinuto = (minAtual, timeId) =>
      evGols.filter(e => e.minuto <= minAtual && e.timeId === timeId).length;

    // ── Gols marcados pelo time APÓS aquele minuto ───────────────────────
    const golsRestantes = (minAtual, timeId) =>
      evGols.filter(e => e.minuto > minAtual && e.timeId === timeId).length;

    // ── Batch update em lotes de 400 ─────────────────────────────────────
    const CHUNK = 400;
    const ops = [];

    // Coleção de padrões para banco global + por time
    const padroesGerais = [];

    for (const snap of snaps) {
      const min   = snap.minuto || 0;
      const sideCasa = 'casa';
      const sideFora = 'fora';

      // ── Enriquecimento para o time da CASA ──────────────────────────
      const enricCasa = {
        // O que aconteceu depois
        'padraoEnriquecido.golNos5min':      golTimeNoIntervalo(min, 5, timeCasaId),
        'padraoEnriquecido.golNos10min':     golTimeNoIntervalo(min, 10, timeCasaId),
        'padraoEnriquecido.golNos15min':     golTimeNoIntervalo(min, 15, timeCasaId),
        'padraoEnriquecido.qualquerGolNos5': golNoIntervalo(min, 5),
        'padraoEnriquecido.qualquerGolNos10':golNoIntervalo(min, 10),
        'padraoEnriquecido.qualquerGolNos15':golNoIntervalo(min, 15),
        'padraoEnriquecido.cartaoNos10min':  cartaoNoIntervalo(min, 10),
        // Contexto do momento
        'padraoEnriquecido.forcaAdversarioCasa': forcaFora,   // adversário da casa = time de fora
        'padraoEnriquecido.forcaAdversarioFora': forcaCasa,
        'padraoEnriquecido.situacaoPlacarCasa':  situacaoPlacar(min, timeCasaId),
        'padraoEnriquecido.situacaoPlacarFora':  situacaoPlacar(min, timeForaId),
        'padraoEnriquecido.faseJogo':            faseJogo(min),
        'padraoEnriquecido.posseMedia10minCasa': possePor10Min(snaps, min),
        'padraoEnriquecido.yaiPorMinCasa':       yaiPorMin(snaps, min, 'casa'),
        'padraoEnriquecido.yaiPorMinFora':       yaiPorMin(snaps, min, 'fora'),
        'padraoEnriquecido.momentumCasa':        snap.yai?.casa ?? null,
        'padraoEnriquecido.momentumFora':        snap.yai?.fora ?? null,
        'padraoEnriquecido.gcsCasa':             snap.gcs       ?? null,
        'padraoEnriquecido.processado':          true,
        'padraoEnriquecido.processadoEm':        admin.firestore.FieldValue.serverTimestamp(),
        // Metadados do jogo
        'padraoEnriquecido.ligaId':              ligaId      ?? null,
        'padraoEnriquecido.temporada':           temporada   ?? null,
        'padraoEnriquecido.odd1Inicial':         oddsPrejogo?.odd1  ?? null,
        'padraoEnriquecido.oddXInicial':         oddsPrejogo?.oddX  ?? null,
        'padraoEnriquecido.odd2Inicial':         oddsPrejogo?.odd2  ?? null,
        'padraoEnriquecido.over25Inicial':       oddsPrejogo?.over25 ?? null,
        'padraoEnriquecido.placarFinal':         `${pC}-${pF}`,
        'padraoEnriquecido.totalGolsFinal':      pC + pF,
      };

      ops.push({ ref: snap.ref, data: enricCasa });

      // ── Registro no banco global de padrões (para queries colectionGroup) ──
      // Cada snapshot vira dois registros: um pela perspectiva da casa, um pela fora
      if (min >= 5 && min <= 85) { // só minutos com sentido preditivo
        const basePadrao = {
          fixtureId:    parseInt(fixtureId),
          timeCasaId, timeForaId,
          ligaId:       ligaId  ?? null,
          temporada:    temporada ?? null,
          minuto:       min,
          faseJogo:     faseJogo(min),
          odd1:         oddsPrejogo?.odd1  ?? null,
          oddX:         oddsPrejogo?.oddX  ?? null,
          odd2:         oddsPrejogo?.odd2  ?? null,
          over25:       oddsPrejogo?.over25 ?? null,
          golNos5:      golNoIntervalo(min, 5),
          golNos10:     golNoIntervalo(min, 10),
          golNos15:     golNoIntervalo(min, 15),
          cartaoNos10:  cartaoNoIntervalo(min, 10),
          totalGolsFinal: pC + pF,
          placarFinal:    `${pC}-${pF}`,
          processadoEm:   admin.firestore.FieldValue.serverTimestamp(),
        };

        // Perspectiva CASA
        padroesGerais.push({
          docId: `${fxStr}_${min}_casa`,
          data: {
            ...basePadrao,
            timeId:          timeCasaId,
            localJogo:       'casa',
            forcaAdversario: forcaFora,
            situacaoPlacar:  situacaoPlacar(min, timeCasaId),
            posse:           snap.casa?.posse ?? null,
            posseMedia10min: possePor10Min(snaps, min),
            yaiAtual:        snap.yai?.casa ?? null,
            yaiPorMin:       yaiPorMin(snaps, min, 'casa'),
            xg:              snap.casa?.xg  ?? null,
            chutesAlvo:      snap.casa?.chutesAlvo ?? null,
            gcs:             snap.gcs ?? null,
            golTimeNos5:     golTimeNoIntervalo(min, 5,  timeCasaId),
            golTimeNos10:    golTimeNoIntervalo(min, 10, timeCasaId),
            golTimeNos15:    golTimeNoIntervalo(min, 15, timeCasaId),
            resultadoFinal:  resultadoFinalTime(timeCasaId),
            golsAoMinuto:    golsAoMinuto(min, timeCasaId),
            golsRestantes:   golsRestantes(min, timeCasaId),
          }
        });

        // Perspectiva FORA
        padroesGerais.push({
          docId: `${fxStr}_${min}_fora`,
          data: {
            ...basePadrao,
            timeId:          timeForaId,
            localJogo:       'fora',
            forcaAdversario: forcaCasa,
            situacaoPlacar:  situacaoPlacar(min, timeForaId),
            posse:           snap.fora?.posse ?? null,
            posseMedia10min: null, // posse da casa; fora = 100 - casa
            yaiAtual:        snap.yai?.fora ?? null,
            yaiPorMin:       yaiPorMin(snaps, min, 'fora'),
            xg:              snap.fora?.xg  ?? null,
            chutesAlvo:      snap.fora?.chutesAlvo ?? null,
            gcs:             snap.gcs ? 100 - snap.gcs : null,
            golTimeNos5:     golTimeNoIntervalo(min, 5,  timeForaId),
            golTimeNos10:    golTimeNoIntervalo(min, 10, timeForaId),
            golTimeNos15:    golTimeNoIntervalo(min, 15, timeForaId),
            resultadoFinal:  resultadoFinalTime(timeForaId),
            golsAoMinuto:    golsAoMinuto(min, timeForaId),
            golsRestantes:   golsRestantes(min, timeForaId),
          }
        });
      }
    }

    // Commit batches dos snapshots-v2
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = db.batch();
      ops.slice(i, i + CHUNK).forEach(op => batch.update(op.ref, op.data));
      await batch.commit();
    }

    // Commit dos padrões globais (coleção padroes-globais)
    const padCol = db.collection('padroes-globais');
    for (let i = 0; i < padroesGerais.length; i += CHUNK) {
      const batch = db.batch();
      padroesGerais.slice(i, i + CHUNK).forEach(p => batch.set(padCol.doc(p.docId), p.data));
      await batch.commit();
    }

    // Atualizar índice por time (para busca rápida)
    const timesEnvolvidos = [
      { timeId: timeCasaId, local: 'casa', forcaAdv: forcaFora },
      { timeId: timeForaId, local: 'fora', forcaAdv: forcaCasa },
    ];
    for (const t of timesEnvolvidos) {
      await db.collection('indice-times').doc(String(t.timeId)).set({
        ultimoJogo:    parseInt(fixtureId),
        ultimaLiga:    ligaId ?? null,
        ultimaTemporada: temporada ?? null,
        totalJogos:    admin.firestore.FieldValue.increment(1),
        ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    console.log(`✅ enriquecerSnapshotsPosFT: ${ops.length} snapshots + ${padroesGerais.length} padrões salvos para fixture ${fixtureId}`);

    return {
      sucesso: true,
      snapshotsEnriquecidos: ops.length,
      padroesGlobaisSalvos: padroesGerais.length,
    };

  } catch(e) {
    console.error('enriquecerSnapshotsPosFT:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 5+6 — buscarPadroesTime + buscarPadroesGerais (unificados)
//
// Query o banco global e/ou por time para encontrar situações similares.
// Retorna:
//   totalAmostras, pctGolNos5/10/15, pctCartaoNos10
//   janelaPreditiva: { distribuicao, picoMinuto, janelaMin, janelaMax }
//   confiança: 'alta'|'media'|'baixa'|'insuficiente'
//   fonteBlend: { pesoTime, pesoGeral, amostrasTime, amostrasGeral }
// ════════════════════════════════════════════════════════════════════════════
exports.buscarPadroesTime = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
  try {
    const {
      timeId,
      localJogo,        // 'casa' | 'fora' | null (qualquer)
      forcaAdversario,  // 'top'|'forte'|'equilibrado'|'fraco'|null
      situacaoPlacar,   // 'vencendo'|'empatando'|'perdendo'|null
      faseJogo,         // '0_25'|'26_45'|'46_65'|'66_mais'|null
      minutoAtual,      // minuto corrente (para filtrar faseJogo)
      // Tolerâncias para match fuzzy
      posseMin, posseMax,       // null = sem filtro
      yaiPorMinMin,             // null = sem filtro
    } = data;

    if (!timeId) throw new functions.https.HttpsError('invalid-argument', 'timeId obrigatório');

    const db = admin.firestore();

    // ── Helper: query com filtros dinâmicos ──────────────────────────────
    const queryPadroes = async (collection, filtros) => {
      let q = db.collection(collection).where('timeId', '==', parseInt(timeId));
      if (filtros.localJogo)       q = q.where('localJogo',       '==', filtros.localJogo);
      if (filtros.forcaAdversario) q = q.where('forcaAdversario', '==', filtros.forcaAdversario);
      if (filtros.situacaoPlacar)  q = q.where('situacaoPlacar',  '==', filtros.situacaoPlacar);
      if (filtros.faseJogo)        q = q.where('faseJogo',        '==', filtros.faseJogo);
      // Limitar a 500 docs para performance
      const snap = await q.limit(500).get();
      return snap.docs.map(d => d.data());
    };

    // Determinar fase pelo minuto se não fornecida
    const fase = faseJogo ?? (
      !minutoAtual ? null :
      minutoAtual <= 25 ? '0_25' : minutoAtual <= 45 ? '26_45' :
      minutoAtual <= 65 ? '46_65' : '66_mais'
    );

    const filtros = {
      localJogo:       localJogo       ?? null,
      forcaAdversario: forcaAdversario ?? null,
      situacaoPlacar:  situacaoPlacar  ?? null,
      faseJogo:        fase,
    };

    // ── Buscar banco do time e banco geral em paralelo ───────────────────
    const [amostrasTime, amostrasGeral] = await Promise.all([
      queryPadroes('padroes-globais', filtros),
      queryPadroes('padroes-globais', { ...filtros }), // mesmo banco, time específico já filtrado
    ]);

    // Filtro adicional de posse e yai (não suportados como where no Firestore sem índice)
    const filtrarSnaps = (arr) => arr.filter(p => {
      if (posseMin != null && (p.posse ?? 50) < posseMin) return false;
      if (posseMax != null && (p.posse ?? 50) > posseMax) return false;
      if (yaiPorMinMin != null && (p.yaiPorMin ?? 0) < yaiPorMinMin) return false;
      return true;
    });

    const amostrasTimeFiltradas  = filtrarSnaps(amostrasTime);
    const amostrasGeralFiltradas = filtrarSnaps(amostrasGeral);

    const nTime  = amostrasTimeFiltradas.length;
    const nGeral = amostrasGeralFiltradas.length;

    // ── Peso do blend dinâmico ────────────────────────────────────────────
    // ≥30 amostras do time → 70% time / 30% geral
    // 10–29              → 40% time / 60% geral
    // <10                → 100% geral
    const pesoTime  = nTime >= 30 ? 0.7 : nTime >= 10 ? 0.4 : 0.0;
    const pesoGeral = 1 - pesoTime;

    // ── Calcular métricas ─────────────────────────────────────────────────
    const pct = (arr, key) => arr.length ? Math.round(arr.filter(p => p[key]).length / arr.length * 100) : null;

    const blendPct = (keyTime, keyGeral) => {
      const pT = pct(amostrasTimeFiltradas, keyTime);
      const pG = pct(amostrasGeralFiltradas, keyGeral || keyTime);
      if (pT === null && pG === null) return null;
      if (pT === null) return pG;
      if (pG === null) return pT;
      return Math.round(pT * pesoTime + pG * pesoGeral);
    };

    const pctGolNos5  = blendPct('golTimeNos5',  'golNos5');
    const pctGolNos10 = blendPct('golTimeNos10', 'golNos10');
    const pctGolNos15 = blendPct('golTimeNos15', 'golNos15');
    const pctQualquerGolNos10 = blendPct('golNos10', 'golNos10');
    const pctCartaoNos10 = blendPct('cartaoNos10', 'cartaoNos10');

    // ── Janela preditiva — distribuição temporal dos gols ─────────────────
    // Coleta todos os eventos de gol dos amostras e distribui por minuto
    const distGols = {}; // { minuto: count }
    const padroesComGol = [
      ...amostrasTimeFiltradas.filter(p => p.golTimeNos15),
      ...amostrasGeralFiltradas.filter(p => p.golNos15),
    ];

    // Aproximação: sabemos o minuto do snapshot e que o gol saiu em até 15min
    // Vamos usar o minuto do snapshot como referência e distribuir
    padroesComGol.forEach(p => {
      // Bucket de 5min para visualização
      const bucket = p.minuto <= 25 ? '0-25' : p.minuto <= 45 ? '26-45' : p.minuto <= 65 ? '46-65' : '66+';
      distGols[bucket] = (distGols[bucket] || 0) + 1;
    });

    // Pico de gol: minuto com mais ocorrências
    const totalAmostras = Math.max(nTime, nGeral);
    const confianca =
      totalAmostras >= 30 ? 'alta' :
      totalAmostras >= 15 ? 'media' :
      totalAmostras >= 5  ? 'baixa' : 'insuficiente';

    return {
      sucesso: true,
      totalAmostras,
      amostrasTime:  nTime,
      amostrasGeral: nGeral,
      blend: { pesoTime, pesoGeral },
      confianca,
      metricas: {
        pctGolNos5,
        pctGolNos10,
        pctGolNos15,
        pctQualquerGolNos10,
        pctCartaoNos10,
      },
      distribuicaoFases: distGols,
      filtrosAplicados: { localJogo, forcaAdversario, situacaoPlacar, fase, posseMin, posseMax, yaiPorMinMin },
    };

  } catch(e) {
    console.error('buscarPadroesTime:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 7+8 — detectarPadraoAoVivo
//
// Chamada a cada N minutos durante o jogo ao vivo.
// Recebe o estado atual e retorna o padrão mais relevante detectado,
// com probabilidade histórica e janela temporal prevista.
//
// Combina buscarPadroesTime internamente.
// ════════════════════════════════════════════════════════════════════════════
exports.detectarPadraoAoVivo = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
  try {
    const {
      timeCasaId, timeForaId,
      minutoAtual,
      posseCasa,
      yaiCasa, yaiFora,
      yaiPorMinCasa, yaiPorMinFora,
      gcsCasa,
      situacaoPlacarCasa,  // 'vencendo'|'empatando'|'perdendo'
      situacaoPlacarFora,
      odd1, oddX, odd2, over25, // odds pré-jogo
      ligaId,
    } = data;

    if (!timeCasaId || !timeForaId || minutoAtual == null) {
      throw new functions.https.HttpsError('invalid-argument', 'campos obrigatórios ausentes');
    }

    const db = admin.firestore();

    // Classificar força dos times pelo odd inicial
    const classForça = (odd) => {
      if (!odd) return null;
      if (odd < 1.50) return 'top';
      if (odd < 2.20) return 'forte';
      if (odd < 3.20) return 'equilibrado';
      return 'fraco';
    };
    const forcaCasa = classForça(odd1);  // força do time da CASA
    const forcaFora = classForça(odd2);  // força do time de FORA

    // Fase do jogo
    const fase =
      minutoAtual <= 25 ? '0_25' : minutoAtual <= 45 ? '26_45' :
      minutoAtual <= 65 ? '46_65' : '66_mais';

    // Tolerância de posse para match (±15%)
    const posseMin = posseCasa ? Math.max(0,  posseCasa - 15) : null;
    const posseMax = posseCasa ? Math.min(100, posseCasa + 15) : null;

    // YAI mínimo para match (80% do atual)
    const yaiMinCasa = yaiPorMinCasa ? yaiPorMinCasa * 0.8 : null;
    const yaiMinFora = yaiPorMinFora ? yaiPorMinFora * 0.8 : null;

    // ── Buscar padrões para os dois times em paralelo ────────────────────
    const queryPadroes = async (timeId, localJogo, situacaoPlacar, forcaAdv, posseMinL, posseMaxL, yaiMin) => {
      let q = db.collection('padroes-globais')
        .where('timeId', '==', parseInt(timeId))
        .where('faseJogo', '==', fase);
      if (localJogo)       q = q.where('localJogo',       '==', localJogo);
      if (situacaoPlacar)  q = q.where('situacaoPlacar',  '==', situacaoPlacar);
      if (forcaAdv)        q = q.where('forcaAdversario', '==', forcaAdv);
      const snap = await q.limit(200).get();
      let docs = snap.docs.map(d => d.data());
      // Filtro adicional em memória
      if (posseMinL != null) docs = docs.filter(p => (p.posse ?? 50) >= posseMinL);
      if (posseMaxL != null) docs = docs.filter(p => (p.posse ?? 50) <= posseMaxL);
      if (yaiMin    != null) docs = docs.filter(p => (p.yaiPorMin ?? 0) >= yaiMin);
      return docs;
    };

    const [padCasa, padFora] = await Promise.all([
      queryPadroes(timeCasaId, 'casa', situacaoPlacarCasa, forcaFora, posseMin, posseMax, yaiMinCasa),
      queryPadroes(timeForaId, 'fora', situacaoPlacarFora, forcaCasa, null, null, yaiMinFora),
    ]);

    // ── Calcular padrão para cada time ───────────────────────────────────
    const calcPadrao = (amostras, timeId, local) => {
      const n = amostras.length;
      if (n === 0) return null;
      const pct = (key) => Math.round(amostras.filter(p => p[key]).length / n * 100);
      const g5  = pct('golTimeNos5');
      const g10 = pct('golTimeNos10');
      const g15 = pct('golTimeNos15');
      const c10 = pct('cartaoNos10');

      // Janela de maior probabilidade
      const janela = g5 >= 40 ? 5 : g10 >= 40 ? 10 : 15;
      const probJanela = janela === 5 ? g5 : janela === 10 ? g10 : g15;

      // Pico: aproximar minuto de pico pela fase
      const picos = { '0_25': 18, '26_45': 38, '46_65': 58, '66_mais': 78 };
      const picoMin = Math.max(minutoAtual + 3, picos[fase] ?? minutoAtual + 8);
      const picoMax = picoMin + (janela === 5 ? 5 : 8);

      return {
        timeId,
        local,
        totalAmostras: n,
        confianca: n >= 30 ? 'alta' : n >= 15 ? 'media' : n >= 5 ? 'baixa' : 'insuficiente',
        pctGolNos5: g5,
        pctGolNos10: g10,
        pctGolNos15: g15,
        pctCartaoNos10: c10,
        janelaRecomendada: janela,
        probJanela,
        picoEstimado: { min: picoMin, max: picoMax },
        alertar: probJanela >= 55 && n >= 5, // limiar para mostrar ao admin
      };
    };

    const padraoCasa = calcPadrao(padCasa, timeCasaId, 'casa');
    const padraoFora = calcPadrao(padFora, timeForaId, 'fora');

    // ── Selecionar padrão mais forte para destaque ────────────────────────
    const ambos = [padraoCasa, padraoFora].filter(Boolean);
    const melhor = ambos.sort((a,b) => b.probJanela - a.probJanela)[0] ?? null;

    return {
      sucesso: true,
      minutoAtual,
      fase,
      padraoCasa,
      padraoFora,
      melhorPadrao: melhor,
      alertarAdmin: melhor?.alertar ?? false,
    };

  } catch(e) {
    console.error('detectarPadraoAoVivo:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Estrutura Firestore — Pattern Engine
//
//  padroes-globais/{fixtureId}_{minuto}_casa|fora
//    timeId, localJogo, faseJogo, forcaAdversario, situacaoPlacar
//    posse, posseMedia10min, yaiAtual, yaiPorMin, xg, chutesAlvo, gcs
//    golTimeNos5, golTimeNos10, golTimeNos15
//    golNos5, golNos10, golNos15, cartaoNos10
//    totalGolsFinal, placarFinal, odd1, oddX, odd2, over25
//    ligaId, temporada, fixtureId, minuto, processadoEm
//
//  indice-times/{timeId}
//    ultimoJogo, ultimaLiga, totalJogos, ultimaAtualizacao
//
//  Índices Firestore necessários (criar no console):
//    padroes-globais:
//      timeId ASC + faseJogo ASC + localJogo ASC
//      timeId ASC + faseJogo ASC + situacaoPlacar ASC
//      timeId ASC + faseJogo ASC + forcaAdversario ASC
//      timeId ASC + faseJogo ASC + localJogo ASC + forcaAdversario ASC + situacaoPlacar ASC
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// BACKFILL HISTÓRICO — backfillPadroesHistorico
//
// Escaneia partidas-live/{fixtureId} com encerradoEm != null e sem padrões
// no banco global. Para cada jogo pendente, busca eventos da API (1 call),
// extrai o contexto e chama a lógica de enriquecimento inline.
//
// Parâmetros:
//   limite     {number}  — jogos a processar por chamada (default 5, max 20)
//   forcarTodos {bool}   — reprocessa mesmo os já processados (default false)
//
// Retorna:
//   processados   — fixtures processados nesta chamada
//   pendentes     — quantos ainda faltam (estimativa)
//   detalhes      — [{fixtureId, snaps, padroes, status}]
// ════════════════════════════════════════════════════════════════════════════
exports.backfillPadroesHistorico = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
  try {
    const limite     = Math.min(parseInt(data?.limite ?? 5), 20);
    const forcarTodos = data?.forcarTodos === true;

    const db = admin.firestore();

    // ── 1. Listar jogos encerrados em partidas-live ──────────────────────
    // Busca todos os docs que tenham encerradoEm (= foram finalizados)
    let q = db.collection('partidas-live').where('encerradoEm', '!=', null);
    const partidasSnap = await q.orderBy('encerradoEm', 'desc').limit(200).get();

    if (partidasSnap.empty) {
      return { processados: 0, pendentes: 0, detalhes: [], motivo: 'nenhum jogo encerrado encontrado' };
    }

    // ── 2. Filtrar os que ainda não têm padrões (ou forçar todos) ────────
    const pendentes = [];
    for (const doc of partidasSnap.docs) {
      const d = doc.data();
      if (!d.timeCasaId || !d.timeForaId) continue; // dados insuficientes
      if (!forcarTodos && d.backfillStatus === 'sem_snapshots') continue; // sem snapshots, pular

      if (!forcarTodos) {
        // Verifica se já existe ao menos 1 padrão global para este fixture
        const check = await db.collection('padroes-globais')
          .where('fixtureId', '==', d.fixtureId ?? parseInt(doc.id))
          .limit(1).get();
        if (!check.empty) continue; // já processado
      }

      pendentes.push({ id: doc.id, data: d });
      if (pendentes.length >= limite * 3) break; // pré-busca 3x para ter margem
    }

    if (pendentes.length === 0) {
      return { processados: 0, pendentes: 0, detalhes: [], motivo: 'todos os jogos já foram processados' };
    }

    // ── 3. Processar até `limite` jogos ──────────────────────────────────
    const lote     = pendentes.slice(0, limite);
    const detalhes = [];
    const CHUNK    = 400;

    for (const item of lote) {
      const fxStr     = item.id;
      const jogoData  = item.data;
      const fixtureId = jogoData.fixtureId ?? parseInt(fxStr);
      const timeCasaId  = jogoData.timeCasaId;
      const timeForaId  = jogoData.timeForaId;
      const ligaId      = jogoData.ligaId      ?? null;
      const temporada   = jogoData.temporada    ?? null;
      const oddsPrejogo = jogoData.oddsPrejogo  ?? null;
      const pC = jogoData.resultado?.placarFinal?.casa ?? 0;
      const pF = jogoData.resultado?.placarFinal?.fora ?? 0;

      try {
        // ── 3a. Buscar eventos da API (1 call) ───────────────────────────
        let eventosApi = [];
        try {
          const evRes = await apiFootballGet(`/fixtures/events?fixture=${fixtureId}`);
          eventosApi = (evRes.response || []).map(e => ({
            tipo:   e.type,   // 'Goal' | 'Card'
            minuto: e.time?.elapsed ?? 0,
            timeId: e.team?.id ?? null,
          }));
        } catch (apiErr) {
          console.warn(`backfill: sem eventos API para ${fixtureId} — ${apiErr.message}`);
        }

        // ── 3b. Ler snapshots-v2 (e fallback para snapshots v1) ──────────
        const snapCol  = db.collection('partidas-live').doc(fxStr).collection('snapshots-v2');
        let snapSnap = await snapCol.orderBy('minuto', 'asc').get();

        // Fallback: se snapshots-v2 vazio, tentar snapshots v1 (jogos antigos)
        if (snapSnap.empty) {
          const snapColV1 = db.collection('partidas-live').doc(fxStr).collection('snapshots');
          snapSnap = await snapColV1.orderBy('minuto', 'asc').get();
        }

        if (snapSnap.empty) {
          // Marcar para nao repetir em lotes futuros
          await db.collection('partidas-live').doc(fxStr).set(
            { backfillStatus: 'sem_snapshots', backfillEm: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          detalhes.push({ fixtureId, status: 'sem_snapshots' });
          continue;
        }

        const snaps = snapSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

        // ── 3c. Helpers (mesma lógica de enriquecerSnapshotsPosFT) ────────
        const evGols    = eventosApi.filter(e => e.tipo === 'Goal');
        const evCartoes = eventosApi.filter(e => e.tipo === 'Card');

        const golNoIntervalo     = (m, j) => evGols.some(e => e.minuto > m && e.minuto <= m + j);
        const cartaoNoIntervalo  = (m, j) => evCartoes.some(e => e.minuto > m && e.minuto <= m + j);
        const golTimeNoIntervalo = (m, j, tId) => evGols.some(e => e.minuto > m && e.minuto <= m + j && e.timeId === tId);

        const possePor10Min = (snapsArr, minAtual) => {
          const janela = snapsArr.filter(s => s.minuto >= minAtual - 10 && s.minuto < minAtual);
          if (!janela.length) return null;
          const vals = janela.map(s => s.casa?.posse).filter(v => v != null && v > 0);
          return vals.length ? Math.round(vals.reduce((a,b)=>a+b)/vals.length) : null;
        };

        const yaiPorMin = (snapsArr, minAtual, side) => {
          const ref = snapsArr.filter(s => s.minuto >= minAtual - 10 && s.minuto < minAtual);
          if (ref.length < 2) return null;
          const key = side === 'casa' ? 'casa' : 'fora';
          const yaiNow = snapsArr.find(s => s.minuto === minAtual)?.yai?.[key] ?? null;
          const yaiOld = ref[0]?.yai?.[key] ?? null;
          if (yaiNow === null || yaiOld === null) return null;
          const mins = Math.max(1, minAtual - ref[0].minuto);
          return +((yaiNow - yaiOld) / mins).toFixed(3);
        };

        const faseJogo = (m) =>
          m <= 25 ? '0_25' : m <= 45 ? '26_45' : m <= 65 ? '46_65' : '66_mais';

        const situacaoPlacar = (minAtual, timeId) => {
          const gT = evGols.filter(e => e.minuto <= minAtual && e.timeId === timeId).length;
          const gA = evGols.filter(e => e.minuto <= minAtual && e.timeId !== timeId).length;
          return gT > gA ? 'vencendo' : gT < gA ? 'perdendo' : 'empatando';
        };

        const classForça = (odd) => {
          if (!odd) return 'desconhecido';
          if (odd < 1.50) return 'top';
          if (odd < 2.20) return 'forte';
          if (odd < 3.20) return 'equilibrado';
          return 'fraco';
        };
        const forcaCasa = classForça(oddsPrejogo?.odd1);
        const forcaFora = classForça(oddsPrejogo?.odd2);

        // ── 3d. Montar ops de enriquecimento ─────────────────────────────
        const ops = [];
        const padroesGerais = [];

        for (const snap of snaps) {
          const min = snap.minuto || 0;

          const enricData = {
            'padraoEnriquecido.golNos5min':       golTimeNoIntervalo(min, 5,  timeCasaId),
            'padraoEnriquecido.golNos10min':      golTimeNoIntervalo(min, 10, timeCasaId),
            'padraoEnriquecido.golNos15min':      golTimeNoIntervalo(min, 15, timeCasaId),
            'padraoEnriquecido.qualquerGolNos5':  golNoIntervalo(min, 5),
            'padraoEnriquecido.qualquerGolNos10': golNoIntervalo(min, 10),
            'padraoEnriquecido.qualquerGolNos15': golNoIntervalo(min, 15),
            'padraoEnriquecido.cartaoNos10min':   cartaoNoIntervalo(min, 10),
            'padraoEnriquecido.forcaAdversarioCasa': forcaFora,
            'padraoEnriquecido.forcaAdversarioFora': forcaCasa,
            'padraoEnriquecido.situacaoPlacarCasa':  situacaoPlacar(min, timeCasaId),
            'padraoEnriquecido.situacaoPlacarFora':  situacaoPlacar(min, timeForaId),
            'padraoEnriquecido.faseJogo':             faseJogo(min),
            'padraoEnriquecido.posseMedia10minCasa':  possePor10Min(snaps, min),
            'padraoEnriquecido.yaiPorMinCasa':        yaiPorMin(snaps, min, 'casa'),
            'padraoEnriquecido.yaiPorMinFora':        yaiPorMin(snaps, min, 'fora'),
            'padraoEnriquecido.momentumCasa':         snap.yai?.casa ?? null,
            'padraoEnriquecido.momentumFora':         snap.yai?.fora ?? null,
            'padraoEnriquecido.gcsCasa':              snap.gcs       ?? null,
            'padraoEnriquecido.processado':           true,
            'padraoEnriquecido.processadoEm':         admin.firestore.FieldValue.serverTimestamp(),
            'padraoEnriquecido.ligaId':               ligaId,
            'padraoEnriquecido.temporada':            temporada,
            'padraoEnriquecido.odd1Inicial':          oddsPrejogo?.odd1  ?? null,
            'padraoEnriquecido.oddXInicial':          oddsPrejogo?.oddX  ?? null,
            'padraoEnriquecido.odd2Inicial':          oddsPrejogo?.odd2  ?? null,
            'padraoEnriquecido.over25Inicial':        oddsPrejogo?.over25 ?? null,
            'padraoEnriquecido.placarFinal':          `${pC}-${pF}`,
            'padraoEnriquecido.totalGolsFinal':       pC + pF,
          };
          ops.push({ ref: snap.ref, data: enricData });

          if (min >= 5 && min <= 85) {
            const base = {
              fixtureId: parseInt(fixtureId),
              timeCasaId, timeForaId, ligaId, temporada, minuto: min,
              faseJogo: faseJogo(min),
              odd1: oddsPrejogo?.odd1 ?? null, oddX: oddsPrejogo?.oddX ?? null,
              odd2: oddsPrejogo?.odd2 ?? null, over25: oddsPrejogo?.over25 ?? null,
              golNos5: golNoIntervalo(min, 5), golNos10: golNoIntervalo(min, 10),
              golNos15: golNoIntervalo(min, 15), cartaoNos10: cartaoNoIntervalo(min, 10),
              totalGolsFinal: pC + pF, placarFinal: `${pC}-${pF}`,
              processadoEm: admin.firestore.FieldValue.serverTimestamp(),
            };
            padroesGerais.push({
              docId: `${fxStr}_${min}_casa`,
              data: { ...base, timeId: timeCasaId, localJogo: 'casa',
                forcaAdversario: forcaFora, situacaoPlacar: situacaoPlacar(min, timeCasaId),
                posse: snap.casa?.posse ?? null, posseMedia10min: possePor10Min(snaps, min),
                yaiAtual: snap.yai?.casa ?? null, yaiPorMin: yaiPorMin(snaps, min, 'casa'),
                xg: snap.casa?.xg ?? null, chutesAlvo: snap.casa?.chutesAlvo ?? null,
                gcs: snap.gcs ?? null,
                golTimeNos5: golTimeNoIntervalo(min,5,timeCasaId),
                golTimeNos10: golTimeNoIntervalo(min,10,timeCasaId),
                golTimeNos15: golTimeNoIntervalo(min,15,timeCasaId),
                resultadoFinal: (() => {
                  const gT = evGols.length ? evGols.filter(e=>e.timeId===timeCasaId).length : pC;
                  const gA = evGols.length ? evGols.filter(e=>e.timeId!==timeCasaId).length : pF;
                  return gT>gA?'vitoria':gT<gA?'derrota':'empate';
                })(),
                golsAoMinuto:  evGols.filter(e=>e.minuto<=min&&e.timeId===timeCasaId).length,
                golsRestantes: evGols.filter(e=>e.minuto>min&&e.timeId===timeCasaId).length,
              }
            });
            padroesGerais.push({
              docId: `${fxStr}_${min}_fora`,
              data: { ...base, timeId: timeForaId, localJogo: 'fora',
                forcaAdversario: forcaCasa, situacaoPlacar: situacaoPlacar(min, timeForaId),
                posse: snap.fora?.posse ?? null, posseMedia10min: null,
                yaiAtual: snap.yai?.fora ?? null, yaiPorMin: yaiPorMin(snaps, min, 'fora'),
                xg: snap.fora?.xg ?? null, chutesAlvo: snap.fora?.chutesAlvo ?? null,
                gcs: snap.gcs ? 100 - snap.gcs : null,
                golTimeNos5: golTimeNoIntervalo(min,5,timeForaId),
                golTimeNos10: golTimeNoIntervalo(min,10,timeForaId),
                golTimeNos15: golTimeNoIntervalo(min,15,timeForaId),
                resultadoFinal: (() => {
                  const gT = evGols.length ? evGols.filter(e=>e.timeId===timeForaId).length : pF;
                  const gA = evGols.length ? evGols.filter(e=>e.timeId!==timeForaId).length : pC;
                  return gT>gA?'vitoria':gT<gA?'derrota':'empate';
                })(),
                golsAoMinuto:  evGols.filter(e=>e.minuto<=min&&e.timeId===timeForaId).length,
                golsRestantes: evGols.filter(e=>e.minuto>min&&e.timeId===timeForaId).length,
              }
            });
          }
        }

        // ── 3e. Commit em batches ─────────────────────────────────────────
        for (let i = 0; i < ops.length; i += CHUNK) {
          const batch = db.batch();
          ops.slice(i, i+CHUNK).forEach(op => batch.update(op.ref, op.data));
          await batch.commit();
        }

        const padCol = db.collection('padroes-globais');
        for (let i = 0; i < padroesGerais.length; i += CHUNK) {
          const batch = db.batch();
          padroesGerais.slice(i, i+CHUNK).forEach(p => batch.set(padCol.doc(p.docId), p.data));
          await batch.commit();
        }

        // ── 3f. Atualizar índice por time ─────────────────────────────────
        for (const t of [
          { timeId: timeCasaId, local: 'casa', forcaAdv: forcaFora },
          { timeId: timeForaId, local: 'fora', forcaAdv: forcaCasa },
        ]) {
          await db.collection('indice-times').doc(String(t.timeId)).set({
            ultimoJogo: parseInt(fixtureId), ultimaLiga: ligaId, ultimaTemporada: temporada,
            totalJogos: admin.firestore.FieldValue.increment(1),
            ultimaAtualizacao: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        detalhes.push({
          fixtureId, status: 'ok',
          snaps: ops.length, padroes: padroesGerais.length,
          temEventos: evGols.length > 0,
        });

        console.log(`✅ backfill ${fixtureId}: ${ops.length} snaps, ${padroesGerais.length} padrões`);

      } catch (jogoErr) {
        console.error(`backfill erro fixture ${fixtureId}:`, jogoErr.message);
        detalhes.push({ fixtureId, status: 'erro', motivo: jogoErr.message });
      }
    }

    const processados = detalhes.filter(d => d.status === 'ok').length;
    const estimativaPendentes = Math.max(0, pendentes.length - lote.length);

    return {
      sucesso: true,
      processados,
      pendentes:  estimativaPendentes,
      total:      partidasSnap.size,
      detalhes,
    };

  } catch(e) {
    console.error('backfillPadroesHistorico:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE GOLS POR CONTEXTO — buscarContextoGol
//
// "Quando este time estava perdendo no min X com posse Y%, o que aconteceu?"
//
// Parâmetros:
//   timeId          — time a analisar
//   situacaoPlacar  — 'perdendo'|'empatando'|'vencendo'
//   faseJogo        — '0_25'|'26_45'|'46_65'|'66_mais'|null
//   localJogo       — 'casa'|'fora'|null
//   forcaAdversario — 'top'|'forte'|'equilibrado'|'fraco'|null
//   posseAtual      — posse atual (para comparar com histórico)
//   xgAtual         — xg atual (para diagnóstico)
//   chutesAtual     — chutes a gol atuais (para diagnóstico)
//
// Retorna:
//   totalAmostras, confianca
//   resultados: { pctVitoria, pctEmpate, pctDerrota }
//   golos: { pctGolNos5, pctGolNos10, pctGolNos15 }
//   medias: { posse, xg, chutesAlvo }  — médias históricas nessa situação
//   diagnostico: []  — insights comparando atual vs histórico
// ════════════════════════════════════════════════════════════════════════════
exports.buscarContextoGol = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
  try {
    const {
      timeId, situacaoPlacar, faseJogo,
      localJogo, forcaAdversario,
      posseAtual, xgAtual, chutesAtual,
    } = data;

    if (!timeId || !situacaoPlacar) {
      throw new functions.https.HttpsError('invalid-argument', 'timeId e situacaoPlacar obrigatórios');
    }

    const db = admin.firestore();

    // ── Query base com filtros progressivos ─────────────────────────────
    // Tenta filtros completos; relaxa se < 10 amostras
    const queryWith = async (filtros) => {
      let q = db.collection('padroes-globais')
        .where('timeId',        '==', parseInt(timeId))
        .where('situacaoPlacar','==', situacaoPlacar);
      if (filtros.faseJogo)        q = q.where('faseJogo',        '==', filtros.faseJogo);
      if (filtros.localJogo)       q = q.where('localJogo',       '==', filtros.localJogo);
      if (filtros.forcaAdversario) q = q.where('forcaAdversario', '==', filtros.forcaAdversario);
      const snap = await q.limit(500).get();
      return snap.docs.map(d => d.data());
    };

    // Tenta com todos os filtros, depois vai relaxando
    let amostras = await queryWith({ faseJogo, localJogo, forcaAdversario });
    let modoBlend = 'completo';

    if (amostras.length < 10) {
      amostras = await queryWith({ faseJogo, localJogo });
      modoBlend = 'sem_forca';
    }
    if (amostras.length < 10) {
      amostras = await queryWith({ faseJogo });
      modoBlend = 'so_fase';
    }
    if (amostras.length < 5) {
      amostras = await queryWith({});
      modoBlend = 'so_situacao';
    }

    const n = amostras.length;
    const confianca = n >= 30 ? 'alta' : n >= 15 ? 'media' : n >= 5 ? 'baixa' : 'insuficiente';
    console.log(`buscarContextoGol: timeId=${parseInt(timeId)} situacao=${situacaoPlacar} fase=${faseJogo} local=${localJogo} forca=${forcaAdversario} → ${n} amostras (${modoBlend})`);

    // Banco vazio — retornar shape limpo em vez de todos os campos null
    if (n === 0) {
      return {
        sucesso: true, totalAmostras: 0, confianca: 'insuficiente', modoBlend,
        filtrosAplicados: { situacaoPlacar, faseJogo, localJogo, forcaAdversario },
        resultados: { pctVitoria: null, pctEmpate: null, pctDerrota: null, totalComResultado: 0 },
        gols: { pctGolNos5: null, pctGolNos10: null, pctGolNos15: null, pctMarcouDepois: null },
        medias: { posse: null, xg: null, chutesAlvo: null, gcs: null, yai: null },
        diagnostico: [],
        _bancoVazio: true,
      };
    }


    // ── Função auxiliar de porcentagem ───────────────────────────────────
    const pct = (arr, fn) => n ? Math.round(arr.filter(fn).length / n * 100) : null;
    const avg = (arr, key) => {
      const vals = arr.map(p => p[key]).filter(v => v != null && v > 0);
      return vals.length ? +(vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(1) : null;
    };

    // ── Resultado final ──────────────────────────────────────────────────
    // resultadoFinal novo campo. Para amostras antigas sem ele, derivar de placarFinal + localJogo
    const resultado = (p) => {
      if (p.resultadoFinal) return p.resultadoFinal;
      // Fallback: derivar de placarFinal
      if (!p.placarFinal) return null;
      const parts = p.placarFinal.split('-').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      const [gc, gf] = parts;
      if (p.localJogo === 'casa') return gc > gf ? 'vitoria' : gc < gf ? 'derrota' : 'empate';
      if (p.localJogo === 'fora') return gf > gc ? 'vitoria' : gf < gc ? 'derrota' : 'empate';
      return null;
    };

    const comResultado = amostras.filter(p => resultado(p) !== null);
    const nR = comResultado.length;
    const pctVitoria  = nR ? Math.round(comResultado.filter(p => resultado(p) === 'vitoria').length  / nR * 100) : null;
    const pctEmpate   = nR ? Math.round(comResultado.filter(p => resultado(p) === 'empate').length   / nR * 100) : null;
    const pctDerrota  = nR ? Math.round(comResultado.filter(p => resultado(p) === 'derrota').length  / nR * 100) : null;

    // ── Probabilidade de gol próximos minutos ───────────────────────────
    const pctGolNos5  = pct(amostras, p => p.golTimeNos5);
    const pctGolNos10 = pct(amostras, p => p.golTimeNos10);
    const pctGolNos15 = pct(amostras, p => p.golTimeNos15);

    // ── Médias históricas nessa situação ─────────────────────────────────
    const mediaPosse  = avg(amostras, 'posse');
    const mediaXG     = avg(amostras, 'xg');
    const mediaChutes = avg(amostras, 'chutesAlvo');
    const mediaGCS    = avg(amostras, 'gcs');
    const mediaYAI    = avg(amostras, 'yaiAtual');

    // ── Diagnóstico: comparar atual vs médias históricas ─────────────────
    const diagnostico = [];

    if (posseAtual != null && mediaPosse != null) {
      const diff = posseAtual - mediaPosse;
      if (diff >= 10) diagnostico.push({
        tipo: 'posse_alta', nivel: 'positivo',
        texto: `Posse ${posseAtual}% vs média histórica ${mediaPosse}% — ${diff.toFixed(0)}% acima do normal nessa situação`,
        icone: '📊',
      });
      else if (diff <= -10) diagnostico.push({
        tipo: 'posse_baixa', nivel: 'negativo',
        texto: `Posse ${posseAtual}% vs média histórica ${mediaPosse}% — ${Math.abs(diff).toFixed(0)}% abaixo do normal`,
        icone: '📉',
      });
    }

    if (xgAtual != null && mediaXG != null) {
      const diff = xgAtual - mediaXG;
      if (posseAtual != null && mediaPosse != null && posseAtual > mediaPosse && diff < -0.1) {
        diagnostico.push({
          tipo: 'posse_sem_xg', nivel: 'alerta',
          texto: `Posse alta mas xG ${xgAtual.toFixed(2)} vs média ${mediaXG.toFixed(2)} — pressão sem criatividade de finalizações`,
          icone: '⚠️',
        });
      } else if (diff >= 0.2) {
        diagnostico.push({
          tipo: 'xg_alto', nivel: 'positivo',
          texto: `xG ${xgAtual.toFixed(2)} acima da média histórica ${mediaXG.toFixed(2)} — criando mais chances que o normal`,
          icone: '🎯',
        });
      } else if (diff <= -0.2) {
        diagnostico.push({
          tipo: 'xg_baixo', nivel: 'negativo',
          texto: `xG ${xgAtual.toFixed(2)} abaixo da média histórica ${mediaXG.toFixed(2)} — criando menos que o normal`,
          icone: '🔕',
        });
      }
    }

    if (chutesAtual != null && mediaChutes != null) {
      const diff = chutesAtual - mediaChutes;
      if (diff >= 3) diagnostico.push({
        tipo: 'chutes_altos', nivel: 'positivo',
        texto: `${chutesAtual} chutes a gol vs média ${mediaChutes.toFixed(0)} — pressionando muito`,
        icone: '💥',
      });
      else if (diff <= -3) diagnostico.push({
        tipo: 'chutes_baixos', nivel: 'negativo',
        texto: `${chutesAtual} chutes a gol vs média ${mediaChutes.toFixed(0)} — menos chegadas que o normal`,
        icone: '😶',
      });
    }

    // Detecção específica: posse alta + xG baixo = problema de finalizador
    const temPosseSemXG = diagnostico.some(d => d.tipo === 'posse_sem_xg');
    if (temPosseSemXG && chutesAtual != null && mediaChutes != null && chutesAtual >= mediaChutes) {
      diagnostico.push({
        tipo: 'finalizador', nivel: 'alerta',
        texto: 'Chutes em quantidade mas baixo xG — problema de qualidade de finalização, não de volume',
        icone: '🎯',
      });
    }

    // Insight sobre golsRestantes (% dos jogos nessa situação que ainda marcou)
    const comGolsRestantes = amostras.filter(p => p.golsRestantes != null);
    const pctMarcouDepois = comGolsRestantes.length
      ? Math.round(comGolsRestantes.filter(p => p.golsRestantes > 0).length / comGolsRestantes.length * 100)
      : null;

    return {
      sucesso: true,
      totalAmostras: n,
      confianca,
      modoBlend,
      filtrosAplicados: { situacaoPlacar, faseJogo, localJogo, forcaAdversario },
      resultados: { pctVitoria, pctEmpate, pctDerrota, totalComResultado: nR },
      gols: { pctGolNos5, pctGolNos10, pctGolNos15, pctMarcouDepois },
      medias: { posse: mediaPosse, xg: mediaXG, chutesAlvo: mediaChutes, gcs: mediaGCS, yai: mediaYAI },
      diagnostico,
    };

  } catch(e) {
    console.error('buscarContextoGol:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  buscarContextoGlobal
//  Igual ao buscarContextoGol mas SEM filtro de timeId.
//  Retorna estatísticas do BANCO TODO para um dado contexto.
//  Usado para comparar: "o time fez isso em X% — em geral acontece em Y%"
// ══════════════════════════════════════════════════════════════════════════
exports.buscarContextoGlobal = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
  try {
    const { situacaoPlacar, faseJogo, localJogo, forcaAdversario } = data;

    const db = admin.firestore();

    const queryWith = async (filtros) => {
      let q = db.collection('padroes-globais');
      if (filtros.situacaoPlacar) q = q.where('situacaoPlacar','==', filtros.situacaoPlacar);
      if (filtros.faseJogo)       q = q.where('faseJogo',      '==', filtros.faseJogo);
      if (filtros.localJogo)      q = q.where('localJogo',     '==', filtros.localJogo);
      if (filtros.forcaAdversario)q = q.where('forcaAdversario','==',filtros.forcaAdversario);
      const snap = await q.limit(1000).get();
      return snap.docs.map(d => d.data());
    };

    let amostras = await queryWith({ situacaoPlacar, faseJogo, localJogo, forcaAdversario });
    let modo = 'completo';
    if (amostras.length < 30) { amostras = await queryWith({ situacaoPlacar, faseJogo, localJogo }); modo = 'sem_forca'; }
    if (amostras.length < 15) { amostras = await queryWith({ situacaoPlacar, faseJogo }); modo = 'so_fase'; }
    if (amostras.length < 5)  { amostras = await queryWith({ situacaoPlacar }); modo = 'so_situacao'; }

    const n = amostras.length;
    const confianca = n >= 100 ? 'alta' : n >= 30 ? 'media' : n >= 10 ? 'baixa' : 'insuficiente';
    if (n === 0) {
      return {
        sucesso: true, totalAmostras: 0, confianca: 'insuficiente', modo,
        filtrosAplicados: { situacaoPlacar, faseJogo, localJogo, forcaAdversario },
        resultados: { pctVitoria: null, pctEmpate: null, pctDerrota: null, totalComResultado: 0 },
        gols: { pctGolNos5: null, pctGolNos10: null, pctGolNos15: null, pctMarcou: null },
        medias: { posse: null, xg: null, chutesAlvo: null, yai: null },
        _bancoVazio: true,
      };
    }

    const resultado = (p) => {
      if (p.resultadoFinal) return p.resultadoFinal;
      if (!p.placarFinal) return null;
      const parts = p.placarFinal.split('-').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      const [gc, gf] = parts;
      if (p.localJogo === 'casa') return gc > gf ? 'vitoria' : gc < gf ? 'derrota' : 'empate';
      if (p.localJogo === 'fora') return gf > gc ? 'vitoria' : gf < gc ? 'derrota' : 'empate';
      return null;
    };

    const comResultado = amostras.filter(p => resultado(p) !== null);
    const nR = comResultado.length;
    const pctVitoria = nR ? Math.round(comResultado.filter(p=>resultado(p)==='vitoria').length/nR*100) : null;
    const pctEmpate  = nR ? Math.round(comResultado.filter(p=>resultado(p)==='empate').length/nR*100)  : null;
    const pctDerrota = nR ? Math.round(comResultado.filter(p=>resultado(p)==='derrota').length/nR*100) : null;

    const pct = (fn) => n ? Math.round(amostras.filter(fn).length/n*100) : null;
    const avg = (key) => { const v=amostras.map(p=>p[key]).filter(v=>v!=null&&v>0); return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null; };

    const pctGolNos5  = pct(p=>p.golTimeNos5);
    const pctGolNos10 = pct(p=>p.golTimeNos10);
    const pctGolNos15 = pct(p=>p.golTimeNos15);
    const pctMarcou   = pct(p=>p.golsRestantes > 0);

    return {
      sucesso: true,
      totalAmostras: n,
      confianca,
      modo,
      filtrosAplicados: { situacaoPlacar, faseJogo, localJogo, forcaAdversario },
      resultados: { pctVitoria, pctEmpate, pctDerrota, totalComResultado: nR },
      gols: { pctGolNos5, pctGolNos10, pctGolNos15, pctMarcou },
      medias: {
        posse: avg('posse'), xg: avg('xg'),
        chutesAlvo: avg('chutesAlvo'), yai: avg('yaiPorMin'),
      },
    };
  } catch(e) {
    console.error('buscarContextoGlobal:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ════════════════════════════════════════════════════════════════
// buscarTaxaSequencia
// Retorna taxa de gol após escanteio/sequência a partir de padroes-globais.
// Filtros progressivos: timeId + faseJogo → só faseJogo → global
// ════════════════════════════════════════════════════════════════
exports.buscarTaxaSequencia = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
  try {
    const { faseJogo, localJogo, situacaoPlacar } = data;
    const timeId     = data.timeId     ? parseInt(data.timeId)     : null;
    const timeIdFora = data.timeIdFora ? parseInt(data.timeIdFora) : null;
    const db = admin.firestore();

    const querySeq = async (filtros, chave) => {
      let q = db.collection('padroes-globais').where('tipoEvento', '==', chave);
      if (filtros.timeId)         q = q.where('timeId',         '==', filtros.timeId);
      if (filtros.faseJogo)       q = q.where('faseJogo',       '==', filtros.faseJogo);
      if (filtros.localJogo)      q = q.where('localJogo',      '==', filtros.localJogo);
      if (filtros.situacaoPlacar) q = q.where('situacaoPlacar', '==', filtros.situacaoPlacar);
      const snap = await q.limit(500).get();
      return snap.docs.map(d => d.data());
    };

    const calcTaxa = (amostras) => {
      const n = amostras.length;
      if (!n) return null;
      const c5  = amostras.filter(p => p.golNos5  || p.golTimeNos5).length;
      const c10 = amostras.filter(p => p.golNos10 || p.golTimeNos10).length;
      const c15 = amostras.filter(p => p.golNos15 || p.golTimeNos15).length;
      return {
        n,
        pct5:  Math.round(c5  / n * 100),
        pct10: Math.round(c10 / n * 100),
        pct15: Math.round(c15 / n * 100),
        confianca: n >= 50 ? 'alta' : n >= 15 ? 'media' : 'baixa',
      };
    };

    const buscarParaSide = async (side, idTime) => {
      const chave = `sequencia_escanteio_${side}`;
      const filtroFull   = { timeId: idTime, faseJogo, localJogo, situacaoPlacar };
      const filtroFase   = { faseJogo, localJogo, situacaoPlacar };
      const filtroGlobal = {};

      let amostras = idTime ? await querySeq(filtroFull, chave) : [];
      let modo = 'completo';
      if (amostras.length < 10) { amostras = await querySeq(filtroFase, chave);  modo = 'sem_time'; }
      if (amostras.length < 5)  { amostras = await querySeq(filtroGlobal, chave); modo = 'global'; }

      return { ...calcTaxa(amostras), modo };
    };

    const [taxaCasa, taxaFora] = await Promise.all([
      buscarParaSide('casa', timeId),
      buscarParaSide('fora', timeIdFora || timeId),
    ]);

    // Taxa global de escanteio → gol (sem filtro de time)
    const globalAms = await querySeq({ faseJogo }, 'sequencia_escanteio_casa')
      .then(c => querySeq({ faseJogo }, 'sequencia_escanteio_fora').then(f => [...c, ...f]));
    const taxaGlobal = calcTaxa(globalAms);

    return {
      sucesso: true,
      taxaCasa,
      taxaFora,
      taxaGlobal,
    };
  } catch(e) {
    console.error('buscarTaxaSequencia:', e.message);
    throw new functions.https.HttpsError('internal', e.message);
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// 🏆 CAMPEONATOS & JOGADORES — Admin Dashboard
// ═══════════════════════════════════════════════════════════════════════════

// Mapa de ligas cobertas pelo sistema
const LIGAS_YELLUP = {
  brasil: [
    { id: 71,  nome: 'Brasileirão Série A', pais: 'Brasil', tier: 1, tipo: 'liga',  ajuste: 0 },
    { id: 72,  nome: 'Brasileirão Série B', pais: 'Brasil', tier: 2, tipo: 'liga',  ajuste: 0 },
    { id: 75,  nome: 'Brasileirão Série C', pais: 'Brasil', tier: 3, tipo: 'liga',  ajuste: 0 },
    { id: 73,  nome: 'Copa do Brasil',      pais: 'Brasil', tier: 2, tipo: 'copa',  ajuste: 0 },
    { id: 475, nome: 'Paulista A1',         pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 477, nome: 'Carioca',             pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 478, nome: 'Gaúcho',              pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 479, nome: 'Mineiro',             pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 480, nome: 'Baiano',              pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 481, nome: 'Paranaense',          pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 482, nome: 'Cearense',            pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 484, nome: 'Pernambucano',        pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 485, nome: 'Goiano',              pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
    { id: 486, nome: 'Capixaba',            pais: 'Brasil', tier: 3, tipo: 'copa',  ajuste: 0 },
  ],
  internacional: [
    { id: 2,   nome: 'Champions League',     pais: 'Europa',  tier: 1, tipo: 'misto', ajuste: -1 },
    { id: 3,   nome: 'Europa League',        pais: 'Europa',  tier: 1, tipo: 'misto', ajuste: -1 },
    { id: 848, nome: 'Conference League',    pais: 'Europa',  tier: 2, tipo: 'misto', ajuste: -1 },
    { id: 1,   nome: 'World Cup',            pais: 'Mundo',   tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 9,   nome: 'Copa América',         pais: 'América', tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 34,  nome: 'Eliminatórias CON.',   pais: 'América', tier: 1, tipo: 'liga',  ajuste: 0  },
    { id: 13,  nome: 'Copa Libertadores',    pais: 'América', tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 11,  nome: 'Copa Sudamericana',    pais: 'América', tier: 2, tipo: 'misto', ajuste: 0  },
    { id: 531, nome: 'UEFA Super Cup',       pais: 'Europa',  tier: 1, tipo: 'copa',  ajuste: -1 },
    { id: 32,  nome: 'Euro Championship',    pais: 'Europa',  tier: 1, tipo: 'misto', ajuste: -1 },
    { id: 20,  nome: 'UEFA Nations League',  pais: 'Europa',  tier: 2, tipo: 'misto', ajuste: -1 },
    { id: 29,  nome: 'Africa Cup of Nations',pais: 'África',  tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 17,  nome: 'AFC Asian Cup',        pais: 'Ásia',    tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 10,  nome: 'CONCACAF Gold Cup',    pais: 'CONCACAF',tier: 1, tipo: 'misto', ajuste: 0  },
    { id: 15,  nome: 'FIFA Club World Cup',  pais: 'Mundo',   tier: 1, tipo: 'copa',  ajuste: 0  },
  ],
  copas_nacionais: [
    { id: 45,  nome: 'FA Cup',              pais: 'Inglaterra', tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 48,  nome: 'Carabao Cup',         pais: 'Inglaterra', tier: 3, tipo: 'copa', ajuste: -1 },
    { id: 143, nome: 'Copa del Rey',        pais: 'Espanha',    tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 81,  nome: 'DFB-Pokal',           pais: 'Alemanha',   tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 137, nome: 'Coppa Italia',        pais: 'Itália',     tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 66,  nome: 'Coupe de France',     pais: 'França',     tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 64,  nome: 'Coupe de la Ligue',   pais: 'França',     tier: 3, tipo: 'copa', ajuste: -1 },
    { id: 102, nome: 'Taça de Portugal',    pais: 'Portugal',   tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 526, nome: 'Supercopa España',    pais: 'Espanha',    tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 528, nome: 'DFL Supercup',        pais: 'Alemanha',   tier: 2, tipo: 'copa', ajuste: -1 },
    { id: 530, nome: 'Supercoppa Italiana', pais: 'Itália',     tier: 2, tipo: 'copa', ajuste: -1 },
  ],
  americas: [
    { id: 128, nome: 'Primera División',    pais: 'Argentina', tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 131, nome: 'Copa Argentina',      pais: 'Argentina', tier: 2, tipo: 'copa', ajuste: 0 },
    { id: 262, nome: 'Liga MX',             pais: 'México',    tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 269, nome: 'Copa MX',             pais: 'México',    tier: 2, tipo: 'copa', ajuste: 0 },
    { id: 253, nome: 'MLS',                 pais: 'EUA',       tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 254, nome: 'US Open Cup',         pais: 'EUA',       tier: 2, tipo: 'copa', ajuste: 0 },
    { id: 239, nome: 'Liga BetPlay',        pais: 'Colômbia',  tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 265, nome: 'Primera División',    pais: 'Chile',     tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 268, nome: 'Liga 1',              pais: 'Peru',      tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 240, nome: 'Serie A',             pais: 'Equador',   tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 271, nome: 'Primera División',    pais: 'Uruguai',   tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 281, nome: 'Primera División',    pais: 'Paraguai',  tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 283, nome: 'División Profesional',pais: 'Bolívia',   tier: 1, tipo: 'liga', ajuste: 0 },
    { id: 105, nome: 'Primera División',    pais: 'Venezuela', tier: 1, tipo: 'liga', ajuste: 0 },
  ],
  europa_extra: [
    { id: 39,  nome: 'Premier League',      pais: 'Inglaterra', tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 140, nome: 'La Liga',             pais: 'Espanha',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 78,  nome: 'Bundesliga',          pais: 'Alemanha',   tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 135, nome: 'Serie A',             pais: 'Itália',     tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 61,  nome: 'Ligue 1',             pais: 'França',     tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 94,  nome: 'Primeira Liga',       pais: 'Portugal',   tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 88,  nome: 'Eredivisie',          pais: 'Holanda',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 169, nome: 'Süper Lig',           pais: 'Turquia',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 207, nome: 'Scottish Premiership',pais: 'Escócia',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 144, nome: 'Pro League',          pais: 'Bélgica',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 218, nome: 'Bundesliga',          pais: 'Áustria',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 197, nome: 'Super League',        pais: 'Grécia',     tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 119, nome: 'Superliga',           pais: 'Dinamarca',  tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 103, nome: 'Eliteserien',         pais: 'Noruega',    tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 113, nome: 'Allsvenskan',         pais: 'Suécia',     tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 244, nome: 'Veikkausliiga',       pais: 'Finlândia',  tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 235, nome: 'Premier Liga',        pais: 'Rússia',     tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 96,  nome: 'Ekstraklasa',         pais: 'Polônia',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 283, nome: 'Liga I',              pais: 'Romênia',    tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 345, nome: 'Czech Liga',          pais: 'Rep. Checa', tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 40,  nome: 'Championship',        pais: 'Inglaterra', tier: 2, tipo: 'liga', ajuste: -1 },
    { id: 141, nome: 'La Liga 2',           pais: 'Espanha',    tier: 2, tipo: 'liga', ajuste: -1 },
    { id: 79,  nome: '2. Bundesliga',       pais: 'Alemanha',   tier: 2, tipo: 'liga', ajuste: -1 },
    { id: 136, nome: 'Serie B',             pais: 'Itália',     tier: 2, tipo: 'liga', ajuste: -1 },
    { id: 62,  nome: 'Ligue 2',             pais: 'França',     tier: 2, tipo: 'liga', ajuste: -1 },
    { id: 165, nome: "Ligat Ha'al",         pais: 'Israel',     tier: 1, tipo: 'liga', ajuste: -1 },
  ],
  asia_oriente: [
    { id: 98,  nome: 'J1 League',           pais: 'Japão',    tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 292, nome: 'K League 1',          pais: 'Coreia',   tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 307, nome: 'Saudi Pro League',    pais: 'Arábia S.',tier: 1, tipo: 'liga', ajuste: -1 },
    { id: 30,  nome: 'AFC Champions',       pais: 'Ásia',     tier: 1, tipo: 'copa', ajuste: -1 },
    { id: 188, nome: 'Chinese Super League',pais: 'China',    tier: 1, tipo: 'liga', ajuste: 0  },
    { id: 323, nome: 'UAE Pro League',      pais: 'Emirados', tier: 1, tipo: 'liga', ajuste: -1 },
  ],
};

// ─── BUSCAR CLASSIFICAÇÃO ──────────────────────────────────────────────────
exports.buscarClassificacao = functions.runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data) => {
  const { leagueId, season } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `standings_${leagueId}_${season}`;
  const cacheRef = db.collection('cache-campeonatos').doc(cacheKey);

  // Cache: 10min se temporada ativa (ano atual), 6h se histórica
  try {
    const snap = await cacheRef.get();
    const anoAtual = new Date().getFullYear();
    const ativo = parseInt(season) >= anoAtual - 1;
    const ttl = ativo ? 10 * 60000 : 6 * 3600000;
    if (snap.exists && Date.now() - snap.data().ts < ttl) {
      return { sucesso: true, fonte: 'cache', dados: snap.data().dados };
    }
  } catch(e) {}

  const r = await apiFootballGet(`/standings?league=${leagueId}&season=${season}`);
  const grupos = (r.response?.[0]?.league?.standings || []).map(grupo =>
    grupo.map(t => ({
      rank: t.rank,
      time: { id: t.team.id, nome: t.team.name, logo: t.team.logo },
      pts: t.points,
      j: t.all.played, v: t.all.win, e: t.all.draw, d: t.all.lose,
      gp: t.all.goals.for, gc: t.all.goals.against, sg: t.all.goals.for - t.all.goals.against,
      casa: {
        j: t.home.played, v: t.home.win, e: t.home.draw, d: t.home.lose,
        gp: t.home.goals.for, gc: t.home.goals.against,
      },
      fora: {
        j: t.away.played, v: t.away.win, e: t.away.draw, d: t.away.lose,
        gp: t.away.goals.for, gc: t.away.goals.against,
      },
      forma: t.form,
      descricao: t.description,
      update: t.update,
    }))
  );

  await cacheRef.set({ ts: Date.now(), dados: grupos }).catch(() => {});

  // ── PERSISTIR SNAPSHOT HISTÓRICO ──────────────────────────────────────────
  // Salva um snapshot por rodada (detecta rodada pelo número de jogos do líder)
  // Coleção: snapshots-classificacao / {leagueId}_{season} / rodadas / {rodada}
  try {
    const anoAtualSnap = new Date().getFullYear();
    const ativoSnap = parseInt(season) >= anoAtualSnap - 1;
    if (ativoSnap && grupos.length > 0) {
      const lider = grupos[0][0]; // primeiro time do primeiro grupo
      const rodada = lider?.j || 0; // rodadas jogadas = rodada atual
      if (rodada > 0) {
        const snapKey = `${leagueId}_${season}`;
        const snapRef = db.collection('snapshots-classificacao')
          .doc(snapKey)
          .collection('rodadas')
          .doc(String(rodada));
        const snapExist = await snapRef.get();
        // Só salva se ainda não temos snapshot desta rodada
        if (!snapExist.exists) {
          const resumo = grupos[0].map(t => ({
            rank: t.rank, timeId: t.time.id, timeNome: t.time.nome, timeLogo: t.time.logo,
            pts: t.pts, j: t.j, gp: t.gp, gc: t.gc, sg: t.sg,
          }));
          await snapRef.set({ rodada, ts: Date.now(), leagueId, season, resumo });
        }
      }
    }
  } catch(e) { console.warn('snapshot classificacao:', e.message); }

  return { sucesso: true, fonte: 'api', dados: grupos };
});

// ─── BUSCAR JOGOS DO CAMPEONATO ────────────────────────────────────────────
exports.buscarJogosCampeonato = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onCall(async (data) => {
  const { leagueId, season, rodada, status, pagina = 1 } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `jogos_${leagueId}_${season}_r${rodada || 'all'}_${status || 'all'}_p${pagina}`;
  const cacheRef = db.collection('cache-campeonatos').doc(cacheKey);

  // Cache: 5min se temporada ativa, 6h se histórica
  try {
    const snap = await cacheRef.get();
    const anoAtual = new Date().getFullYear();
    const ativo = parseInt(season) >= anoAtual - 1;
    const ttl = ativo ? 5 * 60000 : 6 * 3600000;
    if (snap.exists && Date.now() - snap.data().ts < ttl) {
      return { sucesso: true, fonte: 'cache', ...snap.data() };
    }
  } catch(e) {}

  let endpoint = `/fixtures?league=${leagueId}&season=${season}`;
  if (rodada) endpoint += `&round=${encodeURIComponent(rodada)}`;
  if (status) endpoint += `&status=${status}`;

  const r = await apiFootballGet(endpoint);
  const todos = r.response || [];

  // Paginar 50 por página
  const POR_PAG = 50;
  const inicio = (pagina - 1) * POR_PAG;
  const fatia = todos.slice(inicio, inicio + POR_PAG);

  const jogos = fatia.map(f => ({
    id: f.fixture.id,
    data: f.fixture.date,
    status: { short: f.fixture.status.short, long: f.fixture.status.long, elapsed: f.fixture.status.elapsed },
    rodada: f.league.round,
    casa: { id: f.teams.home.id, nome: f.teams.home.name, logo: f.teams.home.logo, vencedor: f.teams.home.winner },
    fora: { id: f.teams.away.id, nome: f.teams.away.name, logo: f.teams.away.logo, vencedor: f.teams.away.winner },
    placar: { casa: f.goals.home, fora: f.goals.away },
    placarHT: { casa: f.score.halftime.home, fora: f.score.halftime.away },
    local: f.fixture.venue?.name,
    arbitro: f.fixture.referee,
  }));

  const result = { sucesso: true, fonte: 'api', jogos, total: todos.length, totalPags: Math.ceil(todos.length / POR_PAG) };
  await cacheRef.set({ ts: Date.now(), dados: jogos, total: todos.length, totalPags: result.totalPags }).catch(() => {});
  return result;
});

// ─── BUSCAR DETALHE DE UM JOGO HISTÓRICO ──────────────────────────────────
exports.buscarDetalheJogoCamp = functions.runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data) => {
  const { fixtureId } = data;
  if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
  const db = admin.firestore();
  const cacheKey = `detalhe_${fixtureId}`;
  const cacheRef = db.collection('cache-campeonatos').doc(cacheKey);

  // Cache: 5min se jogo recente (48h), 24h se antigo
  try {
    const snap = await cacheRef.get();
    const jogoTs = snap.exists && snap.data().jogoData ? new Date(snap.data().jogoData).getTime() : 0;
    const jogoRecente = jogoTs > Date.now() - 48 * 3600000;
    const ttl = jogoRecente ? 5 * 60000 : 24 * 3600000;
    if (snap.exists && Date.now() - snap.data().ts < ttl) {
      return { sucesso: true, fonte: 'cache', ...snap.data().dados };
    }
  } catch(e) {}

  const [statsR, eventsR, lineupsR] = await Promise.all([
    apiFootballGet(`/fixtures/statistics?fixture=${fixtureId}`),
    apiFootballGet(`/fixtures/events?fixture=${fixtureId}`),
    apiFootballGet(`/fixtures/lineups?fixture=${fixtureId}`),
  ]);

  const statsMap = {};
  (statsR.response || []).forEach(t => {
    statsMap[t.team.id] = {};
    (t.statistics || []).forEach(s => { statsMap[t.team.id][s.type] = s.value; });
  });

  const eventos = (eventsR.response || []).map(e => ({
    minuto: e.time.elapsed, extra: e.time.extra,
    time: { id: e.team.id, nome: e.team.name },
    jogador: { id: e.player.id, nome: e.player.name },
    assistente: e.assist?.name,
    tipo: e.type, detalhe: e.detail,
  }));

  const escalacoes = (lineupsR.response || []).map(l => ({
    time: { id: l.team.id, nome: l.team.name, logo: l.team.logo },
    formacao: l.formation,
    titulares: (l.startXI || []).map(p => ({ id: p.player.id, nome: p.player.name, numero: p.player.number, pos: p.player.pos, grade: p.player.grid })),
    reservas: (l.substitutes || []).map(p => ({ id: p.player.id, nome: p.player.name, numero: p.player.number })),
    tecnico: { nome: l.coach.name, foto: l.coach.photo },
  }));

  const dados = { statsMap, eventos, escalacoes };
  await cacheRef.set({ ts: Date.now(), dados }).catch(() => {});
  return { sucesso: true, fonte: 'api', statsMap, eventos, escalacoes };
});

// ─── BUSCAR RODADAS DE UMA LIGA ────────────────────────────────────────────
exports.buscarRodasLiga = functions.runWith({ timeoutSeconds: 20, memory: '128MB' })
  .https.onCall(async (data) => {
  const { leagueId, season } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `rodadas_${leagueId}_${season}`;
  const cacheRef = db.collection('cache-campeonatos').doc(cacheKey);
  try {
    const snap = await cacheRef.get();
    const anoAtual = new Date().getFullYear();
    const ativo = parseInt(season) >= anoAtual - 1;
    if (snap.exists && Date.now() - snap.data().ts < (ativo ? 3600000 : 24 * 3600000)) {
      return { sucesso: true, rodadas: snap.data().rodadas };
    }
  } catch(e) {}
  const r = await apiFootballGet(`/fixtures/rounds?league=${leagueId}&season=${season}`);
  const rodadas = r.response || [];
  await cacheRef.set({ ts: Date.now(), rodadas }).catch(() => {});
  return { sucesso: true, rodadas };
});

// ─── BUSCAR JOGADORES DE UMA LIGA (paginado) ──────────────────────────────
exports.buscarJogadoresLiga = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onCall(async (data) => {
  const { leagueId, season, pagina = 1 } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `jogadores_${leagueId}_${season}_p${pagina}`;
  const cacheRef = db.collection('cache-jogadores').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    if (snap.exists && Date.now() - snap.data().ts < 12 * 3600000) {
      return { sucesso: true, fonte: 'cache', jogadores: snap.data().jogadores, paginacao: snap.data().paginacao };
    }
  } catch(e) {}

  const r = await apiFootballGet(`/players?league=${leagueId}&season=${season}&page=${pagina}`);
  const jogadores = (r.response || []).map(item => {
    const p = item.player;
    const s = item.statistics?.[0] || {};
    return {
      id: p.id, nome: p.name, foto: p.photo,
      idade: p.age, nacionalidade: p.nationality,
      posicao: s.games?.position,
      time: { id: s.team?.id, nome: s.team?.name, logo: s.team?.logo },
      liga: { id: s.league?.id, nome: s.league?.name, logo: s.league?.logo },
      stats: {
        jogos: s.games?.appearences || 0,
        minutos: s.games?.minutes || 0,
        rating: parseFloat(s.games?.rating) || null,
        gols: s.goals?.total || 0,
        assistencias: s.goals?.assists || 0,
        passes: s.passes?.total || 0,
        passesChave: s.passes?.key || 0,
        precisaoPasses: s.passes?.accuracy || null,
        chutes: s.shots?.total || 0,
        chutesAlvo: s.shots?.on || 0,
        dribles: s.dribbles?.attempts || 0,
        driblesSuccess: s.dribbles?.success || 0,
        faltas: s.fouls?.committed || 0,
        amarelos: s.cards?.yellow || 0,
        vermelhos: s.cards?.red || 0,
        desarmes: s.tackles?.total || 0,
        interceptacoes: s.tackles?.interceptions || 0,
        penaltis: s.penalty?.scored || 0,
      }
    };
  });

  const paginacao = { atual: r.paging?.current || pagina, total: r.paging?.total || 1 };
  await cacheRef.set({ ts: Date.now(), jogadores, paginacao }).catch(() => {});
  return { sucesso: true, fonte: 'api', jogadores, paginacao };
});

// ─── BUSCAR RANKING TOP JOGADORES ─────────────────────────────────────────
exports.buscarRankingJogadores = functions.runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data) => {
  const { leagueId, season, tipo = 'topscorers' } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `ranking_${tipo}_${leagueId}_${season}`;
  const cacheRef = db.collection('cache-jogadores').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    const anoAtualR = new Date().getFullYear(); const ativoR = parseInt(season) >= anoAtualR-1;
    if (snap.exists && Date.now() - snap.data().ts < (ativoR ? 30*60000 : 3600000)) {
      return { sucesso: true, fonte: 'cache', jogadores: snap.data().jogadores };
    }
  } catch(e) {}

  // tipos: topscorers, topassists, topyellowcards, topredcards
  const endpoint = tipo === 'topscorers' ? `/players/topscorers?league=${leagueId}&season=${season}`
    : tipo === 'topassists' ? `/players/topassists?league=${leagueId}&season=${season}`
    : tipo === 'topyellowcards' ? `/players/topyellowcards?league=${leagueId}&season=${season}`
    : `/players/topredcards?league=${leagueId}&season=${season}`;

  const r = await apiFootballGet(endpoint);
  const jogadores = (r.response || []).map((item, i) => {
    const p = item.player; const s = item.statistics?.[0] || {};
    return {
      rank: i + 1, id: p.id, nome: p.name, foto: p.photo,
      idade: p.age, nacionalidade: p.nationality,
      posicao: s.games?.position,
      time: { id: s.team?.id, nome: s.team?.name, logo: s.team?.logo },
      stats: {
        jogos: s.games?.appearences || 0, minutos: s.games?.minutes || 0,
        rating: parseFloat(s.games?.rating) || null,
        gols: s.goals?.total || 0, assistencias: s.goals?.assists || 0,
        passes: s.passes?.total || 0, passesChave: s.passes?.key || 0,
        chutes: s.shots?.total || 0, chutesAlvo: s.shots?.on || 0,
        amarelos: s.cards?.yellow || 0, vermelhos: s.cards?.red || 0,
        desarmes: s.tackles?.total || 0,
      }
    };
  });

  await cacheRef.set({ ts: Date.now(), jogadores }).catch(() => {});
  return { sucesso: true, fonte: 'api', jogadores };
});

// ─── BUSCAR PERFIL COMPLETO DO JOGADOR ────────────────────────────────────
exports.buscarPerfilJogadorAdmin = functions.runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data) => {
  const { playerId, season } = data;
  if (!playerId || !season) throw new functions.https.HttpsError('invalid-argument', 'playerId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `perfil_${playerId}_${season}`;
  const cacheRef = db.collection('cache-jogadores').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    if (snap.exists && Date.now() - snap.data().ts < 12 * 3600000) {
      return { sucesso: true, fonte: 'cache', ...snap.data().dados };
    }
  } catch(e) {}

  const r = await apiFootballGet(`/players?id=${playerId}&season=${season}`);
  const item = r.response?.[0];
  if (!item) throw new functions.https.HttpsError('not-found', 'Jogador não encontrado');

  const p = item.player;
  const todosStats = item.statistics || [];

  // Médias calculadas por minuto/jogo
  const calcMedias = (s) => {
    const min = s.games?.minutes || 1;
    const j = s.games?.appearences || 1;
    return {
      golsPorJogo: (s.goals?.total || 0) / j,
      golsPorMin: (s.goals?.total || 0) / min,
      assistPorJogo: (s.goals?.assists || 0) / j,
      chutesPorJogo: (s.shots?.total || 0) / j,
      chutesAlvoPorJogo: (s.shots?.on || 0) / j,
      passesPorJogo: (s.passes?.total || 0) / j,
      passesPorMin: (s.passes?.total || 0) / min,
      passesChavePorJogo: (s.passes?.key || 0) / j,
      desarmePorJogo: (s.tackles?.total || 0) / j,
      driblesPorJogo: (s.dribbles?.attempts || 0) / j,
    };
  };

  const stats = todosStats.map(s => ({
    liga: { id: s.league.id, nome: s.league.name, logo: s.league.logo, pais: s.league.country, temporada: s.league.season },
    time: { id: s.team.id, nome: s.team.name, logo: s.team.logo },
    jogos: s.games?.appearences, minutos: s.games?.minutes, rating: parseFloat(s.games?.rating) || null,
    titular: s.games?.lineups, gols: s.goals?.total, assistencias: s.goals?.assists,
    passes: s.passes?.total, passesChave: s.passes?.key, precisaoPasses: s.passes?.accuracy,
    chutes: s.shots?.total, chutesAlvo: s.shots?.on,
    dribles: s.dribbles?.attempts, driblesSuccess: s.dribbles?.success,
    desarmes: s.tackles?.total, interceptacoes: s.tackles?.interceptions,
    faltas: s.fouls?.committed, sofreu: s.fouls?.drawn,
    amarelos: s.cards?.yellow, vermelhos: s.cards?.red,
    penaltis: s.penalty?.scored, penaltisMissed: s.penalty?.missed,
    medias: calcMedias(s),
  }));

  const jogador = {
    id: p.id, nome: p.name, foto: p.photo, altura: p.height, peso: p.weight,
    nascimento: p.birth?.date, pais: p.birth?.country,
    nacionalidade: p.nationality, lesionado: p.injured,
  };

  const dados = { jogador, stats };
  await cacheRef.set({ ts: Date.now(), dados }).catch(() => {});
  return { sucesso: true, fonte: 'api', jogador, stats };
});

// ─── LISTAR LIGAS YELLUP ───────────────────────────────────────────────────
exports.buscarLigasYellup = functions.https.onCall(async () => {
  return { sucesso: true, ligas: LIGAS_YELLUP };
});

// ─── BUSCAR CHAVEAMENTO / BRACKET ─────────────────────────────────────────
exports.buscarChaveamento = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onCall(async (data) => {
  const { leagueId, season } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `chaveamento_${leagueId}_${season}`;
  const cacheRef = db.collection('cache-campeonatos').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    const anoAtualC = new Date().getFullYear(); const ativoC = parseInt(season) >= anoAtualC-1;
    const ttlC = ativoC ? 10 * 60000 : 3 * 3600000;
    if (snap.exists && Date.now() - snap.data().ts < ttlC) {
      return { sucesso: true, fonte: 'cache', ...snap.data().dados };
    }
  } catch(e) {}

  const r = await apiFootballGet(`/fixtures?league=${leagueId}&season=${season}`);
  const todos = r.response || [];

  // Ordenação de rounds conhecidos
  const ORDEM_ROUNDS = [
    'preliminary round','qualifying','1st round','2nd round','3rd round','4th round',
    'round of 64','round of 32','round of 16','round of 16 - first leg','round of 16 - second leg',
    '8th finals','quarter-finals','quarter-finals - first leg','quarter-finals - second leg',
    'semi-finals','semi-finals - first leg','semi-finals - second leg',
    '3rd place final','final'
  ];

  const ordemIdx = (rd) => {
    const rl = rd.toLowerCase();
    const idx = ORDEM_ROUNDS.findIndex(o => rl.includes(o.split(' - ')[0]));
    return idx === -1 ? 50 : idx;
  };

  // Agrupar todos os rounds
  const porRound = {};
  todos.forEach(f => {
    const rd = f.league.round || 'Sem rodada';
    if (!porRound[rd]) porRound[rd] = [];
    porRound[rd].push({
      id: f.fixture.id,
      data: f.fixture.date,
      status: { short: f.fixture.status.short, elapsed: f.fixture.status.elapsed },
      casa: { id: f.teams.home.id, nome: f.teams.home.name, logo: f.teams.home.logo, vencedor: f.teams.home.winner },
      fora: { id: f.teams.away.id, nome: f.teams.away.name, logo: f.teams.away.logo, vencedor: f.teams.away.winner },
      placar: { casa: f.goals.home, fora: f.goals.away },
      placarHT: { casa: f.score.halftime.home, fora: f.score.halftime.away },
      placarPen: { casa: f.score.penalty.home, fora: f.score.penalty.away },
      local: f.fixture.venue?.name,
    });
  });

  // Detectar se tem fase de grupos
  const roundNames = Object.keys(porRound);
  const temGrupos = roundNames.some(r => /group|grupo|fase de grupos/i.test(r));
  const temKnockout = roundNames.some(r => /final|semi|quarter|round of|oitav/i.test(r));

  // Fases de grupo separadas
  const grupos = {};
  const knockout = {};
  roundNames.forEach(rd => {
    if (/group|grupo|fase de grupos/i.test(rd)) {
      grupos[rd] = porRound[rd];
    } else {
      knockout[rd] = porRound[rd];
    }
  });

  // Ordenar rounds de knockout
  const knockoutOrdenado = Object.entries(knockout)
    .sort(([a], [b]) => ordemIdx(a) - ordemIdx(b))
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  const dados = { porRound: porRound, grupos, knockout: knockoutOrdenado, temGrupos, temKnockout, totalJogos: todos.length };
  await cacheRef.set({ ts: Date.now(), dados }).catch(() => {});
  return { sucesso: true, fonte: 'api', ...dados };
});

// ─── HELPER: buscar todos jogadores de uma liga (todas as páginas) ────────
// Busca TODAS as páginas de uma liga (para buscarMelhoresNotasLiga — uma única liga)
async function fetchAllPlayersLiga(leagueId, season) {
  const primeira = await apiFootballGet(`/players?league=${leagueId}&season=${season}&page=1`);
  const totalPags = primeira.paging?.total || 1;
  let todos = primeira.response || [];

  if (totalPags > 1) {
    const pags = Array.from({ length: Math.min(totalPags - 1, 9) }, (_, i) => i + 2);
    const extras = await Promise.all(
      pags.map(p => apiFootballGet(`/players?league=${leagueId}&season=${season}&page=${p}`).catch(() => ({ response: [] })))
    );
    extras.forEach(r => { todos = todos.concat(r.response || []); });
  }
  return todos;
}

// Busca apenas as primeiras 2 páginas de uma liga (para buscarMelhoresNotasMundo — múltiplas ligas)
async function fetchTopPlayersLiga(leagueId, season) {
  const [p1, p2] = await Promise.all([
    apiFootballGet(`/players?league=${leagueId}&season=${season}&page=1`).catch(() => ({ response: [] })),
    apiFootballGet(`/players?league=${leagueId}&season=${season}&page=2`).catch(() => ({ response: [] })),
  ]);
  return [...(p1.response || []), ...(p2.response || [])];
}


// Nota ponderada: penaliza jogadores com poucos jogos
function ratingPonderadoCF(rating, jogos) {
  if (!rating || !jogos) return 0;
  const conf = Math.min(1, Math.log10(jogos + 1) / Math.log10(21));
  return parseFloat(rating) * (0.4 + 0.6 * conf);
}

function mapJogador(item) {
  const p = item.player; const s = item.statistics?.[0] || {};
  return {
    id: p.id, nome: p.name, foto: p.photo,
    idade: p.age, nacionalidade: p.nationality,
    posicao: s.games?.position,
    time: { id: s.team?.id, nome: s.team?.name, logo: s.team?.logo },
    liga: { id: s.league?.id, nome: s.league?.name, logo: s.league?.logo },
    stats: {
      jogos: s.games?.appearences || 0, minutos: s.games?.minutes || 0,
      rating: parseFloat(s.games?.rating) || 0,
      gols: s.goals?.total || 0, assistencias: s.goals?.assists || 0,
      passes: s.passes?.total || 0, passesChave: s.passes?.key || 0,
      precisaoPasses: s.passes?.accuracy || null,
      chutes: s.shots?.total || 0, chutesAlvo: s.shots?.on || 0,
      dribles: s.dribbles?.attempts || 0, driblesSuccess: s.dribbles?.success || 0,
      faltas: s.fouls?.committed || 0, amarelos: s.cards?.yellow || 0,
      vermelhos: s.cards?.red || 0, desarmes: s.tackles?.total || 0,
      interceptacoes: s.tackles?.interceptions || 0, penaltis: s.penalty?.scored || 0,
    }
  };
}

// ─── BUSCAR MELHORES NOTAS DE UMA LIGA (busca tudo, ordena por rating) ───
exports.buscarMelhoresNotasLiga = functions.runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data) => {
  const { leagueId, season } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const cacheKey = `melhores_${leagueId}_${season}`;
  const cacheRef = db.collection('cache-jogadores').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    const anoAtual = new Date().getFullYear();
    const ativo = parseInt(season) >= anoAtual - 1;
    if (snap.exists && Date.now() - snap.data().ts < (ativo ? 30 * 60000 : 6 * 3600000)) {
      return { sucesso: true, fonte: 'cache', jogadores: snap.data().jogadores };
    }
  } catch(e) {}

  const todos = await fetchAllPlayersLiga(leagueId, season);

  // Mapear, filtrar quem tem rating e pelo menos 3 jogos, ordenar por nota
  const jogadores = todos
    .map(mapJogador)
    .filter(j => j.stats.rating > 0 && j.stats.jogos >= 1)
    .sort((a, b) => ratingPonderadoCF(b.stats.rating, b.stats.jogos) - ratingPonderadoCF(a.stats.rating, a.stats.jogos))
    .slice(0, 100); // top 100

  await cacheRef.set({ ts: Date.now(), jogadores }).catch(() => {});
  return { sucesso: true, fonte: 'api', jogadores };
});

// ─── BUSCAR MELHORES NOTAS DO MUNDO (agrega top ligas) ───────────────────
exports.buscarMelhoresNotasMundo = functions.runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data) => {
  // season = ano de referência do USUÁRIO (ex: 2026 = temporada 25/26 para ligas europeias)
  const { season, scope = 'mundo' } = data;
  if (!season) throw new functions.https.HttpsError('invalid-argument', 'season obrigatório');
  const db = admin.firestore();
  const cacheKey = `melhores_mundo_${scope}_${season}`;
  const cacheRef = db.collection('cache-jogadores').doc(cacheKey);

  try {
    const snap = await cacheRef.get();
    const anoAtual = new Date().getFullYear();
    const ativo = parseInt(season) >= anoAtual - 1;
    if (snap.exists && Date.now() - snap.data().ts < (ativo ? 60 * 60000 : 12 * 3600000)) {
      return { sucesso: true, fonte: 'cache', jogadores: snap.data().jogadores };
    }
  } catch(e) {}

  // Ligas por scope com ajuste de temporada correto para cada liga
  // ajuste: 0 = calendário por ano (Brasil, Américas, Japão...)
  //         -1 = temporada ago-maio (Europa, Champions, Saudi...)
  const LIGAS_SCOPE = {
    brasil:   [
      { id: 71, ajuste: 0 }, { id: 72, ajuste: 0 }, { id: 73, ajuste: 0 },
    ],
    europa:   [
      { id: 39, ajuste: -1 }, { id: 140, ajuste: -1 }, { id: 78, ajuste: -1 },
      { id: 135, ajuste: -1 }, { id: 61, ajuste: -1 }, { id: 94, ajuste: -1 },
      { id: 88, ajuste: -1 }, { id: 2, ajuste: -1 }, { id: 3, ajuste: -1 },
      { id: 848, ajuste: -1 },
    ],
    americas: [
      { id: 71, ajuste: 0 }, { id: 128, ajuste: 0 }, { id: 262, ajuste: 0 },
      { id: 253, ajuste: 0 }, { id: 239, ajuste: 0 }, { id: 13, ajuste: 0 },
      { id: 11, ajuste: 0 },
    ],
    mundo:    [
      { id: 39, ajuste: -1 }, { id: 140, ajuste: -1 }, { id: 78, ajuste: -1 },
      { id: 135, ajuste: -1 }, { id: 61, ajuste: -1 }, { id: 71, ajuste: 0  },
      { id: 94, ajuste: -1 }, { id: 88, ajuste: -1 }, { id: 128, ajuste: 0  },
      { id: 262, ajuste: 0  }, { id: 253, ajuste: 0  }, { id: 2, ajuste: -1 },
      { id: 3, ajuste: -1 }, { id: 307, ajuste: -1 }, { id: 98, ajuste: 0  },
    ],
  };
  const ligas = LIGAS_SCOPE[scope] || LIGAS_SCOPE.mundo;

  // Buscar cada liga com a season correta para aquele calendário
  const todos = [];
  const ano = parseInt(season);
  for (let i = 0; i < ligas.length; i += 4) {
    const batch = ligas.slice(i, i + 4);
    const resultados = await Promise.all(
      batch.map(({ id, ajuste }) => {
        const apiSeason = String(ano + (ajuste || 0));
        return fetchTopPlayersLiga(id, apiSeason).catch(() => []);
      })
    );
    resultados.forEach(r => todos.push(...r));
    if (i + 4 < ligas.length) await new Promise(r => setTimeout(r, 500));
  }

  const jogadores = todos
    .map(mapJogador)
    .filter(j => j.stats.rating > 0 && j.stats.jogos >= 1)
    .sort((a, b) => ratingPonderadoCF(b.stats.rating, b.stats.jogos) - ratingPonderadoCF(a.stats.rating, a.stats.jogos))
    // Remover duplicatas (mesmo jogador pode aparecer em duas ligas)
    .filter((j, idx, arr) => idx === arr.findIndex(x => x.id === j.id))
    .slice(0, 200);

  await cacheRef.set({ ts: Date.now(), jogadores }).catch(() => {});
  return { sucesso: true, fonte: 'api', jogadores };
});

// ─── BUSCAR HISTÓRICO DE CLASSIFICAÇÃO (evolução por rodada) ──────────────
exports.buscarHistoricoClassificacao = functions.runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data) => {
  const { leagueId, season } = data;
  if (!leagueId || !season) throw new functions.https.HttpsError('invalid-argument', 'leagueId e season obrigatórios');
  const db = admin.firestore();
  const snapKey = `${leagueId}_${season}`;
  const rodadasSnap = await db.collection('snapshots-classificacao')
    .doc(snapKey)
    .collection('rodadas')
    .orderBy('rodada', 'asc')
    .get();

  if (rodadasSnap.empty) return { sucesso: true, rodadas: [] };

  const rodadas = rodadasSnap.docs.map(d => ({
    rodada: d.data().rodada,
    ts: d.data().ts,
    resumo: d.data().resumo || [],
  }));

  return { sucesso: true, rodadas };
});

// ─── DIAGNÓSTICO DE ODDS (admin only) ───────────────────────────────────────
// Testa as 3 fontes de odds para um fixture e retorna status detalhado
exports.diagnosticarOdds = functions.runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data) => {
  const { fixtureId, nomeCasa, nomeFora } = data;
  const fxId = parseInt(fixtureId);
  const resultado = { fixtureId: fxId, ts: new Date().toISOString(), fontes: {} };

  // 1. odds-api.io
  if (ODDS_API_IO_KEY) {
    try {
      const r = await buscarOddsApiIo(nomeCasa || '', nomeFora || '', fxId);
      resultado.fontes.oddsApiIo = r
        ? { ok: true, bookmaker: r.bookmaker, casa: r.casa, empate: r.empate, fora: r.fora, matchScore: r.matchScore }
        : { ok: false, motivo: 'Nenhum evento encontrado (fuzzy match < 0.35)' };
    } catch(e) { resultado.fontes.oddsApiIo = { ok: false, motivo: e.message }; }
  } else {
    resultado.fontes.oddsApiIo = { ok: false, motivo: 'ODDS_API_IO_KEY não configurada' };
  }

  // 2. API-Football /odds/live
  try {
    const r = await apiFootballGet(`/odds/live?fixture=${fxId}`);
    resultado.fontes.apifootballLive = {
      results: r.results,
      bookmakers: r.response?.[0]?.bookmakers?.map(b => b.name) || [],
      planoNote: r.results === 0 ? 'Possível plano Free (requer Basic+ para odds ao vivo)' : null,
    };
  } catch(e) { resultado.fontes.apifootballLive = { ok: false, motivo: e.message }; }

  // 3. API-Football /odds (pré-jogo)
  try {
    const r = await apiFootballGet(`/odds?fixture=${fxId}&bookmaker=6`);
    const bk = r.response?.[0]?.bookmakers?.[0];
    resultado.fontes.preJogo = {
      results: r.results,
      bookmaker: bk?.name || null,
      temMW: !!bk?.bets?.find(b => b.name === 'Match Winner' || b.id === 1),
    };
  } catch(e) { resultado.fontes.preJogo = { ok: false, motivo: e.message }; }

  return resultado;
});

// =====================================================
// 🧠 YELLUP LEARNING SYSTEM
// =====================================================

// ── 1. SALVAR PREVISÃO PRÉ-JOGO ──────────────────────────────────────────
exports.salvarPrevisao = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const { fixtureId, timeCasaId, timeForaId, timeCasaNome, timeForaNome,
            liga, dataJogo, previsao } = data;

    if (!fixtureId || !previsao) throw new functions.https.HttpsError('invalid-argument', 'fixtureId e previsao obrigatórios');

    const ref = db.collection('previsoes-historico').doc(String(fixtureId));
    const existing = await ref.get();

    // Não sobrescrever se já tem resultado real
    if (existing.exists && existing.data().resultadoReal) {
      return { sucesso: true, msg: 'Jogo já tem resultado — previsão não sobrescrita' };
    }

    await ref.set({
      fixtureId: String(fixtureId),
      timeCasaId: String(timeCasaId || ''),
      timeForaId: String(timeForaId || ''),
      timeCasaNome: timeCasaNome || '',
      timeForaNome: timeForaNome || '',
      liga: liga || '',
      dataJogo: dataJogo || null,
      savedAt: admin.firestore.FieldValue.serverTimestamp(),

      // Previsão
      probCasa:   previsao.probCasa,
      probEmpate: previsao.probEmpate,
      probFora:   previsao.probFora,
      veredito:   previsao.veredito,   // 'casa'|'empate'|'fora'
      golsEstimado: previsao.golsEstimado,
      golsRange:    previsao.golsRange,
      confianca:    previsao.confianca,

      // Inputs que geraram a previsão (para análise de desvio)
      ysC:      previsao.ysC || null,
      ysF:      previsao.ysF || null,
      forcaC:   previsao.forcaC || null,
      forcaF:   previsao.forcaF || null,
      pesos:    previsao.pesos || null,    // { ys, histCasa, histFora, h2h, banco, global }
      fontes:   previsao.fontes || [],

      // Resultado ainda desconhecido
      resultadoReal: null,
      golsReais: null,
      analisado: false,
    }, { merge: false });

    return { sucesso: true };
  });

// ── 2. ANALISAR DESVIO PÓS-JOGO ──────────────────────────────────────────
exports.analisarDesvioPos = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');
    const { fixtureId } = data;
    if (!fixtureId) throw new functions.https.HttpsError('invalid-argument', 'fixtureId obrigatório');
    return await _analisarDesvio(String(fixtureId));
  });

// ── 3. SCHEDULE: analisar jogos encerrados automaticamente ───────────────
exports.scheduleAnalisarDesvios = functions.pubsub
  .schedule('every 60 minutes')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    // Buscar previsões sem análise cujo jogo já encerrou
    const snap = await db.collection('previsoes-historico')
      .where('analisado', '==', false)
      .where('resultadoReal', '==', null)
      .limit(20)
      .get();

    if (snap.empty) return null;

    // Checar quais já encerraram no Firestore
    let processados = 0;
    for (const doc of snap.docs) {
      const fxId = doc.id;
      let jogoSnap = await db.collection('jogos-admin')
        .where('apiFootballId', '==', parseInt(fxId))
        .limit(1).get();
      if (jogoSnap.empty) {
        jogoSnap = await db.collection('jogos-admin')
          .where('apiFixtureId', '==', parseInt(fxId))
          .limit(1).get();
      }
      if (jogoSnap.empty) {
        const d = await db.collection('jogos-admin').doc(fxId).get();
        if (d.exists) jogoSnap = { empty: false, docs: [d] };
      }

      if (jogoSnap.empty) continue;
      const jogo = jogoSnap.docs[0].data();
      if (jogo.status !== 'encerrado') continue;

      try {
        await _analisarDesvio(fxId);
        processados++;
      } catch(e) {
        console.error('Erro analisarDesvio', fxId, e.message);
      }
    }

    console.log(`✅ Desvios analisados: ${processados}`);
    return null;
  });

// ── LÓGICA CENTRAL DE ANÁLISE DE DESVIO ──────────────────────────────────
async function _analisarDesvio(fixtureId) {
  const prevRef = db.collection('previsoes-historico').doc(fixtureId);
  const prevSnap = await prevRef.get();
  if (!prevSnap.exists) return { sucesso: false, msg: 'Previsão não encontrada' };

  const prev = prevSnap.data();
  if (prev.analisado) return { sucesso: true, msg: 'Já analisado' };

  // Buscar resultado real com fallback para múltiplos campos
  let jogoSnap = await db.collection('jogos-admin')
    .where('apiFootballId', '==', parseInt(fixtureId))
    .limit(1).get();
  if (jogoSnap.empty) {
    jogoSnap = await db.collection('jogos-admin')
      .where('apiFixtureId', '==', parseInt(fixtureId))
      .limit(1).get();
  }
  if (jogoSnap.empty) {
    const directDoc = await db.collection('jogos-admin').doc(String(fixtureId)).get();
    if (directDoc.exists) jogoSnap = { empty: false, docs: [directDoc] };
  }

  // Fallback 1: resultado já salvo no próprio doc (backfill massivo)
  let golsCasa, golsFora;
  if (jogoSnap.empty) {
    if (prev.placarCasa !== undefined && prev.placarFora !== undefined) {
      golsCasa = prev.placarCasa;
      golsFora = prev.placarFora;
    } else {
      // Fallback 2: buscar na API
      try {
        const apiR = await apiFootballGet(`/fixtures?id=${fixtureId}`);
        const apiFix = apiR?.response?.[0];
        if (!apiFix) return { sucesso: false, msg: 'Jogo não encontrado (API)' };
        const st = apiFix.fixture?.status?.short;
        if (!['FT','AET','PEN'].includes(st)) return { sucesso: false, msg: 'Jogo não encerrado na API' };
        golsCasa = apiFix.goals?.home ?? 0;
        golsFora = apiFix.goals?.away ?? 0;
      } catch(e) {
        return { sucesso: false, msg: 'Erro ao buscar resultado na API: ' + e.message };
      }
    }
  } else {
    const jogo = jogoSnap.docs[0].data();
    if (jogo.status !== 'encerrado') return { sucesso: false, msg: 'Jogo não encerrado' };
    golsCasa = jogo.placarCasa ?? jogo.placar?.casa ?? 0;
    golsFora = jogo.placarFora ?? jogo.placar?.fora ?? 0;
  }
  const golsTotal = golsCasa + golsFora;

  const resultadoReal = golsCasa > golsFora ? 'casa'
    : golsFora > golsCasa ? 'fora' : 'empate';

  // Probabilidade que demos para o resultado real
  const probDadaAoReal = resultadoReal === 'casa' ? prev.probCasa
    : resultadoReal === 'fora' ? prev.probFora : prev.probEmpate;

  // Acertou veredito?
  const acertouResultado = prev.veredito === resultadoReal;

  // Desvio de gols
  const golsEst = parseFloat(prev.golsEstimado) || 0;
  const desvioGols = +(golsTotal - golsEst).toFixed(2);
  const acertouGols = Math.abs(desvioGols) <= 1.0; // margem de 1 gol

  // Buscar stats reais do jogo para análise de fatores
  let statsReais = null;
  try {
    const statsR = await apiFootballGet(`/fixtures/statistics?fixture=${fixtureId}`);
    const prevData = prevSnap.data();
    const casaStats = statsR.response?.find(t => String(t.team.id) === String(prevData.timeCasaId));
    const foraStats = statsR.response?.find(t => String(t.team.id) === String(prevData.timeForaId));
    const getStat = (obj, key) => {
      const v = obj?.statistics?.find(s => s.type === key)?.value;
      return v !== null && v !== undefined ? parseFloat(String(v).replace('%','')) : null;
    };
    statsReais = {
      posseCasa: getStat(casaStats, 'Ball Possession'),
      posseFora: getStat(foraStats, 'Ball Possession'),
      xgCasa:    getStat(casaStats, 'expected_goals'),
      xgFora:    getStat(foraStats, 'expected_goals'),
      chutesAlvoCasa: getStat(casaStats, 'Shots on Goal'),
      chutesAlvoFora: getStat(foraStats, 'Shots on Goal'),
      chutesTotalCasa: getStat(casaStats, 'Total Shots'),
      chutesTotalFora: getStat(foraStats, 'Total Shots'),
    };
  } catch(e) { /* stats opcionais */ }

  // ── ANÁLISE DE FATORES ─────────────────────────────────────────────────
  const fatores = [];

  // Fator 1: YS enganou?
  if (prev.ysC !== null && prev.ysF !== null) {
    const diffYS = prev.ysC - prev.ysF;
    const favoreceu = diffYS > 1 ? 'casa' : diffYS < -1 ? 'fora' : 'equilibrado';
    if (favoreceu !== 'equilibrado' && favoreceu !== resultadoReal) {
      fatores.push({
        tipo: 'yellup_score',
        descricao: `YS favorecia ${favoreceu} (${prev.ysC?.toFixed(1)} vs ${prev.ysF?.toFixed(1)}) mas ${resultadoReal} venceu`,
        impacto: 'alto',
        lado: favoreceu
      });
    }
  }

  // Fator 2: xG real divergiu do histórico?
  if (statsReais?.xgCasa !== null && statsReais?.xgFora !== null) {
    const xgVencedor = resultadoReal === 'casa' ? statsReais.xgCasa : statsReais.xgFora;
    const xgPerdedor = resultadoReal === 'casa' ? statsReais.xgFora : statsReais.xgCasa;
    if (xgVencedor !== null && xgPerdedor !== null) {
      if (xgVencedor < xgPerdedor * 0.7) {
        fatores.push({
          tipo: 'xg_contra_resultado',
          descricao: `${resultadoReal} venceu com xG inferior (${xgVencedor?.toFixed(2)} vs ${xgPerdedor?.toFixed(2)}) — resultado improvável`,
          impacto: 'alto',
          dado: { xgVencedor, xgPerdedor }
        });
      }
    }
  }

  // Fator 3: gols muito acima do estimado
  if (desvioGols > 1.5) {
    fatores.push({
      tipo: 'gols_acima',
      descricao: `Gols reais (${golsTotal}) muito acima do estimado (${golsEst}) — defesas mais frágeis que o histórico indicava`,
      impacto: Math.abs(desvioGols) > 2.5 ? 'alto' : 'medio',
      dado: { golsReais: golsTotal, golsEst, desvio: desvioGols }
    });
  } else if (desvioGols < -1.5) {
    fatores.push({
      tipo: 'gols_abaixo',
      descricao: `Gols reais (${golsTotal}) muito abaixo do estimado (${golsEst}) — jogo mais fechado que o esperado`,
      impacto: Math.abs(desvioGols) > 2.5 ? 'alto' : 'medio',
      dado: { golsReais: golsTotal, golsEst, desvio: desvioGols }
    });
  }

  // Fator 4: posse enganou?
  if (statsReais?.posseCasa !== null) {
    const posseDom = statsReais.posseCasa > 60 ? 'casa' : statsReais.posseCasa < 40 ? 'fora' : 'equilibrado';
    if (posseDom !== 'equilibrado' && posseDom !== resultadoReal && resultadoReal !== 'empate') {
      fatores.push({
        tipo: 'posse_sem_eficiencia',
        descricao: `${posseDom} dominou a posse (${statsReais.posseCasa}%) mas não venceu — fator posse superestimado`,
        impacto: 'medio',
        dado: { posseCasa: statsReais.posseCasa }
      });
    }
  }

  // Fator 5: probabilidade dada ao resultado real foi baixa?
  if (probDadaAoReal < 25 && acertouResultado === false) {
    fatores.push({
      tipo: 'baixa_confianca_correta',
      descricao: `Demos apenas ${probDadaAoReal}% para ${resultadoReal} — resultado de baixa probabilidade aconteceu`,
      impacto: 'medio',
      dado: { probDada: probDadaAoReal }
    });
  }

  // ── SALVAR ANÁLISE ─────────────────────────────────────────────────────
  await prevRef.update({
    resultadoReal,
    golsReais: golsTotal,
    golsCasaReal: golsCasa,
    golsForaReal: golsFora,
    desvioGols,
    acertouResultado,
    acertouGols,
    probDadaAoReal,
    statsReais: statsReais || null,
    fatores,
    analisado: true,
    analisadoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── ATUALIZAR BANCO DE APRENDIZADO POR LIGA ────────────────────────────
  if (prev.liga) {
    await _atualizarAprendizadoLiga(prev.liga, {
      acertouResultado,
      acertouGols,
      confianca: prev.confianca,
      fatores,
      desvioGols,
      probDadaAoReal,
    });
  }

  return {
    sucesso: true,
    fixtureId,
    resultadoReal,
    golsReais: golsTotal,
    acertouResultado,
    acertouGols,
    desvioGols,
    fatores: fatores.length,
  };
}

// ── ATUALIZAR BANCO DE APRENDIZADO ────────────────────────────────────────
async function _atualizarAprendizadoLiga(liga, dados) {
  const ref = db.collection('yellup-aprendizado').doc(
    liga.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)
  );

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const base = snap.exists ? snap.data() : {
      liga,
      totalJogos: 0,
      acertosResultado: 0,
      acertosGols: 0,
      desvioGolsAcum: 0,
      fatorFreq: {},       // { tipo: count }
      fatorImpacto: {},    // { tipo: totalImpacto }
      porConfianca: { alta: { total:0,acertos:0 }, media: { total:0,acertos:0 }, baixa: { total:0,acertos:0 }, insuficiente: { total:0,acertos:0 } },
      ultimaAtualizacao: null,
    };

    base.totalJogos++;
    if (dados.acertouResultado) base.acertosResultado++;
    if (dados.acertouGols)      base.acertosGols++;
    base.desvioGolsAcum = (base.desvioGolsAcum || 0) + dados.desvioGols;

    // Frequência de fatores de erro
    for (const f of (dados.fatores || [])) {
      base.fatorFreq[f.tipo] = (base.fatorFreq[f.tipo] || 0) + 1;
      const imp = f.impacto === 'alto' ? 3 : f.impacto === 'medio' ? 2 : 1;
      base.fatorImpacto[f.tipo] = (base.fatorImpacto[f.tipo] || 0) + imp;
    }

    // Por nível de confiança
    const conf = dados.confianca || 'insuficiente';
    if (!base.porConfianca[conf]) base.porConfianca[conf] = { total:0, acertos:0 };
    base.porConfianca[conf].total++;
    if (dados.acertouResultado) base.porConfianca[conf].acertos++;

    base.ultimaAtualizacao = admin.firestore.FieldValue.serverTimestamp();
    tx.set(ref, base);
  });
}

// ── 4. BUSCAR APRENDIZADO (para UI) ──────────────────────────────────────
exports.buscarAprendizado = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    // Buscar todas as ligas com dados
    const ligasSnap = await db.collection('yellup-aprendizado').get();
    const ligas = ligasSnap.docs.map(d => d.data());

    // Buscar últimas previsões com análise (sem orderBy para evitar índice composto)
    const ultimasSnap = await db.collection('previsoes-historico')
      .where('analisado', '==', true)
      .limit(100)
      .get();
    // Ordenar no cliente
    const ultimas = ultimasSnap.docs
      .map(d => d.data())
      .sort((a,b) => {
        const ta = a.analisadoEm?.toMillis?.() || 0;
        const tb = b.analisadoEm?.toMillis?.() || 0;
        return tb - ta;
      })
      .slice(0, 50);

    // Ranking global de fatores de erro
    const fatorGlobal = {};
    ligas.forEach(l => {
      Object.entries(l.fatorFreq || {}).forEach(([k,v]) => {
        fatorGlobal[k] = (fatorGlobal[k] || 0) + v;
      });
    });

    return { ligas, ultimas, fatorGlobal };
  });

// =====================================================
// 🔄 BACKFILL DE PREVISÕES HISTÓRICAS
// Reconstrói previsões para jogos já encerrados e
// executa análise de desvio para popular o banco de
// aprendizado com dados históricos
// =====================================================

// ── LÓGICA DE PREVISÃO NO SERVIDOR (espelho do frontend) ─────────────────

function _calcYS(jogos) {
  if (!jogos?.length) return null;
  const js = jogos.slice(0, 20), n = js.length || 1;
  const avg = k => js.map(j => parseFloat(j.stats?.time?.[k]) || 0).reduce((a,b)=>a+b,0)/n;
  const wins  = js.filter(j => j.resultado === 'V').length;
  const draws = js.filter(j => j.resultado === 'E').length;
  const ap = (wins*3+draws)/(n*3);
  const gM = js.reduce((a,j)=>a+(j.gols||0),0)/n;
  const gS = js.reduce((a,j)=>a+(j.golsSofridos||0),0)/n;
  const xg = avg('expected_goals') || gM*0.8;
  let ys = 0;
  ys += ap*3.5;
  ys += Math.min(1,gM/2.5)*1.8;
  ys += Math.max(0,1-gS/2.0)*1.8;
  ys += Math.min(1,xg/1.5)*1.2;
  ys += Math.min(1,(avg('Shots on Goal')||0)/7)*0.6;
  ys += Math.min(1,((avg('Ball Possession')||50)-30)/40)*0.15;
  ys += Math.min(1,((avg('Passes %')||75)-60)/35)*0.15;
  return Math.min(10, Math.max(0, ys*1.05));
}

function _classForçaYS(ys) {
  if (ys === null) return 'medio';
  if (ys >= 7.5) return 'top';
  if (ys >= 5.5) return 'forte';
  if (ys >= 3.5) return 'equilibrado';
  return 'fraco';
}

function _calcSeq(jogos) {
  if (!jogos?.length) return { tipo: null, count: 0 };
  const p = jogos[0].resultado;
  let c = 0;
  for (const j of jogos) { if (j.resultado === p) c++; else break; }
  return { tipo: p, count: c };
}

function _calcGolsPorTempo(jogos) {
  let g1=0,g2=0,n=0;
  for (const j of jogos) {
    if (!j.golsMinuto?.length) continue;
    g1 += j.golsMinuto.filter(m=>m<=45).length;
    g2 += j.golsMinuto.filter(m=>m>45).length;
    n++;
  }
  if (!n) return { primeiro:0, segundo:0 };
  return { primeiro:+(g1/n).toFixed(2), segundo:+(g2/n).toFixed(2) };
}

function _calcGols(jogosC, jogosF, h2h, periodoC, periodoF) {
  const vals = [];
  const n = Math.min(jogosC.length,20), m = Math.min(jogosF.length,20);
  if (n>=3 && m>=3) {
    const atqC = jogosC.slice(0,n).reduce((a,j)=>a+(j.gols||0),0)/n;
    const defC = jogosC.slice(0,n).reduce((a,j)=>a+(j.golsSofridos||0),0)/n;
    const atqF = jogosF.slice(0,m).reduce((a,j)=>a+(j.gols||0),0)/m;
    const defF = jogosF.slice(0,m).reduce((a,j)=>a+(j.golsSofridos||0),0)/m;
    const ref = 1.35;
    vals.push(((atqC/ref)*(defF/ref)*ref) + ((atqF/ref)*(defC/ref)*ref));
  }
  if (n>=3) vals.push(jogosC.slice(0,n).reduce((a,j)=>a+(j.gols||0)+(j.golsSofridos||0),0)/n);
  if (m>=3) vals.push(jogosF.slice(0,m).reduce((a,j)=>a+(j.gols||0)+(j.golsSofridos||0),0)/m);
  if (h2h?.length>=3) {
    const mg = h2h.slice(0,8).reduce((a,g)=>a+(g.golsCasa||0)+(g.golsFora||0),0)/Math.min(h2h.length,8);
    if (mg>0) vals.push(mg);
  }
  if (!vals.length) vals.push(2.5);
  const mediaG = vals.reduce((a,b)=>a+b,0)/vals.length;
  // Calibração v3 — curva baseada em 1707 jogos reais
  function _correcaoCurva(m) {
    if (m <= 1.5) return 0.55;
    if (m <= 2.0) return 0.30;
    if (m <= 2.5) return 0.05;
    if (m <= 3.0) return -0.20;
    return -0.26;
  }
  const est = +Math.max(0.5, mediaG + _correcaoCurva(mediaG)).toFixed(1);
  return {
    estimado: String(est),
    range: `${Math.max(0,+(est-0.9).toFixed(1))}–${+(est+1.0).toFixed(1)}`,
    tendencia: est>=3.0?'alto':est<=1.9?'baixo':'medio',
  };
}

function _calcPrevisaoServidor(jogo, hC, hF) {
  const jogosC = hC?.jogos || [];
  const jogosF = hF?.jogos || [];
  const nC = jogosC.length, nF = jogosF.length;

  const ysC = _calcYS(jogosC);
  const ysF = _calcYS(jogosF);
  const seqC = _calcSeq(jogosC);
  const seqF = _calcSeq(jogosF);
  const periodoC = _calcGolsPorTempo(jogosC);
  const periodoF = _calcGolsPorTempo(jogosF);

  let probCasa=0, probEmpate=0, wTotal=0;
  const fontes = [];

  // YS relativo
  if (ysC !== null && ysF !== null) {
    const ysTotal = (ysC+ysF)||10;
    const diffAbs = Math.abs(ysC-ysF);
    let probYS = (ysC/ysTotal)*100+5;
    if (diffAbs < 1.5) probYS = probYS*0.6 + 50*0.4;
    const empYS = 24+Math.max(0,12-diffAbs)*0.9;
    const w = diffAbs >= 4.0 ? 0.35 : diffAbs >= 3.0 ? 0.28 : diffAbs >= 2.0 ? 0.08 : 0;
    if (w > 0) {
      probCasa   += probYS*w;
      probEmpate += empYS*w;
      wTotal += w;
    }
    fontes.push(`YS ${ysC.toFixed(1)}/${ysF.toFixed(1)}`);
  }

  // Histórico casa
  if (nC>=3) {
    const ref = jogosC.filter(j=>j.casa===true).length>=3 ? jogosC.filter(j=>j.casa===true) : jogosC;
    const n=ref.length;
    const w = n>=15?0.20:n>=7?0.13:0.07;
    probCasa   += ref.filter(j=>j.resultado==='V').length/n*100*w;
    probEmpate += ref.filter(j=>j.resultado==='E').length/n*100*w;
    wTotal += w;
    fontes.push(`HistCasa(${n})`);
  }

  // Histórico fora
  if (nF>=3) {
    const ref = jogosF.filter(j=>j.casa===false).length>=3 ? jogosF.filter(j=>j.casa===false) : jogosF;
    const n=ref.length;
    const w = n>=15?0.18:n>=7?0.11:0.05;
    const vitF=ref.filter(j=>j.resultado==='V').length/n*100;
    const empF=ref.filter(j=>j.resultado==='E').length/n*100;
    probCasa   += (100-vitF-empF)*w;
    probEmpate += empF*w;
    wTotal += w;
    fontes.push(`HistFora(${n})`);
  }

  // H2H
  const h2h = hC?.h2h || [];
  if (h2h.length>=3) {
    const foraId = String(jogo.timeFora?.apiId||jogo.timeFora?.id||'');
    const filt = h2h.filter(g=>String(g.timeForaId)===foraId||String(g.timeCasaId)===foraId);
    if (filt.length>=3) {
      const casaId = String(jogo.timeCasa?.apiId||jogo.timeCasa?.id||'');
      const vitH = filt.filter(g=>{
        const ic=String(g.timeCasaId)===casaId;
        return (ic&&g.resultado==='1')||(!ic&&g.resultado==='2');
      }).length/filt.length*100;
      const empH=filt.filter(g=>g.resultado==='X').length/filt.length*100;
      const w = filt.length>=8?0.18:0.10;
      probCasa   += vitH*w;
      probEmpate += empH*w;
      wTotal += w;
      fontes.push(`H2H(${filt.length})`);
    }
  }

  // Sequência
  if (seqC.tipo==='V'&&seqC.count>=3) probCasa+=3;
  else if (seqC.tipo==='D'&&seqC.count>=3) probCasa-=3;
  if (seqF.tipo==='V'&&seqF.count>=3) probCasa-=3;

  if (wTotal<0.1) { probCasa=46; probEmpate=26; }
  else { probCasa/=wTotal; probEmpate/=wTotal; }

  // Deflação v3 — comprimir probabilidades sobreestimadas acima de 55%
  function _deflacoinar(p) {
    if (p >= 75) return 0.72*p + 8;
    if (p >= 65) return 0.82*p + 5;
    if (p >= 55) return 0.90*p + 3;
    return p;
  }
  probCasa   = _deflacoinar(probCasa);
  probEmpate = _deflacoinar(probEmpate);

  probCasa   = Math.min(80,Math.max(8,Math.round(probCasa)));
  probEmpate = Math.min(42,Math.max(8,Math.round(probEmpate)));
  let probFora = Math.max(4,100-probCasa-probEmpate);
  const tot = probCasa+probEmpate+probFora;
  probCasa   = Math.round(probCasa/tot*100);
  probEmpate = Math.round(probEmpate/tot*100);
  probFora   = 100-probCasa-probEmpate;

  const max = Math.max(probCasa,probEmpate,probFora);
  const veredito = probCasa===max?'casa':probEmpate===max?'empate':'fora';

  // ── IMPREVISIBILIDADE POR LIGA (v1 — baseada em 1449 jogos) ────────────────
// Fator 0.0 = liga muito previsível (hierarquia clara, favorito vence ~65%+)
// Fator 1.0 = liga muito imprevisível (qualquer time pode ganhar qualquer jogo)
// Fonte: análise de "YS favorecia mas perdeu" por liga nos dados históricos
const LIGA_IMPREVISIBILIDADE = {
  // Brasil — alta imprevisibilidade (série A = uma das mais equilibradas do mundo)
  'Brasileirão Série A':    0.85,
  'Brasileirão Série B':    0.80,
  'Brasileirão Série C':    0.75,
  'Copa do Brasil':         0.80,
  'Paulista A1':            0.80,
  'Carioca':                0.80,
  'Gaúcho':                 0.80,
  'Mineiro':                0.80,
  'Baiano':                 0.82,
  'Paranaense':             0.80,
  'Cearense':               0.82,
  'Pernambucano':           0.82,
  // Europa top — média imprevisibilidade (hierarquia existe mas upset é comum)
  'Premier League':         0.55,
  'La Liga':                0.48,
  'Bundesliga':             0.45,
  'Serie A':                0.52,
  'Ligue 1':                0.50,
  'Primeira Liga':          0.55,
  'Eredivisie':             0.50,
  'Pro League':             0.52,
  // Copas europeias — baixa imprevisibilidade (top times dominam)
  'Champions League':       0.40,
  'Europa League':          0.48,
  'Conference League':      0.52,
  'Copa Libertadores':      0.65,
  'Copa Sudamericana':      0.68,
  // Copa do Mundo e seleções — média
  'World Cup':              0.52,
  'Copa América':           0.58,
  'UEFA Nations League':    0.50,
  // Ligas menores / menos dados — conservador (usar média alta)
  'DEFAULT':                0.65,
};

function getFatorImprevisibilidade(ligaNome) {
  if (!ligaNome) return LIGA_IMPREVISIBILIDADE['DEFAULT'];
  // Busca exata
  if (LIGA_IMPREVISIBILIDADE[ligaNome] !== undefined) return LIGA_IMPREVISIBILIDADE[ligaNome];
  // Busca parcial (ex: "Brasileirão" em "Brasileirão Série A - 2025")
  for (const [key, val] of Object.entries(LIGA_IMPREVISIBILIDADE)) {
    if (key !== 'DEFAULT' && ligaNome.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return LIGA_IMPREVISIBILIDADE['DEFAULT'];
}

// ── CONFIANÇA v3 servidor (espelho do frontend) — baseada em 251 jogos ──
  const diffYS2 = ysC!==null&&ysF!==null ? Math.abs(ysC-ysF) : 0;
  const segundoMax2 = [probCasa,probEmpate,probFora].sort((a,b)=>b-a)[1];
  const altaInc = (max-segundoMax2) < 8;

  // Sinal 1: Volume
  const volBom2   = nC>=15 && nF>=15;
  const volOtimo2 = nC>=25 && nF>=25;
  // Sinal 2: Dominância YS
  const ysMax2 = Math.max(ysC||0,ysF||0);
  const dominanciaClara2 = diffYS2>=4.0 && ysMax2>=7.0;
  const dominanciaMedia2 = diffYS2>=2.5 && ysMax2>=5.5;
  // Sinal 3: Probabilidade
  const probForte2    = max>=62 && !altaInc;
  const probModerada2 = max>=54 && !altaInc;
  // Sinal 4: Forma do favorito
  const favYS2 = (ysC||0)>(ysF||0)?'casa':'fora';
  const jogosDoFav2 = favYS2==='casa' ? jogosC : jogosF;
  const vitoriasFav2 = (jogosDoFav2||[]).slice(0,5).filter(jj=>jj.resultado==='V').length;
  const formaConverge2 = vitoriasFav2>=3;
  // Sinal 5: H2H
  const h2hBom2 = (hC?.h2h||[]).length>=4;

  const sinaisAlta2  = [volOtimo2,dominanciaClara2,probForte2,formaConverge2,h2hBom2].filter(Boolean).length;
  const sinaisMedia2 = [volBom2,dominanciaMedia2,probModerada2,formaConverge2].filter(Boolean).length;

  // Confiança baseada em sinais universais — independente da liga
  const penalizar2 = (altaInc && max<48) || max<40;
  let confianca = penalizar2 ? 'insuficiente'
    : sinaisAlta2>=3  ? 'alta'
    : sinaisMedia2>=2 ? 'baixa'
    : 'insuficiente';

  const gols = _calcGols(jogosC, jogosF, hC?.h2h, periodoC, periodoF);

  return { probCasa, probEmpate, probFora, veredito, confianca,
           golsEstimado: gols.estimado, golsRange: gols.range,
           ysC, ysF, forcaC: _classForçaYS(ysC), forcaF: _classForçaYS(ysF), fontes };
}

// ── CF BACKFILL PRINCIPAL ─────────────────────────────────────────────────
exports.backfillPrevisoes = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const lote       = Math.min(data?.lote || 20, 30);
    const offset     = data?.offset || 0;
    const ligaFiltro = data?.liga || null;
    const forcar     = data?.forcar === true; // reprocessar mesmo já analisados

    console.log(`🔄 Backfill previsões — lote=${lote} offset=${offset}`);

    // Buscar jogos encerrados em lotes para superar o limite
    const jogosSnap = await db.collection('jogos-admin')
      .where('status', '==', 'encerrado')
      .limit(500)
      .get();
    // Filtrar por liga no cliente se necessário, depois ordenar por data

    let todosJogos = jogosSnap.docs.map(d => {
      const raw = d.data();
      // Normalizar campo do fixture id
      const fxId = raw.apiFootballId || raw.apiFixtureId || raw.apiId || null;
      return { id: d.id, ...raw, apiFootballId: fxId };
    }).filter(j => j.apiFootballId && j.timeCasa?.apiId && j.timeFora?.apiId);

    // Filtrar por liga no cliente
    if (ligaFiltro) {
      todosJogos = todosJogos.filter(j => j.liga?.nome === ligaFiltro);
    }

    // Ordenar por data decrescente no cliente
    todosJogos.sort((a, b) => {
      const ta = a.dataInicio?.toMillis?.() || new Date(a.dataInicio||0).getTime();
      const tb = b.dataInicio?.toMillis?.() || new Date(b.dataInicio||0).getTime();
      return tb - ta;
    });

    console.log(`📋 Total jogos encerrados encontrados: ${todosJogos.length}`);

    // Verificar quais já foram processados
    const jaProcessados = new Set();
    if (todosJogos.length > 0) {
      const idsParaCheck = todosJogos.slice(offset, offset+lote).map(j => String(j.apiFootballId));
      const checks = await Promise.all(
        idsParaCheck.map(id => db.collection('previsoes-historico').doc(id).get())
      );
      checks.forEach((snap, i) => {
        if (snap.exists && snap.data().analisado) jaProcessados.add(idsParaCheck[i]);
      });
    }

    const jogosLote = todosJogos.slice(offset, offset+lote)
      .filter(j => forcar || !jaProcessados.has(String(j.apiFootballId)));

    if (!jogosLote.length) {
      return {
        sucesso: true, processados: 0, total: todosJogos.length,
        msg: `Nenhum jogo novo neste lote (total encerrados encontrados: ${todosJogos.length}, offset: ${offset})`
      };
    }

    let processados = 0, erros = 0;
    const resultados = [];

    for (const jogo of jogosLote) {
      const fxId = String(jogo.apiFootballId);
      try {
        const casaId = parseInt(jogo.timeCasa.apiId);
        const foraId = parseInt(jogo.timeFora.apiId);

        // Buscar histórico de ANTES do jogo
        // Usamos season do jogo para não incluir dados futuros
        const jogoData = jogo.dataInicio?.toDate ? jogo.dataInicio.toDate() : new Date(jogo.dataInicio);
        const season = jogoData.getFullYear();

        const [hC, hF] = await Promise.all([
          apiFootballGet(`/fixtures?team=${casaId}&season=${season}&last=35`).then(async r => {
            // Filtrar só jogos ANTES desta data
            const fixtures = (r.response||[]).filter(f => {
              const fd = new Date(f.fixture.date);
              return fd < jogoData && ['FT','AET','PEN'].includes(f.fixture.status.short);
            });
            // Montar estrutura simples (sem buscar stats para economizar chamadas)
            const jogos = fixtures.slice(0,30).map(f => {
              const isHome = Number(f.teams.home.id) === casaId;
              const gM = isHome ? (f.goals.home||0) : (f.goals.away||0);
              const gS = isHome ? (f.goals.away||0) : (f.goals.home||0);
              return {
                fixtureId: f.fixture.id,
                casa: isHome,
                gols: gM,
                golsSofridos: gS,
                resultado: gM>gS?'V':gM===gS?'E':'D',
                stats: {},
              };
            });
            const h2hR = await apiFootballGet(`/fixtures/headtohead?h2h=${casaId}-${foraId}&last=10`);
            const h2h = (h2hR.response||[]).filter(f=>['FT','AET','PEN'].includes(f.fixture.status.short)).map(f=>({
              timeCasaId: f.teams.home.id,
              timeForaId: f.teams.away.id,
              golsCasa: f.goals.home||0,
              golsFora: f.goals.away||0,
              resultado: f.goals.home>f.goals.away?'1':f.goals.home<f.goals.away?'2':'X',
            }));
            return { jogos, h2h };
          }),
          apiFootballGet(`/fixtures?team=${foraId}&season=${season}&last=35`).then(r => {
            const fixtures = (r.response||[]).filter(f => {
              const fd = new Date(f.fixture.date);
              return fd < jogoData && ['FT','AET','PEN'].includes(f.fixture.status.short);
            });
            const jogos = fixtures.slice(0,30).map(f => {
              const isHome = Number(f.teams.home.id) === foraId;
              const gM = isHome ? (f.goals.home||0) : (f.goals.away||0);
              const gS = isHome ? (f.goals.away||0) : (f.goals.home||0);
              return { casa: isHome, gols: gM, golsSofridos: gS, resultado: gM>gS?'V':gM===gS?'E':'D', stats:{} };
            });
            return { jogos, h2h: [] };
          }),
        ]);

        // Calcular previsão retroativa
        const prev = _calcPrevisaoServidor(jogo, hC, hF);

        // Salvar previsão reconstruída
        const jogoData2 = jogo.dataInicio?.toDate ? jogo.dataInicio.toDate() : new Date(jogo.dataInicio);
        await db.collection('previsoes-historico').doc(fxId).set({
          fixtureId: fxId,
          timeCasaId: String(jogo.timeCasa.apiId),
          timeForaId: String(jogo.timeFora.apiId),
          timeCasaNome: jogo.timeCasa.nome || '',
          timeForaNome: jogo.timeFora.nome || '',
          liga: jogo.liga?.nome || '',
          dataJogo: jogoData2.toISOString(),
          savedAt: admin.firestore.FieldValue.serverTimestamp(),
          backfill: true, // marcado como reconstituído

          probCasa:     prev.probCasa,
          probEmpate:   prev.probEmpate,
          probFora:     prev.probFora,
          veredito:     prev.veredito,
          golsEstimado: prev.golsEstimado,
          golsRange:    prev.golsRange,
          confianca:    prev.confianca,
          ysC:          prev.ysC,
          ysF:          prev.ysF,
          forcaC:       prev.forcaC,
          forcaF:       prev.forcaF,
          fontes:       prev.fontes,

          resultadoReal: null,
          golsReais: null,
          analisado: false,
        });

        // Analisar desvio imediatamente
        const analise = await _analisarDesvio(fxId);
        processados++;
        resultados.push({ fxId, acertou: analise.acertouResultado, gols: analise.golsReais });

      } catch(e) {
        console.error(`Erro backfill ${fxId}:`, e.message);
        erros++;
      }
    }

    const totalRestante = todosJogos.length - offset - lote;

    console.log(`✅ Backfill: ${processados} processados, ${erros} erros. Restantes: ${totalRestante}`);
    return {
      sucesso: true,
      processados,
      erros,
      total: todosJogos.length,
      proximoOffset: offset + lote,
      totalRestante: Math.max(0, totalRestante),
      resultados,
    };
  });

// ── DIAGNÓSTICO BACKFILL (temporário) ────────────────────────────────────
exports.diagnosticarBackfill = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    // 1. Contar total de docs em jogos-admin
    const totalSnap = await db.collection('jogos-admin').limit(5).get();
    const exemplo = totalSnap.docs[0]?.data() || null;

    // 2. Quais campos tem o primeiro doc?
    const campos = exemplo ? Object.keys(exemplo) : [];
    const timeCasaCampos = exemplo?.timeCasa ? Object.keys(exemplo.timeCasa) : [];

    // 3. Tentar buscar encerrados com status
    const encSnap1 = await db.collection('jogos-admin')
      .where('status', '==', 'encerrado').limit(5).get();

    // 4. Tentar com statusCode FT
    const encSnap2 = await db.collection('jogos-admin')
      .where('statusCode', '==', 'FT').limit(5).get();

    // 5. Exemplo do primeiro encerrado encontrado
    const primeiroEnc = encSnap1.docs[0]?.data() || encSnap2.docs[0]?.data() || null;

    return {
      totalDocs: totalSnap.size,
      campos,
      timeCasaCampos,
      encerradosPorStatus: encSnap1.size,
      encerradosPorStatusCode: encSnap2.size,
      exemploDoc: {
        status:       primeiroEnc?.status,
        statusCode:   primeiroEnc?.statusCode,
        apiFootballId: primeiroEnc?.apiFootballId,
        apiFixtureId:  primeiroEnc?.apiFixtureId,
        placarCasa:    primeiroEnc?.placarCasa,
        placarFora:    primeiroEnc?.placarFora,
        timeCasaApiId: primeiroEnc?.timeCasa?.apiId,
        timeForaApiId: primeiroEnc?.timeFora?.apiId,
      },
    };
  });

// ── LISTAR LIGAS NO BANCO (diagnóstico) ──────────────────────────────────
exports.listarLigasBackfill = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const snap = await db.collection('jogos-admin')
      .where('status', '==', 'encerrado')
      .limit(500)
      .get();

    const ligas = {};
    snap.docs.forEach(d => {
      const liga = d.data().liga?.nome || '(sem nome)';
      ligas[liga] = (ligas[liga] || 0) + 1;
    });

    // Ver quais já foram para o aprendizado
    const aprSnap = await db.collection('yellup-aprendizado').get();
    const ligasAprendidas = aprSnap.docs.map(d => d.data().liga);

    return {
      totalEncerrados: snap.size,
      ligasNoBackfill: ligas,
      ligasNoAprendizado: ligasAprendidas,
    };
  });

// =====================================================
// 🎰 SIMULADOR DE ESTRATÉGIAS DE APOSTAS
// Testa diferentes estratégias nos dados históricos
// =====================================================
exports.simularEstrategias = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const ligaFiltro    = data?.liga || null;
    const confFiltro    = data?.confianca || null; // 'alta','media','baixa','insuficiente',null=todos

    // Buscar todas as previsões analisadas
    let query = db.collection('previsoes-historico').where('analisado', '==', true).limit(500);
    const snap = await query.get();

    let registros = snap.docs.map(d => d.data())
      .filter(r => r.golsEstimado !== null && r.golsReais !== null);

    if (ligaFiltro)  registros = registros.filter(r => r.liga === ligaFiltro);
    if (confFiltro)  registros = registros.filter(r => r.confianca === confFiltro);

    const n = registros.length;
    if (n === 0) return { sucesso: false, msg: 'Nenhum registro com os filtros aplicados' };

    // ── HELPER ───────────────────────────────────────────────────────────
    const pct = (acertos) => n > 0 ? +((acertos / n) * 100).toFixed(1) : 0;

    // ── ANÁLISE DISTRIBUIÇÃO DE DESVIOS ──────────────────────────────────
    // Saber para qual lado o sistema erra
    let somaDesvio = 0;
    let desviosPositivos = 0; // subestimou (real > estimado)
    let desviosNegativos = 0; // superestimou (real < estimado)
    let desviosExatos    = 0; // acertou em cheio (diff < 0.5)
    const histDesvios = {}; // { "-2": 5, "-1": 12, "0": 30, "+1": 25, ... }

    registros.forEach(r => {
      const est  = parseFloat(r.golsEstimado) || 0;
      const real = r.golsReais;
      const dev  = +(real - est).toFixed(1);
      somaDesvio += dev;
      if (dev >  0.3) desviosPositivos++;
      else if (dev < -0.3) desviosNegativos++;
      else desviosExatos++;
      const bucket = Math.round(dev); // arredondar para inteiro
      const k = bucket >= 0 ? `+${bucket}` : `${bucket}`;
      histDesvios[k] = (histDesvios[k] || 0) + 1;
    });
    const desvioMedio = +(somaDesvio / n).toFixed(2);

    // ── ESTRATÉGIAS DE GOLS ──────────────────────────────────────────────
    // Para cada margem, conta quantas vezes a aposta teria acertado
    const margens = [-1.5, -1.0, -0.5, 0, +0.5, +1.0, +1.5];
    const estrategiasGols = margens.map(margem => {
      // Over: apostamos que o real vai ser > (estimado + margem)
      const overAcertos = registros.filter(r => {
        const threshold = parseFloat(r.golsEstimado) + margem;
        return r.golsReais > threshold;
      }).length;
      // Under: apostamos que o real vai ser < (estimado + margem)  
      const underAcertos = registros.filter(r => {
        const threshold = parseFloat(r.golsEstimado) + margem;
        return r.golsReais < threshold;
      }).length;
      // Exato±0.5: real cai no range estimado ± 0.5
      const exatoAcertos = registros.filter(r => {
        const est = parseFloat(r.golsEstimado) + margem;
        return Math.abs(r.golsReais - est) <= 0.5;
      }).length;

      return {
        margem,
        label: margem === 0 ? 'Estimado exato' : margem > 0 ? `Est. +${margem}` : `Est. ${margem}`,
        over:  { acertos: overAcertos,  pct: pct(overAcertos) },
        under: { acertos: underAcertos, pct: pct(underAcertos) },
        exato: { acertos: exatoAcertos, pct: pct(exatoAcertos) },
      };
    });

    // ── ESTRATÉGIAS DE RESULTADO ─────────────────────────────────────────
    const resultAcertos = registros.filter(r => r.acertouResultado).length;

    // Por confiança
    const porConf = {};
    ['alta','media','baixa','insuficiente'].forEach(conf => {
      const sub = registros.filter(r => r.confianca === conf);
      if (!sub.length) return;
      porConf[conf] = {
        total: sub.length,
        acertos: sub.filter(r => r.acertouResultado).length,
        pct: +((sub.filter(r => r.acertouResultado).length / sub.length) * 100).toFixed(1),
        golsDesvioMedio: +(sub.reduce((a,r) => a + (r.golsReais - parseFloat(r.golsEstimado||0)), 0) / sub.length).toFixed(2),
      };
    });

    // Por margem de probabilidade (quanto o sistema estava "certo" da previsão)
    const porMargem = [
      { label: '≥65% confiante', filter: r => {
        const max = Math.max(r.probCasa||0, r.probEmpate||0, r.probFora||0);
        return max >= 65;
      }},
      { label: '55–64%', filter: r => {
        const max = Math.max(r.probCasa||0, r.probEmpate||0, r.probFora||0);
        return max >= 55 && max < 65;
      }},
      { label: '45–54%', filter: r => {
        const max = Math.max(r.probCasa||0, r.probEmpate||0, r.probFora||0);
        return max >= 45 && max < 55;
      }},
      { label: '<45%', filter: r => {
        const max = Math.max(r.probCasa||0, r.probEmpate||0, r.probFora||0);
        return max < 45;
      }},
    ].map(({ label, filter }) => {
      const sub = registros.filter(filter);
      if (!sub.length) return { label, total: 0, acertos: 0, pct: 0 };
      return {
        label,
        total:   sub.length,
        acertos: sub.filter(r => r.acertouResultado).length,
        pct:     +((sub.filter(r => r.acertouResultado).length / sub.length) * 100).toFixed(1),
      };
    });

    // ── MELHOR ESTRATÉGIA (gols) ─────────────────────────────────────────
    const melhorOver  = estrategiasGols.reduce((best, e) => e.over.pct  > best.over.pct  ? e : best);
    const melhorUnder = estrategiasGols.reduce((best, e) => e.under.pct > best.under.pct ? e : best);

    // ── SIMULAÇÃO FINANCEIRA (ROI simplificado) ───────────────────────────
    // Assumindo odd média de 1.90 para over/under gols
    const ODD = 1.90;
    const STAKE = 10; // R$10 por aposta

    const simFinanceira = estrategiasGols.map(e => {
      const ganhoOver  = e.over.acertos  * (STAKE * ODD) - n * STAKE;
      const ganhoUnder = e.under.acertos * (STAKE * ODD) - n * STAKE;
      return {
        label:      e.label,
        roiOver:    +((ganhoOver  / (n * STAKE)) * 100).toFixed(1),
        roiUnder:   +((ganhoUnder / (n * STAKE)) * 100).toFixed(1),
        lucroOver:  +ganhoOver.toFixed(2),
        lucroUnder: +ganhoUnder.toFixed(2),
      };
    });

    return {
      sucesso: true,
      total: n,
      liga: ligaFiltro,
      confianca: confFiltro,

      // Distribuição de erros
      desvioMedio,
      desviosPositivos,
      desviosNegativos,
      desviosExatos,
      histDesvios,

      // Resultado
      resultAcertos,
      resultPct: pct(resultAcertos),
      porConf,
      porMargem,

      // Gols
      estrategiasGols,
      melhorOver:  { margem: melhorOver.margem,  pct: melhorOver.over.pct },
      melhorUnder: { margem: melhorUnder.margem, pct: melhorUnder.under.pct },
      simFinanceira,
    };
  });

// ── CORRIGIR JOGOS PRESOS COMO AO_VIVO ───────────────────────────────────
// Roda uma vez para corrigir jogos que ficaram presos
exports.corrigirJogosPresos = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    // Buscar todos os jogos marcados como ao_vivo no jogos-admin
    const snap = await db.collection('jogos-admin')
      .where('status', '==', 'ao_vivo')
      .get();

    if (snap.empty) return { corrigidos: 0, msg: 'Nenhum jogo ao_vivo encontrado' };

    // Normalizar campo — pode ser apiFootballId OU apiFixtureId
    const jogos = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        _apiId: data.apiFootballId || data.apiFixtureId || data.apiId || null,
      };
    }).filter(j => j._apiId);

    if (!jogos.length) return { corrigidos: 0, total: snap.size, msg: 'Nenhum jogo com ID da API encontrado' };

    // Buscar status real de cada jogo na API em lotes
    let corrigidos = 0;
    const detalhes = [];

    for (const jogo of jogos) {
      try {
        const data = await apiFootballGet(`/fixtures?id=${jogo._apiId}`);
        const fixture = data?.response?.[0];
        if (!fixture) continue;

        const statusShort = fixture.fixture?.status?.short;
        const STATUS_FT = ['FT', 'AET', 'PEN', 'ABD', 'AWD', 'WO'];

        if (STATUS_FT.includes(statusShort)) {
          const pC = fixture.goals?.home ?? 0;
          const pF = fixture.goals?.away ?? 0;

          await db.collection('jogos-admin').doc(jogo.id).update({
            status: 'encerrado',
            placarCasa: pC,
            placarFora: pF,
            minuto: fixture.fixture?.status?.elapsed || 90,
            encerradoEm: admin.firestore.FieldValue.serverTimestamp(),
          });

          detalhes.push(`✓ ${jogo.timeCasa?.nome || jogo.id} ${pC}×${pF} → encerrado`);
          corrigidos++;
        } else {
          detalhes.push(`○ ${jogo.timeCasa?.nome || jogo.id} ainda ${statusShort}`);
        }

        // Respeitar rate limit da API (1req/seg)
        await new Promise(r => setTimeout(r, 1100));
      } catch(e) {
        detalhes.push(`✗ ${jogo.id}: ${e.message}`);
      }
    }

    return { corrigidos, total: jogos.length, detalhes };
  });

// ── RESETAR YELLUP-APRENDIZADO (para reprocessamento limpo) ──────────────
exports.resetarAprendizado = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const snap = await db.collection('yellup-aprendizado').get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // Também resetar analisado=false em previsoes-historico para reprocessar
    const prevSnap = await db.collection('previsoes-historico')
      .where('analisado', '==', true).limit(500).get();
    const batch2 = db.batch();
    prevSnap.docs.forEach(d => batch2.update(d.ref, { analisado: false, resetadoEm: admin.firestore.FieldValue.serverTimestamp() }));
    await batch2.commit();

    return {
      ok: true,
      aprendizadoDeletado: snap.size,
      previsoresResetados: prevSnap.size,
      msg: 'Agora rode o backfill sem forcar=true para reprocessar tudo limpo'
    };
  });

// =====================================================================
// 📚 BACKFILL HISTÓRICO MASSIVO
// Busca jogos encerrados de temporadas passadas diretamente da API,
// reconstrói a previsão que o algoritmo teria feito ANTES do jogo
// e alimenta o aprendizado — sem precisar ter importado os jogos antes.
// =====================================================================
exports.backfillHistoricoMassivo = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    const ligaId   = data?.ligaId;          // ex: 71 (Brasileirão)
    const season   = data?.season || 2024;  // temporada a buscar
    const lote     = Math.min(data?.lote || 10, 20); // jogos por chamada
    const pagina   = data?.pagina || 1;     // para paginação

    if (!ligaId) throw new functions.https.HttpsError('invalid-argument', 'ligaId obrigatório');

    console.log(`📚 Backfill histórico: liga=${ligaId} season=${season} pagina=${pagina} lote=${lote}`);

    // 1. Buscar jogos encerrados da liga/temporada na API
    const r = await apiFootballGet(`/fixtures?league=${ligaId}&season=${season}&status=FT`);
    const todos = (r?.response || []);

    if (!todos.length) {
      return { sucesso: false, msg: `Nenhum jogo encontrado para liga ${ligaId} temporada ${season}` };
    }

    // Ordenar por data decrescente (mais recentes primeiro)
    todos.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));

    const offset = (pagina - 1) * lote;
    const loteJogos = todos.slice(offset, offset + lote);

    if (!loteJogos.length) {
      return {
        sucesso: true,
        processados: 0,
        total: todos.length,
        paginas: Math.ceil(todos.length / lote),
        msg: 'Todos os jogos desta temporada já foram processados'
      };
    }

    // 2. Verificar quais já foram processados
    const idsLote = loteJogos.map(f => String(f.fixture.id));
    const checks = await Promise.all(
      idsLote.map(id => db.collection('previsoes-historico').doc(id).get())
    );
    const jaFeitos = new Set(
      checks.filter((s, i) => s.exists && s.data()?.analisado).map((s, i) => idsLote[i])
    );

    const paraProcessar = loteJogos.filter(f => !jaFeitos.has(String(f.fixture.id)));

    if (!paraProcessar.length) {
      return {
        sucesso: true,
        processados: 0,
        pulados: lote,
        total: todos.length,
        paginas: Math.ceil(todos.length / lote),
        msg: `Lote ${pagina} já processado anteriormente`
      };
    }

    let processados = 0, erros = 0;
    const resultados = [];

    for (const fixture of paraProcessar) {
      const fxId     = String(fixture.fixture.id);
      const casaId   = String(fixture.teams.home.id);
      const foraId   = String(fixture.teams.away.id);
      const dataJogo = fixture.fixture.date; // ISO string
      const ligaNome = fixture.league.name;
      const pC       = fixture.goals?.home ?? 0;
      const pF       = fixture.goals?.away ?? 0;

      try {
        // 3. Buscar histórico dos times ANTES da data do jogo
        // Usamos a data do jogo como limite para simular conhecimento pré-jogo
        const dataLimite = new Date(dataJogo);
        dataLimite.setDate(dataLimite.getDate() - 1); // dia anterior
        const dataLimiteStr = dataLimite.toISOString().slice(0,10);

        const [hC, hF] = await Promise.all([
          _buscarHistoricoTimeLocal(casaId, dataLimiteStr, 20, season),
          _buscarHistoricoTimeLocal(foraId, dataLimiteStr, 20, season),
        ]);

        if (!hC?.jogos?.length || !hF?.jogos?.length) {
          erros++;
          resultados.push({ fxId, status: 'sem_historico' });
          continue;
        }

        // 4. Montar objeto jogo no formato esperado pelo _calcPrevisaoServidor
        const jogoFake = {
          timeCasa: { apiId: casaId, nome: fixture.teams.home.name },
          timeFora: { apiId: foraId, nome: fixture.teams.away.name },
          liga:     { nome: ligaNome, apiId: ligaId },
          local:    'casa',
        };

        // 5. Calcular previsão retroativa
        const prev = _calcPrevisaoServidor(jogoFake, hC, hF);

        // 6. Salvar previsão e resultado real
        await db.collection('previsoes-historico').doc(fxId).set({
          fixtureId:    fxId,
          timeCasaId:   casaId,
          timeForaId:   foraId,
          timeCasaNome: fixture.teams.home.name,
          timeForaNome: fixture.teams.away.name,
          liga:         ligaNome,
          ligaId:       String(ligaId),
          season:       String(season),
          dataJogo:     dataJogo,
          savedAt:      admin.firestore.FieldValue.serverTimestamp(),
          backfill:     true,
          backfillTipo: 'historico_massivo',

          probCasa:     prev.probCasa,
          probEmpate:   prev.probEmpate,
          probFora:     prev.probFora,
          veredito:     prev.veredito,
          golsEstimado: prev.golsEstimado,
          golsRange:    prev.golsRange,
          confianca:    prev.confianca,
          ysC:          prev.ysC,
          ysF:          prev.ysF,
          fontes:       prev.fontes,

          resultadoReal: pC > pF ? 'casa' : pF > pC ? 'fora' : 'empate',
          golsReais:     pC + pF,
          placarCasa:    pC,
          placarFora:    pF,
          analisado:     false, // será marcado true pelo _analisarDesvio
        });

        // 7. Analisar desvio imediatamente (resultado já está no doc)
        const analise = await _analisarDesvio(fxId);
        processados++;
        resultados.push({
          fxId,
          status: 'ok',
          acertou: analise?.acertouResultado,
          gols: pC + pF,
          golsEst: prev.golsEstimado,
          confianca: prev.confianca,
        });

        // Rate limit entre jogos
        await new Promise(r => setTimeout(r, 800));

      } catch(e) {
        console.error(`Erro backfill histórico ${fxId}:`, e.message);
        erros++;
        resultados.push({ fxId, status: 'erro', msg: e.message });
      }
    }

    const acertos = resultados.filter(r => r.acertou).length;

    return {
      sucesso:    true,
      processados,
      erros,
      pulados:    jaFeitos.size,
      total:      todos.length,
      pagina,
      paginas:    Math.ceil(todos.length / lote),
      acuracia:   processados > 0 ? Math.round(acertos/processados*100) : null,
      msg:        `Liga ${ligaId}/${season}: ${processados} processados, ${erros} erros, acurácia=${acertos}/${processados}`,
      resultados: resultados.slice(0, 20), // preview dos primeiros 20
    };
  });

// Helper: buscar histórico de um time ANTES de uma data
async function _buscarHistoricoTimeLocal(teamId, dataLimite, limite = 20, season = 2024) {
  try {
    // Buscar últimas N partidas do time antes da data
    // Tenta a temporada passada e a anterior para garantir histórico
    const [r1, r2] = await Promise.all([
      apiFootballGet(`/fixtures?team=${teamId}&status=FT&season=${season}&to=${dataLimite}`),
      season > 2020 ? apiFootballGet(`/fixtures?team=${teamId}&status=FT&season=${season-1}`) : Promise.resolve({response:[]}),
    ]);
    const combined = [...(r1?.response||[]), ...(r2?.response||[])];
    const r = { response: combined };
    const fixtures = (r?.response || [])
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .slice(0, limite);

    if (!fixtures.length) return null;

    const jogos = fixtures.map(f => {
      const isCasa = f.teams.home.id === parseInt(teamId);
      const golsMarcados  = isCasa ? (f.goals.home ?? 0) : (f.goals.away ?? 0);
      const golsSofridos  = isCasa ? (f.goals.away ?? 0) : (f.goals.home ?? 0);
      const resultado     = golsMarcados > golsSofridos ? 'V'
        : golsMarcados < golsSofridos ? 'D' : 'E';

      // Estatísticas da partida se disponíveis
      const stats = f.statistics || [];
      const getStat = (tipo) => {
        const t = stats.find(s => s.team?.id === parseInt(teamId));
        const s = (t?.statistics || []).find(st => st.type === tipo);
        if (!s?.value && s?.value !== 0) return 0;
        const v = String(s.value).replace('%','').trim();
        return isNaN(v) ? 0 : parseFloat(v);
      };

      return {
        fixtureId:    String(f.fixture.id),
        data:         f.fixture.date,
        casa:         isCasa,
        gols:         golsMarcados,
        golsSofridos,
        resultado,
        stats: {
          time: {
            posse:         getStat('Ball Possession'),
            chutesAlvo:    getStat('Shots on Goal'),
            chutesTotais:  getStat('Total Shots'),
            xg:            getStat('expected_goals'),
            ataquesPerig:  getStat('Dangerous Attacks'),
            escanteios:    getStat('Corner Kicks'),
            faltas:        getStat('Fouls'),
          },
          adversario: {
            posse:         isCasa ? 100 - getStat('Ball Possession') : getStat('Ball Possession'),
            chutesAlvo:    getStat('Shots on Goal'),
          }
        }
      };
    });

    return { jogos, teamId };
  } catch(e) {
    console.error(`buscarHistoricoTime ${teamId}:`, e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
// 🔬 MINERAÇÃO DE PADRÕES UNIVERSAIS
// Analisa todos os jogos históricos e encontra combinações de indicadores
// pré-jogo que correlacionam com resultados — independente da liga.
// ══════════════════════════════════════════════════════════════════════
exports.minerarPadroesUniversais = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) throw new functions.https.HttpsError('permission-denied', 'Apenas admin');

    // Buscar todas as previsões analisadas
    const snap = await db.collection('previsoes-historico')
      .where('analisado', '==', true)
      .limit(2000)
      .get();

    const registros = snap.docs.map(d => d.data())
      .filter(r => r.golsReais !== null && r.golsEstimado !== null);

    const n = registros.length;
    if (n < 50) return { sucesso: false, msg: 'Poucos dados ainda' };

    // ── PADRÃO 1: Gols por faixa de estimativa ───────────────────────
    // "Quando estimamos X gols, quantos saem na realidade?"
    const faixasGols = {};
    registros.forEach(r => {
      const est = Math.round(parseFloat(r.golsEstimado) * 2) / 2; // arredonda para 0.5
      const key = est.toFixed(1);
      if (!faixasGols[key]) faixasGols[key] = { est, total: 0, somaReais: 0, dist: {} };
      faixasGols[key].total++;
      faixasGols[key].somaReais += r.golsReais;
      const g = String(r.golsReais);
      faixasGols[key].dist[g] = (faixasGols[key].dist[g] || 0) + 1;
    });
    // Calcular média real por faixa
    const calibracaoGols = Object.values(faixasGols)
      .filter(f => f.total >= 10)
      .map(f => ({
        estimado: f.est,
        mediaReal: +(f.somaReais / f.total).toFixed(2),
        desvio: +(f.somaReais / f.total - f.est).toFixed(2),
        total: f.total,
        distribuicao: f.dist,
      }))
      .sort((a, b) => a.estimado - b.estimado);

    // ── PADRÃO 2: Resultado por faixa de probabilidade ──────────────
    // "Quando damos X% de chance, qual é o acerto real?"
    const faixasProb = [
      { label: '40-44%', min: 40, max: 44 },
      { label: '45-49%', min: 45, max: 49 },
      { label: '50-54%', min: 50, max: 54 },
      { label: '55-59%', min: 55, max: 59 },
      { label: '60-64%', min: 60, max: 64 },
      { label: '65-69%', min: 65, max: 69 },
      { label: '70%+',   min: 70, max: 100 },
    ];
    const calibracaoProb = faixasProb.map(f => {
      const sub = registros.filter(r => {
        const max = Math.max(r.probCasa||0, r.probEmpate||0, r.probFora||0);
        return max >= f.min && max <= f.max;
      });
      const acertos = sub.filter(r => r.acertouResultado).length;
      return {
        faixa: f.label,
        total: sub.length,
        acertos,
        pct: sub.length > 0 ? +(acertos / sub.length * 100).toFixed(1) : null,
        // Calibração perfeita seria: 45% prob → 45% acerto. Diferença = viés.
        vies: sub.length > 0 ? +((acertos / sub.length * 100) - ((f.min + f.max) / 2)).toFixed(1) : null,
      };
    }).filter(f => f.total >= 5);

    // ── PADRÃO 3: YS vs Resultado real ──────────────────────────────
    // "Quando o YS favorece X por N pontos, qual é a taxa de vitória?"
    const faixasYS = [
      { label: 'YS < 1',    min: 0,   max: 1   },
      { label: 'YS 1-2',    min: 1,   max: 2   },
      { label: 'YS 2-3',    min: 2,   max: 3   },
      { label: 'YS 3-4',    min: 3,   max: 4   },
      { label: 'YS 4-5',    min: 4,   max: 5   },
      { label: 'YS 5+',     min: 5,   max: 99  },
    ];
    const calibracaoYS = faixasYS.map(f => {
      const sub = registros.filter(r => {
        const diff = Math.abs((r.ysC||0) - (r.ysF||0));
        return diff >= f.min && diff < f.max && r.ysC !== null && r.ysF !== null;
      });
      // Verificar se o time com YS mais alto ganhou
      const favoritoVenceu = sub.filter(r => {
        const favErasCasa = (r.ysC||0) > (r.ysF||0);
        return (favErasCasa && r.resultadoReal === 'casa') ||
               (!favErasCasa && r.resultadoReal === 'fora');
      }).length;
      const empates = sub.filter(r => r.resultadoReal === 'empate').length;
      return {
        faixa: f.label,
        total: sub.length,
        favoritoVenceu,
        empates,
        azaraoVenceu: sub.length - favoritoVenceu - empates,
        pctFavorito: sub.length > 0 ? +(favoritoVenceu / sub.length * 100).toFixed(1) : null,
      };
    }).filter(f => f.total >= 10);

    // ── PADRÃO 4: Gols totais por faixa de YS combinado ─────────────
    // "Times com YS alto tendem a fazer mais gols?"
    const ysCombinadoFaixas = [
      { label: 'Ambos YS < 4',  filtro: r => (r.ysC||0) < 4 && (r.ysF||0) < 4 },
      { label: 'Um YS 4-6',     filtro: r => Math.max(r.ysC||0, r.ysF||0) >= 4 && Math.max(r.ysC||0, r.ysF||0) < 6 },
      { label: 'Um YS 6-8',     filtro: r => Math.max(r.ysC||0, r.ysF||0) >= 6 && Math.max(r.ysC||0, r.ysF||0) < 8 },
      { label: 'Um YS 8+',      filtro: r => Math.max(r.ysC||0, r.ysF||0) >= 8 },
    ];
    const golsPorYS = ysCombinadoFaixas.map(f => {
      const sub = registros.filter(r => r.ysC !== null && r.ysF !== null && f.filtro(r));
      const mediaGols = sub.length > 0 ? +(sub.reduce((a,r) => a + r.golsReais, 0) / sub.length).toFixed(2) : null;
      const over2 = sub.filter(r => r.golsReais > 2).length;
      const over3 = sub.filter(r => r.golsReais > 3).length;
      return {
        faixa: f.label,
        total: sub.length,
        mediaGols,
        pctOver2_5: sub.length > 0 ? +(over2/sub.length*100).toFixed(1) : null,
        pctOver3_5: sub.length > 0 ? +(over3/sub.length*100).toFixed(1) : null,
      };
    }).filter(f => f.total >= 10);

    // ── PADRÃO 5: Sequência de forma vs resultado ────────────────────
    // "Times em série de vitórias ganham mais? Qual o impacto real?"
    const formaPatterns = {};
    registros.forEach(r => {
      // Extrair forma da previsão se disponível
      if (!r.formaC || !r.formaF) return;
      const serieC = r.formaC.slice(0,3).join('');
      const serieF = r.formaF.slice(0,3).join('');
      const key = `${serieC}_vs_${serieF}`;
      if (!formaPatterns[key]) formaPatterns[key] = { total:0, casaVence:0, empate:0, foraVence:0 };
      formaPatterns[key].total++;
      if (r.resultadoReal === 'casa') formaPatterns[key].casaVence++;
      else if (r.resultadoReal === 'empate') formaPatterns[key].empate++;
      else formaPatterns[key].foraVence++;
    });
    // Top padrões de forma com mais amostras
    const topForma = Object.entries(formaPatterns)
      .filter(([k, v]) => v.total >= 8)
      .map(([padrao, v]) => ({
        padrao,
        total: v.total,
        pctCasa:  +(v.casaVence/v.total*100).toFixed(1),
        pctEmpate: +(v.empate/v.total*100).toFixed(1),
        pctFora:  +(v.foraVence/v.total*100).toFixed(1),
      }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 20);

    // ── SALVAR PADRÕES NO BANCO ──────────────────────────────────────
    await db.collection('padroes-universais').doc('calibracao_gols').set({
      dados: calibracaoGols, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), totalJogos: n
    });
    await db.collection('padroes-universais').doc('calibracao_prob').set({
      dados: calibracaoProb, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), totalJogos: n
    });
    await db.collection('padroes-universais').doc('calibracao_ys').set({
      dados: calibracaoYS, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), totalJogos: n
    });
    await db.collection('padroes-universais').doc('gols_por_ys').set({
      dados: golsPorYS, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), totalJogos: n
    });
    await db.collection('padroes-universais').doc('padroes_forma').set({
      dados: topForma, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), totalJogos: n
    });

    return {
      sucesso: true,
      totalJogos: n,
      calibracaoGols,
      calibracaoProb,
      calibracaoYS,
      golsPorYS,
      topForma: topForma.slice(0, 10),
    };
  });

// =====================================================
// 📊 ATUALIZAR FIXTURES-HISTÓRICO DIARIAMENTE
// Roda todo dia às 23:30 (horário Brasília)
// Coleta jogos encerrados de todas as ligas monitoradas
// e salva na coleção fixtures-historico para análise
// de padrões, Elo e perfil de times.
// =====================================================

exports.scheduleAtualizarHistoricoFixtures = functions.pubsub
  .schedule('30 23 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    try {
      const hoje = new Date();
      // Busca jogos dos últimos 3 dias (pega jogos que terminaram tarde / atualizaram depois)
      const datas = [];
      for (let i = 0; i <= 3; i++) {
        const d = new Date(hoje);
        d.setDate(d.getDate() - i);
        datas.push(d.toISOString().split('T')[0]);
      }

      // Ligas monitoradas — mesmas do mapeamento manual
      const LIGAS_MONITORADAS = [
        // Brasil
        { id: 71,  nome: 'Brasileirão A',     season: 2026, liga_tier: 1 },
        { id: 72,  nome: 'Brasileirão B',     season: 2026, liga_tier: 2 },
        { id: 73,  nome: 'Copa do Brasil',    season: 2026, liga_tier: 1 },
        // Sul-América
        { id: 13,  nome: 'Copa Libertadores', season: 2026, liga_tier: 1 },
        { id: 11,  nome: 'Copa Sudamericana', season: 2026, liga_tier: 1 },
        // Europa
        { id: 39,  nome: 'Premier League',   season: 2025, liga_tier: 1 },
        { id: 140, nome: 'La Liga',           season: 2025, liga_tier: 1 },
        { id: 135, nome: 'Serie A',           season: 2025, liga_tier: 1 },
        { id: 78,  nome: 'Bundesliga',        season: 2025, liga_tier: 1 },
        { id: 61,  nome: 'Ligue 1',           season: 2025, liga_tier: 1 },
        { id: 94,  nome: 'Primeira Liga',     season: 2025, liga_tier: 2 },
        // Internacionais
        { id: 2,   nome: 'Champions League',  season: 2025, liga_tier: 1 },
        { id: 3,   nome: 'Europa League',     season: 2025, liga_tier: 1 },
        { id: 848, nome: 'Conference League', season: 2025, liga_tier: 2 },
      ];

      let totalNovos = 0;
      let totalVerificados = 0;
      const erros = [];

      for (const ligaMeta of LIGAS_MONITORADAS) {
        try {
          // Busca jogos encerrados por liga + season
          const endpoint = `/fixtures?league=${ligaMeta.id}&season=${ligaMeta.season}&status=FT-AET-PEN`;
          const apiResult = await apiFootballGet(endpoint);
          const fixtures = apiResult.response || [];

          if (!fixtures.length) {
            console.log(`⚪ ${ligaMeta.nome}: nenhum jogo encerrado`);
            continue;
          }

          // Filtrar apenas jogos dos últimos 3 dias para não reprocessar tudo
          const fixturesFiltrados = fixtures.filter(f => {
            const dataJogo = f.fixture.date?.split('T')[0];
            return datas.includes(dataJogo);
          });

          if (!fixturesFiltrados.length) {
            console.log(`⚪ ${ligaMeta.nome}: nenhum jogo novo nos últimos 3 dias`);
            continue;
          }

          // Verificar quais já existem no banco
          const idsNovos = fixturesFiltrados.map(f => String(f.fixture.id));
          const jaExistemSnap = await db.collection('fixtures-historico')
            .where(admin.firestore.FieldPath.documentId(), 'in', idsNovos.slice(0, 10))
            .get();
          const jaExistem = new Set(jaExistemSnap.docs.map(d => d.id));

          // Para ids além de 10 (limite Firestore), checar individualmente
          const aVerificar = idsNovos.slice(10);
          for (const fid of aVerificar) {
            const doc = await db.collection('fixtures-historico').doc(fid).get();
            if (doc.exists) jaExistem.add(fid);
          }

          // Filtrar apenas os realmente novos
          const novos = fixturesFiltrados.filter(f => !jaExistem.has(String(f.fixture.id)));

          if (!novos.length) {
            console.log(`✅ ${ligaMeta.nome}: ${fixturesFiltrados.length} jogos já no banco`);
            totalVerificados += fixturesFiltrados.length;
            continue;
          }

          // Salvar novos no Firestore
          const batch = db.batch();
          novos.forEach(f => {
            const fid = String(f.fixture.id);
            const gc = f.goals.home ?? 0;
            const gf = f.goals.away ?? 0;
            const r = gc > gf ? 'casa' : gc < gf ? 'fora' : 'empate';

            batch.set(db.collection('fixtures-historico').doc(fid), {
              fixtureId: fid,
              ligaId:    ligaMeta.id,
              ligaNome:  ligaMeta.nome,
              ligaTier:  ligaMeta.liga_tier,
              season:    ligaMeta.season,
              data:      f.fixture.date,
              // Times
              casaId:    f.teams.home.id,
              casaNome:  f.teams.home.name,
              casaLogo:  f.teams.home.logo || '',
              foraId:    f.teams.away.id,
              foraNome:  f.teams.away.name,
              foraLogo:  f.teams.away.logo || '',
              // Resultado
              golsCasa:  gc,
              golsFora:  gf,
              htCasa:    f.score.halftime.home ?? null,
              htFora:    f.score.halftime.away ?? null,
              totalGols: gc + gf,
              over15:    (gc + gf) > 1,
              over25:    (gc + gf) > 2,
              over35:    (gc + gf) > 3,
              btts:      gc > 0 && gf > 0,
              resultado: r,
              status:    f.fixture.status.short || 'FT',
              // Meta
              stats:       null, // enriquecido depois se necessário
              ysPreCasa:   null,
              ysPreFora:   null,
              ysDiff:      null,
              ysFavorito:  null,
              ysTotal:     null,
              coletadoEm:  admin.firestore.FieldValue.serverTimestamp(),
              versao:      1,
            }, { merge: true });
          });

          await batch.commit();
          totalNovos += novos.length;
          totalVerificados += fixturesFiltrados.length;
          console.log(`✅ ${ligaMeta.nome}: +${novos.length} novos (${fixturesFiltrados.length} verificados)`);

          // Delay para não bater no rate limit
          await new Promise(r => setTimeout(r, 500));

        } catch (e) {
          erros.push(`${ligaMeta.nome}: ${e.message}`);
          console.error(`❌ Erro ${ligaMeta.nome}:`, e.message);
        }
      }

      // Log final
      const msg = `scheduleAtualizarHistoricoFixtures: ${totalNovos} novos jogos, ${totalVerificados} verificados${erros.length ? `, ${erros.length} erros` : ''}`;
      console.log(`📊 ${msg}`);

      // Salvar log da execução
      await db.collection('logs-historico').add({
        tipo: 'atualizacao_diaria',
        totalNovos,
        totalVerificados,
        erros,
        datasVerificadas: datas,
        executadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      return null;
    } catch (e) {
      console.error('❌ Erro scheduleAtualizarHistoricoFixtures:', e);
      return null;
    }
  });


// =====================================================
// 🔄 VERSÃO MANUAL (onCall) — para forçar atualização
// pelo painel admin sem esperar o agendamento
// Uso: fns.httpsCallable('atualizarHistoricoManual')({ diasAtras: 7 })
// =====================================================

exports.atualizarHistoricoManual = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!isAdminEmail(context)) {
      throw new functions.https.HttpsError('permission-denied', 'Apenas admin');
    }

    const diasAtras = data?.diasAtras ?? 7; // padrão: últimos 7 dias
    const ligaIdFiltro = data?.ligaId ?? null; // opcional: filtrar por liga

    const hoje = new Date();
    const datas = [];
    for (let i = 0; i <= diasAtras; i++) {
      const d = new Date(hoje);
      d.setDate(d.getDate() - i);
      datas.push(d.toISOString().split('T')[0]);
    }

    const LIGAS = ligaIdFiltro
      ? [{ id: ligaIdFiltro, nome: `Liga ${ligaIdFiltro}`, season: data?.season ?? 2025, liga_tier: 1 }]
      : [
          { id: 71,  nome: 'Brasileirão A',     season: 2026, liga_tier: 1 },
          { id: 72,  nome: 'Brasileirão B',     season: 2026, liga_tier: 2 },
          { id: 73,  nome: 'Copa do Brasil',    season: 2026, liga_tier: 1 },
          { id: 13,  nome: 'Copa Libertadores', season: 2026, liga_tier: 1 },
          { id: 11,  nome: 'Copa Sudamericana', season: 2026, liga_tier: 1 },
          { id: 39,  nome: 'Premier League',   season: 2025, liga_tier: 1 },
          { id: 140, nome: 'La Liga',           season: 2025, liga_tier: 1 },
          { id: 135, nome: 'Serie A',           season: 2025, liga_tier: 1 },
          { id: 78,  nome: 'Bundesliga',        season: 2025, liga_tier: 1 },
          { id: 61,  nome: 'Ligue 1',           season: 2025, liga_tier: 1 },
          { id: 94,  nome: 'Primeira Liga',     season: 2025, liga_tier: 2 },
          { id: 2,   nome: 'Champions League',  season: 2025, liga_tier: 1 },
          { id: 3,   nome: 'Europa League',     season: 2025, liga_tier: 1 },
          { id: 848, nome: 'Conference League', season: 2025, liga_tier: 2 },
        ];

    let totalNovos = 0;
    const detalhes = [];

    for (const ligaMeta of LIGAS) {
      try {
        const endpoint = `/fixtures?league=${ligaMeta.id}&season=${ligaMeta.season}&status=FT-AET-PEN`;
        const apiResult = await apiFootballGet(endpoint);
        const fixtures = (apiResult.response || []).filter(f => {
          const dataJogo = f.fixture.date?.split('T')[0];
          return datas.includes(dataJogo);
        });

        if (!fixtures.length) continue;

        // Verificar existência
        const ids = fixtures.map(f => String(f.fixture.id));
        const novos = [];
        for (const f of fixtures) {
          const doc = await db.collection('fixtures-historico').doc(String(f.fixture.id)).get();
          if (!doc.exists) novos.push(f);
        }

        if (!novos.length) {
          detalhes.push({ liga: ligaMeta.nome, novos: 0, verificados: fixtures.length });
          continue;
        }

        const batch = db.batch();
        novos.forEach(f => {
          const fid = String(f.fixture.id);
          const gc = f.goals.home ?? 0, gf = f.goals.away ?? 0;
          const r = gc > gf ? 'casa' : gc < gf ? 'fora' : 'empate';
          batch.set(db.collection('fixtures-historico').doc(fid), {
            fixtureId: fid, ligaId: ligaMeta.id, ligaNome: ligaMeta.nome,
            ligaTier: ligaMeta.liga_tier, season: ligaMeta.season,
            data: f.fixture.date,
            casaId: f.teams.home.id, casaNome: f.teams.home.name, casaLogo: f.teams.home.logo || '',
            foraId: f.teams.away.id, foraNome: f.teams.away.name, foraLogo: f.teams.away.logo || '',
            golsCasa: gc, golsFora: gf,
            htCasa: f.score.halftime.home ?? null, htFora: f.score.halftime.away ?? null,
            totalGols: gc + gf, over15: (gc+gf)>1, over25: (gc+gf)>2, over35: (gc+gf)>3,
            btts: gc>0 && gf>0, resultado: r, status: f.fixture.status.short || 'FT',
            stats: null, ysPreCasa: null, ysPreFora: null, ysDiff: null, ysFavorito: null, ysTotal: null,
            coletadoEm: admin.firestore.FieldValue.serverTimestamp(), versao: 1,
          }, { merge: true });
        });

        await batch.commit();
        totalNovos += novos.length;
        detalhes.push({ liga: ligaMeta.nome, novos: novos.length, verificados: fixtures.length });

        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        detalhes.push({ liga: ligaMeta.nome, erro: e.message });
      }
    }

    return { sucesso: true, totalNovos, diasAtras, detalhes };
  });

// =====================================================
// 🧠 CALCULAR PERFIS GLOBAIS DE TIMES
// Lê fixtures-historico, calcula Elo + métricas e
// salva na coleção perfis-times para uso centralizado.
// =====================================================

const LIGA_ELO_BASE_PERFIS = {
  'Premier League':1600,'La Liga':1580,'Bundesliga':1560,
  'Serie A':1540,'Ligue 1':1520,'Champions League':1620,
  'Europa League':1540,'Conference League':1500,
  'Copa Libertadores':1480,'Copa Sudamericana':1440,
  'Brasileirão A':1460,'Brasileirão B':1400,
  'Copa do Brasil':1440,'Primeira Liga':1480,'DEFAULT':1400,
};

function _getLigaBasePerfis(nome) {
  if (!nome) return 1400;
  for (const [k,v] of Object.entries(LIGA_ELO_BASE_PERFIS)) {
    if (k!=='DEFAULT' && nome.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return 1400;
}

function _eloParaNota(elo) {
  return Math.round(Math.min(10,Math.max(0,(elo-1200)/(1900-1200)*10))*10)/10;
}

function _calcForca(jogos,n=10){
  const js=jogos.slice(0,n); if(!js.length) return 0;
  const n2=js.length;
  const pts=js.reduce((a,j)=>a+(j.resultado==='V'?3:j.resultado==='E'?1:0),0);
  const gf=js.reduce((a,j)=>a+j.gols,0)/n2;
  const gs=js.reduce((a,j)=>a+j.golsSof,0)/n2;
  return Math.round(Math.min(10,(pts/n2)/3*5+Math.min(gf/2,2)+Math.max(0,1.5-gs/2))*10)/10;
}

function _calcStats(jogos){
  const n=jogos.length; if(!n) return null;
  const vit=jogos.filter(j=>j.resultado==='V').length;
  const emp=jogos.filter(j=>j.resultado==='E').length;
  const gf=jogos.reduce((a,j)=>a+j.gols,0)/n;
  const gs=jogos.reduce((a,j)=>a+j.golsSof,0)/n;
  const tot=jogos.reduce((a,j)=>a+j.total,0)/n;
  const pts=(vit*3+emp)/n;
  return {n,vit,emp,der:n-vit-emp,
    pts_jogo:+pts.toFixed(2),gf_media:+gf.toFixed(2),
    gs_media:+gs.toFixed(2),tot_media:+tot.toFixed(2)};
}

function _calcularEloGlobal(docs){
  const elos={}, histElo={};
  const sorted=[...docs].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  for(const doc of sorted){
    const {casaId,foraId,golsCasa,golsFora,ligaNome}=doc;
    if(!casaId||!foraId||golsCasa==null||golsFora==null) continue;
    const base=_getLigaBasePerfis(ligaNome);
    if(elos[casaId]==null) elos[casaId]=base;
    if(elos[foraId]==null) elos[foraId]=base;
    const ec=1/(1+Math.pow(10,(elos[foraId]-elos[casaId]-50)/400));
    const res=golsCasa>golsFora?1:golsCasa===golsFora?0.5:0;
    const diff=Math.abs(golsCasa-golsFora);
    const delta=32*(1+Math.min(diff*0.1,0.4))*(res-ec);
    elos[casaId]+=delta; elos[foraId]-=delta;
    if(!histElo[casaId]) histElo[casaId]=[];
    if(!histElo[foraId]) histElo[foraId]=[];
    histElo[casaId].push({data:doc.data,elo:elos[casaId]});
    histElo[foraId].push({data:doc.data,elo:elos[foraId]});
  }
  return {elos,histElo};
}

function _calcMomentum(hist,n){
  if(!hist||hist.length<n+1) return 0;
  return Math.round((hist[hist.length-1].elo-hist[hist.length-1-n].elo)/40*10)/10;
}

async function _processarPerfis(){
  // Carregar fixtures em batches
  let docs=[], last=null;
  while(true){
    let q=db.collection('fixtures-historico').orderBy('data','asc').limit(500);
    if(last) q=q.startAfter(last);
    const snap=await q.get();
    if(snap.empty) break;
    docs=docs.concat(snap.docs.map(d=>d.data()));
    last=snap.docs[snap.docs.length-1];
    if(snap.docs.length<500) break;
    if(docs.length>=15000) break;
  }
  console.log(`[perfis] ${docs.length} jogos carregados`);

  // Montar histórico de cada time
  const timesMap={};
  for(const doc of docs){
    for(const lado of ['casa','fora']){
      const tid=doc[`${lado}Id`];
      if(!tid) continue;
      if(!timesMap[tid]) timesMap[tid]={nome:doc[`${lado}Nome`],logo:doc[`${lado}Logo`]||'',jogos:[]};
      const gc2=doc.golsCasa||0,gf2=doc.golsFora||0,eh=lado==='casa';
      const r=doc.resultado||'';
      const res=(r==='casa'&&eh)||(r==='fora'&&!eh)?'V':r==='empate'?'E':'D';
      timesMap[tid].jogos.push({
        data:doc.data||'',gols:eh?gc2:gf2,golsSof:eh?gf2:gc2,
        total:gc2+gf2,resultado:res,casa:eh,
        adversarioId:eh?doc.foraId:doc.casaId,ligaNome:doc.ligaNome||''
      });
    }
  }
  for(const t of Object.values(timesMap)) t.jogos.sort((a,b)=>b.data.localeCompare(a.data));

  // Elo global
  const {elos,histElo}=_calcularEloGlobal(docs);

  // forca5 mapa para porForca
  const forca5Map={};
  for(const tid of Object.keys(timesMap)) forca5Map[tid]=_eloParaNota(elos[tid]||1400);

  // Salvar em batches de 400
  const BLIMIT=400;
  let batch=db.batch(), bCount=0, total=0;
  const agora=admin.firestore.FieldValue.serverTimestamp();

  for(const [tid,t] of Object.entries(timesMap)){
    if(t.jogos.length<3) continue;
    const jogos=t.jogos, hist=histElo[tid]||[];
    const elo=elos[tid]||_getLigaBasePerfis(jogos[0]?.ligaNome);

    // porForca
    const faixas={
      fraco:{casa:[],fora:[]},medio:{casa:[],fora:[]},
      bom:{casa:[],fora:[]},forte:{casa:[],fora:[]}
    };
    for(const j of jogos.slice(0,70)){
      const af=forca5Map[j.adversarioId]||5;
      const fk=af<3.5?'fraco':af<5.5?'medio':af<7.5?'bom':'forte';
      if(j.casa) faixas[fk].casa.push(j); else faixas[fk].fora.push(j);
    }
    const porForca={};
    const FLABELS={fraco:'vs Fracos (0–3.5)',medio:'vs Médios (3.5–5.5)',bom:'vs Bons (5.5–7.5)',forte:'vs Fortes (7.5+)'};
    for(const [key,f] of Object.entries(faixas)){
      const calc=(js)=>{
        const n=js.length; if(!n) return null;
        const gols=js.reduce((a,j)=>a+j.total,0)/n;
        const gf=js.reduce((a,j)=>a+j.gols,0)/n;
        const gs=js.reduce((a,j)=>a+j.golsSof,0)/n;
        const vit=js.filter(j=>j.resultado==='V').length;
        const emp=js.filter(j=>j.resultado==='E').length;
        return{n,gols:+gols.toFixed(2),gf:+gf.toFixed(2),gs:+gs.toFixed(2),
          vit,emp,der:n-vit-emp,over25:+( js.filter(j=>j.total>2).length/n*100).toFixed(0)};
      };
      porForca[key]={label:FLABELS[key],casa:calc(f.casa),fora:calc(f.fora),geral:calc([...f.casa,...f.fora])};
    }

    const jCasa=jogos.filter(j=>j.casa).slice(0,20);
    const jFora=jogos.filter(j=>!j.casa).slice(0,20);
    const s5=_calcStats(jogos.slice(0,5)), s10=_calcStats(jogos.slice(0,10));
    const s20=_calcStats(jogos.slice(0,20)), s70=_calcStats(jogos.slice(0,70));
    const forca5=_calcForca(jogos,5), forca10=_calcForca(jogos,10), forca20=_calcForca(jogos,20);
    const mom5=_calcMomentum(hist,5), mom10=_calcMomentum(hist,10), mom20=_calcMomentum(hist,20);

    batch.set(db.collection('perfis-times').doc(String(tid)),{
      teamId:Number(tid),nome:t.nome,logo:t.logo,totalJogos:jogos.length,
      elo:+elo.toFixed(0),eloNota:_eloParaNota(elo),
      mom5,mom10,mom20,forca5,forca10,forca20,
      s5,s10,s20,s70,
      statsCasa:_calcStats(jCasa),statsFora:_calcStats(jFora),
      porForca,
      tendencia:mom5>=0.8?'subindo':mom5<=-0.8?'caindo':'estavel',
      tendGolsTag:s5?.tot_media>=3?'alta':s5?.tot_media<=1.8?'baixa':'media',
      atualizadoEm:agora,
    },{merge:false});
    bCount++; total++;
    if(bCount>=BLIMIT){ await batch.commit(); batch=db.batch(); bCount=0; }
  }
  if(bCount>0) await batch.commit();

  await db.collection('logs-perfis').add({
    totalJogos:docs.length,totalTimes:total,executadoEm:agora
  });
  console.log(`[perfis] Concluído: ${total} times`);
  return{totalJogos:docs.length,totalTimes:total};
}

// Agendado: todo dia às 00:15 (após coleta das 23:30)
exports.scheduleCalcularPerfis = functions.pubsub
  .schedule('15 0 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async()=>{
    try{
      const r=await _processarPerfis();
      console.log(`✓ scheduleCalcularPerfis: ${r.totalTimes} times`);
    }catch(e){ console.error('❌ scheduleCalcularPerfis:',e); }
  });

// Manual: chamado pelo botão "Recalcular Perfis" no admin
exports.calcularPerfisManual = functions
  .runWith({timeoutSeconds:540,memory:'1GB'})
  .https.onCall(async(data,context)=>{
    if(!context.auth) throw new functions.https.HttpsError('unauthenticated','Login necessário');
    const email = context.auth.token?.email || '';
    if(email !== 'admin@yellup.com') throw new functions.https.HttpsError('permission-denied','Apenas admin');
    try{
      const r=await _processarPerfis();
      return{sucesso:true,...r};
    }catch(e){
      throw new functions.https.HttpsError('internal',e.message);
    }
  });
