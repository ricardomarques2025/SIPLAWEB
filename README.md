# SIPLAWEB — Plano GOINFRA 2026–2030 (GOINFRA/DPL/GEREF)

Sistema de monitoramento das obras, projetos e planejamento da infraestrutura de Goiás, com mapa das origens
(FUNDEINFRA, DOR, DMA, DPJ, DPL, DOC, DSV, TARE, GME, GMK, GMM, GMP, Unidades de Saúde), mapa rodoviário e o
módulo de **Alterações de Jurisdição** (que substitui o site próprio do jurisdição).

**Acesso só com login.** Este repositório publica o código e as camadas de base do mapa; as obras, os trechos
de jurisdição, os trâmites e o histórico ficam no Supabase, protegidos por login e regras de acesso (RLS).

## Usuários e permissões

A permissão é por **área**: cada origem (GME, DOR, FUNDEINFRA…) e a área **JURISDICAO**. Em cada área o usuário
tem um dos níveis abaixo (cada um inclui os anteriores) ou nenhum acesso. O banco garante as regras; o site só arruma a tela.

| Nível | O que pode |
|---|---|
| Visualizador (`visualizador`) | consulta mapa, tabela e ficha; **não exporta nada** (Excel, CSV, GeoJSON, caderno PDF, impressão do mapa; o Ctrl+P sai só com um aviso) |
| Gerenciador (`gerenciador`) | + exporta e imprime |
| Editor básico (`editor_basico`) | + edita dados e traçado e cadastra obra nova, mas tudo vira **proposta** ("Revisar e enviar") que o editor pleno aprova; não exclui, não tramita origem, não registra nota |
| Editor pleno (`editor_pleno`) | + grava direto, exclui, tramita, registra notas; decide as propostas em **Aprovações** (aprovar, ou recusar com motivo) |
| Administrador | tudo, em todas as áreas; usuários e restauração de versões |
| Sem a área | a origem some da página inicial e do mapa (cartões, botões, legenda) |
| Conta inativa | não entra; aparece o aviso para pedir liberação |

- Proposta: fica em `siplaweb.propostas` e é validada na hora (mesmas regras da gravação). Uma pendente por obra; o autor pode
  refazer ou cancelar a dele. Se a obra mudou depois da proposta, o pleno é avisado antes de aprovar. O histórico registra o
  pleno como autor e "proposta de Fulano". O autor vê em **Minhas propostas** o que foi aprovado ou recusado (com o motivo).
- No mapa geral, exportar exige gerenciador em todas as origens que a pessoa vê; no rodoviário, em pelo menos uma área.
- **Trecho que não é segmento SRE inteiro vai para a malha complementar** (regra do usuário): na importação a obra recebe o
  desenho e `siplaweb.obra_para_extra_base()` mantém os segmentos SRE percorridos por inteiro e cria um recorte (`TREnnnn`,
  `recorte_de` = segmentos de origem) com o resto. Se alguma obra em linha ainda tiver desenho próprio (`geom`), o mapa o
  desenha (BASE `desenho` em `js/dados_banco.js`). Usado na importação DOR 2027
  (`SIPLAWEB/DADOS/importacao/2026-10-22_DOR/`: `NOVOS_DOR.xlsx` + `OBRAS_2027.gpkg`, script `gerar_importacao_DOR.py`).
- **Linha do tempo** (`js/linha_tempo.js`, botão no rodapé do mapa; não aparece no rodoviário): escolher uma data e ver a
  **situação real** naquele dia, pela data do fato. Obras: só as já cadastradas, com a etapa/status do último evento até a
  data. Jurisdição: situação do último trâmite até a data ("sem informação" antes do primeiro trâmite; sem trâmites = atual).
  Fora de hoje: faixa "Situação em … · só leitura" no mapa (sai também na impressão) e selo nas tabelas com "voltar para hoje";
  nada se edita. O histórico começa em 08/2026 (carga inicial), então a linha do tempo ganha conteúdo com o uso.
- **Traçado da jurisdição** (aba Traçado da ficha, `js/jurisdicao/tracado.js`): escolher segmentos inteiros da malha SRE ou
  complementar (lista ou clique no mapa; Shift = intervalo), desenhar/editar com ímã (Geoman, carregado só ali) ou importar
  GeoJSON (lat/long; UTM é recusado). Vira pendência; ao salvar, o que ficar fora da malha é oferecido para entrar na malha
  complementar (extra_base), com rodovia e descrição. Botão "Malha complementar" (pleno/admin): lista, ver, excluir; cópias
  arquivadas só para administradores.
