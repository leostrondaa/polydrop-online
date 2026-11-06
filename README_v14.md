# PolyDrop v14 — interface direta, preto e amarelo

Esta versão parte dos arquivos **v13_visual_final_20261105** e mantém o cálculo de captura visual compartilhado entre navegador e servidor (`public/collision.js`). O movimento do béquer não gera contato ao varrer posições anteriores: apenas o contato observado no quadro desenhado envia `game:catch`. O servidor valida e pontua uma vez.

## Aparência
- Fundo preto sólido e amarelo sólido para ação e destaques, sem degradês, brilho ou transparências decorativas.
- A página inicial mostra só o nome, uma frase, campo de nome, dois modos, criação de sala e entrada por código.
- Lobby, placar, resultado e cartão de missão mais limpos. As instruções educativas curtas antes de cada fase foram preservadas.
- No jogo, as moléculas usam cor chapada e rótulos, sem gradiente (a identidade do monômero permanece escrita em cada bola).

## Instalação
Substitua **todos os arquivos deste projeto juntos**. O `server.js` depende de `public/collision.js`; não misture com o `public/contact.js` de versões anteriores.

## Validação
Testes locais de sintaxe, interface, viewport e colisão são executados à parte. Testar também em celulares e conexões reais, principalmente as fases finais.
