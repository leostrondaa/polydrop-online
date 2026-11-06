# PolyDrop v16.4 — memes de ataque + regras e missões

Base: v15, com sobrevivência cooperativa, colisão visual e interface preta/amarela.

## Regras antes de cada partida

- **Individual**: 3 cartões curtos (capturar monômeros, desviar e ativar ataques, vencer pelo placar).
- **Cooperativo**: 3 cartões curtos (5 vidas, tarefas e transferência de monômeros, meta coletiva).
- Os cartões ocupam a tela, apresentam **uma única mensagem de cada vez**, com **fade + deslocamento vertical**, 1,8s por mensagem. **5,4s no total**, sincronizados pelo servidor para todos os jogadores.
- Depois aparecem a missão da etapa (3,6s na primeira, 4,8s nas demais) e a contagem de partida. Regras não reaparecem a cada fase, apenas ao iniciar uma nova partida.
- Se alguém recarregar a página durante as regras, volta para o slide correspondente ao horário da sala.

## Educação / avaliação

- Missões por fase mostram monômero, polímero e uso real do material.
- Ao capturar o primeiro exemplo de um monômero, a descoberta exibe explicação química.
- Na tela final, **Revisão rápida** opcional: 3 questões diferentes para associar polímeros a monômeros, com correção, fórmula da reação e aplicação cotidiana. Não altera o placar.
- Tela inicial e jogo mantidos limpos em preto e amarelo chapados, sem degradês.

## Publicação

Atualizar **server.js** e **toda a pasta public/** juntos. Render/GitHub não foram alterados automaticamente. Node.js >= 18, `npm install`, `npm start`.

## Notas de teste

O projeto vem com os arquivos completos. Testar em celular e multiplayer real depois da publicação: os testes locais não substituem latência e touch reais.

## Critérios de avaliação contemplados

I — Conteúdo de polímeros: cinco pares monômero/polímero, exemplos de uso, explicações por fase e perguntas ao fim.

II — Apresentação visual: preto/amarelo sólidos, legibilidade e responsividade no celular.

III — Regras: apresentação animada específica de cada modo, objetivos por fase e instruções no HUD.

IV — Envolvimento: pontuação, modos multiplayer, sobrevivência cooperativa, atribuições de tarefas, ataques no individual.

## Ajuste v16.1 — velocidade da 5ª fase

Somente a velocidade vertical das moléculas da quinta fase foi reduzida: de `4.0` para `3.5` na Corrida Individual (12,5% mais lenta) e de `1.85` para `1.65` no Cooperativo (cerca de 10,8% mais lenta). Todas as outras fases, metas, frequência de surgimento, poderes, interface e hitbox permanecem inalteradas.


## Ajuste v16.2 — abertura sem confusão

- **Regras**: 3 cartões por modalidade; cada cartão fica **3,8 segundos** (11,4s no total) com fade/slide suave. Válido também para jogadores que reconectam no meio das regras.
- **Missão individual**: não usa mais cartão separado ou tela cheia. O texto aparece **diretamente sobre a pista** (mesmo lugar da contagem), mostra qual polímero produzir e qual monômero capturar.
- **Missão cooperativa**: mostra seu(s) monômero(s), meta da equipe e vidas; se estiver eliminado, informa que está assistindo. A redistribuição das tarefas permanece intacta.
- **Sequência exata**: cartões de regras (somente no início da partida) → atribuição dentro da pista (~3,4s na fase 1; ~3,2s nas seguintes) → `3, 2, 1, VAI!` (3,5s) → moléculas começam a cair.
- A partida continua bloqueada no servidor durante todas as instruções e contagem, para garantir sincronização no multiplayer.
- A velocidade reduzida do estágio 5 da v16.1 foi preservada.


## Ajuste v16.3 — som surpresa sem botão

- No modo individual, quando o servidor aplica um poder, TODOS os participantes da mesma sala ouvem um efeito surpresa ao mesmo tempo (a partir do evento `game:power` existente).
- Seis gritos curtos e impactos **originais**, gerados localmente para esta versão; nenhum áudio de TV ou gravação do Rodrigo Faro/MyInstants é distribuído aqui.
- A seleção é aleatória por ataque, mas determinística a partir do próprio evento: todos ouvem o mesmo efeito.
- Áudio sempre ativo, sem botão; Chrome/Android exigem ao menos uma interação com a página. O toque em **Criar sala** ou **Entrar** desbloqueia o Web Audio e inicia o carregamento.
- Efeitos com punch/compressão e limite de pico; têm presença sem clipping digital proposital ou ganho inseguro em fones.
- A pasta `public/sounds` contém os seis arquivos MP3 compactos. Se um MP3 estiver faltando ou não carregar, um efeito sintetizado de emergência tocará no lugar, inclusive se apenas o `index.html` for atualizado.
- Você pode substituir cada MP3 por sons de meme que tenha direito de usar. Mantenha os nomes/arquivos da lista no `index.html`.
- O servidor, regras animadas, instruções na pista, quinta fase mais lenta e sistema de colisão NÃO foram alterados.
- Atenção ao atualizar GitHub: SUBSTITUA o `public/index.html` inteiro. Não faça merge manual com o arquivo que tem marcadores `<<<<<<< HEAD`. Publique `public/sounds/*.mp3` junto para ouvir as vozes; sem eles, só os sons sintetizados.


## v16.4 — cinco memes enviados pelo usuário

- Os seis efeitos gerados anteriormente foram substituídos pelos **cinco arquivos MP3 enviados na conversa**, preservando o áudio recebido (sem modificar a gravação).
- Ordem dos arquivos: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-e-lutador.mp3`, `som-do-zap-zap-estourado.mp3`, `long-brain-fart.mp3`, `fahhhhhhhhhhhhhh.mp3` e `era-essa-peca.mp3`.
- A cada poder realmente ativado em outro jogador, o servidor transmite `game:power` e o cliente sorteia um dos cinco efeitos; todos na sala escolhem o mesmo pelo identificador do ataque.
- Som ativado sem botão; o áudio é preparado no primeiro toque/clique. Navegadores podem bloquear sons antes da primeira interação. Os cinco MP3 são pré-carregados do próprio servidor.
- Um efeito anterior é interrompido se começar outro ataque; um compressor controla picos. O áudio pode parecer alto por natureza, então cuidado com o volume do aparelho e fones de ouvido.
- **Publicação:** substitua `public/index.html` e envie os **cinco** MP3 para `public/sounds/`; se estiver vindo da versão 16.2, mantenha `server.js` atual com as constantes já ajustadas. A versão completa inclui também `server.js`, `collision.js`, `package.json` e `render.yaml`.
- Se um MP3 ainda não tiver carregado, o jogo usa um efeito sintetizado em vez de interromper o multiplayer.
- **Sem ZIP:** no GitHub v16.2, cole `PolyDrop_v16_4_PATCH_PARA_GITHUB.txt` antes do último `</script>` em `public/index.html`; coloque os cinco MP3 originais em `public/sounds/` sem renomear. Não cole o patch se usar o index completo v16.4.
