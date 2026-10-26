// Tabela de obras (siplaweb.obras): colunas e regras de validacao do lado do site.
// O banco valida de novo (js nao e a unica barreira). Para mudar rotulos, larguras ou a ordem, comece aqui.
//
// tipo: texto | numero | lista | longo | data | sei
// comum: aparece em toda origem; as demais colunas aparecem so se a origem tem algum valor nelas
//        (o usuario pode ligar/desligar qualquer coluna em "Colunas").
// lista: os valores vem de siplaweb.listas (campo etapa | status | intervencao | modalidade | fonte | fase).

var CAMPOS_OBRA = [
  { campo: 'codigo', titulo: 'Código', tipo: 'texto', largura: 112, fixa: true, somenteLeitura: true, comum: true, grupo: 'Identificação' },
  { campo: 'grupo_codigo', titulo: 'Grupo', tipo: 'texto', largura: 96, somenteLeitura: true, grupo: 'Identificação' },
  { campo: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 74, somenteLeitura: true, comum: true, grupo: 'Identificação' },
  { campo: 'descricao', titulo: 'Descrição', tipo: 'longo', largura: 320, comum: true, grupo: 'Identificação' },
  { campo: 'intervencao', titulo: 'Intervenção', tipo: 'lista', largura: 150, comum: true, grupo: 'Identificação' },
  { campo: 'ref', titulo: 'Nº na origem', tipo: 'texto', largura: 96, grupo: 'Identificação' },
  { campo: 'proposta', titulo: 'Proposta', tipo: 'texto', largura: 90, grupo: 'Identificação' },
  { campo: 'fase', titulo: 'Fase', tipo: 'lista', largura: 140, grupo: 'Situação' },
  { campo: 'etapa', titulo: 'Etapa', tipo: 'lista', largura: 120, comum: true, grupo: 'Situação' },
  { campo: 'status', titulo: 'Status', tipo: 'lista', largura: 170, comum: true, grupo: 'Situação' },
  { campo: 'data_referencia', titulo: 'Data de referência', tipo: 'data', largura: 130, comum: true, grupo: 'Situação' },
  { campo: 'conclusao', titulo: 'Conclusão prevista', tipo: 'texto', largura: 120, grupo: 'Situação' },
  { campo: 'rodovia', titulo: 'Rodovia', tipo: 'texto', largura: 110, grupo: 'Localização' },
  { campo: 'sre', titulo: 'SRE', tipo: 'texto', largura: 110, grupo: 'Localização' },
  { campo: 'municipio', titulo: 'Município', tipo: 'texto', largura: 150, grupo: 'Localização' },
  { campo: 'localidade', titulo: 'Localidade', tipo: 'texto', largura: 150, grupo: 'Localização' },
  { campo: 'populacao', titulo: 'População', tipo: 'numero', largura: 100, grupo: 'Localização' },
  { campo: 'sei', titulo: 'SEI', tipo: 'sei', largura: 150, comum: true, grupo: 'Contratação' },
  { campo: 'sei_obra_contrato', titulo: 'SEI contratação', tipo: 'texto', largura: 150, grupo: 'Contratação' },
  { campo: 'contrato', titulo: 'Contrato', tipo: 'texto', largura: 110, grupo: 'Contratação' },
  { campo: 'empresa', titulo: 'Empresa', tipo: 'texto', largura: 200, grupo: 'Contratação' },
  { campo: 'modalidade', titulo: 'Modalidade', tipo: 'lista', largura: 160, grupo: 'Contratação' },
  { campo: 'fonte', titulo: 'Fonte do recurso', tipo: 'lista', largura: 150, grupo: 'Contratação' },
  { campo: 'ext_contrato_km', titulo: 'Ext. contrato (km)', tipo: 'numero', largura: 120, grupo: 'Contratação' },
  { campo: 'lote', titulo: 'Lote', tipo: 'texto', largura: 90, grupo: 'Contratação' },
  { campo: 'area_contratada_m2', titulo: 'Área contratada (m²)', tipo: 'numero', largura: 140, grupo: 'Execução' },
  { campo: 'area_executada_m2', titulo: 'Área executada (m²)', tipo: 'numero', largura: 140, grupo: 'Execução' },
  { campo: 'horas_pagas', titulo: 'Horas pagas', tipo: 'numero', largura: 110, grupo: 'Execução' },
  { campo: 'observacoes', titulo: 'Observações', tipo: 'longo', largura: 260, grupo: 'Execução' }
];

var CORES_ETAPA_OBRA = {
  'Planejamento': '#c98a0c', 'Projeto': '#2b7bd6', 'Licitação': '#ea580c', 'Obra': '#1e9538', 'Manutenção': '#7c3aed', 'Integrada': '#0891b2'
};

// Regras checadas antes de gravar (as mesmas do gatilho siplaweb.validar_obra no banco).
// Devolve a mensagem de erro ou '' quando o valor e aceito.
function validarCampoObra(campo, valor, listas) {
  var c = CAMPOS_OBRA.find(function(x) { return x.campo === campo; });
  if (!c || valor === null || valor === undefined || valor === '') return '';
  if (c.tipo === 'sei' && !/^\d{15}$/.test(String(valor).replace(/\D/g, ''))) return 'SEI deve ter 15 dígitos';
  if (c.tipo === 'numero' && (!isFinite(Number(valor)) || Number(valor) < 0)) return 'Número inválido (não pode ser negativo)';
  if (c.tipo === 'data') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) return 'Data inválida';
    var hoje = new Date(); hoje.setMinutes(hoje.getMinutes() - hoje.getTimezoneOffset());
    if (String(valor) > hoje.toISOString().slice(0, 10)) return 'Data no futuro';
  }
  if (c.tipo === 'lista' && listas && listas[campo] && listas[campo].indexOf(valor) === -1) return 'Valor fora da lista de ' + c.titulo.toLowerCase();
  return '';
}

