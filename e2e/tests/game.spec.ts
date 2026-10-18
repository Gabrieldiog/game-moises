import { expect, test } from '@playwright/test';
import { createRoom, hiddenCards, openHome, roomCode } from './helpers';

test('1) joga contra 2 bots ate a tela final', async ({ page }) => {
  await openHome(page, 'Ana');
  await page.getByRole('button', { name: 'Jogar contra 2 bots' }).click();

  const callEnd = page.getByRole('button', { name: /^Estou foda/ });
  const endTitle = page.getByRole('dialog').getByRole('heading', { name: 'Fim de jogo' });

  // Wait for our turn (the arrange/peek phases and bot turns pass by themselves), then end the game.
  await expect(callEnd).toBeVisible({ timeout: 30_000 });
  await callEnd.click();

  await expect(endTitle).toBeVisible({ timeout: 30_000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/ganhou!|Empate:/)).toBeVisible();
  await expect(dialog.getByText(/^Soma/).first()).toBeVisible();
  // Totals for the three players, each with its own cards face up.
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: 'Voltar para a sala' })).toBeVisible();
});

test('2) duas abas: sala, codigo, bot, configuracoes da mesa e inicio', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    const code = await createRoom(host, 'Host');

    await openHome(guest, 'Convidada');
    await guest.getByRole('textbox', { name: 'Código da sala' }).fill(code.toLowerCase());
    await guest.getByRole('button', { name: 'Entrar', exact: true }).click();
    expect(await roomCode(guest)).toBe(code);
    await expect(host.getByText('2 de 6 lugares')).toBeVisible();
    await expect(guest.getByText('Esperando o anfitrião começar a partida.')).toBeVisible();

    await host.getByRole('button', { name: 'Adicionar bot' }).click();
    await expect(host.getByText('3 de 6 lugares')).toBeVisible();
    await expect(guest.getByText('3 de 6 lugares')).toBeVisible();

    // Host turns one reaction off; the guest sees it, read-only.
    const hostSwitch = host.getByRole('switch', { name: /Filha da putinha/ });
    await expect(hostSwitch).toHaveAttribute('aria-checked', 'true');
    await hostSwitch.click();
    await expect(hostSwitch).toHaveAttribute('aria-checked', 'false');

    const guestTable = guest.getByRole('region', { name: 'Configurações da mesa' });
    await expect(guestTable.getByText('Só o anfitrião muda as configurações.')).toBeVisible();
    await expect(guestTable.locator('p.switch', { hasText: 'Filha da putinha!' }).getByText('desligada')).toBeVisible();
    await expect(guestTable.locator('p.switch', { hasText: 'Filho da puta!' }).getByText('ligada', { exact: true })).toBeVisible();
    await expect(guest.getByRole('switch')).toHaveCount(0);

    await host.getByRole('button', { name: 'Começar partida' }).click();
    for (const page of [host, guest]) {
      await expect(page.getByRole('img', { name: /^Sua posição 1:/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Começar partida' })).toHaveCount(0);
    }
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('3) recarregar a pagina volta para a mesma sala', async ({ page }) => {
  const code = await createRoom(page, 'Rita');
  await page.getByRole('button', { name: 'Adicionar bot' }).click();
  await expect(page.getByText('2 de 6 lugares')).toBeVisible();

  await page.reload();
  expect(await roomCode(page)).toBe(code);
  await expect(page.getByText('2 de 6 lugares')).toBeVisible();

  // The same, in the middle of a game.
  await page.getByRole('button', { name: 'Começar partida' }).click();
  await expect(page.getByRole('img', { name: /^Sua posição 1:/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: /^Sua posição 1:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar sala' })).toHaveCount(0);
});

test('4) codigo de sala errado mostra erro em portugues', async ({ page }) => {
  await openHome(page, 'Beto');
  await page.getByRole('textbox', { name: 'Código da sala' }).fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não achamos uma sala com esse código');
  // Still on the home screen.
  await expect(page.getByRole('button', { name: 'Criar sala' })).toBeVisible();
});

test('5) nenhum texto de carta escondida aparece no DOM', async ({ page }) => {
  await openHome(page, 'Clara');
  await page.getByRole('button', { name: 'Jogar contra 2 bots' }).click();
  await expect(page.getByRole('img', { name: /^Sua posição 1:/ })).toBeVisible();

  const faceName = /(Ás|Valete|Dama|Rei|\d+) de (espadas|copas|ouros|paus)|Coringa (preto|vermelho)/;
  const assertHiddenAreBlind = async () => {
    const found = await hiddenCards(page).evaluateAll((els) =>
      els.map((el) => ({
        label: el.getAttribute('aria-label') ?? '',
        html: el.outerHTML,
        text: el.textContent ?? '',
      })),
    );
    for (const card of found) {
      expect(card.label).toMatch(/: carta virada para baixo$/);
      expect(card.text.trim()).toBe('');
      expect(card.html).not.toMatch(/cards\/[A-Z0-9]+\.svg/);
      expect(card.html).not.toMatch(faceName);
    }
    return found.length;
  };

  // Right at the start (everything face down before the peek) and again once the peek is over and the bots play.
  expect(await assertHiddenAreBlind()).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /^Estou foda/ })).toBeVisible({ timeout: 30_000 });
  expect(await assertHiddenAreBlind()).toBeGreaterThan(4);
});
