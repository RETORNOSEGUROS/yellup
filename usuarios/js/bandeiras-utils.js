/**
 * YELLUP - Utilitário de Bandeiras para Times
 * Versão 2.0 - Funciona com codigoPais OU pais (nome)
 */

// Mapeamento de código ISO para emoji
const BANDEIRAS_ISO = {
    'BR': '🇧🇷', 'AR': '🇦🇷', 'UY': '🇺🇾', 'CO': '🇨🇴', 'CL': '🇨🇱',
    'PE': '🇵🇪', 'EC': '🇪🇨', 'PY': '🇵🇾', 'VE': '🇻🇪', 'BO': '🇧🇴',
    'US': '🇺🇸', 'MX': '🇲🇽', 'CA': '🇨🇦', 'CR': '🇨🇷', 'HN': '🇭🇳',
    'ES': '🇪🇸', 'IT': '🇮🇹', 'DE': '🇩🇪', 'FR': '🇫🇷', 'GB': '🇬🇧',
    'PT': '🇵🇹', 'NL': '🇳🇱', 'BE': '🇧🇪', 'CH': '🇨🇭', 'AT': '🇦🇹',
    'PL': '🇵🇱', 'UA': '🇺🇦', 'CZ': '🇨🇿', 'RO': '🇷🇴', 'HU': '🇭🇺',
    'GR': '🇬🇷', 'SE': '🇸🇪', 'DK': '🇩🇰', 'NO': '🇳🇴', 'FI': '🇫🇮',
    'IE': '🇮🇪', 'RS': '🇷🇸', 'HR': '🇭🇷', 'SK': '🇸🇰', 'SI': '🇸🇮',
    'BG': '🇧🇬', 'RU': '🇷🇺', 'TR': '🇹🇷', 'IS': '🇮🇸', 'CY': '🇨🇾',
    'JP': '🇯🇵', 'CN': '🇨🇳', 'KR': '🇰🇷', 'TH': '🇹🇭', 'VN': '🇻🇳',
    'SA': '🇸🇦', 'AE': '🇦🇪', 'QA': '🇶🇦', 'KW': '🇰🇼', 'IL': '🇮🇱',
    'MA': '🇲🇦', 'EG': '🇪🇬', 'TN': '🇹🇳', 'NG': '🇳🇬', 'ZA': '🇿🇦',
    'AU': '🇦🇺', 'NZ': '🇳🇿', 'SC': '🏴󠁧󠁢󠁳󠁣󠁴󠁿'
};

// Mapeamento de NOME do país (português) para emoji
const BANDEIRAS_NOME = {
    // América do Sul
    'brasil': '🇧🇷',
    'argentina': '🇦🇷',
    'uruguai': '🇺🇾',
    'paraguai': '🇵🇾',
    'chile': '🇨🇱',
    'colômbia': '🇨🇴',
    'colombia': '🇨🇴',
    'peru': '🇵🇪',
    'equador': '🇪🇨',
    'venezuela': '🇻🇪',
    'bolívia': '🇧🇴',
    'bolivia': '🇧🇴',
    
    // América do Norte e Central
    'estados unidos': '🇺🇸',
    'eua': '🇺🇸',
    'usa': '🇺🇸',
    'méxico': '🇲🇽',
    'mexico': '🇲🇽',
    'canadá': '🇨🇦',
    'canada': '🇨🇦',
    
    // Europa
    'espanha': '🇪🇸',
    'itália': '🇮🇹',
    'italia': '🇮🇹',
    'alemanha': '🇩🇪',
    'frança': '🇫🇷',
    'franca': '🇫🇷',
    'inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'reino unido': '🇬🇧',
    'portugal': '🇵🇹',
    'holanda': '🇳🇱',
    'países baixos': '🇳🇱',
    'paises baixos': '🇳🇱',
    'bélgica': '🇧🇪',
    'belgica': '🇧🇪',
    'suíça': '🇨🇭',
    'suica': '🇨🇭',
    'áustria': '🇦🇹',
    'austria': '🇦🇹',
    'polônia': '🇵🇱',
    'polonia': '🇵🇱',
    'ucrânia': '🇺🇦',
    'ucrania': '🇺🇦',
    'república tcheca': '🇨🇿',
    'republica tcheca': '🇨🇿',
    'tchéquia': '🇨🇿',
    'tchequia': '🇨🇿',
    'romênia': '🇷🇴',
    'romenia': '🇷🇴',
    'hungria': '🇭🇺',
    'grécia': '🇬🇷',
    'grecia': '🇬🇷',
    'suécia': '🇸🇪',
    'suecia': '🇸🇪',
    'dinamarca': '🇩🇰',
    'noruega': '🇳🇴',
    'finlândia': '🇫🇮',
    'finlandia': '🇫🇮',
    'irlanda': '🇮🇪',
    'sérvia': '🇷🇸',
    'serbia': '🇷🇸',
    'croácia': '🇭🇷',
    'croacia': '🇭🇷',
    'eslováquia': '🇸🇰',
    'eslovaquia': '🇸🇰',
    'eslovênia': '🇸🇮',
    'eslovenia': '🇸🇮',
    'bulgária': '🇧🇬',
    'bulgaria': '🇧🇬',
    'rússia': '🇷🇺',
    'russia': '🇷🇺',
    'turquia': '🇹🇷',
    'islândia': '🇮🇸',
    'islandia': '🇮🇸',
    'escócia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'escocia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'país de gales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    'pais de gales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    'gales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    'mônaco': '🇲🇨',
    'monaco': '🇲🇨',
    
    // Ásia
    'japão': '🇯🇵',
    'japao': '🇯🇵',
    'china': '🇨🇳',
    'coreia do sul': '🇰🇷',
    'coréia do sul': '🇰🇷',
    'tailândia': '🇹🇭',
    'tailandia': '🇹🇭',
    'vietnã': '🇻🇳',
    'vietna': '🇻🇳',
    
    // Oriente Médio
    'arábia saudita': '🇸🇦',
    'arabia saudita': '🇸🇦',
    'emirados árabes': '🇦🇪',
    'emirados arabes unidos': '🇦🇪',
    'catar': '🇶🇦',
    'qatar': '🇶🇦',
    'israel': '🇮🇱',
    
    // África
    'marrocos': '🇲🇦',
    'egito': '🇪🇬',
    'tunísia': '🇹🇳',
    'tunisia': '🇹🇳',
    'nigéria': '🇳🇬',
    'nigeria': '🇳🇬',
    'áfrica do sul': '🇿🇦',
    'africa do sul': '🇿🇦',
    
    // Oceania
    'austrália': '🇦🇺',
    'australia': '🇦🇺',
    'nova zelândia': '🇳🇿',
    'nova zelandia': '🇳🇿'
};

