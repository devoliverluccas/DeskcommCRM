/**
 * A provisionadora do módulo LOJAS E FILIAIS (item 5.4; ADR-0002, D2/D4/D5).
 *
 * RLS própria: `tenant_isolation_<t>_all` por `fn_user_org_ids()`, com a sessão
 * só LENDO (grant de select) — a escrita é das rotas, com o papel conferido. Por
 * isso `protecaoPropria`: a rotina 0325 não toca tabela que já nasceu com RLS, e
 * a trava do suporte trata a tabela como server-only. O molde compara o núcleo
 * antes e depois de provisionar: as chaves compostas para `catalog_products`,
 * `channel_sessions` e `crm_proposals` APONTAM para o núcleo sem mexer nele.
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "lojas",
  tabelas: ["lojas", "estoque_por_loja", "loja_do_numero", "proposta_da_loja"],
  protecaoPropria: ["lojas", "estoque_por_loja", "loja_do_numero", "proposta_da_loja"],
});
