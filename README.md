# Monitor do Ezcala Resultados

Verifica o site a cada 15 minutos pelo GitHub Actions (repositório público, minutos grátis) e testa o envio de e-mail uma vez por dia.

## O que ele confere

1. A página inicial responde 200 com o formulário de login.
2. A rota de saúde responde que o banco está certo e o acesso administrativo está ativo.
3. A mesma rota responde `email: "ok"` (chave do Resend presente e domínio verificado). Essa conferência não envia e-mail.
4. Duas rotas que não existem respondem 404.
5. O usuário de monitoramento entra e chega ao painel com o nome esperado (navegador Chromium sem tela).

### Teste diário de e-mail

O workflow `email.yml` roda uma vez por dia às 9h de Brasília (`0 12 * * *` em UTC) e também pode ser disparado na mão. Ele pede ao site um e-mail curto de checagem para o endereço de teste do Resend (não chega a ninguém) e falha se o último evento não for `delivered`. Não usa navegador nem as credenciais de login, só `MONITOR_SECRET`.

O log é público e mostra só `ok` ou `falhou: <motivo curto>`. Nenhum endereço, e-mail ou senha aparece.

## Quando falha

- O job falha e o GitHub manda e-mail de falha para o dono.
- Uma issue "Ezcala Resultados fora do ar" (ou "Envio de e-mail do Ezcala Resultados falhou", no teste diário) é aberta (ou recebe comentário quando o motivo muda). O bot do GitHub é o autor, então chega e-mail.
- Quando o site volta, a issue é fechada sozinha.

## Configuração

Em Settings, Secrets and variables, Actions, crie os segredos:

- `MONITOR_EMAIL`: e-mail do usuário de monitoramento.
- `MONITOR_PASSWORD`: senha desse usuário.
- `MONITOR_SECRET`: chave da rota de saúde.

Opcional, em Variables:

- `MONITOR_URL` para apontar para outro endereço.
- `MONITOR_IGNORAR_EMAIL` = `1` só enquanto o Resend ainda não estiver configurado: o monitor de 15 minutos deixa de conferir o campo `email`. Apague a variável assim que o domínio estiver verificado. O teste diário continua falhando até lá, de propósito.

Em Settings, Notifications (da sua conta), deixe ligado o e-mail de Actions e de issues dos repositórios que você acompanha.

## Rodar na mão

Actions, Monitor, Run workflow. Ou, localmente:

```
npm install
npx playwright install chromium
MONITOR_DETALHADO=1 node check.mjs
MONITOR_DETALHADO=1 node check.mjs email-diario
```

## Agendamento

O GitHub desliga agendamentos de repositórios públicos sem atividade por 60 dias. O próprio workflow faz um commit vazio a cada 45 dias para evitar isso. Se mesmo assim ele for desligado, reative em Actions, Monitor, Enable workflow.

## Aviso de deploy revertido

O workflow `aviso.yml` é disparado pelo deploy seguro depois de um rollback automático e abre uma issue "Deploy revertido automaticamente".
