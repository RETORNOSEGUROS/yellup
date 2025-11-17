/**
 * YELLUP - Player de Rádio ao Vivo
 * 
 * Permite torcedores ouvirem transmissões de rádio durante o jogo
 * Suporta múltiplas rádios por jogo
 * 
 * AUTOR: Claude + Seu Nome
 * DATA: 2025-01-17
 */

class RadioService {
  constructor(db) {
    this.db = db;
    this.audioPlayer = null;
    this.currentRadio = null;
    this.isPlaying = false;
  }

  /**
   * Busca rádios disponíveis para um jogo
   * 
   * @param {string} jogoId - ID do jogo
   * @returns {Promise<Array>} Array de rádios
   */
  async buscarRadios(jogoId) {
    try {
      // Busca rádios específicas do jogo
      const jogoRadios = await this.db
        .collection("jogos")
        .doc(jogoId)
        .collection("radios")
        .where("ativo", "==", true)
        .get();

      const radios = [];
      jogoRadios.forEach(doc => {
        radios.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Se não houver rádios específicas, busca rádios gerais dos times
      if (radios.length === 0) {
        const jogoDoc = await this.db.collection("jogos").doc(jogoId).get();
        const jogo = jogoDoc.data();

        if (jogo) {
          // Busca rádios do time da casa
          const radioCasaSnap = await this.db
            .collection("times")
            .doc(jogo.timeCasaId)
            .collection("radios")
            .where("ativo", "==", true)
            .get();

          radioCasaSnap.forEach(doc => {
            radios.push({
              id: doc.id,
              timeId: jogo.timeCasaId,
              ...doc.data()
            });
          });

          // Busca rádios do time visitante
          const radioForaSnap = await this.db
            .collection("times")
            .doc(jogo.timeForaId)
            .collection("radios")
            .where("ativo", "==", true)
            .get();

          radioForaSnap.forEach(doc => {
            radios.push({
              id: doc.id,
              timeId: jogo.timeForaId,
              ...doc.data()
            });
          });
        }
      }

      console.log(`[RÁDIO] ${radios.length} rádios disponíveis para o jogo`);
      return radios;

    } catch (error) {
      console.error("[RÁDIO] Erro ao buscar rádios:", error);
      return [];
    }
  }

  /**
   * Renderiza o player de rádio na página
   * 
   * @param {string} containerId - ID do elemento container
   * @param {string} jogoId - ID do jogo
   */
  async renderizarPlayer(containerId, jogoId) {
    try {
      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`[RÁDIO] Container ${containerId} não encontrado`);
        return;
      }

      const radios = await this.buscarRadios(jogoId);

      if (radios.length === 0) {
        container.innerHTML = `
          <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center; color: #a9b5c6;">
            <p>📻 Nenhuma rádio disponível para este jogo</p>
          </div>
        `;
        return;
      }

      const playerHTML = `
        <div class="radio-player" style="background: linear-gradient(135deg, #18222e 0%, #1e2936 100%); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin: 15px 0;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="flex: 1;">
              <div style="color: #a9b5c6; font-size: 0.85em; margin-bottom: 5px;">📻 Ouça a Transmissão</div>
              <select id="radio-select" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 1em;">
                ${radios.map(r => `
                  <option value="${r.id}" data-url="${r.streamUrl}">${r.nome}</option>
                `).join('')}
              </select>
            </div>
            <button id="radio-play-btn" style="width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #2f6fed 0%, #1a4eb8 100%); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; transition: transform 0.2s;">
              ▶️
            </button>
          </div>
          
          <div id="radio-info" style="display: none; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-top: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="radio-pulse" style="width: 12px; height: 12px; border-radius: 50%; background: #2ecc71; animation: pulse 1.5s infinite;"></div>
              <div style="color: #2ecc71; font-weight: bold;">🔴 AO VIVO</div>
            </div>
            <div id="radio-name" style="color: white; font-size: 1.1em; font-weight: bold; margin-top: 8px;"></div>
            <div style="color: #a9b5c6; font-size: 0.9em; margin-top: 5px;">
              Volume: <input type="range" id="radio-volume" min="0" max="100" value="70" style="width: 150px; vertical-align: middle;">
            </div>
          </div>

          <audio id="radio-audio" preload="none"></audio>
        </div>
      `;

      container.innerHTML = playerHTML;

      // Inicializa controles
      this.setupControls();

    } catch (error) {
      console.error("[RÁDIO] Erro ao renderizar player:", error);
    }
  }

