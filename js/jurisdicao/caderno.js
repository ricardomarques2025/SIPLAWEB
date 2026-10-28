// Caderno A4 paisagem, no padrao do MODELO_CADERNO.pdf.
//   Modo "prancha": uma prancha (o mapa pode ser arrastado/ampliado para ajustar o enquadramento).
//   Modo "completo": capa, indice, tabela-resumo com o painel de indicadores e, por grupo
//   (Estadualizacao, Federalizacao, Municipalizacao), uma pagina divisoria e as pranchas
//   em ordem alfabetica dos municipios.

(function() {
  const $ = id => document.getElementById(id);
  const ORDEM_TIPOS = Indicadores.ORDEM_TIPOS;

  // Cores dos trechos no padrao do caderno (contorno + miolo).
  const ESTILO_TIPO_CADERNO = {
    'Estadualização': { contorno: '#e8212b', miolo: '#fff200' },
    'Federalização': { contorno: '#9fe2ff', miolo: '#0a6cff' },
    'Municipalização': { contorno: '#b9ff9f', miolo: '#17b81a' }
  };
  // Cores do texto de tipo na tabela-resumo (como na planilha original).
  const COR_TIPO_TABELA = { 'Estadualização': '#ed7d31', 'Federalização': '#2e75b6', 'Municipalização': '#3a9b3a' };
  const TITULO_GRUPO = { 'Estadualização': 'ESTADUALIZAÇÕES', 'Federalização': 'FEDERALIZAÇÕES', 'Municipalização': 'MUNICIPALIZAÇÕES' };

  const PRANCHAS_SIMULTANEAS = 3;

  const esc = CadernoMapa.esc, fmtKm = CadernoMapa.fmtKm;
  const fmtKmTabela = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

  function status(txt, ok) {
    $('status').textContent = txt;
    $('status').classList.toggle('ok', !!ok);
    $('btnImprimir').disabled = !ok;
  }

  // Numero impresso no caderno e nas pranchas: sequencial (1, 2, 3...) na ordem do documento gerado, em vez do id do
  // banco (que tem buracos: lixeira, testes apagados). numerar() refaz a lista a cada geracao.
  let NUMERO = new Map();
  function numerar(lista) { NUMERO = new Map(lista.map((r, i) => [r.id, i + 1])); }
  function num(r) { return NUMERO.get(r.id) || r.id; }

  // Ordem do caderno: grupo, depois municipios em ordem alfabetica (sem diferenciar acentos).
  function ordenar(lista) {
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base', ignorePunctuation: true });
    return lista.slice().sort((a, z) => (ORDEM_TIPOS.indexOf(a.tipo) - ORDEM_TIPOS.indexOf(z.tipo)) ||
      cmp(a.municipios, z.municipios) || cmp(a.rodovia, z.rodovia) || cmp(a.trecho, z.trecho) || a.id - z.id);
  }

  // ---------- Prancha ----------
  function legendaHTML(r) {
    const linhaLeg = CadernoMapa.linhaLeg;
    const tipos = ORDEM_TIPOS.map(t => linhaLeg(CadernoMapa.amostraDestaque(ESTILO_TIPO_CADERNO[t]), t)).join('');
    const processos = String(r.processos_sei || r.processo || '').split(/\s+/).filter(Boolean);
    return CadernoMapa.legendaBase() +
      '<div class="leg-tipo"><div class="cab">TIPO</div>' + tipos + '</div>' +
      '<div class="leg-processos"><div class="cab">PROCESSOS</div><div class="lista">' + processos.map(esc).join('<br>') + '</div></div>';
  }

  function novaFolha(classe) {
    const f = document.createElement('section');
    f.className = 'folha ' + classe;
    $('paginas').appendChild(f);
    return f;
  }

  // Cria a folha (ou usa a recebida) e devolve { folha, map, satelite, pronto } (js/caderno_mapa.js).
  function montarPrancha(r, base, numero, folhaExistente) {
    const folha = $('tplPrancha').content.firstElementChild.cloneNode(true);
    if (folhaExistente) folhaExistente.replaceWith(folha); else $('paginas').appendChild(folha);
    const q = sel => folha.querySelector(sel);

    q('.titulo-mapa').textContent = [r.rodovia, r.trecho].filter(Boolean).join(', ');
    q('.legenda').innerHTML = legendaHTML(r);
    q('.tabela-rodape tbody tr').innerHTML = [num(r), r.municipios, r.rodovia, r.trecho, fmtKm(r.extensao_km), r.status_detalhe]
      .map(v => '<td>' + esc(v) + '</td>').join('');
    CadernoMapa.caberTabela(q('.tabela-rodape'), folha);
    q('.numero-pagina').textContent = numero == null ? '' : numero;

    const p = CadernoMapa.montarMapa(folha, base, {
      geometria: Store.geometria(r.id),
      estilo: ESTILO_TIPO_CADERNO[r.tipo] || ESTILO_TIPO_CADERNO['Estadualização']
    });
    p.folha = folha;
    return p;
  }

  // ---------- Capa e divisorias ----------
  function montarCapa(ano) {
    const f = novaFolha('capa');
    f.innerHTML = '<div class="capa-ano">' + esc(ano) + '</div>';
  }

  function montarDivisoria(tipo) {
    const f = novaFolha('divisoria');
    f.innerHTML = '<div class="divisoria-titulo">' + TITULO_GRUPO[tipo] + '</div>';
  }

  // ---------- Indice ----------
  const LINHAS_POR_COLUNA = 37;

  function linhasIndice(grupos) {
    const linhas = [];
    grupos.forEach(function(g) {
      linhas.push({ grupo: g.tipo, pagina: g.pagina });
      g.itens.forEach(it => linhas.push({ id: num(it.r), nome: it.r.municipios, pagina: it.pagina }));
    });
    return linhas;
  }

  // O indice cabe numa folha: com mais linhas, elas encolhem (ate 60% da altura e da letra); so passa disso vai a 2 folhas.
  const ENCOLHE_ATE = 0.6;
  function linhasPorColuna(nLinhas) {
    const numaFolha = Math.ceil(nLinhas / 2);
    return numaFolha <= LINHAS_POR_COLUNA / ENCOLHE_ATE ? Math.max(LINHAS_POR_COLUNA, numaFolha) : LINHAS_POR_COLUNA;
  }
  function paginasIndice(nLinhas) { return Math.max(1, Math.ceil(nLinhas / (linhasPorColuna(nLinhas) * 2))); }

  function preencherIndice(folhas, linhas) {
    const porColuna = linhasPorColuna(linhas.length);
    folhas.forEach(function(f, p) {
      f.style.setProperty('--indice-escala', (LINHAS_POR_COLUNA / porColuna).toFixed(3));
      const colunas = [0, 1].map(function(c) {
        const ini = (p * 2 + c) * porColuna;
        const parte = linhas.slice(ini, ini + porColuna);
        if (!parte.length) return '<div class="indice-coluna"></div>';
        return '<div class="indice-coluna"><div class="indice-cab">Pág.</div>' + parte.map(l => l.grupo
          ? '<div class="indice-linha indice-grupo"><span class="nome">' + esc(l.grupo.toUpperCase()) + '</span><span class="pag">' + l.pagina + '</span></div>'
          : '<div class="indice-linha"><span class="id">' + l.id + '</span><span class="nome">' + esc(l.nome) + '</span><span class="pag">' + l.pagina + '</span></div>').join('') + '</div>';
      }).join('');
      f.innerHTML = (p === 0 ? '<h1 class="indice-titulo">ÍNDICE</h1>' : '') + '<div class="indice-colunas">' + colunas + '</div>';
    });
  }

  // ---------- Tabela-resumo ----------
  const COLUNAS_TABELA = [
    ['Nº', 'id'], ['TIPO', 'tipo'], ['Nº PROCESSO', 'processo'], ['MUNICÍPIOS', 'municipios'], ['RODOVIA', 'rodovia'],
    ['EXTENSÃO (KM)', 'extensao_km'], ['AUTORIZAÇÃO PORTARIA (SRE)', 'portaria_sre'], ['TRECHO URBANO', 'trecho_urbano', 'doc'],
    ['TRECHO', 'trecho'], ['LEI MUNICIPAL', 'lei_municipal', 'doc'], ['EXPOSIÇÃO DE MOTIVOS', 'exposicao_motivos', 'doc'],
    ['LEI ESTADUAL', 'lei_estadual', 'doc'], ['TERMO DE TRANSFERÊNCIA', 'termo_transferencia', 'doc'], ['SITUAÇÃO ATUAL', 'situacao']
  ];

  function painelTabela(lista, ano) {
    const ind = Indicadores.calcular(lista);
    const linhaTipo = (t, valor) => '<div class="pt-linha"><span style="color:' + COR_TIPO_TABELA[t] + '">' + Indicadores.PLURAL_TIPO[t].toUpperCase() + ':</span><b>' + valor + '</b></div>';
    const sit = Indicadores.SITUACOES_RESUMO.map(s => '<div class="pt-linha"><span>' + s[1].toUpperCase() + '</span><b>' + ind.situacoes[s[0]] + '</b></div>');
    return '<div class="tabela-titulo">PROCESSOS DE ALTERAÇÃO DE JURISDIÇÃO RODOVIÁRIA - ' + esc(ano) + '</div>' +
      '<div class="painel-tabela">' +
        '<div class="pt-caixa pt-num">' + Indicadores.icone('processos', 44) + '<div><div class="pt-valor">' + ind.total + '</div><div class="pt-rot">PROCESSOS<br>TOTAIS</div></div></div>' +
        '<div class="pt-caixa pt-lista">' + Indicadores.icone('extensao', 44) + '<div><div class="pt-titulo">EXTENSÕES TOTAIS</div>' +
          ORDEM_TIPOS.map(t => linhaTipo(t, fmtKmTabela(ind.porTipo[t].km) + ' km')).join('') + '</div></div>' +
        '<div class="pt-caixa pt-lista">' + Indicadores.icone('finalizados', 44) + '<div><div class="pt-titulo">FINALIZADOS</div>' +
          ORDEM_TIPOS.map(t => linhaTipo(t, ind.porTipo[t].finalizados)).join('') + '</div></div>' +
        '<div class="pt-caixa pt-sit">' + Indicadores.icone('situacao', 44) + '<div><div class="pt-titulo">SITUAÇÃO ATUAL</div><div class="pt-sit-grade">' + sit.join('') + '</div></div></div>' +
        '<div class="pt-caixa pt-num">' + Indicadores.icone('leiEstadual', 44) + '<div><div class="pt-valor">' + ind.leisEstaduais + '</div><div class="pt-rot">LEIS ESTADUAIS<br>APROVADAS</div></div></div>' +
        '<div class="pt-caixa pt-num">' + Indicadores.icone('leiMunicipal', 44) + '<div><div class="pt-valor">' + ind.leisMunicipais + '</div><div class="pt-rot">LEIS MUNICIPAIS<br>APROVADAS</div></div></div>' +
      '</div>';
  }

  function celulaTabela(r, col) {
    const v = col[1] === 'id' ? num(r) : r[col[1]];
    if (col[2] === 'doc') {
      const s = statusDoc(v);
      return '<td class="td-doc"><span class="doc-cel">' + Indicadores.iconeDoc(s, 9) + '<span>' + esc(Indicadores.textoDoc(v) || '-') + '</span></span></td>';
    }
    if (col[1] === 'tipo') return '<td class="td-tipo" style="color:' + (COR_TIPO_TABELA[v] || '#000') + '">' + esc(v) + '</td>';
    if (col[1] === 'extensao_km') return '<td>' + (v == null ? '' : fmtKmTabela(v)) + '</td>';
    return '<td>' + esc(v == null || v === '' ? '-' : v) + '</td>';
  }

  // Distribui as linhas em quantas paginas forem precisas, medindo a altura real de cada uma.
  function montarTabela(lista, ano) {
    const folhas = [];
    const cabecalho = '<thead><tr>' + COLUNAS_TABELA.map(c => '<th>' + c[0] + '</th>').join('') + '</tr></thead>';
    let folha = null, corpo = null, limite = 0;
    const nova = function() {
      folha = novaFolha('pagina-tabela');
      folha.innerHTML = (folhas.length === 0 ? painelTabela(lista, ano) : '') + '<table class="tabela-resumo">' + cabecalho + '<tbody></tbody></table><div class="numero-pagina"></div>';
      corpo = folha.querySelector('tbody');
      const caixa = folha.getBoundingClientRect();
      limite = caixa.top + caixa.height * (198 / 210);
      folhas.push(folha);
    };
    nova();
    lista.forEach(function(r) {
      const tr = document.createElement('tr');
      tr.innerHTML = COLUNAS_TABELA.map(c => celulaTabela(r, c)).join('');
      corpo.appendChild(tr);
      if (tr.getBoundingClientRect().bottom > limite && corpo.children.length > 1) {
        tr.remove();
        nova();
        corpo.appendChild(tr);
      }
    });
    return folhas;
  }

  // ---------- Caderno completo ----------
  async function gerarCaderno(base, opcoes) {
    const inicio = Date.now();
    $('btnGerar').disabled = true;
    status('Montando páginas…', false);
    $('paginas').innerHTML = '';
    $('paginas').classList.add('completo');

    const lista = ordenar(Store.lista().filter(r => opcoes.grupos.includes(r.tipo)));
    numerar(lista);
    // Prancha (e item do indice) so para registro com traçado; sem ele o mapa mostraria Goias inteiro.
    // Os sem traçado continuam na tabela-resumo.
    const grupos = ORDEM_TIPOS.filter(t => opcoes.grupos.includes(t))
      .map(t => ({ tipo: t, itens: lista.filter(r => r.tipo === t && Store.geometria(r.id)).map(r => ({ r: r })) }))
      .filter(g => g.itens.length);
    const tem = s => opcoes.secoes.includes(s);

    // Paginas fixas primeiro; a numeracao impressa segue o modelo (a capa nao conta).
    if (tem('capa')) montarCapa(opcoes.ano);
    // Conta as linhas que o indice realmente lista (grupos + registros com prancha), senao sobra folha em branco.
    const linhasNoIndice = grupos.reduce((n, g) => n + 1 + g.itens.length, 0);
    const nIndice = tem('indice') ? paginasIndice(linhasNoIndice) : 0;
    const folhasIndice = [];
    for (let i = 0; i < nIndice; i++) folhasIndice.push(novaFolha('pagina-indice'));
    const folhasTabela = tem('tabela') ? montarTabela(lista, opcoes.ano) : [];

    const desconto = tem('capa') ? 1 : 0;
    let fisica = $('paginas').children.length;
    folhasTabela.forEach((f, i) => { f.querySelector('.numero-pagina').textContent = fisica - folhasTabela.length + i + 1 - desconto; });

    // Divisoria + pranchas de cada grupo (sem pranchas, o indice sai sem numero de pagina).
    const fila = [];
    if (tem('pranchas')) {
      grupos.forEach(function(g) {
        fisica++;
        g.pagina = fisica - desconto;
        montarDivisoria(g.tipo);
        g.itens.forEach(function(it) {
          fisica++;
          it.pagina = fisica - desconto;
          const vaga = novaFolha('prancha prancha-pendente');
          vaga.innerHTML = '<div class="pendente-txt">Prancha nº ' + num(it.r) + ' · ' + esc(it.r.municipios) + '</div>';
          fila.push({ it: it, vaga: vaga });
        });
      });
    } else {
      grupos.forEach(g => { g.pagina = ''; g.itens.forEach(it => { it.pagina = ''; }); });
    }
    if (folhasIndice.length) preencherIndice(folhasIndice, linhasIndice(grupos));

    // Pranchas: algumas ao mesmo tempo, cada uma esperando as imagens de satelite.
    let feitas = 0;
    const total = fila.length;
    const atualizarStatus = () => status('Gerando pranchas: ' + feitas + ' de ' + total + '…', false);
    atualizarStatus();
    async function trabalhador() {
      while (fila.length) {
        const t = fila.shift();
        const p = montarPrancha(t.it.r, base, t.it.pagina, t.vaga);
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
    document.title = 'Caderno ' + opcoes.ano + ' · Alterações de Jurisdição';
    Store.registrarEvento('prancha', 'gerou o caderno completo (' + paginas + ' páginas, ' + total + ' pranchas)');
    return paginas;
  }

  function lerOpcoes() {
    const marcados = nome => Array.from(document.querySelectorAll('input[name="' + nome + '"]:checked')).map(i => i.value);
    return { grupos: marcados('grupo'), secoes: marcados('secao'), ano: $('ano').value || new Date().getFullYear() };
  }

  // ---------- Inicio ----------
  async function iniciar() {
    // Sem login, volta para a planilha (que mostra a tela de entrada).
    if (!(await Store.sessao())) { location.replace('index.html'); return; }
    status('Carregando dados…', false);
    await Store.carregar();
    if (!Acesso.podeExportar('JURISDICAO')) { status('O caderno (PDF) não está liberado para o seu perfil.', false); return; }
    const base = await CadernoMapa.carregarBase();

    const params = new URLSearchParams(location.search);
    const modo = params.get('modo') === 'completo' ? 'completo' : 'prancha';
    document.querySelectorAll('#modos button').forEach(function(b) {
      b.classList.toggle('ativo', b.dataset.modo === modo);
      b.addEventListener('click', function() {
        if (b.dataset.modo === modo) return;
        const p = new URLSearchParams();
        if (b.dataset.modo === 'completo') p.set('modo', 'completo'); else if (params.get('id')) p.set('id', params.get('id'));
        location.search = p.toString();
      });
    });
    $('opcoesPrancha').hidden = modo !== 'prancha';
    $('opcoesCompleto').hidden = modo !== 'completo';
    $('ano').value = params.get('ano') || new Date().getFullYear();

    $('btnImprimir').addEventListener('click', function() {
      Store.registrarEvento('prancha', modo === 'completo' ? 'imprimiu/salvou PDF do caderno completo' : 'imprimiu/salvou PDF da prancha #' + params.get('id'));
      window.print();
    });

    if (modo === 'completo') {
      $('btnGerar').addEventListener('click', function() {
        const op = lerOpcoes();
        if (!op.grupos.length) { status('Escolha ao menos um grupo', false); return; }
        if (!op.secoes.length) { status('Escolha ao menos uma seção', false); return; }
        gerarCaderno(base, op).catch(e => { console.error(e); status('Erro: ' + e.message, false); $('btnGerar').disabled = false; });
      });
      status('Escolha as opções e clique em "Gerar caderno"', false);
      if (params.get('gerar')) $('btnGerar').click();
      return;
    }

    const lista = ordenar(Store.lista());
    numerar(lista);
    const id = Number(params.get('id')) || lista[0].id;
    $('selRegistro').innerHTML = lista.map(r => '<option value="' + r.id + '"' + (r.id === id ? ' selected' : '') + '>Nº ' + num(r) + ' · ' +
      esc(r.tipo) + ' · ' + esc(r.municipios) + (Store.geometria(r.id) ? '' : ' (sem traçado)') + '</option>').join('');
    $('selRegistro').addEventListener('change', function() {
      params.set('id', this.value);
      location.search = params.toString();
    });

    const r = Store.obter(id);
    if (!r) { status('Registro não encontrado', false); return; }
    Store.registrarEvento('prancha', 'abriu a prancha #' + id);
    document.title = 'Prancha ' + num(r) + ' · ' + (r.municipios || '');
    status('Carregando imagens de satélite…', false);
    const p = montarPrancha(r, base, params.get('pagina'));
    window.__mapaPrancha = p.map;
    await p.pronto;
    status('Pronto para imprimir', true);
    // Ao reenquadrar o mapa, espera as novas imagens antes de liberar a impressao.
    p.satelite.on('loading', () => status('Carregando imagens de satélite…', false));
    p.satelite.on('load', () => status('Pronto para imprimir', true));
  }

  iniciar().catch(e => { console.error(e); status('Erro: ' + e.message, false); });
})();
