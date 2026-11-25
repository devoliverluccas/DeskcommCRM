import { SCRIPT_DO_CHAT } from "@/lib/channels/webchat/script";

/**
 * GET /webchat.js — o script público do chat do site (fase 5, item 5.3).
 *
 * Um arquivo só para toda instalação e toda organização: quem ele atende sai do
 * `data-chave` da tag e a aparência vem da rota pública de configuração. Por
 * isso não mora em `public/` com marca nenhuma, e não há `NEXT_PUBLIC_*`
 * envolvido. Cache curto (5 min): uma correção no script chega logo aos sites.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(SCRIPT_DO_CHAT, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // O site da empresa carrega o arquivo por `<script src>`, de outro domínio.
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
