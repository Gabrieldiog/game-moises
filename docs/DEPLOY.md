# Implantação em uma VM Ubuntu

Uma porta só: o servidor Node serve o cliente web (`client/dist`), o Socket.IO e `/health`. Na frente fica o Caddy, que dá o HTTPS. O estado das partidas fica na memória: reiniciar o processo encerra as partidas em andamento.

## Variáveis

| Variável | Obrigatória | Valor |
|---|---|---|
| `NODE_ENV` | sim | `production` (sem `CORS_ORIGIN` o servidor não sobe) |
| `CORS_ORIGIN` | sim | origem pública, sem barra final: `https://moises.example.com` (`*` é recusado) |
| `PORT` | não (3000) | porta local do servidor |
| `TRUST_PROXY_HOPS` | sim, atrás do Caddy | `1`. Com `0`, todos os jogadores aparecem com o IP do proxy e dividem os limites por IP |
| `STATIC_DIR` | para servir o cliente | pasta do build do cliente. No Docker já vem configurada |
| `VITE_SERVER_URL` | não | só se o cliente for servido de outra origem. Vazio = conecta na própria origem (padrão nesta configuração) |

Demais ajustes (limites, tempos, bots): `server/.env.example`.

## Opção A: Docker

```sh
sudo apt update && sudo apt install -y git docker.io docker-compose-v2
git clone <repo> moises && cd moises
cp .env.example .env && nano .env      # CORS_ORIGIN, TRUST_PROXY_HOPS=1
sudo docker compose up -d --build
curl http://127.0.0.1:3000/health      # {"status":"ok"}
sudo docker compose ps                 # STATUS "healthy"
```

A porta é publicada só em `127.0.0.1`; o acesso externo passa pelo Caddy.

## Opção B: Node direto

```sh
# Node 22 (ex.: https://github.com/nodesource/distributions ou nvm)
git clone <repo> moises && cd moises
npm ci
npm run build
npm ci --omit=dev                      # opcional: tira dependências de desenvolvimento
sudo tee /etc/moises.env >/dev/null <<'ENV'
NODE_ENV=production
CORS_ORIGIN=https://moises.example.com
TRUST_PROXY_HOPS=1
PORT=3000
HOST=127.0.0.1
STATIC_DIR=/opt/moises/client/dist
ENV
```

Serviço `/etc/systemd/system/moises.service` (ajuste o caminho; mova o repo para `/opt/moises`):

```ini
[Unit]
Description=Moises
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/moises
EnvironmentFile=/etc/moises.env
ExecStart=/usr/bin/node --enable-source-maps server/dist/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now moises
journalctl -u moises -f
```

## HTTPS com Caddy

Aponte o DNS (registro A/AAAA) do domínio para a VM e libere as portas 80 e 443 no firewall (`sudo ufw allow 80,443/tcp`). Não libere a 3000.

```sh
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
moises.example.com {
	encode zstd gzip
	# WebSocket (Socket.IO) passa pelo reverse_proxy sem configuração extra.
	reverse_proxy 127.0.0.1:3000
}
```

```sh
sudo systemctl reload caddy
```

O Caddy emite e renova o certificado sozinho e envia `X-Forwarded-For` (por isso `TRUST_PROXY_HOPS=1`). Teste: abra `https://moises.example.com`, crie uma sala e entre por outro aparelho.

## Atualizar a versão

```sh
cd moises && git pull
# Docker:
sudo docker compose up -d --build
# Node direto:
npm ci && npm run build && npm ci --omit=dev
sudo systemctl restart moises
```

O reinício derruba as partidas em andamento: atualize fora do horário de jogo. Voltar a versão: `git checkout <tag-ou-commit-anterior>` e repetir o passo acima.

## Cache e cabeçalhos (já feitos pelo servidor)

`/assets/*` (nome com hash): `immutable`, 1 ano. `index.html`: `no-store`. Outros arquivos públicos: 1 hora. Todas as respostas estáticas levam CSP (`default-src 'self'`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`. HSTS não é enviado pelo Node; se quiser, ative no Caddy (`header Strict-Transport-Security "max-age=31536000"`) depois de confirmar que o HTTPS está estável.
