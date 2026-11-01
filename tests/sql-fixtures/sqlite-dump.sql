BEGIN TRANSACTION;
CREATE TABLE customers (
  id          integer PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     char(2),
  created_at  timestamp NOT NULL,
  notes       text
);
INSERT INTO "customers" VALUES(1,'ana.secret@example.com','Ana García','ES','2024-01-15 09:30:00','CONFIDENTIAL_NOTE_123');
INSERT INTO "customers" VALUES(2,'bob@example.com','Bob O''Brien','IE','2024-02-01 18:45:10','Line one
line two; with semicolon -- not a comment');
INSERT INTO "customers" VALUES(3,'zoe@example.com','Zoë 😀','FR','2024-03-10 00:00:00',NULL);
INSERT INTO "customers" VALUES(4,'dan@example.com','Dan "The Man" Smith','US','2024-03-11 12:00:00','back\slash path C:\temp');
INSERT INTO "customers" VALUES(5,'eve@example.com','Eve','DE','2024-04-01 08:00:00','');
INSERT INTO "customers" VALUES(6,'confidential_segment_x@example.com','CONFIDENTIAL_CUSTOMER_74291','GB','2024-04-02 08:00:00','CONFIDENTIAL_SEGMENT_X');
CREATE TABLE order_items (
  order_id   integer NOT NULL REFERENCES orders(id),
  line_no    integer NOT NULL,
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (order_id, line_no)
);
INSERT INTO "order_items" VALUES(1,1,1,2);
INSERT INTO "order_items" VALUES(1,2,2,1);
INSERT INTO "order_items" VALUES(2,1,2,1);
INSERT INTO "order_items" VALUES(3,1,4,1);
INSERT INTO "order_items" VALUES(5,1,1,1);
CREATE TABLE orders (
  id          integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  ordered_at  timestamp NOT NULL,
  status      varchar(20) NOT NULL DEFAULT 'paid',
  total       decimal(10,2) NOT NULL
);
INSERT INTO "orders" VALUES(1,1,'2024-05-01 10:00:00','paid',25);
INSERT INTO "orders" VALUES(2,1,'2024-05-03 11:30:00','shipped',8);
INSERT INTO "orders" VALUES(3,2,'2024-05-04 09:15:00','paid',99.99);
INSERT INTO "orders" VALUES(4,3,'2024-05-05 16:20:00','cancelled',0);
INSERT INTO "orders" VALUES(5,6,'2024-05-06 13:00:00','paid',12.5);
CREATE TABLE product_tags (
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id     integer NOT NULL REFERENCES tags(id),
  PRIMARY KEY (product_id, tag_id)
);
INSERT INTO "product_tags" VALUES(1,1);
INSERT INTO "product_tags" VALUES(1,2);
INSERT INTO "product_tags" VALUES(2,1);
INSERT INTO "product_tags" VALUES(4,3);
CREATE TABLE products (
  id     integer PRIMARY KEY,
  sku    varchar(20) NOT NULL UNIQUE,
  title  text NOT NULL,
  price  decimal(10,2)
);
INSERT INTO "products" VALUES(1,'SKU-001','Café',12.5);
INSERT INTO "products" VALUES(2,'SKU-002','Thé',8);
INSERT INTO "products" VALUES(3,'SKU-003','Chocolat',NULL);
INSERT INTO "products" VALUES(4,'SKU-004','"Quoted" title',99.99);
CREATE TABLE shipments (
  id         integer PRIMARY KEY,
  order_id   integer NOT NULL,
  line_no    integer NOT NULL,
  carrier    text,
  shipped_at date,
  FOREIGN KEY (order_id, line_no) REFERENCES order_items (order_id, line_no)
);
INSERT INTO "shipments" VALUES(1,1,1,'DHL','2024-05-02');
INSERT INTO "shipments" VALUES(2,2,1,NULL,'2024-05-04');
INSERT INTO "shipments" VALUES(3,3,1,'UPS',NULL);
CREATE TABLE tags (id integer PRIMARY KEY, label text NOT NULL);
INSERT INTO "tags" VALUES(1,'organic');
INSERT INTO "tags" VALUES(2,'fair-trade');
INSERT INTO "tags" VALUES(3,'gift');
CREATE TABLE "weird name" (id integer PRIMARY KEY, "select" text, "from" text);
INSERT INTO "weird name" VALUES(1,'a;b','--x');
INSERT INTO "weird name" VALUES(2,NULL,'/* not a comment */');
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE VIEW v_order_totals AS
  SELECT customer_id, count(*) AS n, sum(total) AS total FROM orders GROUP BY customer_id;
COMMIT;
