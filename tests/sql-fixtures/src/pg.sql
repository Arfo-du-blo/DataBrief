-- Source database for the PostgreSQL dumps ("shop"). Same data as the other engines, written in PostgreSQL syntax.
CREATE TYPE order_status AS ENUM ('paid', 'shipped', 'cancelled');

CREATE TABLE customers (
  id          integer PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     char(2),
  created_at  timestamptz NOT NULL,
  notes       text
);
COMMENT ON TABLE customers IS 'People who bought something; one row per person';
COMMENT ON COLUMN customers.notes IS 'Free text written by the sales team';

CREATE TABLE products (
  id     integer PRIMARY KEY,
  sku    varchar(20) NOT NULL UNIQUE,
  title  text NOT NULL,
  price  numeric(10,2),
  attrs  jsonb,
  labels text[]
);

CREATE TABLE tags (id integer PRIMARY KEY, label text NOT NULL);
CREATE TABLE product_tags (
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id     integer NOT NULL REFERENCES tags(id),
  PRIMARY KEY (product_id, tag_id)
);

CREATE TABLE orders (
  id          integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  ordered_at  timestamp NOT NULL,
  status      order_status NOT NULL DEFAULT 'paid',
  total       numeric(10,2) NOT NULL
);
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  order_id   integer NOT NULL REFERENCES orders(id),
  line_no    integer NOT NULL,
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE shipments (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL,
  line_no    integer NOT NULL,
  carrier    text,
  shipped_at date,
  FOREIGN KEY (order_id, line_no) REFERENCES order_items (order_id, line_no)
);

CREATE TABLE "weird name" (id integer PRIMARY KEY, "select" text, "from" text);

CREATE VIEW v_order_totals AS
  SELECT customer_id, count(*) AS n, sum(total) AS total FROM orders GROUP BY customer_id;

INSERT INTO customers VALUES
 (1, 'ana.secret@example.com', 'Ana García', 'ES', '2024-01-15 09:30:00+00', 'CONFIDENTIAL_NOTE_123'),
 (2, 'bob@example.com', 'Bob O''Brien', 'IE', '2024-02-01 18:45:10+00', E'Line one\nline two; with semicolon -- not a comment'),
 (3, 'zoe@example.com', 'Zoë 😀', 'FR', '2024-03-10 00:00:00+00', NULL),
 (4, 'dan@example.com', 'Dan "The Man" Smith', 'US', '2024-03-11 12:00:00+00', 'back\slash path C:\temp'),
 (5, 'eve@example.com', 'Eve', 'DE', '2024-04-01 08:00:00+00', ''),
 (6, 'confidential_segment_x@example.com', 'CONFIDENTIAL_CUSTOMER_74291', 'GB', '2024-04-02 08:00:00+00', 'CONFIDENTIAL_SEGMENT_X');
INSERT INTO products VALUES
 (1, 'SKU-001', 'Café', 12.50, '{"origin": "Colombia", "organic": true}', '{organic,coffee}'),
 (2, 'SKU-002', 'Thé', 8.00, NULL, '{}'),
 (3, 'SKU-003', 'Chocolat', NULL, '{"note": "it''s a \"quote\""}', NULL),
 (4, 'SKU-004', '"Quoted" title', 99.99, '[]', '{gift,"two words"}');
INSERT INTO tags VALUES (1, 'organic'), (2, 'fair-trade'), (3, 'gift');
INSERT INTO product_tags VALUES (1, 1), (1, 2), (2, 1), (4, 3);
INSERT INTO orders VALUES
 (1, 1, '2024-05-01 10:00:00', 'paid', 25.00),
 (2, 1, '2024-05-03 11:30:00', 'shipped', 8.00),
 (3, 2, '2024-05-04 09:15:00', 'paid', 99.99),
 (4, 3, '2024-05-05 16:20:00', 'cancelled', 0),
 (5, 6, '2024-05-06 13:00:00', 'paid', 12.50);
INSERT INTO order_items VALUES (1, 1, 1, 2), (1, 2, 2, 1), (2, 1, 2, 1), (3, 1, 4, 1), (5, 1, 1, 1);
INSERT INTO shipments (order_id, line_no, carrier, shipped_at) VALUES (1, 1, 'DHL', '2024-05-02'), (2, 1, NULL, '2024-05-04'), (3, 1, 'UPS', NULL);
INSERT INTO "weird name" VALUES (1, 'a;b', '--x'), (2, NULL, '/* not a comment */');
