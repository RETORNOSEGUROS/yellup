
function getTituloEvolucao(nivel) {
  if (nivel >= 20) return { titulo: "Lendário", icone: "👑" };
  if (nivel >= 15) return { titulo: "Veterano", icone: "🏅" };
  if (nivel >= 10) return { titulo: "Fanático", icone: "🔥" };
  if (nivel >= 5) return { titulo: "Blindado", icone: "🛡️" };
  return { titulo: "Curioso", icone: "🔰" };
}
