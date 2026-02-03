/**
 * YELLUP - Cloud Function para Bolsa de Valores
 * 
 * ÚNICA FUNÇÃO NECESSÁRIA para manter a Bolsa segura
 * 
 * O que ela faz:
 * 1. Comprador chama essa função
 * 2. Função valida se comprador tem créditos
 * 3. Função valida se ordem de venda existe e está ativa
 * 4. Função executa TUDO de forma atômica:
 *    - Desconta créditos do comprador
 *    - Credita créditos ao vendedor
 *    - Transfere cotas
 *    - Atualiza ordem
 *    - Registra transação
 * 
 * INSTALAÇÃO:
 * 1. No terminal, na pasta do projeto: firebase init functions
 * 2. Copie este arquivo para functions/index.js
 * 3. npm install (na pasta functions)
 * 4. firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// =====================================================
// EXECUTAR COMPRA NA BOLSA (Transferência segura)
// =====================================================

exports.executarCompraBolsa = functions.https.onCall(async (data, context) => {
  // 1. Verificar autenticação
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  const compradorId = context.auth.uid;
  const { ordemId, quantidade } = data;

  // 2. Validar dados de entrada
  if (!ordemId || !quantidade || quantidade <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos');
  }

  try {
    // 3. Executar tudo em uma TRANSAÇÃO ATÔMICA
    const resultado = await db.runTransaction(async (transaction) => {
      
      // 3.1 Buscar ordem de venda
      const ordemRef = db.collection('bolsa_ordens').doc(ordemId);
      const ordemDoc = await transaction.get(ordemRef);
      
      if (!ordemDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Ordem não encontrada');
      }
      
      const ordem = ordemDoc.data();
      
      // 3.2 Validar ordem
      if (ordem.status !== 'ativa') {
        throw new functions.https.HttpsError('failed-precondition', 'Ordem não está ativa');
      }
      
      if (ordem.tipo !== 'venda') {
        throw new functions.https.HttpsError('failed-precondition', 'Esta não é uma ordem de venda');
      }
      
      const vendedorId = ordem.userId;
      
      if (vendedorId === compradorId) {
        throw new functions.https.HttpsError('failed-precondition', 'Você não pode comprar sua própria ordem');
      }
      
      const quantidadeDisponivel = ordem.quantidadeRestante || ordem.quantidade;
      
      if (quantidade > quantidadeDisponivel) {
        throw new functions.https.HttpsError('failed-precondition', 
          `Quantidade indisponível. Disponível: ${quantidadeDisponivel}`);
      }
      
      // 3.3 Calcular valor total
      const precoUnitario = ordem.precoUnitario;
      const valorTotal = quantidade * precoUnitario;
      
      // 3.4 Buscar comprador e validar créditos
      const compradorRef = db.collection('usuarios').doc(compradorId);
      const compradorDoc = await transaction.get(compradorRef);
      
      if (!compradorDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Comprador não encontrado');
      }
      
      const compradorData = compradorDoc.data();
      const creditosComprador = compradorData.creditos || 0;
      
      if (creditosComprador < valorTotal) {
        throw new functions.https.HttpsError('resource-exhausted', 
          `Créditos insuficientes. Necessário: ${valorTotal}, Disponível: ${creditosComprador}`);
      }
      
      // 3.5 Buscar vendedor
      const vendedorRef = db.collection('usuarios').doc(vendedorId);
      const vendedorDoc = await transaction.get(vendedorRef);
      
      if (!vendedorDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Vendedor não encontrado');
      }
      
      // 3.6 Buscar/criar cota do comprador
      const timeId = ordem.timeId;
      const cotaCompradorQuery = await db.collection('bolsa_cotas')
        .where('userId', '==', compradorId)
        .where('timeId', '==', timeId)
        .limit(1)
        .get();
      
      let cotaCompradorRef;
      let cotaCompradorAtual = 0;
      
      if (cotaCompradorQuery.empty) {
        // Criar nova cota
        cotaCompradorRef = db.collection('bolsa_cotas').doc();
      } else {
        cotaCompradorRef = cotaCompradorQuery.docs[0].ref;
        cotaCompradorAtual = cotaCompradorQuery.docs[0].data().quantidade || 0;
      }
      
      // 3.7 Buscar cota do vendedor
      const cotaVendedorQuery = await db.collection('bolsa_cotas')
        .where('userId', '==', vendedorId)
        .where('timeId', '==', timeId)
        .limit(1)
        .get();
      
      if (cotaVendedorQuery.empty) {
        throw new functions.https.HttpsError('failed-precondition', 'Vendedor não possui cotas');
      }
      
      const cotaVendedorRef = cotaVendedorQuery.docs[0].ref;
      const cotaVendedorAtual = cotaVendedorQuery.docs[0].data().quantidade || 0;
      
      if (cotaVendedorAtual < quantidade) {
        throw new functions.https.HttpsError('failed-precondition', 'Vendedor não possui cotas suficientes');
      }
      
      // =====================================================
      // 4. EXECUTAR TODAS AS OPERAÇÕES ATÔMICAS
      // =====================================================
      
      // 4.1 Descontar créditos do comprador
      transaction.update(compradorRef, {
        creditos: admin.firestore.FieldValue.increment(-valorTotal)
      });
      
      // 4.2 Creditar vendedor
      transaction.update(vendedorRef, {
        creditos: admin.firestore.FieldValue.increment(valorTotal)
      });
      
      // 4.3 Transferir cotas - Adicionar ao comprador
      if (cotaCompradorQuery.empty) {
        transaction.set(cotaCompradorRef, {
          userId: compradorId,
          timeId: timeId,
          quantidade: quantidade,
          precoMedio: precoUnitario,
          dataAquisicao: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Calcular novo preço médio
        const novaQuantidade = cotaCompradorAtual + quantidade;
        const precoMedioAntigo = cotaCompradorQuery.docs[0].data().precoMedio || precoUnitario;
        const novoPrecoMedio = ((cotaCompradorAtual * precoMedioAntigo) + (quantidade * precoUnitario)) / novaQuantidade;
        
        transaction.update(cotaCompradorRef, {
          quantidade: admin.firestore.FieldValue.increment(quantidade),
          precoMedio: novoPrecoMedio
        });
      }
      
      // 4.4 Transferir cotas - Remover do vendedor
      const novaQuantidadeVendedor = cotaVendedorAtual - quantidade;
      if (novaQuantidadeVendedor <= 0) {
        transaction.delete(cotaVendedorRef);
      } else {
        transaction.update(cotaVendedorRef, {
          quantidade: admin.firestore.FieldValue.increment(-quantidade)
        });
      }
      
      // 4.5 Atualizar ordem
      const novaQuantidadeRestante = quantidadeDisponivel - quantidade;
      const novoStatus = novaQuantidadeRestante <= 0 ? 'executada' : 'ativa';
      
      transaction.update(ordemRef, {
        quantidadeRestante: novaQuantidadeRestante,
        status: novoStatus,
        dataAtualizacao: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // 4.6 Registrar transação
      const transacaoRef = db.collection('bolsa_transacoes').doc();
      transaction.set(transacaoRef, {
        ordemId: ordemId,
        compradorId: compradorId,
        vendedorId: vendedorId,
        timeId: timeId,
        quantidade: quantidade,
        precoUnitario: precoUnitario,
        valorTotal: valorTotal,
        data: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: true,
        transacaoId: transacaoRef.id,
        quantidade: quantidade,
        valorTotal: valorTotal,
        novaQuantidadeOrdem: novaQuantidadeRestante
      };
    });
    
    console.log(`Transação executada: Comprador ${compradorId} comprou ${quantidade} cotas por ${resultado.valorTotal}`);
    
    return resultado;
    
  } catch (error) {
    console.error('Erro na transação da Bolsa:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', 'Erro ao processar transação');
  }
});

// =====================================================
// CREDITAR USUÁRIO (Para pagamentos e premiações)
// =====================================================

exports.creditarUsuario = functions.https.onCall(async (data, context) => {
  const { userId, creditos, motivo, secret } = data;
  
  // Verificar se é admin ou chamada com secret válido
  const expectedSecret = functions.config().yellup?.admin_secret;
  const isAdminEmail = context.auth?.token?.email === 'admin@yellup.com';
  
  if (!isAdminEmail && secret !== expectedSecret) {
    throw new functions.https.HttpsError('permission-denied', 'Acesso negado');
  }
  
  if (!userId || !creditos || creditos <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos');
  }
  
  try {
    await db.collection('usuarios').doc(userId).update({
      creditos: admin.firestore.FieldValue.increment(creditos),
      creditosPagos: admin.firestore.FieldValue.increment(creditos)
    });
    
    // Registrar transação
    await db.collection('transacoes').add({
      usuarioId: userId,
      tipo: 'credito',
      valor: creditos,
      motivo: motivo || 'Crédito manual',
      data: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Creditado ${creditos} para usuário ${userId}`);
    
    return { success: true, creditos };
    
  } catch (error) {
    console.error('Erro ao creditar:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao creditar usuário');
  }
});

// =====================================================
// PREMIAÇÃO DE JOGO (distribui créditos aos vencedores)
// =====================================================

exports.premiarJogo = functions.https.onCall(async (data, context) => {
  // Apenas admin
  if (context.auth?.token?.email !== 'admin@yellup.com') {
    throw new functions.https.HttpsError('permission-denied', 'Apenas admin pode premiar');
  }
  
  const { jogoId, vencedores } = data;
  // vencedores = [{ odId: '...', premio: 100 }, ...]
  
  if (!jogoId || !vencedores || !Array.isArray(vencedores)) {
    throw new functions.https.HttpsError('invalid-argument', 'Dados inválidos');
  }
  
  try {
    const batch = db.batch();
    
    for (const v of vencedores) {
      const userRef = db.collection('usuarios').doc(v.odId);
      batch.update(userRef, {
        creditos: admin.firestore.FieldValue.increment(v.premio),
        yc: admin.firestore.FieldValue.increment(v.premio)
      });
    }
    
    // Marcar jogo como premiado
    const jogoRef = db.collection('jogos').doc(jogoId);
    batch.update(jogoRef, {
      premiado: true,
      dataPremiacao: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await batch.commit();
    
    console.log(`Jogo ${jogoId} premiado. ${vencedores.length} vencedores.`);
    
    return { success: true, totalVencedores: vencedores.length };
    
  } catch (error) {
    console.error('Erro ao premiar:', error);
    throw new functions.https.HttpsError('internal', 'Erro ao premiar jogo');
  }
});
