/**
 * O APARELHO E O ENDEREÇO DE UM ACESSO, do jeito que uma pessoa lê.
 *
 * `api_audit_log.actor_user_agent` guarda o cabeçalho cru — "Mozilla/5.0
 * (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …" — e ninguém reconhece o
 * próprio notebook nisso. `resumirAparelho` devolve só as duas coisas que
 * respondem "fui eu?": o navegador e o sistema. Sem versão de propósito: versão
 * muda a cada atualização e faria o mesmo aparelho parecer outro.
 *
 * `mascararIp` existe para quem não administra a empresa: um gerente vê que o
 * acesso veio de uma rede ("203.0.113.x"), não o endereço de alguém.
 *
 * PURO e vai ao navegador (a tela usa os dois). Sem dependência: os nomes abaixo
 * cobrem quase todo acesso real a um CRM, e o que sobra cai em "desconhecido" —
 * o cabeçalho cru continua na planilha para quem precisar.
 */

export interface Aparelho {
  /** "Chrome", "Safari", … ou `null` quando não reconhecido. */
  navegador: string | null;
  /** "Windows", "iPhone", … ou `null` quando não reconhecido. */
  sistema: string | null;
}

/** A ORDEM importa: Edge, Opera e Samsung se anunciam também como Chrome; Chrome, como Safari. */
const NAVEGADORES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera|OPiOS)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** iPhone/iPad antes de "Mac OS X": o iOS diz "like Mac OS X". Android antes de Linux. */
const SISTEMAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\b(Macintosh|Mac OS X)\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function primeiro(lista: ReadonlyArray<readonly [RegExp, string]>, ua: string): string | null {
  for (const [padrao, nome] of lista) if (padrao.test(ua)) return nome;
  return null;
}

export function resumirAparelho(userAgent: string | null | undefined): Aparelho {
  const ua = (userAgent ?? "").slice(0, 1000);
  if (!ua.trim()) return { navegador: null, sistema: null };
  return { navegador: primeiro(NAVEGADORES, ua), sistema: primeiro(SISTEMAS, ua) };
}

/**
 * A frase da tela: "Chrome no Windows". `t` é o tradutor de quem desenha (`useT`
 * ou `traduzir` com o idioma) — os nomes próprios não traduzem, a ligação sim.
 */
export function descreverAparelho(
  userAgent: string | null | undefined,
  t: (texto: string) => string,
): string {
  const { navegador, sistema } = resumirAparelho(userAgent);
  if (navegador && sistema) {
    return t("{navegador} no {sistema}").replace("{navegador}", navegador).replace("{sistema}", sistema);
  }
  return navegador ?? sistema ?? t("Navegador desconhecido");
}

/**
 * Esconde a parte do endereço que identifica a máquina. IPv4 perde o último
 * octeto; IPv6 fica com os três primeiros grupos (o prefixo da rede). Qualquer
 * coisa que não pareça IP vira "—" — melhor não mostrar do que mostrar inteiro.
 */
export function mascararIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const limpo = ip.trim().replace(/^::ffff:/i, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d+)?$/.exec(limpo);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (limpo.includes(":") && /^[0-9a-f:]+$/i.test(limpo)) {
    const grupos = limpo.split(":").filter((g) => g.length > 0).slice(0, 3);
    if (grupos.length > 0) return `${grupos.join(":")}::x`;
  }
  return "—";
}
