# Game Moisés

Jogo Moisés. Regras de trabalho em `CLAUDE.md`; agentes em `.claude/agents/`.

## Como rodar

Requer Node 22 (`.nvmrc`).

```sh
npm ci
npm run dev -w server     # servidor em desenvolvimento (tsx, recarrega ao salvar)
npm test                  # testes (Vitest)
npm run typecheck
npm run build             # build de produção: server/dist/main.js (esbuild)
npm start -w server       # roda o build
curl http://localhost:3000/health
```

Configuração por variáveis de ambiente, validadas ao iniciar: veja `server/.env.example` (copie para `server/.env`). Em produção, `NODE_ENV=production` e `CORS_ORIGIN` são obrigatórios. Para implantar: gere o build com `npm ci && npm run build` (precisa das dependências de desenvolvimento); no ambiente final, `npm ci --omit=dev` e `node --enable-source-maps server/dist/main.js`. O build já inclui o pacote `shared`; socket.io e zod vêm de `node_modules`.

Implantação (VM, Docker, Caddy): `docs/DEPLOY.md`. Com `STATIC_DIR=client/dist` o servidor também serve o cliente (uma porta só).

Documentos: regras em `docs/REGRAS.md`, protocolo cliente ↔ servidor em `docs/PROTOCOLO.md`, plano em `docs/RELEASES.md`.

### Cliente web

```bash
npm run dev -w client        # abre o Vite; sem VITE_SERVER_URL usa a partida local de demonstração
# o `npm run build` da raiz também gera client/dist
```

Configuração em `client/.env.example` (`VITE_SERVER_URL`). Modo demo: em dev, ou em qualquer build com
`?demo=<cena>&jogadores=<2..6>` (ex.: `?demo=reacao&jogadores=4`; `&tempo=3` deixa os prazos 3× mais longos).
Cenas: `arrumacao`, `espiada`, `minha-vez`, `comprada`, `poder-ver-minha`, `poder-ver-inimigo`, `poder-q`,
`poder-j`, `poder-j-troca`, `poder-k`, `poder-k-troca`, `reacao`, `vez-de-outro`, `estou-foda`, `fim`.

## Como jogar
- Cada jogador recebe 4 cartas viradas (grade 2×2). No começo você vê por 5 s as 2 de baixo. Decore!
- Na sua vez, compre do monte e troque com uma das suas ou descarte. Cartas de poder (7–K preto) só valem se forem compradas e descartadas.
- Alguém descartou um número que você tem? Grite **"Filha da putinha!"** e descarte a sua. Sabe onde está esse número na mesa de um inimigo? **"Filho da puta!"**: pegue a dele e entregue uma sua.
- Quando achar que tem a menor soma, fale **"Estou foda"**. Cada um joga mais uma vez e todas as cartas são reveladas. Menor soma vence (K vermelho = −1, coringa = 0).
- Regras completas em `docs/REGRAS.md`; deploy em `docs/DEPLOY.md`.
