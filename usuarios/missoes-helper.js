/**
 * YELLUP - Helper de Missões
 * Inclua este script em todas as páginas que precisam atualizar missões.
 * 
 * Uso:
 *   <script src="missoes-helper.js"></script>
 *   
 *   // Depois de responder uma pergunta:
 *   MissoesHelper.registrar(userId, 'responder_3');
 *   
 *   // Depois de escolher um time:
 *   MissoesHelper.registrar(userId, 'torcer_1');
 *   
 *   // Depois de compartilhar link de indicação:
 *   MissoesHelper.registrar(userId, 'convidar_1');
 *   
 *   // O baú já atualiza direto, não precisa chamar daqui.
 */

window.MissoesHelper = {

  /**
   * Incrementa progresso de uma missão. Funciona mesmo que:
   * - O documento da missão ainda não exista hoje (cria automaticamente)
   * - O documento seja de um dia anterior (reseta e conta o novo progresso)
   * - A missão já esteja concluída (ignora silenciosamente)
   */
  registrar: async function(userId, missaoId) {
    if (!userId || !missaoId) return;

    try {
      const db = firebase.firestore();
      const ref = db.collection('usuarios').doc(userId).collection('missoes').doc(missaoId);
      const doc = await ref.get();

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      if (!doc.exists) {
        // Documento não existe - criar com progresso 1
        const config = MissoesHelper._configs[missaoId];
        if (!config) { console.warn('Missão desconhecida:', missaoId); return; }

        const concluido = 1 >= config.total;
        await ref.set({
          id: missaoId,
          titulo: config.titulo,
          descricao: config.descricao,
          total: config.total,
          icone: config.icone,
          tipo: config.tipo,
          recompensa_creditos: config.creditos,
          recompensa_xp: config.xp,
          atual: 1,
          concluido: concluido,
          creditada: false,
          data: firebase.firestore.Timestamp.now()
        });

        if (concluido) MissoesHelper._tentarCreditar(missaoId);
        console.log(`✅ Missão ${missaoId}: criada e progresso 1/${config.total}`);
        return;
      }

      const dados = doc.data();
      const dataM = dados.data && dados.data.toDate ? dados.data.toDate() : null;

      // Se a missão é de outro dia → resetar e contar como 1
      if (dataM && dataM < hoje) {
        const total = dados.total || 1;
        const concluido = 1 >= total;
        await ref.update({
          atual: 1,
          concluido: concluido,
          creditada: false,
          data: firebase.firestore.Timestamp.now()
        });

        if (concluido) MissoesHelper._tentarCreditar(missaoId);
        console.log(`✅ Missão ${missaoId}: resetada para hoje, progresso 1/${total}`);
        return;
      }

      // Missão de hoje
      if (dados.concluido) {
        // Já concluída hoje, ignorar
        return;
      }

      const novo = (dados.atual || 0) + 1;
      const total = dados.total || 1;
      const concluido = novo >= total;

      await ref.update({
        atual: novo,
        concluido: concluido
      });

      if (concluido) MissoesHelper._tentarCreditar(missaoId);
      console.log(`✅ Missão ${missaoId}: progresso ${novo}/${total}${concluido ? ' ✅ COMPLETA!' : ''}`);

    } catch (e) {
      console.warn('MissoesHelper.registrar erro:', e);
    }
  },

  /**
   * Tenta creditar via Cloud Function (não bloqueia se falhar)
   */
  _tentarCreditar: async function(missaoId) {
    try {
      const fn = firebase.functions().httpsCallable('completarMissao');
      await fn({ missaoId });
    } catch (e) {
      console.warn('MissoesHelper: Cloud Function falhou (será creditado manualmente):', e.message);
    }
  },

  /**
   * Configurações das missões (para criar docs quando não existem)
   */
  _configs: {
    responder_3: {
      titulo: 'Responda 3 perguntas',
      descricao: 'Entre em qualquer jogo ao vivo e responda 3 perguntas',
      total: 3,
      creditos: 2,
      xp: 10,
      icone: '❓',
      tipo: 'diaria'
    },
    torcer_1: {
      titulo: 'Torça para 1 time',
      descricao: 'Acesse um jogo ao vivo e escolha um time para torcer',
      total: 1,
      creditos: 2,
      xp: 5,
      icone: '📣',
      tipo: 'diaria'
    },
    convidar_1: {
      titulo: 'Convide 1 amigo',
      descricao: 'Vá em Indicações e compartilhe seu link com alguém',
      total: 1,
      creditos: 1,
      xp: 10,
      icone: '🔗',
      tipo: 'diaria'
    },
    abrir_bau: {
      titulo: 'Abra o Baú Diário',
      descricao: 'Vá no Baú Diário e abra para tentar ganhar créditos',
      total: 1,
      creditos: 1,
      xp: 5,
      icone: '🎁',
      tipo: 'diaria'
    }
  }
};
