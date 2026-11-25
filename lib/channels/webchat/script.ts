/**
 * O script público do chat do site (`/webchat.js`) — JavaScript puro, sem
 * framework, servido pelo app (`app/webchat.js/route.ts`).
 *
 * Regras que ele carrega:
 *   - NADA de marca embutida: o nome, a saudação e a cor vêm da configuração da
 *     empresa, pela rota pública. O mesmo arquivo serve toda instalação e toda
 *     organização (doutrina de marca própria: uma imagem, todas as marcas).
 *   - Nenhum cookie: o token do visitante fica no `localStorage` do domínio do
 *     site, e viaja no cabeçalho `X-Webchat-Visitante`, nunca na URL.
 *   - Estilo isolado em Shadow DOM: o CSS do site não quebra a janela, e a
 *     janela não vaza estilo para o site.
 *   - Texto do servidor entra por `textContent`, nunca por `innerHTML`.
 *   - Acessível: bolha com `aria-label`/`aria-expanded`, janela `role=dialog`,
 *     lista `role=log` com `aria-live`, Esc fecha e devolve o foco, alvos de 44px.
 *   - Polling simples (o intervalo vem da config) só com a janela aberta e a
 *     aba visível.
 *
 * O texto é montado com `String.raw` e SEM template string dentro: o arquivo
 * vira um literal só, sem interpolação acidental.
 */
