import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GameView } from '@moises/shared';
import { buildScenario } from '../demo/fixtures';
import { EndScreen, formatTotal } from './EndScreen';

function endView(players: number): GameView {
  return buildScenario('fim', { players, now: 1_000 });
}

describe('EndScreen', () => {
  it('shows every card face up, each total and the single winner', () => {
    render(<EndScreen view={endView(6)} onLeave={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Fim de jogo' })).toBeInTheDocument();
    expect(screen.getByText('Duda ganhou!')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    // Lowest total first; values exactly as sent by the server.
    expect(rows.map((r) => within(r).getByLabelText(/^Soma:/).getAttribute('aria-label'))).toEqual([
      'Soma: 3',
      'Soma: 7',
      'Soma: 7',
      'Soma: 11',
      'Soma: 28',
      'Soma: 43',
    ]);
    expect(rows[0]).toHaveClass('is-winner');
    expect(screen.queryAllByRole('img', { name: /carta virada para baixo/ })).toHaveLength(0);
  });

  it('announces a tie with every winner', () => {
    render(<EndScreen view={endView(4)} onLeave={() => {}} />);
    expect(screen.getByText('Empate: Você e Beto ganharam!')).toBeInTheDocument();
    expect(document.querySelectorAll('.end__row.is-winner')).toHaveLength(2);
  });

  it('never adds the cards up: it shows the totals the server sent', () => {
    const base = endView(2);
    const view: GameView = {
      ...base,
      result: {
        reason: 'deckExhausted',
        scores: [
          { playerId: 's0', total: 999 },
          { playerId: 's1', total: -1 },
        ],
        winners: ['s1'],
      },
    };
    render(<EndScreen view={view} onLeave={() => {}} />);
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
    expect(screen.getByText('Ana ganhou!')).toBeInTheDocument();
    expect(screen.getByText('As cartas acabaram.')).toBeInTheDocument();
  });

  it('goes back to the start', async () => {
    const onLeave = vi.fn();
    render(<EndScreen view={endView(2)} onLeave={onLeave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Voltar ao início' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a result', () => {
    const { container } = render(<EndScreen view={{ ...endView(2), result: null }} onLeave={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('formats negative totals with a real minus sign', () => {
    expect(formatTotal(-3)).toBe('−3');
    expect(formatTotal(0)).toBe('0');
    expect(formatTotal(12)).toBe('12');
  });
});
