#!/usr/bin/env node
/* Writes mcp/home-i18n.json: the texts of the hosted server's home page (/) in the tool's 15 languages.
 *   node tools/build-home-i18n.cjs          write the file
 *   node tools/build-home-i18n.cjs --check  say whether the file is current (tests/test_mcp.cjs does it)
 * The words the page shares with the tool (tagline, purpose, privacy line, footer, licence, formats title, the labels of the language and theme buttons) are TAKEN from
 * src/i18n.js, so the home page and the tool always say the same thing; the texts that only the home page has (the buttons, the connector card, the steps, the links) are
 * written below, one block per language. A star marks bold words in the steps (*Settings*). {v} is the version. Nothing here is HTML: the page puts every text in with
 * textContent. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'mcp', 'home-i18n.json');
const SHARED = ['tagline', 'purpose', 'privacy', 'footer', 'license', 'accepted', 'uiLang', 'theme'];
const KEYS = ['openTool', 'useChat', 'moreFormats', 'cardLead', 'addrLabel', 'copy', 'copied', 'c1', 'c2', 'c3', 'c4', 'g1', 'g2', 'g3', 'linkGuide', 'linkPrivacy', 'linkSupport', 'linkSource', 'verifyTitle', 'verifyText'];

const OWN = {
  en: {
    openTool: 'Open the tool', useChat: 'Use it in Claude or ChatGPT', moreFormats: '+ many more',
    cardLead: 'This server is also a connector: it shows DataBrief inside the chat. It never receives your files, which are read in your browser. Add this address as a custom connector (no sign-in).',
    addrLabel: 'Connector address', copy: 'Copy', copied: 'Copied',
    c1: 'Open *Settings*, then *Connectors*.', c2: 'Choose *Add custom connector*.', c3: 'Paste the address and add it.', c4: 'Ask: *Open DataBrief*.',
    g1: 'Turn on *developer mode* in the settings.', g2: 'Add the address as a connector.', g3: 'Ask: *Open DataBrief*.',
    linkGuide: 'Step-by-step guide', linkPrivacy: 'Privacy', linkSupport: 'Support', linkSource: 'Source code on GitHub',
    verifyTitle: 'Check this page',
    verifyText: 'Version {v}. The tool at /app is the DataBrief page with the layer that lets it work inside a chat (it does nothing outside one). Its SHA-256:',
  },
  fr: {
    openTool: 'Ouvrir l\'outil', useChat: 'L\'utiliser dans Claude ou ChatGPT', moreFormats: '+ bien d\'autres',
    cardLead: 'Ce serveur est aussi un connecteur : il affiche DataBrief dans la conversation. Il ne reçoit jamais vos fichiers, qui sont lus dans votre navigateur. Ajoutez cette adresse comme connecteur personnalisé (sans connexion).',
    addrLabel: 'Adresse du connecteur', copy: 'Copier', copied: 'Copié',
    c1: 'Ouvrez *Paramètres*, puis *Connecteurs*.', c2: 'Choisissez *Ajouter un connecteur personnalisé*.', c3: 'Collez l\'adresse et ajoutez-la.', c4: 'Demandez : *Ouvre DataBrief*.',
    g1: 'Activez le *mode développeur* dans les paramètres.', g2: 'Ajoutez l\'adresse comme connecteur.', g3: 'Demandez : *Ouvre DataBrief*.',
    linkGuide: 'Guide pas à pas', linkPrivacy: 'Confidentialité', linkSupport: 'Assistance', linkSource: 'Code source sur GitHub',
    verifyTitle: 'Vérifier cette page',
    verifyText: 'Version {v}. L\'outil à l\'adresse /app est la page DataBrief avec la couche qui lui permet de fonctionner dans une conversation (elle ne fait rien en dehors). Son SHA-256 :',
  },
  es: {
    openTool: 'Abrir la herramienta', useChat: 'Úsala en Claude o ChatGPT', moreFormats: '+ muchos más',
    cardLead: 'Este servidor también es un conector: muestra DataBrief dentro del chat. Nunca recibe tus archivos, que se leen en tu navegador. Añade esta dirección como conector personalizado (sin iniciar sesión).',
    addrLabel: 'Dirección del conector', copy: 'Copiar', copied: 'Copiado',
    c1: 'Abre *Configuración* y luego *Conectores*.', c2: 'Elige *Añadir conector personalizado*.', c3: 'Pega la dirección y añádela.', c4: 'Pide: *Abre DataBrief*.',
    g1: 'Activa el *modo desarrollador* en la configuración.', g2: 'Añade la dirección como conector.', g3: 'Pide: *Abre DataBrief*.',
    linkGuide: 'Guía paso a paso', linkPrivacy: 'Privacidad', linkSupport: 'Soporte', linkSource: 'Código fuente en GitHub',
    verifyTitle: 'Comprobar esta página',
    verifyText: 'Versión {v}. La herramienta en /app es la página de DataBrief con la capa que le permite funcionar dentro de un chat (fuera de uno no hace nada). Su SHA-256:',
  },
  de: {
    openTool: 'Tool öffnen', useChat: 'In Claude oder ChatGPT nutzen', moreFormats: '+ viele weitere',
    cardLead: 'Dieser Server ist auch ein Connector: Er zeigt DataBrief im Chat an. Er erhält nie Ihre Dateien, sie werden in Ihrem Browser gelesen. Fügen Sie diese Adresse als benutzerdefinierten Connector hinzu (ohne Anmeldung).',
    addrLabel: 'Connector-Adresse', copy: 'Kopieren', copied: 'Kopiert',
    c1: 'Öffnen Sie *Einstellungen* und dann *Connectors*.', c2: 'Wählen Sie *Benutzerdefinierten Connector hinzufügen*.', c3: 'Fügen Sie die Adresse ein und bestätigen Sie.', c4: 'Fragen Sie: *Öffne DataBrief*.',
    g1: 'Aktivieren Sie in den Einstellungen den *Entwicklermodus*.', g2: 'Fügen Sie die Adresse als Connector hinzu.', g3: 'Fragen Sie: *Öffne DataBrief*.',
    linkGuide: 'Schritt-für-Schritt-Anleitung', linkPrivacy: 'Datenschutz', linkSupport: 'Support', linkSource: 'Quellcode auf GitHub',
    verifyTitle: 'Diese Seite prüfen',
    verifyText: 'Version {v}. Das Tool unter /app ist die DataBrief-Seite mit der Ebene, die sie im Chat funktionieren lässt (außerhalb eines Chats tut sie nichts). Ihr SHA-256:',
  },
  it: {
    openTool: 'Apri lo strumento', useChat: 'Usalo in Claude o ChatGPT', moreFormats: '+ molti altri',
    cardLead: 'Questo server è anche un connettore: mostra DataBrief nella chat. Non riceve mai i tuoi file, che vengono letti nel tuo browser. Aggiungi questo indirizzo come connettore personalizzato (senza accesso).',
    addrLabel: 'Indirizzo del connettore', copy: 'Copia', copied: 'Copiato',
    c1: 'Apri *Impostazioni*, poi *Connettori*.', c2: 'Scegli *Aggiungi connettore personalizzato*.', c3: 'Incolla l\'indirizzo e aggiungilo.', c4: 'Chiedi: *Apri DataBrief*.',
    g1: 'Attiva la *modalità sviluppatore* nelle impostazioni.', g2: 'Aggiungi l\'indirizzo come connettore.', g3: 'Chiedi: *Apri DataBrief*.',
    linkGuide: 'Guida passo passo', linkPrivacy: 'Privacy', linkSupport: 'Assistenza', linkSource: 'Codice sorgente su GitHub',
    verifyTitle: 'Verifica questa pagina',
    verifyText: 'Versione {v}. Lo strumento su /app è la pagina DataBrief con il livello che gli permette di funzionare in una chat (fuori da una chat non fa nulla). Il suo SHA-256:',
  },
  pt: {
    openTool: 'Abrir a ferramenta', useChat: 'Use no Claude ou no ChatGPT', moreFormats: '+ muitos outros',
    cardLead: 'Este servidor também é um conector: mostra o DataBrief dentro do chat. Ele nunca recebe seus arquivos, que são lidos no seu navegador. Adicione este endereço como conector personalizado (sem login).',
    addrLabel: 'Endereço do conector', copy: 'Copiar', copied: 'Copiado',
    c1: 'Abra *Configurações* e depois *Conectores*.', c2: 'Escolha *Adicionar conector personalizado*.', c3: 'Cole o endereço e adicione.', c4: 'Peça: *Abra o DataBrief*.',
    g1: 'Ative o *modo desenvolvedor* nas configurações.', g2: 'Adicione o endereço como conector.', g3: 'Peça: *Abra o DataBrief*.',
    linkGuide: 'Guia passo a passo', linkPrivacy: 'Privacidade', linkSupport: 'Suporte', linkSource: 'Código-fonte no GitHub',
    verifyTitle: 'Verificar esta página',
    verifyText: 'Versão {v}. A ferramenta em /app é a página do DataBrief com a camada que a faz funcionar dentro de um chat (fora de um chat ela não faz nada). Seu SHA-256:',
  },
  nl: {
    openTool: 'Open de tool', useChat: 'Gebruik het in Claude of ChatGPT', moreFormats: '+ nog veel meer',
    cardLead: 'Deze server is ook een connector: hij toont DataBrief in de chat. Hij ontvangt nooit je bestanden, die worden in je browser gelezen. Voeg dit adres toe als aangepaste connector (zonder inloggen).',
    addrLabel: 'Adres van de connector', copy: 'Kopiëren', copied: 'Gekopieerd',
    c1: 'Open *Instellingen* en dan *Connectors*.', c2: 'Kies *Aangepaste connector toevoegen*.', c3: 'Plak het adres en voeg het toe.', c4: 'Vraag: *Open DataBrief*.',
    g1: 'Zet de *ontwikkelaarsmodus* aan in de instellingen.', g2: 'Voeg het adres toe als connector.', g3: 'Vraag: *Open DataBrief*.',
    linkGuide: 'Stap-voor-stap-gids', linkPrivacy: 'Privacy', linkSupport: 'Ondersteuning', linkSource: 'Broncode op GitHub',
    verifyTitle: 'Controleer deze pagina',
    verifyText: 'Versie {v}. De tool op /app is de DataBrief-pagina met de laag waarmee hij in een chat werkt (buiten een chat doet die niets). De SHA-256:',
  },
  pl: {
    openTool: 'Otwórz narzędzie', useChat: 'Użyj w Claude lub ChatGPT', moreFormats: '+ wiele innych',
    cardLead: 'Ten serwer jest też konektorem: pokazuje DataBrief w czacie. Nigdy nie otrzymuje Twoich plików, które są odczytywane w Twojej przeglądarce. Dodaj ten adres jako niestandardowy konektor (bez logowania).',
    addrLabel: 'Adres konektora', copy: 'Kopiuj', copied: 'Skopiowano',
    c1: 'Otwórz *Ustawienia*, potem *Konektory*.', c2: 'Wybierz *Dodaj niestandardowy konektor*.', c3: 'Wklej adres i dodaj go.', c4: 'Poproś: *Otwórz DataBrief*.',
    g1: 'Włącz *tryb programisty* w ustawieniach.', g2: 'Dodaj adres jako konektor.', g3: 'Poproś: *Otwórz DataBrief*.',
    linkGuide: 'Instrukcja krok po kroku', linkPrivacy: 'Prywatność', linkSupport: 'Pomoc', linkSource: 'Kod źródłowy na GitHubie',
    verifyTitle: 'Sprawdź tę stronę',
    verifyText: 'Wersja {v}. Narzędzie pod adresem /app to strona DataBrief z warstwą, która pozwala jej działać w czacie (poza czatem nic nie robi). Jej SHA-256:',
  },
  ru: {
    openTool: 'Открыть инструмент', useChat: 'Использовать в Claude или ChatGPT', moreFormats: '+ и многие другие',
    cardLead: 'Этот сервер также является коннектором: он показывает DataBrief в чате. Он никогда не получает ваши файлы — они читаются в вашем браузере. Добавьте этот адрес как пользовательский коннектор (без входа).',
    addrLabel: 'Адрес коннектора', copy: 'Копировать', copied: 'Скопировано',
    c1: 'Откройте *Настройки*, затем *Коннекторы*.', c2: 'Выберите *Добавить пользовательский коннектор*.', c3: 'Вставьте адрес и добавьте его.', c4: 'Попросите: *Открой DataBrief*.',
    g1: 'Включите *режим разработчика* в настройках.', g2: 'Добавьте адрес как коннектор.', g3: 'Попросите: *Открой DataBrief*.',
    linkGuide: 'Пошаговое руководство', linkPrivacy: 'Конфиденциальность', linkSupport: 'Поддержка', linkSource: 'Исходный код на GitHub',
    verifyTitle: 'Проверить эту страницу',
    verifyText: 'Версия {v}. Инструмент по адресу /app — это страница DataBrief со слоем, позволяющим ей работать внутри чата (вне чата он ничего не делает). Её SHA-256:',
  },
  tr: {
    openTool: 'Aracı aç', useChat: 'Claude veya ChatGPT\'de kullan', moreFormats: '+ çok daha fazlası',
    cardLead: 'Bu sunucu aynı zamanda bir bağlayıcıdır: DataBrief\'i sohbetin içinde gösterir. Dosyalarınızı asla almaz; dosyalar tarayıcınızda okunur. Bu adresi özel bağlayıcı olarak ekleyin (oturum açmadan).',
    addrLabel: 'Bağlayıcı adresi', copy: 'Kopyala', copied: 'Kopyalandı',
    c1: '*Ayarlar*\'ı, sonra *Bağlayıcılar*\'ı açın.', c2: '*Özel bağlayıcı ekle*\'yi seçin.', c3: 'Adresi yapıştırıp ekleyin.', c4: 'Şunu isteyin: *DataBrief\'i aç*.',
    g1: 'Ayarlarda *geliştirici modunu* açın.', g2: 'Adresi bağlayıcı olarak ekleyin.', g3: 'Şunu isteyin: *DataBrief\'i aç*.',
    linkGuide: 'Adım adım kılavuz', linkPrivacy: 'Gizlilik', linkSupport: 'Destek', linkSource: 'GitHub\'da kaynak kodu',
    verifyTitle: 'Bu sayfayı doğrula',
    verifyText: 'Sürüm {v}. /app adresindeki araç, bir sohbetin içinde çalışmasını sağlayan katmanla birlikte DataBrief sayfasıdır (sohbetin dışında hiçbir şey yapmaz). SHA-256 değeri:',
  },
  zh: {
    openTool: '打开工具', useChat: '在 Claude 或 ChatGPT 中使用', moreFormats: '+ 更多格式',
    cardLead: '此服务器同时也是一个连接器：它在聊天中显示 DataBrief。它从不接收您的文件，文件只在您的浏览器中读取。将此地址添加为自定义连接器（无需登录）。',
    addrLabel: '连接器地址', copy: '复制', copied: '已复制',
    c1: '打开*设置*，然后打开*连接器*。', c2: '选择*添加自定义连接器*。', c3: '粘贴地址并添加。', c4: '请求：*打开 DataBrief*。',
    g1: '在设置中开启*开发者模式*。', g2: '将地址添加为连接器。', g3: '请求：*打开 DataBrief*。',
    linkGuide: '分步指南', linkPrivacy: '隐私', linkSupport: '支持', linkSource: 'GitHub 上的源代码',
    verifyTitle: '检查此页面',
    verifyText: '版本 {v}。/app 处的工具就是 DataBrief 页面，外加使其能在聊天中运行的一层（在聊天之外它什么也不做）。其 SHA-256：',
  },
  ja: {
    openTool: 'ツールを開く', useChat: 'ClaudeやChatGPTで使う', moreFormats: '+ ほか多数',
    cardLead: 'このサーバーはコネクターでもあり、チャット内にDataBriefを表示します。ファイルは受信せず、お使いのブラウザー内で読み取られます。このアドレスをカスタムコネクターとして追加してください（ログイン不要）。',
    addrLabel: 'コネクターのアドレス', copy: 'コピー', copied: 'コピーしました',
    c1: '*設定*、次に*コネクター*を開きます。', c2: '*カスタムコネクターを追加*を選びます。', c3: 'アドレスを貼り付けて追加します。', c4: '依頼する：*DataBriefを開いて*。',
    g1: '設定で*開発者モード*をオンにします。', g2: 'アドレスをコネクターとして追加します。', g3: '依頼する：*DataBriefを開いて*。',
    linkGuide: 'ステップバイステップガイド', linkPrivacy: 'プライバシー', linkSupport: 'サポート', linkSource: 'GitHubのソースコード',
    verifyTitle: 'このページを確認',
    verifyText: 'バージョン {v}。/app のツールは、チャット内で動作させるためのレイヤーを加えたDataBriefのページです（チャット外では何もしません）。SHA-256：',
  },
  ko: {
    openTool: '도구 열기', useChat: 'Claude 또는 ChatGPT에서 사용', moreFormats: '+ 그 외 다수',
    cardLead: '이 서버는 커넥터이기도 합니다. 채팅 안에 DataBrief를 표시합니다. 파일은 받지 않으며, 파일은 브라우저에서 읽힙니다. 이 주소를 사용자 지정 커넥터로 추가하세요(로그인 불필요).',
    addrLabel: '커넥터 주소', copy: '복사', copied: '복사됨',
    c1: '*설정*을 연 다음 *커넥터*를 엽니다.', c2: '*사용자 지정 커넥터 추가*를 선택합니다.', c3: '주소를 붙여넣고 추가합니다.', c4: '요청: *DataBrief 열어줘*.',
    g1: '설정에서 *개발자 모드*를 켭니다.', g2: '주소를 커넥터로 추가합니다.', g3: '요청: *DataBrief 열어줘*.',
    linkGuide: '단계별 안내', linkPrivacy: '개인정보', linkSupport: '지원', linkSource: 'GitHub 소스 코드',
    verifyTitle: '이 페이지 확인',
    verifyText: '버전 {v}. /app의 도구는 채팅 안에서 작동하게 하는 레이어가 추가된 DataBrief 페이지입니다(채팅 밖에서는 아무것도 하지 않습니다). SHA-256:',
  },
  hi: {
    openTool: 'टूल खोलें', useChat: 'Claude या ChatGPT में उपयोग करें', moreFormats: '+ और भी कई',
    cardLead: 'यह सर्वर एक कनेक्टर भी है: यह चैट के अंदर DataBrief दिखाता है। यह आपकी फ़ाइलें कभी प्राप्त नहीं करता; वे आपके ब्राउज़र में पढ़ी जाती हैं। इस पते को कस्टम कनेक्टर के रूप में जोड़ें (साइन-इन के बिना)।',
    addrLabel: 'कनेक्टर का पता', copy: 'कॉपी करें', copied: 'कॉपी हो गया',
    c1: '*सेटिंग्स* खोलें, फिर *कनेक्टर*।', c2: '*कस्टम कनेक्टर जोड़ें* चुनें।', c3: 'पता पेस्ट करें और जोड़ें।', c4: 'कहें: *DataBrief खोलो*।',
    g1: 'सेटिंग्स में *डेवलपर मोड* चालू करें।', g2: 'पते को कनेक्टर के रूप में जोड़ें।', g3: 'कहें: *DataBrief खोलो*।',
    linkGuide: 'चरण-दर-चरण गाइड', linkPrivacy: 'गोपनीयता', linkSupport: 'सहायता', linkSource: 'GitHub पर सोर्स कोड',
    verifyTitle: 'इस पेज की जाँच करें',
    verifyText: 'संस्करण {v}। /app पर मौजूद टूल वही DataBrief पेज है, जिसमें वह परत जुड़ी है जो उसे चैट के अंदर काम करने देती है (चैट के बाहर वह कुछ नहीं करती)। इसका SHA-256:',
  },
  ar: {
    openTool: 'افتح الأداة', useChat: 'استخدمها في Claude أو ChatGPT', moreFormats: '+ وغيرها الكثير',
    cardLead: 'هذا الخادم موصِّل أيضًا: يعرض DataBrief داخل المحادثة. لا يستلم ملفاتك أبدًا، فهي تُقرأ في متصفحك. أضف هذا العنوان كموصِّل مخصص (دون تسجيل دخول).',
    addrLabel: 'عنوان الموصِّل', copy: 'نسخ', copied: 'تم النسخ',
    c1: 'افتح *الإعدادات* ثم *الموصِّلات*.', c2: 'اختر *إضافة موصِّل مخصص*.', c3: 'الصق العنوان وأضِفه.', c4: 'اطلب: *افتح DataBrief*.',
    g1: 'فعّل *وضع المطوّر* في الإعدادات.', g2: 'أضف العنوان كموصِّل.', g3: 'اطلب: *افتح DataBrief*.',
    linkGuide: 'دليل خطوة بخطوة', linkPrivacy: 'الخصوصية', linkSupport: 'الدعم', linkSource: 'الشيفرة المصدرية على GitHub',
    verifyTitle: 'تحقق من هذه الصفحة',
    verifyText: 'الإصدار {v}. الأداة على /app هي صفحة DataBrief مع الطبقة التي تتيح لها العمل داخل المحادثة (ولا تفعل شيئًا خارجها). قيمة SHA-256 لها:',
  },
};

function build() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8'), sandbox);
  const tool = sandbox.window.DB_I18N;
  const langs = tool.langs.map((l) => (l.rtl ? { code: l.code, name: l.name, rtl: true } : { code: l.code, name: l.name }));
  const texts = {};
  for (const l of langs) {
    const own = OWN[l.code];
    if (!own) throw new Error('No home texts for ' + l.code);
    const t = {};
    for (const k of SHARED) {
      const v = (tool.ui[l.code] && tool.ui[l.code][k]) || tool.ui.en[k];
      if (typeof v !== 'string' || !v) throw new Error('The tool has no "' + k + '" for ' + l.code);
      t[k] = v;
    }
    for (const k of KEYS) {
      if (typeof own[k] !== 'string' || !own[k]) throw new Error('Missing home text ' + l.code + '.' + k);
      t[k] = own[k];
    }
    texts[l.code] = t;
  }
  return { '//': 'Written by tools/build-home-i18n.cjs: do not edit by hand. The words shared with the tool come from src/i18n.js.', langs, texts };
}
const text = () => JSON.stringify(build(), null, 1) + '\n';

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text()) { console.error('mcp/home-i18n.json is out of date: run node tools/build-home-i18n.cjs'); process.exit(1); }
    console.log('mcp/home-i18n.json is current');
  } else {
    fs.writeFileSync(OUT, text());
    console.log('Wrote ' + path.relative(process.cwd(), OUT) + ' (' + Object.keys(OWN).length + ' languages)');
  }
}
module.exports = { build, text, SHARED, KEYS, OWN };
