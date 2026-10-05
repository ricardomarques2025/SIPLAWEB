// --- UNIDADES DE SAÚDE ---
// Registros de data/DADOS.json com UNIDADE = HOSPITAL, posicionados pela
// localidade (campo LOCALIDADE comparado a NOME_ACEN de data/localidades.geojson).
// Cada unidade gera um círculo de 80 km de raio, colorido pela categoria do
// campo INTERVENCAO. Unidades da mesma localidade e categoria compartilham um
// único círculo; o clique lista todas as unidades cujo raio alcança o ponto.
(function() {
  var RAIO_METROS = ESTILO_UNIDADES_SAUDE.raioMetros;
  var CATEGORIAS = ESTILO_UNIDADES_SAUDE.categorias;
  var ORDEM_CATEGORIAS = Object.keys(CATEGORIAS);

  var unidades = [];
  var camada = null;
  var camadaAtiva = false;
  var carregamento = null;

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function escaparHtml(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Qualquer INTERVENCAO contendo "Hospital" é tratada como Hospital.
  function categoriaIntervencao(intervencao) {
    var texto = normalizar(intervencao);
    if (texto.indexOf('hospital') !== -1) return 'hospital';
    if (texto.indexOf('policlinica') !== -1) {
      return texto.indexOf('construcao') !== -1 ? 'policlinica_construcao' : 'policlinica';
    }
    if (texto.indexOf('proposta') !== -1) return 'proposta';
    return null;
  }

  // Com nomes repetidos, prefere a localidade que é sede do município de mesmo nome.
  function coordenadaLocalidade(indice, nomeLocalidade) {
    var nome = normalizar(nomeLocalidade);
    var candidatas = indice[nome] || [];
    if (!candidatas.length) return null;
    var escolhida = candidatas.filter(function(f) {
      return normalizar(f.properties && f.properties.NM_MUN) === nome;
    })[0] || candidatas[0];
    var geom = escolhida.geometry;
    if (!geom || !geom.coordinates) return null;
    var coords = geom.type === 'MultiPoint' ? geom.coordinates[0] : geom.coordinates;
    return coords && coords.length >= 2 ? L.latLng(Number(coords[1]), Number(coords[0])) : null;
  }

  function carregar() {
    if (carregamento) return carregamento;
    carregamento = Promise.all([
      fetch('data/DADOS.json').then(function(r) { return r.json(); }),
      fetch('data/localidades.geojson').then(function(r) { return r.json(); })
    ]).then(function(resultado) {
      var registros = Array.isArray(resultado[0]) ? resultado[0] : [];
      var indice = {};
      ((resultado[1] && resultado[1].features) || []).forEach(function(f) {
        var nome = normalizar(f.properties && f.properties.NOME_ACEN);
        if (!nome) return;
        (indice[nome] = indice[nome] || []).push(f);
      });

      unidades = [];
      registros.forEach(function(item) {
        if (normalizar(item && item.UNIDADE) !== 'hospital') return;
        var categoria = categoriaIntervencao(item.INTERVENCAO);
        if (!categoria) {
          console.warn('Unidade de saúde com INTERVENCAO não classificada:', item.IDCOD, item.INTERVENCAO);
          return;
        }
        var latlng = coordenadaLocalidade(indice, item.LOCALIDADE);
        if (!latlng) {
          console.warn('Unidade de saúde sem localidade correspondente:', item.IDCOD, item.LOCALIDADE);
          return;
        }
        unidades.push({ dados: item, categoria: categoria, latlng: latlng });
      });
      console.log('Unidades de Saúde carregadas:', unidades.length);
      return unidades;
    }).catch(function(e) {
      console.warn('Falha ao carregar Unidades de Saúde:', e);
      carregamento = null;
      return [];
    });
    return carregamento;
  }

  function categoriasSelecionadas() {
    var marcadas = Array.from(document.querySelectorAll('#unidadesSaudeSelectLista input:checked'))
      .map(function(input) { return input.value; });
    return marcadas.length ? marcadas : ORDEM_CATEGORIAS.slice();
  }

  function unidadesFiltradas() {
    var categorias = categoriasSelecionadas();
    return unidades.filter(function(u) { return categorias.indexOf(u.categoria) !== -1; });
  }

  // Zoom da lista completa isola uma unidade (só o círculo dela fica no mapa) até o Voltar.
  var unidadeIsolada = null;

  function unidadesVisiveis() {
    return unidadeIsolada ? [unidadeIsolada] : unidadesFiltradas();
  }

  function unidadesNoPonto(latlng) {
    return unidadesVisiveis()
      .map(function(u) { return { unidade: u, distancia: map.distance(latlng, u.latlng) }; })
      .filter(function(p) { return p.distancia <= RAIO_METROS; })
      .sort(function(a, b) {
        var ordem = ORDEM_CATEGORIAS.indexOf(a.unidade.categoria) - ORDEM_CATEGORIAS.indexOf(b.unidade.categoria);
        return ordem || a.distancia - b.distancia;
      });
  }

  function conteudoPopup(proximas) {
    var html = '<div class="popup-unidades-saude"><b>Unidades de Saúde (' + proximas.length + ')</b>' +
      '<div class="popup-unidades-saude-sub">Raio de ' + (RAIO_METROS / 1000) + ' km a partir do ponto clicado</div>';
    proximas.forEach(function(p) {
      var u = p.unidade;
      var estilo = CATEGORIAS[u.categoria];
      html += '<div class="popup-unidade-saude">' +
        '<span class="popup-unidade-saude-cor" style="background:' + estilo.cor + '"></span>' +
        '<div><b>' + escaparHtml(u.dados.DESCRICAO || '-') + '</b><br>' +
        escaparHtml(u.dados.INTERVENCAO || '') + '<br>' +
        'Localidade: ' + escaparHtml(u.dados.LOCALIDADE || '-') + '<br>' +
        'Distância: ' + (p.distancia / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km' +
        '</div></div>';
    });
    return html + '</div>';
  }

  // --- Painel inferior (Detalhes da seleção) ---
  // Reaproveita as tabelas de js/mapa.js: tabela do clique com as unidades
  // do círculo clicado marcadas, "Mostrar todos registros" com Zoom por linha.
  var CAMPOS_PAINEL = [
    { chave: 'CATEGORIA', rotulo: 'Categoria' },
    { chave: 'DESCRICAO', rotulo: 'Descrição' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' },
    { chave: 'LOCALIDADE', rotulo: 'Localidade' },
    { chave: 'POPULACAO_2026', rotulo: 'População 2026' },
    { chave: 'DISTANCIA_KM', rotulo: 'Distância do clique (km)' },
    { chave: 'IDCOD', rotulo: 'IDCOD' }
  ];
  var idsSelecionados = [];
  var unidadesPorZoomId = {};

  function registroPainel(u, distancia) {
    var populacao = Number(u.dados.POPULACAO_2026);
    // A ordem das chaves define a ordem das colunas na lista completa.
    var registro = {
      CATEGORIA: CATEGORIAS[u.categoria].rotulo,
      DESCRICAO: u.dados.DESCRICAO,
      INTERVENCAO: u.dados.INTERVENCAO,
      LOCALIDADE: u.dados.LOCALIDADE,
      POPULACAO_2026: isFinite(populacao) && u.dados.POPULACAO_2026 !== null && u.dados.POPULACAO_2026 !== '' ? populacao.toLocaleString('pt-BR') : '',
      IDCOD: u.dados.IDCOD
    };
    if (distancia !== undefined) {
      registro.DISTANCIA_KM = (distancia / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    }
    return registro;
  }

  // Polígono do círculo de 80 km, usado pelo Zoom da tabela completa (enquadra e pisca o círculo).
  function featureCirculo(u) {
    var pontos = [];
    var latRad = u.latlng.lat * Math.PI / 180;
    var grausLat = RAIO_METROS / 111320;
    var grausLng = RAIO_METROS / (111320 * Math.cos(latRad));
    for (var i = 0; i <= 64; i++) {
      var ang = 2 * Math.PI * i / 64;
      pontos.push([u.latlng.lng + grausLng * Math.cos(ang), u.latlng.lat + grausLat * Math.sin(ang)]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pontos] } };
  }

  function atualizarPainel(proximas, unidadesCirculoClicado) {
    var painel = document.getElementById('painelTabelaConteudo');
    if (!painel) return;
    idsSelecionados = proximas.map(function(p) { return String(p.unidade.dados.IDCOD); });
    var registros = proximas.map(function(p) {
      var registro = registroPainel(p.unidade, p.distancia);
      if (unidadesCirculoClicado.indexOf(p.unidade) !== -1) registro.__SELECIONADO_GRUPO = true;
      return registro;
    });
    var html = tabelaRegistrosHtml('Unidades de Saúde no ponto clicado (' + registros.length + ')', registros, CAMPOS_PAINEL);
    html += '<div class="painel-tabela-acoes">' +
      '<button type="button" class="btn-tabela-acao" data-lista-unidades-saude="1">Mostrar todos registros</button>' +
      '<span class="painel-tabela-info">Em destaque: unidades do círculo clicado.</span>' +
      '</div>';
    painel.innerHTML = html;
  }

  function renderizarListaCompleta() {
    var painel = document.getElementById('painelTabelaConteudo');
    htmlPainelAntesListaCompleta = painel.innerHTML;
    limparDestaqueTabelaCompleta();
    registrosZoomTabelaCompleta = [];
    unidadesPorZoomId = {};
    var ordenadas = unidadesFiltradas().slice().sort(function(a, b) {
      return ORDEM_CATEGORIAS.indexOf(a.categoria) - ORDEM_CATEGORIAS.indexOf(b.categoria) ||
        String(a.dados.LOCALIDADE).localeCompare(String(b.dados.LOCALIDADE), 'pt-BR');
    });
    var selecionadas = {};
    var registros = ordenadas.map(function(u) {
      var registro = prepararRegistroListaCompleta(registroPainel(u), '', featureCirculo(u), 'saude');
      unidadesPorZoomId[registro.__ZOOM_ID] = u;
      if (idsSelecionados.indexOf(String(u.dados.IDCOD)) !== -1) selecionadas[registro.__ZOOM_ID] = true;
      return registro;
    });
    var html = '<div class="painel-tabela-acoes">' +
      '<button type="button" class="btn-tabela-acao" data-voltar-lista-filtrada="1">Voltar</button>' +
      '<span class="painel-tabela-info">Em destaque: unidades do ponto clicado. Zoom isola a unidade; Voltar restaura.</span>' +
      '<span data-lista-unidades-saude-aberta hidden></span>' +
      '</div>';
    html += registros.length
      ? tabelaRegistrosComZoomHtml('Unidades de Saúde (' + registros.length + ')', registros, [])
      : '<em>Nenhuma unidade de saúde com o filtro atual.</em>';
    painel.innerHTML = html;
    painel.querySelectorAll('.tabela-lista-filtrada tr[data-linha-zoom]').forEach(function(linha) {
      if (selecionadas[linha.getAttribute('data-linha-zoom')]) linha.classList.add('linha-selecionada-grupo');
    });
  }

  function renderizarLegenda(categoriasDesenhadas) {
    var bloco = document.getElementById('blocoLegendaUnidadesSaude');
    var alvo = document.getElementById('legendaUnidadesSaude');
    if (!bloco || !alvo) return;
    alvo.innerHTML = '';
    if (!categoriasDesenhadas.length) {
      bloco.style.display = 'none';
      return;
    }
    ORDEM_CATEGORIAS.forEach(function(categoria) {
      if (categoriasDesenhadas.indexOf(categoria) === -1) return;
      var estilo = CATEGORIAS[categoria];
      var div = document.createElement('div');
      div.className = 'legenda-item';
      div.innerHTML = '<span class="legenda-unidade-saude-amostra" style="border-color:' + estilo.cor +
        ';background:' + estilo.cor + '"></span><div class="legenda-texto">' + estilo.rotulo + '</div>';
      alvo.appendChild(div);
    });
    bloco.style.display = '';
  }

  function desenhar() {
    if (camada) { map.removeLayer(camada); camada = null; }
    var botao = document.getElementById('toggleUnidadesSaude');
    if (botao) {
      botao.classList.toggle('ativo-filtro', camadaAtiva);
      botao.setAttribute('aria-pressed', camadaAtiva ? 'true' : 'false');
    }
    if (!camadaAtiva) { renderizarLegenda([]); return; }

    carregar().then(function() {
      if (!camadaAtiva) return;
      if (camada) { map.removeLayer(camada); camada = null; }
      camada = L.layerGroup();
      var desenhados = {};
      var categoriasDesenhadas = [];
      // Proposta por baixo, Hospital por cima.
      unidadesVisiveis().slice().sort(function(a, b) {
        return ORDEM_CATEGORIAS.indexOf(b.categoria) - ORDEM_CATEGORIAS.indexOf(a.categoria);
      }).forEach(function(u) {
        var chave = u.categoria + '|' + u.latlng.lat + '|' + u.latlng.lng;
        if (desenhados[chave]) { desenhados[chave].push(u); return; }
        var doCirculo = desenhados[chave] = [u];
        if (categoriasDesenhadas.indexOf(u.categoria) === -1) categoriasDesenhadas.push(u.categoria);
        var estilo = CATEGORIAS[u.categoria];
        var circulo = L.circle(u.latlng, {
          pane: 'unidadesSaudePane',
          radius: RAIO_METROS,
          color: estilo.cor,
          weight: ESTILO_UNIDADES_SAUDE.espessura,
          opacity: ESTILO_UNIDADES_SAUDE.opacidadeContorno,
          fillColor: estilo.cor,
          fillOpacity: ESTILO_UNIDADES_SAUDE.opacidadePreenchimento
        });
        circulo.on('click', function(e) {
          var proximas = unidadesNoPonto(e.latlng);
          L.popup({ maxWidth: 380, maxHeight: 360 })
            .setLatLng(e.latlng)
            .setContent(conteudoPopup(proximas))
            .openOn(map);
          // Com uma unidade isolada, o painel mantém a lista completa (e o Voltar).
          if (!unidadeIsolada) atualizarPainel(proximas, doCirculo);
        });
        camada.addLayer(circulo);
      });
      camada.addTo(map);
      renderizarLegenda(categoriasDesenhadas);
    });
  }

  function prepararFiltro() {
    var lista = document.getElementById('unidadesSaudeSelectLista');
    if (!lista) return;
    lista.replaceChildren();
    ORDEM_CATEGORIAS.forEach(function(categoria) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = categoria;
      input.addEventListener('change', function() {
        unidadeIsolada = null;
        // Selecionar uma categoria liga a camada automaticamente.
        if (input.checked) camadaAtiva = true;
        desenhar();
      });
      label.append(input, document.createTextNode(CATEGORIAS[categoria].rotulo));
      lista.appendChild(label);
    });
  }

  function limparFiltro() {
    document.querySelectorAll('#unidadesSaudeSelectLista input').forEach(function(input) {
      input.checked = false;
    });
  }

  function desligar() {
    unidadeIsolada = null;
    camadaAtiva = false;
    limparFiltro();
    desenhar();
  }

  prepararFiltro();

  // Enquadramento e piscada do Zoom, e o retorno do Voltar, são tratados pelo painel em js/mapa.js;
  // aqui só se isola a unidade no mapa e se restaura a camada.
  var painelConteudo = document.getElementById('painelTabelaConteudo');
  painelConteudo.addEventListener('click', function(e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-lista-unidades-saude]')) { renderizarListaCompleta(); return; }
    var listaAberta = painelConteudo.querySelector('[data-lista-unidades-saude-aberta]');
    var alvoZoom = e.target.closest('[data-zoom-registro]');
    if (alvoZoom && listaAberta) {
      unidadeIsolada = unidadesPorZoomId[alvoZoom.getAttribute('data-zoom-registro')] || null;
      map.closePopup();
      desenhar();
      return;
    }
    if (e.target.closest('[data-voltar-lista-filtrada]') && unidadeIsolada) {
      unidadeIsolada = null;
      desenhar();
    }
  }, true);

  // Se o painel deixar de mostrar a lista (clique em outra camada etc.), a camada volta ao normal.
  new MutationObserver(function() {
    if (unidadeIsolada && !painelConteudo.querySelector('[data-lista-unidades-saude-aberta]')) {
      unidadeIsolada = null;
      desenhar();
    }
  }).observe(painelConteudo, { childList: true });

  document.getElementById('unidadesSaudeSelectLimpar').addEventListener('click', function() {
    unidadeIsolada = null;
    limparFiltro();
    desenhar();
  });

  document.getElementById('toggleUnidadesSaude').addEventListener('click', function() {
    unidadeIsolada = null;
    camadaAtiva = !camadaAtiva;
    desenhar();
  });

  // A camada começa desligada; "Desligar Tudo" e "Ligar Tudo / Limpar" voltam a esse estado.
  document.getElementById('desligarTudo').addEventListener('click', desligar);
  document.getElementById('limparFiltro').addEventListener('click', desligar);
})();
