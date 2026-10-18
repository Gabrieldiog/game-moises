import { expect, type Page } from '@playwright/test';

/** Opens the app, waits for the server connection and types the player's name. */
export async function openHome(page: Page, name: string): Promise<void> {
  await page.goto('/');
  const nameField = page.getByLabel('Seu nome');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  // Buttons stay disabled while the name is empty; enabled does not prove the socket is up,
  // so callers rely on the ack/notice that follows their click (requests wait for the connection).
}

/** The room code shown in the waiting room (the heading is the code itself). */
export async function roomCode(page: Page): Promise<string> {
  const heading = page.getByRole('heading', { level: 1, name: /^Sala / });
  await expect(heading).toBeVisible();
  const code = ((await heading.textContent()) ?? '').trim();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  return code;
}

export async function createRoom(page: Page, name: string): Promise<string> {
  await openHome(page, name);
  await page.getByRole('button', { name: 'Criar sala' }).click();
  return roomCode(page);
}

/** Every position shown face down: label ends with "carta virada para baixo". */
export function hiddenCards(page: Page) {
  return page.locator('[aria-label$="carta virada para baixo"]');
}
