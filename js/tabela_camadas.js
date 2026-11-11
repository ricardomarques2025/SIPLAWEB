// Tabela de atributos das camadas de referência (11/11/2026): Aeródromos, Localidades, Municípios, malhas, ferrovias,
// pedágios, áreas, regiões, hidrografia... Aberta pelo botão "Abrir tabela de atributos" do popup da feição.
// Só consulta (as camadas editáveis continuam em "Editar camadas"). Mesmo visual e recursos da tabela de obras
// (css/jurisdicao_tabela.css, escopo .jur-ui): tela cheia ou dividida com o mapa, busca, filtro tipo Excel em cada
// coluna (js/filtro_cabecalho.js), exportação para Excel, destaque da feição no mapa e "Filtrar o mapa".
// Cada camada se registra em js/mapa.js (TabelaCamadas.registrar) dizendo de onde vêm os dados e como redesenhar;
// as funções de desenho perguntam TabelaCamadas.passa(chave, feição) para respeitar o "Filtrar o mapa".

var TabelaCamadas = (function() {
  var LIBS = {
    tabulatorCss: 'https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css',
    tabulatorJs: 'https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };
  var CHAVE_LARGURA = 'siplaweb.camadas.larguraTabela';
  var LARGURA_MIN = 30, LARGURA_MAX = 80;
  var ROTULOS_COMUNS = { GEOCOD: 'Código (base)', CD_MUN: 'Código IBGE', NM_MUN: 'Município', RG_PLAN: 'Região de Planejamento', rg_plan: 'Região de Planejamento',
    ID_LOCAL: 'Código da localidade', NOME_ACEN: 'Nome', POPULACAO: 'População' };

  var camadas = {};            // chave -> { titulo, dados(), rotulos, ordem, ocultar, redesenhar(), ligar() }
  var idsFeicao = new WeakMap(), feicoes = [];   // botão do popup -> [chave, feição]
  var recortes = {};           // chave -> Set de feições que ficam no mapa ("Filtrar o mapa" ligado)
  var atual = null;            // chave da camada aberta na tabela
  var linhas = [];             // feições da camada aberta, na ordem das linhas (índice = __i)
  var colunas = [];            // [{ campo, titulo, numero }]
  var grade = null, modo = 'fechado', montado = false, tabulatorPronto = null;
  var selecionada = null, halo = null, legendaRecolhidaPorNos = false;
  var busca = '', tempoRecorte = null;

  var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="tc-table" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M3 15h18M9 10v11"/></symbol>' +
    '<symbol id="tc-split" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 3v18"/></symbol>' +
    '<symbol id="tc-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>' +
    '<symbol id="tc-filter-x" viewBox="0 0 24 24"><path d="M3 4h18l-7 9v6l-4 2v-8zM16 16l5 5M21 16l-5 5"/></symbol>' +
    '<symbol id="tc-down" viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></symbol>' +
    '<symbol id="tc-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>' +
    '<symbol id="tc-pin" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></symbol>' +
    '</svg>';

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function vazio(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function fmtNumero(v) { return vazio(v) ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function carregarScript(url) {
    return new Promise(function(ok, falha) {
      var s = document.createElement('script'); s.src = url; s.onload = ok;
      s.onerror = function() { falha(new Error('Não foi possível carregar ' + url)); };
      document.head.appendChild(s);
    });
  }
  function carregarCss(url) {
    if (document.querySelector('link[href="' + url + '"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l);
  }
  function toast(msg, erro) {
    var caixa = $('tcToasts'); if (!caixa) return;
    var t = document.createElement('div'); t.className = 'toast' + (erro ? ' toast-erro' : ''); t.textContent = msg;
    caixa.appendChild(t); setTimeout(function() { t.remove(); }, erro ? 6000 : 3500);
  }

  // ---------- Registro e botão do popup ----------
  function registrar(chave, cfg) { camadas[chave] = cfg; }
  function botao(chave, feicao) {
    if (!camadas[chave] || !feicao) return '';
    var id = idsFeicao.get(feicao);
    if (id === undefined) { id = feicoes.length; feicoes.push([chave, feicao]); idsFeicao.set(feicao, id); }
    return '<div class="tc-popup-acao"><button type="button" class="po-abrir tc-abrir" data-tc="' + id + '" title="Abrir a tabela de atributos desta camada">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M3 15h18M9 10v11"/></svg>' +
      'Tabela: ' + esc(camadas[chave].titulo) + '</button></div>';
  }
  function passa(chave, feicao) { var r = recortes[chave]; return !r || r.has(feicao); }

  document.addEventListener('click', function(e) {
    var b = e.target.closest && e.target.closest('.tc-abrir');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var par = feicoes[Number(b.dataset.tc)];
    if (par) abrir(par[0], par[1]);
  });

  // ---------- Interface ----------
  function montar() {
    if (montado) return;
    montado = true;
    var ui = document.createElement('div');
    ui.className = 'jur-ui tc-ui';
    ui.id = 'tcUi';
    ui.innerHTML = SPRITE +
      '<section class="jur-tabela" id="tcTabela" hidden data-modo="dividida">' +
        '<div class="jur-tabela-topo">' +
          '<span class="jur-tabela-titulo"><span class="tc-sup">Camada de referência</span> <b id="tcTitulo"></b></span>' +
          '<nav class="segmentado" aria-label="Modo da tabela">' +
            '<button type="button" data-tc-modo="cheia"><svg><use href="#tc-table"/></svg>Tela cheia</button>' +
            '<button type="button" data-tc-modo="dividida"><svg><use href="#tc-split"/></svg>Dividida com o mapa</button>' +
          '</nav>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn" id="tcExportar" data-exportar><svg><use href="#tc-down"/></svg>Excel</button>' +
          '<button type="button" class="btn-icone" id="tcFechar" title="Fechar a tabela e voltar ao mapa"><svg><use href="#tc-x"/></svg></button>' +
        '</div>' +
        '<section class="ferramentas">' +
          '<label class="busca"><svg><use href="#tc-search"/></svg><input id="tcBusca" type="search" placeholder="Buscar em todas as colunas…" autocomplete="off"></label>' +
          '<button type="button" class="btn btn-fantasma" id="tcLimpar" title="Limpar a busca e os filtros das colunas"><svg><use href="#tc-filter-x"/></svg></button>' +
          '<span class="contador" id="tcContador"></span>' +
          '<button type="button" class="btn obr-filtrar-mapa" id="tcFiltrarMapa" aria-pressed="false" title="Ligado: o mapa mostra só as feições desta camada que passam na busca e nos filtros das colunas"><span class="obr-chave" aria-hidden="true"></span>Filtrar o mapa</button>' +
        '</section>' +
        '<div class="painel-tabela"><div id="tcGrade"></div></div>' +
        '<div class="jur-redimensionar" id="tcRedimensionar" title="Arraste para aumentar ou diminuir a tabela"></div>' +
      '</section>' +
      '<div class="toasts" id="tcToasts"></div>';
    document.body.appendChild(ui);
    if (window.Acesso && Acesso.aplicarExportacao) Acesso.aplicarExportacao();

    // Aviso no mapa enquanto alguma camada estiver filtrada pela tabela (some ao desligar).
    var aviso = document.createElement('div');
    aviso.id = 'tcAvisoMapa';
    aviso.className = 'tc-aviso-mapa';
    aviso.hidden = true;
    map.getContainer().appendChild(aviso);
    L.DomEvent.disableClickPropagation(aviso);
    aviso.addEventListener('click', function(e) {
      var b = e.target.closest('[data-tc-tirar]');
      if (b) { delete recortes[b.dataset.tcTirar]; redesenharCamada(b.dataset.tcTirar); atualizarEstadoFiltro(); return; }
      var a = e.target.closest('[data-tc-abrir]');
      if (a) abrir(a.dataset.tcAbrir, null);
    });

    document.querySelectorAll('[data-tc-modo]').forEach(function(b) { b.addEventListener('click', function() { definirModo(b.dataset.tcModo); }); });
    $('tcFechar').addEventListener('click', fechar);
    $('tcExportar').addEventListener('click', exportar);
    $('tcFiltrarMapa').addEventListener('click', alternarFiltroMapa);
    var t = null;
    $('tcBusca').addEventListener('input', function() { clearTimeout(t); var v = this.value; t = setTimeout(function() { busca = v.trim(); aplicarBusca(); }, 150); });
    $('tcLimpar').addEventListener('click', function() { busca = ''; $('tcBusca').value = ''; if (grade) grade.clearHeaderFilter(); aplicarBusca(); });
    // Borda arrastável (modo dividido), como na tabela de obras.
    $('tcRedimensionar').addEventListener('pointerdown', function(e) {
      e.preventDefault();
      function mover(ev) { aplicarLargura(Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, ev.clientX / window.innerWidth * 100)).toFixed(1)); }
      function soltar() {
        document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar);
        try { localStorage.setItem(CHAVE_LARGURA, ($('tcTabela').getBoundingClientRect().width / window.innerWidth * 100).toFixed(1)); } catch (x) { /* sem storage */ }
        if (grade) grade.redraw(); map.invalidateSize();
      }
      document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar);
    });
    window.addEventListener('resize', posicionar);
  }

  function posicionar() {
    var topo = $('topbar');
    $('tcUi').style.setProperty('--jur-topo', (topo ? topo.getBoundingClientRect().bottom : 60) + 'px');
  }
  function aplicarLargura(pct) { $('tcUi').style.setProperty('--jur-largura', pct + 'vw'); }
  function recolherLegenda(recolher) {
    var barra = $('sidebar-right'), botaoLeg = $('toggleSidebarRight');
    if (!barra || typeof definirSidebarRecolhida !== 'function') return;
    var recolhida = barra.classList.contains('sidebar-colapsed');
    if (recolher && !recolhida) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botaoLeg, true); legendaRecolhidaPorNos = true; }
    else if (!recolher && legendaRecolhidaPorNos) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botaoLeg, false); legendaRecolhidaPorNos = false; }
  }

  function definirModo(novo) {
    modo = novo;
    var painel = $('tcTabela');
    recolherLegenda(novo === 'dividida');
    if (novo === 'fechado') { painel.hidden = true; limparHalo(); setTimeout(function() { map.invalidateSize(); }, 50); return; }
    posicionar();
    painel.dataset.modo = novo;
    painel.hidden = false;
    document.querySelectorAll('[data-tc-modo]').forEach(function(b) { b.classList.toggle('ativo', b.dataset.tcModo === novo); });
    setTimeout(function() { if (grade) grade.redraw(); map.invalidateSize(); if (novo === 'dividida') centralizar(); }, 380);
  }
  function fechar() { definirModo('fechado'); atualizarEstadoFiltro(); }

  // ---------- Abrir a camada ----------
  // feicao: a do popup (fica selecionada e destacada); null = só abre a tabela da camada.
  function abrir(chave, feicao) {
    var cfg = camadas[chave];
    if (!cfg) return;
    montar();
    map.closePopup();
    // Uma tabela por vez: fecha a de obras, se estiver aberta.
    if (window.ObrasPainel && ObrasPainel.definirModo && document.querySelector('#obrTabela:not([hidden])')) ObrasPainel.definirModo('fechado');
    carregarCss(LIBS.tabulatorCss);
    if (!tabulatorPronto) tabulatorPronto = window.Tabulator ? Promise.resolve() : carregarScript(LIBS.tabulatorJs);
    $('tcTitulo').textContent = cfg.titulo;
    aplicarLargura(50);   // pelo popup: meio a meio com o mapa
    definirModo('dividida');
    var pronto = (atual === chave && grade) ? Promise.resolve() : Promise.all([tabulatorPronto, Promise.resolve(cfg.dados())]).then(function(r) {
      montarGrade(chave, r[1]);
      return new Promise(function(ok) { grade.on('tableBuilt', ok); });
    });
    return pronto.then(function() {
      atualizarEstadoFiltro();
      if (feicao) selecionarFeicao(feicao, true);
    }).catch(function(e) { toast('Não foi possível abrir a tabela: ' + e.message, true); });
  }

  function montarGrade(chave, colecao) {
    var cfg = camadas[chave];
    if (grade) { grade.destroy(); grade = null; }
    atual = chave; selecionada = null; limparHalo();
    busca = ''; $('tcBusca').value = '';
    linhas = ((colecao && colecao.features) || []).filter(function(f) { return f && f.properties; });
    // Colunas: as que a camada tem (as do popup primeiro, com o mesmo nome); sem as internas (_..., geometria).
    var ocultar = (cfg.ocultar || []).concat(['fid', 'ord_mun', 'ext_mapa']), vistas = {}, ordem = [];
    (cfg.ordem || []).forEach(function(k) { if (!vistas[k]) { vistas[k] = 1; ordem.push(k); } });
    linhas.forEach(function(f) {
      Object.keys(f.properties).forEach(function(k) { if (!vistas[k]) { vistas[k] = 1; ordem.push(k); } });
    });
    colunas = ordem.filter(function(k) {
      if (k.charAt(0) === '_' || ocultar.indexOf(k) !== -1) return false;
      var algum = false, objeto = false;
      for (var i = 0; i < linhas.length; i++) {
        var v = linhas[i].properties[k];
        if (!vazio(v)) { algum = true; if (typeof v === 'object') { objeto = true; break; } }
      }
      return algum && !objeto;
    }).map(function(k) {
      var numero = linhas.every(function(f) { var v = f.properties[k]; return vazio(v) || typeof v === 'number'; });
      return { campo: k, titulo: (cfg.rotulos && cfg.rotulos[k]) || ROTULOS_COMUNS[k] || k, numero: numero };
    });
    var dados = linhas.map(function(f, i) {
      var d = { __i: i };
      colunas.forEach(function(c) {
        var v = f.properties[c.campo], tr = cfg.traduzir && cfg.traduzir[c.campo];   // códigos -> texto (ex.: papel da hidrografia)
        d[c.campo] = tr && tr[v] !== undefined ? tr[v] : v;
      });
      return d;
    });
    var cols = [{
      title: '', field: '_mapa', width: 44, headerSort: false, frozen: true, hozAlign: 'center', cssClass: 'col-acao',
      formatter: function() { return '<svg class="geo-ok"><use href="#tc-pin"/></svg>'; },
      tooltip: function() { return 'Ver no mapa'; },
      cellClick: function(e, cell) { e.stopPropagation(); selecionarLinha(cell.getRow().getData().__i, true); }
    }];
    colunas.forEach(function(c, n) {
      cols.push(Object.assign({
        title: c.titulo, field: c.campo, frozen: n === 0, headerTooltip: c.titulo, minWidth: 80, maxInitialWidth: 360,
        hozAlign: c.numero ? 'right' : 'left', sorter: c.numero ? 'number' : 'string',
        formatter: function(cell) { var v = cell.getValue(); return esc(c.numero ? fmtNumero(v) : (vazio(v) ? '' : v)); },
        tooltip: function(e, cell) { var v = cell.getValue(); return vazio(v) ? '' : String(v); },
        bottomCalc: n === 0 ? 'count' : undefined
      }, FiltroCabecalho.coluna({
        ordemNumerica: c.numero,
        ler: function(d) { return d[c.campo]; },
        exibir: function(v) { return vazio(v) ? '' : (c.numero ? fmtNumero(v) : String(v)); },
        tabela: function() { return grade; }
      })));
    });
    grade = new Tabulator('#tcGrade', {
      data: dados, index: '__i', height: '100%', layout: 'fitDataFill', columns: cols,
      selectableRows: 1, movableColumns: true, placeholder: 'Nenhuma feição com os filtros atuais',
      columnDefaults: { headerHozAlign: 'left', resizable: true }
    });
    grade.on('rowClick', function(e, row) { selecionarLinha(row.getData().__i, false); });
    grade.on('dataFiltered', function(f, rows) { atualizarContador(rows.length); agendarRecorte(); });
    grade.on('tableBuilt', function() { aplicarBusca(); });
  }

  function aplicarBusca() {
    if (!grade) return;
    var termos = semAcento(busca).split(/\s+/).filter(Boolean);
    grade.setFilter(function(d) {
      if (!termos.length) return true;
      var alvo = semAcento(colunas.map(function(c) { return d[c.campo]; }).join(' '));
      return termos.every(function(t) { return alvo.indexOf(t) !== -1; });
    });
    atualizarContador(grade.getDataCount('active'));
  }
  function atualizarContador(n) { $('tcContador').textContent = n + ' de ' + linhas.length + ' feições'; }

  // ---------- Seleção e destaque no mapa ----------
  function selecionarFeicao(feicao, rolar) {
    var i = linhas.indexOf(feicao);
    if (i === -1) return;
    selecionarLinha(i, true, rolar);
  }
  function selecionarLinha(i, aproximar, rolar) {
    selecionada = linhas[i] || null;
    if (grade) {
      grade.deselectRow(); grade.selectRow(i);
      if (rolar) grade.scrollToRow(i, 'center', false).catch(function() {});
    }
    desenharHalo();
    if (aproximar || modo === 'dividida') centralizar();
  }
  function limparHalo() { if (halo) { map.removeLayer(halo); halo = null; } }
  function desenharHalo() {
    limparHalo();
    if (!selecionada || !selecionada.geometry || modo === 'fechado') return;
    if (!map.getPane('tcHaloPane')) map.createPane('tcHaloPane').style.zIndex = 516;
    halo = L.geoJSON(selecionada, {
      pane: 'tcHaloPane', interactive: false,
      style: function(f) { return /Polygon/.test(f.geometry.type) ? { color: '#facc15', weight: 4, fillColor: '#facc15', fillOpacity: 0.25 } : { color: '#facc15', weight: 14, opacity: 0.65 }; },
      pointToLayer: function(f, ll) { return L.circleMarker(ll, { pane: 'tcHaloPane', radius: 16, color: '#facc15', weight: 5, fillColor: '#fef9c3', fillOpacity: 0.5 }); }
    }).addTo(map);
  }
  function margemEsquerda() {
    var m = map.getContainer().getBoundingClientRect();
    return modo === 'dividida' ? Math.max(0, $('tcTabela').getBoundingClientRect().right - m.left) : 0;
  }
  function centralizar() {
    if (!halo || modo === 'cheia') return;
    setTimeout(function() {
      if (!halo) return;
      map.invalidateSize();
      var b = halo.getBounds();
      if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [margemEsquerda() + 50, 50], paddingBottomRight: [50, 50], maxZoom: 14 });
    }, 420);
  }

  // ---------- Filtrar o mapa ----------
  function redesenharCamada(chave) { var cfg = camadas[chave]; if (cfg && cfg.redesenhar) cfg.redesenhar(); }
  function agendarRecorte() {
    if (!atual || !recortes[atual]) return;
    clearTimeout(tempoRecorte);
    tempoRecorte = setTimeout(function() { aplicarRecorte(true); }, 350);
  }
  function aplicarRecorte(enquadrar) {
    if (!grade || !atual) return;
    var conjunto = new Set();
    grade.getData('active').forEach(function(d) { conjunto.add(linhas[d.__i]); });
    recortes[atual] = conjunto;
    var cfg = camadas[atual];
    if (cfg.ligar) cfg.ligar();
    redesenharCamada(atual);
    atualizarEstadoFiltro();
    if (enquadrar) enquadrarRecorte();
  }
  function enquadrarRecorte() {
    var auto = $('autoZoomToggle');
    if ((auto && !auto.checked) || !grade || modo === 'cheia') return;
    var feats = grade.getData('active').map(function(d) { return linhas[d.__i]; }).filter(function(f) { return f && f.geometry; });
    if (!feats.length) return;
    var b = L.geoJSON({ type: 'FeatureCollection', features: feats }).getBounds();
    if (b.isValid()) setTimeout(function() { map.fitBounds(b, { paddingTopLeft: [margemEsquerda() + 40, 40], paddingBottomRight: [40, 40], maxZoom: 13 }); }, 100);
  }
  function alternarFiltroMapa() {
    if (!atual) return;
    if (recortes[atual]) {
      delete recortes[atual];
      redesenharCamada(atual);
      atualizarEstadoFiltro();
      toast('Mapa sem o filtro da tabela.');
    } else {
      aplicarRecorte(true);
      toast('Mapa filtrado pela tabela: ' + recortes[atual].size + ' feição(ões) de ' + camadas[atual].titulo + '.');
    }
  }
  function atualizarEstadoFiltro() {
    var ligado = !!(atual && recortes[atual]);
    var b = $('tcFiltrarMapa');
    if (b) { b.classList.toggle('ativo', ligado); b.setAttribute('aria-pressed', ligado ? 'true' : 'false'); }
    var aviso = $('tcAvisoMapa');
    if (!aviso) return;
    var chaves = Object.keys(recortes);
    aviso.hidden = !chaves.length;
    aviso.innerHTML = chaves.map(function(k) {
      return '<span class="tc-aviso-item"><button type="button" class="tc-aviso-nome" data-tc-abrir="' + esc(k) + '" title="Abrir a tabela desta camada">' +
        esc(camadas[k].titulo) + ' filtrada pela tabela (' + recortes[k].size + ')</button>' +
        '<button type="button" class="tc-aviso-tirar" data-tc-tirar="' + esc(k) + '" title="Mostrar a camada inteira">×</button></span>';
    }).join('');
  }

  // ---------- Exportar ----------
  function exportar() {
    if (!grade || !atual) return;
    (window.XLSX ? Promise.resolve() : carregarScript(LIBS.xlsx)).then(function() {
      var visiveis = colunas.filter(function(c) { var col = grade.getColumn(c.campo); return col && col.isVisible(); });
      var dados = grade.getData('active').map(function(d) {
        var o = {}; visiveis.forEach(function(c) { o[c.titulo] = vazio(d[c.campo]) ? '' : d[c.campo]; }); return o;
      });
      var nome = camadas[atual].titulo;
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), nome.replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31));
      XLSX.writeFile(wb, new Date().toISOString().slice(0, 10).replace(/-/g, '_') + '_' + semAcento(nome).replace(/[^a-z0-9]+/g, '_') + '.xlsx');
      if (window.Acesso && Acesso.registrarEvento) Acesso.registrarEvento('exportou', 'Excel da camada ' + nome + ' (' + dados.length + ')');
    }).catch(function(e) { toast(e.message, true); });
  }

  return { registrar: registrar, botao: botao, passa: passa, abrir: abrir, fechar: function() { if (montado && modo !== 'fechado') fechar(); },
    aberta: function() { return montado && modo !== 'fechado'; } };
})();
