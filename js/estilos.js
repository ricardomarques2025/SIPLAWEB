// Configuracoes visuais das camadas do mapa.
// Para alterar cores, espessuras ou itens da legenda das linhas, comece aqui.
// A logica que desenha e filtra as camadas fica em js/mapa.js.

const MAPA_PANES = {
  limitesBasePane: 220,
  areasAmbientaisPane: 230,
  areasUrbanasPane: 240,
  municipiosPane: 250,
  regioesPane: 252,
  areaInfluenciaPane: 255,
  bufferPane: 258,
  snvPane: 260,
  ferroviasPane: 270,
  sreBasePane: 300,
  servicosPane: 500,
  localidadesPane: 550,
  oaePane: 600,
  aeroPane: 620,
  rotulosBasePane: 650,
  anotacoesPane: 850,
  medicaoPane: 875,
  rotulosServicosPane: 900,
  anotacoesTextoPane: 950,
  // Acima do .leaflet-popup-pane (z-index 2000 !important em style.css),
  // para a piscada de clique não ficar escondida atrás do popup.
  destaqueCliquePane: 2100
};

const MAPAS_BASE_CONFIG = {
  "Claro limpo": {
    inicial: true,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    opcoes: {
      attribution: "Tiles © Esri",
      maxNativeZoom: 16,
      maxZoom: 20
    }
  },
  "Padrão": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    opcoes: {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19
    }
  },
  "Satélite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    opcoes: {
      attribution: "Tiles © Esri",
      maxZoom: 19
    }
  }
};

const ESTILO_CONTORNO_BRANCO_MUNICIPIOS = {
  color: "#ffffff",
  weight: 7,
  opacity: 1,
  fill: false,
  dashArray: null
};

const ESTILO_AREA_INFLUENCIA = {
  color: "#2680c2",
  weight: 1.5,
  opacity: 1,
  fillColor: "#87cefa",
  fillOpacity: 0.25
};

const ESTILO_ANOTACAO_PADRAO = {
  pane: "anotacoesPane",
  color: "#e11d48",
  weight: 4,
  opacity: 0.95,
  fillColor: "#f43f5e",
  fillOpacity: 0.14
};

const ESTILO_TEXTO_ANOTACAO_PADRAO = {
  cor: "#111827",
  tamanho: 13
};

const ESTILO_PONTO_ANOTACAO_PADRAO = {
  formato: "circulo",
  tamanho: 14
};

const FORMATOS_IMPRESSAO = {
  A4: { largura: 210, altura: 297 },
  A3: { largura: 297, altura: 420 },
  A2: { largura: 420, altura: 594 },
  A1: { largura: 594, altura: 841 },
  A0: { largura: 841, altura: 1189 }
};

