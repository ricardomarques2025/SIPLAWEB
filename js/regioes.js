// Seleção múltipla e malhas regionais. Os dados são carregados por mapa.js.
var regioesData = null;
var regioesPlanejamentoData = null;
var regioesBaseAtivas = { manutencao: false, planejamento: false };
var regioesLayers = {};
var regioesSRE = {};
var areaInfluenciaSelecionada = false;

function regioesSelecionadas(id) {
  var select = document.getElementById(id);
  return select ? Array.from(select.selectedOptions).map(function(o) { return o.value; }).filter(Boolean) : [];
}

function temFiltroRegional() {
  return regioesSelecionadas('rgPlanSelect').length > 0 || regioesSelecionadas('rgManSelect').length > 0;
}

function temFiltroAreaInfluencia() {
  return areaInfluenciaSelecionada;
}

function temFiltroGeografico() {
  return temFiltroRegional() || temFiltroAreaInfluencia();
}

function nomeExibicaoAreaInfluencia(feature, indice) {
  var nome = valorSeguro(feature, 'NOME') || 'Área de Estudo ' + (indice + 1);
  return String(nome).replace(/Área de Influência/gi, 'Área de Estudo');
}

function nomeRegiaoPlanejamento(feature) {
  return String(valorSeguro(feature, 'RG_PLAN') || valorSeguro(feature, 'REG_PLAN'));
}

function poligonosManutencaoSelecionados() {
  var ids = regioesSelecionadas('rgManSelect');
  return regioesData ? regioesData.features.filter(function(f) { return ids.includes(String(valorSeguro(f, 'REG'))); }) : [];
}

function sincronizarListasRegionais() {
  ['rgPlanSelect', 'rgManSelect'].forEach(function(id) {
    var valores = regioesSelecionadas(id);
    document.querySelectorAll('#' + id + 'Lista input').forEach(function(input) {
      input.checked = valores.includes(input.value);
    });
  });
}

function criarListaRegional(id) {
  var select = document.getElementById(id);
  var lista = document.getElementById(id + 'Lista');
  lista.replaceChildren();
  Array.from(select.options).filter(function(o) { return o.value; }).forEach(function(opcao) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opcao.value;
    input.addEventListener('change', function() {
      opcao.selected = input.checked;
      select.dispatchEvent(new Event('change'));
    });
    label.append(input, document.createTextNode(opcao.textContent));
    lista.appendChild(label);
  });
}

function prepararRegioes() {
  var grupos = {};
  municipiosData.features.forEach(function(f) {
    var nome = nomeRegiaoPlanejamento(f);
    if (!nome) return;
    if (!grupos[nome]) grupos[nome] = [];
    grupos[nome].push.apply(grupos[nome], f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  });
  regioesPlanejamentoData = { type: 'FeatureCollection', features: Object.keys(grupos).sort().map(function(nome) {
    return { type: 'Feature', properties: { nome: nome }, geometry: { type: 'MultiPolygon', coordinates: grupos[nome] } };
  }) };
  (sreBaseData ? sreBaseData.features : []).forEach(function(f) {
    var sre = nomeSREFeature(f);
    var reg = String(valorSeguro(f, 'reg_man'));
    if (!sre || !reg) return;
    if (!regioesSRE[sre]) regioesSRE[sre] = new Set();
    regioesSRE[sre].add(reg);
  });
  var select = document.getElementById('rgManSelect');
  (regioesData ? regioesData.features : []).slice().sort(function(a, b) {
    return Number(valorSeguro(a, 'REG')) - Number(valorSeguro(b, 'REG'));
  }).forEach(function(f) {
    var id = String(valorSeguro(f, 'REG'));
    select.add(new Option('Região ' + id, id));
  });
  criarListaRegional('rgPlanSelect');
  criarListaRegional('rgManSelect');
}

function prepararFiltroAreaInfluencia() {
  var select = document.getElementById('areaInfluenciaSelect');
  if (!select || !areaInfluenciaData || !areaInfluenciaData.features) return;
  select.replaceChildren();
  areaInfluenciaData.features.forEach(function(feature, indice) {
    var nome = nomeExibicaoAreaInfluencia(feature, indice);
    select.add(new Option(nome, String(indice)));
  });
  var lista = document.getElementById('areaInfluenciaSelectLista');
  lista.replaceChildren();
  Array.from(select.options).forEach(function(opcao) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = areaInfluenciaSelecionada && opcao.value === '0';
    input.addEventListener('change', function() {
      areaInfluenciaSelecionada = input.checked;
      Array.from(select.options).forEach(function(item) { item.selected = false; });
      if (input.checked) opcao.selected = true;
      select.dispatchEvent(new Event('change'));
    });
    label.append(input, document.createTextNode(opcao.textContent));
    lista.appendChild(label);
  });
}

