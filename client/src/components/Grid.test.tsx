import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@moises/shared';
import { Grid } from './Grid';

const player: PlayerView = {
  id: 'p1',
  name: 'Ana',
  isYou: false,
  cardCount: 3,
  slots: [
    { state: 'hidden' },
    { state: 'visible', card: { kind: 'standard', rank: '9', suit: 'hearts' }, until: 5_000 },
    { state: 'empty' },
    { state: 'visible', card: { kind: 'joker', color: 'black' }, until: null },
  ],
};

const label = (slot: number) => `Ana, posição ${slot + 1}`;

describe('Grid', () => {
  it('keeps every position in order, empty ones included', () => {
    render(<Grid player={player} now={1_000} size="opp" label="Cartas de Ana" slotLabel={label} />);
    const cells = within(screen.getByRole('group', { name: 'Cartas de Ana' })).getAllByRole('img');
    expect(cells.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Ana, posição 1: carta virada para baixo',
      'Ana, posição 2: 9 de copas',
      'Ana, posição 3: vazia',
      'Ana, posição 4: Coringa preto',
    ]);
  });

  it('turns a timed card face down once the server time passes its `until`', () => {
    const { rerender } = render(<Grid player={player} now={4_999} size="opp" label="Cartas de Ana" slotLabel={label} />);
    expect(screen.getByRole('img', { name: 'Ana, posição 2: 9 de copas' })).toBeInTheDocument();

    rerender(<Grid player={player} now={5_000} size="opp" label="Cartas de Ana" slotLabel={label} />);
    expect(screen.getByRole('img', { name: 'Ana, posição 2: carta virada para baixo' })).toBeInTheDocument();
    expect(screen.queryByText(/9 de copas/)).toBeNull();
    // A card with until = null (end of game) stays up.
    expect(screen.getByRole('img', { name: 'Ana, posição 4: Coringa preto' })).toBeInTheDocument();
  });

  it('lets only the allowed positions be chosen', async () => {
    const onSelect = vi.fn();
    render(
      <Grid
        player={player}
        now={0}
        size="opp"
        label="Cartas de Ana"
        slotLabel={label}
        isSelectable={(slot) => slot === 0}
        isSelected={() => false}
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('numbers your own positions from 1', () => {
    render(<Grid player={{ ...player, isYou: true }} now={0} size="you" label="Sua grade" slotLabel={label} numbered />);
    const numbers = Array.from(document.querySelectorAll('.grid__num')).map((n) => n.textContent);
    expect(numbers).toEqual(['1', '2', '3', '4']);
  });
});
