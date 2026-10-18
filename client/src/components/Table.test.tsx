import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAction, type Action } from '@moises/shared';
import { buildScenario, DEMO_PLAYER_COUNTS, SCENARIOS, type ScenarioId } from '../demo/fixtures';
import { Table } from './Table';

const LOCAL_NOW = 2_000_000;
const SERVER_NOW = 5_000;

function renderTable(id: ScenarioId, players = 4) {
  const view = buildScenario(id, { players, now: SERVER_NOW });
  const onSend = vi.fn<(action: Action) => void>();
  const utils = render(
    <Table view={view} clockOffset={SERVER_NOW - LOCAL_NOW} onSend={onSend} onLeave={() => {}} />,
  );
  return { ...utils, view, onSend };
}

describe('Table', () => {
  // Interaction tests only pin the clock; countdown tests also fake the interval.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LOCAL_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tickingClock = () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(LOCAL_NOW);
  };

  const user = () => userEvent.setup();

  it.each(DEMO_PLAYER_COUNTS)('seats you at the bottom and %i-1 opponents around', (players) => {
    renderTable('minha-vez', players);
    expect(screen.getByRole('region', { name: 'Suas cartas' })).toBeInTheDocument();
    expect(document.querySelectorAll('.seat')).toHaveLength(players - 1);
  });

  // One case per scene (same assertions as before): a single loop over every scene and size outgrew the 5 s test budget under the full suite.
  it.each(SCENARIOS.map((s) => s.id))('never renders a face that the view did not send (%s)', (id) => {
    {
      for (const players of DEMO_PLAYER_COUNTS) {
        const { view, unmount, container } = renderTable(id, players);
        // The final screen repeats every grid on the score tab.
        const copies = view.phase === 'ended' ? 2 : 1;
        const visibleInGrids = copies * view.players.flatMap((p) => p.slots).filter((s) => s.state === 'visible').length;
        const others = (view.discardTop || view.reactionWindow ? 1 : 0) + (view.turn?.drawnCard ? 1 : 0);
        const faces = Array.from(container.querySelectorAll('img')).filter((img) => /\/cards\//.test(img.src));
        expect(faces.length, `${id} with ${players}`).toBe(visibleInGrids + others);
        unmount();
      }
    }
  });

  it('shows whose turn it is', () => {
    renderTable('vez-de-outro');
    expect(screen.getByRole('heading', { name: 'Vez de Ana' })).toBeInTheDocument();
    expect(document.querySelector('.seat.is-turn .seat__name')).toHaveTextContent('Ana');
  });

  it('counts down from the server deadline and stops at zero', () => {
    tickingClock();
    renderTable('arrumacao');
    expect(screen.getByRole('timer', { name: 'Arrumação: 5 segundos restantes' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_100));
    expect(screen.getByRole('timer', { name: 'Arrumação: 3 segundos restantes' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('timer', { name: 'Arrumação: 0 segundos restantes' })).toBeInTheDocument();
  });

  it('turns the initial-peek cards face down when their time is over', () => {
    tickingClock();
    renderTable('espiada');
    expect(screen.getByRole('img', { name: /Sua posição 4: Rei de copas/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_100));
    expect(screen.queryByRole('img', { name: /Rei de copas/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Sua posição 4: carta virada para baixo' })).toBeInTheDocument();
  });

  it('arrange: tapping two of your cards sends one arrange action', async () => {
    const { onSend } = renderTable('arrumacao');
    await user().click(screen.getByRole('button', { name: /Sua posição 1/ }));
    expect(screen.getByText('Agora toque onde a posição 1 vai ficar.')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /Sua posição 4/ }));
    expect(onSend).toHaveBeenCalledWith({ type: 'arrange', fromSlot: 0, toSlot: 3 });
  });

  it('drawing: from the button or by tapping the deck', async () => {
    const { onSend } = renderTable('minha-vez');
    await user().click(screen.getByRole('button', { name: /Monte: .* Comprar/ }));
    await user().click(screen.getByRole('button', { name: 'Comprar' }));
    expect(onSend.mock.calls).toEqual([[{ type: 'draw' }], [{ type: 'draw' }]]);
  });

  it('holding a card: tap a position, then swap', async () => {
    const { onSend } = renderTable('comprada');
    expect(screen.getByRole('img', { name: /Sua carta: Rei de espadas \(preto\)/ })).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /Sua posição 2/ }));
    expect(screen.getByRole('button', { name: /Sua posição 2/ })).toHaveAttribute('aria-pressed', 'true');
    await user().click(screen.getByRole('button', { name: 'Trocar com a posição 2' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'swapWithDrawn', slot: 1 });
  });

  it('J power: tap an opponent card, then peek', async () => {
    const { onSend } = renderTable('poder-j');
    // Your own cards are not targets of this power.
    expect(screen.queryByRole('button', { name: /Sua posição/ })).toBeNull();
    await user().click(screen.getByRole('button', { name: /Beto, posição 3/ }));
    await user().click(screen.getByRole('button', { name: 'Espiar a carta' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'usePower', power: 'peekAndSwap', target: { playerId: 's2', slot: 2 } });
  });

  it('a shout claims the window first (step 1); nothing else is sent', async () => {
    const { onSend } = renderTable('reacao');
    await user().click(screen.getByRole('button', { name: /Filho da puta!/ }));
    expect(onSend.mock.calls).toEqual([[{ type: 'claimReaction', kind: 'matchOpponent' }]]);
    expect(parseAction(onSend.mock.calls[0]![0]).ok).toBe(true);
    expect(screen.getByRole('button', { name: /Gritando/ })).toBeDisabled();
  });

  it('"Filho da puta" claimed by you: the enemy card, then the card you give', async () => {
    const { onSend } = renderTable('reacao-gritei');
    // Step 1 lights only enemy cards.
    expect(screen.queryByRole('button', { name: /Sua posição/ })).toBeNull();
    await user().click(screen.getByRole('button', { name: /Cida, posição 2/ }));
    expect(screen.queryByRole('button', { name: /Cida, posição 1/ })).toBeNull();
    await user().click(screen.getByRole('button', { name: /Sua posição 4/ }));
    expect(onSend).toHaveBeenCalledWith({ type: 'matchOpponent', target: { playerId: 's3', slot: 1 }, giveSlot: 3 });
    expect(parseAction(onSend.mock.calls[0]![0]).ok).toBe(true);
  });

  it('"Filha da putinha" claimed by you: one tap on your card sends it', async () => {
    const { onSend } = renderTable('reacao-gritei-igual');
    await user().click(screen.getByRole('button', { name: /Sua posição 1/ }));
    expect(onSend).toHaveBeenCalledWith({ type: 'matchOwn', slot: 0 });
  });

  it('Q power: yours first, then an enemy card, then the choice', async () => {
    const { onSend } = renderTable('poder-q');
    expect(screen.queryByRole('button', { name: /Ana, posição/ })).toBeNull();
    await user().click(screen.getByRole('button', { name: /Sua posição 2/ }));
    await user().click(screen.getByRole('button', { name: /Ana, posição 3/ }));
    await user().click(screen.getByRole('button', { name: 'Trocar no escuro' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'usePower', power: 'blindSwap', ownSlot: 1, target: { playerId: 's1', slot: 2 } });
  });

  it('tells other players\' moves: a balloon and a line in the history', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(LOCAL_NOW);
    const view = buildScenario('vez-de-outro', { players: 3, now: SERVER_NOW });
    const props = { clockOffset: SERVER_NOW - LOCAL_NOW, onSend: () => {}, onLeave: () => {} };
    const { rerender } = render(<Table view={view} events={[]} eventsSeq={1} {...props} />);
    rerender(
      <Table
        view={view}
        events={[{ type: 'cardsSwapped', by: 's1', a: { playerId: 's1', slot: 0 }, b: { playerId: 's0', slot: 2 }, blind: true }]}
        eventsSeq={2}
        {...props}
      />,
    );
    expect(screen.getAllByText('Ana trocou no escuro a própria carta 1 com a sua carta 3').length).toBeGreaterThan(0);
    act(() => {
      screen.getByRole('button', { name: /Abrir histórico/ }).click();
    });
    expect(within(screen.getByRole('log')).getByText('Ana trocou no escuro a própria carta 1 com a sua carta 3')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    vi.useRealTimers();
  });

  it('shows the "Estou foda" banner with who still plays', () => {
    renderTable('estou-foda', 4);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText('Ana falou “Estou foda”!')).toBeInTheDocument();
    expect(within(banner).getByText('Última vez de: Beto, Cida, Você.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sua posição 2: vazia' })).toBeInTheDocument();
  });

  it('counts the current decision down from GameUpdate.turnDeadline', () => {
    const view = buildScenario('minha-vez', { players: 3, now: SERVER_NOW });
    render(<Table view={view} clockOffset={SERVER_NOW - LOCAL_NOW} turnDeadline={SERVER_NOW + 15_000} onSend={() => {}} onLeave={() => {}} />);
    expect(screen.getByRole('timer', { name: 'Tempo da jogada: 15 segundos restantes' })).toBeInTheDocument();
  });

  it('"Estou foda" goes with one tap', async () => {
    const { onSend } = renderTable('minha-vez');
    await user().click(screen.getByRole('button', { name: /Estou foda/ }));
    expect(onSend).toHaveBeenCalledWith({ type: 'callEnd' });
  });

  it('opens the final screen when the game ends', () => {
    renderTable('fim', 2);
    expect(screen.getByRole('dialog', { name: 'Fim de jogo' })).toBeInTheDocument();
    expect(screen.getByText('Você ganhou!')).toBeInTheDocument();
  });
});