export const SCRIPT_DO_CHAT = String.raw`(function () {
  "use strict";
  if (window.__chatDoSiteCarregado) return;
  window.__chatDoSiteCarregado = true;

  var script = document.currentScript || document.querySelector("script[data-chave][src*='webchat.js']");
  if (!script) return;
  var chave = script.getAttribute("data-chave") || "";
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(chave)) return;
  var base;
  try { base = new URL(script.src).origin; } catch (e) { return; }
  var api = base + "/api/v1/webchat/" + chave;
  var CHAVE_LOCAL = "chat_do_site_visitante_" + chave;

  function lerToken() { try { return window.localStorage.getItem(CHAVE_LOCAL); } catch (e) { return null; } }
  function gravarToken(v) { try { if (v) window.localStorage.setItem(CHAVE_LOCAL, v); else window.localStorage.removeItem(CHAVE_LOCAL); } catch (e) {} }
  function novoId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = new Uint8Array(16); window.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function pedir(caminho, opcoes) {
    opcoes = opcoes || {};
    var cab = { "Accept": "application/json" };
    if (opcoes.corpo) cab["Content-Type"] = "application/json";
    var token = lerToken();
    if (token) cab["X-Webchat-Visitante"] = token;
    return fetch(api + caminho, {
      method: opcoes.metodo || "GET",
      headers: cab,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      credentials: "omit",
      mode: "cors"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var err = new Error("http_" + r.status); err.status = r.status; throw err; }
        return j && j.data;
      });
    });
  }

  function corDoTexto(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "#ffffff";
    var c = [m[1], m[2], m[3]].map(function (x) {
      var v = parseInt(x, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return l > 0.4 ? "#111114" : "#ffffff";
  }

  pedir("/config").then(function (cfg) {
    if (!cfg) return;
    montar(cfg);
  }).catch(function () { /* chat desligado ou domínio fora da lista: não aparece */ });

  function montar(cfg) {
    var T = cfg.textos || {};
    var cor = /^#[0-9a-fA-F]{6}$/.test(cfg.cor) ? cfg.cor : "#1a1a1e";
    var tinta = corDoTexto(cor);
    var lado = cfg.posicao === "esquerda" ? "left" : "right";
    var maxTexto = cfg.max_texto || 2000;
    var intervalo = Math.max(2000, cfg.intervalo_ms || 4000);

    var host = document.createElement("div");
    host.setAttribute("data-chat-do-site", "");
    var raiz = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var estilo = document.createElement("style");
    estilo.textContent = [
      ":host{all:initial}",
      "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
      ".bolha{position:fixed;bottom:20px;" + lado + ":20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:" + cor + ";color:" + tinta + ";display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18)}",
      ".icone{position:relative;display:block;width:24px;height:18px;border-radius:5px;background:currentColor}",
      ".icone::after{content:'';position:absolute;left:4px;bottom:-6px;border-width:6px 6px 0 0;border-style:solid;border-color:currentColor transparent transparent transparent}",
      ".bolha:focus-visible,.fechar:focus-visible,.enviar:focus-visible,textarea:focus-visible{outline:3px solid " + cor + ";outline-offset:2px}",
      ".janela{position:fixed;bottom:88px;" + lado + ":20px;z-index:2147483000;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 120px);background:#fff;color:#1a1a1e;border:1px solid #d9d9de;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.16)}",
      ".janela[hidden]{display:none}",
      "@media (max-width:480px){.janela{left:0;right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}}",
      ".topo{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 16px;background:" + cor + ";color:" + tinta + "}",
      ".titulo{font-size:15px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".fechar{width:44px;height:44px;border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;border-radius:8px}",
      ".lista{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f7f7f8;margin:0;list-style:none}",
      ".msg{max-width:85%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}",
      ".msg.empresa{align-self:flex-start;background:#fff;border:1px solid #e4e4e7}",
      ".msg.visitante{align-self:flex-end;background:" + cor + ";color:" + tinta + "}",
      ".msg.pendente{opacity:.6}",
      ".msg img{display:block;max-width:100%;border-radius:8px;margin-bottom:4px}",
      ".msg a{color:inherit;text-decoration:underline}",
      ".erro{font-size:12px;color:#b4232c;padding:0 12px 4px;min-height:16px}",
      ".form{display:flex;gap:8px;padding:8px;border-top:1px solid #e4e4e7;background:#fff}",
      "textarea{flex:1;resize:none;min-height:44px;max-height:120px;padding:10px 12px;border:1px solid #d9d9de;border-radius:8px;font-size:16px;color:#1a1a1e;background:#fff}",
      ".enviar{min-width:44px;height:44px;padding:0 14px;border:0;border-radius:8px;background:" + cor + ";color:" + tinta + ";font-size:14px;font-weight:600;cursor:pointer}",
      ".enviar:disabled{opacity:.5;cursor:default}",
      ".oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}"
    ].join("\n");
    raiz.appendChild(estilo);

    var bolha = document.createElement("button");
    bolha.type = "button";
    bolha.className = "bolha";
    bolha.setAttribute("aria-label", T.abrir || "Chat");
    bolha.setAttribute("aria-expanded", "false");
    bolha.setAttribute("aria-controls", "janela-do-chat");
    // O ícone é desenhado em CSS (balão + rabicho): nenhum recurso externo a buscar.
    var icone = document.createElement("span"); icone.className = "icone"; icone.setAttribute("aria-hidden", "true");
    bolha.appendChild(icone);

    var janela = document.createElement("div");
    janela.className = "janela";
    janela.id = "janela-do-chat";
    janela.hidden = true;
    janela.setAttribute("role", "dialog");
    janela.setAttribute("aria-label", cfg.nome || "Chat");

    var topo = document.createElement("div"); topo.className = "topo";
    var titulo = document.createElement("h2"); titulo.className = "titulo"; titulo.textContent = cfg.nome || "";
    var fechar = document.createElement("button"); fechar.type = "button"; fechar.className = "fechar";
    fechar.setAttribute("aria-label", T.fechar || "Fechar"); fechar.textContent = "×";
    topo.appendChild(titulo); topo.appendChild(fechar);

    var lista = document.createElement("ol");
    lista.className = "lista";
    lista.setAttribute("role", "log");
    lista.setAttribute("aria-live", "polite");
    lista.setAttribute("aria-label", T.mensagens || "");

    var erro = document.createElement("div"); erro.className = "erro"; erro.setAttribute("role", "status");

    var form = document.createElement("form"); form.className = "form";
    var rotulo = document.createElement("label"); rotulo.className = "oculto"; rotulo.htmlFor = "texto-do-chat";
    rotulo.textContent = T.placeholder || "";
    var campo = document.createElement("textarea"); campo.id = "texto-do-chat"; campo.rows = 1;
    campo.maxLength = maxTexto; campo.placeholder = T.placeholder || "";
    var enviar = document.createElement("button"); enviar.type = "submit"; enviar.className = "enviar";
    enviar.textContent = T.enviar || "Enviar";
    form.appendChild(rotulo); form.appendChild(campo); form.appendChild(enviar);

    janela.appendChild(topo); janela.appendChild(lista); janela.appendChild(erro); janela.appendChild(form);
    raiz.appendChild(janela); raiz.appendChild(bolha);
    document.body.appendChild(host);

    var vistos = {};
    var pendentes = [];
    var cursor = null;
    var timer = null;
    var aberta = false;

    function rolar() { lista.scrollTop = lista.scrollHeight; }

    function bolhaDeMensagem(autor, texto, midia) {
      var li = document.createElement("li");
      li.className = "msg " + (autor === "visitante" ? "visitante" : "empresa");
      if (midia && midia.url && /^https:\/\//i.test(midia.url)) {
        if (/^image\//.test(midia.mime || "")) {
          var img = document.createElement("img"); img.src = midia.url; img.alt = ""; img.loading = "lazy";
          li.appendChild(img);
        } else {
          var a = document.createElement("a"); a.href = midia.url; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.textContent = "↓ " + (texto || T.arquivo || "");
          li.appendChild(a);
          texto = null;
        }
      }
      if (texto) li.appendChild(document.createTextNode(texto));
      return li;
    }

    if (cfg.saudacao) lista.appendChild(bolhaDeMensagem("empresa", cfg.saudacao, null));

    function receber(mensagens) {
      (mensagens || []).forEach(function (m) {
        if (!m || vistos[m.id]) return;
        vistos[m.id] = true;
        if (!cursor || m.criada_em > cursor) cursor = m.criada_em;
        if (m.autor === "visitante") {
          for (var i = 0; i < pendentes.length; i++) {
            if (pendentes[i].texto === m.texto) {
              pendentes[i].el.classList.remove("pendente");
              pendentes.splice(i, 1);
              return;
            }
          }
        }
        lista.appendChild(bolhaDeMensagem(m.autor, m.texto, m.midia));
      });
      rolar();
    }

    function encerrar() {
      gravarToken(null);
      vistos = {}; pendentes = []; cursor = null;
      while (lista.children.length > (cfg.saudacao ? 1 : 0)) lista.removeChild(lista.lastChild);
    }

    function buscar() {
      if (!lerToken()) return Promise.resolve();
      var q = cursor ? "?depois=" + encodeURIComponent(cursor) : "";
      return pedir("/mensagens" + q).then(function (d) {
        if (d && d.encerrada) { encerrar(); return; }
        receber(d && d.mensagens);
      }).catch(function () {});
    }

    function agendar() {
      clearTimeout(timer);
      if (!aberta) return;
      timer = setTimeout(function () {
        if (document.visibilityState === "hidden") { agendar(); return; }
        buscar().then(agendar);
      }, intervalo);
    }

    function garantirSessao() {
      if (lerToken()) return Promise.resolve(lerToken());
      return pedir("/sessao", { metodo: "POST", corpo: {} }).then(function (d) {
        if (d && d.visitante) gravarToken(d.visitante);
        return lerToken();
      });
    }

    function abrir() {
      aberta = true;
      janela.hidden = false;
      bolha.setAttribute("aria-expanded", "true");
      bolha.setAttribute("aria-label", T.fechar || "Fechar");
      campo.focus();
      buscar().then(agendar);
      rolar();
    }
    function fecharJanela() {
      aberta = false;
      clearTimeout(timer);
      janela.hidden = true;
      bolha.setAttribute("aria-expanded", "false");
      bolha.setAttribute("aria-label", T.abrir || "Chat");
      bolha.focus();
    }

    bolha.addEventListener("click", function () { if (aberta) fecharJanela(); else abrir(); });
    fechar.addEventListener("click", fecharJanela);
    janela.addEventListener("keydown", function (e) { if (e.key === "Escape") fecharJanela(); });
    campo.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); }
    });

    function mandar(corpo, tentativa) {
      return pedir("/mensagens", { metodo: "POST", corpo: corpo }).catch(function (err) {
        // Rede caiu: tenta de novo UMA vez com o MESMO id (o servidor descarta o repetido).
        if (!err.status && tentativa < 1) return mandar(corpo, tentativa + 1);
        throw err;
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var texto = campo.value.trim();
      if (!texto) return;
      erro.textContent = "";
      enviar.disabled = true;
      var el = bolhaDeMensagem("visitante", texto, null);
      el.classList.add("pendente");
      lista.appendChild(el); rolar();
      var pend = { texto: texto, el: el };
      pendentes.push(pend);
      campo.value = "";
      garantirSessao().then(function () {
        return mandar({ id: novoId(), texto: texto }, 0);
      }).then(function (d) {
        if (d && d.encerrada) { encerrar(); return; }
        // Marca como vista, mas NÃO avança o cursor: uma resposta criada antes
        // desta mensagem e ainda não buscada ficaria para trás.
        if (d && d.id) vistos[d.id] = true;
        el.classList.remove("pendente");
        var i = pendentes.indexOf(pend); if (i >= 0) pendentes.splice(i, 1);
        agendar();
      }).catch(function () {
        erro.textContent = T.falha || "";
        el.parentNode && el.parentNode.removeChild(el);
        var i = pendentes.indexOf(pend); if (i >= 0) pendentes.splice(i, 1);
        campo.value = texto;
      }).then(function () { enviar.disabled = false; });
    });
  }
})();
`;
