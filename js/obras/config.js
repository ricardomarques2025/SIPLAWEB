// Tabela de obras (siplaweb.obras): colunas e regras de validacao do lado do site.
// O banco valida de novo (js nao e a unica barreira). Para mudar rotulos, larguras ou a ordem, comece aqui.
//
// tipo: texto | numero | lista | longo | data | sei
// comum: aparece em toda origem; as demais colunas aparecem so se a origem tem algum valor nelas
//        (o usuario pode ligar/desligar qualquer coluna em "Colunas").
// lista: os valores vem de siplaweb.listas (campo etapa | status | intervencao | modalidade | fonte | fase).

// Ordem e nomes como na planilha de obras da DOR (13/11/2026): ID, Proposta, Fase, Rodovia, Intervenção, Trecho,
// Extensão (km), Status, Valor aprovado, Valor do contrato, Fonte, Processo, Contrato, Previsão de conclusão; os demais depois.
// moeda: número em R$ (tabela, ficha, exportação).
// oculta: fora da tabela até a pessoa ligar em "Colunas" (continua na ficha, no caderno e na exportação completa).
//   ID (ref) é só referência de ordenação da planilha (muda a cada versão dela); Tipo e valores servem aos cadernos.
var CAMPOS_OBRA = [
  { campo: 'codigo', titulo: 'Código', tipo: 'texto', largura: 112, fixa: true, somenteLeitura: true, comum: true, grupo: 'Identificação' },
  // soFiltro: visível por padrão só na tabela FUNDEINFRA (filtro das obras da DOR e da DPJ; 17/11/2026).
  // Obras vinculadas (script 026, 18/11/2026): mesma obra em outra origem, ligada à mão; o banco grava o vínculo nos
  // dois sentidos. Depois se decide qual código fica. tipo 'obras' = códigos OB26-00000 separados por ; ou ,
  { campo: 'obras_vinculadas', titulo: 'Obras vinculadas', tipo: 'obras', largura: 190, comum: true, grupo: 'Identificação' },
  { campo: 'origem', titulo: 'Origem', tipo: 'texto', largura: 80, somenteLeitura: true, soFiltro: true, grupo: 'Identificação' },
  { campo: 'grupo_codigo', titulo: 'Grupo', tipo: 'texto', largura: 96, somenteLeitura: true, grupo: 'Identificação' },
  { campo: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 74, somenteLeitura: true, comum: true, oculta: true, grupo: 'Identificação' },
  { campo: 'ref', titulo: 'ID', tipo: 'texto', largura: 70, oculta: true, grupo: 'Identificação' },
  { campo: 'proposta', titulo: 'Proposta', tipo: 'texto', largura: 90, grupo: 'Identificação' },
  { campo: 'fase', titulo: 'Fase', tipo: 'lista', largura: 110, grupo: 'Situação' },
  { campo: 'rodovia', titulo: 'Rodovia', tipo: 'texto', largura: 110, grupo: 'Localização' },
  { campo: 'intervencao', titulo: 'Intervenção', tipo: 'lista', largura: 150, comum: true, grupo: 'Identificação' },
  { campo: 'descricao', titulo: 'Trecho', tipo: 'longo', largura: 320, comum: true, grupo: 'Identificação' },
  { campo: 'ext_contrato_km', titulo: 'Extensão (km)', tipo: 'numero', largura: 110, grupo: 'Contratação' },
  { campo: 'etapa', titulo: 'Etapa', tipo: 'lista', largura: 120, comum: true, grupo: 'Situação' },
  { campo: 'status', titulo: 'Status', tipo: 'lista', largura: 170, comum: true, grupo: 'Situação' },
  { campo: 'valor_aprovado', titulo: 'Valor aprovado', tipo: 'numero', moeda: true, largura: 150, oculta: true, grupo: 'Contratação' },
  { campo: 'valor_contrato', titulo: 'Valor do contrato', tipo: 'numero', moeda: true, largura: 150, oculta: true, grupo: 'Contratação' },
  { campo: 'fonte', titulo: 'Fonte', tipo: 'lista', largura: 150, grupo: 'Contratação' },
  { campo: 'sei', titulo: 'Processo', tipo: 'sei', largura: 150, comum: true, grupo: 'Contratação' },
  { campo: 'contrato', titulo: 'Contrato', tipo: 'texto', largura: 110, grupo: 'Contratação' },
  { campo: 'conclusao', titulo: 'Previsão de conclusão', tipo: 'texto', largura: 120, grupo: 'Situação' },
  { campo: 'modalidade', titulo: 'Modalidade', tipo: 'lista', largura: 160, grupo: 'Contratação' },
  { campo: 'data_referencia', titulo: 'Data de referência', tipo: 'data', largura: 130, comum: true, grupo: 'Situação' },
  { campo: 'municipio', titulo: 'Município', tipo: 'texto', largura: 150, grupo: 'Localização' },
  { campo: 'localidade', titulo: 'Localidade', tipo: 'texto', largura: 150, grupo: 'Localização' },
  { campo: 'populacao', titulo: 'População', tipo: 'numero', largura: 100, grupo: 'Localização' },
  // Coordenadas (18/11/2026): calculadas da geometria da obra no navegador (ObrasStore), só leitura: o ponto se muda
  // pelo mapa. Linha: o vértice do meio. Servem para busca e filtro.
  { campo: 'latitude', titulo: 'Latitude', tipo: 'numero', casas: 6, negativo: true, largura: 100, somenteLeitura: true, oculta: true, grupo: 'Localização' },
  { campo: 'longitude', titulo: 'Longitude', tipo: 'numero', casas: 6, negativo: true, largura: 100, somenteLeitura: true, oculta: true, grupo: 'Localização' },
  { campo: 'sre', titulo: 'SRE', tipo: 'texto', largura: 110, grupo: 'Localização' },
  { campo: 'sei_obra_contrato', titulo: 'Processo de contratação', tipo: 'texto', largura: 150, grupo: 'Contratação' },
  { campo: 'empresa', titulo: 'Empresa', tipo: 'texto', largura: 200, grupo: 'Contratação' },
  { campo: 'lote', titulo: 'Lote', tipo: 'texto', largura: 90, grupo: 'Contratação' },
  { campo: 'area_contratada_m2', titulo: 'Área contratada (m²)', tipo: 'numero', largura: 140, grupo: 'Execução' },
  { campo: 'area_executada_m2', titulo: 'Área executada (m²)', tipo: 'numero', largura: 140, grupo: 'Execução' },
  { campo: 'horas_pagas', titulo: 'Horas pagas', tipo: 'numero', largura: 110, grupo: 'Execução' },
  { campo: 'observacoes', titulo: 'Observações', tipo: 'longo', largura: 260, grupo: 'Execução' },
  // Base Geral do PGE (Programa de Gestão de Estruturas; GME, GMK e PGE; script 025, 18/11/2026). Só aparecem nas
  // origens que têm valor; as menos usadas ficam ocultas (ligar em "Colunas"). futuro: data que pode ser futura.
  { campo: 'codigo_pge', titulo: 'Código PGE', tipo: 'texto', largura: 100, grupo: 'Identificação' },
  // Calculados pelo banco a partir do Código PGE (script 027): só leitura.
  { campo: 'pge_eixo', titulo: 'Eixo PGE', tipo: 'texto', largura: 70, somenteLeitura: true, oculta: true, grupo: 'Identificação' },
  { campo: 'pge_etapa', titulo: 'Etapa PGE', tipo: 'texto', largura: 70, somenteLeitura: true, oculta: true, grupo: 'Identificação' },
  { campo: 'pge_item', titulo: 'Item PGE', tipo: 'texto', largura: 70, somenteLeitura: true, oculta: true, grupo: 'Identificação' },
  { campo: 'estrutura', titulo: 'Estrutura prevista', tipo: 'texto', largura: 130, grupo: 'Estrutura' },
  { campo: 'curso_dagua', titulo: "Curso d'água", tipo: 'texto', largura: 200, grupo: 'Estrutura' },
  { campo: 'extensao_m', titulo: 'Extensão (m)', tipo: 'numero', largura: 100, grupo: 'Estrutura' },
  { campo: 'largura_m', titulo: 'Largura (m)', tipo: 'numero', largura: 100, oculta: true, grupo: 'Estrutura' },
  { campo: 'altura_m', titulo: 'Altura (m)', tipo: 'numero', largura: 100, oculta: true, grupo: 'Estrutura' },
  { campo: 'area_m2', titulo: 'Área (m²)', tipo: 'numero', largura: 100, oculta: true, grupo: 'Estrutura' },
  { campo: 'custo_preliminar', titulo: 'Custo preliminar', tipo: 'numero', moeda: true, largura: 150, oculta: true, grupo: 'Estrutura' },
  { campo: 'etapa_fase', titulo: 'Etapa da fase', tipo: 'texto', largura: 220, grupo: 'Situação' },
  { campo: 'regional', titulo: 'Regional', tipo: 'texto', largura: 80, oculta: true, grupo: 'Localização' },
  { campo: 'superficie', titulo: 'Superfície da rodovia', tipo: 'texto', largura: 110, oculta: true, grupo: 'Localização' },
  { campo: 'trecho_inicial', titulo: 'Trecho inicial', tipo: 'texto', largura: 220, oculta: true, grupo: 'Localização' },
  { campo: 'trecho_final', titulo: 'Trecho final', tipo: 'texto', largura: 220, oculta: true, grupo: 'Localização' },
  { campo: 'lote_projeto', titulo: 'Lote de projeto', tipo: 'texto', largura: 120, oculta: true, grupo: 'Projeto' },
  { campo: 'sei_projeto', titulo: 'Processo do projeto', tipo: 'texto', largura: 150, oculta: true, grupo: 'Projeto' },
  { campo: 'contrato_projeto', titulo: 'Contrato do projeto', tipo: 'texto', largura: 120, oculta: true, grupo: 'Projeto' },
  { campo: 'projeto_inicio', titulo: 'Início do projeto', tipo: 'data', futuro: true, largura: 120, oculta: true, grupo: 'Projeto' },
  { campo: 'projeto_termino', titulo: 'Término do projeto', tipo: 'data', futuro: true, largura: 120, oculta: true, grupo: 'Projeto' },
  { campo: 'valor_projeto', titulo: 'Valor do projeto', tipo: 'numero', moeda: true, largura: 150, oculta: true, grupo: 'Projeto' },
  { campo: 'obra_inicio', titulo: 'Início da obra', tipo: 'data', futuro: true, largura: 120, oculta: true, grupo: 'Execução' },
  { campo: 'obra_termino', titulo: 'Término da obra', tipo: 'data', futuro: true, largura: 120, oculta: true, grupo: 'Execução' },
  { campo: 'avanco_fisico', titulo: 'Avanço físico (%)', tipo: 'numero', largura: 110, oculta: true, grupo: 'Execução' },
  { campo: 'convenio', titulo: 'Convênio', tipo: 'texto', largura: 110, oculta: true, grupo: 'Contratação' },
  { campo: 'sei_convenio', titulo: 'Processo do convênio', tipo: 'texto', largura: 150, oculta: true, grupo: 'Contratação' },
  { campo: 'sislog', titulo: 'Nº SISLOG', tipo: 'texto', largura: 100, oculta: true, grupo: 'Contratação' },
  { campo: 'inclusao_pge', titulo: 'Inclusão no PGE (SEI)', tipo: 'texto', largura: 140, oculta: true, grupo: 'Contratação' }
];

