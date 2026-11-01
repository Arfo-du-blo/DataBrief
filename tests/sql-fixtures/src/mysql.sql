-- Source database for the MySQL and MariaDB dumps ("shop"). Same data as the other engines, written in MySQL syntax.
CREATE TABLE customers (
  id          int unsigned NOT NULL AUTO_INCREMENT,
  email       varchar(255) NOT NULL,
  name        varchar(255) NOT NULL,
  country     char(2) DEFAULT NULL,
  created_at  datetime NOT NULL,
  notes       text COMMENT 'Free text written by the sales team',
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='People who bought something; one row per person';

CREATE TABLE products (
  id     int NOT NULL,
  sku    varchar(20) NOT NULL,
  title  varchar(255) NOT NULL,
  price  decimal(10,2) DEFAULT NULL,
  attrs  json DEFAULT NULL,
  price_cents int GENERATED ALWAYS AS (price * 100) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tags (id int NOT NULL, label varchar(100) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB;
CREATE TABLE product_tags (
  product_id int NOT NULL,
  tag_id     int NOT NULL,
  PRIMARY KEY (product_id, tag_id),
  KEY tag_id (tag_id),
  CONSTRAINT fk_pt_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags (id)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id          int NOT NULL,
  customer_id int unsigned NOT NULL,
  ordered_at  datetime NOT NULL,
  status      enum('paid','shipped','cancelled') NOT NULL DEFAULT 'paid',
  total       decimal(10,2) NOT NULL,
  PRIMARY KEY (id),
  KEY orders_customer_idx (customer_id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  order_id   int NOT NULL,
  line_no    int NOT NULL,
  product_id int NOT NULL,
  quantity   int NOT NULL,
  PRIMARY KEY (order_id, line_no),
  KEY product_id (product_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_qty CHECK (quantity >= 0)
) ENGINE=InnoDB;

CREATE TABLE shipments (
  id         int NOT NULL AUTO_INCREMENT,
  order_id   int NOT NULL,
  line_no    int NOT NULL,
  carrier    varchar(100) DEFAULT NULL,
  shipped_at date DEFAULT NULL,
  PRIMARY KEY (id),
  KEY order_id (order_id, line_no),
  CONSTRAINT fk_ship_item FOREIGN KEY (order_id, line_no) REFERENCES order_items (order_id, line_no)
) ENGINE=InnoDB;

CREATE TABLE `weird name` (id int NOT NULL, `select` text, `from` text, PRIMARY KEY (id)) ENGINE=InnoDB;

CREATE VIEW v_order_totals AS
  SELECT customer_id, count(*) AS n, sum(total) AS total FROM orders GROUP BY customer_id;

INSERT INTO customers VALUES
 (1, 'ana.secret@example.com', 'Ana García', 'ES', '2024-01-15 09:30:00', 'CONFIDENTIAL_NOTE_123'),
 (2, 'bob@example.com', 'Bob O''Brien', 'IE', '2024-02-01 18:45:10', 'Line one\nline two; with semicolon -- not a comment'),
 (3, 'zoe@example.com', 'Zoë 😀', 'FR', '2024-03-10 00:00:00', NULL),
 (4, 'dan@example.com', 'Dan "The Man" Smith', 'US', '2024-03-11 12:00:00', 'back\\slash path C:\\temp'),
 (5, 'eve@example.com', 'Eve', 'DE', '2024-04-01 08:00:00', ''),
 (6, 'confidential_segment_x@example.com', 'CONFIDENTIAL_CUSTOMER_74291', 'GB', '2024-04-02 08:00:00', 'CONFIDENTIAL_SEGMENT_X');
INSERT INTO products (id, sku, title, price, attrs) VALUES
 (1, 'SKU-001', 'Café', 12.50, '{"origin": "Colombia", "organic": true}'),
 (2, 'SKU-002', 'Thé', 8.00, NULL),
 (3, 'SKU-003', 'Chocolat', NULL, '{"note": "it''s a \\"quote\\""}'),
 (4, 'SKU-004', '"Quoted" title', 99.99, '[]');
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
INSERT INTO `weird name` VALUES (1, 'a;b', '--x'), (2, NULL, '/* not a comment */');
