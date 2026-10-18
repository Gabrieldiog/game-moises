import type { Card, ErrorCode, GameOverReason, PowerKind, Rank, Suit } from '@moises/shared';
import type { ConnectionError, ConnectionStatus, LobbyErrorCode } from '../connection/types';

// Every user-facing string of the client. Card values, timings and limits are
// never written here: they come from the server (GameView / RoomView).

const RANK_NAMES: Record<Rank, string> = {
  A: 'Ás',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'Valete',
  Q: 'Dama',
  K: 'Rei',
};

const SUIT_NAMES: Record<Suit, string> = {
  spades: 'espadas',
  hearts: 'copas',
  diamonds: 'ouros',
  clubs: 'paus',
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const COLOR_NAMES = { red: 'vermelho', black: 'preto' } as const;

/** "Rei de copas (vermelho)", "7 de paus", "Coringa preto". */
export function cardName(card: Card): string {
  if (card.kind === 'joker') return `Coringa ${COLOR_NAMES[card.color]}`;
  const base = `${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`;
  if (card.rank !== 'K') return base;
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return `${base} (${red ? COLOR_NAMES.red : COLOR_NAMES.black})`;
}

/** "K♥", "10♣", "Coringa". */
export function cardShort(card: Card): string {
  if (card.kind === 'joker') return 'Coringa';
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

/** Positions are shown 1-based to people; the protocol uses 0-based slots. */
export function positionLabel(slot: number): string {
  return `posição ${slot + 1}`;
}

export const POWER_TEXT: Record<PowerKind, { readonly name: string; readonly hint: string; readonly confirm: string }> = {
  peekOwn: {
    name: 'Ver uma carta sua',
    hint: 'Toque numa carta sua para ver.',
    confirm: 'Ver minha carta',
  },
  peekOpponent: {
    name: 'Ver carta de um inimigo',
    hint: 'Toque numa carta de um inimigo para ver.',
    confirm: 'Ver a carta dele',
  },
  blindSwap: {
    name: 'Trocar no escuro',
    hint: 'Toque numa carta sua e numa de um inimigo. Ninguém vê nada.',
    confirm: 'Trocar no escuro',
  },
  peekAndSwap: {
    name: 'Espiar e trocar',
    hint: 'Toque numa carta de um inimigo para ver. Depois você decide se troca.',
    confirm: 'Espiar a carta',
  },
  peekManyAndSwap: {
    name: 'Espiar inimigos e trocar',
    hint: 'Toque nas cartas de inimigos que quer ver. Depois você decide se troca uma delas.',
    confirm: 'Espiar as cartas',
  },
};

export const T = {
  appName: 'Moisés',
  tagline: 'Decore suas cartas, troque no escuro e grite antes de todo mundo.',
  you: 'Você',

  // lobby
  nameLabel: 'Seu nome',
  namePlaceholder: 'Como a mesa vai te chamar',
  createRoom: 'Criar sala',
  joinTitle: 'Entrar com código',
  codeLabel: 'Código da sala',
  codePlaceholder: 'Ex.: K7Q2',
  join: 'Entrar',
  playBots: 'Jogar contra bots',
  or: 'ou',
  mockNotice: 'Sem servidor configurado: salas e partidas são de demonstração, só neste aparelho.',
  roomTitle: (code: string) => `Sala ${code}`,
  botRoomTitle: 'Partida contra bots',
  roomShare: 'Mande este código para a galera entrar.',
  copyCode: 'Copiar código',
  codeCopied: 'Código copiado',
  seatsCount: (taken: number, max: number) => `${taken} de ${max} lugares`,
  minPlayersHint: (min: number) => `A partida começa com pelo menos ${min} jogadores.`,
  host: 'anfitrião',
  bot: 'bot',
  addBot: 'Adicionar bot',
  removeBot: (name: string) => `Tirar ${name}`,
  startGame: 'Começar partida',
  waitingHost: 'Esperando o anfitrião começar a partida.',
  leaveRoom: 'Sair da sala',

  // table
  deck: 'Monte',
  deckCount: (n: number) => `${n} no monte`,
  discard: 'Descarte',
  discardEmpty: 'Descarte vazio',
  discardCount: (n: number) => `${n} no descarte`,
  yourCard: 'Sua carta',
  heldBy: (name: string) => `${name} está com uma carta na mão`,
  turnOf: (name: string) => `Vez de ${name}`,
  yourTurn: 'Sua vez',
  emptySlot: 'vazia',
  hiddenCard: 'carta virada para baixo',
  ownSlotLabel: (slot: number) => `Sua ${positionLabel(slot)}`,
  oppSlotLabel: (name: string, slot: number) => `${name}, ${positionLabel(slot)}`,
  cardsLeft: (n: number) => (n === 1 ? '1 carta' : `${n} cartas`),
  finalTurnPending: 'última vez',
  calledEnd: 'falou “Estou foda”',
  reacted: 'já reagiu',
  secondsLeft: (s: number) => (s === 1 ? '1 segundo restante' : `${s} segundos restantes`),

  // status lines
  arrangeTitle: 'Arrume suas cartas',
  arrangeHint: 'Toque em duas cartas suas para trocar de lugar. Ninguém vê nada.',
  arrangeSelected: (slot: number) => `Agora toque onde a ${positionLabel(slot)} vai ficar.`,
  peekTitle: 'Decore suas cartas',
  peekHint: 'Só você vê as cartas abertas. Daqui a pouco elas viram.',
  drawHint: 'Compre uma carta do monte.',
  decideHint: 'Toque numa carta sua para trocar, ou descarte a que está na mão.',
  powerTitle: (name: string) => `Poder: ${name}`,
  powerSwapTitle: 'Trocar?',
  powerSwapHint: 'Toque numa carta que você viu e numa sua. Ou deixe tudo como está.',
  powerSwapHintOne: 'Toque numa carta sua para trocar com a que você viu. Ou deixe tudo como está.',
  reactionTitle: 'Tem igual?',
  reactionHint: (who: string, card: string) => `${who} descartou ${card}.`,
  reactionDone: 'Você já reagiu a este descarte.',
  reactionClosed: 'A janela de reação fechou.',
  waitingDraw: 'Comprando uma carta.',
  waitingDecide: 'Decidindo o que fazer com a carta.',
  waitingPower: (power: string) => `Usando o poder: ${power}.`,
  waitingPowerSwap: 'Decidindo se troca.',
  spectating: 'Você está assistindo.',
  endCalled: (name: string) => `${name} falou “Estou foda”!`,
  endCalledYou: 'Você falou “Estou foda”!',
  endNoCards: (name: string) => `${name} ficou sem cartas!`,
  endPending: (names: string) => `Última vez de: ${names}.`,

  // actions
  draw: 'Comprar',
  discardDrawn: 'Descartar',
  swapPick: 'Trocar: toque numa carta sua',
  swapWith: (slot: number) => `Trocar com a ${positionLabel(slot)}`,
  skipPower: 'Pular',
  keepAsIs: 'Não trocar',
  powerSwap: 'Trocar',
  pickCards: (n: number) => (n === 0 ? 'Toque nas cartas' : `${n} ${n === 1 ? 'carta escolhida' : 'cartas escolhidas'}`),
  shoutOwn: 'Filha da putinha!',
  shoutOwnHint: 'Descarta uma carta sua igual.',
  shoutOwnPick: 'Toque na sua carta igual.',
  shoutOpponent: 'Filho da puta!',
  shoutOpponentHint: 'Pega a carta igual de um inimigo.',
  shoutOpponentPickTarget: 'Toque na carta igual do inimigo.',
  shoutOpponentPickGive: 'Agora toque na carta sua que vai entregar.',
  cancel: 'Cancelar',
  callEnd: 'Estou foda',
  callEndQuestion: 'Falar “Estou foda”?',
  callEndConfirm: 'Estou foda!',
  callEndHint: 'Cada um joga mais uma vez e a partida acaba.',

  // end
  endTitle: 'Fim de jogo',
  endReason: {
    endCalled: 'A última rodada acabou.',
    deckExhausted: 'As cartas acabaram.',
  } satisfies Record<GameOverReason, string>,
  winnerOne: (name: string) => `${name} ganhou!`,
  winnerYou: 'Você ganhou!',
  winnersTie: (names: string) => `Empate: ${names} ganharam!`,
  total: 'Soma',
  winnerBadge: 'Menor soma',
  backToLobby: 'Voltar ao início',

  // connection
  status: {
    idle: 'Desconectado',
    connecting: 'Conectando…',
    connected: 'Conectado',
    reconnecting: 'Reconectando…',
    disconnected: 'Sem conexão',
  } satisfies Record<ConnectionStatus, string>,
  dismiss: 'Fechar aviso',

  // demo
  demoButton: 'Demo',
  demoTitle: 'Cenas de demonstração',
  demoPlayers: 'Jogadores',
  demoReload: 'Recomeçar cena',
  demoLastSent: 'Última ação enviada',
  demoNone: 'nenhuma',
  demoClose: 'Fechar',
} as const;

const GAME_ERROR_TEXT: Record<ErrorCode, string> = {
  INVALID_ACTION: 'O servidor não entendeu essa jogada.',
  INVALID_TIME: 'O relógio do servidor se perdeu. Tente de novo.',
  UNKNOWN_PLAYER: 'Você não está nesta partida.',
  GAME_OVER: 'A partida já acabou.',
  INVALID_PHASE: 'Não dá para fazer isso agora.',
  NOT_YOUR_TURN: 'Espere a sua vez.',
  INVALID_SLOT: 'Essa posição não existe.',
  EMPTY_SLOT: 'Essa posição está vazia.',
  SAME_SLOT: 'Escolha duas posições diferentes.',
  INVALID_TARGET: 'Escolha uma carta de um inimigo.',
  POWER_MISMATCH: 'Esse não é o poder da carta descartada.',
  WRONG_TARGET_COUNT: 'Quantidade de cartas errada para este poder.',
  DUPLICATE_TARGET: 'Você escolheu a mesma carta duas vezes.',
  TARGET_NOT_PEEKED: 'Só dá para trocar com uma carta que você acabou de ver.',
  REACTION_WINDOW_CLOSED: 'Tarde demais: a janela de reação fechou.',
  REACTION_ALREADY_ATTEMPTED: 'Você já reagiu a este descarte.',
  END_ALREADY_CALLED: 'Alguém já falou “Estou foda”.',
};

const LOBBY_ERROR_TEXT: Record<LobbyErrorCode, string> = {
  ROOM_NOT_FOUND: 'Não achamos uma sala com esse código. Confira e tente de novo.',
  ROOM_FULL: 'Essa sala está cheia.',
  GAME_ALREADY_STARTED: 'A partida dessa sala já começou.',
  NOT_HOST: 'Só o anfitrião pode fazer isso.',
  INVALID_NAME: 'Escolha um nome para entrar na mesa.',
  NOT_CONNECTED: 'Sem conexão com o servidor. Tente de novo em instantes.',
};

export function errorText(error: ConnectionError): string {
  if (error.code in GAME_ERROR_TEXT) return GAME_ERROR_TEXT[error.code as ErrorCode];
  return LOBBY_ERROR_TEXT[error.code as LobbyErrorCode] ?? T.status.disconnected;
}