function sincronizarFiltroAreaInfluencia() {
  document.querySelectorAll('#areaInfluenciaSelectLista input').forEach(function(input) {
    input.checked = areaInfluenciaSelecionada;
  });
}

function featuresAreaInfluenciaSelecionada() {
  return areaInfluenciaSelecionada && areaInfluenciaData ? areaInfluenciaData.features : [];
}

// Interseção geométrica, inclusive segmentos que atravessam uma região sem
// possuir vértices dentro dela. As caixas evitam comparações desnecessárias.
var cacheGeometriasRegionais = new WeakMap();
function geometriaRegional(feature) {
  if (cacheGeometriasRegionais.has(feature)) return cacheGeometriasRegionais.get(feature);
  var pontos = [], segmentos = [], caixa = [Infinity, Infinity, -Infinity, -Infinity];
  function linha(coords) {
    coords.forEach(function(p, i) {
      pontos.push(p);
      caixa[0] = Math.min(caixa[0], p[0]); caixa[1] = Math.min(caixa[1], p[1]);
      caixa[2] = Math.max(caixa[2], p[0]); caixa[3] = Math.max(caixa[3], p[1]);
      if (i) segmentos.push([coords[i - 1], p]);
    });
  }
  var g = feature.geometry;
  if (g.type === 'Point') linha([g.coordinates]);
  else if (g.type === 'MultiPoint') g.coordinates.forEach(function(p) { linha([p]); });
  else if (g.type === 'LineString') linha(g.coordinates);
  else if (g.type === 'Polygon' || g.type === 'MultiLineString') g.coordinates.forEach(linha);
  else if (g.type === 'MultiPolygon') g.coordinates.forEach(function(p) { p.forEach(linha); });
  var resultado = { pontos: pontos, segmentos: segmentos, caixa: caixa };
  cacheGeometriasRegionais.set(feature, resultado);
  return resultado;
}

