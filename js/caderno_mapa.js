// Pranchas A4 dos cadernos em PDF (jurisdicao_caderno.html e obras_caderno.html): o mesmo mapa nos dois.
// Satelite + mascara + municipios + SNV/SRE pela situacao, grade de coordenadas, escala, rosa dos ventos,
// escudos das rodovias, localidades, nomes de municipios e o localizador de Goias no canto.
// Cada caderno monta a sua folha (template no HTML) e chama CadernoMapa.montarMapa com o que destacar.

var CadernoMapa = (function() {
  const VERMELHO = '#ef2020', LARANJA = '#f5a300', VERDE = '#2fa31a', AMARELO = '#f2c500';

  // Camadas de base (os mesmos arquivos do mapa do SIPLAWEB).
  const ARQUIVOS_BASE = {
    mascara: 'data/mascara_brasil.geojson',
    municipios: 'data/municipios.geojson',
    sre: 'data/sre_base.geojson',
    snv: 'data/snv_goias.geojson',
    localidades: 'data/localidades.geojson'
  };
  const SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const fmtKm = n => n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Situacao -> camadas de linha (desenhadas em sequencia).
  function estiloRodovia(sit, federal) {
    const cor = federal ? VERDE : VERMELHO;
    switch (String(sit || '').toUpperCase()) {
      case 'DUP': return [{ color: cor, weight: 4.2 }, { color: '#fff', weight: 1.2 }];
      case 'EOD': return [{ color: cor, weight: 3.6 }, { color: '#fff', weight: 1.1, dashArray: '5,4' }];
      case 'EOP': return [{ color: cor, weight: 2, dashArray: '7,4' }];
      case 'IMP': return [{ color: LARANJA, weight: 2 }];
      case 'LEN': return [{ color: federal ? AMARELO : LARANJA, weight: 2 }];
      case 'PLA': return [{ color: '#000', weight: 1.2, dashArray: '2,3' }];
      default: return [{ color: cor, weight: 2 }];
    }
  }

  // ---------- Carga das camadas de base ----------
  async function carregarBase() {
    const j = url => fetch(url).then(r => r.json());
    const [mascara, municipios, sre, snv, localidades] = await Promise.all([
      j(ARQUIVOS_BASE.mascara), j(ARQUIVOS_BASE.municipios), j(ARQUIVOS_BASE.sre), j(ARQUIVOS_BASE.snv), j(ARQUIVOS_BASE.localidades)
    ]);
    const base = { mascara, municipios, sre, snv, localidades };
    prepararLocalizador(base);
    return base;
  }

  // ---------- Recorte das camadas de base por regiao ----------
  // Cada prancha recebe so o que esta perto do trecho; sem isso, 70+ mapas com as camadas
  // inteiras esgotam a memoria do navegador.
  function caixaFeicao(f) {
    if (f.__bb) return f.__bb;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (function percorrer(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
        if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      } else c.forEach(percorrer);
    })(f.geometry.coordinates);
    return (f.__bb = [x0, y0, x1, y1]);
  }

  function recortar(fc, b) {
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    return { type: 'FeatureCollection', features: fc.features.filter(function(f) {
      if (!f.geometry) return false;
      const bb = caixaFeicao(f);
      return bb[0] <= e && bb[2] >= w && bb[1] <= n && bb[3] >= s;
    }) };
  }

  // area = o que o mapa mostra (depois de enquadrado) e mais uma vista de cada lado, para quem afasta o zoom na prancha.
  // Recortar pelo desenho deixava sem malha e sem localidades as bordas da folha (obra pontual = retangulo de
  // tamanho zero; trecho leste-oeste = faixa fina).
  function recortarBase(base, vista) {
    const area = vista.pad(1);
    return {
      mascara: recortar(base.mascara, area), municipios: recortar(base.municipios, area),
      sre: recortar(base.sre, area), snv: recortar(base.snv, area), localidades: recortar(base.localidades, area)
    };
  }

  // ---------- Localizador (SVG unico, reaproveitado em todas as pranchas) ----------
  let localizadorBase = null;
  function prepararLocalizador(base) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    base.municipios.features.forEach(function(f) {
      const bb = caixaFeicao(f);
      x0 = Math.min(x0, bb[0]); y0 = Math.min(y0, bb[1]); x1 = Math.max(x1, bb[2]); y1 = Math.max(y1, bb[3]);
    });
    const cosLat = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    const escala = 1000 / ((x1 - x0) * cosLat);
    const proj = (lon, lat) => [(lon - x0) * cosLat * escala, (y1 - lat) * escala];
    const larg = (x1 - x0) * cosLat * escala, alt = (y1 - y0) * escala;
    const folga = 0.05 * larg;
    const caminho = function(fc) {
      const partes = [];
      fc.features.forEach(function(f) {
        const g = f.geometry;
        const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        polis.forEach(p => p.forEach(function(anel) {
          let d = '', ult = null;
          anel.forEach(function(c) {
            const p2 = proj(c[0], c[1]);
            if (ult && Math.abs(p2[0] - ult[0]) + Math.abs(p2[1] - ult[1]) < 3) return;
            d += (d ? 'L' : 'M') + p2[0].toFixed(0) + ' ' + p2[1].toFixed(0);
            ult = p2;
          });
          if (d) partes.push(d + 'Z');
        }));
      });
      return partes.join('');
    };
    const rotulos = [['TO', -11.6, -48.3], ['BA', -13.4, -45.0], ['MT', -14.3, -53.9], ['MG', -17.6, -45.6], ['MS', -19.4, -53.6], ['DF', -15.75, -47.4]]
      .map(e => { const p = proj(e[2], e[1]); return '<text x="' + p[0].toFixed(0) + '" y="' + p[1].toFixed(0) + '">' + e[0] + '</text>'; }).join('');
    localizadorBase = {
      proj: proj,
      vb: [-folga, -folga, larg + 2 * folga, alt + 2 * folga],
      corpo: '<path d="' + caminho(base.mascara) + '" fill="#c8c8c8" stroke="#fff" stroke-width="4"/>' +
        '<path d="' + caminho(base.municipios) + '" fill="#fff" stroke="#fff" stroke-width="4"/>' +
        '<g class="loc-rotulos">' + rotulos + '</g>'
    };
  }

  function montarLocalizador(el) {
    const L0 = localizadorBase;
    el.innerHTML = '<svg viewBox="' + L0.vb.join(' ') + '" preserveAspectRatio="xMidYMid meet">' + L0.corpo + '<rect class="loc-marca"/></svg>';
    const marca = el.querySelector('.loc-marca');
    return {
      marcar: function(b) {
        const ne = L0.proj(b.getEast(), b.getNorth()), sw = L0.proj(b.getWest(), b.getSouth());
        const min = L0.vb[2] * 0.06;
        const cx = (ne[0] + sw[0]) / 2, cy = (ne[1] + sw[1]) / 2;
        const w = Math.max(ne[0] - sw[0], min), h = Math.max(sw[1] - ne[1], min);
        marca.setAttribute('x', cx - w / 2); marca.setAttribute('y', cy - h / 2);
        marca.setAttribute('width', w); marca.setAttribute('height', h);
      }
    };
  }

  // ---------- Legenda ----------
  function amostraLinha(camadas, w, h) {
    w = w || 20; h = h || 7;
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + camadas.map(c =>
      '<line x1="1" y1="' + h / 2 + '" x2="' + (w - 1) + '" y2="' + h / 2 + '" stroke="' + c.color + '" stroke-width="' + c.weight + '"' +
      (c.dashArray ? ' stroke-dasharray="' + c.dashArray.replace(',', ' ') + '"' : '') + (c.cap ? ' stroke-linecap="round"' : '') + '/>').join('') + '</svg>';
  }

  // Amostra do destaque (trecho ou ponto) com as cores { contorno, miolo }.
  function amostraDestaque(e, ponto) {
    if (ponto) return '<svg width="26" height="12" viewBox="0 0 26 12"><circle cx="13" cy="6" r="5" fill="' + e.miolo + '" stroke="' + e.contorno + '" stroke-width="2.4"/>' +
      '<circle cx="13" cy="6" r="6.2" fill="none" stroke="#555" stroke-width="0.8"/></svg>';
    return amostraLinha([{ color: '#555', weight: 8.4, cap: 1 }, { color: e.contorno, weight: 7, cap: 1 }, { color: e.miolo, weight: 3.6, cap: 1 }], 26, 10);
  }

  const linhaLeg = (amostra, rotulo) => '<div class="leg-linha">' + amostra + '<span>' + rotulo + '</span></div>';

  // Parte comum da legenda: localidade, limite de municipio e as rodovias estaduais/federais.
  function legendaBase() {
    const est = ['DUP', 'PAV', 'EOD', 'EOP', 'IMP', 'LEN'].map(s => linhaLeg(amostraLinha(estiloRodovia(s, false), 16, 6), s)).join('');
    const fed = ['DUP', 'LEN', 'EOP', 'PAV', 'EOD'].map(s => linhaLeg(amostraLinha(estiloRodovia(s, true), 16, 6), s)).join('');
    return '<h3>LEGENDA</h3>' +
      linhaLeg('<svg width="12" height="10"><circle cx="6" cy="5" r="3.6" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>', 'LOCALIDADE') +
      linhaLeg('<svg width="12" height="10"><rect x="1" y="1.5" width="10" height="7" fill="#eee" stroke="#000" stroke-width="0.8" stroke-dasharray="2 1.5"/></svg>', 'LIMITE MUNICÍPIO') +
      '<div class="leg-colunas"><div><div class="cab">RODOVIA<br>ESTADUAL</div>' + est + '</div><div><div class="cab">RODOVIA<br>FEDERAL</div>' + fed + '</div></div>';
  }

  // ---------- Rosa dos ventos ----------
  function rosaDosVentos() {
    const ponta = (ang, comp, larg) => {
      const r = a => [50 + Math.sin(a) * comp, 50 - Math.cos(a) * comp];
      const lado = s => [50 + Math.sin(ang + s * Math.PI / 2) * larg, 50 - Math.cos(ang + s * Math.PI / 2) * larg];
      const p = r(ang), e = lado(-1), d = lado(1);
      return '<polygon points="50,50 ' + p + ' ' + e + '" fill="#000"/><polygon points="50,50 ' + p + ' ' + d + '" fill="#fff" stroke="#000" stroke-width="1.2"/>';
    };
    let s = '<svg viewBox="0 0 100 100">';
    [45, 135, 225, 315].forEach(a => { s += ponta(a * Math.PI / 180, 22, 5); });
    [0, 90, 180, 270].forEach(a => { s += ponta(a * Math.PI / 180, 36, 7); });
    s += '<circle cx="50" cy="50" r="4" fill="#fff" stroke="#000" stroke-width="1.2"/>';
    const txt = (x, y, t, tam) => '<text x="' + x + '" y="' + y + '" font-size="' + tam + '" font-weight="700" text-anchor="middle" dominant-baseline="middle" font-family="Arial" stroke="#fff" stroke-width="3" paint-order="stroke">' + t + '</text>';
    s += txt(50, 7, 'N', 12) + txt(50, 94, 'S', 12) + txt(93, 50, 'L', 12) + txt(7, 50, 'O', 12);
    s += txt(77, 22, 'NE', 7) + txt(23, 22, 'NO', 7) + txt(77, 79, 'SE', 7) + txt(23, 79, 'SO', 7);
    return s + '</svg>';
  }

  // ---------- Geometria auxiliar ----------
  function colide(caixas, c) {
    return caixas.some(b => c.x < b.x + b.w && c.x + c.w > b.x && c.y < b.y + b.h && c.y + c.h > b.y);
  }

  // Geometrias GeoJSON -> linhas (listas de LatLng) e pontos. Poligonos entram pelo contorno.
  function partesDe(geometrias) {
    const linhas = [], pontos = [];
    (function percorrer(g) {
      if (!g) return;
      const c = g.coordinates;
      switch (g.type) {
        case 'Point': pontos.push(L.latLng(c[1], c[0])); break;
        case 'MultiPoint': c.forEach(p => pontos.push(L.latLng(p[1], p[0]))); break;
        case 'LineString': linhas.push(L.GeoJSON.coordsToLatLngs(c, 0)); break;
        case 'MultiLineString': case 'Polygon': L.GeoJSON.coordsToLatLngs(c, 1).forEach(l => linhas.push(l)); break;
        case 'MultiPolygon': c.forEach(p => L.GeoJSON.coordsToLatLngs(p, 1).forEach(l => linhas.push(l))); break;
        case 'GeometryCollection': g.geometries.forEach(percorrer); break;
      }
    })(geometrias && geometrias.type ? geometrias : { type: 'GeometryCollection', geometries: geometrias || [] });
    return { linhas: linhas, pontos: pontos };
  }

  // ---------- Mapa da prancha ----------
  // destaque: { geometria (GeoJSON ou lista), estilo: { contorno, miolo }, zoomMax (16) }. Sem geometria: Goias inteiro.
  // Devolve { map, satelite, pronto }: a promessa resolve quando as imagens de satelite terminam de carregar
  // (ou depois de 30 s, para nao travar o caderno).
  function montarMapa(folha, base, destaque) {
    const q = sel => folha.querySelector(sel);
    q('.norte').innerHTML = rosaDosVentos();

    const partes = partesDe(destaque.geometria);
    const tudo = partes.linhas.flat().concat(partes.pontos);
    const temDesenho = tudo.length > 0;
    const limites = temDesenho ? L.latLngBounds(tudo) : L.geoJSON(base.municipios).getBounds();

    const map = L.map(q('.mapa-prancha'), {
      zoomControl: false, attributionControl: false, zoomSnap: 0, zoomDelta: 0.25, wheelPxPerZoomLevel: 120,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false
    });
    // Enquadra antes de desenhar: o recorte das camadas de base sai da area que o mapa mostra.
    if (temDesenho) map.fitBounds(limites, { paddingTopLeft: [50, 75], paddingBottomRight: [50, 40], maxZoom: destaque.zoomMax || 16 });
    else map.fitBounds(limites);
    const b = temDesenho ? recortarBase(base, map.getBounds()) : base;
    [['pMascara', 250], ['pMunicipios', 300], ['pGrade', 320], ['pSnv', 350], ['pSre', 360], ['pTrecho', 450], ['pRotulos', 620]]
      .forEach(p => { map.createPane(p[0]).style.zIndex = p[1]; });

    // Imagem de satelite com o dobro da densidade (tiles de 256 exibidos a 128 px) para impressao nitida.
    const satelite = L.tileLayer(SATELITE, { tileSize: 128, zoomOffset: 1, maxNativeZoom: 17, maxZoom: 20, crossOrigin: true });
    const pronto = new Promise(function(resolve) {
      const limite = setTimeout(resolve, 30000);
      satelite.once('load', () => { clearTimeout(limite); resolve(); });
    });
    satelite.addTo(map);

    L.geoJSON(b.mascara, { pane: 'pMascara', interactive: false, style: { stroke: false, fillColor: '#fff', fillOpacity: 0.45 } }).addTo(map);
    L.geoJSON(b.municipios, { pane: 'pMunicipios', interactive: false, style: { color: '#fff', weight: 2.2, opacity: 0.95, fill: false } }).addTo(map);
    L.geoJSON(b.municipios, { pane: 'pMunicipios', interactive: false, style: { color: '#222', weight: 1, dashArray: '3,3', fill: false } }).addTo(map);
    [[b.snv, 'SITUACAO', true, 'pSnv'], [b.sre, 'situacao', false, 'pSre']].forEach(function(c) {
      const grupos = {};
      c[0].features.forEach(f => { const s = String(f.properties[c[1]] || 'PAV').toUpperCase(); (grupos[s] = grupos[s] || []).push(f); });
      Object.keys(grupos).forEach(function(s) {
        estiloRodovia(s, c[2]).forEach(function(est) {
          L.geoJSON({ type: 'FeatureCollection', features: grupos[s] }, { pane: c[3], interactive: false, style: Object.assign({ opacity: 1, lineCap: 'butt' }, est) }).addTo(map);
        });
      });
    });

    if (temDesenho) {
      const e = destaque.estilo;
      if (partes.linhas.length) {
        [{ color: '#444', weight: 12.5, opacity: 0.5 }, { color: e.contorno, weight: 11 }, { color: e.miolo, weight: 5.5 }].forEach(function(s) {
          L.polyline(partes.linhas, Object.assign({ pane: 'pTrecho', interactive: false, lineCap: 'round', lineJoin: 'round', opacity: 1 }, s)).addTo(map);
        });
      }
      partes.pontos.forEach(function(p) {
        if (destaque.icone) {
          L.marker(p, { pane: 'pTrecho', interactive: false,
            icon: L.icon({ iconUrl: destaque.icone, iconSize: [30, 30], iconAnchor: [15, 15], className: 'icone-obra' }) }).addTo(map);
          return;
        }
        L.circleMarker(p, { pane: 'pTrecho', interactive: false, radius: 10, stroke: false, fillColor: '#444', fillOpacity: 0.5 }).addTo(map);
        L.circleMarker(p, { pane: 'pTrecho', interactive: false, radius: 7.5, color: e.contorno, weight: 4, opacity: 1, fillColor: e.miolo, fillOpacity: 1 }).addTo(map);
      });
    }

    const localizador = montarLocalizador(q('.mapa-loc'));
    const grade = L.layerGroup().addTo(map);
    const rotulos = L.layerGroup().addTo(map);

    function atualizar() {
      desenharGrade(map, grade, q('.graticula-rotulos'));
      desenharEscala(map, q('.escala'));
      desenharRotulos(map, rotulos, b, partes.pontos);
      localizador.marcar(map.getBounds());
    }
    map.on('moveend', atualizar);
    atualizar();
    return { map: map, satelite: satelite, pronto: pronto };
  }

  // Tabela do rodape com altura fixa (28 mm): se o texto (em geral o status) nao couber em 7,5 pt,
  // reduz a letra das celulas aos poucos, ate 5,5 pt, em vez de esticar o quadro.
  function caberTabela(tabela, folha) {
    const mm = folha.getBoundingClientRect().height / 210;
    if (!mm) return;
    const alvo = 28 * mm + 1;
    const celulas = tabela.querySelectorAll('tbody td');
    for (let pt = 7.5; tabela.offsetHeight > alvo && pt > 5.5; pt -= 0.25) {
      celulas.forEach(td => { td.style.fontSize = (pt - 0.25) + 'pt'; });
    }
  }

  // ---------- Grade de coordenadas ----------
  function desenharGrade(map, grupo, elRotulos) {
    grupo.clearLayers();
    elRotulos.innerHTML = '';
    const b = map.getBounds();
    const passos = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2];
    const span = b.getEast() - b.getWest();
    const passo = passos.find(p => span / p <= 7) || 2;
    const tam = map.getSize();
    const html = [];
    const fmt = (v, pos, neg) => Math.abs(v).toFixed(3) + '°' + (v < 0 ? neg : pos);

    for (let lon = Math.ceil(b.getWest() / passo) * passo; lon < b.getEast(); lon += passo) {
      L.polyline([[b.getSouth() - 1, lon], [b.getNorth() + 1, lon]], { pane: 'pGrade', color: '#fff', weight: 0.7, opacity: 0.6, interactive: false }).addTo(grupo);
      const x = map.latLngToContainerPoint([b.getCenter().lat, lon]).x;
      if (x < 20 || x > tam.x - 20) continue;
      const t = fmt(lon, 'E', 'W');
      html.push('<span class="topo" style="left:' + x + 'px">' + t + '</span><span class="base" style="left:' + x + 'px">' + t + '</span>');
    }
    for (let lat = Math.ceil(b.getSouth() / passo) * passo; lat < b.getNorth(); lat += passo) {
      L.polyline([[lat, b.getWest() - 1], [lat, b.getEast() + 1]], { pane: 'pGrade', color: '#fff', weight: 0.7, opacity: 0.6, interactive: false }).addTo(grupo);
      const y = map.latLngToContainerPoint([lat, b.getCenter().lng]).y;
      if (y < 20 || y > tam.y - 20) continue;
      const t = fmt(lat, 'N', 'S');
      html.push('<span class="esq" style="top:' + y + 'px">' + t + '</span><span class="dir" style="top:' + y + 'px">' + t + '</span>');
    }
    elRotulos.innerHTML = html.join('');
  }

  // ---------- Escala grafica ----------
  function desenharEscala(map, el) {
    const tam = map.getSize();
    const y = tam.y / 2;
    const mPorPx = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y])) / 100;
    const alvoPx = tam.x * 0.2;
    const opcoes = [0.2, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
    let km = opcoes[0];
    opcoes.forEach(o => { if (o * 1000 / mPorPx <= alvoPx) km = o; });
    const px = km * 1000 / mPorPx;
    const num = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    el.innerHTML = '<div class="rotulos" style="width:' + px + 'px">' +
      '<span style="left:0">0</span><span style="left:50%">' + num(km / 2) + '</span><span style="left:100%">' + num(km) + '&nbsp;km</span></div>' +
      '<div class="barra" style="width:' + px + 'px"><i></i><i></i><i></i><i></i></div>';
  }

  // ---------- Rotulos: escudos, localidades e municipios ----------
  function desenharRotulos(map, grupo, base, pontosObra) {
    grupo.clearLayers();
    const tam = map.getSize();
    const dentro = p => p.x > 8 && p.y > 8 && p.x < tam.x - 8 && p.y < tam.y - 8;
    // Areas reservadas: titulo, rosa dos ventos, escala e o icone (ou bolinha) de cada ponto da obra.
    const caixas = [
      { x: 0, y: 0, w: tam.x, h: 62 },
      { x: 0, y: tam.y - 45, w: tam.x * 0.25, h: 45 }
    ].concat((pontosObra || []).map(function(ll) {
      const p = map.latLngToContainerPoint(ll);
      return { x: p.x - 17, y: p.y - 17, w: 34, h: 34 };
    }));
    const b = map.getBounds().pad(0.05);

    // Escudos das rodovias (um por trecho visivel, sem repetir a mesma rodovia muito perto).
    const porRodovia = {};
    [[base.sre, 'rodovia', false], [base.snv, 'RODOVIA', true]].forEach(function(c) {
      c[0].features.forEach(function(f) {
        const nome = String(f.properties[c[1]] || '');
        const m = nome.match(/^(GO|BR)-(\d{3})/);
        if (!m) return;
        const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        coords.forEach(function(linha) {
          const pts = linha.map(ll => map.latLngToContainerPoint([ll[1], ll[0]]));
          // maior sequencia continua dentro da area do mapa
          let atual = [], melhor = [];
          pts.forEach(p => { if (dentro(p)) atual.push(p); else { if (atual.length > melhor.length) melhor = atual; atual = []; } });
          if (atual.length > melhor.length) melhor = atual;
          if (melhor.length < 2) return;
          const acum = [0];
          for (let i = 1; i < melhor.length; i++) acum.push(acum[i - 1] + melhor[i].distanceTo(melhor[i - 1]));
          const total = acum[acum.length - 1];
          if (total < 70) return;
          const meio = total / 2;
          let i = acum.findIndex(a => a >= meio);
          const p = melhor[Math.max(0, i)];
          (porRodovia[nome] = porRodovia[nome] || []).push({ p: p, num: m[2], fed: c[2], total: total });
        });
      });
    });
    Object.keys(porRodovia).forEach(function(nome) {
      const lista = porRodovia[nome].sort((a, z) => z.total - a.total);
      const postos = [];
      lista.forEach(function(item) {
        if (postos.some(p => p.distanceTo(item.p) < 160)) return;
        const caixa = { x: item.p.x - 10, y: item.p.y - 10, w: 20, h: 20 };
        if (colide(caixas, caixa)) return;
        caixas.push(caixa);
        postos.push(item.p);
        const forma = item.fed
          ? '<path d="M2.5 2.5h15v7.5c0 4.5-3.5 7-7.5 8.5-4-1.5-7.5-4-7.5-8.5z" fill="#fff" stroke="#000" stroke-width="1.3"/>'
          : '<circle cx="10" cy="10" r="8.3" fill="#fff" stroke="#000" stroke-width="1.3"/>';
        const svg = '<svg class="escudo" viewBox="0 0 20 20" width="18" height="18">' + forma +
          '<text x="10" y="' + (item.fed ? 10 : 10.6) + '" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-weight="700" font-size="' +
          (item.fed ? 6.6 : 7) + '" fill="#000">' + item.num + '</text></svg>';
        L.marker(map.containerPointToLatLng(item.p), {
          pane: 'pRotulos', interactive: false,
          icon: L.divIcon({ className: '', html: svg, iconSize: [18, 18], iconAnchor: [9, 9] })
        }).addTo(grupo);
      });
    });

    // Localidades (maiores primeiro).
    base.localidades.features
      .filter(f => b.contains([f.geometry.coordinates[0][1], f.geometry.coordinates[0][0]]))
      .sort((a, z) => (z.properties.POPULACAO || 0) - (a.properties.POPULACAO || 0))
      .forEach(function(f) {
        const ll = [f.geometry.coordinates[0][1], f.geometry.coordinates[0][0]];
        const p = map.latLngToContainerPoint(ll);
        if (!dentro(p)) return;
        const ponto = { x: p.x - 4, y: p.y - 4, w: 8, h: 8 };
        if (colide(caixas, ponto)) return;
        caixas.push(ponto);
        L.circleMarker(ll, { pane: 'pRotulos', radius: 3.6, color: '#000', weight: 1.3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(grupo);
        const nome = String(f.properties.NOME_ACEN || '').toUpperCase();
        const w = nome.length * 5 + 4;
        // tenta a direita do ponto; se nao couber, a esquerda
        const opcoes = [{ x: p.x + 5, ancora: -6, alinhar: 'left' }, { x: p.x - 5 - w, ancora: w + 6, alinhar: 'right' }];
        const lado = opcoes.find(o => o.x > 4 && o.x + w < tam.x - 4 && !colide(caixas, { x: o.x, y: p.y - 6, w: w, h: 11 }));
        if (!lado) return;
        caixas.push({ x: lado.x, y: p.y - 6, w: w, h: 11 });
        L.marker(ll, { pane: 'pRotulos', interactive: false,
          icon: L.divIcon({ className: '', html: '<div class="rot-localidade" style="text-align:' + lado.alinhar + '">' + esc(nome) + '</div>', iconSize: [w, 11], iconAnchor: [lado.ancora, 6] }) }).addTo(grupo);
      });

    // Nomes de municipios (italico), no meio da parte do municipio visivel no mapa.
    const vista = map.getBounds();
    const amostras = [];
    for (let gx = 1; gx < 14; gx++) for (let gy = 1; gy < 10; gy++) {
      const p = L.point(tam.x * gx / 14, tam.y * gy / 10);
      amostras.push({ p: p, ll: map.containerPointToLatLng(p) });
    }
    base.municipios.features.forEach(function(f) {
      const c = caixaFeicao(f);
      const bb = L.latLngBounds([c[1], c[0]], [c[3], c[2]]);
      if (!vista.intersects(bb)) return;
      const dentroMun = amostras.filter(a => bb.contains(a.ll) && pontoNoPoligono(a.ll.lng, a.ll.lat, f.geometry));
      if (dentroMun.length < 2) return;
      const media = dentroMun.reduce((s, a) => s.add(a.p), L.point(0, 0)).divideBy(dentroMun.length);
      const nome = f.properties.NM_MUN || '';
      const w = nome.length * 5.2;
      const lugar = dentroMun.map(a => a.p).sort((a, z) => a.distanceTo(media) - z.distanceTo(media))
        .find(p => !colide(caixas, { x: p.x - w / 2, y: p.y - 6, w: w, h: 12 }));
      if (!lugar) return;
      caixas.push({ x: lugar.x - w / 2, y: lugar.y - 6, w: w, h: 12 });
      L.marker(map.containerPointToLatLng(lugar), { pane: 'pRotulos', interactive: false,
        icon: L.divIcon({ className: '', html: '<div class="rot-municipio">' + esc(nome) + '</div>', iconSize: [w, 12], iconAnchor: [w / 2, 6] }) }).addTo(grupo);
    });
  }

  function pontoNoPoligono(x, y, geom) {
    const polis = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    let dentro = false;
    polis.forEach(function(poli) {
      poli.forEach(function(anel) {
        for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
          const xi = anel[i][0], yi = anel[i][1], xj = anel[j][0], yj = anel[j][1];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
        }
      });
    });
    return dentro;
  }

  return {
    esc: esc, fmtKm: fmtKm, carregarBase: carregarBase, montarMapa: montarMapa, caberTabela: caberTabela,
    legendaBase: legendaBase, linhaLeg: linhaLeg, amostraDestaque: amostraDestaque
  };
})();
