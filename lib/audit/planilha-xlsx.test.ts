/**
 * A planilha gerada é LIDA de volta pelo leitor de XLSX do próprio repositório
 * (`lib/planilha/ler-arquivo.ts`) — prova que o arquivo é um .xlsx de verdade,
 * e não só um zip com nomes certos.
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseImportFile } from "@/lib/planilha/ler-arquivo";

import { gerarXlsx } from "./planilha-xlsx";

function comoArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

describe("gerarXlsx", () => {
  it("cabeçalho e linhas voltam iguais pelo leitor do repositório", async () => {
    const xlsx = gerarXlsx(
      ["Quando", "Pessoa", "Evento"],
      [
        ["25/11/2026 10:00", "Ana <ana@example.com>", "Entrou"],
        ["25/11/2026 11:00", null, "Saiu"],
      ],
      "Acessos",
    );
    const lida = await parseImportFile(comoArrayBuffer(xlsx), "acessos.xlsx");
    expect(lida.ok).toBe(true);
    if (!lida.ok) return;
    expect(lida.sheet.headers).toEqual(["Quando", "Pessoa", "Evento"]);
    expect(lida.sheet.rows[0]).toEqual(["25/11/2026 10:00", "Ana <ana@example.com>", "Entrou"]);
    expect(lida.sheet.rows[1]?.[2]).toBe("Saiu");
  });

  it("texto hostil vira texto: fórmula não é avaliada e caractere de controle não quebra o XML", () => {
    const xlsx = gerarXlsx(["UA"], [["=HYPERLINK(\"http://x\")\u0001<script>"]]);
    const folha = strFromU8(unzipSync(xlsx)["xl/worksheets/sheet1.xml"]!);
    expect(folha).toContain('t="inlineStr"');
    expect(folha).not.toContain("<f>");
    expect(folha).not.toContain("\u0001");
    expect(folha).toContain("=HYPERLINK(&quot;http://x&quot;)&lt;script&gt;");
  });
});
