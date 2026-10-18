# Protocolo cliente ↔ servidor (v0.2)

Como o cliente web conversa com o servidor. Tipos e schemas ficam em `shared/` para o cliente reutilizar:

| Arquivo | Conteúdo |
|---|---|
| `shared/src/protocol.ts` | Eventos, payloads (schemas Zod), `RoomView`, `GameUpdate`, acks, códigos de erro |
| `shared/src/actions.ts` | Ações do jogo (`game:action`) |
| `shared/src/view.ts` | `GameView`: o que **um** jogador pode ver |
| `shared/src/events.ts` | Eventos públicos do jogo |
| `shared/src/errors.ts` | Códigos de erro do motor |

`PROTOCOL_VERSION = 1`.

## Transporte

- **HTTP** `GET /health` (ou `HEAD`) → `200 {"status":"ok"}`. Qualquer outro caminho → `404`; outro método em `/health` → `405`.
- **Socket.IO 4** na mesma porta, caminho padrão `/socket.io/`, namespace `/`. O servidor não serve o bundle do cliente Socket.IO (o cliente usa o pacote `socket.io-client`).
- A **origem** do navegador é conferida em todo handshake (polling e WebSocket) contra `CORS_ORIGIN`. Origem fora da lista → conexão recusada. Clientes sem cabeçalho `Origin` (fora do navegador) são aceitos.
- Recusas de conexão chegam em `connect_error` com `err.message`:
  - `SERVER_FULL`: limite global de conexões (`MAX_CONNECTIONS`).
  - `TOO_MANY_CONNECTIONS`: limite por IP (`MAX_CONNECTIONS_PER_IP`).
- Mensagem maior que `MAX_MESSAGE_BYTES` (padrão 16 KB) → o servidor fecha a conexão.

```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@moises/shared';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(import.meta.env.VITE_SERVER_URL, {
  transports: ['websocket'],
});
```

## Pedido e resposta (ack)

Todo evento cliente → servidor leva **um** payload e um callback de resposta. Com `emitWithAck`:

```ts
const res = await socket.emitWithAck('room:create', { name: 'Ana' });
if (res.ok) {
  res.data; // JoinedRoom
} else {
  res.error.code; // ServerErrorCode
}
```

- Resposta: `{ ok: true, data }` ou `{ ok: false, error: { code, message } }`.
- `message` é um texto genérico em inglês derivado do código (ex.: `"not your turn"`). Nunca tem detalhe do estado nem stack. O cliente mostra a própria mensagem em português a partir de `code`.
- Evento sem callback é processado normalmente, mas não recebe resposta. Use sempre o ack.
- Mais de um argumento além do callback → `BAD_REQUEST`.
- Eventos sem dados (`room:leave`, `room:addBot`, `room:start`) recebem `{}`.
- Ordem: o ack de um pedido chega **antes** das mensagens que ele causou (`room:state`, `game:update`). Quando as duas mudam juntas, `room:state` vem antes de `game:update`.

## Eventos cliente → servidor

| Evento | Payload | `data` do ack | Erros específicos |
|---|---|---|---|
| `room:create` | `{ name }` | `JoinedRoom` | `ALREADY_IN_ROOM`, `ROOM_LIMIT` |
| `room:join` | `{ code, name }` | `JoinedRoom` | `ALREADY_IN_ROOM`, `ROOM_NOT_FOUND`, `ROOM_FULL` (partida em andamento: entra na fila, `RoomView.queue`) |
| `room:quickPlay` | `{ name, bots }` | `JoinedRoom` (sala já em jogo) | `ALREADY_IN_ROOM`, `ROOM_LIMIT`, `ROOM_FULL` |
| `session:resume` | `{ token }` | `ResumedSession` | `INVALID_SESSION`, `ALREADY_IN_ROOM` |
| `room:leave` | `{}` | `null` | `NOT_IN_ROOM` |
| `room:addBot` | `{}` | `null` | `NOT_IN_ROOM`, `NOT_HOST`, `GAME_IN_PROGRESS`, `ROOM_FULL` |
| `room:removeBot` | `{ playerId }` | `null` | `NOT_IN_ROOM`, `NOT_HOST`, `GAME_IN_PROGRESS`, `NOT_A_BOT` |
| `room:start` | `{}` | `null` | `NOT_IN_ROOM`, `NOT_HOST`, `GAME_IN_PROGRESS`, `NOT_ENOUGH_PLAYERS` |
| `room:setTable` | `{ turnSeconds (int 5–60), reactions: { matchOwn, matchOpponent }, powers: Rank[] }` | `null` | `NOT_IN_ROOM`, `NOT_HOST`, `GAME_IN_PROGRESS`, `BAD_REQUEST` (também para rank sem poder nas regras do servidor) |
| `game:action` | uma `Action` | `null` | `NOT_IN_ROOM`, `NO_GAME`, códigos do motor |