// Origens da Base Geral do PGE (18/11/2026, pedido do usuário: "ordem e campos condizentes com a planilha, para
// facilitar as edições"): nessas tabelas as colunas seguem a ordem e os nomes da planilha
// (Base_Geral_NOVA AVALIAÇÃO_OAE.xlsx, aba GERAL) e ficam todas visíveis; o Código da obra (OB26-...) continua
// fixo à esquerda e os campos só do sistema ficam no fim, ocultos. Nas demais origens nada muda.
// PGE = tabela única do Programa de Gestão de Estruturas (as 6 origens juntas; Acesso.gruposOrigens).
var ORIGENS_PLANILHA_PGE = ['GME', 'GMK', 'PGE1', 'GPP', 'PGE3', 'PGE4', 'PGE'];
var COLUNAS_PLANILHA_PGE = [
  ['codigo_pge', 'CÓDIGO'], ['pge_eixo', 'EIXO'], ['pge_etapa', 'ETAPA'], ['modalidade', 'SUBEIXO', 'soComValor'],
  ['pge_item', 'ITEM'], ['regional', 'REGIONAL'], ['curso_dagua', "CURSO D'ÁGUA"],
  ['sre', 'S.R.E'], ['trecho_inicial', 'TRECHO INICIAL'], ['trecho_final', 'TRECHO FINAL'], ['municipio', 'MUNICÍPIOS'],
  ['descricao', 'DESCRIÇÃO DO OBJETO'], ['estrutura', 'ESTRUTURA PREVISTA'], ['intervencao', 'INTERVENÇÃO (OAE/OAC)'],
  ['superficie', 'SITUAÇÃO SUPERFÍCIE'], ['rodovia', 'RODOVIAS'], ['latitude', 'LATITUDE'], ['longitude', 'LONGITUDE'], ['extensao_m', 'EXT. (m)'], ['altura_m', 'ALTURA (m)'],
  ['largura_m', 'LARGURA (m)'], ['area_m2', 'ÁREA (m²)'], ['fonte', 'RECURSO'], ['custo_preliminar', 'CUSTO PRELIMINAR'],
  ['lote_projeto', 'LOTE DE PROJETO'], ['etapa', 'FASE'], ['etapa_fase', 'ETAPA DA FASE'], ['status', 'SITUAÇÃO'],
  ['projeto_inicio', 'DATA DE INÍCIO (PROJETO)'], ['projeto_termino', 'DATA DE TÉRMINO (PROJETO)'], ['valor_projeto', 'VALOR DO PROJETO'],
  ['sei_projeto', 'Nº PROCESSO SEI (PROJETO)'], ['contrato_projeto', 'Nº DO CONTRATO (PROJETO)'], ['convenio', 'Nº CONVÊNIO'],
  ['sei_convenio', 'Nº PROCESSO SEI CONVÊNIO'], ['lote', 'LOTE DE OBRA'], ['obra_inicio', 'DATA DE INÍCIO (OBRA)'],
  ['obra_termino', 'DATA DE TÉRMINO (OBRA)'], ['valor_contrato', 'VALOR DA OBRA'],
  // "sei" = processo principal da obra (o da obra; se ainda não há, o do projeto: importação de 18/11/2026)
  ['sei', 'Nº PROCESSO SEI (OBRA)'], ['contrato', 'Nº DO CONTRATO (OBRA)'], ['avanco_fisico', 'AVANÇO FÍSICO DA OBRA (%)'],
  ['sislog', 'Nº SISLOG'], ['inclusao_pge', 'INCLUSÃO PGE']
];

