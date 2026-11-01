/* Writes the Access test databases of tests/access-fixtures/ with Jackcess (an independent open-source library that creates real
 * .mdb / .accdb files; it is NOT Microsoft Access). Run by tests/make_access_fixtures.sh in a Java container.
 * The values are made up. expected.json is written here from the same values: the oracle of tests/test_access.cjs. */
import com.healthmarketscience.jackcess.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;

public class MakeAccess {
  static final String[] NOTES = {"CONFIDENTIAL_NOTE_123", "Line one\r\nline two; with semicolon -- not a comment", null, "back\\slash path C:\\temp", "", "CONFIDENTIAL_SEGMENT_X"};

  public static void main(String[] a) throws Exception {
    File dir = new File(a[0]);
    shop(new File(dir, "shop.accdb"), Database.FileFormat.V2016);
    shop(new File(dir, "shop.mdb"), Database.FileFormat.V2000);
    canary(new File(dir, "CONFIDENTIAL_FILE_access.accdb"));
    emptyDb(new File(dir, "empty.accdb"));
  }

  static Table table(Database db, String name, Object... cols) throws Exception {
    TableBuilder tb = new TableBuilder(name);
    List<String> pk = new ArrayList<>();
    for (int i = 0; i < cols.length; i += 3) {
      ColumnBuilder cb = new ColumnBuilder((String) cols[i], (DataType) cols[i + 1]);
      String opt = (String) cols[i + 2];
      if (opt.contains("auto")) cb.setAutoNumber(true);
      if (opt.contains("len=")) cb.setLengthInUnits(Integer.parseInt(opt.replaceAll(".*len=(\\d+).*", "$1")));
      tb.addColumn(cb);
      if (opt.contains("pk")) pk.add((String) cols[i]);
    }
    if (!pk.isEmpty()) tb.addIndex(new IndexBuilder(IndexBuilder.PRIMARY_KEY_NAME).addColumns(pk.toArray(new String[0])).setPrimaryKey());
    return tb.toTable(db);
  }

  static void shop(File f, Database.FileFormat fmt) throws Exception {
    f.delete();
    try (Database db = new DatabaseBuilder(f).setFileFormat(fmt).create()) {
      db.setDateTimeType(DateTimeType.LOCAL_DATE_TIME);
      Table customers = table(db, "Customers", "Id", DataType.LONG, "auto pk", "Email", DataType.TEXT, "len=255", "Name", DataType.TEXT, "len=100", "Country", DataType.TEXT, "len=2",
          "CreatedAt", DataType.SHORT_DATE_TIME, "", "Notes", DataType.MEMO, "", "Active", DataType.BOOLEAN, "", "Balance", DataType.MONEY, "", "Score", DataType.DOUBLE, "");
      table(db, "Products", "Id", DataType.LONG, "pk", "Sku", DataType.TEXT, "len=20", "Unit Price", DataType.MONEY, "", "Stock", DataType.INT, "");
      table(db, "Tags", "Id", DataType.LONG, "pk", "Label", DataType.TEXT, "len=50");
      table(db, "ProductTags", "ProductId", DataType.LONG, "pk", "TagId", DataType.LONG, "pk");
      table(db, "Orders", "Id", DataType.LONG, "pk", "CustomerId", DataType.LONG, "", "OrderedAt", DataType.SHORT_DATE_TIME, "", "Status", DataType.TEXT, "len=20", "Total", DataType.MONEY, "");
      table(db, "OrderItems", "OrderId", DataType.LONG, "pk", "LineNo", DataType.LONG, "pk", "ProductId", DataType.LONG, "", "Quantity", DataType.LONG, "");
      table(db, "Shipments", "Id", DataType.LONG, "auto pk", "OrderId", DataType.LONG, "", "LineNo", DataType.LONG, "", "Carrier", DataType.TEXT, "len=50");
      String[] emails = {"ana.secret@example.com", "bob@example.com", "zoe@example.com", "dan@example.com", "eve@example.com", "confidential_segment_x@example.com"};
      String[] names = {"Ana García", "Bob O'Brien", "Zoë 😀", "Dan \"The Man\" Smith", "Eve", "CONFIDENTIAL_CUSTOMER_74291"};
      String[] ctry = {"ES", "IE", "FR", "US", "DE", "GB"};
      LocalDateTime[] at = {LocalDateTime.of(2024, 1, 15, 9, 30), LocalDateTime.of(2024, 2, 1, 18, 45), LocalDateTime.of(2024, 3, 10, 0, 0), LocalDateTime.of(2024, 3, 11, 12, 0),
          LocalDateTime.of(2024, 4, 1, 8, 0), LocalDateTime.of(2024, 4, 2, 8, 0)};
      for (int i = 0; i < 6; i++) customers.addRow(Column.AUTO_NUMBER, emails[i], names[i], ctry[i], at[i], NOTES[i], i % 2 == 0, new java.math.BigDecimal(i == 1 ? "-7.25" : (i * 100 + ".5")), i == 2 ? null : 1.5 * i);
      Table products = db.getTable("Products");
      products.addRow(1, "SKU-001", new java.math.BigDecimal("12.50"), (short) 40);
      products.addRow(2, "SKU-002", new java.math.BigDecimal("8"), (short) 0);
      products.addRow(3, "SKU-003", null, null);
      products.addRow(4, "SKU-004", new java.math.BigDecimal("99.99"), (short) -1);
      Table tags = db.getTable("Tags");
      tags.addRow(1, "organic"); tags.addRow(2, "fair-trade"); tags.addRow(3, "gift");
      Table pt = db.getTable("ProductTags");
      pt.addRow(1, 1); pt.addRow(1, 2); pt.addRow(2, 1); pt.addRow(4, 3);
      Table orders = db.getTable("Orders");
      orders.addRow(1, 1, LocalDateTime.of(2024, 5, 1, 10, 0), "paid", new java.math.BigDecimal("25"));
      orders.addRow(2, 1, LocalDateTime.of(2024, 5, 3, 11, 30), "shipped", new java.math.BigDecimal("8"));
      orders.addRow(3, 2, LocalDateTime.of(2024, 5, 4, 9, 15), "paid", new java.math.BigDecimal("99.99"));
      orders.addRow(4, 3, LocalDateTime.of(2024, 5, 5, 16, 20), "cancelled", new java.math.BigDecimal("0"));
      orders.addRow(5, 6, LocalDateTime.of(2024, 5, 6, 13, 0), "paid", new java.math.BigDecimal("12.5"));
      Table items = db.getTable("OrderItems");
      items.addRow(1, 1, 1, 2); items.addRow(1, 2, 2, 1); items.addRow(2, 1, 2, 1); items.addRow(3, 1, 4, 1); items.addRow(5, 1, 1, 1);
      Table ship = db.getTable("Shipments");
      ship.addRow(Column.AUTO_NUMBER, 1, 1, "DHL"); ship.addRow(Column.AUTO_NUMBER, 2, 1, null); ship.addRow(Column.AUTO_NUMBER, 3, 1, "UPS");
      // declared relationships: one cascading, one composite, a junction table with two parents
      new RelationshipBuilder("Customers", "Orders").addColumns("Id", "CustomerId").setReferentialIntegrity().toRelationship(db);
      new RelationshipBuilder("Orders", "OrderItems").addColumns("Id", "OrderId").setReferentialIntegrity().setCascadeDeletes().toRelationship(db);
      new RelationshipBuilder("Products", "OrderItems").addColumns("Id", "ProductId").setReferentialIntegrity().toRelationship(db);
      new RelationshipBuilder("Products", "ProductTags").addColumns("Id", "ProductId").setReferentialIntegrity().setCascadeDeletes().toRelationship(db);
      new RelationshipBuilder("Tags", "ProductTags").addColumns("Id", "TagId").setReferentialIntegrity().toRelationship(db);
      new RelationshipBuilder("OrderItems", "Shipments").addColumns("OrderId", "OrderId").addColumns("LineNo", "LineNo").setReferentialIntegrity().toRelationship(db);
    }
  }

