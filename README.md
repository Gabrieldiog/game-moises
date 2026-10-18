# Game Moisés

Jogo Moisés. Regras de trabalho em `CLAUDE.md`; agentes em `.claude/agents/`.

## Cliente web (v0.3)

```bash
npm install
npm run dev -w client        # abre o Vite; sem VITE_SERVER_URL usa a partida local de demonstração
npm run build                # build de produção do cliente (client/dist)
```

Configuração em `client/.env.example` (`VITE_SERVER_URL`). Modo demo: em dev, ou em qualquer build com
`?demo=<cena>&jogadores=<2..6>` (ex.: `?demo=reacao&jogadores=4`; `&tempo=3` deixa os prazos 3× mais longos).
Cenas: `arrumacao`, `espiada`, `minha-vez`, `comprada`, `poder-ver-minha`, `poder-ver-inimigo`, `poder-q`,
`poder-j`, `poder-j-troca`, `poder-k`, `poder-k-troca`, `reacao`, `vez-de-outro`, `estou-foda`, `fim`.
