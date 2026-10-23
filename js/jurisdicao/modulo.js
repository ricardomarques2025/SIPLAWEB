// Modulo Jurisdicao dentro do mapa do SIPLAWEB.
//   mapa.html?modulo=jurisdicao  -> mesma base do mapa (sem obras), trechos de alteracao de jurisdicao,
//                                   filtros, legenda, painel de indicadores e a tabela (js/jurisdicao/painel.js).
//   demais mapas                 -> "Jurisdição" em Camadas de Referência, so leitura, desligada ao abrir.
// Dados: js/jurisdicao/store.js (o banco so entrega a quem tem a area JURISDICAO).
// Conversa com o mapa por funcoes globais de js/mapa.js (map, abrirPopupNoPonto, tabelaRegistrosHtml...).
// Filtros sao um so estado para mapa, painel de indicadores e tabela.

var Jurisdicao = (function() {
  var MODULO = new URLSearchParams(location.search).get('modulo') === 'jurisdicao';
  var CAMPOS_PAINEL = CAMPOS.filter(function(c) { return !c.oculta; }).map(function(c) { return { chave: c.campo, rotulo: c.titulo }; });

  var carga = null;
  var camada = null;
  var linhas = new Map();      // id -> polyline desenhada
  var halo = null;
  var selecionado = null;
  var referenciaAtiva = false;
  var filtros = { tipo: '', situacao: '', geo: '', busca: '' };
  var ouvintes = [];

  map.createPane('jurisdicaoHaloPane').style.zIndex = 515;
  map.createPane('jurisdicaoPane').style.zIndex = 520;   // acima das rodovias, abaixo das localidades

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function km2(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function corTipo(t) { return (TIPOS[t] || {}).cor || '#6b7280'; }
  function corSituacao(s) { return (SITUACOES[s] || {}).cor || '#6b7280'; }
  function emitir(evento, id) { ouvintes.forEach(function(fn) { fn(evento, id); }); }

  function carregar() {
    if (!carga) {
      carga = Acesso.pronto.then(function() {
        return Acesso.podeVer('JURISDICAO') ? Store.carregar() : null;
      });
    }
    return carga;
  }

  // ignorar: 'tipo' ou 'situacao' (o painel de indicadores conta cada grupo sem o proprio filtro)
  function atende(r, ignorar) {
    if (!r) return false;
    if (filtros.tipo && ignorar !== 'tipo' && r.tipo !== filtros.tipo) return false;
    if (filtros.situacao && ignorar !== 'situacao' && r.situacao !== filtros.situacao) return false;
    if (filtros.geo) {
      var tem = !!Store.geometria(r.id);
      if (filtros.geo === 'com' ? !tem : tem) return false;
    }
    if (filtros.busca) {
      var alvo = semAcento(CAMPOS.map(function(c) { return r[c.campo]; }).join(' '));
      if (!semAcento(filtros.busca).split(/\s+/).every(function(t) { return alvo.indexOf(t) !== -1; })) return false;
    }
    return true;
  }

  function lista() {
    var todos = Store.lista();
    return MODULO ? todos.filter(function(r) { return atende(r); }) : todos;
  }

  function conteudoPopup(r) {
    var km = r.extensao_km != null ? Number(r.extensao_km).toLocaleString('pt-BR') + ' km' : '';
    return '<div class="popup-jurisdicao">' +
      '<div class="pj-sup">Jurisdição · #' + r.id + ' · <span style="--c:' + corTipo(r.tipo) + '"><i></i>' + esc(r.tipo) + '</span></div>' +
      '<b>' + esc(r.rodovia) + ' — ' + esc(r.municipios) + '</b>' +
      '<div>' + esc(r.trecho) + (km ? ' · <b>' + km + '</b>' : '') + '</div>' +
      '<div class="pj-sit" style="--c:' + corSituacao(r.situacao) + '">' + esc(r.situacao || 'Sem situação') + '</div>' +
      (r.processo ? '<div class="pj-proc">Processo ' + esc(r.processo) + '</div>' : '') +
      (MODULO ? '<button type="button" class="pj-abrir" data-jur-abrir="' + r.id + '">Abrir detalhes</button>' : '') +
      '</div>';
  }

  function mostrarNoPainel(r) {
    var painel = $('painelTabelaConteudo');
    if (!painel || typeof tabelaRegistrosHtml !== 'function') return;
    painel.innerHTML = tabelaRegistrosHtml('Alteração de jurisdição #' + r.id, [r], CAMPOS_PAINEL);
  }

  function latlngsDe(g) {
    return L.GeoJSON.coordsToLatLngs(g.coordinates, g.type === 'MultiLineString' ? 1 : 0);
  }

  function desenhar() {
    if (camada) { map.removeLayer(camada); camada = null; }
    linhas.clear();
    var visiveis = MODULO || referenciaAtiva ? lista() : [];
    if (visiveis.length) {
      camada = L.layerGroup();
      visiveis.forEach(function(r) {
        var g = Store.geometria(r.id);
        if (!g || !g.coordinates) return;
        var latlngs = latlngsDe(g);
        camada.addLayer(L.polyline(latlngs, { pane: 'jurisdicaoPane', color: '#fff', weight: 8, opacity: 1, interactive: false }));
        var linha = L.polyline(latlngs, { pane: 'jurisdicaoPane', color: corTipo(r.tipo), weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round' });
        linha.on('click', function(e) {
          if (window.obrasSelecaoTracadoAtiva) return;   // editando um traçado: o clique é da ferramenta
          var atual = Store.obter(r.id) || r;
          abrirPopupNoPonto(e.latlng, conteudoPopup(atual), null);
          mostrarNoPainel(atual);
          selecionar(r.id);
          emitir('clique', r.id);
        });
        linha.on('mouseover', function() { linha.setStyle({ weight: 7 }); });
        linha.on('mouseout', function() { linha.setStyle({ weight: 4.5 }); });
        camada.addLayer(linha);
        linhas.set(r.id, linha);
      });
      camada.addTo(map);
    }
    atualizarHalo();
    renderLegenda(visiveis);
    if (MODULO) { renderResumo($('resumoJurisdicao'), true); renderContador(visiveis); }
  }

  function atualizarHalo() {
    if (halo) { map.removeLayer(halo); halo = null; }
    var linha = selecionado != null && linhas.get(selecionado);
    if (!linha) return;
    halo = L.polyline(linha.getLatLngs(), { pane: 'jurisdicaoHaloPane', color: '#facc15', weight: 16, opacity: 0.6, interactive: false }).addTo(map);
  }

  function selecionar(id) { selecionado = id; atualizarHalo(); }

  // margens: largura do mapa coberta pela tabela (esquerda) e pela ficha (direita); o trecho fica
  // centralizado na parte que sobra visivel.
  function focar(id, margemEsquerda, margemDireita) {
    var g = Store.geometria(id);
    if (!g) return false;
    var limites = L.polyline(latlngsDe(g)).getBounds();
    map.fitBounds(limites, { paddingTopLeft: [(margemEsquerda || 0) + 50, 50], paddingBottomRight: [(margemDireita || 0) + 50, 50], maxZoom: 14 });
    return true;
  }

  function enquadrar(margemEsquerda) {
    var limites = L.latLngBounds([]);
    linhas.forEach(function(l) { limites.extend(l.getBounds()); });
    if (limites.isValid()) map.fitBounds(limites, { paddingTopLeft: [(margemEsquerda || 0) + 30, 30], paddingBottomRight: [30, 30], maxZoom: 13 });
  }

  // ---------- Filtros (um estado so) ----------
  function definirFiltro(campo, valor) {
    filtros[campo] = valor || '';
    sincronizarControles();
    desenhar();
    emitir('filtros');
  }

  function limparFiltros() {
    filtros = { tipo: '', situacao: '', geo: '', busca: '' };
    sincronizarControles();
    desenhar();
    emitir('filtros');
  }

  function sincronizarControles() {
    [['jurBusca', 'busca'], ['jurTipo', 'tipo'], ['jurSituacao', 'situacao']].forEach(function(p) {
      var el = $(p[0]);
      if (el && document.activeElement !== el) el.value = filtros[p[1]];
    });
  }

  // ---------- Legenda (barra direita) ----------
  function renderLegenda(visiveis) {
    var bloco = $('blocoLegendaJurisdicao');
    if (!bloco) return;
    var porTipo = {};
    visiveis.forEach(function(r) { porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1; });
    var tipos = Indicadores.ORDEM_TIPOS.filter(function(t) { return porTipo[t]; });
    bloco.style.display = tipos.length ? '' : 'none';
    $('legendaJurisdicao').innerHTML = tipos.map(function(t) {
      return '<div class="legenda-item"><span class="legenda-linha-wrap"><span class="legenda-linha" style="height:5px;background:' + corTipo(t) +
        ';box-shadow:0 0 0 2px #fff,0 0 0 3px #d1d5db"></span></span><div class="legenda-texto">' + esc(t) + ' (' + porTipo[t] + ')</div></div>';
    }).join('');
  }

  // ---------- Painel de indicadores ----------
  // compacto = barra direita do mapa; senao, faixa larga no topo da tabela (como no site do jurisdicao).
  function renderResumo(alvo, compacto) {
    if (!alvo) return;
    var todos = Store.lista();
    var ind = Indicadores.calcular(todos.filter(function(r) { return atende(r); }));
    var indTipo = Indicadores.calcular(todos.filter(function(r) { return atende(r, 'tipo'); }));
    var indSit = Indicadores.calcular(todos.filter(function(r) { return atende(r, 'situacao'); }));
    function cartao(classe, icone, corpo) {
      return '<div class="ind ' + classe + '">' + Indicadores.icone(icone, compacto ? 34 : 40) + '<div class="ind-corpo">' + corpo + '</div></div>';
    }
    var tipos = Indicadores.ORDEM_TIPOS.map(function(t) {
      return '<button type="button" class="ind-linha' + (filtros.tipo === t ? ' ativo' : '') + '" data-tipo="' + esc(t) + '" style="--cor:' + corTipo(t) + '">' +
        '<i></i><span class="rot">' + Indicadores.PLURAL_TIPO[t] + '<span class="km">' + km2(indTipo.porTipo[t].km) + ' km</span></span><b>' + indTipo.porTipo[t].qtd + '</b></button>';
    }).join('');
    var finalizados = Indicadores.ORDEM_TIPOS.map(function(t) {
      return '<div class="ind-linha" style="--cor:' + corTipo(t) + '"><i></i><span class="rot">' + Indicadores.PLURAL_TIPO[t] + '</span><b>' + ind.porTipo[t].finalizados + '</b></div>';
    }).join('');
    var total = indSit.total || 1, barra = '', sits = '';
    Indicadores.SITUACOES_RESUMO.forEach(function(par) {
      var s = par[0], n = indSit.situacoes[s], cor = corSituacao(s);
      if (n) barra += '<span style="width:' + (n / total * 100) + '%;background:' + cor + '" title="' + esc(s) + ': ' + n + '"></span>';
      sits += '<button type="button" class="ind-sit' + (filtros.situacao === s ? ' ativo' : '') + '" data-situacao="' + esc(s) + '" style="--cor:' + cor + '"><i></i>' + par[1] + '<b>' + n + '</b></button>';
    });
    var leis = cartao('ind-total', 'leiEstadual', '<div class="ind-valor">' + ind.leisEstaduais + '</div><div class="ind-rotulo">Leis estaduais aprovadas</div>') +
      cartao('ind-total', 'leiMunicipal', '<div class="ind-valor">' + ind.leisMunicipais + '</div><div class="ind-rotulo">Leis municipais aprovadas</div>');
    alvo.innerHTML =
      cartao('ind-total', 'processos', '<div class="ind-valor">' + ind.total + '</div><div class="ind-rotulo">Processos totais</div><div class="ind-sub">' + km2(ind.km) + ' km</div>') +
      cartao('ind-lista', 'extensao', '<div class="ind-titulo">Extensões totais</div>' + tipos) +
      cartao('ind-lista', 'finalizados', '<div class="ind-titulo">Finalizados</div>' + finalizados) +
      cartao('ind-situacoes', 'situacao', '<div class="ind-titulo">Situação atual</div><div class="barra">' + barra + '</div><div class="ind-sits">' + sits + '</div>') +
      (compacto ? '<div class="ind-par">' + leis + '</div>' : leis);
  }

  // Tipo e situacao do painel filtram (clicar de novo desmarca).
  function cliqueResumo(e) {
    var b = e.target.closest('[data-tipo],[data-situacao]');
    if (!b) return;
    if (b.dataset.tipo) definirFiltro('tipo', filtros.tipo === b.dataset.tipo ? '' : b.dataset.tipo);
    else definirFiltro('situacao', filtros.situacao === b.dataset.situacao ? '' : b.dataset.situacao);
  }

  function renderContador(visiveis) {
    var el = $('jurContador');
    if (!el) return;
    var km = visiveis.reduce(function(s, r) { return s + (Number(r.extensao_km) || 0); }, 0);
    el.textContent = visiveis.length + ' de ' + Store.lista().length + ' trechos · ' + km2(km) + ' km';
  }

  // ---------- Interface ----------
  function montarModulo() {
    document.body.classList.add('modulo-jurisdicao');
    // Sem obras: o painel ORIGEM some; os demais filtros (municipio, regioes...) continuam valendo para a base.
    var origem = $('servicosLinearesBotoes');
    if (origem && origem.closest('details')) origem.closest('details').hidden = true;

    var painel = document.createElement('details');
    painel.className = 'painel-colapsavel jur-painel';
    painel.open = true;
    painel.innerHTML =
      '<summary class="subtitulo subtitulo-painel">JURISDIÇÃO</summary>' +
      '<div class="conteudo-colapsavel">' +
        '<button type="button" class="jur-abrir-tabela" id="jurAbrirTabela">Abrir tabela</button>' +
        '<label for="jurBusca">Buscar</label>' +
        '<input id="jurBusca" type="search" placeholder="Nº, rodovia, município, processo" autocomplete="off">' +
        '<label for="jurTipo">Tipo</label><select id="jurTipo"><option value="">Todos</option>' +
          Indicadores.ORDEM_TIPOS.map(function(t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' +
        '<label for="jurSituacao">Situação</label><select id="jurSituacao"><option value="">Todas</option>' +
          Object.keys(SITUACOES).map(function(s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
        '<div class="jur-contador" id="jurContador">Carregando…</div>' +
        '<button type="button" id="jurEnquadrar">Enquadrar trechos</button>' +
      '</div>';
    var conteudo = $('sidebar-left-content');
    conteudo.insertBefore(painel, conteudo.firstElementChild);

    var bloco = document.createElement('div');
    bloco.className = 'bloco jur-resumo-bloco';
    bloco.innerHTML = '<div class="subtitulo">PAINEL DA JURISDIÇÃO</div><div class="jur-resumo" id="resumoJurisdicao"></div>';
    var titulo = $('blocoLegendaTitulo');
    titulo.parentNode.insertBefore(bloco, titulo);

    var tempo = null;
    $('jurBusca').addEventListener('input', function() {
      clearTimeout(tempo);
      var valor = this.value;
      tempo = setTimeout(function() { definirFiltro('busca', valor.trim()); }, 200);
    });
    $('jurTipo').addEventListener('change', function() { definirFiltro('tipo', this.value); });
    $('jurSituacao').addEventListener('change', function() { definirFiltro('situacao', this.value); });
    $('jurEnquadrar').addEventListener('click', function() { enquadrar(); });
    $('resumoJurisdicao').addEventListener('click', cliqueResumo);
    // Botao "Abrir detalhes" do popup do trecho.
    document.addEventListener('click', function(e) {
      var b = e.target.closest('[data-jur-abrir]');
      if (b) { map.closePopup(); emitir('abrir', Number(b.dataset.jurAbrir)); }
    });
  }

  function montarLegenda() {
    var bloco = document.createElement('div');
    bloco.className = 'bloco legenda-categoria';
    bloco.id = 'blocoLegendaJurisdicao';
    bloco.style.display = 'none';
    bloco.innerHTML = '<div class="subtitulo">JURISDIÇÃO</div><div id="legendaJurisdicao"></div>';
    var titulo = $('blocoLegendaTitulo');
    titulo.parentNode.insertBefore(bloco, titulo.nextSibling);
  }

  function ligarReferencia(ligar) {
    referenciaAtiva = ligar;
    var botao = $('toggleJurisdicao');
    if (botao) {
      botao.classList.toggle('ativo-filtro', ligar);
      botao.setAttribute('aria-pressed', String(ligar));
    }
    if (ligar) carregar().then(desenhar); else desenhar();
  }

  montarLegenda();
  // Mudancas gravadas (por esta ou outra aba) redesenham mapa e indicadores.
  Store.ouvir(function(evento) {
    // 'pendentes': o traçado em edição (ainda não salvo) já aparece no mapa.
    if (['registro', 'geometria', 'criado', 'excluido', 'recarregado', 'pendentes', 'visao'].indexOf(evento) !== -1) desenhar();
  });
  if (MODULO) {
    montarModulo();
    if ($('toggleJurisdicao')) $('toggleJurisdicao').hidden = true;
    carregar().then(function() { desenhar(); enquadrar(); })
      .catch(function(e) { $('jurContador').textContent = e.message; });
    // "Ligar Tudo / Limpar" volta ao estado de abertura do modulo (sem filtros da jurisdicao).
    $('limparFiltro').addEventListener('click', limparFiltros);
  } else {
    $('toggleJurisdicao').addEventListener('click', function() { ligarReferencia(!referenciaAtiva); });
    $('desligarTudo').addEventListener('click', function() { ligarReferencia(false); });
    $('limparFiltro').addEventListener('click', function() { ligarReferencia(false); });
  }

  return {
    ativo: function() { return MODULO; },
    carregar: carregar,
    atende: atende,
    filtros: function() { return filtros; },
    definirFiltro: definirFiltro,
    limparFiltros: limparFiltros,
    renderResumo: renderResumo,
    cliqueResumo: cliqueResumo,
    selecionar: selecionar,
    focar: focar,
    enquadrar: enquadrar,
    ouvir: function(fn) { ouvintes.push(fn); }
  };
})();
