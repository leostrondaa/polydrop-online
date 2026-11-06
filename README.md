# PolyDrop Online v9 — missões por fase

## Atualização
- Antes de cada fase, cartão em tela cheia durante 6 segundos com 3 telas curtas: função, monômero e curiosidade química.
- Jogo fica pausado durante a apresentação e a contagem regressiva acontece depois.
- No modo Corrida individual, o objetivo continua associado ao polímero da fase e os especiais permanecem disponíveis.
- No modo Laboratório compartilhado, o servidor sorteia um monômero distinto para cada participante (até 4), mostrando a distribuição a todos. Pegar a molécula de outro jogador conta como erro.
- Feedback de acerto usa um único indicador de pontuação flutuante, com partículas e brilho no copo.
- Conserva a hitbox por contato com a linha do copo, cooldown, vibração e poderes da v8.

## Instalação
1. Substitua `server.js` e `public/index.html` juntos no repositório.
2. Faça commit. O Render pode atualizar automaticamente, caso esteja configurado.
3. Recarregue o site sem cache após o deploy.

## Verificações locais
- `node test-v9.cjs` passou.
- Interface testada em Chromium 390×844 e 1280×800, nos dois modos.
- Não foi feita partida real em celulares diferentes.


## v10 - Captura responsiva
- Boca iluminada 8% menor; colisão usa a mesma geometria.
- Contato nas paredes laterais superiores do copo também captura, mesmo abaixo da boca.
- Copo local segue o dedo imediatamente; envio de posição mais frequente.
- Desvios laterais muito rápidos têm uma janela de 48 ms sem capturas para evitar falsos positivos por atraso.
- Mantidos briefings v9, poderes e modo compartilhado.