Qualquer evento pode responder também `BAD_REQUEST`, `RATE_LIMITED`, `INTERNAL_ERROR`; um nome de evento fora da lista responde `UNKNOWN_EVENT`.

Campos:
- `name`: até 128 caracteres brutos; o servidor normaliza (Unicode NFKC, remove caracteres de controle e invisíveis, como zero-width e override bidirecional, limita acentos empilhados, junta espaços) e exige 1–32 caracteres depois disso. O nome é texto puro: o cliente deve renderizá-lo como texto (o React já escapa).
- `code`: código da sala. Aceita minúsculas e espaços em volta. Alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sem 0/O, 1/I/L), tamanho `ROOM_CODE_LENGTH` (padrão 6).
- `bots`: inteiro ≥ 1; a sala inteira tem no máximo `maxPlayers` (6) lugares.
- `token`: 43 caracteres base64url, recebido em `JoinedRoom`.
- `playerId` (em `room:removeBot` e nos alvos das ações): sempre um id gerado pelo servidor e visto em `RoomView`/`GameView`.
- Objetos são estritos: chave desconhecida → `BAD_REQUEST`.

### Ações do jogo (`game:action`)

O payload é exatamente uma `Action` de `shared/src/actions.ts`. Ações levam só posições e ids, **nunca cartas**: o servidor descobre as cartas sozinho.

| Ação | Quem/quando |
|---|---|
| `{ type: 'arrange', fromSlot, toSlot }` | qualquer jogador, fase `arrange` |
| `{ type: 'draw' }` | jogador da vez, passo `draw` |
| `{ type: 'swapWithDrawn', slot }` | jogador da vez, passo `decide` |
| `{ type: 'discardDrawn' }` | jogador da vez, passo `decide` |
| `{ type: 'callEnd' }` ("Estou foda") | jogador da vez, qualquer passo do próprio turno |
| `{ type: 'usePower', power, ... }` | jogador da vez, passo `power` (formato por poder em `actions.ts`) |
| `{ type: 'powerSwap', ownSlot, target }` | jogador da vez, passo `powerSwap` |
| `{ type: 'skipPower' }` | jogador da vez, passos `power` e `powerSwap` |
| `{ type: 'matchOwn', slot }` ("Filha da putinha") | qualquer jogador, janela de reação aberta |
| `{ type: 'matchOpponent', target, giveSlot }` ("Filho da puta") | qualquer jogador, janela de reação aberta |

Recusas do motor voltam com o código de `shared/src/errors.ts`: `NOT_YOUR_TURN`, `INVALID_PHASE`, `INVALID_SLOT`, `EMPTY_SLOT`, `SAME_SLOT`, `INVALID_TARGET`, `POWER_MISMATCH`, `WRONG_TARGET_COUNT`, `DUPLICATE_TARGET`, `TARGET_NOT_PEEKED`, `REACTION_WINDOW_CLOSED`, `REACTION_ALREADY_ATTEMPTED`, `END_ALREADY_CALLED`, `GAME_OVER`. Uma ação recusada não muda nada.

## Eventos servidor → cliente

| Evento | Payload | Quando |
|---|---|---|
| `room:state` | `RoomView` | ao entrar e sempre que a sala muda (membros, anfitrião, conexão, status) |
| `game:update` | `GameUpdate` | a cada mudança do jogo; uma cópia por jogador |
| `room:closed` | `{ code, reason }` | a sala foi fechada (`idle`, `empty`, `shutdown`, `error`); a conexão continua aberta e pode criar ou entrar em outra sala |
| `session:replaced` | — | outra conexão retomou esta sessão; o servidor desconecta esta (sem reconexão automática) |

### `RoomView`

```ts
{
  code: 'K7QX2M',
  status: 'lobby' | 'playing' | 'ended',
  you: PlayerId,          // muda por destinatário
  hostId: PlayerId,
  members: [{ id, name, isBot, isHost, connected }], // ordem dos lugares na próxima partida
  settings: { minPlayers, maxPlayers, turnMs },
  table: { turnSeconds, reactions: { matchOwn, matchOpponent }, powers: Rank[] }, // configurações da mesa (padrão 15 s, tudo ligado)
  queue: [{ id, name, connected }], // chegaram com a partida em andamento; viram jogadores na próxima (e assistem como espectadores)
}
```

