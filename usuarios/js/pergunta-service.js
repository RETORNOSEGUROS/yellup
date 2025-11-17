/**
 * YELLUP - Sistema de Perguntas Aleatórias
 * 
 * Resolve o problema de perguntas sempre na mesma ordem
 * Garante que cada usuário tenha experiência única
 * 
 * AUTOR: Claude + Seu Nome
 * DATA: 2025-01-17
 */

class PerguntaService {
  constructor(db, auth) {
    this.db = db;
    this.auth = auth;
  }

  /**
   * Busca perguntas disponíveis para o usuário
   * Exclui as que já foram respondidas
   * Embaralha aleatoriamente
   * 
   * @param {string} jogoId - ID do jogo
   * @param {number} quantidade - Quantas perguntas buscar (padrão: 1)
   * @returns {Promise<Array>} Array de perguntas aleatórias
   */
  async buscarPerguntasAleatorias(jogoId, quantidade = 1) {
    try {
      const userId = this.auth.currentUser?.uid;
      if (!userId) throw new Error("Usuário não autenticado");

      // 1. Buscar histórico do usuário neste jogo
      const historicoRef = this.db
        .collection("usuarios")
        .doc(userId)
        .collection("historico_perguntas")
        .doc(jogoId);
      
      const historicoDoc = await historicoRef.get();
      const perguntasRespondidas = historicoDoc.exists 
        ? (historicoDoc.data()?.respondidas || [])
        : [];

      console.log(`[PERGUNTAS] Usuário já respondeu ${perguntasRespondidas.length} perguntas`);

      // 2. Buscar TODAS as perguntas do jogo
      const todasPerguntasSnap = await this.db
        .collection("perguntas")
        .where("jogoId", "==", jogoId)
        .get();

      if (todasPerguntasSnap.empty) {
        throw new Error("Nenhuma pergunta cadastrada para este jogo");
      }

      // 3. Filtrar perguntas não respondidas
      const perguntasDisponiveis = [];
      todasPerguntasSnap.forEach(doc => {
        if (!perguntasRespondidas.includes(doc.id)) {
          perguntasDisponiveis.push({
            id: doc.id,
            ...doc.data()
          });
        }
      });

      console.log(`[PERGUNTAS] ${perguntasDisponiveis.length} perguntas disponíveis`);

      // 4. Verificar se ainda há perguntas
      if (perguntasDisponiveis.length === 0) {
        // RESET: usuário respondeu todas! Libera tudo de novo
        console.log("[PERGUNTAS] Usuário respondeu tudo! Resetando...");
        await historicoRef.set({ respondidas: [], resetadoEm: new Date() });
        
        // Busca de novo
        perguntasDisponiveis.length = 0;
        todasPerguntasSnap.forEach(doc => {
          perguntasDisponiveis.push({
            id: doc.id,
            ...doc.data()
          });
        });
      }

      // 5. Embaralhar usando algoritmo Fisher-Yates
      this.embaralhar(perguntasDisponiveis);

      // 6. Retornar quantidade solicitada
      const perguntasSelecionadas = perguntasDisponiveis.slice(0, quantidade);

      console.log(`[PERGUNTAS] Retornando ${perguntasSelecionadas.length} perguntas aleatórias`);
      
      return perguntasSelecionadas;

    } catch (error) {
      console.error("[PERGUNTAS] Erro ao buscar perguntas:", error);
      throw error;
    }
  }

  /**
   * Registra que o usuário respondeu uma pergunta
   * Atualiza o histórico
   * 
   * @param {string} jogoId - ID do jogo
   * @param {string} perguntaId - ID da pergunta respondida
   * @param {boolean} acertou - Se acertou ou errou
   * @param {number} pontos - Pontos ganhos
   */
  async registrarResposta(jogoId, perguntaId, acertou, pontos) {
    try {
      const userId = this.auth.currentUser?.uid;
      if (!userId) throw new Error("Usuário não autenticado");

      const historicoRef = this.db
        .collection("usuarios")
        .doc(userId)
        .collection("historico_perguntas")
        .doc(jogoId);

      // Adiciona pergunta ao histórico
      await historicoRef.set({
        respondidas: this.db.FieldValue.arrayUnion(perguntaId),
        ultimaResposta: new Date(),
        totalRespondidas: this.db.FieldValue.increment(1),
        totalAcertos: acertou ? this.db.FieldValue.increment(1) : 0,
        pontosGanhos: this.db.FieldValue.increment(pontos || 0)
      }, { merge: true });

      console.log(`[PERGUNTAS] Resposta registrada: ${acertou ? '✅' : '❌'} +${pontos}pts`);

    } catch (error) {
      console.error("[PERGUNTAS] Erro ao registrar resposta:", error);
      throw error;
    }
  }

