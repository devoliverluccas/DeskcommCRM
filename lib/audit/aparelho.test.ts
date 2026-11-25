import { describe, expect, it } from "vitest";

import { descreverAparelho, mascararIp, resumirAparelho } from "./aparelho";

/** Cabeçalhos reais, copiados de navegadores de 2026 — não inventados. */
const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  operaMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

describe("resumirAparelho", () => {
  it.each([
    [UA.chromeWindows, "Chrome", "Windows"],
    [UA.edgeWindows, "Edge", "Windows"],
    [UA.safariIphone, "Safari", "iPhone"],
    [UA.chromeIphone, "Chrome", "iPhone"],
    [UA.safariMac, "Safari", "macOS"],
    [UA.firefoxLinux, "Firefox", "Linux"],
    [UA.samsungAndroid, "Samsung Internet", "Android"],
    [UA.chromeAndroid, "Chrome", "Android"],
    [UA.operaMac, "Opera", "macOS"],
    [UA.ipad, "Safari", "iPad"],
    [UA.chromebook, "Chrome", "ChromeOS"],
  ])("%s → %s no %s", (ua, navegador, sistema) => {
    expect(resumirAparelho(ua)).toEqual({ navegador, sistema });
  });

  it("vazio, nulo ou ferramenta de linha de comando não inventam aparelho", () => {
    expect(resumirAparelho(null)).toEqual({ navegador: null, sistema: null });
    expect(resumirAparelho("   ")).toEqual({ navegador: null, sistema: null });
    expect(resumirAparelho("curl/8.5.0")).toEqual({ navegador: null, sistema: null });
  });
});

describe("descreverAparelho", () => {
  const pt = (s: string) => s;
  const es = (s: string) => (s === "{navegador} no {sistema}" ? "{navegador} en {sistema}" : s);

  it("junta navegador e sistema pela frase traduzível", () => {
    expect(descreverAparelho(UA.chromeWindows, pt)).toBe("Chrome no Windows");
    expect(descreverAparelho(UA.safariIphone, es)).toBe("Safari en iPhone");
  });

  it("com só uma das partes, mostra a parte; sem nenhuma, diz que não reconheceu", () => {
    expect(descreverAparelho("Mozilla/5.0 (Windows NT 10.0) Foo/1", pt)).toBe("Windows");
    expect(descreverAparelho(null, pt)).toBe("Navegador desconhecido");
  });
});

describe("mascararIp", () => {
  it("IPv4 perde o último octeto (inclusive o mapeado em IPv6 e com porta)", () => {
    expect(mascararIp("203.0.113.45")).toBe("203.0.113.x");
    expect(mascararIp("::ffff:198.51.100.9")).toBe("198.51.100.x");
    expect(mascararIp("198.51.100.9:443")).toBe("198.51.100.x");
  });

  it("IPv6 fica só com o prefixo da rede", () => {
    expect(mascararIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::x");
  });

  it("nulo continua nulo, e o que não é IP não sai inteiro", () => {
    expect(mascararIp(null)).toBeNull();
    expect(mascararIp("")).toBeNull();
    expect(mascararIp("nao-sou-ip")).toBe("—");
  });
});
