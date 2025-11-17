/**
 * YELLUP - Sistema de Patrocinadores
 * 
 * Componente para exibir banners e logos de patrocinadores
 * Suporta múltiplos formatos e posicionamentos
 * 
 * AUTOR: Claude + Seu Nome
 * DATA: 2025-01-17
 */

class PatrocinadorService {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
  }

  /**
   * Busca patrocinadores ativos
   * Com cache para evitar consultas repetidas
   * 
   * @param {string} posicao - 'header', 'sidebar', 'banner', 'rodape'
   * @returns {Promise<Array>} Array de patrocinadores
   */
  async buscarPatrocinadores(posicao = 'banner') {
    try {
      // Verifica cache (válido por 5 minutos)
      const cacheKey = `patrocinadores_${posicao}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
        console.log("[PATROCINADORES] Usando cache");
        return cached.data;
      }

      // Busca no Firestore
      const snap = await this.db
        .collection("patrocinadores")
        .where("ativo", "==", true)
        .where("posicao", "==", posicao)
        .orderBy("ordem", "asc")
        .get();

      const patrocinadores = [];
      snap.forEach(doc => {
        patrocinadores.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Salva no cache
      this.cache.set(cacheKey, {
        data: patrocinadores,
        timestamp: Date.now()
      });

      console.log(`[PATROCINADORES] ${patrocinadores.length} encontrados em ${posicao}`);
      return patrocinadores;

    } catch (error) {
      console.error("[PATROCINADORES] Erro ao buscar:", error);
      return [];
    }
  }

  /**
   * Registra clique em patrocinador (analytics)
   * 
   * @param {string} patrocinadorId - ID do patrocinador
   */
  async registrarClique(patrocinadorId) {
    try {
      const userId = this.auth?.currentUser?.uid || 'anonimo';
      
      await this.db.collection("patrocinadores_clicks").add({
        patrocinadorId,
        userId,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        userAgent: navigator.userAgent
      });

      // Incrementa contador
      await this.db
        .collection("patrocinadores")
        .doc(patrocinadorId)
        .update({
          totalCliques: firebase.firestore.FieldValue.increment(1)
        });

      console.log("[PATROCINADORES] Clique registrado");

    } catch (error) {
      console.error("[PATROCINADORES] Erro ao registrar clique:", error);
    }
  }

  /**
   * Renderiza patrocinadores na página
   * 
   * @param {string} containerId - ID do elemento onde renderizar
   * @param {string} posicao - Posição dos patrocinadores
   * @param {string} estilo - 'banner', 'logo', 'carousel'
   */
  async renderizar(containerId, posicao, estilo = 'banner') {
    try {
      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`[PATROCINADORES] Container ${containerId} não encontrado`);
        return;
      }

      const patrocinadores = await this.buscarPatrocinadores(posicao);

      if (patrocinadores.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.innerHTML = '';
      container.style.display = 'block';

      if (estilo === 'banner') {
        this.renderizarBanner(container, patrocinadores);
      } else if (estilo === 'logo') {
        this.renderizarLogos(container, patrocinadores);
      } else if (estilo === 'carousel') {
        this.renderizarCarousel(container, patrocinadores);
      }

    } catch (error) {
      console.error("[PATROCINADORES] Erro ao renderizar:", error);
    }
  }

  /**
   * Renderiza como banner simples
   */
  renderizarBanner(container, patrocinadores) {
    patrocinadores.forEach(p => {
      const banner = document.createElement('a');
      banner.href = p.link || '#';
      banner.target = '_blank';
      banner.rel = 'noopener noreferrer';
      banner.className = 'patrocinador-banner';
      banner.style.cssText = `
        display: block;
        margin: 15px 0;
        border-radius: 12px;
        overflow: hidden;
        transition: transform 0.3s;
      `;
      
      banner.innerHTML = `
        <img 
          src="${p.imagemUrl}" 
          alt="${p.nome}"
          style="width: 100%; height: auto; display: block;"
        />
      `;

      banner.addEventListener('mouseenter', () => {
        banner.style.transform = 'scale(1.02)';
      });

      banner.addEventListener('mouseleave', () => {
        banner.style.transform = 'scale(1)';
      });

      banner.addEventListener('click', () => {
        this.registrarClique(p.id);
      });

      container.appendChild(banner);
    });
  }

  /**
   * Renderiza como logos pequenos (footer style)
   */
  renderizarLogos(container, patrocinadores) {
    container.style.cssText = `
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      padding: 20px 0;
    `;

    patrocinadores.forEach(p => {
      const logo = document.createElement('a');
      logo.href = p.link || '#';
      logo.target = '_blank';
      logo.rel = 'noopener noreferrer';
      logo.title = p.nome;
      logo.style.cssText = `
        opacity: 0.7;
        transition: opacity 0.3s;
      `;

      logo.innerHTML = `
        <img 
          src="${p.logoUrl || p.imagemUrl}" 
          alt="${p.nome}"
          style="height: 40px; width: auto;"
        />
      `;

      logo.addEventListener('mouseenter', () => {
        logo.style.opacity = '1';
      });

      logo.addEventListener('mouseleave', () => {
        logo.style.opacity = '0.7';
      });

      logo.addEventListener('click', () => {
        this.registrarClique(p.id);
      });

      container.appendChild(logo);
    });
  }

  /**
   * Renderiza como carousel rotativo
   */
  renderizarCarousel(container, patrocinadores) {
    if (patrocinadores.length === 0) return;

    let currentIndex = 0;

    const carouselHTML = `
      <div class="patrocinador-carousel" style="position: relative; overflow: hidden; border-radius: 12px;">
        <div class="carousel-item" id="carousel-content"></div>
        ${patrocinadores.length > 1 ? `
          <button class="carousel-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; padding: 10px 15px; border-radius: 50%; cursor: pointer;">‹</button>
          <button class="carousel-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; padding: 10px 15px; border-radius: 50%; cursor: pointer;">›</button>
          <div class="carousel-dots" style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px;"></div>
        ` : ''}
      </div>
    `;

    container.innerHTML = carouselHTML;

    const contentEl = container.querySelector('#carousel-content');
    const dotsContainer = container.querySelector('.carousel-dots');

    const showSlide = (index) => {
      const p = patrocinadores[index];
      contentEl.innerHTML = `
        <a href="${p.link || '#'}" target="_blank" rel="noopener noreferrer" onclick="patrocinadorService.registrarClique('${p.id}')">
          <img src="${p.imagemUrl}" alt="${p.nome}" style="width: 100%; height: auto; display: block;" />
        </a>
      `;

      // Atualiza dots
      if (dotsContainer) {
        dotsContainer.innerHTML = patrocinadores.map((_, i) => 
          `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${i === index ? 'white' : 'rgba(255,255,255,0.5)'}; cursor: pointer;" data-index="${i}"></span>`
        ).join('');

        dotsContainer.querySelectorAll('span').forEach((dot, i) => {
          dot.addEventListener('click', () => {
            currentIndex = i;
            showSlide(currentIndex);
          });
        });
      }
    };

    // Navegação
    const prevBtn = container.querySelector('.carousel-prev');
    const nextBtn = container.querySelector('.carousel-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        currentIndex = (currentIndex - 1 + patrocinadores.length) % patrocinadores.length;
        showSlide(currentIndex);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        currentIndex = (currentIndex + 1) % patrocinadores.length;
        showSlide(currentIndex);
      });
    }

    // Auto-play (10 segundos)
    if (patrocinadores.length > 1) {
      setInterval(() => {
        currentIndex = (currentIndex + 1) % patrocinadores.length;
        showSlide(currentIndex);
      }, 10000);
    }

    // Mostra primeiro slide
    showSlide(0);
  }
}

// CSS para patrocinadores
const style = document.createElement('style');
style.textContent = `
  .patrocinador-banner {
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    cursor: pointer;
  }

  .patrocinador-banner:hover {
    box-shadow: 0 6px 20px rgba(0,0,0,0.3);
  }

  .patrocinador-carousel {
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  @media (max-width: 768px) {
    .patrocinador-banner {
      margin: 10px 0;
    }
  }
`;
document.head.appendChild(style);

// Exportar para uso global
window.PatrocinadorService = PatrocinadorService;

// Exemplo de uso:
// const patrocinadorService = new PatrocinadorService(db);
// await patrocinadorService.renderizar('patrocinadores-container', 'banner', 'carousel');
