import { db } from "../firebase/firebase-config.js";
import {
  collection,
  getDocs,
  addDoc
} from "firebase/firestore";

const listaTimes = document.getElementById("listaTimes");
const buscaInput = document.getElementById("buscaTime");

function desenharCamiseta(cor1, cor2, cor3, estilo) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "50");
  svg.setAttribute("height", "50");
  svg.setAttribute("viewBox", "0 0 64 64");

  const base = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  base.setAttribute("x", "12");
  base.setAttribute("y", "15");
  base.setAttribute("width", "40");
  base.setAttribute("height", "40");
  base.setAttribute("fill", cor1);
  svg.appendChild(base);

  const gola = document.createElementNS("http://www.w3.org/2000/svg", "path");
  gola.setAttribute("d", "M22,15 Q32,5 42,15");
  gola.setAttribute("stroke", cor3);
  gola.setAttribute("stroke-width", "3");
  gola.setAttribute("fill", "none");
  svg.appendChild(gola);

  if (estilo === "listrada") {
    for (let i = 0; i < 3; i++) {
      const faixa = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      faixa.setAttribute("x", 14 + i * 10);
      faixa.setAttribute("y", "15");
      faixa.setAttribute("width", "6");
      faixa.setAttribute("height", "40");
      faixa.setAttribute("fill", cor3);
      svg.appendChild(faixa);
    }
  } else if (estilo === "faixa") {
    const faixa = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    faixa.setAttribute("x", "12");
    faixa.setAttribute("y", "32");
    faixa.setAttribute("width", "40");
    faixa.setAttribute("height", "6");
    faixa.setAttribute("fill", cor3);
    svg.appendChild(faixa);
  } else if (estilo === "diagonal") {
    const diag = document.createElementNS("http://www.w3.org/2000/svg", "path");
    diag.setAttribute("d", "M12,50 L52,15");
    diag.setAttribute("stroke", cor3);
    diag.setAttribute("stroke-width", "6");
    svg.appendChild(diag);
  }

  return svg;
}

function renderizarTimes(times) {
  listaTimes.innerHTML = "";
  times.forEach(doc => {
    const { nome, pais, primaria, secundaria, terciaria, estilo } = doc.data();
    const linha = document.createElement("tr");

    linha.innerHTML = `
      <td>${nome}</td>
      <td>${pais}</td>
      <td class="camisa-cell"></td>
      <td><button onclick="editarTime('${doc.id}')">Editar</button></td>
    `;

    const celulaCamisa = linha.querySelector(".camisa-cell");
    const svg = desenharCamiseta(primaria, secundaria, terciaria, estilo);
    celulaCamisa.appendChild(svg);

    listaTimes.appendChild(linha);
  });
}

async function carregarTimes() {
  const snap = await getDocs(collection(db, "times"));
  renderizarTimes(snap.docs);
}

function cadastrarTime() {
  const nome = document.getElementById("nomeTime").value;
  const pais = document.getElementById("paisTime").value;
  const primaria = document.getElementById("corPrimaria").value;
  const secundaria = document.getElementById("corSecundaria").value;
  const terciaria = document.getElementById("corTerciaria").value;
  const estilo = document.getElementById("estilo").value;

  addDoc(collection(db, "times"), {
    nome, pais, primaria, secundaria, terciaria, estilo
  }).then(() => carregarTimes());
}

buscaInput.addEventListener("input", async e => {
  const filtro = e.target.value.toLowerCase();
  const snap = await getDocs(collection(db, "times"));
  const filtrados = snap.docs.filter(doc => {
    const { nome, pais } = doc.data();
    return nome.toLowerCase().includes(filtro) || pais.toLowerCase().includes(filtro);
  });
  renderizarTimes(filtrados);
});

carregarTimes();