- Na **JURISDICAO** valem as mesmas regras (tabela com pendências + "Revisar e salvar/enviar", fila de Aprovações); lá o
  editor básico também **propõe trâmite** (só entra na linha do tempo e muda a situação depois de aprovado). Remover trâmite e excluir são do pleno.
- **Mapa geral** mostra só as origens liberadas ao usuário. **Mapa rodoviário** (sem obras) é liberado a todo usuário ativo.
- O login vale para todo o projeto `banco-gis` (é o mesmo do site antigo do jurisdição). O cadastro público está desligado.
- **Usuários e permissões:** página `usuarios.html` (link "Usuários" no topo, só para administradores).
  - **Novo usuário:** nome + e-mail → a conta nasce **inativa** com uma **senha provisória** mostrada uma única vez
    (repasse por canal seguro); no primeiro acesso a pessoa é obrigada a criar a própria senha. Depois ative e escolha
    os níveis por área ("Aplicar a todas as origens" ajuda). "Redefinir senha" gera outra senha provisória.
  - **Administrador master** (um só, o dono do sistema): poderes plenos, inclusive sobre outros administradores.
    Só ele cria, promove, rebaixa, edita, desativa ou exclui administradores e exclui contas; ninguém altera o master.
    Administradores comuns gerenciam só usuários comuns (podem desativar, não excluir).
  - Toda mudança fica em **Registro de alterações** (quem, quando, antes → depois).
  - Criar conta, redefinir senha e excluir passam pela Edge Function `admin-usuarios`
    (`supabase/functions/admin-usuarios/`), que usa a chave secreta do ambiente do Supabase (nunca vai para o site).
    O e-mail padrão do Supabase só entrega para a equipe do projeto, por isso a senha provisória em vez de convite.

## Páginas

| Página | Conteúdo |
|---|---|
| `index.html` | página inicial (painel): saudação, números do plano, um cartão por origem com o total de empreendimentos e a divisão planejamento/projeto/obra, e os atalhos Mapa geral (mosaico das origens), Mapa rodoviário e Jurisdição |
| `index_antigo.html` | página inicial anterior (capa verde), guardada como alternativa |
| `mapa.html` | o mapa. Entradas: `?origem=DOR`, `?perfil=geral`, `?perfil=rodoviario`, `?modulo=jurisdicao` (`&tabela=cheia` ou `&tabela=dividida` abre a tabela direto) |
| `jurisdicao_caderno.html` | caderno em PDF da jurisdição (prancha A4 de um registro ou caderno completo) |
| `ajuda.html` | Central de Ajuda (botão "?" do mapa, que abre no assunto da tela): índice, pesquisa sem acento, glossário. Cada assunto é um `<article>` em `ajuda.html` (`data-cat`, `data-titulo`, `data-termos` = sinônimos para a pesquisa, `data-rel` = relacionados); a lógica fica em `js/ajuda.js`. Funcionalidade nova → acrescentar ou atualizar o artigo |
| `manual.html` | só redireciona para `ajuda.html` (o manual antigo está no histórico do git) |

## Visual do mapa

O tema padrão é `css/tema_novo.css` (barra verde, fundo claro, cartões com borda suave, fonte Inter, logo no rodapé do
menu esquerdo, botões de ação em verde-claro). Ele é uma camada sobre `css/style.css`, ligada pela classe `tema-novo`
no `<html>`. `mapa.html?tema=antigo` mostra o visual anterior (fica lembrado no navegador); `?tema=novo` volta ao padrão.
O logo do canto do mapa só aparece na impressão/PDF.

## Como funciona o mapa

- **Popup do ponto clicado**: mostra o que foi clicado (rodovia, obra, localidade, aeródromo, pedágio, trecho de
  jurisdição, unidades de saúde) e, em seguida, **todas as áreas visíveis que contêm o ponto** (município, regiões
  de manutenção e planejamento, áreas urbanas e ambientais, área de estudo/influência, raio das unidades de saúde).
  Rótulos (escudos de rodovia, nomes de localidade) não capturam o clique. Função `abrirPopupNoPonto` em `js/mapa.js`.
- **Ligar Tudo / Limpar** volta ao estado em que o mapa foi aberto (só a origem escolhida; no Mapa geral, todas as
  suas origens). Para trocar de origem, volte à página inicial (⌂).
- **Mapa rodoviário** abre com a malha estadual/federal, municípios, áreas e aeródromos; pedágios começam desligados.
- **Camada de referência Jurisdição** (Camadas de Referência): trechos de jurisdição só para consulta, desligada ao
  abrir, para quem tem a área JURISDICAO.

## Módulo Jurisdição (`mapa.html?modulo=jurisdicao`)

