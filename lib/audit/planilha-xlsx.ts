/**
 * UMA PLANILHA .xlsx MÍNIMA, sem dependência nova.
 *
 * O repositório não tem gerador de XLSX (`exceljs`/`xlsx` ficaram de fora pelo
 * peso — ver o cabeçalho de `lib/planilha/ler-arquivo.ts`), mas tem `fflate`, e um
 * `.xlsx` é só um zip de XML. Aqui se escreve o mínimo que o Excel, o LibreOffice
 * e o Google Planilhas abrem sem reclamar: uma aba, cabeçalho em negrito e todas
 * as células como TEXTO em linha (`inlineStr`).
 *
 * Texto em linha também é a defesa contra injeção de fórmula: uma célula
 * `inlineStr` nunca é avaliada, então "=HYPERLINK(...)" num navegador forjado
 * aparece como texto — sem o apóstrofo que o CSV precisa (`neutralizarFormula`).
 */
import { strToU8, zipSync } from "fflate";

/** Caracteres que o XML 1.0 proíbe; um user agent hostil não pode quebrar o arquivo. */
const PROIBIDOS_NO_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Teto de célula do Excel. */
const TETO_DA_CELULA = 32_767;

function escaparXml(texto: string): string {
  return texto
    .replace(PROIBIDOS_NO_XML, "")
    .slice(0, TETO_DA_CELULA)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function letraDaColuna(indice: number): string {
  let n = indice + 1;
  let s = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function linhaXml(celulas: ReadonlyArray<string | null | undefined>, numero: number, estilo?: number): string {
  const s = estilo === undefined ? "" : ` s="${estilo}"`;
  const cs = celulas
    .map((v, i) => {
      if (v === null || v === undefined || v === "") return "";
      return `<c r="${letraDaColuna(i)}${numero}" t="inlineStr"${s}><is><t xml:space="preserve">${escaparXml(v)}</t></is></c>`;
    })
    .join("");
  return `<row r="${numero}">${cs}</row>`;
}

/** Nome de aba: até 31 caracteres, sem `[]:*?/\`. */
function nomeDeAba(nome: string): string {
  const limpo = nome.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return escaparXml(limpo || "Planilha");
}

export function gerarXlsx(
  cabecalho: readonly string[],
  linhas: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  aba = "Planilha",
): Uint8Array {
  const corpo = [
    linhaXml(cabecalho, 1, 1),
    ...linhas.map((l, i) => linhaXml(l, i + 2)),
  ].join("");
  const largura = cabecalho.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="24" customWidth="1"/>`).join("");

  const arquivos: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>",
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${nomeDeAba(aba)}" sheetId="1" r:id="rId1"/></sheets>` +
      "</workbook>",
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
    "xl/styles.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      "</styleSheet>",
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (largura ? `<cols>${largura}</cols>` : "") +
      `<sheetData>${corpo}</sheetData>` +
      "</worksheet>",
  };

  return zipSync(
    Object.fromEntries(Object.entries(arquivos).map(([nome, xml]) => [nome, strToU8(xml)])),
    { level: 6 },
  );
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
