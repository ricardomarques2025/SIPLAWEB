// Dados da tabela de obras (schema siplaweb). As edicoes ficam PENDENTES no navegador ate o editor
// "Revisar e salvar"; a gravacao confere a versao de cada obra (se outra pessoa gravou antes, aquela obra e
// recusada e recarregada; nada e sobrescrito em silencio). O banco valida tudo de novo e guarda o historico.
// Perfil que propoe sem gravar direto (js/acesso.js; editor basico e pleno): o mesmo "salvar" vira PROPOSTA
// (siplaweb.propor / propor_nova), assim como excluir e mudar de origem (propor_exclusao / propor_origem); quem
// aprova depende do perfil de quem propos (o pleno aprova o basico, o gerenciador os dois). Ate la a obra nao muda.

var ObrasStore = (function() {
  var sb = Acesso.cliente;   // schema siplaweb
  var EDITAVEIS = CAMPOS_OBRA.filter(function(c) { return !c.somenteLeitura; }).map(function(c) { return c.campo; });
  var COLUNAS = ['uid', 'codigo', 'versao', 'atualizado_em', 'atualizado_por', 'origem', 'tipo', 'natureza', 'vinculos', 'geom',
    'grupo:grupos(codigo)', 'pge_eixo', 'pge_etapa', 'pge_item'].concat(EDITAVEIS).join(',');   // pge_*: calculados (027)
  var POR_PAGINA = 1000;

  var origem = null;
  var registros = new Map();    // uid -> obra
  var pendentes = new Map();    // uid -> { campo: valor novo }
  var listas = {};              // campo -> [valores]
  var nomes = new Map();        // user_id -> nome
  var propostas = [];           // da origem: pendentes + decididas nos ultimos 30 dias (mais nova primeiro)
  var ouvintes = [];

  // Tabelas FUNDEINFRA e TARE (17/11/2026): são filtros das obras da DOR e da DPJ pela fonte do recurso
  // (Acesso.filtrosFonte), só para consulta; editar, propor e aprovar continuam na origem de cada obra. As obras
  // antigas das origens FUNDEINFRA e TARE (backup) não entram.
  function ehFiltro() { return Acesso.ehFiltroFonte(origem); }
  // Grupo de origens (PGE, 18/11/2026): tabela única EDITÁVEL com as obras das origens do grupo; cada obra é gravada,
  // proposta e aprovada pela origem dela (o banco aceita quem tem a área do grupo: script 028).
  function ehGrupo() { return Acesso.ehGrupoOrigens(origem); }
  function daTabela(o) { return ehFiltro() ? Acesso.ehObraDoFiltro(origem, o) : Acesso.origensDoGrupo(origem).indexOf(o.origem) !== -1; }
  function modoProposta() { return !ehFiltro() && Acesso.podePropor(origem) && !Acesso.podeEditar(origem); }
  // Linha do tempo (js/linha_tempo.js): { codigo: [etapa, status] } da data escolhida; null = hoje.
  // Na data passada a tabela mostra só as obras que existiam, com a etapa/status de então, e fica só leitura.
  var visao = null;
  function definirVisao(v) { visao = v || null; emitir('visao'); }
  function emitir(evento, uid) { ouvintes.forEach(function(fn) { fn(evento, uid); }); }
  function erro(e) { return new Error(String((e && e.message) || e)); }
  // Vinculos (lista) e geom (GeoJSON) comparam pelo conteudo; lista vazia = sem vinculo.
  function normalizar(v) {
    if (Array.isArray(v)) return v.length ? JSON.stringify(v.slice().sort()) : null;
    if (v && typeof v === 'object') return JSON.stringify({ type: v.type, coordinates: v.coordinates });
    return v === null || v === undefined || v === '' ? null : String(v);
  }
  // O banco recebe a geometria em EWKT (SRID 4674); a leitura volta em GeoJSON.
  function paraEwkt(g) {
    if (!g) return null;
    if (g.type === 'Point') return 'SRID=4674;POINT(' + g.coordinates[0] + ' ' + g.coordinates[1] + ')';
    throw new Error('Só o ponto pode ser desenhado pelo site');
  }
  function erroTracado(campo, valor) {
    if (campo !== 'geom' || !valor) return '';
    return validarPontoObra(valor.coordinates[1], valor.coordinates[0]);
  }

  function guardar(linha) {
    var r = Object.assign({}, linha);
    r.grupo_codigo = r.grupo ? r.grupo.codigo : null;
    delete r.grupo;
    registros.set(r.uid, r);
    return r;
  }

  function carregar(codigoOrigem) {
    origem = codigoOrigem;
    var linhas = [];
    function pagina(inicio) {
      var q = sb.from('obras').select(COLUNAS);
      var F = Acesso.filtrosFonte[origem];
      q = ehFiltro() ? q.in('origem', F.origens).in('fonte', F.fontes) : q.in('origem', Acesso.origensDoGrupo(origem));
      return q.is('excluido_em', null).order('codigo')
        .range(inicio, inicio + POR_PAGINA - 1)
        .then(function(res) {
          if (res.error) throw erro(res.error);
          linhas = linhas.concat(res.data);
          return res.data.length === POR_PAGINA ? pagina(inicio + POR_PAGINA) : linhas;
        });
    }
    return Promise.all([
      pagina(0),
      sb.from('listas').select('campo,valor').eq('ativo', true).order('campo').order('ordem'),
      sb.rpc('nomes'),
      carregarPropostas()
    ]).then(function(r) {
      registros = new Map();
      pendentes = new Map();
      r[0].forEach(guardar);
      listas = {};
      (r[1].data || []).forEach(function(l) { (listas[l.campo] = listas[l.campo] || []).push(l.valor); });
      nomes = new Map((r[2].data || []).map(function(n) { return [n.user_id, n.nome]; }));
      emitir('carregado');
    });
  }

  function carregarPropostas() {
    if (ehFiltro()) { propostas = []; emitir('propostas'); return Promise.resolve(); }
    var desde = new Date(Date.now() - 30 * 864e5).toISOString();
    return sb.from('propostas').select('*').in('origem', Acesso.origensDoGrupo(origem)).or('situacao.eq.pendente,decidido_em.gte.' + desde)
      .order('pid', { ascending: false }).limit(300)
      .then(function(res) { if (res.error) throw erro(res.error); propostas = res.data; emitir('propostas'); });
  }
  function propostaPendente(uid, tipos) {
    tipos = tipos || ['edicao'];
    return propostas.find(function(p) { return p.obra_uid === uid && p.situacao === 'pendente' && tipos.indexOf(p.tipo) !== -1; }) || null;
  }
  // Quem decide esta proposta: depende do perfil de quem propos (guardado na proposta).
  function podeDecidir(p) { return !visao && !ehFiltro() && Acesso.podeAprovar(p.origem || origem, p.perfil_autor, p.criado_por); }

  function recarregarObra(uid) {
    return sb.from('obras').select(COLUNAS + ',excluido_em').eq('uid', uid).maybeSingle().then(function(res) {
      if (res.error) throw erro(res.error);
      if (!res.data || res.data.excluido_em || !daTabela(res.data)) { registros.delete(uid); pendentes.delete(uid); return null; }
      delete res.data.excluido_em;
      return guardar(res.data);
    });
  }

  // ---------- Pendencias ----------
  function definirPendente(uid, campo, valor) {
    var r = registros.get(uid);
    if (!r) return;
    var p = pendentes.get(uid) || {};
    if (normalizar(r[campo]) === normalizar(valor)) delete p[campo];
    else p[campo] = valor === '' ? null : Array.isArray(valor) ? valor.slice().sort() : valor;
    if (Object.keys(p).length) pendentes.set(uid, p); else pendentes.delete(uid);
    emitir('pendentes', uid);
  }
  // Sempre booleano: classList.toggle(classe, undefined) inverteria a marcacao em vez de desligar.
  function pendente(uid, campo) { var p = pendentes.get(uid); return !!(p && Object.prototype.hasOwnProperty.call(p, campo)); }
  function valorAtual(uid, campo) {
    if (visao && (campo === 'etapa' || campo === 'status')) { var r0 = registros.get(uid), v = r0 && visao[r0.codigo]; if (v) return campo === 'etapa' ? v[0] : v[1]; }
    var p = pendentes.get(uid); return p && Object.prototype.hasOwnProperty.call(p, campo) ? p[campo] : (registros.get(uid) || {})[campo]; }
  function totalPendentes() { var n = 0; pendentes.forEach(function(p) { n += Object.keys(p).length; }); return n; }
  function descartar() { pendentes = new Map(); emitir('pendentes'); }

  // Lista das mudancas para a tela de conferencia, com o resultado da validacao de cada campo.
  function resumoPendentes() {
    var itens = [];
    pendentes.forEach(function(p, uid) {
      var r = registros.get(uid);
      var campos = Object.keys(p).map(function(campo) {
        return { campo: campo, antes: r[campo], depois: p[campo], erro: validarCampoObra(campo, p[campo], listas) || erroTracado(campo, p[campo]) };
      });
      itens.push({ uid: uid, codigo: r.codigo, descricao: r.descricao, campos: campos,
        mudaSituacao: campos.some(function(c) { return c.campo === 'etapa' || c.campo === 'status'; }) });
    });
    return itens.sort(function(a, b) { return a.codigo < b.codigo ? -1 : 1; });
  }

  // Grava todas as pendencias. dataFato vira a data de referencia das obras que mudaram etapa/status
  // (e a data na linha do tempo), a nao ser que a propria data de referencia tenha sido editada.
  function salvar(dataFato) {
    var itens = resumoPendentes();
    var resultado = { gravadas: [], recusadas: [], proposta: modoProposta() };
    var espelhadas = {};   // obras vinculadas/desvinculadas (o banco as altera também: script 026)
    return itens.reduce(function(fila, item) {
      return fila.then(function() {
        var r = registros.get(item.uid);
        var mudancas = Object.assign({}, pendentes.get(item.uid));
        if (mudancas.sei) mudancas.sei = String(mudancas.sei).replace(/\D/g, '');
        if (Object.prototype.hasOwnProperty.call(mudancas, 'geom')) mudancas.geom = paraEwkt(mudancas.geom);
        if (item.mudaSituacao && dataFato && !Object.prototype.hasOwnProperty.call(mudancas, 'data_referencia')) mudancas.data_referencia = dataFato;
        if (resultado.proposta) {
          return sb.rpc('propor', { p_obra: item.uid, p_mudancas: mudancas, p_versao: r.versao }).then(function(res) {
            if (res.error) {
              resultado.recusadas.push({ codigo: item.codigo, motivo: res.error.message });
              if (/alterada por outra pessoa/.test(res.error.message)) { pendentes.delete(item.uid); return recarregarObra(item.uid); }
              return;
            }
            pendentes.delete(item.uid);
            resultado.gravadas.push(item.codigo);
          });
        }
        return sb.from('obras').update(mudancas).eq('uid', item.uid).eq('versao', r.versao).select(COLUNAS).then(function(res) {
          if (res.error) { resultado.recusadas.push({ codigo: item.codigo, motivo: res.error.message }); return; }
          if (!res.data.length) {
            resultado.recusadas.push({ codigo: item.codigo, motivo: 'alterada por outra pessoa enquanto você editava; os dados foram atualizados, confira e refaça' });
            pendentes.delete(item.uid);
            return recarregarObra(item.uid);
          }
          if (Object.prototype.hasOwnProperty.call(mudancas, 'obras_vinculadas')) {
            String((r.obras_vinculadas || '') + ';' + (res.data[0].obras_vinculadas || '')).toUpperCase()
              .replace(/OB\d{2}-\d{5,}/g, function(c) { espelhadas[c] = true; return c; });
          }
          guardar(res.data[0]);
          pendentes.delete(item.uid);
          resultado.gravadas.push(item.codigo);
        });
      });
    }, Promise.resolve()).then(function() {
      // A outra obra do vínculo, se for desta mesma tabela, foi alterada pelo banco: relê para não ficar com a versão velha.
      var uids = [];
      registros.forEach(function(o, uid) { if (espelhadas[o.codigo] && !pendentes.has(uid)) uids.push(uid); });
      return Promise.all(uids.map(recarregarObra));
    }).then(function() {
      return resultado.proposta ? carregarPropostas() : null;
    }).then(function() { emitir('salvo'); return resultado; });
  }

  // ---------- Criar / excluir / tramitar ----------
  function criar(dados) {
    var nova = Object.assign({ origem: origem }, dados);   // grupo (PGE): dados.origem vem do eixo escolhido
    if (nova.sei) nova.sei = String(nova.sei).replace(/\D/g, '');
    if (modoProposta()) {
      var origemNova = nova.origem;
      delete nova.origem;
      Object.keys(nova).forEach(function(k) { if (nova[k] === null) delete nova[k]; });
      return sb.rpc('propor_nova', { p_origem: origemNova, p_dados: nova }).then(function(res) {
        if (res.error) throw erro(res.error);
        return carregarPropostas().then(function() { return { proposta: res.data }; });
      });
    }
    return sb.from('obras').insert(nova).select(COLUNAS).single().then(function(res) {
      if (res.error) throw erro(res.error);
      var r = guardar(res.data);
      emitir('criado', r.uid);
      return r;
    });
  }

  // motivo: obrigatorio quando vira proposta (quem aprova le).
  function excluir(uid, motivo) {
    var r = registros.get(uid);
    if (modoProposta()) {
      return sb.rpc('propor_exclusao', { p_obra: uid, p_motivo: motivo || '' }).then(function(res) {
        if (res.error) throw erro(res.error);
        return carregarPropostas().then(function() { return { proposta: res.data }; });
      });
    }
    return sb.from('obras').update({ excluido_em: new Date().toISOString() }).eq('uid', uid).eq('versao', r.versao).select('uid').then(function(res) {
      if (res.error) throw erro(res.error);
      if (!res.data.length) throw new Error('A obra foi alterada por outra pessoa; recarregue e tente de novo.');
      registros.delete(uid); pendentes.delete(uid);
      emitir('excluido', uid);
    });
  }

  function tramitarOrigem(uids, nova, data, descricao, sei) {
    if (modoProposta()) {
      return sb.rpc('propor_origem', { p_obras: uids, p_nova_origem: nova, p_data: data, p_descricao: descricao, p_sei: sei || null }).then(function(res) {
        if (res.error) throw erro(res.error);
        return carregarPropostas().then(function() { return { proposta: true }; });
      });
    }
    return sb.rpc('tramitar_origem', { p_obras: uids, p_nova_origem: nova, p_data: data, p_descricao: descricao, p_sei: sei || null }).then(function(res) {
      if (res.error) throw erro(res.error);
      // Mudou de eixo dentro do grupo (PGE): a obra continua na tabela, com a origem nova.
      if (Acesso.origensDoGrupo(origem).indexOf(nova) !== -1 && ehGrupo()) {
        return Promise.all(uids.map(function(uid) { pendentes.delete(uid); return recarregarObra(uid); })).then(function() { emitir('tramitado'); });
      }
      uids.forEach(function(uid) { registros.delete(uid); pendentes.delete(uid); });
      emitir('tramitado');
    });
  }

  function anotar(uid, data, descricao, sei) {
    return sb.rpc('anotar', { p_obras: [uid], p_data: data, p_descricao: descricao, p_sei: sei || null }).then(function(res) {
      if (res.error) throw erro(res.error);
    });
  }

  // ---------- Linha do tempo e historico ----------
  function tramitacoes(uid) {
    return sb.from('tramitacoes').select('tid,data_fato,evento,etapa,status,origem,origem_anterior,descricao,sei,criado_em,criado_por')
      .eq('obra_uid', uid).is('excluido_em', null).order('data_fato', { ascending: false }).order('criado_em', { ascending: false })
      .then(function(res) { if (res.error) throw erro(res.error); return res.data; });
  }

  // ---------- Aprovacao (quem aprova o perfil de quem propos) ----------
  function aprovar(pid, forcar) {
    return sb.rpc('aprovar_proposta', { p_pid: pid, p_forcar: !!forcar }).then(function(res) {
      if (res.error) throw erro(res.error);
      return recarregarObra(res.data);
    }).then(function(r) { return carregarPropostas().then(function() { emitir('salvo'); return r; }); });
  }
  function recusar(pid, motivo) {
    return sb.rpc('recusar_proposta', { p_pid: pid, p_motivo: motivo }).then(function(res) {
      if (res.error) throw erro(res.error);
      return carregarPropostas();
    });
  }
  function cancelar(pid) {
    return sb.rpc('cancelar_proposta', { p_pid: pid }).then(function(res) {
      if (res.error) throw erro(res.error);
      return carregarPropostas();
    });
  }

  function historico(uid) {
    return sb.from('historico').select('hid,quando,usuario_nome,acao,campos,antes,depois,proposto_por_nome')
      .eq('tabela', 'obras').eq('registro_uid', uid).order('hid', { ascending: false })
      .then(function(res) { if (res.error) throw erro(res.error); return res.data; });
  }

  function restaurarVersao(uid, hid) {
    return sb.rpc('restaurar_versao', { p_hid: hid }).then(function(res) {
      if (res.error) throw erro(res.error);
      return recarregarObra(uid);
    }).then(function() { emitir('salvo'); });
  }

  function origensDisponiveis() {
    return sb.from('origens').select('codigo,nome').eq('ativa', true).order('ordem').then(function(res) {
      if (res.error) throw erro(res.error); return res.data;
    });
  }

  return {
    carregar: carregar, origem: function() { return origem; },
    lista: function() { var l = Array.from(registros.values()); return visao ? l.filter(function(r) { return visao[r.codigo]; }) : l; },
    definirVisao: definirVisao, visao: function() { return visao; },
    obter: function(uid) { return registros.get(uid); },
    listas: function() { return listas; },
    nomeUsuario: function(id) { return nomes.get(id) || ''; },
    // podeAlterar: mexe na tabela/ficha/traçado, exclui, tramita e anota (quem propõe); podeGravar: grava direto,
    // sem aprovação (admin ou perfil com "gravar"); modoProposta: propõe sem gravar (tudo vira proposta);
    // podeAprovarAlgo: decide propostas de alguém nesta origem (pleno, gerenciador...); podeDecidir(p): esta proposta.
    ehGrupo: ehGrupo,
    podeAlterar: function() { return !visao && !ehFiltro() && Acesso.podePropor(origem); },
    podeGravar: function() { return !visao && !ehFiltro() && Acesso.podeEditar(origem); },
    podeAprovarAlgo: function() { return !visao && !ehFiltro() && Acesso.aprovaNaArea(origem); },
    ehFiltro: ehFiltro,
    podeDecidir: podeDecidir,
    modoProposta: modoProposta,
    propostas: function() { return propostas; }, propostaPendente: propostaPendente, carregarPropostas: carregarPropostas,
    aprovar: aprovar, recusar: recusar, cancelar: cancelar,
    definirPendente: definirPendente, pendente: pendente, valorAtual: valorAtual,
    totalPendentes: totalPendentes, descartar: descartar, resumoPendentes: resumoPendentes, salvar: salvar,
    criar: criar, excluir: excluir, tramitarOrigem: tramitarOrigem, anotar: anotar,
    tramitacoes: tramitacoes, historico: historico, restaurarVersao: restaurarVersao, origensDisponiveis: origensDisponiveis,
    ouvir: function(fn) { ouvintes.push(fn); }
  };
})();