// Traçado: camadas de base que cada tipo de obra pode usar (as mesmas de siplaweb.validar_obra) e como cada
// feição aparece na lista de escolha. As bases em si são editadas fora do site (arquivos data/*.geojson).
// grupo: filtro principal da lista (rodovia, município...); ordem: sequência dentro do grupo (intervalo com Shift).
function kmObra(v) { return v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
var BASES_TRACADO = {
  sre_base: {
    nome: 'Malha SRE (rodovias estaduais)', rotuloGrupo: 'Rodovia', item: 'trecho',
    grupo: function(p) { return p.rodovia; }, ordem: function(p) { return Number(p.km_ini) || 0; },
    rotulo: function(p) { return p.sre || p.GEOCOD; },
    detalhe: function(p) { return p.rodovia + ' · km ' + kmObra(p.km_ini) + '–' + kmObra(p.km_fim) + ' · ' + (p.trecho || ''); },
    km: function(p) { return Number(p.ext) || 0; }
  },
  extra_base: {
    nome: 'Trechos extras (vicinais e urbanos)', rotuloGrupo: 'Rodovia', item: 'trecho',
    grupo: function(p) { return p.rodovia; }, ordem: function(p) { return p.sre || p.GEOCOD; },
    rotulo: function(p) { return p.sre || p.GEOCOD; }, detalhe: function(p) { return p.trecho || ''; },
    km: function(p) { return Number(p.EXT_KM) || 0; }
  },
  ferrovias: {
    nome: 'Ferrovias', rotuloGrupo: 'Ferrovia', item: 'segmento',
    grupo: function(p) { return [p.sigla, p.label].filter(Boolean).join(' · '); }, ordem: function(p) { return Number(p.id) || 0; },
    rotulo: function(p) { return p.segmento || p.GEOCOD; },
    detalhe: function(p) { return (p.nome || '') + (p.municipio ? ' · ' + p.municipio : ''); },
    km: function(p) { return Number(p.extensao) || 0; }
  },
  aero: {
    nome: 'Aeródromos', rotuloGrupo: 'Município', item: 'aeródromo',
    grupo: function(p) { return p.MUNICIPIO; }, ordem: function(p) { return p.NOME || ''; },
    rotulo: function(p) { return p.COD || p.GEOCOD; }, detalhe: function(p) { return (p.NOME || '') + ' · ' + (p.MUNICIPIO || ''); }
  },
  localidades: {
    nome: 'Localidades', rotuloGrupo: 'Município', item: 'localidade',
    grupo: function(p) { return p.NM_MUN; }, ordem: function(p) { return p.NOME_ACEN || ''; },
    rotulo: function(p) { return p.NOME_ACEN || p.GEOCOD; },
    detalhe: function(p) { return (p.NM_MUN || '') + (p.POPULACAO ? ' · ' + Number(p.POPULACAO).toLocaleString('pt-BR') + ' hab.' : ''); }
  },
  municipios: {
    nome: 'Municípios', rotuloGrupo: 'Região de planejamento', item: 'município',
    grupo: function(p) { return p.rg_plan; }, ordem: function(p) { return p.NM_MUN || ''; },
    rotulo: function(p) { return p.NM_MUN || p.GEOCOD; }, detalhe: function(p) { return p.rg_plan || ''; }
  },
  // As três abaixo são editáveis pelo site (js/camadas_edicao.js, supabase/014_camadas_editaveis.sql).
  geo_pol_base: {
    nome: 'Áreas de estudo', rotuloGrupo: '', item: 'área',
    grupo: function() { return ''; }, ordem: function(p) { return p.GEOCOD; },
    rotulo: function(p) { return p.NOME || p.GEOCOD; },
    detalhe: function(p) { return [p.GEOCOD, p.AREA_KM2 ? kmObra(p.AREA_KM2) + ' km²' : '', p.DESCRICAO].filter(Boolean).join(' · '); }
  },
  geo_lin_base: {
    nome: 'Linhas genéricas (projetos)', rotuloGrupo: '', item: 'linha',
    grupo: function() { return ''; }, ordem: function(p) { return p.GEOCOD; },
    rotulo: function(p) { return p.NOME || p.GEOCOD; },
    detalhe: function(p) { return [p.GEOCOD, p.EXT_KM != null ? kmObra(p.EXT_KM) + ' km' : '', p.DESCRICAO].filter(Boolean).join(' · '); },
    km: function(p) { return Number(p.EXT_KM) || 0; }
  },
  geo_pt_base: {
    nome: 'Pontos genéricos (projetos)', rotuloGrupo: '', item: 'ponto',
    grupo: function() { return ''; }, ordem: function(p) { return p.GEOCOD; },
    rotulo: function(p) { return p.NOME || p.GEOCOD; },
    detalhe: function(p) { return [p.GEOCOD, p.DESCRICAO].filter(Boolean).join(' · '); }
  }
};
var BASES_POR_TIPO = {
  'Ponto': ['localidades', 'aero', 'geo_pt_base'],
  'Linha': ['sre_base', 'ferrovias', 'extra_base', 'geo_lin_base'],
  'Área': ['municipios', 'geo_pol_base']
};

// Coordenada do ponto: mesma caixa de Goiás (com folga) que o banco usa.
function validarPontoObra(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return 'Latitude e longitude devem ser números (ex.: -16.68, -49.25)';
  if (lon < -53.8 || lon > -45.4 || lat < -20 || lat > -12) return 'Ponto fora de Goiás (confira se latitude e longitude não estão trocadas)';
  return '';
}