/**
 * Retorna o emoji da bandeira
 * Aceita código ISO (BR, ES) ou nome do país (Brasil, Espanha)
 */
function getBandeira(codigoOuNome) {
    if (!codigoOuNome) return '⚽';
    
    // Primeiro tenta por código ISO (maiúsculo)
    const codigo = String(codigoOuNome).toUpperCase().trim();
    if (BANDEIRAS_ISO[codigo]) {
        return BANDEIRAS_ISO[codigo];
    }
    
    // Depois tenta por nome do país (minúsculo, sem acentos)
    const nome = String(codigoOuNome).toLowerCase().trim();
    if (BANDEIRAS_NOME[nome]) {
        return BANDEIRAS_NOME[nome];
    }
    
    // Fallback: bola de futebol
    return '⚽';
}

/**
 * Formata o nome do time com bandeira
 * Tenta usar codigoPais, depois pais, depois mostra só o nome
 */
function formatarTimeComBandeira(time) {
    if (!time || !time.nome) return 'Time desconhecido';
    
    // Tenta obter bandeira por codigoPais ou pais
    const bandeira = getBandeira(time.codigoPais) !== '⚽' 
        ? getBandeira(time.codigoPais) 
        : getBandeira(time.pais);
    
    return `${bandeira} ${time.nome}`;
}

/**
 * Formata para uso em selects
 */
function formatarTimeParaSelect(time) {
    return formatarTimeComBandeira(time);
}

/**
 * Cria elemento HTML
 */
function criarElementoTime(time) {
    const texto = formatarTimeComBandeira(time);
    return `<span class="time-com-bandeira">${texto}</span>`;
}

/**
 * Popula select com times
 */
function popularSelectTimes(selectId, times, valorSelecionado = '', filtroTipo = null) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    let timesFiltrados = filtroTipo 
        ? times.filter(t => t.tipo === filtroTipo)
        : times;
    
    const timesOrdenados = [...timesFiltrados].sort((a, b) => 
        (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
    );
    
    const placeholder = filtroTipo === 'selecao' 
        ? 'Selecione uma seleção...' 
        : filtroTipo === 'clube' 
            ? 'Selecione um clube...'
            : 'Selecione um time...';
    
    select.innerHTML = `<option value="">${placeholder}</option>`;
    
    timesOrdenados.forEach(time => {
        const option = document.createElement('option');
        option.value = time.id;
        option.textContent = formatarTimeComBandeira(time);
        if (time.id === valorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function popularSelectClubes(selectId, times, valorSelecionado = '') {
    popularSelectTimes(selectId, times, valorSelecionado, 'clube');
}

function popularSelectSelecoes(selectId, times, valorSelecionado = '') {
    popularSelectTimes(selectId, times, valorSelecionado, 'selecao');
}

function isSelecao(time) {
    return time && time.tipo === 'selecao';
}

function isClube(time) {
    return time && time.tipo === 'clube';
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.BANDEIRAS_ISO = BANDEIRAS_ISO;
    window.BANDEIRAS_NOME = BANDEIRAS_NOME;
    window.getBandeira = getBandeira;
    window.formatarTimeComBandeira = formatarTimeComBandeira;
    window.formatarTimeParaSelect = formatarTimeParaSelect;
    window.criarElementoTime = criarElementoTime;
    window.popularSelectTimes = popularSelectTimes;
    window.popularSelectClubes = popularSelectClubes;
    window.popularSelectSelecoes = popularSelectSelecoes;
    window.isSelecao = isSelecao;
    window.isClube = isClube;
}