function caixasRegionaisCruzam(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function segmentosRegionaisCruzam(a, b, c, d) {
  if (!caixasRegionaisCruzam([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    [Math.min(c[0], d[0]), Math.min(c[1], d[1]), Math.max(c[0], d[0]), Math.max(c[1], d[1])])) return false;
  function lado(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
  return lado(a, b, c) * lado(a, b, d) <= 0 && lado(c, d, a) * lado(c, d, b) <= 0;
}

var cachePartesRegionais = new WeakMap();
function featureCruzaRegiao(feature, poligono) {
  if (!feature.geometry || !poligono.geometry) return false;
  var a = geometriaRegional(feature), b = geometriaRegional(poligono);
  if (!caixasRegionaisCruzam(a.caixa, b.caixa)) return false;
  if (poligono.geometry.type === 'MultiPolygon') {
    if (!cachePartesRegionais.has(poligono)) {
      cachePartesRegionais.set(poligono, poligono.geometry.coordinates.map(function(coords) {
        return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } };
      }));
    }
    return cachePartesRegionais.get(poligono).some(function(parte) { return featureCruzaRegiao(feature, parte); });
  }
  if (a.pontos.some(function(p) { return pontoEmPoligonoFeature(p[0], p[1], poligono); })) return true;
  if (/Polygon/.test(feature.geometry.type) && b.pontos.some(function(p) { return pontoEmPoligonoFeature(p[0], p[1], feature); })) return true;
  return a.segmentos.some(function(s) { return b.segmentos.some(function(t) { return segmentosRegionaisCruzam(s[0], s[1], t[0], t[1]); }); });
}

var cacheFiltroRegional = new WeakMap();
function featureAtendeRegioes(feature) {
  if (!temFiltroGeografico()) return true;
  var chave = regioesSelecionadas('rgManSelect').join('|') + '/' + regioesSelecionadas('rgPlanSelect').join('|') + '/' + areaInfluenciaSelecionada;
  var anterior = cacheFiltroRegional.get(feature);
  if (anterior && anterior.chave === chave) return anterior.resultado;
  var resultado = calcularFiltroRegional(feature);
  cacheFiltroRegional.set(feature, { chave: chave, resultado: resultado });
  return resultado;
}

function calcularFiltroRegional(feature) {
  var manutencao = regioesSelecionadas('rgManSelect');
  var planejamento = regioesSelecionadas('rgPlanSelect');
  if (manutencao.length) {
    var reg = String(valorSeguro(feature, 'reg_man'));
    var regs = reg ? new Set([reg]) : regioesSRE[nomeSREFeature(feature)];
    if (regs) {
      if (!manutencao.some(function(id) { return regs.has(id); })) return false;
    } else if (!poligonosManutencaoSelecionados().some(function(p) { return featureCruzaRegiao(feature, p); })) return false;
  }
  if (planejamento.length) {
    var nome = nomeRegiaoPlanejamento(feature);
    if (nome && !planejamento.includes(nome)) return false;
    if (!nome && !regioesPlanejamentoData.features.some(function(p) {
      return planejamento.includes(p.properties.nome) && featureCruzaRegiao(feature, p);
    })) return false;
  }
  if (areaInfluenciaSelecionada && !featuresAreaInfluenciaSelecionada().some(function(area) {
    return featureCruzaRegiao(feature, area);
  })) return false;
  return true;
}

// Remove arestas municipais compartilhadas para mostrar apenas as divisas regionais.
function contornoRegional(feature) {
  var arestas = new Map();
  geometriaRegional(feature).segmentos.forEach(function(s) {
    var a = s[0].map(function(n) { return n.toFixed(7); }).join(',');
    var b = s[1].map(function(n) { return n.toFixed(7); }).join(',');
    var chave = a < b ? a + ':' + b : b + ':' + a;
    if (arestas.has(chave)) arestas.delete(chave); else arestas.set(chave, s);
  });
  return { type: 'Feature', properties: feature.properties, geometry: { type: 'MultiLineString', coordinates: Array.from(arestas.values()) } };
}

function estiloPreenchimentoRegiao(indice, selecionado, selecao) {
  var cor = 'hsl(' + ((indice + 1) * 37 % 360) + ', 50%, 80%)';
  return {
    stroke: false,
    fillColor: cor,
    fillOpacity: selecionado || (!selecao.length && temFiltroRegional()) ? 0 : (selecao.length ? 1 : 0.6)
  };
}

function atualizarLegendasRegionais() {
  ['manutencao', 'planejamento'].forEach(function(tipo) {
    var sufixo = tipo === 'manutencao' ? 'Manutencao' : 'Planejamento';
    var bloco = document.getElementById('blocoLegendaRegioes' + sufixo);
    var alvo = document.getElementById('legendaRegioes' + sufixo);
    alvo.replaceChildren();
    var dados = tipo === 'manutencao' ? regioesData : regioesPlanejamentoData;
    var visivel = dados && regioesLayers[tipo] && map.hasLayer(regioesLayers[tipo]);
    bloco.style.display = visivel ? '' : 'none';
    if (!visivel) return;
    var selecao = regioesSelecionadas(tipo === 'manutencao' ? 'rgManSelect' : 'rgPlanSelect');
    dados.features.forEach(function(f, i) {
      var nome = tipo === 'manutencao' ? String(valorSeguro(f, 'REG')) : f.properties.nome;
      var selecionado = selecao.includes(nome);
      if (selecao.length && !selecionado) return;
      var estilo = estiloPreenchimentoRegiao(i, selecionado, selecao);
      var item = document.createElement('div');
      item.className = 'legenda-item';
      var amostra = document.createElement('span');
      amostra.className = 'legenda-regiao-amostra';
      var preenchimento = document.createElement('span');
      preenchimento.style.backgroundColor = estilo.fillColor;
      preenchimento.style.opacity = estilo.fillOpacity;
      amostra.appendChild(preenchimento);
      var texto = document.createElement('div');
      texto.className = 'legenda-texto';
      texto.textContent = (tipo === 'manutencao' ? 'Região ' : '') + nome + (selecionado ? ' (selecionada)' : '');
      item.append(amostra, texto);
      alvo.appendChild(item);
    });
  });
  var blocoArea = document.getElementById('blocoLegendaAreaInfluencia');
  var alvoArea = document.getElementById('legendaAreaInfluencia');
  if (blocoArea && alvoArea) {
    alvoArea.replaceChildren();
    var visivel = areaInfluenciaData && (areaInfluenciaFiltroAtivo || areaInfluenciaSelecionada);
    blocoArea.style.display = visivel ? '' : 'none';
    if (visivel) {
      featuresAreaInfluenciaSelecionada().forEach(function(feature) {
        var item = document.createElement('div');
        item.className = 'legenda-item';
        item.innerHTML = '<span class="legenda-regiao-amostra"><span style="background:#87cefa;opacity:0"></span></span>' +
          '<div class="legenda-texto">' + escapeHtml(nomeExibicaoAreaInfluencia(feature, 0)) + '</div>';
        alvoArea.appendChild(item);
      });
      if (!areaInfluenciaSelecionada) {
        var itemPadrao = document.createElement('div');
        itemPadrao.className = 'legenda-item';
        itemPadrao.innerHTML = '<span class="legenda-regiao-amostra"><span style="background:#87cefa;opacity:0.25"></span></span><div class="legenda-texto">Área de Estudo</div>';
        alvoArea.appendChild(itemPadrao);
      }
    }
  }
}

function desenharRegioesBase() {
  ['planejamento', 'manutencao'].forEach(function(tipo) {
    if (regioesLayers[tipo]) map.removeLayer(regioesLayers[tipo]);
    regioesLayers[tipo] = null;
    var dados = tipo === 'manutencao' ? regioesData : regioesPlanejamentoData;
    var selecao = regioesSelecionadas(tipo === 'manutencao' ? 'rgManSelect' : 'rgPlanSelect');
    if (!dados || (!regioesBaseAtivas[tipo] && !selecao.length)) return;
    var grupo = L.layerGroup();
    dados.features.forEach(function(f, i) {
      var nome = tipo === 'manutencao' ? String(valorSeguro(f, 'REG')) : f.properties.nome;
      var selecionado = selecao.includes(nome);
      L.geoJSON(f, {
        pane: 'regioesPane',
        style: estiloPreenchimentoRegiao(i, selecionado, selecao),
        onEachFeature: function(feature, layer) {
          vincularPopupComAreaClique(layer, function() {
            return construirPopupAreaBase(feature,
              (tipo === 'manutencao' ? 'Região de Manutenção ' : 'Região de Planejamento: ') + nome, []);
          });
        }
      }).addTo(grupo);
    });
    dados.features.forEach(function(f) {
      if (!f._contornoRegional) f._contornoRegional = contornoRegional(f);
      L.geoJSON(f._contornoRegional, { pane: 'regioesPane', interactive: false, style: { color: '#ffffff', weight: 3, opacity: 1 } }).addTo(grupo);
      L.geoJSON(f._contornoRegional, { pane: 'regioesPane', interactive: false, style: { color: '#888888', weight: 1.5, dashArray: '8, 5, 1, 5' } }).addTo(grupo);
    });
    regioesLayers[tipo] = grupo.addTo(map);
  });
  atualizarLegendasRegionais();
}

function atualizarBotoesRegionais() {
  ['manutencao', 'planejamento'].forEach(function(tipo) {
    var btn = document.getElementById(tipo === 'manutencao' ? 'toggleRegioesManutencao' : 'toggleRegioesPlanejamento');
    btn.classList.toggle('ativo-filtro', regioesBaseAtivas[tipo]);
    btn.setAttribute('aria-pressed', String(regioesBaseAtivas[tipo]));
  });
  sincronizarListasRegionais();
}

function zoomParaRegioesSelecionadas() {
  map.off('zoomend', zoomParaRegioesSelecionadas);
  if (map._animatingZoom) {
    map.once('zoomend', zoomParaRegioesSelecionadas);
    return;
  }
  var planejamento = regioesSelecionadas('rgPlanSelect');
  var features = poligonosManutencaoSelecionados().concat(
    regioesPlanejamentoData.features.filter(function(f) { return planejamento.includes(f.properties.nome); })
  );
  if (!features.length) return;
  var bounds = L.geoJSON({ type: 'FeatureCollection', features: features }).getBounds();
  if (bounds.isValid()) {
    // Cliques consecutivos não devem disputar animações de enquadramentos anteriores.
    map.stop();
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11, animate: false });
  }
}

