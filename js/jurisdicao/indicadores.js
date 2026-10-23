// Indicadores do painel-resumo (site e caderno) e icones no padrao da tabela original
// "Processos de alteracao de jurisdicao rodoviaria": processos, extensoes, finalizados,
// situacao atual, leis estaduais e leis municipais aprovadas.

const Indicadores = (function() {
  const ORDEM_TIPOS = ['Estadualização', 'Federalização', 'Municipalização'];
  const PLURAL_TIPO = { 'Estadualização': 'Estadualizações', 'Federalização': 'Federalizações', 'Municipalização': 'Municipalizações' };

  // Ordem e rotulos curtos da tabela original.
  const SITUACOES_RESUMO = [
    ['EM ANÁLISE', 'Em análise'],
    ['EM JUDICIALIZAÇÃO (PGE/ADI)', 'Em judicialização'],
    ['ENCERRADO', 'Encerrados'],
    ['FINALIZADO', 'Finalizado'],
    ['SOBRESTADO', 'Sobrestados'],
    ['VETO TOTAL DO GOVERNADOR', 'Veto governador']
  ];

  function calcular(lista) {
    const porTipo = {};
    ORDEM_TIPOS.forEach(t => { porTipo[t] = { qtd: 0, km: 0, finalizados: 0 }; });
    const situacoes = {};
    SITUACOES_RESUMO.forEach(s => { situacoes[s[0]] = 0; });
    let km = 0, leisEstaduais = 0, leisMunicipais = 0;
    lista.forEach(function(r) {
      const ext = Number(r.extensao_km) || 0;
      km += ext;
      const t = porTipo[r.tipo];
      if (t) {
        t.qtd++;
        t.km += ext;
        if (r.situacao === 'FINALIZADO') t.finalizados++;
      }
      if (r.situacao in situacoes) situacoes[r.situacao]++;
      if (statusDoc(r.lei_estadual) === 'sim') leisEstaduais++;
      if (statusDoc(r.lei_municipal) === 'sim') leisMunicipais++;
    });
    return { total: lista.length, km, porTipo, situacoes, leisEstaduais, leisMunicipais };
  }

  // ---------- Icones (48x48) ----------
  function engrenagem(cor) {
    const dentes = 8, rExt = 21, rInt = 16.5, pts = [];
    for (let i = 0; i < dentes * 4; i++) {
      const a = (i / (dentes * 4)) * Math.PI * 2 - Math.PI / 2;
      const r = (i % 4 === 0 || i % 4 === 1) ? rExt : rInt;
      pts.push((24 + Math.cos(a) * r).toFixed(1) + ',' + (24 + Math.sin(a) * r).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + cor + '"/><circle cx="24" cy="24" r="7.5" fill="#fff"/>';
  }

  const ICONES = {
    processos: '<path d="M15 9h17l7 7v25H15z" fill="#fff" stroke="#1f2937" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M10 14v29h22" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M32 9v7h7" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M20 22h13M20 27h13M20 32h13M20 37h9" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round"/>',
    extensao: '<path d="M17 6h14l11 36H6z" fill="#1f2937"/>' +
      '<path d="M24 9v5M24 19v6M24 30v7" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M15.5 10 9 38M32.5 10 39 38" stroke="#fff" stroke-width="1.6"/>',
    finalizados: '<circle cx="24" cy="24" r="20" fill="#3f8f3a"/><path d="m14 24.5 7 7 13-14" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>',
    situacao: engrenagem('#d4a017'),
    leiEstadual: '<path d="M24 5 6 14h36z" fill="#1f2937"/><rect x="7" y="15.5" width="34" height="3" fill="#1f2937"/>' +
      '<path d="M11 21v14M19 21v14M29 21v14M37 21v14" stroke="#1f2937" stroke-width="4"/>' +
      '<rect x="7" y="37" width="34" height="3" fill="#1f2937"/><rect x="4" y="41.5" width="40" height="3" fill="#1f2937"/>',
    leiMunicipal: '<circle cx="16" cy="15" r="7" fill="#2a4fa8"/><circle cx="33" cy="15" r="7" fill="#2a4fa8"/>' +
      '<path d="M3 42c0-10 5-17 13-17s13 7 13 17z" fill="#2a4fa8"/><path d="M20 42c0-10 5-17 13-17s13 7 13 17z" fill="#2a4fa8" stroke="#fff" stroke-width="1.5"/>'
  };

  function icone(nome, tam) {
    return '<svg class="ico-ind" viewBox="0 0 48 48" width="' + (tam || 40) + '" height="' + (tam || 40) + '" aria-hidden="true">' + ICONES[nome] + '</svg>';
  }

  // Circulo de status dos documentos (como na tabela original): verde = possui, vermelho = nao.
  const CORES_DOC = { sim: '#5d9b6c', nao: '#e0573b', parcial: '#e3a21a', na: '#a3a9b3' };
  function iconeDoc(status, tam) {
    const t = tam || 14, cor = CORES_DOC[status];
    if (!cor) return '';
    const miolo = {
      sim: '<path d="m6.2 12.4 3.8 3.6 7.8-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
      nao: '<path d="m8 8 8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
      parcial: '<path d="M12 3a9 9 0 0 1 0 18z" fill="#fff"/>',
      na: '<path d="M7.5 12h9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'
    }[status];
    return '<svg class="ico-doc" viewBox="0 0 24 24" width="' + t + '" height="' + t + '" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="' + cor + '"/>' + miolo + '</svg>';
  }

  // Texto exibido ao lado do icone de documento.
  function textoDoc(v) {
    const s = statusDoc(v);
    if (s === 'vazio') return '';
    if (s === 'na') return 'N/A';
    const t = String(v).trim();
    return s === 'sim' && t.toUpperCase() === 'SIM' ? 'SIM' : t;
  }

  return { ORDEM_TIPOS, PLURAL_TIPO, SITUACOES_RESUMO, calcular, icone, iconeDoc, textoDoc };
})();