  /**
   * Verifica quantas perguntas o usuário ainda pode responder
   * 
   * @param {string} jogoId - ID do jogo
   * @returns {Promise<Object>} { disponiveis, respondidas, total }
   */
  async obterEstatisticas(jogoId) {
    try {
      const userId = this.auth.currentUser?.uid;
      if (!userId) throw new Error("Usuário não autenticado");

      // Total de perguntas do jogo
      const totalSnap = await this.db
        .collection("perguntas")
        .where("jogoId", "==", jogoId)
        .get();
      
      const total = totalSnap.size;

      // Perguntas respondidas pelo usuário
      const historicoRef = this.db
        .collection("usuarios")
        .doc(userId)
        .collection("historico_perguntas")
        .doc(jogoId);
      
      const historicoDoc = await historicoRef.get();
      const respondidas = historicoDoc.exists 
        ? (historicoDoc.data()?.respondidas || []).length
        : 0;

      const disponiveis = total - respondidas;

      return {
        total,
        respondidas,
        disponiveis,
        percentual: total > 0 ? Math.round((respondidas / total) * 100) : 0
      };

    } catch (error) {
      console.error("[PERGUNTAS] Erro ao obter estatísticas:", error);
      return { total: 0, respondidas: 0, disponiveis: 0, percentual: 0 };
    }
  }

  /**
   * Embaralha array usando Fisher-Yates shuffle
   * Modifica o array in-place
   * 
   * @param {Array} array - Array para embaralhar
   */
  embaralhar(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Sistema de perguntas grátis (3 por dia)
   * Verifica se usuário ainda tem jogadas grátis disponíveis
   * 
   * @returns {Promise<Object>} { temGratis, quantidade, proximoReset }
   */
  async verificarJogadasGratis() {
    try {
      const userId = this.auth.currentUser?.uid;
      if (!userId) throw new Error("Usuário não autenticado");

      const userRef = this.db.collection("usuarios").doc(userId);
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const ultimoReset = userData.jogadasGratis?.ultimoReset?.toDate();
      const jogadasUsadas = userData.jogadasGratis?.usadas || 0;

      // Reset diário
      if (!ultimoReset || ultimoReset < hoje) {
        await userRef.update({
          'jogadasGratis.usadas': 0,
          'jogadasGratis.ultimoReset': hoje
        });

        return {
          temGratis: true,
          quantidade: 3,
          proximoReset: this.calcularProximoReset()
        };
      }

      const restantes = Math.max(0, 3 - jogadasUsadas);

      return {
        temGratis: restantes > 0,
        quantidade: restantes,
        proximoReset: this.calcularProximoReset()
      };

    } catch (error) {
      console.error("[JOGADAS GRÁTIS] Erro:", error);
      return { temGratis: false, quantidade: 0 };
    }
  }

  /**
   * Consome uma jogada grátis
   */
  async consumirJogadaGratis() {
    try {
      const userId = this.auth.currentUser?.uid;
      if (!userId) throw new Error("Usuário não autenticado");

      const userRef = this.db.collection("usuarios").doc(userId);
      
      await userRef.update({
        'jogadasGratis.usadas': this.db.FieldValue.increment(1)
      });

      console.log("[JOGADAS GRÁTIS] Jogada consumida");
      
    } catch (error) {
      console.error("[JOGADAS GRÁTIS] Erro ao consumir:", error);
      throw error;
    }
  }

  /**
   * Calcula horário do próximo reset (meia-noite)
   */
  calcularProximoReset() {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(0, 0, 0, 0);
    return amanha;
  }
}

// Exportar para uso global
window.PerguntaService = PerguntaService;

// Exemplo de uso:
// const perguntaService = new PerguntaService(db, auth);
// const perguntas = await perguntaService.buscarPerguntasAleatorias(jogoId, 1);
