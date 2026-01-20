/**
 * YELLUP - Utilitário de Bandeiras para Times
 * 
 * Adicione este código em suas páginas para exibir bandeiras junto aos nomes dos times.
 * 
 * USO:
 * 1. Inclua este script na página OU copie as funções para seu JS existente
 * 2. Use: formatarTimeComBandeira(time) para obter o HTML com bandeira
 * 3. Use: getBandeira(codigoPais) para obter apenas o emoji da bandeira
 */

// Mapeamento de código de país para emoji de bandeira
const BANDEIRAS = {
    // América do Sul
    'BR': '🇧🇷', 'AR': '🇦🇷', 'UY': '🇺🇾', 'CO': '🇨🇴', 'CL': '🇨🇱',
    'PE': '🇵🇪', 'EC': '🇪🇨', 'PY': '🇵🇾', 'VE': '🇻🇪', 'BO': '🇧🇴',
    
    // América do Norte e Central
    'US': '🇺🇸', 'MX': '🇲🇽', 'CA': '🇨🇦', 'CR': '🇨🇷', 'HN': '🇭🇳',
    'SV': '🇸🇻', 'GT': '🇬🇹', 'PA': '🇵🇦', 'JM': '🇯🇲', 'TT': '🇹🇹',
    'HT': '🇭🇹', 'CU': '🇨🇺',
    
    // Europa
    'ES': '🇪🇸', 'IT': '🇮🇹', 'DE': '🇩🇪', 'FR': '🇫🇷', 'GB': '🇬🇧',
    'PT': '🇵🇹', 'NL': '🇳🇱', 'BE': '🇧🇪', 'CH': '🇨🇭', 'AT': '🇦🇹',
    'PL': '🇵🇱', 'UA': '🇺🇦', 'CZ': '🇨🇿', 'RO': '🇷🇴', 'HU': '🇭🇺',
    'GR': '🇬🇷', 'SE': '🇸🇪', 'DK': '🇩🇰', 'NO': '🇳🇴', 'FI': '🇫🇮',
    'IE': '🇮🇪', 'RS': '🇷🇸', 'HR': '🇭🇷', 'SK': '🇸🇰', 'SI': '🇸🇮',
    'BG': '🇧🇬', 'RU': '🇷🇺', 'TR': '🇹🇷', 'IS': '🇮🇸', 'CY': '🇨🇾',
    'BA': '🇧🇦', 'ME': '🇲🇪', 'AL': '🇦🇱', 'MK': '🇲🇰', 'XK': '🇽🇰',
    'LU': '🇱🇺', 'MT': '🇲🇹', 'MC': '🇲🇨', 'AD': '🇦🇩', 'LI': '🇱🇮',
    'BY': '🇧🇾', 'MD': '🇲🇩', 'EE': '🇪🇪', 'LV': '🇱🇻', 'LT': '🇱🇹',
    
    // Ásia
    'JP': '🇯🇵', 'CN': '🇨🇳', 'KR': '🇰🇷', 'KP': '🇰🇵', 'TH': '🇹🇭',
    'VN': '🇻🇳', 'ID': '🇮🇩', 'MY': '🇲🇾', 'PH': '🇵🇭', 'SG': '🇸🇬',
    'IN': '🇮🇳', 'PK': '🇵🇰', 'BD': '🇧🇩', 'HK': '🇭🇰', 'TW': '🇹🇼',
    
    // Oriente Médio
    'SA': '🇸🇦', 'AE': '🇦🇪', 'QA': '🇶🇦', 'KW': '🇰🇼', 'BH': '🇧🇭',
    'OM': '🇴🇲', 'IR': '🇮🇷', 'IQ': '🇮🇶', 'IL': '🇮🇱', 'JO': '🇯🇴',
    'LB': '🇱🇧', 'SY': '🇸🇾',
    
    // Cáucaso
    'GE': '🇬🇪', 'AM': '🇦🇲', 'AZ': '🇦🇿',
    
    // África
    'MA': '🇲🇦', 'EG': '🇪🇬', 'TN': '🇹🇳', 'DZ': '🇩🇿', 'NG': '🇳🇬',
    'SN': '🇸🇳', 'GH': '🇬🇭', 'CI': '🇨🇮', 'CM': '🇨🇲', 'ZA': '🇿🇦',
    'KE': '🇰🇪', 'ET': '🇪🇹', 'ML': '🇲🇱', 'BF': '🇧🇫', 'AO': '🇦🇴',
    'MZ': '🇲🇿', 'ZM': '🇿🇲', 'ZW': '🇿🇼', 'UG': '🇺🇬', 'TZ': '🇹🇿',
    'RW': '🇷🇼', 'CD': '🇨🇩', 'CG': '🇨🇬', 'GA': '🇬🇦', 'GN': '🇬🇳',
    'GW': '🇬🇼', 'GQ': '🇬🇶', 'CV': '🇨🇻', 'MG': '🇲🇬', 'MU': '🇲🇺',
    
    // Oceania
    'AU': '🇦🇺', 'NZ': '🇳🇿', 'FJ': '🇫🇯', 'PG': '🇵🇬',
    
    // Ásia Central
    'KZ': '🇰🇿', 'UZ': '🇺🇿', 'AF': '🇦🇫',
};

