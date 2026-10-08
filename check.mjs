// Monitor do Ezcala Resultados (autocontido: só Node 22 e playwright).
//
// Confere a página inicial, a rota de saúde (banco, master e e-mail), duas rotas que devem dar 404 e o login do
// usuário de monitoramento. Com o argumento "email-diario", faz só o teste diário de envio: pede à rota
// /api/saude/email um e-mail de checagem para o endereço de teste do Resend e exige o evento "delivered".
// O log é público: imprime só "ok" ou "falhou: <motivos curtos sem dados>". Nunca imprime URL, e-mail nem segredo.
//
// Variáveis (Actions secrets): MONITOR_EMAIL, MONITOR_PASSWORD, MONITOR_SECRET.
// Opcionais: MONITOR_URL (variável do repositório), MONITOR_NOME, MONITOR_RESULT_FILE (onde gravar o motivo),
// MONITOR_DETALHADO=1 (uma linha por verificação, formato "ok: ..." / "falhou: ...", para uso local),
// MONITOR_IGNORAR_EMAIL=1 (não confere o campo email da saúde; só enquanto o Resend não estiver configurado).

import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_PADRAO = "https://dashboard.ezcala.com.br";
const NOME_PADRAO = "Monitoramento Ezcala";
const UA_MARK = "EzrMonitor/1";
const TIMEOUT_HTTP_MS = 20_000;
const TIMEOUT_LOGIN_MS = 45_000;
// A rota espera até 30 s pelo evento de entrega, mais o envio.
const TIMEOUT_EMAIL_MS = 75_000;
// Endereço público de teste do Resend: aceita o envio e gera o evento "delivered" sem entregar a ninguém.
export const DESTINO_TESTE = "delivered@resend.dev";

function envOf(name) {
  const v = (process.env[name] ?? "").trim();
  return v === "" ? undefined : v;
}

export function config(env = process.env) {
  const get = (n) => ((env[n] ?? "").trim() === "" ? undefined : env[n].trim());
  return {
    baseUrl: new URL(get("MONITOR_URL") ?? URL_PADRAO).origin,
    email: get("MONITOR_EMAIL"),
    password: env.MONITOR_PASSWORD ? env.MONITOR_PASSWORD : undefined,
    secret: get("MONITOR_SECRET"),
    nome: get("MONITOR_NOME") ?? NOME_PADRAO,
    ignorarEmail: get("MONITOR_IGNORAR_EMAIL") === "1",
  };
}

export function redigir(texto, segredos) {
  let out = String(texto);
  for (const s of segredos) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join("***");
  }
  // Rede extra: nada que pareça e-mail ou URL sai no log público.
  return out.replace(/\S+@\S+/g, "***").replace(/https?:\/\/\S+/g, "***");
}

function valorCurto(v) {
  return typeof v === "string" && /^[a-z_]{1,24}$/.test(v) ? v : "inesperado";
}

export function motivoSaude(corpo) {
  if (!corpo || typeof corpo !== "object") return "saude sem JSON";
  const p = [];
  if (corpo.ok !== true) p.push("ok diferente de true");
  if (corpo.banco !== "certo") p.push(`banco ${valorCurto(corpo.banco)}`);
  if (corpo.master !== "ativo") p.push(`master ${valorCurto(corpo.master)}`);
  return p.length ? `saude: ${p.join(", ")}` : null;
}

/** Campo email de /api/saude: só "ok" passa. */
export function motivoEmail(corpo) {
  if (!corpo || typeof corpo !== "object") return "email: saude sem JSON";
  return corpo.email === "ok" ? null : `email ${valorCurto(corpo.email)}`;
}

/** Resposta de POST /api/saude/email?acao=enviar-teste: só passa com 200 e último evento "delivered". */
export function motivoEnvioTeste(status, corpo) {
  if (!corpo || typeof corpo !== "object") return `email teste respondeu ${status}`;
  if (status !== 200) return `email teste respondeu ${status}${corpo.erro ? ` (${valorCurto(corpo.erro)})` : ""}`;
  if (corpo.ultimo_evento !== "delivered") return `email teste: ultimo evento ${corpo.ultimo_evento == null ? "nenhum" : valorCurto(corpo.ultimo_evento)}`;
  return null;
}

function temFormularioLogin(html) {
  return /name=["']?email["']?/i.test(html) && /(type|name)=["']?password["']?/i.test(html);
}

async function pegar(cfg, path, extra = {}) {
  return fetch(new URL(path, cfg.baseUrl), {
    headers: { "user-agent": `Mozilla/5.0 ${UA_MARK}`, "cache-control": "no-cache", ...extra },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_HTTP_MS),
  });
}

async function checarInicio(cfg) {
  try {
    const r = await pegar(cfg, "/");
    if (r.status !== 200) return { ok: false, texto: `pagina inicial respondeu ${r.status}` };
    if (!temFormularioLogin(await r.text())) return { ok: false, texto: "pagina inicial sem formulario de login" };
    return { ok: true, texto: "pagina inicial" };
  } catch {
    return { ok: false, texto: "pagina inicial fora do ar" };
  }
}

/** Saúde (banco e master) e, numa linha separada, o campo email. */
async function checarSaude(cfg) {
  if (!cfg.secret) return [{ ok: false, texto: "saude: segredo ausente" }];
  let r;
  let corpo = null;
  try {
    r = await pegar(cfg, "/api/saude", { authorization: `Bearer ${cfg.secret}`, accept: "application/json" });
    try {
      corpo = await r.json();
    } catch {
      corpo = null;
    }
  } catch {
    return [{ ok: false, texto: "saude fora do ar" }];
  }
  let saude;
  if (r.status !== 200) {
    const d = corpo ? motivoSaude(corpo) : null;
    saude = { ok: false, texto: `saude respondeu ${r.status}${d ? ` (${d.replace(/^saude: /, "")})` : ""}` };
  } else {
    const m = motivoSaude(corpo);
    saude = m ? { ok: false, texto: m } : { ok: true, texto: "saude" };
  }
  if (cfg.ignorarEmail || !corpo || typeof corpo !== "object") return [saude];
  const e = motivoEmail(corpo);
  return [saude, e ? { ok: false, texto: e } : { ok: true, texto: "email" }];
}

