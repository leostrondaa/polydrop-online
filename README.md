# PolyDrop Online — multiplayer didático de polímeros

Jogo HTML/JS com dois modos de jogo, salas por código e QR Code. **O servidor Node.js é necessário**: apenas abrir o arquivo HTML não permite o multiplayer.

## Modos

- **Corrida individual:** todos jogam ao mesmo tempo, cada pessoa com seu próprio conjunto de moléculas. Vence a maior pontuação.
- **Laboratório compartilhado:** todos veem o mesmo conjunto de moléculas e movem seus béqueres no mesmo campo. A primeira pessoa a alcançar uma molécula ganha seus pontos.

## Rodar no computador

1. Instale Node.js 18 ou superior.
2. Abra um terminal nesta pasta.
3. Rode `npm install`.
4. Rode `npm start`.
5. Abra http://localhost:3000 no navegador.

Para testar entre celulares na **mesma rede Wi-Fi**, abra o jogo pelo endereço IP local do computador (exemplo: `http://192.168.0.10:3000`). O firewall deve permitir a porta 3000. Se abrir com `localhost`, o QR Code também vai apontar para localhost e **não funcionará em outros celulares**; crie a sala pelo IP acessível pelos celulares.

## Colocar online para toda a turma

Hospede esta pasta como um **Web Service Node.js** em um serviço que mantenha conexões WebSocket (por exemplo, Render, Railway ou um VPS).

- Instalação: `npm install`
- Inicialização: `npm start`
- Porta: variável `PORT` fornecida pelo serviço ou 3000 por padrão.
- Suba todos os arquivos da pasta para um repositório Git e conecte-o ao serviço de hospedagem.
- Abra a URL pública HTTPS, crie a sala e mostre o QR Code.

**Importante:** o jogo só será acessível pela internet depois que o servidor for publicado. O código sozinho não cria uma URL pública. Salas e placares ficam na memória: são perdidos quando o servidor reinicia, e só funcionam corretamente com **uma única instância do servidor**. Hospedagem gratuita pode suspender o servidor por inatividade. O QR Code abre a URL atual do jogo.

## Mecânica e didática

- 5 etapas, 22 segundos cada (110 segundos no total, fora a contagem inicial).
- +10 pontos ao capturar o monômero correspondente ao polímero da rodada.
- +5 de bônus a cada 3 acertos seguidos.
- −5 ao capturar uma molécula errada (mínimo zero).
- Explicação breve com monômero, polímero, reação e uso ao acertar cada combinação pela primeira vez.
- O popup desaparece automaticamente depois de 4,2 segundos, sem pausar os demais jogadores.
- Máximo: 12 jogadores por sala.
- Sem login, anúncios, banco de dados ou imagens externas.

## Observação de química

Os cinco pares utilizados são exemplos de **polimerização por adição**: cloreto de vinila/PVC, eteno/polietileno, estireno/poliestireno, tetrafluoroetileno/PTFE e propeno/polipropileno. As equações são simplificadas e mostram a unidade de repetição das cadeias.