Mesma base do mapa de uma origem, **sem obras**, com os trechos de alteração de jurisdição nas cores do tipo
(estadualização, federalização, municipalização).

- **Menu esquerdo → JURISDIÇÃO**: *Abrir tabela*, busca, tipo, situação, contador e *Enquadrar trechos*.
- **Barra direita**: painel de indicadores (processos, extensões, finalizados, situação, leis) — clicar em um tipo
  ou situação filtra. Os filtros são um só para mapa, painel e tabela.
- **Tabela** (como no site antigo do jurisdição): tela cheia (com o painel de indicadores) ou **dividida com o mapa**.
  - No modo dividido a legenda da direita recolhe, a largura da tabela é ajustável arrastando a alça na borda
    (fica salva no navegador) e o trecho selecionado é centralizado no espaço que sobra do mapa.
  - Duplo clique edita a célula (quem tem *editar*); *Novo registro*; *Colunas*; status *Salvo no banco*.
  - **Ficha de detalhes**: abas Dados, Tramitação (registrar trâmite, inclusive replicado para os trechos do mesmo
    processo) e Histórico (o admin pode voltar uma versão); *Excluir* (lixeira), *Prancha*, *Ver no mapa*.
  - **Exportar**: Excel (todos ou filtrados), CSV, GeoJSON com atributos (QGIS), caderno completo, prancha.
  - Edição simultânea: se outra pessoa gravou antes, a gravação é recusada e o registro recarregado.
- **Popup do trecho no mapa** → *Abrir detalhes* abre a ficha.
- O **traçado** ainda é editado no site antigo do jurisdição (ver *Pendências*).

Código em `js/jurisdicao/` (`config`, `indicadores`, `store`, `tabela`, `modulo`, `painel`, `caderno`) e
`css/jurisdicao*.css`. O CSS da tabela é todo restrito ao contêiner `.jur-ui`, com um reset das regras genéricas
de `css/style.css`. Tabulator e XLSX são carregados só quando a tabela/exportação é usada.

## Banco de dados (Supabase, projeto `banco-gis`)

| Schema | Conteúdo |
|---|---|
| `siplaweb` | obras, grupos, tramitações (linha do tempo), histórico, origens, listas de valores, acessos |
| `acesso` | usuários, áreas e permissões (fora da API; o site usa funções do schema `siplaweb`) |
| `jurisdicao` | alterações de jurisdição, tramitações, histórico (do antigo site do jurisdição) |
| `public` | camadas de base (`sre_base`, `municipios`, `ferrovias`…) e `export_geojson` |

Scripts em `supabase/`:

| Arquivo | Conteúdo |
|---|---|
| `001_schema.sql` | schema `siplaweb`: tabelas, códigos, validação, auditoria, linha do tempo, RLS |
| `002_acesso.sql` | schema `acesso` (permissões por área), migração dos perfis, RLS das obras por origem |
| `003_jurisdicao_no_siplaweb.sql` | regras do `jurisdicao` aceitam também a área JURISDICAO |
| `004_niveis_aprovacao.sql` | 5 níveis por área, propostas do editor básico e aprovação pelo editor pleno (obras) |
| `013_codigo_jurisdicao.sql` | código permanente da jurisdição **AJ26-0001** (contador `AJ`, gerado no cadastro, imutável); existentes numerados na ordem do id. O `id` fica só como chave interna; caderno e pranchas usam Nº sequencial próprio |
| `012_fase_e_listas_DPJ.sql` | campo **Fase** (lista: Projeto, Anteprojeto, Fase Preparatória) e valores novos: status Obra/Integrada, modalidade Contratado/Interno/Doação/Tare, intervenção Sinalização Viária, fonte Doação (importação DPJ, 23/10/2026) |
| `011_recortes_extra_base.sql` | regra dos recortes: `siplaweb.obra_para_extra_base()` leva para a malha complementar o que não é segmento SRE inteiro (`recorte_de`) |
| `010_fonte_e_listas.sql` | campo **Fonte do recurso** (lista) e valores novos: etapa Licitação, status Em Mobilização / Aguardando Mobilização da Rede, intervenção Viaduto |
| `009_remove_login_antigo.sql` | fim do login do site antigo da jurisdição (`perfis`, gatilho, view `nomes`); permissão só pela área JURISDICAO |
| `008_linha_do_tempo.sql` | situação numa data: `siplaweb.situacao_obras_em()` e `jurisdicao.situacao_em()` |
| `007_extra_base_tracado.sql` | malha complementar (extra_base) editável com cópias arquivadas, `fora_da_malha()`, validação do traçado da jurisdição |
| `006_admin_master.sql` | administrador master, senha provisória obrigatória, registro de alterações de usuários |
| `functions/admin-usuarios/` | Edge Function (criar conta, redefinir senha, excluir); publicada com `verify_jwt = false`, confere o login por `meu_acesso()` |
| `005_jurisdicao_niveis.sql` | o mesmo para a jurisdição (edição, registro novo e trâmite propostos); autor do histórico pelo usuário do SIPLAWEB |
| `jurisdicao/` | scripts originais do schema `jurisdicao` (vindos do site antigo, já aplicados) |

