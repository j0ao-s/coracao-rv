/* Conteúdo pt-BR do "Coração por Dentro".
 * REVISÃO OBRIGATÓRIA: todos os textos devem ser revisados por professor(a) ou monitor(a)
 * de anatomia antes do teste com alunos.
 */
window.CONTENT = (function () {
  // layer: paredes | cavidades | valvas | vasos | coronarias | contexto
  const GROUPS = [
    { id: 'atrio_direito', nome: 'Átrio direito', cor: '#c46a62', layer: 'paredes',
      texto: 'Recebe o sangue pobre em oxigênio que volta do corpo pelas veias cavas e pelo seio coronário.' },
    { id: 'atrio_esquerdo', nome: 'Átrio esquerdo', cor: '#c46a62', layer: 'paredes',
      texto: 'Recebe o sangue rico em oxigênio que chega dos pulmões pelas veias pulmonares.' },
    { id: 'ventriculos', nome: 'Ventrículos (parede)', cor: '#b0524b', layer: 'paredes',
      texto: 'Câmaras de bombeamento. A parede do ventrículo esquerdo é mais espessa porque impulsiona o sangue para todo o corpo.' },

    { id: 'cav_atrio_dir', nome: 'Cavidade do átrio direito', cor: '#4a78b5', opacidade: 0.35, layer: 'cavidades',
      texto: 'Espaço ocupado pelo sangue venoso no lado direito do coração.' },
    { id: 'cav_vent_dir', nome: 'Cavidade do ventrículo direito', cor: '#4a78b5', opacidade: 0.35, layer: 'cavidades',
      texto: 'Espaço ocupado pelo sangue venoso no lado direito do coração.' },
    { id: 'cav_atrio_esq', nome: 'Cavidade do átrio esquerdo', cor: '#c8443a', opacidade: 0.35, layer: 'cavidades',
      texto: 'Espaço ocupado pelo sangue arterial no lado esquerdo do coração.' },
    { id: 'cav_vent_esq', nome: 'Cavidade do ventrículo esquerdo', cor: '#c8443a', opacidade: 0.35, layer: 'cavidades',
      texto: 'Espaço ocupado pelo sangue arterial no lado esquerdo do coração.' },

    { id: 'valva_tricuspide', nome: 'Valva tricúspide', cor: '#ecdcae', layer: 'valvas',
      texto: 'Três válvulas entre o átrio e o ventrículo direitos. Impede o refluxo para o átrio quando o ventrículo contrai.' },
    { id: 'valva_pulmonar', nome: 'Valva pulmonar', cor: '#ecdcae', layer: 'valvas',
      texto: 'Três válvulas semilunares na saída do ventrículo direito para o tronco pulmonar.' },
    { id: 'valva_mitral', nome: 'Valva mitral (bicúspide)', cor: '#ecdcae', layer: 'valvas',
      texto: 'Duas válvulas entre o átrio e o ventrículo esquerdos.' },
    { id: 'valva_aortica', nome: 'Valva aórtica', cor: '#ecdcae', layer: 'valvas',
      texto: 'Três válvulas semilunares na saída do ventrículo esquerdo para a aorta.' },

    { id: 'veia_cava_superior', nome: 'Veia cava superior', cor: '#3f6fae', layer: 'vasos',
      texto: 'Traz ao átrio direito o sangue da cabeça, do pescoço e dos membros superiores.' },
    { id: 'veia_cava_inferior', nome: 'Veia cava inferior', cor: '#3f6fae', layer: 'vasos',
      texto: 'Traz ao átrio direito o sangue do abdome e dos membros inferiores.' },
    { id: 'tronco_pulmonar', nome: 'Tronco pulmonar', cor: '#3f6fae', layer: 'vasos',
      texto: 'Sai do ventrículo direito e se divide nas artérias pulmonares.' },
    { id: 'arterias_pulmonares', nome: 'Artérias pulmonares', cor: '#3f6fae', layer: 'vasos',
      texto: 'Levam sangue pobre em oxigênio aos pulmões. São artérias porque saem do coração, não por causa do oxigênio.' },
    { id: 'veias_pulmonares', nome: 'Veias pulmonares', cor: '#c8443a', layer: 'vasos',
      texto: 'Trazem sangue rico em oxigênio dos pulmões ao átrio esquerdo.' },
    { id: 'aorta_ascendente', nome: 'Aorta ascendente', cor: '#c8443a', layer: 'vasos',
      texto: 'Primeiro trecho da aorta. Dela saem as artérias coronárias.' },
    { id: 'arco_aorta', nome: 'Arco da aorta', cor: '#c8443a', layer: 'vasos',
      texto: 'Curva da aorta de onde saem os vasos para a cabeça e os membros superiores.' },
    { id: 'aorta_descendente', nome: 'Aorta descendente torácica', cor: '#c8443a', layer: 'vasos',
      texto: 'Leva o sangue para o tronco e os membros inferiores.' },

    { id: 'coronaria_direita', nome: 'Artéria coronária direita e ramos', cor: '#e0603f', layer: 'coronarias',
      texto: 'Irriga principalmente o átrio e o ventrículo direitos e, na maioria das pessoas, a parede inferior do coração.' },
    { id: 'coronaria_esquerda', nome: 'Artéria coronária esquerda e ramos', cor: '#e0603f', layer: 'coronarias',
      texto: 'Divide-se nos ramos interventricular anterior e circunflexo e irriga grande parte do ventrículo esquerdo.' },
    { id: 'seio_coronario', nome: 'Seio coronário', cor: '#3f6fae', layer: 'coronarias',
      texto: 'Coleta o sangue venoso do próprio músculo cardíaco e o devolve ao átrio direito.' },

    { id: 'traqueia_bronquios', nome: 'Traqueia e árvore brônquica', cor: '#d9b8bd', layer: 'contexto',
      texto: 'Conduzem o ar aos pulmões. O tecido do pulmão (parênquima) não existe neste modelo.' },
    { id: 'caixa_toracica', nome: 'Caixa torácica', cor: '#e6dcc0', opacidade: 0.35, layer: 'contexto',
      texto: 'Costelas, cartilagens costais, esterno e vértebras torácicas que protegem o coração.' },
    { id: 'diafragma', nome: 'Diafragma', cor: '#a8695a', opacidade: 0.5, layer: 'contexto',
      texto: 'Músculo que separa o tórax do abdome. O coração repousa sobre ele.' },
  ];

  const LAYERS = [
    { id: 'vasos', nome: 'Vasos', inicial: true },
    { id: 'coronarias', nome: 'Coronárias', inicial: true },
    { id: 'valvas', nome: 'Valvas', inicial: true },
    { id: 'contexto', nome: 'Contexto do tórax', inicial: false },
  ];

  // Pontos da curva do trajeto (ids de grupo => centro do grupo; arrays => ponto fixo em coordenadas do modelo, metros).
  const PATH_POINTS = [
    'veia_cava_superior',   // 0
    'cav_atrio_dir',        // 1
    'valva_tricuspide',     // 2
    'cav_vent_dir',         // 3
    'valva_pulmonar',       // 4
    'tronco_pulmonar',      // 5
    'arterias_pulmonares',  // 6
    [-0.09, 0.03, -0.03],   // 7 pulmão direito (fora do modelo)
    'veias_pulmonares',     // 8
    'cav_atrio_esq',        // 9
    'valva_mitral',         // 10
    'cav_vent_esq',         // 11
    'valva_aortica',        // 12
    'aorta_ascendente',     // 13
    'arco_aorta',           // 14
    'aorta_descendente',    // 15
  ];

  // seg: [índice inicial, índice final] em PATH_POINTS. A esfera é azul até o passo 7 e vermelha a partir do 8.
  const PATH_STEPS = [
    { titulo: 'Veias cavas', grupos: ['veia_cava_superior', 'veia_cava_inferior'], seg: [0, 0],
      texto: 'O sangue pobre em oxigênio volta do corpo pelas veias cavas superior e inferior.' },
    { titulo: 'Átrio direito', grupos: ['cav_atrio_dir', 'atrio_direito'], seg: [0, 1],
      texto: 'Ele chega ao átrio direito, que também recebe o sangue do próprio coração pelo seio coronário.' },
    { titulo: 'Valva tricúspide', grupos: ['valva_tricuspide'], seg: [1, 2],
      texto: 'Passa pela valva tricúspide, que se abre para o ventrículo e se fecha quando ele contrai, impedindo o refluxo.' },
    { titulo: 'Ventrículo direito', grupos: ['cav_vent_dir'], seg: [2, 3],
      texto: 'Entra no ventrículo direito, que bombeia o sangue em direção aos pulmões.' },
    { titulo: 'Valva pulmonar', grupos: ['valva_pulmonar'], seg: [3, 4],
      texto: 'Atravessa a valva pulmonar, na saída do ventrículo direito.' },
    { titulo: 'Tronco e artérias pulmonares', grupos: ['tronco_pulmonar', 'arterias_pulmonares'], seg: [4, 6],
      texto: 'Segue pelo tronco pulmonar, que se divide nas artérias pulmonares direita e esquerda.' },
    { titulo: 'Pulmões: troca gasosa', grupos: ['traqueia_bronquios', 'arterias_pulmonares'], seg: [6, 7], mostrar: ['traqueia_bronquios'],
      texto: 'Nos pulmões acontece a troca gasosa: o sangue libera gás carbônico e recebe oxigênio. Atenção: o pulmão não está neste modelo; a árvore brônquica serve de referência.' },
    { titulo: 'Veias pulmonares', grupos: ['veias_pulmonares'], seg: [7, 8],
      texto: 'Agora rico em oxigênio, o sangue volta ao coração pelas veias pulmonares.' },
    { titulo: 'Átrio esquerdo', grupos: ['cav_atrio_esq', 'atrio_esquerdo'], seg: [8, 9],
      texto: 'Chega ao átrio esquerdo.' },
    { titulo: 'Valva mitral', grupos: ['valva_mitral'], seg: [9, 10],
      texto: 'Passa pela valva mitral, também chamada bicúspide.' },
    { titulo: 'Ventrículo esquerdo', grupos: ['cav_vent_esq'], seg: [10, 11],
      texto: 'Entra no ventrículo esquerdo, a câmara de parede mais espessa, que bombeia o sangue para todo o corpo.' },
    { titulo: 'Valva aórtica', grupos: ['valva_aortica'], seg: [11, 12],
      texto: 'Sai pela valva aórtica.' },
    { titulo: 'Aorta', grupos: ['aorta_ascendente', 'arco_aorta', 'aorta_descendente'], seg: [12, 15],
      texto: 'Percorre a aorta ascendente, o arco da aorta e a aorta descendente, levando oxigênio a todo o corpo.' },
  ];
  const PATH_RED_FROM = 7; // índice (0-based) do passo 8

  const QUIZ = [
    { alvo: 'valva_mitral', pergunta: 'Encontre a valva mitral' },
    { alvo: 'atrio_direito', pergunta: 'Encontre o átrio direito' },
    { alvo: 'tronco_pulmonar', pergunta: 'Encontre o tronco pulmonar' },
    { alvo: 'arco_aorta', pergunta: 'Encontre o arco da aorta' },
    { alvo: 'valva_tricuspide', pergunta: 'Encontre a valva tricúspide' },
    { alvo: 'coronaria_esquerda', pergunta: 'Encontre a artéria coronária esquerda' },
  ];

  // Modo "Entrar no coração". olhar: grupo que fica à frente do usuário; pois: pontos descritos em voz.
  const ENTER = {
    atrio_direito: {
      nome: 'átrio direito', cavidade: 'cav_atrio_dir', olhar: 'valva_tricuspide',
      pois: [{ id: 'valva_tricuspide', nome: 'a valva tricúspide' }, { id: 'veia_cava_superior', nome: 'a abertura da veia cava superior' }],
      realce: ['valva_tricuspide'],
    },
    ventriculo_esquerdo: {
      nome: 'ventrículo esquerdo', cavidade: 'cav_vent_esq', olhar: 'valva_mitral',
      pois: [{ id: 'valva_mitral', nome: 'a valva mitral' }, { id: 'valva_aortica', nome: 'a valva aórtica, saída para a aorta' }],
      realce: ['valva_mitral', 'valva_aortica'],
    },
  };

  return { GROUPS, LAYERS, PATH_POINTS, PATH_STEPS, PATH_RED_FROM, QUIZ, ENTER };
})();