  /**
   * Configura controles do player
   */
  setupControls() {
    const playBtn = document.getElementById('radio-play-btn');
    const select = document.getElementById('radio-select');
    const volumeSlider = document.getElementById('radio-volume');
    const audioEl = document.getElementById('radio-audio');
    const infoDiv = document.getElementById('radio-info');
    const nameDiv = document.getElementById('radio-name');

    if (!playBtn || !select || !audioEl) return;

    this.audioPlayer = audioEl;

    // Play/Pause
    playBtn.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pause();
        playBtn.textContent = '▶️';
        playBtn.style.background = 'linear-gradient(135deg, #2f6fed 0%, #1a4eb8 100%)';
        infoDiv.style.display = 'none';
      } else {
        const selectedOption = select.options[select.selectedIndex];
        const url = selectedOption.dataset.url;
        const name = selectedOption.text;
        
        this.play(url, name);
        playBtn.textContent = '⏸️';
        playBtn.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
        infoDiv.style.display = 'block';
        nameDiv.textContent = name;
      }
    });

    // Troca de rádio
    select.addEventListener('change', () => {
      if (this.isPlaying) {
        const selectedOption = select.options[select.selectedIndex];
        const url = selectedOption.dataset.url;
        const name = selectedOption.text;
        
        this.play(url, name);
        nameDiv.textContent = name;
      }
    });

    // Volume
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        if (this.audioPlayer) {
          this.audioPlayer.volume = e.target.value / 100;
        }
      });
      // Define volume inicial
      this.audioPlayer.volume = 0.7;
    }

    // Hover effect no botão
    playBtn.addEventListener('mouseenter', () => {
      playBtn.style.transform = 'scale(1.1)';
    });

    playBtn.addEventListener('mouseleave', () => {
      playBtn.style.transform = 'scale(1)';
    });

    // Error handling
    audioEl.addEventListener('error', (e) => {
      console.error("[RÁDIO] Erro no stream:", e);
      alert('Erro ao conectar com a rádio. Tente outra!');
      this.pause();
      playBtn.textContent = '▶️';
      playBtn.style.background = 'linear-gradient(135deg, #2f6fed 0%, #1a4eb8 100%)';
      infoDiv.style.display = 'none';
    });
  }

  /**
   * Inicia reprodução
   */
  play(streamUrl, radioName) {
    try {
      if (!this.audioPlayer) return;

      this.audioPlayer.src = streamUrl;
      this.audioPlayer.play();
      this.isPlaying = true;
      this.currentRadio = radioName;

      console.log(`[RÁDIO] Tocando: ${radioName}`);

      // Registra analytics
      this.registrarEscuta(streamUrl, radioName);

    } catch (error) {
      console.error("[RÁDIO] Erro ao tocar:", error);
      alert('Erro ao iniciar a rádio');
    }
  }

  /**
   * Pausa reprodução
   */
  pause() {
    if (this.audioPlayer) {
      this.audioPlayer.pause();
      this.audioPlayer.src = '';
      this.isPlaying = false;
      console.log("[RÁDIO] Pausado");
    }
  }

  /**
   * Registra que usuário está ouvindo (analytics)
   */
  async registrarEscuta(streamUrl, radioName) {
    try {
      const userId = firebase.auth().currentUser?.uid || 'anonimo';

      await this.db.collection("radio_escutas").add({
        userId,
        streamUrl,
        radioName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent
      });

    } catch (error) {
      console.error("[RÁDIO] Erro ao registrar escuta:", error);
    }
  }
}

// CSS para animação
const style = document.createElement('style');
style.textContent = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }

  .radio-pulse {
    animation: pulse 1.5s infinite;
  }

  #radio-select {
    cursor: pointer;
  }

  #radio-select:focus {
    outline: 2px solid #2f6fed;
  }

  #radio-volume {
    cursor: pointer;
  }
`;
document.head.appendChild(style);

// Exportar para uso global
window.RadioService = RadioService;

// Exemplo de uso:
// const radioService = new RadioService(db);
// await radioService.renderizarPlayer('radio-container', jogoId);