function ehOrigemPlanilhaPge(origem) { return ORIGENS_PLANILHA_PGE.indexOf(String(origem || '').toUpperCase()) !== -1; }

// Campos da tabela/ficha/exportação da origem: CAMPOS_OBRA (cópias) na ordem e com os títulos da planilha nas origens
// do PGE; nas demais, o próprio CAMPOS_OBRA. planilha: true = coluna da planilha (visível por padrão);
// soComValor: só aparece se a origem tem algum valor (SUBEIXO = Modalidade, só no PGE4).
function camposObraDaOrigem(origem) {
  if (!ehOrigemPlanilhaPge(origem)) return CAMPOS_OBRA;
  var porCampo = {};
  CAMPOS_OBRA.forEach(function(c) { porCampo[c.campo] = c; });
  var usados = { codigo: true, obras_vinculadas: true, origem: true };
  var lista = [Object.assign({}, porCampo.codigo, { titulo: 'Cód. SIPLAWEB' })];   // "CÓDIGO" é o da planilha
  // Tabela única (PGE): a origem de cada obra (programa do eixo) logo depois do código
  if (window.Acesso && Acesso.ehGrupoOrigens && Acesso.ehGrupoOrigens(origem)) lista.push(Object.assign({}, porCampo.origem, { titulo: 'ORIGEM', soFiltro: true }));
  else lista.push(Object.assign({}, porCampo.origem, { oculta: true }));
  lista.push(Object.assign({}, porCampo.obras_vinculadas, { titulo: 'OBRAS VINCULADAS', oculta: false }));
  COLUNAS_PLANILHA_PGE.forEach(function(p) {
    var c = porCampo[p[0]]; if (!c) return;
    usados[p[0]] = true;
    lista.push(Object.assign({}, c, { titulo: p[1], planilha: true, oculta: false, comum: p[2] !== 'soComValor', soComValor: p[2] === 'soComValor' }));
  });
  CAMPOS_OBRA.forEach(function(c) { if (!usados[c.campo]) lista.push(Object.assign({}, c, { oculta: true })); });
  return lista;
}

