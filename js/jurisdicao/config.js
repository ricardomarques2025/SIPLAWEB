// Modulo Jurisdicao do SIPLAWEB: dominios, cores e definicao das colunas (vindo de JURISDICAO/SITE/js/config.js).
// O acesso ao banco e o login ficam em js/acesso.js. Para mudar rotulos, cores ou a ordem das colunas, comece aqui.

// Camadas de base (os mesmos arquivos do mapa do SIPLAWEB), usadas pelo caderno em PDF.
const ARQUIVOS = {
  base: {
    mascara: 'data/mascara_brasil.geojson',
    municipios: 'data/municipios.geojson',
    sre: 'data/sre_base.geojson',
    snv: 'data/snv_goias.geojson',
    localidades: 'data/localidades.geojson'
  }
};

const TIPOS = {
  'Estadualização': { cor: '#2563eb', curto: 'Estadualização' },
  'Municipalização': { cor: '#ea580c', curto: 'Municipalização' },
  'Federalização': { cor: '#9333ea', curto: 'Federalização' }
};

const SITUACOES = {
  'EM ANÁLISE': { cor: '#2563eb' },
  'SOBRESTADO': { cor: '#d97706' },
  'EM JUDICIALIZAÇÃO (PGE/ADI)': { cor: '#7c3aed' },
  'VETO TOTAL DO GOVERNADOR': { cor: '#dc2626' },
  'ENCERRADO': { cor: '#64748b' },
  'FINALIZADO': { cor: '#16a34a' }
};

// Campos de documento: "NÃO", "PARCIAL", "NÃO SE APLICA", "SIM" ou o texto do ato (= possui).
const OPCOES_DOC = ['SIM', 'NÃO', 'PARCIAL', 'NÃO SE APLICA'];

// tipo: texto | numero | lista | doc | longo
// grupo: usado no painel de detalhes
const CAMPOS = [
  // Código permanente gerado pelo banco (AJ26-0001); o id numérico é só a chave interna e não aparece.
  { campo: 'codigo', titulo: 'Código', tipo: 'texto', largura: 104, fixa: true, somenteLeitura: true, grupo: 'Identificação' },
  { campo: 'tipo', titulo: 'Tipo', tipo: 'lista', opcoes: Object.keys(TIPOS), largura: 150, fixa: true, grupo: 'Identificação' },
  { campo: 'rodovia', titulo: 'Rodovia', tipo: 'texto', largura: 120, grupo: 'Identificação' },
  { campo: 'municipios', titulo: 'Municípios', tipo: 'texto', largura: 210, grupo: 'Identificação' },
  { campo: 'trecho', titulo: 'Trecho', tipo: 'longo', largura: 260, grupo: 'Identificação' },
  { campo: 'extensao_km', titulo: 'Ext. (km)', tipo: 'numero', largura: 90, grupo: 'Identificação' },
  { campo: 'situacao', titulo: 'Situação atual', tipo: 'lista', opcoes: Object.keys(SITUACOES), largura: 200, grupo: 'Andamento' },
  { campo: 'processo', titulo: 'Nº processo', tipo: 'texto', largura: 150, grupo: 'Andamento' },
  { campo: 'processos_sei', titulo: 'Processos SEI (todos)', tipo: 'longo', largura: 200, grupo: 'Andamento', oculta: true },
  { campo: 'status_detalhe', titulo: 'Status detalhado', tipo: 'longo', largura: 280, grupo: 'Andamento' },
  { campo: 'trecho_urbano', titulo: 'Trecho urbano', tipo: 'doc', largura: 100, grupo: 'Documentação' },
  { campo: 'portaria_sre', titulo: 'Portaria (SRE)', tipo: 'doc', largura: 110, grupo: 'Documentação' },
  { campo: 'lei_municipal', titulo: 'Lei municipal', tipo: 'doc', largura: 110, grupo: 'Documentação' },
  { campo: 'exposicao_motivos', titulo: 'Exp. motivos', tipo: 'doc', largura: 105, grupo: 'Documentação' },
  { campo: 'lei_estadual', titulo: 'Lei estadual', tipo: 'doc', largura: 105, grupo: 'Documentação' },
  { campo: 'termo_transferencia', titulo: 'Termo transf.', tipo: 'doc', largura: 105, grupo: 'Documentação' },
  { campo: 'id_est', titulo: 'ID_EST', tipo: 'numero', largura: 80, grupo: 'Códigos', oculta: true },
  { campo: 'id_site', titulo: 'ID site', tipo: 'texto', largura: 120, grupo: 'Códigos', oculta: true },
  { campo: 'observacoes', titulo: 'Observações', tipo: 'longo', largura: 220, grupo: 'Andamento', oculta: true }
];

// Cabecalhos usados na exportacao para Excel (mesma nomenclatura da planilha original).
const CABECALHOS_EXCEL = {
  codigo: 'CÓDIGO', id_est: 'ID_EST', tipo: 'TIPO', id_site: 'ID SITE', processo: 'Nº PROCESSO',
  municipios: 'MUNICÍPIOS', rodovia: 'RODOVIA', extensao_km: 'EXTENSÃO (KM)',
  portaria_sre: 'AUTORIZAÇÃO PORTARIA (SRE)', trecho_urbano: 'TRECHO URBANO', trecho: 'TRECHO',
  lei_municipal: 'LEI MUNICIPAL', exposicao_motivos: 'EXPOSIÇÃO DE MOTIVOS', lei_estadual: 'LEI ESTADUAL',
  termo_transferencia: 'TERMO DE TRANSFERÊNCIA', situacao: 'SITUAÇÃO ATUAL',
  status_detalhe: 'STATUS DETALHADO', processos_sei: 'PROCESSOS SEI', observacoes: 'OBSERVAÇÕES'
};

const MAPAS_BASE = {
  'Claro': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    opcoes: { attribution: 'Tiles © Esri', maxNativeZoom: 16, maxZoom: 20 }
  },
  'OpenStreetMap': {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opcoes: { attribution: '© OpenStreetMap', maxZoom: 19 }
  },
  'Satélite': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opcoes: { attribution: 'Tiles © Esri', maxZoom: 19 }
  }
};

// Situacao (codigo) da base SRE -> estilo, igual ao SIPLAWEB.
const ESTILO_SRE = {
  DUP: { color: '#ef2020', weight: 3.2 },
  EOD: { color: '#ef2020', weight: 2.6 },
  EOP: { color: '#ef2020', weight: 1.8, dashArray: '10,7' },
  PAV: { color: '#ef2020', weight: 1.8 },
  IMP: { color: '#f08a00', weight: 1.6 },
  LEN: { color: '#f08a00', weight: 1.6 },
  PLA: { color: '#000000', weight: 1.4 }
};

function statusDoc(valor) {
  const v = String(valor == null ? '' : valor).trim().toUpperCase();
  if (!v || v === '-' ) return 'vazio';
  if (v === 'NÃO') return 'nao';
  if (v === 'PARCIAL') return 'parcial';
  if (v === 'NÃO SE APLICA') return 'na';
  return 'sim';
}