  // Canary of the "Do not share data" tests: names (CONFIDENTIAL_COL...), records (CONFIDENTIAL_REC...), a memo (free text)
  static void canary(File f) throws Exception {
    f.delete();
    try (Database db = new DatabaseBuilder(f).setFileFormat(Database.FileFormat.V2016).create()) {
      table(db, "CONFIDENTIAL_COL_PARENT", "CONFIDENTIAL_COL_ID", DataType.LONG, "pk", "Label", DataType.TEXT, "len=50");
      Table t = table(db, "CONFIDENTIAL_COL_TABLE", "CONFIDENTIAL_COL_A", DataType.TEXT, "len=40", "CONFIDENTIAL_COL_B", DataType.LONG, "", "CONFIDENTIAL_COL_C", DataType.TEXT, "len=40",
          "CONFIDENTIAL_COL_PID", DataType.LONG, "", "CONFIDENTIAL_COL_MEMO", DataType.MEMO, "");
      db.getTable("CONFIDENTIAL_COL_PARENT").addRow(1, "CONFIDENTIAL_REC_PARENT");
      String[] cat = {"common", "common", "common", "common", "common", "common", "common", "common", "other", "other", "other", "CONFIDENTIAL_REC_RARE"};
      for (int i = 0; i < 12; i++) t.addRow(String.format("CONFIDENTIAL_REC_%02d", i + 1), 100 + i * 3, cat[i], 1, String.format("CONFIDENTIAL_REC_MEMO_%02d", i + 1));
      new RelationshipBuilder("CONFIDENTIAL_COL_PARENT", "CONFIDENTIAL_COL_TABLE").addColumns("CONFIDENTIAL_COL_ID", "CONFIDENTIAL_COL_PID").setReferentialIntegrity().toRelationship(db);
    }
  }

  static void emptyDb(File f) throws Exception {
    f.delete();
    try (Database db = new DatabaseBuilder(f).setFileFormat(Database.FileFormat.V2016).create()) {
      table(db, "Nothing", "A", DataType.TEXT, "len=10", "B", DataType.LONG, "");
    }
  }
}