// Ordem dos blocos da ficha da obra (independe da ordem das colunas acima).
var GRUPOS_FICHA_OBRA = ['Identificação', 'Situação', 'Localização', 'Estrutura', 'Projeto', 'Contratação', 'Execução'];

// Selos coloridos na tabela (Etapa e Fonte do recurso); valor fora da lista fica cinza.
var CORES_FONTE_OBRA = {
  'Tesouro': '#0f766e', 'Fundeinfra': '#b45309', 'Associativo-Fundeinfra': '#a16207', 'Convênio': '#6d28d9', 'TARE': '#be185d', 'Doação': '#4d7c0f',
  'Federal': '#1d4ed8'
};

var CORES_ETAPA_OBRA = {
  'Estudo Técnico Preliminar': '#c98a0c', 'Planejamento': '#c98a0c', 'Projeto': '#2b7bd6', 'Licitação': '#ea580c', 'Obra': '#1e9538', 'Manutenção': '#7c3aed', 'Integrada': '#0891b2',
  'Projeto + Obra': '#0f766e'
};

// Regras checadas antes de gravar (as mesmas do gatilho siplaweb.validar_obra no banco).
// Devolve a mensagem de erro ou '' quando o valor e aceito.
function validarCampoObra(campo, valor, listas) {
  var c = CAMPOS_OBRA.find(function(x) { return x.campo === campo; });
  if (!c || valor === null || valor === undefined || valor === '') return '';
  if (c.tipo === 'obras') {
    var resto = String(valor).toUpperCase().replace(/OB\d{2}-\d{5,}/g, '').replace(/[\s,;]/g, '');
    if (resto) return 'Use só códigos de obra (ex.: OB26-00052; OB26-01431)';
  }
  if (c.tipo === 'sei' && !/^\d{15}$/.test(String(valor).replace(/\D/g, ''))) return 'Processo SEI deve ter 15 dígitos';
  if (c.tipo === 'numero' && (!isFinite(Number(valor)) || Number(valor) < 0)) return 'Número inválido (não pode ser negativo)';
  if (c.tipo === 'data') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) return 'Data inválida';
    var hoje = new Date(); hoje.setMinutes(hoje.getMinutes() - hoje.getTimezoneOffset());
    if (!c.futuro && String(valor) > hoje.toISOString().slice(0, 10)) return 'Data no futuro';
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
