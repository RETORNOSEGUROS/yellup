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
