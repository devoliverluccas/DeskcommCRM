/**
 * A ABA MÍDIAS DO PAINEL — sub-filtros, grade, lista, abrir e "carregar mais".
 *
 * A rota que lista (`GET /api/v1/conversations/[id]/media`) tem teste próprio,
 * ao lado dela. Aqui o `apiClient` é dublê e o que se mede é a TELA: qual tipo
 * a tela pede, como desenha cada tipo, que o arquivo é aberto pelo MESMO
 * caminho do balão (`/api/v1/messages/{id}/media`) e que a segunda página
 * entra embaixo da primeira com o cursor que o servidor devolveu.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MidiaDaConversa } from "@/hooks/inbox/useMidiasDaConversa";

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => h.get(...a) } }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { MidiasDaConversa } from "./MidiasDaConversa";

const CONVERSA = "33333333-3333-4333-8333-333333333333";

function item(p: Partial<MidiaDaConversa> & { id: string }): MidiaDaConversa {
  return {
    type: "image",
    direction: "inbound",
    media_mime: "image/jpeg",
    media_size_bytes: 2048,
    media_storage_path: `org/conv/${p.id}.jpg`,
    nome: null,
    sent_at: "2026-11-20T10:00:00.000Z",
    ...p,
  };
}

/** O "servidor": responde por `tipo` e por `cursor`, como a rota. */
let paginas: Record<string, Array<{ data: MidiaDaConversa[]; meta: { cursor: string | null; has_more: boolean } }>>;

beforeEach(() => {
  h.get.mockReset();
  paginas = {};
  h.get.mockImplementation(async (url: string) => {
    const qs = new URL(url, "http://x").searchParams;
    const lista = paginas[qs.get("tipo") ?? ""] ?? [];
    const indice = qs.get("cursor") ? Number(qs.get("cursor")!.replace("c", "")) : 0;
    return lista[indice] ?? { data: [], meta: { cursor: null, has_more: false } };
  });
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MidiasDaConversa conversationId={CONVERSA} />
    </QueryClientProvider>,
  );
}

const urlsPedidas = () => h.get.mock.calls.map(([url]) => String(url));

describe("aba Mídias — sub-filtros", () => {
  it("abre em Fotos e pede só imagens desta conversa", async () => {
    paginas.imagem = [{ data: [item({ id: "m1" })], meta: { cursor: null, has_more: false } }];
    montar();

    expect(await screen.findByTestId("inbox-midias-grade")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fotos" })).toHaveAttribute("aria-pressed", "true");
    expect(urlsPedidas()[0]).toContain(`/api/v1/conversations/${CONVERSA}/media?`);
    expect(urlsPedidas()[0]).toContain("tipo=imagem");
  });

  it.each([
    ["Vídeos", "video"],
    ["Documentos", "documento"],
    ["Áudios", "audio"],
  ])("%s pede ?tipo=%s", async (rotulo, tipo) => {
    montar();
    await screen.findByTestId("inbox-midias-vazio");
    const u = userEvent.setup();

    await u.click(screen.getByRole("button", { name: rotulo }));

    expect(screen.getByRole("button", { name: rotulo })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(urlsPedidas().some((url) => url.includes(`tipo=${tipo}`))).toBe(true));
  });

  it("sem nada do tipo, diz isso", async () => {
    montar();
    expect(await screen.findByText("Nenhuma mídia deste tipo nesta conversa.")).toBeInTheDocument();
  });

  it("falha de leitura não vira lista vazia: avisa e tenta de novo", async () => {
    h.get.mockRejectedValueOnce(new Error("500"));
    montar();

    expect(await screen.findByText("Não foi possível carregar as mídias.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma mídia deste tipo nesta conversa.")).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nenhuma mídia deste tipo nesta conversa.")).toBeInTheDocument();
  });
});

describe("aba Mídias — cada tipo desenha como o fio", () => {
  it("foto em grade, servida pela rota da mensagem, e o clique amplia como no fio", async () => {
    paginas.imagem = [
      { data: [item({ id: "m1" }), item({ id: "m2" })], meta: { cursor: null, has_more: false } },
    ];
    montar();

    const grade = await screen.findByTestId("inbox-midias-grade");
    const imagens = within(grade).getAllByRole("img");
    expect(imagens.map((img) => img.getAttribute("src"))).toEqual([
      "/api/v1/messages/m1/media",
      "/api/v1/messages/m2/media",
    ]);

    fireEvent.load(imagens[0]!);
    const ampliar = within(grade).getAllByRole("button", { name: "Ampliar imagem" })[0]!;
    await userEvent.setup().click(ampliar);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("documento em lista, com o nome original e o link de abrir da mensagem", async () => {
    paginas.documento = [
      {
        data: [
          item({
            id: "d1",
            type: "document",
            media_mime: "application/pdf",
            media_storage_path: "org/conv/d1.pdf",
            nome: "contrato.pdf",
          }),
        ],
        meta: { cursor: null, has_more: false },
      },
    ];
    montar();
    await screen.findByTestId("inbox-midias-vazio");
    await userEvent.setup().click(screen.getByRole("button", { name: "Documentos" }));

    const lista = await screen.findByTestId("inbox-midias-lista");
    expect(within(lista).getByText("contrato.pdf")).toBeInTheDocument();
    const abrir = within(lista).getByRole("link", { name: /^contrato\.pdf/ });
    expect(abrir).toHaveAttribute("href", "/api/v1/messages/d1/media");
  });

  it("áudio em lista, com o player do fio", async () => {
    paginas.audio = [
      {
        data: [item({ id: "a1", type: "audio", media_mime: "audio/mpeg", media_storage_path: "org/conv/a1.mp3" })],
        meta: { cursor: null, has_more: false },
      },
    ];
    montar();
    await screen.findByTestId("inbox-midias-vazio");
    await userEvent.setup().click(screen.getByRole("button", { name: "Áudios" }));

    const lista = await screen.findByTestId("inbox-midias-lista");
    expect(within(lista).getByRole("button", { name: /reproduzir/i })).toBeInTheDocument();
  });
});

describe("aba Mídias — carregar mais", () => {
  it("a segunda página entra embaixo, pedida com o cursor do servidor", async () => {
    paginas.imagem = [
      { data: [item({ id: "m1" }), item({ id: "m2" })], meta: { cursor: "c1", has_more: true } },
      { data: [item({ id: "m3" })], meta: { cursor: null, has_more: false } },
    ];
    montar();
    await screen.findByTestId("inbox-midias-grade");

    await userEvent.setup().click(screen.getByRole("button", { name: "Carregar mais" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("inbox-midia-item").map((el) => el.getAttribute("data-midia-id"))).toEqual([
        "m1",
        "m2",
        "m3",
      ]),
    );
    expect(urlsPedidas().some((url) => url.includes("cursor=c1"))).toBe(true);
    // Acabou: o botão sai.
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("inativa (aba fechada), não pergunta nada ao servidor", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MidiasDaConversa conversationId={CONVERSA} ativo={false} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(h.get).not.toHaveBeenCalled();
  });
});
