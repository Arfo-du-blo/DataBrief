CREATE TABLE customers(id INTEGER PRIMARY KEY, email VARCHAR NOT NULL UNIQUE, "name" VARCHAR NOT NULL, country VARCHAR, created_at TIMESTAMP NOT NULL, notes VARCHAR);;
CREATE TABLE products(id INTEGER PRIMARY KEY, sku VARCHAR NOT NULL UNIQUE, title VARCHAR NOT NULL, price DECIMAL(10,2));;
CREATE TABLE tags(id INTEGER PRIMARY KEY, "label" VARCHAR NOT NULL);;
CREATE TABLE "weird name"(id INTEGER PRIMARY KEY, "select" VARCHAR, "from" VARCHAR);;
CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, ordered_at TIMESTAMP NOT NULL, status VARCHAR DEFAULT('paid') NOT NULL, total DECIMAL(10,2) NOT NULL, FOREIGN KEY (customer_id) REFERENCES customers(id));;
CREATE TABLE order_items(order_id INTEGER, line_no INTEGER, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id), CHECK((quantity >= 0)), PRIMARY KEY(order_id, line_no));;
CREATE TABLE product_tags(product_id INTEGER, tag_id INTEGER, FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY (tag_id) REFERENCES tags(id), PRIMARY KEY(product_id, tag_id));;
CREATE TABLE shipments(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, line_no INTEGER NOT NULL, carrier VARCHAR, shipped_at DATE, FOREIGN KEY (order_id, line_no) REFERENCES order_items(order_id, line_no));;
CREATE VIEW v_order_totals AS SELECT customer_id, count_star() AS n, sum(total) AS total FROM orders GROUP BY customer_id;;
CREATE INDEX orders_customer_idx ON orders(customer_id);;

