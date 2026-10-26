// Obras do SIPLAWEB lidas do banco (schema siplaweb), depois do login.
// Entrega os registros no mesmo formato dos antigos data/DADOS.json e data/OBRAS_LINKS.json,
// para o restante do mapa continuar igual:
//   IDCOD  = codigo permanente da obra (OB26-00001)   IDGRUPO = codigo do grupo (GR26-0001)
//   links  = vinculos da obra com as camadas de base ({ GEOCOD, BASE, IDCOD })
//   Obra em linha com traçado desenhado (geom, ex.: importação DOR 2027, obra que cobre só parte de um segmento SRE):
//   o mapa desenha a linha própria (BASE "desenho", índice em desenhos()); os vínculos ficam só como referência.

var DadosBanco = (function() {
  var COLUNAS = [
    'codigo', 'idcod_legado', 'origem', 'tipo', 'natureza', 'ref', 'proposta', 'sre', 'localidade', 'municipio',
    'populacao', 'rodovia', 'descricao', 'intervencao', 'etapa', 'status', 'modalidade', 'sei', 'sei_obra_contrato',
    'contrato', 'empresa', 'ext_contrato_km', 'conclusao', 'area_contratada_m2', 'area_executada_m2', 'horas_pagas',
    'lote', 'fonte', 'fase', 'data_referencia', 'vinculos', 'geom', 'grupo:grupos(codigo)'
  ].join(',');
  var POR_PAGINA = 1000;   // limite de linhas por consulta da API
  var carga = null;
  // Linha do tempo (js/linha_tempo.js): { codigo: [etapa, status] } da data escolhida; null = situação atual.
  // Com visão, só aparecem as obras que já existiam e com a etapa/status daquela data.
  var visao = null;

  function aplicarVisao(c) {
    if (!visao) return c;
    var registros = c.registros.filter(function(r) { return visao[r.IDCOD]; }).map(function(r) {
      return Object.assign({}, r, { ETAPA: visao[r.IDCOD][0], STATUS: visao[r.IDCOD][1] });
    });
    return { registros: registros, links: c.links.filter(function(l) { return visao[l.IDCOD]; }) };
  }

  function buscarObras() {
    var sb = Acesso.cliente;
    var linhas = [];
    function pagina(inicio) {
      return sb.from('obras').select(COLUNAS).is('excluido_em', null).order('codigo')
        .range(inicio, inicio + POR_PAGINA - 1)
        .then(function(res) {
          if (res.error) throw new Error('Falha ao ler obras do banco: ' + res.error.message);
          linhas = linhas.concat(res.data);
          return res.data.length === POR_PAGINA ? pagina(inicio + POR_PAGINA) : linhas;
        });
    }
    return pagina(0);
  }

  // Ponto desenhado -> LATITUDE/LONGITUDE; pontos de localidade e unidades de saude continuam
  // posicionados pelo nome da localidade, como antes.
  function tipoLegado(o) {
    if (o.tipo !== 'Ponto') return 'Link';
    if (pontoDaBase(o) && !(o.geom && o.geom.type === 'Point')) return 'Ponto';
    if (o.origem === 'HOSPITAL') return 'Link';
    if ((o.vinculos || []).some(function(v) { return v.indexOf('aero:') === 0; })) return 'Link';
    return 'Ponto';
  }

  // Obra em ponto ligada a um ponto genérico (geo_pt_base, editável pelo site): fica na posição dele.
  var pontosBase = {};
  function buscarPontosBase() {
    return Acesso.cliente.rpc('camada_geojson', { p_camada: 'geo_pt_base' }).then(function(res) {
      pontosBase = {};
      if (res.error) { console.warn('geo_pt_base indisponível:', res.error.message); return; }
      (res.data.features || []).forEach(function(f) { pontosBase[f.properties.GEOCOD] = f.geometry.coordinates; });
    });
  }
  function pontoDaBase(o) {
    var v = (o.vinculos || []).find(function(x) { return x.indexOf('geo_pt_base:') === 0; });
    return v ? pontosBase[v.slice(12)] || null : null;
  }

  function registroLegado(o) {
    var ponto = o.geom && o.geom.type === 'Point' ? o.geom.coordinates : pontoDaBase(o);
    return {
      IDCOD: o.codigo,
      IDCOD_LEGADO: o.idcod_legado,
      IDGRUPO: o.grupo ? o.grupo.codigo : null,
      UNIDADE: o.origem,
      TIPO: tipoLegado(o),
      NATUREZA: o.natureza,
      LATITUDE: ponto ? ponto[1] : null,
      LONGITUDE: ponto ? ponto[0] : null,
      REF: o.ref,
      PROPOSTA: o.proposta,
      SRE: o.sre,
      LOCALIDADE: o.localidade,
      POPULACAO_2026: o.populacao,
      MUNICIPIO: o.municipio || '',
      INTERVENCAO: o.intervencao,
      RODOVIA: o.rodovia || '',
      DESCRICAO: o.descricao,
      SEI: o.sei,
      SEI_OBRA_CONTRATO: o.sei_obra_contrato,
      CONTRATO: o.contrato,
      EXT_CONTRATO_KM: o.ext_contrato_km,
      ETAPA: o.etapa,
      STATUS: o.status,
      MODALIDADE: o.modalidade,
      FONTE: o.fonte,
      FASE: o.fase,
      EMPRESA: o.empresa,
      CONCLUSAO: o.conclusao,
      AREA_CONTRATADA_M2: o.area_contratada_m2,
      AREA_EXECUTADA_M2: o.area_executada_m2,
      HORAS_PAGAS: o.horas_pagas,
      LOTE: o.lote,
      ATUALIZACAO: o.data_referencia ? o.data_referencia + ' 00:00:00' : null
    };
  }

  function temDesenho(o) { return o.tipo === 'Linha' && o.geom && /LineString/.test(o.geom.type); }

  function linksLegado(obras) {
    var links = [];
    obras.forEach(function(o) {
      if (temDesenho(o)) { links.push({ BASE: 'desenho', GEOCOD: o.codigo, IDCOD: o.codigo }); return; }
      (o.vinculos || []).forEach(function(v) {
        var p = v.indexOf(':');
        links.push({ BASE: v.slice(0, p), GEOCOD: v.slice(p + 1), IDCOD: o.codigo });
      });
    });
    return links;
  }

  function carregar() {
    if (!carga) {
      carga = Acesso.pronto.then(function() {
        return Promise.all([buscarObras(), buscarPontosBase()]).then(function(r) { return r[0]; });
      }).then(function(obras) {
        console.log('Obras carregadas do banco:', obras.length);
        var desenhos = {};
        obras.filter(temDesenho).forEach(function(o) {
          desenhos[o.codigo] = { type: 'Feature', geometry: o.geom,
            properties: { GEOCOD: o.codigo, sre: o.sre || '', rodovia: o.rodovia || '', trecho: o.descricao || '', ext: o.ext_contrato_km } };
        });
        return { registros: obras.map(registroLegado), links: linksLegado(obras), desenhos: desenhos };
      });
    }
    return carga;
  }

  return {
    registros: function() { return carregar().then(function(c) { return aplicarVisao(c).registros; }); },
    links: function() { return carregar().then(function(c) { return aplicarVisao(c).links; }); },
    desenhos: function() { return carregar().then(function(c) { return c.desenhos; }); },
    definirVisao: function(v) { visao = v || null; },
    visao: function() { return visao; },
    // Descarta a copia em memoria; a proxima leitura busca de novo no banco (apos gravacoes).
    recarregar: function() { carga = null; return carregar(); }
  };
})();