Nunca contém cartas nem tokens. Em `ended` a sala funciona como lobby: o anfitrião pode mexer nos bots e iniciar outra partida, e outras pessoas podem entrar.

### `GameUpdate`

```ts
{
  view: GameView,                 // construída só para o destinatário (viewFor)
  turnDeadline: number | null,    // hora do servidor em que ele joga pelo jogador da vez
  events: ServerGameEvent[],      // eventos públicos desde o update anterior
}
```

- Cada socket recebe **apenas** `viewFor(estado, seuJogador, agora)`. Uma carta escondida nunca aparece em mensagem nenhuma: só a carta comprada (para quem comprou), as cartas vistas por poder (para quem viu, até `until`), a espiada inicial (dono), cartas reveladas a todos após reação errada, o descarte e, no fim, todas.
- **Poder pendente** (`view.turn`): `pendingPower` é público (a carta descartada está virada para cima). `powerTargetCount` diz quantas cartas o jogador da vez deve escolher no `usePower` desse poder, para o cliente não repetir número de regra: `targets.length` no `peekManyAndSwap` (`rules.powers.peekManyCount`, limitado às cartas de oponentes que ainda estão na mesa, o mesmo cálculo que o motor usa para recusar com `WRONG_TARGET_COUNT`) e `1` nos poderes de uma escolha só; `null` quando não há poder pendente. O valor só é definitivo com `turn.step === 'power'` (durante a janela de reação a mesa ainda pode mudar). É informação pública: deriva só de contagens de cartas, nunca de faces.
- `events` são públicos (iguais para todos) e servem para animações e histórico. Além dos eventos do motor (`shared/src/events.ts`), existe `{ type: 'turnTimedOut', playerId, turnNumber, step }`.
- Logo após `session:resume`, chega um `game:update` com `events: []` (retrato completo).
- **Relógio**: todos os prazos (`turnDeadline`, `view.phaseDeadline`, `reactionWindow.deadline`, `until`) estão na hora do servidor. Use `view.now` para calcular a diferença em relação ao relógio local: `offset = view.now - Date.now()` na chegada.

## Identidade e reconexão

- Ao criar, entrar ou jogar contra bots, o servidor gera o `playerId` (público) e um **token de sessão** secreto (256 bits). O servidor guarda só o hash SHA-256 do token.
- O servidor **nunca** aceita `playerId` vindo do cliente para dizer quem é: quem age é o jogador associado à conexão no `room:create` / `room:join` / `room:quickPlay` / `session:resume`.
- Uma conexão fica em no máximo uma sala (`ALREADY_IN_ROOM`; saia com `room:leave` antes).
- Ao reconectar (o socket.io-client reconecta sozinho), envie `session:resume` com o token no handler de `connect`. Recomendação para o cliente: guardar o token em `sessionStorage` (por aba); nunca colocar na URL nem em log.
- Uma sessão por jogador: se outra conexão retomar o mesmo token, a anterior recebe `session:replaced` e é desconectada.
- O token deixa de valer quando o jogador sai (`room:leave`) ou a sala fecha.
- Conexão caída:
  - **no lobby**: o lugar fica guardado por `LOBBY_RECONNECT_GRACE_MS` (padrão 60 s); depois o jogador sai da sala (e o anfitrião passa para o próximo humano);
  - **em jogo**: o lugar fica até o fim da partida; o timer de turno joga por ele.
- `room:leave` durante a partida: o jogador continua sentado até o fim (o timer joga por ele), mas não pode voltar.

## Timer de turno

- `turnMs` (padrão 15 s, `MOISES_TURN_MS`; o anfitrião troca por mesa com `room:setTable`) vale para **cada decisão** do jogador da vez: comprar (`draw`), ficar ou descartar (`decide`), usar ou pular o poder (`power`, `powerSwap`). `turnDeadline` mostra o prazo atual; durante a janela de reação ele é `null` (a janela tem prazo próprio, `reactionWindow.deadline`).
- Se o prazo vencer, o servidor publica `turnTimedOut` e joga o mínimo pelo resto daquele turno: compra se ainda não comprou, descarta a carta comprada e pula o poder. Uma ação atrasada depois disso é recusada (normalmente `INVALID_PHASE`).
- Jogadores desconectados continuam cobertos pelo timer. Quem **sai** (`room:leave`) no meio da partida é substituído por um bot no mesmo lugar (`members[i].isBot` vira `true`, mesmo `id`); o bot joga a partir da visão daquele lugar.
- Reações: `attemptsPerWindow` = 2 (erros permitidos por jogador por descarte; um acerto fecha a janela). `reactionWindow` traz `attemptsPerPlayer` e `yourAttemptsLeft`. Reação desligada na mesa responde `REACTION_DISABLED`; com as duas desligadas a janela nem abre.
- Ficar sem cartas não encerra a partida; o jogador continua jogando e pode chamar `callEnd`. `EndReason` agora é só `'called'`.

