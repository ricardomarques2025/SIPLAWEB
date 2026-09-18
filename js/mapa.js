var map = L.map('map', {
  zoomControl: false,
  zoomSnap: 0.1,
  zoomDelta: 0.1
}).setView([-15.8, -49.0], 7);
var originalCenter = map.getCenter();
var originalZoom = map.getZoom();

// Conexão direta com o Supabase (banco-gis) para as tabelas de dados de
// negócio (dados/obras_links). Chave pública (anon) — leitura apenas, RLS
// no banco restringe a SELECT. Alterações feitas direto no Supabase pelo
// GOINFRA refletem no site publicado sem precisar reexportar arquivos.
var SUPABASE_URL = 'https://ctukaanelcsevdmoqlys.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0dWthYW5lbGNzZXZkbW9xbHlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDE0NTIsImV4cCI6MjEwMjcxNzQ1Mn0.WgEoQ4FEGTOuTrWtDN07eGc6huKWP5QD7Bt44GPeq4o';

// Busca todas as linhas de uma tabela do Supabase via REST, paginando em
// blocos de 1000 (limite padrão do PostgREST) até esgotar os registros.
function carregarTabelaSupabase(tabela) {
  var PAGE_SIZE = 1000;
  function buscarPagina(offset, acumulado) {
    var inicio = offset;
    var fim = offset + PAGE_SIZE - 1;
    return fetch(SUPABASE_URL + '/rest/v1/' + tabela + '?select=*', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        Range: inicio + '-' + fim
      }
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' em tabela Supabase ' + tabela);
      return r.json().then(function(pagina) {
        var todos = acumulado.concat(pagina);
        if (pagina.length < PAGE_SIZE) return todos;
        return buscarPagina(offset + PAGE_SIZE, todos);
      });
    });
  }
  return buscarPagina(0, []).catch(function(e) {
    console.warn('Falha ao carregar tabela Supabase:', tabela, e);
    return [];
  });
}

// Registra um acesso ao site via RPC (função SECURITY DEFINER, sem grant de
// escrita direta às tabelas para a chave anon). Qualquer escrita no banco
// conta como atividade para o Supabase não pausar o projeto por
// inatividade (o plano gratuito pausa após 7 dias sem uso). Falha aqui
// nunca deve afetar o carregamento do mapa.
function registrarAcessoSupabase() {
  fetch(SUPABASE_URL + '/rest/v1/rpc/registrar_acesso', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: '{}'
  }).catch(function(e) {
    console.warn('Falha ao registrar acesso no Supabase:', e);
  });
}
registrarAcessoSupabase();

// Botão "Atualizar site": força o navegador a buscar novamente o mapa.html
// (ignorando o cache local), o que também garante que a busca dos dados de
// negócio no Supabase (dados/obras_links) e das camadas seja refeita do
// zero. Combinado com o parâmetro "?v=" nos scripts/estilos (bumped a cada
// alteração de código), isso garante que qualquer usuário sempre veja a
// versão mais recente do site sem precisar saber o atalho de hard refresh.
(function() {
  var btn = document.getElementById('btnAtualizarSite');
  if (!btn) return;
  btn.addEventListener('click', function() {
    var limpezaCaches = ('caches' in window)
      ? caches.keys().then(function(chaves) {
          return Promise.all(chaves.map(function(chave) { return caches.delete(chave); }));
        }).catch(function() {})
      : Promise.resolve();
    limpezaCaches.then(function() {
      var url = new URL(location.href);
      url.searchParams.set('_atualizar', Date.now());
      location.replace(url.toString());
    });
  });
})();

// CONFIGURACOES DOS ICONES DE AERODROMOS E AEROPORTOS.
// Altere os tamanhos em pixels ou os arquivos SVG aqui.
var CONFIG_AERO = {
  zoomMinimo: 8,
  aerodromo: {
    tamanho: 25,
    icone: 'data/aerodromo.svg'
  },
  aeroporto: {
    tamanho: 30,
    icone: 'data/aeroporto.svg'
  }
};

function criarPanesMapa() {
  Object.keys(MAPA_PANES).forEach(function(nomePane) {
    map.createPane(nomePane);
    map.getPane(nomePane).style.zIndex = MAPA_PANES[nomePane];
  });
}

criarPanesMapa();

var hoverIconeIntervencaoAtivo = 0;

function alvoHoverIconeIntervencao(el) {
  return el && el.closest && el.closest('.obra-ponto-icon, .obras-pontos-cluster, .marker-cluster');
}

function atualizarPrimeiroPlanoIconesIntervencao(ativo) {
  var pane = map.getPane('oaePane');
  if (!pane) return;
  pane.style.zIndex = ativo ? 1300 : MAPA_PANES.oaePane;
}

map.getContainer().addEventListener('mouseover', function(e) {
  if (!alvoHoverIconeIntervencao(e.target)) return;
  hoverIconeIntervencaoAtivo++;
  atualizarPrimeiroPlanoIconesIntervencao(true);
}, true);

map.getContainer().addEventListener('mouseout', function(e) {
  var alvo = alvoHoverIconeIntervencao(e.target);
  if (!alvo) return;
  if (e.relatedTarget && alvo.contains(e.relatedTarget)) return;
  hoverIconeIntervencaoAtivo = Math.max(0, hoverIconeIntervencaoAtivo - 1);
  if (!hoverIconeIntervencaoAtivo) atualizarPrimeiroPlanoIconesIntervencao(false);
}, true);

function criarMapasBase() {
  var mapas = {};
  var mapaInicial = null;

  Object.keys(MAPAS_BASE_CONFIG).forEach(function(nome) {
    var config = MAPAS_BASE_CONFIG[nome];
    var camada = L.tileLayer(config.url, config.opcoes);
    mapas[nome] = camada;
    if (config.inicial) mapaInicial = camada;
  });

  if (mapaInicial) mapaInicial.addTo(map);
  return mapas;
}

// --- MÁSCARA DO BRASIL (Brasil menos Goiás) ---
var mascaraBrasilData = null;
var mascaraBrasilLayer = null;

function desenharMascaraBrasil() {
  if (!mascaraBrasilData) return;
  if (mascaraBrasilLayer) map.removeLayer(mascaraBrasilLayer);

  var municipioSelecionado = document.getElementById('municipioSelect') ? document.getElementById('municipioSelect').value : '';
  var filtroEspacialSelecionado = !!(municipioSelecionado || temFiltroGeografico());
  var corMascara = filtroEspacialSelecionado ? '#d9d9d9' : '#808080';

  mascaraBrasilLayer = L.geoJSON(mascaraBrasilData, {
    pane: 'limitesBasePane',
    style: {
      color: corMascara,
      weight: 1,
      fillColor: corMascara,
      fillOpacity: filtroEspacialSelecionado ? 1 : 0.25
    },
    interactive: false
  }).addTo(map);
}
// --- FIM MÁSCARA ---

// controle para trocar a base
const mapasBase = criarMapasBase();

L.control.layers(mapasBase, null, {
  position: 'topleft',
  collapsed: true
}).addTo(map);

// ---- CONTROLE DE ZOOM POR VALOR ----
var ZoomValorControl = L.Control.extend({
  options: {
    position: 'topleft'
  },

  onAdd: function(map) {
    var container = L.DomUtil.create('div', 'leaflet-bar zoom-valor-control');
    var label = L.DomUtil.create('label', '', container);

    label.title = 'Definir zoom';
    label.appendChild(document.createTextNode('Zoom'));
    var input = L.DomUtil.create('input', '', label);
    input.type = 'number';
    input.min = map.getMinZoom();
    input.max = map.getMaxZoom();
    input.step = '0.1';
    input.value = map.getZoom();

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    function atualizarCampo() {
      input.value = Number(map.getZoom().toFixed(1));
    }

    function aplicarZoom() {
      var valor = parseFloat(input.value);
      if (!isFinite(valor)) {
        atualizarCampo();
        return;
      }
      var minZoom = map.getMinZoom();
      var maxZoom = map.getMaxZoom();
      map.setZoom(Math.max(minZoom, Math.min(maxZoom, valor)));
    }

    L.DomEvent.on(input, 'change', aplicarZoom);
    L.DomEvent.on(input, 'keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        aplicarZoom();
        input.blur();
      }
    });
    map.on('zoomend', atualizarCampo);

    return container;
  }
});

map.addControl(new ZoomValorControl());

// ---- FERRAMENTA DE MEDIÇÃO ----
var medicaoAtiva = false;
var medicaoPontos = [];
var medicaoLayer = L.layerGroup().addTo(map);
var medicaoLinha = null;
var medicaoTooltip = null;
var medicaoBotao = null;

function formatarDistanciaMedicao(metros) {
  if (!isFinite(metros)) return '0 m';
  if (metros >= 1000) return (metros / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' km';
  return metros.toLocaleString('pt-BR', {
    maximumFractionDigits: 0
  }) + ' m';
}

function distanciaTotalMedicao(pontos) {
  var total = 0;
  for (var i = 1; i < pontos.length; i++) {
    total += pontos[i - 1].distanceTo(pontos[i]);
  }
  return total;
}

function atualizarBotaoMedicao() {
  if (medicaoBotao) medicaoBotao.classList.toggle('ativo', medicaoAtiva);
}

function limparMedicao() {
  medicaoPontos = [];
  medicaoLayer.clearLayers();
  medicaoLinha = null;
  medicaoTooltip = null;
}

function atualizarDesenhoMedicao(pontoPreview) {
  var pontosLinha = medicaoPontos.slice();
  if (pontoPreview && pontosLinha.length) pontosLinha.push(pontoPreview);

  if (medicaoLinha) medicaoLayer.removeLayer(medicaoLinha);
  if (pontosLinha.length > 1) {
    medicaoLinha = L.polyline(pontosLinha, {
      pane: 'medicaoPane',
      color: '#111827',
      weight: 3,
      opacity: 0.95,
      dashArray: '8,6'
    }).addTo(medicaoLayer);
  }

  if (medicaoTooltip) medicaoLayer.removeLayer(medicaoTooltip);
  if (pontosLinha.length) {
    var total = distanciaTotalMedicao(pontosLinha);
    var texto = formatarDistanciaMedicao(total);
    medicaoTooltip = L.marker(pontosLinha[pontosLinha.length - 1], {
      pane: 'medicaoPane',
      interactive: false,
      icon: L.divIcon({
        className: 'medicao-tooltip-icon',
        html: '<span class="medicao-tooltip">' + texto + '</span>',
        iconSize: [1, 1],
        iconAnchor: [0, 0]
      })
    }).addTo(medicaoLayer);
  }
}

function finalizarMedicao() {
  medicaoAtiva = false;
  map.dragging.enable();
  map.doubleClickZoom.enable();
  atualizarBotaoMedicao();
  atualizarDesenhoMedicao();
}

function alternarMedicao() {
  medicaoAtiva = !medicaoAtiva;
  atualizarBotaoMedicao();

  if (medicaoAtiva) {
    if (typeof anotacaoFerramenta !== 'undefined' && anotacaoFerramenta) {
      ativarFerramentaAnotacao(anotacaoFerramenta);
    }
    limparMedicao();
    map.dragging.disable();
    map.doubleClickZoom.disable();
  } else {
    finalizarMedicao();
  }
}

function adicionarPontoMedicao(e) {
  if (!medicaoAtiva) return;
  if (e.originalEvent) {
    L.DomEvent.preventDefault(e.originalEvent);
    L.DomEvent.stopPropagation(e.originalEvent);
  }
  if (e.originalEvent && e.originalEvent.detail >= 2) {
    finalizarMedicao();
    return;
  }

  medicaoPontos.push(e.latlng);
  L.circleMarker(e.latlng, {
    pane: 'medicaoPane',
    radius: 4,
    color: '#111827',
    weight: 2,
    fillColor: '#ffffff',
    fillOpacity: 1
  }).addTo(medicaoLayer);
  atualizarDesenhoMedicao();
  if (medicaoPontos.length >= 2) finalizarMedicao();
}

function previewMedicao(e) {
  if (!medicaoAtiva || !medicaoPontos.length) return;
  atualizarDesenhoMedicao(e.latlng);
}

var MedicaoControl = L.Control.extend({
  options: {
    position: 'topleft'
  },

  onAdd: function(map) {
    var container = L.DomUtil.create('div', 'leaflet-bar medicao-control');
    medicaoBotao = L.DomUtil.create('button', 'medicao-btn', container);
    medicaoBotao.type = 'button';
    medicaoBotao.title = 'Medir distância';
    medicaoBotao.textContent = 'Régua';

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(medicaoBotao, 'click', function(e) {
      L.DomEvent.preventDefault(e);
      alternarMedicao();
    });

    return container;
  }
});

map.addControl(new MedicaoControl());
map.on('click', adicionarPontoMedicao);
map.on('mousemove', previewMedicao);
map.on('dblclick', function(e) {
  if (!medicaoAtiva) return;
  if (e.originalEvent) {
    L.DomEvent.preventDefault(e.originalEvent);
    L.DomEvent.stopPropagation(e.originalEvent);
  }
  finalizarMedicao();
});
map.getContainer().addEventListener('contextmenu', function(e) {
  if (!medicaoAtiva) return;
  e.preventDefault();
  e.stopPropagation();
  finalizarMedicao();
}, true);

// ---- ESCALA GRÁFICA DINÂMICA ----
L.control.scale({
  position: 'bottomleft',
  maxWidth: 200,
  metric: true,
  imperial: false,
  updateWhenIdle: false
}).addTo(map);

// ---- SÍMBOLO DE NORTE (ROSA DOS VENTOS) ----
var NortheArrowControl = L.Control.extend({
  options: {
    position: 'bottomleft'
  },

  onAdd: function(map) {
    var container = L.DomUtil.create('div', 'north-arrow-control');
    
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 120');
    svg.setAttribute('width', '45');
    svg.setAttribute('height', '53');
    
    var backgroundCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    backgroundCircle.setAttribute('cx', '50');
    backgroundCircle.setAttribute('cy', '60');
    backgroundCircle.setAttribute('r', '46');
    backgroundCircle.setAttribute('fill', 'rgba(255, 255, 255, 0.82)');
    
    // Triângulo principal (norte) - preenchido
    var mainTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    mainTriangle.setAttribute('points', '50,35 78,91 50,72 22,91');
    mainTriangle.setAttribute('fill', '#1f2937');
    
    // Letra "N" no topo da seta
    var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '50');
    text.setAttribute('y', '32');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '43');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', '#1f2937');
    text.textContent = 'N';
    
    svg.appendChild(backgroundCircle);
    svg.appendChild(mainTriangle);
    svg.appendChild(text);
    
    container.appendChild(svg);
    
    L.DomEvent.disableClickPropagation(container);
    
    return container;
  }
});

map.addControl(new NortheArrowControl());

// ---- LOGO INSTITUCIONAL NO MAPA ----
var LogoMapaControl = L.Control.extend({
  options: {
    position: 'topright'
  },

  onAdd: function(map) {
    var container = L.DomUtil.create('div', 'logo-mapa-control');
    var img = L.DomUtil.create('img', '', container);
    img.src = 'data/Logo_GOINFRA_DPL_2025.png';
    img.alt = 'GOINFRA DPL Governo de Goiás';

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  }
});

map.addControl(new LogoMapaControl());

  map.on('zoomend', function() {
    atualizarVisibilidadeRotulos();
    atualizarVisibilidadeRotulosSRE();
    atualizarVisibilidadeRotulosObras();
    atualizarVisibilidadeIconesAeroObras();
    desenharAero();
  });

  var municipiosData = null;
  var localidadesData = null;
  var areasAmbientaisData = null;
  var areasUrbanasData = null;
  var areaInfluenciaData = null;
  var bufferData = { type: 'FeatureCollection', features: [] };
  var bufferLayer = null;
  var bufferFiltroAtivo = false;
  var ferroviasData = null;
  var ferroviasLayer = null;
  var ferroviasFiltroAtivo = false;
  var sreBaseData = null;
  var sreBaseCoincidenciasIndex = null;
  var extraBaseData = null;
  var sreData = null;
  var obrasPontosData = null;
  var obrasPontosBaseData = null;
  var obrasPontosCoordenadasData = null;
  var aeroData = null;
  var aeroObrasData = null;
  var oaeData = null;
  var estadosData = null;
  var snvData = null;
  var alteracoesData = null;
  var alteracoesTabelaData = [];
  var alteracoesPorId = {};

  var estadosLayer = null;
  var municipiosLayer = null;
  var localidadesLayer = null;
  var areasAmbientaisLayer = null;
  var areasUrbanasLayer = null;
  var areaInfluenciaLayer = null;
  var sreBaseLayer = null;
  var sreBaseLabelLayer = null;
  var snvLabelLayer = null;
  var obrasPontosLayer = null;
  var aeroLayer = null;
  var aeroObrasIconLayer = null;
  var aeroObrasClusterRefs = [];
  var oaeLayer = null;
  var snvLayer = null;
  var obrasLabelLayer = null;
  var regraLayers = [];
  var alteracoesLayer = null;
  var rotulosObrasPrintAtivos = false;
  var registrosZoomTabelaCompleta = [];
  var destaqueTabelaCompletaLayer = null;
  var htmlPainelAntesListaCompleta = '';
  var destaqueCliqueLayer = null;
  var destaqueCliqueTimerId = null;

  var programaAtivo = '';
  var programas = [];

    var servicosAtivos = {
      FUNDEINFRA: true,
      DOR: true,
      DMA: true,
      DPJ: true,
      DPL: true,
      DOC: true,
      DSV: true
    };
    var servicoFiltroAtivo = '';

    var TIPOS_ALTERACAO = [
      'Estadualiza\u00e7\u00e3o',
      'Federaliza\u00e7\u00e3o',
      'Municipaliza\u00e7\u00e3o'
    ];
    var alteracoesAtivas = {};
    var alteracoesReferenciaAtiva = true;
    for (var iAltInicial = 0; iAltInicial < TIPOS_ALTERACAO.length; iAltInicial++) {
      alteracoesAtivas[TIPOS_ALTERACAO[iAltInicial]] = true;
    }

  var anotacoesLayer = L.featureGroup().addTo(map);
  var anotacoesHistorico = [];
  var anotacaoFerramenta = null;
  var anotacaoInicio = null;
  var anotacaoPreview = null;
  var anotacaoMedicaoTooltip = null;
  var anotacaoMedicaoPontosPreview = [];
  var anotacaoLinhaPontos = [];
  var anotacaoMedicaoFormaModo = null;
  var legendaAnotacoesAtiva = false;
  var ANOTACOES_STORAGE_KEY = 'mapa_pop2_anotacoes_v1';
  var estiloAnotacao = Object.assign({}, ESTILO_ANOTACAO_PADRAO);
  var estiloTextoAnotacao = Object.assign({}, ESTILO_TEXTO_ANOTACAO_PADRAO);
  var estiloPontoAnotacao = Object.assign({}, ESTILO_PONTO_ANOTACAO_PADRAO);

  function setStatusAnotacao(texto) {
    var status = document.getElementById('drawStatus');
    if (status) status.textContent = texto;
  }

  function valorCampo(id, padrao) {
    var campo = document.getElementById(id);
    return campo && campo.value ? campo.value : padrao;
  }

  function lerEstiloFormaAnotacao() {
    var cor = valorCampo('drawCorLinha', estiloAnotacao.color);
    var espessura = parseInt(valorCampo('drawEspessuraLinha', estiloAnotacao.weight), 10);
    var opacidadePreenchimento = parseInt(valorCampo('drawOpacidadePreenchimento', estiloAnotacao.fillOpacity * 100), 10);
    if (!isFinite(espessura)) espessura = estiloAnotacao.weight;
    if (!isFinite(opacidadePreenchimento)) opacidadePreenchimento = estiloAnotacao.fillOpacity * 100;
    return {
      pane: 'anotacoesPane',
      color: cor,
      weight: Math.max(1, Math.min(12, espessura)),
      opacity: 0.95,
      fillColor: cor,
      fillOpacity: Math.max(0, Math.min(100, opacidadePreenchimento)) / 100
    };
  }

  function lerEstiloTextoAnotacao() {
    var tamanho = parseInt(valorCampo('drawTamanhoTexto', estiloTextoAnotacao.tamanho), 10);
    if (!isFinite(tamanho)) tamanho = estiloTextoAnotacao.tamanho;
    return {
      cor: valorCampo('drawCorTexto', estiloTextoAnotacao.cor),
      tamanho: Math.max(8, Math.min(36, tamanho))
    };
  }

  function lerEstiloPontoAnotacao() {
    var tamanho = parseInt(valorCampo('drawTamanhoPonto', estiloPontoAnotacao.tamanho), 10);
    if (!isFinite(tamanho)) tamanho = estiloPontoAnotacao.tamanho;
    return {
      formato: valorCampo('drawFormatoPonto', estiloPontoAnotacao.formato),
      tamanho: Math.max(6, Math.min(34, tamanho))
    };
  }

  function atualizarIndicadoresEstiloAnotacao() {
    var espessuraValor = document.getElementById('drawEspessuraValor');
    var opacidadeValor = document.getElementById('drawOpacidadeValor');
    var tamanhoPontoValor = document.getElementById('drawTamanhoPontoValor');
    var tamanhoValor = document.getElementById('drawTamanhoTextoValor');
    var estiloForma = lerEstiloFormaAnotacao();
    if (espessuraValor) espessuraValor.textContent = estiloForma.weight + ' px';
    if (opacidadeValor) opacidadeValor.textContent = Math.round(estiloForma.fillOpacity * 100) + '%';
    if (tamanhoPontoValor) tamanhoPontoValor.textContent = lerEstiloPontoAnotacao().tamanho + ' px';
    if (tamanhoValor) tamanhoValor.textContent = lerEstiloTextoAnotacao().tamanho + ' px';
  }

  function estiloFormaPorProps(props) {
    return Object.assign({}, estiloAnotacao, props && props.estilo ? props.estilo : {});
  }

  function estiloTextoPorProps(props) {
    return Object.assign({}, estiloTextoAnotacao, props && props.estiloTexto ? props.estiloTexto : {});
  }

  function estiloPontoPorProps(props) {
    return Object.assign({}, estiloPontoAnotacao, props && props.estiloPonto ? props.estiloPonto : {});
  }

  function estiloFormaDaCamada(layer) {
    var opcoes = layer.options || {};
    return {
      color: opcoes.color || estiloAnotacao.color,
      weight: opcoes.weight || estiloAnotacao.weight,
      opacity: opcoes.opacity == null ? estiloAnotacao.opacity : opcoes.opacity,
      fillColor: opcoes.fillColor || opcoes.color || estiloAnotacao.fillColor,
      fillOpacity: opcoes.fillOpacity == null ? estiloAnotacao.fillOpacity : opcoes.fillOpacity,
      dashArray: opcoes.dashArray || ''
    };
  }

  function nomeTipoAnotacao(tipo) {
    if (tipo === 'linha') return 'Linha';
    if (tipo === 'poligono') return 'Polígono';
    if (tipo === 'medicao') return 'Medição';
    if (tipo === 'ponto') return 'Ponto';
    if (tipo === 'retangulo') return 'Retângulo';
    if (tipo === 'circulo') return 'Círculo';
    if (tipo === 'texto') return 'Texto';
    return 'Anotação';
  }

  function solicitarNomeLegendaAnotacao(tipo, padrao) {
    var nome = window.prompt('Nome para aparecer na legenda (' + nomeTipoAnotacao(tipo) + '):', padrao || '');
    if (nome === null) return padrao || '';
    nome = nome.trim();
    if (nome) {
      legendaAnotacoesAtiva = true;
      atualizarBotaoLegendaAnotacoes();
    }
    return nome;
  }

  function atualizarBotaoLegendaAnotacoes() {
    var botao = document.getElementById('toggleLegendaAnotacoes');
    if (!botao) return;
    botao.classList.toggle('ativo-filtro', legendaAnotacoesAtiva);
    botao.textContent = legendaAnotacoesAtiva ? 'Legenda das anotações: ligada' : 'Legenda das anotações: desligada';
  }

  function estiloCssCor(cor, fallback) {
    return String(cor || fallback || '#111827').replace(/[^#(),.%\w\s-]/g, '');
  }

  function corHexParaRgba(cor, opacidade) {
    cor = String(cor || '#111827').trim();
    opacidade = Math.max(0, Math.min(1, Number(opacidade)));
    var match = cor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return cor;
    var hex = match[1];
    if (hex.length === 3) {
      hex = hex.split('').map(function(ch) { return ch + ch; }).join('');
    }
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + opacidade.toFixed(2) + ')';
  }

  function classeFormatoPonto(formato) {
    if (formato === 'quadrado') return ' anotacao-ponto-quadrado';
    if (formato === 'losango') return ' anotacao-ponto-losango';
    if (formato === 'triangulo') return ' anotacao-ponto-triangulo';
    return ' anotacao-ponto-circulo';
  }

  function simboloLegendaAnotacao(tipo, extra) {
    extra = extra || {};
    var estilo = extra.estilo || {};
    var estiloTexto = extra.estiloTexto || {};
    var cor = estiloCssCor(estilo.color, estiloTexto.cor || '#111827');
    var espessura = Math.max(1, Math.min(12, Number(estilo.weight) || 3));
    var preenchimento = estiloCssCor(estilo.fillColor, cor);
    var opacidade = estilo.fillOpacity == null ? 0.14 : Math.max(0, Math.min(1, Number(estilo.fillOpacity)));

    if (tipo === 'linha' || tipo === 'medicao') {
      var tracejado = tipo === 'medicao' ? ';border-top-style:dashed' : '';
      return '<span class="legenda-anotacao-simbolo"><span class="legenda-anotacao-linha" style="border-top-color:' + cor + ';border-top-width:' + espessura + 'px' + tracejado + '"></span></span>';
    }
    if (tipo === 'ponto') {
      var ponto = extra.estiloPonto || {};
      var tamanho = Math.max(8, Math.min(22, Number(ponto.tamanho) || 14));
      return '<span class="legenda-anotacao-simbolo"><span class="anotacao-ponto-shape' + classeFormatoPonto(ponto.formato) + '" style="width:' + tamanho + 'px;height:' + tamanho + 'px;border-color:' + cor + ';border-width:' + espessura + 'px;background:' + corHexParaRgba(preenchimento, opacidade) + '"></span></span>';
    }
    if (tipo === 'retangulo' || tipo === 'poligono') {
      return '<span class="legenda-anotacao-simbolo"><span class="legenda-anotacao-retangulo" style="border-color:' + cor + ';border-width:' + espessura + 'px;background:' + corHexParaRgba(preenchimento, opacidade) + '"></span></span>';
    }
    if (tipo === 'circulo') {
      return '<span class="legenda-anotacao-simbolo"><span class="legenda-anotacao-circulo" style="border-color:' + cor + ';border-width:' + espessura + 'px;background:' + corHexParaRgba(preenchimento, opacidade) + '"></span></span>';
    }
    return '<span class="legenda-anotacao-simbolo"><span class="legenda-anotacao-texto" style="color:' + cor + '">T</span></span>';
  }

  function renderizarLegendaAnotacoes() {
    var bloco = document.getElementById('blocoLegendaAnotacoes');
    var alvo = document.getElementById('legendaAnotacoes');
    if (!bloco || !alvo) return;

    alvo.innerHTML = '';
    if (!legendaAnotacoesAtiva) {
      bloco.style.display = 'none';
      return;
    }

    var total = 0;
    anotacoesLayer.eachLayer(function(layer) {
      var extra = layer._anotacaoExtra || {};
      if (layer._anotacaoTipo === 'texto') return;
      var nome = String(extra.nomeLegenda || '').trim();
      if (!nome) return;

      var item = document.createElement('div');
      item.className = 'legenda-item legenda-anotacao-item';
      item.innerHTML = simboloLegendaAnotacao(layer._anotacaoTipo, extra) +
        '<span class="legenda-texto">' + escaparHtml(nome) + '</span>';
      alvo.appendChild(item);
      total++;
    });

    bloco.style.display = total ? '' : 'none';
  }

  function nomeArquivoSeguroAnotacao(nome) {
    return String(nome || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function limparPreviewAnotacao() {
    if (anotacaoPreview) {
      map.removeLayer(anotacaoPreview);
      anotacaoPreview = null;
    }
    if (anotacaoMedicaoTooltip) {
      map.removeLayer(anotacaoMedicaoTooltip);
      anotacaoMedicaoTooltip = null;
    }
    anotacaoMedicaoPontosPreview.forEach(function(layer) {
      map.removeLayer(layer);
    });
    anotacaoMedicaoPontosPreview = [];
    anotacaoInicio = null;
    anotacaoLinhaPontos = [];
  }

  function limparPreviewMedicoesAnotacao() {
    if (anotacaoMedicaoTooltip) {
      map.removeLayer(anotacaoMedicaoTooltip);
      anotacaoMedicaoTooltip = null;
    }
    anotacaoMedicaoPontosPreview.forEach(function(layer) {
      map.removeLayer(layer);
    });
    anotacaoMedicaoPontosPreview = [];
  }

  function atualizarBotoesAnotacao() {
    var ids = {
      linha: 'drawLinha',
      poligono: 'drawPoligono',
      medicao: 'drawMedicao',
      ponto: 'drawPonto',
      retangulo: 'drawRetangulo',
      circulo: 'drawCirculo',
      texto: 'drawTexto'
    };
    Object.keys(ids).forEach(function(chave) {
      var botao = document.getElementById(ids[chave]);
      if (botao) botao.classList.toggle('ativo-filtro', anotacaoFerramenta === chave);
    });
  }

  function escaparHtml(valor) {
    return String(valor || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function criarIconeTextoAnotacao(texto, estiloTexto) {
    estiloTexto = Object.assign({}, estiloTextoAnotacao, estiloTexto || {});
    var tamanho = Number(estiloTexto.tamanho || estiloTextoAnotacao.tamanho);
    var rotacao = Number(estiloTexto.rotacao) || 0;
    var style = 'color:' + escaparHtml(estiloTexto.cor) + ';' +
      'font-size:' + tamanho + 'px;' +
      'border-color:' + escaparHtml(estiloTexto.cor) + ';' +
      'transform:rotate(' + rotacao + 'deg);';
    return L.divIcon({
      className: 'anotacao-texto-icon',
      html: '<span class="anotacao-texto" style="' + style + '">' + escaparHtml(texto) + '</span>',
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    });
  }

  function anguloEntreLatLngs(origem, destino) {
    if (!origem || !destino) return 0;
    var p1 = map.latLngToLayerPoint(origem);
    var p2 = map.latLngToLayerPoint(destino);
    if (p1.equals && p1.equals(p2)) return 0;
    return Math.round(Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI);
  }

  function rotacaoTextoLegivel(angulo) {
    var rotacao = Number(angulo) || 0;
    while (rotacao > 180) rotacao -= 360;
    while (rotacao < -180) rotacao += 360;
    if (rotacao > 90) rotacao -= 180;
    if (rotacao < -90) rotacao += 180;
    return rotacao;
  }

  function destinoLatLng(centro, metros, graus) {
    var raioTerra = 6378137;
    var brng = graus * Math.PI / 180;
    var lat1 = centro.lat * Math.PI / 180;
    var lng1 = centro.lng * Math.PI / 180;
    var distanciaAngular = metros / raioTerra;
    var lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanciaAngular) +
      Math.cos(lat1) * Math.sin(distanciaAngular) * Math.cos(brng)
    );
    var lng2 = lng1 + Math.atan2(
      Math.sin(brng) * Math.sin(distanciaAngular) * Math.cos(lat1),
      Math.cos(distanciaAngular) - Math.sin(lat1) * Math.sin(lat2)
    );
    return L.latLng(lat2 * 180 / Math.PI, lng2 * 180 / Math.PI);
  }

  function formatarCoordenadasMedicao(latlng) {
    return 'Lat: ' + latlng.lat.toFixed(6).replace('.', ',') +
      ' | Lon: ' + latlng.lng.toFixed(6).replace('.', ',');
  }

  function criarIconePontoAnotacao(estiloForma, estiloPonto) {
    estiloForma = Object.assign({}, estiloAnotacao, estiloForma || {});
    estiloPonto = Object.assign({}, estiloPontoAnotacao, estiloPonto || {});
    var tamanho = Number(estiloPonto.tamanho || estiloPontoAnotacao.tamanho);
    var borda = Number(estiloForma.weight || estiloAnotacao.weight);
    var cor = estiloCssCor(estiloForma.color, '#e11d48');
    var preenchimento = corHexParaRgba(estiloForma.fillColor || estiloForma.color, estiloForma.fillOpacity == null ? 0.14 : estiloForma.fillOpacity);
    var style = 'width:' + tamanho + 'px;height:' + tamanho + 'px;' +
      'border-color:' + cor + ';border-width:' + borda + 'px;' +
      'background:' + preenchimento + ';';
    return L.divIcon({
      className: 'anotacao-ponto-icon',
      html: '<span class="anotacao-ponto-shape' + classeFormatoPonto(estiloPonto.formato) + '" style="' + style + '"></span>',
      iconSize: [tamanho + borda * 2, tamanho + borda * 2],
      iconAnchor: [(tamanho + borda * 2) / 2, (tamanho + borda * 2) / 2]
    });
  }

  function criarIconeKmRodoviaAnotacao(texto, estiloForma, estiloPonto, estiloTexto, latlng) {
    estiloForma = Object.assign({}, estiloAnotacao, estiloForma || {});
    estiloPonto = Object.assign({}, estiloPontoAnotacao, estiloPonto || {});
    estiloTexto = Object.assign({}, estiloTextoAnotacao, estiloTexto || {});
    var tamanho = Number(estiloPonto.tamanho || estiloPontoAnotacao.tamanho);
    var borda = Number(estiloForma.weight || estiloAnotacao.weight);
    var cor = estiloCssCor(estiloForma.color, '#e11d48');
    var corTexto = estiloCssCor(estiloTexto.cor, estiloTextoAnotacao.cor);
    var tamanhoTexto = Number(estiloTexto.tamanho || estiloTextoAnotacao.tamanho);
    var preenchimento = corHexParaRgba(estiloForma.fillColor || estiloForma.color, estiloForma.fillOpacity == null ? 0.14 : estiloForma.fillOpacity);
    var pontoStyle = 'width:' + tamanho + 'px;height:' + tamanho + 'px;' +
      'border-color:' + cor + ';border-width:' + borda + 'px;' +
      'background:' + preenchimento + ';';
    var textoStyle = 'color:' + corTexto + ';font-size:' + tamanhoTexto + 'px;';
    var tamanhoIcone = tamanho + borda * 2;
    var coordsHtml = latlng ?
      '<span class="anotacao-km-coord">Lat: ' + escaparHtml(formatarCoordenadaKm(latlng.lat)) + '</span>' +
      '<span class="anotacao-km-coord">Long: ' + escaparHtml(formatarCoordenadaKm(latlng.lng)) + '</span>' :
      '';
    return L.divIcon({
      className: 'anotacao-km-icon',
      html: '<span class="anotacao-km-wrap">' +
        '<span class="anotacao-ponto-shape' + classeFormatoPonto(estiloPonto.formato) + '" style="' + pontoStyle + '"></span>' +
        '<span class="anotacao-km-label" style="' + textoStyle + '">' +
          '<span class="anotacao-km-titulo">' + escaparHtml(texto) + '</span>' +
          coordsHtml +
        '</span>' +
        '</span>',
      iconSize: [tamanhoIcone, tamanhoIcone],
      iconAnchor: [tamanhoIcone / 2, tamanhoIcone / 2]
    });
  }

  function criarIconeMedicaoAnotacao(texto, estiloTexto) {
    estiloTexto = Object.assign({}, estiloTextoAnotacao, estiloTexto || {});
    var tamanho = Number(estiloTexto.tamanho || estiloTextoAnotacao.tamanho);
    var cor = estiloCssCor(estiloTexto.cor, estiloTextoAnotacao.cor);
    var rotacao = Number(estiloTexto.rotacao) || 0;
    var deslocamento = estiloTexto.ancora === 'inferiorDireito' ? 'translate(10px, 10px)' : 'translate(-50%, -50%)';
    var style = 'color:' + cor + ';' +
      'font-size:' + tamanho + 'px;' +
      'border-color:' + cor + ';' +
      'transform:' + deslocamento + ' rotate(' + rotacao + 'deg);';
    return L.divIcon({
      className: 'medicao-tooltip-icon',
      html: '<span class="medicao-tooltip anotacao-medicao-tooltip" style="' + style + '">' + escaparHtml(texto) + '</span>',
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    });
  }

  function textoMedicaoAnotacao(layer) {
    var extra = layer._anotacaoExtra || {};
    if (extra.texto) return extra.texto;
    return formatarDistanciaMedicao(distanciaTotalMedicao(layer.getLatLngs()));
  }

  function criarPontoExtremoMedicao(latlng, estiloForma) {
    estiloForma = Object.assign({}, estiloAnotacao, estiloForma || {});
    return L.circleMarker(latlng, {
      pane: 'anotacoesPane',
      interactive: false,
      radius: 4,
      color: estiloForma.color || '#111827',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1
    }).addTo(map);
  }

  function removerPontosExtremosMedicao(layer) {
    if (!layer || !layer._anotacaoMedicaoPontos) return;
    layer._anotacaoMedicaoPontos.forEach(function(ponto) {
      map.removeLayer(ponto);
    });
    layer._anotacaoMedicaoPontos = [];
  }

  function sincronizarPontosExtremosMedicao(layer) {
    if (!layer || layer._anotacaoTipo !== 'medicao') return;
    removerPontosExtremosMedicao(layer);
    var pontos = layer.getLatLngs();
    if (pontos.length < 2) return;
    var estiloForma = estiloFormaPorProps(layer._anotacaoExtra || {});
    layer._anotacaoMedicaoPontos = [
      criarPontoExtremoMedicao(pontos[0], estiloForma),
      criarPontoExtremoMedicao(pontos[pontos.length - 1], estiloForma)
    ];
  }

  function sincronizarMarcadorMedicaoAnotacao(layer) {
    if (!layer || layer._anotacaoTipo !== 'medicao') return;
    var pontos = layer.getLatLngs();
    if (!pontos.length) return;
    sincronizarPontosExtremosMedicao(layer);
    var texto = textoMedicaoAnotacao(layer);
    var estiloTexto = estiloTextoPorProps(layer._anotacaoExtra || {});
    if (layer._anotacaoMedicaoMarcador) {
      layer._anotacaoMedicaoMarcador.setLatLng(pontos[pontos.length - 1]);
      layer._anotacaoMedicaoMarcador.setIcon(criarIconeMedicaoAnotacao(texto, estiloTexto));
      return;
    }
    layer._anotacaoMedicaoMarcador = L.marker(pontos[pontos.length - 1], {
      pane: 'anotacoesTextoPane',
      interactive: true,
      icon: criarIconeMedicaoAnotacao(texto, estiloTexto)
    }).addTo(map);
    layer._anotacaoMedicaoMarcador.on('click', function(e) {
      if (e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e.originalEvent);
      }
      editarMedicaoAnotacao(layer);
    });
  }

  function removerMedicoesFormaAnotacao(layer) {
    if (!layer) return;
    (layer._anotacaoMedicaoFormaLayers || []).forEach(function(item) {
      map.removeLayer(item);
    });
    layer._anotacaoMedicaoFormaLayers = [];
  }

  function adicionarMarcadorMedicaoForma(layer, latlng, texto, rotacao, opcoes) {
    var estiloTexto = estiloTextoPorProps(layer._anotacaoExtra || {});
    estiloTexto.rotacao = rotacao || 0;
    if (opcoes && opcoes.ancora) estiloTexto.ancora = opcoes.ancora;
    var marcador = L.marker(latlng, {
      pane: 'anotacoesTextoPane',
      interactive: false,
      icon: criarIconeMedicaoAnotacao(texto, estiloTexto)
    }).addTo(map);
    layer._anotacaoMedicaoFormaLayers.push(marcador);
  }

  function adicionarMarcadorPreviewMedicao(latlng, texto, rotacao, opcoes) {
    var estiloTexto = lerEstiloTextoAnotacao();
    estiloTexto.rotacao = rotacao || 0;
    if (opcoes && opcoes.ancora) estiloTexto.ancora = opcoes.ancora;
    anotacaoMedicaoPontosPreview.push(L.marker(latlng, {
      pane: 'anotacoesTextoPane',
      interactive: false,
      icon: criarIconeMedicaoAnotacao(texto, estiloTexto)
    }).addTo(map));
  }

  function pontoMedioLatLng(a, b) {
    return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
  }

  function adicionarMedicaoSegmentoForma(layer, a, b) {
    adicionarMarcadorMedicaoForma(
      layer,
      pontoMedioLatLng(a, b),
      formatarDistanciaMedicao(a.distanceTo(b)),
      rotacaoTextoLegivel(anguloEntreLatLngs(a, b))
    );
  }

  function adicionarMedicaoSegmentoPreview(a, b) {
    adicionarMarcadorPreviewMedicao(
      pontoMedioLatLng(a, b),
      formatarDistanciaMedicao(a.distanceTo(b)),
      rotacaoTextoLegivel(anguloEntreLatLngs(a, b))
    );
  }

  function areaPoligonoMetrosQuadrados(pontos) {
    if (!pontos || pontos.length < 3) return 0;
    var raioTerra = 6378137;
    var area = 0;
    for (var i = 0; i < pontos.length; i++) {
      var atual = pontos[i];
      var prox = pontos[(i + 1) % pontos.length];
      area += (prox.lng - atual.lng) * Math.PI / 180 *
        (2 + Math.sin(atual.lat * Math.PI / 180) + Math.sin(prox.lat * Math.PI / 180));
    }
    return Math.abs(area * raioTerra * raioTerra / 2);
  }

  function formatarAreaMedicao(area) {
    if (!isFinite(area)) return '0 m²';
    if (area >= 1000000) return (area / 1000000).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' km²';
    if (area >= 10000) return (area / 10000).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ha';
    return area.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }) + ' m²';
  }

  function centroideLatLng(pontos) {
    if (!pontos || !pontos.length) return null;
    var lat = 0;
    var lng = 0;
    pontos.forEach(function(ponto) {
      lat += ponto.lat;
      lng += ponto.lng;
    });
    return L.latLng(lat / pontos.length, lng / pontos.length);
  }

  function adicionarMedicoesPoligono(layer, pontos, incluirArea) {
    if (!pontos || pontos.length < 2) return;
    if (pontos.length > 2 && pontos[0].equals && pontos[0].equals(pontos[pontos.length - 1])) {
      pontos = pontos.slice(0, -1);
    }
    for (var i = 1; i < pontos.length; i++) {
      adicionarMedicaoSegmentoForma(layer, pontos[i - 1], pontos[i]);
    }
    if (pontos.length > 2) {
      adicionarMedicaoSegmentoForma(layer, pontos[pontos.length - 1], pontos[0]);
      if (incluirArea) {
        adicionarMarcadorMedicaoForma(
          layer,
          centroideLatLng(pontos),
          'Área = ' + formatarAreaMedicao(areaPoligonoMetrosQuadrados(pontos)),
          0
        );
      }
    }
  }

  function atualizarPreviewMedicoesForma(tipo, pontos, incluirArea) {
    limparPreviewMedicoesAnotacao();
    if (!pontos || !pontos.length) return;

    if (tipo === 'linha') {
      for (var i = 1; i < pontos.length; i++) adicionarMedicaoSegmentoPreview(pontos[i - 1], pontos[i]);
      return;
    }

    if (tipo === 'poligono') {
      for (var j = 1; j < pontos.length; j++) adicionarMedicaoSegmentoPreview(pontos[j - 1], pontos[j]);
      if (pontos.length > 2) {
        adicionarMedicaoSegmentoPreview(pontos[pontos.length - 1], pontos[0]);
        if (incluirArea) {
          adicionarMarcadorPreviewMedicao(
            centroideLatLng(pontos),
            'Área = ' + formatarAreaMedicao(areaPoligonoMetrosQuadrados(pontos)),
            0
          );
        }
      }
      return;
    }

    if (tipo === 'retangulo' && pontos.length > 1) {
      var bounds = L.latLngBounds(pontos[0], pontos[1]);
      var nw = bounds.getNorthWest();
      var ne = bounds.getNorthEast();
      var sw = bounds.getSouthWest();
      adicionarMedicaoSegmentoPreview(nw, ne);
      adicionarMedicaoSegmentoPreview(nw, sw);
      return;
    }

    if (tipo === 'circulo' && pontos.length > 1) {
      adicionarMedicaoSegmentoPreview(pontos[0], pontos[1]);
    }
  }

  function sincronizarMedicoesFormaAnotacao(layer) {
    if (!layer || !layer._anotacaoExtra || !layer._anotacaoExtra.medirForma) return;
    removerMedicoesFormaAnotacao(layer);
    layer._anotacaoMedicaoFormaLayers = [];
    var tipo = layer._anotacaoTipo;
    var estiloForma = estiloFormaPorProps(layer._anotacaoExtra);

    if (tipo === 'ponto') {
      adicionarMarcadorMedicaoForma(layer, layer.getLatLng(), formatarCoordenadasMedicao(layer.getLatLng()), 0, {
        ancora: 'inferiorDireito'
      });
      return;
    }

    if (tipo === 'retangulo') {
      var bounds = layer.getBounds();
      var nw = bounds.getNorthWest();
      var ne = bounds.getNorthEast();
      var sw = bounds.getSouthWest();
      adicionarMedicaoSegmentoForma(layer, nw, ne);
      adicionarMedicaoSegmentoForma(layer, nw, sw);
      return;
    }

    if (tipo === 'linha') {
      var pontosLinha = layer.getLatLngs();
      for (var i = 1; i < pontosLinha.length; i++) {
        adicionarMedicaoSegmentoForma(layer, pontosLinha[i - 1], pontosLinha[i]);
      }
      return;
    }

    if (tipo === 'poligono') {
      adicionarMedicoesPoligono(layer, layer.getLatLngs()[0] || [], true);
      return;
    }

    if (tipo === 'circulo') {
      var centro = layer.getLatLng();
      var raio = layer.getRadius();
      var pontoRaio = layer._anotacaoExtra.pontoRaio ?
        L.latLng(layer._anotacaoExtra.pontoRaio[1], layer._anotacaoExtra.pontoRaio[0]) :
        destinoLatLng(centro, raio, 90);
      var linhaRaio = L.polyline([centro, pontoRaio], Object.assign({}, estiloForma, {
        pane: 'anotacoesPane',
        dashArray: '8,6',
        fillOpacity: 0,
        interactive: false
      })).addTo(map);
      layer._anotacaoMedicaoFormaLayers.push(linhaRaio);
      adicionarMarcadorMedicaoForma(layer, pontoMedioLatLng(centro, pontoRaio), formatarDistanciaMedicao(raio), rotacaoTextoLegivel(anguloEntreLatLngs(centro, pontoRaio)));
    }
  }

  function editarMedicaoAnotacao(layer) {
    if (anotacaoFerramenta) return;
    var textoAtual = textoMedicaoAnotacao(layer);
    var novoTexto = window.prompt('Texto da medição:', textoAtual);
    if (novoTexto === null) return;
    novoTexto = novoTexto.trim();
    if (!novoTexto) {
      removerAnotacao(layer);
      return;
    }

    var nomeAtual = layer._anotacaoExtra.nomeLegenda || '';
    var novoNome = solicitarNomeLegendaAnotacao('medicao', nomeAtual);
    layer._anotacaoExtra.texto = novoTexto;
    layer._anotacaoExtra.nomeLegenda = novoNome;
    sincronizarMarcadorMedicaoAnotacao(layer);
    salvarAnotacoesLocal();
  }

  function atualizarPreviewMedicaoAnotacao(pontos) {
    if (anotacaoMedicaoTooltip) {
      map.removeLayer(anotacaoMedicaoTooltip);
      anotacaoMedicaoTooltip = null;
    }
    anotacaoMedicaoPontosPreview.forEach(function(layer) {
      map.removeLayer(layer);
    });
    anotacaoMedicaoPontosPreview = [];
    if (!pontos || !pontos.length) return;
    var texto = formatarDistanciaMedicao(distanciaTotalMedicao(pontos));
    anotacaoMedicaoTooltip = L.marker(pontos[pontos.length - 1], {
      pane: 'anotacoesTextoPane',
      interactive: false,
      icon: criarIconeMedicaoAnotacao(texto, lerEstiloTextoAnotacao())
    }).addTo(map);
    if (pontos.length > 1) {
      var estiloForma = lerEstiloFormaAnotacao();
      anotacaoMedicaoPontosPreview = [
        criarPontoExtremoMedicao(pontos[0], estiloForma),
        criarPontoExtremoMedicao(pontos[pontos.length - 1], estiloForma)
      ];
    }
  }

  function configurarCamadaAnotacao(layer, tipo, extra) {
    layer._anotacaoTipo = tipo;
    layer._anotacaoExtra = extra || {};
    if (tipo === 'texto') {
      layer.on('dragend', salvarAnotacoesLocal);
      layer.on('click', function() {
        var textoAtual = layer._anotacaoExtra.texto || '';
        var novoTexto = window.prompt('Texto da anotação:', textoAtual);
        if (novoTexto === null) return;
        novoTexto = novoTexto.trim();
        if (!novoTexto) {
          removerAnotacao(layer);
          return;
        }
        layer._anotacaoExtra.texto = novoTexto;
        layer.setIcon(criarIconeTextoAnotacao(novoTexto, estiloTextoPorProps(layer._anotacaoExtra)));
        salvarAnotacoesLocal();
      });
    } else if (tipo === 'medicao') {
      sincronizarMarcadorMedicaoAnotacao(layer);
      layer.on('click', function() {
        editarMedicaoAnotacao(layer);
      });
    } else {
      layer.on('click', function() {
        if (anotacaoFerramenta) return;
        var nomeAtual = layer._anotacaoExtra.nomeLegenda || '';
        var novoNome = solicitarNomeLegendaAnotacao(tipo, nomeAtual);
        layer._anotacaoExtra.nomeLegenda = novoNome;
        salvarAnotacoesLocal();
        if (window.confirm('Remover esta anotação?')) removerAnotacao(layer);
      });
    }
    sincronizarMedicoesFormaAnotacao(layer);
    return layer;
  }

  function adicionarAnotacao(layer, tipo, extra) {
    configurarCamadaAnotacao(layer, tipo, extra);
    anotacoesLayer.addLayer(layer);
    anotacoesHistorico.push(layer);
    salvarAnotacoesLocal();
    renderizarLegendaAnotacoes();
  }

  function removerAnotacao(layer) {
    if (layer && layer._anotacaoMedicaoMarcador) {
      map.removeLayer(layer._anotacaoMedicaoMarcador);
      layer._anotacaoMedicaoMarcador = null;
    }
    removerMedicoesFormaAnotacao(layer);
    removerPontosExtremosMedicao(layer);
    anotacoesLayer.removeLayer(layer);
    anotacoesHistorico = anotacoesHistorico.filter(function(item) {
      return item !== layer;
    });
    salvarAnotacoesLocal();
    renderizarLegendaAnotacoes();
  }

  function latLngsParaCoords(latlngs) {
    return latlngs.map(function(latlng) {
      return [latlng.lng, latlng.lat];
    });
  }

  function coordsParaLatLngs(coords) {
    return coords.map(function(coord) {
      return [coord[1], coord[0]];
    });
  }

  function coordenadasCirculoAproximado(centro, raioMetros) {
    var pontos = [];
    var lat1 = centro.lat * Math.PI / 180;
    var lng1 = centro.lng * Math.PI / 180;
    var distanciaAngular = raioMetros / 6378137;

    for (var i = 0; i <= 72; i++) {
      var bearing = (i * 5) * Math.PI / 180;
      var lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(distanciaAngular) +
        Math.cos(lat1) * Math.sin(distanciaAngular) * Math.cos(bearing)
      );
      var lng2 = lng1 + Math.atan2(
        Math.sin(bearing) * Math.sin(distanciaAngular) * Math.cos(lat1),
        Math.cos(distanciaAngular) - Math.sin(lat1) * Math.sin(lat2)
      );
      pontos.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }

    return [pontos];
  }

  function camadaAnotacaoParaFeature(layer) {
    var tipo = layer._anotacaoTipo;
    var props = Object.assign({ tipo: tipo }, layer._anotacaoExtra || {});

    if (tipo === 'linha' || tipo === 'medicao') {
      props.estilo = estiloFormaDaCamada(layer);
      return {
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'LineString',
          coordinates: latLngsParaCoords(layer.getLatLngs())
        }
      };
    }

    if (tipo === 'ponto') {
      var ponto = layer.getLatLng();
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: [ponto.lng, ponto.lat] }
      };
    }

    if (tipo === 'retangulo' || tipo === 'poligono') {
      var polygon = layer.toGeoJSON().geometry.coordinates;
      props.estilo = estiloFormaDaCamada(layer);
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Polygon', coordinates: polygon }
      };
    }

    if (tipo === 'circulo') {
      var centro = layer.getLatLng();
      props.raio = layer.getRadius();
      props.centro = [centro.lng, centro.lat];
      props.estilo = estiloFormaDaCamada(layer);
      return {
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'Polygon',
          coordinates: coordenadasCirculoAproximado(centro, props.raio)
        }
      };
    }

    if (tipo === 'texto') {
      var pos = layer.getLatLng();
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] }
      };
    }

    return null;
  }

  function exportarAnotacoesGeoJSON() {
    var features = [];
    anotacoesLayer.eachLayer(function(layer) {
      var feature = camadaAnotacaoParaFeature(layer);
      if (feature) features.push(feature);
    });
    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  function salvarAnotacoesLocal() {
    try {
      localStorage.setItem(ANOTACOES_STORAGE_KEY, JSON.stringify(exportarAnotacoesGeoJSON()));
      setStatusAnotacao(anotacoesLayer.getLayers().length + ' anotação(ões) salva(s) no navegador');
      renderizarLegendaAnotacoes();
    } catch (erro) {
      setStatusAnotacao('Não foi possível salvar no navegador');
      console.warn('Falha ao salvar anotações:', erro);
    }
  }

  function criarLayerDeFeatureAnotacao(feature) {
    if (!feature || !feature.geometry) return null;
    var props = feature.properties || {};
    var tipo = props.tipo;
    var geom = feature.geometry;
    var layer = null;
    var estiloForma = estiloFormaPorProps(props);

    if (tipo === 'linha' && geom.type === 'LineString') {
      layer = L.polyline(coordsParaLatLngs(geom.coordinates), estiloForma);
    } else if (tipo === 'medicao' && geom.type === 'LineString') {
      layer = L.polyline(coordsParaLatLngs(geom.coordinates), Object.assign({}, estiloForma, {
        dashArray: estiloForma.dashArray || '8,6'
      }));
    } else if (tipo === 'ponto' && geom.type === 'Point') {
      var latlngPonto = L.latLng(geom.coordinates[1], geom.coordinates[0]);
      var iconePonto = props.rotuloKm ?
        criarIconeKmRodoviaAnotacao(props.rotuloKm, estiloForma, estiloPontoPorProps(props), estiloTextoPorProps(props), latlngPonto) :
        criarIconePontoAnotacao(estiloForma, estiloPontoPorProps(props));
      layer = L.marker(latlngPonto, {
        pane: 'anotacoesPane',
        draggable: false,
        icon: iconePonto
      });
    } else if (tipo === 'retangulo' && geom.type === 'Polygon') {
      layer = L.polygon(coordsParaLatLngs(geom.coordinates[0] || []), estiloForma);
    } else if (tipo === 'poligono' && geom.type === 'Polygon') {
      layer = L.polygon(coordsParaLatLngs(geom.coordinates[0] || []), estiloForma);
    } else if (tipo === 'circulo' && geom.type === 'Polygon' && props.centro) {
      layer = L.circle([props.centro[1], props.centro[0]], Object.assign({}, estiloForma, {
        radius: Number(props.raio) || 1000
      }));
    } else if (tipo === 'circulo' && geom.type === 'Point') {
      layer = L.circle([geom.coordinates[1], geom.coordinates[0]], Object.assign({}, estiloForma, {
        radius: Number(props.raio) || 1000
      }));
    } else if (tipo === 'texto' && geom.type === 'Point') {
      layer = L.marker([geom.coordinates[1], geom.coordinates[0]], {
        pane: 'anotacoesTextoPane',
        draggable: true,
        icon: criarIconeTextoAnotacao(props.texto || '', estiloTextoPorProps(props))
      });
    }

    if (!layer) return null;
    return configurarCamadaAnotacao(layer, tipo, props);
  }

  function carregarAnotacoesGeoJSON(geojson, substituir) {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      setStatusAnotacao('Arquivo de anotações inválido');
      return;
    }

    if (substituir) {
      anotacoesLayer.eachLayer(function(layer) {
        if (layer._anotacaoMedicaoMarcador) map.removeLayer(layer._anotacaoMedicaoMarcador);
        removerMedicoesFormaAnotacao(layer);
        removerPontosExtremosMedicao(layer);
      });
      anotacoesLayer.clearLayers();
      anotacoesHistorico = [];
    }

    geojson.features.forEach(function(feature) {
      var layer = criarLayerDeFeatureAnotacao(feature);
      if (layer) {
        anotacoesLayer.addLayer(layer);
        anotacoesHistorico.push(layer);
      }
    });
    salvarAnotacoesLocal();
  }

  function carregarAnotacoesLocal() {
    try {
      var bruto = localStorage.getItem(ANOTACOES_STORAGE_KEY);
      if (!bruto) return;
      carregarAnotacoesGeoJSON(JSON.parse(bruto), true);
    } catch (erro) {
      setStatusAnotacao('Não foi possível recuperar as anotações salvas');
      console.warn('Falha ao carregar anotações:', erro);
    }
  }

  function lerNumeroDecimal(valor) {
    var texto = String(valor || '').trim();
    texto = texto.indexOf(',') !== -1 ? texto.replace(/\./g, '').replace(',', '.') : texto;
    var numero = Number(texto);
    return isFinite(numero) ? numero : null;
  }

  function formatarKmRodovia(km) {
    return Number(km).toLocaleString('pt-BR', {
      minimumFractionDigits: Math.abs(km % 1) > 0.0001 ? 1 : 0,
      maximumFractionDigits: 3
    });
  }

  function formatarCoordenadaKm(valor) {
    return Number(valor).toFixed(6).replace('.', ',');
  }

  function coordenadasLinhaFeature(feature) {
    var geom = feature && feature.geometry;
    if (!geom || !geom.coordinates) return [];
    if (geom.type === 'LineString') return geom.coordinates;
    if (geom.type === 'MultiLineString') {
      var coords = [];
      geom.coordinates.forEach(function(parte) {
        if (Array.isArray(parte)) coords = coords.concat(parte);
      });
      return coords;
    }
    return [];
  }

  function interpolarPontoNaLinha(coords, fator) {
    if (!coords || !coords.length) return null;
    var pontos = coords
      .filter(function(coord) { return coord && coord.length >= 2; })
      .map(function(coord) { return L.latLng(Number(coord[1]), Number(coord[0])); })
      .filter(function(latlng) { return isFinite(latlng.lat) && isFinite(latlng.lng); });

    if (!pontos.length) return null;
    if (pontos.length === 1) return pontos[0];

    fator = Math.max(0, Math.min(1, Number(fator) || 0));
    var distancias = [];
    var total = 0;
    for (var i = 1; i < pontos.length; i++) {
      var d = pontos[i - 1].distanceTo(pontos[i]);
      distancias.push(d);
      total += d;
    }
    if (!total) return pontos[0];

    var alvo = total * fator;
    var acumulado = 0;
    for (var j = 1; j < pontos.length; j++) {
      var segmento = distancias[j - 1];
      if (acumulado + segmento >= alvo) {
        var t = segmento ? (alvo - acumulado) / segmento : 0;
        return L.latLng(
          pontos[j - 1].lat + (pontos[j].lat - pontos[j - 1].lat) * t,
          pontos[j - 1].lng + (pontos[j].lng - pontos[j - 1].lng) * t
        );
      }
      acumulado += segmento;
    }
    return pontos[pontos.length - 1];
  }

  function localizarKmNaRodovia(rodovia, km) {
    if (!sreBaseData || !sreBaseData.features) return null;
    var segmentos = sreBaseData.features
      .filter(function(feature) {
        return nomeRodoviaFeature(feature) === rodovia &&
          valorSeguro(feature, 'km_ini') !== '' &&
          valorSeguro(feature, 'km_fim') !== '';
      })
      .sort(function(a, b) {
        return Number(valorSeguro(a, 'km_ini')) - Number(valorSeguro(b, 'km_ini')) ||
          String(nomeSREFeature(a)).localeCompare(String(nomeSREFeature(b)), 'pt-BR');
      });

    for (var i = 0; i < segmentos.length; i++) {
      var feature = segmentos[i];
      var kmIni = Number(valorSeguro(feature, 'km_ini'));
      var kmFim = Number(valorSeguro(feature, 'km_fim'));
      if (!isFinite(kmIni) || !isFinite(kmFim)) continue;
      var min = Math.min(kmIni, kmFim);
      var max = Math.max(kmIni, kmFim);
      if (km < min || km > max) continue;
      var fator = kmFim === kmIni ? 0 : (km - kmIni) / (kmFim - kmIni);
      var latlng = interpolarPontoNaLinha(coordenadasLinhaFeature(feature), fator);
      if (latlng) return { feature: feature, latlng: latlng, kmIni: kmIni, kmFim: kmFim };
    }

    return null;
  }

  function intervaloKmRodovia(rodovia) {
    if (!sreBaseData || !sreBaseData.features) return null;
    var minimo = Infinity;
    var maximo = -Infinity;
    sreBaseData.features.forEach(function(feature) {
      if (nomeRodoviaFeature(feature) !== rodovia) return;
      var kmIni = Number(valorSeguro(feature, 'km_ini'));
      var kmFim = Number(valorSeguro(feature, 'km_fim'));
      if (!isFinite(kmIni) || !isFinite(kmFim)) return;
      minimo = Math.min(minimo, kmIni, kmFim);
      maximo = Math.max(maximo, kmIni, kmFim);
    });
    if (!isFinite(minimo) || !isFinite(maximo)) return null;
    return { minimo: minimo, maximo: maximo };
  }

  function marcarKmRodoviaSelecionada() {
    var rodovia = document.getElementById('rodoviaSelect').value;
    var campoKm = document.getElementById('drawKmRodovia');
    var km = lerNumeroDecimal(campoKm ? campoKm.value : '');

    if (!rodovia) {
      setStatusAnotacao('Selecione uma rodovia no filtro antes de localizar o km');
      return;
    }
    if (km === null) {
      setStatusAnotacao('Informe um km válido para localizar na rodovia');
      return;
    }

    var resultado = localizarKmNaRodovia(rodovia, km);
    if (!resultado) {
      var intervalo = intervaloKmRodovia(rodovia);
      var complemento = intervalo ?
        ' Intervalo disponível: km ' + formatarKmRodovia(intervalo.minimo) + ' a km ' + formatarKmRodovia(intervalo.maximo) + '.' :
        '';
      setStatusAnotacao('Km não encontrado na rodovia selecionada.' + complemento);
      return;
    }

    if (anotacaoFerramenta) ativarFerramentaAnotacao(anotacaoFerramenta);

    var estiloPontoForma = lerEstiloFormaAnotacao();
    var estiloPonto = lerEstiloPontoAnotacao();
    var estiloTexto = lerEstiloTextoAnotacao();
    var texto = rodovia + ', km ' + formatarKmRodovia(km);
    var props = resultado.feature.properties || {};

    adicionarAnotacao(L.marker(resultado.latlng, {
      pane: 'anotacoesPane',
      draggable: false,
      icon: criarIconeKmRodoviaAnotacao(texto, estiloPontoForma, estiloPonto, estiloTexto, resultado.latlng)
    }), 'ponto', {
      estilo: estiloFormaDaCamada({ options: estiloPontoForma }),
      estiloPonto: estiloPonto,
      estiloTexto: estiloTexto,
      rotuloKm: texto,
      nomeLegenda: texto,
      rodoviaKm: rodovia,
      km: km,
      latitude: Number(resultado.latlng.lat.toFixed(6)),
      longitude: Number(resultado.latlng.lng.toFixed(6)),
      sre: props.sre || props.SRE || '',
      trecho: props.trecho || props.TRECHO || ''
    });

    map.setView(resultado.latlng, Math.max(map.getZoom(), 13));
    setStatusAnotacao(texto + ' marcado no SRE ' + (props.sre || props.SRE || ''));
  }

  function ativarFerramentaAnotacao(tipo) {
    var ferramentaAnterior = anotacaoFerramenta;
    limparPreviewAnotacao();
    anotacaoMedicaoFormaModo = tipo === 'medicao' && ['linha', 'poligono', 'ponto', 'retangulo', 'circulo'].indexOf(ferramentaAnterior) !== -1 ?
      ferramentaAnterior :
      null;
    anotacaoFerramenta = anotacaoFerramenta === tipo ? null : tipo;
    if (!anotacaoFerramenta) anotacaoMedicaoFormaModo = null;
    atualizarBotoesAnotacao();

    if (!anotacaoFerramenta) {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      setStatusAnotacao('Sem ferramenta ativa');
      return;
    }

    map.dragging.disable();
    map.doubleClickZoom.disable();

    if (tipo === 'linha') {
      setStatusAnotacao('Linha: clique nos pontos e dê duplo clique para finalizar');
      return;
    }
    if (tipo === 'poligono') {
      setStatusAnotacao('Polígono: clique nos vértices e dê duplo clique para finalizar');
      return;
    }
    if (tipo === 'medicao') {
      if (anotacaoMedicaoFormaModo === 'ponto') setStatusAnotacao('Medição de ponto: clique no local para inserir as coordenadas');
      else if (anotacaoMedicaoFormaModo === 'linha') setStatusAnotacao('Medição de linha: clique nos pontos e dê duplo clique para finalizar');
      else if (anotacaoMedicaoFormaModo === 'poligono') setStatusAnotacao('Medição de polígono: clique nos vértices e dê duplo clique para finalizar');
      else if (anotacaoMedicaoFormaModo === 'retangulo') setStatusAnotacao('Medição de retângulo: clique em dois cantos para medir os lados');
      else if (anotacaoMedicaoFormaModo === 'circulo') setStatusAnotacao('Medição de círculo: clique no centro e depois no raio');
      else setStatusAnotacao('Medição: clique nos pontos e dê duplo clique para finalizar');
      return;
    }
    if (tipo === 'ponto') {
      setStatusAnotacao('Ponto: clique no local da anotação');
      return;
    }
    if (tipo === 'retangulo') {
      setStatusAnotacao('Retângulo: clique em dois cantos do retângulo');
      return;
    }
    if (tipo === 'circulo') {
      setStatusAnotacao('Círculo: clique no centro e depois no raio');
      return;
    }
    if (tipo === 'texto') {
      setStatusAnotacao('Texto: clique no local, mova para escolher a rotação e clique para digitar');
      return;
    }
  }

  function finalizarLinhaAnotacao() {
    if (anotacaoLinhaPontos.length < 2) return;
    if (anotacaoPreview) map.removeLayer(anotacaoPreview);
    var medirSegmentosLinha = anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'linha';
    var medirPoligono = anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'poligono';
    var tipoPoligono = anotacaoFerramenta === 'poligono' || medirPoligono;
    if (tipoPoligono && anotacaoLinhaPontos.length < 3) return;
    var tipoLinha = anotacaoFerramenta === 'medicao' && !medirSegmentosLinha ? 'medicao' : 'linha';
    if (tipoPoligono) tipoLinha = 'poligono';
    var estiloLinha = lerEstiloFormaAnotacao();
    if (tipoLinha === 'medicao') estiloLinha.dashArray = '8,6';
    var nomeLegenda = solicitarNomeLegendaAnotacao(tipoLinha, '');
    var extra = {
      estilo: estiloFormaDaCamada({ options: estiloLinha }),
      nomeLegenda: nomeLegenda
    };
    if (medirSegmentosLinha || medirPoligono) {
      extra.estiloTexto = lerEstiloTextoAnotacao();
      extra.medirForma = true;
    }
    if (tipoLinha === 'medicao') {
      extra.texto = formatarDistanciaMedicao(distanciaTotalMedicao(anotacaoLinhaPontos));
      extra.estiloTexto = lerEstiloTextoAnotacao();
    }
    adicionarAnotacao(tipoPoligono ? L.polygon(anotacaoLinhaPontos, estiloLinha) : L.polyline(anotacaoLinhaPontos, estiloLinha), tipoLinha, extra);
    limparPreviewAnotacao();
    ativarFerramentaAnotacao((medirSegmentosLinha || medirPoligono) ? 'medicao' : tipoLinha);
  }

  function processarCliqueAnotacao(e) {
    if (!anotacaoFerramenta) return;
    if (e.originalEvent) {
      L.DomEvent.preventDefault(e.originalEvent);
      L.DomEvent.stopPropagation(e.originalEvent);
    }

    if (anotacaoFerramenta === 'texto') {
      if (!anotacaoInicio) {
        anotacaoInicio = e.latlng;
        setStatusAnotacao('Texto: mova o mouse para escolher a rotação e clique para digitar');
        return;
      }
      var rotacaoTexto = anguloEntreLatLngs(anotacaoInicio, e.latlng);
      if (anotacaoPreview) {
        map.removeLayer(anotacaoPreview);
        anotacaoPreview = null;
      }
      var textoRotacionado = window.prompt('Texto da anotação:');
      if (textoRotacionado && textoRotacionado.trim()) {
        var estiloTextoRotacionado = lerEstiloTextoAnotacao();
        estiloTextoRotacionado.rotacao = rotacaoTexto;
        adicionarAnotacao(L.marker(anotacaoInicio, {
          pane: 'anotacoesTextoPane',
          draggable: true,
          icon: criarIconeTextoAnotacao(textoRotacionado.trim(), estiloTextoRotacionado)
        }), 'texto', { texto: textoRotacionado.trim(), estiloTexto: estiloTextoRotacionado });
      }
      limparPreviewAnotacao();
      ativarFerramentaAnotacao('texto');
      return;
    }
    if (anotacaoFerramenta === 'ponto') {
      var estiloPontoForma = lerEstiloFormaAnotacao();
      var estiloPonto = lerEstiloPontoAnotacao();
      var nomeLegendaPonto = solicitarNomeLegendaAnotacao('ponto', '');
      adicionarAnotacao(L.marker(e.latlng, {
        pane: 'anotacoesPane',
        draggable: false,
        icon: criarIconePontoAnotacao(estiloPontoForma, estiloPonto)
      }), 'ponto', {
        estilo: estiloFormaDaCamada({ options: estiloPontoForma }),
        estiloPonto: estiloPonto,
        nomeLegenda: nomeLegendaPonto
      });
      ativarFerramentaAnotacao('ponto');
      return;
    }

    if (anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'ponto') {
      var estiloPontoMedicaoForma = lerEstiloFormaAnotacao();
      var estiloPontoMedicao = lerEstiloPontoAnotacao();
      var nomeLegendaPontoMedicao = solicitarNomeLegendaAnotacao('ponto', '');
      adicionarAnotacao(L.marker(e.latlng, {
        pane: 'anotacoesPane',
        draggable: false,
        icon: criarIconePontoAnotacao(estiloPontoMedicaoForma, estiloPontoMedicao)
      }), 'ponto', {
        estilo: estiloFormaDaCamada({ options: estiloPontoMedicaoForma }),
        estiloPonto: estiloPontoMedicao,
        estiloTexto: lerEstiloTextoAnotacao(),
        medirForma: true,
        nomeLegenda: nomeLegendaPontoMedicao
      });
      limparPreviewAnotacao();
      ativarFerramentaAnotacao('medicao');
      return;
    }

    if (anotacaoFerramenta === 'medicao' && (anotacaoMedicaoFormaModo === 'retangulo' || anotacaoMedicaoFormaModo === 'circulo')) {
      if (!anotacaoInicio) {
        anotacaoInicio = e.latlng;
        return;
      }

      if (anotacaoMedicaoFormaModo === 'retangulo') {
        if (anotacaoPreview) map.removeLayer(anotacaoPreview);
        var estiloRetanguloMedicao = lerEstiloFormaAnotacao();
        var nomeLegendaRetanguloMedicao = solicitarNomeLegendaAnotacao('retangulo', '');
        adicionarAnotacao(L.rectangle(L.latLngBounds(anotacaoInicio, e.latlng), estiloRetanguloMedicao), 'retangulo', {
          estilo: estiloFormaDaCamada({ options: estiloRetanguloMedicao }),
          estiloTexto: lerEstiloTextoAnotacao(),
          medirForma: true,
          nomeLegenda: nomeLegendaRetanguloMedicao
        });
      }

      if (anotacaoMedicaoFormaModo === 'circulo') {
        var raioMedicao = anotacaoInicio.distanceTo(e.latlng);
        if (raioMedicao > 0) {
          if (anotacaoPreview) map.removeLayer(anotacaoPreview);
          var estiloCirculoMedicao = lerEstiloFormaAnotacao();
          var nomeLegendaCirculoMedicao = solicitarNomeLegendaAnotacao('circulo', '');
          adicionarAnotacao(L.circle(anotacaoInicio, Object.assign({}, estiloCirculoMedicao, {
            radius: raioMedicao
          })), 'circulo', {
            estilo: estiloFormaDaCamada({ options: estiloCirculoMedicao }),
            estiloTexto: lerEstiloTextoAnotacao(),
            medirForma: true,
            pontoRaio: [e.latlng.lng, e.latlng.lat],
            nomeLegenda: nomeLegendaCirculoMedicao
          });
        }
      }

      limparPreviewAnotacao();
      ativarFerramentaAnotacao('medicao');
      return;
    }

    if (anotacaoFerramenta === 'linha' || anotacaoFerramenta === 'poligono' || anotacaoFerramenta === 'medicao') {
      if (e.originalEvent && e.originalEvent.detail >= 2) {
        finalizarLinhaAnotacao();
        return;
      }
      anotacaoLinhaPontos.push(e.latlng);
      if (anotacaoPreview) map.removeLayer(anotacaoPreview);
      var desenhandoPoligono = anotacaoFerramenta === 'poligono' || (anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'poligono');
      anotacaoPreview = (desenhandoPoligono ? L.polygon : L.polyline)(anotacaoLinhaPontos, Object.assign({}, lerEstiloFormaAnotacao(), {
        dashArray: anotacaoFerramenta === 'medicao' ? '8,6' : '6,6'
      })).addTo(map);
      if (anotacaoFerramenta === 'medicao' && !anotacaoMedicaoFormaModo) atualizarPreviewMedicaoAnotacao(anotacaoLinhaPontos);
      else atualizarPreviewMedicoesForma(desenhandoPoligono ? 'poligono' : 'linha', anotacaoLinhaPontos, desenhandoPoligono);
      return;
    }

    if (!anotacaoInicio) {
      anotacaoInicio = e.latlng;
      return;
    }

    if (anotacaoFerramenta === 'retangulo') {
      if (anotacaoPreview) map.removeLayer(anotacaoPreview);
      var estiloRetangulo = lerEstiloFormaAnotacao();
      var nomeLegendaRetangulo = solicitarNomeLegendaAnotacao('retangulo', '');
      adicionarAnotacao(L.rectangle(L.latLngBounds(anotacaoInicio, e.latlng), estiloRetangulo), 'retangulo', {
        estilo: estiloFormaDaCamada({ options: estiloRetangulo }),
        nomeLegenda: nomeLegendaRetangulo
      });
      limparPreviewAnotacao();
      ativarFerramentaAnotacao('retangulo');
      return;
    }

    if (anotacaoFerramenta === 'circulo') {
      var raio = anotacaoInicio.distanceTo(e.latlng);
      if (raio > 0) {
        if (anotacaoPreview) map.removeLayer(anotacaoPreview);
        var estiloCirculo = lerEstiloFormaAnotacao();
        var nomeLegendaCirculo = solicitarNomeLegendaAnotacao('circulo', '');
        adicionarAnotacao(L.circle(anotacaoInicio, Object.assign({}, estiloCirculo, {
          radius: raio
        })), 'circulo', {
          estilo: estiloFormaDaCamada({ options: estiloCirculo }),
          nomeLegenda: nomeLegendaCirculo
        });
      }
      limparPreviewAnotacao();
      ativarFerramentaAnotacao('circulo');
    }
  }

  function processarMousemoveAnotacao(e) {
    if (!anotacaoFerramenta) return;

    if (anotacaoFerramenta === 'texto' && anotacaoInicio) {
      if (anotacaoPreview) map.removeLayer(anotacaoPreview);
      var estiloTextoPreview = lerEstiloTextoAnotacao();
      estiloTextoPreview.rotacao = anguloEntreLatLngs(anotacaoInicio, e.latlng);
      anotacaoPreview = L.marker(anotacaoInicio, {
        pane: 'anotacoesTextoPane',
        interactive: false,
        icon: criarIconeTextoAnotacao('Texto', estiloTextoPreview)
      }).addTo(map);
      return;
    }

    if ((anotacaoFerramenta === 'linha' || anotacaoFerramenta === 'poligono' || anotacaoFerramenta === 'medicao') && anotacaoLinhaPontos.length) {
      if (anotacaoPreview) map.removeLayer(anotacaoPreview);
      var pontosPreviewLinha = anotacaoLinhaPontos.concat([e.latlng]);
      var previewPoligono = anotacaoFerramenta === 'poligono' || (anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'poligono');
      anotacaoPreview = (previewPoligono ? L.polygon : L.polyline)(pontosPreviewLinha, Object.assign({}, lerEstiloFormaAnotacao(), {
        dashArray: anotacaoFerramenta === 'medicao' ? '8,6' : '6,6'
      })).addTo(map);
      if (anotacaoFerramenta === 'medicao' && !anotacaoMedicaoFormaModo) atualizarPreviewMedicaoAnotacao(pontosPreviewLinha);
      else atualizarPreviewMedicoesForma(previewPoligono ? 'poligono' : 'linha', pontosPreviewLinha, previewPoligono);
      return;
    }

    if (!anotacaoInicio) return;
    if (anotacaoPreview) map.removeLayer(anotacaoPreview);

    if (anotacaoFerramenta === 'retangulo' || (anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'retangulo')) {
      anotacaoPreview = L.rectangle(L.latLngBounds(anotacaoInicio, e.latlng), Object.assign({}, lerEstiloFormaAnotacao(), {
        dashArray: '6,6'
      })).addTo(map);
      atualizarPreviewMedicoesForma('retangulo', [anotacaoInicio, e.latlng], false);
    }

    if (anotacaoFerramenta === 'circulo' || (anotacaoFerramenta === 'medicao' && anotacaoMedicaoFormaModo === 'circulo')) {
      anotacaoPreview = L.circle(anotacaoInicio, Object.assign({}, lerEstiloFormaAnotacao(), {
        radius: anotacaoInicio.distanceTo(e.latlng),
        dashArray: '6,6'
      })).addTo(map);
      atualizarPreviewMedicoesForma('circulo', [anotacaoInicio, e.latlng], false);
    }
  }

  function exportarArquivoAnotacoes() {
    var data = new Date().toISOString().slice(0, 10);
    var nomePadrao = 'anotacoes_mapa_pop2_' + data;
    var nomeInformado = window.prompt('Nome do arquivo GeoJSON:', nomePadrao);
    if (nomeInformado === null) return;
    var nomeArquivo = nomeArquivoSeguroAnotacao(nomeInformado) || nomePadrao;
    if (!/\.geojson$/i.test(nomeArquivo)) nomeArquivo += '.geojson';

    var blob = new Blob([JSON.stringify(exportarAnotacoesGeoJSON(), null, 2)], {
      type: 'application/geo+json'
    });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    document.body.removeChild(link);
    setStatusAnotacao('Anotações exportadas em GeoJSON');
  }

  function inicializarAnotacoes() {
    map.on('click', processarCliqueAnotacao);
    map.on('mousemove', processarMousemoveAnotacao);
    map.on('dblclick', function(e) {
      if (anotacaoFerramenta === 'linha' || anotacaoFerramenta === 'poligono' || anotacaoFerramenta === 'medicao') {
        if (e.originalEvent) {
          L.DomEvent.preventDefault(e.originalEvent);
          L.DomEvent.stopPropagation(e.originalEvent);
        }
        finalizarLinhaAnotacao();
      }
    });
    map.getContainer().addEventListener('contextmenu', function(e) {
      if (!anotacaoFerramenta) return;
      e.preventDefault();
      e.stopPropagation();
      if (anotacaoFerramenta === 'linha' || anotacaoFerramenta === 'poligono' || anotacaoFerramenta === 'medicao') finalizarLinhaAnotacao();
    }, true);

    var botoes = [
      ['drawLinha', 'linha'],
      ['drawPoligono', 'poligono'],
      ['drawMedicao', 'medicao'],
      ['drawPonto', 'ponto'],
      ['drawRetangulo', 'retangulo'],
      ['drawCirculo', 'circulo'],
      ['drawTexto', 'texto']
    ];
    botoes.forEach(function(item) {
      var botao = document.getElementById(item[0]);
      if (botao) botao.addEventListener('click', function() {
        ativarFerramentaAnotacao(item[1]);
      });
    });

    var limpar = document.getElementById('drawLimpar');
    if (limpar) limpar.addEventListener('click', function() {
      if (!anotacoesLayer.getLayers().length) return;
      if (!window.confirm('Limpar todas as anotações salvas neste navegador?')) return;
      anotacoesLayer.eachLayer(function(layer) {
        if (layer._anotacaoMedicaoMarcador) map.removeLayer(layer._anotacaoMedicaoMarcador);
        removerMedicoesFormaAnotacao(layer);
        removerPontosExtremosMedicao(layer);
      });
      anotacoesLayer.clearLayers();
      anotacoesHistorico = [];
      salvarAnotacoesLocal();
      renderizarLegendaAnotacoes();
    });

    var exportar = document.getElementById('drawExportar');
    if (exportar) exportar.addEventListener('click', exportarArquivoAnotacoes);

    var localizarKm = document.getElementById('drawLocalizarKm');
    var campoKmRodovia = document.getElementById('drawKmRodovia');
    if (localizarKm) localizarKm.addEventListener('click', marcarKmRodoviaSelecionada);
    if (campoKmRodovia) {
      campoKmRodovia.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          marcarKmRodoviaSelecionada();
        }
      });
    }

    var botaoLegendaAnotacoes = document.getElementById('toggleLegendaAnotacoes');
    if (botaoLegendaAnotacoes) {
      botaoLegendaAnotacoes.addEventListener('click', function() {
        legendaAnotacoesAtiva = !legendaAnotacoesAtiva;
        atualizarBotaoLegendaAnotacoes();
        renderizarLegendaAnotacoes();
      });
      atualizarBotaoLegendaAnotacoes();
    }

    ['drawCorLinha', 'drawEspessuraLinha', 'drawOpacidadePreenchimento', 'drawFormatoPonto', 'drawTamanhoPonto', 'drawCorTexto', 'drawTamanhoTexto'].forEach(function(id) {
      var campo = document.getElementById(id);
      if (campo) campo.addEventListener('input', atualizarIndicadoresEstiloAnotacao);
    });
    atualizarIndicadoresEstiloAnotacao();

    var importar = document.getElementById('drawImportar');
    var arquivo = document.getElementById('drawImportArquivo');
    if (importar && arquivo) {
      importar.addEventListener('click', function() { arquivo.click(); });
      arquivo.addEventListener('change', function() {
        var file = arquivo.files && arquivo.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function() {
          try {
            carregarAnotacoesGeoJSON(JSON.parse(reader.result), false);
            setStatusAnotacao('Anotações importadas e acrescentadas ao mapa');
          } catch (erro) {
            setStatusAnotacao('Não foi possível importar o arquivo');
            console.warn('Falha ao importar anotações:', erro);
          }
          arquivo.value = '';
        };
        reader.readAsText(file);
      });
    }

    carregarAnotacoesLocal();
    renderizarLegendaAnotacoes();
    if (!anotacoesLayer.getLayers().length) setStatusAnotacao('Sem ferramenta ativa');
  }

  inicializarAnotacoes();

  var oaeFiltroAtivo = false;
  var sreBaseFiltroAtivo = true;
  var snvFiltroAtivo = true;
  var localidadeFiltroAtivo = true;
  var aeroFiltroAtivo = true;
  var municipioBaseFiltroAtivo = true;
  var areasAmbientaisFiltroAtivo = false;
  var areasUrbanasFiltroAtivo = false;
  var areaInfluenciaFiltroAtivo = false;
  var densidadeRotulos = 0;

  var obrasFundeinfraData = [];
  var obrasFundeinfraPorLink = {};
  var obrasDorData = [];
  var obrasDorPorLink = {};
  var obrasDmaData = [];
  var obrasDmaPorLink = {};
  var obrasDplData = [];
  var obrasDplPorLink = {};
  var obrasDpjData = [];
  var obrasDpjPorLink = {};
  var dadosUnificadosPromise = null;
  var dadosUnificadosData = [];
  var dadosUnificadosPorGrupo = {};
  var obrasPontosTabelaData = [];
  var obrasPontosPorLink = {};

  function indexarObrasPorLink(registros, camposLink) {
    var indice = {};
    for (var i = 0; i < registros.length; i++) {
      var item = registros[i];
      var link = '';
      for (var c = 0; c < camposLink.length; c++) {
        link = item && item[camposLink[c]];
        if (link) break;
      }
      if (link) {
        var chave = String(link);
        if (!indice[chave]) indice[chave] = [];
        indice[chave].push(item);
      }
    }
    return indice;
  }
  function tipoRegistroDados(item) {
    return String((item && item.TIPO) || '').trim().toUpperCase();
  }

  function valorIntervencaoDados(dados) {
    return String((dados && dados.INTERVENCAO) || '').trim();
  }

  function normalizarRegistroDados(item) {
    var normalizado = Object.assign({}, item || {});
    normalizado.ORIGEM = origemNormalizadaObraPonto(normalizado);
    normalizado.INTERVENCAO = valorIntervencaoDados(normalizado);
    normalizado.SERVICO = normalizado.INTERVENCAO;
    if (normalizado.ITEM === null || normalizado.ITEM === undefined || String(normalizado.ITEM).trim() === '') {
      normalizado.ITEM = normalizado.REF || normalizado.IDCOD || '';
    }
    if (!normalizado.PROCESSO_SEI_CONTRATACAO && normalizado.SEI_OBRA_CONTRATO) {
      normalizado.PROCESSO_SEI_CONTRATACAO = normalizado.SEI_OBRA_CONTRATO;
    }
    return normalizado;
  }

  function carregarDadosUnificados() {
    if (!dadosUnificadosPromise) {
      dadosUnificadosPromise = carregarTabelaSupabase('dados')
        .then(function(resultado) {
          return Array.isArray(resultado) ? resultado.map(normalizarRegistroDados) : [];
        });
    }
    return dadosUnificadosPromise;
  }

  function registrosDadosPorTipo(registros, tipo) {
    var tipoNormalizado = String(tipo || '').trim().toUpperCase();
    return registros.filter(function(item) {
      return tipoRegistroDados(item) === tipoNormalizado;
    });
  }

  function registrosDadosPorUnidade(registros, unidade) {
    var unidadeNormalizada = String(unidade || '').trim().toUpperCase();
    return registros.filter(function(item) {
      return origemNormalizadaObraPonto(item) === unidadeNormalizada;
    });
  }

  function indexarDadosPorIdcod(registros) {
    var indice = {};
    for (var i = 0; i < registros.length; i++) {
      var item = registros[i];
      var idcod = item && item.IDCOD;
      if (idcod === null || idcod === undefined || String(idcod).trim() === '') continue;
      var chave = String(idcod).trim();
      if (!indice[chave]) indice[chave] = [];
      indice[chave].push(item);
    }
    return indice;
  }

  function chaveIdGrupo(dados) {
    var valor = dados && dados.IDGRUPO;
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
  }

  function chaveIdcod(dados) {
    var valor = dados && dados.IDCOD;
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
  }

  function indexarDadosPorGrupo(registros) {
    var indice = {};
    for (var i = 0; i < registros.length; i++) {
      var grupo = chaveIdGrupo(registros[i]);
      if (!grupo) continue;
      if (!indice[grupo]) indice[grupo] = [];
      indice[grupo].push(registros[i]);
    }
    return indice;
  }

  function expandirRegistrosPorGrupo(registros, opcoes) {
    if (!registros || !registros.length) return [];
    opcoes = opcoes || {};
    var selecionados = {};
    var resultado = [];
    var vistos = {};

    for (var s = 0; s < registros.length; s++) {
      var idSelecionado = chaveIdcod(registros[s]);
      if (idSelecionado && chaveIdGrupo(registros[s])) selecionados[idSelecionado] = true;
    }

    function adicionar(item) {
      if (!item) return;
      if (opcoes.tipo && tipoRegistroDados(item) !== String(opcoes.tipo).trim().toUpperCase()) return;
      if (opcoes.unidade && origemNormalizadaObraPonto(item) !== String(opcoes.unidade).trim().toUpperCase()) return;
      var id = chaveIdcod(item);
      var chave = (id || JSON.stringify(item)) + '|' + origemNormalizadaObraPonto(item) + '|' + tipoRegistroDados(item);
      if (vistos[chave]) return;
      vistos[chave] = true;
      var copia = Object.assign({}, item);
      if (chaveIdGrupo(item) && id && selecionados[id]) copia.__SELECIONADO_GRUPO = true;
      resultado.push(copia);
    }

    for (var i = 0; i < registros.length; i++) {
      var grupo = chaveIdGrupo(registros[i]);
      if (grupo && dadosUnificadosPorGrupo[grupo] && dadosUnificadosPorGrupo[grupo].length) {
        var membros = dadosUnificadosPorGrupo[grupo];
        for (var m = 0; m < membros.length; m++) adicionar(membros[m]);
      } else {
        adicionar(registros[i]);
      }
    }

    resultado.sort(function(a, b) {
      return String(chaveIdGrupo(a)).localeCompare(String(chaveIdGrupo(b)), 'pt-BR', { numeric: true }) ||
        String(chaveIdcod(a)).localeCompare(String(chaveIdcod(b)), 'pt-BR', { numeric: true });
    });
    return resultado;
  }

  function tabelaTemGrupo(registros) {
    if (!registros) return false;
    for (var i = 0; i < registros.length; i++) {
      if (chaveIdGrupo(registros[i])) return true;
    }
    return false;
  }

  function valorTituloGrupo(valor) {
    var exibicao = valorExibicao(valor);
    return exibicao === '' ? '' : String(exibicao);
  }

  function tituloTabelaComGrupo(titulo, registros) {
    var grupos = [];
    var extensoes = [];
    for (var i = 0; i < registros.length; i++) {
      var grupo = chaveIdGrupo(registros[i]);
      if (!grupo) continue;
      adicionarUnico(grupos, grupo);
      var ext = valorTituloGrupo(registros[i] && registros[i].EXT_CONTRATO_KM);
      if (ext) adicionarUnico(extensoes, ext);
    }
    if (!grupos.length) return titulo;
    var partes = [titulo + ' - Grupo ' + grupos.join(', ')];
    if (extensoes.length) partes.push('Ext. Contrato ' + extensoes.join(', ') + ' km');
    return partes.join(' - ');
  }

  function camposTabelaAjustadosPorGrupo(campos, registros) {
    return campos;
  }
  function carregarJsonOpcional(nome) {
    return fetch(nome)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + nome);
        return r.json();
      })
      .catch(function(e) {
        console.warn('Tabela opcional nao carregada:', nome, e);
        return [];
      });
  }

  function origemNormalizadaObraPonto(dados) {
    var origem = String((dados && (dados.ORIGEM || dados.UNIDADE)) || 'FUNDEINFRA').trim().toUpperCase();
    return origem || 'FUNDEINFRA';
  }

  function numeroCoordenadaObraPonto(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') return null;
    var numero = Number(String(valor).trim().replace(',', '.'));
    return isFinite(numero) ? numero : null;
  }

  function criarFeatureObraPontoCoordenada(item) {
    var lat = numeroCoordenadaObraPonto(item && item.LATITUDE);
    var lon = numeroCoordenadaObraPonto(item && item.LONGITUDE);
    if (lat === null || lon === null) return null;
    if ((lat < -35 || lat > 10) && lon >= -35 && lon <= 10 && lat >= -75 && lat <= -30) {
      var coordenadaInvertida = lat;
      lat = lon;
      lon = coordenadaInvertida;
    }
    if (lat < -35 || lat > 10 || lon < -75 || lon > -30) return null;

    var props = Object.assign({}, item || {});
    props.ORIGEM = origemNormalizadaObraPonto(props);
    props.RODOVIA = props.RODOVIA || '';
    props.trecho = props.TRECHO || props.DESCRICAO || props.LOCALIDADE || '';
    var dadosObra = Object.assign({}, props);
    props.__PONTO_TABELA_COORDENADA = true;
    props.__CHAVE_AGREGADORA_PONTO = String(props.IDCOD || '').trim();
    props.__DADOS_OBRA_PONTO = dadosObra;

    return {
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'Point',
        coordinates: [lon, lat]
      }
    };
  }

  function atualizarObrasPontosDataComCoordenadas() {
    var featuresBase = obrasPontosBaseData && obrasPontosBaseData.features ? obrasPontosBaseData.features : [];
    var featuresCoordenadas = obrasPontosCoordenadasData && obrasPontosCoordenadasData.features ? obrasPontosCoordenadasData.features : [];
    var origensCoordenadas = {};

    for (var i = 0; i < featuresCoordenadas.length; i++) {
      var dadosCoord = dadosObrasPontosDaFeature(featuresCoordenadas[i]);
      origensCoordenadas[origemObraPonto(dadosCoord)] = true;
    }

    var featuresFiltradas = featuresBase.filter(function(feature) {
      var dados = dadosObrasPontosDaFeatureTodos(feature);
      for (var d = 0; d < dados.length; d++) {
        if (origensCoordenadas[origemObraPonto(dados[d])]) return false;
      }
      return true;
    });

    obrasPontosData = {
      type: 'FeatureCollection',
      features: featuresFiltradas.concat(featuresCoordenadas)
    };
  }

  function carregarTabelaObrasPontos() {
    carregarDadosUnificados().then(function(registros) {
      var tabelaLegada = [];
      var tabelaCoordenadas = registrosDadosPorTipo(registros, 'Ponto');
      var featuresCoordenadas = [];
      var origensCoordenadas = {};

      var featuresCoordenadasPorIdcod = {};
      for (var c = 0; c < tabelaCoordenadas.length; c++) {
        var itemCoord = Object.assign({}, tabelaCoordenadas[c]);
        itemCoord.ORIGEM = origemNormalizadaObraPonto(itemCoord);
        var chaveIdcod = String(itemCoord.IDCOD || '').trim();
        if (!chaveIdcod) continue;
        origensCoordenadas[itemCoord.ORIGEM] = true;
        if (featuresCoordenadasPorIdcod[chaveIdcod]) continue;
        var featureCoord = criarFeatureObraPontoCoordenada(itemCoord);
        if (!featureCoord) continue;
        featuresCoordenadasPorIdcod[chaveIdcod] = featureCoord;
        featuresCoordenadas.push(featureCoord);
      }

      obrasPontosCoordenadasData = {
        type: 'FeatureCollection',
        features: featuresCoordenadas
      };

      obrasPontosTabelaData = tabelaLegada.filter(function(item) {
        return !origensCoordenadas[origemNormalizadaObraPonto(item)];
      }).concat(tabelaCoordenadas.map(function(item) {
        var normalizado = Object.assign({}, item);
        normalizado.ORIGEM = origemNormalizadaObraPonto(normalizado);
        return normalizado;
      }));

      obrasPontosPorLink = {};
      for (var i = 0; i < obrasPontosTabelaData.length; i++) {
        var item = obrasPontosTabelaData[i];
        var chave = item && (item.IDCOD || item.LINK);
        if (!chave) continue;
        chave = String(chave).trim();
        if (!obrasPontosPorLink[chave]) obrasPontosPorLink[chave] = [];
        obrasPontosPorLink[chave].push(item);
      }

      atualizarObrasPontosDataComCoordenadas();
      console.log('OBRAS_PONTOS/DADOS carregados:', obrasPontosTabelaData.length, 'registros; pontos por coordenada:', featuresCoordenadas.length);
      if (municipiosData) preencherPropostas();
      if (obrasPontosData && municipiosData) aplicarFiltros();
    }).catch(function(e) {
      console.warn('Falha ao carregar tabelas de obras pontuais:', e);
    });
  }
  function atualizarDadosObrasUnificadas(registros) {
    dadosUnificadosData = registros || [];
    dadosUnificadosPorGrupo = indexarDadosPorGrupo(dadosUnificadosData);
    var linhas = registrosDadosPorTipo(registros, 'Link');
    obrasFundeinfraData = registrosDadosPorUnidade(linhas, 'FUNDEINFRA');
    obrasDorData = registrosDadosPorUnidade(linhas, 'DOR');
    obrasDmaData = registrosDadosPorUnidade(linhas, 'DMA');
    obrasDplData = registrosDadosPorUnidade(linhas, 'DPL');
    obrasDpjData = registrosDadosPorUnidade(linhas, 'DPJ');

    var indiceFundeinfra = indexarDadosPorIdcod(obrasFundeinfraData);
    obrasFundeinfraPorLink = {};
    Object.keys(indiceFundeinfra).forEach(function(chave) {
      obrasFundeinfraPorLink[chave] = indiceFundeinfra[chave][0];
    });
    obrasDorPorLink = indexarDadosPorIdcod(obrasDorData);
    obrasDmaPorLink = indexarDadosPorIdcod(obrasDmaData);
    obrasDplPorLink = indexarDadosPorIdcod(obrasDplData);
    obrasDpjPorLink = indexarDadosPorIdcod(obrasDpjData);

    console.log('DADOS.json linhas carregadas:', linhas.length);
    preencherIntervencaos();
    if (sreData && municipiosData) {
      preencherRodovias();
      preencherSREs();
      preencherPropostas();
      aplicarFiltros();
    }
  }

  function carregarTabelasDadosUnificados() {
    carregarDadosUnificados()
      .then(atualizarDadosObrasUnificadas)
      .catch(function(e) {
        console.warn('Falha ao carregar dados unificados:', e);
      });
  }

  carregarTabelasDadosUnificados();
  carregarTabelaObrasPontos();
  
  
  function atualizarBotoesBase() {
    atualizarBotoesRegionais();
    atualizarBotoesAlteracoes();
    var btnOAE = document.getElementById('toggleOAE');
    if (btnOAE) btnOAE.classList.toggle('ativo-filtro', oaeFiltroAtivo);
    document.getElementById('toggleSREBase').classList.toggle('ativo-filtro', sreBaseFiltroAtivo);
    document.getElementById('toggleSNV').classList.toggle('ativo-filtro', snvFiltroAtivo);
    var btnLocalidades = document.getElementById('toggleLocalidades');
    if (btnLocalidades) {
      btnLocalidades.classList.toggle('ativo-filtro', localidadeFiltroAtivo);
    }
    var btnAero = document.getElementById('toggleAero');
    if (btnAero) {
      btnAero.classList.toggle('ativo-filtro', aeroFiltroAtivo);
    }
    var btnMunicipios = document.getElementById('toggleMunicipiosBase');
    if (btnMunicipios) {
      btnMunicipios.classList.toggle('ativo-filtro', municipioBaseFiltroAtivo);
    }
    var btnAreasAmbientais = document.getElementById('toggleAreasAmbientais');
    if (btnAreasAmbientais) {
      btnAreasAmbientais.classList.toggle('ativo-filtro', areasAmbientaisFiltroAtivo);
    }
    var btnAreasUrbanas = document.getElementById('toggleAreasUrbanas');
    if (btnAreasUrbanas) {
      btnAreasUrbanas.classList.toggle('ativo-filtro', areasUrbanasFiltroAtivo);
    }
    var btnBuffer = document.getElementById('toggleBuffer');
    btnBuffer.classList.toggle('ativo-filtro', bufferFiltroAtivo);
    btnBuffer.setAttribute('aria-pressed', String(bufferFiltroAtivo));
    var btnFerrovias = document.getElementById('toggleFerrovias');
    if (btnFerrovias) {
      btnFerrovias.classList.toggle('ativo-filtro', ferroviasFiltroAtivo);
      btnFerrovias.setAttribute('aria-pressed', String(ferroviasFiltroAtivo));
    }
    var btnAreaInfluencia = document.getElementById('toggleAreaInfluencia');
    if (btnAreaInfluencia) {
      btnAreaInfluencia.classList.toggle('ativo-filtro', areaInfluenciaFiltroAtivo || areaInfluenciaSelecionada);
      btnAreaInfluencia.setAttribute('aria-pressed', String(areaInfluenciaFiltroAtivo || areaInfluenciaSelecionada));
    }
    atualizarBotoesAlteracoes();
  }


  function limparCamadasRegras() {
    for (var i = 0; i < regraLayers.length; i++) {
      map.removeLayer(regraLayers[i]);
    }
    regraLayers = [];
    if (obrasLabelLayer) {
      map.removeLayer(obrasLabelLayer);
      obrasLabelLayer = null;
    }
    if (obrasPontosLayer) {
      map.removeLayer(obrasPontosLayer);
      obrasPontosLayer = null;
    }
    if (aeroObrasIconLayer) {
      map.removeLayer(aeroObrasIconLayer);
      aeroObrasIconLayer = null;
    }
    if (alteracoesLayer) {
      map.removeLayer(alteracoesLayer);
      alteracoesLayer = null;
    }
    aeroObrasClusterRefs = [];
  }


  function valorSeguro(obj, campo) {
    if (obj == null || obj.properties == null) return '';
    var valor = obj.properties[campo];
    if (valor === null || valor === undefined) {
      var campoNormalizado = String(campo).toLowerCase();
      var chaves = Object.keys(obj.properties);
      for (var i = 0; i < chaves.length; i++) {
        if (String(chaves[i]).toLowerCase() === campoNormalizado) {
          valor = obj.properties[chaves[i]];
          break;
        }
      }
    }
    if (valor === null || valor === undefined) {
      var aliasesLinkIdcod = {
        LINK_FUND: 'IDCOD_FUND',
        LINK_DOR: 'IDCOD_DOR',
        LINK_DMA: 'IDCOD_DMA',
        LINK_DPL: 'IDCOD_DPL',
        LINK_DPJ: 'IDCOD_DPJ',
        LINK_DOC: 'IDCOD_DOC',
        LINK_DSV: 'IDCOD_DSV'
      };
      var alias = aliasesLinkIdcod[String(campo || '').toUpperCase()];
      if (alias) valor = valorSeguro(obj, alias);
    }
    if (valor === null || valor === undefined) return '';
    return typeof valor === 'string' ? valor.trim() : valor;
  }

  function featureComOrigemIntervencao(feature, origem) {
    if (!feature) return feature;
    var props = Object.assign({}, feature.properties || {});
    props.__ORIGEM_INTERVENCAO = origem;

    return {
      type: feature.type || 'Feature',
      id: feature.id,
      properties: props,
      geometry: feature.geometry
    };
  }

  function origemIntervencaoFeature(feature) {
    return valorSeguro(feature, '__ORIGEM_INTERVENCAO');
  }

  function numeroSeguro(v) {
    if (v === null || v === undefined || String(v).trim() === '') return 0;
    return Number(v);
  }

  function formatarNumeroPopup(valor, casas) {
    var numero = Number(valor);
    if (!isFinite(numero)) return valor || '';
    return numero.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: casas
    });
  }

  function valorCampoAreaBase(feature, campo) {
    if (campo.nomes && campo.nomes.length) {
      for (var i = 0; i < campo.nomes.length; i++) {
        var valorAlternativo = valorSeguro(feature, campo.nomes[i]);
        if (valorAlternativo !== '') return valorAlternativo;
      }
      return '';
    }
    return valorSeguro(feature, campo.nome);
  }

  function construirPopupAreaBase(feature, tituloFallback, campos) {
    var html = '<b>' + escapeHtml(tituloFallback) + '</b>';
    campos.forEach(function(campo) {
      var valor = valorCampoAreaBase(feature, campo);
      if (valor === '') return;
      if (campo.tipo === 'numero') valor = formatarNumeroPopup(valor, campo.casas || 2);
      html += '<br><b>' + escapeHtml(campo.rotulo) + ':</b> ' + escapeHtml(valor);
    });
    return html;
  }

  function numeroPrograma(feature, campo) {
    return numeroSeguro(valorSeguro(feature, campo));
  }

  function corOAE(eixo) {
    eixo = Number(eixo);
    if (eixo === 1) return '#00ffff';
    if (eixo === 2) return '#ffff00';
    if (eixo === 3) return '#ff0000';
    if (eixo === 4) return '#2f80ed';
    if (eixo === 5) return '#00ff00';
    if (eixo === 6) return '#ff4dc4';
    if (eixo === 100) return '#8B5A00';
    if (eixo === 101) return '#999999';
    return '#cccccc';
  }

  function nomeTipoOAE(eixo) {
    eixo = Number(eixo);
    if (eixo === 1) return 'Eixo 1';
    if (eixo === 2) return 'Eixo 2';
    if (eixo === 3) return 'Eixo 3';
    if (eixo === 4) return 'Eixo 4';
    if (eixo === 5) return 'Eixo 5';
    if (eixo === 6) return 'Eixo 6';
    if (eixo === 100) return 'Bueiro';
    if (eixo === 101) return 'Viaduto';
    return 'Outro';
  }

  function marcadorLosango(latlng, cor) {
    return L.marker(latlng, {
      icon: L.divIcon({
        className: '',
        html:
          '<div style="' +
          'width:12px;' +
          'height:12px;' +
          'background:' + cor + ';' +
          'border:2px solid #000;' +
          'transform: rotate(45deg);' +
          'box-sizing:border-box;' +
          '"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    });
  }


  function rotuloRodoviaCampos(feature) {
    return (
      valorSeguro(feature, 'rodovia') ||
      valorSeguro(feature, 'RODOVIA') ||
      valorSeguro(feature, 'sg_rodovia') ||
      valorSeguro(feature, 'SNV') ||
      ''
    );
  }

  function podeMostrarRotulo() {
    return map.getZoom() >= 9;
  }

  function preencherRGPlan() {
    var select = document.getElementById('rgPlanSelect');
    var valores = [];

    for (var i = 0; i < municipiosData.features.length; i++) {
      var rg = nomeRegiaoPlanejamento(municipiosData.features[i]);
      if (rg && valores.indexOf(rg) === -1) valores.push(rg);
    }

    valores.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var j = 0; j < valores.length; j++) {
      var opt = document.createElement('option');
      opt.value = valores[j];
      opt.textContent = valores[j];
      select.appendChild(opt);
    }
  }


  function nomeRodoviaFeature(feature) {
    return (
      valorSeguro(feature, 'rodovia') ||
      valorSeguro(feature, 'RODOVIA') ||
      valorSeguro(feature, 'Rodovia') ||
      ''
    );
  }


  function nomeSREFeature(feature) {
    return (
      valorSeguro(feature, 'sre') ||
      valorSeguro(feature, 'SRE') ||
      ''
    );
  }
  function valorTrechoFeature(feature) {
    return (
      valorSeguro(feature, 'trecho') ||
      valorSeguro(feature, 'trecho_go') ||
      valorSeguro(feature, 'TRECHO_GO') ||
      ''
    );
  }

  function valorExtensaoKmFeature(feature) {
    return (
      valorSeguro(feature, 'EXT_KM') ||
      valorSeguro(feature, 'ext_km') ||
      valorSeguro(feature, 'ext') ||
      valorSeguro(feature, 'EXTENSAO') ||
      valorSeguro(feature, 'Extensao') ||
      ''
    );
  }
  function numeroRodoviaParaOrdenacao(rodovia) {
    var match = String(rodovia || '').match(/\d+/);
    if (!match) return Infinity;
    var numero = Number(match[0]);
    return isFinite(numero) ? numero : Infinity;
  }

  function compararRodoviasPorMenorValor(a, b) {
    var numA = numeroRodoviaParaOrdenacao(a);
    var numB = numeroRodoviaParaOrdenacao(b);
    if (numA !== numB) return numA - numB;
    return String(a || '').localeCompare(String(b || ''), 'pt-BR');
  }

  function tokenCoordenadaSRE(coord) {
    if (!coord || coord.length < 2) return '';
    return Number(coord[0]).toFixed(7) + ',' + Number(coord[1]).toFixed(7);
  }

  function atualizarHashSRE(hash, texto) {
    for (var i = 0; i < texto.length; i++) {
      hash = ((hash << 5) - hash + texto.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function chaveLinhaSRE(coords) {
    if (!coords || coords.length < 2) return '';
    var primeiro = tokenCoordenadaSRE(coords[0]);
    var ultimo = tokenCoordenadaSRE(coords[coords.length - 1]);
    var reverso = ultimo < primeiro;
    var hash = 0;
    for (var i = 0; i < coords.length; i++) {
      var indice = reverso ? coords.length - 1 - i : i;
      hash = atualizarHashSRE(hash, tokenCoordenadaSRE(coords[indice]) + '|');
    }
    return coords.length + ':' + (hash >>> 0).toString(36);
  }

  function chaveGeometriaSRE(feature) {
    if (!feature) return '';
    if (feature.__chaveGeometriaSRE !== undefined) return feature.__chaveGeometriaSRE;
    var geometry = feature.geometry;
    var chaveFinal = '';
    if (geometry && geometry.coordinates) {
      if (geometry.type === 'LineString') {
        chaveFinal = chaveLinhaSRE(geometry.coordinates);
      } else if (geometry.type === 'MultiLineString') {
        var partes = [];
        for (var i = 0; i < geometry.coordinates.length; i++) {
          var chave = chaveLinhaSRE(geometry.coordinates[i]);
          if (chave) partes.push(chave);
        }
        chaveFinal = partes.sort().join('||');
      }
    }
    feature.__chaveGeometriaSRE = chaveFinal;
    return chaveFinal;
  }

  function construirIndiceSREBaseCoincidencias() {
    sreBaseCoincidenciasIndex = {};
    if (!sreBaseData || !sreBaseData.features) return;

    for (var i = 0; i < sreBaseData.features.length; i++) {
      var feature = sreBaseData.features[i];
      var chave = chaveGeometriaSRE(feature);
      if (!chave) continue;
      if (!sreBaseCoincidenciasIndex[chave]) sreBaseCoincidenciasIndex[chave] = [];
      var rodovia = nomeRodoviaFeature(feature);
      var sre = nomeSREFeature(feature);
      if (!rodovia && !sre) continue;
      sreBaseCoincidenciasIndex[chave].push({ feature: feature, rodovia: rodovia, sre: sre });
    }

    Object.keys(sreBaseCoincidenciasIndex).forEach(function(chave) {
      sreBaseCoincidenciasIndex[chave].sort(function(a, b) {
        return compararRodoviasPorMenorValor(a.rodovia, b.rodovia) ||
          String(a.sre || '').localeCompare(String(b.sre || ''), 'pt-BR');
      });
    });
  }

  function featuresSRESobrepostas(feature) {
    var chave = chaveGeometriaSRE(feature);
    if (!chave) return [];
    if (!sreBaseCoincidenciasIndex) construirIndiceSREBaseCoincidencias();
    return sreBaseCoincidenciasIndex[chave] || [];
  }

  function featureRotuloMenorRodovia(features) {
    var escolhida = null;
    for (var i = 0; i < features.length; i++) {
      var feature = features[i];
      var rodovia = nomeRodoviaFeature(feature);
      if (!rodovia) continue;
      if (!escolhida || compararRodoviasPorMenorValor(rodovia, nomeRodoviaFeature(escolhida)) < 0) {
        escolhida = feature;
      }
    }
    return escolhida;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function construirPopupRodoviaBase(feature) {
    var coincidentes = featuresSRESobrepostas(feature);
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var usarMenorRodoviaComoPrincipal = !rodoviaSelecionada && !sreSelecionado && coincidentes.length > 1;
    var principal = usarMenorRodoviaComoPrincipal && coincidentes[0] && coincidentes[0].feature ? coincidentes[0].feature : feature;
    var p = principal.properties || {};
    var html = '';
    var srePrincipal = nomeSREFeature(principal);
    var sresCoincidentes = coincidentes
      .filter(function(item) {
        return item.sre && item.sre !== srePrincipal;
      })
      .map(function(item) {
        return item.sre;
      });

    // Ordem específica dos campos
    var campos = [
      { chave: 'rodovia', rotulo: 'RODOVIA' },
      { chave: 'trecho', rotulo: 'TRECHO' },
      { chave: 'situacao', rotulo: 'SITUAÇÃO' },
      { chave: 'sre', rotulo: 'SRE' },
      { chave: 'ext', rotulo: 'EXTENSÃO' }
    ];

    for (var i = 0; i < campos.length; i++) {
      var campo = campos[i];
      var valor = p[campo.chave];
      if (valor === null || valor === undefined || String(valor).trim() === '') continue;
      html += '<b>' + escapeHtml(campo.rotulo) + ':</b> ' + escapeHtml(valor);
      if (campo.chave === 'sre' && sresCoincidentes.length) {
        html += '<br><b>SREs coincidentes:</b> ' + escapeHtml(sresCoincidentes.join(', '));
      }
      html += '<br>';
    }

    if (!html) {
      html = '<b>Rodovia:</b> ' + escapeHtml(rotuloRodoviaCampos(feature));
    }

    return html;
  }

  function preencherSREs() {
    var select = document.getElementById('sreSelect');
    var valorAtual = select.value;
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var filtrarPorOrigemIntervencaoProposta = filtroOrigemIntervencaoPropostaAtivo();
    var sres = [];

    select.innerHTML = '<option value="">Todos</option>';

    function considerarFeature(feature) {
      if (!featureAtendeRegioes(feature)) return;
      var sre = nomeSREFeature(feature);
      var rodovia = nomeRodoviaFeature(feature);

      if (!sre) return;
      if (rodoviaSelecionada && rodovia !== rodoviaSelecionada) return;
      if (filtrarPorOrigemIntervencaoProposta && feature.geometry && !featureAtendeOrigemIntervencaoProposta(feature)) return;
      adicionarUnico(sres, sre);
    }

    if (sreData && sreData.features) {
      sreData.features.forEach(considerarFeature);
    }
    if (sreBaseData && sreBaseData.features) {
      sreBaseData.features.forEach(considerarFeature);
    }
    if (obrasPontosData && obrasPontosData.features) {
      obrasPontosData.features.forEach(considerarFeature);
    }

    sres.sort(function(a,b){ return String(a).localeCompare(String(b), 'pt-BR'); });
    sres.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      select.appendChild(opt);
    });

    select.value = sres.indexOf(valorAtual) !== -1 ? valorAtual : '';
  }

  function preencherPropostas() {
    var select = document.getElementById('propostaSelect');
    if (!select) return;
    var valorAtual = select.value;

    var respeitarOrigem = algumaOrigemAtiva();
    var propostas = [];

    select.innerHTML = '<option value="">Todas</option>';

    function considerarFeature(feature) {
      var dadosFund = dadosFundeinfraDaFeature(feature);

      if (respeitarOrigem && !servicosAtivos.FUNDEINFRA) return;
      if (servicoFiltroAtivo && (!dadosFund || dadosFund.INTERVENCAO !== servicoFiltroAtivo)) return;

      if (dadosFund && dadosFund.PROPOSTA !== null && dadosFund.PROPOSTA !== undefined && String(dadosFund.PROPOSTA).trim() !== '') {
        adicionarUnico(propostas, String(dadosFund.PROPOSTA));
      }
    }

    if (sreData && sreData.features) {
      sreData.features.forEach(considerarFeature);
    }

    if (obrasPontosData && obrasPontosData.features && (!respeitarOrigem || servicosAtivos.FUNDEINFRA) && !servicoFiltroAtivo) {
      for (var p = 0; p < obrasPontosData.features.length; p++) {
        var featurePonto = obrasPontosData.features[p];
        var dadosPonto = dadosObrasPontosDaFeature(featurePonto);
        if (!dadosPonto || origemObraPonto(dadosPonto) !== 'FUNDEINFRA') continue;
        if (dadosPonto && dadosPonto.PROPOSTA !== null && dadosPonto.PROPOSTA !== undefined && String(dadosPonto.PROPOSTA).trim() !== '') {
          adicionarUnico(propostas, String(dadosPonto.PROPOSTA));
        }
      }
    }

    propostas.sort(function(a, b) { return Number(a) - Number(b); });
    propostas.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });

    select.value = propostas.indexOf(valorAtual) !== -1 ? valorAtual : '';
  }

  function preencherIntervencaos() {
    var select = document.getElementById('servicoSelect');
    if (!select) return;
    var valorAtual = select.value;
    select.innerHTML = '<option value="">Todos</option>';

    var servicos = [];

    function addIntervencaos(lista) {
      for (var i = 0; i < lista.length; i++) {
        var s = lista[i] && lista[i].INTERVENCAO;
        if (s && servicos.indexOf(s) === -1) servicos.push(s);
      }
    }

    function addIntervencaosPontos(lista) {
      for (var i = 0; i < lista.length; i++) {
        var item = lista[i];
        var origem = origemObraPonto(item);
        if (respeitarOrigem && !servicosAtivos[origem]) continue;
        var s = valorFiltroObraPonto(item);
        if (s && servicos.indexOf(s) === -1) servicos.push(s);
      }
    }

    var respeitarOrigem = algumaOrigemAtiva();
    if (!respeitarOrigem || servicosAtivos.FUNDEINFRA) addIntervencaos(obrasFundeinfraData);
    if (!respeitarOrigem || servicosAtivos.DOR) addIntervencaos(obrasDorData);
    if (!respeitarOrigem || servicosAtivos.DMA) addIntervencaos(obrasDmaData);
    if (!respeitarOrigem || servicosAtivos.DPJ) addIntervencaos(obrasDpjData);
    if (!respeitarOrigem || servicosAtivos.DPL) addIntervencaos(obrasDplData);
    addIntervencaosPontos(obrasPontosTabelaData);

    servicos.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    servicos.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      select.appendChild(opt);
    });

    if (valorAtual && servicos.indexOf(valorAtual) !== -1) {
      select.value = valorAtual;
      servicoFiltroAtivo = valorAtual;
    } else {
      select.value = '';
      servicoFiltroAtivo = '';
    }
  }

  function obterFeaturesZoomIntervencaos() {
    var rgSelecionada = regioesSelecionadas('rgPlanSelect');
    var municipioSelecionado = document.getElementById('municipioSelect').value;
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';

    var feats = [];
    var featuresMunicipios = municipiosFiltrados();

    function considerarFeature(f, base) {
      if (!featureAtendeRegioes(f)) return;
      var nmMun = valorSeguro(f, 'NM_MUN');
      var rgPlan = nomeRegiaoPlanejamento(f);
      var rodovia = nomeRodoviaFeature(f);
      var sre = nomeSREFeature(f);

      if (municipioSelecionado && nmMun && nmMun !== municipioSelecionado) return;
      if (!municipioSelecionado && rgSelecionada.length && rgPlan && !rgSelecionada.includes(rgPlan)) return;
      if (rodoviaSelecionada && rodovia !== rodoviaSelecionada) return;
      if (sreSelecionado && sre !== sreSelecionado) return;
      if (propostaSelecionada) {
        var dadosFund = servicosAtivos.FUNDEINFRA ? dadosFundeinfraDaFeatureFiltrado(f, propostaSelecionada) : null;
        if (!dadosFund) return;
      }

      feats.push(f);
    }

    if (sreData && sreData.features) {
      for (var i = 0; i < sreData.features.length; i++) considerarFeature(sreData.features[i]);
    }
    if (sreBaseData && sreBaseData.features && (rodoviaSelecionada || sreSelecionado) && !propostaSelecionada) {
      for (var j = 0; j < sreBaseData.features.length; j++) considerarFeature(sreBaseData.features[j], true);
    }
    if (snvData && snvData.features && rodoviaSelecionada && !propostaSelecionada) {
      for (var k = 0; k < snvData.features.length; k++) considerarFeature(snvData.features[k], true);
    }
    if (obrasPontosData && obrasPontosData.features && algumaOrigemObraPontoAtiva()) {
      for (var p = 0; p < obrasPontosData.features.length; p++) {
        var featurePonto = obrasPontosData.features[p];
        var coordsPonto = featurePonto.geometry && featurePonto.geometry.coordinates;
        if (!coordsPonto || coordsPonto.length < 2) continue;
        if (!pontoDentroSelecaoMunicipios(coordsPonto[0], coordsPonto[1], featuresMunicipios)) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(featurePonto) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(featurePonto) !== sreSelecionado) continue;
        if (!dadosObrasPontosFiltrados(featurePonto, propostaSelecionada).length) continue;
        feats.push(featurePonto);
      }
    }
    return feats;
  }

  function obterFeaturesZoomPropostaFundeinfra(propostaSelecionada) {
    var rgSelecionada = regioesSelecionadas('rgPlanSelect');
    var municipioSelecionado = document.getElementById('municipioSelect').value;
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var feats = [];

    if (!propostaSelecionada || !sreData || !sreData.features) return feats;

    for (var i = 0; i < sreData.features.length; i++) {
      var feature = sreData.features[i];
      if (!featureAtendeRegioes(feature)) continue;
      var dadosFund = dadosFundeinfraDaFeature(feature);
      if (!dadosFund || String(dadosFund.PROPOSTA) !== String(propostaSelecionada)) continue;
      if (servicoFiltroAtivo && dadosFund.INTERVENCAO !== servicoFiltroAtivo) continue;

      var nmMun = valorSeguro(feature, 'NM_MUN');
      var rgPlan = nomeRegiaoPlanejamento(feature);
      var rodovia = nomeRodoviaFeature(feature);
      var sre = nomeSREFeature(feature);

      if (municipioSelecionado && nmMun && nmMun !== municipioSelecionado) continue;
      if (!municipioSelecionado && rgSelecionada.length && rgPlan && !rgSelecionada.includes(rgPlan)) continue;
      if (rodoviaSelecionada && rodovia !== rodoviaSelecionada) continue;
      if (sreSelecionado && sre !== sreSelecionado) continue;

      feats.push(feature);
    }

    return feats;
  }

  function zoomParaPropostaFundeinfra() {
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    if (!propostaSelecionada) return false;

    var featsProposta = obterFeaturesZoomPropostaFundeinfra(propostaSelecionada);
    if (!featsProposta.length) return false;

    zoomParaSelecao(featsProposta);
    return true;
  }

  function preencherRodovias() {
    var select = document.getElementById('rodoviaSelect');
    var valorAtual = select.value;
    var filtrarPorOrigemIntervencaoProposta = filtroOrigemIntervencaoPropostaAtivo();
    var rodovias = [];

    select.innerHTML = '<option value="">Todas</option>';

    function considerarFeature(feature) {
      if (!featureAtendeRegioes(feature)) return;
      var nome = nomeRodoviaFeature(feature);

      if (!nome) return;
      if (filtrarPorOrigemIntervencaoProposta && feature.geometry && !featureAtendeOrigemIntervencaoProposta(feature)) return;
      adicionarUnico(rodovias, nome);
    }

    if (sreData && sreData.features) {
      sreData.features.forEach(considerarFeature);
    }
    if (sreBaseData && sreBaseData.features) {
      sreBaseData.features.forEach(considerarFeature);
    }
    if (snvData && snvData.features) {
      snvData.features.forEach(considerarFeature);
    }
    if (obrasPontosData && obrasPontosData.features) {
      obrasPontosData.features.forEach(considerarFeature);
    }

    rodovias.sort(function(a,b){ return String(a).localeCompare(String(b), 'pt-BR'); });
    rodovias.forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      select.appendChild(opt);
    });

    select.value = rodovias.indexOf(valorAtual) !== -1 ? valorAtual : '';
  }

  function preencherMunicipios() {
    var select = document.getElementById('municipioSelect');
    var nomes = [];
    select.innerHTML = '<option value="">Todos</option>';

    for (var i = 0; i < municipiosData.features.length; i++) {
      var nome = valorSeguro(municipiosData.features[i], 'NM_MUN');
      if (nome && nomes.indexOf(nome) === -1) nomes.push(nome);
    }

    nomes.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var j = 0; j < nomes.length; j++) {
      var opt = document.createElement('option');
      opt.value = nomes[j];
      opt.textContent = nomes[j];
      select.appendChild(opt);
    }
  }

  function atualizarMunicipiosPorRegiao() {
    var rgSelecionada = regioesSelecionadas('rgPlanSelect');
    var select = document.getElementById('municipioSelect');
    var nomes = [];
    select.innerHTML = '<option value="">Todos</option>';

    for (var i = 0; i < municipiosData.features.length; i++) {
      var f = municipiosData.features[i];
      var nome = valorSeguro(f, 'NM_MUN');
      var rg = nomeRegiaoPlanejamento(f);

      if (nome && (!rgSelecionada.length || rgSelecionada.includes(rg)) && featureAtendeRegioes(f) && nomes.indexOf(nome) === -1) {
        nomes.push(nome);
      }
    }

    nomes.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var j = 0; j < nomes.length; j++) {
      var opt = document.createElement('option');
      opt.value = nomes[j];
      opt.textContent = nomes[j];
      select.appendChild(opt);
    }
  }

  function preencherLocalidades() {
    var select = document.getElementById('localidadeSelect');
    var nomes = [];
    select.innerHTML = '<option value="">Todas</option>';

    for (var i = 0; i < localidadesData.features.length; i++) {
      var nome = valorSeguro(localidadesData.features[i], 'NOME_ACEN');
      if (nome && nomes.indexOf(nome) === -1) nomes.push(nome);
    }

    nomes.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var j = 0; j < nomes.length; j++) {
      var opt = document.createElement('option');
      opt.value = nomes[j];
      opt.textContent = nomes[j];
      select.appendChild(opt);
    }
  }

  function resetarBotoesPrograma() {
    var botoes = document.querySelectorAll('.programa-btn');
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].classList.remove('ativo-filtro');
      botoes[i].classList.remove('ativo-municipio');
    }
  }

    function resetarBotoesIntervencao() {
    var botoes = document.querySelectorAll('.servico-btn');
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].classList.remove('ativo-filtro');
      botoes[i].classList.remove('ativo-municipio');
    }
  }

  function resetarSelectIntervencao() {
    document.getElementById('servicoSelect').value = '';
    servicoFiltroAtivo = '';
  }

  function resetarBotaoOAE() {
    var botao = document.getElementById('toggleOAE');
    if (!botao) return;
    botao.classList.remove('ativo-filtro');
    botao.classList.remove('ativo-municipio');
  }

  function atualizarIndicadoresProgramaMunicipio(nomeMunicipio) {
    resetarBotoesPrograma();
  }

  function atualizarIndicadoresIntervencaoEOAE(nomeMunicipio) {
    resetarBotoesIntervencao();
    resetarBotaoOAE();

    var botoesIntervencaoGerais = document.querySelectorAll('.servico-btn');
    for (var x = 0; x < botoesIntervencaoGerais.length; x++) {
      var chaveGeral = botoesIntervencaoGerais[x].getAttribute('data-servico');
      if (servicosAtivos[chaveGeral]) {
        botoesIntervencaoGerais[x].classList.add('ativo-filtro');
      }
    }
  }

  function municipiosFiltrados() {
    var rg = regioesSelecionadas('rgPlanSelect');
    var municipio = document.getElementById('municipioSelect').value;
    var lista = [];

    for (var i = 0; i < municipiosData.features.length; i++) {
      var f = municipiosData.features[i];
      var nome = valorSeguro(f, 'NM_MUN');
      var rgPlan = nomeRegiaoPlanejamento(f);

      if (rg.length && !rg.includes(rgPlan)) continue;
      if (!featureAtendeRegioes(f)) continue;
      if (municipio && nome !== municipio) continue;

      lista.push(f);
    }

    return lista;
  }

  function ehGoias(feature) {
    var props = feature.properties || {};
    var candidatos = [
      props.SIGLA_UF, props.UF, props.SIGLA, props.sg_uf,
      props.NM_UF, props.nome, props.NOME, props.estado
    ];

    for (var i = 0; i < candidatos.length; i++) {
      var v = String(candidatos[i] || '').trim().toUpperCase();
      if (v === 'GO' || v === 'GOIÁS' || v === 'GOIAS') return true;
    }
    return false;
  }

  function desenharEstados() {
    if (!estadosData) return;
    if (estadosLayer) map.removeLayer(estadosLayer);

    estadosLayer = L.geoJSON(estadosData, {
      pane: 'limitesBasePane',
      style: function(feature) {
        if (ehGoias(feature)) {
          return {
            color: '#666666',
            weight: 1,
            fillColor: '#ffffff',
            fillOpacity: 0
          };
        }
        return {
          color: '#666666',
          weight: 1,
          fillColor: '#808080',
          fillOpacity: 0.28
        };
      }
    }).addTo(map);
  }

  function corPastelMunicipio(feature) {
    var regiao = parseInt(valorSeguro(feature, 'REGIAO'), 10);
    var base = isNaN(regiao) ? parseInt(valorSeguro(feature, 'ORD_MUN'), 10) : regiao;
    var hue = (Math.abs(base || 0) * 37) % 360;
    return 'hsl(' + hue + ', 15%, 75%)';
  }

  function desenharMunicipiosBase(featuresSelecionados) {
    if (municipiosLayer) map.removeLayer(municipiosLayer);

    var municipioSelecionadoFiltro = document.getElementById('municipioSelect').value;
    var rgSelecionadaFiltro = regioesSelecionadas('rgPlanSelect');

    if (!municipioBaseFiltroAtivo && !municipioSelecionadoFiltro && !rgSelecionadaFiltro.length) {
      municipiosLayer = null;
      return;
    }

    var selecionados = new Set(
      (featuresSelecionados || []).map(function(f) {
        return valorSeguro(f, 'NM_MUN');
      })
    );

    var haSelecao = !temFiltroRegional() && selecionados.size > 0 &&
                    selecionados.size < municipiosData.features.length;
    var mascaraMunicipioSelecionado = !!municipioSelecionadoFiltro;

    var estiloMunicipio = function(feature) {
        var nome = valorSeguro(feature, 'NM_MUN');
        var rgPlan = nomeRegiaoPlanejamento(feature);
        var selecionado = selecionados.has(nome);

        if (mascaraMunicipioSelecionado) {
          if (nome === municipioSelecionadoFiltro) {
            return {
              color: '#888888',
              weight: 2,
              dashArray: '8, 5, 1, 5',
              fillColor: '#ffffff',
              fillOpacity: 0
            };
          }

          return {
            color: '#888888',
            weight: 1,
            dashArray: '8, 5, 1, 5',
            fillColor: corPastelMunicipio(feature),
            fillOpacity: 1
          };
        }

        if (!haSelecao) {
          return {
            color: '#888888',
            weight: 1,
            dashArray: '8, 5, 1, 5',
            fillColor: '#ffffff',
            fillOpacity: (regioesBaseAtivas.manutencao || regioesBaseAtivas.planejamento || temFiltroRegional()) ? 0 : 0.6
          };
        }

        if (selecionado) {
          return {
            color: '#888888',
            weight: 1.5,
            dashArray: '8, 5, 1, 5',
            fillColor: '#ffffff',
            fillOpacity: 0
          };
        }

        return {
          color: '#888888',
          weight: 1.5,
          dashArray: '8, 5, 1, 5',
          fillColor: '#808080',
          fillOpacity: 0.28
        };
    };

    // Desenha todos os preenchimentos antes dos contornos para preservar as divisas compartilhadas.
    var preenchimentos = L.geoJSON(municipiosData, {
      pane: 'municipiosPane',
      interactive: true,
      style: function(feature) {
        return Object.assign({}, estiloMunicipio(feature), { stroke: false });
      },
      onEachFeature: function(feature, layer) {
        vincularPopupComAreaClique(layer, function() {
          return construirPopupAreaBase(feature, 'Município de ' + valorSeguro(feature, 'NM_MUN'), [
            { rotulo: 'Código IBGE', nome: 'CD_MUN' },
            { rotulo: 'Região de Planejamento', nome: 'RG_PLAN' }
          ]);
        });
      }
    });
    if (rgSelecionadaFiltro.length) {
      municipiosLayer = L.layerGroup([preenchimentos]).addTo(map);
      return;
    }
    var contornosBrancos = L.geoJSON(municipiosData, {
      pane: 'municipiosPane',
      interactive: false,
      style: ESTILO_CONTORNO_BRANCO_MUNICIPIOS
    });
    var contornosTracejados = L.geoJSON(municipiosData, {
      pane: 'municipiosPane',
      interactive: false,
      style: function(feature) {
        return Object.assign({}, estiloMunicipio(feature), { fill: false });
      }
    });
    municipiosLayer = L.layerGroup([preenchimentos, contornosBrancos, contornosTracejados]).addTo(map);
  }

  var camadasAreasPopup = new Map();

  function conteudoPopupAreasSobrepostas(layerClicada, latlng) {
    var conteudos = [];
    function adicionar(layer, conteudo) {
      var html = typeof conteudo === 'function' ? conteudo(layer) : conteudo;
      if (html && conteudos.indexOf(html) === -1) conteudos.push(html);
    }
    if (camadasAreasPopup.has(layerClicada)) adicionar(layerClicada, camadasAreasPopup.get(layerClicada));
    camadasAreasPopup.forEach(function(conteudo, layer) {
      if (layer === layerClicada || !map.hasLayer(layer)) return;
      if (!layer.getBounds().contains(latlng)) return;
      if (pontoEmPoligonoFeature(latlng.lng, latlng.lat, layer.feature)) adicionar(layer, conteudo);
    });
    return conteudos.map(function(html) {
      return '<section class="popup-area-sobreposta">' + html + '</section>';
    }).join('');
  }

  function vincularPopupComAreaClique(layer, conteudo) {
    if (layer instanceof L.Polygon && layer.feature) {
      layer.on('add', function() { camadasAreasPopup.set(layer, conteudo); });
      layer.on('remove', function() { camadasAreasPopup.delete(layer); });
      if (map.hasLayer(layer)) camadasAreasPopup.set(layer, conteudo);
      layer.on('click', function(e) {
        L.popup({ maxWidth: 380, maxHeight: 360 }, layer)
          .setLatLng(e.latlng)
          .setContent(conteudoPopupAreasSobrepostas(layer, e.latlng))
          .openOn(map);
      });
      return;
    }
    layer.bindPopup(conteudo);
    if (!(layer instanceof L.Polyline) || layer instanceof L.Polygon) return;
    var areaClique = null;
    layer.on('add', function() {
      if (areaClique) return;
      areaClique = L.polyline(layer.getLatLngs(), {
        pane: layer.options.pane,
        weight: Math.max(18, Number(layer.options.weight) || 0),
        opacity: 0,
        fill: false,
        dashArray: null,
        interactive: true,
        bubblingMouseEvents: false
      });
      areaClique.on('click', function(e) {
        // Preserva também os handlers que atualizam o painel de informações.
        layer.fire('click', { latlng: e.latlng, originalEvent: e.originalEvent }, true);
      });
      areaClique.addTo(map).bringToBack();
    });
    layer.on('remove', function() {
      if (areaClique) map.removeLayer(areaClique);
      areaClique = null;
    });
  }

  // Vínculo via OBRAS_LINKS.json (GEOCOD/BASE/IDCOD) + DADOS.json
  // (NATUREZA = 'Espacialização'), cruzado com sre_base/ferrovias/extra_base.
  function prepararBuffer(links, registrosPorIdcod, baseIndices) {
    bufferData.features = construirBufferDeLinks(links, registrosPorIdcod, baseIndices);
    var select = document.getElementById('bufferSelect');
    var selecionada = select.value;
    var descricoes = new Set();
    bufferData.features.forEach(function(feature) {
      if (feature.properties.DESCRICAO) descricoes.add(feature.properties.DESCRICAO);
    });
    select.innerHTML = '<option value="">Todos</option>';
    Array.from(descricoes).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }).forEach(function(descricao) {
      var option = document.createElement('option');
      option.value = descricao;
      option.textContent = descricao;
      select.appendChild(option);
    });
    select.value = descricoes.has(selecionada) ? selecionada : '';
  }

  function atualizarLegendaAreaEstudo() {
    document.querySelectorAll('[data-area-estudo]').forEach(function(amostra) {
      var estilo = ESTILOS_AREA_ESTUDO[amostra.getAttribute('data-area-estudo')];
      amostra.setAttribute('stroke', estilo.color);
      amostra.setAttribute('stroke-opacity', estilo.opacity);
      amostra.setAttribute('stroke-width', estilo.weight);
      amostra.setAttribute('stroke-linecap', estilo.lineCap);
      amostra.setAttribute('stroke-linejoin', estilo.lineJoin);
      var altura = Math.max(18, estilo.weight);
      amostra.ownerSVGElement.setAttribute('height', altura);
      amostra.ownerSVGElement.setAttribute('viewBox', '0 0 48 ' + altura);
      amostra.setAttribute('d', 'M0 ' + altura / 2 + 'H48');
    });
  }

  function desenharBuffer() {
    atualizarLegendaAreaEstudo();
    if (bufferLayer) map.removeLayer(bufferLayer);
    bufferLayer = null;
    var descricao = document.getElementById('bufferSelect').value;
    var features = bufferData.features.filter(function(feature) {
      return !descricao || feature.properties.DESCRICAO === descricao;
    });
    document.getElementById('blocoLegendaBuffer').style.display = bufferFiltroAtivo && features.length ? '' : 'none';
    if (!bufferFiltroAtivo || !features.length) return;
    bufferLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
      pane: 'bufferPane',
      style: function(feature) {
        return ESTILOS_AREA_ESTUDO[feature.properties.BASE] || ESTILOS_AREA_ESTUDO.sre_base;
      },
      onEachFeature: function(feature, layer) {
        layer.bindPopup(function() {
          return construirPopupAreaBase(feature, feature.properties.DESCRICAO || 'Área de Influência', [
            { rotulo: 'Identificador', nome: 'IDCOD' },
            { rotulo: 'Base', nome: 'BASE' },
            { rotulo: 'Trecho', nome: 'SRE' }
          ]);
        });
      }
    }).addTo(map);
  }

  function preencherFerrovias() {
    var select = document.getElementById('ferroviaSelect');
    var selecionada = select.value;
    select.innerHTML = '<option value="">Todas</option>';
    var nomes = new Set();
    ((ferroviasData && ferroviasData.features) || []).forEach(function(feature) {
      var nome = valorSeguro(feature, 'nome');
      if (nome) nomes.add(nome);
    });
    Array.from(nomes).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }).forEach(function(nome) {
      var option = document.createElement('option');
      option.value = nome;
      option.textContent = nome;
      select.appendChild(option);
    });
    select.value = nomes.has(selecionada) ? selecionada : '';
  }

  function desenharFerrovias() {
    if (ferroviasLayer) map.removeLayer(ferroviasLayer);
    ferroviasLayer = null;
    var legendaFerrovias = document.getElementById('blocoLegendaFerrovias');
    if (legendaFerrovias) legendaFerrovias.style.display = ferroviasFiltroAtivo && ferroviasData ? '' : 'none';
    if (!ferroviasFiltroAtivo || !ferroviasData) return;
    var selecionada = document.getElementById('ferroviaSelect').value;
    var dadosFiltrados = {
      type: 'FeatureCollection',
      features: (ferroviasData.features || []).filter(function(feature) {
        return !selecionada || valorSeguro(feature, 'nome') === selecionada;
      })
    };
    var linhaContinua = L.geoJSON(dadosFiltrados, {
      pane: 'ferroviasPane',
      style: { color: '#000000', weight: 2, opacity: 1 },
      onEachFeature: function(feature, layer) {
        vincularPopupComAreaClique(layer, function() {
          return construirPopupAreaBase(feature, valorSeguro(feature, 'nome') || 'Ferrovia', [
            { rotulo: 'Sigla', nome: 'sigla' },
            { rotulo: 'Situação', nome: 'tip_situac' },
            { rotulo: 'Bitola', nome: 'bitola' },
            { rotulo: 'Município', nome: 'municipio' }
          ]);
        });
      }
    });
    // Segmentos curtos e largos formam os traços perpendiculares ao eixo da ferrovia.
    var travessas = L.geoJSON(dadosFiltrados, {
      pane: 'ferroviasPane',
      interactive: false,
      style: { color: '#000000', weight: 6, opacity: 1, dashArray: '1.2, 12', lineCap: 'butt' }
    });
    ferroviasLayer = L.layerGroup([linhaContinua, travessas]).addTo(map);
  }

  function desenharAreaInfluencia() {
    if (areaInfluenciaLayer) {
      map.removeLayer(areaInfluenciaLayer);
      areaInfluenciaLayer = null;
    }
    if ((!areaInfluenciaFiltroAtivo && !areaInfluenciaSelecionada) || !areaInfluenciaData || !areaInfluenciaData.features) return;

    areaInfluenciaLayer = L.geoJSON(areaInfluenciaData, {
      pane: 'areaInfluenciaPane',
      interactive: true,
      style: ESTILO_AREA_INFLUENCIA,
      onEachFeature: function(feature, layer) {
        vincularPopupComAreaClique(layer, function() {
          return construirPopupAreaBase(feature, nomeExibicaoAreaInfluencia(feature, 0), [
            { rotulo: 'Área (km²)', nome: 'AREA_KM2', tipo: 'numero', casas: 2 }
          ]);
        });
      }
    }).addTo(map);
  }

  function desenharAreasUrbanas() {
    if (areasUrbanasLayer) {
      map.removeLayer(areasUrbanasLayer);
      areasUrbanasLayer = null;
    }

    if (!areasUrbanasFiltroAtivo || !areasUrbanasData || !areasUrbanasData.features) return;

    areasUrbanasLayer = L.geoJSON(areasUrbanasData, {
      interactive: true,
      pane: 'areasUrbanasPane',
      style: function() {
        return {
          color: '#ffb5b5',
          weight: 1.5,
          opacity: 1,
          fillColor: '#ffb5b5',
          fillOpacity: 0.42
        };
      },
      onEachFeature: function(feature, layer) {
        var titulo = valorSeguro(feature, 'NOME_ACEN') || 'Área urbana';
        vincularPopupComAreaClique(layer, function() {
          return construirPopupAreaBase(feature, titulo, [
            { rotulo: 'Município', nome: 'NM_MUN' },
            { rotulo: 'Região de Planejamento', nome: 'RG_PLAN' },
            { rotulo: 'População', nome: 'POPULACAO', tipo: 'numero', casas: 0 },
            { rotulo: 'Área (km²)', nome: 'AREA_KM2', tipo: 'numero', casas: 3 }
          ]);
        });
      }
    }).addTo(map);
  }

  function desenharAreasAmbientais() {
    if (areasAmbientaisLayer) {
      map.removeLayer(areasAmbientaisLayer);
      areasAmbientaisLayer = null;
    }

    if (!areasAmbientaisFiltroAtivo || !areasAmbientaisData || !areasAmbientaisData.features) return;

    areasAmbientaisLayer = L.geoJSON(areasAmbientaisData, {
      interactive: true,
      pane: 'areasAmbientaisPane',
      style: function() {
        return {
          color: '#729b2a',
          weight: 1.5,
          opacity: 1,
          fillColor: '#729b2a',
          fillOpacity: 0.42
        };
      },
      onEachFeature: function(feature, layer) {
        var titulo = valorSeguro(feature, 'NOME') || valorSeguro(feature, 'UNIDADE') || 'Área ambiental';
        vincularPopupComAreaClique(layer, function() {
          return construirPopupAreaBase(feature, titulo, [
            { rotulo: 'Categoria', nome: 'CATEGORIA' },
            { rotulo: 'Grupo', nome: 'GRUPO' },
            { rotulo: 'Jurisdição', nome: 'JURIS' },
            { rotulo: 'UF', nome: 'UF' },
            { rotulo: 'Municípios', nome: 'MUN' },
            { rotulo: 'Gestor', nome: 'GESTOR' },
            { rotulo: 'Criação', nome: 'ANO_CRIA' },
            { rotulo: 'Ato de criação', nome: 'CRIA_ATO' },
            { rotulo: 'Registro', nome: 'REGISTRO' },
            { rotulo: 'Parque', nome: 'PARQUE' },
            { rotulo: 'Área (ha)', nome: 'AREA_HA', tipo: 'numero', casas: 2 },
            { rotulo: 'Área (km²)', nome: 'AREA_KM2', tipo: 'numero', casas: 2 }
          ]);
        });
      }
    }).addTo(map);
  }

  function desenharLocalidades() {
    if (!localidadeFiltroAtivo) {
      if (localidadesLayer) { map.removeLayer(localidadesLayer); localidadesLayer = null; }
      return;
    }

    if (localidadesLayer) map.removeLayer(localidadesLayer);

    var localidadeSelecionada = document.getElementById('localidadeSelect').value;

    var featuresFiltradas = localidadesData.features.filter(function(feature) {
      var nome = valorSeguro(feature, 'NOME_ACEN');
      if (localidadeSelecionada && nome !== localidadeSelecionada) return false;
      return true;
    });

    // Ordenar por POPULACAO decrescente para priorizar rótulos
    featuresFiltradas.sort(function(a, b) {
      var popA = numeroSeguro(valorSeguro(a, 'POPULACAO'));
      var popB = numeroSeguro(valorSeguro(b, 'POPULACAO'));
      return popB - popA;
    });

    localidadesLayer = L.layerGroup();

    featuresFiltradas.forEach(function(feature) {
      var coords = feature.geometry.coordinates[0]; // MultiPoint, pegar primeiro ponto
      var latlng = [coords[1], coords[0]]; // GeoJSON é [lng, lat]
      var nome = valorSeguro(feature, 'NOME_ACEN');
      var populacao = numeroSeguro(valorSeguro(feature, 'POPULACAO'));

            // Criar marcador para o ponto
            var marker = L.circleMarker(latlng, {
              pane: 'rotulosBasePane',
              color: '#000000',
        fillColor: '#ffffff',
        fillOpacity: 1,
        radius: 5,
        weight: 1.5,
        populacao: populacao,
        nomeLocalidade: nome
      });

      // Adicionar popup
      marker.bindPopup('<b>' + nome + '</b><br>População: ' + populacao.toLocaleString('pt-BR'));

      localidadesLayer.addLayer(marker);

      // Adicionar rótulo baseado no zoom e população
      var label = L.marker(latlng, {
        pane: 'rotulosBasePane',
        icon: L.divIcon({
          className: 'localidade-label',
          html: '<div class="label-text">' + nome + '</div>',
          iconSize: [0, 0],
          iconAnchor: [-5, 20]
        }),
        populacao: populacao,
        nomeLocalidade: nome
      });

      localidadesLayer.addLayer(label);
    });

    localidadesLayer.addTo(map);

    // Atualizar visibilidade dos rótulos baseado no zoom
    atualizarVisibilidadeRotulos();
  }

  function tipoAeroFeature(feature) {
    var tipo = String(valorSeguro(feature, 'TIPO') || '').toLowerCase();
    return tipo.indexOf('aeroporto') >= 0 ? 'aeroporto' : 'aerodromo';
  }

  function criarIconeAero(tipo) {
    var aeroporto = tipo === 'aeroporto';
    var config = aeroporto ? CONFIG_AERO.aeroporto : CONFIG_AERO.aerodromo;
    var tamanho = config.tamanho;
    var icone = config.icone;
    return L.divIcon({
      className: 'aero-icon',
      html: '<img class="aero-simbolo" src="' + icone + '" alt="" aria-hidden="true" style="width:' + tamanho + 'px;height:' + tamanho + 'px;" />',
      iconSize: [tamanho, tamanho],
      iconAnchor: [tamanho / 2, tamanho / 2],
      popupAnchor: [0, -tamanho / 2]
    });
  }

  function construirPopupAero(feature) {
    var p = feature.properties || {};
    var linhas = [
      ['Tipo', p.TIPO],
      ['Código', p.COD],
      ['Nome', p.NOME],
      ['Município', p.MUNICIPIO],
      ['Altitude', p.ALT_M ? p.ALT_M + ' m' : ''],
      ['Comprimento', p.COMP_M ? p.COMP_M + ' m' : ''],
      ['Largura', p.LARG_M ? p.LARG_M + ' m' : ''],
      ['Revestimento', p.REVESTIMENTO]
    ];
    var html = '<b>' + escaparHtml(p.NOME || p.TIPO || 'Aeródromo') + '</b>';
    for (var i = 0; i < linhas.length; i++) {
      if (linhas[i][1] === null || linhas[i][1] === undefined || linhas[i][1] === '') continue;
      html += '<br><b>' + escaparHtml(linhas[i][0]) + ':</b> ' + escaparHtml(linhas[i][1]);
    }
    return html;
  }

  function desenharAero() {
    if (aeroLayer) {
      map.removeLayer(aeroLayer);
      aeroLayer = null;
    }

    renderizarLegendaAero({});

    if (!aeroFiltroAtivo || map.getZoom() < CONFIG_AERO.zoomMinimo || !aeroData || !aeroData.features) return;

    var tiposVisiveis = {};
    aeroLayer = L.layerGroup();

    aeroData.features.forEach(function(feature) {
      var coords = feature.geometry && feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;

      var tipo = tipoAeroFeature(feature);
      tiposVisiveis[tipo] = true;

      var marker = L.marker([coords[1], coords[0]], {
        pane: 'aeroPane',
        icon: criarIconeAero(tipo),
        title: valorSeguro(feature, 'NOME') || valorSeguro(feature, 'TIPO') || '',
        zIndexOffset: tipo === 'aeroporto' ? 20 : 10
      });

      marker.bindPopup(construirPopupAero(feature));
      aeroLayer.addLayer(marker);
    });

    if (aeroLayer.getLayers().length) aeroLayer.addTo(map);
    renderizarLegendaAero(tiposVisiveis);
  }

  function renderizarLegendaAero(tiposVisiveis) {
    var bloco = document.getElementById('blocoLegendaAero');
    var alvo = document.getElementById('legendaAero');
    if (!bloco || !alvo) return;

    alvo.innerHTML = '';
    if (!aeroFiltroAtivo || !tiposVisiveis) {
      bloco.style.display = 'none';
      return;
    }

    [
      ['aerodromo', 'Aeródromo'],
      ['aeroporto', 'Aeroporto']
    ].forEach(function(item) {
      if (!tiposVisiveis[item[0]]) return;
      var div = document.createElement('div');
      div.className = 'legenda-item';
      div.innerHTML =
        '<span class="legenda-aero-simbolo"><img class="aero-simbolo" src="data/' +
        (item[0] === 'aeroporto' ? 'aeroporto.svg' : 'aerodromo.svg') +
        '" alt="" aria-hidden="true" /></span><div class="legenda-texto">' + item[1] + '</div>';
      alvo.appendChild(div);
    });

    bloco.style.display = alvo.children.length ? '' : 'none';
  }

  function valorDensidadeRotulos() {
    return Math.max(0, Math.min(4, Number(densidadeRotulos) || 0));
  }

  function adicionarUnico(lista, valor) {
    if (valor && lista.indexOf(valor) === -1) lista.push(valor);
  }

  function algumaOrigemAtiva() {
    for (var chave in servicosAtivos) {
      if (servicosAtivos[chave]) return true;
    }
    return false;
  }

  function filtroOrigemIntervencaoPropostaAtivo() {
    var propostaSelect = document.getElementById('propostaSelect');
    var propostaSelecionada = propostaSelect ? propostaSelect.value : '';
    return algumaOrigemAtiva() || !!servicoFiltroAtivo || !!propostaSelecionada;
  }

  function featureTemIntervencaoAtivo(feature) {
    var linkFund = valorSeguro(feature, 'LINK_FUND');
    var linkDor = valorSeguro(feature, 'LINK_DOR');
    var linkDma = valorSeguro(feature, 'LINK_DMA');
    var linkDpl = valorSeguro(feature, 'LINK_DPL');
    var linkDpj = valorSeguro(feature, 'LINK_DPJ');
    return (
      (servicosAtivos.FUNDEINFRA && linkFund && dadosFundeinfraDaFeature(feature)) ||
      (servicosAtivos.DOR && linkDor && dadosDorDaFeature(feature)) ||
      (servicosAtivos.DMA && linkDma && dadosDmaDaFeature(feature)) ||
      (servicosAtivos.DPL && linkDpl && dadosDplDaFeature(feature)) ||
      (servicosAtivos.DPJ && linkDpj && dadosDpjDaFeature(feature))
    );
  }

  function featureAtendeOrigemIntervencaoProposta(feature) {
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var servico = servicoFiltroAtivo;
    var respeitarOrigem = algumaOrigemAtiva();

    if (propostaSelecionada) {
      if (respeitarOrigem && !servicosAtivos.FUNDEINFRA) return false;
      var dadosProposta = dadosFundeinfraDaFeature(feature);
      if (!dadosProposta) return false;
      if (String(dadosProposta.PROPOSTA) !== String(propostaSelecionada)) return false;
      if (servico && dadosProposta.INTERVENCAO !== servico) return false;
      return true;
    }

    if (!respeitarOrigem || servicosAtivos.FUNDEINFRA) {
      var dadosFund = dadosFundeinfraDaFeature(feature);
      if (dadosFund && (!servico || dadosFund.INTERVENCAO === servico)) return true;
    }

    if ((!respeitarOrigem || servicosAtivos.DOR) && dadosDorDaFeatureFiltrados(feature, servico, '').length) return true;
    if ((!respeitarOrigem || servicosAtivos.DMA) && dadosDmaDaFeatureFiltrados(feature, servico, '').length) return true;
    if ((!respeitarOrigem || servicosAtivos.DPL) && dadosDplDaFeatureFiltrados(feature, servico, '').length) return true;
    if ((!respeitarOrigem || servicosAtivos.DPJ) && dadosDpjDaFeatureFiltrados(feature, servico, '').length) return true;

    return false;
  }

  function textoDensidadeRotulos(valor) {
    return valor === 0 ? 'Automático' : String(valor);
  }

  function atualizarTextoDensidadeRotulos() {
    var alvo = document.getElementById('rotulosDensidadeValor');
    if (alvo) alvo.textContent = textoDensidadeRotulos(valorDensidadeRotulos());
  }

    function atualizarVisibilidadeRotulos() {
      atualizarVisibilidadeGrupoRotulos(localidadesLayer);
    }

    function atualizarVisibilidadeGrupoRotulos(grupo) {
    if (!grupo) return;

    var zoom = map.getZoom();
    var densidade = valorDensidadeRotulos();
    var labels = [];
    var pontos = [];

    // Coletar todos os layers separando rótulos e pontos
    grupo.eachLayer(function(layer) {
      if (layer.options && layer.options.icon && layer.options.icon.options.className === 'localidade-label') {
        var populacao = layer.options.populacao;
        var latlng = layer.getLatLng();
        var pixelPos = map.latLngToContainerPoint(latlng);

        labels.push({
          layer: layer,
          populacao: populacao,
          nomeLocalidade: layer.options.nomeLocalidade || '',
          pixelPos: pixelPos,
          visible: false
        });
      } else if (layer instanceof L.CircleMarker) {
        pontos.push({
          layer: layer,
          populacao: layer.options.populacao || 0,
          nomeLocalidade: layer.options.nomeLocalidade || '',
          latlng: layer.getLatLng()
        });
      }
    });

    // Ordenar por população decrescente
    labels.sort(function(a, b) {
      return b.populacao - a.populacao;
    });

    var occupiedAreas = [];

    labels.forEach(function(label) {
      var elLabel = label.layer.getElement();
      if (!elLabel) return;

      if (densidade === 4) {
        elLabel.style.display = 'block';
        return;
      }

      // Goiânia fica sempre visível
      if (label.nomeLocalidade === 'Goiânia') {
        elLabel.style.display = 'block';
        var labelRect = {
          left: label.pixelPos.x - 60,
          right: label.pixelPos.x + 60,
          top: label.pixelPos.y - 18,
          bottom: label.pixelPos.y + 6
        };
        occupiedAreas.push(labelRect);
        return;
      }

      var zoomNecessario;
      if (label.populacao > 0) {
        zoomNecessario = Math.max(8, 15 - Math.log10(label.populacao) * 2);
      } else {
        zoomNecessario = 12;
      }
      zoomNecessario = zoomNecessario - densidade;

      if (zoom < zoomNecessario) {
        elLabel.style.display = 'none';
        return;
      }

      // Verificar sobreposição
      var folga = densidade === 3 ? 0.55 : densidade === 2 ? 0.7 : densidade === 1 ? 0.85 : 1;
      var labelRect = {
        left: label.pixelPos.x - (60 * folga),
        right: label.pixelPos.x + (60 * folga),
        top: label.pixelPos.y - (18 * folga),
        bottom: label.pixelPos.y + (6 * folga)
      };

      var overlaps = densidade < 3 && occupiedAreas.some(function(area) {
        return !(labelRect.right < area.left || labelRect.left > area.right ||
                 labelRect.bottom < area.top || labelRect.top > area.bottom);
      });

      if (!overlaps) {
        elLabel.style.display = 'block';
        occupiedAreas.push(labelRect);
      } else {
        elLabel.style.display = 'none';
      }
    });

    // Controlar visibilidade dos pontos (bolinhas brancas) com a MESMA lógica dos rótulos
    pontos.forEach(function(ponto) {
      if (!ponto.layer.getElement()) return;

      if (densidade === 4) {
        ponto.layer.getElement().style.display = 'block';
        return;
      }

      // Goiânia fica sempre visível
      if (ponto.nomeLocalidade === 'Goiânia') {
        ponto.layer.getElement().style.display = 'block';
        return;
      }

      var zoomNecessario;
      if (ponto.populacao > 0) {
        zoomNecessario = Math.max(8, 15 - Math.log10(ponto.populacao) * 2);
      } else {
        zoomNecessario = 12;
      }
      zoomNecessario = zoomNecessario - densidade;

      if (zoom >= zoomNecessario) {
        ponto.layer.getElement().style.display = 'block';
      } else {
        ponto.layer.getElement().style.display = 'none';
      }
    });
  }

  function criarMarcadorLabel(latlng, texto, rodovia, tipo) {
    var federal = tipo === 'federal';
    var html = federal
      ? '<div class="snv-escudo-federal">' +
          '<svg viewBox="0 0 100 105" aria-hidden="true" focusable="false">' +
            '<path d="M50 9 C39 21 28 22 16 15 L5 29 C16 42 16 56 9 70 C4 82 12 92 27 94 C38 95 46 97 50 103 C54 97 62 95 73 94 C88 92 96 82 91 70 C84 56 84 42 95 29 L84 15 C72 22 61 21 50 9 Z"></path>' +
            '<text x="50" y="64">' + texto + '</text>' +
          '</svg>' +
        '</div>'
      : '<div class="sre-escudo-circular">' + texto + '</div>';

    return L.marker(latlng, {
      pane: 'rotulosBasePane',
      icon: L.divIcon({
        className: federal ? 'sre-label-escudo snv-label-escudo' : 'sre-label-escudo',
        html: html,
        iconSize: federal ? [26, 26] : [18, 18],
        iconAnchor: federal ? [13, 13] : [9, 9]
      }),
      rodovia: rodovia,
      tipoRotulo: tipo || 'estadual'
    });
  }

    function atualizarVisibilidadeRotulosSRE() {
    if (!sreBaseLabelLayer && !snvLabelLayer) return;

    var zoom = map.getZoom();
    var densidade = valorDensidadeRotulos();
    var labels = [];

    // --- COLETAR ÁREAS OCUPADAS PELOS RÓTULOS DE LOCALIDADES (prioridade) ---
    var occupiedAreas = [];

    if (localidadesLayer && localidadeFiltroAtivo && densidade < 3) {
      localidadesLayer.eachLayer(function(layer) {
        // Rótulos de localidades
        if (layer.options && layer.options.icon && layer.options.icon.options.className === 'localidade-label') {
          var el = layer.getElement();
          if (el && el.style.display !== 'none') {
            var latlngLoc = layer.getLatLng();
            var pixelPosLoc = map.latLngToContainerPoint(latlngLoc);
            occupiedAreas.push({
              left: pixelPosLoc.x - 60,
              right: pixelPosLoc.x + 60,
              top: pixelPosLoc.y - 18,
              bottom: pixelPosLoc.y + 6
            });
          }
        }
        // Pontos das localidades (bolinhas brancas)
        else if (layer instanceof L.CircleMarker) {
          var elPonto = layer.getElement();
          if (elPonto && elPonto.style.display !== 'none') {
            var latlngPonto = layer.getLatLng();
            var pixelPosPonto = map.latLngToContainerPoint(latlngPonto);
            occupiedAreas.push({
              left: pixelPosPonto.x - 5,
              right: pixelPosPonto.x + 5,
              top: pixelPosPonto.y - 5,
              bottom: pixelPosPonto.y + 5
            });
          }
        }
      });
    }

    // Coletar labels do SRE Base
    if (sreBaseLabelLayer) {
      sreBaseLabelLayer.eachLayer(function(layer) {
        var latlng = layer.getLatLng();
        var pixelPos = map.latLngToContainerPoint(latlng);
        labels.push({
          layer: layer,
          pixelPos: pixelPos,
          rodovia: layer.options.rodovia || '',
          tipoRotulo: layer.options.tipoRotulo || 'estadual'
        });
      });
    }

    // Coletar labels do SNV
    if (snvLabelLayer) {
      snvLabelLayer.eachLayer(function(layer) {
        var latlng = layer.getLatLng();
        var pixelPos = map.latLngToContainerPoint(latlng);
        labels.push({
          layer: layer,
          pixelPos: pixelPos,
          rodovia: layer.options.rodovia || '',
          tipoRotulo: layer.options.tipoRotulo || 'federal'
        });
      });
    }

    labels.forEach(function(label) {
      var elLabel = label.layer.getElement();
      if (!elLabel) return;

      if (densidade === 4) {
        elLabel.style.display = 'block';
        return;
      }

      var zoomNecessario;
      if (zoom >= 10) {
        zoomNecessario = 9;
      } else if (zoom >= 9) {
        zoomNecessario = 9;
      } else {
        zoomNecessario = 99;
      }
      if (densidade > 0) {
        zoomNecessario = Math.max(5, 9 - densidade);
      }
      if (zoom < zoomNecessario) {
        elLabel.style.display = 'none';
        return;
      }

      // Verificar sobreposição entre escudos e com labels de localidades
      var metade = label.tipoRotulo === 'federal' ? 22 : 18;
      var folga = densidade === 3 ? 0.55 : densidade === 2 ? 0.7 : densidade === 1 ? 0.85 : 1;
      var labelRect = {
        left: label.pixelPos.x - (metade * folga),
        right: label.pixelPos.x + (metade * folga),
        top: label.pixelPos.y - (metade * folga),
        bottom: label.pixelPos.y + (metade * folga)
      };

      var overlaps = densidade < 3 && occupiedAreas.some(function(area) {
        return !(labelRect.right < area.left || labelRect.left > area.right ||
                 labelRect.bottom < area.top || labelRect.top > area.bottom);
      });
      if (!overlaps) {
        elLabel.style.display = 'block';
        occupiedAreas.push(labelRect);
      } else {
        elLabel.style.display = 'none';
      }
    });
  }

  function desenharSREBase() {
    if (!sreBaseFiltroAtivo) {
      if (sreBaseLayer) { map.removeLayer(sreBaseLayer); sreBaseLayer = null; }
      if (sreBaseLabelLayer) { map.removeLayer(sreBaseLabelLayer); sreBaseLabelLayer = null; }
      return {};
    }
    if (!sreBaseData || !sreBaseData.features) return {};
    if (sreBaseLayer) map.removeLayer(sreBaseLayer);

    var dup = [];
    var eod = [];
    var eop = [];
    var pav = [];
    var imp = [];
    var len = [];
    var pla = [];

    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;

    for (var i = 0; i < sreBaseData.features.length; i++) {
      var f = sreBaseData.features[i];
      if (!featureAtendeRegioes(f)) continue;
      if (rodoviaSelecionada && nomeRodoviaFeature(f) !== rodoviaSelecionada) continue;
      if (sreSelecionado && nomeSREFeature(f) !== sreSelecionado) continue;
      var s = String(valorSeguro(f, 'situacao') || valorSeguro(f, 'SITUACAO')).toUpperCase();
      if (s === 'DUP') dup.push(f);
      else if (s === 'EOD') eod.push(f);
      else if (s === 'EOP') eop.push(f);
      else if (s === 'PAV') pav.push(f);
      else if (s === 'IMP') imp.push(f);
      else if (s === 'LEN') len.push(f);
      else if (s === 'PLA') pla.push(f);
      else pav.push(f);
    }

    var grupo = L.layerGroup();

    function addSimple(features, style) {
      if (!features.length) return;
      grupo.addLayer(L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'sreBasePane',
        style: function() { return style; },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, function() { return construirPopupRodoviaBase(feature); });
        }
      }));
    }

    if (dup.length) {
      grupo.addLayer(L.geoJSON({
        type: 'FeatureCollection',
        features: dup
      }, {
        pane: 'sreBasePane',
        style: function() {
          return { color:'#ef2020', weight:4, opacity:0.95 };
        }
      }));
      grupo.addLayer(L.geoJSON({
        type: 'FeatureCollection',
        features: dup
      }, {
        pane: 'sreBasePane',
        style: function() {
          return { color:'#ffffff', weight:1, opacity:1 };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, function() { return construirPopupRodoviaBase(feature); });
        }
      }));
    }

    if (eod.length) {
      grupo.addLayer(L.geoJSON({
        type: 'FeatureCollection',
        features: eod
      }, {
        pane: 'sreBasePane',
        style: function() {
          return { color:'#ef2020', weight:3, opacity:0.95 };
        }
      }));
      grupo.addLayer(L.geoJSON({
        type: 'FeatureCollection',
        features: eod
      }, {
        pane: 'sreBasePane',
        style: function() {
          return { color:'#ffffff', weight:1.2, opacity:1, dashArray:'6,4' };
        }
      }));
    }

    addSimple(eop, { color:'#ef2020', weight:2.2, opacity:0.95, dashArray:'12,8' });
    addSimple(pav, { color:'#ef2020', weight:2.2, opacity:0.95 });
    addSimple(imp, { color:'#f08a00', weight:2.2, opacity:0.95 });
    addSimple(len, { color:'#f08a00', weight:2.2, opacity:0.95 });
    addSimple(pla, { color:'#000000', weight:2.2, opacity:0.95 });

    sreBaseLayer = grupo.addTo(map);

    // --- CRIAR RÓTULOS EM FORMA DE CÍRCULO PARA OS TRECHOS ---
    if (sreBaseLabelLayer) {
      map.removeLayer(sreBaseLabelLayer);
      sreBaseLabelLayer = null;
    }
    sreBaseLabelLayer = L.layerGroup();

    var todosFeatures = [].concat(dup, eod, eop, pav, imp, len, pla);

    var gruposRotulo = {};
    todosFeatures.forEach(function(feature) {
      var chave = chaveGeometriaSRE(feature) || ('sem-chave-' + Object.keys(gruposRotulo).length);
      if (!gruposRotulo[chave]) gruposRotulo[chave] = [];
      gruposRotulo[chave].push(feature);
    });

    Object.keys(gruposRotulo).forEach(function(chave) {
      var feature = featureRotuloMenorRodovia(gruposRotulo[chave]);
      if (!feature) return;
      var rodovia = nomeRodoviaFeature(feature);
      if (!rodovia) return;

      // Extrair os 3 últimos dígitos (ex: GO-338 -> 338)
      var partes = rodovia.split('-');
      var numeroRodovia = partes.length > 1 ? partes[1] : rodovia;
      var ultimos3Digitos = numeroRodovia.slice(-3);

      // Obter o ponto médio da LineString para posicionar o label
      var coords = coordenadasLinhaPrincipal(feature.geometry);
      if (!coords || coords.length < 2) return;

      var midIndex = Math.floor(coords.length / 2);
      var midCoord = coords[midIndex];
      var latlng = [midCoord[1], midCoord[0]];

      var labelLayer = criarMarcadorLabel(latlng, ultimos3Digitos, rodovia);
      sreBaseLabelLayer.addLayer(labelLayer);

    });

    sreBaseLabelLayer.addTo(map);
    atualizarVisibilidadeRotulosSRE();

    var vis = {};
    if (dup.length) vis.DUP = true;
    if (pav.length) vis.PAV = true;
    if (eod.length) vis.EOD = true;
    if (eop.length) vis.EOP = true;
    if (imp.length) vis.IMP = true;
    if (len.length) vis.LEN = true;
    if (pla.length) vis.PLA = true;
    return vis;
  }

    function desenharSNV() {
    if (!snvFiltroAtivo) {
      if (snvLayer) { map.removeLayer(snvLayer); snvLayer = null; }
      if (snvLabelLayer) { map.removeLayer(snvLabelLayer); snvLabelLayer = null; }
      return {};
    }
    if (!snvData || !snvData.features) return {};
    if (snvLayer) map.removeLayer(snvLayer);

    function estiloSNV(feature) {
      var s = String(valorSeguro(feature, 'SITUACAO')).toUpperCase();

      if (s === 'LEN') {
        return {
          pane: 'snvPane',
          color: '#e59b00',
          weight: 1,
          opacity: 0.95
        };
      }

      if (s === 'EOP') {
        return {
          pane: 'snvPane',
          color: '#33a21a',
          weight: 1,
          opacity: 0.95,
          dashArray: '14,10'
        };
      }

      return {
        pane: 'snvPane',
        color: '#33a21a',
        weight: 1,
        opacity: 0.95
      };
    }

    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;

    var pavLenEop = snvData.features.filter(function(f) {
      if (!featureAtendeRegioes(f)) return false;
      if (rodoviaSelecionada && nomeRodoviaFeature(f) !== rodoviaSelecionada) return false;
      if (sreSelecionado && nomeSREFeature(f) !== sreSelecionado) return false;
      return String(valorSeguro(f, 'SITUACAO')).toUpperCase() !== 'DUP';
    });

    var dup = snvData.features.filter(function(f) {
      if (!featureAtendeRegioes(f)) return false;
      if (rodoviaSelecionada && nomeRodoviaFeature(f) !== rodoviaSelecionada) return false;
      if (sreSelecionado && nomeSREFeature(f) !== sreSelecionado) return false;
      return String(valorSeguro(f, 'SITUACAO')).toUpperCase() === 'DUP';
    });

    var grupo = L.layerGroup();

    if (pavLenEop.length) {
      var camadaBase = L.geoJSON({
        type: 'FeatureCollection',
        features: pavLenEop
      }, {
        style: estiloSNV,
        onEachFeature: function(feature, layer) {
          var p = feature.properties || {};
          var nome = p.RODOVIA || p.SNV || '';
          vincularPopupComAreaClique(layer,
            '<b>Rodovia:</b> ' + (p.RODOVIA || '') + '<br>' +
            '<b>SNV:</b> ' + (p.SNV || '') + '<br>' +
            '<b>Trecho:</b> ' + (p.TRECHO || '') + '<br>' +
            '<b>Extensão (km):</b> ' + (p.EXT_KM || '') + '<br>' +
            '<b>Situação:</b> ' + (p.SITUACAO || '')
          );
        }
      });
      grupo.addLayer(camadaBase);
    }

    if (dup.length) {
      var dupBase = L.geoJSON({
        type: 'FeatureCollection',
        features: dup
      }, {
        style: function() {
          return {
            pane: 'snvPane',
            color: '#33a21a',
            weight: 3,
            opacity: 0.95
          };
        }
      });

      var dupMiolo = L.geoJSON({
        type: 'FeatureCollection',
        features: dup
      }, {
        style: function() {
          return {
            pane: 'snvPane',
            color: '#ffffff',
            weight: 1,
            opacity: 1
          };
        },
        onEachFeature: function(feature, layer) {
          var p = feature.properties || {};
          var nome = p.RODOVIA || p.SNV || '';
          vincularPopupComAreaClique(layer,
            '<b>Rodovia:</b> ' + (p.RODOVIA || '') + '<br>' +
            '<b>SNV:</b> ' + (p.SNV || '') + '<br>' +
            '<b>Trecho:</b> ' + (p.TRECHO || '') + '<br>' +
            '<b>Extensão (km):</b> ' + (p.EXT_KM || '') + '<br>' +
            '<b>Situação:</b> ' + (p.SITUACAO || '')
          );
        }
      });

      grupo.addLayer(dupBase);
      grupo.addLayer(dupMiolo);
    }

    snvLayer = grupo.addTo(map);

    // --- CRIAR RÓTULOS EM FORMA DE CÍRCULO PARA OS TRECHOS SNV ---
    if (snvLabelLayer) {
      map.removeLayer(snvLabelLayer);
      snvLabelLayer = null;
    }
    snvLabelLayer = L.layerGroup();

    var todosSnvFeatures = [].concat(dup, pavLenEop);
    todosSnvFeatures.forEach(function(feature) {
      var rodovia = valorSeguro(feature, 'RODOVIA');
      if (!rodovia) rodovia = valorSeguro(feature, 'SNV');
      if (!rodovia) return;

      // Extrair os 3 últimos dígitos (ex: GO-338 -> 338)
      var partes = rodovia.split('-');
      var numeroRodovia = partes.length > 1 ? partes[1] : rodovia;
      var ultimos3Digitos = numeroRodovia.slice(-3);

      // Obter o ponto médio da LineString para posicionar o label
      var coords = feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;

      var midIndex = Math.floor(coords.length / 2);
      var midCoord = coords[midIndex];
      var latlng = [midCoord[1], midCoord[0]];

      var labelLayer = criarMarcadorLabel(latlng, ultimos3Digitos, rodovia, 'federal');
      snvLabelLayer.addLayer(labelLayer);
    });

    snvLabelLayer.addTo(map);
    atualizarVisibilidadeRotulosSRE();

    var vis = {};
    if (dup.length) vis.DUP = true;
    pavLenEop.forEach(function(f) {
      var s = String(valorSeguro(f, 'SITUACAO')).toUpperCase();
      if (s) vis[s] = true;
    });
    return vis;
  }

  function comparar(valorFeature, comparador, valorRegra) {
    if (comparador === '=') return String(valorFeature) === String(valorRegra);
    if (comparador === '>') return numeroSeguro(valorFeature) > numeroSeguro(valorRegra);
    if (comparador === '>=') return numeroSeguro(valorFeature) >= numeroSeguro(valorRegra);
    if (comparador === '<') return numeroSeguro(valorFeature) < numeroSeguro(valorRegra);
    if (comparador === '<=') return numeroSeguro(valorFeature) <= numeroSeguro(valorRegra);
    return false;
  }

  function regraAtendida(feature, regra) {
    var condicoes = regra.regra.condicoes || [];
    var op = regra.regra.op || 'AND';

    if (op === 'OR') {
      for (var i = 0; i < condicoes.length; i++) {
        var c = condicoes[i];
        if (!servicosAtivos[c.grupo]) continue;
        if (comparar(valorSeguro(feature, c.campo), c.comparador, c.valor)) return true;
      }
      return false;
    }

    for (var j = 0; j < condicoes.length; j++) {
      var c2 = condicoes[j];
      if (!servicosAtivos[c2.grupo]) return false;
      if (!comparar(valorSeguro(feature, c2.campo), c2.comparador, c2.valor)) return false;
    }
    return true;
  }


    function dadosFundeinfraDaFeature(feature) {
    var link = valorSeguro(feature, 'LINK_FUND');
    if (!link) return null;
    return obrasFundeinfraPorLink[String(link)] || null;
  }

  function dadosFundeinfraDaFeatureFiltrado(feature, proposta) {
    var dados = dadosFundeinfraDaFeature(feature);
    if (!dados) return null;
    if (!servicosAtivos.FUNDEINFRA) return null;
    if (servicoFiltroAtivo && dados.INTERVENCAO !== servicoFiltroAtivo) return null;
    if (proposta && String(dados.PROPOSTA) !== String(proposta)) return null;
    return dados;
  }

  function dadosDorDaFeature(feature) {
    var dados = dadosDorDaFeatureTodos(feature);
    return dados.length ? dados[0] : null;
  }

  function dadosDorDaFeatureTodos(feature) {
    var link = valorSeguro(feature, 'LINK_DOR');
    if (!link) return [];
    var dados = obrasDorPorLink[String(link)] || [];
    return Array.isArray(dados) ? dados : [dados];
  }

  function dadosDorDaFeatureFiltrados(feature, servico, proposta) {
    var todos = dadosDorDaFeatureTodos(feature);
    var filtrados = [];

    for (var i = 0; i < todos.length; i++) {
      var item = todos[i];
      if (servico && item.INTERVENCAO !== servico) continue;
      if (proposta && String(item.PROPOSTA) !== String(proposta)) continue;
      filtrados.push(item);
    }

    return filtrados;
  }

  function dadosDmaDaFeature(feature) {
    var dados = dadosDmaDaFeatureTodos(feature);
    return dados.length ? dados[0] : null;
  }

  function dadosDmaDaFeatureTodos(feature) {
    var link = valorSeguro(feature, 'LINK_DMA');
    if (!link) return [];
    var dados = obrasDmaPorLink[String(link)] || [];
    return Array.isArray(dados) ? dados : [dados];
  }

  function dadosDmaDaFeatureFiltrados(feature, servico, proposta) {
    var todos = dadosDmaDaFeatureTodos(feature);
    var filtrados = [];

    for (var i = 0; i < todos.length; i++) {
      var item = todos[i];
      if (servico && item.INTERVENCAO !== servico) continue;
      filtrados.push(item);
    }

    return filtrados;
  }

  function dadosDplDaFeature(feature) {
    var dados = dadosDplDaFeatureTodos(feature);
    return dados.length ? dados[0] : null;
  }

  function dadosDplDaFeatureTodos(feature) {
    var link = valorSeguro(feature, 'LINK_DPL');
    if (!link) return [];
    var dados = obrasDplPorLink[String(link)] || [];
    return Array.isArray(dados) ? dados : [dados];
  }

  function dadosDplDaFeatureFiltrados(feature, servico, proposta) {
    var todos = dadosDplDaFeatureTodos(feature);
    var filtrados = [];

    for (var i = 0; i < todos.length; i++) {
      var item = todos[i];
      if (servico && item.INTERVENCAO !== servico) continue;
      filtrados.push(item);
    }

    return filtrados;
  }

  function dadosDpjDaFeature(feature) {
    var dados = dadosDpjDaFeatureTodos(feature);
    return dados.length ? dados[0] : null;
  }

  function dadosDpjDaFeatureTodos(feature) {
    var link = valorSeguro(feature, 'LINK_DPJ');
    if (!link) return [];
    var dados = obrasDpjPorLink[String(link)] || [];
    return Array.isArray(dados) ? dados : [dados];
  }

  function dadosDpjDaFeatureFiltrados(feature, servico, proposta) {
    var todos = dadosDpjDaFeatureTodos(feature);
    var filtrados = [];

    for (var i = 0; i < todos.length; i++) {
      var item = todos[i];
      if (servico && item.INTERVENCAO !== servico) continue;
      filtrados.push(item);
    }

    return filtrados;
  }

  function adicionarReferenciaProposta(lista, origem, proposta) {
    if (proposta === null || proposta === undefined || String(proposta).trim() === '') return;
    var chave = origem + '|' + String(proposta);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].chave === chave) return;
    }
    lista.push({ origem: origem, proposta: proposta, chave: chave });
  }

  function adicionarReferenciaIdcod(lista, origem, idcod) {
    if (idcod === null || idcod === undefined || String(idcod).trim() === '') return;
    var chave = origem + '|IDCOD|' + String(idcod);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].chave === chave) return;
    }
    lista.push({ origem: origem, idcod: idcod, chave: chave });
  }

  function referenciasPropostaDaFeature(feature, dadosFund, dadosDorTodos, dadosDmaTodos, dadosDplTodos, dadosDpjTodos) {
    var referencias = [];
    if (dadosFund) adicionarReferenciaProposta(referencias, 'FUNDEINFRA', dadosFund.PROPOSTA);
    for (var i = 0; i < dadosDorTodos.length; i++) {
      adicionarReferenciaIdcod(referencias, 'DOR', dadosDorTodos[i].IDCOD);
    }
    for (var d = 0; d < dadosDmaTodos.length; d++) {
      adicionarReferenciaIdcod(referencias, 'DMA', dadosDmaTodos[d].IDCOD);
    }
    for (var p = 0; p < dadosDplTodos.length; p++) {
      adicionarReferenciaIdcod(referencias, 'DPL', dadosDplTodos[p].IDCOD);
    }
    for (var j = 0; j < dadosDpjTodos.length; j++) {
      adicionarReferenciaIdcod(referencias, 'DPJ', dadosDpjTodos[j].IDCOD);
    }
    return referencias;
  }

  function featureAtendeReferenciaProposta(feature, referencia) {
    if (!referencia) return false;
    if (referencia.origem === 'FUNDEINFRA') {
      return !!dadosFundeinfraDaFeatureFiltrado(feature, referencia.proposta);
    }
    if (referencia.origem === 'DOR') {
      var dadosDor = dadosDorDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var i = 0; i < dadosDor.length; i++) {
        if (String(dadosDor[i].IDCOD) === String(referencia.idcod)) return true;
      }
    }
    if (referencia.origem === 'DMA') {
      var dadosDma = dadosDmaDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var d = 0; d < dadosDma.length; d++) {
        if (String(dadosDma[d].IDCOD) === String(referencia.idcod)) return true;
      }
    }
    if (referencia.origem === 'DPL') {
      var dadosDpl = dadosDplDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var p = 0; p < dadosDpl.length; p++) {
        if (String(dadosDpl[p].IDCOD) === String(referencia.idcod)) return true;
      }
    }
    if (referencia.origem === 'DPJ') {
      var dadosDpj = dadosDpjDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var j = 0; j < dadosDpj.length; j++) {
        if (String(dadosDpj[j].IDCOD) === String(referencia.idcod)) return true;
      }
    }
    return false;
  }

  function featuresSrePorReferenciasProposta(featureClicada, referencias) {
    var features = [];
    var vistos = {};
    var origem = sreData && sreData.features ? sreData.features : [];

    for (var i = 0; i < origem.length; i++) {
      var feature = origem[i];
      var atende = false;
      for (var r = 0; r < referencias.length; r++) {
        if (featureAtendeReferenciaProposta(feature, referencias[r])) {
          atende = true;
          break;
        }
      }
      if (!atende) continue;

      var chave = [
        nomeSREFeature(feature),
        nomeRodoviaFeature(feature),
        valorTrechoFeature(feature),
        valorExtensaoKmFeature(feature)
      ].join('|');
      if (vistos[chave]) continue;
      vistos[chave] = true;
      features.push(feature);
    }

    if (!features.length && featureClicada) features.push(featureClicada);
    features.sort(function(a, b) {
      return String(nomeRodoviaFeature(a)).localeCompare(String(nomeRodoviaFeature(b)), 'pt-BR', { numeric: true }) ||
        String(nomeSREFeature(a)).localeCompare(String(nomeSREFeature(b)), 'pt-BR', { numeric: true });
    });
    return features;
  }

  function htmlTabelaDadosSre(features, referencias) {
    var propostas = [];
    var itensDor = [];
    var itensDma = [];
    var itensDpl = [];
    var itensDpj = [];
    for (var i = 0; i < referencias.length; i++) {
      if (referencias[i].origem === 'DOR') {
        adicionarUnico(itensDor, String(referencias[i].idcod));
      } else if (referencias[i].origem === 'DMA') {
        adicionarUnico(itensDma, String(referencias[i].idcod));
      } else if (referencias[i].origem === 'DPL') {
        adicionarUnico(itensDpl, String(referencias[i].idcod));
      } else if (referencias[i].origem === 'DPJ') {
        adicionarUnico(itensDpj, String(referencias[i].idcod));
      } else {
        adicionarUnico(propostas, String(referencias[i].proposta));
      }
    }
    var titulo = 'Dados do SRE';
    if (propostas.length) titulo += ' - Proposta ' + propostas.join(', ');
    if (itensDor.length) titulo += ' - IDCOD DOR ' + itensDor.join(', ');
    if (itensDma.length) titulo += ' - IDCOD DMA ' + itensDma.join(', ');
    if (itensDpl.length) titulo += ' - IDCOD DPL ' + itensDpl.join(', ');
    if (itensDpj.length) titulo += ' - IDCOD DPJ ' + itensDpj.join(', ');

    var registros = [];
    var totalExtensao = 0;
    for (var f = 0; f < features.length; f++) {
      var p = features[f].properties || {};
      var extensao = valorExtensaoKmFeature(features[f]);
      var numeroExtensao = Number(String(extensao).replace(',', '.'));
      if (isFinite(numeroExtensao)) totalExtensao += numeroExtensao;
      registros.push({
        SRE: p.sre || p.SRE || '',
        RODOVIA: p.RODOVIA || p.rodovia || '',
        TRECHO: valorTrechoFeature(features[f]),
        EXTENSAO: extensao === '' ? '' : String(extensao) + ' km'
      });
    }

    if (features.length > 1) {
      registros.push({
        SRE: 'Total',
        EXTENSAO: totalExtensao.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' km'
      });
    }

    var html = tabelaRegistrosHtml(titulo, registros, [
      { chave: 'SRE', rotulo: 'SRE' },
      { chave: 'RODOVIA', rotulo: 'Rodovia' },
      { chave: 'TRECHO', rotulo: 'Trecho' },
      { chave: 'EXTENSAO', rotulo: 'Extensão' }
    ]);
    return html.replace('titulo-servico', 'titulo-servico titulo-cinza');
  }
  function dadosObrasPontosDaFeatureTodos(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var chave = props.__PONTO_TABELA_COORDENADA ? props.__CHAVE_AGREGADORA_PONTO : valorSeguro(feature, 'LINK');
    if (!chave) return [];
    var dados = obrasPontosPorLink[String(chave).trim()] || [];
    if (!dados.length && props.__PONTO_TABELA_COORDENADA && props.__DADOS_OBRA_PONTO) return [props.__DADOS_OBRA_PONTO];
    return Array.isArray(dados) ? dados : [dados];
  }

  function dadosObrasPontosDaFeature(feature) {
    var dados = dadosObrasPontosDaFeatureTodos(feature);
    return dados.length ? dados[0] : null;
  }

  function origemObraPonto(dados) {
    return origemNormalizadaObraPonto(dados);
  }

  function rotuloIdentificadorObraPonto(dados) {
    return origemObraPonto(dados) === 'FUNDEINFRA' ? 'Proposta' : 'IDCOD';
  }

  function valorIdentificadorObraPonto(dados) {
    if (!dados) return '';
    return origemObraPonto(dados) === 'FUNDEINFRA' ? dados.PROPOSTA : (dados.IDCOD || dados.LINK || '');
  }

  function rotuloColunaIdentificadorObraPonto(dadosLista) {
    var temFundeinfra = false;
    var temOutrasOrigens = false;

    for (var i = 0; i < dadosLista.length; i++) {
      if (origemObraPonto(dadosLista[i]) === 'FUNDEINFRA') temFundeinfra = true;
      else temOutrasOrigens = true;
    }

    if (temFundeinfra && temOutrasOrigens) return 'Proposta/IDCOD';
    return temFundeinfra ? 'Proposta' : 'IDCOD';
  }

  function intervencaoEhOAE(dados) {
    return valorIntervencaoDados(dados).toUpperCase().indexOf('OAE') >= 0;
  }

  function tipoObraPonto(dados) {
    var tipo = String((dados && dados.TIPO) || '').trim().toUpperCase();
    if (tipo === 'PONTO' || tipo === 'LINHA') {
      if (intervencaoEhOAE(dados)) return 'OAE';
      return valorIntervencaoDados(dados).toUpperCase();
    }
    return tipo;
  }

  function valorFiltroObraPonto(dados) {
    return valorIntervencaoDados(dados);
  }

  function algumaOrigemObraPontoAtiva() {
    return !!(servicosAtivos.FUNDEINFRA || servicosAtivos.DOC || servicosAtivos.DSV || servicosAtivos.DOR || servicosAtivos.DMA || servicosAtivos.DPL || servicosAtivos.DPJ);
  }

  function algumaOrigemObraAeroAtiva() {
    return !!(servicosAtivos.DOR || servicosAtivos.DMA || servicosAtivos.DPJ);
  }

  function dadosObrasPontosFiltrados(feature, proposta) {
    var todos = dadosObrasPontosDaFeatureTodos(feature);
    var filtrados = [];

    for (var i = 0; i < todos.length; i++) {
      var item = todos[i];
      var origem = origemObraPonto(item);
      if (!servicosAtivos[origem]) continue;
      if (proposta && (origem !== 'FUNDEINFRA' || String(item.PROPOSTA) !== String(proposta))) continue;
      if (servicoFiltroAtivo && valorFiltroObraPonto(item) !== servicoFiltroAtivo) continue;
      filtrados.push(item);
    }

    return filtrados;
  }

  function dadosObrasAeroFiltrados(feature) {
    var filtrados = [];
    if (servicosAtivos.DOR) {
      var dadosDor = dadosDorDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var i = 0; i < dadosDor.length; i++) {
        filtrados.push(Object.assign({}, dadosDor[i], {
          ORIGEM: 'DOR',
          __TIPO_PONTO_AERO: 'AERO_OBRA'
        }));
      }
    }
    if (servicosAtivos.DMA) {
      var dadosDma = dadosDmaDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var d = 0; d < dadosDma.length; d++) {
        filtrados.push(Object.assign({}, dadosDma[d], {
          ORIGEM: 'DMA',
          ETAPA: dadosDma[d].ETAPA || 'Manutenção',
          __TIPO_PONTO_AERO: 'AERO_OBRA'
        }));
      }
    }
    if (servicosAtivos.DPJ) {
      var dadosDpj = dadosDpjDaFeatureFiltrados(feature, servicoFiltroAtivo, '');
      for (var j = 0; j < dadosDpj.length; j++) {
        filtrados.push(Object.assign({}, dadosDpj[j], {
          ORIGEM: 'DPJ',
          __TIPO_PONTO_AERO: 'AERO_OBRA'
        }));
      }
    }
    return filtrados;
  }

  function valorItemExportacao(dados) {
    if (!dados) return '';
    if (dados.ITEM !== null && dados.ITEM !== undefined && String(dados.ITEM).trim() !== '') return dados.ITEM;
    if (dados.PROPOSTA !== null && dados.PROPOSTA !== undefined && String(dados.PROPOSTA).trim() !== '') return dados.PROPOSTA;
    return '';
  }

  function valorExportacaoCompleta(valor) {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'object') {
      try {
        return JSON.stringify(valor);
      } catch (e) {
        return String(valor);
      }
    }
    return valor;
  }

  function adicionarCamposExportacao(destino, prefixo, fonte) {
    if (!fonte) return;
    Object.keys(fonte).forEach(function(chave) {
      if (!chave || chave.indexOf('__') === 0) return;
      destino[prefixo + chave] = valorExportacaoCompleta(fonte[chave]);
    });
  }

  function registroExportacao(feature, origem, tipo, dados) {
    var p = feature.properties || {};
    var linkCampo = origem === 'FUNDEINFRA' ? 'LINK_FUND' :
      origem === 'DOR' ? 'LINK_DOR' :
      origem === 'DMA' ? 'LINK_DMA' :
      origem === 'DPL' ? 'LINK_DPL' :
      origem === 'DPJ' ? 'LINK_DPJ' : 'LINK';
    var link = valorSeguro(feature, linkCampo) || valorSeguro(feature, 'LINK');

    var registro = {
      ORIGEM: origem,
      TIPO: tipo,
      INTERVENCAO: (dados && dados.INTERVENCAO) || '',
      ETAPA: (dados && dados.ETAPA) || '',
      PROPOSTA_ITEM: valorItemExportacao(dados),
      RODOVIA: nomeRodoviaFeature(feature),
      SRE: nomeSREFeature(feature),
      TRECHO: valorTrechoFeature(feature),
      EXT_KM: valorExtensaoKmFeature(feature),
      MUNICIPIO: p.NM_MUN || p.MUNICIPIO || '',
      REGIAO_PLANEJAMENTO: p.RG_PLAN || '',
      LINK: link
    };

    adicionarCamposExportacao(registro, 'GEO_', p);
    adicionarCamposExportacao(registro, 'TAB_', dados);

    return registro;
  }

  function adicionarRegistrosObraLinear(linhas, feature, origem, dadosLista) {
    for (var i = 0; i < dadosLista.length; i++) {
      linhas.push(registroExportacao(feature, origem, 'Obra linear', dadosLista[i]));
    }
  }

  function coletarDadosTabularesFiltrados() {
    var linhas = [];
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var rgSelecionada = regioesSelecionadas('rgPlanSelect');
    var municipioSelecionado = document.getElementById('municipioSelect').value;
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var featuresMunicipios = municipiosFiltrados();

    function featureAtendeFiltrosEspaciais(feature) {
      if (!featureAtendeRegioes(feature)) return false;
      var nmMun = valorSeguro(feature, 'NM_MUN') || valorSeguro(feature, 'MUNICIPIO');
      var rgPlan = nomeRegiaoPlanejamento(feature);
      if (municipioSelecionado && nmMun && nmMun !== municipioSelecionado) return false;
      if (!municipioSelecionado && rgSelecionada.length && rgPlan && !rgSelecionada.includes(rgPlan)) return false;
      if (rodoviaSelecionada && nomeRodoviaFeature(feature) !== rodoviaSelecionada) return false;
      if (sreSelecionado && nomeSREFeature(feature) !== sreSelecionado) return false;
      return true;
    }


    if (sreData && sreData.features) {
      for (var i = 0; i < sreData.features.length; i++) {
        var feature = sreData.features[i];
        if (!featureAtendeFiltrosEspaciais(feature)) continue;

        if (servicosAtivos.FUNDEINFRA) {
          var dadosFund = dadosFundeinfraDaFeatureFiltrado(feature, propostaSelecionada);
          if (dadosFund) {
            linhas.push(registroExportacao(feature, 'FUNDEINFRA', 'Obra linear', dadosFund));
          }
        }

        if (servicosAtivos.DOR) {
          adicionarRegistrosObraLinear(linhas, feature, 'DOR', dadosDorDaFeatureFiltrados(feature, servicoFiltroAtivo, ''));
        }

        if (servicosAtivos.DMA) {
          adicionarRegistrosObraLinear(linhas, feature, 'DMA', dadosDmaDaFeatureFiltrados(feature, servicoFiltroAtivo, ''));
        }

        if (servicosAtivos.DPL) {
          adicionarRegistrosObraLinear(linhas, feature, 'DPL', dadosDplDaFeatureFiltrados(feature, servicoFiltroAtivo, ''));
        }

        if (servicosAtivos.DPJ) {
          adicionarRegistrosObraLinear(linhas, feature, 'DPJ', dadosDpjDaFeatureFiltrados(feature, servicoFiltroAtivo, ''));
        }
      }
    }

    if (obrasPontosData && obrasPontosData.features && algumaOrigemObraPontoAtiva()) {
      for (var p = 0; p < obrasPontosData.features.length; p++) {
        var ponto = obrasPontosData.features[p];
        if (!featureAtendeFiltrosEspaciais(ponto)) continue;
        var coords = ponto.geometry && ponto.geometry.coordinates;
        if (!coords || coords.length < 2) continue;
        if (!pontoDentroSelecaoMunicipios(coords[0], coords[1], featuresMunicipios)) continue;
        var dadosPontos = dadosObrasPontosFiltrados(ponto, propostaSelecionada);
        for (var ip = 0; ip < dadosPontos.length; ip++) {
          var itemPonto = dadosPontos[ip];
          linhas.push(registroExportacao(ponto, origemObraPonto(itemPonto), 'Obra pontual', Object.assign({}, itemPonto, {
            INTERVENCAO: itemPonto.INTERVENCAO || 'Obra pontual'
          })));
        }
      }
    }

    if (aeroObrasData && aeroObrasData.features && algumaOrigemObraAeroAtiva() && !rodoviaSelecionada && !sreSelecionado) {
      for (var a = 0; a < aeroObrasData.features.length; a++) {
        var aero = aeroObrasData.features[a];
        var coordsAero = aero.geometry && aero.geometry.coordinates;
        if (!coordsAero || coordsAero.length < 2) continue;
        if (!pontoDentroSelecaoMunicipios(coordsAero[0], coordsAero[1], featuresMunicipios)) continue;
        var dadosAero = dadosObrasAeroFiltrados(aero);
        for (var ia = 0; ia < dadosAero.length; ia++) {
          var itemAero = dadosAero[ia];
          linhas.push(registroExportacao(aero, origemObraPonto(itemAero), 'Obra em aeródromo/aeroporto', Object.assign({}, itemAero, {
            INTERVENCAO: itemAero.INTERVENCAO || 'Aeródromos'
          })));
        }
      }
    }

    return linhas;
  }

  function valorCsv(valor) {
    var texto = String(valor === null || valor === undefined ? '' : valor);
    if (/[;"\r\n]/.test(texto)) {
      return '"' + texto.replace(/"/g, '""') + '"';
    }
    return texto;
  }

  function formatarNumeroCsvBr(valor) {
    if (valor === null || valor === undefined || String(valor).trim() === '') return '';
    var texto = String(valor).trim();
    if (texto.indexOf(',') >= 0) return texto;
    return texto.replace('.', ',');
  }

  function compararExportacao(a, b) {
    return String(a.ORIGEM || '').localeCompare(String(b.ORIGEM || ''), 'pt-BR', { numeric: true }) ||
      String(a.PROPOSTA_ITEM || '').localeCompare(String(b.PROPOSTA_ITEM || ''), 'pt-BR', { numeric: true }) ||
      String(a.RODOVIA || '').localeCompare(String(b.RODOVIA || ''), 'pt-BR', { numeric: true }) ||
      String(a.SRE || '').localeCompare(String(b.SRE || ''), 'pt-BR', { numeric: true }) ||
      String(a.TRECHO || '').localeCompare(String(b.TRECHO || ''), 'pt-BR', { numeric: true });
  }

  function colunasExportacao(linhas) {
    var principais = ['ORIGEM', 'TIPO', 'INTERVENCAO', 'ETAPA', 'PROPOSTA_ITEM', 'RODOVIA', 'SRE', 'TRECHO', 'EXT_KM', 'MUNICIPIO', 'REGIAO_PLANEJAMENTO', 'LINK'];
    var vistas = {};
    var colunas = [];

    function adicionar(coluna) {
      if (vistas[coluna]) return;
      vistas[coluna] = true;
      colunas.push(coluna);
    }

    principais.forEach(adicionar);
    linhas.forEach(function(linha) {
      Object.keys(linha).forEach(adicionar);
    });

    return colunas;
  }

  function exportarTabelaFiltradaCsv() {
    var linhas = coletarDadosTabularesFiltrados();
    if (!linhas.length) {
      alert('Nenhum dado tabular encontrado para os filtros atuais.');
      return;
    }

    linhas.sort(compararExportacao);

    var colunas = colunasExportacao(linhas);
    var conteudo = colunas.join(';') + '\r\n';
    for (var i = 0; i < linhas.length; i++) {
      conteudo += colunas.map(function(coluna) {
        var valor = coluna === 'EXT_KM' ? formatarNumeroCsvBr(linhas[i][coluna]) : linhas[i][coluna];
        return valorCsv(valor);
      }).join(';') + '\r\n';
    }

    var agora = new Date();
    var sufixo = agora.getFullYear() +
      String(agora.getMonth() + 1).padStart(2, '0') +
      String(agora.getDate()).padStart(2, '0') + '_' +
      String(agora.getHours()).padStart(2, '0') +
      String(agora.getMinutes()).padStart(2, '0');
    var blob = new Blob(['\ufeff' + conteudo], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'dados_filtrados_mapa_' + sufixo + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function estiloObraPonto(dados) {
    if (dados && dados.__TIPO_PONTO_AERO === 'AERO_OBRA') {
      if (origemObraPonto(dados) === 'DMA') return OBRAS_PONTOS_INFO.Manutencao;
      if (origemObraPonto(dados) === 'DPJ') return OBRAS_PONTOS_INFO.Projeto;
    }
    var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
    if (tipoObraPonto(dados) === 'OAE') {
      if (etapa.indexOf('planejamento') >= 0) return OBRAS_PONTOS_INFO.OaePlanejamento;
      if (etapa.indexOf('projeto') >= 0) return OBRAS_PONTOS_INFO.OaeProjeto;
      if (etapa.indexOf('obra') >= 0) return OBRAS_PONTOS_INFO.OaeObra;
    }
    if (etapa.indexOf('planejamento') >= 0) return OBRAS_PONTOS_INFO.Planejamento;
    if (etapa.indexOf('projeto') >= 0) return OBRAS_PONTOS_INFO.Projeto;
    if (etapa.indexOf('obra') >= 0) return OBRAS_PONTOS_INFO.Obra;
    return OBRAS_PONTOS_INFO.Padrao;
  }

    function estiloDor(dados) {
      var servico = String((dados && dados.INTERVENCAO) || '').toLowerCase();
      var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
      var cor = '#666666';
      var tipoLinha = 'NORMAL';

      if (servico.indexOf('pavimenta') >= 0) cor = '#dc0101';
      else if (servico.indexOf('duplica') >= 0) cor = '#001efe';
      else if (servico.indexOf('restaura') >= 0) cor = '#10a000';
      else if (servico.indexOf('revitaliza') >= 0) cor = '#7db0b4';
      else if (servico.indexOf('terraplenagem') >= 0) cor = '#91522d';
      else if (servico.indexOf('melhoria') >= 0) cor = '#ff9601';
      else if (servico === 'drenagem') cor = '#b398f3';
      else if (servico.indexOf('amplia') >= 0) cor = '#ff7bbd';
      else if (servico.indexOf('reforma') >= 0) cor = '#14b8a6';

      if (servico.indexOf('revitaliza') >= 0 && etapa.indexOf('planejamento') >= 0) tipoLinha = 'COM LINHA BRANCA DOR';

      return {
        cor: cor,
        tipo_linha: tipoLinha,
        espessura: 7,
        legenda: ((dados && dados.INTERVENCAO) || 'Intervenção') + ' - ' + ((dados && dados.ETAPA) || 'Etapa')
      };
    }

  function estiloDma(dados) {
    return estiloDor(dados);
  }

  function estiloDpl(dados) {
    var estilo = estiloDor(dados);
    var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
    if (etapa.indexOf('planejamento') >= 0) estilo.tipo_linha = 'COM LINHA BRANCA TRACEJADA';
    return estilo;
  }

  function estiloDpj(dados) {
    var estilo = estiloDpl(dados);
    var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
    if (etapa.indexOf('projeto') >= 0) estilo.tipo_linha = 'COM LINHA BRANCA';
    return estilo;
  }

  function estiloFundeinfra(dados) {
    var servico = String((dados && dados.INTERVENCAO) || '').toLowerCase();
    var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
    var cor = '#666666';

    if (servico.indexOf('pavimenta') >= 0) cor = '#dc0101';
    else if (servico.indexOf('duplica') >= 0) cor = '#001efe';
    else if (servico.indexOf('restaura') >= 0) cor = '#10a000';
    else if (servico.indexOf('melhoria') >= 0) cor = '#ff9601';

    return {
      cor: cor,
      tipo_linha: etapa.indexOf('projeto') >= 0 ? 'COM LINHA BRANCA' : 'NORMAL',
      espessura: 9,
      legenda: ((dados && dados.INTERVENCAO) || 'Intervenção') + ' - ' + ((dados && dados.ETAPA) || 'Etapa')
    };
  }

  function coordenadasLinhaPrincipal(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    if (geometry.type === 'LineString') return geometry.coordinates;
    if (geometry.type === 'MultiLineString') {
      var maior = null;
      for (var i = 0; i < geometry.coordinates.length; i++) {
        var linha = geometry.coordinates[i];
        if (!maior || (linha && linha.length > maior.length)) maior = linha;
      }
      return maior;
    }
    return null;
  }

  function pontoMedioLinha(feature) {
    var coords = coordenadasLinhaPrincipal(feature && feature.geometry);
    if (!coords || coords.length < 2) return null;
    var midIndex = Math.floor(coords.length / 2);
    var midCoord = coords[midIndex];
    if (!midCoord || midCoord.length < 2) return null;
    return [midCoord[1], midCoord[0]];
  }

  function segmentoMedioLinha(feature) {
    var coords = coordenadasLinhaPrincipal(feature && feature.geometry);
    if (!coords || coords.length < 2) return null;
    var midIndex = Math.floor(coords.length / 2);
    var anterior = coords[Math.max(0, midIndex - 1)];
    var proximo = coords[Math.min(coords.length - 1, midIndex + 1)];
    if (!anterior || !proximo || anterior.length < 2 || proximo.length < 2) return null;
    return {
      a: [anterior[1], anterior[0]],
      b: [proximo[1], proximo[0]]
    };
  }

  function anguloSegmentoMedio(feature) {
    var segmento = segmentoMedioLinha(feature);
    if (!segmento) return 0;
    var pontoA = map.latLngToLayerPoint(segmento.a);
    var pontoB = map.latLngToLayerPoint(segmento.b);
    return Math.atan2(pontoB.y - pontoA.y, pontoB.x - pontoA.x) * 180 / Math.PI;
  }

  function siglaOrigemEtapa(dados, origem, link) {
    var linkTxt = String(link || '');
    var prefixo = linkTxt.split('_')[0];
    if (origem === 'DMA' || prefixo === 'DMA') return 'Ma';
    if (origem === 'DPL' || prefixo === 'DPL') return 'Pl';
    if (origem === 'DPJ' || prefixo === 'DPJ') return 'Pj';
    if (prefixo && prefixo.length <= 3) {
      return prefixo.charAt(0).toUpperCase() + prefixo.slice(1).toLowerCase();
    }

    if (origem === 'DOR') return 'Do';

    var etapa = String((dados && dados.ETAPA) || '').toLowerCase();
    if (etapa.indexOf('projeto') >= 0) return 'Fp';
    return 'Fo';
  }

  function criarRotuloObra(latlng, dados, origem, link, cor, angulo) {
    var sigla = siglaOrigemEtapa(dados, origem, link);
    var identificador = '';
    if (origem === 'FUNDEINFRA') {
      identificador = dados && dados.PROPOSTA !== null && dados.PROPOSTA !== undefined ? String(dados.PROPOSTA) : '';
    } else {
      identificador = dados && dados.ITEM !== null && dados.ITEM !== undefined ? String(dados.ITEM) : '';
    }
    var titulo = origem + ' - ' + ((dados && dados.INTERVENCAO) || 'Intervencao') + ' - ' + ((dados && dados.ETAPA) || 'Etapa');
    var anguloOffset = isFinite(angulo) ? angulo + 90 : 0;

    return L.marker(latlng, {
      pane: 'rotulosServicosPane',
      interactive: false,
      anguloLinhaObra: isFinite(angulo) ? angulo : 0,
      anguloOffsetObra: anguloOffset,
      icon: L.divIcon({
        className: 'obra-label-icon',
        html:
          '<div class="obra-label-chamada" style="background:' + cor + ';"></div>' +
          '<div class="obra-label-offset">' +
          '<div class="obra-label" title="' + escapeHtml(titulo) + '">' +
            '<div class="obra-label-top">' + escapeHtml(sigla) + '</div>' +
            '<div class="obra-label-bottom" style="background:' + cor + ';">' + escapeHtml(identificador) + '</div>' +
          '</div>' +
          '</div>',
        iconSize: [42, 46],
        iconAnchor: [21, 23]
      })
    });
  }

  function adicionarRotuloObra(grupo, feature, dados, origem, link, cor) {
    var latlng = pontoMedioLinha(feature);
    if (!latlng) return;
    grupo.addLayer(criarRotuloObra(latlng, dados, origem, link, cor, anguloSegmentoMedio(feature)));
  }

  function retangulosOcupadosRotulosBase() {
    var ocupados = [];

    if (localidadesLayer && localidadeFiltroAtivo) {
      localidadesLayer.eachLayer(function(layer) {
        var el = layer.getElement && layer.getElement();
        if (!el || el.style.display === 'none') return;

        var p = map.latLngToContainerPoint(layer.getLatLng());
        if (layer.options && layer.options.icon && layer.options.icon.options.className === 'localidade-label') {
          ocupados.push({
            left: p.x - 66,
            right: p.x + 66,
            top: p.y - 22,
            bottom: p.y + 10,
            tipo: 'base'
          });
        } else if (layer instanceof L.CircleMarker) {
          ocupados.push({
            left: p.x - 8,
            right: p.x + 8,
            top: p.y - 8,
            bottom: p.y + 8,
            tipo: 'base'
          });
        }
      });
    }

    function adicionarEscudos(layerGroup) {
      if (!layerGroup) return;
      layerGroup.eachLayer(function(layer) {
        var el = layer.getElement && layer.getElement();
        if (!el || el.style.display === 'none') return;

        var p = map.latLngToContainerPoint(layer.getLatLng());
        var metade = layer.options && layer.options.tipoRotulo === 'federal' ? 24 : 20;
        ocupados.push({
          left: p.x - metade,
          right: p.x + metade,
          top: p.y - metade,
          bottom: p.y + metade,
          tipo: 'base'
        });
      });
    }

    adicionarEscudos(sreBaseLabelLayer);
    adicionarEscudos(snvLabelLayer);

    return ocupados;
  }

  function retangulosSobrepostos(a, b) {
    return !(a.right < b.left || a.left > b.right ||
             a.bottom < b.top || a.top > b.bottom);
  }

  function pontoDentroRetangulo(p, r) {
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }

  function orientacaoSegmento(a, b, c) {
    return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  }

  function segmentosCruzam(a, b, c, d) {
    var o1 = orientacaoSegmento(a, b, c);
    var o2 = orientacaoSegmento(a, b, d);
    var o3 = orientacaoSegmento(c, d, a);
    var o4 = orientacaoSegmento(c, d, b);
    return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
  }

  function segmentoCruzaRetangulo(a, b, r, margem) {
    var rect = {
      left: r.left - margem,
      right: r.right + margem,
      top: r.top - margem,
      bottom: r.bottom + margem
    };

    if (pontoDentroRetangulo(a, rect) || pontoDentroRetangulo(b, rect)) return true;

    var tl = { x: rect.left, y: rect.top };
    var tr = { x: rect.right, y: rect.top };
    var br = { x: rect.right, y: rect.bottom };
    var bl = { x: rect.left, y: rect.bottom };
    return segmentosCruzam(a, b, tl, tr) ||
      segmentosCruzam(a, b, tr, br) ||
      segmentosCruzam(a, b, br, bl) ||
      segmentosCruzam(a, b, bl, tl);
  }

  function atualizarVisibilidadeRotulosObras() {
    if (!obrasLabelLayer) return;
    var mostrar = document.body.classList.contains('modo-impressao') &&
      rotulosObrasPrintAtivos;
    var ocupados = retangulosOcupadosRotulosBase();

    obrasLabelLayer.eachLayer(function(layer) {
      var el = layer.getElement && layer.getElement();
      if (!el) return;

      el.style.display = mostrar ? 'block' : 'none';
      if (!mostrar) return;

      var offsetEl = el.querySelector('.obra-label-offset');
      var chamadaEl = el.querySelector('.obra-label-chamada');
      if (!offsetEl) return;

      var base = map.latLngToContainerPoint(layer.getLatLng());
      var anguloLinha = layer.options.anguloLinhaObra || 0;
      var anguloPerp = layer.options.anguloOffsetObra || 90;
      var radPerp = anguloPerp * Math.PI / 180;
      var radLinha = anguloLinha * Math.PI / 180;
      var largura = 50;
      var altura = 54;
      var raioRotulo = 21;
      var folga = 5;
      var distanciaInicial = 24;
      var distancias = [distanciaInicial, 29, 34, 40, 47, 55, 64, 74, 86, 100, 116];
      var deslocamentos = [0, 14, -14, 28, -28, 42, -42, 56, -56, 72, -72, 90, -90];
      var angulosRadiais = [90, -90, 67, -67, 112, -112, 45, -45, 135, -135];
      var melhor = null;

      function avaliarCandidato(cx, cy, prioridade, distancia, deslocamento) {
        var rect = {
          left: cx - largura / 2 - folga,
          right: cx + largura / 2 + folga,
          top: cy - altura / 2 - folga,
          bottom: cy + altura / 2 + folga
        };
        var centro = { x: cx, y: cy };
        var pontuacao = prioridade + distancia * 1.8 + Math.abs(deslocamento) * 0.7;
        var temSobreposicao = false;

        for (var oi = 0; oi < ocupados.length; oi++) {
          var area = ocupados[oi];
          if (retangulosSobrepostos(rect, area)) {
            temSobreposicao = true;
            pontuacao += area.tipo === 'base' ? 50000 : 120000;
          }
          if (segmentoCruzaRetangulo(base, centro, area, area.tipo === 'base' ? 5 : 2)) {
            pontuacao += area.tipo === 'base' ? 8000 : 4500;
          }
        }

        if (temSobreposicao) pontuacao += 20000;

        if (!melhor || pontuacao < melhor.pontuacao) {
          melhor = {
            pontuacao: pontuacao,
            rect: rect,
            dx: cx - base.x,
            dy: cy - base.y
          };
        }
      }

      for (var di = 0; di < distancias.length; di++) {
        for (var li = 0; li < deslocamentos.length; li++) {
          for (var ladoTentativa = 0; ladoTentativa < 2; ladoTentativa++) {
            var lado = ladoTentativa === 0 ? 1 : -1;
            var distanciaPerp = distancias[di];
            var deslocamentoLinha = deslocamentos[li];
            avaliarCandidato(
              base.x + Math.cos(radPerp) * distanciaPerp * lado + Math.cos(radLinha) * deslocamentoLinha,
              base.y + Math.sin(radPerp) * distanciaPerp * lado + Math.sin(radLinha) * deslocamentoLinha,
              ladoTentativa * 8,
              distanciaPerp,
              deslocamentoLinha
            );
          }
        }
      }

      for (var ai = 0; ai < angulosRadiais.length; ai++) {
        var rad = (anguloLinha + angulosRadiais[ai]) * Math.PI / 180;
        for (var ri = 0; ri < 6; ri++) {
          avaliarCandidato(
            base.x + Math.cos(rad) * distancias[ri],
            base.y + Math.sin(rad) * distancias[ri],
            18 + Math.abs(90 - Math.abs(angulosRadiais[ai])) * 0.25,
            distancias[ri],
            0
          );
        }
      }

      var escolhido = melhor || {
        rect: {
          left: base.x - largura / 2,
          right: base.x + largura / 2,
          top: base.y - altura / 2,
          bottom: base.y + altura / 2
        },
        dx: Math.cos(radPerp) * distanciaInicial,
        dy: Math.sin(radPerp) * distanciaInicial
      };

      offsetEl.style.transform =
        'translate(' + escolhido.dx.toFixed(1) + 'px, ' + escolhido.dy.toFixed(1) + 'px)';
      if (chamadaEl) {
        var comprimentoCentro = Math.sqrt(escolhido.dx * escolhido.dx + escolhido.dy * escolhido.dy);
        var comprimentoLinha = Math.max(0, comprimentoCentro - raioRotulo);
        var anguloChamada = Math.atan2(escolhido.dy, escolhido.dx) * 180 / Math.PI;
        chamadaEl.style.display = comprimentoLinha > 6 ? 'block' : 'none';
        chamadaEl.style.width = comprimentoLinha.toFixed(1) + 'px';
        chamadaEl.style.transform = 'rotate(' + anguloChamada.toFixed(2) + 'deg)';
      }
      ocupados.push(escolhido.rect);
    });
  }

  function valorExibicao(valor) {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'string') return valor.trim();
    return valor;
  }

  function campoPreenchido(valor) {
    return valorExibicao(valor) !== '';
  }

  function htmlCampoPopup(rotulo, valor, sufixo) {
    var exibicao = valorExibicao(valor);
    if (exibicao === '') return '';
    return '<b>' + escapeHtml(rotulo) + ':</b> ' + escapeHtml(exibicao) + (sufixo || '') + '<br>';
  }

  function htmlCamposPopup(dados, campos) {
    var html = '';
    for (var i = 0; i < campos.length; i++) {
      html += htmlCampoPopup(campos[i].rotulo, dados && dados[campos[i].chave]);
    }
    return html.replace(/<br>$/, '');
  }

  function camposVisiveisTabela(registros, campos) {
    var visiveis = [];
    for (var c = 0; c < campos.length; c++) {
      var campo = campos[c];
      for (var i = 0; i < registros.length; i++) {
        if (campoPreenchido(registros[i] && registros[i][campo.chave])) {
          visiveis.push(campo);
          break;
        }
      }
    }
    return visiveis;
  }

  function tabelaRegistrosHtml(titulo, registros, campos) {
    if (!registros || !registros.length) return '';
    var camposVisiveis = camposVisiveisTabela(registros, campos);
    if (!camposVisiveis.length) return '';

    var html = '<div class="bloco-servico">' +
      '<div class="titulo-servico">' + escapeHtml(titulo) + '</div>' +
      '<table class="tabela-servico"><tr>';

    for (var c = 0; c < camposVisiveis.length; c++) {
      html += '<th>' + escapeHtml(camposVisiveis[c].rotulo) + '</th>';
    }

    html += '</tr>';
    for (var i = 0; i < registros.length; i++) {
      var classeLinha = registros[i] && registros[i].__SELECIONADO_GRUPO ? ' class="linha-selecionada-grupo"' : '';
      html += '<tr' + classeLinha + '>';
      for (var d = 0; d < camposVisiveis.length; d++) {
        html += '<td>' + escapeHtml(valorExibicao(registros[i][camposVisiveis[d].chave])) + '</td>';
      }
      html += '</tr>';
    }

    return html + '</table></div>';
  }

  var CORES_ALTERACAO = {
    'Estadualiza\u00e7\u00e3o': '#159447',
    'Federaliza\u00e7\u00e3o': '#1d4ed8',
    'Municipaliza\u00e7\u00e3o': '#dc2626'
  };

  var CAMPOS_ALTERACOES_POPUP = [
    { chave: 'TIPO', rotulo: 'Tipo' },
    { chave: 'PROCESSO', rotulo: 'Processo' },
    { chave: 'MUNICIPIOS', rotulo: 'Munic\u00edpios' },
    { chave: 'SITUACAO_ATUAL', rotulo: 'Situa\u00e7\u00e3o atual' }
  ];

  var CAMPOS_ALTERACOES_TABELA = [
    { chave: 'ID', rotulo: 'ID' },
    { chave: 'TIPO', rotulo: 'Tipo' },
    { chave: 'PROCESSO', rotulo: 'Processo' },
    { chave: 'MUNICIPIOS', rotulo: 'Munic\u00edpios' },
    { chave: 'RODOVIA', rotulo: 'Rodovia' },
    { chave: 'EXTENSAO_KM', rotulo: 'Extens\u00e3o km' },
    { chave: 'PORTARIA_SRE', rotulo: 'Portaria SRE' },
    { chave: 'TRECHO', rotulo: 'Trecho' },
    { chave: 'LEI_MUNICIPAL', rotulo: 'Lei municipal' },
    { chave: 'EXPOSICAO_DE_MOTIVOS', rotulo: 'Exposi\u00e7\u00e3o de motivos' },
    { chave: 'LEI_ESTADUAL', rotulo: 'Lei estadual' },
    { chave: 'TERMO_DE_TRANSFERENCIA', rotulo: 'Termo de transfer\u00eancia' },
    { chave: 'SITUACAO_ATUAL', rotulo: 'Situa\u00e7\u00e3o atual' }
  ];

  function atualizarBotoesAlteracoes() {
    var tiposSelecionados = TIPOS_ALTERACAO.filter(function(tipo) { return alteracoesAtivas[tipo]; });
    document.getElementById('alteracaoJurisdicaoSelect').value = tiposSelecionados.length === 1 ? tiposSelecionados[0] : '';
    var botao = document.getElementById('toggleAlteracoesJurisdicao');
    botao.classList.toggle('ativo-filtro', alteracoesReferenciaAtiva);
    botao.setAttribute('aria-pressed', String(alteracoesReferenciaAtiva));
  }

  function definirAlteracoesAtivas(valor) {
    alteracoesReferenciaAtiva = !!valor;
    for (var i = 0; i < TIPOS_ALTERACAO.length; i++) {
      alteracoesAtivas[TIPOS_ALTERACAO[i]] = !!valor;
    }
    atualizarBotoesAlteracoes();
  }

  function algumaAlteracaoAtiva() {
    if (!alteracoesReferenciaAtiva) return false;
    for (var i = 0; i < TIPOS_ALTERACAO.length; i++) {
      if (alteracoesAtivas[TIPOS_ALTERACAO[i]]) return true;
    }
    return false;
  }

  function normalizarAlteracaoRegistro(item) {
    var registro = {};
    item = item || {};
    for (var i = 0; i < CAMPOS_ALTERACOES_TABELA.length; i++) {
      var chave = CAMPOS_ALTERACOES_TABELA[i].chave;
      registro[chave] = item[chave];
    }
    return registro;
  }

  function atualizarAlteracoesTabela(registros) {
    alteracoesTabelaData = Array.isArray(registros) ? registros.map(normalizarAlteracaoRegistro) : [];
    alteracoesPorId = {};
    for (var i = 0; i < alteracoesTabelaData.length; i++) {
      var id = alteracoesTabelaData[i].ID;
      if (id === null || id === undefined || String(id).trim() === '') continue;
      alteracoesPorId[String(id).trim()] = alteracoesTabelaData[i];
    }
  }

  function dadosAlteracaoDaFeature(feature) {
    var id = valorSeguro(feature, 'ID');
    if (id === null || id === undefined || String(id).trim() === '') return null;
    return alteracoesPorId[String(id).trim()] || null;
  }

  function corAlteracao(tipo) {
    return CORES_ALTERACAO[tipo] || '#64748b';
  }

  function construirPopupAlteracao(feature) {
    var dados = dadosAlteracaoDaFeature(feature);
    if (!dados) return '<b>Nenhum dado encontrado</b>';
    return htmlCamposPopup(dados, CAMPOS_ALTERACOES_POPUP) || '<b>Nenhum dado encontrado</b>';
  }

  function atualizarPainelInferiorAlteracao(feature) {
    var dados = dadosAlteracaoDaFeature(feature);
    var registros = dados ? [dados] : [];
    var html = tabelaRegistrosHtml('Altera\u00e7\u00f5es de Jurisdi\u00e7\u00e3o', registros, CAMPOS_ALTERACOES_TABELA);
    if (html) html += htmlAcoesTabelaCompleta('alteracao');
    document.getElementById('painelTabelaConteudo').innerHTML = html || '<em>Nenhum dado encontrado para este trecho.</em>';
  }

  function desenharAlteracoesJuridicao() {
    if (alteracoesLayer) {
      map.removeLayer(alteracoesLayer);
      alteracoesLayer = null;
    }
    if (!alteracoesData || !alteracoesData.features || !algumaAlteracaoAtiva()) return {};

    var features = [];
    var legendas = {};
    for (var i = 0; i < alteracoesData.features.length; i++) {
      var feature = alteracoesData.features[i];
      if (!featureAtendeRegioes(feature)) continue;
      var dados = dadosAlteracaoDaFeature(feature);
      if (!dados || !alteracoesAtivas[dados.TIPO]) continue;
      features.push(feature);
      legendas[dados.TIPO] = corAlteracao(dados.TIPO);
    }
    if (!features.length) return legendas;

    var sombra = L.geoJSON({ type: 'FeatureCollection', features: features }, {
      pane: 'servicosPane',
      interactive: false,
      style: function(feature) {
        var dados = dadosAlteracaoDaFeature(feature);
        return {
          color: dados ? corAlteracao(dados.TIPO) : '#111827',
          weight: 10,
          opacity: 0.20,
          lineCap: 'round',
          lineJoin: 'round'
        };
      }
    });

    var linhas = L.geoJSON({ type: 'FeatureCollection', features: features }, {
      pane: 'servicosPane',
      style: function(feature) {
        var dados = dadosAlteracaoDaFeature(feature);
        return {
          color: dados ? corAlteracao(dados.TIPO) : '#64748b',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        };
      },
      onEachFeature: function(feature, layer) {
        vincularPopupComAreaClique(layer, construirPopupAlteracao(feature));
        layer.on('click', function() {
          piscarFeatureClicada(feature);
          atualizarPainelInferiorAlteracao(feature);
        });
      }
    });

    alteracoesLayer = L.layerGroup([sombra, linhas]).addTo(map);
    return legendas;
  }

  var CAMPOS_LINHA_FUNDEINFRA = [
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'PROPOSTA', rotulo: 'Proposta' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'CONCLUSAO', rotulo: 'Conclusão' },
    { chave: 'MODALIDADE', rotulo: 'Modalidade' },
    { chave: 'EMPRESA', rotulo: 'Empresa' },
    { chave: 'CONTRATO', rotulo: 'Contrato' },
    { chave: 'PROCESSO_SEI_CONTRATACAO', rotulo: 'Processo SEI Contratação' }
  ];

  var CAMPOS_LINHA_FUNDEINFRA_TABELA = CAMPOS_LINHA_FUNDEINFRA.concat([
    { chave: 'DESCRICAO', rotulo: 'Descrição' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualização' }
  ]);

  var CAMPOS_LINHA_UNIDADE = [
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'CONCLUSAO', rotulo: 'Conclusão' }
  ];

  var CAMPOS_LINHA_UNIDADE_TABELA = CAMPOS_LINHA_UNIDADE.concat([
    { chave: 'DESCRICAO', rotulo: 'Descrição' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualização' }
  ]);

  var CAMPOS_LISTA_LINHAS_FILTRADAS = [
    { chave: '__ORIGEM_LISTA', rotulo: 'Origem' },
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'PROPOSTA', rotulo: 'Proposta' },
    { chave: 'INTERVENCAO', rotulo: 'Interven\u00e7\u00e3o' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'DESCRICAO', rotulo: 'Descri\u00e7\u00e3o' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualiza\u00e7\u00e3o' }
  ];

  var CAMPOS_LISTA_PONTOS_FILTRADOS = [
    { chave: '__ORIGEM_LISTA', rotulo: 'Origem' },
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'PROPOSTA', rotulo: 'Proposta' },
    { chave: 'LOCALIDADE', rotulo: 'Localidade' },
    { chave: 'INTERVENCAO', rotulo: 'Interven\u00e7\u00e3o' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'CONTRATO', rotulo: 'Contrato' },
    { chave: 'RODOVIA', rotulo: 'Rodovia' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'DESCRICAO', rotulo: 'Descri\u00e7\u00e3o' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualiza\u00e7\u00e3o' }
  ];

  function htmlAcoesTabelaCompleta(tipo) {
    return '<div class="painel-tabela-acoes">' +
      '<button type="button" class="btn-tabela-acao" data-lista-filtrada="' + tipo + '">Mostrar todos registros</button>' +
      '</div>';
  }

  function limparDestaqueTabelaCompleta() {
    if (destaqueTabelaCompletaLayer) {
      map.removeLayer(destaqueTabelaCompletaLayer);
      destaqueTabelaCompletaLayer = null;
    }
  }

  function limparDestaqueClique() {
    if (destaqueCliqueTimerId) {
      clearInterval(destaqueCliqueTimerId);
      destaqueCliqueTimerId = null;
    }
    if (destaqueCliqueLayer) {
      map.removeLayer(destaqueCliqueLayer);
      destaqueCliqueLayer = null;
    }
  }

  // Piscada de destaque sobre a linha/ponto clicado no mapa, para indicar
  // visualmente qual elemento originou as informações exibidas no painel.
  // Usa um pane próprio (acima do popupPane do Leaflet) para não ficar
  // escondida atrás do popup que abre no mesmo clique.
  function piscarFeatureClicada(feature) {
    limparDestaqueClique();
    if (!feature || !feature.geometry) return;
    destaqueCliqueLayer = L.geoJSON(feature, {
      pane: 'destaqueCliquePane',
      interactive: false,
      pointToLayer: function(f, latlng) {
        return L.circleMarker(latlng, { radius: 16, color: '#facc15', weight: 5, fillColor: '#fef9c3', fillOpacity: 0.55 });
      },
      style: function() {
        return { color: '#facc15', weight: 11, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
      }
    }).addTo(map);

    var visivel = true;
    var repeticoes = 0;
    destaqueCliqueTimerId = setInterval(function() {
      visivel = !visivel;
      var estilo = { opacity: visivel ? 0.9 : 0, fillOpacity: visivel ? 0.55 : 0 };
      destaqueCliqueLayer.eachLayer(function(l) {
        if (l.setStyle) l.setStyle(estilo);
      });
      repeticoes++;
      if (repeticoes >= 4) limparDestaqueClique();
    }, 180);
  }

  function registrarZoomTabelaCompleta(features, tipo) {
    var id = registrosZoomTabelaCompleta.length;
    registrosZoomTabelaCompleta.push({ features: features, tipo: tipo });
    return id;
  }

  // 'features' pode ser uma única feature ou um array de features (quando o
  // mesmo registro/obra abrange vários trechos/segmentos, ex.: várias SREs).
  function prepararRegistroListaCompleta(dados, origem, features, tipo) {
    var registro = Object.assign({}, dados || {});
    registro.__ORIGEM_LISTA = origem || '';
    registro.__ZOOM_ID = registrarZoomTabelaCompleta(Array.isArray(features) ? features : [features], tipo);
    return registro;
  }

  function rotuloCampoListaCompleta(chave) {
    if (chave === '__ORIGEM_LISTA') return 'Origem';
    return String(chave).replace(/_/g, ' ');
  }

  function camposTodosPreenchidosTabelaCompleta(registros) {
    var ordem = [];
    var vistos = {};
    function adicionar(chave) {
      if (!chave || chave === '__ZOOM_ID' || chave === '__SELECIONADO_GRUPO' || vistos[chave]) return;
      vistos[chave] = true;
      ordem.push(chave);
    }
    adicionar('__ORIGEM_LISTA');
    for (var i = 0; i < registros.length; i++) {
      var chaves = Object.keys(registros[i] || {});
      for (var c = 0; c < chaves.length; c++) adicionar(chaves[c]);
    }
    var campos = [];
    for (var o = 0; o < ordem.length; o++) {
      var chave = ordem[o];
      for (var r = 0; r < registros.length; r++) {
        if (campoPreenchido(registros[r][chave])) {
          campos.push({ chave: chave, rotulo: rotuloCampoListaCompleta(chave) });
          break;
        }
      }
    }
    return campos;
  }

  function tabelaRegistrosComZoomHtml(titulo, registros, campos) {
    if (!registros || !registros.length) return '';
    var camposVisiveis = camposTodosPreenchidosTabelaCompleta(registros);
    var html = '<div class="bloco-servico bloco-lista-filtrada">' +
      '<div class="titulo-servico">' + escapeHtml(titulo) + '</div>' +
      '<div class="busca-lista-filtrada-wrap"><input id="buscaListaFiltrada" class="busca-lista-filtrada" type="search" placeholder="Pesquisar nesta tabela" autocomplete="off" /></div>' +
      '<table class="tabela-servico tabela-lista-filtrada"><tr><th>Zoom</th>';
    for (var c = 0; c < camposVisiveis.length; c++) html += '<th>' + escapeHtml(camposVisiveis[c].rotulo) + '</th>';
    html += '</tr>';
    for (var i = 0; i < registros.length; i++) {
      html += '<tr data-linha-zoom="' + registros[i].__ZOOM_ID + '"><td><button type="button" class="btn-zoom-registro" data-zoom-registro="' + registros[i].__ZOOM_ID + '">Zoom</button></td>';
      for (var d = 0; d < camposVisiveis.length; d++) html += '<td>' + escapeHtml(valorExibicao(registros[i][camposVisiveis[d].chave])) + '</td>';
      html += '</tr>';
    }
    return html + '</table></div>';
  }

  function featureAtendeFiltrosLinhaLista(feature, rodoviaSelecionada, sreSelecionado) {
    if (!featureAtendeRegioes(feature)) return false;
    if (rodoviaSelecionada && nomeRodoviaFeature(feature) !== rodoviaSelecionada) return false;
    if (sreSelecionado && nomeSREFeature(feature) !== sreSelecionado) return false;
    return true;
  }

  function coletarLinhasFiltradasParaTabela() {
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var linksFundIncluidos = {};
    if (!sreData || !sreData.features) return [];

    // O mesmo registro (IDCOD) pode estar vinculado a vários trechos/SREs.
    // Agrupamos por IDCOD para exibir uma única linha na tabela, mas
    // guardamos todas as features associadas para o Zoom abranger o
    // trecho inteiro (todas as SREs), não só o primeiro segmento.
    var gruposPorChave = {};
    var ordemChaves = [];
    function addAoGrupo(feature, origem, lista) {
      for (var i = 0; i < lista.length; i++) {
        var dados = lista[i];
        var idcod = dados && dados.IDCOD;
        var chave = origem + '|' + (idcod != null && idcod !== '' ? String(idcod) : ('__sem_idcod_' + ordemChaves.length));
        if (!gruposPorChave[chave]) {
          gruposPorChave[chave] = { dados: dados, origem: origem, features: [] };
          ordemChaves.push(chave);
        }
        gruposPorChave[chave].features.push(feature);
      }
    }
    if (servicosAtivos.FUNDEINFRA) {
      for (var f = 0; f < sreData.features.length; f++) {
        var featureFund = sreData.features[f];
        var linkFund = valorSeguro(featureFund, 'LINK_FUND');
        if (!linkFund) continue;
        if (!featureAtendeFiltrosLinhaLista(featureFund, rodoviaSelecionada, sreSelecionado)) continue;
        var dadosFund = dadosFundeinfraDaFeatureFiltrado(featureFund, propostaSelecionada);
        if (!dadosFund) continue;
        addAoGrupo(featureFund, 'FUNDEINFRA', [dadosFund]);
        linksFundIncluidos[String(linkFund)] = true;
      }
    }
    var configs = [
      { origem: 'DOR', campo: 'LINK_DOR', fn: dadosDorDaFeatureFiltrados },
      { origem: 'DMA', campo: 'LINK_DMA', fn: dadosDmaDaFeatureFiltrados },
      { origem: 'DPL', campo: 'LINK_DPL', fn: dadosDplDaFeatureFiltrados },
      { origem: 'DPJ', campo: 'LINK_DPJ', fn: dadosDpjDaFeatureFiltrados }
    ];
    for (var c = 0; c < configs.length; c++) {
      var cfg = configs[c];
      if (!servicosAtivos[cfg.origem]) continue;
      for (var i = 0; i < sreData.features.length; i++) {
        var feature = sreData.features[i];
        if (!valorSeguro(feature, cfg.campo)) continue;
        if (servicosAtivos.FUNDEINFRA && valorSeguro(feature, 'LINK_FUND') && linksFundIncluidos[String(valorSeguro(feature, 'LINK_FUND'))]) continue;
        if (!featureAtendeFiltrosLinhaLista(feature, rodoviaSelecionada, sreSelecionado)) continue;
        addAoGrupo(feature, cfg.origem, cfg.fn(feature, servicoFiltroAtivo, ''));
      }
    }

    var registros = [];
    for (var g = 0; g < ordemChaves.length; g++) {
      var grupo = gruposPorChave[ordemChaves[g]];
      registros.push(prepararRegistroListaCompleta(grupo.dados, grupo.origem, grupo.features, 'linha'));
    }
    return registros;
  }

  function coletarPontosFiltradosParaTabela() {
    var registros = [];
    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var featuresMunicipios = municipiosFiltrados();
    if (!obrasPontosData || !obrasPontosData.features || !algumaOrigemObraPontoAtiva()) return registros;
    for (var i = 0; i < obrasPontosData.features.length; i++) {
      var feature = obrasPontosData.features[i];
      if (rodoviaSelecionada && nomeRodoviaFeature(feature) !== rodoviaSelecionada) continue;
      if (sreSelecionado && nomeSREFeature(feature) !== sreSelecionado) continue;
      var coords = feature.geometry && feature.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      if (!pontoDentroSelecaoMunicipios(coords[0], coords[1], featuresMunicipios)) continue;
      var dadosFiltrados = dadosObrasPontosFiltrados(feature, propostaSelecionada);
      for (var d = 0; d < dadosFiltrados.length; d++) registros.push(prepararRegistroListaCompleta(dadosFiltrados[d], origemObraPonto(dadosFiltrados[d]), feature, 'ponto'));
    }
    return registros;
  }

  function coletarAlteracoesFiltradasParaTabela() {
    var registros = [];
    if (!alteracoesData || !alteracoesData.features || !algumaAlteracaoAtiva()) return registros;
    for (var i = 0; i < alteracoesData.features.length; i++) {
      var feature = alteracoesData.features[i];
      var dados = dadosAlteracaoDaFeature(feature);
      if (!dados || !alteracoesAtivas[dados.TIPO]) continue;
      registros.push(prepararRegistroListaCompleta(dados, dados.TIPO, feature, 'alteracao'));
    }
    return registros;
  }

  function renderizarListaCompletaFiltrada(tipo) {
    var painel = document.getElementById('painelTabelaConteudo');
    htmlPainelAntesListaCompleta = painel ? painel.innerHTML : '';
    limparDestaqueTabelaCompleta();
    registrosZoomTabelaCompleta = [];
    var registros = [];
    var campos = [];
    var titulo = 'Registros filtrados';
    if (tipo === 'alteracao') {
      registros = coletarAlteracoesFiltradasParaTabela();
      campos = CAMPOS_ALTERACOES_TABELA;
      titulo = 'Altera\u00e7\u00f5es de Jurisdi\u00e7\u00e3o filtradas (' + registros.length + ')';
    } else if (tipo === 'ponto') {
      registros = coletarPontosFiltradosParaTabela();
      campos = CAMPOS_LISTA_PONTOS_FILTRADOS;
      titulo = 'Obras pontuais filtradas (' + registros.length + ')';
    } else {
      registros = coletarLinhasFiltradasParaTabela();
      campos = CAMPOS_LISTA_LINHAS_FILTRADAS;
      titulo = 'Obras lineares filtradas (' + registros.length + ')';
    }
    var html = '<div class="painel-tabela-acoes">' +
      '<button type="button" class="btn-tabela-acao" data-voltar-lista-filtrada="1">Voltar</button>' +
      '<span class="painel-tabela-info">Filtros atuais confirmados.</span>' +
      '</div>';
    html += registros.length ? tabelaRegistrosComZoomHtml(titulo, registros, campos) : '<em>Nenhum registro encontrado com os filtros atuais.</em>';
    document.getElementById('painelTabelaConteudo').innerHTML = html;
  }

  function zoomParaRegistroTabelaCompleta(id) {
    var item = registrosZoomTabelaCompleta[Number(id)];
    if (!item || !item.features || !item.features.length) return;
    limparDestaqueTabelaCompleta();
    destaqueTabelaCompletaLayer = L.geoJSON({ type: 'FeatureCollection', features: item.features }, {
      pane: item.tipo === 'ponto' ? 'oaePane' : 'servicosPane',
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, { radius: 11, color: '#0b7a2a', weight: 4, fillColor: '#dff5e6', fillOpacity: 0.65 });
      },
      style: function() {
        return { color: '#0b7a2a', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
      }
    }).addTo(map);
    var bounds = destaqueTabelaCompletaLayer.getBounds && destaqueTabelaCompletaLayer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { paddingTopLeft: [70, 70], paddingBottomRight: [70, 70], maxZoom: item.tipo === 'ponto' ? 13 : 11 });
    }
  }

    function construirPopupLinha(feature) {
      var p = feature.properties || {};
      var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
      var dadosFund = dadosFundeinfraDaFeatureFiltrado(feature, propostaSelecionada);
      var dadosDorTodos = servicosAtivos.DOR ? dadosDorDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDmaTodos = servicosAtivos.DMA ? dadosDmaDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDplTodos = servicosAtivos.DPL ? dadosDplDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDpjTodos = servicosAtivos.DPJ ? dadosDpjDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];

      var html = '';
      html += htmlCampoPopup('SRE', p.sre || p.SRE);
      html += htmlCampoPopup('Rodovia', p.RODOVIA || p.rodovia);
      html += htmlCampoPopup('Trecho', valorTrechoFeature(feature));
      html += htmlCampoPopup('Extensão', valorExtensaoKmFeature(feature), ' km');

      if (dadosFund) {
        var htmlFund = htmlCamposPopup(dadosFund, CAMPOS_LINHA_FUNDEINFRA);
        if (htmlFund) html += '<br><b>-- FUNDEINFRA --</b><br>' + htmlFund;
      }

      function adicionarRegistrosPopup(titulo, registros) {
        if (!registros.length) return;
        var bloco = '';
        for (var i = 0; i < registros.length; i++) {
          var htmlRegistro = htmlCamposPopup(registros[i], CAMPOS_LINHA_UNIDADE);
          if (!htmlRegistro) continue;
          if (bloco) bloco += '<br>';
          if (registros.length > 1) bloco += '<b>Registro ' + (i + 1) + '</b><br>';
          bloco += htmlRegistro;
        }
        if (bloco) html += '<br><br><b>-- ' + escapeHtml(titulo) + ' --</b><br>' + bloco;
      }

      adicionarRegistrosPopup('DOR', dadosDorTodos);
      adicionarRegistrosPopup('DMA', dadosDmaTodos);
      adicionarRegistrosPopup('DPL', dadosDplTodos);
      adicionarRegistrosPopup('DPJ', dadosDpjTodos);

      return html || '<b>Nenhum dado encontrado</b>';
    }
    function construirLayerNormal(features, cor, espessura) {
      var sombra = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        interactive: false,
        style: function() {
          return {
            color: '#111827',
            weight: espessura + 5,
            opacity: 0.24,
            lineCap: 'round',
            lineJoin: 'round'
          };
        }
      });

      var linha = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        style: function() {
          return {
            color: cor,
            weight: espessura,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, construirPopupLinha(feature));

          layer.on('click', function() {
            piscarFeatureClicada(feature);
            atualizarPainelInferior(feature);
          });
        }
      });

      return L.layerGroup([sombra, linha]);
    }

    function construirLayerLinhaBranca(features, cor, espessura) {
      var pesoBase = 9;
      var pesoTopo = 3;

      var sombra = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        interactive: false,
        style: function() {
          return {
            color: '#111827',
            weight: pesoBase + 5,
            opacity: 0.24,
            lineCap: 'round',
            lineJoin: 'round'
          };
        }
      });

      var base = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        style: function() {
          return {
            color: cor,
            weight: pesoBase,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, construirPopupLinha(feature));

          layer.on('click', function() {
            piscarFeatureClicada(feature);
            atualizarPainelInferior(feature);
          });
        }
      });

      var topo = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        style: function() {
          return {
            color: '#ffffff',
            weight: pesoTopo,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round'
          };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, construirPopupLinha(feature));

          layer.on('click', function() {
            piscarFeatureClicada(feature);
            atualizarPainelInferior(feature);
          });
        }
      });

      return L.layerGroup([sombra, base, topo]);
    }

    function construirLayerLinhaBrancaTracejada(features, cor, espessura) {
      var pesoBase = 9;
      var pesoTopo = 3;

      var sombra = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        interactive: false,
        style: function() {
          return {
            color: '#111827',
            weight: pesoBase + 5,
            opacity: 0.24,
            lineCap: 'round',
            lineJoin: 'round'
          };
        }
      });

      var base = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        style: function() {
          return {
            color: cor,
            weight: pesoBase,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, construirPopupLinha(feature));

          layer.on('click', function() {
            piscarFeatureClicada(feature);
            atualizarPainelInferior(feature);
          });
        }
      });

      var topo = L.geoJSON({
        type: 'FeatureCollection',
        features: features
      }, {
        pane: 'servicosPane',
        style: function() {
          return {
            color: '#ffffff',
            weight: pesoTopo,
            opacity: 1,
            dashArray: '8,6',
            lineCap: 'butt',
            lineJoin: 'round'
          };
        },
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, construirPopupLinha(feature));

          layer.on('click', function() {
            piscarFeatureClicada(feature);
            atualizarPainelInferior(feature);
          });
        }
      });

      return L.layerGroup([sombra, base, topo]);
    }
  
  function criarLegendaLinha(tipo, cor) {
    if (tipo === 'dup') {
      return '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha-dup-base" style="height:5px;background:' + cor + ';"></span>' +
        '<span class="legenda-linha-dup-miolo" style="height:2px;"></span>' +
      '</span>';
    }
    if (tipo === 'dashed-red') {
      return '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha-eod-base" style="height:5px;background:' + cor + ';"></span>' +
        '<span class="legenda-linha-eod-miolo" style="border-top:2px dashed ' + cor + '; background:transparent; height:0;"></span>' +
      '</span>';
    }
    if (tipo === 'dashed-green') {
      return '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha legenda-linha-tracejada" style="border-top-color:' + cor + '; border-top-width:3px;"></span>' +
      '</span>';
    }
    return '<span class="legenda-linha-wrap">' +
      '<span class="legenda-linha" style="height:4px;background:' + cor + ';"></span>' +
    '</span>';
  }

  function renderizarLegendaAlteracoes(legendasVisiveis) {
    var bloco = document.getElementById('blocoLegendaAlteracoes');
    var alvo = document.getElementById('legendaAlteracoes');
    if (!bloco || !alvo) return;

    alvo.innerHTML = '';
    var total = 0;
    for (var i = 0; i < TIPOS_ALTERACAO.length; i++) {
      var tipo = TIPOS_ALTERACAO[i];
      if (!legendasVisiveis || !legendasVisiveis[tipo]) continue;
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML = '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha" style="height:9px;background:' + legendasVisiveis[tipo] + ';"></span>' +
        '</span><div class="legenda-texto">' + escapeHtml(tipo) + '</div>';
      alvo.appendChild(item);
      total++;
    }
    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaIntervencaos(legendasVisiveis) {
    var alvo = document.getElementById('legendaIntervencaos'); if(!alvo) return;
    var bloco = document.getElementById('legendaIntervencaos').closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var linhas = (legendasVisiveis && legendasVisiveis.linhas) || legendasVisiveis || {};
    var pontos = (legendasVisiveis && legendasVisiveis.pontos) || {};
    var nomes = Object.keys(linhas || {}).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var i = 0; i < nomes.length; i++) {
      var legenda = nomes[i];
      var cor = linhas[legenda] || '#666666';
      var projeto = String(legenda).toLowerCase().indexOf('projeto') >= 0;
      var item = document.createElement('div');
      item.className = 'legenda-item';

      if (projeto) {
        item.innerHTML =
          '<span class="legenda-linha-wrap">' +
            '<span class="legenda-linha-projeto-base" style="height:9px;background:' + cor + ';"></span>' +
            '<span class="legenda-linha-projeto-topo" style="height:4.5px;"></span>' +
          '</span>' +
          legenda;
      } else {
        item.innerHTML =
          '<span class="legenda-linha-wrap">' +
            '<span class="legenda-linha" style="height:9px;background:' + cor + ';"></span>' +
          '</span>' +
          legenda;
      }

      alvo.appendChild(item);
      total++;
    }

    var ordemPontos = ['OaePlanejamento', 'OaeProjeto', 'OaeObra', 'Planejamento', 'Projeto', 'Manutencao', 'Obra', 'Padrao'];
    for (var p = 0; p < ordemPontos.length; p++) {
      var chavePonto = ordemPontos[p];
      if (!pontos[chavePonto]) continue;
      var info = OBRAS_PONTOS_INFO[chavePonto];
      var itemPonto = document.createElement('div');
      itemPonto.className = 'legenda-item';
      itemPonto.innerHTML =
        criarHtmlSimboloObraPonto(info.classe, 'legenda-ponto-simbolo', info.icone) +
        '<div class="legenda-texto">' + escapeHtml(info.label) + '</div>';
      alvo.appendChild(itemPonto);
      total++;
    }

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaPontos(alvoId, pontos) {
    var alvo = document.getElementById(alvoId); if(!alvo) return;
    var bloco = alvo.closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var ordemPontos = ['OaePlanejamento', 'OaeProjeto', 'OaeObra', 'Planejamento', 'Projeto', 'Manutencao', 'Obra', 'Padrao'];
    for (var p = 0; p < ordemPontos.length; p++) {
      var chavePonto = ordemPontos[p];
      if (!pontos || !pontos[chavePonto]) continue;
      var info = OBRAS_PONTOS_INFO[chavePonto];
      var itemPonto = document.createElement('div');
      itemPonto.className = 'legenda-item';
      itemPonto.innerHTML =
        criarHtmlSimboloObraPonto(info.classe, 'legenda-ponto-simbolo', info.icone) +
        '<div class="legenda-texto">' + escapeHtml(info.label) + '</div>';
      alvo.appendChild(itemPonto);
      total++;
    }

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaDoc(legendasVisiveis) {
    renderizarLegendaPontos('legendaDoc', legendasVisiveis || {});
  }

  function renderizarLegendaDsv(legendasVisiveis) {
    renderizarLegendaPontos('legendaDsv', legendasVisiveis || {});
  }

  function adicionarItensLegendaPontos(alvo, pontos) {
    var total = 0;
    var ordemPontos = ['OaePlanejamento', 'OaeProjeto', 'OaeObra', 'Planejamento', 'Projeto', 'Manutencao', 'Obra', 'Padrao'];
    for (var p = 0; p < ordemPontos.length; p++) {
      var chavePonto = ordemPontos[p];
      if (!pontos || !pontos[chavePonto]) continue;
      var info = OBRAS_PONTOS_INFO[chavePonto];
      var itemPonto = document.createElement('div');
      itemPonto.className = 'legenda-item';
      itemPonto.innerHTML =
        criarHtmlSimboloObraPonto(info.classe, 'legenda-ponto-simbolo', info.icone) +
        '<div class="legenda-texto">' + escapeHtml(info.label) + '</div>';
      alvo.appendChild(itemPonto);
      total++;
    }
    return total;
  }

  function corLegendaIntervencao(info) {
    if (info && typeof info === 'object') return info.cor || '#666666';
    return info || '#666666';
  }

  function tipoLinhaLegendaIntervencao(info) {
    if (info && typeof info === 'object') return info.tipo_linha || 'NORMAL';
    return 'NORMAL';
  }

  function htmlLegendaIntervencao(info) {
    var cor = corLegendaIntervencao(info);
    if (tipoLinhaLegendaIntervencao(info) === 'COM LINHA BRANCA TRACEJADA') {
      return '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha-projeto-base" style="height:9px;background:' + cor + ';"></span>' +
        '<span class="legenda-linha-projeto-topo" style="height:0;border-top:4.5px dashed #ffffff;background:transparent;"></span>' +
      '</span>';
    }
    if (tipoLinhaLegendaIntervencao(info) === 'COM LINHA BRANCA DOR' || tipoLinhaLegendaIntervencao(info) === 'COM LINHA BRANCA') {
      return '<span class="legenda-linha-wrap">' +
        '<span class="legenda-linha-projeto-base" style="height:9px;background:' + cor + ';"></span>' +
        '<span class="legenda-linha-projeto-topo" style="height:4.5px;"></span>' +
      '</span>';
    }
    return '<span class="legenda-linha-wrap">' +
      '<span class="legenda-linha" style="height:9px;background:' + cor + ';"></span>' +
    '</span>';
  }

  function renderizarLegendaDor(legendasVisiveis, pontosVisiveis) {
    var alvo = document.getElementById('legendaDor'); if(!alvo) return;
    var bloco = document.getElementById('legendaDor').closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var nomes = Object.keys(legendasVisiveis || {}).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var i = 0; i < nomes.length; i++) {
      var legenda = nomes[i];
      var infoLegenda = legendasVisiveis[legenda] || '#666666';
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML =
        htmlLegendaIntervencao(infoLegenda) +
        legenda;
      alvo.appendChild(item);
      total++;
    }

    total += adicionarItensLegendaPontos(alvo, pontosVisiveis);

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaDma(legendasVisiveis, pontosVisiveis) {
    var alvo = document.getElementById('legendaDma'); if(!alvo) return;
    var bloco = document.getElementById('legendaDma').closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var nomes = Object.keys(legendasVisiveis || {}).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var i = 0; i < nomes.length; i++) {
      var legenda = nomes[i];
      var infoLegenda = legendasVisiveis[legenda] || '#666666';
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML =
        htmlLegendaIntervencao(infoLegenda) +
        legenda;
      alvo.appendChild(item);
      total++;
    }

    total += adicionarItensLegendaPontos(alvo, pontosVisiveis);

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaDpl(legendasVisiveis, pontosVisiveis) {
    var alvo = document.getElementById('legendaDpl'); if(!alvo) return;
    var bloco = document.getElementById('legendaDpl').closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var nomes = Object.keys(legendasVisiveis || {}).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var i = 0; i < nomes.length; i++) {
      var legenda = nomes[i];
      var infoLegenda = legendasVisiveis[legenda] || '#666666';
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML =
        htmlLegendaIntervencao(infoLegenda) +
        legenda;
      alvo.appendChild(item);
      total++;
    }

    total += adicionarItensLegendaPontos(alvo, pontosVisiveis);

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaDpj(legendasVisiveis, pontosVisiveis) {
    var alvo = document.getElementById('legendaDpj'); if(!alvo) return;
    var bloco = document.getElementById('legendaDpj').closest('.bloco');
    alvo.innerHTML = '';

    var total = 0;
    var nomes = Object.keys(legendasVisiveis || {}).sort(function(a, b) {
      return String(a).localeCompare(String(b), 'pt-BR');
    });

    for (var i = 0; i < nomes.length; i++) {
      var legenda = nomes[i];
      var infoLegenda = legendasVisiveis[legenda] || '#666666';
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML =
        htmlLegendaIntervencao(infoLegenda) +
        legenda;
      alvo.appendChild(item);
      total++;
    }

    total += adicionarItensLegendaPontos(alvo, pontosVisiveis);

    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaOAE(eixosVisiveis) {
    var alvo = document.getElementById('legendaOAE'); if(!alvo) return;
    var bloco = document.getElementById('blocoLegendaOAE');
    alvo.innerHTML = '';
    var total = 0;
    var ordem = [1,2,3,4,5,6,100,101];
    for (var i = 0; i < ordem.length; i++) {
      var e = ordem[i];
      if (!eixosVisiveis || !eixosVisiveis[e]) continue;
      total++;
      var info = OAE_LEGENDA_INFO[e];
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML = '<span class="legenda-simbolo" style="background:' + info.cor + ';"></span>' +
        '<div class="legenda-texto"><b>' + info.titulo + '</b>' + (info.desc ? ' — ' + info.desc : '') + '</div>';
      alvo.appendChild(item);
    }
    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaRodEst(situacoesVisiveis) {
    var bloco = document.getElementById('blocoLegendaRodEst');
    var alvo = document.getElementById('legendaRodEst');
    if (!bloco || !alvo) return;
    if (typeof sreBaseFiltroAtivo !== 'undefined' && !sreBaseFiltroAtivo) {
      alvo.innerHTML = '';
      bloco.style.display = 'none';
      return;
    }
    
    alvo.innerHTML = '';
    var ordem = ['DUP','PAV','EOD','EOP','IMP','LEN','PLA'];
    var total = 0;
    for (var i = 0; i < ordem.length; i++) {
      var s = ordem[i];
      if (!situacoesVisiveis || !situacoesVisiveis[s]) continue;
      total++;
      var info = ROD_EST_INFO[s];
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML = criarLegendaLinha(info.tipo, info.cor) + '<div class="legenda-texto">' + info.label + '</div>';
      alvo.appendChild(item);
    }
    bloco.style.display = total > 0 ? '' : 'none';
  }

  function renderizarLegendaRodFed(situacoesVisiveis) {
    var bloco = document.getElementById('blocoLegendaRodFed');
    var alvo = document.getElementById('legendaRodFed');
    if (!bloco || !alvo) return;
    if (typeof snvFiltroAtivo !== 'undefined' && !snvFiltroAtivo) {
      alvo.innerHTML = '';
      bloco.style.display = 'none';
      return;
    }
    
    alvo.innerHTML = '';
    var ordem = ['DUP','LEN','EOP','PAV'];
    var total = 0;
    for (var i = 0; i < ordem.length; i++) {
      var s = ordem[i];
      if (!situacoesVisiveis || !situacoesVisiveis[s]) continue;
      total++;
      var info = ROD_FED_INFO[s];
      var item = document.createElement('div');
      item.className = 'legenda-item';
      item.innerHTML = criarLegendaLinha(info.tipo, info.cor) + '<div class="legenda-texto">' + info.label + '</div>';
      alvo.appendChild(item);
    }
    bloco.style.display = total > 0 ? '' : 'none';
  }


  function zoomParaGoias() {
    var bounds = L.geoJSON(municipiosData).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        paddingTopLeft: [20, 20],
        paddingBottomRight: [20, 20]
      });
    }
  }

  function zoomParaOriginal() {
    map.setView(originalCenter, originalZoom);
  }

  function zoomParaLocalidade(nomeLocalidade) {
    var feature = localidadesData.features.find(function(feature) {
      return valorSeguro(feature, 'NOME_ACEN') === nomeLocalidade;
    });

    if (!feature) {
      zoomParaGoias();
      return;
    }

    var coords = feature.geometry.coordinates[0];
    var latlng = [coords[1], coords[0]];
    var targetZoom = Math.min(map.getMaxZoom(), Math.round(originalZoom + Math.log2(70)));

    map.setView(latlng, targetZoom);
  }

  function zoomParaSelecao(features) {
    if (!features || !features.length) {
      zoomParaGoias();
      return;
    }

    var bounds = L.geoJSON({
      type: 'FeatureCollection',
      features: features
    }).getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        paddingTopLeft: [60, 60],
        paddingBottomRight: [60, 60],
        maxZoom: 11
      });
    }
  }

  function tabelaHtmlObjeto(titulo, dados, classeTitulo) {
    dados = dados || {};
    var chaves = Object.keys(dados).filter(function(chave) {
      return campoPreenchido(dados[chave]);
    });
    if (!chaves.length) return '';

    var html = '<div class="bloco-servico">' +
      '<div class="titulo-servico ' + (classeTitulo || '') + '">' + escapeHtml(titulo) + '</div>' +
      '<table class="tabela-servico">';

    for (var i = 0; i < chaves.length; i++) {
      var chave = chaves[i];
      html += '<tr><th>' + escapeHtml(chave) + '</th><td>' + escapeHtml(valorExibicao(dados[chave])) + '</td></tr>';
    }

    html += '</table></div>';
    return html;
  }

  var CAMPOS_OBRA_PONTO_POPUP = [
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'UNIDADE', rotulo: 'Unidade' },
    { chave: 'PROPOSTA', rotulo: 'Proposta' },
    { chave: 'LOCALIDADE', rotulo: 'Localidade' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'SEI_OBRA', rotulo: 'SEI Obra' },
    { chave: 'CONTRATO', rotulo: 'Contrato' },
    { chave: 'RODOVIA', rotulo: 'Rodovia' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' }
  ];

  var CAMPOS_OBRA_PONTO_TABELA = CAMPOS_OBRA_PONTO_POPUP.concat([
    { chave: 'DESCRICAO', rotulo: 'Descrição' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualização' }
  ]);

  function valorCampoTabelaObraPonto(dados, chave) {
    if (!dados) return '';
    var valor = dados[chave];
    if (valor === null || valor === undefined) return '';
    return typeof valor === 'string' ? valor.trim() : valor;
  }

  function htmlPopupCamposTabelaObraPonto(dados) {
    var html = '';
    for (var i = 0; i < CAMPOS_OBRA_PONTO_POPUP.length; i++) {
      var campo = CAMPOS_OBRA_PONTO_POPUP[i];
      var valor = valorCampoTabelaObraPonto(dados, campo.chave);
      if (valor === '') continue;
      html += '<b>' + escapeHtml(campo.rotulo) + ':</b> ' + escapeHtml(valor) + '<br>';
    }
    return html.replace(/<br>$/, '');
  }

  function construirPopupObraPonto(feature) {
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var dadosTodos = dadosObrasPontosFiltrados(feature, propostaSelecionada);
    var totalDados = dadosTodos.length;
    var dadosPopup = totalDados ? dadosTodos[0] : null;
    var html = dadosPopup ? htmlPopupCamposTabelaObraPonto(dadosPopup) : '';

    if (totalDados > 1) {
      var restantes = totalDados - 1;
      html += '<br><br><span class="popup-obras-pontos-aviso">Existem mais ' +
        restantes + ' ' + (restantes === 1 ? 'obra' : 'obras') +
        ' neste ponto. Veja a lista completa no painel inferior.</span>';
    }

    return html || '<b>Nenhum dado encontrado</b>';
  }

  function atualizarPainelInferiorObraPonto(feature) {
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var dadosTodos = expandirRegistrosPorGrupo(dadosObrasPontosFiltrados(feature, propostaSelecionada), { tipo: 'Ponto' });
    var html = tabelaRegistrosHtml(tituloTabelaComGrupo('Dados das obras pontuais', dadosTodos), dadosTodos, camposTabelaAjustadosPorGrupo(CAMPOS_OBRA_PONTO_TABELA, dadosTodos));
    if (html) html += htmlAcoesTabelaCompleta('ponto');
    document.getElementById('painelTabelaConteudo').innerHTML = html || '<em>Nenhum dado encontrado para este ponto.</em>';
  }
  var CAMPOS_AERO_INFO = [
    { chave: 'COD', rotulo: 'Código' },
    { chave: 'TIPO', rotulo: 'Tipo' },
    { chave: 'NOME', rotulo: 'Nome' },
    { chave: 'MUNICIPIO', rotulo: 'Município' },
    { chave: 'COMP_M', rotulo: 'Comprimento' },
    { chave: 'LARG_M', rotulo: 'Largura' },
    { chave: 'REVESTIMENTO', rotulo: 'Revestimento' }
  ];

  var CAMPOS_AERO_OBRA_POPUP = [
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'CONCLUSAO', rotulo: 'Conclusão' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' }
  ];

  var CAMPOS_AERO_OBRA_TABELA = [
    { chave: 'IDCOD', rotulo: 'IDCOD' },
    { chave: '__ORIGEM', rotulo: 'Origem' },
    { chave: '__IDENTIFICADOR', rotulo: 'Proposta' },
    { chave: 'ETAPA', rotulo: 'Etapa' },
    { chave: 'STATUS', rotulo: 'Status' },
    { chave: 'SEI', rotulo: 'SEI' },
    { chave: 'CONCLUSAO', rotulo: 'Conclusão' },
    { chave: 'INTERVENCAO', rotulo: 'Intervenção' },
    { chave: 'DESCRICAO', rotulo: 'Descrição' },
    { chave: 'ATUALIZACAO', rotulo: 'Atualização' }
  ];
  function construirPopupObraAero(feature, dadosSelecionado) {
    var p = feature.properties || {};
    var dadosTodos = dadosObrasAeroFiltrados(feature);
    var totalDados = dadosTodos.length;
    var dadosPopup = dadosSelecionado || (totalDados ? dadosTodos[0] : null);
    var html = htmlCamposPopup(p, [
      { chave: 'NOME', rotulo: 'Aeródromo/Aeroporto' },
      { chave: 'TIPO', rotulo: 'Tipo' },
      { chave: 'MUNICIPIO', rotulo: 'Município' },
      { chave: 'COD', rotulo: 'Código' }
    ]);

    if (dadosPopup) {
      var dados = Object.assign({}, dadosPopup);
      var origem = origemObraPonto(dados);
      var camposObra = CAMPOS_AERO_OBRA_POPUP;
      if (origem === 'FUNDEINFRA') {
        camposObra = [{ chave: '__IDENTIFICADOR', rotulo: 'Proposta' }].concat(CAMPOS_AERO_OBRA_POPUP);
        dados.__IDENTIFICADOR = valorIdentificadorObraPonto(dados);
      }
      var htmlObra = htmlCamposPopup(dados, camposObra);
      if (htmlObra) html += '<br><br><b>-- ' + escapeHtml(origem) + ' --</b><br>' + htmlObra;
    }

    if (totalDados > 1) {
      var restantes = totalDados - 1;
      html += '<br><br><span class="popup-obras-pontos-aviso">Existem mais ' +
        restantes + ' ' + (restantes === 1 ? 'obra' : 'obras') +
        ' neste aeródromo/aeroporto. Veja a lista completa no painel inferior.</span>';
    }

    return html || '<b>Nenhum dado encontrado</b>';
  }

  function atualizarPainelInferiorObraAero(feature, dadosSelecionado) {
    var p = feature.properties || {};
    var dadosTodos = dadosObrasAeroFiltrados(feature);
    if (dadosSelecionado) {
      dadosTodos = [dadosSelecionado].concat(dadosTodos.filter(function(item) {
        return origemObraPonto(item) !== origemObraPonto(dadosSelecionado) ||
          String(item.IDCOD || '') !== String(dadosSelecionado.IDCOD || '');
      }));
    }
    dadosTodos = expandirRegistrosPorGrupo(dadosTodos);

    var dadosTabela = dadosTodos.map(function(item) {
      var normalizado = Object.assign({}, item);
      normalizado.__ORIGEM = origemObraPonto(item);
      normalizado.__IDENTIFICADOR = origemObraPonto(item) === 'FUNDEINFRA' ? valorIdentificadorObraPonto(item) : '';
      return normalizado;
    });

    var html = tabelaRegistrosHtml('Dados do aeródromo/aeroporto', [p], CAMPOS_AERO_INFO);
    html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados das obras em aeródromos/aeroportos', dadosTabela), dadosTabela, camposTabelaAjustadosPorGrupo(CAMPOS_AERO_OBRA_TABELA, dadosTabela));
    document.getElementById('painelTabelaConteudo').innerHTML = html || '<b>Nenhum dado encontrado</b>';
  }
  function criarIconeObraPonto(dados, quantidadeItens, opcoes) {
    opcoes = opcoes || {};
    var estilo = estiloObraPonto(dados);
    var usarIconeImagem = !!estilo.icone;
    if (usarIconeImagem) {
      var tamanhoIconeDoc = 28;
      var offsetDireita = opcoes.offset === 'direita';
      var indiceOffset = Math.max(0, Number(opcoes.indiceOffset || 0));
      var deslocamentoDireita = offsetDireita ? tamanhoIconeDoc * 0.4 : 0;
      return L.divIcon({
        className: 'obra-ponto-icon ' + (offsetDireita ? 'obra-ponto-icon-aero' : 'obra-ponto-icon-doc'),
        html: criarHtmlSimboloObraPonto(estilo.classe, null, estilo.icone, quantidadeItens),
        iconSize: [tamanhoIconeDoc, tamanhoIconeDoc],
        iconAnchor: offsetDireita ? [-(tamanhoIconeDoc * indiceOffset + deslocamentoDireita), tamanhoIconeDoc] : [tamanhoIconeDoc, tamanhoIconeDoc],
        popupAnchor: offsetDireita ? [tamanhoIconeDoc * (indiceOffset + 0.5) + deslocamentoDireita, -tamanhoIconeDoc * 1.5] : [-tamanhoIconeDoc, -tamanhoIconeDoc * 1.5]
      });
    }

    return L.divIcon({
      className: 'obra-ponto-icon',
      html: criarHtmlSimboloObraPonto(estilo.classe, null, null, quantidadeItens),
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -10]
    });
  }

  function chaveLegendaObraPonto(dados) {
    var estilo = estiloObraPonto(dados);
    return estilo === OBRAS_PONTOS_INFO.OaePlanejamento ? 'OaePlanejamento' :
      estilo === OBRAS_PONTOS_INFO.OaeProjeto ? 'OaeProjeto' :
      estilo === OBRAS_PONTOS_INFO.OaeObra ? 'OaeObra' :
      estilo === OBRAS_PONTOS_INFO.Planejamento ? 'Planejamento' :
      estilo === OBRAS_PONTOS_INFO.Projeto ? 'Projeto' :
      estilo === OBRAS_PONTOS_INFO.Manutencao ? 'Manutencao' :
      estilo === OBRAS_PONTOS_INFO.Obra ? 'Obra' : 'Padrao';
  }

  function dadosPrincipalObraPonto(dadosLista) {
    if (!dadosLista || !dadosLista.length) return null;
    for (var i = 0; i < dadosLista.length; i++) {
      var chave = chaveLegendaObraPonto(dadosLista[i]);
      if (chave === 'OaeObra' || chave === 'Obra') return dadosLista[i];
    }
    for (var j = 0; j < dadosLista.length; j++) {
      var chavePlanejamento = chaveLegendaObraPonto(dadosLista[j]);
      if (chavePlanejamento === 'OaePlanejamento' || chavePlanejamento === 'OaeProjeto' || chavePlanejamento === 'Planejamento') return dadosLista[j];
    }
    return dadosLista[0];
  }

  function criarHtmlSimboloObraPonto(classe, classeExtra, iconeSrc, quantidadeItens) {
    var classes = ['obra-ponto-simbolo'];
    if (classeExtra) classes.push(classeExtra);
    if (classe) classes.push(classe);
    var badge = quantidadeItens > 1 ?
      '<span class="obra-ponto-badge">' + escapeHtml(quantidadeItens) + '</span>' :
      '';

    if (iconeSrc) {
      return '<span class="' + classes.join(' ') + '">' +
        badge +
        '<img src="' + escapeHtml(iconeSrc) + '" alt="" aria-hidden="true" />' +
      '</span>';
    }

    return '<span class="' + classes.join(' ') + '">' +
      badge +
      '<svg viewBox="0 0 268.18307 268.18396" aria-hidden="true" focusable="false">' +
        '<g transform="translate(-511.05083,580.11813)">' +
          '<path fill="var(--obra-ponto-fill)" fill-opacity="1" d="m 640.89944,-312.84081 c -2.34343,-1.27137 -124.35457,-123.00021 -127.42572,-127.13088 -2.80683,-3.77514 -3.18674,-7.56496 -1.07818,-10.75574 2.27986,-3.45002 125.74826,-126.89418 128.24864,-128.22348 2.91343,-1.54889 6.08942,-1.55642 9.02824,-0.0214 2.6714,1.39535 126.92093,125.61018 128.51354,128.47769 1.49348,2.68893 1.3778,6.69768 -0.26493,9.18355 -2.27987,3.45003 -125.74824,126.89419 -128.24861,128.22349 -2.70759,1.43944 -6.38403,1.54285 -8.77298,0.24677 z"/>' +
          '<path fill="currentColor" d="m 643.55505,-568.15193 c -5.90332,0.84574 -9.46768,4.85646 -13.49375,8.88254 l -15.34583,15.34583 -67.73333,67.73334 -16.13959,16.13958 c -4.24629,4.2463 -8.66487,8.80651 -7.86176,15.34584 1.10312,8.98202 10.60192,15.44017 16.59301,21.43126 l 45.50833,45.50833 41.27501,41.27501 c 5.4398,5.43981 11.39237,13.69469 20.10833,12.62426 5.88756,-0.72307 9.49533,-4.6571 13.49375,-8.65551 l 15.34583,-15.34584 67.99792,-67.99792 16.13959,-16.13958 c 4.24199,-4.24199 8.66344,-8.81814 7.86176,-15.34585 -1.10311,-8.98201 -10.60192,-15.44016 -16.59301,-21.43125 l -45.50834,-45.50833 -41.53958,-41.53959 c -5.44571,-5.44571 -11.37568,-13.5732 -20.10834,-12.32212 m 0,5.79369 c 7.3523,-1.22774 13.18051,7.80269 17.72709,12.34926 l 41.80417,41.80417 43.12708,43.12709 10.58333,10.58333 c 2.05803,2.05803 4.34183,4.07899 4.7137,7.14375 0.60783,5.00942 -2.79632,7.87222 -6.03661,11.11251 l -17.72709,17.72709 -65.35208,65.35209 -16.66875,16.66875 c -2.57409,2.57408 -5.17675,6.15527 -8.99584,6.79301 -7.35228,1.22775 -13.18051,-7.80269 -17.72708,-12.34926 l -41.80417,-41.80417 -43.12708,-43.12709 -10.58333,-10.58333 c -2.05803,-2.05803 -4.34185,-4.07899 -4.71371,-7.14376 -0.60782,-5.00942 2.79632,-7.8722 6.03662,-11.1125 l 17.72708,-17.72709 65.35209,-65.35209 16.66875,-16.66875 c 2.57408,-2.57408 5.17676,-6.15528 8.99583,-6.79301 m -39.95209,62.88468 c 2.93303,7.04287 8.59625,13.56279 10.6793,20.90209 0.58852,2.07356 0.16862,4.73414 0.16862,6.87917 v 14.2875 29.63334 c 0,4.47941 0.84252,9.91225 -0.1033,14.2875 -1.62753,7.52868 -9.13138,13.6056 -10.48003,21.16667 l 17.72709,9.26042 c 3.09961,-5.31063 5.67266,-10.96561 8.54547,-16.40417 1.47757,-2.79721 3.74647,-5.92419 4.53629,-8.99583 0.56091,-2.18136 0.1474,-4.8998 0.1474,-7.14375 v -14.55209 -36.77709 c 0,-5.03062 1.10433,-11.53622 -0.1474,-16.40417 -0.4847,-1.885 -1.79726,-3.83585 -2.70503,-5.55625 -2.60262,-4.93247 -5.14262,-9.89825 -7.77418,-14.81667 -0.60566,-1.132 -1.57431,-4.46746 -2.92348,-4.81109 -1.30583,-0.3326 -3.57083,1.53045 -4.70616,2.09994 -4.36032,2.18717 -8.75263,4.48378 -12.96459,6.94448 m 82.81459,106.89169 c -1.47148,-5.09824 -5.1193,-10.3894 -7.62963,-15.08125 -0.96813,-1.80947 -2.41265,-3.79596 -2.85039,-5.82084 -0.94584,-4.37523 -0.10331,-9.8081 -0.10331,-14.2875 v -29.63334 -14.2875 c 0,-2.14503 -0.4199,-4.80561 0.16863,-6.87917 2.08395,-7.34238 7.73435,-13.86592 10.67929,-20.90209 -4.05973,-2.6774 -8.68629,-4.64701 -12.96459,-6.96083 -1.12735,-0.6097 -3.35538,-2.42816 -4.70615,-2.08359 -1.31102,0.33443 -2.20229,3.46045 -2.81446,4.54651 -2.67746,4.75011 -5.18228,9.67727 -7.62596,14.55208 -0.96123,1.91754 -2.48673,3.99286 -2.96963,6.08542 -0.53072,2.29979 -0.14005,5.05499 -0.14005,7.40833 v 14.55209 50.27084 c 2.5e-4,3.67019 1.99589,6.64159 3.74093,9.78959 2.0142,3.63356 3.83674,7.4088 5.71956,11.1125 0.75622,1.48757 2.25613,5.90761 3.82502,6.55089 1.23756,0.5074 3.66574,-1.35425 4.70616,-1.94069 4.26056,-2.4015 8.87905,-4.29704 12.96458,-6.99145 z"/>' +
        '</g>' +
      '</svg>' +
    '</span>';
  }

  function pontoEmAnel(lon, lat, anel) {
    var dentro = false;
    for (var i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      var xi = anel[i][0], yi = anel[i][1];
      var xj = anel[j][0], yj = anel[j][1];
      var cruza = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (cruza) dentro = !dentro;
    }
    return dentro;
  }

  function pontoEmPoligonoFeature(lon, lat, feature) {
    var geom = feature && feature.geometry;
    if (!geom || !geom.coordinates) return false;
    var poligonos = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

    for (var i = 0; i < poligonos.length; i++) {
      var poligono = poligonos[i];
      if (!poligono || !poligono.length) continue;
      if (!pontoEmAnel(lon, lat, poligono[0])) continue;

      var emBuraco = false;
      for (var j = 1; j < poligono.length; j++) {
        if (pontoEmAnel(lon, lat, poligono[j])) {
          emBuraco = true;
          break;
        }
      }

      if (!emBuraco) return true;
    }

    return false;
  }

  function pontoDentroSelecaoMunicipios(lon, lat, featuresMunicipios) {
    var manutencao = poligonosManutencaoSelecionados();
    if (regioesSelecionadas('rgManSelect').length && !manutencao.some(function(f) { return pontoEmPoligonoFeature(lon, lat, f); })) return false;
    if (temFiltroAreaInfluencia() && !featuresAreaInfluenciaSelecionada().some(function(f) { return pontoEmPoligonoFeature(lon, lat, f); })) return false;
    if (!featuresMunicipios || !featuresMunicipios.length) return !temFiltroGeografico() && !document.getElementById('municipioSelect').value;
    if (municipiosData && featuresMunicipios.length >= municipiosData.features.length) return true;

    for (var i = 0; i < featuresMunicipios.length; i++) {
      if (pontoEmPoligonoFeature(lon, lat, featuresMunicipios[i])) return true;
    }

    return false;
  }

  function criarCamadaObrasPontos() {
    if (L.markerClusterGroup) {
      var grupoCluster = L.markerClusterGroup({
        pane: 'oaePane',
        clusterPane: 'oaePane',
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 13,
        maxClusterRadius: function(zoom) {
          if (zoom <= 7) return 40;
          if (zoom <= 9) return 25;
          if (zoom <= 11) return 10;
          return 2;
        },
        iconCreateFunction: function(cluster) {
          var markers = cluster.getAllChildMarkers();
          var total = 0;
          for (var i = 0; i < markers.length; i++) {
            total += Number(markers[i]._quantidadeObrasPontos || 1);
          }
          var tamanho = total >= 100 ? 'grande' : total >= 10 ? 'medio' : 'pequeno';
          return L.divIcon({
            html: '<span>' + total + '</span>',
            className: 'obras-pontos-cluster obras-pontos-cluster-' + tamanho,
            iconSize: L.point(34, 34)
          });
        }
      });
      grupoCluster.on('animationend spiderfied unspiderfied clusterclick', agendarAtualizacaoIconesAeroObras);
      return grupoCluster;
    }

    return L.layerGroup();
  }

  function criarIconeClusterProxy() {
    return L.divIcon({
      className: 'obra-ponto-cluster-proxy',
      html: '',
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    });
  }

  function atualizarVisibilidadeIconesAeroObras() {
    if (!aeroObrasIconLayer || !obrasPontosLayer || !obrasPontosLayer.getVisibleParent) return;

    for (var i = 0; i < aeroObrasClusterRefs.length; i++) {
      var ref = aeroObrasClusterRefs[i];
      var visivel = obrasPontosLayer.getVisibleParent(ref.proxy) === ref.proxy;
      for (var m = 0; m < ref.markers.length; m++) {
        var marker = ref.markers[m];
        if (visivel && !aeroObrasIconLayer.hasLayer(marker)) {
          aeroObrasIconLayer.addLayer(marker);
        } else if (!visivel && aeroObrasIconLayer.hasLayer(marker)) {
          aeroObrasIconLayer.removeLayer(marker);
        }
      }
    }
  }

  function agendarAtualizacaoIconesAeroObras() {
    setTimeout(atualizarVisibilidadeIconesAeroObras, 0);
    setTimeout(atualizarVisibilidadeIconesAeroObras, 160);
    setTimeout(atualizarVisibilidadeIconesAeroObras, 320);
  }

  function desenharObrasPontos(rodoviaSelecionada, sreSelecionado, propostaSelecionada, featuresMunicipios) {
    if (obrasPontosLayer) {
      map.removeLayer(obrasPontosLayer);
      obrasPontosLayer = null;
    }

    var tiposVisiveis = {};
    var tiposVisiveisDor = {};
    var tiposVisiveisDma = {};
    var tiposVisiveisDpl = {};
    var tiposVisiveisDpj = {};
    var tiposVisiveisDoc = {};
    var tiposVisiveisDsv = {};
    var total = 0;

    obrasPontosLayer = criarCamadaObrasPontos();

    if (!obrasPontosData || !obrasPontosData.features || !algumaOrigemObraPontoAtiva()) {
      return {
        total: total,
        legenda: tiposVisiveis,
        legendaDor: tiposVisiveisDor,
        legendaDma: tiposVisiveisDma,
        legendaDpl: tiposVisiveisDpl,
        legendaDpj: tiposVisiveisDpj,
        legendaDoc: tiposVisiveisDoc,
        legendaDsv: tiposVisiveisDsv
      };
    }

    for (var i = 0; i < obrasPontosData.features.length; i++) {
      var feature = obrasPontosData.features[i];
      var p = feature.properties || {};
      var dadosFiltrados = dadosObrasPontosFiltrados(feature, propostaSelecionada);
      if (!dadosFiltrados.length) continue;
      if (rodoviaSelecionada && nomeRodoviaFeature(feature) !== rodoviaSelecionada) continue;
      if (sreSelecionado && nomeSREFeature(feature) !== sreSelecionado) continue;

      var coords = feature.geometry && feature.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      if (!pontoDentroSelecaoMunicipios(coords[0], coords[1], featuresMunicipios)) continue;

      for (var d = 0; d < dadosFiltrados.length; d++) {
        var itemFiltrado = dadosFiltrados[d];
        var tipoLegenda = chaveLegendaObraPonto(itemFiltrado);
        var origemLegenda = origemObraPonto(itemFiltrado);
        if (origemLegenda === 'DOC') tiposVisiveisDoc[tipoLegenda] = true;
        else if (origemLegenda === 'DSV') tiposVisiveisDsv[tipoLegenda] = true;
        else if (origemLegenda === 'DOR') tiposVisiveisDor[tipoLegenda] = true;
        else if (origemLegenda === 'DMA') tiposVisiveisDma[tipoLegenda] = true;
        else if (origemLegenda === 'DPL') tiposVisiveisDpl[tipoLegenda] = true;
        else if (origemLegenda === 'DPJ') tiposVisiveisDpj[tipoLegenda] = true;
        else tiposVisiveis[tipoLegenda] = true;
      }

      var dados = dadosPrincipalObraPonto(dadosFiltrados);

      var marker = L.marker([coords[1], coords[0]], {
        pane: 'oaePane',
        icon: criarIconeObraPonto(dados, dadosFiltrados.length),
        title: valorSeguro(feature, 'trecho') + ' - ' + ((dados && dados.ETAPA) || '')
      });

      marker.bindPopup(construirPopupObraPonto(feature));
      marker._quantidadeObrasPontos = dadosFiltrados.length;
      marker.on('click', function(f) {
        return function() {
          piscarFeatureClicada(f);
          atualizarPainelInferiorObraPonto(f);
        };
      }(feature));

      obrasPontosLayer.addLayer(marker);
      total++;
    }

    return {
      total: total,
      legenda: tiposVisiveis,
      legendaDor: tiposVisiveisDor,
      legendaDma: tiposVisiveisDma,
      legendaDpl: tiposVisiveisDpl,
      legendaDpj: tiposVisiveisDpj,
      legendaDoc: tiposVisiveisDoc,
        legendaDsv: tiposVisiveisDsv
    };
  }

  function desenharObrasAero(featuresMunicipios) {
    var legendasDor = {};
    var legendasDma = {};
    var legendasDpj = {};
    var total = 0;
    var totalCluster = 0;
    var countDor = 0;
    var countDma = 0;
    var countDpj = 0;

    if (!aeroObrasData || !aeroObrasData.features || !algumaOrigemObraAeroAtiva()) {
      return { total: total, totalCluster: totalCluster, countDor: countDor, countDma: countDma, countDpj: countDpj, legendaDor: legendasDor, legendaDma: legendasDma, legendaDpj: legendasDpj };
    }

    if (!obrasPontosLayer) obrasPontosLayer = criarCamadaObrasPontos();
    aeroObrasIconLayer = L.layerGroup();
    aeroObrasClusterRefs = [];

    for (var i = 0; i < aeroObrasData.features.length; i++) {
      var feature = aeroObrasData.features[i];
      var p = feature.properties || {};
      var dadosFiltrados = dadosObrasAeroFiltrados(feature);
      if (!dadosFiltrados.length) continue;

      var coords = feature.geometry && feature.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      if (!pontoDentroSelecaoMunicipios(coords[0], coords[1], featuresMunicipios)) continue;

      var markersAero = [];

      for (var d = 0; d < dadosFiltrados.length; d++) {
        var dados = dadosFiltrados[d];
        var origem = origemObraPonto(dados);
        var tipoLegenda = chaveLegendaObraPonto(dados);
        if (origem === 'DOR') {
          legendasDor[tipoLegenda] = true;
          countDor++;
        } else if (origem === 'DMA') {
          legendasDma[tipoLegenda] = true;
          countDma++;
        } else if (origem === 'DPJ') {
          legendasDpj[tipoLegenda] = true;
          countDpj++;
        }

        var marker = L.marker([coords[1], coords[0]], {
          pane: 'oaePane',
          icon: criarIconeObraPonto(dados, 1, {
            usarIconeImagem: true,
            offset: 'direita',
            indiceOffset: d
          }),
          title: (p.NOME || p.MUNICIPIO || '') + ' - ' + origem
        });

        marker.bindPopup(construirPopupObraAero(feature, dados));
        marker._quantidadeObrasPontos = 1;
        marker.on('click', function(f, item) {
          return function() {
            piscarFeatureClicada(f);
            atualizarPainelInferiorObraAero(f, item);
          };
        }(feature, dados));

        aeroObrasIconLayer.addLayer(marker);
        markersAero.push(marker);
        total++;
      }

      var proxy = L.marker([coords[1], coords[0]], {
        pane: 'oaePane',
        interactive: false,
        icon: criarIconeClusterProxy()
      });
      proxy._quantidadeObrasPontos = 1;
      obrasPontosLayer.addLayer(proxy);
      aeroObrasClusterRefs.push({
        proxy: proxy,
        markers: markersAero
      });
      totalCluster++;
    }

    agendarAtualizacaoIconesAeroObras();
    return { total: total, totalCluster: totalCluster, countDor: countDor, countDma: countDma, countDpj: countDpj, legendaDor: legendasDor, legendaDma: legendasDma, legendaDpj: legendasDpj };
  }

    function desenharLinhasEPontos(featuresMunicipios) {
    limparCamadasRegras();

    if (oaeLayer) {
      map.removeLayer(oaeLayer);
      oaeLayer = null;
    }

    var situacoesFedVisiveis = desenharSNV();
    var situacoesEstVisiveis = desenharSREBase();
    var alteracoesVisiveis = desenharAlteracoesJuridicao();

    var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
    var sreSelecionado = document.getElementById('sreSelect').value;
    var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
    var resultadoObrasPontos = desenharObrasPontos(rodoviaSelecionada, sreSelecionado, propostaSelecionada, featuresMunicipios);
    var resultadoObrasAero = desenharObrasAero(featuresMunicipios);
    var totalObrasPontos = resultadoObrasPontos.total;

    if (obrasPontosLayer && totalObrasPontos + resultadoObrasAero.totalCluster > 0) {
      obrasPontosLayer.addTo(map);
      if (aeroObrasIconLayer) aeroObrasIconLayer.addTo(map);
      atualizarVisibilidadeIconesAeroObras();
    }

    var linhasBase = [];
    var linksFundIncluidos = {};

        // --- FUNDEINFRA ---
    if (sreData && sreData.features && servicosAtivos.FUNDEINFRA) {
      for (var j = 0; j < sreData.features.length; j++) {
        var f = sreData.features[j];
        var link = valorSeguro(f, 'LINK_FUND');
        if (!link) continue;
        var dadosF = dadosFundeinfraDaFeature(f);
        if (!dadosF) continue;
        if (servicoFiltroAtivo && dadosF.INTERVENCAO !== servicoFiltroAtivo) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(f) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(f) !== sreSelecionado) continue;
        if (propostaSelecionada) {
          if (!dadosF || String(dadosF.PROPOSTA) !== String(propostaSelecionada)) continue;
        }
        linhasBase.push(featureComOrigemIntervencao(f, 'FUNDEINFRA'));
        linksFundIncluidos[String(link)] = true;
      }
    }

    // --- DOR (não inclui features que já entraram como FUNDEINFRA) ---
    if (sreData && sreData.features && servicosAtivos.DOR) {
      for (var d = 0; d < sreData.features.length; d++) {
        var fd = sreData.features[d];
        var linkDor = valorSeguro(fd, 'LINK_DOR');
        if (!linkDor) continue;
        var dadosDFiltrados = dadosDorDaFeatureFiltrados(fd, servicoFiltroAtivo, '');
        if (!dadosDFiltrados.length) continue;
        // Se já tem LINK_FUND e FUNDEINFRA está ativo, pula (prioridade FUNDEINFRA)
        if (servicosAtivos.FUNDEINFRA && valorSeguro(fd, 'LINK_FUND') && linksFundIncluidos[String(valorSeguro(fd, 'LINK_FUND'))]) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(fd) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(fd) !== sreSelecionado) continue;
        linhasBase.push(featureComOrigemIntervencao(fd, 'DOR'));
      }
    }

    // --- DMA (independente da DOR, mesmo quando compartilham a mesma geometria) ---
    if (sreData && sreData.features && servicosAtivos.DMA) {
      for (var dm = 0; dm < sreData.features.length; dm++) {
        var fdm = sreData.features[dm];
        var linkDma = valorSeguro(fdm, 'LINK_DMA');
        if (!linkDma) continue;
        var dadosDmaFiltrados = dadosDmaDaFeatureFiltrados(fdm, servicoFiltroAtivo, '');
        if (!dadosDmaFiltrados.length) continue;
        if (servicosAtivos.FUNDEINFRA && valorSeguro(fdm, 'LINK_FUND') && linksFundIncluidos[String(valorSeguro(fdm, 'LINK_FUND'))]) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(fdm) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(fdm) !== sreSelecionado) continue;
        linhasBase.push(featureComOrigemIntervencao(fdm, 'DMA'));
      }
    }

    // --- DPL (independente das demais origens, mesmo quando compartilham a mesma geometria) ---
    if (sreData && sreData.features && servicosAtivos.DPL) {
      for (var dp = 0; dp < sreData.features.length; dp++) {
        var fdp = sreData.features[dp];
        var linkDpl = valorSeguro(fdp, 'LINK_DPL');
        if (!linkDpl) continue;
        var dadosDplFiltrados = dadosDplDaFeatureFiltrados(fdp, servicoFiltroAtivo, '');
        if (!dadosDplFiltrados.length) continue;
        if (servicosAtivos.FUNDEINFRA && valorSeguro(fdp, 'LINK_FUND') && linksFundIncluidos[String(valorSeguro(fdp, 'LINK_FUND'))]) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(fdp) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(fdp) !== sreSelecionado) continue;
        linhasBase.push(featureComOrigemIntervencao(fdp, 'DPL'));
      }
    }

    // --- DPJ (independente das demais origens, mesmo quando compartilham a mesma geometria) ---
    if (sreData && sreData.features && servicosAtivos.DPJ) {
      for (var dj = 0; dj < sreData.features.length; dj++) {
        var fdj = sreData.features[dj];
        var linkDpj = valorSeguro(fdj, 'LINK_DPJ');
        if (!linkDpj) continue;
        var dadosDpjFiltrados = dadosDpjDaFeatureFiltrados(fdj, servicoFiltroAtivo, '');
        if (!dadosDpjFiltrados.length) continue;
        if (servicosAtivos.FUNDEINFRA && valorSeguro(fdj, 'LINK_FUND') && linksFundIncluidos[String(valorSeguro(fdj, 'LINK_FUND'))]) continue;
        if (rodoviaSelecionada && nomeRodoviaFeature(fdj) !== rodoviaSelecionada) continue;
        if (sreSelecionado && nomeSREFeature(fdj) !== sreSelecionado) continue;
        linhasBase.push(featureComOrigemIntervencao(fdj, 'DPJ'));
      }
    }

    // Valores maiores são desenhados por último (ficam por cima). Ordem de
    // prioridade visual: FUNDEINFRA, DOR, DMA, DPJ, DPL (FUNDEINFRA acima de todas).
    var ordemOrigensLineares = { DPL: 0, DPJ: 1, DMA: 2, DOR: 3, FUNDEINFRA: 4 };
    linhasBase = linhasBase.filter(featureAtendeRegioes);
    linhasBase.sort(function(a, b) {
      return ordemOrigensLineares[origemIntervencaoFeature(a)] - ordemOrigensLineares[origemIntervencaoFeature(b)];
    });

        var grupos = {};
    var servicosVisiveis = {};
    var servicosVisiveisDor = {};
    var servicosVisiveisDma = {};
    var servicosVisiveisDpl = {};
    var servicosVisiveisDpj = {};
    var idsUnicos = {};

        for (var k = 0; k < linhasBase.length; k++) {
      var feat = linhasBase[k];
      var linkFund = valorSeguro(feat, 'LINK_FUND');
      var linkDor = valorSeguro(feat, 'LINK_DOR');
      var linkDma = valorSeguro(feat, 'LINK_DMA');
      var linkDpl = valorSeguro(feat, 'LINK_DPL');
      var linkDpj = valorSeguro(feat, 'LINK_DPJ');

      var dados, estilo, chaveId, origemDados;

      var origemPreferida = origemIntervencaoFeature(feat);

      if (origemPreferida === 'FUNDEINFRA' && linkFund && dadosFundeinfraDaFeature(feat) && servicosAtivos.FUNDEINFRA) {
        dados = dadosFundeinfraDaFeature(feat);
        estilo = estiloFundeinfra(dados);
        chaveId = 'FUND_' + String(linkFund) + '_' + k;
        origemDados = 'FUNDEINFRA';
      } else if (origemPreferida === 'DOR' && linkDor && dadosDorDaFeature(feat) && servicosAtivos.DOR) {
        dados = dadosDorDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDorDaFeature(feat);
        estilo = estiloDor(dados);
        chaveId = 'DOR_' + String(linkDor) + '_' + k;
        origemDados = 'DOR';
      } else if (origemPreferida === 'DMA' && linkDma && dadosDmaDaFeature(feat) && servicosAtivos.DMA) {
        dados = dadosDmaDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDmaDaFeature(feat);
        estilo = estiloDma(dados);
        chaveId = 'DMA_' + String(linkDma) + '_' + k;
        origemDados = 'DMA';
      } else if (origemPreferida === 'DPL' && linkDpl && dadosDplDaFeature(feat) && servicosAtivos.DPL) {
        dados = dadosDplDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDplDaFeature(feat);
        estilo = estiloDpl(dados);
        chaveId = 'DPL_' + String(linkDpl) + '_' + k;
        origemDados = 'DPL';
      } else if (origemPreferida === 'DPJ' && linkDpj && dadosDpjDaFeature(feat) && servicosAtivos.DPJ) {
        dados = dadosDpjDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDpjDaFeature(feat);
        estilo = estiloDpj(dados);
        chaveId = 'DPJ_' + String(linkDpj) + '_' + k;
        origemDados = 'DPJ';
      // Prioridade FUNDEINFRA se ambos existirem e FUNDEINFRA estiver ativo
      } else if (linkFund && dadosFundeinfraDaFeature(feat)) {
        dados = dadosFundeinfraDaFeature(feat);
        estilo = estiloFundeinfra(dados);
        chaveId = 'FUND_' + String(linkFund) + '_' + k;
        origemDados = 'FUNDEINFRA';
      } else if (linkDor && dadosDorDaFeature(feat)) {
        dados = dadosDorDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDorDaFeature(feat);
        estilo = estiloDor(dados);
        chaveId = 'DOR_' + String(linkDor) + '_' + k;
        origemDados = 'DOR';
      } else if (linkDma && dadosDmaDaFeature(feat)) {
        dados = dadosDmaDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDmaDaFeature(feat);
        estilo = estiloDma(dados);
        chaveId = 'DMA_' + String(linkDma) + '_' + k;
        origemDados = 'DMA';
      } else if (linkDpl && dadosDplDaFeature(feat)) {
        dados = dadosDplDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDplDaFeature(feat);
        estilo = estiloDpl(dados);
        chaveId = 'DPL_' + String(linkDpl) + '_' + k;
        origemDados = 'DPL';
      } else if (linkDpj && dadosDpjDaFeature(feat)) {
        dados = dadosDpjDaFeatureFiltrados(feat, servicoFiltroAtivo, '')[0] || dadosDpjDaFeature(feat);
        estilo = estiloDpj(dados);
        chaveId = 'DPJ_' + String(linkDpj) + '_' + k;
        origemDados = 'DPJ';
      } else {
        continue;
      }

      var chave = estilo.legenda + '|' + estilo.cor + '|' + estilo.tipo_linha;
      if (!grupos[chave]) grupos[chave] = { features: [], estilo: estilo };
      grupos[chave].features.push(feat);
      if (origemDados === 'FUNDEINFRA') {
        servicosVisiveis[estilo.legenda] = estilo.cor;
      } else if (origemDados === 'DMA') {
        servicosVisiveisDma[estilo.legenda] = estilo;
      } else if (origemDados === 'DPL') {
        servicosVisiveisDpl[estilo.legenda] = estilo;
      } else if (origemDados === 'DPJ') {
        servicosVisiveisDpj[estilo.legenda] = estilo;
      } else if (origemDados === 'DOR') {
        servicosVisiveisDor[estilo.legenda] = estilo;
      }
      idsUnicos[chaveId] = true;
    }

    Object.keys(grupos).forEach(function(chave) {
      var grupo = grupos[chave];
      var camada;
      if (grupo.estilo.tipo_linha === 'COM LINHA BRANCA') {
        camada = construirLayerLinhaBranca(grupo.features, grupo.estilo.cor, grupo.estilo.espessura);
      } else if (grupo.estilo.tipo_linha === 'COM LINHA BRANCA DOR') {
        camada = construirLayerLinhaBranca(grupo.features, grupo.estilo.cor, grupo.estilo.espessura);
      } else if (grupo.estilo.tipo_linha === 'COM LINHA BRANCA TRACEJADA') {
        camada = construirLayerLinhaBrancaTracejada(grupo.features, grupo.estilo.cor, grupo.estilo.espessura);
      } else {
        camada = construirLayerNormal(grupo.features, grupo.estilo.cor, grupo.estilo.espessura);
      }
      camada.addTo(map);
      regraLayers.push(camada);
    });

    obrasLabelLayer = L.layerGroup();
    var rotulosIncluidos = {};
    for (var rl = 0; rl < linhasBase.length; rl++) {
      var featRotulo = linhasBase[rl];
      var linkFundRotulo = valorSeguro(featRotulo, 'LINK_FUND');
      var linkDorRotulo = valorSeguro(featRotulo, 'LINK_DOR');
      var linkDmaRotulo = valorSeguro(featRotulo, 'LINK_DMA');
      var linkDplRotulo = valorSeguro(featRotulo, 'LINK_DPL');
      var linkDpjRotulo = valorSeguro(featRotulo, 'LINK_DPJ');
      var dadosRotulo = null;
      var estiloRotulo = null;
      var origemRotulo = '';
      var linkRotulo = '';
      var origemPreferidaRotulo = origemIntervencaoFeature(featRotulo);

      if (origemPreferidaRotulo === 'FUNDEINFRA' && linkFundRotulo && dadosFundeinfraDaFeature(featRotulo) && servicosAtivos.FUNDEINFRA) {
        dadosRotulo = dadosFundeinfraDaFeature(featRotulo);
        estiloRotulo = estiloFundeinfra(dadosRotulo);
        origemRotulo = 'FUNDEINFRA';
        linkRotulo = linkFundRotulo;
      } else if (origemPreferidaRotulo === 'DOR' && linkDorRotulo && dadosDorDaFeature(featRotulo) && servicosAtivos.DOR) {
        dadosRotulo = dadosDorDaFeatureFiltrados(featRotulo, servicoFiltroAtivo, '')[0] || dadosDorDaFeature(featRotulo);
        estiloRotulo = estiloDor(dadosRotulo);
        origemRotulo = 'DOR';
        linkRotulo = linkDorRotulo;
      } else if (origemPreferidaRotulo === 'DMA' && linkDmaRotulo && dadosDmaDaFeature(featRotulo) && servicosAtivos.DMA) {
        dadosRotulo = dadosDmaDaFeatureFiltrados(featRotulo, servicoFiltroAtivo, '')[0] || dadosDmaDaFeature(featRotulo);
        estiloRotulo = estiloDma(dadosRotulo);
        origemRotulo = 'DMA';
        linkRotulo = linkDmaRotulo;
      } else if (origemPreferidaRotulo === 'DPL' && linkDplRotulo && dadosDplDaFeature(featRotulo) && servicosAtivos.DPL) {
        dadosRotulo = dadosDplDaFeatureFiltrados(featRotulo, servicoFiltroAtivo, '')[0] || dadosDplDaFeature(featRotulo);
        estiloRotulo = estiloDpl(dadosRotulo);
        origemRotulo = 'DPL';
        linkRotulo = linkDplRotulo;
      } else if (origemPreferidaRotulo === 'DPJ' && linkDpjRotulo && dadosDpjDaFeature(featRotulo) && servicosAtivos.DPJ) {
        dadosRotulo = dadosDpjDaFeatureFiltrados(featRotulo, servicoFiltroAtivo, '')[0] || dadosDpjDaFeature(featRotulo);
        estiloRotulo = estiloDpj(dadosRotulo);
        origemRotulo = 'DPJ';
        linkRotulo = linkDpjRotulo;
      }

      if (!dadosRotulo || !estiloRotulo) continue;

      var chaveRotulo = origemRotulo + '|' + String(linkRotulo) + '|' + String(dadosRotulo.PROPOSTA || '') + '|' + String(dadosRotulo.INTERVENCAO || '');
      if (rotulosIncluidos[chaveRotulo]) continue;
      rotulosIncluidos[chaveRotulo] = true;
      adicionarRotuloObra(obrasLabelLayer, featRotulo, dadosRotulo, origemRotulo, linkRotulo, estiloRotulo.cor);
    }
    obrasLabelLayer.addTo(map);
    atualizarVisibilidadeRotulosObras();

        document.getElementById('countMunicipios').textContent = featuresMunicipios.length;
    document.getElementById('countLinhas').textContent = Object.keys(idsUnicos).length;

    var countFund = 0;
    var countDor = 0;
    var countDma = 0;
    var countDpl = 0;
    var countDpj = 0;
    for (var ci = 0; ci < linhasBase.length; ci++) {
      var origemContador = origemIntervencaoFeature(linhasBase[ci]);
      if (origemContador === 'FUNDEINFRA') countFund++;
      else if (origemContador === 'DOR') countDor++;
      else if (origemContador === 'DMA') countDma++;
      else if (origemContador === 'DPL') countDpl++;
      else if (origemContador === 'DPJ') countDpj++;
      else {
        if (valorSeguro(linhasBase[ci], 'LINK_FUND')) countFund++;
        if (valorSeguro(linhasBase[ci], 'LINK_DOR')) countDor++;
        if (valorSeguro(linhasBase[ci], 'LINK_DMA')) countDma++;
        if (valorSeguro(linhasBase[ci], 'LINK_DPL')) countDpl++;
        if (valorSeguro(linhasBase[ci], 'LINK_DPJ')) countDpj++;
      }
    }
    document.getElementById('countOAE').textContent = countFund;
    var contadorObrasPontos = document.getElementById('countObrasPontos');
    if (contadorObrasPontos) contadorObrasPontos.textContent = totalObrasPontos + resultadoObrasAero.totalCluster;
    document.getElementById('countDor').textContent = countDor + resultadoObrasAero.countDor;
    var contadorDma = document.getElementById('countDma');
    if (contadorDma) contadorDma.textContent = countDma + resultadoObrasAero.countDma;
    var contadorDpl = document.getElementById('countDpl');
    if (contadorDpl) contadorDpl.textContent = countDpl;
    var contadorDpj = document.getElementById('countDpj');
    if (contadorDpj) contadorDpj.textContent = countDpj + resultadoObrasAero.countDpj;

        renderizarLegendaIntervencaos({
      linhas: servicosVisiveis,
      pontos: resultadoObrasPontos.legenda
    });
    renderizarLegendaDor(servicosVisiveisDor, Object.assign({}, resultadoObrasPontos.legendaDor, resultadoObrasAero.legendaDor));
    renderizarLegendaDma(servicosVisiveisDma, Object.assign({}, resultadoObrasPontos.legendaDma, resultadoObrasAero.legendaDma));
    renderizarLegendaDpj(servicosVisiveisDpj, Object.assign({}, resultadoObrasPontos.legendaDpj, resultadoObrasAero.legendaDpj));
    renderizarLegendaDpl(servicosVisiveisDpl, resultadoObrasPontos.legendaDpl);
    renderizarLegendaDoc(resultadoObrasPontos.legendaDoc);
    renderizarLegendaDsv(resultadoObrasPontos.legendaDsv);
    renderizarLegendaAlteracoes(alteracoesVisiveis);
    renderizarLegendaOAE({});
    renderizarLegendaRodEst(situacoesEstVisiveis);
    renderizarLegendaRodFed(situacoesFedVisiveis);
  }
    function atualizarPainelInferior(feature) {
      var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
      var dadosFund = dadosFundeinfraDaFeatureFiltrado(feature, propostaSelecionada);
      var dadosDorTodos = servicosAtivos.DOR ? dadosDorDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDmaTodos = servicosAtivos.DMA ? dadosDmaDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDplTodos = servicosAtivos.DPL ? dadosDplDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var dadosDpjTodos = servicosAtivos.DPJ ? dadosDpjDaFeatureFiltrados(feature, servicoFiltroAtivo, '') : [];
      var referenciasProposta = referenciasPropostaDaFeature(feature, dadosFund, dadosDorTodos, dadosDmaTodos, dadosDplTodos, dadosDpjTodos);
      var featuresSre = featuresSrePorReferenciasProposta(feature, referenciasProposta);

      var html = htmlTabelaDadosSre(featuresSre, referenciasProposta);
      var dadosFundTabela = expandirRegistrosPorGrupo(dadosFund ? [dadosFund] : [], { tipo: 'Link', unidade: 'FUNDEINFRA' });
      var dadosDorTabela = expandirRegistrosPorGrupo(dadosDorTodos, { tipo: 'Link', unidade: 'DOR' });
      var dadosDmaTabela = expandirRegistrosPorGrupo(dadosDmaTodos, { tipo: 'Link', unidade: 'DMA' });
      var dadosDplTabela = expandirRegistrosPorGrupo(dadosDplTodos, { tipo: 'Link', unidade: 'DPL' });
      var dadosDpjTabela = expandirRegistrosPorGrupo(dadosDpjTodos, { tipo: 'Link', unidade: 'DPJ' });
      html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados FUNDEINFRA', dadosFundTabela), dadosFundTabela, camposTabelaAjustadosPorGrupo(CAMPOS_LINHA_FUNDEINFRA_TABELA, dadosFundTabela));
      html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados DOR', dadosDorTabela), dadosDorTabela, camposTabelaAjustadosPorGrupo(CAMPOS_LINHA_UNIDADE_TABELA, dadosDorTabela));
      html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados DMA', dadosDmaTabela), dadosDmaTabela, camposTabelaAjustadosPorGrupo(CAMPOS_LINHA_UNIDADE_TABELA, dadosDmaTabela));
      html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados DPL', dadosDplTabela), dadosDplTabela, camposTabelaAjustadosPorGrupo(CAMPOS_LINHA_UNIDADE_TABELA, dadosDplTabela));
      html += tabelaRegistrosHtml(tituloTabelaComGrupo('Dados DPJ', dadosDpjTabela), dadosDpjTabela, camposTabelaAjustadosPorGrupo(CAMPOS_LINHA_UNIDADE_TABELA, dadosDpjTabela));
      if (html) html += htmlAcoesTabelaCompleta('linha');

      document.getElementById('painelTabelaConteudo').innerHTML = html || '<em>Nenhum dado encontrado para este trecho.</em>';
    }
    function atualizarTituloTopBar() {
    var municipioSelecionado = document.getElementById('municipioSelect').value;
    var rgSelecionada = regioesSelecionadas('rgPlanSelect');
    var elementoTitulo = document.querySelector('.topbar-right span');
    
    var novoTitulo = 'ESTADO DE GOIÁS';
    
    if (municipioSelecionado) {
      novoTitulo = municipioSelecionado;
    } else if (temFiltroRegional()) {
      novoTitulo = rgSelecionada.concat(regioesSelecionadas('rgManSelect').map(function(id) { return 'Manutenção ' + id; })).join(' / ');
    } else if (temFiltroAreaInfluencia()) {
      novoTitulo = nomeExibicaoAreaInfluencia(featuresAreaInfluenciaSelecionada()[0], 0).toUpperCase();
    }
    
    if (elementoTitulo) {
      elementoTitulo.textContent = novoTitulo;
    }

    // Atualizar topbar-left conforme intervenções ativas
    var topbarLeft = document.querySelector('.topbar-left');
    if (topbarLeft) {
      var strong = topbarLeft.querySelector('strong');
      var span = topbarLeft.querySelector('span');
      var fundAtivo = servicosAtivos.FUNDEINFRA;
      var dorAtivo = servicosAtivos.DOR;
      var dmaAtivo = servicosAtivos.DMA;
      var dplAtivo = servicosAtivos.DPL;
      var dpjAtivo = servicosAtivos.DPJ;
      var docAtivo = servicosAtivos.DOC;
      var dsvAtivo = servicosAtivos.DSV;
      var alteracaoAtiva = algumaAlteracaoAtiva();

      strong.textContent = 'PLANO GOINFRA';
      if (fundAtivo && dorAtivo && dmaAtivo && dplAtivo && dpjAtivo && docAtivo && dsvAtivo && alteracaoAtiva) {
        span.textContent = '';
      } else {
        var origensAtivas = [];
        if (fundAtivo) origensAtivas.push('FUNDEINFRA');
        if (dorAtivo) origensAtivas.push('DOR');
        if (dmaAtivo) origensAtivas.push('DMA');
        if (dplAtivo) origensAtivas.push('DPL');
        if (dpjAtivo) origensAtivas.push('DPJ');
        if (docAtivo) origensAtivas.push('DOC');
        if (dsvAtivo) origensAtivas.push('DSV');
        span.textContent = origensAtivas.length ? '- ' + origensAtivas.join(' / ') : '';
      }
    }
  }

  function aplicarFiltros(opcoes) {
    opcoes = opcoes || {};
    desenharMascaraBrasil();
    atualizarBotoesBase();
    var feats = municipiosFiltrados();
    var municipioSelecionado = document.getElementById('municipioSelect').value;

    desenharEstados();
    desenharMunicipiosBase(feats);
    desenharRegioesBase();
    desenharAreasAmbientais();
    desenharAreasUrbanas();
    desenharAreaInfluencia();
    atualizarLegendasRegionais();
    desenharFerrovias();
    desenharBuffer();
    desenharLocalidades();
    desenharAero();
    desenharLinhasEPontos(feats);
    atualizarIndicadoresProgramaMunicipio(municipioSelecionado);
    atualizarIndicadoresIntervencaoEOAE(municipioSelecionado);

    if (opcoes.zoomRegional || opcoes.zoomAreaInfluencia) {
      if (temFiltroRegional()) zoomParaRegioesSelecionadas();
      else if (temFiltroAreaInfluencia()) zoomParaSelecao(featuresAreaInfluenciaSelecionada());
      else map.fitBounds(L.geoJSON(municipiosData).getBounds(), { padding: [20, 20], animate: false });
    } else if (!opcoes.preservarZoom) {
      var localidadeSelecionada = document.getElementById('localidadeSelect').value;
      if (localidadeFiltroAtivo && localidadeSelecionada) {
        zoomParaLocalidade(localidadeSelecionada);
      } else {
        var rodoviaSelecionada = document.getElementById('rodoviaSelect').value;
        var sreSelecionado = document.getElementById('sreSelect').value;
        var propostaSelecionada = document.getElementById('propostaSelect') ? document.getElementById('propostaSelect').value : '';
        var featsZoom = obterFeaturesZoomIntervencaos();

        if (propostaSelecionada && zoomParaPropostaFundeinfra()) {
          // Zoom aplicado ao trecho FUNDEINFRA da proposta.
        } else if ((rodoviaSelecionada || sreSelecionado || propostaSelecionada) && featsZoom.length > 0) {
          zoomParaSelecao(featsZoom);
        } else if (temFiltroRegional() && !municipioSelecionado) {
          zoomParaRegioesSelecionadas();
        } else if (temFiltroAreaInfluencia() && !municipioSelecionado) {
          zoomParaSelecao(featuresAreaInfluenciaSelecionada());
        } else if (feats.length > 0 && feats.length < municipiosData.features.length) {
          zoomParaSelecao(feats);
        } else {
          zoomParaGoias();
        }
      }
    }

    var blocoFed = document.getElementById('blocoLegendaRodFed');
    if (blocoFed && !snvFiltroAtivo) blocoFed.style.display = 'none';
    var blocoEst = document.getElementById('blocoLegendaRodEst');
    if (blocoEst && !sreBaseFiltroAtivo) blocoEst.style.display = 'none';

    atualizarTituloTopBar();
  }


  function desligarTudo() {
    programaAtivo = '';
    resetarBotoesPrograma();

    for (var chave in servicosAtivos) {
      servicosAtivos[chave] = false;
    }
    definirAlteracoesAtivas(false);
    oaeFiltroAtivo = false;
        sreBaseFiltroAtivo = false;
    snvFiltroAtivo = false;
    areasAmbientaisFiltroAtivo = false;
    areasUrbanasFiltroAtivo = false;
    areaInfluenciaFiltroAtivo = false;
    ferroviasFiltroAtivo = false;
    bufferFiltroAtivo = false;
    desenharAreaInfluencia();
    desenharFerrovias();
    desenharBuffer();
    atualizarBotoesBase();
    servicoFiltroAtivo = '';
    preencherIntervencaos();

    var btnOAEOff = document.getElementById('toggleOAE');
    if (btnOAEOff) btnOAEOff.classList.remove('ativo-filtro');
    document.getElementById('toggleSREBase').classList.remove('ativo-filtro');
    document.getElementById('toggleSNV').classList.remove('ativo-filtro');
    document.getElementById('toggleLocalidades').classList.remove('ativo-filtro');
    localidadeFiltroAtivo = false;
    aeroFiltroAtivo = false;
    var btnAeroOff = document.getElementById('toggleAero');
    if (btnAeroOff) btnAeroOff.classList.remove('ativo-filtro');
    municipioBaseFiltroAtivo = false;
    regioesBaseAtivas.manutencao = false;
    regioesBaseAtivas.planejamento = false;
    var btnMunicipiosOff = document.getElementById('toggleMunicipiosBase');
    if (btnMunicipiosOff) btnMunicipiosOff.classList.remove('ativo-filtro');
    var btnAreasAmbientaisOff = document.getElementById('toggleAreasAmbientais');
    if (btnAreasAmbientaisOff) btnAreasAmbientaisOff.classList.remove('ativo-filtro');
    var btnAreasUrbanasOff = document.getElementById('toggleAreasUrbanas');
    if (btnAreasUrbanasOff) btnAreasUrbanasOff.classList.remove('ativo-filtro');
    document.getElementById('localidadeSelect').value = '';
    document.getElementById('localidadeBusca').value = '';

    resetarBotoesIntervencao();

    if (snvLayer) { map.removeLayer(snvLayer); snvLayer = null; }
    if (snvLabelLayer) { map.removeLayer(snvLabelLayer); snvLabelLayer = null; }
    if (sreBaseLayer) { map.removeLayer(sreBaseLayer); sreBaseLayer = null; }
    if (sreBaseLabelLayer) { map.removeLayer(sreBaseLabelLayer); sreBaseLabelLayer = null; }
    if (areasAmbientaisLayer) { map.removeLayer(areasAmbientaisLayer); areasAmbientaisLayer = null; }
    if (areasUrbanasLayer) { map.removeLayer(areasUrbanasLayer); areasUrbanasLayer = null; }
    if (aeroLayer) { map.removeLayer(aeroLayer); aeroLayer = null; }
    if (oaeLayer) { map.removeLayer(oaeLayer); oaeLayer = null; }
    limparCamadasRegras();

    var b1 = document.getElementById('blocoLegendaRodFed');
    var b2 = document.getElementById('blocoLegendaRodEst');
    var b3 = document.getElementById('blocoLegendaOAE');
        var b4 = document.getElementById('legendaIntervencaos') ? document.getElementById('legendaIntervencaos').closest('.bloco') : null;
    var b5 = document.getElementById('legendaDor') ? document.getElementById('legendaDor').closest('.bloco') : null;
    var bDma = document.getElementById('legendaDma') ? document.getElementById('legendaDma').closest('.bloco') : null;
    var bDpl = document.getElementById('legendaDpl') ? document.getElementById('legendaDpl').closest('.bloco') : null;
    var bDpj = document.getElementById('legendaDpj') ? document.getElementById('legendaDpj').closest('.bloco') : null;
    var bDoc = document.getElementById('legendaDoc') ? document.getElementById('legendaDoc').closest('.bloco') : null;
    var bDsv = document.getElementById('legendaDsv') ? document.getElementById('legendaDsv').closest('.bloco') : null;
    var bAlteracoes = document.getElementById('blocoLegendaAlteracoes');
    var bAero = document.getElementById('blocoLegendaAero');
    if (b1) b1.style.display = 'none';
    if (b2) b2.style.display = 'none';
    if (b3) b3.style.display = 'none';
    if (b4) b4.style.display = 'none';
    if (b5) b5.style.display = 'none';
    if (bDma) bDma.style.display = 'none';
    if (bDpl) bDpl.style.display = 'none';
    if (bDpj) bDpj.style.display = 'none';
    if (bDoc) bDoc.style.display = 'none';
    if (bDsv) bDsv.style.display = 'none';
    if (bAlteracoes) bAlteracoes.style.display = 'none';
    if (bAero) bAero.style.display = 'none';

    desenharEstados();
    desenharMunicipiosBase(municipiosFiltrados());
    desenharRegioesBase();

    document.getElementById('countMunicipios').textContent = municipiosFiltrados().length;
    document.getElementById('countLinhas').textContent = '0';
    document.getElementById('countOAE').textContent = '0';
    var contadorObrasPontosOff = document.getElementById('countObrasPontos');
    if (contadorObrasPontosOff) contadorObrasPontosOff.textContent = '0';
    document.getElementById('countDor').textContent = '0';
    var contadorDmaOff = document.getElementById('countDma');
    if (contadorDmaOff) contadorDmaOff.textContent = '0';
    var contadorDplOff = document.getElementById('countDpl');
    if (contadorDplOff) contadorDplOff.textContent = '0';
    var contadorDpjOff = document.getElementById('countDpj');
    if (contadorDpjOff) contadorDpjOff.textContent = '0';

    atualizarTituloTopBar();
  }

  function limparTudo() {
    document.getElementById('bufferSelect').value = '';
    document.getElementById('ferroviaSelect').value = '';
    document.getElementById('rgPlanSelect').value = '';
    document.getElementById('rgManSelect').value = '';
    areaInfluenciaSelecionada = false;
    document.getElementById('areaInfluenciaSelect').value = '';
    sincronizarListasRegionais();
    sincronizarFiltroAreaInfluencia();
    atualizarMapaBaseRegioes();
    document.getElementById('municipioSelect').value = '';
    document.getElementById('rodoviaSelect').value = '';
    document.getElementById('sreSelect').value = '';
        document.getElementById('propostaSelect').value = '';
    document.getElementById('servicoSelect').value = '';
    programaAtivo = '';
    resetarBotoesPrograma();

    for (var chave in servicosAtivos) {
      servicosAtivos[chave] = true;
    }
    definirAlteracoesAtivas(true);
    oaeFiltroAtivo = true;
        sreBaseFiltroAtivo = true;
    snvFiltroAtivo = true;
    areasAmbientaisFiltroAtivo = false;
    areasUrbanasFiltroAtivo = false;
    areaInfluenciaFiltroAtivo = false;
    ferroviasFiltroAtivo = false;
    bufferFiltroAtivo = false;
    servicoFiltroAtivo = '';
    preencherIntervencaos();

    var btnOAEOn = document.getElementById('toggleOAE');
    if (btnOAEOn) btnOAEOn.classList.add('ativo-filtro');
    document.getElementById('toggleSREBase').classList.add('ativo-filtro');
    document.getElementById('toggleSNV').classList.add('ativo-filtro');
    localidadeFiltroAtivo = true;
    document.getElementById('toggleLocalidades').classList.add('ativo-filtro');
    aeroFiltroAtivo = true;
    var btnAeroOn = document.getElementById('toggleAero');
    if (btnAeroOn) btnAeroOn.classList.add('ativo-filtro');
    // Municípios começam desligados
    municipioBaseFiltroAtivo = false;
    var btnMunicipiosOn = document.getElementById('toggleMunicipiosBase');
    if (btnMunicipiosOn) btnMunicipiosOn.classList.remove('ativo-filtro');
    var btnAreasAmbientaisOn = document.getElementById('toggleAreasAmbientais');
    if (btnAreasAmbientaisOn) btnAreasAmbientaisOn.classList.remove('ativo-filtro');
    var btnAreasUrbanasOn = document.getElementById('toggleAreasUrbanas');
    if (btnAreasUrbanasOn) btnAreasUrbanasOn.classList.remove('ativo-filtro');
    document.getElementById('localidadeSelect').value = '';
    document.getElementById('localidadeBusca').value = '';
    atualizarBotoesBase();

    atualizarMunicipiosPorRegiao();
    preencherRodovias();
    preencherSREs();
    preencherPropostas();
    aplicarFiltros();
  }

  function parametrosEntradaMapa() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (e) {
      return new URLSearchParams('');
    }
  }

  function limparCamposFiltroEntrada() {
    var campos = [
      'rgPlanSelect',
      'rgManSelect',
      'areaInfluenciaSelect',
      'municipioSelect',
      'rodoviaSelect',
      'sreSelect',
      'ferroviaSelect',
      'bufferSelect',
      'propostaSelect',
      'servicoSelect',
      'localidadeSelect',
      'localidadeBusca',
      'municipioBusca'
    ];

    campos.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    programaAtivo = '';
    servicoFiltroAtivo = '';
    resetarBotoesPrograma();
  }

  function definirOrigensAtivas(origemAtiva) {
    for (var chave in servicosAtivos) {
      servicosAtivos[chave] = !origemAtiva || chave === origemAtiva;
    }
    definirAlteracoesAtivas(!origemAtiva);

    preencherIntervencaos();
    resetarBotoesIntervencao();
    preencherPropostas();
    preencherRodovias();
    preencherSREs();
  }

  function definirSidebarRecolhida(sidebarId, appClass, btn, recolhida) {
    var sidebar = document.getElementById(sidebarId);
    var app = document.getElementById('app');
    if (!sidebar || !app || !btn) return;

    sidebar.classList.toggle('sidebar-colapsed', recolhida);
    app.classList.toggle(appClass, recolhida);
    btn.textContent = recolhida
      ? (sidebarId === 'sidebar-left' ? '»' : '«')
      : (sidebarId === 'sidebar-left' ? '«' : '»');

    setTimeout(function() {
      map.invalidateSize();
    }, 300);
  }

  function definirMapaBase(nomeBase) {
    if (!nomeBase || !mapasBase || !mapasBase[nomeBase]) return;

    Object.keys(mapasBase).forEach(function(nome) {
      if (map.hasLayer(mapasBase[nome])) map.removeLayer(mapasBase[nome]);
    });

    mapasBase[nomeBase].addTo(map);
  }

  function aplicarEntradaMapa() {
    var params = parametrosEntradaMapa();
    var origem = String(params.get('origem') || '').toUpperCase();
    var perfil = String(params.get('perfil') || '').toLowerCase();
    var alteracoesEntrada = params.get('alteracoes') === '1';
    var origensValidas = ['FUNDEINFRA', 'DOR', 'DMA', 'DPL', 'DPJ', 'DOC', 'DSV'];

    if (alteracoesEntrada) {
      limparCamposFiltroEntrada();
      municipioBaseFiltroAtivo = true;
      for (var chaveAltEntrada in servicosAtivos) {
        servicosAtivos[chaveAltEntrada] = false;
      }
      definirAlteracoesAtivas(true);
      preencherIntervencaos();
      resetarBotoesIntervencao();
      preencherPropostas();
      preencherRodovias();
      preencherSREs();
      aplicarFiltros();
    } else if (origem && origensValidas.indexOf(origem) !== -1) {
      limparCamposFiltroEntrada();
      definirOrigensAtivas(origem);
      aplicarFiltros();
    } else if (perfil === 'rodoviario') {
      limparCamposFiltroEntrada();
      definirOrigensAtivas(null);
      for (var chave in servicosAtivos) {
        servicosAtivos[chave] = false;
      }
      definirAlteracoesAtivas(false);
      preencherIntervencaos();
      resetarBotoesIntervencao();

      oaeFiltroAtivo = true;
      sreBaseFiltroAtivo = true;
      snvFiltroAtivo = true;
      localidadeFiltroAtivo = true;
      aeroFiltroAtivo = true;
      municipioBaseFiltroAtivo = true;
      areasAmbientaisFiltroAtivo = true;
      areasUrbanasFiltroAtivo = true;
      densidadeRotulos = 1;

      var controleDensidade = document.getElementById('rotulosDensidade');
      if (controleDensidade) controleDensidade.value = '1';

      definirMapaBase('Padr\u00e3o');
      atualizarTextoDensidadeRotulos();
      atualizarBotoesBase();
      aplicarFiltros();
    } else {
      atualizarTextoDensidadeRotulos();
    }

    if (params.get('sidebar') === 'fechada') {
      definirSidebarRecolhida('sidebar-left', 'sidebar-left-collapsed', botaoSidebarLeft, true);
    }
  }

  configurarControlesRegionais();

  document.getElementById('municipioSelect').addEventListener('change', function() {
    preencherRodovias();
    preencherSREs();
    aplicarFiltros();
  });

  document.getElementById('rodoviaSelect').addEventListener('change', function() {
    document.getElementById('sreSelect').value = '';
    preencherSREs();
    aplicarFiltros();
  });

  document.getElementById('sreSelect').addEventListener('change', function() {
    aplicarFiltros();
  });

    document.getElementById('propostaSelect').addEventListener('change', function() {
    document.getElementById('rodoviaSelect').value = '';
    document.getElementById('sreSelect').value = '';
    preencherRodovias();
    preencherSREs();
    aplicarFiltros();
  });

  document.getElementById('servicoSelect').addEventListener('change', function() {
    servicoFiltroAtivo = this.value;
    document.getElementById('propostaSelect').value = '';
    document.getElementById('rodoviaSelect').value = '';
    document.getElementById('sreSelect').value = '';
    preencherPropostas();
    preencherRodovias();
    preencherSREs();
    aplicarFiltros();
  });

  document.getElementById('localidadeSelect').addEventListener('change', function() {
    document.getElementById('localidadeBusca').value = this.value;
    aplicarFiltros();
  });

  document.getElementById('desligarTudo').addEventListener('click', function() {
    desligarTudo();
  });

  document.getElementById('limparFiltro').addEventListener('click', function() {
    limparTudo();
  });

  var botaoExportarTabela = document.getElementById('exportarTabelaFiltrada');
  if (botaoExportarTabela) {
    botaoExportarTabela.addEventListener('click', exportarTabelaFiltradaCsv);
  }

  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  var indiceSugestaoMunicipio = -1;

  function selecionarMunicipio(nome) {
    var select = document.getElementById('municipioSelect');
    var busca = document.getElementById('municipioBusca');
    var sugestoes = document.getElementById('municipioSugestoes');

    select.value = nome;
    busca.value = nome;

    sugestoes.innerHTML = '';
    sugestoes.style.display = 'none';
    indiceSugestaoMunicipio = -1;

    document.getElementById('rodoviaSelect').value = '';
    document.getElementById('sreSelect').value = '';

    preencherRodovias();
    preencherSREs();
    aplicarFiltros();
  }

  var indiceSugestaoLocalidade = -1;

  function selecionarLocalidade(nome) {
    var select = document.getElementById('localidadeSelect');
    var busca = document.getElementById('localidadeBusca');
    var sugestoes = document.getElementById('localidadeSugestoes');

    select.value = nome;
    busca.value = nome;

    sugestoes.innerHTML = '';
    sugestoes.style.display = 'none';
    indiceSugestaoLocalidade = -1;

    aplicarFiltros();
  }

  function listarSugestoesLocalidade(textoDigitado) {
    var sugestoes = document.getElementById('localidadeSugestoes');
    var select = document.getElementById('localidadeSelect');

    var texto = normalizar(textoDigitado);
    sugestoes.innerHTML = '';
    indiceSugestaoLocalidade = -1;

    if (!texto) {
      sugestoes.style.display = 'none';
      select.value = '';
      aplicarFiltros();
      return;
    }

    var opcoes = Array.from(select.options)
      .map(function(opt) { return opt.value; })
      .filter(function(nome) { return nome; });

    var encontrados = opcoes
      .filter(function(nome) {
        return normalizar(nome).includes(texto);
      })
      .sort(function(a, b) {
        var na = normalizar(a);
        var nb = normalizar(b);

        var aComeca = na.startsWith(texto);
        var bComeca = nb.startsWith(texto);

        if (aComeca && !bComeca) return -1;
        if (!aComeca && bComeca) return 1;

        return a.localeCompare(b, 'pt-BR');
      })
      .slice(0, 8);

    if (!encontrados.length) {
      sugestoes.style.display = 'none';
      return;
    }

    encontrados.forEach(function(nome) {
      var item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = nome;

      item.addEventListener('mousedown', function() {
        selecionarLocalidade(nome);
      });

      sugestoes.appendChild(item);
    });

    sugestoes.style.display = 'block';
  }

  function listarSugestoesMunicipio(textoDigitado) {
    var sugestoes = document.getElementById('municipioSugestoes');
    var select = document.getElementById('municipioSelect');

    var texto = normalizar(textoDigitado);
    sugestoes.innerHTML = '';
    indiceSugestaoMunicipio = -1;

    if (!texto) {
      sugestoes.style.display = 'none';
      select.value = '';
      aplicarFiltros();
      return;
    }

    var opcoes = Array.from(select.options)
      .map(function(opt) { return opt.value; })
      .filter(function(nome) { return nome; });

    var encontrados = opcoes
      .filter(function(nome) {
        return normalizar(nome).includes(texto);
      })
      .sort(function(a, b) {
        var na = normalizar(a);
        var nb = normalizar(b);

        var aComeca = na.startsWith(texto);
        var bComeca = nb.startsWith(texto);

        if (aComeca && !bComeca) return -1;
        if (!aComeca && bComeca) return 1;

        return a.localeCompare(b, 'pt-BR');
      })
      .slice(0, 8);

    if (!encontrados.length) {
      sugestoes.style.display = 'none';
      return;
    }

    encontrados.forEach(function(nome) {
      var item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = nome;

      item.addEventListener('mousedown', function() {
        selecionarMunicipio(nome);
      });

      sugestoes.appendChild(item);
    });

    sugestoes.style.display = 'block';
  }

  document.getElementById('municipioBusca').addEventListener('input', function() {
    listarSugestoesMunicipio(this.value);
  });

  document.getElementById('municipioBusca').addEventListener('keydown', function(e) {
    var sugestoes = document.getElementById('municipioSugestoes');
    var itens = sugestoes.querySelectorAll('.autocomplete-item');

    if (!itens.length || sugestoes.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceSugestaoMunicipio++;

      if (indiceSugestaoMunicipio >= itens.length) {
        indiceSugestaoMunicipio = 0;
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceSugestaoMunicipio--;

      if (indiceSugestaoMunicipio < 0) {
        indiceSugestaoMunicipio = itens.length - 1;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (indiceSugestaoMunicipio >= 0 && itens[indiceSugestaoMunicipio]) {
        selecionarMunicipio(itens[indiceSugestaoMunicipio].textContent);
      }

      return;
    }

    itens.forEach(function(item) {
      item.classList.remove('ativo');
    });

    if (indiceSugestaoMunicipio >= 0 && itens[indiceSugestaoMunicipio]) {
      itens[indiceSugestaoMunicipio].classList.add('ativo');
    }
  });

  document.getElementById('localidadeBusca').addEventListener('input', function() {
    listarSugestoesLocalidade(this.value);
  });

  document.getElementById('localidadeBusca').addEventListener('keydown', function(e) {
    var sugestoes = document.getElementById('localidadeSugestoes');
    var itens = sugestoes.querySelectorAll('.autocomplete-item');

    if (!itens.length || sugestoes.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceSugestaoLocalidade++;

      if (indiceSugestaoLocalidade >= itens.length) {
        indiceSugestaoLocalidade = 0;
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceSugestaoLocalidade--;

      if (indiceSugestaoLocalidade < 0) {
        indiceSugestaoLocalidade = itens.length - 1;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (indiceSugestaoLocalidade >= 0 && itens[indiceSugestaoLocalidade]) {
        selecionarLocalidade(itens[indiceSugestaoLocalidade].textContent);
      }

      return;
    }

    itens.forEach(function(item) {
      item.classList.remove('ativo');
    });

    if (indiceSugestaoLocalidade >= 0 && itens[indiceSugestaoLocalidade]) {
      itens[indiceSugestaoLocalidade].classList.add('ativo');
    }
  });

  document.addEventListener('click', function(e) {
    var isInsideAutocomplete = !!e.target.closest('.autocomplete-wrap');
    var sugestoesMunicipio = document.getElementById('municipioSugestoes');
    var sugestoesLocalidade = document.getElementById('localidadeSugestoes');

    if (!isInsideAutocomplete) {
      sugestoesMunicipio.style.display = 'none';
      sugestoesLocalidade.style.display = 'none';
    }
  });

  var botoesPrograma = document.querySelectorAll('.programa-btn');
  for (var iBot = 0; iBot < botoesPrograma.length; iBot++) {
    botoesPrograma[iBot].addEventListener('click', function() {
      var prog = this.getAttribute('data-programa');

      if (programaAtivo === prog) {
        programaAtivo = '';
      } else {
        programaAtivo = prog;
      }

      resetarBotoesPrograma();

      if (programaAtivo) {
        var botao = document.querySelector('.programa-btn[data-programa="' + programaAtivo + '"]');
        if (botao) botao.classList.add('ativo-filtro');
      }

      aplicarFiltros();
    });
  }

  document.getElementById('toggleAlteracoesJurisdicao').addEventListener('click', function() {
    alteracoesReferenciaAtiva = !alteracoesReferenciaAtiva;
    if (alteracoesReferenciaAtiva && !TIPOS_ALTERACAO.some(function(tipo) { return alteracoesAtivas[tipo]; })) {
      definirAlteracoesAtivas(true);
    }
    atualizarBotoesAlteracoes();
    aplicarFiltros({ preservarZoom: true });
  });

  document.getElementById('alteracaoJurisdicaoSelect').addEventListener('change', function() {
    var tipoSelecionado = this.value;
    TIPOS_ALTERACAO.forEach(function(tipo) {
      alteracoesAtivas[tipo] = !tipoSelecionado || tipo === tipoSelecionado;
    });
    alteracoesReferenciaAtiva = true;
    atualizarBotoesAlteracoes();
    aplicarFiltros({ preservarZoom: true });
  });

  var botoesIntervencao = document.querySelectorAll('.servico-btn');
  for (var iServ = 0; iServ < botoesIntervencao.length; iServ++) {
    botoesIntervencao[iServ].addEventListener('click', function() {
      var chave = this.getAttribute('data-servico');
      servicosAtivos[chave] = !servicosAtivos[chave];
      preencherIntervencaos();
      document.getElementById('propostaSelect').value = '';
      document.getElementById('rodoviaSelect').value = '';
      document.getElementById('sreSelect').value = '';
      preencherPropostas();
      preencherRodovias();
      preencherSREs();
      aplicarFiltros({ preservarZoom: true });
    });
  }

  var btnToggleOAE = document.getElementById('toggleOAE');
  if (btnToggleOAE) {
    btnToggleOAE.addEventListener('click', function() {
      oaeFiltroAtivo = !oaeFiltroAtivo;
      this.classList.toggle('ativo-filtro', oaeFiltroAtivo);
      if (!oaeFiltroAtivo && oaeLayer) { map.removeLayer(oaeLayer); oaeLayer = null; }
      aplicarFiltros({ preservarZoom: true });
    });
  }

  document.getElementById('toggleSREBase').addEventListener('click', function() {
    sreBaseFiltroAtivo = !sreBaseFiltroAtivo;
    atualizarBotoesBase();
    aplicarFiltros({ preservarZoom: true });
  });

  document.getElementById('toggleSNV').addEventListener('click', function() {
    snvFiltroAtivo = !snvFiltroAtivo;
    atualizarBotoesBase();
    aplicarFiltros({ preservarZoom: true });
  });

  document.getElementById('toggleLocalidades').addEventListener('click', function() {
    localidadeFiltroAtivo = !localidadeFiltroAtivo;
    atualizarBotoesBase();
    aplicarFiltros({ preservarZoom: true });
  });

  var btnToggleAero = document.getElementById('toggleAero');
  if (btnToggleAero) {
    btnToggleAero.addEventListener('click', function() {
      aeroFiltroAtivo = !aeroFiltroAtivo;
      atualizarBotoesBase();
      desenharAero();
    });
  }

  var btnToggleMunicipios = document.getElementById('toggleMunicipiosBase');
  if (btnToggleMunicipios) {
    btnToggleMunicipios.addEventListener('click', function() {
      municipioBaseFiltroAtivo = !municipioBaseFiltroAtivo;
      atualizarBotoesBase();
      aplicarFiltros({ preservarZoom: true });
    });
  }

  document.getElementById('bufferSelect').addEventListener('change', function() {
    bufferFiltroAtivo = true;
    atualizarBotoesBase();
    desenharBuffer();
  });

  document.getElementById('toggleBuffer').addEventListener('click', function() {
    bufferFiltroAtivo = !bufferFiltroAtivo;
    atualizarBotoesBase();
    desenharBuffer();
  });

  document.getElementById('ferroviaSelect').addEventListener('change', function() {
    ferroviasFiltroAtivo = true;
    atualizarBotoesBase();
    desenharFerrovias();
  });

  var btnToggleFerrovias = document.getElementById('toggleFerrovias');
  if (btnToggleFerrovias) {
    btnToggleFerrovias.addEventListener('click', function() {
      ferroviasFiltroAtivo = !ferroviasFiltroAtivo;
      atualizarBotoesBase();
      desenharFerrovias();
    });
  }

  var btnToggleAreaInfluencia = document.getElementById('toggleAreaInfluencia');
  if (btnToggleAreaInfluencia) {
    btnToggleAreaInfluencia.addEventListener('click', function() {
      areaInfluenciaFiltroAtivo = !areaInfluenciaFiltroAtivo;
      atualizarBotoesBase();
      desenharAreaInfluencia();
    });
  }

  var btnToggleAreasUrbanas = document.getElementById('toggleAreasUrbanas');
  if (btnToggleAreasUrbanas) {
    btnToggleAreasUrbanas.addEventListener('click', function() {
      areasUrbanasFiltroAtivo = !areasUrbanasFiltroAtivo;
      atualizarBotoesBase();
      desenharAreasUrbanas();
    });
  }

  var btnToggleAreasAmbientais = document.getElementById('toggleAreasAmbientais');
  if (btnToggleAreasAmbientais) {
    btnToggleAreasAmbientais.addEventListener('click', function() {
      areasAmbientaisFiltroAtivo = !areasAmbientaisFiltroAtivo;
      atualizarBotoesBase();
      desenharAreasAmbientais();
    });
  }



  function alturaPainelTabelaSalva() {
    try {
      var valor = Number(localStorage.getItem('painelTabelaAlturaPx'));
      return isFinite(valor) && valor > 0 ? valor : null;
    } catch (e) {
      return null;
    }
  }

  function aplicarAlturaPainelTabela(altura) {
    var painel = document.getElementById('painelTabela');
    if (!painel || painel.classList.contains('painel-fechado')) return;

    var centro = document.getElementById('centro-mapa');
    var limiteMax = centro ? Math.max(180, centro.clientHeight - 160) : 520;
    var alturaFinal = Math.max(120, Math.min(limiteMax, Math.round(altura)));
    painel.style.setProperty('--painel-tabela-altura', alturaFinal + 'px');

    try {
      localStorage.setItem('painelTabelaAlturaPx', String(alturaFinal));
    } catch (e) {}

    setTimeout(function() {
      map.invalidateSize();
    }, 0);
  }

  function inicializarRedimensionamentoPainelTabela() {
    var painel = document.getElementById('painelTabela');
    var handle = document.getElementById('painelTabelaResize');
    if (!painel || !handle) return;

    var alturaSalva = alturaPainelTabelaSalva();
    if (alturaSalva) painel.style.setProperty('--painel-tabela-altura', alturaSalva + 'px');

    var arrastando = false;
    var inicioY = 0;
    var alturaInicial = 0;

    handle.addEventListener('mousedown', function(e) {
      if (painel.classList.contains('painel-fechado')) return;
      arrastando = true;
      inicioY = e.clientY;
      alturaInicial = painel.getBoundingClientRect().height;
      document.body.classList.add('redimensionando-painel-tabela');
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!arrastando) return;
      aplicarAlturaPainelTabela(alturaInicial + (inicioY - e.clientY));
    });

    document.addEventListener('mouseup', function() {
      if (!arrastando) return;
      arrastando = false;
      document.body.classList.remove('redimensionando-painel-tabela');
    });
  }

  inicializarRedimensionamentoPainelTabela();

  function alternarPainelTabela() {
    var painel = document.getElementById('painelTabela');
    var cabecalho = document.getElementById('painelTabelaHeader');
    if (!painel) return;

    painel.classList.toggle('painel-fechado');
    if (!painel.classList.contains('painel-fechado')) {
      var alturaSalva = alturaPainelTabelaSalva();
      if (alturaSalva) painel.style.setProperty('--painel-tabela-altura', alturaSalva + 'px');
    }

    if (cabecalho) {
      cabecalho.setAttribute('aria-expanded', painel.classList.contains('painel-fechado') ? 'false' : 'true');
    }

    setTimeout(function() {
      map.invalidateSize();
    }, 200);
  }

  var cabecalhoPainelTabela = document.getElementById('painelTabelaHeader');
  if (cabecalhoPainelTabela) {
    cabecalhoPainelTabela.addEventListener('click', alternarPainelTabela);
    cabecalhoPainelTabela.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      alternarPainelTabela();
    });
  }

  // ===== TOGGLE DAS SIDEBARS (Filtros e Legendas) =====

  function toggleSidebar(sidebarId, appClass, btn) {
    var sidebar = document.getElementById(sidebarId);
    var app = document.getElementById('app');
    if (!sidebar || !app) return;

    sidebar.classList.toggle('sidebar-colapsed');
    app.classList.toggle(appClass);

    btn.textContent = sidebar.classList.contains('sidebar-colapsed')
      ? (sidebarId === 'sidebar-left' ? '»' : '«')
      : (sidebarId === 'sidebar-left' ? '«' : '»');

    setTimeout(function() {
      map.invalidateSize();
    }, 300);
  }

  var botaoSidebarLeft = document.getElementById('toggleSidebarLeft');
  if (botaoSidebarLeft) {
    botaoSidebarLeft.addEventListener('click', function() {
      toggleSidebar('sidebar-left', 'sidebar-left-collapsed', this);
    });
  }

  var botaoSidebarRight = document.getElementById('toggleSidebarRight');
  if (botaoSidebarRight) {
    botaoSidebarRight.addEventListener('click', function() {
      toggleSidebar('sidebar-right', 'sidebar-right-collapsed', this);
    });
  }

  function fetchGeoJSON(nome, obrigatorio) {
    return fetch(nome)
      .then(function(r) {
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status + ' em ' + nome);
          err.fileName = nome;
          throw err;
        }
        return r.json().catch(function(jsonErr) {
          var err = new Error('JSON inválido em ' + nome);
          err.fileName = nome;
          throw err;
        });
      })
      .catch(function(e) {
        if (!e.fileName) e.fileName = nome;
        if (obrigatorio) throw e;
        console.warn('Camada opcional não carregada:', nome, e);
        return null;
      });
  }

  var painelTabelaConteudoEl = document.getElementById('painelTabelaConteudo');
  if (painelTabelaConteudoEl) {
    painelTabelaConteudoEl.addEventListener('click', function(e) {
      var alvoLista = e.target && e.target.closest ? e.target.closest('[data-lista-filtrada]') : null;
      if (alvoLista) {
        renderizarListaCompletaFiltrada(alvoLista.getAttribute('data-lista-filtrada'));
        return;
      }
      var alvoVoltar = e.target && e.target.closest ? e.target.closest('[data-voltar-lista-filtrada]') : null;
      if (alvoVoltar) {
        limparDestaqueTabelaCompleta();
        if (htmlPainelAntesListaCompleta) painelTabelaConteudoEl.innerHTML = htmlPainelAntesListaCompleta;
        return;
      }
      var alvoZoom = e.target && e.target.closest ? e.target.closest('[data-zoom-registro]') : null;
      if (alvoZoom) {
        var linhas = painelTabelaConteudoEl.querySelectorAll('.tabela-lista-filtrada tr.linha-selecionada-grupo');
        for (var i = 0; i < linhas.length; i++) linhas[i].classList.remove('linha-selecionada-grupo');
        var linha = alvoZoom.closest('tr');
        if (linha) linha.classList.add('linha-selecionada-grupo');
        zoomParaRegistroTabelaCompleta(alvoZoom.getAttribute('data-zoom-registro'));
      }
    });
  }

  if (painelTabelaConteudoEl) {
    painelTabelaConteudoEl.addEventListener('input', function(e) {
      var busca = e.target && e.target.id === 'buscaListaFiltrada' ? e.target : null;
      if (!busca) return;
      var termo = busca.value.toLowerCase();
      var linhas = painelTabelaConteudoEl.querySelectorAll('.tabela-lista-filtrada tr[data-linha-zoom]');
      for (var i = 0; i < linhas.length; i++) {
        linhas[i].style.display = !termo || linhas[i].textContent.toLowerCase().indexOf(termo) >= 0 ? '' : 'none';
      }
    });
  }

  // --- Construção em memória de obras_linhas / aerodromos_obras / alteracoes_linhas ---
  // a partir de OBRAS_LINKS.json + DADOS.json cruzados com as bases geográficas
  // (sre_base, ferrovias, extra_base, AERO), substituindo os antigos arquivos
  // GeoJSON estáticos equivalentes sem alterar os campos que o restante do
  // código já espera encontrar em cada feature.

  function indexarPorGeocod(colecao) {
    var indice = {};
    if (!colecao || !colecao.features) return indice;
    for (var i = 0; i < colecao.features.length; i++) {
      var props = colecao.features[i].properties || {};
      var geocod = props.GEOCOD || props.geocod;
      if (geocod) indice[String(geocod)] = colecao.features[i];
    }
    return indice;
  }

  function indexarRegistrosPorIdcod(registros) {
    var indice = {};
    (registros || []).forEach(function(registro) {
      if (registro && registro.IDCOD !== null && registro.IDCOD !== undefined) {
        indice[String(registro.IDCOD)] = registro;
      }
    });
    return indice;
  }

  var LINK_FIELD_POR_UNIDADE = {
    FUNDEINFRA: 'LINK_FUND',
    DOR: 'LINK_DOR',
    DMA: 'LINK_DMA',
    DPL: 'LINK_DPL',
    DPJ: 'LINK_DPJ'
  };

  // Cada GEOCOD (dentro de uma BASE) gera UMA única feature, com um campo
  // LINK_x por unidade vinculada (mesmo padrão do antigo formato largo em
  // OBRAS_LINHAS.json). Isso é essencial para que obras de origens distintas
  // (ex.: FUNDEINFRA e DOR) sobre o mesmo trecho continuem sendo detectadas
  // e exibidas juntas (popup e tabelas inferiores), em vez de virarem
  // features separadas que só carregam uma origem cada.
  function construirSreDataDeLinks(links, registrosPorIdcod, baseIndices) {
    var featuresPorChave = {};
    (links || []).forEach(function(vinculo) {
      var registro = registrosPorIdcod[String(vinculo.IDCOD)];
      if (!registro) return;
      var linkField = LINK_FIELD_POR_UNIDADE[String(registro.UNIDADE || '').toUpperCase()];
      if (!linkField) return;
      var indice = baseIndices[vinculo.BASE];
      var baseFeature = indice && indice[String(vinculo.GEOCOD)];
      if (!baseFeature || !baseFeature.geometry) return;
      var chave = vinculo.BASE + '|' + vinculo.GEOCOD;
      var feature = featuresPorChave[chave];
      if (!feature) {
        var bp = baseFeature.properties || {};
        var props = {
          sre: bp.sre || '',
          rodovia: bp.rodovia || '',
          trecho: bp.trecho || bp.nome || '',
          EXT_KM: bp.ext != null ? bp.ext : (bp.extensao != null ? bp.extensao : '')
        };
        if (bp.reg_man != null) props.reg_man = bp.reg_man;
        feature = { type: 'Feature', properties: props, geometry: baseFeature.geometry };
        featuresPorChave[chave] = feature;
      }
      if (registro.MUNICIPIO && !feature.properties.NM_MUN) feature.properties.NM_MUN = registro.MUNICIPIO;
      feature.properties[linkField] = registro.IDCOD;
    });
    return { type: 'FeatureCollection', features: Object.keys(featuresPorChave).map(function(chave) { return featuresPorChave[chave]; }) };
  }

  function construirAeroObrasDeLinks(links, registrosPorIdcod, aeroIndice) {
    var featuresPorGeocod = {};
    (links || []).forEach(function(vinculo) {
      if (vinculo.BASE !== 'aero') return;
      var registro = registrosPorIdcod[String(vinculo.IDCOD)];
      if (!registro) return;
      var linkField = LINK_FIELD_POR_UNIDADE[String(registro.UNIDADE || '').toUpperCase()];
      if (!linkField) return;
      var aeroFeature = aeroIndice[String(vinculo.GEOCOD)];
      if (!aeroFeature || !aeroFeature.geometry) return;
      var feature = featuresPorGeocod[vinculo.GEOCOD];
      if (!feature) {
        feature = { type: 'Feature', properties: Object.assign({}, aeroFeature.properties || {}), geometry: aeroFeature.geometry };
        featuresPorGeocod[vinculo.GEOCOD] = feature;
      }
      feature.properties[linkField] = registro.IDCOD;
    });
    return { type: 'FeatureCollection', features: Object.keys(featuresPorGeocod).map(function(geocod) { return featuresPorGeocod[geocod]; }) };
  }

  var MAPA_CAMPOS_ALTERACAO_DE_DADOS = {
    ID: 'IDCOD',
    TIPO: 'INTERVENCAO',
    PROCESSO: 'SEI',
    MUNICIPIOS: 'MUNICIPIO',
    RODOVIA: 'RODOVIA',
    EXTENSAO_KM: 'EXT_CONTRATO_KM',
    PORTARIA_SRE: 'PORTARIA_SRE',
    TRECHO: 'DESCRICAO',
    LEI_MUNICIPAL: 'LEI_MUNICIPAL',
    EXPOSICAO_DE_MOTIVOS: 'EXPOSICAO_DE_MOTIVOS',
    LEI_ESTADUAL: 'LEI_ESTADUAL',
    TERMO_DE_TRANSFERENCIA: 'TERMO_DE_TRANSFERENCIA',
    SITUACAO_ATUAL: 'STATUS'
  };

  function construirRegistrosAlteracoesDeDados(registrosJurisdicao) {
    return registrosJurisdicao.map(function(registro) {
      var mapeado = {};
      Object.keys(MAPA_CAMPOS_ALTERACAO_DE_DADOS).forEach(function(campoAlteracao) {
        mapeado[campoAlteracao] = registro[MAPA_CAMPOS_ALTERACAO_DE_DADOS[campoAlteracao]];
      });
      return mapeado;
    });
  }

  function construirAlteracoesDataDeLinks(links, registrosPorIdcod, baseIndices) {
    var features = [];
    (links || []).forEach(function(vinculo) {
      var registro = registrosPorIdcod[String(vinculo.IDCOD)];
      if (!registro || registro.NATUREZA !== 'Jurisdição') return;
      var indice = baseIndices[vinculo.BASE];
      var baseFeature = indice && indice[String(vinculo.GEOCOD)];
      if (!baseFeature || !baseFeature.geometry) return;
      features.push({ type: 'Feature', properties: { ID: registro.IDCOD }, geometry: baseFeature.geometry });
    });
    return { type: 'FeatureCollection', features: features };
  }

  // --- Área de Estudo (polígono, base geo_pol_base) e Área de Influência ---
  // (buffer de linhas ao longo de rodovias/ferrovias) — ambas vinculadas via
  // DADOS.json (NATUREZA = 'Espacialização') + OBRAS_LINKS.json.

  function construirAreaInfluenciaDeLinks(links, registrosPorIdcod, geoPolIndice) {
    var features = [];
    (links || []).forEach(function(vinculo) {
      if (vinculo.BASE !== 'geo_pol_base') return;
      var registro = registrosPorIdcod[String(vinculo.IDCOD)];
      if (!registro || registro.NATUREZA !== 'Espacialização') return;
      var baseFeature = geoPolIndice[String(vinculo.GEOCOD)];
      if (!baseFeature || !baseFeature.geometry) return;
      features.push({ type: 'Feature', properties: Object.assign({}, baseFeature.properties || {}), geometry: baseFeature.geometry });
    });
    return { type: 'FeatureCollection', features: features };
  }

  function construirBufferDeLinks(links, registrosPorIdcod, baseIndices) {
    var features = [];
    (links || []).forEach(function(vinculo) {
      if (vinculo.BASE === 'geo_pol_base' || vinculo.BASE === 'aero') return;
      var registro = registrosPorIdcod[String(vinculo.IDCOD)];
      if (!registro || registro.NATUREZA !== 'Espacialização') return;
      var indice = baseIndices[vinculo.BASE];
      var baseFeature = indice && indice[String(vinculo.GEOCOD)];
      if (!baseFeature || !baseFeature.geometry) return;
      features.push({
        type: 'Feature',
        geometry: baseFeature.geometry,
        properties: {
          IDCOD: registro.IDCOD,
          BASE: vinculo.BASE,
          SRE: vinculo.GEOCOD,
          DESCRICAO: registro.DESCRICAO
        }
      });
    });
    return features;
  }

  Promise.all([
    fetchGeoJSON('data/municipios.geojson', true),
    fetchGeoJSON('data/localidades.geojson', true),
    fetchGeoJSON('data/parques_go.geojson', false),
    fetchGeoJSON('data/areas_urbanas.geojson', false),
    fetchGeoJSON('data/sre_base.geojson', false),
    fetchGeoJSON('data/snv_goias.geojson', false),
    fetchGeoJSON('data/estados.geojson', false),
    fetchGeoJSON('data/mascara_brasil.geojson', false),
    fetchGeoJSON('data/aero.geojson', false),
    fetchGeoJSON('data/geo_pol_base.geojson', false),
    fetchGeoJSON('data/ferrovias.geojson', false),
    carregarDadosUnificados(),
    fetchGeoJSON('data/regioes.geojson', true),
    fetchGeoJSON('data/extra_base.geojson', false),
    carregarTabelaSupabase('obras_links')
  ]).then(function(resultado) {
    municipiosData = resultado[0];
    localidadesData = resultado[1];
    areasAmbientaisData = resultado[2];
    areasUrbanasData = resultado[3];
    sreBaseData = resultado[4];
    construirIndiceSREBaseCoincidencias();
    obrasPontosBaseData = null;
    oaeData = null;
    snvData = resultado[5];
    estadosData = resultado[6];
    mascaraBrasilData = resultado[7];
    aeroData = resultado[8];

    desenharMascaraBrasil();

    var geoPolBaseData = resultado[9];
    ferroviasData = resultado[10];
    preencherFerrovias();

    regioesData = resultado[12];
    extraBaseData = resultado[13];

    var registros = resultado[11];
    var links = resultado[14];
    var registrosPorIdcod = indexarRegistrosPorIdcod(registros);
    var baseIndices = {
      sre_base: indexarPorGeocod(sreBaseData),
      ferrovias: indexarPorGeocod(ferroviasData),
      extra_base: indexarPorGeocod(extraBaseData)
    };
    var aeroIndice = indexarPorGeocod(aeroData);
    var geoPolIndice = indexarPorGeocod(geoPolBaseData);

    sreData = construirSreDataDeLinks(links, registrosPorIdcod, baseIndices);
    aeroObrasData = construirAeroObrasDeLinks(links, registrosPorIdcod, aeroIndice);
    alteracoesData = construirAlteracoesDataDeLinks(links, registrosPorIdcod, baseIndices);
    areaInfluenciaData = construirAreaInfluenciaDeLinks(links, registrosPorIdcod, geoPolIndice);
    prepararFiltroAreaInfluencia();
    prepararBuffer(links, registrosPorIdcod, baseIndices);

    var registrosJurisdicao = registros.filter(function(r) { return r.NATUREZA === 'Jurisdição'; });
    atualizarAlteracoesTabela(construirRegistrosAlteracoesDeDados(registrosJurisdicao));

    preencherRGPlan();
    prepararRegioes();
    preencherMunicipios();
    preencherLocalidades();
    preencherRodovias();
    preencherSREs();
    limparTudo();
    aplicarEntradaMapa();
  }).catch(function(e) {
    console.error('Falha detalhada no carregamento:', e);
    alert(
      'Falha ao carregar: ' + (e.fileName || 'arquivo desconhecido') +
      '\nDetalhe: ' + (e.message || e)
    );
  });










































