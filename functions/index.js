const functions = require('firebase-functions');
const admin = require('firebase-admin');

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
  diario: { preco: 2.90, duracaoDias: 1, nome: 'Passe Diário' },
  mensal: { preco: 19.90, duracaoDias: 30, nome: 'Passe Mensal' }
};

const CONFIG_LIMITES = {
  free: { partidasPorDia: 2, pvpPorDia: 1, timerPerguntaSeg: 300, bauCreditos: 5, missoes: 3 },
  diario: { partidasPorDia: 999, pvpPorDia: 999, timerPerguntaSeg: 120, bauCreditos: 10, missoes: 5 },
  mensal: { partidasPorDia: 999, pvpPorDia: 999, timerPerguntaSeg: 120, bauCreditos: 15, missoes: 7 }
};

const CONFIG_PVP = {
  taxaEntradaMin: 5,
  taxaEntradaMax: 15,
  premioSistemaEmbate: 40,
  premioSistemaPenalti: 30
};

const CONFIG_PARTIDA = {
  // Prêmio do sistema por jogo (distribuído entre participantes)
  premioBasePorJogo: 100,          // créditos base para distribuir no ranking
  premioPorParticipante: 5,        // + 5 créditos por participante (escala com engajamento)
  premioMaxPorJogo: 500,           // teto máximo por jogo
  // Percentuais do ranking
  percentuaisRanking: [30, 20, 15, 10, 7, 5, 4, 3, 3, 3],
  // Anti-bot: tempo mínimo para responder (segundos)
  tempoMinimoResposta: 3
};

