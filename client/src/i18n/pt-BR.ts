import type {
  Card,
  ErrorCode,
  GameOverReason,
  PowerKind,
  ProtocolErrorCode,
  Rank,
  RoomClosedReason,
  Suit,
} from '@moises/shared';
import type {
  ClientErrorCode,
  ConnectionError,
  ConnectionErrorCode,
  ConnectionStatus,
  RequestName,
} from '../connection/types';

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
  codePlaceholder: 'Ex.: K7QX2M',
  join: 'Entrar',
  playBots: (n: number) => (n === 1 ? 'Jogar contra 1 bot' : `Jogar contra ${n} bots`),
  botsCount: (n: number) => (n === 1 ? '1 bot' : `${n} bots`),
  fewerBots: 'Menos bots',
  moreBots: 'Mais bots',
  botsLabel: 'Bots',
  or: 'ou',
  mockNotice: 'Modo demonstração: salas e partidas são de mentirinha, só neste aparelho, sem servidor.',
  roomTitle: (code: string) => `Sala ${code}`,
  botRoomTitle: 'Partida contra bots',
  roomShare: 'Mande este código para a galera entrar.',
  copyCode: 'Copiar código',
  codeCopied: 'Código copiado',
  seatsCount: (taken: number, max: number) => `${taken} de ${max} lugares`,
  minPlayersHint: (min: number) => `A partida começa com pelo menos ${min} jogadores.`,
  turnTimeHint: (seconds: number) => `Cada jogada tem ${seconds} segundos.`,
  roomEndedTitle: 'Partida encerrada',
  playAgain: 'Jogar de novo',
  waitingHostAgain: 'Esperando o anfitrião começar outra partida.',
  offline: 'desconectado',
  host: 'anfitrião',
  bot: 'bot',
  addBot: 'Adicionar bot',
  removeBot: (name: string) => `Tirar ${name}`,
  startGame: 'Começar partida',
  waitingHost: 'Esperando o anfitrião começar a partida.',
  leaveRoom: 'Sair da sala',
  queueTitle: 'Na fila para a próxima partida',
  queueYou: 'Você está na fila. Entra na próxima partida; enquanto isso, assiste a esta.',
  queueHint: 'Partida em andamento. Quem chegou agora joga a próxima.',
  roomPlaying: 'Partida em andamento',
  watchGame: 'Assistir à partida',
  waiting: 'esperando',

  // table settings ("Configurações da mesa")
  tableTitle: 'Configurações da mesa',
  tableReadOnly: 'Só o anfitrião muda as configurações.',
  turnSecondsLabel: 'Tempo por decisão',
  turnSecondsValue: (s: number) => `${s} s`,
  lessTime: 'Menos tempo',
  moreTime: 'Mais tempo',
  reactionsLabel: 'Reações',
  powersLabel: 'Cartas com poder',
  powersHint: 'Desligada, a carta só vale os pontos.',
  powersNone: 'Nenhuma carta com poder.',
  on: 'ligada',
  off: 'desligada',
  rankShort: (rank: Rank) => (rank === 'K' ? 'K preto' : rank),
  tableSaved: 'Configurações salvas',

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
  countdown: { arrange: 'Arrumação', initialPeek: 'Espiada', reaction: 'Reação', turn: 'Tempo da jogada' },
  attemptsLeft: (n: number) => (n === 1 ? 'Você tem mais 1 tentativa.' : `Você tem mais ${n} tentativas.`),
  queueBanner: 'Você está na fila: joga a próxima partida.',

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
  reactionDone: 'Suas tentativas neste descarte acabaram.',
  reactionClosed: 'A janela de reação fechou.',
  waitingDraw: 'Comprando uma carta.',
  waitingDecide: 'Decidindo o que fazer com a carta.',
  waitingPower: (power: string) => `Usando o poder: ${power}.`,
  waitingPowerSwap: 'Decidindo se troca.',
  spectating: 'Você está assistindo.',
  endCalled: (name: string) => `${name} falou “Estou foda”!`,
  endCalledYou: 'Você falou “Estou foda”!',
  endPending: (names: string) => `Última vez de: ${names}.`,

  // actions
  draw: 'Comprar',
  discardDrawn: 'Descartar',
  swapPick: 'Trocar: toque numa carta sua',
  swapWith: (slot: number) => `Trocar com a ${positionLabel(slot)}`,
  skipPower: 'Pular',
  keepAsIs: 'Não trocar',
  powerSwap: 'Trocar',
  pickedOf: (picked: number, total: number) => `${picked}/${total}`,
  peekManyHint: (n: number) =>
    n === 1
      ? 'Toque numa carta de um inimigo para ver. Depois você decide se troca.'
      : `Toque em ${n} cartas de inimigos para ver. Depois você decide se troca uma delas.`,
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
  backToRoom: 'Voltar para a sala',

  // connection
  status: {
    idle: 'Desconectado',
    connecting: 'Conectando…',
    connected: 'Conectado',
    reconnecting: 'Reconectando…',
    disconnected: 'Sem conexão',
    replaced: 'Partida aberta em outro lugar',
  } satisfies Record<ConnectionStatus, string>,
  retry: 'Tentar de novo',
  dismiss: 'Fechar aviso',
  genericError: 'Algo deu errado. Tente de novo.',
  sessionLost: 'Não deu para voltar à partida: ela acabou ou você saiu dela.',
  splashConnecting: 'Conectando ao servidor…',
  splashTable: 'Preparando a mesa…',
  replacedTitle: 'Você abriu esta partida em outro lugar',
  replacedHint: 'Outra aba ou aparelho assumiu o seu lugar na mesa. Só um pode jogar de cada vez.',
  replacedTakeBack: 'Jogar aqui',
  replacedHome: 'Ir para o início',

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
  REACTION_ALREADY_ATTEMPTED: 'Suas tentativas neste descarte acabaram.',
  REACTION_DISABLED: 'Essa reação está desligada nesta mesa.',
  END_ALREADY_CALLED: 'Alguém já falou “Estou foda”.',
};

