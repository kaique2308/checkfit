# CheckFit

App de registro de treinos offline-first em React Native + Expo.

## Problema

Quem treina por conta própria perde o controle da evolução de carga, da frequência semanal e da execução dos exercícios. Além disso, muitas academias ficam em subsolos ou têm sinal ruim, então apps que dependem de internet falham na hora do treino.

## Solução

- Registro de treinos e exercícios (séries, repetições, carga) direto no aparelho com **Expo SQLite**, funcionando sem internet.
- Histórico de carga por exercício ("últimas vezes que você fez") para o usuário saber quanto subir.
- Indicadores da semana (treinos, minutos, volume em kg) e progresso da meta semanal definida no Perfil.
- Sincronização com **Supabase (PostgreSQL)** quando houver conexão, com status "Só no aparelho" / "Na nuvem" em cada treino.
- **Visão Computacional (2º bimestre):** Pose Estimation pela câmera conta as repetições e dá uma nota de postura com dicas de correção. O resultado (`cv_reps`, `cv_score`, `cv_feedback`) é salvo no SQLite, sincronizado com o Supabase e usado no app (card do exercício, histórico de carga e postura média da semana).

## Stack

- Expo SDK 58, React Native 0.88
- expo-sqlite (banco local)
- @supabase/supabase-js (banco online)
- React Navigation (abas + pilha)
- NetInfo (detecção de conexão)
- MediaPipe Pose Landmarker (Google) em `react-native-webview` + `expo-camera` (permissão), funcionando no Expo Go

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um projeto em https://supabase.com, abra **SQL Editor** e rode o arquivo `supabase/schema.sql`.
3. Copie `.env.example` para `.env` e preencha com a URL e a chave pública do projeto: **publishable** (`sb_publishable_...`) ou **anon** (Connect > Framework, ou Project Settings > API Keys). Nunca use a chave `secret` ou `service_role`.
4. Inicie:
   ```bash
   npx expo start        # mesma rede Wi-Fi (ou roteador do celular)
   npx expo start --tunnel   # alternativa: pela internet (exige `npx expo login`)
   ```
   No Windows, se o PowerShell bloquear scripts, use `npx.cmd` no lugar de `npx`.
5. Abra no celular pelo **Expo Go** lendo o QR Code. Depois de mexer no `.env`, reinicie com `npx expo start -c`. No iPhone, permita **Câmera** e **Rede Local** para o Expo Go.

## Estrutura

```
App.js                      navegação (abas + pilha)
src/db/database.js          SQLite: criação das tabelas e CRUD
src/lib/supabase.js         cliente Supabase
src/services/sync.js        sincronização push/pull (last-write-wins)
src/screens/                Home, Novo treino, Detalhe, Análise de postura, Sincronizar, Perfil
src/vision/pose.js          Visão Computacional: modelo de pose, contagem de repetições e nota
src/components/ui.js        componentes visuais
supabase/schema.sql         tabelas, índices, RLS e views (v_resumo_treinos, v_analises_postura)
```

## Como a sincronização funciona

1. Toda gravação vai primeiro para o SQLite com `synced = 0`.
2. **Push:** registros com `synced = 0` são enviados ao Supabase via `upsert` e marcados `synced = 1`.
3. **Pull:** o app baixa os registros do aparelho (`device_id`) e grava localmente o que for novo ou mais recente.
4. Exclusões são lógicas (`deleted = 1`) para que o Supabase também receba a remoção.

## Roteiro da apresentação do 1º bimestre (10 min)

1. **Problema (1 min):** controle de carga e academia sem sinal.
2. **Modo avião (2 min):** ative o modo avião e crie um treino com 2 exercícios. Mostre o selo "Só no aparelho".
3. **SQLite (2 min):** aba Sincronizar > Inspecionar > SQLite > `workouts` e `exercises`. Os registros aparecem com `synced: 0`.
4. **Supabase (3 min):** desligue o modo avião e toque em **Sincronizar agora**. Mostre o selo mudar para "Na nuvem", o chip "Supabase (nuvem)" no app e o Table Editor do Supabase no notebook (ou a view `v_resumo_treinos`).
5. **Prova da persistência online (1 min):** toque em **Restaurar dados do Supabase**. O app apaga o SQLite e baixa tudo de volta.
6. **Próxima etapa (1 min):** card "Análise de postura pela câmera" e campos `cv_*` prontos para o 2º bimestre.

## Roteiro da apresentação do 2º bimestre (10 min, slides + tela do celular espelhada)

**Antes de começar:** espelhe o iPhone no notebook (AirPlay com LetsView ou ApowerMirror), abra o app e uma análise uma vez para baixar o modelo, deixe o Supabase aberto em `v_analises_postura` e apague os dados de teste.

1. **Slides: problema (1 min):** quem treina sozinho não tem ninguém corrigindo a execução nem contando as repetições, e muitas academias têm sinal ruim.
2. **Slides: solução e visão computacional (1 min):** Pose Estimation com MediaPipe (33 pontos do corpo), ângulo da articulação, contagem por máquina de estados e nota de postura.
3. **App funcionando (2 min):** crie um treino e um exercício "Agachamento" (SQLite, selo "Só no aparelho").
4. **Visão computacional ao vivo (3 min):** toque em **Analisar com câmera**, faça 3 agachamentos completos (contador e nota sobem) e 1 raso (não conta e gera dica). Toque em **Salvar análise**.
5. **Como o resultado é usado (1 min):** card "Postura X% · N repetições contadas" com a dica, "Postura média na semana" na tela inicial e postura no histórico do exercício.
6. **SQLite + Supabase (2 min):** Sincronizar > Inspecionar > SQLite > `exercises` (campos `cv_*` com `synced: 0`). Toque em **Sincronizar agora** e mostre `v_analises_postura` no Supabase.

## Visão Computacional (2º bimestre): Pose Estimation

**Como funciona**

1. No treino, cada exercício tem o botão **Analisar com câmera**.
2. A tela de análise abre a câmera e roda o **MediaPipe Pose Landmarker**, que detecta 33 pontos do corpo em tempo real e desenha o esqueleto na tela.
3. O app calcula o ângulo da articulação principal: **joelho** no agachamento, **cotovelo** na flexão e na rosca.
4. **Contagem:** uma repetição conta quando o ângulo sai da posição inicial, passa pela posição profunda e volta. Movimento curto não conta.
5. **Nota de postura (0 a 100%) por repetição:**
   - Agachamento: profundidade + tronco ereto.
   - Flexão: descer o peito + quadril alinhado.
   - Rosca: contração + extensão completas + cotovelo parado.
6. **Feedback:** as falhas mais frequentes viram dicas, por exemplo "Mantenha o tronco mais ereto".

**Como o resultado é usado**

- Fica salvo no exercício (`cv_reps`, `cv_score`, `cv_feedback`): **SQLite** primeiro, depois o **Supabase** pela sincronização normal.
- Aparece no card do exercício, no histórico ("Últimas vezes que você fez") e na tela inicial ("Postura média na semana").
- No Supabase, a view `v_analises_postura` lista todas as análises.

**Por que WebView?** O MediaPipe roda dentro de uma WebView (`react-native-webview`), que já faz parte do Expo Go. Assim o app funciona no iPhone e no Android **sem development build**. O modelo (`pose_landmarker_lite`) é baixado da internet na primeira análise. As imagens da câmera não são gravadas nem enviadas, só o resultado.

**Dica para a câmera:** apoie o celular de lado para a pessoa, a uns 2 m, com o corpo inteiro aparecendo e boa iluminação.
