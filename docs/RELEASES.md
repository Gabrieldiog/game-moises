# Plano de releases

São 5 releases. Cada uma tem uma branch própria, quantos commits forem necessários e 1 PR para a `main`.

| Release | Branch | Conteúdo | Agentes |
|---|---|---|---|
| v0.1 | `release/1-motor` | Monorepo, tipos compartilhados, motor do jogo (baralho, turnos, poderes, reações, fim) e testes unitários | backend, qa |
| v0.2 | `release/2-servidor` | Servidor HTTP + WebSocket, salas, visão por jogador (sem vazar cartas), validação de entrada, timers, bots | backend, qa, security |
| v0.3 | `release/3-mesa` | Cliente web (Vite + React): lobby, mesa responsiva, cartas, conexão com o servidor | frontend |
| v0.4 | `release/4-jogabilidade` | Interações completas: poderes, reações, "Estou foda", animações, tela final | frontend, qa |
| v0.5 | `release/5-polimento` | Testes ponta a ponta, revisão de segurança e acessibilidade, README e polimento visual | qa, security, frontend |

## Stack
- TypeScript em tudo, npm workspaces: `shared/`, `server/`, `client/`.
- Servidor: Node 22, Socket.IO, Zod para validar mensagens.
- Cliente: Vite + React, configuração por variáveis de ambiente (`VITE_*`).
- Testes: Vitest (unitários); Playwright (ponta a ponta).
