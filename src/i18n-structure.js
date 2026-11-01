/* DataBrief - translations for table structure: keys, indexes, definitions, generated columns. GPL-3.0-or-later.
 * Prompt order: tblPk, tblFk, tblUnique, tblIndexes, onDelete, onUpdate, tblDdl, cGenerated, genVirtual, genStored */
'use strict';
(function () {
  const KEYS = ['tblPk', 'tblFk', 'tblUnique', 'tblIndexes', 'onDelete', 'onUpdate', 'tblDdl', 'cGenerated', 'genVirtual', 'genStored'];
  const P = {
    en: ['Primary key', 'Foreign keys', 'Unique constraints and indexes', 'Other indexes', 'on delete', 'on update', 'Definition', 'Generated', 'virtual', 'stored'],
    fr: ['Clé primaire', 'Clés étrangères', 'Contraintes et index uniques', 'Autres index', 'à la suppression', 'à la mise à jour', 'Définition', 'Générée', 'virtuelle', 'stockée'],
    es: ['Clave primaria', 'Claves foráneas', 'Restricciones e índices únicos', 'Otros índices', 'al eliminar', 'al actualizar', 'Definición', 'Generada', 'virtual', 'almacenada'],
    de: ['Primärschlüssel', 'Fremdschlüssel', 'Eindeutige Einschränkungen und Indizes', 'Weitere Indizes', 'beim Löschen', 'beim Aktualisieren', 'Definition', 'Berechnet', 'virtuell', 'gespeichert'],
    it: ['Chiave primaria', 'Chiavi esterne', 'Vincoli e indici univoci', 'Altri indici', 'in eliminazione', 'in aggiornamento', 'Definizione', 'Generata', 'virtuale', 'memorizzata'],
    pt: ['Chave primária', 'Chaves estrangeiras', 'Restrições e índices únicos', 'Outros índices', 'ao excluir', 'ao atualizar', 'Definição', 'Gerada', 'virtual', 'armazenada'],
    nl: ['Primaire sleutel', 'Vreemde sleutels', 'Unieke beperkingen en indexen', 'Overige indexen', 'bij verwijderen', 'bij bijwerken', 'Definitie', 'Gegenereerd', 'virtueel', 'opgeslagen'],
    pl: ['Klucz główny', 'Klucze obce', 'Ograniczenia i indeksy unikalne', 'Pozostałe indeksy', 'przy usuwaniu', 'przy aktualizacji', 'Definicja', 'Generowana', 'wirtualna', 'przechowywana'],
    ru: ['Первичный ключ', 'Внешние ключи', 'Ограничения и уникальные индексы', 'Прочие индексы', 'при удалении', 'при обновлении', 'Определение', 'Вычисляемый', 'виртуальный', 'хранимый'],
    tr: ['Birincil anahtar', 'Yabancı anahtarlar', 'Benzersiz kısıtlamalar ve dizinler', 'Diğer dizinler', 'silinirken', 'güncellenirken', 'Tanım', 'Üretilmiş', 'sanal', 'saklanan'],
    zh: ['主键', '外键', '唯一约束和唯一索引', '其他索引', '删除时', '更新时', '定义', '生成列', '虚拟', '存储'],
    ja: ['主キー', '外部キー', '一意制約と一意インデックス', 'その他のインデックス', '削除時', '更新時', '定義', '生成列', '仮想', '保存型'],
    ko: ['기본 키', '외래 키', '고유 제약 조건 및 고유 인덱스', '기타 인덱스', '삭제 시', '업데이트 시', '정의', '생성 열', '가상', '저장됨'],
    hi: ['प्राथमिक कुंजी', 'विदेशी कुंजियाँ', 'अद्वितीय बाधाएँ और अनुक्रमणिकाएँ', 'अन्य अनुक्रमणिकाएँ', 'हटाने पर', 'अपडेट करने पर', 'परिभाषा', 'जनित', 'वर्चुअल', 'संग्रहीत'],
    ar: ['المفتاح الأساسي', 'المفاتيح الأجنبية', 'القيود والفهارس الفريدة', 'فهارس أخرى', 'عند الحذف', 'عند التحديث', 'التعريف', 'مُولَّد', 'افتراضي', 'مخزَّن'],
  };
  for (const [lang, vals] of Object.entries(P)) KEYS.forEach((k, i) => { window.DB_I18N.prompt[lang][k] = vals[i]; });
})();
