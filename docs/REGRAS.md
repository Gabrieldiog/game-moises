# Moisés — regras do jogo

Fonte da verdade para o motor (back-end), a interface (front-end) e os testes (QA).
Itens marcados com **[SUPOSIÇÃO]** não foram definidos pelo dono do jogo; o motor usa o padrão indicado e o valor fica em configuração para ser trocado sem reescrever código.

## Baralho
- 52 cartas (A a K, 4 naipes) + 2 coringas = 54 cartas.
- Valores: A = 1, 2–10 = valor da face, J = 11, Q = 12, K preto (♠ ♣) = 13, **K vermelho (♥ ♦) = −1**, coringa = 0.
- Jogadores: 2 a 6 **[SUPOSIÇÃO]**. Modos: online (salas) e contra bots.

## Mesa
- Cada jogador recebe 4 cartas viradas para baixo, em grade 2×2:
  ```
  [0] [1]
  [2] [3]
  ```
  A "última coluna" (como o dono do jogo chama) é a **fileira de baixo**: posições 2 e 3.
- Ninguém vê as próprias cartas, exceto quando uma regra mostra.

## Início
1. Embaralha e distribui 4 cartas para cada jogador.
2. **Arrumação (5 s):** depois que todos receberam, cada jogador pode trocar suas cartas de posição na própria grade, **sem ver** as cartas. Exemplo: cima [2, 3], baixo [K, 4]; ao trocar K com 2 fica cima [K, 3], baixo [2, 4].
3. **Espiada inicial (5 s):** cada jogador vê, só ele, as 2 cartas da fileira de baixo (posições 2 e 3). No exemplo, vê o 2 e o 4 e não sabe as de cima.
4. Começa o primeiro jogador **[SUPOSIÇÃO: sorteado]**.

## Turno
1. Comprar a carta do topo do monte. Só o jogador da vez vê a carta comprada. **[SUPOSIÇÃO]** Não se compra do descarte.
2. Escolher uma opção:
   - **Trocar:** a carta comprada entra numa posição da sua grade (sem ver a antiga); a antiga vai para o descarte, virada para cima. Poderes **não** são ativados.
   - **Descartar:** a carta comprada vai para o descarte. Se tiver poder, o jogador **pode** usá-lo (opcional).
3. Cada descarte abre a **janela de reação** (ver Reações).
4. Se o monte acabar, o descarte (menos a carta do topo) é embaralhado e vira o novo monte **[SUPOSIÇÃO]**.

## Poderes
Só valem para a carta **comprada e descartada** no mesmo turno. Cartas que já estão na grade nunca têm poder. Toda troca é opcional.

| Carta | Poder |
|---|---|
| 7, 8 | Ver uma das suas cartas. |
| 9, 10 | Ver uma carta de um inimigo. |
| Q | Trocar no escuro: troca uma carta sua com uma de um inimigo, sem ver nenhuma das duas. |
| J | Ver uma carta de um inimigo e decidir se troca com uma sua (sem ver a sua). |
| K preto | Ver duas cartas de inimigos (podem ser de inimigos diferentes **[SUPOSIÇÃO]**) e decidir se troca **uma** delas com uma sua. |
| K vermelho | Sem poder; vale −1. |
| Coringa | Sem poder; vale 0. |
| A–6 | Sem poder. |

Uma carta vista fica visível por um tempo curto e depois volta a ficar virada para baixo. Lembrar dela é parte do jogo.

## Reações (podem ser feitas por qualquer jogador, fora da vez)
Abrem a cada carta que vai para o descarte e duram uma janela curta (**[SUPOSIÇÃO] 3 s**, configurável). Vale só a **primeira** reação válida recebida pelo servidor.

- **"Filha da putinha":** a carta descartada tem o mesmo número que uma carta sua (qualquer naipe). Você descarta a sua e fica com uma carta a menos.
- **"Filho da puta":** você sabe que a carta numa posição exata de um inimigo tem o mesmo número da descartada. Você pega a carta dele, descarta, e entrega uma das suas no lugar. Você fica com uma carta a menos; ele continua com a mesma quantidade.
- **Erro:** se a carta indicada não tiver o mesmo número, nada sai do lugar e quem errou **revela para todos** uma carta dele: na "filha da putinha", a carta que tentou descartar; no "filho da puta", a carta que ia entregar. A carta fica visível por alguns segundos e volta a ficar virada para baixo.
- Vale reagir ao descarte de qualquer jogador, inclusive o seu. A "filha da putinha" sempre tira uma carta **sua**; o "filho da puta" sempre tira a de um **inimigo**.
- **[SUPOSIÇÃO]** O jogador da vez usa o poder depois que a janela de reação fecha.

## Fim de jogo
- O jogador da vez joga normalmente e, durante o próprio turno, pode falar **"Estou foda"**. Depois, cada outro jogador joga mais um turno; quando a vez voltaria para quem falou, a partida acaba (ele não joga de novo).
- Todas as cartas são reveladas. Ganha quem tiver a **menor soma**. Em empate, todos os empatados ganham.
- **[SUPOSIÇÃO]** Se um jogador ficar sem cartas, o fim é disparado automaticamente como se ele tivesse falado "Estou foda".

## Princípios técnicos
- O **servidor é a autoridade**. Ele guarda o baralho e todas as cartas; cada jogador recebe só o que pode ver. O navegador nunca recebe cartas escondidas, então não dá para trapacear pelo DevTools.
- O servidor valida toda ação: vez, fase, posse da carta e formato da mensagem.
- Valores das cartas, tempos e limites ficam na configuração do servidor (`server/src/config`). O front-end exibe o que o servidor manda.

## Detalhes decididos na implementação
Pontos que a descrição original não cobria. Todos ficam em `server/src/config/rules.ts` quando faz sentido; podem ser revistos pelo dono do jogo.
- Cada jogador tem **1 tentativa de reação por descarte**. Sem isso, dava para chutar posição por posição.
- Uma reação **errada não fecha** a janela; a primeira **certa** fecha.
- Só descartes do turno abrem janela de reação. O descarte feito por uma reação certa não abre outra.
- O próximo turno só começa quando a janela de reação fecha.
- Coringa casa com coringa. K vermelho casa com K preto (mesmo número).
- Carta vista (poder ou erro de reação) fica aberta por **3 s**.
- Poder sem alvo possível (ex.: inimigos sem cartas) é pulado automaticamente.
- O descarte começa vazio.
- **Timer de turno (v0.2):** o jogador da vez tem **30 s** (`turnMs`, configurável por `MOISES_TURN_MS`) para **cada decisão** do turno: comprar, ficar com a carta ou descartar, usar ou pular o poder. A janela de reação não conta (tem prazo próprio). Se o tempo acabar, o servidor joga o mínimo pelo resto daquele turno: compra se ainda não comprou, descarta a carta comprada e pula o poder. Vale também para jogadores desconectados. O motor continua sem timers; quem aplica o prazo é o servidor.
