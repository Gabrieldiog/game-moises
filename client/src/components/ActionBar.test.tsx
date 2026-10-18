import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseAction, type Action, type GameView } from '@moises/shared';
import { buildScenario, type ScenarioId } from '../demo/fixtures';
import { NO_PICKS, type Picks, type Shout } from '../game/intent';
import { uiContext } from '../game/selectors';
import { ActionBar, CallEndButton } from './ActionBar';

const NOW = 1_000;

function scene(id: ScenarioId, players = 4): GameView {
  return buildScenario(id, { players, now: NOW });
}

function setup(view: GameView, picks: Picks = NO_PICKS, shout: Shout | null = null) {
  const onSend = vi.fn<(action: Action) => void>();
  const onShout = vi.fn<(shout: Shout) => void>();
  const onCancel = vi.fn();
  const ctx = uiContext(view, NOW);
  const utils = render(
    <ActionBar ctx={ctx} picks={picks} shout={shout} onSend={onSend} onShout={onShout} onCancel={onCancel} />,
  );
  /** Every action the bar sends must match the shared ActionSchema. */
  const sent = () =>
    onSend.mock.calls.map(([action]) => {
      expect(parseAction(action).ok).toBe(true);
      return action;
    });
  return { ...utils, onSend, onShout, onCancel, sent };
}