## Bots

- O anfitrião adiciona e remove bots no lobby; `room:quickPlay` cria a sala com N bots e já inicia.
- Bots jogam no servidor, com um atraso aleatório entre `BOT_DELAY_MIN_MS` e `BOT_DELAY_MAX_MS` (padrão 0,6–1,4 s); uma reação de bot sempre chega antes de a janela fechar.
- Um bot só usa a própria `GameView` e os eventos públicos, as mesmas informações de um cliente humano. Suas jogadas passam pela mesma validação do motor.

## Limites e proteção

| Limite | Padrão | Variável |
|---|---|---|
| Tamanho de mensagem | 16 KB | `MAX_MESSAGE_BYTES` |
| Taxa por conexão (token bucket) | rajada 20, 10/s | `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_SECOND` |
| Desconexão por excesso | 50 mensagens recusadas seguidas | `RATE_LIMIT_DISCONNECT_AFTER` |
| Conexões | 2000 no total, 20 por IP | `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP` |
| Salas | 500 no total, 5 criadas por IP | `MAX_ROOMS`, `MAX_ROOMS_PER_IP` |
| Sala sem atividade humana | 30 min | `ROOM_IDLE_TTL_MS` |
| Sala sem humano conectado | 2 min | `ROOM_EMPTY_TTL_MS` |
| Códigos de sala errados | 20 por IP a cada 5 min | `JOIN_FAIL_MAX`, `JOIN_FAIL_WINDOW_MS` |

Uma mensagem acima da taxa recebe `RATE_LIMITED` e é descartada. Atrás de proxy reverso, configure `TRUST_PROXY_HOPS` para os limites por IP usarem o endereço real (`X-Forwarded-For`).

- Depois de `JOIN_FAIL_MAX` códigos inexistentes, todo `room:join` daquele IP responde `RATE_LIMITED` (mesmo com o código certo) até a janela acabar. O cliente deve mostrar "muitas tentativas, espere alguns minutos".
- Endereços IPv6 são agrupados por prefixo /64 em todos os limites por IP.
- Acima de 2× `MAX_CONNECTIONS_PER_IP` conexões que ainda não terminaram o handshake, novas conexões daquele IP são fechadas sem `connect_error` próprio.

## Códigos de erro do protocolo

| Código | Significado |
|---|---|
| `BAD_REQUEST` | payload ausente, malformado ou fora do schema |
| `UNKNOWN_EVENT` | evento fora do protocolo |
| `RATE_LIMITED` | mensagens demais; espere |
| `INTERNAL_ERROR` | falha inesperada no servidor (sem detalhes) |
| `INVALID_SESSION` | token desconhecido ou expirado |
| `NOT_IN_ROOM` | a conexão não está em uma sala |
| `ALREADY_IN_ROOM` | a conexão já está em uma sala |
| `ROOM_NOT_FOUND` | código de sala inexistente |
| `ROOM_FULL` | sem lugar (ou bots demais pedidos) |
| `ROOM_IN_GAME` | não é mais devolvido por `room:join` (fila); mantido por compatibilidade |
| `ROOM_LIMIT` | limite de salas (global ou por IP) |
| `NOT_HOST` | só o anfitrião pode |
| `NOT_ENOUGH_PLAYERS` | menos jogadores que o mínimo (2) |
| `NOT_A_BOT` | o jogador a remover não é bot desta sala |
| `NO_GAME` | não há partida nesta sala |
| `GAME_IN_PROGRESS` | não permitido durante a partida |

## Fluxo típico

```
cliente A                         servidor                         cliente B
room:create {name} ───────────▶   cria sala, token A
                   ◀───────────   ack {playerId, token, room}
                   ◀───────────   room:state
                                                   ◀──────────── room:join {code, name}
                                  ack {playerId, token, room} ──▶
                   ◀───────────   room:state ──────────────────▶
room:addBot {} / room:start {} ▶  cria a partida (embaralha com seed secreta)
                   ◀───────────   ack
                   ◀───────────   room:state (playing) ────────▶
                   ◀───────────   game:update (view de A) | game:update (view de B) ──▶
game:action {type:'draw'} ────▶   valida (schema + motor) e aplica
                   ◀───────────   ack
                   ◀───────────   game:update (A vê a carta) | game:update (B não vê) ──▶
```