### Obras (`siplaweb.obras`)

- **Código permanente** `OB26-00001` (obra) e `GR26-0001` (grupo): ano do cadastro + sequência, nunca reaproveitado
  e que **não muda quando a obra tramita de origem**. O IDCOD/IDGRUPO das planilhas antigas fica em
  `idcod_legado`/`idgrupo_legado`. Na tela os registros são chamados de **empreendimentos**.
- **Tipo**: Ponto, Linha ou Área. **Traçado** = vínculos a feições das camadas de base (`'sre_base:309EGO0185'`,
  `'localidades:LOC0465'`, `'municipios:5212709'`…) e/ou geometria desenhada. O banco recusa GEOCOD inexistente e
  vínculo incompatível com o tipo (Ponto → localidades/aero; Linha → sre_base/ferrovias/extra_base;
  Área → municipios/geo_pol_base).
- **Validação no banco**: SEI com 15 dígitos, valores de lista (etapa, status, intervenção, modalidade) cadastrados
  em `siplaweb.listas`, data de referência não futura, traçado dentro de Goiás, origem só muda por
  `tramitar_origem()`.
- **Linha do tempo** (`tramitacoes`): cadastro, mudança de etapa/status (pela data de referência), mudança de origem
  e notas. **Histórico** (`historico`): foto completa de cada versão; `obras_em(data)` devolve como as obras estavam
  numa data; o admin pode restaurar uma versão.
- O site lê as obras pelo `js/dados_banco.js`, que entrega os registros no formato dos antigos `DADOS.json` e
  `OBRAS_LINKS.json` (o restante do mapa continuou igual).
- Carga inicial (21/10/2026): 1.419 obras e 36 grupos, gerada por `tools/gerar_carga_supabase.py` a partir dos JSON
  antigos (sem os 58 registros de jurisdição). O script grava em `../DADOS/carga_inicial/` (fora do git).

## Camadas de base

`data/*.geojson`, geradas do banco pela função `public.export_geojson`. `sre_base` e `municipios` usam a versão
simplificada pré-calculada em `staging._export_precomputed`; as demais saem completas (parques, áreas urbanas e
ferrovias, com ~2,5 MB cada, são candidatas a simplificar).

## Keepalive

`.github/workflows/supabase-keepalive.yml` roda a cada 6 h com a chave publishable: chama `registrar_acesso()` e
lê a camada `aero` por `export_geojson` (o plano gratuito pausa o projeto após 7 dias sem atividade).

## Rodar localmente

```
python -m http.server 8765
```

e abrir <http://127.0.0.1:8765/index.html>. Precisa de internet (banco no Supabase) e de um login liberado.

## Pendências

1. **Etapa 3 do módulo Jurisdição**: edição do traçado no mapa do SIPLAWEB (Geoman: snap nas rodovias,
   simplificar, desenhar segmento, apagar).
2. **Tela de administração** de usuários e áreas no site, com Edge Function para criar contas (a chave secreta
   não pode ir ao navegador).
3. **Aposentar o site antigo do jurisdição** (`JURISDICAO_WEB`): permissões só pelo modelo novo, redirecionar o
   endereço antigo, juntar o repositório.
4. **Edição das obras por origem** (mesmo painel de tabela), com traçado de ponto/linha e linha do tempo
   selecionável.
5. **Publicação**: commit/push; depois apagar `public.dados` e `public.obras_links` (backup em
   `../DADOS/bkp/2026-10-21_tabelas_antigas_dados_obras_links.json`).
6. Backup diário passar a incluir `siplaweb.exportar_backup()` (o usuário `jurisdicao_backup` já tem permissão).
7. Os arquivos de obras antigos (`data/DADOS.json`, `data/OBRAS_LINKS.json`) saíram do repositório, mas continuam no
   histórico do git (repositório público); removê-los de lá exige reescrever o histórico.

## Testes

Testes de login usam usuários temporários `teste.*@jurisdicao.invalid`, apagados ao final junto com os acessos e
registros que geraram. Edições de teste no jurisdição usam o registro #72 e são desfeitas restaurando versão, autor
e data (`session_replication_role = replica`) e apagando as entradas de histórico criadas.