/**
 * Retorna o emoji da bandeira para um código de país
 * @param {string} codigoPais - Código ISO do país (ex: 'BR', 'ES')
 * @returns {string} Emoji da bandeira ou 🏳️ se não encontrar
 */
function getBandeira(codigoPais) {
    return BANDEIRAS[codigoPais] || '🏳️';
}

/**
 * Formata o nome do time com bandeira para exibição
 * @param {Object} time - Objeto do time com nome e codigoPais
 * @returns {string} Nome formatado com bandeira (ex: "🇧🇷 Corinthians - SP")
 */
function formatarTimeComBandeira(time) {
    const bandeira = getBandeira(time.codigoPais);
    return `${bandeira} ${time.nome}`;
}

/**
 * Formata o nome do time para uso em selects/dropdowns
 * Bandeira no início para fácil identificação visual
 * @param {Object} time - Objeto do time
 * @returns {string} Nome formatado para select
 */
function formatarTimeParaSelect(time) {
    const bandeira = getBandeira(time.codigoPais);
    return `${bandeira} ${time.nome}`;
}

/**
 * Cria um elemento HTML para exibir time com bandeira
 * @param {Object} time - Objeto do time
 * @returns {string} HTML string com bandeira e nome
 */
function criarElementoTime(time) {
    const bandeira = getBandeira(time.codigoPais);
    return `<span class="time-com-bandeira">
        <span class="bandeira">${bandeira}</span>
        <span class="nome-time">${time.nome}</span>
    </span>`;
}

/**
 * Popula um select com times, ordenados por nome, com bandeiras
 * @param {string} selectId - ID do elemento select
 * @param {Array} times - Array de times [{id, nome, codigoPais, ...}]
 * @param {string} [valorSelecionado] - Valor a ser pré-selecionado
 */
function popularSelectTimes(selectId, times, valorSelecionado = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Ordenar por nome
    const timesOrdenados = [...times].sort((a, b) => 
        a.nome.localeCompare(b.nome, 'pt-BR')
    );
    
    // Limpar e adicionar opção padrão
    select.innerHTML = '<option value="">Selecione um time...</option>';
    
    // Adicionar times
    timesOrdenados.forEach(time => {
        const option = document.createElement('option');
        option.value = time.id;
        option.textContent = formatarTimeParaSelect(time);
        if (time.id === valorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// Exportar funções para uso global
if (typeof window !== 'undefined') {
    window.BANDEIRAS = BANDEIRAS;
    window.getBandeira = getBandeira;
    window.formatarTimeComBandeira = formatarTimeComBandeira;
    window.formatarTimeParaSelect = formatarTimeParaSelect;
    window.criarElementoTime = criarElementoTime;
    window.popularSelectTimes = popularSelectTimes;
}

// Para uso com módulos ES6
// export { BANDEIRAS, getBandeira, formatarTimeComBandeira, formatarTimeParaSelect, criarElementoTime, popularSelectTimes };
