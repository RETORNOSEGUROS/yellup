
async function carregarRankingPvP() {
  const tabela = document.getElementById("tabelaRankingPvP");
  tabela.innerHTML = "<tr><td colspan='4'>Carregando...</td></tr>";

  try {
    const snap = await db.collection("desafios").where("status", "==", "finalizado").get();
    const mapa = {};

    snap.forEach(doc => {
      const d = doc.data();

      [d.jogadorA, d.jogadorB].forEach(jogador => {
        const id = jogador.uid;
        if (!mapa[id]) {
          mapa[id] = { nome: jogador.nome, vitorias: 0, derrotas: 0 };
        }
      });

      const vencedorId = d.vencedor;
      const perdedorId = d.jogadorA.uid === vencedorId ? d.jogadorB.uid : d.jogadorA.uid;

      mapa[vencedorId].vitorias++;
      mapa[perdedorId].derrotas++;
    });

    const ranking = Object.values(mapa).map(p => ({
      ...p,
      partidas: p.vitorias + p.derrotas
    })).sort((a, b) => b.vitorias - a.vitorias);

    tabela.innerHTML = ranking.slice(0, 10).map(p => `
      <tr>
        <td>${p.nome}</td>
        <td>${p.vitorias}</td>
        <td>${p.derrotas}</td>
        <td>${p.partidas}</td>
      </tr>`).join("");

  } catch (e) {
    console.error("Erro ao carregar ranking PvP:", e);
    tabela.innerHTML = "<tr><td colspan='4'>Erro ao carregar ranking.</td></tr>";
  }
}
