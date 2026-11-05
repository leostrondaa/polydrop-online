# PolyDrop Online — versão 2 (corrigida)

Jogo multiplayer de química com duas modalidades e salas por QR Code. Para usar online, é necessário hospedar **o servidor Node.js e a pasta `public`** no Render (ou serviço equivalente).

## Como atualizar seu repositório existente

**Substitua os arquivos existentes**, mantendo estas pastas:

```text
polydrop-online/
  server.js          <- substituir
  package.json       <- manter (sem alterações)
  render.yaml        <- manter
  public/
    index.html       <- substituir
  README.md          <- opcional
```

No GitHub, abra `server.js` (na raiz), clique no lápis e cole o conteúdo do `server.js` novo. Faça o mesmo com `public/index.html`. **Não coloque o `index.html` na raiz.** Ao salvar no branch `main`, o Render geralmente inicia o deploy automaticamente, se Auto-Deploy estiver ativo. Caso não esteja, use **Manual Deploy → Deploy latest commit** no Render.

Quando o serviço estiver **Live**, recarregue a página e crie **uma sala nova**: o deploy reinicia o servidor e as salas anteriores são perdidas.

## O que foi corrigido

- Tela inicial não fica mais visível por cima da partida: CSS de visibilidade corrigido.
- Cada participante tem uma identidade estável por aba, diferente do ID da conexão WebSocket.
- Reconexão durante o lobby, contagem regressiva e partida sem criar participante duplicado.
- Retorno durante a partida preserva pontos e status de anfitrião, enquanto a sala estiver ativa.
- Aviso visível se a sala realmente expirou após reinicialização do servidor.
- Cliente sem cache para evitar versões antiga e nova misturadas após deploy.
- Interface com menos texto e descobertas de química em frases curtas (~3 segundos).
- Dois modos mantidos: corrida individual (`race`) e laboratório compartilhado (`arena`).

## Executar localmente

Requer Node.js 18+:

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Teste automatizado

O arquivo `tests/simulation.js` não precisa de pacotes adicionais. Ele simula conexões, criação e entrada em salas, começo da partida, pontuação, primeira descoberta, reconexão, final das cinco fases e revanche nos dois modos:

```bash
node tests/simulation.js
```

## Regras

- 5 fases de 22 segundos, além da contagem inicial.
- +10 por monômero correto, +5 a cada três acertos seguidos e −5 por erro.
- As primeiras capturas corretas de cada fase mostram breves exemplos de polimerização por adição.
- Até 12 jogadores por sala, sem cadastro.

**Limitação do Render Free:** salas e pontuações ficam na memória do servidor. Uma suspensão ou reinicialização encerra as salas existentes. A versão 2 recupera conexões **somente enquanto aquela sala ainda existe no servidor**. Para várias instâncias ou partidas persistentes seria preciso um banco de dados/armazenamento compartilhado.
