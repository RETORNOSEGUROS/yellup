const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// =====================================================
// FUNÇÃO: EXECUTAR COMPRA NA BOLSA
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

    console.log(`✅ Missão ${missaoId} creditada para ${userId}: +${creditosRecompensa} créditos`);
    return { success: true, creditos: creditosRecompensa };

  } catch (error) {
    console.error('❌ Erro ao completar missão:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Erro ao completar missão');
  }
});
