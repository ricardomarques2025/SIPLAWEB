// Painel (painel.html): resumo com indicadores, avisos/aprovações e configurações.
// Liberado a quem exporta ou aprova em alguma área (ou administrador). Os números respeitam as permissões do banco:
// cada pessoa só vê as origens (e a jurisdição) que tem liberadas. Aprovar/recusar usa as mesmas funções do mapa
// (siplaweb/jurisdicao.aprovar_proposta, recusar_proposta, cancelar_proposta), que conferem o perfil de novo no banco.
// Configurações: perfis de acesso (criados e editados só pelo administrador master: siplaweb.admin_salvar_perfil).
(function() {
  var POR_PAGINA = 1000;
  var DIAS = 30;
  // Data de referência: até 45 dias = em dia, até 90 = atenção, mais que isso = desatualizada.
  var PRAZO = { emDia: 45, atencao: 90 };
  var GRUPOS_ETAPA = [
    { chave: 'Planejamento', cor: 'var(--plan)' }, { chave: 'Projeto', cor: 'var(--projeto)' },
    { chave: 'Obra', cor: 'var(--obra)' }, { chave: 'outros', nome: 'Outras / sem etapa', cor: 'var(--outros)' }
  ];
  var SITUACAO_PROPOSTA = { pendente: 'Aguardando', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' };

  var sb = Acesso.cliente, sbJur = Acesso.cliente.schema('jurisdicao');
  var perfil = null, origens = [], obras = [], historico = [], jur = [], nomes = {};
  var propostas = [];        // { area, p, atual } das duas fontes (obras e jurisdição)
  var filtro = '';           // origem escolhida ('' = todas)

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, casas) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas || 0 }); }
  function fmtData(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '—'; }
  function fmtDataHora(d) { if (!d) return '—'; var x = new Date(d); return x.toLocaleDateString('pt-BR') + ' ' + x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function diasDesde(d) { return Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T12:00:00').getTime()) / 864e5); }
  function toast(msg, erro) {
    var t = document.createElement('div');
    t.className = 'toast' + (erro ? ' toast-erro' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function() { t.remove(); }, erro ? 7000 : 3500);
  }
  function eu() { return perfil.user_id; }
  function nomeOrigem(c) { var o = origens.find(function(x) { return x.codigo === c; }); return o ? o.nome : c; }

  // Leitura paginada (a API devolve no máximo 1000 linhas por consulta).
  function tudo(montar) {
    var linhas = [];
    function pagina(i) {
      return montar().range(i, i + POR_PAGINA - 1).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        linhas = linhas.concat(res.data);
        return res.data.length === POR_PAGINA ? pagina(i + POR_PAGINA) : linhas;
      });
    }
    return pagina(0);
  }
  function dados(res) { if (res.error) throw new Error(res.error.message); return res.data; }

  // ---------- Carga ----------
  function carregar() {
    var desde = new Date(Date.now() - DIAS * 864e5).toISOString();
    var veJur = Acesso.podeVer('JURISDICAO');
    return Promise.all([
      sb.from('origens').select('codigo,nome,ordem').eq('ativa', true).order('ordem').then(dados),
      tudo(function() { return sb.from('obras').select('uid,codigo,origem,etapa,status,municipio,ext_contrato_km,data_referencia').is('excluido_em', null).order('codigo'); }),
      tudo(function() { return sb.from('historico').select('quando,acao').gte('quando', desde).order('hid'); }),
      veJur ? tudo(function() { return sbJur.from('alteracoes').select('uid,codigo,situacao,extensao_km,rodovia,municipios').is('excluido_em', null).order('id'); }) : [],
      veJur ? tudo(function() { return sbJur.from('historico').select('quando,acao').gte('quando', desde).order('hid'); }) : [],
      sb.rpc('nomes').then(dados)
    ]).then(function(r) {
      origens = r[0].filter(function(o) { return Acesso.podeVer(o.codigo); });
      obras = r[1];
      historico = r[2].concat(r[4]);
      jur = r[3];
      nomes = {};
      r[5].forEach(function(u) { nomes[u.user_id] = u.nome; });
      return carregarPropostas();
    });
  }

  // Pendentes + decididas nos últimos 30 dias, das obras e da jurisdição. Para as edições pendentes busca
  // os valores atuais, para mostrar "antes → depois" (como na tela de Aprovações do mapa).
  function carregarPropostas() {
    var desde = new Date(Date.now() - DIAS * 864e5).toISOString();
    var filtroSit = 'situacao.eq.pendente,decidido_em.gte.' + desde;
    var veJur = Acesso.podeVer('JURISDICAO');
    return Promise.all([
      sb.from('propostas').select('*').or(filtroSit).order('criado_em', { ascending: false }).then(dados),
      veJur ? sbJur.from('propostas').select('*').or(filtroSit).order('criado_em', { ascending: false }).then(dados) : [],
      // Camadas (016): o banco só entrega a quem edita camadas, a quem decide e ao autor.
      sb.from('camadas_propostas').select('pid,camada,acao,geocod,dados,area,perfil_autor,situacao,motivo,criado_por,criado_em,decidido_por,decidido_em')
        .or(filtroSit).order('criado_em', { ascending: false }).then(dados).catch(function() { return []; })
    ]).then(function(r) {
      var camadas = r[2];
      var uidsObra = r[0].filter(function(p) { return p.obra_uid; }).map(function(p) { return p.obra_uid; });
      var uidsJur = [];
      r[1].forEach(function(p) { if (p.registro_uid) uidsJur.push(p.registro_uid); (p.registros || []).forEach(function(u) { uidsJur.push(u); }); });
      return Promise.all([
        uidsObra.length ? sb.from('obras').select('*').in('uid', uidsObra).then(dados) : [],
        uidsJur.length ? sbJur.from('alteracoes').select('*').in('uid', uidsJur).then(dados) : []
      ]).then(function(atuais) {
        var obraPor = {}, jurPor = {};
        atuais[0].forEach(function(o) { obraPor[o.uid] = o; });
        atuais[1].forEach(function(o) { jurPor[o.uid] = o; });
        propostas = r[0].map(function(p) { return { fonte: 'obras', area: p.origem, p: p, atual: obraPor[p.obra_uid] || null }; })
          .concat(r[1].map(function(p) {
            return { fonte: 'jurisdicao', area: 'JURISDICAO', p: p, atual: jurPor[p.registro_uid] || null,
              registros: (p.registros || []).map(function(u) { return jurPor[u]; }).filter(Boolean) };
          })).concat(camadas.map(function(p) { return { fonte: 'camadas', area: p.area, p: p, atual: null }; }));
      });
    });
  }

  // ---------- Filtro por origem ----------
  function renderFiltros() {
    var contagem = {};
    obras.forEach(function(o) { contagem[o.origem] = (contagem[o.origem] || 0) + 1; });
    var com = origens.filter(function(o) { return contagem[o.codigo]; });
    $('filtros').innerHTML = '<span class="pn-filtros-rotulo">Origem</span>' +
      '<button type="button" data-origem=""' + (filtro ? '' : ' class="ativo"') + '>Todas</button>' +
      com.map(function(o) {
        return '<button type="button" data-origem="' + esc(o.codigo) + '"' + (filtro === o.codigo ? ' class="ativo"' : '') +
          ' title="' + esc(o.nome) + ' · ' + num(contagem[o.codigo]) + '">' + esc(o.codigo) + '</button>';
      }).join('');
    $('filtros').hidden = com.length < 2;
  }
  function filtrar(origem) {
    filtro = filtro === origem ? '' : origem;
    renderFiltros();
    renderResumo();
  }
  function obrasFiltradas() { return filtro ? obras.filter(function(o) { return o.origem === filtro; }) : obras; }

  // ---------- Resumo ----------
  function grupoEtapa(e) { return e === 'Planejamento' || e === 'Projeto' || e === 'Obra' ? e : 'outros'; }

  function renderResumo() {
    var lista = obrasFiltradas();
    var porEtapa = { Planejamento: 0, Projeto: 0, Obra: 0, outros: 0 }, km = 0, municipios = {};
    lista.forEach(function(o) {
      porEtapa[grupoEtapa(o.etapa)]++;
      km += Number(o.ext_contrato_km) || 0;
      String(o.municipio || '').split(/\s*[\/;,]\s*/).forEach(function(m) { if (m) municipios[m] = (municipios[m] || 0) + 1; });
    });
    var pend = propostas.filter(function(x) { return x.p.situacao === 'pendente' && (!filtro || x.area === filtro); });
    var paraMim = pend.filter(podeDecidir).length;
    var kpis = [
      { v: num(lista.length), r: 'empreendimentos', s: filtro ? nomeOrigem(filtro) : origens.length + ' origens liberadas' },
      { v: num(porEtapa.Obra), r: 'em obra', s: pct(porEtapa.Obra, lista.length), cor: 'var(--obra)' },
      { v: num(porEtapa.Projeto), r: 'em projeto', s: pct(porEtapa.Projeto, lista.length), cor: 'var(--projeto)' },
      { v: num(porEtapa.Planejamento), r: 'em planejamento', s: pct(porEtapa.Planejamento, lista.length), cor: 'var(--plan)' },
      { v: num(km), r: 'km contratados', s: 'soma da extensão de contrato' },
      { v: num(Object.keys(municipios).length), r: 'municípios atendidos', s: 'com ao menos um empreendimento' },
      { v: num(pend.length), r: 'propostas aguardando', s: paraMim ? paraMim + ' para você decidir' : 'aguardando aprovação',
        link: '#aprovacoes', alerta: paraMim > 0 }
    ];
    $('kpis').innerHTML = kpis.map(function(k) {
      return '<' + (k.link ? 'a href="' + k.link + '"' : 'div') + ' class="pn-kpi' + (k.alerta ? ' pn-kpi-alerta' : '') + '"' +
        (k.cor ? ' style="--c:' + k.cor + '"' : '') + '><b>' + k.v + '</b><span>' + k.r + '</span><small>' + esc(k.s) + '</small></' + (k.link ? 'a' : 'div') + '>';
    }).join('');

    renderEtapas();
    renderBarrasSimples($('gStatus'), contar(lista, function(o) { return o.status || '(sem status)'; }), 8, 'var(--projeto)');
    renderBarrasSimples($('gMunicipios'), Object.keys(municipios).map(function(m) { return [m, municipios[m]]; }).sort(function(a, b) { return b[1] - a[1]; }), 8, 'var(--obra)', true);
    renderAtualizacao();
    renderAtividade();
    renderJurisdicao();
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '% do total' : '—'; }
  function contar(lista, chave) {
    var c = {};
    lista.forEach(function(o) { var k = chave(o); c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function(k) { return [k, c[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  }

  // Barras horizontais empilhadas: uma linha por origem, segmentos por etapa, total na ponta.
  function renderEtapas() {
    var por = {};
    obras.forEach(function(o) {
      var x = por[o.origem] = por[o.origem] || { total: 0, Planejamento: 0, Projeto: 0, Obra: 0, outros: 0, detalhe: {} };
      x.total++; x[grupoEtapa(o.etapa)]++;
      var d = o.etapa || 'sem etapa'; x.detalhe[d] = (x.detalhe[d] || 0) + 1;
    });
    var linhas = origens.filter(function(o) { return por[o.codigo]; }).sort(function(a, b) { return por[b.codigo].total - por[a.codigo].total; });
    var max = Math.max.apply(null, linhas.map(function(o) { return por[o.codigo].total; }).concat(1));
    $('gEtapas').innerHTML = linhas.map(function(o) {
      var x = por[o.codigo];
      var outros = Object.keys(x.detalhe).filter(function(d) { return grupoEtapa(d === 'sem etapa' ? null : d) === 'outros'; })
        .map(function(d) { return d + ': ' + x.detalhe[d]; }).join(' · ');
      return '<button type="button" class="pn-linha' + (filtro && filtro !== o.codigo ? ' apagada' : '') + (filtro === o.codigo ? ' escolhida' : '') +
        '" data-origem="' + esc(o.codigo) + '"><span class="pn-rotulo" title="' + esc(o.nome) + '">' + esc(o.codigo) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (x.total / max * 100) + '%">' +
        GRUPOS_ETAPA.filter(function(g) { return x[g.chave]; }).map(function(g) {
          var nome = g.nome || g.chave;
          return '<i style="flex:' + x[g.chave] + ';background:' + g.cor + '" data-dica="' + esc(o.codigo + ' · ' + nome + '|' + num(x[g.chave]) + ' (' + Math.round(x[g.chave] / x.total * 100) + '%)' +
            (g.chave === 'outros' && outros ? '|' + outros : '')) + '"></i>';
        }).join('') + '</span><span class="pn-valor">' + num(x.total) + '</span></span></button>';
    }).join('') || '<div class="vazio">Sem empreendimentos.</div>';
  }

  // Barras horizontais de uma série; o que passa do limite vira "Outros".
  function renderBarrasSimples(alvo, pares, limite, cor, semOutros) {
    var mostra = pares.slice(0, limite), resto = pares.slice(limite);
    if (resto.length && !semOutros) mostra.push(['Outros (' + resto.length + ')', resto.reduce(function(s, p) { return s + p[1]; }, 0)]);
    var max = Math.max.apply(null, mostra.map(function(p) { return p[1]; }).concat(1));
    alvo.innerHTML = mostra.map(function(p) {
      return '<div class="pn-linha pn-linha-larga"><span class="pn-rotulo" title="' + esc(p[0]) + '">' + esc(p[0]) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (p[1] / max * 100) + '%"><i style="flex:1;background:' + cor + '" data-dica="' + esc(p[0] + '|' + num(p[1])) + '"></i></span>' +
        '<span class="pn-valor">' + num(p[1]) + '</span></span></div>';
    }).join('') || '<div class="vazio">Sem dados.</div>';
  }

  function situacaoPrazo(dias) {
    if (dias == null) return { cls: 'sem', txt: 'Sem data', ico: '–' };
    if (dias <= PRAZO.emDia) return { cls: 'ok', txt: 'Em dia', ico: '✓' };
    if (dias <= PRAZO.atencao) return { cls: 'atencao', txt: 'Atenção', ico: '!' };
    return { cls: 'atrasada', txt: 'Desatualizada', ico: '!!' };
  }
  function atualizacaoPorOrigem() {
    var ult = {};
    obras.forEach(function(o) { if (o.data_referencia && (!ult[o.origem] || o.data_referencia > ult[o.origem])) ult[o.origem] = o.data_referencia; });
    return origens.filter(function(o) { return obras.some(function(x) { return x.origem === o.codigo; }); }).map(function(o) {
      var d = ult[o.codigo];
      return { origem: o, data: d, dias: d ? diasDesde(d) : null };
    }).sort(function(a, b) { return (b.dias == null ? 1e9 : b.dias) - (a.dias == null ? 1e9 : a.dias); });
  }
  function renderAtualizacao() {
    var linhas = atualizacaoPorOrigem().filter(function(l) { return !filtro || l.origem.codigo === filtro; });
    $('tAtualizacao').innerHTML = '<table class="pn-tabela"><thead><tr><th>Origem</th><th>Referência</th><th>Há</th><th>Situação</th></tr></thead><tbody>' +
      linhas.map(function(l) {
        var s = situacaoPrazo(l.dias);
        return '<tr><td title="' + esc(l.origem.nome) + '"><b>' + esc(l.origem.codigo) + '</b></td><td>' + fmtData(l.data) + '</td><td>' +
          (l.dias == null ? '—' : num(l.dias) + ' dias') + '</td><td><span class="pn-selo pn-selo-' + s.cls + '"><i>' + s.ico + '</i>' + s.txt + '</span></td></tr>';
      }).join('') + '</tbody></table><p class="pn-nota">Em dia: até ' + PRAZO.emDia + ' dias · atenção: até ' + PRAZO.atencao + ' · desatualizada: mais de ' + PRAZO.atencao + '.</p>';
  }

  // Colunas por dia (últimos 30 dias): tudo o que entrou no histórico (obras + jurisdição) que a pessoa pode ver.
  function renderAtividade() {
    var dias = [], por = {}, hoje = new Date();
    for (var i = DIAS - 1; i >= 0; i--) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i);
      var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      dias.push(k); por[k] = 0;
    }
    historico.forEach(function(h) {
      var x = new Date(h.quando);
      var k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
      if (k in por) por[k]++;
    });
    var max = Math.max.apply(null, dias.map(function(k) { return por[k]; }).concat(1));
    var total = dias.reduce(function(s, k) { return s + por[k]; }, 0);
    var picos = dias.filter(function(k) { return por[k] === max && max > 0; });
    $('gAtividade').innerHTML = '<div class="pn-colunas">' + dias.map(function(k) {
      return '<span class="pn-col" data-dica="' + esc(fmtData(k) + '|' + num(por[k]) + ' alteraç' + (por[k] === 1 ? 'ão' : 'ões')) + '">' +
        '<i style="height:' + (por[k] ? Math.max(4, por[k] / max * 100) : 0) + '%"></i></span>';
    }).join('') + '</div><div class="pn-eixo"><span>' + fmtData(dias[0]).slice(0, 5) + '</span><span>hoje</span></div>' +
      '<p class="pn-nota"><b>' + num(total) + '</b> alterações no período' + (picos.length ? ' · pico de ' + num(max) + ' em ' + fmtData(picos[0]).slice(0, 5) : '') +
      '. Inclui cadastros, edições, traçados e importações.</p>';
  }

  function renderJurisdicao() {
    $('cartaoJur').hidden = !jur.length;
    if (!jur.length) return;
    var por = {}, km = 0;
    jur.forEach(function(r) {
      var s = r.situacao || '(sem situação)';
      por[s] = por[s] || { n: 0, km: 0 };
      por[s].n++; por[s].km += Number(r.extensao_km) || 0; km += Number(r.extensao_km) || 0;
    });
    var emAnalise = (por['EM ANÁLISE'] || { n: 0 }).n;
    $('kpisJur').innerHTML = [[num(jur.length), 'processos'], [num(km), 'km envolvidos'], [num(emAnalise), 'em análise']].map(function(k) {
      return '<div class="pn-kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>';
    }).join('');
    var pares = Object.keys(por).sort(function(a, b) { return por[b].n - por[a].n; });
    var max = Math.max.apply(null, pares.map(function(s) { return por[s].n; }).concat(1));
    $('gJur').innerHTML = pares.map(function(s) {
      return '<div class="pn-linha pn-linha-larga"><span class="pn-rotulo" title="' + esc(s) + '">' + esc(s) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (por[s].n / max * 100) + '%"><i style="flex:1;background:#5b6b8c" data-dica="' +
        esc(s + '|' + num(por[s].n) + ' processos · ' + num(por[s].km, 1) + ' km') + '"></i></span>' +
        '<span class="pn-valor">' + num(por[s].n) + ' <small>· ' + num(por[s].km) + ' km</small></span></span></div>';
    }).join('');
  }

  // ---------- Avisos e aprovações ----------
  // Quem decide depende do perfil de quem propôs (guardado na proposta); ninguém decide a própria.
  function podeDecidir(x) { return x.p.situacao === 'pendente' && Acesso.podeAprovar(x.area, x.p.perfil_autor, x.p.criado_por); }
  function aprovaAlgo() { return perfil.admin || Object.keys(perfil.areas).some(Acesso.aprovaNaArea); }
  function nomeArea(a) { return a === 'JURISDICAO' ? 'Jurisdição' : a; }
  function linkArea(a) { return a === 'JURISDICAO' ? 'mapa.html?modulo=jurisdicao&tabela=dividida' : 'mapa.html?origem=' + encodeURIComponent(a) + '&tabela=dividida'; }

  function tituloCampo(fonte, c) {
    if (c === 'geom') return 'Traçado';
    if (c === 'vinculos') return 'Trechos da malha';
    var lista = fonte === 'obras' ? CAMPOS_OBRA : CAMPOS;
    var x = lista.find(function(k) { return k.campo === c; });
    return x ? x.titulo : c;
  }
  function textoValor(c, v) {
    if (v == null || v === '') return '';
    if (c === 'geom') return typeof v === 'string' ? (/POINT/.test(v) ? 'ponto' : 'desenho') : (v.type === 'Point' ? 'ponto' : 'desenho') + ' alterado';
    if (c === 'vinculos') return v.length + ' trecho' + (v.length === 1 ? '' : 's');
    if (c === 'data_referencia') return fmtData(v);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  var CAMADA_NOME = { extra_base: 'Malha complementar', geo_lin_base: 'Linhas genéricas', geo_pt_base: 'Pontos genéricos', geo_pol_base: 'Áreas de estudo' };
  var CAMADA_ACAO = { criar: 'feição nova', alterar: 'alterar', excluir: 'excluir' };
  var FONTE_NOME = { obras: 'Obra', jurisdicao: 'Jurisdição', camadas: 'Camada' };

  // Título, subtítulo e campos (rótulo, antes|null, depois) de uma proposta das três fontes.
  function descrever(x) {
    var p = x.p, r = x.atual, m = p.mudancas || p.dados || {};
    var titulo, sub, campos;
    if (x.fonte === 'camadas') {
      titulo = (CAMADA_NOME[p.camada] || p.camada) + ' · ' + CAMADA_ACAO[p.acao] + (p.geocod ? ' ' + p.geocod : '');
      sub = p.camada === 'extra_base' ? [m.rodovia, m.trecho].filter(Boolean).join(' · ') : (m.NOME || '');
      campos = p.acao === 'excluir' ? [['Feição', null, p.geocod]] : Object.keys(m).filter(function(k) { return m[k]; }).map(function(k) {
        return [{ rodovia: 'Rodovia', trecho: 'Trecho', situacao: 'Situação', NOME: 'Nome', DESCRICAO: 'Descrição' }[k] || k, null, m[k]];
      }).concat([['Desenho', null, 'ver no mapa (tracejado)']]);
      return { titulo: titulo, sub: sub, campos: campos, conflito: false };
    }
    if (x.fonte === 'obras') titulo = p.tipo === 'nova' ? (r ? r.codigo + ' · obra nova' : 'Obra nova')
      : (r ? r.codigo : '(obra)') + (p.tipo === 'exclusao' ? ' · excluir a obra' : p.tipo === 'origem' ? ' · tramitar para ' + m.nova_origem : '');
    else titulo = p.tipo === 'nova' ? (r ? r.codigo + ' · registro novo' : 'Registro novo')
      : p.tipo === 'tramite' ? 'Trâmite · ' + x.registros.map(function(o) { return o.codigo; }).join(', ')
      : p.tipo === 'tramite_exclusao' ? 'Remover trâmite · ' + (r ? r.codigo : '(registro)')
      : (r ? r.codigo : '(registro)') + (p.tipo === 'exclusao' ? ' · excluir o registro' : '');
    sub = x.fonte === 'obras' ? ((r && r.descricao) || m.descricao || '')
      : [(r || m).rodovia, (r || m).municipios].filter(Boolean).join(' — ');
    var comAntes = p.tipo === 'edicao' && p.situacao === 'pendente' && r;
    campos = p.tipo === 'exclusao' ? [['Motivo', null, m.motivo]]
      : p.tipo === 'origem' ? [['Origem', p.origem, m.nova_origem], ['Data · motivo', null, fmtData(m.data) + ' · ' + (m.descricao || '') + (m.sei ? ' · SEI ' + m.sei : '')]]
      : p.tipo === 'tramite' || p.tipo === 'tramite_exclusao'
      ? (p.tipo === 'tramite_exclusao' ? [['Motivo da remoção', m.motivo]] : []).concat([['Data', fmtData(m.data)],
          ['Nova situação', m.situacao || (p.tipo === 'tramite' ? '(mantém)' : '')], ['Descrição', m.descricao], ['Processo SEI', m.processo_sei]])
        .filter(function(l) { return l[1]; }).map(function(l) { return [l[0], null, l[1]]; })
      : Object.keys(m).map(function(c) { return [tituloCampo(x.fonte, c), comAntes ? textoValor(c, r[c]) || '(vazio)' : null, textoValor(c, m[c]) || '(vazio)']; });
    return { titulo: titulo, sub: sub, campos: campos, conflito: p.situacao === 'pendente' && r && p.versao_base != null && r.versao !== p.versao_base };
  }
  function linkProposta(x) { return x.fonte === 'camadas' ? 'mapa.html?proposta_camada=' + x.p.pid : linkArea(x.area); }
  // Nomes dos perfis que decidem a proposta (pelo perfil de quem propôs) + administrador.
  function quemDecide(x) {
    var perfis = perfil.perfis || {}, autor = x.p.perfil_autor || 'editor_basico';
    return Object.keys(perfis).filter(function(c) { return (perfis[c].aprova || []).indexOf(autor) !== -1; })
      .map(function(c) { return perfis[c].nome; }).concat(['administrador']).join(', ');
  }

  function cartaoProposta(x) {
    var p = x.p, d = descrever(x), decide = podeDecidir(x), chave = x.fonte + ':' + p.pid;
    var acoes = '<a class="link" href="' + linkProposta(x) + '">' + (x.fonte === 'camadas' ? 'ver no mapa' : 'abrir no mapa') + '</a>';
    if (p.situacao === 'pendente') {
      if (decide) acoes += '<span class="espaco"></span><button type="button" class="btn" data-recusar="' + chave + '">Recusar</button>' +
        '<button type="button" class="btn btn-primario" data-aprovar="' + chave + '">Aprovar</button>';
      else if (p.criado_por === eu()) acoes += '<span class="espaco"></span><button type="button" class="btn" data-cancelar="' + chave + '">Cancelar proposta</button>';
    }
    var decisao = p.situacao === 'pendente' ? '<div class="pn-autor">Decide: ' + esc(quemDecide(x)) + '</div>'
      : '<div class="pn-decisao pn-decisao-' + p.situacao + '">' + SITUACAO_PROPOSTA[p.situacao] +
        (p.decidido_por && p.decidido_por !== p.criado_por ? ' por ' + esc(nomes[p.decidido_por] || '—') : '') + ' em ' + fmtDataHora(p.decidido_em) +
        (p.motivo ? ' · motivo: ' + esc(p.motivo) : '') + '</div>';
    return '<div class="pn-proposta pn-proposta-' + p.situacao + '">' +
      '<div class="pn-prop-cab"><span class="pn-area">' + esc(nomeArea(x.area)) + '</span><b>' + esc(d.titulo) + '</b> <span class="pn-sub">' + esc(String(d.sub).slice(0, 110)) + '</span></div>' +
      '<div class="pn-autor">Proposta de <b>' + esc(nomes[p.criado_por] || '—') + '</b>' + (p.perfil_autor ? ' (' + esc(Acesso.nomePerfil(p.perfil_autor)) + ')' : '') +
        ' em ' + fmtDataHora(p.criado_em) + '</div>' +
      (d.conflito ? '<div class="pn-conflito">Foi alterado depois desta proposta (versão ' + p.versao_base + ' → ' + x.atual.versao + '). Confira os valores atuais antes de aprovar.</div>' : '') +
      '<div class="pn-campos">' + d.campos.map(function(c) {
        return '<span class="pn-campo">' + esc(c[0]) + '</span>' + (c[1] != null ? '<span class="de">' + esc(c[1]) + '</span><span class="seta">→</span>' : '<span></span><span></span>') +
          '<span class="para">' + esc(c[2]) + '</span>';
      }).join('') + '</div>' + decisao +
      '<div class="pn-recusa" hidden><textarea rows="2" placeholder="Motivo da recusa (o autor vai ver)"></textarea>' +
      '<button type="button" class="btn btn-perigo" data-confirmar-recusa="' + chave + '">Confirmar recusa</button></div>' +
      '<div class="pn-prop-acoes">' + acoes + '</div></div>';
  }

  // ---------- Kanban (aba "Alterações e aprovações") ----------
  var COLUNAS = [['pendente', 'Aguardando aprovação'], ['aprovada', 'Aprovadas'], ['recusada', 'Recusadas'], ['cancelada', 'Canceladas']];
  function idade(d) {
    var dias = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
    return dias <= 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : 'há ' + dias + ' dias';
  }
  function filtrosKanban() {
    var areas = {}, autores = {};
    propostas.forEach(function(x) { areas[x.area] = 1; autores[x.p.criado_por] = nomes[x.p.criado_por] || '—'; });
    function opcoes(sel, primeira, pares) {
      var v = sel.value;
      sel.innerHTML = '<option value="">' + primeira + '</option>' + pares.map(function(p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>'; }).join('');
      sel.value = pares.some(function(p) { return p[0] === v; }) ? v : '';
    }
    opcoes($('kbArea'), 'Todas as áreas', Object.keys(areas).sort().map(function(a) { return [a, nomeArea(a)]; }));
    opcoes($('kbAutor'), 'Todos os autores', Object.keys(autores).map(function(u) { return [u, autores[u]]; }).sort(function(a, b) { return a[1] < b[1] ? -1 : 1; }));
  }
  function renderKanban() {
    var termo = $('kbBusca').value.trim().toLowerCase(), area = $('kbArea').value, fonte = $('kbFonte').value, autor = $('kbAutor').value, meu = $('kbMeu').checked;
    var lista = propostas.filter(function(x) {
      if (area && x.area !== area) return false;
      if (fonte && x.fonte !== fonte) return false;
      if (autor && x.p.criado_por !== autor) return false;
      if (meu && !podeDecidir(x)) return false;
      if (termo) { var d = descrever(x); if ((d.titulo + ' ' + d.sub + ' ' + (nomes[x.p.criado_por] || '')).toLowerCase().indexOf(termo) === -1) return false; }
      return true;
    });
    var paraMim = propostas.filter(podeDecidir).length;
    $('contKanban').hidden = !paraMim;
    $('contKanban').textContent = paraMim;
    $('kbResumo').textContent = lista.length + ' de ' + propostas.length + ' · ' + (paraMim ? paraMim + ' para você decidir' : 'nada para você decidir');
    $('kanban').innerHTML = COLUNAS.map(function(col) {
      var itens = lista.filter(function(x) { return x.p.situacao === col[0]; }).sort(function(a, b) {
        if (col[0] === 'pendente') { var da = podeDecidir(a), db = podeDecidir(b); if (da !== db) return da ? -1 : 1; return a.p.criado_em < b.p.criado_em ? -1 : 1; }
        return (a.p.decidido_em || '') < (b.p.decidido_em || '') ? 1 : -1;
      });
      return '<section class="pn-kb-coluna pn-kb-' + col[0] + '"><h4>' + col[1] + ' <span>' + itens.length + '</span></h4><div class="pn-kb-lista">' +
        (itens.length ? itens.map(function(x) {
          var p = x.p, d = descrever(x), minha = podeDecidir(x);
          return '<button type="button" class="pn-kb-cartao' + (minha ? ' para-mim' : '') + '" data-kb="' + x.fonte + ':' + p.pid + '">' +
            '<span class="pn-kb-cab"><span class="pn-area">' + esc(nomeArea(x.area)) + '</span>' +
              (x.fonte === 'jurisdicao' ? '' : '<span class="pn-kb-tipo pn-kb-' + x.fonte + '">' + FONTE_NOME[x.fonte] + '</span>') +
              (minha ? '<span class="pn-kb-meu">para você</span>' : p.criado_por === eu() ? '<span class="pn-kb-sua">sua</span>' : '') + '</span>' +
            '<b>' + esc(d.titulo) + '</b>' + (d.sub ? '<span class="pn-sub">' + esc(String(d.sub).slice(0, 80)) + '</span>' : '') +
            '<small>' + esc(nomes[p.criado_por] || '—') + (p.perfil_autor ? ' · ' + esc(Acesso.nomePerfil(p.perfil_autor)) : '') + ' · ' + idade(p.criado_em) + '</small>' +
            (col[0] === 'pendente' ? '<small class="pn-kb-decide">Decide: ' + esc(quemDecide(x)) + '</small>'
              : '<small>' + esc(SITUACAO_PROPOSTA[p.situacao]) + (p.decidido_por && p.decidido_por !== p.criado_por ? ' por ' + esc(nomes[p.decidido_por] || '—') : '') + ' · ' + idade(p.decidido_em) + '</small>') +
            (d.conflito ? '<small class="pn-kb-conflito">alterado depois da proposta</small>' : '') + '</button>';
        }).join('') : '<div class="vazio">Nada aqui.</div>') + '</div></section>';
    }).join('');
  }
  function abrirProposta(chave) {
    var x = propostas.find(function(y) { return y.fonte + ':' + y.p.pid === chave; });
    if (!x) return;
    $('dlgPropostaTitulo').textContent = FONTE_NOME[x.fonte] + ' · ' + nomeArea(x.area);
    $('dlgPropostaCorpo').innerHTML = cartaoProposta(x);
    if (!$('dlgProposta').open) $('dlgProposta').showModal();
  }

  function aviso(tipo, titulo, texto, link) {
    return '<div class="pn-aviso pn-aviso-' + tipo + '"><i>' + (tipo === 'ok' ? '✓' : '!') + '</i><div><b>' + titulo + '</b>' +
      (texto ? '<span>' + texto + '</span>' : '') + '</div>' + (link ? '<a class="link" href="' + link[0] + '">' + link[1] + '</a>' : '') + '</div>';
  }

  function renderAvisos() {
    var html = '';
    var pendentes = propostas.filter(function(x) { return x.p.situacao === 'pendente'; });
    var paraDecidir = pendentes.filter(podeDecidir);
    var minhas = propostas.filter(function(x) { return x.p.criado_por === eu(); });
    var soAcompanha = pendentes.filter(function(x) { return !podeDecidir(x) && x.p.criado_por !== eu(); });

    // 1. Aprovações (quem aprova o perfil do autor: pleno, gerenciador, administrador...)
    if (paraDecidir.length) {
      html += '<h3 class="pn-subtitulo">Para você aprovar (' + paraDecidir.length + ')</h3>' + paraDecidir.map(cartaoProposta).join('');
    } else if (aprovaAlgo()) {
      html += aviso('ok', 'Nenhuma proposta aguardando a sua aprovação.');
    }
    // 2. Propostas da própria pessoa
    if (minhas.length) {
      html += '<h3 class="pn-subtitulo">Minhas propostas <small>pendentes e decididas nos últimos ' + DIAS + ' dias</small></h3>' + minhas.map(cartaoProposta).join('');
    }
    // 3. Quem só acompanha (diretor, ou propostas que cabem a outro perfil): quantas estão paradas em cada área
    if (soAcompanha.length) {
      var porArea = {};
      soAcompanha.forEach(function(x) { porArea[x.area] = (porArea[x.area] || 0) + 1; });
      html += Object.keys(porArea).map(function(a) {
        var mais = soAcompanha.filter(function(x) { return x.area === a; }).sort(function(p, q) { return p.p.criado_em < q.p.criado_em ? -1 : 1; })[0];
        return aviso('atencao', porArea[a] + ' proposta' + (porArea[a] > 1 ? 's' : '') + ' aguardando aprovação · ' + esc(nomeArea(a)),
          'A mais antiga é de ' + fmtData(mais.p.criado_em.slice(0, 10)) + ' (' + esc(nomes[mais.p.criado_por] || '—') + ').', [linkArea(a), 'abrir no mapa']);
      }).join('');
    }
    // 4. Dados atrasados: o aviso aparece a partir de "atenção" e só some quando a origem atualizar a data de referência
    //    (não tem prazo nem botão de dispensar).
    var linhas = atualizacaoPorOrigem();
    [['atrasada', 'desatualizados', function(l) { return l.dias == null || l.dias > PRAZO.atencao; }, 'mais de ' + PRAZO.atencao + ' dias'],
     ['atencao', 'precisando de atualização', function(l) { return l.dias != null && l.dias > PRAZO.emDia && l.dias <= PRAZO.atencao; }, 'entre ' + (PRAZO.emDia + 1) + ' e ' + PRAZO.atencao + ' dias']
    ].forEach(function(g) {
      var lista = linhas.filter(g[2]);
      if (!lista.length) return;
      html += aviso(g[0] === 'atrasada' ? 'grave' : 'atencao', lista.length + ' origem' + (lista.length > 1 ? 'ns' : '') + ' com dados ' + g[1],
        lista.map(function(l) { return '<b>' + esc(l.origem.codigo) + '</b> ' + (l.data ? fmtData(l.data) + ' (' + num(l.dias) + ' dias)' : 'sem data'); }).join(' · ') +
        '. Data de referência há ' + g[3] + '. O aviso fica até a origem atualizar os dados.');
    });
    // 5. Contas (administrador)
    if (contas) {
      var inativas = contas.filter(function(u) { return !u.ativo; }), senha = contas.filter(function(u) { return u.ativo && u.trocar_senha; });
      if (inativas.length) html += aviso('atencao', inativas.length + ' conta' + (inativas.length > 1 ? 's' : '') + ' inativa' + (inativas.length > 1 ? 's' : ''),
        inativas.map(function(u) { return esc(u.nome); }).join(', ') + '. Ative e escolha os perfis.', ['usuarios.html', 'Usuários e permissões']);
      if (senha.length) html += aviso('info', senha.length + ' pessoa' + (senha.length > 1 ? 's' : '') + ' ainda com senha provisória',
        senha.map(function(u) { return esc(u.nome); }).join(', ') + ' (ainda não entrou para criar a própria senha).');
    }
    $('listaAvisos').innerHTML = html || aviso('ok', 'Nenhum aviso no momento.');
  }

  function rpcDe(fonte) { return fonte === 'jurisdicao' ? sbJur : sb; }
  // Obras e jurisdição: aprovar_proposta, recusar_proposta, cancelar_proposta; camadas: aprovar_camada...
  function rpcNome(fonte, acao) { return acao + (fonte === 'camadas' ? '_camada' : '_proposta'); }
  function separar(v) { var i = v.indexOf(':'); return { fonte: v.slice(0, i), pid: Number(v.slice(i + 1)) }; }
  function depoisDeDecidir(msg) {
    toast(msg);
    if ($('dlgProposta').open) $('dlgProposta').close();
    return carregar().then(function() { renderFiltros(); renderResumo(); renderAvisos(); filtrosKanban(); renderKanban(); });
  }
  function aprovar(v, forcar) {
    var x = separar(v);
    rpcDe(x.fonte).rpc(rpcNome(x.fonte, 'aprovar'), { p_pid: x.pid, p_forcar: !!forcar }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      return depoisDeDecidir('Proposta aprovada');
    }).catch(function(e) {
      if (/CONFLITO/.test(e.message) && confirm(e.message.replace('CONFLITO: ', '') + '.\n\nAprovar mesmo assim? Os campos da proposta sobrescrevem os valores atuais.')) return aprovar(v, true);
      toast(e.message, true);
    });
  }
  function aoClicarAvisos(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aprovar) return aprovar(b.dataset.aprovar);
    if (b.dataset.recusar) { var caixa = b.closest('.pn-proposta').querySelector('.pn-recusa'); caixa.hidden = false; caixa.querySelector('textarea').focus(); return; }
    if (b.dataset.confirmarRecusa) {
      var motivo = b.closest('.pn-recusa').querySelector('textarea').value.trim();
      if (!motivo) { toast('Escreva o motivo da recusa', true); return; }
      var x = separar(b.dataset.confirmarRecusa);
      return rpcDe(x.fonte).rpc(rpcNome(x.fonte, 'recusar'), { p_pid: x.pid, p_motivo: motivo }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return depoisDeDecidir('Proposta recusada');
      }).catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.cancelar) {
      if (!confirm('Cancelar esta proposta?')) return;
      var y = separar(b.dataset.cancelar);
      return rpcDe(y.fonte).rpc(rpcNome(y.fonte, 'cancelar'), { p_pid: y.pid }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return depoisDeDecidir('Proposta cancelada');
      }).catch(function(err) { toast(err.message, true); });
    }
  }

  // ---------- Configurações (administrador) ----------
  var contas = null, areasAdm = [], camadasAdm = [], perfisAdm = [];
  function carregarContas() {
    if (!perfil.admin) return Promise.resolve();
    return sb.rpc('admin_usuarios').then(dados).then(function(d) {
      contas = d.usuarios; areasAdm = d.areas; camadasAdm = d.camadas || []; perfisAdm = d.perfis || [];
      contas.forEach(function(u) { u.camadas = u.camadas || []; });
    });
  }
  function perfilAdm(codigo) { return perfisAdm.find(function(f) { return f.codigo === codigo; }) || null; }
  // Sigla da matriz: iniciais do nome ("Editor básico" -> EB, "Diretor" -> D).
  function sigla(f) { return f ? f.nome.split(/\s+/).map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 3) : '?'; }
  var CORES_PERFIL = ['#475569', '#7c3aed', '#92400e', '#166534', '#1d4ed8', '#be185d', '#0e7490', '#b45309'];
  function corPerfil(codigo) { var i = perfisAdm.findIndex(function(f) { return f.codigo === codigo; }); return CORES_PERFIL[(i < 0 ? 0 : i) % CORES_PERFIL.length]; }
  function selo(codigo, titulo) {
    var f = perfilAdm(codigo);
    return '<span class="nv nv-perfil" style="--c:' + corPerfil(codigo) + '" title="' + esc(titulo || (f ? f.nome : codigo)) + '">' + esc(sigla(f)) + '</span>';
  }
  function editaCamadas(u) { return u.admin || Object.keys(u.areas).some(function(a) { var f = perfilAdm(u.areas[a]); return f && f.camadas; }); }

  // ---------- Perfis de acesso ----------
  var CHAVES = [['exportar', 'Exporta e imprime'], ['propor', 'Propõe edições'], ['gravar', 'Grava direto'], ['camadas', 'Edita camadas']];
  function renderPerfis() {
    var master = !!perfil.master;
    $('perfisSub').textContent = master ? 'o que cada perfil pode fazer · cada pessoa recebe um perfil por área · altere e clique em Salvar'
      : 'o que cada perfil pode fazer · só o administrador master altera';
    function linha(f, novo) {
      var dis = master ? '' : ' disabled';
      // Só faz sentido aprovar quem propõe (os já marcados continuam aparecendo).
      var outros = perfisAdm.filter(function(o) { return o.codigo !== f.codigo && (o.propor || (f.aprova || []).indexOf(o.codigo) !== -1); });
      return '<tr data-perfil="' + esc(f.codigo || '') + '"' + (novo ? ' class="pn-perfil-novo"' : '') + '>' +
        '<td><input class="pn-in" data-c="nome" value="' + esc(f.nome || '') + '" placeholder="Nome do perfil"' + dis + '>' +
        '<textarea class="pn-in" data-c="descricao" rows="3" placeholder="Descrição (aparece para o administrador)"' + dis + '>' + esc(f.descricao || '') + '</textarea></td>' +
        CHAVES.map(function(k) { return '<td class="pn-c"><input type="checkbox" data-c="' + k[0] + '"' + (f[k[0]] ? ' checked' : '') + dis + ' title="' + k[1] + '"></td>'; }).join('') +
        '<td class="pn-aprova">' + (outros.length ? outros.map(function(o) {
          return '<label class="chk"><input type="checkbox" data-aprova="' + esc(o.codigo) + '"' + ((f.aprova || []).indexOf(o.codigo) !== -1 ? ' checked' : '') + dis + '> ' + esc(o.nome) + '</label>';
        }).join('') : '—') + '</td>' +
        '<td class="pn-c">' + (novo ? '—' : num(f.em_uso)) + '</td>' +
        '<td class="pn-c">' + (master ? '<button type="button" class="btn btn-primario" data-salvar-perfil>' + (novo ? 'Criar' : 'Salvar') + '</button>' +
          (!novo && !f.em_uso ? ' <button type="button" class="btn" data-excluir-perfil title="Excluir (só perfil sem uso)">Excluir</button>' : '') : '') + '</td></tr>';
    }
    $('perfis').innerHTML = '<table class="pn-tabela pn-perfis"><thead><tr><th>Perfil</th>' + CHAVES.map(function(k) { return '<th class="pn-c">' + k[1] + '</th>'; }).join('') +
      '<th>Aprova as propostas de</th><th class="pn-c">Em uso</th><th></th></tr></thead><tbody>' +
      perfisAdm.map(function(f) { return linha(f, false); }).join('') +
      (master ? linha({ nome: '', descricao: '', aprova: [] }, true) : '') + '</tbody></table>' +
      '<p class="pn-nota">Todos os perfis veem os dados das áreas liberadas. <b>Propõe</b>: edita, exclui e tramita, mas tudo vai para aprovação; ' +
      '<b>grava direto</b>: dispensa a aprovação. <b>Aprova as propostas de</b>: decide as propostas de quem tem aqueles perfis, na mesma área ' +
      '(ninguém aprova a própria). <b>Edita camadas</b>: as camadas que o administrador liberar abaixo e, na Jurisdição, a malha complementar.</p>';
  }
  function codigoNovo(nome) {
    var base = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p_$1').slice(0, 30) || 'perfil';
    var c = base, n = 2;
    while (c === 'admin' || perfilAdm(c)) c = base + '_' + n++;
    return c;
  }
  function aoClicarPerfis(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var tr = b.closest('tr'), codigo = tr.dataset.perfil;
    if (b.hasAttribute('data-excluir-perfil')) {
      if (!confirm('Excluir o perfil ' + perfilAdm(codigo).nome + '?')) return;
      return sb.rpc('admin_excluir_perfil', { p_codigo: codigo }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        toast('Perfil excluído');
        return carregarContas().then(renderConfig);
      }).catch(function(err) { toast(err.message, true); });
    }
    if (!b.hasAttribute('data-salvar-perfil')) return;
    var d = { nome: tr.querySelector('[data-c="nome"]').value.trim(), descricao: tr.querySelector('[data-c="descricao"]').value.trim(), aprova: [] };
    if (!d.nome) { toast('Dê um nome ao perfil', true); return; }
    CHAVES.forEach(function(k) { d[k[0]] = tr.querySelector('[data-c="' + k[0] + '"]').checked; });
    tr.querySelectorAll('[data-aprova]:checked').forEach(function(x) { d.aprova.push(x.dataset.aprova); });
    var f = codigo ? perfilAdm(codigo) : null;
    d.ordem = f ? f.ordem : Math.max.apply(null, perfisAdm.map(function(x) { return x.ordem; }).concat(0)) + 1;
    if (f && f.em_uso && !confirm('O perfil ' + f.nome + ' está em uso em ' + f.em_uso + ' permissão(ões). A mudança vale na hora para todas essas pessoas. Salvar?')) return;
    b.disabled = true;
    sb.rpc('admin_salvar_perfil', { p_codigo: codigo || codigoNovo(d.nome), p_dados: d }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      toast(codigo ? 'Perfil ' + d.nome + ' salvo' : 'Perfil ' + d.nome + ' criado');
      return carregarContas().then(renderConfig);
    }).catch(function(err) { b.disabled = false; toast(err.message, true); });
  }
  function renderConfig() { renderPerfis(); renderMatriz(); renderCamadas(); }
  function renderMatriz() {
    var ativos = contas.filter(function(u) { return u.ativo; }).length;
    $('legendaPerfis').innerHTML = perfisAdm.map(function(f) { return selo(f.codigo) + ' ' + esc(f.nome); }).join(' ') + ' <span class="nv nv-admin">ADM</span> administrador';
    $('resumoUsuarios').textContent = contas.length + ' conta' + (contas.length === 1 ? '' : 's') + ' · ' + ativos + ' ativa' + (ativos === 1 ? '' : 's');
    var areas = areasAdm.slice().sort(function(a, b) { return (a.tipo === 'site') - (b.tipo === 'site'); });
    $('matriz').innerHTML = '<table class="pn-tabela pn-matriz"><thead><tr><th>Usuário</th>' +
      areas.map(function(a) { return '<th title="' + esc(a.nome) + '">' + esc(a.codigo === 'JURISDICAO' ? 'JUR' : a.codigo === 'FUNDEINFRA' ? 'FUND' : a.codigo === 'HOSPITAL' ? 'SAÚDE' : a.codigo) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + contas.map(function(u) {
        return '<tr' + (u.ativo ? '' : ' class="inativo"') + '><td><b>' + esc(u.nome) + '</b>' + (u.master ? ' <span class="selo selo-master">master</span>' : u.admin ? ' <span class="selo selo-admin">admin</span>' : '') +
          (u.ativo ? '' : ' <span class="selo selo-inativo">inativa</span>') + '<small>' + esc(u.email) + '</small></td>' +
          areas.map(function(a) {
            if (u.admin) return '<td><span class="nv nv-admin" title="administrador">ADM</span></td>';
            var n = u.areas[a.codigo], f = perfilAdm(n);
            return '<td>' + (n ? selo(n, a.nome + ': ' + (f ? f.nome : n)) : '<span class="nv-nada">·</span>') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  // Camadas editáveis: uma linha por pessoa com perfil que edita camadas (em alguma área); administradores editam todas.
  function renderCamadas() {
    var camadas = camadasAdm;
    var plenos = contas.filter(editaCamadas);
    if (!camadas.length) { $('camadasEdicao').innerHTML = '<div class="vazio">Camadas editáveis ainda não instaladas no banco.</div>'; return; }
    $('camadasEdicao').innerHTML = '<table class="pn-tabela pn-matriz pn-camadas"><thead><tr><th>Quem edita camadas</th>' +
      camadas.map(function(c) { return '<th title="' + esc(c.codigo) + '">' + esc(c.nome) + '<small>' + esc(c.geometria) + '</small></th>'; }).join('') +
      '</tr></thead><tbody>' + (plenos.length ? plenos.map(function(u) {
        var plenoEm = Object.keys(u.areas).filter(function(a) { var f = perfilAdm(u.areas[a]); return f && f.camadas; });
        return '<tr' + (u.ativo ? '' : ' class="inativo"') + '><td><b>' + esc(u.nome) + '</b>' + (u.admin ? ' <span class="selo selo-admin">admin</span>' : '') +
          '<small>' + (u.admin ? 'administrador: edita todas' : 'edita camadas em ' + esc(plenoEm.map(nomeArea).join(', '))) + '</small></td>' +
          camadas.map(function(c) {
            var fj = perfilAdm(u.areas.JURISDICAO), pelaJur = c.codigo === 'extra_base' && !!(fj && fj.camadas);
            var marcado = u.admin || pelaJur || u.camadas.indexOf(c.codigo) !== -1;
            var travado = u.admin || pelaJur;
            return '<td><input type="checkbox" data-camada-user="' + u.user_id + '" data-camada="' + esc(c.codigo) + '"' + (marcado ? ' checked' : '') + (travado ? ' disabled data-travado' : '') +
              ' title="' + esc(u.admin ? 'Administrador edita todas' : pelaJur ? 'Já liberada pelo perfil na Jurisdição' : c.nome) + '"></td>';
          }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (camadas.length + 1) + '"><div class="vazio">Ninguém com perfil que edita camadas ainda. Dê esse perfil em alguma área (Usuários e permissões).</div></td></tr>') +
      '</tbody></table>';
  }
  function salvarCamadas(input) {
    var id = input.dataset.camadaUser, u = contas.find(function(x) { return x.user_id === id; });
    // Manda sempre a linha inteira (as travadas, de admin e da Jurisdição, não entram): cliques seguidos não se perdem.
    var lista = Array.prototype.map.call(document.querySelectorAll('[data-camada-user="' + id + '"]:checked:not([data-travado])'), function(x) { return x.dataset.camada; });
    sb.rpc('admin_salvar_camadas', { p_user_id: id, p_camadas: lista }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      u.camadas = lista;
      toast('Camadas de ' + u.nome + ' salvas: ' + (lista.length ? lista.length + ' camada(s)' : 'nenhuma'));
    }).catch(function(e) {
      input.checked = !input.checked;
      toast(e.message, true);
    });
  }

  var EVENTO = { acesso: 'entrou', saiu: 'saiu', exportou: 'exportou', acesso_negado: 'acesso negado' };
  function renderAcessos() {
    $('acessos').innerHTML = '<div class="vazio">Carregando…</div>';
    sb.from('acessos').select('quando,usuario_nome,email,evento,detalhe').order('quando', { ascending: false }).limit(50).then(dados).then(function(linhas) {
      $('acessos').innerHTML = linhas.length ? '<table class="pn-tabela"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>' +
        linhas.map(function(a) {
          return '<tr><td>' + fmtDataHora(a.quando) + '</td><td>' + esc(a.usuario_nome || a.email) + '</td><td>' + esc(EVENTO[a.evento] || a.evento) + '</td><td>' + esc(a.detalhe || '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="vazio">Nenhum acesso registrado.</div>';
    }).catch(function(e) { $('acessos').innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; });
  }

  // ---------- Dica (tooltip) dos gráficos ----------
  function ligarDica() {
    var dica = $('dica');
    function mostrar(el, x, y) {
      var partes = el.getAttribute('data-dica').split('|');
      dica.textContent = '';
      var t = document.createElement('small'); t.textContent = partes[0]; dica.appendChild(t);
      var v = document.createElement('b'); v.textContent = partes[1] || ''; dica.appendChild(v);
      if (partes[2]) { var d = document.createElement('span'); d.textContent = partes[2]; dica.appendChild(d); }
      dica.hidden = false;
      var w = dica.offsetWidth, h = dica.offsetHeight;
      dica.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
      dica.style.top = Math.max(8, y - h - 12) + 'px';
    }
    document.addEventListener('pointermove', function(e) {
      var el = e.target.closest && e.target.closest('[data-dica]');
      if (el) mostrar(el, e.clientX, e.clientY); else dica.hidden = true;
    });
    document.addEventListener('scroll', function() { dica.hidden = true; }, true);
  }

  // ---------- Início ----------
  // "Gerenciador · DOR, DPL" ou, com perfis diferentes, "Gerenciador (3 áreas) · Diretor (JUR)".
  function papel() {
    if (perfil.master) return 'Administrador master';
    if (perfil.admin) return 'Administrador';
    var por = {};
    Object.keys(perfil.areas).forEach(function(a) { (por[perfil.areas[a]] = por[perfil.areas[a]] || []).push(a); });
    var cods = Object.keys(por).sort(function(a, b) { return por[b].length - por[a].length; });
    function areas(l) { return l.length > 4 ? l.length + ' áreas' : l.map(nomeArea).join(', '); }
    return cods.length === 1 ? Acesso.nomePerfil(cods[0]) + ' · ' + areas(por[cods[0]])
      : cods.map(function(c) { return Acesso.nomePerfil(c) + ' (' + areas(por[c]) + ')'; }).join(' · ');
  }

  Acesso.pronto.then(function(p) {
    perfil = p;
    var libera = p.admin || Object.keys(p.areas).some(function(a) { return Acesso.podeExportar(a) || Acesso.aprovaNaArea(a); });
    if (!libera) { $('restrito').hidden = false; return; }
    $('painel').hidden = false;
    $('papel').textContent = papel();
    $('abaBotaoConfig').hidden = !p.admin;
    $('kpis').innerHTML = '<div class="vazio">Carregando…</div>';
    ligarDica();
    $('filtros').addEventListener('click', function(e) { var b = e.target.closest('[data-origem]'); if (b) { filtro = ''; filtrar(b.dataset.origem); } });
    $('gEtapas').addEventListener('click', function(e) { var b = e.target.closest('[data-origem]'); if (b) filtrar(b.dataset.origem); });
    $('listaAvisos').addEventListener('click', aoClicarAvisos);
    document.querySelectorAll('.adm-abas button').forEach(function(b) {
      b.addEventListener('click', function() {
        document.querySelectorAll('.adm-abas button').forEach(function(x) { x.classList.toggle('ativo', x === b); });
        $('abaGeral').hidden = b.dataset.aba !== 'geral';
        $('abaKanban').hidden = b.dataset.aba !== 'kanban';
        $('abaConfig').hidden = b.dataset.aba !== 'config';
        if (b.dataset.aba === 'kanban') carga.then(function() { filtrosKanban(); renderKanban(); });
        if (b.dataset.aba === 'config') carga.then(function() { renderConfig(); renderAcessos(); });
      });
    });
    $('camadasEdicao').addEventListener('change', function(e) { if (e.target.dataset.camadaUser) salvarCamadas(e.target); });
    $('perfis').addEventListener('click', aoClicarPerfis);
    $('kanban').addEventListener('click', function(e) { var c = e.target.closest('[data-kb]'); if (c) abrirProposta(c.dataset.kb); });
    $('kbFiltros').addEventListener('input', renderKanban);
    $('kbFiltros').addEventListener('change', renderKanban);
    $('dlgPropostaCorpo').addEventListener('click', aoClicarAvisos);
    $('dlgProposta').addEventListener('click', function(e) { if (e.target.closest('[data-fechar-dlg]') || e.target === this) this.close(); });
    // Atalho: painel.html#aprovacoes abre direto o kanban.
    function irKanban() { if (location.hash === '#aprovacoes') document.querySelector('.adm-abas button[data-aba="kanban"]').click(); }
    window.addEventListener('hashchange', irKanban);
    var carga = Promise.all([carregar(), carregarContas()]);   // a aba Configurações espera por ela
    irKanban();   // depois da carga começar: a aba espera por ela
    return carga.then(function() {
      renderFiltros();
      renderResumo();
      renderAvisos();
      filtrosKanban();
      renderKanban();
    });
  }).catch(function(e) { toast('Erro ao carregar o painel: ' + e.message, true); });
})();