/** Teste diário: um envio real para o endereço de teste do Resend, exigindo o evento "delivered". */
export async function verificarEmailDiario(cfg) {
  if (!cfg.secret) return [{ ok: false, texto: "email teste: segredo ausente" }];
  const caminho = `/api/saude/email?acao=enviar-teste&para=${encodeURIComponent(DESTINO_TESTE)}`;
  try {
    const r = await fetch(new URL(caminho, cfg.baseUrl), {
      method: "POST",
      headers: { "user-agent": `Mozilla/5.0 ${UA_MARK}`, authorization: `Bearer ${cfg.secret}`, accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_EMAIL_MS),
    });
    let corpo = null;
    try {
      corpo = await r.json();
    } catch {
      corpo = null;
    }
    const m = motivoEnvioTeste(r.status, corpo);
    return [m ? { ok: false, texto: m } : { ok: true, texto: "email teste entregue" }];
  } catch {
    return [{ ok: false, texto: "email teste sem resposta" }];
  }
}

async function checar404(cfg, path) {
  try {
    const r = await pegar(cfg, path);
    await r.body?.cancel().catch(() => undefined);
    return r.status === 404 ? { ok: true, texto: `${path} 404` } : { ok: false, texto: `${path} respondeu ${r.status}` };
  } catch {
    return { ok: false, texto: `${path} sem resposta` };
  }
}

async function checarLogin(cfg) {
  if (!cfg.email || !cfg.password) return { ok: false, texto: "login: credenciais ausentes" };
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { ok: false, texto: "login: playwright ausente" };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    return { ok: false, texto: "login: navegador nao abriu" };
  }
  try {
    const context = await browser.newContext({
      baseURL: cfg.baseUrl,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ${UA_MARK}`,
    });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: TIMEOUT_LOGIN_MS });
    const form = page
      .locator("form")
      .filter({ has: page.locator('input[name="email"], input[type="email"]') })
      .filter({ has: page.locator('input[type="password"], input[name="password"]') })
      .first();
    try {
      await form.waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      return { ok: false, texto: "login: formulario nao apareceu" };
    }
    await form.locator('input[name="email"], input[type="email"]').first().fill(cfg.email);
    await form.locator('input[type="password"], input[name="password"]').first().fill(cfg.password);
    await form.locator('button[type="submit"]').first().click();
    try {
      await page.waitForURL((u) => u.pathname.startsWith("/painel") || u.pathname === "/nova-senha", { timeout: TIMEOUT_LOGIN_MS });
    } catch {
      return { ok: false, texto: "login: nao chegou ao painel" };
    }
    if (new URL(page.url()).pathname === "/nova-senha") return { ok: false, texto: "login: conta pede troca de senha" };
    try {
      await page.getByText(cfg.nome, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      return { ok: false, texto: "login: painel sem o nome esperado" };
    }
    // Sai da conta para não acumular sessões (melhor esforço).
    await page
      .evaluate(() => {
        const f = Array.from(document.querySelectorAll("form")).find((x) => x.querySelector("h3") && x.querySelector('button[type="submit"]'));
        f?.requestSubmit();
      })
      .catch(() => undefined);
    await page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 }).catch(() => undefined);
    return { ok: true, texto: "login" };
  } catch {
    return { ok: false, texto: "login: erro no navegador" };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function verificar(cfg) {
  const r = [];
  r.push(await checarInicio(cfg));
  r.push(...(await checarSaude(cfg)));
  r.push(await checar404(cfg, "/admin"));
  r.push(await checar404(cfg, "/dashboard"));
  r.push(await checarLogin(cfg));
  return r;
}

/** Linha final do log público. */
export function resumoPublico(resultados, segredos) {
  const falhas = resultados.filter((x) => !x.ok).map((x) => redigir(x.texto, segredos));
  return falhas.length ? `falhou: ${falhas.join("; ")}` : "ok";
}

async function main() {
  let cfg;
  try {
    cfg = config();
  } catch {
    console.log("falhou: endereco invalido");
    return 1;
  }
  const segredos = [cfg.email, cfg.password, cfg.secret];
  const resultados = process.argv[2] === "email-diario" ? await verificarEmailDiario(cfg) : await verificar(cfg);
  if (envOf("MONITOR_DETALHADO") === "1") {
    for (const x of resultados) console.log(`${x.ok ? "ok" : "falhou"}: ${redigir(x.texto, segredos)}`);
    console.log(`resultado: ${resultados.every((x) => x.ok) ? "ok" : "falhou"}`);
  } else {
    console.log(resumoPublico(resultados, segredos));
  }
  const arquivo = envOf("MONITOR_RESULT_FILE");
  if (arquivo) {
    const motivo = resumoPublico(resultados, segredos).replace(/^falhou: /, "");
    try {
      writeFileSync(arquivo, motivo === "ok" ? "" : motivo);
    } catch {
      // sem arquivo de motivo, a issue usa um texto genérico
    }
  }
  return resultados.every((x) => x.ok) ? 0 : 1;
}

function ehEntrada() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (ehEntrada()) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.log("falhou: erro inesperado no monitor");
      process.exit(1);
    },
  );
}