function atualizarMapaBaseRegioes() {
  var basePadrao = Object.keys(MAPAS_BASE_CONFIG).find(function(nome) {
    return MAPAS_BASE_CONFIG[nome].inicial;
  });
  definirMapaBase(temFiltroRegional() ? 'Satélite' : basePadrao);
}

function configurarControlesRegionais() {
  ['rgPlanSelect', 'rgManSelect'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
      document.getElementById('municipioSelect').value = '';
      document.getElementById('municipioBusca').value = '';
      atualizarMapaBaseRegioes();
      atualizarMunicipiosPorRegiao();
      preencherRodovias();
      preencherSREs();
      aplicarFiltros({ zoomRegional: true });
    });
    document.getElementById(id + 'Limpar').addEventListener('click', function() {
      document.getElementById(id).value = '';
      document.getElementById(id).dispatchEvent(new Event('change'));
    });
  });
  document.getElementById('areaInfluenciaSelect').addEventListener('change', function() {
    areaInfluenciaSelecionada = Array.from(this.selectedOptions).length > 0;
    atualizarMapaBaseRegioes();
    atualizarMunicipiosPorRegiao();
    preencherRodovias();
    preencherSREs();
    aplicarFiltros({ zoomAreaInfluencia: true });
  });
  document.getElementById('areaInfluenciaSelectLimpar').addEventListener('click', function() {
    areaInfluenciaSelecionada = false;
    document.getElementById('areaInfluenciaSelect').value = '';
    sincronizarFiltroAreaInfluencia();
    document.getElementById('areaInfluenciaSelect').dispatchEvent(new Event('change'));
  });
  ['manutencao', 'planejamento'].forEach(function(tipo) {
    document.getElementById(tipo === 'manutencao' ? 'toggleRegioesManutencao' : 'toggleRegioesPlanejamento').addEventListener('click', function() {
      regioesBaseAtivas[tipo] = !regioesBaseAtivas[tipo];
      aplicarFiltros({ preservarZoom: true });
    });
  });
}
