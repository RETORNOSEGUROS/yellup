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
    if (embate.status !== 'em_andamento' && embate.status !== 'respondendo') {
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