describe('ActionBar by phase', () => {
  it.each(['arrumacao', 'espiada', 'vez-de-outro', 'fim'] as const)('offers no action in "%s"', (id) => {
    const { container } = setup(scene(id));
    expect(container).toBeEmptyDOMElement();
  });

  it('draw step: only "Comprar"', async () => {
    const { sent } = setup(scene('minha-vez'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Comprar' }));
    expect(sent()).toEqual([{ type: 'draw' }]);
  });

  it('holding a card: swap needs a chosen position, discard does not', async () => {
    const { sent } = setup(scene('comprada'));
    expect(screen.getByRole('button', { name: 'Trocar: toque numa carta sua' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(sent()).toEqual([{ type: 'discardDrawn' }]);
  });

  it('holding a card with position 3 chosen: "Trocar com a posição 3"', async () => {
    const { sent } = setup(scene('comprada'), { own: [2], opponents: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Trocar com a posição 3' }));
    expect(sent()).toEqual([{ type: 'swapWithDrawn', slot: 2 }]);
  });

  it('J power: pick an opponent card to peek, or skip', async () => {
    const view = scene('poder-j');
    const { sent, unmount } = setup(view);
    expect(screen.getByRole('button', { name: 'Espiar a carta' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
    expect(sent()).toEqual([{ type: 'skipPower' }]);
    unmount();

    const picked = setup(view, { own: [], opponents: [{ playerId: 's2', slot: 1 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Espiar a carta' }));
    expect(picked.sent()).toEqual([{ type: 'usePower', power: 'peekAndSwap', target: { playerId: 's2', slot: 1 } }]);
  });

  it('black K power: peeks every chosen opponent card', async () => {
    const targets = [
      { playerId: 's1', slot: 0 },
      { playerId: 's3', slot: 3 },
    ];
    const { sent } = setup(scene('poder-k', 6), { own: [], opponents: targets });
    await userEvent.click(screen.getByRole('button', { name: 'Espiar as cartas (2/2)' }));
    expect(sent()).toEqual([{ type: 'usePower', power: 'peekManyAndSwap', targets }]);
  });

  it('Q power: needs one of yours and one of theirs', async () => {
    const view = scene('poder-q');
    const { unmount } = setup(view, { own: [1], opponents: [] });
    expect(screen.getByRole('button', { name: 'Trocar no escuro' })).toBeDisabled();
    unmount();
    const both = setup(view, { own: [1], opponents: [{ playerId: 's1', slot: 2 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Trocar no escuro' }));
    expect(both.sent()).toEqual([
      { type: 'usePower', power: 'blindSwap', ownSlot: 1, target: { playerId: 's1', slot: 2 } },
    ]);
  });

  it('after a J peek: swap with the single peeked card, or keep things as they are', async () => {
    const view = scene('poder-j-troca');
    const { sent } = setup(view, { own: [3], opponents: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Trocar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Não trocar' }));
    expect(sent()).toEqual([
      { type: 'powerSwap', ownSlot: 3, target: view.turn!.peeked[0] },
      { type: 'skipPower' },
    ]);
  });

  it('after a black K peek: the target must be chosen among the peeked cards', () => {
    setup(scene('poder-k-troca'), { own: [0], opponents: [] });
    expect(screen.getByRole('button', { name: 'Trocar' })).toBeDisabled();
  });

  it('reaction window: two big shouts', async () => {
    const { onShout } = setup(scene('reacao'));
    await userEvent.click(screen.getByRole('button', { name: /Filha da putinha!/ }));
    await userEvent.click(screen.getByRole('button', { name: /Filho da puta!/ }));
    expect(onShout.mock.calls).toEqual([['matchOwn'], ['matchOpponent']]);
  });

  it('reaction window: a first wrong try still leaves one attempt', () => {
    const view = scene('reacao');
    const once: GameView = { ...view, reactionWindow: { ...view.reactionWindow!, attemptedBy: ['s0'], yourAttemptsLeft: 1 } };
    setup(once);
    expect(screen.getByRole('button', { name: /Filha da putinha!/ })).toBeEnabled();
  });

  it('reaction window: a reaction switched off at this table is not offered', () => {
    const view = scene('reacao');
    const onSend = vi.fn();
    render(
      <ActionBar
        ctx={uiContext(view, NOW)}
        picks={NO_PICKS}
        shout={null}
        onSend={onSend}
        onShout={vi.fn()}
        onCancel={vi.fn()}
        reactions={{ matchOwn: false, matchOpponent: true }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Filha da putinha!/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Filho da puta!/ })).toBeEnabled();
  });

  it('reaction window: shouts are off when your attempts ran out', () => {
    const view = scene('reacao');
    const reacted: GameView = { ...view, reactionWindow: { ...view.reactionWindow!, attemptedBy: ['s0'], yourAttemptsLeft: 0 } };
    setup(reacted);
    expect(screen.getByRole('button', { name: /Filha da putinha!/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Filho da puta!/ })).toBeDisabled();
  });

  it('reaction window: shouts are off once the server deadline passed', () => {
    const view = scene('reacao');
    const late: GameView = { ...view, reactionWindow: { ...view.reactionWindow!, deadline: NOW } };
    setup(late);
    expect(screen.getByRole('button', { name: /Filho da puta!/ })).toBeDisabled();
  });

  it('a waiting shout says which card to tap and can be cancelled', async () => {
    const { onCancel } = setup(scene('reacao'), NO_PICKS, 'matchOpponent');
    expect(screen.getByText('Toque na carta igual do inimigo.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('CallEndButton ("Estou foda")', () => {
  function renderEnd(view: GameView) {
    const onSend = vi.fn<(action: Action) => void>();
    const utils = render(<CallEndButton view={view} ctx={uiContext(view, NOW)} onSend={onSend} />);
    return { ...utils, onSend };
  }

  it('sends at once, with no confirmation', async () => {
    const { onSend } = renderEnd(scene('minha-vez'));
    await userEvent.click(screen.getByRole('button', { name: /Estou foda/ }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith({ type: 'callEnd' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is offered in every step of your own turn', () => {
    for (const id of ['minha-vez', 'comprada', 'poder-j', 'poder-k-troca'] as const) {
      const { unmount } = renderEnd(scene(id));
      expect(screen.getByRole('button', { name: /Estou foda/ })).toBeInTheDocument();
      unmount();
    }
  });

  it('is not offered on someone else’s turn, before the game or after someone called it', () => {
    for (const id of ['vez-de-outro', 'reacao', 'arrumacao', 'estou-foda', 'fim'] as const) {
      const { container, unmount } = renderEnd(scene(id));
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
