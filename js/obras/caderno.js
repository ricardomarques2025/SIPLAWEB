// Caderno de obras A4 paisagem (obras_caderno.html), no padrao do caderno da jurisdicao e com o visual
// dos cadernos da GOINFRA (Caderno de Obras Rodoviarias 2027 / Caderno de Projetos Rodoviarios 2026-2027).
//   Modo "prancha": o mapa de uma obra (pode ser arrastado/ampliado para ajustar o enquadramento).
//   Modo "completo": capa, indice e, para cada origem escolhida (na ordem da lista): divisoria, resumo e,
//   por secao (ex.: DOR > Em andamento > Tesouro), pagina de titulo, planilha e os mapas das obras.
// As secoes de cada origem ficam em CONFIG_ORIGEM; origem sem configuracao e dividida por etapa e fonte.
// Obra que nao cai em nenhuma secao configurada vai para "Outras", nada fica de fora.

(function() {
  const $ = id => document.getElementById(id);
  const esc = CadernoMapa.esc, fmtKm = CadernoMapa.fmtKm;
  const sb = Acesso.cliente;   // schema siplaweb
  const PRANCHAS_SIMULTANEAS = 3;
  const POR_PAGINA = 1000;     // limite de linhas por consulta da API
  const COLUNAS = ['codigo', 'origem', 'tipo', 'ref', 'proposta', 'rodovia', 'descricao', 'intervencao', 'etapa', 'status',
    'modalidade', 'fonte', 'fase', 'sei', 'contrato', 'ext_contrato_km', 'conclusao', 'municipio', 'vinculos', 'geom'].join(',');

  // ---------- Secoes por origem ----------
  const fonte = re => o => re.test(o.fonte || '');
  const TESOURO = fonte(/^(tesouro|convênio)$/i);
  const CONFIG_ORIGEM = {
    DOR: {
      titulo: 'OBRAS RODOVIÁRIAS',
      fase: { titulo: 'FASE', valor: o => String(o.modalidade || '').replace(/^Obra Integrada$/, 'Integrada') },
      trecho: 'TRECHO',
      capitulos: [
        { titulo: 'OBRAS RODOVIÁRIAS EM ANDAMENTO', filtro: o => o.etapa === 'Obra', secoes: [
          { titulo: 'TESOURO', filtro: TESOURO },
          { titulo: 'TARE', filtro: fonte(/^tare$/i) },
          { titulo: 'FUNDEINFRA', filtro: fonte(/^fundeinfra$/i) },
          { titulo: 'IFAG', filtro: fonte(/associativo/i) }
        ] },
        { titulo: 'LICITAÇÃO DE OBRAS RODOVIÁRIAS', planilha: 'LICITAÇÕES DE OBRAS RODOVIÁRIAS EM ANDAMENTO', filtro: o => o.etapa === 'Licitação', secoes: [
          { titulo: 'TESOURO', filtro: TESOURO },
          { titulo: 'FUNDEINFRA', filtro: fonte(/fundeinfra/i) }
        ] }
      ]
    },
    DPJ: {
      titulo: 'PROJETOS RODOVIÁRIOS',
      fase: { titulo: 'FASE', valor: o => o.fase },
      trecho: 'DESCRIÇÃO',
      capitulos: [
        { titulo: 'PROJETOS RODOVIÁRIOS EM ANDAMENTO', planilha: 'RELAÇÃO DE PROJETOS RODOVIÁRIOS EM ANDAMENTO', secoes: [
          { titulo: 'ETP', filtro: o => /preparat/i.test(o.fase || '') },
          { titulo: 'TESOURO – CONTRATADOS', filtro: o => TESOURO(o) && o.modalidade !== 'Interno' },
          { titulo: 'TESOURO – INTERNOS', filtro: o => TESOURO(o) && o.modalidade === 'Interno' },
          { titulo: 'FUNDEINFRA', filtro: fonte(/fundeinfra/i) },
          { titulo: 'DOAÇÃO', filtro: fonte(/doa/i) }
        ] }
      ]
    }
  };
  // Origem sem configuracao: um capitulo por etapa (nesta ordem) e uma secao por fonte.
  const ETAPAS = [['Planejamento', 'PLANEJAMENTO'], ['Projeto', 'PROJETOS'], ['Licitação', 'LICITAÇÕES'], ['Obra', 'OBRAS'],
    ['Integrada', 'OBRAS INTEGRADAS'], ['Manutenção', 'MANUTENÇÃO']];
  const FONTES = ['Tesouro', 'Fundeinfra', 'Associativo-Fundeinfra', 'Convênio', 'Tare', 'Doação'];

  // Cores por intervencao: destaque no mapa (contorno + miolo, como os tipos da jurisdicao) e fundo da linha na planilha
  // (as cores dos cadernos da GOINFRA). A primeira regra que casa vale.
  const ESTILOS = [
    [/bueiro|oac/i, { contorno: '#c7f0ff', miolo: '#0891b2', fundo: '#dcefff' }],
    [/duplica|capacidade/i, { contorno: '#9fe2ff', miolo: '#0a6cff', fundo: '#d9e8ff' }],
    [/ponte|oae|viaduto|passarela|passagem/i, { contorno: '#ffe0b3', miolo: '#b45309', fundo: '#ead4c0' }],
    [/paviment|implanta/i, { contorno: '#ffd1f5', miolo: '#c2189b', fundo: '#fae9fc' }],
    [/restaura|recupera|cbuq|micro/i, { contorno: '#b9ff9f', miolo: '#17b81a', fundo: '#e6f8db' }],
    [/prad/i, { contorno: '#d9f99d', miolo: '#4d7c0f', fundo: '#b6d6a8' }],
    [/sinaliza/i, { contorno: '#ede9fe', miolo: '#7c3aed', fundo: '#ede9fe' }]
  ];
  const ESTILO_PADRAO = { contorno: '#e8212b', miolo: '#fff200', fundo: '#fff7d6' };
  function estiloObra(o) {
    const e = ESTILOS.find(x => x[0].test(o.intervencao || ''));
    return e ? e[1] : ESTILO_PADRAO;
  }

  // Icones das obras pontuais (img/obras/icones), pela intervencao; a primeira regra que casa vale.
  // Obra pontual sem icone continua com a bolinha nas cores do estilo.
  const ICONES = [
    [/aer[oó]dromo/i, 'aerodromo', 'Aeródromo'],
    [/bueiro|\boac\b/i, 'bueiro', 'Bueiro'],
    [/duplica/i, 'duplicacao', 'Duplicação'],
    [/paviment/i, 'pavimentacao', 'Pavimentação'],
    [/viaduto/i, 'viaduto', 'Viaduto'],
    [/ponte|\boae\b/i, 'ponte', 'Ponte']
  ];
  const urlIcone = arq => 'img/obras/icones/' + arq + '.svg';
  const soPontos = geos => geos.length > 0 && geos.every(g => /Point/.test(g.type));
  function iconeObra(o, geos) {
    if (!soPontos(geos)) return null;
    const i = ICONES.find(x => x[0].test(o.intervencao || ''));
    return i ? urlIcone(i[1]) : null;
  }

  const fmtKmTabela = n => n == null || n === '' ? '-' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vazio = v => v == null || v === '';
  const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base', numeric: true });

  function status(txt, ok) {
    $('status').textContent = txt;
    $('status').classList.toggle('ok', !!ok);
    $('btnImprimir').disabled = !ok;
  }

  // ---------- Leitura do banco ----------
  // Origens que entram no caderno (as demais ficam so no mapa).
  const ORIGENS_CADERNO = ['DOC', 'DSV', 'FUNDEINFRA', 'DPL', 'DPJ', 'DMA', 'DOR', 'GEREF', 'TARE'];
  let ORIGENS = [];   // [{ codigo, nome }] que a pessoa pode exportar e que tem obras
  async function lerOrigens() {
    const res = await sb.from('origens').select('codigo, nome, ordem').eq('ativa', true).order('ordem');
    if (res.error) throw new Error('Falha ao ler as origens: ' + res.error.message);
    return res.data.filter(o => ORIGENS_CADERNO.includes(o.codigo) && Acesso.podeVer(o.codigo) && Acesso.podeExportar(o.codigo));
  }

  async function lerObras(origens) {
    let linhas = [];
    for (let inicio = 0; ; inicio += POR_PAGINA) {
      const res = await sb.from('obras').select(COLUNAS).in('origem', origens).is('excluido_em', null)
        .order('codigo').range(inicio, inicio + POR_PAGINA - 1);
      if (res.error) throw new Error('Falha ao ler obras do banco: ' + res.error.message);
      linhas = linhas.concat(res.data);
      if (res.data.length < POR_PAGINA) return linhas;
    }
  }

  // ---------- Desenho de cada obra ----------
  // Ponto/linha propria (geom) ou os trechos e pontos a que a obra esta ligada (vinculos "base:GEOCOD"),
  // lidos das mesmas fontes do mapa: arquivos data/*.geojson e as camadas editaveis do banco.
  const INDICES = {};
  async function indexarBases(obras, base) {
    const bases = new Set();
    obras.forEach(o => (o.vinculos || []).forEach(v => bases.add(v.slice(0, v.indexOf(':')))));
    await Promise.all(Array.from(bases).filter(b => !INDICES[b]).map(async function(b) {
      let fc = null;
      try {
        if (b === 'sre_base') fc = base.sre;
        else if (b === 'municipios') fc = base.municipios;
        else if (b === 'localidades') fc = base.localidades;
        else if (b === 'extra_base') fc = (await sb.rpc('extra_base_geojson')).data;
        else if (/^geo_(pt|lin|pol)_base$/.test(b)) fc = (await sb.rpc('camada_geojson', { p_camada: b })).data;
        else fc = await fetch('data/' + b + '.geojson').then(r => r.ok ? r.json() : null);
      } catch (e) { console.warn('Camada ' + b + ' indisponível:', e.message); }
      const indice = new Map();
      ((fc && fc.features) || []).forEach(function(f) {
        const p = f.properties || {};
        const cod = p.GEOCOD || p.geocod;
        if (cod && f.geometry) indice.set(String(cod), f.geometry);
      });
      INDICES[b] = indice;
    }));
  }

  function geometriaObra(o) {
    if (o.geom && o.geom.type) return [o.geom];
    return (o.vinculos || []).map(function(v) {
      const i = v.indexOf(':');
      const ind = INDICES[v.slice(0, i)];
      return ind ? ind.get(v.slice(i + 1)) : null;
    }).filter(Boolean);
  }
  const temDesenho = o => geometriaObra(o).length > 0;

  // ---------- Estrutura: origem > capitulo > secao > obras ----------
  function ordenarItens(itens) {
    const num = o => /^\d+$/.test(String(o.ref || '').trim()) ? Number(o.ref) : Infinity;
    return itens.slice().sort((a, z) => (num(a) - num(z)) || cmp(a.intervencao, z.intervencao) ||
      cmp(a.rodovia, z.rodovia) || cmp(a.descricao, z.descricao) || cmp(a.codigo, z.codigo));
  }

  function porFonte(itens, tituloSemFonte) {
    const grupos = new Map();
    itens.forEach(o => { const f = o.fonte || ''; if (!grupos.has(f)) grupos.set(f, []); grupos.get(f).push(o); });
    const chaves = Array.from(grupos.keys()).sort((a, z) => {
      const ia = FONTES.indexOf(a), iz = FONTES.indexOf(z);
      return (ia < 0 ? 99 : ia) - (iz < 0 ? 99 : iz) || cmp(a, z);
    });
    if (chaves.length === 1 && chaves[0] === '') return [{ titulo: tituloSemFonte || null, itens: itens }];
    return chaves.map(f => ({ titulo: f ? f.toUpperCase() : 'SEM FONTE', itens: grupos.get(f) }));
  }

  function porEtapa(itens) {
    const caps = [];
    const usados = new Set();
    ETAPAS.concat(Array.from(new Set(itens.map(o => o.etapa || ''))).filter(e => !ETAPAS.some(x => x[0] === e)).map(e => [e, e ? e.toUpperCase() : 'SEM ETAPA']))
      .forEach(function(e) {
        const doCap = itens.filter(o => (o.etapa || '') === e[0] && !usados.has(o));
        if (!doCap.length) return;
        doCap.forEach(o => usados.add(o));
        caps.push({ titulo: e[1], planilha: e[1], secoes: porFonte(doCap) });
      });
    return caps;
  }

  function capitulosDaOrigem(cod, obras) {
    const cfg = CONFIG_ORIGEM[cod];
    if (!cfg) return porEtapa(obras);
    let resto = obras.slice();
    const caps = [];
    cfg.capitulos.forEach(function(c) {
      const doCap = resto.filter(o => !c.filtro || c.filtro(o));
      resto = resto.filter(o => doCap.indexOf(o) < 0);
      let semSecao = doCap;
      const secoes = [];
      c.secoes.forEach(function(s) {
        const itens = semSecao.filter(s.filtro);
        semSecao = semSecao.filter(o => itens.indexOf(o) < 0);
        if (itens.length) secoes.push({ titulo: s.titulo, itens: itens });
      });
      if (semSecao.length) secoes.push({ titulo: 'OUTRAS', itens: semSecao });
      if (secoes.length) caps.push({ titulo: c.titulo, planilha: c.planilha || c.titulo, secoes: secoes });
    });
    porEtapa(resto).forEach(c => { c.titulo = 'OUTRAS: ' + c.titulo; c.planilha = c.titulo; caps.push(c); });
    return caps;
  }

  // Numero impresso (ITEM): sequencial em cada origem, na ordem do documento, como nos cadernos da GOINFRA.
  let NUMERO = new Map();
  const num = o => NUMERO.get(o.codigo) || '';

  function estruturar(codigos, obras) {
    NUMERO = new Map();
    return codigos.map(function(cod) {
      const origem = ORIGENS.find(o => o.codigo === cod) || { codigo: cod, nome: cod };
      const cfg = CONFIG_ORIGEM[cod] || {};
      const caps = capitulosDaOrigem(cod, obras.filter(o => o.origem === cod));
      let n = 0;
      caps.forEach(c => c.secoes.forEach(s => { s.itens = ordenarItens(s.itens); s.itens.forEach(o => NUMERO.set(o.codigo, ++n)); }));
      return { codigo: cod, titulo: cfg.titulo || ('OBRAS · ' + String(origem.nome).toUpperCase()), cfg: cfg, capitulos: caps,
        obras: caps.flatMap(c => c.secoes.flatMap(s => s.itens)) };
    }).filter(o => o.obras.length);
  }

  // ---------- Paginas ----------
  function novaFolha(classe) {
    const f = document.createElement('section');
    f.className = 'folha ' + classe;
    $('paginas').appendChild(f);
    return f;
  }
  const rodapeNumero = classe => '<div class="ob-numero ' + (classe || '') + '"></div>';

  // Titulo em duas linhas equilibradas, como "OBRAS / RODOVIÁRIAS" nos cadernos da GOINFRA.
  function duasLinhas(texto) {
    const p = String(texto || '').trim().split(/\s+/);
    if (p.length < 2) return esc(texto);
    let melhor = 1, dif = Infinity;
    for (let i = 1; i < p.length; i++) {
      const d = Math.abs(p.slice(0, i).join(' ').length - p.slice(i).join(' ').length);
      if (d < dif) { dif = d; melhor = i; }
    }
    return esc(p.slice(0, melhor).join(' ')) + '<br>' + esc(p.slice(melhor).join(' '));
  }

  function montarCapa(titulo, ano) {
    const f = novaFolha('ob-capa');
    f.innerHTML = '<div class="ob-capa-titulo">' + duasLinhas(titulo) + (ano ? '<span class="ob-capa-ano">' + esc(ano) + '</span>' : '') + '</div>';
  }

  function montarDivisoria(titulo) {
    const f = novaFolha('ob-divisoria');
    f.innerHTML = '<div class="ob-divisoria-titulo">' + duasLinhas(titulo) + '</div>' + rodapeNumero('claro');
    return f;
  }

  // Pagina de titulo de secao (fundo com a onda verde): "2. OBRAS ... EM ANDAMENTO" e/ou "2.1. TESOURO".
  function montarTituloSecao(principal, sub) {
    const f = novaFolha('ob-secao');
    f.innerHTML = (principal ? '<h1>' + esc(principal) + '</h1>' : '') + (sub ? '<h2>' + esc(sub) + '</h2>' : '') + rodapeNumero('claro');
    return f;
  }

  // Folha de conteudo (planilha, resumo): logo GOINFRA no alto e numero no circulo azul.
  function novaFolhaConteudo(classe) {
    const f = novaFolha('ob-conteudo ' + classe);
    f.innerHTML = '<img class="ob-logo" src="img/obras/logo_goinfra.png" alt="GOINFRA"><div class="ob-corpo"></div>' + rodapeNumero();
    return f;
  }
  const limiteFolha = f => { const c = f.getBoundingClientRect(); return c.top + c.height * (188 / 210); };

  // ---------- Planilha ----------
  // Colunas iguais em todas as planilhas da origem; as opcionais so entram se alguma obra tem valor.
  function colunasPlanilha(org) {
    const tem = campo => org.obras.some(o => !vazio(o[campo]));
    const cfg = org.cfg;
    const cols = [{ t: 'ITEM', v: o => num(o), w: 3.6 }];
    if (tem('proposta')) cols.push({ t: 'PROPOSTA', v: o => o.proposta, w: 6 });
    if (cfg.fase) cols.push({ t: cfg.fase.titulo, v: cfg.fase.valor, w: 7 });
    else cols.push({ t: 'ETAPA', v: o => o.etapa, w: 7 });
    cols.push({ t: 'RODOVIA', v: o => o.rodovia, w: 6.5 });
    cols.push({ t: 'INTERVENÇÃO', v: o => o.intervencao, w: 9 });
    cols.push({ t: cfg.trecho || 'DESCRIÇÃO', v: o => o.descricao, w: 26, classe: 'esq' });
    if (!CONFIG_ORIGEM[org.codigo] && tem('municipio')) cols.push({ t: 'MUNICÍPIO', v: o => o.municipio, w: 11 });
    if (tem('ext_contrato_km')) cols.push({ t: 'EXTENSÃO (km)', v: o => fmtKmTabela(o.ext_contrato_km), w: 6.5, ext: true });
    cols.push({ t: 'STATUS', v: o => o.status, w: 9 });
    if (tem('fonte')) cols.push({ t: 'FONTE', v: o => o.fonte, w: 7.5 });
    cols.push({ t: 'PROCESSO', v: o => o.sei, w: 10.5 });
    if (tem('contrato')) cols.push({ t: 'CONTRATO', v: o => o.contrato, w: 7.5 });
    if (tem('conclusao')) cols.push({ t: 'PREVISÃO DE CONCLUSÃO', v: o => o.conclusao, w: 7 });
    const soma = cols.reduce((s, c) => s + c.w, 0);
    cols.forEach(c => { c.pct = (100 * c.w / soma).toFixed(2) + '%'; });
    return cols;
  }

  // Distribui as linhas em quantas folhas forem precisas, medindo a altura real de cada uma.
  function montarPlanilha(titulo, itens, cols) {
    const folhas = [];
    const cabecalho = '<colgroup>' + cols.map(c => '<col style="width:' + c.pct + '">').join('') + '</colgroup>' +
      '<thead><tr>' + cols.map(c => '<th>' + esc(c.t) + '</th>').join('') + '</tr></thead>';
    let corpo = null, limite = 0;
    const nova = function() {
      const f = novaFolhaConteudo('ob-planilha');
      f.querySelector('.ob-corpo').innerHTML = (folhas.length ? '' : '<h3 class="ob-titulo-tabela">' + esc(titulo) + '</h3>') +
        '<table class="ob-tabela">' + cabecalho + '<tbody></tbody></table>';
      corpo = f.querySelector('tbody');
      limite = limiteFolha(f);
      folhas.push(f);
    };
    const por = function(tr) {
      corpo.appendChild(tr);
      if (tr.getBoundingClientRect().bottom > limite && corpo.children.length > 1) { tr.remove(); nova(); corpo.appendChild(tr); }
    };
    nova();
    itens.forEach(function(o) {
      const tr = document.createElement('tr');
      tr.style.background = estiloObra(o).fundo;
      tr.innerHTML = cols.map(c => { const v = c.v(o); return '<td' + (c.classe ? ' class="' + c.classe + '"' : '') + '>' + esc(vazio(v) ? '-' : v) + '</td>'; }).join('');
      por(tr);
    });
    const iExt = cols.findIndex(c => c.ext);
    const tr = document.createElement('tr');
    tr.className = 'total';
    if (iExt > 0) {
      const km = itens.reduce((s, o) => s + (Number(o.ext_contrato_km) || 0), 0);
      tr.innerHTML = '<td colspan="' + iExt + '">TOTAL · ' + itens.length + (itens.length === 1 ? ' OBRA' : ' OBRAS') + '</td><td>' + fmtKmTabela(km) + '</td>' +
        (cols.length - iExt - 1 > 0 ? '<td colspan="' + (cols.length - iExt - 1) + '"></td>' : '');
    } else {
      tr.innerHTML = '<td colspan="' + cols.length + '">TOTAL · ' + itens.length + (itens.length === 1 ? ' OBRA' : ' OBRAS') + '</td>';
    }
    por(tr);
    return folhas;
  }

  // ---------- Resumo ----------
  const CORES_CAB = ['#1e9639', '#5b9bd5', '#1f4e79', '#bf8f00', '#c55a11', '#7030a0'];
  const somaKm = itens => itens.reduce((s, o) => s + (Number(o.ext_contrato_km) || 0), 0);

  function blocosResumo(org) {
    const blocos = [];
    org.capitulos.forEach(function(c) {
      const secs = c.secoes;
      const cab = (primeira) => '<tr><th class="ob-cab-cinza">' + primeira + '</th>' +
        secs.map((s, i) => '<th style="background:' + CORES_CAB[i % CORES_CAB.length] + ';color:#fff">' + esc(s.titulo || 'OBRAS') + '</th>').join('');
      const todos = secs.flatMap(s => s.itens);
      blocos.push('<h3 class="ob-titulo-tabela">' + esc(c.titulo) + '</h3>' +
        '<table class="ob-tabela ob-resumo"><thead>' + cab('') + '<th class="ob-cab-cinza">TOTAL</th></tr></thead><tbody>' +
        '<tr><th>QUANTIDADE</th>' + secs.map(s => '<td>' + s.itens.length + '</td>').join('') + '<td><b>' + todos.length + '</b></td></tr>' +
        '<tr><th>EXTENSÃO (km)</th>' + secs.map(s => '<td>' + fmtKmTabela(somaKm(s.itens)) + '</td>').join('') + '<td><b>' + fmtKmTabela(somaKm(todos)) + '</b></td></tr>' +
        '</tbody></table>');
      const intervencoes = Array.from(new Set(todos.map(o => o.intervencao || '-'))).sort(cmp);
      blocos.push('<h3 class="ob-titulo-tabela">' + esc(c.titulo) + ' · POR INTERVENÇÃO</h3>' +
        '<table class="ob-tabela ob-resumo"><thead>' + cab('INTERVENÇÃO') + '<th class="ob-cab-cinza">EXTENSÃO (km)</th></tr></thead><tbody>' +
        intervencoes.map(function(iv) {
          const daIv = todos.filter(o => (o.intervencao || '-') === iv);
          return '<tr><th>' + esc(iv.toUpperCase()) + '</th>' + secs.map(s => { const n = s.itens.filter(o => (o.intervencao || '-') === iv).length; return '<td>' + (n || '-') + '</td>'; }).join('') +
            '<td>' + fmtKmTabela(somaKm(daIv)) + '</td></tr>';
        }).join('') +
        '<tr class="total"><th>TOTAL</th>' + secs.map(s => '<td>' + s.itens.length + '</td>').join('') + '<td>' + fmtKmTabela(somaKm(todos)) + '</td></tr>' +
        '</tbody></table>');
    });
    return blocos;
  }

  function montarResumo(org) {
    const folhas = [];
    let corpo = null, limite = 0;
    const nova = function() {
      const f = novaFolhaConteudo('ob-pagina-resumo');
      corpo = f.querySelector('.ob-corpo');
      limite = limiteFolha(f);
      folhas.push(f);
    };
    nova();
    blocosResumo(org).forEach(function(html) {
      const div = document.createElement('div');
      div.className = 'ob-bloco';
      div.innerHTML = html;
      corpo.appendChild(div);
      if (div.getBoundingClientRect().bottom > limite && corpo.children.length > 1) { div.remove(); nova(); corpo.appendChild(div); }
    });
    return folhas;
  }

  // ---------- Prancha (formato da jurisdicao) ----------
  function legendaHTML(o) {
    const linhaLeg = CadernoMapa.linhaLeg;
    const geos = geometriaObra(o);
    const soPonto = soPontos(geos);
    const icone = iconeObra(o, geos);
    const amostraIcone = url => '<img class="leg-icone" src="' + url + '" alt="">';
    const proc = [o.sei, o.contrato ? 'Contrato ' + o.contrato : ''].filter(Boolean);
    // Obra pontual: bloco com todos os icones (em ordem alfabetica), como na legenda dos cadernos da GOINFRA.
    const obras = !soPonto ? '' : '<div class="leg-icones"><div class="cab">OBRAS</div>' +
      ICONES.slice().sort((a, z) => a[2].localeCompare(z[2], 'pt-BR')).map(i => linhaLeg(amostraIcone(urlIcone(i[1])), i[2])).join('') + '</div>';
    return CadernoMapa.legendaBase() + obras +
      '<div class="leg-tipo"><div class="cab">OBRA</div>' +
      linhaLeg(icone ? amostraIcone(icone) : CadernoMapa.amostraDestaque(estiloObra(o), soPonto), esc(o.intervencao || 'Obra')) + '</div>' +
      '<div class="leg-processos"><div class="cab">PROCESSO</div><div class="lista">' + proc.map(esc).join('<br>') + '</div></div>';
  }

  function montarPrancha(o, base, numero, folhaExistente) {
    const folha = $('tplPrancha').content.firstElementChild.cloneNode(true);
    if (folhaExistente) folhaExistente.replaceWith(folha); else $('paginas').appendChild(folha);
    const q = sel => folha.querySelector(sel);

    q('.titulo-mapa').textContent = [o.rodovia, o.descricao].filter(Boolean).join(', ');
    q('.legenda').innerHTML = legendaHTML(o);
    q('.tabela-rodape th:nth-child(4)').textContent = (CONFIG_ORIGEM[o.origem] || {}).trecho || 'DESCRIÇÃO';
    q('.tabela-rodape tbody tr').innerHTML = [num(o), o.rodovia, o.intervencao, o.descricao, fmtKm(o.ext_contrato_km), o.status, o.fonte, o.sei, o.contrato]
      .map(v => '<td>' + esc(v) + '</td>').join('');
    CadernoMapa.caberTabela(q('.tabela-rodape'), folha);
    q('.numero-pagina').textContent = numero == null ? '' : numero;

    const geos = geometriaObra(o);
    const p = CadernoMapa.montarMapa(folha, base, {
      geometria: geos, estilo: estiloObra(o), icone: iconeObra(o, geos),
      // Obra curta (ponte, bueiro) aparece com o entorno, sem aproximar demais.
      zoomMax: soPontos(geos) ? 13 : 14
    });
    p.folha = folha;
    return p;
  }

  // ---------- Indice ----------
  const LINHAS_POR_COLUNA = 37, ENCOLHE_ATE = 0.6;
  function preencherIndice(folhas, linhas) {
    const porColuna = Math.max(LINHAS_POR_COLUNA, Math.ceil(linhas.length / (folhas.length * 2)));
    folhas.forEach(function(f, p) {
      f.style.setProperty('--indice-escala', (LINHAS_POR_COLUNA / porColuna).toFixed(3));
      const colunas = [0, 1].map(function(c) {
        const ini = (p * 2 + c) * porColuna;
        const parte = linhas.slice(ini, ini + porColuna);
        return '<div class="indice-coluna">' + parte.map(l => '<div class="indice-linha nivel-' + l.nivel + '">' +
          (l.num != null ? '<span class="id">' + l.num + '</span>' : '') + '<span class="nome">' + esc(l.texto) + '</span><span class="pag">' + (l.pagina || '') + '</span></div>').join('') + '</div>';
      }).join('');
      f.querySelector('.ob-corpo').innerHTML = (p === 0 ? '<h1 class="ob-h1">ÍNDICE</h1>' : '') + '<div class="indice-colunas">' + colunas + '</div>';
    });
  }
  const paginasIndice = n => Math.max(1, Math.ceil(n / (2 * Math.floor(LINHAS_POR_COLUNA / ENCOLHE_ATE))));

  // ---------- Caderno completo ----------
  async function gerarCaderno(base, opcoes) {
    const inicio = Date.now();
    $('btnGerar').disabled = true;
    status('Lendo obras…', false);
    $('paginas').innerHTML = '';
    const obras = await lerObras(opcoes.origens);
    await indexarBases(obras, base);
    status('Montando páginas…', false);
    const tem = s => opcoes.secoes.includes(s);
    const doc = estruturar(opcoes.origens, obras);
    if (!doc.length) { status('Nenhuma obra nas origens escolhidas', false); $('btnGerar').disabled = false; return; }
    const varias = doc.length > 1;

    // Titulos numerados: com uma origem, "1. RESUMO", "2. OBRAS ... EM ANDAMENTO", "2.1. TESOURO";
    // com varias, a origem vem antes ("1.2.1. TESOURO").
    const indice = [];
    const folhasNumeradas = [];   // [folha, linhaDoIndice?] na ordem: o numero sai da posicao final
    const marcar = (folha, linha) => { folhasNumeradas.push({ folha: folha, linha: linha }); return folha; };

    if (tem('capa')) montarCapa(opcoes.titulo, opcoes.ano);
    const linhasIndice = tem('indice') ? doc.reduce((n, org) => n + 1 + (tem('resumo') ? 1 : 0) +
      org.capitulos.reduce((m, c) => m + 1 + c.secoes.filter(s => s.titulo).length + (tem('pranchas') ? c.secoes.reduce((k, s) => k + s.itens.filter(temDesenho).length, 0) : 0), 0), 0) : 0;
    const folhasIndice = [];
    for (let i = 0; i < (tem('indice') ? paginasIndice(linhasIndice) : 0); i++) folhasIndice.push(marcar(novaFolhaConteudo('ob-indice')));

    const fila = [];
    doc.forEach(function(org, io) {
      const pre = varias ? (io + 1) + '.' : '';
      const lOrg = { nivel: 'origem', texto: (varias ? pre + ' ' : '') + org.titulo };
      indice.push(lOrg);
      marcar(montarDivisoria(org.titulo), lOrg);
      let n = 0;
      if (tem('resumo')) {
        n++;
        const l = { nivel: 'cap', texto: pre + n + '. RESUMO' };
        indice.push(l);
        marcar(montarTituloSecao(pre + n + '. RESUMO', null), l);
        montarResumo(org).forEach(f => marcar(f));
      }
      const cols = colunasPlanilha(org);
      org.capitulos.forEach(function(c) {
        n++;
        const nc = pre + n + '.';
        const lCap = { nivel: 'cap', texto: nc + ' ' + c.titulo };
        indice.push(lCap);
        c.secoes.forEach(function(s, is) {
          const ns = nc + (is + 1) + '.';
          const lSec = s.titulo ? { nivel: 'sec', texto: ns + ' ' + s.titulo } : null;
          if (lSec) indice.push(lSec);
          if (!tem('planilhas') && !tem('pranchas')) return;
          const fTit = marcar(montarTituloSecao(is === 0 ? nc + ' ' + c.titulo : null, s.titulo ? ns + ' ' + s.titulo : null), is === 0 ? lCap : null);
          if (lSec) folhasNumeradas[folhasNumeradas.length - 1].linha2 = lSec;
          if (tem('planilhas')) montarPlanilha(c.planilha + (s.titulo ? ' (' + s.titulo + ')' : ''), s.itens, cols).forEach(f => marcar(f));
          if (tem('pranchas')) {
            s.itens.filter(temDesenho).forEach(function(o) {
              const vaga = novaFolha('prancha prancha-pendente');
              vaga.innerHTML = '<div class="pendente-txt">Mapa nº ' + num(o) + ' · ' + esc(o.rodovia || '') + ' · ' + esc(o.descricao || '') + '</div>';
              const l = { nivel: 'item', num: num(o), texto: [o.rodovia, o.descricao].filter(Boolean).join(' · ') };
              indice.push(l);
              const item = { o: o, vaga: vaga };
              marcar(vaga, l).item = item;
              fila.push(item);
            });
          }
        });
      });
    });

    // Numeracao impressa: a capa nao conta (como no caderno da jurisdicao).
    const desconto = tem('capa') ? 1 : 0;
    const todas = Array.from($('paginas').children);
    folhasNumeradas.forEach(function(x) {
      const pagina = todas.indexOf(x.folha) + 1 - desconto;
      if (x.linha && x.linha.pagina == null) x.linha.pagina = pagina;
      if (x.linha2) x.linha2.pagina = pagina;
      if (x.item) x.item.pagina = pagina;
      const el = x.folha.querySelector('.ob-numero');
      if (el) el.textContent = pagina;
    });
    if (folhasIndice.length) preencherIndice(folhasIndice, indice);

    // Mapas: alguns ao mesmo tempo, cada um esperando as imagens de satelite.
    let feitas = 0;
    const total = fila.length;
    const atualizarStatus = () => status('Gerando mapas: ' + feitas + ' de ' + total + '…', false);
    atualizarStatus();
    async function trabalhador() {
      while (fila.length) {
        const t = fila.shift();
        const p = montarPrancha(t.o, base, t.pagina, t.vaga);
        await p.pronto;
        feitas++;
        atualizarStatus();
      }
    }
    await Promise.all(Array.from({ length: PRANCHAS_SIMULTANEAS }, trabalhador));

    const paginas = $('paginas').children.length;
    const seg = Math.round((Date.now() - inicio) / 1000);
    status('Pronto para imprimir · ' + paginas + ' páginas (' + seg + ' s)', true);
    $('btnGerar').disabled = false;
    document.title = opcoes.titulo + ' ' + opcoes.ano;
    Acesso.registrarEvento('exportou', 'Caderno de obras ' + opcoes.origens.join('+') + ' (' + paginas + ' páginas, ' + total + ' mapas)');
    return paginas;
  }

  // ---------- Opcoes ----------
  const tituloPadrao = origens => origens.length === 1
    ? (CONFIG_ORIGEM[origens[0]] ? CONFIG_ORIGEM[origens[0]].titulo : 'OBRAS · ' + origens[0])
    : origens.every(c => c === 'DOR' || c === 'DPJ') ? 'OBRAS E PROJETOS RODOVIÁRIOS' : 'OBRAS RODOVIÁRIAS';

  // Ordem das origens no caderno = ordem em que foram marcadas (o numero aparece ao lado do nome).
  let ordemOrigens = [];
  function origensMarcadas() { return ordemOrigens.slice(); }
  function mostrarOrdem() {
    document.querySelectorAll('input[name="origem"]').forEach(function(i) {
      const n = ordemOrigens.indexOf(i.value);
      i.parentNode.querySelector('.ordem').textContent = n < 0 || ordemOrigens.length < 2 ? '' : (n + 1) + 'º';
    });
  }

  // A escolha de origens fica no endereco (?origens=DOR,DPJ): recarregar a pagina mantem a selecao
  // e a regra de exportacao (js/acesso.js) confere todas elas.
  function guardarOrigens(origens) {
    const p = new URLSearchParams(location.search);
    p.set('origens', origens.join(','));
    history.replaceState(null, '', '?' + p.toString());
    Acesso.aplicarExportacao();
  }

  // ---------- Inicio ----------
  async function iniciar() {
    await Acesso.pronto;
    status('Carregando…', false);
    ORIGENS = await lerOrigens();
    const params = new URLSearchParams(location.search);
    const pedidas = String(params.get('origens') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const escolhidas = pedidas.filter(c => ORIGENS.some(o => o.codigo === c));
    if (!ORIGENS.length) { status('O caderno (PDF) não está liberado para o seu perfil.', false); return; }
    if (pedidas.length && !escolhidas.length) { status('O caderno (PDF) dessas origens não está liberado para o seu perfil.', false); return; }
    if (pedidas.length === 1) $('voltar').href = 'mapa.html?origem=' + encodeURIComponent(pedidas[0]);
    const origensIniciais = escolhidas.length ? escolhidas : [ORIGENS[0].codigo];

    const base = await CadernoMapa.carregarBase();
    const modo = params.get('modo') === 'completo' ? 'completo' : 'prancha';
    document.querySelectorAll('#modos button').forEach(function(b) {
      b.classList.toggle('ativo', b.dataset.modo === modo);
      b.addEventListener('click', function() {
        if (b.dataset.modo === modo) return;
        const p = new URLSearchParams(location.search);
        p.delete('codigo'); p.delete('gerar');
        if (b.dataset.modo === 'completo') p.set('modo', 'completo'); else p.delete('modo');
        location.search = p.toString();
      });
    });
    $('opcoesPrancha').hidden = modo !== 'prancha';
    $('opcoesCompleto').hidden = modo !== 'completo';

    $('btnImprimir').addEventListener('click', function() {
      Acesso.registrarEvento('exportou', modo === 'completo' ? 'imprimiu/salvou PDF do caderno de obras' : 'imprimiu/salvou PDF do mapa da obra ' + params.get('codigo'));
      window.print();
    });

    if (modo === 'completo') {
      $('grupoOrigens').innerHTML = ORIGENS.map(o => '<label><input type="checkbox" name="origem" value="' + esc(o.codigo) + '"' +
        (origensIniciais.includes(o.codigo) ? ' checked' : '') + '> ' + esc(o.nome) + '<sup class="ordem"></sup></label>').join('');
      ordemOrigens = origensIniciais.slice();
      mostrarOrdem();
      $('ano').value = params.get('ano') || new Date().getFullYear() + 1;
      $('titulo').value = params.get('titulo') || tituloPadrao(origensIniciais);
      let tituloMexido = !!params.get('titulo');
      $('titulo').addEventListener('input', () => { tituloMexido = true; });
      $('grupoOrigens').addEventListener('change', function(ev) {
        const v = ev.target.value;
        ordemOrigens = ordemOrigens.filter(c => c !== v);
        if (ev.target.checked) ordemOrigens.push(v);
        mostrarOrdem();
        const marcadas = origensMarcadas();
        if (!tituloMexido && marcadas.length) $('titulo').value = tituloPadrao(marcadas);
      });
      $('btnGerar').addEventListener('click', function() {
        const marcados = nome => Array.from(document.querySelectorAll('input[name="' + nome + '"]:checked')).map(i => i.value);
        const op = { origens: origensMarcadas(), secoes: marcados('secao'), ano: $('ano').value, titulo: $('titulo').value.trim() || tituloPadrao(origensMarcadas()) };
        if (!op.origens.length) { status('Escolha ao menos uma origem', false); return; }
        if (!op.secoes.length) { status('Escolha ao menos uma seção', false); return; }
        guardarOrigens(op.origens);
        gerarCaderno(base, op).catch(e => { console.error(e); status('Erro: ' + e.message, false); $('btnGerar').disabled = false; });
      });
      status('Escolha as opções e clique em "Gerar caderno"', false);
      if (params.get('gerar')) $('btnGerar').click();
      return;
    }

    // Prancha de uma obra: lista das obras das origens do endereco, na ordem e com o numero do caderno.
    status('Lendo obras…', false);
    const obras = await lerObras(origensIniciais);
    await indexarBases(obras, base);
    const doc = estruturar(origensIniciais, obras);
    const lista = doc.flatMap(org => org.obras.map(o => ({ o: o, org: org })));
    if (!lista.length) { status('Nenhuma obra nessa origem', false); return; }
    const codigo = params.get('codigo') || (lista.find(x => temDesenho(x.o)) || lista[0]).o.codigo;
    $('selObra').innerHTML = lista.map(x => '<option value="' + esc(x.o.codigo) + '"' + (x.o.codigo === codigo ? ' selected' : '') + '>' +
      (doc.length > 1 ? esc(x.org.codigo) + ' · ' : '') + 'Nº ' + num(x.o) + ' · ' + esc(x.o.rodovia || '') + ' · ' + esc(x.o.descricao || '') +
      (temDesenho(x.o) ? '' : ' (sem traçado)') + '</option>').join('');
    $('selObra').addEventListener('change', function() {
      params.set('codigo', this.value);
      location.search = params.toString();
    });
    const item = lista.find(x => x.o.codigo === codigo);
    if (!item) { status('Obra não encontrada', false); return; }
    document.title = 'Mapa ' + num(item.o) + ' · ' + (item.o.descricao || item.o.codigo);
    status('Carregando imagens de satélite…', false);
    const p = montarPrancha(item.o, base, params.get('pagina'));
    window.__mapaPrancha = p.map;
    await p.pronto;
    status('Pronto para imprimir', true);
    // Ao reenquadrar o mapa, espera as novas imagens antes de liberar a impressao.
    p.satelite.on('loading', () => status('Carregando imagens de satélite…', false));
    p.satelite.on('load', () => status('Pronto para imprimir', true));
  }

  iniciar().catch(e => { console.error(e); status('Erro: ' + e.message, false); });
})();