const REGRAS_ESTILO = [
    {
      legenda: "Pavimentação - Em Andamento",
      cor: "#dc0101",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 1,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_AND", campo: "TES.AND.SV", comparador: "=", valor: "Pavimentação" },
        { grupo: "FUN_AND", campo: "FUN.AND.SV", comparador: "=", valor: "Pavimentação" }
      ]}
    },
    {
      legenda: "Duplicação - Em Andamento",
      cor: "#001efe",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 2,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_AND", campo: "TES.AND.SV", comparador: "=", valor: "Duplicação" },
        { grupo: "FUN_AND", campo: "FUN.AND.SV", comparador: "=", valor: "Duplicação" }
      ]}
    },
    {
      legenda: "Restauração - Em Andamento",
      cor: "#10a000",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 3,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_AND", campo: "TES.AND.SV", comparador: "=", valor: "Restauração" },
        { grupo: "FUN_AND", campo: "FUN.AND.SV", comparador: "=", valor: "Restauração" }
      ]}
    },
    {
      legenda: "Melhoria Funcional - Em Andamento",
      cor: "#ff9601",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 4,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_AND", campo: "TES.AND.SV", comparador: "=", valor: "Melhoria Funcional" },
        { grupo: "FUN_AND", campo: "FUN.AND.SV", comparador: "=", valor: "Melhoria Funcional" }
      ]}
    },
    {
      legenda: "Pavimentação - Em Licitação",
      cor: "#dc8484",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 5,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_LIC", campo: "TES.LIC.SV", comparador: "=", valor: "Pavimentação" },
        { grupo: "FUN_LIC", campo: "FUN.LIC.SV", comparador: "=", valor: "Pavimentação" }
      ]}
    },
    {
      legenda: "Duplicação - Em Licitação",
      cor: "#7f90fe",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 6,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_LIC", campo: "TES.LIC.SV", comparador: "=", valor: "Duplicação" },
        { grupo: "FUN_LIC", campo: "FUN.LIC.SV", comparador: "=", valor: "Duplicação" }
      ]}
    },
    {
      legenda: "Restauração - Em Licitação",
      cor: "#8fd388",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 7,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_LIC", campo: "TES.LIC.SV", comparador: "=", valor: "Restauração" },
        { grupo: "FUN_LIC", campo: "FUN.LIC.SV", comparador: "=", valor: "Restauração" }
      ]}
    },
    {
      legenda: "Melhoria Funcional - Em Licitação",
      cor: "#ffd388",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 8,
      regra: { op: "OR", condicoes: [
        { grupo: "TES_LIC", campo: "TES.LIC.SV", comparador: "=", valor: "Melhoria Funcional" },
        { grupo: "FUN_LIC", campo: "FUN.LIC.SV", comparador: "=", valor: "Melhoria Funcional" }
      ]}
    },
    {
      legenda: "Pavimentação - Projeto",
      cor: "#dc0101",
      tipo_linha: "COM LINHA BRANCA",
      espessura: 9,
      prioridade: 9,
      regra: { op: "AND", condicoes: [
        { grupo: "DPJ", campo: "DPJ.SV", comparador: "=", valor: "Pavimentação" }
      ]}
    },
    {
      legenda: "Duplicação - Projeto",
      cor: "#001efe",
      tipo_linha: "COM LINHA BRANCA",
      espessura: 9,
      prioridade: 10,
      regra: { op: "AND", condicoes: [
        { grupo: "DPJ", campo: "DPJ.SV", comparador: "=", valor: "Duplicação" }
      ]}
    },
    {
      legenda: "Restauração - Projeto",
      cor: "#10a000",
      tipo_linha: "COM LINHA BRANCA",
      espessura: 9,
      prioridade: 11,
      regra: { op: "AND", condicoes: [
        { grupo: "DPJ", campo: "DPJ.SV", comparador: "=", valor: "Restauração" }
      ]}
    },
    {
      legenda: "Melhoria Funcional - Projeto",
      cor: "#ff9601",
      tipo_linha: "COM LINHA BRANCA",
      espessura: 9,
      prioridade: 12,
      regra: { op: "AND", condicoes: [
        { grupo: "DPJ", campo: "DPJ.SV", comparador: "=", valor: "Melhoria Funcional" }
      ]}
    },
    {
      legenda: "Federalização",
      cor: "#e0fe00",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 13,
      regra: { op: "AND", condicoes: [
        { grupo: "FEDER", campo: "FEDER", comparador: "=", valor: 1 }
      ]}
    },
    {
      legenda: "Microrrevestimento",
      cor: "#fe49e6",
      tipo_linha: "NORMAL",
      espessura: 9,
      prioridade: 14,
      regra: { op: "AND", condicoes: [
        { grupo: "MICRO", campo: "PMR", comparador: ">", valor: 0 }
      ]}
    }
  ];

  const OAE_LEGENDA_INFO = {
    1: { cor: '#00ffff', titulo: 'Eixo 1', desc: 'Manutenção e restauração de pontes em rodovias pavimentadas' },
    2: { cor: '#ffff00', titulo: 'Eixo 2', desc: 'GPP - Programa Goiás de Ponta a Ponte' },
    3: { cor: '#ff0000', titulo: 'Eixo 3', desc: 'Obras firmadas em parcerias com entes externos' },
    4: { cor: '#2f80ed', titulo: 'Eixo 4', desc: 'Novas Obras Estaduais' },
    5: { cor: '#00ff00', titulo: 'Eixo 5', desc: 'GME - Programa Goiás em Movimento Estruturas' },
    6: { cor: '#ff4dc4', titulo: 'Eixo 6', desc: 'GMK - Programa Goiás em Movimento Kalunga' },
    100: { cor: '#8B5A00', titulo: 'Bueiro', desc: '' },
    101: { cor: '#999999', titulo: 'Viaduto', desc: '' }
  };

  const ROD_EST_INFO = {
    DUP: { label: 'Duplicada', tipo: 'dup', cor: '#ef2020' },
    PAV: { label: 'Pavimentada', tipo: 'simple', cor: '#ef2020' },
    EOD: { label: 'Em Obras de Duplicação', tipo: 'dashed-red', cor: '#ef2020' },
    EOP: { label: 'Em Obras de Pavimentação', tipo: 'dashed-red', cor: '#ef2020' },
    IMP: { label: 'Implantada', tipo: 'simple', cor: '#f08a00' },
    LEN: { label: 'Leito Natural', tipo: 'simple', cor: '#f08a00' },
    PLA: { label: 'Planejada', tipo: 'simple', cor: '#000000' }
  };

  const ROD_FED_INFO = {
    DUP: { label: 'Duplicada', tipo: 'dup', cor: '#33a21a' },
    LEN: { label: 'Leito Natural', tipo: 'simple', cor: '#e59b00' },
    EOP: { label: 'Em Obras de Pavimentação', tipo: 'dashed-green', cor: '#33a21a' },
    PAV: { label: 'Pavimentada', tipo: 'simple', cor: '#33a21a' }
  };

  const OBRAS_PONTOS_INFO = {
    OaePlanejamento: {
      label: 'OAE em planejamento',
      classe: 'obra-ponto-oae-planejamento',
      cor: '#8b5cf6',
      formato: 'quadrado',
      icone: 'data/placaoaeplanejamento.svg'
    },
    OaeProjeto: {
      label: 'OAE em projeto',
      classe: 'obra-ponto-oae-projeto',
      cor: '#00ffff',
      formato: 'quadrado',
      icone: 'data/placaoaeprojeto.svg'
    },
    OaeObra: {
      label: 'OAE em obra',
      classe: 'obra-ponto-oae-obra',
      cor: '#fffb00',
      formato: 'losango',
      icone: 'data/placaoaeobra.svg'
    },
    Planejamento: {
      label: 'Em planejamento',
      classe: 'obra-ponto-planejamento',
      cor: '#8b5cf6',
      formato: 'quadrado',
      icone: 'data/placaplanejamento.svg'
    },
    Projeto: {
      label: 'Projeto',
      classe: 'obra-ponto-projeto',
      cor: '#00ffff',
      formato: 'quadrado',
      icone: 'data/placaprojeto.svg'
    },
    Manutencao: {
      label: 'Manutenção',
      classe: 'obra-ponto-manutencao',
      cor: '#ffcc00',
      formato: 'quadrado',
      icone: 'data/placamanutencao.svg'
    },
    Obra: {
      label: 'Obra',
      classe: 'obra-ponto-obra',
      cor: '#ffcc00',
      formato: 'losango',
      icone: 'data/placaobra.svg'
    },
    Padrao: {
      label: 'Outros',
      classe: 'obra-ponto-padrao',
      cor: '#6b7280',
      formato: 'circulo'
    }
  };

  window.MAPA_PANES = MAPA_PANES;
  window.ESTILO_AREA_INFLUENCIA = ESTILO_AREA_INFLUENCIA;
  window.MAPAS_BASE_CONFIG = MAPAS_BASE_CONFIG;
  window.ESTILO_ANOTACAO_PADRAO = ESTILO_ANOTACAO_PADRAO;
  window.ESTILO_TEXTO_ANOTACAO_PADRAO = ESTILO_TEXTO_ANOTACAO_PADRAO;
  window.ESTILO_PONTO_ANOTACAO_PADRAO = ESTILO_PONTO_ANOTACAO_PADRAO;
  window.FORMATOS_IMPRESSAO = FORMATOS_IMPRESSAO;
  window.REGRAS_ESTILO = REGRAS_ESTILO;
  window.OAE_LEGENDA_INFO = OAE_LEGENDA_INFO;
  window.ROD_EST_INFO = ROD_EST_INFO;
  window.ROD_FED_INFO = ROD_FED_INFO;
  window.OBRAS_PONTOS_INFO = OBRAS_PONTOS_INFO;




// Faixa visual em pixels ao redor dos trechos vinculados à área de estudo.
const ESTILOS_AREA_ESTUDO = {
  sre_base: { color: '#eda1a1', weight: 18, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
  ferrovias: { color: '#84a5ec', weight: 18, opacity: 1.0, lineCap: 'round', lineJoin: 'round' }
};