// Campos padrão para novos usuários (inicialização)
const CAMPOS_PADRAO_USUARIO = {
  passe: {
    tipo: 'free',           // 'free', 'diario', 'mensal'
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
    const tipoPasse = (passe.ativo && passe.tipo !== 'free') ? passe.tipo : 'free';
    const config = CONFIG_LIMITES[tipoPasse] || CONFIG_LIMITES.free;
    const limite = tipo === 'partida' ? config.partidasPorDia : config.pvpPorDia;
    return { permitido: true, restante: limite, limite, tipoPasse };
  }

  // Mesmo dia — verificar contadores
  const tipoPasse = (passe.ativo && passe.tipo !== 'free') ? passe.tipo : 'free';
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
 * Recebe: { paymentId, tipoPasse: 'diario'|'mensal' }
 */
exports.ativarPasse = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const uid = context.auth.uid;
  const { paymentId, tipoPasse } = data;

  if (!paymentId || !tipoPasse || !['diario', 'mensal'].includes(tipoPasse)) {
    throw new functions.https.HttpsError('invalid-argument', 'paymentId e tipoPasse (diario/mensal) obrigatórios');
  }

  try {
    // Verificar duplicidade
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

    const aposta = embate.aposta;
    const participantes = embate.participantes || [];

    const batch = db.batch();

    // Devolver créditos a todos os participantes
    for (const odId of participantes) {
      batch.update(db.collection('usuarios').doc(odId), {
        creditos: admin.firestore.FieldValue.increment(aposta)
      });

      // Registrar transação de reembolso
      const transRef = db.collection('transacoes').doc();
      batch.set(transRef, {
        usuarioId: odId,
        tipo: 'credito',
        valor: aposta,
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
        await logAtividade(odId, 'reembolso_pvp', aposta, null,
          `PvP: reembolso — embate ${embate.codigo || embateId} cancelado`,
          { embateId, aposta });
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

    // Verificar se já foi premiado
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

    // Verificar se já foi creditado (evitar duplicidade)
    const novoUserDoc = await db.collection('usuarios').doc(novoUserId).get();
    if (!novoUserDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Usuário novo não encontrado');
    }

    const indicadorData = indicadorDoc.data();
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
// [DEPRECATED] FUNÇÃO: CREDITAR COMPRA DE CRÉDITOS
// ⚠️ Será removida na Fase 1 — substituída por ativarPasse
// Mantida para processar pagamentos pendentes
// =====================================================
exports.creditarCompra = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login primeiro');
  }

  const userId = context.auth.uid;
  const { paymentId, pacoteId, creditos, bonus, externalRef } = data;

  if (!paymentId || !creditos) {
    throw new functions.https.HttpsError('invalid-argument', 'paymentId e creditos são obrigatórios');
  }

  try {
    // Verificar se pagamento já foi processado (evitar duplicidade)
    const pagamentoDoc = await db.collection('pagamentos_mp').doc(String(paymentId)).get();
    if (pagamentoDoc.exists) {
      console.log('⚠️ Pagamento já processado:', paymentId);
      return { success: true, jaProcessado: true };
    }

    const totalCreditos = (creditos || 0) + (bonus || 0);

    // Ler saldo atual para log
    const userDocAtual = await db.collection('usuarios').doc(userId).get();
    const saldoAnterior = userDocAtual.data()?.creditos || 0;

    const batch = db.batch();

    // Creditar usuário
    const userRef = db.collection('usuarios').doc(userId);
    batch.update(userRef, {
      creditos: admin.firestore.FieldValue.increment(totalCreditos),
      creditosPagos: admin.firestore.FieldValue.increment(creditos),
      creditosBonus: admin.firestore.FieldValue.increment(bonus || 0)
    });

    // Registrar pagamento
    const pagRef = db.collection('pagamentos_mp').doc(String(paymentId));
    batch.set(pagRef, {
      usuarioId: userId,
      creditos: creditos,
      bonus: bonus || 0,
      totalCreditos: totalCreditos,
      status: 'aprovado',
      externalReference: externalRef || '',
      processadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    // Registrar transação
    const transRef = db.collection('transacoes').doc();
    batch.set(transRef, {
      usuarioId: userId,
      tipo: 'credito',
      valor: totalCreditos,
      descricao: `Compra de ${creditos} créditos${bonus > 0 ? ` + ${bonus} bônus` : ''}`,
      paymentId: String(paymentId),
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // 📋 Log
    await logAtividade(userId, 'compra', totalCreditos, saldoAnterior,
      `Compra MP: ${creditos} cr${bonus > 0 ? ` + ${bonus} bônus` : ''} (client-side)`,
      { paymentId: String(paymentId), pacoteId, creditosBase: creditos, bonus: bonus || 0, origem: 'client' });

    console.log(`✅ Compra processada: ${userId} recebeu ${totalCreditos} créditos (pagamento ${paymentId})`);
    return { success: true, totalCreditos: totalCreditos };

  } catch (error) {
    console.error('❌ Erro ao creditar compra:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao creditar compra');
  }
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
  const { embateId, taxaEntrada } = data;

  if (!embateId || !taxaEntrada || taxaEntrada < CONFIG_PVP.taxaEntradaMin || taxaEntrada > CONFIG_PVP.taxaEntradaMax) {
    throw new functions.https.HttpsError('invalid-argument',
      `Taxa de entrada deve ser entre ${CONFIG_PVP.taxaEntradaMin} e ${CONFIG_PVP.taxaEntradaMax} créditos`);
  }

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

    // Marcar embate como v2 (prêmio do sistema)
    batch.update(db.collection('embates').doc(embateId), {
      modeloV2: true,
      taxaEntrada: taxaEntrada,
      premioSistema: CONFIG_PVP.premioSistemaEmbate,
      // NÃO tem prizePool — prêmio é fixo do sistema
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

    // Log + Stats
    await logAtividade(uid, 'debito_pvp_v2', -taxaEntrada, creditos,
      `PvP v2: taxa entrada embate ${embate.codigo || embateId}`,
      { embateId, taxaEntrada, modeloV2: true });

    console.log(`✅ Embate v2 criado: ${uid} queimou ${taxaEntrada} cr (prêmio sistema: ${CONFIG_PVP.premioSistemaEmbate})`);

    return {
      success: true,
      mensagem: `Taxa cobrada: ${taxaEntrada} créditos. Prêmio ao vencedor: ${CONFIG_PVP.premioSistemaEmbate} créditos!`,
      premioSistema: CONFIG_PVP.premioSistemaEmbate
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

    const taxaEntrada = embate.taxaEntrada || embate.aposta || CONFIG_PVP.taxaEntradaMin;

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

    // QUEIMAR taxa
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
    return { success: true, mensagem: `Entrada confirmada! -${taxaEntrada} créditos` };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro aceitarEmbateV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao aceitar embate');
  }
});

/**
 * FINALIZAR EMBATE v2 — Prêmio do SISTEMA, não do pool dos jogadores
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

    // PRÊMIO DO SISTEMA (não do pool!)
    const premio = embate.premioSistema || CONFIG_PVP.premioSistemaEmbate;
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
        premioSistema: premio,
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
            descricao: `🏆 Prêmio do sistema: embate ${embate.codigo || embateId}`,
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
          descricao: `🏆 Prêmio do sistema: embate ${embate.codigo || embateId}`,
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
      dataFinalizacao: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    console.log(`✅ Embate v2 ${embateId} finalizado. Prêmio sistema: ${premio} cr`);
    return { success: true, resultado, premio, fontePremio: 'sistema' };

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

    // 2. Verificar se já está participando deste jogo
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const userData = userDoc.data() || {};
    const jaParticipando = userData.torcidas?.[jogoId];

    if (jaParticipando) {
      // Já entrou neste jogo — retorna status atual
      const passe = await verificarPasse(uid);
      return {
        success: true, jaEntrou: true,
        timerSegundos: passe.config.timerPerguntaSeg,
        tipoPasse: passe.tipo
      };
    }

    // 3. Verificar limite diário de partidas
    const limite = await verificarLimiteDiario(uid, 'partida');
    if (!limite.permitido) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Limite diário de partidas atingido (${limite.limite}/${limite.limite}). ${limite.tipoPasse === 'free' ? 'Adquira um Passe para jogar ilimitado!' : ''}`);
    }

    // 4. Verificar se o time existe e pertence ao jogo
    if (timeId !== jogo.timeCasaId && timeId !== jogo.timeForaId) {
      throw new functions.https.HttpsError('invalid-argument', 'Time não pertence a este jogo');
    }

    // 5. Registrar entrada
    const passe = await verificarPasse(uid);

    await db.collection('usuarios').doc(uid).update({
      [`torcidas.${jogoId}`]: timeId,
      'limitesDiarios.ultimoReset': admin.firestore.FieldValue.serverTimestamp()
    });

    // 6. Incrementar limite diário
    await incrementarLimiteDiario(uid, 'partida');

    // 7. Atualizar stats
    await db.collection('usuarios').doc(uid).update({
      'stats.diasAtivos': admin.firestore.FieldValue.increment(0), // será calculado no rating
      'stats.ultimoLogin': admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`⚽ ${uid} entrou no jogo ${jogoId} (time: ${timeId}, passe: ${passe.tipo})`);

    return {
      success: true,
      jaEntrou: false,
      timerSegundos: passe.config.timerPerguntaSeg,
      tipoPasse: passe.tipo,
      partidasRestantes: limite.restante - 1
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('❌ Erro entrarPartidaV2:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao entrar na partida');
  }
});


/**
 * RESPONDER PERGUNTA v2 — Sem custo de créditos, com timer server-side
 * Mudanças vs v1:
 * - NÃO cobra créditos para jogar
 * - NÃO adiciona créditos ao pool do jogo
 * - VERIFICA timer entre perguntas (server-side)
 * - RASTREIA stats para cálculo de rating
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
    // 1. Buscar pergunta (server-side - seguro)
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

    // 6. TIMER SERVER-SIDE: verificar intervalo entre perguntas
    const passe = await verificarPasse(uid);
    const timerNecessario = passe.config.timerPerguntaSeg; // 300s free, 120s pass

    const participanteRef = db.collection('jogos').doc(jogoId).collection('participantes').doc(uid);
    const participanteDoc = await participanteRef.get();
    const participante = participanteDoc.exists ? participanteDoc.data() : {};

    const ultimaResposta = participante.ultimaRespostaEm?.toDate?.() || null;
    if (ultimaResposta) {
      const segundosDesdeUltima = (agora.getTime() - ultimaResposta.getTime()) / 1000;
      // Tolerância de 5 segundos (latência de rede)
      if (segundosDesdeUltima < (timerNecessario - 5)) {
        const faltam = Math.ceil(timerNecessario - segundosDesdeUltima);
        throw new functions.https.HttpsError('failed-precondition',
          `Aguarde ${faltam}s para a próxima pergunta. ${passe.tipo === 'free' ? 'Com Passe o timer é de apenas 2min!' : ''}`);
      }
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

    // 10. Atualizar tudo em batch (atômico)
    const batch = db.batch();
    const userRef = db.collection('usuarios').doc(uid);

    const userUpdates = {
      [`perguntasRespondidas_${timeTorcida}`]: admin.firestore.FieldValue.arrayUnion(perguntaId),
      // Stats para rating
      'stats.totalPerguntas': admin.firestore.FieldValue.increment(1),
      'stats.ultimoLogin': admin.firestore.FieldValue.serverTimestamp()
    };

    // NÃO cobra créditos — v2 é gratuito para jogar
    // NÃO adiciona ao pool do jogo — prêmio vem do sistema

    if (acertou) {
      userUpdates[`pontuacoes.${jogoId}`] = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates.xp = admin.firestore.FieldValue.increment(pontosFinais);
      userUpdates[`tempoRespostas.${jogoId}.soma`] = admin.firestore.FieldValue.increment(tempoRespostaSegundos);
      userUpdates[`tempoRespostas.${jogoId}.quantidade`] = admin.firestore.FieldValue.increment(1);
      userUpdates['stats.totalAcertos'] = admin.firestore.FieldValue.increment(1);
    }

    batch.update(userRef, userUpdates);

    // Atualizar participante (com timestamp da resposta para timer)
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
      ultimaRespostaEm: admin.firestore.Timestamp.now(),  // ← TIMER: marca quando respondeu
      modeloV2: true,
      atualizadoEm: admin.firestore.Timestamp.now()
    }, { merge: true });

    await batch.commit();

    // 11. Retornar resultado
    return {
      acertou,
      respostaCorreta: pergunta.correta,
      respostaTexto: pergunta.alternativas?.[pergunta.correta] || '',
      pontosGanhos: pontosFinais,
      pontuacaoBase,
      multiplicador,
      streak: streakAtual,
      maxStreak: maxStreakVal,
      timerProximaPergunta: timerNecessario,
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

  const { jogoId } = data;
  if (!jogoId) throw new functions.https.HttpsError('invalid-argument', 'jogoId obrigatório');

  try {
    // 1. Ler dados do jogo
    const jogoDoc = await db.collection('jogos').doc(jogoId).get();
    if (!jogoDoc.exists) throw new functions.https.HttpsError('not-found', 'Jogo não encontrado');
    const jogoData = jogoDoc.data();

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

    // 4. CALCULAR PRÊMIO DO SISTEMA (não dos jogadores!)
    const numParticipantes = participantes.length;
    const premioCalculado = CONFIG_PARTIDA.premioBasePorJogo +
      (numParticipantes * CONFIG_PARTIDA.premioPorParticipante);
    const totalPremio = Math.min(premioCalculado, CONFIG_PARTIDA.premioMaxPorJogo);

    // Função auxiliar
    function arredondar(valor) {
      if (valor <= 0) return 0;
      return Math.max(1, Math.round(valor));
    }

    // 5. Distribuição 100% ranking (mérito puro)
    const PERCENTUAIS = CONFIG_PARTIDA.percentuaisRanking;
    const top100 = participantes.slice(0, 100);
    const creditosPorPosicao = [];
    let creditosDistribuidos = 0;

    if (top100.length <= 10) {
      const perc = PERCENTUAIS.slice(0, top100.length);
      const somaPerc = perc.reduce((a, b) => a + b, 0);
      for (let i = 0; i < top100.length; i++) {
        const cr = arredondar(totalPremio * perc[i] / somaPerc);
        creditosPorPosicao.push(cr);
        creditosDistribuidos += cr;
      }
    } else {
      const creditosTop10 = arredondar(totalPremio * 0.70);
      const creditosRestante = totalPremio - creditosTop10;
      for (let i = 0; i < 10; i++) {
        const cr = arredondar(creditosTop10 * PERCENTUAIS[i] / 100);
        creditosPorPosicao.push(cr);
        creditosDistribuidos += cr;
      }
      const restantes = top100.length - 10;
      for (let i = 10; i < top100.length; i++) {
        const peso = Math.max(1, restantes - (i - 10));
        const somaPesos = (restantes * (restantes + 1)) / 2;
        const cr = arredondar(creditosRestante * peso / somaPesos);
        creditosPorPosicao.push(cr);
        creditosDistribuidos += cr;
      }
    }

    // Ajustar diferença no 1º lugar
    const diferenca = totalPremio - creditosDistribuidos;
    if (diferenca !== 0 && creditosPorPosicao.length > 0) {
      creditosPorPosicao[0] += diferenca;
    }

    // 6. Distribuir prêmios em batch
    const premiosRanking = [];
    let batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < top100.length; i++) {
      const p = top100[i];
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
      fontePremio: 'sistema',
      totalPremio,
      premioBase: CONFIG_PARTIDA.premioBasePorJogo,
      bonusParticipantes: numParticipantes * CONFIG_PARTIDA.premioPorParticipante,
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
// 🔧 MIGRAÇÃO: Adicionar campos v2 a usuários existentes
// Executar UMA VEZ via admin dashboard ou manualmente
// =====================================================
exports.migrarUsuariosV2 = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Faça login');
  }

  // Verificar se é admin
  const adminDoc = await db.collection('usuarios').doc(context.auth.uid).get();
  if (!adminDoc.data()?.isAdmin) {
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
