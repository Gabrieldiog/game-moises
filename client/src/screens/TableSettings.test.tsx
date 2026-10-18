import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SetTableSettingsPayload, TableSettingsView } from '@moises/shared';
import { knownPowerRanks, type RankMemory } from '../game/powerRanks';
import { TableSettings } from './TableSettings';

const TABLE: TableSettingsView = {
  turnSeconds: 15,
  reactions: { matchOwn: true, matchOpponent: true },
  powers: ['7', '8', 'K'],
};

function setup(editable: boolean, table = TABLE) {
  const onChange = vi.fn<(s: SetTableSettingsPayload) => Promise<{ ok: true }>>(async () => ({ ok: true }));
  render(<TableSettings table={table} powerRanks={['7', '8', 'J', 'K']} editable={editable} onChange={onChange} />);
  return { onChange };
}

describe('TableSettings', () => {
  it('the host changes time, reactions and powers; each change is sent whole', async () => {
    const { onChange } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: 'Mais tempo' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...TABLE, turnSeconds: 20, powers: ['7', '8', 'K'] });
    await userEvent.click(screen.getByRole('switch', { name: /Filha da putinha/ }));
    expect(onChange.mock.lastCall?.[0].reactions).toEqual({ matchOwn: false, matchOpponent: true });
    await userEvent.click(screen.getByRole('button', { name: 'J' }));
    expect(onChange.mock.lastCall?.[0].powers).toEqual(['7', '8', 'J', 'K']);
    await userEvent.click(screen.getByRole('button', { name: 'K preto' }));
    expect(onChange.mock.lastCall?.[0].powers).toEqual(['7', '8', 'J']);
  });

  it('time stays inside the protocol bounds', () => {
    setup(true, { ...TABLE, turnSeconds: 60 });
    expect(screen.getByRole('button', { name: 'Mais tempo' })).toBeDisabled();
  });

  it('everyone else only reads', () => {
    setup(false, { ...TABLE, reactions: { matchOwn: false, matchOpponent: true } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Só o anfitrião muda as configurações.')).toBeInTheDocument();
    expect(screen.getByLabelText('J: desligada')).toBeInTheDocument();
    expect(screen.getByText('15 s')).toBeInTheDocument();
  });
});

describe('knownPowerRanks', () => {
  it('remembers ranks seen on for the room, so switching one off keeps its switch', () => {
    let stored: { code: string; ranks: readonly string[] } | null = null;
    const memory: RankMemory = { load: () => stored, save: (v) => void (stored = v) };
    expect(knownPowerRanks('AAAA', ['7', 'K', 'Q'], memory)).toEqual(['7', 'Q', 'K']);
    expect(knownPowerRanks('AAAA', ['K'], memory)).toEqual(['7', 'Q', 'K']);
    expect(knownPowerRanks('BBBB', ['8'], memory)).toEqual(['8']);
  });
});
