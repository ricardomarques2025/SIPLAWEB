// Tabela do modulo Jurisdicao sobre o mapa do SIPLAWEB (vinda do site do jurisdicao):
// "Abrir tabela" no painel JURISDICAO do menu esquerdo; tela cheia ou dividida com o mapa (largura
// ajustavel arrastando a borda); ficha de detalhes (dados, tramitacao, historico), exportacao, novo
// registro e exclusao. Fechar volta so ao mapa.
// Mesmo fluxo da tabela de obras: edicao pendente (amarelo) ate "Revisar e salvar" (editor pleno) ou
// "Revisar e enviar" (editor basico: vira proposta; tramite e registro novo tambem). O pleno decide em
// "Aprovações". Excluir e remover tramite sao do pleno. Visual das conferencias: css/obras.css (.obr-ui).

var JurisdicaoPainel = (function() {
  if (!Jurisdicao.ativo()) return null;

  var LIBS = {
    tabulatorCss: 'https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css',
    tabulatorJs: 'https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };
  var ACOES = {
    criado: 'Criou o registro', editado: 'Editou', tracado: 'Alterou o traçado', tramitado: 'Registrou trâmite',
    tramite_editado: 'Alterou trâmite', tramite_removido: 'Removeu trâmite', excluido: 'Excluiu (lixeira)', restaurado: 'Restaurou', apagado: 'Apagou'
  };

  var CHAVE_LARGURA = 'siplaweb.jurisdicao.larguraTabela';
  var LARGURA_MIN = 30, LARGURA_MAX = 80;   // % da janela no modo dividido
  var modo = 'fechado';        // fechado | cheia | dividida
  var selecionadoAtual = null;
  var legendaRecolhidaPorNos = false;
  var tabelaPronta = null;
  var gavetaId = null;
  var abaGaveta = 'dados';
  var erroStatus = null;

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtData(v) { if (!v) return ''; var p = String(v).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtDataHora(v) { return v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  function hojeIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

  function toast(msg, erro) {
    var el = document.createElement('div');
    el.className = 'toast' + (erro ? ' toast-erro' : '');
    el.textContent = msg;
    $('jurToasts').appendChild(el);
    setTimeout(function() { el.remove(); }, erro ? 7000 : 3200);
  }

  function carregarScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.onload = resolve; s.onerror = function() { reject(new Error('Falha ao carregar ' + url)); };
      document.head.appendChild(s);
    });
  }
  function carregarCss(url) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = url;
    document.head.appendChild(l);
  }

  // ---------- Montagem ----------
  var SPRITE =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
      '<symbol id="i-table" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M3 15h18M9 10v11"/></symbol>' +
      '<symbol id="i-split" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 3v18"/></symbol>' +
      '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>' +
      '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
      '<symbol id="i-down" viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></symbol>' +
      '<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>' +
      '<symbol id="i-cols" viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z"/></symbol>' +
      '<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></symbol>' +
      '<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></symbol>' +
      '<symbol id="i-filter-x" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4zM16 16l5 5M21 16l-5 5"/></symbol>' +
      '<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></symbol>' +
    '</svg>';

  function montar() {
    var ui = document.createElement('div');
    ui.className = 'jur-ui obr-ui';
    ui.id = 'jurUi';
    ui.innerHTML = SPRITE +
      '<section class="jur-tabela" id="jurTabela" hidden data-modo="cheia">' +
        '<div class="jur-tabela-topo">' +
          '<b class="jur-tabela-titulo">Jurisdição · Tabela</b><span class="lt-selo" hidden></span>' +
          '<nav class="segmentado" aria-label="Modo da tabela">' +
            '<button type="button" data-jur-modo="cheia"><svg><use href="#i-table"/></svg>Tela cheia</button>' +
            '<button type="button" data-jur-modo="dividida"><svg><use href="#i-split"/></svg>Dividida com o mapa</button>' +
          '</nav>' +
          '<button type="button" class="btn btn-primario so-editor" id="jurRevisar" disabled><svg><use href="#i-check"/></svg>Revisar e salvar</button>' +
          '<span class="obr-pendentes" id="jurPendentes" hidden></span>' +
          '<button type="button" class="btn btn-fantasma so-editor" id="jurDescartar" hidden>Descartar</button>' +
          '<button type="button" class="btn so-editor" id="jurAprovacoes"></button>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="pill-status" id="jurStatus" title="Recarregar os dados do banco"><span class="ponto"></span><span id="jurTxtStatus">Carregando…</span></button>' +
          '<div class="menu" data-exportar>' +
            '<button type="button" class="btn btn-primario" data-jur-menu="jurMenuExportar"><svg><use href="#i-down"/></svg>Exportar</button>' +
            '<div class="menu-lista direita" id="jurMenuExportar">' +
              '<div class="menu-rotulo">Planilha</div>' +
              '<button type="button" data-jur-acao="exp-xlsx">Excel (.xlsx) — todos</button>' +
              '<button type="button" data-jur-acao="exp-xlsx-filtro">Excel (.xlsx) — filtrados</button>' +
              '<button type="button" data-jur-acao="exp-csv">CSV</button>' +
              '<div class="menu-rotulo">Mapa</div>' +
              '<button type="button" data-jur-acao="exp-geojson-qgis">GeoJSON com atributos (QGIS)</button>' +
              '<div class="menu-rotulo">Caderno</div>' +
              '<button type="button" data-jur-acao="caderno-completo">Caderno completo (PDF)</button>' +
              '<button type="button" data-jur-acao="caderno">Prancha A4 do registro (PDF)</button>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn-icone" id="jurFecharTabela" title="Fechar a tabela e voltar ao mapa"><svg><use href="#i-x"/></svg></button>' +
        '</div>' +
        '<section class="resumo" id="jurResumoTabela"></section>' +
        '<section class="ferramentas">' +
          '<label class="busca"><svg><use href="#i-search"/></svg><input id="jurTBusca" type="search" placeholder="Buscar município, rodovia, processo, trecho…" autocomplete="off"></label>' +
          '<select id="jurTTipo" class="seletor"><option value="">Todos os tipos</option></select>' +
          '<select id="jurTSituacao" class="seletor"><option value="">Todas as situações</option></select>' +
          '<select id="jurTGeo" class="seletor"><option value="">Com e sem traçado</option><option value="com">Com traçado</option><option value="sem">Sem traçado</option></select>' +
          '<button type="button" class="btn btn-fantasma" id="jurTLimpar" title="Limpar filtros"><svg><use href="#i-filter-x"/></svg></button>' +
          '<span class="contador" id="jurTContador"></span>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn so-editor so-pleno" id="jurMalha" title="Trechos da malha complementar (extra_base)">Malha complementar</button>' +
          '<button type="button" class="btn" id="jurTColunas"><svg><use href="#i-cols"/></svg>Colunas</button>' +
          '<button type="button" class="btn btn-primario so-editor" id="jurTNovo"><svg><use href="#i-plus"/></svg>Novo registro</button>' +
        '</section>' +
        '<div class="painel-tabela"><div id="jurGrade"></div></div>' +
        '<div class="jur-redimensionar" id="jurRedimensionar" title="Arraste para aumentar ou diminuir a tabela"></div>' +
      '</section>' +
      '<aside class="gaveta" id="jurGaveta" aria-hidden="true">' +
        '<div class="gaveta-topo"><div><div class="gaveta-sup" id="jurGavetaSup"></div><h2 id="jurGavetaTitulo"></h2></div>' +
          '<button type="button" class="btn-icone" id="jurFecharGaveta" title="Fechar"><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="gaveta-abas"><button type="button" class="ativo" data-aba="dados">Dados</button><button type="button" data-aba="tracado">Traçado</button><button type="button" data-aba="tramitacao">Tramitação</button><button type="button" data-aba="historico">Histórico</button></div>' +
        '<div class="gaveta-corpo" id="jurGavetaCorpo"></div>' +
        '<div class="gaveta-rodape">' +
          '<button type="button" class="btn btn-perigo-fantasma so-editor so-pleno" id="jurExcluir"><svg><use href="#i-trash"/></svg>Excluir</button>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn" id="jurPrancha" data-exportar title="Abrir a prancha A4 deste registro"><svg><use href="#i-down"/></svg>Prancha</button>' +
          '<button type="button" class="btn btn-primario" id="jurVerMapa"><svg><use href="#i-pin"/></svg>Ver no mapa</button>' +
        '</div>' +
      '</aside>' +
      '<dialog id="jurDlgColunas" class="dialogo dialogo-pequeno">' +
        '<div class="dialogo-topo"><h3>Colunas visíveis</h3><button type="button" class="btn-icone" data-jur-fechar><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="jurDlgColunasCorpo"></div>' +
      '</dialog>' +
      '<dialog id="jurDlgRevisao" class="dialogo"><div class="dialogo-topo"><h3 id="jurRevisaoTitulo">Conferir antes de salvar</h3><button type="button" class="btn-icone" data-jur-fechar><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="jurRevisaoCorpo"></div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="jurRevisaoAviso"></span><div class="espaco"></div>' +
          '<button type="button" class="btn" data-jur-fechar>Voltar e corrigir</button>' +
          '<button type="button" class="btn btn-primario" id="jurConfirmar"><svg><use href="#i-check"/></svg>Confirmar e salvar</button></div></dialog>' +
      '<dialog id="jurDlgAprov" class="dialogo"><div class="dialogo-topo"><h3 id="jurAprovTitulo">Aprovações</h3><button type="button" class="btn-icone" data-jur-fechar><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="jurAprovCorpo"></div></dialog>' +
      '<dialog id="jurDlgNovo" class="dialogo dialogo-pequeno"><form id="jurFormNovo"><div class="dialogo-topo"><h3>Novo registro · Jurisdição</h3><button type="button" class="btn-icone" data-jur-fechar><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="jurNovoCorpo"></div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="jurNovoAviso"></span><div class="espaco"></div><button type="submit" class="btn btn-primario"><svg><use href="#i-check"/></svg>Cadastrar</button></div></form></dialog>' +
      '<div class="toasts" id="jurToasts"></div>';
    document.body.appendChild(ui);
    Acesso.pronto.then(Acesso.aplicarExportacao);   // antes do login o perfil ainda e nulo e esconderia o Exportar de todos
    JurTracado.montar(ui);

    Object.keys(TIPOS).forEach(function(t) { $('jurTTipo').add(new Option(t, t)); });
    Object.keys(SITUACOES).forEach(function(s) { $('jurTSituacao').add(new Option(s, s)); });

    $('jurAbrirTabela').addEventListener('click', function() { definirModo('cheia'); });
    ligarEventos();
    // As propostas chegam com a carga do modulo: o pleno ve "N para aprovar" no menu antes de abrir a tabela.
    Store.ouvir(function(evento) {
      if (evento === 'propostas') atualizarAprovacoes();
      // Linha do tempo: data passada = só leitura e situação daquela data.
      if (evento === 'visao') {
        JurTracado.encerrar();
        $('jurUi').classList.toggle('somente-leitura', !Store.podeEditar());
        $('jurUi').classList.toggle('sem-pleno', !Store.podeGravar());
        if (tabelaPronta) { Tabela.recarregar(); aplicarFiltros(); }
        if (gavetaId != null) renderGaveta();
      }
    });
    if (window.LinhaTempo) LinhaTempo.atualizarSelos();
  }

  // ---------- Modos ----------
  function larguraSalva() {
    var v = NaN;
    try { v = Number(localStorage.getItem(CHAVE_LARGURA)); } catch (e) { /* sem storage: usa o padrao */ }
    return v >= LARGURA_MIN && v <= LARGURA_MAX ? v : 55;
  }
  function aplicarLargura(pct) { $('jurUi').style.setProperty('--jur-largura', pct + 'vw'); }

  // Legenda (barra direita) recolhida no modo dividido; volta como estava ao sair dele.
  function recolherLegenda(recolher) {
    var barra = document.getElementById('sidebar-right');
    var botao = document.getElementById('toggleSidebarRight');
    if (!barra || typeof definirSidebarRecolhida !== 'function') return;
    var recolhida = barra.classList.contains('sidebar-colapsed');
    if (recolher && !recolhida) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botao, true); legendaRecolhidaPorNos = true; }
    else if (!recolher && legendaRecolhidaPorNos) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botao, false); legendaRecolhidaPorNos = false; }
  }

  // Area do mapa que sobra visivel: entre a tabela (dividida) e a ficha de detalhes (se aberta).
  function margensVisiveis() {
    var m = map.getContainer().getBoundingClientRect();
    var esquerda = modo === 'dividida' ? Math.max(0, $('jurTabela').getBoundingClientRect().right - m.left) : 0;
    var g = $('jurGaveta');
    var direita = g.classList.contains('aberta') ? Math.max(0, m.right - (window.innerWidth - g.offsetWidth)) : 0;
    return [esquerda, direita];
  }

  // Centraliza o trecho selecionado no que sobrou do mapa (espera as barras terminarem de se mover).
  var tempoCentralizar = null;
  function centralizarSelecionado(atraso) {
    clearTimeout(tempoCentralizar);
    tempoCentralizar = setTimeout(function() {
      if (selecionadoAtual == null || modo === 'cheia') return;
      map.invalidateSize();
      var m = margensVisiveis();
      Jurisdicao.focar(selecionadoAtual, m[0], m[1]);
    }, atraso || 0);
  }

  function posicionar() {
    var topo = document.getElementById('topbar');
    $('jurUi').style.setProperty('--jur-topo', (topo ? topo.getBoundingClientRect().bottom : 60) + 'px');
  }

  function iniciarTabela() {
    if (!tabelaPronta) {
      carregarCss(LIBS.tabulatorCss);
      tabelaPronta = Promise.all([carregarScript(LIBS.tabulatorJs), Jurisdicao.carregar()]).then(function() {
        document.getElementById('jurUi').classList.toggle('somente-leitura', !Store.podeEditar());
        document.getElementById('jurUi').classList.toggle('sem-pleno', !Store.podeGravar());
        document.getElementById('jurUi').classList.toggle('admin', Store.eAdmin());
        return Tabela.iniciar({ aoSelecionar: selecionar, aoAbrir: abrirGaveta, aoVerMapa: verNoMapa, aoFiltrar: aoFiltrar });
      }).then(function() {
        Store.ouvir(aoMudarStore);
        aplicarFiltros();
        atualizarStatus();
        atualizarPendentes();
        atualizarAprovacoes();
      });
    }
    return tabelaPronta;
  }

  function definirModo(novo) {
    var anterior = modo;
    modo = novo;
    var painel = $('jurTabela');
    document.body.classList.toggle('jur-tabela-aberta', novo !== 'fechado');
    recolherLegenda(novo === 'dividida');
    if (novo === 'fechado') {
      painel.hidden = true;
      fecharGaveta();
      return Promise.resolve();
    }
    posicionar();
    aplicarLargura(larguraSalva());
    painel.dataset.modo = novo;
    if (anterior === 'fechado') {
      // Leve animacao ao abrir: a tabela desliza a partir do menu esquerdo.
      painel.classList.remove('jur-entrando');
      void painel.offsetWidth;
      painel.classList.add('jur-entrando');
    }
    painel.hidden = false;
    document.querySelectorAll('[data-jur-modo]').forEach(function(b) { b.classList.toggle('ativo', b.dataset.jurModo === novo); });
    return iniciarTabela().then(function() {
      // A largura muda com animacao (.35s); redesenha a grade e o mapa ao final.
      setTimeout(function() { Tabela.redesenhar(); map.invalidateSize(); }, 380);
      if (novo === 'dividida') centralizarSelecionado(420);
    }).catch(function(e) { toast('Não foi possível abrir a tabela: ' + e.message, true); });
  }

  // Alca na borda direita da tabela (modo dividido): arrastar aumenta ou diminui a area da tabela.
  function ligarRedimensionar() {
    var alca = $('jurRedimensionar');
    var painel = $('jurTabela');
    alca.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      alca.setPointerCapture(e.pointerId);
      painel.classList.add('arrastando');
      function mover(ev) {
        var pct = Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, ev.clientX / window.innerWidth * 100));
        aplicarLargura(pct.toFixed(1));
      }
      function soltar() {
        alca.removeEventListener('pointermove', mover);
        alca.removeEventListener('pointerup', soltar);
        painel.classList.remove('arrastando');
        var pct = painel.getBoundingClientRect().width / window.innerWidth * 100;
        try { localStorage.setItem(CHAVE_LARGURA, pct.toFixed(1)); } catch (x) { /* sem storage */ }
        Tabela.redesenhar();
        centralizarSelecionado(50);
      }
      alca.addEventListener('pointermove', mover);
      alca.addEventListener('pointerup', soltar);
    });
  }

  // ---------- Filtros (estado unico em Jurisdicao) ----------
  function aplicarFiltros() {
    if (!tabelaPronta) return;
    var f = Jurisdicao.filtros();
    Tabela.aplicarFiltro(function(r) { return Jurisdicao.atende(Store.obter(r.id) || r); });
    [['jurTTipo', 'tipo'], ['jurTSituacao', 'situacao'], ['jurTGeo', 'geo']].forEach(function(p) {
      $(p[0]).value = f[p[1]];
      $(p[0]).classList.toggle('ativo', !!f[p[1]]);
    });
    if (document.activeElement !== $('jurTBusca')) $('jurTBusca').value = f.busca;
    Jurisdicao.renderResumo($('jurResumoTabela'), false);
  }

  function aoFiltrar(ids) {
    $('jurTContador').textContent = ids.length + ' de ' + Store.lista().length + ' registros';
  }

  // ---------- Selecao / detalhes ----------
  function selecionar(id, origem) {
    selecionadoAtual = id;
    Jurisdicao.selecionar(id);
    if (origem === 'mapa' && tabelaPronta && modo !== 'fechado') Tabela.selecionar(id, true);
    if (gavetaId != null && gavetaId !== id) abrirGaveta(id);
    // Na tabela dividida, clicar numa linha leva o mapa ate o trecho.
    if (origem === 'tabela' && modo === 'dividida' && Store.geometria(id)) centralizarSelecionado(gavetaId != null ? 250 : 0);
  }

  function abrirGaveta(id) {
    var r = Store.obter(id);
    if (!r) return;
    if (id !== gavetaId) JurTracado.encerrar();
    gavetaId = id;
    selecionadoAtual = id;
    posicionar();
    if (tabelaPronta && modo !== 'fechado') Tabela.selecionar(id, true);
    Jurisdicao.selecionar(id);
    renderGaveta();
    $('jurGaveta').classList.add('aberta');
    $('jurGaveta').setAttribute('aria-hidden', 'false');
  }

  function fecharGaveta() {
    JurTracado.encerrar();
    gavetaId = null;
    $('jurGaveta').classList.remove('aberta');
    $('jurGaveta').setAttribute('aria-hidden', 'true');
  }

  // O que a aba Traçado (js/jurisdicao/tracado.js) usa do painel. Escolhendo ou desenhando no mapa, a tabela
  // encolhe ao mínimo para sobrar mapa entre ela e a ficha; volta ao tamanho de antes ao terminar.
  var tabelaEncolhida = false;
  var apiTracado = {
    toast: function(msg, erro) { toast(msg, erro); },
    margens: function() { return margensVisiveis(); },
    mostrarMapa: function(encolher) {
      return (modo === 'dividida' ? Promise.resolve() : definirModo('dividida')).then(function() {
        if (!encolher || tabelaEncolhida) return;
        tabelaEncolhida = true;
        aplicarLargura(LARGURA_MIN);
        return new Promise(function(resolve) { setTimeout(function() { Tabela.redesenhar(); map.invalidateSize(); resolve(); }, 380); });
      });
    },
    aoEncerrar: function() {
      if (!tabelaEncolhida) return;
      tabelaEncolhida = false;
      if (modo === 'dividida') { aplicarLargura(larguraSalva()); setTimeout(function() { Tabela.redesenhar(); map.invalidateSize(); }, 380); }
    },
    aoMudar: function() { if (gavetaId != null) renderCabecalhoGaveta(); }
  };

  function renderCabecalhoGaveta() {
    var r = Store.obter(gavetaId);
    var tipo = TIPOS[r.tipo] || { cor: '#6b7280' };
    var sit = SITUACOES[r.situacao] || { cor: '#6b7280' };
    $('jurGavetaSup').innerHTML = '#' + r.id + ' <span class="tipo" style="--c:' + tipo.cor + '"><i></i>' + esc(r.tipo || '—') + '</span>' +
      (r.situacao ? '<span class="badge" style="--c:' + sit.cor + '">' + esc(r.situacao) + '</span>' : '');
    $('jurGavetaTitulo').textContent = [r.rodovia, r.municipios].filter(Boolean).join(' — ') || 'Novo registro';
    $('jurVerMapa').disabled = !Store.geometria(gavetaId);
    $('jurVerMapa').title = Store.geometria(gavetaId) ? 'Mostrar o trecho no mapa' : 'Registro sem traçado';
  }

  function renderGaveta() {
    if (gavetaId == null) return;
    renderCabecalhoGaveta();
    document.querySelectorAll('#jurGaveta .gaveta-abas button').forEach(function(b) { b.classList.toggle('ativo', b.dataset.aba === abaGaveta); });
    if (abaGaveta !== 'tracado') JurTracado.encerrar();
    if (abaGaveta === 'tracado') { JurTracado.render($('jurGavetaCorpo'), Store.obter(gavetaId), apiTracado); return; }
    if (abaGaveta === 'historico') { renderHistorico(gavetaId); return; }
    if (abaGaveta === 'tramitacao') { renderTramitacao(gavetaId); return; }
    var r = Store.obter(gavetaId);
    var grupos = [];
    CAMPOS.forEach(function(c) { if (grupos.indexOf(c.grupo) === -1) grupos.push(c.grupo); });
    var autor = Store.nomeUsuario(r.atualizado_por);
    $('jurGavetaCorpo').innerHTML = avisoProposta(r) + '<div class="carimbo">Última alteração: ' + fmtDataHora(r.atualizado_em) + (autor ? ' · ' + esc(autor) : '') + '</div>' +
      grupos.map(function(g) {
        return '<div class="form-grupo"><h4>' + g + '</h4><div class="form-grade">' +
          CAMPOS.filter(function(c) { return c.grupo === g; }).map(function(c) { return renderCampo(c, r); }).join('') + '</div></div>';
      }).join('');
  }

  function avisoProposta(r) {
    var p = Store.propostaPendente(r.id);
    if (!p) return '';
    return '<div class="obr-aviso-proposta">◷ Proposta de <b>' + esc(Store.nomeUsuario(p.criado_por) || '—') + '</b> em ' + fmtDataHora(p.criado_em) +
      ' aguardando aprovação (' + Object.keys(p.mudancas).map(tituloCampo).join(', ') + '). <button type="button" class="link" data-abrir-aprovacoes>Ver</button></div>';
  }

  function renderCampo(c, r) {
    var v = Store.valorAtual(r.id, c.campo);
    v = v == null ? '' : v;
    var editado = Store.pendente(r.id, c.campo) ? ' editado' : '';
    var largo = (c.tipo === 'longo' || c.tipo === 'doc' || c.campo === 'municipios') ? ' largo' : '';
    var bloqueio = Store.podeEditar() ? '' : ' disabled';
    var entrada;
    if (c.tipo === 'lista') {
      entrada = '<select data-campo="' + c.campo + '"' + bloqueio + '><option value=""></option>' +
        c.opcoes.map(function(o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (c.tipo === 'longo') {
      entrada = '<textarea data-campo="' + c.campo + '" rows="3"' + bloqueio + '>' + esc(v) + '</textarea>';
    } else if (c.tipo === 'doc') {
      var s = statusDoc(v);
      var sel = s === 'sim' ? 'SIM' : s === 'nao' ? 'NÃO' : s === 'parcial' ? 'PARCIAL' : s === 'na' ? 'NÃO SE APLICA' : '';
      var detalhe = (s === 'sim' && String(v).trim().toUpperCase() !== 'SIM') || s === 'vazio' ? v : '';
      entrada = '<div class="doc-campo"><select data-doc="' + c.campo + '"' + bloqueio + '>' +
        ['', 'SIM', 'NÃO', 'PARCIAL', 'NÃO SE APLICA'].map(function(o) { return '<option value="' + o + '"' + (o === sel ? ' selected' : '') + '>' + (o || '—') + '</option>'; }).join('') +
        '</select><input data-doc-texto="' + c.campo + '" placeholder="Nº do ato / descrição (opcional)" value="' + esc(detalhe === '-' ? '' : detalhe) + '"' + bloqueio + '></div>';
    } else {
      entrada = '<input data-campo="' + c.campo + '"' + (c.tipo === 'numero' ? ' type="number" step="any"' : '') +
        (c.somenteLeitura ? ' readonly' : bloqueio) + ' value="' + esc(v) + '">';
    }
    return '<div class="campo' + largo + editado + '" data-wrap="' + c.campo + '"><label><span class="marcador"></span>' + c.titulo + '</label>' + entrada + '</div>';
  }

  function aoEditarGaveta(e) {
    var t = e.target;
    if (gavetaId == null || !Store.podeEditar()) return;
    if (t.closest('.form-tramite')) return;
    if (t.dataset.campo) {
      var c = CAMPOS.find(function(x) { return x.campo === t.dataset.campo; });
      var v = t.value.trim();
      if (c.tipo === 'numero') v = v === '' ? null : Number(v);
      Store.atualizar(gavetaId, c.campo, v);
    } else if (t.dataset.doc || t.dataset.docTexto) {
      var campo = t.dataset.doc || t.dataset.docTexto;
      var sel = document.querySelector('#jurGaveta [data-doc="' + campo + '"]');
      var txt = document.querySelector('#jurGaveta [data-doc-texto="' + campo + '"]');
      if (t === txt && txt.value.trim() && sel.value !== 'SIM') sel.value = 'SIM';
      var valor = sel.value === 'SIM' && txt.value.trim() ? txt.value.trim() : (sel.value || txt.value.trim() || null);
      Store.atualizar(gavetaId, campo, valor);
    }
  }

  // Atualiza os campos da aba Dados sem perder o foco de quem esta digitando em outro campo.
  function sincronizarCamposGaveta() {
    if (gavetaId == null) return;
    renderCabecalhoGaveta();
    if (abaGaveta !== 'dados') return;
    var r = Store.obter(gavetaId);
    CAMPOS.forEach(function(c) {
      var w = document.querySelector('#jurGaveta [data-wrap="' + c.campo + '"]');
      if (w) w.classList.toggle('editado', Store.pendente(gavetaId, c.campo));
      if (!w || w.contains(document.activeElement)) return;
      var novo = document.createElement('div');
      novo.innerHTML = renderCampo(c, r);
      w.replaceWith(novo.firstChild);
    });
    var autor = Store.nomeUsuario(r.atualizado_por);
    var carimbo = document.querySelector('#jurGaveta .carimbo');
    if (carimbo) carimbo.textContent = 'Última alteração: ' + fmtDataHora(r.atualizado_em) + (autor ? ' · ' + autor : '');
  }

  // Pendencia nova: refaz so o campo que mudou (refazer os outros roubaria o foco de quem acabou de clicar em
  // outro campo, porque o "change" do campo anterior dispara justamente nessa hora).
  function atualizarCampoGaveta(campo) {
    if (abaGaveta !== 'dados') return;
    var c = CAMPOS.find(function(x) { return x.campo === campo; });
    var w = c && document.querySelector('#jurGaveta [data-wrap="' + campo + '"]');
    if (!w) return;
    if (w.contains(document.activeElement)) { w.classList.toggle('editado', Store.pendente(gavetaId, campo)); return; }
    var novo = document.createElement('div');
    novo.innerHTML = renderCampo(c, Store.obter(gavetaId));
    w.replaceWith(novo.firstChild);
  }

  // ---------- Tramitacao ----------
  function renderTramitacao(id) {
    var corpo = $('jurGavetaCorpo');
    var r = Store.obter(id);
    var irmaos = r.processo ? Store.lista().filter(function(x) { return x.processo === r.processo && x.id !== id; }) : [];
    var html = '';
    if (Store.podeEditar()) {
      var propondo = Store.modoProposta();
      html += '<form class="form-tramite" id="jurFormTramite">' +
        '<h4>' + (propondo ? 'Propor trâmite' : 'Registrar trâmite') + '</h4><div class="form-grade">' +
        '<div class="campo"><label>Data do trâmite</label><input type="date" name="data" required value="' + hojeIso() + '"></div>' +
        '<div class="campo"><label>Nova situação</label><select name="situacao"><option value="">(manter: ' + esc(r.situacao || '—') + ')</option>' +
        Object.keys(SITUACOES).map(function(s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
        '<div class="campo largo"><label>Descrição / encaminhamento</label><textarea name="descricao" rows="3" required placeholder="Ex.: Encaminhado à Procuradoria para parecer."></textarea></div>' +
        '<div class="campo largo"><label>Processo SEI do trâmite (opcional)</label><input name="processo_sei" placeholder="Nº do processo ou documento SEI"></div>' +
        '</div>' +
        (irmaos.length ? '<div class="replicar"><div class="replicar-titulo">Aplicar também aos outros trechos do processo ' + esc(r.processo) + ':</div>' +
          irmaos.map(function(x) {
            return '<label class="chk"><input type="checkbox" name="replicar" value="' + x.id + '" checked> #' + x.id + ' · ' +
              esc(x.tipo) + ' · ' + esc(x.trecho || x.municipios) + ' <span class="badge" style="--c:' + ((SITUACOES[x.situacao] || {}).cor || '#6b7280') + '">' + esc(x.situacao || '—') + '</span></label>';
          }).join('') + '</div>' : '') +
        '<div class="form-tramite-acoes"><span class="dica-tramite">' + (propondo
          ? 'Vai para aprovação do editor pleno; só entra na linha do tempo (e muda a situação) depois de aprovado.'
          : 'Se for o trâmite mais recente, atualiza a situação e o status detalhado.') + '</span>' +
        '<button class="btn btn-primario" type="submit"><svg><use href="#i-check"/></svg>' + (propondo ? 'Enviar para aprovação' : 'Registrar') + '</button></div></form>';
    }
    var aguardando = Store.propostas().filter(function(p) { return p.tipo === 'tramite' && p.situacao === 'pendente' && (p.registros || []).indexOf(r.uid) !== -1; });
    html += aguardando.map(function(p) {
      return '<div class="obr-aviso-proposta">◷ Trâmite proposto por <b>' + esc(Store.nomeUsuario(p.criado_por) || '—') + '</b> aguardando aprovação: ' +
        fmtData(p.mudancas.data) + (p.mudancas.situacao ? ' · ' + esc(p.mudancas.situacao) : '') + ' · ' + esc(p.mudancas.descricao) +
        ' <button type="button" class="link" data-abrir-aprovacoes>Ver</button></div>';
    }).join('');
    html += '<div class="linha-tempo" id="jurLinhaTempo"><div class="vazio">Carregando trâmites…</div></div>';
    corpo.innerHTML = html;
    var form = $('jurFormTramite');
    if (form) form.addEventListener('submit', function(e) { e.preventDefault(); enviarTramite(id, form); });

    Store.tramitacoes(id).then(function(itens) {
      if (gavetaId !== id || abaGaveta !== 'tramitacao') return;
      $('jurLinhaTempo').innerHTML = itens.length ? itens.map(function(t) {
        return '<div class="tramite"><div class="tramite-data">' + fmtData(t.data_tramite) + '</div><div class="tramite-corpo">' +
          (t.situacao ? '<span class="badge" style="--c:' + ((SITUACOES[t.situacao] || {}).cor || '#6b7280') + '">' + esc(t.situacao) + '</span>' : '') +
          '<div class="tramite-desc">' + esc(t.descricao) + '</div>' +
          (t.processo_sei ? '<div class="tramite-sei">SEI ' + esc(t.processo_sei) + '</div>' : '') +
          '<div class="tramite-autor">Lançado por ' + esc(Store.nomeUsuario(t.criado_por) || '—') + ' em ' + fmtDataHora(t.criado_em) +
          (Store.podeGravar() ? ' · <button type="button" class="link link-perigo" data-excluir-tramite="' + t.tid + '">remover</button>' : '') + '</div>' +
          '</div></div>';
      }).join('') : '<div class="vazio">Nenhum trâmite registrado ainda.</div>';
    }).catch(function(e) {
      $('jurLinhaTempo').innerHTML = '<div class="vazio">Erro ao carregar: ' + esc(e.message) + '</div>';
    });
  }

  function enviarTramite(id, form) {
    var dados = Object.fromEntries(new FormData(form));
    dados.descricao = (dados.descricao || '').trim();
    if (!dados.descricao) return;
    var ids = [id].concat(Array.from(form.querySelectorAll('[name=replicar]:checked')).map(function(c) { return Number(c.value); }));
    var botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    Store.tramitar(ids, dados).then(function(res) {
      toast((res && res.proposta ? 'Trâmite enviado para aprovação' : 'Trâmite registrado') + (ids.length > 1 ? ' (' + ids.length + ' trechos)' : ''));
      renderTramitacao(id);
    }).catch(function(e) {
      toast('Não foi possível registrar: ' + e.message, true);
      botao.disabled = false;
    });
  }

  // ---------- Historico ----------
  function renderHistorico(id) {
    var corpo = $('jurGavetaCorpo');
    corpo.innerHTML = '<div class="vazio">Carregando histórico…</div>';
    Store.historico(id).then(function(itens) {
      if (gavetaId !== id || abaGaveta !== 'historico') return;
      if (!itens.length) { corpo.innerHTML = '<div class="vazio">Nenhuma alteração registrada.</div>'; return; }
      function titulo(campo) { return campo === 'geom' ? 'Traçado' : campo === 'excluido_em' ? 'Lixeira' : ((CAMPOS.find(function(c) { return c.campo === campo; }) || {}).titulo || campo); }
      function valor(v) { return v == null || v === '' ? '(vazio)' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
      var ultimoAlt = itens.find(function(h) { return h.tabela === 'alteracoes'; });
      corpo.innerHTML = itens.map(function(h) {
        var detalhe = '';
        if (h.acao === 'editado' || h.acao === 'tramite_editado') {
          detalhe = (h.campos || []).filter(function(c) { return c !== 'geom'; }).map(function(c) {
            return '<div class="mudanca"><b>' + esc(titulo(c)) + '</b><div class="de">' + esc(valor(h.antes && h.antes[c])) + '</div>' +
              '<div class="para">' + esc(valor(h.depois && h.depois[c])) + '</div></div>';
          }).join('') + ((h.campos || []).indexOf('geom') !== -1 ? '<div class="mudanca"><b>Traçado</b> alterado</div>' : '');
        } else if (h.acao === 'tramitado' && h.depois) {
          detalhe = '<div class="mudanca">' + fmtData(h.depois.data_tramite) + (h.depois.situacao ? ' · <b>' + esc(h.depois.situacao) + '</b>' : '') +
            '<div>' + esc(h.depois.descricao) + '</div></div>';
        }
        var podeRestaurar = Store.eAdmin() && h.tabela === 'alteracoes' && h.depois && h !== ultimoAlt && h.acao !== 'excluido';
        return '<div class="historico-item"><div class="quando">' + fmtDataHora(h.quando) + ' · <b>' + esc(h.usuario_nome || '—') + '</b> · ' +
          esc(ACOES[h.acao] || h.acao) + (h.proposto_por_nome ? ' · proposta de <b>' + esc(h.proposto_por_nome) + '</b>' : '') +
          (podeRestaurar ? ' · <button type="button" class="link" data-restaurar="' + h.hid + '" title="Volta o registro para como ficou após esta alteração">voltar a esta versão</button>' : '') +
          '</div>' + detalhe + '</div>';
      }).join('');
    }).catch(function(e) {
      corpo.innerHTML = '<div class="vazio">Erro ao carregar: ' + esc(e.message) + '</div>';
    });
  }

  // ---------- Mapa ----------
  function verNoMapa(id) {
    if (!Store.geometria(id)) { toast('Registro #' + id + ' ainda não tem traçado'); return; }
    selecionadoAtual = id;
    var mudou = modo !== 'dividida';
    var pronto = mudou ? definirModo('dividida') : Promise.resolve();
    pronto.then(function() {
      if (tabelaPronta) Tabela.selecionar(id, true);
      Jurisdicao.selecionar(id);
      centralizarSelecionado(mudou ? 420 : 0);
    });
  }

  // ---------- Reacao a mudancas ----------
  function aoMudarStore(evento, id, extra) {
    if (evento === 'salvando' || evento === 'salvo') { if (evento === 'salvo') erroStatus = null; atualizarStatus(); return; }
    if (evento === 'erro') {
      erroStatus = extra;
      toast(extra, true);
    } else if (evento === 'pendentes') {
      if (id != null) Tabela.atualizarLinha(id);
      if (id != null && id === gavetaId) atualizarCampoGaveta(extra);
      atualizarPendentes();
    } else if (evento === 'propostas') {
      atualizarAprovacoes();
      Tabela.reformatar();
      if (gavetaId != null && abaGaveta !== 'historico') renderGaveta();
    } else if (evento === 'registro' || evento === 'geometria') {
      Tabela.atualizarLinha(id);
      if (id === gavetaId) sincronizarCamposGaveta();
      aplicarFiltros();
    } else if (evento === 'criado') {
      Tabela.atualizarLinha(id);
      aplicarFiltros();
      abrirGaveta(id);
    } else if (evento === 'excluido') {
      Tabela.atualizarLinha(id);
      if (id === gavetaId) fecharGaveta();
      aplicarFiltros();
    } else if (evento === 'recarregado') {
      Tabela.recarregar();
      aplicarFiltros();
      if (gavetaId != null) { if (Store.obter(gavetaId)) renderGaveta(); else fecharGaveta(); }
    }
    atualizarStatus();
  }

  function atualizarStatus() {
    var el = $('jurStatus');
    var salvando = Store.gravandoAgora();
    el.classList.toggle('salvando', salvando);
    el.classList.toggle('pendente', !salvando && !!erroStatus);
    $('jurTxtStatus').textContent = salvando ? 'Salvando…' : erroStatus ? 'Erro · recarregar' : 'Dados do banco';
    el.title = erroStatus ? erroStatus + ' (clique para recarregar)' : 'Recarregar os dados do banco';
  }

  function recarregarTudo(silencioso) {
    if (Store.gravandoAgora()) return;
    Store.recarregar().then(function() {
      erroStatus = null;
      atualizarStatus();
      if (!silencioso) toast('Dados atualizados do banco');
    }).catch(function(e) { toast('Não foi possível recarregar: ' + e.message, true); });
  }

  // ---------- Pendencias, revisao e aprovacoes (mesmo fluxo das obras) ----------
  function tituloCampo(c) { return c === '_extra_base' ? 'Trechos novos na malha complementar' : c === 'geom' ? 'Traçado' : ((CAMPOS.find(function(x) { return x.campo === c; }) || {}).titulo || c); }
  function textoValor(c, v) {
    if (v == null || v === '') return '';
    if (c === 'geom') return JurTracado.descrever(v);
    if (c === '_extra_base') return v.map(function(t) { return t.rodovia + ' · ' + t.trecho; }).join('; ');
    if (c === 'extensao_km') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' km';
    return String(v);
  }
  function eu() { var p = Acesso.perfil(); return p && p.user_id; }

  function atualizarPendentes() {
    var n = Store.totalPendentes();
    $('jurPendentes').hidden = !n;
    $('jurPendentes').textContent = n + (n === 1 ? ' alteração pendente' : ' alterações pendentes');
    $('jurDescartar').hidden = !n;
    $('jurRevisar').disabled = !n;
    $('jurRevisar').lastChild.textContent = Store.modoProposta() ? 'Revisar e enviar' : 'Revisar e salvar';
  }

  function abrirRevisao() {
    var itens = Store.resumoPendentes();
    if (!itens.length) return;
    var erros = 0, proposta = Store.modoProposta();
    $('jurRevisaoCorpo').innerHTML = '<p class="rev-resumo">' + itens.length + (itens.length === 1 ? ' registro' : ' registros') + ' · ' +
      Store.totalPendentes() + ' campo(s) alterado(s)</p>' + itens.map(function(it) {
        return '<div class="rev-obra"><div class="rev-cab"><b>#' + it.id + '</b> ' + esc([it.r.rodovia, it.r.municipios].filter(Boolean).join(' — ')) + '</div>' +
          it.campos.map(function(c) {
            if (c.erro) erros++;
            return '<div class="rev-campo' + (c.erro ? ' rev-erro' : '') + '"><span class="rev-rotulo">' + esc(tituloCampo(c.campo)) + '</span>' +
              '<span class="de">' + esc(textoValor(c.campo, c.antes) || '(vazio)') + '</span><span class="rev-seta">→</span>' +
              '<span class="para">' + esc(textoValor(c.campo, c.depois) || '(vazio)') + '</span>' +
              (c.erro ? '<span class="rev-msg">' + esc(c.erro) + '</span>' : '') + '</div>';
          }).join('') + '</div>';
      }).join('');
    $('jurRevisaoTitulo').textContent = proposta ? 'Conferir antes de enviar para aprovação' : 'Conferir antes de salvar';
    $('jurConfirmar').lastChild.textContent = proposta ? 'Enviar para aprovação' : 'Confirmar e salvar';
    $('jurRevisaoAviso').textContent = erros ? 'Corrija ' + erros + ' valor(es) em vermelho antes de ' + (proposta ? 'enviar.' : 'salvar.')
      : proposta ? 'As mudanças só valem depois que o editor pleno aprovar.' : '';
    $('jurConfirmar').disabled = erros > 0;
    $('jurDlgRevisao').showModal();
  }

  // Antes de gravar: o que ficou fora da malha pode virar trecho da malha complementar (JurTracado).
  function confirmarSalvar() {
    $('jurConfirmar').disabled = true;
    $('jurRevisaoAviso').textContent = 'Conferindo o traçado…';
    JurTracado.conferirForaDaMalha(Store.resumoPendentes()).then(function(extras) {
      if (!extras) { $('jurRevisaoAviso').textContent = ''; return null; }
      $('jurRevisaoAviso').textContent = 'Salvando…';
      return Store.salvar(extras);
    }).then(function(res) {
      if (!res) return;
      $('jurDlgRevisao').close();
      if (res.gravadas.length) toast(res.proposta
        ? res.gravadas.length + (res.gravadas.length === 1 ? ' proposta enviada' : ' propostas enviadas') + ' para aprovação'
        : res.gravadas.length + (res.gravadas.length === 1 ? ' registro salvo' : ' registros salvos') + ' no banco');
      res.recusadas.forEach(function(x) { toast('#' + x.id + ': ' + x.motivo, true); });
      res.gravadas.forEach(function(id) { Tabela.atualizarLinha(id); });
      if (gavetaId != null) renderGaveta();
      aplicarFiltros();
    }).catch(function(e) { toast('Falha ao salvar: ' + e.message, true); })
      .then(function() { $('jurConfirmar').disabled = false; atualizarPendentes(); });
  }

  function atualizarAprovacoes() {
    var b = $('jurAprovacoes');
    if (!b || !Store.podeEditar()) return;
    var pleno = Store.podeGravar();
    var pend = Store.propostas().filter(function(p) { return p.situacao === 'pendente' && (pleno || p.criado_por === eu()); }).length;
    b.innerHTML = (pleno ? 'Aprovações' : 'Minhas propostas') + (pend ? ' <span class="obr-contagem">' + pend + '</span>' : '');
    b.classList.toggle('tem-pendente', pleno && pend > 0);
    var menu = $('jurAbrirTabela');
    if (menu) menu.textContent = 'Abrir tabela' + (pleno && pend ? ' · ' + pend + ' para aprovar' : '');
  }

  function abrirAprovacoes() { renderAprovacoes(); if (!$('jurDlgAprov').open) $('jurDlgAprov').showModal(); }

  var SITUACAO_PROPOSTA = { pendente: 'Aguardando', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' };
  function cartaoProposta(p) {
    var pleno = Store.podeGravar();
    var id = p.registro_uid ? Store.idPorUid(p.registro_uid) : null, r = id != null ? Store.obter(id) : null;
    var titulo = p.tipo === 'nova' ? (p.situacao === 'aprovada' && r ? '#' + r.id + ' · registro novo' : 'Registro novo')
      : p.tipo === 'tramite' ? 'Trâmite · ' + (p.registros || []).map(function(u) { var x = Store.idPorUid(u); return x != null ? '#' + x : '?'; }).join(', ')
      : (r ? '#' + r.id : '(registro excluído)');
    var comAntes = p.tipo === 'edicao' && p.situacao === 'pendente' && r;
    var conflito = comAntes && r.versao !== p.versao_base;
    var linhas = p.tipo === 'tramite'
      ? [['Data', fmtData(p.mudancas.data)], ['Nova situação', p.mudancas.situacao || '(mantém)'], ['Descrição', p.mudancas.descricao], ['Processo SEI', p.mudancas.processo_sei || '']]
        .filter(function(l) { return l[1]; }).map(function(l) { return '<div class="rev-campo"><span class="rev-rotulo">' + l[0] + '</span><span></span><span></span><span class="para">' + esc(l[1]) + '</span></div>'; }).join('')
      : Object.keys(p.mudancas).map(function(c) {
        return '<div class="rev-campo"><span class="rev-rotulo">' + esc(tituloCampo(c)) + '</span>' +
          (comAntes ? '<span class="de">' + esc(textoValor(c, c === 'geom' ? Store.geometria(r.id) : r[c]) || '(vazio)') + '</span><span class="rev-seta">→</span>' : '<span></span><span></span>') +
          '<span class="para">' + esc(textoValor(c, p.mudancas[c]) || '(vazio)') + '</span></div>';
      }).join('');
    var acoes = '';
    if (p.situacao === 'pendente') {
      if (pleno) acoes = '<button type="button" class="btn btn-fantasma" data-recusar="' + p.pid + '">Recusar</button>' +
        '<button type="button" class="btn btn-primario" data-aprovar="' + p.pid + '"><svg><use href="#i-check"/></svg>Aprovar</button>';
      else if (p.criado_por === eu()) acoes = '<button type="button" class="btn btn-fantasma" data-cancelar="' + p.pid + '">Cancelar proposta</button>';
    }
    if (r) acoes = '<button type="button" class="link" data-abrir-registro="' + r.id + '">abrir o registro</button>' + acoes;
    var decisao = p.situacao === 'pendente' ? '' : '<div class="aprov-decisao aprov-' + p.situacao + '">' + SITUACAO_PROPOSTA[p.situacao] +
      (p.decidido_por && p.decidido_por !== p.criado_por ? ' por ' + esc(Store.nomeUsuario(p.decidido_por)) : '') + ' em ' + fmtDataHora(p.decidido_em) +
      (p.motivo ? ' · motivo: ' + esc(p.motivo) : '') + '</div>';
    return '<div class="rev-obra aprov-' + p.situacao + '" data-pid="' + p.pid + '"><div class="rev-cab"><b>' + esc(titulo) + '</b> ' +
      esc(r ? [r.rodovia, r.municipios].filter(Boolean).join(' — ') : [p.mudancas.rodovia, p.mudancas.municipios].filter(Boolean).join(' — ')) + '</div>' +
      '<div class="aprov-autor">Proposta de <b>' + esc(Store.nomeUsuario(p.criado_por) || '—') + '</b> em ' + fmtDataHora(p.criado_em) + '</div>' +
      (conflito ? '<div class="aprov-conflito">O registro foi alterado depois desta proposta (versão ' + p.versao_base + ' → ' + r.versao + '). Confira os valores atuais antes de aprovar.</div>' : '') +
      linhas + decisao +
      '<div class="aprov-recusa" hidden><textarea rows="2" placeholder="Motivo da recusa (o autor vai ver)"></textarea>' +
        '<button type="button" class="btn btn-perigo-fantasma" data-confirmar-recusa="' + p.pid + '">Confirmar recusa</button></div>' +
      (acoes ? '<div class="aprov-acoes">' + acoes + '</div>' : '') + '</div>';
  }

  function renderAprovacoes() {
    var pleno = Store.podeGravar();
    var todas = Store.propostas().filter(function(p) { return pleno || p.criado_por === eu(); });
    var pend = todas.filter(function(p) { return p.situacao === 'pendente'; }), dec = todas.filter(function(p) { return p.situacao !== 'pendente'; });
    $('jurAprovTitulo').textContent = (pleno ? 'Aprovações' : 'Minhas propostas') + ' · Jurisdição';
    $('jurAprovCorpo').innerHTML = '<h4 class="aprov-secao">Aguardando decisão (' + pend.length + ')</h4>' +
      (pend.length ? pend.map(cartaoProposta).join('') : '<div class="vazio">' + (pleno ? 'Nenhuma proposta para aprovar.' : 'Nenhuma proposta sua aguardando.') + '</div>') +
      (dec.length ? '<h4 class="aprov-secao">Decididas nos últimos 30 dias</h4>' + dec.map(cartaoProposta).join('') : '');
  }

  function aprovar(pid, forcar) {
    Store.aprovar(pid, forcar).then(function(id) {
      toast('Proposta aprovada' + (id != null ? ': #' + id : ''));
      renderAprovacoes();
      if (gavetaId != null) renderGaveta();
      aplicarFiltros();
    }).catch(function(e) {
      if (/CONFLITO/.test(e.message) && confirm(e.message.replace('CONFLITO: ', '') + '.\n\nAprovar mesmo assim? Os campos da proposta sobrescrevem os valores atuais.')) return aprovar(pid, true);
      toast(e.message, true);
      return Store.carregarPropostas().then(renderAprovacoes);
    });
  }

  function aoClicarAprovacoes(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aprovar) return aprovar(Number(b.dataset.aprovar));
    if (b.dataset.recusar) { var caixa = b.closest('.rev-obra').querySelector('.aprov-recusa'); caixa.hidden = false; caixa.querySelector('textarea').focus(); return; }
    if (b.dataset.confirmarRecusa) {
      var motivo = b.closest('.aprov-recusa').querySelector('textarea').value.trim();
      if (!motivo) { toast('Escreva o motivo da recusa', true); return; }
      return Store.recusar(Number(b.dataset.confirmarRecusa), motivo).then(function() { toast('Proposta recusada'); renderAprovacoes(); })
        .catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.cancelar) {
      if (!confirm('Cancelar esta proposta?')) return;
      return Store.cancelar(Number(b.dataset.cancelar)).then(function() { toast('Proposta cancelada'); renderAprovacoes(); })
        .catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.abrirRegistro) { $('jurDlgAprov').close(); abaGaveta = 'dados'; abrirGaveta(Number(b.dataset.abrirRegistro)); }
  }

  // Registro novo: o pleno cria e abre a ficha para completar; o basico envia como proposta.
  function abrirNovo() {
    function opcoes(lista, sel) { return lista.map(function(v) { return '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); }
    $('jurNovoCorpo').innerHTML = '<div class="form-grade">' +
      '<div class="campo"><label>Tipo</label><select name="tipo" required>' + opcoes(Object.keys(TIPOS), 'Estadualização') + '</select></div>' +
      '<div class="campo"><label>Situação</label><select name="situacao">' + opcoes(Object.keys(SITUACOES), 'EM ANÁLISE') + '</select></div>' +
      '<div class="campo"><label>Rodovia</label><input name="rodovia" placeholder="GO-000"></div>' +
      '<div class="campo"><label>Nº processo</label><input name="processo"></div>' +
      '<div class="campo largo"><label>Municípios</label><input name="municipios" required></div>' +
      '<div class="campo largo"><label>Trecho</label><textarea name="trecho" rows="2"></textarea></div>' +
      '</div><p class="nota">' + (Store.modoProposta()
        ? 'O registro entra como proposta: o número (#) e o cadastro saem quando o editor pleno aprovar.'
        : 'O número (#) é gerado pelo banco; depois de cadastrar, a ficha abre para completar os dados.') + '</p>';
    $('jurNovoAviso').textContent = '';
    $('jurDlgNovo').showModal();
  }
  function cadastrarNovo(e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData($('jurFormNovo')));
    Object.keys(d).forEach(function(k) { d[k] = String(d[k]).trim(); });
    Store.criar(d).then(function(r) {
      $('jurDlgNovo').close();
      if (r.proposta) { toast('Registro novo enviado para aprovação'); return; }
      toast('Registro #' + r.id + ' cadastrado');
    }).catch(function(err) { $('jurNovoAviso').textContent = err.message; });
  }

  // ---------- Exportacao ----------
  function baixar(nome, conteudo, tipo) {
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  }
  function hoje() { return new Date().toISOString().slice(0, 10).replace(/-/g, '_'); }

  function planilha(registros) {
    var chaves = Object.keys(CABECALHOS_EXCEL);
    var linhas = registros.slice().sort(function(a, b) { return a.id - b.id; }).map(function(r) {
      var o = {};
      chaves.forEach(function(k) { o[CABECALHOS_EXCEL[k]] = r[k] == null ? '' : r[k]; });
      return o;
    });
    var ws = XLSX.utils.json_to_sheet(linhas, { header: chaves.map(function(k) { return CABECALHOS_EXCEL[k]; }) });
    ws['!cols'] = chaves.map(function(k) { return { wch: ['trecho', 'status_detalhe', 'lei_municipal', 'lei_estadual', 'observacoes'].indexOf(k) !== -1 ? 45 : k === 'municipios' ? 28 : 16 }; });
    ws['!autofilter'] = { ref: ws['!ref'] };
    return ws;
  }

  var xlsxPronto = null;
  function comXlsx(fn) {
    if (!xlsxPronto) xlsxPronto = window.XLSX ? Promise.resolve() : carregarScript(LIBS.xlsx);
    xlsxPronto.then(fn).catch(function(e) { toast(e.message, true); });
  }

  function exportar(acao) {
    if (!Acesso.podeExportar('JURISDICAO')) return;   // visualizador nao exporta
    if (acao === 'exp-xlsx' || acao === 'exp-xlsx-filtro') {
      comXlsx(function() {
        var regs = acao === 'exp-xlsx' ? Store.lista() : Tabela.idsFiltrados().map(Store.obter);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, planilha(regs), 'ALTERACOES');
        XLSX.writeFile(wb, hoje() + '_Alteracoes_Jurisdicao.xlsx');
        Store.registrarEvento('exportou', 'Excel (' + (acao === 'exp-xlsx' ? 'todos' : 'filtrados') + ', ' + regs.length + ' registros)');
      });
    } else if (acao === 'exp-csv') {
      comXlsx(function() {
        Store.registrarEvento('exportou', 'CSV (' + Store.lista().length + ' registros)');
        baixar(hoje() + '_Alteracoes_Jurisdicao.csv', '﻿' + XLSX.utils.sheet_to_csv(planilha(Store.lista()), { FS: ';' }), 'text/csv;charset=utf-8');
      });
    } else if (acao === 'exp-geojson-qgis') {
      Store.registrarEvento('exportou', 'GeoJSON com atributos (QGIS)');
      baixar(hoje() + '_alt_juris_atributos.geojson', JSON.stringify(Store.exportarTrechos(true)), 'application/geo+json');
    } else if (acao === 'caderno') {
      window.open('jurisdicao_caderno.html' + (gavetaId != null ? '?id=' + gavetaId : ''), '_blank');
    } else if (acao === 'caderno-completo') {
      window.open('jurisdicao_caderno.html?modo=completo', '_blank');
    }
  }

  // ---------- Eventos ----------
  function ligarEventos() {
    document.querySelectorAll('[data-jur-modo]').forEach(function(b) {
      b.addEventListener('click', function() { definirModo(b.dataset.jurModo); });
    });
    $('jurFecharTabela').addEventListener('click', function() {
      if (Store.totalPendentes() && !confirm('Há alterações pendentes não salvas. Fechar a tabela mesmo assim? (elas continuam pendentes até você salvar ou descartar)')) return;
      definirModo('fechado');
    });
    $('jurRevisar').addEventListener('click', abrirRevisao);
    $('jurConfirmar').addEventListener('click', confirmarSalvar);
    $('jurDescartar').addEventListener('click', function() {
      if (!confirm('Descartar ' + Store.totalPendentes() + ' alteração(ões) pendente(s)?')) return;
      Store.descartar();
      if (gavetaId != null) renderGaveta();
    });
    $('jurAprovacoes').addEventListener('click', abrirAprovacoes);
    $('jurMalha').addEventListener('click', function() { JurTracado.abrirMalhaComplementar(); });
    $('jurAprovCorpo').addEventListener('click', aoClicarAprovacoes);
    $('jurFormNovo').addEventListener('submit', cadastrarNovo);

    var t = null;
    $('jurTBusca').addEventListener('input', function() {
      clearTimeout(t);
      var v = this.value;
      t = setTimeout(function() { Jurisdicao.definirFiltro('busca', v.trim()); }, 150);
    });
    [['jurTTipo', 'tipo'], ['jurTSituacao', 'situacao'], ['jurTGeo', 'geo']].forEach(function(p) {
      $(p[0]).addEventListener('change', function() { Jurisdicao.definirFiltro(p[1], $(p[0]).value); });
    });
    $('jurTLimpar').addEventListener('click', function() { Jurisdicao.limparFiltros(); });
    $('jurResumoTabela').addEventListener('click', Jurisdicao.cliqueResumo);
    Jurisdicao.ouvir(function(evento, id) {
      if (evento === 'filtros') aplicarFiltros();
      else if (evento === 'clique') selecionar(id, 'mapa');
      else if (evento === 'abrir') abrirGaveta(id);
    });

    // menus
    document.querySelectorAll('[data-jur-menu]').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        var m = $(b.dataset.jurMenu);
        var aberto = m.classList.contains('aberto');
        document.querySelectorAll('.jur-ui .menu-lista').forEach(function(x) { x.classList.remove('aberto'); });
        if (!aberto) m.classList.add('aberto');
      });
    });
    document.addEventListener('click', function() { document.querySelectorAll('.jur-ui .menu-lista').forEach(function(x) { x.classList.remove('aberto'); }); });
    document.querySelectorAll('[data-jur-acao]').forEach(function(b) {
      b.addEventListener('click', function() { exportar(b.dataset.jurAcao); });
    });

    // gaveta
    $('jurFecharGaveta').addEventListener('click', fecharGaveta);
    $('jurGavetaCorpo').addEventListener('change', aoEditarGaveta);
    $('jurGavetaCorpo').addEventListener('click', function(e) {
      if (e.target.closest('[data-abrir-aprovacoes]')) { abrirAprovacoes(); return; }
      var rest = e.target.closest('[data-restaurar]');
      var trm = e.target.closest('[data-excluir-tramite]');
      if (rest && confirm('Voltar o registro #' + gavetaId + ' para como estava nesta versão? (a restauração também fica no histórico)')) {
        Store.restaurarVersao(gavetaId, Number(rest.dataset.restaurar)).then(function() { toast('Versão restaurada'); renderGaveta(); })
          .catch(function(err) { toast(err.message, true); });
      } else if (trm && confirm('Remover este trâmite da linha do tempo? (a situação atual do registro não muda)')) {
        Store.excluirTramite(trm.dataset.excluirTramite).then(renderGaveta).catch(function(err) { toast(err.message, true); });
      }
    });
    document.querySelectorAll('#jurGaveta .gaveta-abas button').forEach(function(b) {
      b.addEventListener('click', function() { abaGaveta = b.dataset.aba; renderGaveta(); });
    });
    $('jurVerMapa').addEventListener('click', function() { verNoMapa(gavetaId); });
    $('jurPrancha').addEventListener('click', function() { window.open('jurisdicao_caderno.html?id=' + gavetaId, '_blank'); });
    $('jurExcluir').addEventListener('click', function() {
      if (gavetaId != null && confirm('Excluir o registro #' + gavetaId + '? Ele vai para a lixeira e só o administrador pode restaurá-lo.')) Store.excluir(gavetaId);
    });
    $('jurTNovo').addEventListener('click', abrirNovo);

    // status e colunas
    $('jurStatus').addEventListener('click', function() { recarregarTudo(false); });
    $('jurTColunas').addEventListener('click', function() {
      $('jurDlgColunasCorpo').innerHTML = CAMPOS.filter(function(c) { return !c.fixa; }).map(function(c) {
        return '<label class="chk"><input type="checkbox" data-coluna="' + c.campo + '"' + (Tabela.colunaVisivel(c.campo) ? ' checked' : '') + '> ' + c.titulo + '</label>';
      }).join('');
      $('jurDlgColunas').showModal();
    });
    $('jurDlgColunasCorpo').addEventListener('change', function(e) { if (e.target.dataset.coluna) Tabela.definirVisivel(e.target.dataset.coluna, e.target.checked); });
    document.querySelectorAll('[data-jur-fechar]').forEach(function(b) { b.addEventListener('click', function() { b.closest('dialog').close(); }); });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || document.querySelector('.tabulator-editing')) return;
      if (JurTracado.ativo()) JurTracado.encerrar(); else fecharGaveta();
    });
    // Ao voltar para a aba depois de um tempo, traz o que outras pessoas alteraram.
    document.addEventListener('visibilitychange', function() {
      if (tabelaPronta && document.visibilityState === 'visible' && Store.idadeDados() > 2 * 60 * 1000) recarregarTudo(true);
    });
    window.addEventListener('resize', posicionar);
    ligarRedimensionar();
    window.addEventListener('beforeunload', function(e) {
      if (tabelaPronta && (Store.gravandoAgora() || Store.totalPendentes())) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  montar();
  if (new URLSearchParams(location.search).get('tabela')) definirModo(new URLSearchParams(location.search).get('tabela') === 'dividida' ? 'dividida' : 'cheia');

  return { definirModo: definirModo, abrirGaveta: abrirGaveta };
})();
