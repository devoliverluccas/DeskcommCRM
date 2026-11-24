// lib/propostas/documento/pdf-do-documento.tsx
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import { formatarMoeda } from "../moeda";
import type { SecaoRenderizada } from "./renderer";

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 48, fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  logo: { width: 96, height: 40, objectFit: "contain" },
  titulo: { fontSize: 16, fontWeight: 700 },
  secaoTitulo: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 4 },
  secaoBody: { fontSize: 10, lineHeight: 1.4 },
  linhaItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 0.5 },
  itemImagem: { width: 32, height: 32, objectFit: "cover", marginRight: 8 },
  itemTexto: { flexDirection: "row", alignItems: "center" },
  total: { marginTop: 8, fontSize: 12, fontWeight: 700, textAlign: "right" },
  ajuste: { marginTop: 4, fontSize: 10, textAlign: "right" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#666" },
});

export interface ItemDoPdf {
  descricao: string;
  quantidade: number;
  precoUnitarioCents: number;
  descontoCents: number;
  imagemUrl?: string | null;
}

export interface DocumentoPdfInput {
  titulo: string;
  numero: number | null;
  ano: number | null;
  versao: number;
  destinatario: { nome: string };
  secoes: SecaoRenderizada[];
  itens: ItemDoPdf[];
  totalCents: number;
  /** 9480 — desconto e frete da PROPOSTA. Zero (ou ausente) = a linha não aparece. */
  descontoCents?: number;
  freteCents?: number;
  moeda: string;
  validUntil: string | null;
  condicoes: string | null;
  /** SÓ a organização (D6 da spec-mãe) — quem monta é `marcaDaOrganizacaoParaPdf`. */
  marca: { app_name: string | null; accent_hex: string | null; logoUrl: string | null };
  /**
   * PRÉVIA DE TELA ("Ver como o cliente recebe"): o arquivo é o mesmo que o
   * envio faria, mas o número ainda não existe — e o lugar dele diz isso, em vez
   * de ficar em branco (quem lê não pode confundir "sem número" com "faltou
   * alguma coisa no PDF").
   */
  previa?: boolean;
}

export type BlocoDoPdf = { tipo: "secao"; secao: SecaoRenderizada } | { tipo: "itens" };

const ID_DA_SECAO_DE_INVESTIMENTO = "investment";

/** A ordem de leitura da §6.2 da spec de 21/09: a tabela de itens mora dentro do investimento. */
export function blocosDoDocumento(secoes: SecaoRenderizada[]): BlocoDoPdf[] {
  const blocos: BlocoDoPdf[] = [];
  let itensColocados = false;
  for (const secao of secoes) {
    blocos.push({ tipo: "secao", secao });
    if (secao.id === ID_DA_SECAO_DE_INVESTIMENTO && !itensColocados) {
      blocos.push({ tipo: "itens" });
      itensColocados = true;
    }
  }
  if (!itensColocados) blocos.push({ tipo: "itens" });
  return blocos;
}

/**
 * As linhas entre os itens e o total (9480): subtotal, desconto e frete da
 * proposta — só quando há desconto ou frete. Sem os dois, nada muda no PDF.
 */
export function ajustes(d: Pick<DocumentoPdfInput, "itens" | "descontoCents" | "freteCents" | "moeda">): Array<{ rotulo: string; valor: string }> {
  const desconto = d.descontoCents ?? 0;
  const frete = d.freteCents ?? 0;
  if (desconto === 0 && frete === 0) return [];
  const subtotal = d.itens.reduce(
    (acc, it) => acc + Math.max(0, Math.round(it.quantidade * it.precoUnitarioCents) - it.descontoCents),
    0,
  );
  const linhas = [{ rotulo: "Subtotal", valor: formatarMoeda(subtotal, d.moeda) }];
  if (desconto !== 0) linhas.push({ rotulo: "Desconto", valor: `- ${formatarMoeda(desconto, d.moeda)}` });
  if (frete !== 0) linhas.push({ rotulo: "Frete", valor: formatarMoeda(frete, d.moeda) });
  return linhas;
}

function Itens({ d, accent }: { d: DocumentoPdfInput; accent: string | undefined }): React.ReactElement {
  return (
    <View style={{ marginTop: 8 }}>
      {d.itens.map((it, i) => (
        <View key={i} style={styles.linhaItem}>
          <View style={styles.itemTexto}>
            {it.imagemUrl ? <Image src={it.imagemUrl} style={styles.itemImagem} /> : null}
            <Text>
              {it.descricao} (x{it.quantidade})
            </Text>
          </View>
          <Text>{formatarMoeda(it.quantidade * it.precoUnitarioCents - it.descontoCents, d.moeda)}</Text>
        </View>
      ))}
      {ajustes(d).map((linha) => (
        <Text key={linha.rotulo} style={styles.ajuste}>
          {linha.rotulo}: {linha.valor}
        </Text>
      ))}
      <Text style={[styles.total, accent ? { color: accent } : {}]}>Total: {formatarMoeda(d.totalCents, d.moeda)}</Text>
    </View>
  );
}

function DocumentoPdfDoc({ d }: { d: DocumentoPdfInput }): React.ReactElement {
  const accent = d.marca.accent_hex ?? undefined;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.titulo, accent ? { color: accent } : {}]}>{d.titulo}</Text>
            {d.previa ? (
              <Text>Prévia — sem número</Text>
            ) : d.numero !== null && d.ano !== null ? (
              <Text>
                Proposta {String(d.numero).padStart(4, "0")}/{d.ano}
                {d.versao > 1 ? ` — v${d.versao}` : ""}
              </Text>
            ) : null}
          </View>
          {d.marca.logoUrl ? (
            <Image src={d.marca.logoUrl} style={styles.logo} />
          ) : d.marca.app_name ? (
            <Text>{d.marca.app_name}</Text>
          ) : null}
        </View>

        <Text>Para: {d.destinatario.nome}</Text>

        {blocosDoDocumento(d.secoes).map((bloco, i) =>
          bloco.tipo === "itens" ? (
            <Itens key={`itens-${i}`} d={d} accent={accent} />
          ) : (
            <View key={bloco.secao.id} wrap>
              <Text style={styles.secaoTitulo}>{bloco.secao.title}</Text>
              <Text style={styles.secaoBody}>{bloco.secao.body}</Text>
            </View>
          ),
        )}

        {d.validUntil ? <Text style={{ marginTop: 12 }}>Válida até {d.validUntil}</Text> : null}
        {d.condicoes ? <Text style={{ marginTop: 8 }}>{d.condicoes}</Text> : null}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${d.marca.app_name ?? "Proposta comercial"} — página ${pageNumber} de ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderDocumentoPdf(input: DocumentoPdfInput): Promise<Buffer> {
  const buf = await renderToBuffer(<DocumentoPdfDoc d={input} />);
  return buf as Buffer;
}
