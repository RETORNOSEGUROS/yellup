
// Calcula o nível com base no XP atual
function calcularNivel(xp) {
  let nivel = 1;
  while (xp >= nivel * nivel * 100) {
    nivel++;
  }
  return nivel;
}

// Adiciona XP ao usuário, calcula novo nível, atualiza Firestore
async function adicionarXP(usuarioId, quantidade) {
  const ref = db.collection("usuarios").doc(usuarioId);
  const doc = await ref.get();
  if (!doc.exists) return;

  let xpAtual = doc.data().xp || 0;
  let nivelAtual = doc.data().nivel || 1;

  xpAtual += quantidade;
  const novoNivel = calcularNivel(xpAtual);

  const updates = { xp: xpAtual };
  if (novoNivel > nivelAtual) {
    updates.nivel = novoNivel;
    updates.dataUltimaSubida = firebase.firestore.Timestamp.now();

    // Conquista de nível
    await ref.collection("conquistas").add({
      tipo: `Nível ${novoNivel}`,
      descricao: `Você atingiu o nível ${novoNivel}`,
      data: firebase.firestore.Timestamp.now()
    });
  }

  await ref.update(updates);
}

// Barra visual de progresso
function exibirBarraProgressoXP(xp, nivel) {
  const next = nivel * nivel * 100;
  const prev = (nivel - 1) * (nivel - 1) * 100;
  const atual = xp - prev;
  const total = next - prev;
  const perc = Math.round((atual / total) * 100);

  return `
    <div style="margin-top:10px;">
      <div style="font-size:14px;">Nível ${nivel} – XP: ${xp}</div>
      <div style="background:#ddd; border-radius:8px; height:10px; overflow:hidden;">
        <div style="width:${perc}%; height:10px; background:#4caf50;"></div>
      </div>
    </div>
  `;
}

async function carregarXP(usuarioId) {
  const doc = await db.collection("usuarios").doc(usuarioId).get();
  if (!doc.exists) return;
  const xp = doc.data().xp || 0;
  const nivel = doc.data().nivel || 1;
  document.getElementById("barraXP").innerHTML = exibirBarraProgressoXP(xp, nivel);
}
