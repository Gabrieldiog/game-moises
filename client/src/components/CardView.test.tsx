import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '@moises/shared';
import backUrl from '../assets/card-back.svg';
import { CardView, faceFile } from './CardView';

const KH: Card = { kind: 'standard', rank: 'K', suit: 'hearts' };
const KS: Card = { kind: 'standard', rank: 'K', suit: 'spades' };

describe('faceFile', () => {
  it('maps faces to the CC0 file names', () => {
    expect(faceFile({ kind: 'standard', rank: '10', suit: 'diamonds' })).toBe('TD');
    expect(faceFile({ kind: 'standard', rank: 'A', suit: 'spades' })).toBe('AS');
    expect(faceFile({ kind: 'standard', rank: 'Q', suit: 'clubs' })).toBe('QC');
    expect(faceFile({ kind: 'joker', color: 'red' })).toBe('1J');
    expect(faceFile({ kind: 'joker', color: 'black' })).toBe('2J');
  });
});

describe('CardView', () => {
  it('shows a face-up card with its file and an accessible name', () => {
    const { container } = render(
      <CardView slot={{ state: 'visible', card: { kind: 'standard', rank: '7', suit: 'clubs' }, until: null }} size="you" label="Sua posição 1" />,
    );
    expect(screen.getByRole('img', { name: 'Sua posição 1: 7 de paus' })).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/cards\/7C\.svg$/);
  });

  it('never puts anything about a hidden card in the DOM', () => {
    const { container } = render(<CardView slot={{ state: 'hidden' }} size="opp" label="Ana, posição 2" />);
    expect(screen.getByRole('img', { name: 'Ana, posição 2: carta virada para baixo' })).toBeInTheDocument();
    const html = container.innerHTML;
    expect(html).not.toMatch(/cards\//);
    expect(html).not.toMatch(/king|copas|espadas|ouros|paus|Rei|Dama|Valete/i);
    // Every hidden card uses the same generic back image.
    expect(container.querySelector('img')?.getAttribute('src')).toBe(backUrl);
  });

  it('shows an empty position as an empty space', () => {
    const { container } = render(<CardView slot={{ state: 'empty' }} size="you" label="Sua posição 3" />);
    expect(screen.getByRole('img', { name: 'Sua posição 3: vazia' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('marks red and black kings differently, in the DOM and for screen readers', () => {
    const { rerender, container } = render(<CardView slot={{ state: 'visible', card: KH, until: null }} size="pile" label="Descarte" />);
    expect(container.firstElementChild).toHaveClass('card--king-red');
    expect(screen.getByRole('img', { name: /Rei de copas \(vermelho\)/ })).toBeInTheDocument();
    expect(container.querySelector('.card__kfold')).toHaveTextContent('♥');

    rerender(<CardView slot={{ state: 'visible', card: KS, until: null }} size="pile" label="Descarte" />);
    expect(container.firstElementChild).toHaveClass('card--king-black');
    expect(screen.getByRole('img', { name: /Rei de espadas \(preto\)/ })).toBeInTheDocument();
  });

  it('flags a card that is visible only for a while', () => {
    const { container } = render(<CardView slot={{ state: 'visible', card: KS, until: 123 }} size="opp" label="Ana, posição 1" />);
    expect(container.firstElementChild).toHaveClass('is-timed');
  });

  it('becomes a toggle button when it can be chosen', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <CardView slot={{ state: 'hidden' }} size="you" label="Sua posição 2" selectable onSelect={onSelect} />,
    );
    const button = screen.getByRole('button', { name: 'Sua posição 2: carta virada para baixo' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<CardView slot={{ state: 'hidden' }} size="you" label="Sua posição 2" selectable selected onSelect={onSelect} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
