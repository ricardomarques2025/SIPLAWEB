// Camada de dados do modulo Jurisdicao (schema "jurisdicao" do projeto banco-gis), vinda do site do jurisdicao.
// Login e permissoes sao os do SIPLAWEB (js/acesso.js, area JURISDICAO, 5 niveis).
// Como na tabela de obras: as edicoes ficam PENDENTES ate "Revisar e salvar" (editor pleno grava; o banco
// carimba autor/data e guarda o historico) ou "Revisar e enviar" (editor basico: vira proposta em
// jurisdicao.propostas, que o pleno aprova ou recusa). O basico tambem propoe tramite e registro novo.
// Edicao simultanea: toda gravacao confere a "versao" do registro; se outra pessoa gravou antes,
// o registro e recarregado e a edicao e recusada (nada se perde em silencio).

const Store = (function() {
  const sb = Acesso.cliente.schema('jurisdicao');
  const auth = Acesso.cliente.auth;
  const COLUNAS = ['uid', 'versao', 'atualizado_em', 'atualizado_por', 'geom']
    .concat(CAMPOS.map(c => c.campo)).join(',');

  let registros = new Map();   // id -> registro (sem geometria)
  let geometrias = new Map();  // id -> geometry (ou null)
  let nomes = new Map();       // user_id -> nome
  let pendentes = new Map();   // id -> { campo: valor novo }
  let propostas = [];          // pendentes + decididas nos ultimos 30 dias (mais nova primeiro)
  let gravando = 0;
  let carregadoEm = 0;
  const filas = new Map();     // id -> Promise: gravacoes do mesmo registro em sequencia
  const ouvintes = new Set();

  // ---------- Sessao (js/acesso.js) ----------
  async function sessao() {
    const { data } = await auth.getSession();
    return data.session;
  }

  const usuario = () => Acesso.perfil();
  // podeEditar: mexe na tabela/ficha e tramita (basico ou pleno); podeGravar: grava direto, aprova, exclui,
  // remove tramite (pleno); modoProposta: basico, cujo "salvar" vira proposta.
  // Linha do tempo (js/linha_tempo.js): { id: situacao|null } da data escolhida; null = hoje. Na data passada
  // a situacao mostrada e a daquela data (null = sem informacao) e nada se edita.
  let visao = null;
  function definirVisao(v) { visao = v || null; emitir('visao'); }
  function comVisao(r) {
    if (!visao || !r || !Object.prototype.hasOwnProperty.call(visao, r.id)) return r;
    return Object.assign({}, r, { situacao: visao[r.id] });
  }
  const podeEditar = () => !visao && Acesso.podePropor('JURISDICAO');
  const podeGravar = () => !visao && Acesso.podeEditar('JURISDICAO');
  const modoProposta = () => podeEditar() && !podeGravar();
  const eAdmin = () => !!Acesso.perfil() && !!Acesso.perfil().admin;

  // ---------- Carga ----------
  async function carregar() {
    await Acesso.pronto;
    if (!(await sessao())) throw new Error('Sessão expirada. Entre novamente.');
    const [res, resNomes] = await Promise.all([
      sb.from('alteracoes').select(COLUNAS).is('excluido_em', null).order('id'),
      Acesso.cliente.rpc('nomes'),   // siplaweb.nomes(): usuarios do SIPLAWEB
      carregarPropostas()
    ]);
    if (res.error) throw traduzir(res.error);
    registros = new Map();
    geometrias = new Map();
    res.data.forEach(guardar);
    pendentes.forEach((p, id) => { if (!registros.has(id)) pendentes.delete(id); });
    nomes = new Map((resNomes.data || []).map(n => [n.user_id, n.nome]));
    carregadoEm = Date.now();
    return { versao: new Date(carregadoEm).toISOString() };
  }

  async function recarregar() {
    await carregar();
    emitir('recarregado');
  }

  function guardar(linha) {
    const r = { ...linha };
    const g = r.geom;
    delete r.geom;
    if (r.extensao_km != null) r.extensao_km = Number(r.extensao_km);
    registros.set(r.id, r);
    geometrias.set(r.id, g || null);
    return r;
  }

  async function recarregarRegistro(id) {
    const r = registros.get(id);
    if (!r) return null;
    const { data, error } = await sb.from('alteracoes').select(COLUNAS + ',excluido_em').eq('uid', r.uid).maybeSingle();
    if (error) throw traduzir(error);
    if (!data || data.excluido_em) {
      registros.delete(id);
      geometrias.delete(id);
      pendentes.delete(id);
      emitir('excluido', id);
      return null;
    }
    delete data.excluido_em;
    guardar(data);
    emitir('registro', id);
    return registros.get(id);
  }

  // ---------- Leitura ----------
  function lista() { return Array.from(registros.values()).map(comVisao); }
  function obter(id) { return comVisao(registros.get(id)); }
  // Traçado em uso na tela: o pendente (ainda não salvo), se houver; senão o gravado.
  function geometria(id) { return pendente(id, 'geom') ? pendentes.get(id).geom : geometrias.get(id) || null; }
  function nomeUsuario(uid) { return nomes.get(uid) || ''; }
  const idadeDados = () => Date.now() - carregadoEm;
  const gravandoAgora = () => gravando > 0;

  // ---------- Escrita ----------
  function enfileirar(id, tarefa) {
    const p = (filas.get(id) || Promise.resolve()).then(tarefa);
    filas.set(id, p.catch(() => {}));
    return p;
  }

  async function gravar(id, mudancas) {
    gravando++;
    emitir('salvando');
    try {
      return await enfileirar(id, async function() {
        const r = registros.get(id);
        if (!r) throw new Error('Registro #' + id + ' não está mais disponível.');
        const { data, error } = await sb.from('alteracoes').update(mudancas)
          .eq('uid', r.uid).eq('versao', r.versao).select(COLUNAS);
        if (error) throw traduzir(error);
        if (!data.length) {
          await recarregarRegistro(id);
          throw new Error('O registro #' + id + ' foi alterado por outra pessoa enquanto você editava. ' +
            'Os dados foram atualizados; confira e refaça a alteração.');
        }
        return guardar(data[0]);
      });
    } finally {
      gravando--;
      emitir('salvo');
    }
  }

  // ---------- Pendencias (amarelo ate revisar) ----------
  function atualizar(id, campo, valor) {
    const r = registros.get(id);
    if (!r) return;
    if (valor === '' || valor === undefined) valor = null;
    const p = pendentes.get(id) || {};
    const original = campo === 'geom' ? geometrias.get(id) || null : r[campo];
    if (normalizar(original) === normalizar(valor)) delete p[campo]; else p[campo] = valor;
    if (Object.keys(p).length) pendentes.set(id, p); else pendentes.delete(id);
    emitir('pendentes', id, campo);
  }
  function definirGeometria(id, geom) { atualizar(id, 'geom', geom); }
  // Sempre booleano (classList.toggle com undefined inverteria a marcacao).
  const pendente = (id, campo) => !!(pendentes.get(id) && Object.prototype.hasOwnProperty.call(pendentes.get(id), campo));
  const valorAtual = (id, campo) => pendente(id, campo) ? pendentes.get(id)[campo] : (comVisao(registros.get(id)) || {})[campo];
  function totalPendentes() { let n = 0; pendentes.forEach(p => { n += Object.keys(p).length; }); return n; }
  function descartarCampo(id, campo) {
    const p = pendentes.get(id);
    if (!p || !Object.prototype.hasOwnProperty.call(p, campo)) return;
    delete p[campo];
    if (!Object.keys(p).length) pendentes.delete(id);
    emitir('pendentes', id, campo);
  }
  function descartar() { const ids = Array.from(pendentes.keys()); pendentes = new Map(); ids.forEach(id => emitir('pendentes', id)); }

  function validar(campo, valor) {
    const c = CAMPOS.find(x => x.campo === campo);
    if (campo === 'geom') return valor ? validarLinha(valor) : '';
    if (!c || valor == null || valor === '') return '';
    if (c.tipo === 'numero' && (!isFinite(Number(valor)) || Number(valor) < 0)) return 'Número inválido (não pode ser negativo)';
    if (c.tipo === 'lista' && c.opcoes.indexOf(valor) === -1) return 'Valor fora da lista de ' + c.titulo.toLowerCase();
    return '';
  }
  // Mesma caixa de Goiás que o banco usa (jurisdicao.validar_geom).
  function validarLinha(g) {
    const pontos = (g.coordinates || []).flat();
    if (!pontos.length) return 'Traçado vazio';
    if (pontos.some(c => !(c[0] >= -53.8 && c[0] <= -45.4 && c[1] >= -20 && c[1] <= -12))) return 'Traçado fora de Goiás (confira as coordenadas)';
    return '';
  }
  function resumoPendentes() {
    const itens = [];
    pendentes.forEach(function(p, id) {
      const r = registros.get(id);
      itens.push({ id: id, r: r, campos: Object.keys(p).map(c => ({ campo: c, antes: c === 'geom' ? geometrias.get(id) || null : r[c], depois: p[c], erro: validar(c, p[c]) })) });
    });
    return itens.sort((a, b) => a.id - b.id);
  }

  // Grava (pleno) ou envia como proposta (basico) todas as pendencias, registro a registro.
  // extras: { id: [{ rodovia, trecho, geom }] } trechos fora da malha que entram na malha complementar
  // (extra_base): o pleno cria na hora; o basico manda junto com a proposta ("_extra_base").
  async function salvar(extras) {
    extras = extras || {};
    let criouMalha = false;
    const resultado = { gravadas: [], recusadas: [], proposta: modoProposta() };
    gravando++;
    emitir('salvando');
    try {
      for (const item of resumoPendentes()) {
        const mudancas = Object.assign({}, pendentes.get(item.id));
        try {
          const novos = extras[item.id] || [];
          if (resultado.proposta) {
            if (novos.length) mudancas._extra_base = novos;
            const { error } = await sb.rpc('propor', { p_registro: item.r.uid, p_mudancas: mudancas, p_versao: item.r.versao });
            if (error) throw traduzir(error);
          } else {
            for (const t of novos) {
              const { error } = await Acesso.cliente.rpc('extra_base_salvar', { p_geocod: null, p_dados: { rodovia: t.rodovia, trecho: t.trecho }, p_geojson: t.geom });
              if (error) throw traduzir(error);
              criouMalha = true;
            }
            await gravar(item.id, mudancas);
          }
          pendentes.delete(item.id);
          resultado.gravadas.push(item.id);
          emitir('registro', item.id);
        } catch (e) {
          resultado.recusadas.push({ id: item.id, motivo: e.message });
          if (/alterad[oa] por outra pessoa/.test(e.message)) { pendentes.delete(item.id); await recarregarRegistro(item.id).catch(() => null); }
        }
      }
      if (resultado.proposta) await carregarPropostas();
      if (criouMalha && typeof recarregarExtraBase === 'function') await recarregarExtraBase().catch(() => null);
    } finally {
      gravando--;
      emitir('salvo');
    }
    return resultado;
  }

  // Registro novo: o pleno cria e ja abre a ficha; o basico propoe (o n. sai na aprovacao).
  async function criar(dados) {
    const novo = Object.assign({ tipo: 'Estadualização', situacao: 'EM ANÁLISE' }, dados || {});
    Object.keys(novo).forEach(k => { if (novo[k] === '' || novo[k] == null) delete novo[k]; });
    if (modoProposta()) {
      const { error } = await sb.rpc('propor_nova', { p_dados: novo });
      if (error) throw traduzir(error);
      await carregarPropostas();
      return { proposta: true };
    }
    const { data, error } = await sb.from('alteracoes').insert(novo).select(COLUNAS).single();
    if (error) throw traduzir(error);
    const reg = guardar(data);
    emitir('criado', reg.id);
    return reg;
  }

  // Vai para a lixeira (o admin pode restaurar).
  async function excluir(id) {
    if (!registros.has(id)) return;
    try {
      await gravar(id, { excluido_em: new Date().toISOString() });
      registros.delete(id);
      geometrias.delete(id);
      pendentes.delete(id);
      emitir('excluido', id);
    } catch (e) {
      await recarregarRegistro(id).catch(() => null);
      emitir('erro', id, e.message);
    }
  }

  // ---------- Tramitacao ----------
  async function tramitacoes(id) {
    const r = registros.get(id);
    const { data, error } = await sb.from('tramitacoes')
      .select('tid,data_tramite,situacao,descricao,processo_sei,lote,criado_em,criado_por')
      .eq('registro_uid', r.uid).is('excluido_em', null)
      .order('data_tramite', { ascending: false }).order('criado_em', { ascending: false });
    if (error) throw traduzir(error);
    return data;
  }

  // ids: trechos que recebem o mesmo tramite (o primeiro e o que esta aberto). Basico: vira proposta.
  async function tramitar(ids, dados) {
    gravando++;
    emitir('salvando');
    try {
      if (modoProposta()) {
        const { error } = await sb.rpc('propor_tramite', {
          p_registros: ids.map(id => registros.get(id).uid), p_data: dados.data, p_descricao: dados.descricao,
          p_situacao: dados.situacao || null, p_processo_sei: dados.processo_sei || null
        });
        if (error) throw traduzir(error);
        await carregarPropostas();
        return { proposta: true };
      }
      const { error } = await sb.rpc('tramitar', {
        p_registros: ids.map(id => registros.get(id).uid),
        p_data: dados.data,
        p_descricao: dados.descricao,
        p_situacao: dados.situacao || null,
        p_processo_sei: dados.processo_sei || null
      });
      if (error) throw traduzir(error);
      await Promise.all(ids.map(recarregarRegistro));
    } finally {
      gravando--;
      emitir('salvo');
    }
  }

  async function excluirTramite(tid) {
    const { error } = await sb.from('tramitacoes').update({ excluido_em: new Date().toISOString() }).eq('tid', tid);
    if (error) throw traduzir(error);
  }

  // ---------- Propostas (editor basico) e decisao (editor pleno) ----------
  async function carregarPropostas() {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await sb.from('propostas').select('*').or('situacao.eq.pendente,decidido_em.gte.' + desde)
      .order('pid', { ascending: false }).limit(300);
    if (error) throw traduzir(error);
    propostas = data;
    emitir('propostas');
  }
  function idPorUid(uid) { for (const [id, r] of registros) if (r.uid === uid) return id; return null; }
  function propostaPendente(id) {
    const r = registros.get(id);
    return r ? propostas.find(p => p.registro_uid === r.uid && p.situacao === 'pendente' && p.tipo === 'edicao') || null : null;
  }
  async function aprovar(pid, forcar) {
    const { data, error } = await sb.rpc('aprovar_proposta', { p_pid: pid, p_forcar: !!forcar });
    if (error) throw traduzir(error);
    const p = propostas.find(x => x.pid === pid);
    if (p && p.tipo === 'tramite') await Promise.all((p.registros || []).map(idPorUid).filter(x => x != null).map(recarregarRegistro));
    else if (p && p.tipo === 'nova') await recarregar();
    else { const id = idPorUid(data); if (id != null) await recarregarRegistro(id); }
    await carregarPropostas();
    return idPorUid(data);
  }
  async function recusar(pid, motivo) {
    const { error } = await sb.rpc('recusar_proposta', { p_pid: pid, p_motivo: motivo });
    if (error) throw traduzir(error);
    await carregarPropostas();
  }
  async function cancelar(pid) {
    const { error } = await sb.rpc('cancelar_proposta', { p_pid: pid });
    if (error) throw traduzir(error);
    await carregarPropostas();
  }

  // ---------- Historico ----------
  async function historico(id) {
    const r = registros.get(id);
    const { data, error } = await sb.rpc('historico_de', { p_registro: r.uid });
    if (error) throw traduzir(error);
    return data;
  }

  async function restaurarVersao(id, hid) {
    const { error } = await sb.rpc('restaurar_versao', { p_hid: hid });
    if (error) throw traduzir(error);
    await recarregarRegistro(id);
  }

  // ---------- Lixeira (admin) ----------
  async function lixeira() {
    const { data, error } = await sb.from('alteracoes')
      .select('uid,id,tipo,rodovia,municipios,excluido_em,excluido_por')
      .not('excluido_em', 'is', null).order('excluido_em', { ascending: false });
    if (error) throw traduzir(error);
    return data;
  }

  async function restaurarDaLixeira(uid) {
    const { data, error } = await sb.from('alteracoes').update({ excluido_em: null }).eq('uid', uid).select(COLUNAS);
    if (error) throw traduzir(error);
    if (!data.length) throw new Error('Não foi possível restaurar (sem permissão?).');
    const reg = guardar(data[0]);
    emitir('criado', reg.id);
    return reg;
  }

  // ---------- Registro de acessos ----------
  // Nao trava a tela: se falhar (ex.: sem internet), so avisa no console.
  function registrarEvento(evento, detalhe) {
    const ua = navigator.userAgent;
    const nav = (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Outro') +
      ' / ' + (/Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro');
    return sb.rpc('registrar_evento', { p_evento: evento, p_detalhe: detalhe || null, p_navegador: nav })
      .then(r => { if (r.error) console.warn('Registro de acesso falhou', r.error); })
      .catch(e => console.warn('Registro de acesso falhou', e));
  }

  // ---------- Exportacao ----------
  function exportarTrechos(comAtributos) {
    const features = [];
    registros.forEach(function(r, id) {
      const g = geometrias.get(id);
      if (!g) return;
      const props = {};
      CAMPOS.forEach(c => { props[c.campo] = r[c.campo]; });
      features.push({ type: 'Feature', properties: comAtributos ? props : { id: id }, geometry: g });
    });
    features.sort((a, b) => a.properties.id - b.properties.id);
    const fc = { type: 'FeatureCollection', name: 'alt_juris', features: features };
    if (comAtributos) fc.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4674' } };
    return fc;
  }

  // ---------- Util ----------
  function normalizar(v) {
    if (v && typeof v === 'object') return JSON.stringify(v.coordinates);   // geometria: compara as coordenadas
    return v == null || v === '' ? null : String(v);
  }

  function traduzir(e) {
    const msg = String(e && e.message || e);
    const mapa = [
      [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/Email not confirmed/i, 'E-mail ainda não confirmado.'],
      [/rate limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
      [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
      [/New password should be different/i, 'A nova senha precisa ser diferente da atual.'],
      [/JWT expired|invalid JWT/i, 'Sessão expirada. Entre novamente.'],
      [/permission denied|row-level security|42501/i, 'Sem permissão para esta operação.'],
      [/alteracoes_tipo_check/i, 'Tipo inválido (use Estadualização, Municipalização ou Federalização).'],
      [/Failed to fetch|NetworkError/i, 'Sem conexão com o banco de dados. Verifique a internet.']
    ];
    const achado = mapa.find(m => m[0].test(msg));
    return new Error(achado ? achado[1] : msg);
  }

  function emitir(evento, id, extra) { ouvintes.forEach(fn => fn(evento, id, extra)); }
  function ouvir(fn) { ouvintes.add(fn); }

  return {
    sessao, usuario, podeEditar, podeGravar, modoProposta, eAdmin,
    carregar, recarregar, recarregarRegistro, lista, obter, definirVisao, visao: () => visao, geometria, nomeUsuario, idadeDados, gravandoAgora,
    atualizar, definirGeometria, pendente, valorAtual, totalPendentes, descartar, descartarCampo, resumoPendentes, salvar,
    criar, excluir, propostas: () => propostas, propostaPendente, carregarPropostas, aprovar, recusar, cancelar, idPorUid,
    tramitacoes, tramitar, excluirTramite, historico, restaurarVersao,
    lixeira, restaurarDaLixeira, registrarEvento,
    exportarTrechos, ouvir
  };
})();
