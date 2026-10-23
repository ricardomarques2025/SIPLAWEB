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

  const VERMELHO = '#ef2020', LARANJA = '#f5a300', VERDE = '#2fa31a', AMARELO = '#f2c500';
  const PRANCHAS_SIMULTANEAS = 3;

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

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const fmtKm = n => n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtKmTabela = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

  function status(txt, ok) {
    $('status').textContent = txt;
    $('status').classList.toggle('ok', !!ok);
    $('btnImprimir').disabled = !ok;
  }

  // Ordem do caderno: grupo, depois municipios em ordem alfabetica (sem diferenciar acentos).
  function ordenar(lista) {
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base', ignorePunctuation: true });
    return lista.slice().sort((a, z) => (ORDEM_TIPOS.indexOf(a.tipo) - ORDEM_TIPOS.indexOf(z.tipo)) ||
      cmp(a.municipios, z.municipios) || cmp(a.rodovia, z.rodovia) || cmp(a.trecho, z.trecho) || a.id - z.id);
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

  function recortarBase(base, limites) {
    const area = limites.pad(1.5);
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

  // ---------- Amostras da legenda ----------
  function amostraLinha(camadas, w, h) {
    w = w || 20; h = h || 7;
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + camadas.map(c =>
      '<line x1="1" y1="' + h / 2 + '" x2="' + (w - 1) + '" y2="' + h / 2 + '" stroke="' + c.color + '" stroke-width="' + c.weight + '"' +
      (c.dashArray ? ' stroke-dasharray="' + c.dashArray.replace(',', ' ') + '"' : '') + (c.cap ? ' stroke-linecap="round"' : '') + '/>').join('') + '</svg>';
  }

  function legendaHTML(r) {
    const linhaLeg = (amostra, rotulo) => '<div class="leg-linha">' + amostra + '<span>' + rotulo + '</span></div>';
    const est = ['DUP', 'PAV', 'EOD', 'EOP', 'IMP', 'LEN'].map(s => linhaLeg(amostraLinha(estiloRodovia(s, false), 16, 6), s)).join('');
    const fed = ['DUP', 'LEN', 'EOP', 'PAV', 'EOD'].map(s => linhaLeg(amostraLinha(estiloRodovia(s, true), 16, 6), s)).join('');
    const tipos = ORDEM_TIPOS.map(function(t) {
      const e = ESTILO_TIPO_CADERNO[t];
      return linhaLeg(amostraLinha([{ color: '#555', weight: 8.4, cap: 1 }, { color: e.contorno, weight: 7, cap: 1 }, { color: e.miolo, weight: 3.6, cap: 1 }], 26, 10), t);
    }).join('');
    const processos = String(r.processos_sei || r.processo || '').split(/\s+/).filter(Boolean);
    return '<h3>LEGENDA</h3>' +
      linhaLeg('<svg width="12" height="10"><circle cx="6" cy="5" r="3.6" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>', 'LOCALIDADE') +
      linhaLeg('<svg width="12" height="10"><rect x="1" y="1.5" width="10" height="7" fill="#eee" stroke="#000" stroke-width="0.8" stroke-dasharray="2 1.5"/></svg>', 'LIMITE MUNICÍPIO') +
      '<div class="leg-colunas"><div><div class="cab">RODOVIA<br>ESTADUAL</div>' + est + '</div><div><div class="cab">RODOVIA<br>FEDERAL</div>' + fed + '</div></div>' +
      '<div class="leg-tipo"><div class="cab">TIPO</div>' + tipos + '</div>' +
      '<div class="leg-processos"><div class="cab">PROCESSOS</div><div class="lista">' + processos.map(esc).join('<br>') + '</div></div>';
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

  function novaFolha(classe) {
    const f = document.createElement('section');
    f.className = 'folha ' + classe;
    $('paginas').appendChild(f);
    return f;
  }

  // ---------- Prancha ----------
  // Cria a folha (ou usa a recebida) e devolve uma promessa que resolve quando as imagens
  // de satelite terminam de carregar (ou depois de 30 s, para nao travar o caderno).
  function montarPrancha(r, base, numero, folhaExistente) {
    const folha = $('tplPrancha').content.firstElementChild.cloneNode(true);
    if (folhaExistente) folhaExistente.replaceWith(folha); else $('paginas').appendChild(folha);
    const q = sel => folha.querySelector(sel);

    q('.titulo-mapa').textContent = [r.rodovia, r.trecho].filter(Boolean).join(', ');
    q('.norte').innerHTML = rosaDosVentos();
    q('.legenda').innerHTML = legendaHTML(r);
    q('.tabela-rodape tbody tr').innerHTML = [r.id, r.municipios, r.rodovia, r.trecho, fmtKm(r.extensao_km), r.status_detalhe]
      .map(v => '<td>' + esc(v) + '</td>').join('');
    caberTabela(q('.tabela-rodape'), folha);
    q('.numero-pagina').textContent = numero == null ? '' : numero;

    const geom = Store.geometria(r.id);
    const latlngs = geom ? L.GeoJSON.coordsToLatLngs(geom.coordinates, geom.type === 'MultiLineString' ? 1 : 0) : null;
    const limites = latlngs ? L.latLngBounds(latlngs.flat()) : L.geoJSON(base.municipios).getBounds();
    const b = geom ? recortarBase(base, limites) : base;

    const map = L.map(q('.mapa-prancha'), {
      zoomControl: false, attributionControl: false, zoomSnap: 0, zoomDelta: 0.25, wheelPxPerZoomLevel: 120,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false
    });
    [['pMascara', 250], ['pMunicipios', 300], ['pGrade', 320], ['pSnv', 350], ['pSre', 360], ['pTrecho', 450], ['pRotulos', 620]]
      .forEach(p => { map.createPane(p[0]).style.zIndex = p[1]; });

    // Imagem de satelite com o dobro da densidade (tiles de 256 exibidos a 128 px) para impressao nitida.
    const satelite = L.tileLayer(MAPAS_BASE['Satélite'].url, { tileSize: 128, zoomOffset: 1, maxNativeZoom: 17, maxZoom: 20, crossOrigin: true });
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

    if (geom) {
      const e = ESTILO_TIPO_CADERNO[r.tipo] || ESTILO_TIPO_CADERNO['Estadualização'];
      [{ color: '#444', weight: 12.5, opacity: 0.5 }, { color: e.contorno, weight: 11 }, { color: e.miolo, weight: 5.5 }].forEach(function(s) {
        L.polyline(latlngs, Object.assign({ pane: 'pTrecho', interactive: false, lineCap: 'round', lineJoin: 'round', opacity: 1 }, s)).addTo(map);
      });
      map.fitBounds(limites, { paddingTopLeft: [50, 75], paddingBottomRight: [50, 40], maxZoom: 16 });
    } else {
      map.fitBounds(limites);
    }

    const localizador = montarLocalizador(q('.mapa-loc'));
    const grade = L.layerGroup().addTo(map);
    const rotulos = L.layerGroup().addTo(map);

    function atualizar() {
      desenharGrade(map, grade, q('.graticula-rotulos'));
      desenharEscala(map, q('.escala'));
      desenharRotulos(map, rotulos, b);
      localizador.marcar(map.getBounds());
    }
    map.on('moveend', atualizar);
    atualizar();
    return { folha: folha, map: map, satelite: satelite, pronto: pronto };
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
  function desenharRotulos(map, grupo, base) {
    grupo.clearLayers();
    const tam = map.getSize();
    const dentro = p => p.x > 8 && p.y > 8 && p.x < tam.x - 8 && p.y < tam.y - 8;
    // Areas reservadas: titulo, rosa dos ventos e escala.
    const caixas = [
      { x: 0, y: 0, w: tam.x, h: 62 },
      { x: 0, y: tam.y - 45, w: tam.x * 0.25, h: 45 }
    ];
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
      g.itens.forEach(it => linhas.push({ id: it.r.id, nome: it.r.municipios, pagina: it.pagina }));
    });
    return linhas;
  }

  function paginasIndice(nLinhas) { return Math.max(1, Math.ceil(nLinhas / (LINHAS_POR_COLUNA * 2))); }

  function preencherIndice(folhas, linhas) {
    folhas.forEach(function(f, p) {
      const colunas = [0, 1].map(function(c) {
        const ini = (p * 2 + c) * LINHAS_POR_COLUNA;
        const parte = linhas.slice(ini, ini + LINHAS_POR_COLUNA);
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
    ['ID', 'id'], ['TIPO', 'tipo'], ['Nº PROCESSO', 'processo'], ['MUNICÍPIOS', 'municipios'], ['RODOVIA', 'rodovia'],
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
    const v = r[col[1]];
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
          vaga.innerHTML = '<div class="pendente-txt">Prancha #' + it.r.id + ' · ' + esc(it.r.municipios) + '</div>';
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
    const j = url => fetch(url).then(r => r.json());
    const [mascara, municipios, sre, snv, localidades] = await Promise.all([
      j(ARQUIVOS.base.mascara), j(ARQUIVOS.base.municipios), j(ARQUIVOS.base.sre), j(ARQUIVOS.base.snv), j(ARQUIVOS.base.localidades)
    ]);
    const base = { mascara, municipios, sre, snv, localidades };
    prepararLocalizador(base);

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
    const id = Number(params.get('id')) || lista[0].id;
    $('selRegistro').innerHTML = lista.map(r => '<option value="' + r.id + '"' + (r.id === id ? ' selected' : '') + '>#' + r.id + ' · ' +
      esc(r.tipo) + ' · ' + esc(r.municipios) + (Store.geometria(r.id) ? '' : ' (sem traçado)') + '</option>').join('');
    $('selRegistro').addEventListener('change', function() {
      params.set('id', this.value);
      location.search = params.toString();
    });

    const r = Store.obter(id);
    if (!r) { status('Registro não encontrado', false); return; }
    Store.registrarEvento('prancha', 'abriu a prancha #' + id);
    document.title = 'Prancha ' + r.id + ' · ' + (r.municipios || '');
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