const PROTOCOL_ERROR_TEXT: Record<ProtocolErrorCode, string> = {
  BAD_REQUEST: 'O servidor não entendeu o pedido. Confira os dados e tente de novo.',
  UNKNOWN_EVENT: 'O servidor não reconheceu esse pedido. Atualize a página.',
  RATE_LIMITED: 'Muitos pedidos seguidos. Espere um pouco e tente de novo.',
  INTERNAL_ERROR: 'Deu um problema no servidor. Tente de novo.',
  INVALID_SESSION: 'Não deu para voltar à partida: ela acabou ou você saiu dela.',
  NOT_IN_ROOM: 'Você não está mais nesta sala.',
  ALREADY_IN_ROOM: 'Você já está numa sala. Saia dela antes de entrar em outra.',
  ROOM_NOT_FOUND: 'Não achamos uma sala com esse código. Confira e tente de novo.',
  ROOM_FULL: 'Essa sala está cheia.',
  ROOM_IN_GAME: 'A partida dessa sala já começou. Espere ela acabar para entrar.',
  ROOM_LIMIT: 'Salas demais abertas agora. Saia de uma sala ou tente mais tarde.',
  NOT_HOST: 'Só o anfitrião pode fazer isso.',
  NOT_ENOUGH_PLAYERS: 'Faltam jogadores para começar. Chame alguém ou adicione um bot.',
  NOT_A_BOT: 'Só dá para tirar bots da sala.',
  NO_GAME: 'Não tem partida rolando nesta sala.',
  GAME_IN_PROGRESS: 'Não dá para fazer isso com a partida rolando. Espere ela acabar.',
};

const CLIENT_ERROR_TEXT: Record<ClientErrorCode, string> = {
  NOT_CONNECTED: 'Sem conexão com o servidor. Tente de novo em instantes.',
  TIMEOUT: 'O servidor demorou para responder. Tente de novo.',
  INVALID_NAME: 'Escolha um nome para entrar na mesa.',
  INVALID_CODE: 'Esse código não parece certo. Confira as letras e os números.',
  SERVER_FULL: 'O servidor está lotado agora. Tente daqui a pouco.',
  TOO_MANY_CONNECTIONS: 'Muitas conexões abertas daqui. Feche outras abas do jogo e tente de novo.',
};

/** The same code reads differently depending on what was asked. */
const REQUEST_ERROR_TEXT: Partial<Record<RequestName, Partial<Record<ConnectionErrorCode, string>>>> = {
  'room:join': {
    RATE_LIMITED: 'Muitas tentativas. Espere alguns minutos.',
    BAD_REQUEST: 'Confira o código da sala e o seu nome.',
    ROOM_FULL: 'Essa sala está cheia, e a fila para a próxima partida também.',
  },
  'room:create': { BAD_REQUEST: 'Confira o seu nome.' },
  'room:quickPlay': {
    ROOM_FULL: 'Bots demais para uma mesa. Escolha menos bots.',
    BAD_REQUEST: 'Confira o seu nome e a quantidade de bots.',
  },
  'room:addBot': { ROOM_FULL: 'A mesa já está cheia.' },
  'room:removeBot': { GAME_IN_PROGRESS: 'Não dá para tirar bots com a partida rolando.' },
  'room:start': { GAME_IN_PROGRESS: 'A partida já começou.' },
  'room:setTable': {
    BAD_REQUEST: 'O servidor recusou essas configurações. Confira e tente de novo.',
    GAME_IN_PROGRESS: 'As configurações só mudam fora da partida.',
    NOT_HOST: 'Só o anfitrião muda as configurações da mesa.',
  },
  'session:resume': { RATE_LIMITED: 'Não deu para voltar à partida agora. Espere um pouco.' },
  'game:action': {
    RATE_LIMITED: 'Calma! Jogadas demais seguidas. Espere um instante.',
    BAD_REQUEST: 'O servidor não entendeu essa jogada.',
    NOT_IN_ROOM: 'Você não está mais nesta partida.',
  },
};

const ALL_ERROR_TEXT: Record<ConnectionErrorCode, string> = {
  ...GAME_ERROR_TEXT,
  ...PROTOCOL_ERROR_TEXT,
  ...CLIENT_ERROR_TEXT,
};

/** Portuguese text for any refusal, from its code (never from the server's English message). */
export function errorText(error: Pick<ConnectionError, 'code' | 'request'>): string {
  return REQUEST_ERROR_TEXT[error.request]?.[error.code] ?? ALL_ERROR_TEXT[error.code] ?? T.genericError;
}

export const ROOM_CLOSED_TEXT: Record<RoomClosedReason, string> = {
  idle: 'A sala fechou por falta de atividade.',
  empty: 'A sala fechou porque ficou sem ninguém.',
  shutdown: 'O servidor foi reiniciado e a sala fechou. Crie outra para continuar.',
  error: 'A sala fechou por um erro no servidor. Desculpe! Crie outra para continuar.',
};
