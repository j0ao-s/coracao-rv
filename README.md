# Coração por Dentro

MVP de realidade virtual (WebXR) para o ensino de anatomia cardíaca. Disciplina *Realidade Virtual para Transformação Social*.
Roda no navegador do computador, do celular (com ou sem visor tipo Cardboard) e em headsets (Quest).

- **Explorar:** coração 3D real (BodyParts3D), 25 estruturas, rotação por arrasto, zoom (roda/pinça), escalas 1×, 8× e 20×.
- **Camadas:** paredes transparentes, vasos, coronárias, valvas e contexto do tórax.
- **Entrar no coração:** átrio direito e ventrículo esquerdo em escala 25×, sem locomoção (só girar a cabeça), com descrição espacial falada calculada a partir da geometria.
- **Trajeto do sangue:** 13 passos com esfera animada (azul até o passo 7, vermelha a partir do 8) e áudio.
- **Desafio:** 6 perguntas "Encontre…" em ordem aleatória; registra tempo, erros, dica e plataforma; exporta JSON + CSV.
- **Acessibilidade:** áudio pt-BR (Web Speech API), fonte ≥ 17–18 px, alto contraste, teclado, lista de estruturas, Libras (simulado), `prefers-reduced-motion`, aviso de conforto.

## Rodar localmente

Requer só Node.js (sem dependências para servir):

```bash
node tools/serve.mjs site 8080
```

Abra http://localhost:8080. Para testar no celular ou no Quest é preciso **HTTPS** (WebXR): publique no GitHub Pages ou use um túnel (`npx localtunnel --port 8080`).

## Estrutura

```
tools/extract.py     gera site/coracao.glb a partir do atlas human-atlas (BodyParts3D)
tools/serve.mjs      servidor estático mínimo
site/index.html      cena A-Frame 1.7.1 + interface HTML
site/app.js          lógica: modelo, picking com raycast próprio, cursor de olhar, painel VR (CanvasTexture),
                     laser do Quest, trajeto, modo "entrar", desafio, teclado e áudio
site/content.js      TEXTOS pt-BR, passos do trajeto, perguntas do desafio, configuração do modo "entrar"
site/style.css       estilos (desktop e celular)
site/coracao.glb     modelo (≈4,8 MB, 25 grupos nomeados)
site/coracao.json    centro, triângulos e partes de cada grupo (referência)
tests/smoke.mjs      teste automatizado com Playwright
```

**Para revisar textos:** edite só `site/content.js`. Todos os textos devem ser revisados por docente ou monitor(a) de anatomia antes do teste com alunos.

## Teste automatizado

```bash
npm install
```

```bash
PW_CHANNEL=msedge npm test
```

(`PW_CHANNEL=chrome` também funciona; sem a variável, use antes `npx playwright install chromium`.)
O teste abre a página, espera o modelo, confere os 25 nomes, o clique através das paredes transparentes, os 13 passos do
trajeto com a troca de cor 7→8, o modo "entrar", uma rodada completa do desafio com exportação, o layout de celular,
e falha se houver erro no console. Screenshots ficam em `tests/screenshots/` (desktop 1280×800 e celular 390×844).

## Publicar no GitHub Pages

1. Crie um repositório e envie este projeto.
2. O GitHub Pages só publica a raiz ou a pasta `/docs` de um branch. Opção simples: renomeie `site/` para `docs/`
   (e ajuste `tools/serve.mjs`/`tests/smoke.mjs`, que usam `site`) e, em *Settings → Pages*, escolha "Deploy from a branch", `main`, `/docs`.
   Alternativa: Vercel ou Netlify apontando para `site/` (sem build).
3. Acesse `https://<usuario>.github.io/<repo>/` no celular/Quest e toque em **Entrar em VR** (o botão só aparece quando o aparelho suporta WebXR).

## Como usar em cada plataforma

| Plataforma | Selecionar | Olhar ao redor |
|---|---|---|
| Computador | clique (sem arrastar) | arrastar gira o modelo; no modo "entrar", arrastar olha ao redor |
| Celular (tela) | toque | arrastar gira; pinça dá zoom; no modo "entrar", mover o celular |
| Celular + visor (Cardboard) | olhar fixo por 1,5 s (anel de progresso) | girar a cabeça |
| Quest | gatilho do controle (laser) | girar a cabeça |

Em VR aparece um painel 3D à esquerda com texto e botões (Paredes, Trajeto, Entrar AD/VE, Ouvir, Escala, Recentrar; no trajeto: Anterior/Próximo/Repetir/Sair).
O desafio deve ser **iniciado fora do VR** (para digitar o código do participante) e pode continuar dentro do VR.

Os resultados do desafio ficam salvos no aparelho (localStorage) e podem ser baixados todos de uma vez em
*Desafio → Baixar todos (CSV)*.

## Decisões técnicas

- **Raycast próprio** (`THREE.Raycaster`) em vez do `cursor` do A-Frame: ignora malhas invisíveis e esmaecidas (opacidade < 0,3), e
  estruturas translúcidas (cavidades, caixa torácica) só são escolhidas se nada opaco estiver na linha — por isso o clique atravessa as paredes transparentes até a valva.
- **Veia cava inferior recortada** em y < −7,5 cm: no atlas ela desce ~27 cm até o abdome.
- Os centros de cada grupo são calculados em tempo real a partir da geometria (equivalentes aos do `coracao.json`).
- `camera near = 0,05`: com 0,01 o chão aparecia por cima do coração (falha de profundidade observada).
- Painel VR desenhado em `<canvas>` com a fonte do sistema (o `a-text` não tem acentos).

## Limitações conhecidas (declarar na apresentação)

Modelo de homem adulto de referência; sem parênquima pulmonar; valvas estáticas; Libras simulado; uso educacional, não clínico.
Ainda não testado em hardware real (Quest e Cardboard) — ver checklist abaixo.

## Checklist antes de 04/12

- [ ] Publicar com HTTPS e testar no Android (Chrome, com e sem visor) e no Quest Browser.
- [ ] Conferir no headset o enquadramento do modo "entrar" (a valva tricúspide fica bem próxima; ajustar o recuo em `Enter.position` em `app.js`).
- [ ] Medir carregamento em 4G (GLB ≈ 4,8 MB). Se lento: `npx gltf-transform optimize site/coracao.glb site/coracao.glb --compress meshopt` e carregar o decoder meshopt.
- [ ] Revisão dos textos por docente de anatomia.

## Créditos e licenças

- Modelo anatômico: **BodyParts3D**, © The Database Center for Life Science, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Adaptado (recortado, agrupado e recolorido). https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- Conversão de dados: [human-atlas](https://github.com/ashemag/human-atlas) (MIT).
- [A-Frame](https://aframe.io) 1.7.1 (MIT).
- Código deste projeto: MIT.
