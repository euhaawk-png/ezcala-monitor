# Monitor do Ezcala Resultados

Verifica o site a cada 15 minutos pelo GitHub Actions (repositório público, minutos grátis).

## O que ele confere

1. A página inicial responde 200 com o formulário de login.
2. A rota de saúde responde que o banco está certo e o acesso administrativo está ativo.
3. Duas rotas que não existem respondem 404.
4. O usuário de monitoramento entra e chega ao painel com o nome esperado (navegador Chromium sem tela).

O log é público e mostra só `ok` ou `falhou: <motivo curto>`. Nenhum endereço, e-mail ou senha aparece.

## Quando falha

- O job falha e o GitHub manda e-mail de falha para o dono.
- Uma issue "Ezcala Resultados fora do ar" é aberta (ou recebe comentário quando o motivo muda). O bot do GitHub é o autor, então chega e-mail.
- Quando o site volta, a issue é fechada sozinha.

## Configuração

Em Settings, Secrets and variables, Actions, crie os segredos:

- `MONITOR_EMAIL`: e-mail do usuário de monitoramento.
- `MONITOR_PASSWORD`: senha desse usuário.
- `MONITOR_SECRET`: chave da rota de saúde.

Opcional, em Variables: `MONITOR_URL` para apontar para outro endereço.

Em Settings, Notifications (da sua conta), deixe ligado o e-mail de Actions e de issues dos repositórios que você acompanha.

## Rodar na mão

Actions, Monitor, Run workflow. Ou, localmente:

```
npm install
npx playwright install chromium
MONITOR_DETALHADO=1 node check.mjs
```

## Agendamento

O GitHub desliga agendamentos de repositórios públicos sem atividade por 60 dias. O próprio workflow faz um commit vazio a cada 45 dias para evitar isso. Se mesmo assim ele for desligado, reative em Actions, Monitor, Enable workflow.

## Aviso de deploy revertido

O workflow `aviso.yml` é disparado pelo deploy seguro depois de um rollback automático e abre uma issue "Deploy revertido automaticamente".
