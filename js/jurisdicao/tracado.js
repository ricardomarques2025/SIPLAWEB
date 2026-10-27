// Aba "Traçado" da ficha da jurisdição (js/jurisdicao/painel.js). A linha do trecho é própria (MultiLineString)
// e pode ser montada de três jeitos, que se combinam:
//   1. Escolher na malha: segmentos inteiros da SRE ou da malha complementar (extra_base), pela lista
//      (Shift marca um intervalo) ou clicando no mapa (Shift+clique pega o intervalo da mesma rodovia);
//   2. Desenhar / editar: Geoman (carregado só aqui), com ímã nos segmentos da malha à vista;
//   3. Importar: arquivo GeoJSON com linhas (latitude/longitude), substituindo ou acrescentando.
// Tudo vira pendência (Store.atualizar 'geom') e passa pelo "Revisar e salvar/enviar"; na conferência, o pedaço
// que ficar fora da malha é oferecido para entrar na extra_base (conferirForaDaMalha).
// Também: "Malha complementar" (lista, ver no mapa, excluir; arquivo de cópias só para administradores).

var JurTracado = (function() {
  var GEOMAN = {
    css: 'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css',
    js: 'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.js'
  };
  var BASES = ['sre_base', 'extra_base'];
  var LIMITE_LISTA = 300;

  var api = null, id = null;
  var modo = null;                 // null | 'malha' | 'desenho' | 'importar'
  var estado = { base: 'sre_base', grupo: '', busca: '', marcados: new Set(), ultimo: null, ultimoMapa: null, lista: [] };
  var camadaSelecao = null, rendererSelecao = null;
  var edicao = null;               // { linha, snap }
  var ima = true;
  var geomanPronto = null;

  function $(x) { return document.getElementById(x); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function km(n) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function r6(n) { return Math.round(n * 1e6) / 1e6; }

  // ---------- Geometria ----------
  function partesDe(g) {
    if (!g || !g.coordinates) return [];
    return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  }
  function partesAtuais() { return partesDe(Store.geometria(id)).map(function(p) { return p.slice(); }); }
  function metros(a, b) {
    var R = 6371008.8, f1 = a[1] * Math.PI / 180, f2 = b[1] * Math.PI / 180, df = f2 - f1, dl = (b[0] - a[0]) * Math.PI / 180;
    var h = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function kmDe(g) {
    return partesDe(g).reduce(function(s, p) { for (var i = 1; i < p.length; i++) s += metros(p[i - 1], p[i]); return s; }, 0) / 1000;
  }
  function descrever(g) { var n = partesDe(g).length; return g ? km(kmDe(g)) + ' km · ' + n + (n === 1 ? ' parte' : ' partes') : ''; }

  // Grava como pendência (nada vai ao banco aqui). Partes com menos de 2 pontos saem.
  function definir(partes) {
    partes = partes.map(function(p) { return p.map(function(c) { return [r6(c[0]), r6(c[1])]; }); }).filter(function(p) { return p.length >= 2; });
    Store.atualizar(id, 'geom', partes.length ? { type: 'MultiLineString', coordinates: partes } : null);
    api.aoMudar();
    renderResumo();
  }

  // ---------- Malha (SRE + extra_base) ----------
  function feicoes(base) { var fc = typeof camadaBaseMapa === 'function' ? camadaBaseMapa(base) : null; return (fc && fc.features) || []; }
  function chave(base, f) { return base + ':' + f.properties.GEOCOD; }
  function feicaoPorChave(k) {
    var p = k.indexOf(':'), base = k.slice(0, p), cod = k.slice(p + 1);
    return feicoes(base).find(function(f) { return f.properties.GEOCOD === cod; }) || null;
  }
  function defBase(base) { return BASES_TRACADO[base]; }
  // Segmento já está no traçado? (algum trecho do traçado passa pelos dois extremos e pelo meio)
  function noTracado(f) {
    var partes = partesAtuais();
    if (!partes.length) return false;
    var p = partesDe(f.geometry)[0];
    if (!p || p.length < 2) return false;
    var alvos = [p[0], p[Math.floor(p.length / 2)], p[p.length - 1]];
    return alvos.every(function(a) { return partes.some(function(q) { return q.some(function(c) { return metros(a, c) < 15; }); }); });
  }
  function acrescentar(chaves) {
    var partes = partesAtuais(), n = 0;
    chaves.forEach(function(k) {
      var f = feicaoPorChave(k);
      if (!f || noTracado(f)) return;
      partesDe(f.geometry).forEach(function(p) { partes.push(p.slice()); });
      n++;
    });
    if (n) definir(partes);
    return n;
  }

  // ---------- Aba ----------
  function render(corpo, r, opcoes) {
    if (id !== r.id) { encerrar(); estado.marcados = new Set(); estado.ultimo = null; estado.ultimoMapa = null; }
    id = r.id;
    api = opcoes;
    var pode = Store.podeEditar();
    corpo.innerHTML = '<div class="jt">' +
      '<div class="form-grupo"><h4>Traçado do trecho</h4><div class="trc-resumo" id="jtResumo"></div>' +
      (pode ? '<div class="trc-acoes">' +
        '<button type="button" class="btn" data-jt-modo="malha"><svg><use href="#i-pin"/></svg>Escolher na malha</button>' +
        '<button type="button" class="btn" data-jt-modo="desenho"><svg><use href="#i-split"/></svg>Desenhar / editar</button>' +
        '<button type="button" class="btn" data-jt-modo="importar"><svg><use href="#i-down"/></svg>Importar GeoJSON</button></div>' +
        '<div class="trc-acoes"><button type="button" class="link" id="jtDesfazer">desfazer alterações do traçado</button>' +
        '<span class="espaco"></span><button type="button" class="link link-perigo" id="jtApagar">apagar o traçado</button></div>' : '') +
      '</div><div id="jtPainel"></div></div>';
    renderResumo();
    if (!pode) return;
    corpo.querySelectorAll('[data-jt-modo]').forEach(function(b) {
      b.addEventListener('click', function() { modo === b.dataset.jtModo ? encerrar() : iniciarModo(b.dataset.jtModo); });
    });
    $('jtDesfazer').addEventListener('click', function() {
      encerrar();
      Store.descartarCampo(id, 'geom');   // volta ao traçado gravado
      api.aoMudar(); renderResumo();
    });
    $('jtApagar').addEventListener('click', function() {
      if (!confirm('Apagar o traçado do registro ' + Store.rotulo(id) + '? (fica pendente até você salvar)')) return;
      encerrar(); definir([]);
    });
    if (modo) renderPainel();
  }

  function renderResumo() {
    var el = $('jtResumo');
    if (!el) return;
    var g = Store.geometria(id), pend = Store.pendente(id, 'geom');
    el.innerHTML = g ? '<b>' + descrever(g) + '</b>' + (pend ? ' <span class="trc-tag trc-tag-pend">alterado, falta salvar</span>' : '')
      : 'Sem traçado' + (pend ? ' <span class="trc-tag trc-tag-pend">apagado, falta salvar</span>' : ' — use uma das opções abaixo.');
    if ($('jtDesfazer')) $('jtDesfazer').hidden = !pend;
    if ($('jtApagar')) $('jtApagar').hidden = !g;
    document.querySelectorAll('[data-jt-modo]').forEach(function(b) { b.classList.toggle('ativo', b.dataset.jtModo === modo); });
  }

  function iniciarModo(novo) {
    encerrar();
    modo = novo;
    renderResumo();
    renderPainel();
    if (novo === 'malha') api.mostrarMapa(true).then(function() { if (modo === 'malha') { desenharSelecao(); enquadrarTracado(); } });
    if (novo === 'desenho') api.mostrarMapa(true).then(iniciarDesenho);
  }

  function renderPainel() {
    var el = $('jtPainel');
    if (!el) return;
    if (modo === 'malha') {
      el.innerHTML = '<div class="form-grupo"><h4>Escolher na malha</h4><div class="trc-filtros">' +
        '<select id="jtBase" class="seletor">' + BASES.map(function(b) { return '<option value="' + b + '"' + (b === estado.base ? ' selected' : '') + '>' + esc(defBase(b).nome) + '</option>'; }).join('') + '</select>' +
        '<select id="jtGrupo" class="seletor"></select>' +
        '<label class="busca"><svg><use href="#i-search"/></svg><input id="jtBusca" type="search" placeholder="Código, km, nome…" value="' + esc(estado.busca) + '"></label></div>' +
        '<div class="trc-acoes"><button type="button" class="btn btn-fantasma" id="jtMarcarTodos">Marcar todos</button><span class="espaco"></span>' +
        '<button type="button" class="btn btn-primario" id="jtAdicionar" disabled></button></div>' +
        '<p class="trc-dica">Marque na lista (Shift+clique marca um intervalo) ou clique no segmento no mapa para acrescentá-lo; Shift+clique acrescenta todos os segmentos da mesma rodovia entre o último clicado e este. Segmento escolhido entra inteiro: se o trecho começa ou termina no meio dele, ajuste a ponta em <b>Desenhar / editar</b>.</p>' +
        '<div id="jtLista" class="trc-lista trc-resultados"></div></div>';
      preencherGrupos(); renderLista();
      $('jtBase').addEventListener('change', function() { estado.base = this.value; estado.grupo = ''; estado.marcados = new Set(); preencherGrupos(); renderLista(); desenharSelecao(); });
      $('jtGrupo').addEventListener('change', function() { estado.grupo = this.value; renderLista(); restilizar(); if (estado.grupo) enquadrar(resultados().map(feicaoPorChave)); });
      var t = null;
      $('jtBusca').addEventListener('input', function() { var v = this.value; clearTimeout(t); t = setTimeout(function() { estado.busca = v.trim(); renderLista(); }, 150); });
      $('jtMarcarTodos').addEventListener('click', function() { estado.lista.forEach(function(k) { if (!noTracado(feicaoPorChave(k))) estado.marcados.add(k); }); renderLista(); restilizar(); });
      $('jtAdicionar').addEventListener('click', function() {
        var n = acrescentar(Array.from(estado.marcados));
        estado.marcados = new Set(); renderLista(); restilizar();
        api.toast(n + ' segmento(s) acrescentado(s) ao traçado (pendente)');
      });
      $('jtLista').addEventListener('click', aoMarcar);
    } else if (modo === 'desenho') {
      el.innerHTML = '<div class="form-grupo"><h4>Desenhar / editar no mapa</h4>' +
        '<p class="trc-dica">Arraste os vértices para ajustar; clique no meio de um lado para criar vértice; clique com o botão direito num vértice para apagá-lo. <b>Nova parte</b> desenha outra linha (clique ponto a ponto, duplo clique termina).</p>' +
        '<div class="trc-acoes"><label class="chk"><input type="checkbox" id="jtIma"' + (ima ? ' checked' : '') + '> Ímã na malha (SRE e complementar)</label></div>' +
        '<div class="trc-acoes"><button type="button" class="btn" id="jtNovaParte"><svg><use href="#i-plus"/></svg>Nova parte</button><span class="espaco"></span>' +
        '<button type="button" class="btn btn-fantasma" id="jtCancelarDesenho">Cancelar</button>' +
        '<button type="button" class="btn btn-primario" id="jtConcluir"><svg><use href="#i-check"/></svg>Concluir edição</button></div>' +
        '<div class="trc-dica" id="jtVertices"></div></div>';
      $('jtIma').addEventListener('change', function() { ima = this.checked; reativarEdicao(); });
      $('jtNovaParte').addEventListener('click', novaParte);
      $('jtCancelarDesenho').addEventListener('click', encerrar);
      $('jtConcluir').addEventListener('click', concluirDesenho);
    } else if (modo === 'importar') {
      el.innerHTML = '<div class="form-grupo"><h4>Importar GeoJSON</h4>' +
        '<p class="trc-dica">Arquivo .geojson/.json com linhas (LineString ou MultiLineString) em latitude/longitude (SIRGAS 2000 ou WGS 84). Coordenadas em UTM não são aceitas: exporte em graus no QGIS (EPSG:4674).</p>' +
        '<div class="trc-acoes"><label class="chk"><input type="radio" name="jtComo" value="substituir" checked> Substituir o traçado</label>' +
        '<label class="chk"><input type="radio" name="jtComo" value="acrescentar"> Acrescentar ao traçado</label></div>' +
        '<div class="trc-acoes"><input type="file" id="jtArquivo" accept=".geojson,.json,application/geo+json,application/json"></div>' +
        '<span class="obr-aviso" id="jtAvisoImport"></span></div>';
      $('jtArquivo').addEventListener('change', importar);
    } else {
      el.innerHTML = '';
    }
  }

  // ---------- 1. Escolher na malha ----------
  function preencherGrupos() {
    var def = defBase(estado.base), vistos = {};
    feicoes(estado.base).forEach(function(f) { var g = def.grupo(f.properties || {}); if (g) vistos[g] = (vistos[g] || 0) + 1; });
    $('jtGrupo').innerHTML = '<option value="">Qualquer rodovia</option>' + Object.keys(vistos).sort(function(a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); })
      .map(function(g) { return '<option value="' + esc(g) + '"' + (g === estado.grupo ? ' selected' : '') + '>' + esc(g) + ' (' + vistos[g] + ')</option>'; }).join('');
  }
  function ordenar(a, b) {
    var def = defBase(estado.base), fa = feicaoPorChave(a).properties, fb = feicaoPorChave(b).properties;
    var ga = String(def.grupo(fa) || ''), gb = String(def.grupo(fb) || '');
    if (ga !== gb) return ga.localeCompare(gb, 'pt-BR', { numeric: true });
    var oa = def.ordem(fa), ob = def.ordem(fb);
    return oa < ob ? -1 : oa > ob ? 1 : 0;
  }
  function resultados() {
    var def = defBase(estado.base), termos = semAcento(estado.busca).split(/\s+/).filter(Boolean);
    return feicoes(estado.base).filter(function(f) {
      var p = f.properties || {};
      if (estado.grupo && def.grupo(p) !== estado.grupo) return false;
      if (!termos.length) return true;
      var alvo = semAcento([p.GEOCOD, def.rotulo(p), def.detalhe(p)].join(' '));
      return termos.every(function(t) { return alvo.indexOf(t) !== -1; });
    }).map(function(f) { return chave(estado.base, f); }).sort(ordenar);
  }
  function renderLista() {
    var todos = resultados(), def = defBase(estado.base);
    estado.lista = todos.slice(0, LIMITE_LISTA);
    $('jtLista').innerHTML = estado.lista.length ? estado.lista.map(function(k) {
      var f = feicaoPorChave(k), p = f.properties, ja = noTracado(f);
      return '<label class="trc-opcao' + (ja ? ' ja' : '') + '"><input type="checkbox" data-jt-marcar="' + esc(k) + '"' + (ja ? ' checked disabled' : estado.marcados.has(k) ? ' checked' : '') + '>' +
        '<span class="trc-texto"><b>' + esc(def.rotulo(p)) + '</b>' + (ja ? ' <span class="trc-tag">já no traçado</span>' : '') + '<span>' + esc(def.detalhe(p)) + '</span></span></label>';
    }).join('') + (todos.length > LIMITE_LISTA ? '<div class="vazio">Mostrando ' + LIMITE_LISTA + ' de ' + todos.length + '. Escolha a rodovia ou refine a busca.</div>' : '')
      : '<div class="vazio">Nada encontrado.</div>';
    var n = estado.marcados.size;
    $('jtAdicionar').disabled = !n;
    $('jtAdicionar').innerHTML = '<svg><use href="#i-plus"/></svg>Acrescentar' + (n ? ' ' + n : '') + ' ao traçado';
  }
  function aoMarcar(e) {
    var input = e.target.closest('[data-jt-marcar]');
    if (!input) return;
    var k = input.dataset.jtMarcar, lista = estado.lista, i = lista.indexOf(k), j = estado.ultimo ? lista.indexOf(estado.ultimo) : -1;
    var faixa = e.shiftKey && j !== -1 ? lista.slice(Math.min(i, j), Math.max(i, j) + 1) : [k];
    faixa.forEach(function(x) { if (noTracado(feicaoPorChave(x))) return; input.checked ? estado.marcados.add(x) : estado.marcados.delete(x); });
    estado.ultimo = k;
    renderLista(); restilizar();
  }

  function estilo(f) {
    var k = chave(estado.base, f), def = defBase(estado.base);
    var ja = noTracado(f), marcado = estado.marcados.has(k), doGrupo = estado.grupo && def.grupo(f.properties) === estado.grupo;
    var cor = ja ? '#f59e0b' : marcado ? '#16a34a' : doGrupo ? '#2563eb' : '#475569';
    return { color: cor, weight: ja || marcado ? 6 : doGrupo ? 4 : 2.5, opacity: ja || marcado || doGrupo ? 0.95 : 0.55 };
  }
  function desenharSelecao() {
    if (camadaSelecao) { map.removeLayer(camadaSelecao); camadaSelecao = null; }
    if (modo !== 'malha') return;
    if (!rendererSelecao) {
      map.createPane('jurTracadoPane').style.zIndex = 640;
      rendererSelecao = L.canvas({ pane: 'jurTracadoPane', tolerance: 8 });
    }
    var def = defBase(estado.base);
    camadaSelecao = L.geoJSON({ type: 'FeatureCollection', features: feicoes(estado.base) }, {
      pane: 'jurTracadoPane', renderer: rendererSelecao, style: estilo,
      onEachFeature: function(f, l) {
        l.bindTooltip('<b>' + esc(def.rotulo(f.properties)) + '</b><br>' + esc(def.detalhe(f.properties)), { sticky: true, direction: 'top', className: 'trc-tooltip' });
        l.on('click', function(e) { L.DomEvent.stopPropagation(e); cliqueSegmento(f, e.originalEvent && e.originalEvent.shiftKey); });
      }
    }).addTo(map);
    window.obrasSelecaoTracadoAtiva = true;
  }
  function restilizar() { if (camadaSelecao) camadaSelecao.eachLayer(function(l) { l.setStyle(estilo(l.feature)); }); }
  function cliqueSegmento(f, shift) {
    var def = defBase(estado.base), k = chave(estado.base, f), ant = estado.ultimoMapa && feicaoPorChave(estado.ultimoMapa);
    var lista = [k];
    if (shift && ant && def.grupo(ant.properties) === def.grupo(f.properties)) {
      var g = def.grupo(f.properties);
      var doGrupo = feicoes(estado.base).filter(function(x) { return def.grupo(x.properties) === g; }).map(function(x) { return chave(estado.base, x); }).sort(ordenar);
      var i = doGrupo.indexOf(estado.ultimoMapa), j = doGrupo.indexOf(k);
      lista = doGrupo.slice(Math.min(i, j), Math.max(i, j) + 1);
    }
    var n = acrescentar(lista);
    estado.ultimoMapa = k;
    if (!n) api.toast('Esse segmento já está no traçado');
    restilizar();
    if ($('jtLista')) renderLista();
  }

  // ---------- 2. Desenhar / editar (Geoman) ----------
  function carregarGeoman() {
    if (!geomanPronto && window.L && L.PM) {   // o editor de camadas (js/camadas_edicao.js) já carregou
      L.PM.setOptIn(true);
      if (!map.pm) map.pm = new L.PM.Map(map);
      geomanPronto = Promise.resolve();
    }
    if (!geomanPronto) {
      geomanPronto = new Promise(function(resolve, reject) {
        var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = GEOMAN.css; document.head.appendChild(l);
        var s = document.createElement('script'); s.src = GEOMAN.js;
        s.onload = function() {
          // Opt-in: só as camadas desta edição (pmIgnore:false) entram no Geoman; o resto do mapa fica de fora.
          L.PM.setOptIn(true);
          if (!map.pm) map.pm = new L.PM.Map(map);
          map.pm.setLang('pt_br');
          resolve();
        };
        s.onerror = function() { reject(new Error('Não foi possível carregar a ferramenta de desenho')); };
        document.head.appendChild(s);
      });
    }
    return geomanPronto;
  }
  function latlngs(partes) { return partes.map(function(p) { return p.map(function(c) { return L.latLng(c[1], c[0]); }); }); }
  function opcoesEdicao() { return { snappable: ima, snapDistance: 14, allowSelfIntersection: true, draggable: false }; }

  function iniciarDesenho() {
    if (modo !== 'desenho') return;
    carregarGeoman().then(function() {
      if (modo !== 'desenho') return;
      if (!map.getPane('jurEdicaoPane')) map.createPane('jurEdicaoPane').style.zIndex = 650;
      window.obrasSelecaoTracadoAtiva = true;
      edicao = { linha: null, snap: null };
      var partes = partesAtuais();
      if (partes.length) {
        edicao.linha = L.polyline(latlngs(partes), { pane: 'jurEdicaoPane', color: '#dc2626', weight: 4, pmIgnore: false, snapIgnore: true }).addTo(map);
        edicao.linha.pm.enable(opcoesEdicao());
        edicao.linha.on('pm:edit pm:vertexremoved', contarVertices);
      }
      atualizarIma();
      map.on('moveend', atualizarIma);
      map.on('pm:create', aoCriarParte);
      enquadrarTracado();
      contarVertices();
      if (!partes.length) novaParte();
    }).catch(function(e) { api.toast(e.message, true); encerrar(); });
  }
  // Ímã: só os segmentos da malha perto da área visível (o Geoman confere todos a cada movimento do mouse).
  function atualizarIma() {
    if (!edicao) return;
    if (edicao.snap) { map.removeLayer(edicao.snap); edicao.snap = null; }
    if (ima && map.getZoom() >= 11) {
      var b = map.getBounds().pad(0.3);
      var perto = BASES.reduce(function(acc, base) {
        return acc.concat(feicoes(base).filter(function(f) { var bb = L.geoJSON(f).getBounds(); return b.intersects(bb); }));
      }, []);
      edicao.snap = L.geoJSON({ type: 'FeatureCollection', features: perto }, {
        pane: 'jurEdicaoPane', interactive: false, pmIgnore: false, snapIgnore: false, style: { color: '#64748b', weight: 2, opacity: 0.6, dashArray: '4,4' }
      }).addTo(map);
      edicao.snap.eachLayer(function(l) { l.options.pmIgnore = false; l.options.snapIgnore = false; });
    }
    reativarEdicao(true);
  }
  function reativarEdicao(semRecarregarIma) {
    if (!edicao) return;
    if (!semRecarregarIma) { atualizarIma(); return; }
    if (edicao.linha) { edicao.linha.pm.disable(); edicao.linha.pm.enable(opcoesEdicao()); }
  }
  function novaParte() {
    if (!edicao) return;
    map.pm.enableDraw('Line', { snappable: ima, snapDistance: 14, finishOn: 'dblclick', templineStyle: { color: '#dc2626', weight: 3 }, hintlineStyle: { color: '#dc2626', dashArray: '5,5' }, pathOptions: { pmIgnore: true } });
  }
  function aoCriarParte(e) {
    if (!edicao) return;
    var novas = e.layer.getLatLngs();
    map.removeLayer(e.layer);
    if (novas.length < 2) return;
    if (edicao.linha) {
      var atuais = edicao.linha.getLatLngs();
      var partes = L.LineUtil.isFlat(atuais) ? [atuais] : atuais;
      partes.push(novas);
      edicao.linha.pm.disable();
      edicao.linha.setLatLngs(partes);
    } else {
      edicao.linha = L.polyline([novas], { pane: 'jurEdicaoPane', color: '#dc2626', weight: 4, pmIgnore: false, snapIgnore: true }).addTo(map);
      edicao.linha.on('pm:edit pm:vertexremoved', contarVertices);
    }
    edicao.linha.pm.enable(opcoesEdicao());
    contarVertices();
  }
  function partesDaLinha() {
    if (!edicao || !edicao.linha) return [];
    var g = edicao.linha.toGeoJSON(6).geometry;
    return partesDe(g);
  }
  function contarVertices() {
    var el = $('jtVertices');
    if (!el) return;
    var partes = partesDaLinha();
    el.textContent = partes.length ? partes.reduce(function(s, p) { return s + p.length; }, 0) + ' vértices · ' + descrever({ type: 'MultiLineString', coordinates: partes }) : 'Nenhuma linha ainda: clique em Nova parte.';
  }
  function concluirDesenho() {
    var partes = partesDaLinha();
    var antes = JSON.stringify(partesAtuais().map(function(p) { return p.map(function(c) { return [r6(c[0]), r6(c[1])]; }); }));
    encerrar();
    if (JSON.stringify(partes) !== antes) { definir(partes); api.toast('Traçado alterado (pendente: falta revisar e salvar)'); }
  }

  // ---------- 3. Importar ----------
  function linhasDoGeojson(obj) {
    var partes = [];
    (function andar(o) {
      if (!o) return;
      if (o.type === 'FeatureCollection') (o.features || []).forEach(andar);
      else if (o.type === 'Feature') andar(o.geometry);
      else if (o.type === 'GeometryCollection') (o.geometries || []).forEach(andar);
      else if (o.type === 'LineString') partes.push(o.coordinates);
      else if (o.type === 'MultiLineString') o.coordinates.forEach(function(p) { partes.push(p); });
    })(obj);
    return partes.map(function(p) { return p.map(function(c) { return [Number(c[0]), Number(c[1])]; }); });
  }
  function importar() {
    var arq = this.files && this.files[0], aviso = $('jtAvisoImport');
    if (!arq) return;
    aviso.textContent = 'Lendo…';
    arq.text().then(function(txt) {
      var partes = linhasDoGeojson(JSON.parse(txt));
      if (!partes.length) throw new Error('O arquivo não tem linhas (LineString/MultiLineString).');
      var pontos = partes.flat();
      if (pontos.some(function(c) { return Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90; })) throw new Error('As coordenadas parecem projetadas (UTM). Exporte em latitude/longitude (EPSG:4674 ou 4326).');
      if (pontos.some(function(c) { return !(c[0] >= -53.8 && c[0] <= -45.4 && c[1] >= -20 && c[1] <= -12); })) throw new Error('Há pontos fora de Goiás. Confira se latitude e longitude não estão trocadas.');
      var substituir = document.querySelector('input[name="jtComo"]:checked').value === 'substituir';
      definir(substituir ? partes : partesAtuais().concat(partes));
      aviso.textContent = '';
      api.toast('Importado: ' + partes.length + (partes.length === 1 ? ' linha' : ' linhas') + ' · ' + km(kmDe({ type: 'MultiLineString', coordinates: partes })) + ' km (pendente)');
      api.mostrarMapa(false).then(enquadrarTracado);
    }).catch(function(e) { aviso.textContent = e instanceof SyntaxError ? 'Arquivo não é um GeoJSON válido.' : e.message; });
    this.value = '';
  }

  // ---------- Mapa ----------
  function enquadrar(lista) {
    var b = L.latLngBounds([]);
    lista.forEach(function(f) { if (f && f.geometry) b.extend(L.geoJSON(f).getBounds()); });
    if (!b.isValid()) return;
    var mg = api.margens();
    map.fitBounds(b, { paddingTopLeft: [mg[0] + 50, 50], paddingBottomRight: [mg[1] + 50, 50], maxZoom: 15 });
  }
  function enquadrarTracado() { var g = Store.geometria(id); if (g) enquadrar([{ type: 'Feature', geometry: g }]); }

  function encerrar() {
    if (camadaSelecao) { map.removeLayer(camadaSelecao); camadaSelecao = null; }
    if (edicao) {
      if (map.pm) map.pm.disableDraw();
      if (edicao.linha) { edicao.linha.pm.disable(); map.removeLayer(edicao.linha); }
      if (edicao.snap) map.removeLayer(edicao.snap);
      map.off('moveend', atualizarIma);
      map.off('pm:create', aoCriarParte);
      edicao = null;
    }
    var estava = modo;
    modo = null;
    window.obrasSelecaoTracadoAtiva = false;
    if (estava && api && api.aoEncerrar) api.aoEncerrar();
    renderResumo();
    renderPainel();
  }

  // ---------- Conferência: o que ficou fora da malha ----------
  // itens: os de Store.resumoPendentes(). Devolve Promise de { id: [{rodovia, trecho, geom}] } ou null se cancelar.
  function conferirForaDaMalha(itens) {
    var comGeom = itens.filter(function(it) { return it.campos.some(function(c) { return c.campo === 'geom' && c.depois; }); });
    if (!comGeom.length) return Promise.resolve({});
    return Promise.all(comGeom.map(function(it) {
      var g = it.campos.find(function(c) { return c.campo === 'geom'; }).depois;
      return Acesso.cliente.rpc('fora_da_malha', { p_geojson: g }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return { id: it.id, r: it.r, pedacos: res.data.features };
      });
    })).then(function(lista) {
      lista = lista.filter(function(x) { return x.pedacos.length; });
      if (!lista.length) return {};
      return perguntarMalha(lista);
    });
  }
  function perguntarMalha(lista) {
    return new Promise(function(resolve) {
      var dlg = $('jtDlgMalha');
      var n = 0;
      $('jtMalhaCorpo').innerHTML = '<p class="rev-resumo">Partes do traçado que não estão na malha SRE nem na malha complementar. Marque as que devem virar trechos novos da malha complementar (extra_base) — assim as obras também podem usá-los.</p>' +
        lista.map(function(x) {
          return '<div class="rev-obra"><div class="rev-cab"><b>' + Store.rotulo(x.id) + '</b> ' + esc([x.r.rodovia, x.r.municipios].filter(Boolean).join(' — ')) + '</div>' +
            x.pedacos.map(function(p) {
              var i = n++;
              return '<div class="jt-pedaco" data-i="' + i + '" data-id="' + x.id + '"><label class="chk"><input type="checkbox" checked data-usar> Cadastrar (' + km(p.properties.km) + ' km)</label>' +
                '<div class="form-grade"><div class="campo"><label>Rodovia</label><input data-rodovia value="' + esc(x.r.rodovia || '') + '" placeholder="Ex.: VICINAL, GO-020"></div>' +
                '<div class="campo largo"><label>Descrição do trecho</label><input data-trecho value="' + esc(x.r.trecho || x.r.municipios || '') + '"></div></div>' +
                '<button type="button" class="link" data-ver="' + i + '">ver no mapa</button></div>';
            }).join('') + '</div>';
        }).join('');
      var geoms = [];
      lista.forEach(function(x) { x.pedacos.forEach(function(p) { geoms.push(p.geometry); }); });
      var destaque = null;
      $('jtMalhaCorpo').onclick = function(e) {
        var b = e.target.closest('[data-ver]');
        if (!b) return;
        if (destaque) map.removeLayer(destaque);
        destaque = L.geoJSON(geoms[Number(b.dataset.ver)], { style: { color: '#dc2626', weight: 7, opacity: 0.8 } }).addTo(map);
        map.fitBounds(destaque.getBounds(), { maxZoom: 15, padding: [80, 80] });
      };
      function fechar(valor) {
        if (destaque) map.removeLayer(destaque);
        dlg.close();
        resolve(valor);
      }
      $('jtMalhaConfirmar').onclick = function() {
        var extras = {}, falta = false;
        $('jtMalhaCorpo').querySelectorAll('.jt-pedaco').forEach(function(el) {
          if (!el.querySelector('[data-usar]').checked) return;
          var rod = el.querySelector('[data-rodovia]').value.trim(), tre = el.querySelector('[data-trecho]').value.trim();
          if (!rod || !tre) { falta = true; return; }
          var k = Number(el.dataset.id);
          (extras[k] = extras[k] || []).push({ rodovia: rod, trecho: tre, geom: geoms[Number(el.dataset.i)] });
        });
        if (falta) { $('jtMalhaAviso').textContent = 'Preencha rodovia e descrição dos trechos marcados (ou desmarque).'; return; }
        fechar(extras);
      };
      $('jtMalhaVoltar').onclick = function() { fechar(null); };
      $('jtMalhaAviso').textContent = '';
      dlg.showModal();
    });
  }

  // ---------- Malha complementar (lista; arquivo de cópias para administradores) ----------
  var destaqueMalha = null;
  function abrirMalhaComplementar() {
    var pleno = Store.podeCamadas(), admin = !!(Acesso.perfil() && Acesso.perfil().admin);   // edita camadas: exclui trecho
    var fc = camadaBaseMapa('extra_base') || { features: [] };
    var corpo = $('jtMalhaListaCorpo');
    corpo.innerHTML = '<p class="rev-resumo">' + fc.features.length + ' trechos na malha complementar (extra_base).' +
      (admin ? ' <button type="button" class="link" id="jtVerArquivo">ver cópias arquivadas (backup)</button>' : '') + '</p>' +
      '<div class="trc-lista">' + fc.features.slice().sort(function(a, b) { return a.properties.GEOCOD < b.properties.GEOCOD ? -1 : 1; }).map(function(f) {
        var p = f.properties;
        return '<div class="trc-item"><div class="trc-texto"><b>' + esc(p.GEOCOD) + '</b> ' + esc(p.rodovia || '') + ' · ' + km(p.EXT_KM) + ' km<span>' + esc(p.trecho || '') + '</span></div>' +
          '<button type="button" class="link" data-malha-ver="' + esc(p.GEOCOD) + '">ver</button>' +
          (pleno ? ' <button type="button" class="link link-perigo" data-malha-excluir="' + esc(p.GEOCOD) + '">excluir</button>' : '') + '</div>';
      }).join('') + '</div><div id="jtArquivo"></div>';
    corpo.onclick = function(e) {
      var ver = e.target.closest('[data-malha-ver]'), exc = e.target.closest('[data-malha-excluir]'), arq = e.target.closest('#jtVerArquivo'), verArq = e.target.closest('[data-arquivo-ver]');
      if (ver) mostrarNoMapa(fc.features.find(function(f) { return f.properties.GEOCOD === ver.dataset.malhaVer; }));
      if (verArq) mostrarNoMapa(JSON.parse(decodeURIComponent(verArq.dataset.arquivoVer)));
      if (exc && confirm('Excluir o trecho ' + exc.dataset.malhaExcluir + ' da malha complementar? Ele fica guardado como cópia arquivada (só administradores veem).')) {
        Acesso.cliente.rpc('camada_excluir', { p_camada: 'extra_base', p_geocod: exc.dataset.malhaExcluir }).then(function(res) {
          if (res.error) throw new Error(res.error.message);
          if (/^proposta:/.test(res.data || '')) { api.toast('Exclusão do trecho ' + exc.dataset.malhaExcluir + ' enviada para aprovação'); return; }
          api.toast('Trecho ' + exc.dataset.malhaExcluir + ' excluído (cópia guardada)');
          return recarregarExtraBase();
        }).then(abrirMalhaComplementar).catch(function(err) { api.toast(err.message, true); });
      }
      if (arq) {
        Acesso.cliente.rpc('extra_base_arquivo').then(function(res) {
          if (res.error) throw new Error(res.error.message);
          $('jtArquivo').innerHTML = '<h4 class="aprov-secao">Cópias arquivadas (' + res.data.features.length + ')</h4><div class="trc-lista">' +
            (res.data.features.length ? res.data.features.map(function(f) {
              var p = f.properties;
              return '<div class="trc-item removido"><div class="trc-texto"><b>' + esc(p.GEOCOD) + '</b> ' + (p.motivo === 'excluido' ? 'excluído' : 'versão anterior') +
                ' em ' + new Date(p.arquivado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + (p.arquivado_por ? ' por ' + esc(p.arquivado_por) : '') +
                '<span>' + esc(p.rodovia || '') + ' · ' + esc(p.trecho || '') + ' · ' + km(p.EXT_KM) + ' km</span></div>' +
                '<button type="button" class="link" data-arquivo-ver="' + encodeURIComponent(JSON.stringify(f)) + '">ver</button></div>';
            }).join('') : '<div class="vazio">Nenhuma cópia arquivada ainda.</div>') + '</div>';
        }).catch(function(err) { api.toast(err.message, true); });
      }
    };
    if (!$('jtDlgMalhaLista').open) $('jtDlgMalhaLista').showModal();
  }
  function mostrarNoMapa(f) {
    if (!f) return;
    if (destaqueMalha) map.removeLayer(destaqueMalha);
    $('jtDlgMalhaLista').close();
    destaqueMalha = L.geoJSON(f, { style: { color: '#7c3aed', weight: 8, opacity: 0.8 }, interactive: false }).addTo(map);
    api.mostrarMapa(false).then(function() { enquadrar([f]); });
    setTimeout(function() { if (destaqueMalha) { map.removeLayer(destaqueMalha); destaqueMalha = null; } }, 12000);
  }

  // Diálogos (montados uma vez, dentro da interface da jurisdição).
  function montar(raiz) {
    var d = document.createElement('div');
    d.innerHTML =
      '<dialog id="jtDlgMalha" class="dialogo"><div class="dialogo-topo"><h3>Trechos fora da malha</h3></div>' +
        '<div class="dialogo-corpo" id="jtMalhaCorpo"></div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="jtMalhaAviso"></span><div class="espaco"></div>' +
          '<button type="button" class="btn" id="jtMalhaVoltar">Voltar</button>' +
          '<button type="button" class="btn btn-primario" id="jtMalhaConfirmar"><svg><use href="#i-check"/></svg>Continuar</button></div></dialog>' +
      '<dialog id="jtDlgMalhaLista" class="dialogo"><div class="dialogo-topo"><h3>Malha complementar (extra_base)</h3><button type="button" class="btn-icone" data-jur-fechar><svg><use href="#i-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="jtMalhaListaCorpo"></div></dialog>';
    while (d.firstChild) raiz.appendChild(d.firstChild);
    raiz.querySelector('#jtDlgMalhaLista [data-jur-fechar]').addEventListener('click', function() { $('jtDlgMalhaLista').close(); });
  }

  return {
    montar: montar, render: render, encerrar: encerrar, ativo: function() { return modo; },
    descrever: descrever, conferirForaDaMalha: conferirForaDaMalha, abrirMalhaComplementar: abrirMalhaComplementar
  };
})();
