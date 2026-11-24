"use client";

/**
 * O painel de Valores personalizados: criar, a lista (editar e apagar) e a
 * prévia de uma mensagem com os valores salvos (fase 4, item 4.6).
 *
 * Sem cartão em volta de tudo: o formulário é um bloco, a lista é uma lista
 * com divisórias, e a hierarquia vem de peso e espaço. O token
 * (`{{empresa.pix}}`) é o que a pessoa copia para a mensagem — por isso ele
 * aparece em fonte de dado, com o botão de copiar ao lado.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { Copy, PencilSimple, Trash } from "@/lib/ui/icons";
import { previaDoTexto } from "@/lib/variaveis/previa";
import {
  FORMATO_DA_CHAVE,
  TAMANHO_MAXIMO_DA_DESCRICAO,
  TAMANHO_MAXIMO_DO_VALOR,
  mapaDosValores,
  ordenarValores,
  tokenDaChave,
  type ValorPersonalizado,
} from "@/lib/variaveis/valores-personalizados";

interface Rascunho {
  chave: string;
  valor: string;
  descricao: string;
}

const VAZIO: Rascunho = { chave: "", valor: "", descricao: "" };

/** O que a pessoa digita na chave vira o formato do banco: minúsculas, `_` no lugar de espaço e traço. */
function normalizarChave(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

function CamposDoValor({
  idPrefixo,
  rascunho,
  setRascunho,
  t,
}: {
  idPrefixo: string;
  rascunho: Rascunho;
  setRascunho: (r: Rascunho) => void;
  t: (texto: string) => string;
}) {
  const chaveInvalida = rascunho.chave !== "" && !FORMATO_DA_CHAVE.test(rascunho.chave);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefixo}-chave`}>{t("Chave")}</Label>
        <Input
          id={`${idPrefixo}-chave`}
          value={rascunho.chave}
          onChange={(e) => setRascunho({ ...rascunho, chave: normalizarChave(e.target.value) })}
          placeholder="pix"
          className="max-w-xs font-mono"
          aria-invalid={chaveInvalida}
          aria-describedby={`${idPrefixo}-chave-ajuda`}
          required
        />
        <p id={`${idPrefixo}-chave-ajuda`} className={chaveInvalida ? "text-xs text-error-fg" : "text-xs text-text-subtle"}>
          {rascunho.chave === ""
            ? t("Letras minúsculas, números e _, começando por letra.")
            : `${t("Na mensagem:")} ${tokenDaChave(rascunho.chave)}`}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefixo}-valor`}>{t("Valor")}</Label>
        <Textarea
          id={`${idPrefixo}-valor`}
          value={rascunho.valor}
          maxLength={TAMANHO_MAXIMO_DO_VALOR}
          onChange={(e) => setRascunho({ ...rascunho, valor: e.target.value })}
          placeholder={t("Ex.: pix@suaempresa.com.br")}
          className="min-h-20"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefixo}-descricao`}>{t("Descrição (opcional)")}</Label>
        <Input
          id={`${idPrefixo}-descricao`}
          value={rascunho.descricao}
          maxLength={TAMANHO_MAXIMO_DA_DESCRICAO}
          onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
          placeholder={t("Para que serve, para quem edita depois")}
        />
      </div>
    </div>
  );
}

export function PainelDeValores({ idioma, iniciais }: { idioma: Idioma; iniciais: ValorPersonalizado[] }) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [valores, setValores] = useState(iniciais);
  const [novo, setNovo] = useState<Rascunho>(VAZIO);
  const [editando, setEditando] = useState<{ id: string; rascunho: Rascunho } | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState(() =>
    iniciais[0] ? `${t("Olá, {{primeiro_nome}}!")} ${tokenDaChave(iniciais[0].chave)}` : t("Olá, {{primeiro_nome}}!"),
  );

  const mapa = useMemo(() => mapaDosValores(valores), [valores]);
  const previa = useMemo(() => previaDoTexto(teste, "inbox", mapa), [teste, mapa]);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora."));
    } finally {
      setOcupado(false);
    }
  }

  const prontoParaSalvar = (r: Rascunho) => FORMATO_DA_CHAVE.test(r.chave) && r.valor.trim() !== "";

  function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!prontoParaSalvar(novo)) return;
    void executar(async () => {
      const r = await apiClient.post<{ data: ValorPersonalizado }>("/api/v1/valores-personalizados", {
        chave: novo.chave,
        valor: novo.valor,
        descricao: novo.descricao.trim() || null,
      });
      setValores((lista) => ordenarValores([...lista, r.data]));
      setNovo(VAZIO);
      toast.success(t("Valor criado."));
    });
  }

  function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando || !prontoParaSalvar(editando.rascunho)) return;
    const { id, rascunho } = editando;
    void executar(async () => {
      const r = await apiClient.patch<{ data: ValorPersonalizado }>(`/api/v1/valores-personalizados/${id}`, {
        chave: rascunho.chave,
        valor: rascunho.valor,
        descricao: rascunho.descricao.trim() || null,
      });
      setValores((lista) => ordenarValores(lista.map((v) => (v.id === id ? r.data : v))));
      setEditando(null);
      toast.success(t("Valor salvo."));
    });
  }

  function apagar(v: ValorPersonalizado) {
    void executar(async () => {
      await apiClient.delete(`/api/v1/valores-personalizados/${v.id}`);
      setValores((lista) => lista.filter((x) => x.id !== v.id));
      setApagando(null);
      toast.success(t("Valor apagado."));
    });
  }

  async function copiar(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(t("Copiado."));
    } catch {
      toast.error(t("Não foi possível copiar."));
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <form onSubmit={criar} className="flex flex-col gap-3" data-testid="form-valor-personalizado">
        <h2 className="text-sm font-semibold">{t("Novo valor")}</h2>
        <CamposDoValor idPrefixo="novo-valor" rascunho={novo} setRascunho={setNovo} t={t} />
        <div>
          <Button type="submit" disabled={ocupado || !prontoParaSalvar(novo)} data-testid="criar-valor-personalizado">
            {t("Criar valor")}
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-2" aria-labelledby="valores-cadastrados">
        <h2 id="valores-cadastrados" className="text-sm font-semibold">
          {t("Valores da empresa")}
        </h2>
        {valores.length === 0 ? (
          <p className="text-sm text-text-muted" data-testid="valores-vazio">
            {t("Nenhum valor ainda. Crie o primeiro acima — por exemplo, a chave pix com a sua chave PIX.")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="lista-de-valores">
            {valores.map((v) =>
              editando?.id === v.id ? (
                <li key={v.id} className="py-4">
                  <form onSubmit={salvarEdicao} className="flex flex-col gap-3">
                    <CamposDoValor
                      idPrefixo={`editar-${v.id}`}
                      rascunho={editando.rascunho}
                      setRascunho={(rascunho) => setEditando({ id: v.id, rascunho })}
                      t={t}
                    />
                    {editando.rascunho.chave !== v.chave && (
                      <p className="text-xs text-warning-fg">
                        {t("Trocar a chave faz as mensagens que já usam a chave antiga saírem com o token, sem o valor.")}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" disabled={ocupado || !prontoParaSalvar(editando.rascunho)}>
                        {t("Salvar")}
                      </Button>
                      <Button type="button" variant="ghost" disabled={ocupado} onClick={() => setEditando(null)}>
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={v.id} className="flex flex-col gap-1 py-3" data-testid="valor-personalizado">
                  <div className="flex min-h-11 items-center gap-2 lg:min-h-8">
                    <code className="min-w-0 truncate font-mono text-sm font-medium">{tokenDaChave(v.chave)}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-11 shrink-0 px-0 lg:w-8"
                      aria-label={`${t("Copiar")} ${tokenDaChave(v.chave)}`}
                      title={t("Copiar")}
                      onClick={() => void copiar(tokenDaChave(v.chave))}
                    >
                      <Copy size={16} aria-hidden />
                    </Button>
                    <span className="flex-1" />
                    {apagando === v.id ? (
                      <>
                        <span className="text-xs text-text-muted">{t("Apagar este valor?")}</span>
                        <Button type="button" variant="destructive" size="sm" disabled={ocupado} onClick={() => apagar(v)}>
                          {t("Apagar")}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => setApagando(null)}>
                          {t("Cancelar")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-11 px-0 lg:w-8"
                          disabled={ocupado}
                          aria-label={`${t("Editar")} ${v.chave}`}
                          title={t("Editar")}
                          onClick={() =>
                            setEditando({
                              id: v.id,
                              rascunho: { chave: v.chave, valor: v.valor, descricao: v.descricao ?? "" },
                            })
                          }
                        >
                          <PencilSimple size={16} aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-11 px-0 lg:w-8"
                          disabled={ocupado}
                          aria-label={`${t("Apagar")} ${v.chave}`}
                          title={t("Apagar")}
                          onClick={() => setApagando(v.id)}
                        >
                          <Trash size={16} aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                  <p className="line-clamp-3 text-sm whitespace-pre-line text-text">{v.valor}</p>
                  {v.descricao && <p className="text-xs text-text-subtle">{v.descricao}</p>}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="previa-de-valores">
        <h2 id="previa-de-valores" className="text-sm font-semibold">
          {t("Como fica numa mensagem")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="teste-de-valores">{t("Escreva uma mensagem de teste")}</Label>
          <Textarea
            id="teste-de-valores"
            value={teste}
            onChange={(e) => setTeste(e.target.value)}
            className="min-h-20 font-mono text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 border-l-2 border-border-strong pl-3" data-testid="previa-de-valores">
          <p className="text-xs text-text-subtle">{t("O cliente recebe")}</p>
          <p className="text-sm whitespace-pre-line text-text">{previa}</p>
        </div>
        <p className="text-xs text-text-subtle">
          {t("O nome da prévia é de um contato de exemplo. Chave que não existe continua como {{empresa.chave}} — é assim que sairia.")}
        </p>
      </section>
    </div>
  );
}
