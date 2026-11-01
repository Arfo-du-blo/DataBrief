/* DataBrief - translations for the titles of the result sections (summary, output), the hint under the format chips
 * and the link to the project page under the introduction. GPL-3.0-or-later. UI order: see KEYS. */
'use strict';
(function () {
  const KEYS = ['secSummary', 'secOutput', 'chipsHint', 'purposeMore'];
  const U = {
    en: ["Summary", "Output", "Click a format to see what DataBrief reads and the best file to give.", "Learn more on GitHub"],
    fr: ["Résumé", "Sortie", "Cliquez sur un format pour voir ce que DataBrief en lit et le meilleur fichier à fournir.", "En savoir plus sur GitHub"],
    es: ["Resumen", "Salida", "Haz clic en un formato para ver qué lee DataBrief y cuál es el mejor archivo que puedes dar.", "Más información en GitHub"],
    de: ["Zusammenfassung", "Ausgabe", "Klicken Sie auf ein Format, um zu sehen, was DataBrief liest und welche Datei am besten geeignet ist.", "Mehr auf GitHub erfahren"],
    it: ["Riepilogo", "Output", "Fai clic su un formato per vedere cosa legge DataBrief e qual è il file migliore da fornire.", "Scopri di più su GitHub"],
    pt: ["Resumo", "Saída", "Clique em um formato para ver o que o DataBrief lê e qual é o melhor arquivo a fornecer.", "Saiba mais no GitHub"],
    nl: ["Samenvatting", "Uitvoer", "Klik op een formaat om te zien wat DataBrief leest en welk bestand het best werkt.", "Meer weten op GitHub"],
    pl: ["Podsumowanie", "Wynik", "Kliknij format, aby zobaczyć, co odczytuje DataBrief i jaki plik najlepiej podać.", "Dowiedz się więcej na GitHubie"],
    ru: ["Сводка", "Результат", "Нажмите на формат, чтобы узнать, что читает DataBrief и какой файл лучше всего передать.", "Подробнее на GitHub"],
    tr: ["Özet", "Çıktı", "DataBrief'in neyi okuduğunu ve hangi dosyanın en iyisi olduğunu görmek için bir biçime tıklayın.", "GitHub'da daha fazla bilgi"],
    zh: ["摘要", "输出", "点击某个格式，了解 DataBrief 会读取什么，以及最适合提供的文件。", "在 GitHub 上了解更多"],
    ja: ["概要", "出力", "形式をクリックすると、DataBrief が何を読み取るか、どんなファイルが最適かが分かります。", "GitHub で詳しく見る"],
    ko: ["요약", "출력", "형식을 클릭하면 DataBrief가 무엇을 읽는지, 어떤 파일이 가장 좋은지 볼 수 있습니다.", "GitHub에서 더 알아보기"],
    hi: ["सारांश", "आउटपुट", "किसी फ़ॉर्मैट पर क्लिक करें और देखें कि DataBrief क्या पढ़ता है और कौन-सी फ़ाइल देना सबसे अच्छा है।", "GitHub पर और जानें"],
    ar: ["ملخّص", "المخرجات", "انقر على صيغة لمعرفة ما يقرؤه DataBrief وأفضل ملف يمكن تقديمه.", "اعرف المزيد على GitHub"],
  };
  for (const [lang, vals] of Object.entries(U)) KEYS.forEach((k, i) => { window.DB_I18N.ui[lang][k] = vals[i]; });
})();
