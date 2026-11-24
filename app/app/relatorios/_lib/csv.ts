/**
 * Exportar CSV por aba (3.6). Separador `;` e BOM: é o que a planilha em
 * português e espanhol abre sem pedir assistente de importação (a vírgula é o
 * separador decimal nesses idiomas).
 */
export type Celula = string | number | null | undefined;

function celula(valor: Celula): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  // Aspas quando há separador, aspas ou quebra de linha; aspas internas dobram.
  // Fórmula (=, +, -, @ no começo) ganha apóstrofo: CSV aberto em planilha não
  // pode virar execução de fórmula vinda de um nome digitado por cliente.
  const seguro = /^[=+\-@]/.test(texto) && typeof valor === "string" ? `'${texto}` : texto;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function montarCsv(cabecalho: string[], linhas: Celula[][]): string {
  return `﻿${[cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n")}\r\n`;
}

/** Baixa o CSV no navegador. */
export function baixarCsv(nome: string, conteudo: string): void {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.endsWith(".csv") ? nome : `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
